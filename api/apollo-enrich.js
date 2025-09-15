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
    const apiKey = process.env.APOLLO_API_KEY;
    
    console.log('Apollo Enrich Request:', { contactId, contactData });
    
    // Primero intentar obtener por ID si lo tenemos
    if (contactId) {
      try {
        // Opción 1: Obtener el contacto completo por ID
        const personResponse = await axios({
          method: 'GET',
          url: `https://api.apollo.io/v1/people/${contactId}`,
          headers: {
            'Cache-Control': 'no-cache',
            'Content-Type': 'application/json',
            'X-Api-Key': apiKey
          }
        });
        
        console.log('Person by ID response:', personResponse.data);
        
        // Si encontramos la persona pero sin teléfono, intentar enrich
        if (personResponse.data?.person) {
          const person = personResponse.data.person;
          
          // Si no tiene teléfono, intentar hacer un enrich adicional
          if (!person.phone_numbers || person.phone_numbers.length === 0) {
            try {
              const enrichResponse = await axios({
                method: 'POST',
                url: 'https://api.apollo.io/v1/people/match',
                headers: {
                  'Cache-Control': 'no-cache',
                  'Content-Type': 'application/json',
                  'X-Api-Key': apiKey
                },
                data: {
                  first_name: person.first_name,
                  last_name: person.last_name,
                  organization_name: person.organization?.name,
                  email: person.email,
                  reveal_personal_emails: true,
                  reveal_phone_numbers: true,
                  reveal_personal_phone_numbers: true // Agregar esto
                }
              });
              
              console.log('Enrich response:', enrichResponse.data);
              
              if (enrichResponse.data?.person) {
                return res.status(200).json({
                  enriched: true,
                  contact: enrichResponse.data.person
                });
              }
            } catch (enrichError) {
              console.log('Enrich failed, using original person data');
            }
          }
          
          return res.status(200).json({
            enriched: true,
            contact: person
          });
        }
      } catch (error) {
        console.log('Get by ID failed:', error.message);
      }
    }
    
    // Si no funciona por ID, intentar match por datos
    if (contactData) {
      const matchResponse = await axios({
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
          domain: contactData.organization_name ? null : contactData.email?.split('@')[1],
          reveal_personal_emails: true,
          reveal_phone_numbers: true,
          reveal_personal_phone_numbers: true,
          reveal_mobile_phones: true // Agregar móviles también
        }
      });
      
      console.log('Match response:', matchResponse.data);
      
      return res.status(200).json({
        enriched: true,
        contact: matchResponse.data.person || matchResponse.data
      });
    }
    
    return res.status(200).json({ 
      enriched: false,
      message: 'No se pudo enriquecer el contacto'
    });
    
  } catch (error) {
    console.error('Error en Apollo enrich:', error.response?.data || error.message);
    
    return res.status(200).json({ 
      enriched: false,
      error: error.response?.data?.error || error.message
    });
  }
};
