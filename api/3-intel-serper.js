const axios = require('axios');

async function searchSerper(query, apiKey, gl = 'br', num = 10) {
    try {
        const response = await axios.post(
            'https://google.serper.dev/search',
            { 
                q: query, 
                gl: gl, 
                hl: 'pt-br', 
                num: num,
                dateRestriction: 'd[6]' // Solo últimos 6 meses para info más relevante
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
        const companyDomain = company.primary_domain || company.website_url || '';
        const industry = company.industry || '';
        
        const results = {
            logistics_problems: [],
            expansion_signals: [],
            recent_news: [],
            financial_info: [],
            technology_adoption: [],
            competitors: [],
            ecommerce_activity: [],
            insights: {},
            raw_intelligence: ''
        };

        // 1. PROBLEMAS LOGÍSTICOS ESPECÍFICOS
        const logisticsQuery = `"${companyName}" ("atraso na entrega" OR "problema logístico" OR "reclamação transporte" OR "avaria mercadoria" OR "extravio" OR "devolução" OR "insatisfação cliente" OR "prazo de entrega") site:reclameaqui.com.br OR site:consumidor.gov.br`;
        const logisticsResults = await searchSerper(logisticsQuery, apiKey, 'br', 5);
        
        logisticsResults.forEach(result => {
            if (result.snippet && result.snippet.toLowerCase().includes(companyName.toLowerCase())) {
                // Extrae números si los hay
                const numbers = result.snippet.match(/\d+/g);
                results.logistics_problems.push({
                    title: result.title,
                    snippet: result.snippet,
                    link: result.link,
                    severity: numbers && parseInt(numbers[0]) > 100 ? 'HIGH' : 'MEDIUM',
                    date: result.date
                });
            }
        });

        // 2. SEÑALES DE CRECIMIENTO/INVERSIÓN
        const growthQuery = `"${companyName}" ("novo centro de distribuição" OR "nova unidade" OR "expansão" OR "investimento" OR "aumento de produção" OR "contratando" OR "vagas abertas" OR "inauguração" OR "aquisição")`;
        const growthResults = await searchSerper(growthQuery, apiKey, 'br', 5);
        
        growthResults.forEach(result => {
            if (result.snippet) {
                // Busca valores de inversión
                const moneyMatch = result.snippet.match(/R\$\s?[\d,.]+ (milhões|milhão|mil)/i);
                const employeeMatch = result.snippet.match(/(\d+)\s?(funcionários|colaboradores|vagas)/i);
                
                results.expansion_signals.push({
                    title: result.title,
                    snippet: result.snippet,
                    link: result.link,
                    investment: moneyMatch ? moneyMatch[0] : null,
                    jobs: employeeMatch ? employeeMatch[1] : null,
                    type: result.snippet.includes('distribuição') ? 'LOGISTICS' : 'GENERAL'
                });
            }
        });

        // 3. INFORMACIÓN FINANCIERA Y DE MERCADO
        const financeQuery = `"${companyName}" ("faturamento" OR "receita" OR "lucro" OR "crescimento" OR "market share" OR "líder de mercado")`;
        const financeResults = await searchSerper(financeQuery, apiKey, 'br', 3);
        
        financeResults.forEach(result => {
            const revenueMatch = result.snippet.match(/R\$\s?[\d,.]+ (bilhões|bilhão|milhões|milhão)/i);
            const growthMatch = result.snippet.match(/(\d+)%/);
            
            if (revenueMatch || growthMatch) {
                results.financial_info.push({
                    snippet: result.snippet,
                    revenue: revenueMatch ? revenueMatch[0] : null,
                    growth: growthMatch ? growthMatch[0] : null,
                    link: result.link
                });
            }
        });

        // 4. E-COMMERCE Y MARKETPLACE (muy relevante para packaging)
        if (industry.toLowerCase().includes('commerce') || industry.toLowerCase().includes('retail')) {
            const ecomQuery = `"${companyName}" ("marketplace" OR "e-commerce" OR "vendas online" OR "entrega rápida" OR "fulfillment" OR "última milha")`;
            const ecomResults = await searchSerper(ecomQuery, apiKey, 'br', 3);
            
            ecomResults.forEach(result => {
                results.ecommerce_activity.push({
                    snippet: result.snippet,
                    link: result.link,
                    is_marketplace: result.snippet.toLowerCase().includes('marketplace')
                });
            });
        }

        // 5. TECNOLOGÍA Y AUTOMATIZACIÓN
        const techQuery = `"${companyName}" ("automação" OR "tecnologia" OR "sistema" OR "ERP" OR "WMS" OR "robô" OR "inteligência artificial")`;
        const techResults = await searchSerper(techQuery, apiKey, 'br', 3);
        
        techResults.forEach(result => {
            if (result.snippet.toLowerCase().includes('automa') || 
                result.snippet.toLowerCase().includes('tecnolog') ||
                result.snippet.toLowerCase().includes('sistema')) {
                results.technology_adoption.push({
                    snippet: result.snippet,
                    link: result.link,
                    type: result.snippet.includes('WMS') ? 'WAREHOUSE' : 'GENERAL'
                });
            }
        });

        // 6. COMPETIDORES (para contexto de mercado)
        if (industry) {
            const competitorQuery = `"${industry}" "principais empresas" Brasil -"${companyName}"`;
            const competitorResults = await searchSerper(competitorQuery, apiKey, 'br', 2);
            
            competitorResults.slice(0, 2).forEach(result => {
                results.competitors.push({
                    snippet: result.snippet,
                    link: result.link
                });
            });
        }

        // ANÁLISIS DE INSIGHTS
        const totalProblems = results.logistics_problems.length;
        const totalExpansion = results.expansion_signals.length;
        const hasEcommerce = results.ecommerce_activity.length > 0;
        const hasTechInvestment = results.technology_adoption.length > 0;
        const hasFinancialData = results.financial_info.length > 0;
        
        // Calcular score de oportunidad (0-100)
        let opportunityScore = 0;
        let buyingIntent = 'LOW';
        let urgency = 'LOW';
        
        // Problemas logísticos = alta oportunidad
        if (totalProblems > 0) {
            opportunityScore += totalProblems * 15;
            urgency = totalProblems > 2 ? 'HIGH' : 'MEDIUM';
        }
        
        // Expansión = alta oportunidad
        if (totalExpansion > 0) {
            opportunityScore += totalExpansion * 20;
            buyingIntent = 'MEDIUM';
            if (results.expansion_signals.some(s => s.type === 'LOGISTICS')) {
                opportunityScore += 15;
                buyingIntent = 'HIGH';
            }
        }
        
        // E-commerce activo = necesita buen packaging
        if (hasEcommerce) {
            opportunityScore += 15;
            if (results.ecommerce_activity.some(e => e.is_marketplace)) {
                opportunityScore += 10;
            }
        }
        
        // Inversión en tecnología = presupuesto disponible
        if (hasTechInvestment) {
            opportunityScore += 10;
            buyingIntent = buyingIntent === 'LOW' ? 'MEDIUM' : buyingIntent;
        }
        
        // Datos financieros positivos
        if (hasFinancialData && results.financial_info.some(f => f.growth && parseInt(f.growth) > 10)) {
            opportunityScore += 10;
        }
        
        opportunityScore = Math.min(opportunityScore, 100);
        
        results.insights = {
            opportunity_score: opportunityScore,
            buying_intent: buyingIntent,
            urgency: urgency,
            key_pain_points: totalProblems,
            expansion_signals: totalExpansion,
            has_ecommerce: hasEcommerce,
            tech_adoption: hasTechInvestment,
            recommendation: opportunityScore > 60 ? 'HOT_LEAD' : opportunityScore > 30 ? 'WARM_LEAD' : 'COLD_LEAD'
        };
        
        // Generar inteligencia en texto para Claude
        results.raw_intelligence = `
        EMPRESA: ${companyName}
        INDUSTRIA: ${industry}
        
        PROBLEMAS ENCONTRADOS (${totalProblems}):
        ${results.logistics_problems.map(p => `- ${p.snippet} [${p.severity}]`).join('\n')}
        
        SEÑALES DE EXPANSIÓN (${totalExpansion}):
        ${results.expansion_signals.map(e => `- ${e.snippet} ${e.investment ? `[Inversión: ${e.investment}]` : ''}`).join('\n')}
        
        ACTIVIDAD E-COMMERCE: ${hasEcommerce ? 'SÍ' : 'NO'}
        ${results.ecommerce_activity.map(e => `- ${e.snippet}`).join('\n')}
        
        INFORMACIÓN FINANCIERA:
        ${results.financial_info.map(f => `- Receita: ${f.revenue || 'N/D'}, Crecimiento: ${f.growth || 'N/D'}`).join('\n')}
        
        ADOPCIÓN TECNOLÓGICA: ${hasTechInvestment ? 'SÍ' : 'NO'}
        
        SCORE DE OPORTUNIDAD: ${opportunityScore}/100
        INTENCIÓN DE COMPRA: ${buyingIntent}
        URGENCIA: ${urgency}
        `;

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
