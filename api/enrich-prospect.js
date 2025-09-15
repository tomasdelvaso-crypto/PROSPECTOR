const axios = require('axios');

module.exports = async (req, res) => {
    // ... validaciones existentes ...
    
    const enrichmentData = {
        publicProblems: [],
        buyingSignals: [],
        news: []
    };
    
    // Solo 2 búsquedas críticas en lugar de 6:
    
    // 1. Problemas y reclamos (la más importante)
    const problemsQuery = `"${company.name}" (avaria OR violação OR roubo OR reclamação)`;
    const problemsResponse = await searchSerper(problemsQuery);
    // ... procesar resultados ...
    
    // 2. Señales de compra/expansión (combinada)
    const signalsQuery = `"${company.name}" (licitação OR "novo fornecedor" OR expansão)`;
    const signalsResponse = await searchSerper(signalsQuery);
    // ... procesar resultados ...
    
    // ELIMINAR: búsquedas de ESG, ergonomía, competidores
    
    res.status(200).json({
        enriched: true,
        enrichmentData,
        additionalScore: calculateScore(enrichmentData)
    });
};

    if (newsResponse.data.organic) {
      enrichmentData.news = newsResponse.data.organic.map(result => ({
        title: result.title,
        snippet: result.snippet,
        link: result.link,
        date: result.date
      }));
    }

    // 2. Buscar problemas de fulfillment/logística
    const problemsQuery = `"${company.name}" (avaria OR violação OR roubo OR "atraso entrega" OR reclame aqui)`;
    const problemsResponse = await axios({
      method: 'POST',
      url: 'https://google.serper.dev/search',
      headers: {
        'X-API-KEY': process.env.SERPER_API_KEY
      },
      data: {
        q: problemsQuery,
        location: 'Brazil',
        num: 3
      }
    });

    if (problemsResponse.data.organic) {
      enrichmentData.publicProblems = problemsResponse.data.organic
        .filter(r => r.snippet.toLowerCase().includes('problema') || 
                     r.snippet.toLowerCase().includes('reclam') ||
                     r.snippet.toLowerCase().includes('avaria'))
        .map(r => ({
          issue: r.title,
          details: r.snippet,
          source: r.link
        }));
    }

    // 3. Buscar señales de compra
    const buyingSignalsQuery = `"${company.name}" (licitação OR RFP OR "busca fornecedor" OR "novo fornecedor")`;
    const buyingResponse = await axios({
      method: 'POST',
      url: 'https://google.serper.dev/search',
      headers: {
        'X-API-KEY': process.env.SERPER_API_KEY
      },
      data: {
        q: buyingSignalsQuery,
        location: 'Brazil',
        num: 3,
        dateRange: '6m'
      }
    });

    if (buyingResponse.data.organic) {
      enrichmentData.buyingSignals = buyingResponse.data.organic.map(r => ({
        signal: r.title,
        details: r.snippet,
        date: r.date
      }));
    }

    // 4. Información de sustentabilidad/ESG
    const esgQuery = `"${company.name}" (sustentabilidade OR ESG OR "pegada carbono" OR reciclagem)`;
    const esgResponse = await axios({
      method: 'POST',
      url: 'https://google.serper.dev/search',
      headers: {
        'X-API-KEY': process.env.SERPER_API_KEY
      },
      data: {
        q: esgQuery,
        location: 'Brazil',
        num: 2
      }
    });

    if (esgResponse.data.organic && esgResponse.data.organic.length > 0) {
      enrichmentData.sustainabilityInfo = {
        hasESGFocus: true,
        details: esgResponse.data.organic[0].snippet
      };
    }

    // 5. NUEVO: Búsqueda de problemas ergonómicos (no prioritario pero incluido)
    const ergonomicQuery = `"${company.name}" ("acidente trabalho" OR "afastamento" OR "LER" OR "DORT" OR "túnel carpo" OR "tendinite")`;
    const ergonomicResponse = await axios({
      method: 'POST',
      url: 'https://google.serper.dev/search',
      headers: {
        'X-API-KEY': process.env.SERPER_API_KEY
      },
      data: {
        q: ergonomicQuery,
        location: 'Brazil',
        num: 2
      }
    }).catch(() => null); // No fallar si no encuentra nada

    if (ergonomicResponse?.data?.organic) {
      enrichmentData.ergonomicProblems = ergonomicResponse.data.organic
        .filter(r => r.snippet.toLowerCase().includes('acidente') || 
                     r.snippet.toLowerCase().includes('afastamento'))
        .map(r => ({
          issue: r.title,
          details: r.snippet
        }));
    }

    // 6. Calcular score adicional basado en señales
    let additionalScore = 0;
    
    if (enrichmentData.publicProblems.length > 0) {
      additionalScore += 15;
    }
    
    if (enrichmentData.buyingSignals.length > 0) {
      additionalScore += 20;
    }
    
    if (enrichmentData.news.some(n => n.snippet?.includes('expansão') || n.snippet?.includes('crescimento'))) {
      additionalScore += 10;
    }
    
    if (enrichmentData.sustainabilityInfo?.hasESGFocus) {
      additionalScore += 5;
    }

    if (enrichmentData.ergonomicProblems?.length > 0) {
      additionalScore += 5; // Bonus menor por no ser prioridad
    }

    res.status(200).json({
      enriched: true,
      enrichmentData,
      additionalScore,
      summary: generateEnrichmentSummary(enrichmentData, company)
    });

  } catch (error) {
    console.error('Error enriching with Serper:', error);
    res.status(200).json({ enriched: false });
  }
};

function generateEnrichmentSummary(data, company) {
  let summary = [];
  
  if (data.publicProblems && data.publicProblems.length > 0) {
    summary.push(`⚠️ ${data.publicProblems.length} problemas detectados`);
  }
  
  if (data.buyingSignals && data.buyingSignals.length > 0) {
    summary.push(`🛒 Buscando fornecedores ativamente`);
  }
  
  if (data.news && data.news.length > 0) {
    const expansion = data.news.some(n => 
      n.snippet?.toLowerCase().includes('expansão') || 
      n.snippet?.toLowerCase().includes('crescimento')
    );
    if (expansion) summary.push(`📈 Empresa em expansão`);
  }
  
  if (data.sustainabilityInfo?.hasESGFocus) {
    summary.push(`🌱 Foco em sustentabilidade`);
  }

  if (data.ergonomicProblems && data.ergonomicProblems.length > 0) {
    summary.push(`👷 Problemas ergonômicos reportados`);
  }
  
  return summary.length > 0 ? 
    summary.join(' | ') : 
    `${company.name || 'Empresa'} sem sinais públicos relevantes detectados`;
}
