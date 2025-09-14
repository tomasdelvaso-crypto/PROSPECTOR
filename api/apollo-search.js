const axios = require('axios');

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const { query, filters, enrichContacts = true } = req.body || {};
    
    const apiKey = process.env.APOLLO_API_KEY;
    if (!apiKey) {
      throw new Error('Apollo API key not configured');
    }

    console.log('Buscando prospectos para mercado brasileiro...');

    // Payload optimizado para Brasil
    const apolloPayload = {
      q_organization_name: query || '',
      per_page: 25,
      page: 1,
      
      // Localización Brasil
      person_locations: filters?.location ? [filters.location] : ["Brazil"],
      organization_locations: ["Brazil"],
      
      // Títulos en portugués e inglés
      person_titles: filters?.titles || [
        "Gerente de Qualidade", "Quality Manager",
        "Gerente de Operações", "Operations Manager", 
        "Gerente de Logística", "Logistics Manager",
        "Gerente de Produção", "Production Manager",
        "Diretor de Operações", "Operations Director",
        "Diretor Industrial", "VP Operations",
        "Supply Chain Manager", "Gerente Supply Chain",
        "CEO", "Presidente", "Chief Executive"
      ],
      
      // Industrias prioritarias
      organization_industry_tag_ids: filters?.industries || [],
      
      // Tamaño de empresa
      organization_num_employees_ranges: filters?.size ? [filters.size] : ["501,1000", "1001,5000", "5001,10000"],
      
      // IMPORTANTE: Solicitar datos de contacto
      contact_email_status: ["verified", "guessed", "verified_likely", "unavailable"],
      include_contact_info: true,
      
      // Campos adicionales para scoring
      organization_annual_revenue_ranges: filters?.revenue ? [`${filters.revenue}M,`] : [],
      
      // Excluir empresas sin datos de contacto
      must_have_contact_info: false, // Cambiamos a false para obtener más resultados
      
      // Tecnologías (si están buscando proveedores)
      organization_technologies: filters?.techKeywords || [],
      
      // Ordenar por relevancia
      sort_by_field: "organization_num_employees",
      sort_ascending: false
    };

    console.log('Enviando request a Apollo con parámetros optimizados...');

    const response = await axios({
      method: 'POST',
      url: 'https://api.apollo.io/v1/mixed_people/search',
      data: apolloPayload,
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      },
      timeout: 30000
    });

    console.log(`Encontrados ${response.data.people?.length || 0} prospectos`);

    // Enriquecer contactos si está habilitado
    let enrichedPeople = response.data.people || [];
    
    if (enrichContacts && enrichedPeople.length > 0) {
      console.log('Enriqueciendo datos de contacto...');
      enrichedPeople = await enrichContactData(enrichedPeople, apiKey);
    }

    // Agregar metadata para scoring
    enrichedPeople = enrichedPeople.map(person => ({
      ...person,
      _metadata: {
        searchDate: new Date().toISOString(),
        searchQuery: query,
        hasEmail: !!person.email,
        hasPhone: !!(person.phone_numbers && person.phone_numbers.length > 0),
        hasLinkedIn: !!person.linkedin_url,
        contactCompleteness: calculateContactCompleteness(person)
      }
    }));
    
    res.status(200).json({
      people: enrichedPeople,
      pagination: response.data.pagination,
      total_entries: response.data.total_entries
    });

  } catch (error) {
    console.error('Error completo:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status
    });
    
    res.status(500).json({ 
      error: 'Error searching prospects',
      details: error.response?.data?.error || error.message 
    });
  }
};

// Función para enriquecer datos de contacto
async function enrichContactData(people, apiKey) {
  const enrichedPeople = [];
  
  for (const person of people) {
    try {
      // Si no tiene email, intentar enriquecerlo
      if (!person.email && person.name && person.organization?.domain) {
        const enrichResponse = await axios({
          method: 'POST',
          url: 'https://api.apollo.io/v1/people/match',
          data: {
            name: person.name,
            organization_name: person.organization.name,
            domain: person.organization.domain,
            reveal_personal_emails: true,
            reveal_phone_numbers: true
          },
          headers: {
            'X-Api-Key': apiKey,
            'Content-Type': 'application/json'
          },
          timeout: 5000
        }).catch(err => {
          console.log(`No se pudo enriquecer ${person.name}`);
          return null;
        });

        if (enrichResponse?.data?.person) {
          enrichedPeople.push({
            ...person,
            ...enrichResponse.data.person,
            _enriched: true
          });
        } else {
          enrichedPeople.push(person);
        }
      } else {
        enrichedPeople.push(person);
      }
    } catch (error) {
      console.error(`Error enriqueciendo ${person.name}:`, error.message);
      enrichedPeople.push(person);
    }
  }
  
  return enrichedPeople;
}

// Calcular completitud de datos de contacto
function calculateContactCompleteness(person) {
  let score = 0;
  if (person.email) score += 40;
  if (person.phone_numbers?.length > 0) score += 30;
  if (person.linkedin_url) score += 20;
  if (person.title) score += 10;
  return score;
}
