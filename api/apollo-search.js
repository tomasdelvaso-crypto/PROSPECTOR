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

    console.log('Recibiendo request con filtros:', filters);

    const apolloPayload = {
      api_key: process.env.APOLLO_API_KEY,
      q_organization_name: query || '',
      per_page: 25,
      page: 1,
      person_locations: [filters?.location || "Brazil"],
      person_titles: filters?.titles || ["Gerente", "Director", "CEO", "Manager"]
    };

    // Agregar tamaño si existe
    if (filters?.size) {
      apolloPayload.organization_num_employees_ranges = [filters.size];
    }

    console.log('Enviando a Apollo:', apolloPayload);

    const response = await axios.post(
      'https://api.apollo.io/v1/mixed_people/search',
      apolloPayload,
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache'
        }
      }
    );

    console.log('Respuesta de Apollo recibida');
    res.status(200).json(response.data);

  } catch (error) {
    console.error('Error en apollo-search:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Error searching prospects',
      details: error.response?.data || error.message 
    });
  }
};
