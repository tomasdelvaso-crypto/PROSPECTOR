const axios = require('axios');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { industries, size_range, location } = req.body;
    const apiKey = process.env.APOLLO_API_KEY;
    
    if (!apiKey) {
      return res.status(500).json({ error: 'API key not configured' });
    }
    
    const apolloPayload = {
      page: 1,
      per_page: 50,
      organization_locations: [location || 'Brazil'],
      organization_industries: industries || []
    };
    
    if (size_range) {
      apolloPayload.organization_num_employees_ranges = [size_range];
    }
    
    // Limpiar payload de valores null
    Object.keys(apolloPayload).forEach(key => {
      if (!apolloPayload[key] || apolloPayload[key].length === 0) {
        delete apolloPayload[key];
      }
    });
    
    console.log('Apollo companies search:', JSON.stringify(apolloPayload, null, 2));
    
    const response = await axios({
      method: 'POST',
      url: 'https://api.apollo.io/v1/mixed_organizations/search',
      headers: { 
        'X-Api-Key': apiKey, 
        'Content-Type': 'application/json' 
      },
      data: apolloPayload,
      timeout: 30000
    });
    
    const companies = response.data?.organizations || [];
    
    // Ordenar por tamaño descendente
    companies.sort((a, b) => 
      (b.estimated_num_employees || 0) - (a.estimated_num_employees || 0)
    );
    
    return res.status(200).json({
      success: true,
      companies: companies.slice(0, 20),
      total: companies.length
    });
    
  } catch (error) {
    console.error('Apollo companies error:', error.response?.data || error.message);
    return res.status(200).json({
      success: false,
      companies: [],
      error: error.message
    });
  }
};
