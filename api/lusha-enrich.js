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
    
    // Endpoint correcto de Lusha
    const response = await axios({
      method: 'GET',
      url: 'https://api.lusha.com/contact',  // <-- CAMBIO: endpoint correcto
      headers: {
        'Authorization': `Bearer ${apiKey}`,  // <-- CAMBIO: formato correcto del header
        'Content-Type': 'application/json'
      },
      params: {
        firstName: firstName,
        lastName: lastName,
        company: company,
        domain: domain  // agregar si lo tenés
      }
    });
    
    console.log('Lusha raw response:', JSON.stringify(response.data, null, 2));
    
    if (response.data && response.data.data) {
      const lushaData = response.data.data;
      
      // Mapeo según la estructura real de Lusha
      const phones = [];
      
      // Lusha puede devolver múltiples tipos de teléfono
      if (lushaData.phoneNumbers) {
        lushaData.phoneNumbers.forEach(phone => {
          phones.push({
            type: phone.type || 'unknown',
            number: phone.internationalNumber || phone.localNumber || phone.number,
            source: 'Lusha'
          });
        });
      }
      
      // También chequear campos individuales
      if (lushaData.mobilePhone) {
        phones.push({
          type: 'mobile',
          number: lushaData.mobilePhone,
          source: 'Lusha'
        });
      }
      
      if (lushaData.directPhone) {
        phones.push({
          type: 'direct',
          number: lushaData.directPhone,
          source: 'Lusha'
        });
      }
      
      // Emails
      const emails = [];
      if (lushaData.emailAddresses) {
        lushaData.emailAddresses.forEach(email => {
          emails.push(email.email || email);
        });
      }
      if (lushaData.email && !emails.includes(lushaData.email)) {
        emails.push(lushaData.email);
      }
      
      console.log('Processed phones:', phones);
      console.log('Processed emails:', emails);
      
      return res.status(200).json({
        enriched: true,
        source: 'lusha',
        contact: {
          email: emails[0] || null,
          emails: emails,
          phone: phones[0]?.number || null,
          phones: phones,
          // Mantener estructura para el frontend
          phone_numbers: phones.map(p => ({
            sanitized_number: p.number,
            type: p.type,
            source: p.source
          })),
          rawData: lushaData // Para debug
        }
      });
    }
    
    return res.status(200).json({
      enriched: false,
      message: 'No data found in Lusha'
    });
    
  } catch (error) {
    console.error('Lusha error details:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      headers: error.response?.headers
    });
    
    // Si es 401, el API key es inválido
    if (error.response?.status === 401) {
      return res.status(200).json({ 
        enriched: false,
        error: 'Invalid Lusha API key',
        details: error.response?.data
      });
    }
    
    // Si es 404, el endpoint es incorrecto
    if (error.response?.status === 404) {
      return res.status(200).json({ 
        enriched: false,
        error: 'Lusha endpoint not found - check API version',
        details: error.response?.data
      });
    }
    
    return res.status(200).json({ 
      enriched: false,
      error: error.message,
      details: error.response?.data
    });
  }
};
