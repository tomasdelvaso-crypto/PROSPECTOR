// api/_apollo-cache.js
// Apollo search cache — fail-open, 7-day TTL, shared with all Apollo endpoints.
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
 * Normaliza filtros para hashing determinístico.
 * Ordena keys, filtra null/undefined/strings vacíos, lowercase arrays de strings.
 */
function normalizeFilters(obj) {
  if (obj === null || obj === undefined) return null;
  if (Array.isArray(obj)) {
    return obj
      .map(normalizeFilters)
      .filter(v => v !== null && v !== '' && v !== undefined);
  }
  if (typeof obj === 'object') {
    const out = {};
    Object.keys(obj).sort().forEach(k => {
      const v = normalizeFilters(obj[k]);
      if (v !== null && v !== '' && v !== undefined &&
          !(Array.isArray(v) && v.length === 0)) {
        out[k] = v;
      }
    });
    return out;
  }
  if (typeof obj === 'string') return obj.trim().toLowerCase();
  return obj;
}

function hashKey(endpoint, filters) {
  const normalized = normalizeFilters(filters);
  const canonical = JSON.stringify({ endpoint, filters: normalized });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * Intenta leer cache. Si existe y no expiró, retorna { hit: true, data }.
 * Si no, retorna { hit: false, cacheKey, normalized } para usar después en set().
 */
async function tryGet(endpoint, filters) {
  const supabase = getSupabase();
  const normalized = normalizeFilters(filters);
  const cacheKey = hashKey(endpoint, filters);

  if (!supabase) return { hit: false, cacheKey, normalized };

  try {
    const { data, error } = await supabase.rpc('apollo_cache_get', {
      p_filters_hash: cacheKey
    });
    if (error) {
      console.warn('Cache get error (fail-open):', error.message);
      return { hit: false, cacheKey, normalized };
    }
    if (data) {
      console.log(`✅ Apollo cache HIT: ${endpoint}`);
      return { hit: true, data, cacheKey, normalized };
    }
    console.log(`⚪ Apollo cache MISS: ${endpoint}`);
    return { hit: false, cacheKey, normalized };
  } catch (e) {
    console.warn('Cache get exception (fail-open):', e.message);
    return { hit: false, cacheKey, normalized };
  }
}

/**
 * Guarda resultado en cache. Fail-open: si hay error, no rompe el flujo.
 */
async function set(cacheKey, endpoint, normalized, result, totalEntries, vendor) {
  const supabase = getSupabase();
  if (!supabase) return;

  try {
    const { error } = await supabase.rpc('apollo_cache_set', {
      p_filters_hash: cacheKey,
      p_endpoint: endpoint,
      p_filters_normalized: normalized,
      p_result: result,
      p_total_entries: totalEntries || null,
      p_vendor: vendor || null
    });
    if (error) console.warn('Cache set error (fail-open):', error.message);
  } catch (e) {
    console.warn('Cache set exception (fail-open):', e.message);
  }
}

module.exports = { tryGet, set };
