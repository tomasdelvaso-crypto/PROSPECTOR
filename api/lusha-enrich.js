const axios = require('axios');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { firstName, lastName, company, domain } = req.body;
    const apiKey = process.env.LUSHA_API_KEY; // Necesitás agregar esto en Vercel
    
    if (!apiKey) {
      return res.status(200).json({ 
        enriched: false,
        message: 'Lusha API key no configurada'
      });
    }
    
    // Endpoint de Lusha para enriquecimiento
    const response = await axios({
      method: 'GET',
      url: 'https://api.lusha.com/person',
      headers: {
        'api_key': apiKey
      },
      params: {
        firstName: firstName,
        lastName: lastName,
        company: company,
        domain: domain
      }
    });
    
    if (response.data && response.data.person) {
      const person = response.data.person;
      return res.status(200).json({
        enriched: true,
        source: 'lusha',
        contact: {
          email: person.emailAddresses?.[0]?.email,
          emails: person.emailAddresses?.map(e => e.email),
          phone: person.phoneNumbers?.[0]?.internationalNumber,
          phones: person.phoneNumbers?.map(p => ({
            number: p.internationalNumber,
            type: p.type
          })),
          jobTitle: person.jobTitle,
          seniority: person.seniority
        }
      });
    }
    
    return res.status(200).json({
      enriched: false,
      message: 'No se encontraron datos en Lusha'
    });
    
  } catch (error) {
    console.error('Lusha error:', error.response?.data || error.message);
    return res.status(200).json({ 
      enriched: false,
      error: error.message
    });
  }
};
