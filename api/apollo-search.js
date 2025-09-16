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
    
    // Payload optimizado para Ventapel
    const apolloPayload = {
      per_page: 100,
      page: page || 1
    };

    // Location - más flexible
    if (filters.location && filters.location.includes('Santa Catarina')) {
      apolloPayload.person_locations = ['Brazil'];
    } else if (filters.location) {
      apolloPayload.person_locations = [filters.location];
    } else {
      apolloPayload.person_locations = ['Brazil'];
    }

    // Titles relevantes para Ventapel
    if (filters.titles && filters.titles.length > 0) {
      apolloPayload.person_titles = filters.titles;
    }

    // Size flexible
    if (filters.size && filters.size !== '201,500') {
      apolloPayload.organization_num_employees_ranges = [filters.size];
    }

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

    // FILTROS RELEVANTES PARA VENTAPEL
    const VENTAPEL_PRIORITY_INDUSTRIES = {
      'ecommerce': ['e-commerce', 'ecommerce', 'retail', 'varejo', 'marketplace', 'online', 'store'],
      'logistics': ['logistics', 'logística', '3pl', 'fulfillment', 'warehouse', 'shipping'],
      'manufacturing': ['manufacturing', 'manufatura', 'industrial', 'factory', 'packaging'],
      'food': ['food', 'alimento', 'beverage', 'bebida', 'fmcg'],
      'pharma': ['pharmaceutical', 'farmacêutica', 'cosmetic'],
      'automotive': ['automotive', 'automotiva', 'autopeças'],
      'textile': ['textile', 'têxtil', 'fashion', 'moda', 'apparel', 'vestuário']
    };

    // SIEMPRE EXCLUIR
    const EXCLUDE = [
      'bank', 'banco', 'insurance', 'seguro',
      'consulting', 'consultoria', 'legal', 'advocacia',
      'education', 'universidade', 'government', 'governo',
      'real estate', 'imobiliária', 'hotel', 'turismo'
    ];

    // Filtrar industrias irrelevantes
    people = people.filter(person => {
      const industry = (person.organization?.industry || '').toLowerCase();
      const company = (person.organization?.name || '').toLowerCase();
      const combined = `${industry} ${company}`;
      
      // Excluir industrias no deseadas
      const isExcluded = EXCLUDE.some(term => combined.includes(term));
      if (isExcluded) return false;
      
      // Excluir empresas muy pequeñas
      const employees = person.organization?.estimated_num_employees || 0;
      if (employees > 0 && employees < 50) return false;
      
      return true;
    });

    // Si hay filtro de industria, priorizar
    if (filters.industryKeywords) {
      const terms = VENTAPEL_PRIORITY_INDUSTRIES[filters.industryKeywords] || [];
      
      if (terms.length > 0) {
        // Separar matches y no-matches
        const matches = [];
        const others = [];
        
        people.forEach(person => {
          const industry = (person.organization?.industry || '').toLowerCase();
          const company = (person.organization?.name || '').toLowerCase();
          
          if (terms.some(term => industry.includes(term) || company.includes(term))) {
            matches.push(person);
          } else {
            others.push(person);
          }
        });
        
        // Priorizar matches pero mantener algunos otros
        people = [...matches, ...others.slice(0, 15)];
      }
    }

    // Filtrar títulos irrelevantes
    const EXCLUDE_TITLES = [
      'intern', 'estagiário', 'trainee', 'student',
      'analyst', 'analista', 'assistant', 'assistente',
      'coordinator', 'coordenador', 'specialist', 'especialista'
    ];
    
    people = people.filter(person => {
      const title = (person.title || '').toLowerCase();
      return !EXCLUDE_TITLES.some(term => title.includes(term));
    });

    // Scoring optimizado para Ventapel
    people = people.map(person => {
      let score = 0;
      
      // Score por cargo
      const title = (person.title || '').toLowerCase();
      if (title.includes('ceo') || title.includes('president')) score += 50;
      else if (title.includes('director') || title.includes('diretor')) score += 45;
      else if (title.includes('vp') || title.includes('vice')) score += 40;
      else if (title.includes('head')) score += 35;
      else if (title.includes('manager') || title.includes('gerente')) score += 30;
      else if (title.includes('supervisor')) score += 20;
      
      // Bonus por área relevante
      if (title.includes('operations') || title.includes('operac')) score += 15;
      if (title.includes('logistics') || title.includes('logist')) score += 15;
      if (title.includes('supply')) score += 10;
      if (title.includes('quality') || title.includes('qualidade')) score += 10;
      if (title.includes('production') || title.includes('produc')) score += 10;
      
      // Score por tamaño de empresa
      const employees = person.organization?.estimated_num_employees || 0;
      if (employees >= 5000) score += 40;
      else if (employees >= 1000) score += 35;
      else if (employees >= 500) score += 25;
      else if (employees >= 200) score += 15;
      else if (employees >= 100) score += 10;
      
      // Score por industria relevante
      const industry = (person.organization?.industry || '').toLowerCase();
      const allPriorityTerms = Object.values(VENTAPEL_PRIORITY_INDUSTRIES).flat();
      if (allPriorityTerms.some(term => industry.includes(term))) {
        score += 20;
      }
      
      // Score por datos disponibles
      if (person.email && !person.email.includes('email_not_unlocked')) score += 15;
      if (person.phone_numbers?.length > 0) score += 15;
      if (person.linkedin_url) score += 5;
      
      return { ...person, priorityScore: score };
    });

    // Ordenar y limitar
    people.sort((a, b) => b.priorityScore - a.priorityScore);
    people = people.slice(0, 25);

    console.log(`Sending ${people.length} qualified prospects for Ventapel`);

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
    console.error('Apollo error:', error.message);
    
    return res.status(200).json({
      success: true,
      people: [],
      total: 0,
      error: error.message
    });
  }
};
