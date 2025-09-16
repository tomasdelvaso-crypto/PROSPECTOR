const axios = require('axios');

async function searchSerper(query, apiKey) {
    try {
        const response = await axios.post(
            'https://google.serper.dev/search',
            { 
                q: query, 
                gl: 'br', 
                hl: 'pt-br', 
                num: 5 
            },
            { 
                headers: { 
                    'X-API-KEY': apiKey, 
                    'Content-Type': 'application/json' 
                },
                timeout: 10000
            }
        );
        return response.data.organic || [];
    } catch (error) {
        console.error(`Serper search failed for query: ${query}`, error.message);
        return [];
    }
}

module.exports = async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const { company } = req.body;
        const apiKey = process.env.SERPER_API_KEY;

        if (!apiKey) {
            return res.status(200).json({ 
                success: false,
                intel: false,
                message: 'Serper API key not configured' 
            });
        }

        if (!company || !company.name) {
            return res.status(200).json({ 
                success: false,
                intel: false,
                message: 'Company name is required' 
            });
        }

        const companyName = company.name;
        const results = {
            pain_points: [],
            buying_signals: [],
            recent_news: [],
            insights: ''
        };

        // Search 1: Pain points related to packaging/logistics
        const painQuery = `"${companyName}" (problemas OR reclamação OR avaria OR "danos no transporte" OR "violação de carga" OR "roubo de mercadoria")`;
        const painResults = await searchSerper(painQuery, apiKey);
        
        painResults.forEach(result => {
            if (result.snippet && result.snippet.toLowerCase().includes(companyName.toLowerCase())) {
                results.pain_points.push({
                    title: result.title,
                    snippet: result.snippet,
                    link: result.link
                });
            }
        });

        // Search 2: Buying signals and expansion
        const signalQuery = `"${companyName}" (expansão OR "novo centro de distribuição" OR "nova fábrica" OR "aumenta produção" OR "investe em logística" OR "melhoria operacional")`;
        const signalResults = await searchSerper(signalQuery, apiKey);
        
        signalResults.forEach(result => {
            if (result.snippet && result.snippet.toLowerCase().includes(companyName.toLowerCase())) {
                results.buying_signals.push({
                    title: result.title,
                    snippet: result.snippet,
                    link: result.link
                });
            }
        });

        // Search 3: Recent news
        const newsQuery = `"${companyName}" site:valor.com.br OR site:exame.com OR site:estadao.com.br`;
        const newsResults = await searchSerper(newsQuery, apiKey);
        
        newsResults.slice(0, 3).forEach(result => {
            results.recent_news.push({
                title: result.title,
                snippet: result.snippet,
                link: result.link,
                date: result.date
            });
        });

        // Generate insights summary
        if (results.pain_points.length > 0) {
            results.insights += `Encontrados ${results.pain_points.length} problemas potenciais. `;
        }
        if (results.buying_signals.length > 0) {
            results.insights += `${results.buying_signals.length} sinais de expansão/investimento. `;
        }
        if (results.recent_news.length > 0) {
            results.insights += `${results.recent_news.length} notícias recentes. `;
        }
        if (results.insights === '') {
            results.insights = 'Informações limitadas encontradas. Empresa pode ter baixa presença digital.';
        }

        res.status(200).json({
            success: true,
            intel: true,
            company_name: companyName,
            ...results
        });

    } catch (error) {
        console.error('Serper intel error:', error.message);
        
        res.status(500).json({ 
            success: false,
            intel: false,
            error: 'Failed to gather market intelligence',
            details: error.message
        });
    }
};
