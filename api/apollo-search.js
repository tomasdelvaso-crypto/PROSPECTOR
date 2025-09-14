const axios = require('axios');

module.exports = async (req, res) => {
  // Habilitar CORS
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
    const { query, filters } = req.body || {};
    
    // Verificar que tenemos la API key
    const apiKey = process.env.APOLLO_API_KEY;
    if (!apiKey) {
      console.error('Apollo API key not found in environment variables');
      throw new Error('Apollo API key not configured');
    }

    console.log('API Key existe:', !!apiKey);
    console.log('API Key length:', apiKey.length);

    // Construir el payload para Apollo - INCLUYENDO LA API KEY EN EL BODY
    const apolloPayload = {
      api_key: apiKey,  // <-- Apollo espera la key en el body
      q_organization_name: query || '',
      per_page: 10,
      page: 1,
      person_locations: [filters?.location || "Brazil"],
      person_titles: filters?.titles && filters.titles.length > 0 
        ? filters.titles 
        : ["Gerente de Qualidade", "Gerente de Operações", "Gerente de Logística", "Director", "CEO"]
    };

    // Agregar tamaño si existe
    if (filters?.size) {
      apolloPayload.organization_num_employees_ranges = [filters.size];
    }

    console.log('Enviando a Apollo...');

    // Hacer la llamada a Apollo
    const response = await axios({
      method: 'POST',
      url: 'https://api.apollo.io/v1/mixed_people/search',
      data: apolloPayload,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      },
      timeout: 30000 // 30 segundos timeout
    });

    console.log('Respuesta exitosa de Apollo');
    
    res.status(200).json(response.data);

  } catch (error) {
    console.error('Error completo:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status
    });
    
    if (error.response?.status === 401 || error.response?.status === 422) {
      res.status(500).json({ 
        error: 'API key de Apollo inválida o formato incorrecto',
        details: error.response?.data?.error || 'Verificá la configuración de la API key en Vercel'
      });
    } else {
      res.status(500).json({ 
        error: 'Error searching prospects',
        details: error.response?.data?.error || error.message 
      });
    }
  }
};
