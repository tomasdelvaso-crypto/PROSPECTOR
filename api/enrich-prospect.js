const axios = require('axios');

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { company, contact } = req.body;
    
    // Validar entrada
    if (!company || !company.name) {
      return res.status(200).json({ 
        enriched: false,
        message: 'Nombre de empresa no proporcionado'
      });
    }
    
    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) {
      console.log('Serper API key no configurada');
      return res.status(200).json({ 
        enriched: false,
        message: 'API no configurada'
      });
    }

    const enrichmentData = {
      news: [],
      publicProblems: [],
      buyingSignals: []
    };

    // Búsqueda 1: Problemas logísticos
    try {
      const problemsQuery = `"${company.name}" (avaria OR violação OR roubo OR "reclamação" OR "atraso entrega")`;
      console.log('Buscando problemas:', problemsQuery);
      
      const problemsResponse = await axios({
        method: 'POST',
        url: 'https://google.serper.dev/search',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json'
        },
        data: {
          q: problemsQuery,
          location: 'Brazil',
          gl: 'br',
          hl: 'pt',
          num: 3
        },
        timeout: 10000
      });

      if (problemsResponse.data?.organic) {
        enrichmentData.publicProblems = problemsResponse.data.organic
          .filter(r => {
            const snippet = (r.snippet || '').toLowerCase();
            return snippet.includes('problema') || 
                   snippet.includes('reclam') ||
                   snippet.includes('avaria') ||
                   snippet.includes('atraso');
          })
          .slice(0, 2)
          .map(r => ({
            issue: r.title || 'Problema detectado',
            details: (r.snippet || '').substring(0, 150)
          }));
      }
    } catch (searchError) {
      console.error('Error en búsqueda de problemas:', searchError.message);
    }

    // Búsqueda 2: Señales de compra/expansión
    try {
      const signalsQuery = `"${company.name}" (licitação OR expansão OR "novo centro" OR "novo fornecedor")`;
      console.log('Buscando señales:', signalsQuery);
      
      const signalsResponse = await axios({
        method: 'POST',
        url: 'https://google.serper.dev/search',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json'
        },
        data: {
          q: signalsQuery,
          location: 'Brazil',
          gl: 'br',
          hl: 'pt',
          num: 2
        },
        timeout: 10000
      });

      if (signalsResponse.data?.organic) {
        // Buscar expansión
        const expansionResults = signalsResponse.data.organic.filter(r => {
          const text = ((r.title || '') + (r.snippet || '')).toLowerCase();
          return text.includes('expansão') || text.includes('crescimento') || text.includes('novo');
        });
        
        if (expansionResults.length > 0) {
          enrichmentData.news = [{
            title: expansionResults[0].title || 'Expansão detectada',
            snippet: (expansionResults[0].snippet || '').substring(0, 150)
          }];
        }
        
        // Buscar licitaciones
        const buyingResults = signalsResponse.data.organic.filter(r => {
          const text = ((r.title || '') + (r.snippet || '')).toLowerCase();
          return text.includes('licitação') || text.includes('fornecedor');
        });
        
        if (buyingResults.length > 0) {
          enrichmentData.buyingSignals = [{
            signal: 'Buscando fornecedores',
            details: (buyingResults[0].snippet || '').substring(0, 150)
          }];
        }
      }
    } catch (searchError) {
      console.error('Error en búsqueda de señales:', searchError.message);
    }

    // Calcular score adicional
    let additionalScore = 0;
    if (enrichmentData.publicProblems.length > 0) {
      additionalScore += 15;
    }
    if (enrichmentData.buyingSignals.length > 0) {
      additionalScore += 20;
    }
    if (enrichmentData.news.length > 0) {
      additionalScore += 10;
    }

    console.log('Enriquecimiento completado:', {
      company: company.name,
      problems: enrichmentData.publicProblems.length,
      signals: enrichmentData.buyingSignals.length,
      news: enrichmentData.news.length,
      score: additionalScore
    });

    res.status(200).json({
      enriched: true,
      enrichmentData,
      additionalScore,
      summary: generateSummary(enrichmentData, company.name)
    });

  } catch (error) {
    console.error('Error general en enrich-prospect:', error);
    
    res.status(200).json({ 
      enriched: false,
      error: error.message,
      enrichmentData: {
        message: 'Error al enriquecer'
      },
      additionalScore: 0
    });
  }
};

function generateSummary(data, companyName) {
  const points = [];
  
  if (data.publicProblems && data.publicProblems.length > 0) {
    points.push(`⚠️ ${data.publicProblems.length} problemas detectados`);
  }
  
  if (data.buyingSignals && data.buyingSignals.length > 0) {
    points.push(`🛒 Buscando fornecedores`);
  }
  
  if (data.news && data.news.length > 0) {
    points.push(`📈 Empresa em expansão`);
  }
  
  return points.length > 0 ? 
    points.join(' | ') : 
    `${companyName} - Sem sinais relevantes`;
}
