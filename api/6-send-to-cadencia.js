import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { company, contact, vendor_name, vendor_auth_id, source } = req.body;

    if (!company?.name || !vendor_name) {
      return res.status(400).json({ error: 'company.name e vendor_name são obrigatórios' });
    }

    // 1. Check collision
    const { data: collisionData, error: collisionErr } = await supabase.rpc('check_company_collision', {
      p_company_name: company.name,
      p_vendor: vendor_name,
    });

    if (collisionErr) {
      console.error('Collision check error:', collisionErr);
      // Don't block — just warn
    }

    const collision = collisionData?.[0]?.is_taken ? collisionData[0] : null;

    // Filter placeholder/invalid emails from Apollo ("email_not_unlocked@domain.com")
    const isValidEmail = (e) => {
      if (!e || typeof e !== 'string') return false;
      return e.includes('@')
        && e !== 'email_not_unlocked@domain.com'
        && e !== 'Não disponível';
    };

    const emailCandidates = [
      contact?.email,
      ...(contact?.all_emails || []).map(e => typeof e === 'string' ? e : e?.email),
      ...(contact?.emails_apollo || [])
    ];
    const email = emailCandidates.find(isValidEmail) || null;

    // 2. Insert lead
    const lead = {
      vendor: vendor_name,
      source: source || 'prospector',
      company_name: company.name,
      company_domain: company.website_url || company.domain || null,
      contact_name: contact?.name || null,
      contact_title: contact?.title || null,
      contact_email: email,
      contact_phone: contact?.phone || (contact?.all_phones?.[0]?.number) || (contact?.phones_apollo?.[0]?.number) || null,
      contact_linkedin: contact?.linkedin_url || null,
      stage: contact?.name ? '1b' : '1a',
      status: 'active',
      touchpoints_count: 0,
      next_touchpoint_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
    };

    const { data: newLead, error: insertErr } = await supabase
      .from('leads')
      .insert([lead])
      .select()
      .single();

    if (insertErr) {
      console.error('Insert error:', insertErr);
      return res.status(500).json({ error: 'Erro ao inserir lead: ' + insertErr.message });
    }

    return res.status(200).json({
      success: true,
      lead: newLead,
      collision: collision ? { taken_by: collision.taken_by } : null,
    });

  } catch (error) {
    console.error('Send to cadencia error:', error);
    return res.status(500).json({ error: error.message || 'Erro interno' });
  }
}
