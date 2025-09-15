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
      return res.status(500).json({ 
        error: 'API key not configured'
      });
    }

    const { query = '', filters = {}, page = 1, per_page = 25 } = req.body;
    
    // MAPEO DE INDUSTRIAS RELEVANTES
    const INDUSTRY_KEYWORDS = {
      'ecommerce': ['e-commerce', 'ecommerce', 'retail', 'varejo', 'marketplace', 'online'],
      'logistics': ['logistics', 'logística', '3pl', 'fulfillment', 'warehouse', 'armazém', 'transporte', 'shipping'],
      'manufacturing': ['manufacturing', 'manufatura', 'indústria', 'industrial', 'fábrica', 'produção'],
      'food': ['food', 'alimento', 'bebida', 'beverage', 'fmcg', 'consumer goods'],
      'pharma': ['pharmaceutical', 'farmacêutica', 'cosmetic', 'cosmética', 'healthcare', 'saúde'],
      'automotive': ['automotive', 'automotiva', 'autopeças', 'auto parts', 'vehicles']
    };

    // Construir payload para Apollo
    const apolloPayload = {
      per_page: 50, // Pedir más para tener margen después del filtrado
      page: page || 1
    };

    if (query) apolloPayload.q_keywords = query;
    if (filters.location) apolloPayload.person_locations = [filters.location];
    if (filters.titles?.length > 0) apolloPayload.person_titles = filters.titles;
    if (filters.size) apolloPayload.organization_num_employees_ranges = [filters.size];

    console.log('Apollo request:', JSON.stringify(apolloPayload, null, 2));

    const response = await axios({
      method: 'POST',
      url: 'https://api.apollo.io/v1/mixed_people/search',
      data: apolloPayload,
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json'
      }
    });

    let people = response.data?.people || [];
    console.log(`Apollo devolvió: ${people.length} resultados`);

    // FILTRADO AGRESIVO POR INDUSTRIA SELECCIONADA
    if (filters.industries && filters.industries.length > 0) {
      const selectedIndustry = filters.industries[0].toLowerCase();
      console.log(`Filtrando por industria: ${selectedIndustry}`);
      
      // Obtener keywords para la industria seleccionada
      const industryKeywords = INDUSTRY_KEYWORDS[selectedIndustry] || [];
      
      people = people.filter(person => {
        const companyIndustry = (person.organization?.industry || '').toLowerCase();
        const companyName = (person.organization?.name || '').toLowerCase();
        const companyDescription = (person.organization?.short_description || '').toLowerCase();
        
        // Buscar coincidencias con keywords de la industria
        const matchesIndustry = industryKeywords.some(keyword => 
          companyIndustry.includes(keyword) ||
          companyName.includes(keyword) ||
          companyDescription.includes(keyword)
        );
        
        return matchesIndustry;
      });
      
      console.log(`Después de filtro de industria específica: ${people.length} resultados`);
    }

    // FILTRO 1: Excluir SIEMPRE industrias irrelevantes
    const ALWAYS_EXCLUDE = [
      'banking', 'banco', 'bank',
      'insurance', 'seguro', 'seguros',
      'financial services', 'servicios financieros',
      'consulting', 'consultoria', 'consultant',
      'software development', 'desarrollo de software',
      'it services', 'servicios de ti',
      'legal', 'advocacia', 'law firm',
      'education', 'educação', 'university',
      'government', 'governo',
      'non-profit', 'ong',
      'real estate', 'imobiliária',
      'telecommunications', 'telecom'
    ];

    const beforeExclude = people.length;
    people = people.filter(person => {
      const industry = (person.organization?.industry || '').toLowerCase();
      const isExcluded = ALWAYS_EXCLUDE.some(term => industry.includes(term));
      
      if (isExcluded) {
        console.log(`Excluido: ${person.organization?.name} - ${industry}`);
      }
      
      return !isExcluded;
    });
    console.log(`Industrias excluidas: ${beforeExclude} -> ${people.length}`);

    // FILTRO 2: Por empresa específica
    if (filters.company_names?.length > 0) {
      const targetCompany = filters.company_names[0].toLowerCase();
      people = people.filter(person => {
        const companyName = (person.organization?.name || '').toLowerCase();
        return companyName.includes(targetCompany) || targetCompany.includes(companyName);
      });
      console.log(`Filtro empresa "${filters.company_names[0]}": ${people.length} resultados`);
    }

    // FILTRO 3: Títulos no deseados
    const EXCLUDED_TITLES = [
      'intern', 'estagiário',
      'trainee', 'aprendiz',
      'student', 'estudante',
      'junior', 'júnior',
      'assistant', 'assistente',
      'analyst', 'analista' // Agregado
    ];

    people = people.filter(person => {
      const title = (person.title || '').toLowerCase();
      return !EXCLUDED_TITLES.some(term => title.includes(term));
    });

    // FILTRO 4: Tamaño mínimo
    people = people.filter(person => {
      const employees = person.organization?.estimated_num_employees || 0;
      return employees >= 100 || employees === 0; // 0 significa sin datos
    });

    // PRIORIZACIÓN: Ordenar por relevancia
    people = people.map(person => {
      let score = 0;
      
      // Score por cargo
      const title = (person.title || '').toLowerCase();
      if (title.includes('director') || title.includes('diretor')) score += 30;
      else if (title.includes('manager') || title.includes('gerente')) score += 20;
      else if (title.includes('head')) score += 25;
      else if (title.includes('ceo') || title.includes('president')) score += 40;
      
      // Score por tamaño de empresa
      const employees = person.organization?.estimated_num_employees || 0;
      if (employees > 5000) score += 30;
      else if (employees > 1000) score += 20;
      else if (employees > 500) score += 10;
      
      // Score por datos disponibles
      if (person.email && person.email !== 'email_not_unlocked@domain.com') score += 10;
      if (person.phone_numbers?.length > 0) score += 10;
      
      return { ...person, priorityScore: score };
    }).sort((a, b) => b.priorityScore - a.priorityScore);

    // Limitar a 25 resultados mejores
    people = people.slice(0, 25);

    console.log(`\n=== RESULTADO FINAL ===`);
    console.log(`Enviando ${people.length} prospectos calificados`);
    if (people.length > 0) {
      console.log('Top 3:');
      people.slice(0, 3).forEach(p => {
        console.log(`- ${p.name} | ${p.title} | ${p.organization?.name} | Score: ${p.priorityScore}`);
      });
    }

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
    return res.status(500).json({ 
      error: 'Search failed',
      message: error.message
    });
  }
};
