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
    
    // Construir payload con campos REALES de Apollo
    const apolloPayload = {
      per_page: 50,
      page: page || 1
    };

    // Campos que SÍ existen en Apollo:
    
    // 1. Location
    if (filters.location) {
      apolloPayload.person_locations = [filters.location];
    }
    
    // 2. Job titles
    if (filters.titles && filters.titles.length > 0) {
      apolloPayload.person_titles = filters.titles;
    }
    
    // 3. Company size
    if (filters.size) {
      apolloPayload.organization_num_employees_ranges = [filters.size];
    }
    
    // 4. TRUCO: Usar q_keywords para buscar por industria (búsqueda de texto)
    if (filters.industryKeywords) {
      const industrySearchTerms = {
        'ecommerce': 'ecommerce retail marketplace varejo',
        'logistics': 'logistics fulfillment 3pl warehouse',
        'manufacturing': 'manufacturing industrial factory',
        'food': 'food beverage alimentos bebidas',
        'pharma': 'pharmaceutical cosmetic farmaceutica',
        'automotive': 'automotive autopeças vehicles',
        'textile': 'textile fashion apparel moda'
      };
      
      apolloPayload.q_keywords = industrySearchTerms[filters.industryKeywords] || '';
    }
    
    // 5. Company name search
    if (filters.company_names && filters.company_names.length > 0) {
      // Usar q_organization_domains_list si tenemos el dominio
      // O q_keywords si es solo el nombre
      apolloPayload.q_keywords = (apolloPayload.q_keywords || '') + ' ' + filters.company_names[0];
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

    // Filtrado manual post-Apollo (porque Apollo no filtra industrias)
    const EXCLUDE = [
      'bank', 'banco', 'insurance', 'seguro',
      'consulting', 'consultoria', 'legal', 'advocacia',
      'education', 'universidade', 'government'
    ];
    
    people = people.filter(person => {
      const industry = (person.organization?.industry || '').toLowerCase();
      const company = (person.organization?.name || '').toLowerCase();
      return !EXCLUDE.some(term => industry.includes(term) || company.includes(term));
    });

    // Filtrar títulos junior
    people = people.filter(person => {
      const title = (person.title || '').toLowerCase();
      return !['intern', 'trainee', 'student', 'junior'].some(term => title.includes(term));
    });

    // Scoring
    people = people.map(person => {
      let score = 0;
      
      const title = (person.title || '').toLowerCase();
      if (title.includes('ceo') || title.includes('president')) score += 50;
      else if (title.includes('director')) score += 40;
      else if (title.includes('vp')) score += 35;
      else if (title.includes('manager')) score += 30;
      
      const employees = person.organization?.estimated_num_employees || 0;
      if (employees > 5000) score += 40;
      else if (employees > 1000) score += 30;
      else if (employees > 500) score += 20;
      else if (employees > 200) score += 10;
      
      if (person.email && !person.email.includes('email_not_unlocked')) score += 15;
      if (person.phone_numbers?.length > 0) score += 15;
      
      return { ...person, priorityScore: score };
    });

    people.sort((a, b) => b.priorityScore - a.priorityScore);
    people = people.slice(0, 25);

    return res.status(200).json({
      success: true,
      people: people,
      total: people.length
    });

  } catch (error) {
    console.error('Apollo error:', error.response?.data || error.message);
    
    if (error.response?.status === 422) {
      return res.status(422).json({ 
        error: 'Invalid Apollo parameters',
        details: error.response.data 
      });
    }
    
    return res.status(500).json({ 
      error: 'Search failed',
      message: error.message
    });
  }
};
