const Anthropic = require('@anthropic-ai/sdk');

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
            return res.status(200).json(generateDetailedFallbackAnalysis(company, contact, intel));
        }

        const anthropic = new Anthropic({ apiKey });

        // Build comprehensive prompt with actual intelligence
        const prompt = `
Você é um especialista senior em vendas B2B da Ventapel Brasil com 20 anos de experiência. Analise este prospecto com EXTREMA profundidade.

CONTEXTO VENTAPEL:
- Solução: Sistema de fechamento inviolável BP555/BP755 + Cinta VENOM
- Investimento: R$50k-200k com ROI em 6-12 meses
- Redução comprovada: 64% nos custos totais de embalagem, 87% redução em violações
- Casos de sucesso: Magazine Luiza (zero violações em 2M de envios), B2W (-92% devoluções)

DADOS DO PROSPECTO:
Empresa: ${company?.name || 'Não identificada'}
- Indústria: ${company?.industry || 'Não especificada'}
- Funcionários: ${company?.estimated_num_employees || 'Desconhecido'}
- Localização: ${company?.city || company?.state || 'Brasil'}
- Receita estimada: R$ ${company?.annual_revenue ? (company.annual_revenue / 1000000).toFixed(1) + 'M' : 'Desconhecida'}

Contato: ${contact?.name || 'Não identificado'}
- Cargo: ${contact?.title || 'Não especificado'}
- Senioridade: ${contact?.seniority || 'Não identificada'}
- Departamento: ${contact?.departments?.[0] || 'Não identificado'}
- Email: ${contact?.email ? 'DISPONÍVEL' : 'NÃO DISPONÍVEL'}
- Telefone: ${contact?.phone ? 'DISPONÍVEL' : 'NÃO ENCONTRADO'}

INTELIGÊNCIA DE MERCADO COLETADA:
${intel?.raw_intelligence || 'Sem dados de inteligência'}

Score de Oportunidade: ${intel?.insights?.opportunity_score || 0}/100
Intenção de Compra: ${intel?.insights?.buying_intent || 'DESCONHECIDA'}
Urgência: ${intel?.insights?.urgency || 'BAIXA'}
Problemas Logísticos Encontrados: ${intel?.insights?.key_pain_points || 0}
Sinais de Expansão: ${intel?.insights?.expansion_signals || 0}

PROBLEMAS ESPECÍFICOS ENCONTRADOS:
${intel?.logistics_problems?.map(p => `- ${p.snippet} [Severidade: ${p.severity}]`).join('\n') || 'Nenhum problema específico encontrado'}

EXPANSÕES/INVESTIMENTOS:
${intel?.expansion_signals?.map(e => `- ${e.snippet} ${e.investment ? `[Valor: ${e.investment}]` : ''}`).join('\n') || 'Nenhuma expansão identificada'}

ANÁLISE PPVVC DETALHADA:

1. PAIN (0-10): Analise:
   - Quantidade e severidade dos problemas logísticos encontrados
   - Volume estimado de expedição (funcionários x indústria)
   - Presença em e-commerce (alta taxa de violação)
   - Reclamações específicas sobre entrega/violação
   - Se não há problemas encontrados, score máximo 3

2. POWER (0-10): "${contact?.title}" tem autoridade para:
   - Aprovar R$50-200k? (gerente=5, diretor=7, C-level=9)
   - Influenciar a decisão? (operations/logistics=+2 pontos)
   - Mobilizar outros departamentos?
   
3. VISION (0-10): O contato entenderá o valor?
   - Cargo em operações/logística = alta visão (8-10)
   - Cargo em qualidade = média-alta visão (6-8)  
   - Outros cargos = baixa visão (3-5)
   - Empresa com problemas graves = +2 pontos

4. VALUE (0-10): ROI justificável?
   - >1000 funcionários = 8-10 (alto volume)
   - 500-1000 funcionários = 6-8 (médio volume)
   - <500 funcionários = 3-5 (baixo volume)
   - E-commerce ativo = +2 pontos
   - Expansão logística = +1 ponto

5. CONTROL (0-10): Podemos criar urgência?
   - Problemas severos encontrados = 8-10
   - Expansão em andamento = 6-8
   - Competidor usando solução similar = 7-9
   - Sem ganchos claros = 2-4

6. COMPRAS (0-10 invertido - 10=fácil, 1=difícil):
   - <500 funcionários = 8-10 (processo simples)
   - 500-2000 = 5-7 (processo médio)
   - >2000 = 2-4 (processo complexo)
   - Empresa familiar = +2 pontos

ABORDAGEM ESPECÍFICA:
Com base nos dados reais encontrados, crie uma abordagem ESPECÍFICA em uma frase. Exemplos:
- Se há problemas no ReclameAqui: "Mencionar as X reclamações sobre violação encontradas e apresentar case Magazine Luiza"
- Se há expansão: "Parabenizar pela nova unidade em [cidade] e propor piloto para garantir zero violações"
- Se é e-commerce: "Focar no aumento de 47% em devoluções do setor e nossa redução de 92%"
- Se não há ganchos: "Abordagem educativa sobre tendências de violação no setor [indústria específica]"

RESPOSTA APENAS EM JSON, sem texto adicional:
{
  "scores": {
    "pain": <0-10 baseado em problemas reais>,
    "power": <0-10 baseado no cargo>,
    "vision": <0-10 baseado na função>,
    "value": <0-10 baseado no porte e volume>,
    "control": <0-10 baseado em urgência real>,
    "compras": <0-10 invertido>
  },
  "total_score": <média ponderada>,
  "priority": "HOT|WARM|COLD",
  "justification": "Explicação específica em uma frase baseada nos dados reais",
  "approach": "Abordagem específica e acionável em uma frase",
  "estimated_boxes_day": <número>,
  "key_hook": "Principal gancho encontrado nos dados",
  "first_message": "Mensagem de abertura específica para este lead",
  "objection_handling": "Principal objeção esperada e resposta",
  "next_steps": ["Ação 1 específica", "Ação 2 específica", "Ação 3 específica"]
}`;

        const response = await anthropic.messages.create({
            model: 'claude-3-haiku-20240307',
            max_tokens: 2048,
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
        
        // Use enhanced fallback if Claude fails
        res.status(200).json(generateDetailedFallbackAnalysis(
            req.body.company,
            req.body.contact,
            req.body.intel
        ));
    }
};

