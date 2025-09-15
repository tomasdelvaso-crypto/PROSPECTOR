const axios = require('axios');

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const apiKey = process.env.APOLLO_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ 
        error: 'Configuration error',
        message: 'API key not configured'
      });
    }

    const { query = '', filters = {} } = req.body || {};
    
    console.log('Apollo request with filters:', filters);

    // PAYLOAD CORREGIDO PARA APOLLO v1
    const apolloPayload = {
      q_keywords: query || '',  // Cambio: usar q_keywords en lugar de q_organization_name
      per_page: 10,
      page: 1,
      
      // Ubicaciones - formato correcto
      person_locations: filters.location ? [filters.location] : ["Brazil"],
      
      // Títulos - simplificado
      person_titles: filters.titles || [
        "Manager",
        "Director", 
        "CEO",
        "President",
        "Operations",
        "Logistics",
        "Quality",
        "Supply Chain"
      ],
      
      // Tamaños de empresa - formato correcto
      organization_num_employees_ranges: filters.size ? [filters.size] : ["1001,5000"]
    };

    console.log('Sending to Apollo:', JSON.stringify(apolloPayload, null, 2));

    const response = await axios({
      method: 'POST',
      url: 'https://api.apollo.io/v1/mixed_people/search',
      data: apolloPayload,
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    console.log(`Found ${response.data?.people?.length || 0} prospects`);

    // Procesar personas
    const people = response.data?.people || [];
    
    // Agregar metadata
    const enrichedPeople = people.map(person => ({
      ...person,
      _metadata: {
        searchDate: new Date().toISOString(),
        hasEmail: !!person.email,
        hasPhone: !!(person.phone_numbers?.length > 0),
        hasLinkedIn: !!person.linkedin_url
      }
    }));
    
    res.status(200).json({
      success: true,
      people: enrichedPeople,
      total: response.data?.total_entries || 0
    });

  } catch (error) {
    console.error('Apollo Error Details:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
      headers: error.response?.headers
    });

    if (error.response?.status === 422) {
      return res.status(422).json({ 
        error: 'Invalid parameters',
        message: 'Apollo rejected the search parameters. Please check the filters.',
        details: error.response.data
      });
    }

    if (error.response?.status === 401) {
      return res.status(401).json({ 
        error: 'Authentication failed',
        message: 'API key is invalid'
      });
    }

    if (error.response?.status === 429) {
      return res.status(429).json({ 
        error: 'Rate limited',
        message: 'Too many requests. Please wait.'
      });
    }

    res.status(500).json({ 
      error: 'Search failed',
      message: error.message || 'Unknown error',
      details: error.response?.data
    });
  }
};
