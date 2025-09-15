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

    const { query = '', filters = {}, page = 1, per_page = 25 } = req.body || {};
    
    // Si hay una empresa específica, primero buscar su ID
    let organizationId = null;
    if (filters.company_names && filters.company_names.length > 0) {
      const companyName = filters.company_names[0];
      console.log('Buscando empresa específica:', companyName);
      
      try {
        // Buscar la organización primero
        const orgResponse = await axios({
          method: 'POST',
          url: 'https://api.apollo.io/v1/organizations/search',
          data: {
            q_organization_name: companyName,
            per_page: 5,
            page: 1
          },
          headers: {
            'X-Api-Key': apiKey,
            'Content-Type': 'application/json'
          }
        });
        
        if (orgResponse.data?.organizations?.length > 0) {
          // Buscar coincidencia exacta o más cercana
          const exactMatch = orgResponse.data.organizations.find(
            org => org.name.toLowerCase() === companyName.toLowerCase()
          );
          
          if (exactMatch) {
            organizationId = exactMatch.id;
            console.log('Empresa encontrada con ID:', organizationId);
          } else {
            // Usar la primera si no hay coincidencia exacta
            organizationId = orgResponse.data.organizations[0].id;
            console.log('Usando aproximación:', orgResponse.data.organizations[0].name);
          }
        }
      } catch (orgError) {
        console.log('No se pudo buscar la empresa, continuando sin filtro de empresa');
      }
    }
    
    // Construir payload para búsqueda de personas
    const apolloPayload = {
      q_keywords: query || '',
      per_page: per_page,
      page: page,
      
      // Si tenemos ID de organización, usarlo
      ...(organizationId && { organization_ids: [organizationId] }),
      
      // Ubicaciones
      person_locations: filters.location ? [filters.location] : ["Brazil"],
      
      // Títulos de cargo
      person_titles: filters.titles || [
        "Manager",
        "Director", 
        "CEO",
        "President",
        "COO",
        "VP",
        "Head",
        "Chief"
      ],
      
      // Departamentos relevantes
      person_departments: filters.departments || [
        "operations",
        "logistics",
        "supply_chain",
        "procurement",
        "quality",
        "manufacturing",
        "production",
        "warehouse",
        "fulfillment"
      ],
      
      // Niveles de senioridad
      person_seniorities: filters.seniority_levels || [
        "manager",
        "director",
        "vp",
        "owner",
        "c_suite"
      ],
      
      // Tamaño de empresa
      organization_num_employees_ranges: filters.size ? [filters.size] : ["501,1000", "1001,5000", "5001,10000"],
      
      // Industrias (si se especifican)
      ...(filters.industries && { organization_industry_tag_ids: filters.industries })
    };
    
    console.log('Apollo payload:', JSON.stringify(apolloPayload, null, 2));
    
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
    
    // Filtrado adicional del lado servidor
    let people = response.data?.people || [];
    
    // FILTRO AGRESIVO: Si se especificó una empresa, filtrar solo esa empresa
    if (filters.company_names && filters.company_names.length > 0) {
      const targetCompany = filters.company_names[0].toLowerCase();
      people = people.filter(person => {
        const companyName = (person.organization?.name || '').toLowerCase();
        return companyName.includes(targetCompany) || targetCompany.includes(companyName);
      });
      console.log(`Filtrado por empresa: ${people.length} coincidencias`);
    }
    
    // FILTRO: Excluir industrias irrelevantes
    const IRRELEVANT_INDUSTRIES = [
      'financial', 'banking', 'insurance', 'fintech',
      'real estate', 'construction', 'architecture',
      'consulting', 'accounting', 'legal', 'law',
      'software', 'it services', 'saas', 'technology', 'computer',
      'education', 'training', 'school', 'university',
      'media', 'advertising', 'marketing agency',
      'investment', 'venture capital', 'private equity',
      'government', 'non-profit', 'ngo'
    ];
    
    people = people.filter(person => {
      const industry = (person.organization?.industry || '').toLowerCase();
      return !IRRELEVANT_INDUSTRIES.some(irrelevant => industry.includes(irrelevant));
    });
    
    // FILTRO: Excluir cargos junior/irrelevantes
    const EXCLUDED_TITLES = [
      'assistant', 'analyst', 'intern', 'junior', 'trainee', 
      'student', 'coordinator', 'specialist', 'advisor', 'consultant',
      'sales', 'marketing', 'hr', 'finance', 'it'
    ];
    
    people = people.filter(person => {
      const title = (person.title || '').toLowerCase();
      return !EXCLUDED_TITLES.some(excluded => title.includes(excluded));
    });
    
    // FILTRO: Solo empresas con más de 100 empleados
    people = people.filter(person => {
      const employees = person.organization?.estimated_num_employees || 0;
      return employees >= 100;
    });
    
    console.log(`After all filters: ${people.length} qualified prospects`);
    
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
    
    res.status(200).json({
      success: true,
      people: enrichedPeople,
      total: enrichedPeople.length,
      filtered: {
        original: response.data?.people?.length || 0,
        afterFilters: enrichedPeople.length
      }
    });
    
  } catch (error) {
    console.error('Apollo Error:', error.message);
    
    res.status(500).json({ 
      error: 'Search failed',
      message: error.message || 'Unknown error',
      details: error.response?.data
    });
  }
};
