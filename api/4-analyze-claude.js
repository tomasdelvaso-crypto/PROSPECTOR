const Anthropic = require('@anthropic-ai/sdk');

// Fallback analysis if Claude API fails
function generateFallbackAnalysis(company, contact, intel) {
    const employees = company?.estimated_num_employees || 100;
    const hasProblems = intel?.pain_points?.length > 0;
    const hasExpansion = intel?.buying_signals?.length > 0;
    const isOperations = contact?.title?.toLowerCase().includes('operations') || 
                        contact?.title?.toLowerCase().includes('logistics');
    const isDirector = contact?.title?.toLowerCase().includes('director') ||
                      contact?.title?.toLowerCase().includes('manager');

    // Calculate scores based on rules
    const scores = {
        pain: hasProblems ? 8 : employees > 1000 ? 6 : 4,
        power: isDirector ? 7 : 5,
        vision: isOperations ? 8 : 6,
        value: employees > 1000 ? 8 : employees > 500 ? 6 : 4,
        control: hasExpansion ? 7 : 5,
        compras: employees > 5000 ? 4 : employees > 1000 ? 6 : 8
    };

    const total = Object.values(scores).reduce((a, b) => a + b, 0) / 6;
    
    return {
        scores,
        total_score: total.toFixed(1),
        priority: total >= 7 ? 'HOT' : total >= 5 ? 'WARM' : 'COLD',
        justification: 'Análise baseada em regras devido a falha na API Claude',
        approach: 'Enviar email com case de sucesso relevante para o setor',
        estimated_boxes_day: Math.round(employees / 10)
    };
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
        const { company, contact, intel } = req.body;
        const apiKey = process.env.CLAUDE_API_KEY;

        if (!apiKey) {
            console.warn('Claude API key not found. Using fallback analysis.');
            return res.status(200).json(generateFallbackAnalysis(company, contact, intel));
        }

        const anthropic = new Anthropic({ apiKey });

        // Build comprehensive prompt with Ventapel context
        const prompt = `
Você é um especialista em vendas B2B da Ventapel Brasil, empresa líder em soluções de fechamento de caixas.

CONTEXTO VENTAPEL:
- Produtos: Máquinas dispensadoras BP555/BP755 (investimento R$50k-200k) + Cinta VENOM (consumível recorrente)
- Problemas que resolvemos: Violação de caixas em trânsito, perdas por roubo, baixa produtividade no fechamento, retrabalho logístico
- ROI típico: 6-12 meses com redução de 64% nos custos totais de fechamento
- Clientes ideais: Empresas com >500 funcionários, alto volume de expedição (>500 caixas/dia)

DADOS DO PROSPECTO:
Empresa: ${company?.name || 'Não identificada'}
- Indústria: ${company?.industry || 'Não especificada'}
- Funcionários: ${company?.estimated_num_employees || 'Desconhecido'}
- Localização: ${company?.city || company?.state || 'Brasil'}
- Website: ${company?.website_url || 'N/A'}

Contato: ${contact?.name || 'Não identificado'}
- Cargo: ${contact?.title || 'Não especificado'}
- Email: ${contact?.email ? 'Disponível' : 'Não disponível'}
- Telefone: ${contact?.phone ? 'DISPONÍVEL' : 'NÃO ENCONTRADO'}
- LinkedIn: ${contact?.linkedin_url || 'N/A'}

INTELIGÊNCIA DE MERCADO:
- Problemas encontrados: ${intel?.pain_points?.length || 0} sinais de problemas logísticos
${intel?.pain_points?.[0] ? `  Exemplo: "${intel.pain_points[0].snippet}"` : ''}
- Sinais de compra: ${intel?.buying_signals?.length || 0} indicadores de expansão/investimento
${intel?.buying_signals?.[0] ? `  Exemplo: "${intel.buying_signals[0].snippet}"` : ''}
- Notícias recentes: ${intel?.recent_news?.length || 0}

Analise este prospecto usando o framework PPVVC (escala 0-10):

1. PAIN (Dor): A empresa demonstra problemas que Ventapel resolve? Considere o volume de operação e problemas encontrados.

2. POWER (Poder): O cargo "${contact?.title || 'não especificado'}" tem autoridade para aprovar ou influenciar fortemente uma compra de R$50-200k?

3. VISION (Visão): Pela função do contato, ele entenderá rapidamente o valor de um sistema de fechamento inviolável?

4. VALUE (Valor): O porte da empresa e volume estimado justificam o investimento? Calcule caixas/dia baseado em funcionários e indústria.

5. CONTROL (Controle): Temos informações e ganchos suficientes para criar urgência e liderar o processo de venda?

6. COMPRAS: Qual a complexidade esperada do processo de compras para uma empresa deste porte?

Forneça análise em JSON puro, sem texto adicional:
{
  "scores": {
    "pain": <0-10>,
    "power": <0-10>,
    "vision": <0-10>,
    "value": <0-10>,
    "control": <0-10>,
    "compras": <0-10>
  },
  "total_score": <média>,
  "priority": "HOT|WARM|COLD",
  "justification": "Resumo em uma frase dos principais pontos",
  "approach": "Abordagem recomendada específica em uma frase",
  "estimated_boxes_day": "<número estimado>"
}`;

        const response = await anthropic.messages.create({
            model: 'claude-3-haiku-20240307',
            max_tokens: 1024,
            temperature: 0.3,
            messages: [{ 
                role: 'user', 
                content: prompt 
            }]
        });

        // Parse Claude's response
        const responseText = response.content[0].text;
        const cleanJson = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const analysis = JSON.parse(cleanJson);

        res.status(200).json(analysis);

    } catch (error) {
        console.error('Claude analysis error:', error);
        
        // Use fallback if Claude fails
        res.status(200).json(generateFallbackAnalysis(
            req.body.company,
            req.body.contact,
            req.body.intel
        ));
    }
};
