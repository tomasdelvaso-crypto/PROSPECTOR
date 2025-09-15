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
    
    // Construir los parámetros según la documentación
    const params = {
      firstName: firstName,
      lastName: lastName
    };
    
    // Agregar company o domain si están disponibles
    if (company) {
      params.companyName = company;
    }
    if (domain) {
      params.companyDomain = domain;
    }
    
    console.log('Lusha params:', params);
    
    // Usar el endpoint correcto según la documentación
    const response = await axios({
      method: 'GET',
      url: 'https://api.lusha.com/v2/person',
      headers: {
        'api_key': apiKey, // Header correcto según la documentación
        'Content-Type': 'application/json'
      },
      params: params
    });
    
    console.log('Lusha raw response:', JSON.stringify(response.data, null, 2));
    
    // La respuesta de Lusha v2 tiene la estructura data.data
    if (response.data && response.data.data) {
      const personData = response.data.data;
      
      // Mapear los teléfonos
      const phones = [];
      if (personData.phoneNumbers && Array.isArray(personData.phoneNumbers)) {
        personData.phoneNumbers.forEach(phone => {
          if (phone) {
            phones.push({
              number: phone.internationalNumber || phone.localNumber || phone.number || phone,
              type: phone.type || 'unknown',
              source: 'Lusha'
            });
          }
        });
      }
      
      // Mapear los emails
      const emails = [];
      if (personData.emailAddresses && Array.isArray(personData.emailAddresses)) {
        personData.emailAddresses.forEach(email => {
          if (email) {
            emails.push(typeof email === 'string' ? email : email.email || email.address);
          }
        });
      }
      
      // También chequear campos directos
      if (personData.email && !emails.includes(personData.email)) {
        emails.push(personData.email);
      }
      
      console.log('Phones found:', phones);
      console.log('Emails found:', emails);
      
      return res.status(200).json({
        enriched: true,
        source: 'lusha',
        contact: {
          email: emails[0] || null,
          emails: emails,
          phone: phones[0]?.number || null,
          phones: phones,
          phone_numbers: phones.map(p => ({
            sanitized_number: p.number,
            type: p.type,
            source: 'Lusha'
          })),
          fullName: personData.fullName,
          firstName: personData.firstName,
          lastName: personData.lastName,
          company: personData.company,
          position: personData.position,
          rawData: personData
        }
      });
    }
    
    // Si no hay data.data, devolver lo que venga
    return res.status(200).json({
      enriched: false,
      message: 'No data found in Lusha response',
      rawResponse: response.data
    });
    
  } catch (error) {
    console.error('Lusha error:', error.message);
    console.error('Error status:', error.response?.status);
    console.error('Error data:', error.response?.data);
    
    return res.status(200).json({ 
      enriched: false,
      error: error.message,
      status: error.response?.status,
      details: error.response?.data
    });
  }
};
