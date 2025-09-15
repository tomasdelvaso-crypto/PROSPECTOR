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
    
    // Construir los parámetros según la documentación
    const params = {};
    
    // Priorizar LinkedIn URL si está disponible
    if (linkedinUrl) {
      params.linkedinUrl = linkedinUrl;
    }
    
    // Siempre incluir nombre y empresa para mejor matching
    if (firstName) params.firstName = firstName;
    if (lastName) params.lastName = lastName;
    if (company) params.companyName = company;
    if (domain) params.companyDomain = domain;
    
    // IMPORTANTE: Activar revelación de datos (consume créditos)
    params.revealPhones = true;  // Gasta 5 créditos
    params.revealEmails = true;  // Gasta 1 crédito
    
    console.log('Lusha params con reveal activado:', params);
    
    // Hacer la llamada a Lusha
    const response = await axios({
      method: 'GET',
      url: 'https://api.lusha.com/v2/person',
      headers: {
        'api_key': apiKey,
        'Content-Type': 'application/json'
      },
      params: params
    });
    
    console.log('Lusha response status:', response.status);
    console.log('Lusha response headers:', response.headers);
    console.log('Lusha raw response:', JSON.stringify(response.data, null, 2));
    
    // Verificar si hay datos en la respuesta
    if (response.data && response.data.data) {
      const personData = response.data.data;
      
      // Procesar teléfonos
      const phones = [];
      
      // Buscar en phoneNumbers array
      if (personData.phoneNumbers && Array.isArray(personData.phoneNumbers)) {
        console.log('Found phoneNumbers array:', personData.phoneNumbers);
        personData.phoneNumbers.forEach(phone => {
          if (phone) {
            const phoneNumber = phone.internationalNumber || 
                              phone.localNumber || 
                              phone.number || 
                              phone;
            if (phoneNumber) {
              phones.push({
                number: phoneNumber,
                type: phone.type || phone.phoneType || 'unknown',
                source: 'Lusha'
              });
            }
          }
        });
      }
      
      // También buscar campos directos de teléfono
      if (personData.phone) {
        phones.push({
          number: personData.phone,
          type: 'direct',
          source: 'Lusha'
        });
      }
      
      if (personData.mobilePhone) {
        phones.push({
          number: personData.mobilePhone,
          type: 'mobile',
          source: 'Lusha'
        });
      }
      
      if (personData.directPhone) {
        phones.push({
          number: personData.directPhone,
          type: 'direct',
          source: 'Lusha'
        });
      }
      
      // Procesar emails
      const emails = [];
      
      // Buscar en emailAddresses array
      if (personData.emailAddresses && Array.isArray(personData.emailAddresses)) {
        console.log('Found emailAddresses array:', personData.emailAddresses);
        personData.emailAddresses.forEach(email => {
          if (email) {
            const emailAddress = typeof email === 'string' ? email : 
                               email.email || 
                               email.address || 
                               email;
            if (emailAddress) {
              emails.push(emailAddress);
            }
          }
        });
      }
      
      // También buscar campo directo de email
      if (personData.email && !emails.includes(personData.email)) {
        emails.push(personData.email);
      }
      
      console.log('📱 Phones found:', phones);
      console.log('📧 Emails found:', emails);
      console.log('💳 Credits consumed: ~6 (5 for phone, 1 for email)');
      
      // Devolver respuesta estructurada
      return res.status(200).json({
        enriched: true,
        source: 'lusha',
        creditsUsed: phones.length > 0 ? 6 : 1, // Estimado de créditos usados
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
          
          // Información adicional
          fullName: personData.fullName || `${firstName} ${lastName}`,
          firstName: personData.firstName || firstName,
          lastName: personData.lastName || lastName,
          title: personData.title || personData.jobTitle,
          company: personData.company || company,
          seniority: personData.seniority,
          departments: personData.departments,
          
          // LinkedIn
          linkedinUrl: personData.linkedinUrl || linkedinUrl,
          
          // Raw data para debug
          rawData: personData
        }
      });
    }
    
    // Si no hay data.data, buscar directamente en response.data
    if (response.data) {
      console.log('No data.data found, checking root level');
      return res.status(200).json({
        enriched: false,
        message: 'Lusha responded but no contact data found',
        rawResponse: response.data,
        headers: response.headers
      });
    }
    
    // No hay datos en absoluto
    return res.status(200).json({
      enriched: false,
      message: 'No data found in Lusha'
    });
    
  } catch (error) {
    console.error('❌ Lusha error:', error.message);
    console.error('Error status:', error.response?.status);
    console.error('Error data:', error.response?.data);
    
    // Manejar errores específicos
    if (error.response?.status === 403) {
      return res.status(200).json({ 
        enriched: false,
        error: 'Plan restriction - your Lusha plan may not support revealPhones/revealEmails',
        details: error.response?.data
      });
    }
    
    if (error.response?.status === 429) {
      return res.status(200).json({ 
        enriched: false,
        error: 'Rate limit or credit limit exceeded',
        details: error.response?.data
      });
    }
    
    return res.status(200).json({ 
      enriched: false,
      error: error.message,
      status: error.response?.status,
      details: error.response?.data
    });
  }
};