// Enhanced fallback analysis based on real data
function generateDetailedFallbackAnalysis(company, contact, intel) {
    const employees = company?.estimated_num_employees || 100;
    const hasProblems = intel?.insights?.key_pain_points > 0;
    const hasExpansion = intel?.insights?.expansion_signals > 0;
    const opportunityScore = intel?.insights?.opportunity_score || 0;
    const urgency = intel?.insights?.urgency || 'LOW';
    
    // More sophisticated scoring based on intel
    const scores = {
        pain: hasProblems ? Math.min(8, 4 + intel.insights.key_pain_points * 2) : 
              employees > 1000 ? 5 : 3,
        power: contact?.title?.toLowerCase().includes('director') ? 7 :
               contact?.title?.toLowerCase().includes('manager') ? 5 : 3,
        vision: contact?.title?.toLowerCase().includes('operations') || 
                contact?.title?.toLowerCase().includes('logistics') ? 8 : 5,
        value: employees > 1000 ? 8 : employees > 500 ? 6 : 4,
        control: urgency === 'HIGH' ? 8 : urgency === 'MEDIUM' ? 6 : 3,
        compras: employees > 5000 ? 3 : employees > 1000 ? 6 : 8
    };

    const total = Object.values(scores).reduce((a, b) => a + b, 0) / 6;
    const priority = opportunityScore > 60 ? 'HOT' : opportunityScore > 30 ? 'WARM' : 'COLD';
    
    // Generate specific hooks based on intel
    let keyHook = "Sem gancho específico identificado";
    let approach = "Abordagem educativa sobre redução de violações";
    let firstMessage = `Olá ${contact?.name?.split(' ')[0] || ''}, vi que a ${company?.name} está crescendo...`;
    
    if (hasProblems && intel?.logistics_problems?.length > 0) {
        keyHook = intel.logistics_problems[0].snippet.substring(0, 100);
        approach = `Abordar diretamente os ${intel.insights.key_pain_points} problemas de entrega encontrados`;
        firstMessage = `Vi as reclamações sobre problemas de entrega da ${company.name}. Temos a solução que eliminou 100% das violações na Magazine Luiza...`;
    } else if (hasExpansion && intel?.expansion_signals?.length > 0) {
        keyHook = `Expansão: ${intel.expansion_signals[0].snippet.substring(0, 100)}`;
        approach = "Parabenizar pela expansão e oferecer proteção para novo volume";
        firstMessage = `Parabéns pela expansão! Com o aumento de volume, a proteção contra violações se torna crítica...`;
    }
    
    return {
        scores,
        total_score: total.toFixed(1),
        priority,
        justification: hasProblems ? 
            `${intel.insights.key_pain_points} problemas logísticos encontrados, oportunidade clara` :
            `Empresa com ${employees} funcionários, potencial baseado em porte`,
        approach,
        estimated_boxes_day: Math.round(employees / 10),
        key_hook: keyHook,
        first_message: firstMessage,
        objection_handling: "Preço alto? ROI em 6 meses com redução de 64% em custos totais",
        next_steps: [
            hasProblems ? "Enviar case específico do setor" : "Enviar vídeo demonstrativo",
            "Agendar call de diagnóstico gratuito",
            "Preparar proposta com ROI calculado"
        ]
    };
}
