const axios = require('axios');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { company_name } = req.body;
    const apiKey = process.env.SERPER_API_KEY;
    
    if (!apiKey) {
      return res.status(200).json({ 
        success: false,
        message: 'Serper API not configured'
      });
    }
    
    const results = {
      distribution_centers: [],
      production_volume: null,
      problems: [],
      insights: ''
    };
    
    // Buscar centros de distribución
    try {
      const dcResponse = await axios({
        method: 'POST',
        url: 'https://google.serper.dev/search',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json'
        },
        data: {
          q: `"${company_name}" ("centro de distribuição" OR "fábrica" OR "unidade" OR "planta")`,
          location: 'Brazil',
          gl: 'br',
          hl: 'pt',
          num: 5
        }
      });
      
      if (dcResponse.data?.organic) {
        results.distribution_centers = dcResponse.data.organic
          .filter(r => r.snippet?.toLowerCase().includes('unidade') || 
                      r.snippet?.toLowerCase().includes('centro') ||
                      r.snippet?.toLowerCase().includes('fábrica'))
          .map(r => r.snippet.substring(0, 100));
      }
    } catch (e) {
      console.log('DC search failed:', e.message);
    }
    
    // Buscar volumen de producción
    try {
      const volumeResponse = await axios({
        method: 'POST',
        url: 'https://google.serper.dev/search',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json'
        },
        data: {
          q: `"${company_name}" ("produz" OR "capacidade" OR "volume" OR "toneladas")`,
          location: 'Brazil',
          gl: 'br',
          hl: 'pt',
          num: 3
        }
      });
      
      if (volumeResponse.data?.organic?.[0]) {
        const snippet = volumeResponse.data.organic[0].snippet;
        const numbers = snippet.match(/\d+\.?\d*/g);
        if (numbers && numbers.length > 0) {
          results.production_volume = numbers.join(', ');
        }
      }
    } catch (e) {
      console.log('Volume search failed:', e.message);
    }
    
    // Buscar problemas
    try {
      const problemsResponse = await axios({
        method: 'POST',
        url: 'https://google.serper.dev/search',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json'
        },
        data: {
          q: `"${company_name}" ("problema" OR "recall" OR "reclamação" OR "multa")`,
          location: 'Brazil',
          gl: 'br',
          hl: 'pt',
          num: 3
        }
      });
      
      if (problemsResponse.data?.organic) {
        results.problems = problemsResponse.data.organic
          .filter(r => {
            const text = (r.snippet || '').toLowerCase();
            return text.includes('problema') || 
                   text.includes('recall') || 
                   text.includes('reclam') ||
                   text.includes('multa');
          })
          .slice(0, 2)
          .map(r => ({
            title: r.title.substring(0, 100),
            snippet: r.snippet.substring(0, 150)
          }));
      }
    } catch (e) {
      console.log('Problems search failed:', e.message);
    }
    
    // Generar insights
    if (results.distribution_centers.length > 0) {
      results.insights += `${results.distribution_centers.length} centros identificados. `;
    }
    
    if (results.production_volume) {
      results.insights += `Volume: ${results.production_volume}. `;
    }
    
    if (results.problems.length > 0) {
      results.insights += `⚠️ ${results.problems.length} problemas detectados. `;
    }
    
    if (!results.insights) {
      results.insights = 'Informações limitadas disponíveis.';
    }
    
    return res.status(200).json({
      success: true,
      ...results
    });
    
  } catch (error) {
    console.error('Serper error:', error.message);
    return res.status(200).json({
      success: false,
      error: error.message
    });
  }
};
