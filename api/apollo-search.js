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
    
    // REFACTOR: Define industry keywords for better Apollo searching
    const INDUSTRY_SEARCH_TERMS = {
      'ecommerce': 'e-commerce retail marketplace varejo online store',
      'logistics': 'logistics fulfillment 3PL warehouse shipping freight transport',
      'manufacturing': 'manufacturing industrial factory production packaging',
      'food': 'food beverage FMCG consumer goods alimentos bebidas',
      'pharma': 'pharmaceutical cosmetic healthcare beauty farmaceutica cosmetica',
      'automotive': 'automotive autopeças vehicles auto parts car truck'
    };

    // REFACTOR: Build Apollo payload with proper filters
    const apolloPayload = {
      per_page: 40, // Request more to account for post-filtering
      page: page || 1
    };

    // Location filter - Apollo supports this directly
    if (filters.location) {
      apolloPayload.person_locations = [filters.location];
    }

    // Title filter - Apollo supports this directly
    if (filters.titles && filters.titles.length > 0) {
      apolloPayload.person_titles = filters.titles;
    }

    // Size filter - Apollo supports this directly
    if (filters.size) {
      apolloPayload.organization_num_employees_ranges = [filters.size];
    }

    // REFACTOR: Use q_keywords for industry-specific searching
    if (filters.industryKeywords) {
      // Get search terms for the selected industry
      const industryKey = filters.industryKeywords.toLowerCase();
      const searchTerms = INDUSTRY_SEARCH_TERMS[industryKey];
      
      if (searchTerms) {
        apolloPayload.q_keywords = searchTerms;
        console.log(`Searching with industry keywords: ${searchTerms}`);
      }
    }

    // REFACTOR: Add company name to keywords if specified
    if (filters.company_names && filters.company_names.length > 0) {
      const companySearch = filters.company_names[0];
      apolloPayload.q_keywords = apolloPayload.q_keywords 
        ? `${apolloPayload.q_keywords} ${companySearch}`
        : companySearch;
    }

    console.log('Apollo request payload:', JSON.stringify(apolloPayload, null, 2));

    // Make Apollo API call
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

    // REFACTOR: Define industries to always exclude
    const EXCLUDE_INDUSTRIES = [
      'banking', 'banco', 'insurance', 'seguro',
      'financial services', 'serviços financeiros',
      'consulting', 'consultoria', 'advisory',
      'it services', 'tecnologia da informação',
      'telecommunications', 'telecom',
      'legal', 'advocacia', 'law firm',
      'education', 'universidade', 'escola',
      'government', 'governo', 'municipal',
      'non-profit', 'ong', 'sem fins lucrativos'
    ];

    // REFACTOR: Filter out irrelevant industries
    people = people.filter(person => {
      const industry = (person.organization?.industry || '').toLowerCase();
      const companyName = (person.organization?.name || '').toLowerCase();
      
      // Check if it's an excluded industry
      const isExcluded = EXCLUDE_INDUSTRIES.some(term => 
        industry.includes(term) || companyName.includes(term)
      );
      
      return !isExcluded;
    });

    // REFACTOR: Filter out junior positions
    const JUNIOR_TITLES = ['intern', 'estagiário', 'trainee', 'student', 'junior'];
    people = people.filter(person => {
      const title = (person.title || '').toLowerCase();
      return !JUNIOR_TITLES.some(term => title.includes(term));
    });

    // REFACTOR: Calculate priority scores for sorting
    people = people.map(person => {
      let priorityScore = 0;
      
      // Score by title seniority
      const title = (person.title || '').toLowerCase();
      if (title.includes('ceo') || title.includes('president')) {
        priorityScore += 50;
      } else if (title.includes('director') || title.includes('diretor')) {
        priorityScore += 40;
      } else if (title.includes('vp') || title.includes('vice president')) {
        priorityScore += 45;
      } else if (title.includes('head')) {
        priorityScore += 35;
      } else if (title.includes('manager') || title.includes('gerente')) {
        priorityScore += 30;
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
      
      // Score by data completeness
      if (person.email && !person.email.includes('email_not_unlocked')) {
        priorityScore += 15;
      }
      if (person.phone_numbers && person.phone_numbers.length > 0) {
        priorityScore += 15;
      }
      if (person.linkedin_url) {
        priorityScore += 5;
      }
      
      // REFACTOR: Boost score if matches selected industry
      if (filters.industryKeywords) {
        const industry = (person.organization?.industry || '').toLowerCase();
        const keywords = INDUSTRY_SEARCH_TERMS[filters.industryKeywords.toLowerCase()] || '';
        const keywordList = keywords.split(' ');
        
        if (keywordList.some(keyword => industry.includes(keyword))) {
          priorityScore += 25;
        }
      }
      
      return { ...person, priorityScore };
    });

    // REFACTOR: Sort by priority score and limit results
    people.sort((a, b) => b.priorityScore - a.priorityScore);
    people = people.slice(0, 25);

    console.log(`Sending ${people.length} qualified prospects`);

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
