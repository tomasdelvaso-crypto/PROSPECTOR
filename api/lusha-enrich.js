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
    
    console.log('Lusha response received, isCreditCharged:', response.data?.isCreditCharged);
    
    // LA ESTRUCTURA CORRECTA ES response.data.data
    if (response.data && response.data.data) {
      const personData = response.data.data;
      
      // Procesar teléfonos - ESTÁN EN personData.phoneNumbers
      const phones = [];
      if (personData.phoneNumbers && Array.isArray(personData.phoneNumbers)) {
        personData.phoneNumbers.forEach(phone => {
          if (phone && phone.number) {
            phones.push({
              number: phone.number,
              type: phone.phoneType || 'unknown',
              doNotCall: phone.doNotCall,
              source: 'Lusha'
            });
          }
        });
      }
      
      // Procesar emails - ESTÁN EN personData.emailAddresses
      const emails = [];
      if (personData.emailAddresses && Array.isArray(personData.emailAddresses)) {
        personData.emailAddresses.forEach(email => {
          if (email && email.email) {
            emails.push(email.email);
          }
        });
      }
      
      console.log('✅ Phones found:', phones);
      console.log('✅ Emails found:', emails);
      console.log('💳 Credits charged:', response.data.isCreditCharged);
      
      return res.status(200).json({
        enriched: true,
        source: 'lusha',
        creditsCharged: response.data.isCreditCharged,
        contact: {
          // Emails
          email: emails[0] || null,
          emails: emails,
          
          // Teléfonos
          phone: phones[0]?.number || null,
          phones: phones,
          phone_numbers: phones.map(p => ({
            sanitized_number: p.number,
            type: p.type,
            source: 'Lusha'
          })),
          
          // Información personal
          fullName: personData.fullName,
          firstName: personData.firstName,
          lastName: personData.lastName,
          
          // Información laboral
          title: personData.jobTitle?.title,
          seniority: personData.jobTitle?.seniority,
          departments: personData.jobTitle?.departments,
          company: personData.company?.name,
          
          // LinkedIn
          linkedinUrl: personData.socialLinks?.linkedin,
          
          // Ubicación
          location: personData.location,
          
          // Datos completos para referencia
          rawData: response.data
        }
      });
    }
    
    return res.status(200).json({
      enriched: false,
      message: 'No data found in expected structure',
      rawResponse: response.data
    });
    
  } catch (error) {
    console.error('❌ Lusha error:', error.message);
    
    return res.status(200).json({ 
      enriched: false,
      error: error.message,
      status: error.response?.status,
      details: error.response?.data
    });
  }
};
