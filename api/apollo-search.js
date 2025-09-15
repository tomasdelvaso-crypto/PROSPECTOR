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
    // Verificación crítica de API key
    const apiKey = process.env.APOLLO_API_KEY;
    if (!apiKey) {
      console.error('ERROR: APOLLO_API_KEY no está configurada en las variables de entorno');
      return res.status(500).json({ 
        error: 'Configuration error',
        message: 'API key not configured. Please check Vercel environment variables.',
        solution: 'Add APOLLO_API_KEY to your Vercel project settings'
      });
    }

    // Extraer parámetros del request
    const { query = '', filters = {}, enrichContacts = false } = req.body || {};
    
    console.log('Apollo Search Request:', {
      hasApiKey: !!apiKey,
      apiKeyLength: apiKey.length,
      query: query || 'no query',
      location: filters.location || 'Brazil',
      size: filters.size || 'default',
      titlesCount: filters.titles?.length || 0
    });

    // Construir payload para Apollo
    const apolloPayload = {
      q_organization_name: query || '',
      per_page: 25,
      page: 1,
      
      // Localización Brasil
      person_locations: filters.location ? [filters.location] : ["Brazil"],
      organization_locations: ["Brazil"],
      
      // Títulos en portugués e inglés - expandido para mejor cobertura
      person_titles: filters.titles && filters.titles.length > 0 ? filters.titles : [
        // Gerentes
        "Gerente de Qualidade", "Quality Manager",
        "Gerente de Operações", "Operations Manager", "Gerente Operacional",
        "Gerente de Logística", "Logistics Manager", "Gerente Logístico",
        "Gerente de Produção", "Production Manager", "Gerente Industrial",
        "Gerente de Supply Chain", "Supply Chain Manager",
        "Gerente de Compras", "Procurement Manager",
        
        // Directores
        "Diretor de Operações", "Operations Director", "Diretor Operacional",
        "Diretor Industrial", "Industrial Director",
        "Diretor de Logística", "Logistics Director",
        "VP Operations", "Vice President Operations",
        
        // C-Level
        "CEO", "Chief Executive Officer",
        "COO", "Chief Operating Officer",
        "Presidente", "President",
        "Sócio", "Sócio Diretor"
      ],
      
      // Tamaño de empresa
      organization_num_employees_ranges: filters.size ? [filters.size] : [
        "501,1000",
        "1001,5000", 
        "5001,10000",
        "10001,"
      ],
      
      // Configuración para obtener contactos
      contact_email_status: ["verified", "guessed", "verified_likely", "unavailable"],
      include_contact_info: true,
      
      // No excluir empresas sin contacto para tener más resultados
      must_have_contact_info: false,
      
      // Ordenar por tamaño de empresa (más grandes primero)
      sort_by_field: "organization_num_employees",
      sort_ascending: false
    };

    // Si hay industrias específicas, agregarlas
    if (filters.industries && filters.industries.length > 0) {
      apolloPayload.organization_industry_tag_ids = filters.industries;
    }

    // Si hay revenue filter
    if (filters.revenue) {
      apolloPayload.organization_annual_revenue_ranges = [`${filters.revenue}M,`];
    }

    console.log('Enviando request a Apollo API...');
    console.log('Payload:', JSON.stringify(apolloPayload, null, 2));

    const response = await axios({
      method: 'POST',
      url: 'https://api.apollo.io/v1/mixed_people/search',
      data: apolloPayload,
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      },
      timeout: 30000,
      validateStatus: function (status) {
        return status < 500; // Resolver solo si el status es menor a 500
      }
    });

    console.log('Apollo Response Status:', response.status);
    console.log('Apollo Response:', {
      status: response.status,
      peopleCount: response.data?.people?.length || 0,
      hasData: !!response.data
    });

    // Verificar respuesta de Apollo
    if (response.status === 401) {
      console.error('Apollo API Key inválida');
      return res.status(401).json({ 
        error: 'Authentication failed',
        message: 'Invalid Apollo API key. Please verify your key.',
        status: 401
      });
    }

    if (response.status === 429) {
      console.error('Rate limit excedido en Apollo');
      return res.status(429).json({ 
        error: 'Rate limit exceeded',
        message: 'Too many requests to Apollo. Please wait and try again.',
        status: 429
      });
    }

    if (response.status === 422) {
      console.error('Request inválido a Apollo:', response.data);
      return res.status(422).json({ 
        error: 'Invalid request',
        message: 'Invalid parameters sent to Apollo API',
        details: response.data,
        status: 422
      });
    }

    // Procesar resultados exitosos
    let people = response.data?.people || [];
    
    console.log(`Encontrados ${people.length} prospectos en Apollo`);

    // Enriquecer contactos si está habilitado y hay API key
    if (enrichContacts && people.length > 0 && apiKey) {
      console.log('Iniciando enriquecimiento de contactos...');
      people = await enrichContactData(people.slice(0, 10), apiKey); // Limitar a 10 para no gastar créditos
    }

    // Agregar metadata para scoring
    const enrichedPeople = people.map(person => ({
      ...person,
      _metadata: {
        searchDate: new Date().toISOString(),
        searchQuery: query,
        hasEmail: !!person.email,
        hasPhone: !!(person.phone_numbers && person.phone_numbers.length > 0),
        hasLinkedIn: !!person.linkedin_url,
        contactCompleteness: calculateContactCompleteness(person)
      }
    }));
    
    // Respuesta exitosa
    res.status(200).json({
      success: true,
      people: enrichedPeople,
      pagination: response.data?.pagination || {},
      total_entries: response.data?.total_entries || people.length,
      message: `Found ${enrichedPeople.length} prospects`
    });

  } catch (error) {
    // Log detallado del error
    console.error('Apollo API Error - Full Details:', {
      message: error.message,
      code: error.code,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      headers: error.response?.headers,
      config: {
        url: error.config?.url,
        method: error.config?.method,
        hasApiKey: !!error.config?.headers?.['X-Api-Key']
      }
    });

    // Determinar el tipo de error y responder apropiadamente
    if (error.code === 'ECONNABORTED') {
      return res.status(504).json({ 
        error: 'Request timeout',
        message: 'Apollo API took too long to respond. Please try again.',
        status: 504
      });
    }

    if (error.response?.status === 401) {
      return res.status(401).json({ 
        error: 'Authentication failed',
        message: 'Apollo API key is invalid or expired. Please check your API key.',
        status: 401
      });
    }

    if (error.response?.status === 403) {
      return res.status(403).json({ 
        error: 'Forbidden',
        message: 'Access denied. Your Apollo account may not have permission for this operation.',
        status: 403
      });
    }

    if (error.response?.status === 429) {
      return res.status(429).json({ 
        error: 'Rate limited',
        message: 'Too many requests to Apollo API. Please wait a moment and try again.',
        status: 429
      });
    }

    if (error.response?.status >= 500) {
      return res.status(502).json({ 
        error: 'Apollo API error',
        message: 'Apollo API is experiencing issues. Please try again later.',
        status: error.response.status,
        details: error.response?.data
      });
    }

    // Error genérico
    res.status(500).json({ 
      error: 'Search failed',
      message: error.message || 'An unexpected error occurred',
      details: error.response?.data || null,
      status: error.response?.status || 500
    });
  }
};

