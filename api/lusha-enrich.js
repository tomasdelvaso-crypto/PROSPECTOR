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
    
    // Activar revelación de datos
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
    
    console.log('Lusha full response structure:', Object.keys(response.data));
    console.log('Lusha raw response:', JSON.stringify(response.data, null, 2));
    
    // CAMBIO IMPORTANTE: Los datos pueden estar en diferentes lugares
    let personData = null;
    
    // Opción 1: response.data.data (estructura esperada v2)
    if (response.data && response.data.data) {
      personData = response.data.data;
      console.log('Found data in response.data.data');
    }
    // Opción 2: response.data.contact (estructura alternativa)
    else if (response.data && response.data.contact) {
      personData = response.data.contact;
      console.log('Found data in response.data.contact');
    }
    // Opción 3: response.data directamente
    else if (response.data && (response.data.phoneNumbers || response.data.emailAddresses || response.data.email)) {
      personData = response.data;
      console.log('Found data in response.data root');
    }
    
    if (personData) {
      // Procesar teléfonos
      const phones = [];
      
      // Buscar en todos los campos posibles
      const phoneFields = ['phoneNumbers', 'phone_numbers', 'phones', 'phone', 'mobilePhone', 'mobile_phone', 'directPhone', 'direct_phone'];
      
      for (const field of phoneFields) {
        if (personData[field]) {
          console.log(`Found phone field "${field}":`, personData[field]);
          
          if (Array.isArray(personData[field])) {
            personData[field].forEach(phone => {
              if (phone) {
                const number = phone.internationalNumber || 
                              phone.localNumber || 
                              phone.number || 
                              phone;
                if (number && typeof number === 'string') {
                  phones.push({
                    number: number,
                    type: phone.type || phone.phoneType || field,
                    source: 'Lusha'
                  });
                }
              }
            });
          } else if (typeof personData[field] === 'string') {
            phones.push({
              number: personData[field],
              type: field,
              source: 'Lusha'
            });
          }
        }
      }
      
      // Procesar emails
      const emails = [];
      
      const emailFields = ['emailAddresses', 'email_addresses', 'emails', 'email'];
      
      for (const field of emailFields) {
        if (personData[field]) {
          console.log(`Found email field "${field}":`, personData[field]);
          
          if (Array.isArray(personData[field])) {
            personData[field].forEach(email => {
              if (email) {
                const address = typeof email === 'string' ? email : 
                               email.email || email.address || email;
                if (address && typeof address === 'string' && !emails.includes(address)) {
                  emails.push(address);
                }
              }
            });
          } else if (typeof personData[field] === 'string' && !emails.includes(personData[field])) {
            emails.push(personData[field]);
          }
        }
      }
      
      console.log('📱 Final phones found:', phones);
      console.log('📧 Final emails found:', emails);
      
      return res.status(200).json({
        enriched: true,
        source: 'lusha',
        creditsUsed: phones.length > 0 ? 6 : (emails.length > 0 ? 1 : 0),
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
          fullName: personData.fullName || personData.full_name || `${firstName} ${lastName}`,
          firstName: personData.firstName || personData.first_name || firstName,
          lastName: personData.lastName || personData.last_name || lastName,
          title: personData.title || personData.jobTitle || personData.job_title,
          company: personData.company || personData.companyName || company,
          rawData: personData
        }
      });
    }
    
    // No se encontraron datos
    return res.status(200).json({
      enriched: false,
      message: 'No contact data found in Lusha response',
      rawResponse: response.data,
      structure: {
        hasData: !!response.data,
        hasDataData: !!(response.data?.data),
        hasContact: !!(response.data?.contact),
        keys: Object.keys(response.data || {})
      }
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
