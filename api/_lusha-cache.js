// api/_lusha-cache.js
// Lusha enrichment cache — shared across all vendors, 30-day TTL.
// Identity strategy: linkedinUrl (preferred) or firstName+lastName+company.
// Empty results are NOT cached.
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

let _supabase = null;
function getSupabase() {
  if (!supabaseUrl || !supabaseKey) return null;
  if (!_supabase) _supabase = createClient(supabaseUrl, supabaseKey);
  return _supabase;
}

/**
 * Normaliza params de lookup a Lusha.
 * Estrategia de identidad:
 *   1. Si hay linkedinUrl → ese es el key (más preciso)
 *   2. Si no, combinar firstName+lastName+companyName (+ companyDomain si hay)
 * Esto evita que dos búsquedas del mismo contacto con ligeras variaciones
 * (e.g., con y sin domain) generen keys distintos.
 */
function buildLookupKey(params) {
  const linkedin = (params.linkedinUrl || '').trim().toLowerCase();

  if (linkedin) {
    // Normalizar trailing slash y www
    const clean = linkedin
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/$/, '');
    return { type: 'linkedin', key: clean };
  }

  // Fallback: nombre + empresa
  const firstName = (params.firstName || '').trim().toLowerCase();
  const lastName = (params.lastName || '').trim().toLowerCase();
  const company = (params.companyName || '').trim().toLowerCase();
  const domain = (params.companyDomain || '').trim().toLowerCase();

  if (!firstName || !lastName || !company) {
    return null; // Datos insuficientes para cachear
  }

  return {
    type: 'name',
    key: `${firstName}|${lastName}|${company}${domain ? '|' + domain : ''}`
  };
}

function hashLookup(params) {
  const lookup = buildLookupKey(params);
  if (!lookup) return null;

  const canonical = JSON.stringify(lookup);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * Intenta leer cache. Si hit, retorna { hit: true, data, cacheKey }.
 * Si miss o lookup insuficiente, retorna { hit: false, cacheKey }.
 */
async function tryGet(params) {
  const cacheKey = hashLookup(params);
  if (!cacheKey) {
    console.log('⚪ Lusha cache SKIP: lookup params insuficientes');
    return { hit: false, cacheKey: null };
  }

  const supabase = getSupabase();
  if (!supabase) return { hit: false, cacheKey };

  try {
    const { data, error } = await supabase.rpc('lusha_cache_get', {
      p_lookup_hash: cacheKey
    });
    if (error) {
      console.warn('Lusha cache get error (fail-open):', error.message);
      return { hit: false, cacheKey };
    }
    if (data) {
      const who = params.linkedinUrl || `${params.firstName || ''} ${params.lastName || ''}`.trim();
      console.log(`✅ Lusha cache HIT for ${who}`);
      return { hit: true, data, cacheKey };
    }
    const who = params.linkedinUrl || `${params.firstName || ''} ${params.lastName || ''}`.trim();
    console.log(`⚪ Lusha cache MISS for ${who}`);
    return { hit: false, cacheKey };
  } catch (e) {
    console.warn('Lusha cache get exception (fail-open):', e.message);
    return { hit: false, cacheKey };
  }
}

/**
 * Guarda resultado en cache — SOLO si el enrichment fue productivo.
 * Criterio: al menos 1 email O 1 teléfono. Resultados vacíos no se cachean
 * (no costaron crédito, y el próximo vendedor podría tener mejor suerte con
 * otros params, o Lusha podría haber actualizado su base).
 */
async function set(cacheKey, params, result, vendor) {
  if (!cacheKey) return;

  const supabase = getSupabase();
  if (!supabase) return;

  // Support multiple response shapes:
  // - PROSPECTOR shape: result.all_emails / result.all_phones
  // - ProspMini shape:  result.enriched_data.emails / result.enriched_data.phones
  const emails = result.all_emails || result.enriched_data?.emails || [];
  const phones = result.all_phones || result.enriched_data?.phones || [];
  const emailsCount = emails.length;
  const phonesCount = phones.length;

  if (emailsCount === 0 && phonesCount === 0) {
    console.log('⚪ Lusha cache SKIP SET: resultado vacío, no se cachea');
    return;
  }

  try {
    const { error } = await supabase.rpc('lusha_cache_set', {
      p_lookup_hash: cacheKey,
      p_lookup_params: params,
      p_result: result,
      p_emails_count: emailsCount,
      p_phones_count: phonesCount,
      p_vendor: vendor || null
    });
    if (error) console.warn('Lusha cache set error (fail-open):', error.message);
    else console.log(`💾 Lusha cache SET: ${emailsCount} emails, ${phonesCount} phones`);
  } catch (e) {
    console.warn('Lusha cache set exception (fail-open):', e.message);
  }
}

module.exports = { tryGet, set };
