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
    return res.status(200).end();
  }

  try {
    const apiKey = process.env.APOLLO_API_KEY;
    
    if (!apiKey) {
      return res.status(500).json({ 
        error: 'Configuration error',
        message: 'API key not configured'
      });
    }

    const { query = '', filters = {}, page = 1, per_page = 25 } = req.body || {};
    
    console.log('Received request:', { query, filters, page, per_page });

    // Construir payload simple para Apollo
    const apolloPayload = {
      per_page: per_page || 25,
      page: page || 1
    };

    // Agregar query si existe
    if (query) {
      apolloPayload.q_keywords = query;
    }

    // Ubicación
    if (filters.location) {
      apolloPayload.person_locations = [filters.location];
    } else {
      apolloPayload.person_locations = ["Brazil"];
    }

    // Títulos
    if (filters.titles && filters.titles.length > 0) {
      apolloPayload.person_titles = filters.titles;
    }

    // Tamaño de empresa
    if (filters.size) {
      apolloPayload.organization_num_employees_ranges = [filters.size];
    }

    // Niveles de senioridad (si se proporcionan)
    if (filters.seniority_levels && filters.seniority_levels.length > 0) {
      apolloPayload.person_seniorities = filters.seniority_levels;
    }

    // Departamentos (si se proporcionan)
    if (filters.departments && filters.departments.length > 0) {
      apolloPayload.person_departments = filters.departments;
    }

    console.log('Apollo payload:', JSON.stringify(apolloPayload, null, 2));

    // Hacer la llamada a Apollo
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

    console.log(`Apollo returned ${response.data?.people?.length || 0} results`);

    // Obtener personas
    let people = response.data?.people || [];

    // FILTRADO DEL LADO SERVIDOR

    // 1. Filtrar por empresa si se especificó
    if (filters.company_names && filters.company_names.length > 0) {
      const targetCompany = filters.company_names[0].toLowerCase();
      const originalCount = people.length;
      
      people = people.filter(person => {
        const companyName = (person.organization?.name || '').toLowerCase();
        return companyName.includes(targetCompany) || targetCompany.includes(companyName);
      });
      
      console.log(`Company filter: ${originalCount} -> ${people.length}`);
    }

    // 2. Excluir industrias irrelevantes
    const IRRELEVANT_INDUSTRIES = [
      'financial', 'banking', 'insurance', 'fintech',
      'real estate', 'construction', 'architecture',
      'consulting', 'accounting', 'legal', 'law',
      'software development', 'it services', 'saas', 'computer software',
      'education', 'training', 'school', 'university',
      'media', 'advertising', 'marketing agency',
      'investment', 'venture capital', 'private equity',
      'government', 'non-profit', 'ngo',
      'telecommunications', 'telecom'
    ];

    if (!filters.skip_industry_filter) {
      const originalCount = people.length;
      
      people = people.filter(person => {
        const industry = (person.organization?.industry || '').toLowerCase();
        const isIrrelevant = IRRELEVANT_INDUSTRIES.some(irrelevant => 
          industry.includes(irrelevant)
        );
        return !isIrrelevant;
      });
      
      console.log(`Industry filter: ${originalCount} -> ${people.length}`);
    }

    // 3. Excluir títulos no deseados
    const EXCLUDED_TITLES = [
      'assistant', 'analyst', 'intern', 'junior', 'trainee',
      'student', 'coordinator', 'specialist', 'advisor', 
      'consultant', 'sales rep', 'account executive',
      'marketing', 'hr', 'human resources', 'finance', 'it support'
    ];

    const originalTitleCount = people.length;
    
    people = people.filter(person => {
      const title = (person.title || '').toLowerCase();
      const isExcluded = EXCLUDED_TITLES.some(excluded => 
        title.includes(excluded)
      );
      return !isExcluded;
    });
    
    console.log(`Title filter: ${originalTitleCount} -> ${people.length}`);

    // 4. Solo empresas con más de 100 empleados
    people = people.filter(person => {
      const employees = person.organization?.estimated_num_employees || 0;
      return employees >= 100;
    });

    console.log(`Final count after all filters: ${people.length}`);

    // Enriquecer con metadata
    const enrichedPeople = people.map(person => ({
      ...person,
      _metadata: {
        searchDate: new Date().toISOString(),
        hasEmail: !!person.email && person.email !== 'email_not_unlocked@domain.com',
        hasPhone: !!(person.phone_numbers?.length > 0),
        hasLinkedIn: !!person.linkedin_url,
        companySize: person.organization?.estimated_num_employees || 0,
        industry: person.organization?.industry || 'Unknown'
      }
    }));

    // Respuesta exitosa
    return res.status(200).json({
      success: true,
      people: enrichedPeople,
      total: enrichedPeople.length,
      pagination: {
        page: page,
        per_page: per_page,
        has_more: response.data?.pagination?.has_more_pages || false
      },
      filtered: {
        original: response.data?.people?.length || 0,
        afterFilters: enrichedPeople.length
      }
    });

  } catch (error) {
    console.error('Apollo API Error:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data
    });

    // Manejo de errores específicos
    if (error.response?.status === 422) {
      return res.status(422).json({ 
        error: 'Invalid parameters',
        message: 'Apollo rejected the search parameters',
        details: error.response.data
      });
    }

    if (error.response?.status === 401) {
      return res.status(401).json({ 
        error: 'Authentication failed',
        message: 'Apollo API key is invalid or missing'
      });
    }

    if (error.response?.status === 429) {
      return res.status(429).json({ 
        error: 'Rate limited',
        message: 'Too many requests to Apollo. Please wait.'
      });
    }

    // Error genérico
    return res.status(500).json({ 
      error: 'Search failed',
      message: error.message || 'Unknown error occurred',
      details: error.response?.data || null
    });
  }
};
