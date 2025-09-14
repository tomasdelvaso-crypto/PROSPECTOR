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
    if (!process.env.APOLLO_API_KEY) {
      throw new Error('Apollo API key not configured');
    }

    console.log('Recibiendo request con filtros:', filters);

    // Construir el payload para Apollo
    const apolloPayload = {
      q_organization_name: query || '',
      per_page: 25,
      page: 1,
      person_locations: [filters?.location || "Brazil"],
      person_titles: filters?.titles && filters.titles.length > 0 
        ? filters.titles 
        : ["Gerente", "Director", "CEO", "Manager", "Gerente de Qualidade", "Gerente de Operações", "Gerente de Logística"]
    };

    // Agregar tamaño si existe
    if (filters?.size) {
      apolloPayload.organization_num_employees_ranges = [filters.size];
    }

    console.log('Enviando a Apollo con payload:', JSON.stringify(apolloPayload, null, 2));

    // IMPORTANTE: Apollo requiere la API key en el HEADER, no en el body
    const response = await axios.post(
      'https://api.apollo.io/v1/mixed_people/search',
      apolloPayload,
      {
        headers: {
          'Api-Key': process.env.APOLLO_API_KEY,  // <-- API key en el header
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache'
        }
      }
    );

    console.log('Respuesta de Apollo recibida, personas encontradas:', response.data.people?.length || 0);
    
    res.status(200).json(response.data);

  } catch (error) {
    console.error('Error completo:', error.response?.data || error.message);
    
    // Manejo específico de errores de Apollo
    if (error.response?.status === 401) {
      res.status(500).json({ 
        error: 'API key de Apollo inválida o expirada',
        details: 'Verificá que la API key esté correctamente configurada en Vercel'
      });
    } else if (error.response?.status === 422) {
      res.status(500).json({ 
        error: 'Parámetros inválidos para Apollo',
        details: error.response?.data?.error || 'Verificá los filtros enviados'
      });
    } else {
      res.status(500).json({ 
        error: 'Error searching prospects',
        details: error.response?.data || error.message 
      });
    }
  }
};
