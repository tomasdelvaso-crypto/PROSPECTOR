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
    
    // Construir payload para Apollo
    const apolloPayload = {
      per_page: per_page || 25,
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
    const stats = {
      original: people.length,
      afterCompany: 0,
      afterIndustry: 0,
      afterTitle: 0,
      afterSize: 0,
      final: 0,
      removedByIndustry: [],
      removedByTitle: [],
      removedBySize: []
    };

    console.log(`\n=== ANÁLISIS DE FILTRADO ===`);
    console.log(`Resultados originales: ${people.length}`);
    
    // Muestra sample de lo que llega
    if (people.length > 0) {
      console.log('\nMuestra de 5 personas recibidas:');
      people.slice(0, 5).forEach(p => {
        console.log(`- ${p.name} | ${p.title} | ${p.organization?.name} | ${p.organization?.industry} | ${p.organization?.estimated_num_employees} emp`);
      });
    }

    // 1. Filtro por empresa específica (si se especificó)
    if (filters.company_names?.length > 0) {
      const targetCompany = filters.company_names[0].toLowerCase();
      people = people.filter(person => {
        const companyName = (person.organization?.name || '').toLowerCase();
        return companyName.includes(targetCompany) || targetCompany.includes(companyName);
      });
      stats.afterCompany = people.length;
      console.log(`Después de filtro empresa: ${stats.afterCompany}`);
    }

    // 2. Filtro de industrias - AJUSTADO PARA BRASIL
    const IRRELEVANT_INDUSTRIES = [
      'banking', 'banco', 'financ',
      'insurance', 'seguro',
      'consulting', 'consultoria',
      'legal', 'advocacia', 'jurídico',
      'education', 'educação', 'ensino',
      'government', 'governo',
      'non-profit', 'ong'
    ];

    people = people.filter(person => {
      const industry = (person.organization?.industry || '').toLowerCase();
      const isIrrelevant = IRRELEVANT_INDUSTRIES.some(term => industry.includes(term));
      
      if (isIrrelevant) {
        stats.removedByIndustry.push(`${person.organization?.name} (${industry})`);
      }
      return !isIrrelevant;
    });
    stats.afterIndustry = people.length;
    console.log(`Después de filtro industria: ${stats.afterIndustry}`);

    // 3. Filtro de títulos - MÁS PERMISIVO
    const EXCLUDED_TITLES = [
      'intern', 'estagiário', 'estagiária',
      'trainee', 'aprendiz',
      'student', 'estudante',
      'junior', 'júnior',
      'assistente', 'assistant'
    ];

    people = people.filter(person => {
      const title = (person.title || '').toLowerCase();
      const isExcluded = EXCLUDED_TITLES.some(term => title.includes(term));
      
      if (isExcluded) {
        stats.removedByTitle.push(`${person.name} (${title})`);
      }
      return !isExcluded;
    });
    stats.afterTitle = people.length;
    console.log(`Después de filtro título: ${stats.afterTitle}`);

    // 4. Filtro de tamaño - AJUSTADO
    const MIN_EMPLOYEES = 50; // Bajado de 100
    people = people.filter(person => {
      const employees = person.organization?.estimated_num_employees || 0;
      
      if (employees < MIN_EMPLOYEES && employees > 0) {
        stats.removedBySize.push(`${person.organization?.name} (${employees} emp)`);
      }
      
      // Si no hay dato de empleados, lo dejamos pasar
      return employees >= MIN_EMPLOYEES || employees === 0;
    });
    stats.afterSize = people.length;
    stats.final = people.length;

    console.log(`\n=== RESUMEN DE FILTRADO ===`);
    console.log(`Original: ${stats.original}`);
    console.log(`Después de empresa: ${stats.afterCompany || stats.original}`);
    console.log(`Después de industria: ${stats.afterIndustry} (eliminados: ${stats.removedByIndustry.length})`);
    console.log(`Después de título: ${stats.afterTitle} (eliminados: ${stats.removedByTitle.length})`);
    console.log(`Después de tamaño: ${stats.afterSize} (eliminados: ${stats.removedBySize.length})`);
    console.log(`FINAL: ${stats.final}`);

    if (stats.removedByIndustry.length > 0) {
      console.log('\nEliminados por industria:', stats.removedByIndustry.slice(0, 5));
    }
    if (stats.removedByTitle.length > 0) {
      console.log('Eliminados por título:', stats.removedByTitle.slice(0, 5));
    }
    if (stats.removedBySize.length > 0) {
      console.log('Eliminados por tamaño:', stats.removedBySize.slice(0, 5));
    }

    // Enriquecer con metadata
    const enrichedPeople = people.map(person => ({
      ...person,
      _metadata: {
        searchDate: new Date().toISOString(),
        hasEmail: !!person.email && person.email !== 'email_not_unlocked@domain.com',
        hasPhone: !!(person.phone_numbers?.length > 0),
        hasLinkedIn: !!person.linkedin_url
      }
    }));

    return res.status(200).json({
      success: true,
      people: enrichedPeople,
      total: enrichedPeople.length,
      stats: stats, // Incluir estadísticas para debugging
      pagination: {
        page: page,
        per_page: per_page,
        has_more: response.data?.pagination?.has_more_pages || false
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
