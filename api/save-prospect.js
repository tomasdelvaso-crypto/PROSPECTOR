const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  try {
    const prospectData = req.body;
    
    const { data, error } = await supabase
      .from('prospects')
      .insert([prospectData]);

    if (error) {
      console.error('Error Supabase:', error);
      throw error;
    }

    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Error guardando:', error);
    res.status(500).json({ error: error.message });
  }
};
