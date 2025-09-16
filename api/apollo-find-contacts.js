const axios = require('axios');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { company_name, company_domain, titles } = req.body;
    const apiKey = process.env.APOLLO_API_KEY;
    
    if (!apiKey) {
      return res.status(500).json({ error: 'API key not configured' });
    }
    
    const apolloPayload = {
      page: 1,
      per_page: 10,
      person_titles: titles || ['Manager', 'Director', 'Gerente', 'Diretor']
    };
    
    if (company_name) {
      apolloPayload.organization_names = [company_name];
    }
    
    if (company_domain) {
      apolloPayload.organization_domains = [company_domain];
    }
    
    console.log('Apollo contacts search:', JSON.stringify(apolloPayload, null, 2));
    
    const response = await axios({
      method: 'POST',
      url: 'https://api.apollo.io/v1/mixed_people/search',
      headers: { 
        'X-Api-Key': apiKey, 
        'Content-Type': 'application/json' 
      },
      data: apolloPayload,
      timeout: 30000
    });
    
    const contacts = response.data?.people || [];
    
    return res.status(200).json({
      success: true,
      contacts: contacts,
      total: contacts.length
    });
    
  } catch (error) {
    console.error('Find contacts error:', error.response?.data || error.message);
    return res.status(200).json({
      success: false,
      contacts: [],
      error: error.message
    });
  }
};
