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
    
    if (!apiKey) {
      return res.status(200).json({ 
        enriched: false,
        message: 'Lusha API key not configured'
      });
    }
    
    const params = {};
    if (linkedinUrl) params.linkedinUrl = linkedinUrl;
    if (firstName) params.firstName = firstName;
    if (lastName) params.lastName = lastName;
    if (company) params.companyName = company;
    if (domain) params.companyDomain = domain;
    
    params.property = 'person';
    
    console.log('Lusha request params:', params);
    
    const response = await axios({
      method: 'GET',
      url: 'https://api.lusha.com/person',
      headers: {
        'api_key': apiKey,
        'Content-Type': 'application/json'
      },
      params: params
    });
    
    if (response.data && response.data.data) {
      const personData = response.data.data;
      
      const phones = [];
      if (personData.phoneNumbers && Array.isArray(personData.phoneNumbers)) {
        personData.phoneNumbers.forEach(phone => {
          if (phone?.internationalNumber) {
            phones.push({
              number: phone.internationalNumber,
              type: phone.phoneType || 'unknown'
            });
          }
        });
      }
      
      const email = personData.emailAddress;
      
      return res.status(200).json({
        enriched: true,
        contact: {
          email: email || null,
          phone: phones[0]?.number || null,
          phone_numbers: phones,
          fullName: personData.fullName,
          firstName: personData.firstName,
          lastName: personData.lastName,
          company: personData.company?.name
        }
      });
    }
    
    return res.status(200).json({
      enriched: false,
      message: 'No data found'
    });
    
  } catch (error) {
    console.error('Lusha error:', error.response?.data || error.message);
    
    return res.status(200).json({ 
      enriched: false,
      error: error.message
    });
  }
};
