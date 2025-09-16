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
    
    // Para Santa Catarina específicamente, necesitamos ser más amplios
    const apolloPayload = {
      page: page || 1,
      per_page: 100, // Pedir MUCHOS más para poder filtrar
    };

    // Location - para Santa Catarina buscar en todo Brasil
    if (filters.location?.includes('Santa Catarina')) {
      apolloPayload.person_locations = ['Brazil'];
    } else {
      apolloPayload.person_locations = [filters.location || 'Brazil'];
    }
    
    // Titles - enfocarse en operations y logistics
    if (filters.titles?.length > 0) {
      apolloPayload.person_titles = filters.titles;
    } else {
      // Por defecto, buscar títulos relevantes para Ventapel
      apolloPayload.person_titles = [
        'Operations Manager',
        'Logistics Manager',
        'Supply Chain Manager',
        'Production Manager',
        'Plant Manager',
        'Warehouse Manager',
        'Quality Manager',
        'Operations Director',
        'COO'
      ];
    }
    
    // NO filtrar por tamaño en Santa Catarina (muy restrictivo)
    if (filters.size && !filters.location?.includes('Santa Catarina')) {
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

    // FILTRADO AGRESIVO - SOLO EMPRESAS RELEVANTES PARA VENTAPEL
    
    // Palabras clave que DEBEN estar presentes (industrias relevantes)
    const MUST_HAVE_KEYWORDS = [
      // Manufactura y producción
      'manufactur', 'industrial', 'factory', 'fábrica', 'produção', 'production',
      'assembly', 'montagem', 'planta',
      
      // Logística y distribución
      'logistics', 'logística', 'warehouse', 'armazém', 'distribution',
      'distribuição', 'fulfillment', 'shipping', 'transporte', 'freight',
      '3pl', 'supply chain', 'cadeia de suprimentos',
      
      // Retail y comercio
      'retail', 'varejo', 'atacado', 'wholesale', 'commerce', 'comércio',
      'store', 'loja', 'supermercado', 'supermarket', 'hypermarket',
      
      // Sectores específicos buenos para Ventapel
      'food', 'alimento', 'beverage', 'bebida', 'pharmaceutical', 'farmacêutica',
      'cosmetic', 'cosmética', 'automotive', 'automotiva', 'autopeças',
      'textile', 'têxtil', 'clothing', 'vestuário', 'fashion', 'moda',
      'paper', 'papel', 'packaging', 'embalagem', 'plastics', 'plástico',
      'chemical', 'química', 'metal', 'machinery', 'máquinas',
      
      // E-commerce
      'ecommerce', 'e-commerce', 'marketplace', 'online retail'
    ];
    
    // Palabras que indican que NO es relevante
    const EXCLUDE_KEYWORDS = [
      'software', 'technology', 'tecnologia', 'it services', 'consulting',
      'consultoria', 'bank', 'banco', 'finance', 'financ', 'insurance',
      'seguro', 'investimento', 'investment', 'venture', 'startup',
      'digital marketing', 'agency', 'agência', 'education', 'educação',
      'universidade', 'university', 'escola', 'school', 'hospital',
      'clinic', 'clínica', 'law', 'advocacia', 'legal', 'real estate',
      'imobiliária', 'hotel', 'turismo', 'tourism', 'restaurant',
      'non-profit', 'ong', 'church', 'igreja', 'government', 'governo',
      'cooperativa financeira', 'credit union', 'sicredi', 'cryptocurrency',
      'crypto', 'blockchain', 'gaming', 'entertainment', 'media'
    ];
    
    // Filtrar agresivamente
    people = people.filter(person => {
      const company = (person.organization?.name || '').toLowerCase();
      const industry = (person.organization?.industry || '').toLowerCase();
      const description = (person.organization?.description || '').toLowerCase();
      const combined = `${company} ${industry} ${description}`;
      
      // Excluir si tiene palabras prohibidas
      const hasExcluded = EXCLUDE_KEYWORDS.some(keyword => 
        combined.includes(keyword)
      );
      if (hasExcluded) return false;
      
      // Incluir SOLO si tiene palabras relevantes
      const hasRelevant = MUST_HAVE_KEYWORDS.some(keyword => 
        combined.includes(keyword)
      );
      
      // Si no tenemos datos de industria pero el título es relevante, mantener
      if (!hasRelevant && !industry && !description) {
        const title = (person.title || '').toLowerCase();
        const hasRelevantTitle = 
          title.includes('operations') ||
          title.includes('logistics') ||
          title.includes('supply') ||
          title.includes('production') ||
          title.includes('warehouse') ||
          title.includes('plant') ||
          title.includes('quality');
        
        return hasRelevantTitle;
      }
      
      return hasRelevant;
    });

    console.log(`After industry filter: ${people.length} relevant results`);

    // Si después del filtrado tenemos muy pocos, relajar un poco
    if (people.length < 10) {
      // Hacer otra búsqueda con títulos más amplios
      const fallbackPayload = {
        page: 1,
        per_page: 100,
        person_locations: ['Brazil'],
        person_titles: ['Manager', 'Director', 'Gerente', 'Diretor']
      };
      
      const fallbackResponse = await axios({
        method: 'POST',
        url: 'https://api.apollo.io/v1/mixed_people/search',
        data: fallbackPayload,
        headers: { 
          'X-Api-Key': apiKey, 
          'Content-Type': 'application/json' 
        }
      });
      
      let fallbackPeople = fallbackResponse.data?.people || [];
      
      // Filtrar solo los relevantes
      fallbackPeople = fallbackPeople.filter(person => {
        const industry = (person.organization?.industry || '').toLowerCase();
        const company = (person.organization?.name || '').toLowerCase();
        const combined = `${industry} ${company}`;
        
        return MUST_HAVE_KEYWORDS.some(kw => combined.includes(kw)) &&
               !EXCLUDE_KEYWORDS.some(kw => combined.includes(kw));
      });
      
      people = [...people, ...fallbackPeople].slice(0, 25);
    }

    // Scoring final
    people = people.map(person => {
      let score = 0;
      
      const title = (person.title || '').toLowerCase();
      
      // Títulos más valiosos para Ventapel
      if (title.includes('operations')) score += 50;
      else if (title.includes('logistics')) score += 50;
      else if (title.includes('supply chain')) score += 45;
      else if (title.includes('production')) score += 45;
      else if (title.includes('warehouse')) score += 40;
      else if (title.includes('plant')) score += 40;
      else if (title.includes('quality')) score += 35;
      else if (title.includes('coo')) score += 50;
      else if (title.includes('director')) score += 30;
      else if (title.includes('manager')) score += 25;
      else if (title.includes('ceo')) score += 20; // CEO menos importante que operations
      
      // Tamaño de empresa
      const employees = person.organization?.estimated_num_employees || 0;
      if (employees >= 1000) score += 30;
      else if (employees >= 500) score += 25;
      else if (employees >= 200) score += 20;
      else if (employees >= 100) score += 15;
      
      // Datos de contacto
      if (person.email && !person.email.includes('email_not_unlocked')) score += 15;
      if (person.phone_numbers?.length > 0) score += 15;
      
      return { ...person, priorityScore: score };
    });

    // Ordenar y limitar
    people.sort((a, b) => b.priorityScore - a.priorityScore);
    people = people.slice(0, 25);

    return res.status(200).json({
      success: true,
      people: people,
      total: people.length
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