// Función para enriquecer datos de contacto
async function enrichContactData(people, apiKey) {
  const enrichedPeople = [];
  
  for (const person of people) {
    try {
      // Si no tiene email, intentar enriquecerlo
      if (!person.email && person.name && person.organization?.domain) {
        console.log(`Intentando enriquecer contacto: ${person.name}`);
        
        const enrichResponse = await axios({
          method: 'POST',
          url: 'https://api.apollo.io/v1/people/match',
          data: {
            name: person.name,
            organization_name: person.organization.name,
            domain: person.organization.domain,
            reveal_personal_emails: true,
            reveal_phone_numbers: true
          },
          headers: {
            'X-Api-Key': apiKey,
            'Content-Type': 'application/json'
          },
          timeout: 5000
        }).catch(err => {
          console.log(`No se pudo enriquecer ${person.name}: ${err.message}`);
          return null;
        });

        if (enrichResponse?.data?.person) {
          enrichedPeople.push({
            ...person,
            ...enrichResponse.data.person,
            _enriched: true
          });
        } else {
          enrichedPeople.push(person);
        }
      } else {
        enrichedPeople.push(person);
      }
    } catch (error) {
      console.error(`Error enriqueciendo ${person.name}:`, error.message);
      enrichedPeople.push(person);
    }
  }
  
  return enrichedPeople;
}

// Calcular completitud de datos de contacto
function calculateContactCompleteness(person) {
  let score = 0;
  if (person.email) score += 40;
  if (person.phone_numbers?.length > 0) score += 30;
  if (person.linkedin_url) score += 20;
  if (person.title) score += 10;
  return score;
}
