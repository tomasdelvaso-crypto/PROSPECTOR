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

    const { filters = {}, page = 1, per_page = 25 } = req.body;
    
    // REFACTOR: Build simple Apollo query without restrictive keywords
    const apolloPayload = {
      per_page: 50, // Request extra to compensate for filtering
      page: page || 1
    };

    // Location - Apollo handles this well
    if (filters.location) {
      apolloPayload.person_locations = [filters.location];
    } else {
      apolloPayload.person_locations = ["Brazil"];
    }

    // Titles - Apollo handles this well
    if (filters.titles && filters.titles.length > 0) {
      apolloPayload.person_titles = filters.titles;
    }

    // Company size - Apollo handles this well
    if (filters.size) {
      apolloPayload.organization_num_employees_ranges = [filters.size];
    }

    // Company name search (if specified)
    if (filters.company_names && filters.company_names.length > 0) {
      apolloPayload.q_organization_name = filters.company_names[0];
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

    // REFACTOR: Define priority industries including TEXTILE
    const INDUSTRY_PRIORITIES = {
      'ecommerce': ['e-commerce', 'ecommerce', 'retail', 'varejo', 'marketplace', 'online', 'store', 'loja', 'shopping'],
      'logistics': ['logistics', 'logística', '3pl', 'fulfillment', 'warehouse', 'armazém', 'shipping', 'transporte', 'freight', 'distribuição', 'distribution'],
      'manufacturing': ['manufacturing', 'manufatura', 'industrial', 'indústria', 'fábrica', 'production', 'produção', 'packaging', 'embalagem'],
      'food': ['food', 'alimento', 'beverage', 'bebida', 'fmcg', 'consumer goods', 'consumo', 'restaurant', 'restaurante'],
      'pharma': ['pharmaceutical', 'farmacêutica', 'cosmetic', 'cosmética', 'healthcare', 'beauty', 'beleza', 'perfume', 'medical'],
      'automotive': ['automotive', 'automotiva', 'autopeças', 'auto parts', 'vehicles', 'car', 'carro', 'truck', 'caminhão'],
      'textile': ['textile', 'têxtil', 'textil', 'apparel', 'vestuário', 'clothing', 'roupa', 'fashion', 'moda', 'calçado', 'footwear', 'confecção'] // ADDED
    };

    // Industries to exclude
    const EXCLUDE_INDUSTRIES = [
      'banking', 'banco', 'bank of', 'santander', 'itaú', 'bradesco',
      'insurance', 'seguro', 'seguros', 'seguradora',
      'financial services', 'serviços financeiros', 'financeira',
      'consulting', 'consultoria', 'advisory', 'consulting firm',
      'it services', 'tecnologia da informação', 'software development', 'desenvolvimento de software',
      'legal', 'advocacia', 'law firm', 'escritório de advocacia',
      'education', 'educação', 'universidade', 'university', 'escola', 'school',
      'government', 'governo', 'municipal', 'federal', 'prefeitura',
      'telecommunications', 'telecom', 'telefonia', 'telecomuni'
    ];

    // REFACTOR: Filter by selected industry if specified
    if (filters.industryKeywords) {
      const selectedIndustry = filters.industryKeywords.toLowerCase();
      const industryTerms = INDUSTRY_PRIORITIES[selectedIndustry];
      
      if (industryTerms) {
        console.log(`Filtering for ${selectedIndustry} industry`);
        people = people.filter(person => {
          const industry = (person.organization?.industry || '').toLowerCase();
          const companyName = (person.organization?.name || '').toLowerCase();
          
          // Check if matches selected industry
          return industryTerms.some(term => 
            industry.includes(term) || companyName.includes(term)
          );
        });
        console.log(`After industry filter: ${people.length} results`);
      }
    }

    // REFACTOR: Always exclude certain industries
    people = people.filter(person => {
      const industry = (person.organization?.industry || '').toLowerCase();
      const companyName = (person.organization?.name || '').toLowerCase();
      
      const isExcluded = EXCLUDE_INDUSTRIES.some(term => 
        industry.includes(term) || companyName.includes(term)
      );
      
      if (isExcluded) {
        // But check if it's also a priority industry (might be a company with mixed classification)
        const isPriority = Object.values(INDUSTRY_PRIORITIES).flat().some(term =>
          industry.includes(term) || companyName.includes(term)
        );
        
        // Only exclude if it's not also a priority industry
        return isPriority;
      }
      
      return true;
    });

    // REFACTOR: Filter out junior positions
    const JUNIOR_TITLES = [
      'intern', 'estagiário', 'estagiária',
      'trainee', 'aprendiz',
      'student', 'estudante', 
      'junior', 'júnior'
    ];

    people = people.filter(person => {
      const title = (person.title || '').toLowerCase();
      return !JUNIOR_TITLES.some(term => title.includes(term));
    });

    // REFACTOR: Filter by minimum company size (be lenient)
    people = people.filter(person => {
      const employees = person.organization?.estimated_num_employees || 0;
      // If no data (0), let it pass. Otherwise minimum 50 employees
      return employees === 0 || employees >= 50;
    });

    // REFACTOR: Calculate priority scores
    people = people.map(person => {
      let priorityScore = 0;
      
      // Score by title
      const title = (person.title || '').toLowerCase();
      if (title.includes('ceo') || title.includes('president') || title.includes('presidente')) {
        priorityScore += 50;
      } else if (title.includes('director') || title.includes('diretor')) {
        priorityScore += 40;
      } else if (title.includes('vp') || title.includes('vice')) {
        priorityScore += 45;
      } else if (title.includes('head') || title.includes('chefe')) {
        priorityScore += 35;
      } else if (title.includes('manager') || title.includes('gerente')) {
        priorityScore += 30;
      } else if (title.includes('supervisor')) {
        priorityScore += 20;
      }
      
      // Score by company size
      const employees = person.organization?.estimated_num_employees || 0;
      if (employees >= 5000) {
        priorityScore += 40;
      } else if (employees >= 1000) {
        priorityScore += 30;
      } else if (employees >= 500) {
        priorityScore += 20;
      } else if (employees >= 200) {
        priorityScore += 10;
      }
      
      // Score by industry match
      const industry = (person.organization?.industry || '').toLowerCase();
      const companyName = (person.organization?.name || '').toLowerCase();
      
      // Extra points for priority industries
      const allPriorityTerms = Object.values(INDUSTRY_PRIORITIES).flat();
      if (allPriorityTerms.some(term => industry.includes(term) || companyName.includes(term))) {
        priorityScore += 20;
      }
      
      // Extra points if matches the selected industry filter
      if (filters.industryKeywords) {
        const selectedTerms = INDUSTRY_PRIORITIES[filters.industryKeywords.toLowerCase()] || [];
        if (selectedTerms.some(term => industry.includes(term) || companyName.includes(term))) {
          priorityScore += 15;
        }
      }
      
      // Score by data availability
      if (person.email && !person.email.includes('email_not_unlocked')) {
        priorityScore += 10;
      }
      if (person.phone_numbers && person.phone_numbers.length > 0) {
        priorityScore += 10;
      }
      if (person.linkedin_url) {
        priorityScore += 5;
      }
      
      return { ...person, priorityScore };
    });

    // Sort by score and limit
    people.sort((a, b) => b.priorityScore - a.priorityScore);
    people = people.slice(0, 25);

    console.log(`Sending ${people.length} qualified prospects`);
    if (people.length > 0) {
      console.log('Top 3 results:');
      people.slice(0, 3).forEach(p => {
        console.log(`- ${p.name} | ${p.title} | ${p.organization?.name} | Industry: ${p.organization?.industry} | Score: ${p.priorityScore}`);
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
    console.error('Apollo API error:', error.response?.data || error.message);
    
    return res.status(500).json({ 
      error: 'Search failed',
      message: error.message || 'Unknown error occurred'
    });
  }
};
