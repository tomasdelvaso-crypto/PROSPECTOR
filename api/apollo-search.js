const axios = require('axios');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const apiKey = process.env.APOLLO_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'API key not configured' });
    }

    const { filters = {}, page = 1 } = req.body;
    
    // Construcción de payload con campos REALES de Apollo
    const apolloPayload = {
      page: page || 1,
      per_page: 50, // Pedir más para filtrar después
    };

    // FILTROS QUE SÍ EXISTEN EN APOLLO:
    
    // 1. Ubicación
    if (filters.location) {
      apolloPayload.person_locations = [filters.location];
    } else {
      apolloPayload.person_locations = ['Brazil'];
    }
    
    // 2. Títulos/Cargos
    if (filters.titles && filters.titles.length > 0) {
      apolloPayload.person_titles = filters.titles;
    }
    
    // 3. Tamaño de empresa
    if (filters.size) {
      apolloPayload.organization_num_employees_ranges = [filters.size];
    }
    
    // 4. Búsqueda por nombre de empresa
    if (filters.company_names && filters.company_names[0]) {
      // Apollo NO tiene q_organization_name, usa q_keywords
      apolloPayload.q_keywords = filters.company_names[0];
    }
    
    // 5. Seniority (con valores CORRECTOS de Apollo)
    apolloPayload.person_seniorities = [
      'owner',
      'c_suite',
      'vp',
      'director',
      'manager'
    ];

    console.log('Apollo request:', JSON.stringify(apolloPayload, null, 2));

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

    let people = response.data?.people || [];
    console.log(`Apollo returned ${people.length} results`);

    // FILTRADO POST-APOLLO (porque Apollo no filtra por industria)
    
    // Industrias relevantes para Ventapel
    const VENTAPEL_INDUSTRIES = {
      'ecommerce': ['e-commerce', 'retail', 'marketplace', 'varejo'],
      'logistics': ['logistics', 'logística', '3pl', 'fulfillment', 'warehouse'],
      'manufacturing': ['manufacturing', 'industrial', 'packaging', 'embalagem'],
      'food': ['food', 'beverage', 'alimento', 'bebida', 'fmcg'],
      'pharma': ['pharmaceutical', 'cosmetic', 'farmacêutica'],
      'automotive': ['automotive', 'autopeças', 'auto parts'],
      'textile': ['textile', 'fashion', 'apparel', 'moda', 'vestuário']
    };

    // Industrias a excluir siempre
    const EXCLUDE = [
      'bank', 'banco', 'insurance', 'seguro',
      'consulting', 'consultoria', 'legal', 'advocacia',
      'education', 'universidade', 'government', 'governo',
      'real estate', 'imobiliária', 'non-profit', 'ong'
    ];

    // Filtrar industrias no deseadas
    people = people.filter(person => {
      const industry = (person.organization?.industry || '').toLowerCase();
      const company = (person.organization?.name || '').toLowerCase();
      
      // Excluir industrias irrelevantes
      const isExcluded = EXCLUDE.some(term => 
        industry.includes(term) || company.includes(term)
      );
      
      return !isExcluded;
    });

    // Si hay filtro de industria específico, aplicarlo
    if (filters.industryKeywords) {
      const terms = VENTAPEL_INDUSTRIES[filters.industryKeywords] || [];
      
      if (terms.length > 0) {
        // Priorizar matches pero mantener algunos otros
        const matches = [];
        const others = [];
        
        people.forEach(person => {
          const industry = (person.organization?.industry || '').toLowerCase();
          const matchesIndustry = terms.some(term => industry.includes(term));
          
          if (matchesIndustry) {
            matches.push(person);
          } else {
            others.push(person);
          }
        });
        
        // Combinar: primero los matches, luego algunos otros
        people = [...matches, ...others.slice(0, 10)];
      }
    }

    // Filtrar títulos muy junior (Apollo's seniorities no siempre funciona bien)
    const JUNIOR_TITLES = [
      'intern', 'estagiário', 'trainee', 'student',
      'analyst', 'analista', 'assistant', 'coordinator'
    ];
    
    people = people.filter(person => {
      const title = (person.title || '').toLowerCase();
      return !JUNIOR_TITLES.some(term => title.includes(term));
    });

    // Scoring optimizado para Ventapel
    people = people.map(person => {
      let score = 0;
      
      const title = (person.title || '').toLowerCase();
      
      // Score por cargo
      if (title.includes('ceo') || title.includes('president')) score += 50;
      else if (title.includes('director')) score += 40;
      else if (title.includes('vp') || title.includes('vice')) score += 35;
      else if (title.includes('head')) score += 30;
      else if (title.includes('manager')) score += 25;
      
      // Bonus por área relevante para Ventapel
      if (title.includes('operation') || title.includes('operac')) score += 20;
      if (title.includes('logistic') || title.includes('logíst')) score += 20;
      if (title.includes('supply')) score += 15;
      if (title.includes('quality') || title.includes('qualidade')) score += 15;
      if (title.includes('production') || title.includes('produção')) score += 15;
      if (title.includes('packaging') || title.includes('embalagem')) score += 25;
      
      // Score por tamaño
      const employees = person.organization?.estimated_num_employees || 0;
      if (employees >= 5000) score += 40;
      else if (employees >= 1000) score += 30;
      else if (employees >= 500) score += 20;
      else if (employees >= 200) score += 10;
      
      // Score por industria relevante
      const industry = (person.organization?.industry || '').toLowerCase();
      const allTerms = Object.values(VENTAPEL_INDUSTRIES).flat();
      if (allTerms.some(term => industry.includes(term))) {
        score += 15;
      }
      
      // Score por datos disponibles
      if (person.email && !person.email.includes('email_not_unlocked')) score += 10;
      if (person.phone_numbers?.length > 0) score += 10;
      
      return { ...person, priorityScore: score };
    });

    // Ordenar por score y limitar
    people.sort((a, b) => b.priorityScore - a.priorityScore);
    people = people.slice(0, 25);

    console.log(`Sending ${people.length} qualified Ventapel prospects`);

    return res.status(200).json({
      success: true,
      people: people,
      total: people.length,
      pagination: {
        page: page,
        per_page: 25,
        has_more: people.length === 25
      }
    });

  } catch (error) {
    console.error('Apollo error:', error.response?.data || error.message);
    
    return res.status(200).json({
      success: true,
      people: [],
      total: 0,
      error: error.message
    });
  }
};
