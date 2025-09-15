const axios = require('axios');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { firstName, lastName, company, domain, linkedinUrl } = req.body;
    const apiKey = process.env.LUSHA_API_KEY;
    
    console.log('Lusha request:', { firstName, lastName, company, domain, linkedinUrl });
    
    if (!apiKey) {
      return res.status(200).json({ 
        enriched: false,
        message: 'Lusha API key no configurada'
      });
    }
    
    const params = {};
    if (linkedinUrl) params.linkedinUrl = linkedinUrl;
    if (firstName) params.firstName = firstName;
    if (lastName) params.lastName = lastName;
    if (company) params.companyName = company;
    if (domain) params.companyDomain = domain;
    
    params.revealPhones = true;
    params.revealEmails = true;
    
    console.log('Lusha params:', params);
    
    const response = await axios({
      method: 'GET',
      url: 'https://api.lusha.com/v2/person',
      headers: {
        'api_key': apiKey,
        'Content-Type': 'application/json'
      },
      params: params
    });
    
    console.log('Lusha raw response structure:', JSON.stringify(response.data, null, 2));
    
    // La estructura correcta según tus logs es response.data con los datos directamente
    if (response.data) {
      const rawData = response.data;
      
      // Buscar los datos en diferentes ubicaciones posibles
      let personData = null;
      
      if (rawData.data) {
        personData = rawData.data;
      } else if (rawData.contact) {
        personData = rawData.contact;
      } else if (rawData.phoneNumbers || rawData.emailAddresses) {
        personData = rawData;
      }
      
      if (personData) {
        const phones = [];
        if (personData.phoneNumbers && Array.isArray(personData.phoneNumbers)) {
          personData.phoneNumbers.forEach(phone => {
            if (phone && phone.number) {
              phones.push({
                number: phone.number,
                type: phone.phoneType || 'unknown',
                source: 'Lusha'
              });
            }
          });
        }
        
        const emails = [];
        if (personData.emailAddresses && Array.isArray(personData.emailAddresses)) {
          personData.emailAddresses.forEach(email => {
            if (email && email.email) {
              emails.push(email.email);
            }
          });
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
            company: personData.company?.name,
            rawData: rawData
          }
        });
      }
    }
    
    // Si llegamos acá, no pudimos procesar los datos
    return res.status(200).json({
      enriched: false,
      message: 'No data found in expected structure',
      rawResponse: response.data
    });
    
  } catch (error) {
    console.error('Lusha error:', error.message);
    console.error('Error details:', error.response?.data);
    
    return res.status(200).json({ 
      enriched: false,
      error: error.message,
      details: error.response?.data
    });
  }
};
