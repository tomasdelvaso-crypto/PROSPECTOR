const axios = require('axios');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { person, first_name, last_name, company_name } = req.body;
    const apiKey = process.env.APOLLO_API_KEY;
    
    if (!apiKey) {
      return res.status(200).json({ 
        success: false,
        message: 'Apollo API key not configured' 
      });
    }

    // Opción 1: Intentar con ID si existe
    if (person?.id) {
      try {
        const response = await axios({
          method: 'POST',
          url: 'https://api.apollo.io/v1/people/match',
          headers: {
            'Cache-Control': 'no-cache',
            'Content-Type': 'application/json',
            'X-Api-Key': apiKey
          },
          data: {
            id: person.id,
            reveal_personal_emails: true,
            reveal_phone_numbers: true
          }
        });
        
        return res.status(200).json({
          success: true,
          person: response.data.person
        });
      } catch (e) {
        console.log('ID match failed, trying name match');
      }
    }
    
    // Opción 2: Match por nombre y empresa
    const matchData = {
      first_name: first_name || person?.first_name,
      last_name: last_name || person?.last_name,
      organization_name: company_name || person?.organization?.name,
      reveal_personal_emails: true,
      reveal_phone_numbers: true
    };
    
    const response = await axios({
      method: 'POST',
      url: 'https://api.apollo.io/v1/people/match',
      headers: {
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey
      },
      data: matchData
    });
    
    return res.status(200).json({
      success: true,
      person: response.data.person
    });
    
  } catch (error) {
    console.error('Apollo enrich error:', error.response?.data || error.message);
    
    return res.status(200).json({ 
      success: false,
      error: error.response?.data?.error || error.message
    });
  }
};
