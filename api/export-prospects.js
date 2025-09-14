const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  try {
    const { tier, status, limit = 100 } = req.query;
    
    let query = supabase
      .from('prospects')
      .select('*')
      .order('ventapel_score', { ascending: false })
      .limit(limit);
    
    if (tier) {
      query = query.eq('tier', tier);
    }
    
    if (status) {
      query = query.eq('status', status);
    }
    
    const { data, error } = await query;

    if (error) throw error;

    res.status(200).json({ 
      success: true, 
      data,
      count: data?.length || 0
    });

  } catch (error) {
    console.error('Error exportando prospectos:', error);
    res.status(500).json({ 
      error: error.message
    });
  }
};
