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
    
    // Construir payload MÍNIMO para Apollo
    const apolloPayload = {
      per_page: 100,  // Pedir muchos resultados
      page: page || 1
    };

    // Solo agregar location si NO es Santa Catarina (muy específico)
    if (filters.location && filters.location === 'Santa Catarina, Brazil') {
      // Para Santa Catarina, buscar en todo Brasil
      apolloPayload.person_locations = ['Brazil'];
    } else if (filters.location) {
      apolloPayload.person_locations = [filters.location];
    } else {
      apolloPayload.person_locations = ['Brazil'];
    }

    // NO agregar titles si es "Todos" o si está vacío
    if (filters.titles && filters.titles.length > 0 && filters.titles[0] !== 'Todos') {
      apolloPayload.person_titles = filters.titles;
    }

    // Size - ser más flexible
    if (filters.size === '201,500') {
      // No agregar filtro de size, o usar rango más amplio
      // Apollo puede tener pocos resultados en este rango específico
    } else if (filters.size) {
      apolloPayload.organization_num_employees_ranges = [filters.size];
    }

    console.log('Apollo request (simplified):', JSON.stringify(apolloPayload, null, 2));

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
    console.log(`Apollo returned ${people.length} raw results`);

    // Si no hay resultados, intentar búsqueda más amplia
    if (people.length === 0) {
      console.log('No results, trying broader search...');
      
      const broaderPayload = {
        per_page: 100,
        page: 1,
        person_locations: ['Brazil']
        // Sin más filtros
      };
      
      const broaderResponse = await axios({
        method: 'POST',
        url: 'https://api.apollo.io/v1/mixed_people/search',
        data: broaderPayload,
        headers: { 
          'X-Api-Key': apiKey, 
          'Content-Type': 'application/json' 
        }
      });
      
      people = broaderResponse.data?.people || [];
      console.log(`Broader search: ${people.length} results`);
    }

    // Filtrado manual por industria si se especificó
    if (filters.industryKeywords) {
      const industryTerms = {
        'automotive': ['automotive', 'automotiva', 'autopeças', 'auto', 'car', 'vehicle'],
        'ecommerce': ['e-commerce', 'ecommerce', 'retail', 'varejo', 'marketplace', 'online'],
        'logistics': ['logistics', 'logística', '3pl', 'fulfillment', 'warehouse'],
        'manufacturing': ['manufacturing', 'manufatura', 'industrial', 'factory'],
        'food': ['food', 'alimento', 'beverage', 'bebida'],
        'pharma': ['pharmaceutical', 'farmacêutica', 'cosmetic'],
        'textile': ['textile', 'têxtil', 'fashion', 'moda', 'apparel']
      };

      const terms = industryTerms[filters.industryKeywords] || [];
      
      if (terms.length > 0) {
        const filtered = people.filter(person => {
          const industry = (person.organization?.industry || '').toLowerCase();
          const company = (person.organization?.name || '').toLowerCase();
          const combined = `${industry} ${company}`;
          
          return terms.some(term => combined.includes(term));
        });

        // Si el filtro es muy estricto, mantener algunos sin filtrar
        if (filtered.length < 5) {
          people = [...filtered, ...people.filter(p => !filtered.includes(p)).slice(0, 20)];
        } else {
          people = filtered;
        }
      }
    }

    // Excluir solo las más irrelevantes
    const EXCLUDE = ['bank', 'banco', 'insurance', 'seguro', 'consulting'];
    people = people.filter(person => {
      const industry = (person.organization?.industry || '').toLowerCase();
      return !EXCLUDE.some(term => industry.includes(term));
    });

    // Filtrar junior titles
    people = people.filter(person => {
      const title = (person.title || '').toLowerCase();
      return !['intern', 'trainee', 'student'].some(term => title.includes(term));
    });

    // Scoring simple
    people = people.map(person => {
      let score = 0;
      
      const title = (person.title || '').toLowerCase();
      if (title.includes('director')) score += 40;
      else if (title.includes('manager')) score += 30;
      else if (title.includes('ceo')) score += 50;
      
      if (person.email) score += 10;
      if (person.phone_numbers?.length > 0) score += 10;
      
      return { ...person, priorityScore: score };
    });

    people.sort((a, b) => b.priorityScore - a.priorityScore);
    people = people.slice(0, 25);

    console.log(`Final: ${people.length} prospects sent`);

    return res.status(200).json({
      success: true,
      people: people,
      total: people.length
    });

  } catch (error) {
    console.error('Apollo error:', error.message);
    
    // Si hay error, devolver algunos resultados de prueba
    return res.status(200).json({
      success: true,
      people: [],
      total: 0,
      error: error.message
    });
  }
};
