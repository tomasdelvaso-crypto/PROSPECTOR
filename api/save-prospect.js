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
    
    // Preparar datos para guardar
    const dataToSave = {
      // Datos de la empresa
      company_name: prospectData.company_name,
      company_domain: prospectData.company_domain,
      company_industry: prospectData.company_industry,
      company_size: prospectData.company_size,
      company_location: prospectData.company_location,
      company_description: prospectData.company_description,
      
      // Datos del contacto
      contact_name: prospectData.contact_name,
      contact_title: prospectData.contact_title,
      contact_email: prospectData.contact_email,
      contact_phone: prospectData.contact_phone,
      contact_linkedin: prospectData.contact_linkedin,
      
      // Scores PPVVC
      pain_score: prospectData.pain_score || 0,
      power_score: prospectData.power_score || 0,
      vision_score: prospectData.vision_score || 0,
      value_score: prospectData.value_score || 0,
      control_score: prospectData.control_score || 0,
      compras_score: prospectData.compras_score || 0,
      total_score: prospectData.total_score || 0,
      
      // Score Ventapel
      ventapel_score: prospectData.ventapel_score,
      tier: prospectData.tier,
      
      // Análisis
      reasoning: prospectData.reasoning,
      recommended_approach: prospectData.recommended_approach,
      potential_pain_points: prospectData.potential_pain_points || [],
      
      // Metadata
      source: 'apollo',
      status: prospectData.status || 'new',
      priority: prospectData.priority,
      assigned_to: prospectData.assigned_to,
      notes: prospectData.notes,
      
      // Timestamps
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    const { data, error } = await supabase
      .from('prospects')
      .insert([dataToSave])
      .select();

    if (error) {
      console.error('Error Supabase:', error);
      throw error;
    }

    // Si se guardó exitosamente, crear una interacción inicial
    if (data && data[0]) {
      await supabase
        .from('prospect_interactions')
        .insert([{
          prospect_id: data[0].id,
          interaction_type: 'system',
          notes: 'Prospecto creado desde búsqueda Apollo',
          outcome: 'Pendiente calificación inicial',
          next_action: prospectData.tier === 'A' ? 'Contactar en 24h' : 
                       prospectData.tier === 'B' ? 'Contactar en 72h' : 
                       'Agregar a campaña de nutrición',
          created_by: 'system'
        }]);
    }

    res.status(200).json({ 
      success: true, 
      data: data?.[0],
      message: 'Prospecto guardado exitosamente'
    });

  } catch (error) {
    console.error('Error guardando prospecto:', error);
    res.status(500).json({ 
      error: error.message,
      details: 'Error al guardar en base de datos'
    });
  }
};
