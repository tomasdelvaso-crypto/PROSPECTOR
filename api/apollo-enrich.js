const axios = require('axios');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { person } = req.body;
    const apiKey = process.env.APOLLO_API_KEY;
    
    if (!apiKey) {
      return res.status(500).json({ error: 'API key not configured' });
    }

    // Opción 1: Si tenemos el ID de Apollo, usar people/match
    if (person.id) {
      const response = await axios({
        method: 'GET',
        url: `https://api.apollo.io/v1/people/${person.id}`,
        headers: {
          'X-Api-Key': apiKey
        },
        timeout: 10000
      });
      
      console.log('Apollo GET person response:', response.data);
      
      // Si aún no tiene email real, intentar revelar
      if (response.data.email?.includes('not_unlocked')) {
        const revealResponse = await axios({
          method: 'POST',
          url: 'https://api.apollo.io/v1/emails/reveal',
          headers: {
            'X-Api-Key': apiKey,
            'Content-Type': 'application/json'
          },
          data: {
            person_id: person.id
          }
        });
        
        console.log('Email revealed:', revealResponse.data);
        return res.status(200).json({
          success: true,
          person: revealResponse.data
        });
      }
      
      return res.status(200).json({
        success: true,
        person: response.data
      });
    }
    
    // Opción 2: Buscar por nombre y empresa
    const searchResponse = await axios({
      method: 'POST',
      url: 'https://api.apollo.io/v1/people/search',
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json'
      },
      data: {
        q_person_name: person.name,
        q_organization_name: person.organization?.name,
        reveal_personal_emails: true,
        reveal_phone_numbers: true
      }
    });
    
    console.log('Apollo search response:', searchResponse.data);
    
    res.status(200).json({
      success: true,
      person: searchResponse.data.people?.[0] || person
    });

  } catch (error) {
    console.error('Apollo enrich error:', error.response?.data || error.message);
    res.status(200).json({ 
      success: false,
      error: error.message,
      details: error.response?.data
    });
  }
};
