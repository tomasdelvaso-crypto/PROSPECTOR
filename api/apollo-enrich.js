// api/apollo-enrich.js
const axios = require('axios');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { contactId, contactData } = req.body;
    
    if (!contactId && !contactData) {
      return res.status(400).json({ 
        error: 'Se requiere contactId o contactData' 
      });
    }

    const apiKey = process.env.APOLLO_API_KEY;
    
    // OPCIÓN 1: Si tenés el ID del contacto
    if (contactId) {
      const response = await axios({
        method: 'POST',
        url: 'https://api.apollo.io/v1/people/match',
        headers: {
          'Cache-Control': 'no-cache',
          'Content-Type': 'application/json',
          'X-Api-Key': apiKey
        },
        data: {
          id: contactId,
          reveal_personal_emails: true,
          reveal_phone_numbers: true
        }
      });
      
      return res.status(200).json({
        enriched: true,
        contact: response.data.person
      });
    }
    
    // OPCIÓN 2: Match por nombre y empresa
    if (contactData) {
      const response = await axios({
        method: 'POST',
        url: 'https://api.apollo.io/v1/people/match',
        headers: {
          'Cache-Control': 'no-cache',
          'Content-Type': 'application/json',
          'X-Api-Key': apiKey
        },
        data: {
          first_name: contactData.first_name,
          last_name: contactData.last_name,
          organization_name: contactData.organization_name,
          reveal_personal_emails: true,
          reveal_phone_numbers: true
        }
      });
      
      return res.status(200).json({
        enriched: true,
        contact: response.data.person
      });
    }
    
  } catch (error) {
    console.error('Error en Apollo enrich:', error.response?.data || error.message);
    
    return res.status(200).json({ 
      enriched: false,
      error: error.response?.data?.error || error.message
    });
  }
};
