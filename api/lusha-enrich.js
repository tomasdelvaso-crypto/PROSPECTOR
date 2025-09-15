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
    const apiKey = process.env.LUSHA_API_KEY;
    
    console.log('Lusha request:', { firstName, lastName, company, domain });
    
    if (!apiKey) {
      return res.status(200).json({ 
        enriched: false,
        message: 'Lusha API key no configurada'
      });
    }
    
    // Probar con el endpoint correcto de Lusha
    const response = await axios({
      method: 'GET',
      url: 'https://api.lusha.com/person',
      headers: {
        'api_key': apiKey,
        'Content-Type': 'application/json'
      },
      params: {
        firstName: firstName,
        lastName: lastName,
        company: company
      }
    });
    
    // IMPORTANTE: Loggear la respuesta completa
    console.log('Lusha raw response:', JSON.stringify(response.data, null, 2));
    
    // Verificar la estructura real de la respuesta
    if (response.data) {
      // La estructura puede ser diferente, ajustar según lo que veamos en logs
      const phoneNumbers = response.data.phoneNumbers || 
                           response.data.phone_numbers || 
                           response.data.phones ||
                           [];
      
      const emails = response.data.emailAddresses || 
                     response.data.email_addresses || 
                     response.data.emails ||
                     [];
      
      return res.status(200).json({
        enriched: true,
        source: 'lusha',
        contact: {
          email: emails[0]?.email || emails[0] || response.data.email,
          emails: emails,
          phone: phoneNumbers[0]?.internationalNumber || 
                 phoneNumbers[0]?.number || 
                 phoneNumbers[0],
          phones: phoneNumbers,
          rawData: response.data // Temporalmente para debug
        }
      });
    }
    
    return res.status(200).json({
      enriched: false,
      message: 'No data from Lusha'
    });
    
  } catch (error) {
    console.error('Lusha error details:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status
    });
    
    return res.status(200).json({ 
      enriched: false,
      error: error.message,
      details: error.response?.data
    });
  }
};
