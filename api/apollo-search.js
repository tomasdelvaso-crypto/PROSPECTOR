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
    
    // INDUSTRIAS PRIORITARIAS - EXPANDIDO
    const PRIORITY_INDUSTRIES = [
      // Automotriz
      'automotive', 'automotiva', 'autopeças', 'auto parts', 'vehicles', 'veículos',
      'car', 'carro', 'truck', 'caminhão', 'auto dealer', 'concessionária',
      
      // Cosmética y Farmacéutica
      'cosmetic', 'cosmética', 'beauty', 'beleza', 'pharmaceutical', 'farmacêutica',
      'pharma', 'farma', 'healthcare', 'saúde', 'personal care', 'cuidados pessoais',
      
      // Deportes y Textil
      'sports', 'esporte', 'sporting goods', 'artigos esportivos', 'athletic',
      'textile', 'têxtil', 'apparel', 'vestuário', 'clothing', 'roupa',
      'fashion', 'moda', 'footwear', 'calçado',
      
      // E-commerce y Retail
      'e-commerce', 'ecommerce', 'retail', 'varejo', 'marketplace', 'online',
      'store', 'loja', 'shopping', 'comércio',
      
      // Logística
      'fulfillment', '3pl', 'third party logistics', 'logistics', 'logística',
      'warehouse', 'armazém', 'distribution', 'distribuição', 'shipping',
      'transportadora', 'freight', 'frete', 'supply chain', 'cadeia de suprimentos',
      
      // Manufactura y Producción
      'manufacturing', 'manufatura', 'industrial', 'indústria', 'factory', 'fábrica',
      'production', 'produção', 'packaging', 'embalagem',
      
      // Alimentos y Bebidas
      'food', 'alimento', 'beverage', 'bebida', 'fmcg', 'consumer goods',
      'consumo', 'restaurant', 'restaurante'
    ];

    // INDUSTRIAS A EXCLUIR - SOLO LAS MUY IRRELEVANTES
    const EXCLUDE_INDUSTRIES = [
      'banking', 'banco', 'bank of', 'santander', 'itaú', 'bradesco',
      'insurance', 'seguradora', 'seguros',
      'financial services', 'serviços financeiros',
      'consulting', 'consultoria', 'advisory',
      'software', 'software development', 'desenvolvimento de software',
      'it services', 'tecnologia da informação',
      'legal', 'advocacia', 'law firm', 'escritório de advocacia',
      'education', 'educação', 'university', 'universidade', 'escola',
      'government', 'governo', 'municipal', 'federal',
      'non-profit', 'sem fins lucrativos', 'ong',
      'real estate', 'imobiliária', 'imóveis',
      'telecommunications', 'telecom', 'telefonia'
    ];

    // Construir payload para Apollo
    const apolloPayload = {
      per_page: 50, // Pedir más para compensar filtrado
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

    // FILTRO 1: Si hay empresa específica, filtrar por ella
    if (filters.company_names?.length > 0) {
      const targetCompany = filters.company_names[0].toLowerCase();
      const beforeFilter = people.length;
      
      people = people.filter(person => {
        const companyName = (person.organization?.name || '').toLowerCase();
        return companyName.includes(targetCompany) || targetCompany.includes(companyName);
      });
      
      console.log(`Filtro empresa "${filters.company_names[0]}": ${beforeFilter} -> ${people.length}`);
    }

    // FILTRO 2: Excluir solo industrias muy irrelevantes
    const beforeExclude = people.length;
    people = people.filter(person => {
      const industry = (person.organization?.industry || '').toLowerCase();
      const companyName = (person.organization?.name || '').toLowerCase();
      
      // Verificar si es una industria excluida
      const isExcluded = EXCLUDE_INDUSTRIES.some(term => 
        industry.includes(term) || companyName.includes(term)
      );
      
      if (isExcluded) {
        // Pero verificar si también coincide con una industria prioritaria
        const isPriority = PRIORITY_INDUSTRIES.some(term => 
          industry.includes(term) || companyName.includes(term)
        );
        
        // Si es prioritaria, no excluir aunque tenga términos excluidos
        if (isPriority) {
          console.log(`Preservado (prioritario): ${person.organization?.name} - ${industry}`);
          return true;
        }
        
        console.log(`Excluido: ${person.organization?.name} - ${industry}`);
        return false;
      }
      
      return true;
    });
    console.log(`Filtro industrias: ${beforeExclude} -> ${people.length}`);

    // FILTRO 3: Si se seleccionó una industria específica, priorizar esa
    if (filters.industries?.length > 0) {
      const selectedIndustry = filters.industries[0].toLowerCase();
      console.log(`Priorizando industria: ${selectedIndustry}`);
      
      // Dar score extra a la industria seleccionada
      people = people.map(person => {
        const industry = (person.organization?.industry || '').toLowerCase();
        const matchesSelected = industry.includes(selectedIndustry);
        return { ...person, industryMatch: matchesSelected };
      });
    }

    // FILTRO 4: Títulos - solo excluir los muy junior
    const EXCLUDED_TITLES = [
      'intern', 'estagiário',
      'trainee', 'aprendiz',
      'student', 'estudante',
      'junior', 'júnior'
      // Removí 'assistant' y 'analyst' porque pueden ser cargos válidos
    ];

    people = people.filter(person => {
      const title = (person.title || '').toLowerCase();
      return !EXCLUDED_TITLES.some(term => title.includes(term));
    });

    // FILTRO 5: Tamaño mínimo - más flexible
    people = people.filter(person => {
      const employees = person.organization?.estimated_num_employees || 0;
      // Si no hay datos (0), dejar pasar
      // Si hay datos, mínimo 50 empleados
      return employees === 0 || employees >= 50;
    });

    // SCORING Y PRIORIZACIÓN
    people = people.map(person => {
      let score = 0;
      
      // Score por cargo
      const title = (person.title || '').toLowerCase();
      if (title.includes('ceo') || title.includes('president')) score += 50;
      else if (title.includes('director') || title.includes('diretor')) score += 40;
      else if (title.includes('head')) score += 35;
      else if (title.includes('manager') || title.includes('gerente')) score += 30;
      else if (title.includes('coordinator') || title.includes('coordenador')) score += 20;
      
      // Score por tamaño
      const employees = person.organization?.estimated_num_employees || 0;
      if (employees > 5000) score += 40;
      else if (employees > 1000) score += 30;
      else if (employees > 500) score += 20;
      else if (employees > 200) score += 10;
      
      // Score por industria prioritaria
      const industry = (person.organization?.industry || '').toLowerCase();
      const isPriority = PRIORITY_INDUSTRIES.some(term => industry.includes(term));
      if (isPriority) score += 25;
      
      // Score extra si coincide con industria seleccionada
      if (person.industryMatch) score += 30;
      
      // Score por datos disponibles
      if (person.email && person.email !== 'email_not_unlocked@domain.com') score += 15;
      if (person.phone_numbers?.length > 0) score += 15;
      if (person.linkedin_url) score += 5;
      
      return { ...person, priorityScore: score };
    });

    // Ordenar por score
    people.sort((a, b) => b.priorityScore - a.priorityScore);

    // Tomar los mejores 25
    people = people.slice(0, 25);

    console.log(`\n=== RESULTADO FINAL ===`);
    console.log(`Enviando ${people.length} prospectos`);
    if (people.length > 0) {
      console.log('Top 5:');
      people.slice(0, 5).forEach(p => {
        console.log(`- ${p.name} | ${p.title} | ${p.organization?.name} | ${p.organization?.industry} | Score: ${p.priorityScore}`);
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
