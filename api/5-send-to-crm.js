// api/5-send-to-crm.js
// Vercel Serverless Function — Inserta oportunidades en el CRM (Supabase)
// Las credenciales quedan en env vars de Vercel, nunca expuestas al frontend.
//
// SETUP EN VERCEL:
// 1. Ir a Settings → Environment Variables en tu proyecto de Vercel
// 2. Agregar:
//    - CRM_SUPABASE_URL   = https://tu-proyecto.supabase.co
//    - CRM_SUPABASE_KEY   = eyJhbG...tu-anon-key
// 3. Redeploy

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY
);

// --- SCALE DESCRIPTIONS (mirror del CRM) ---
const SCALE_DESCRIPTIONS = {
    dor: [
        "Não há identificação de necessidade ou dor pelo cliente",
        "Vendedor assume necessidades do cliente",
        "Pessoa de Contato admite necessidade",
        "Pessoa de Contato admite razões e sintomas causadores de dor",
        "Pessoa de Contato admite dor",
        "Vendedor documenta dor e Pessoa de Contato concorda",
        "Pessoa de Contato e outros necessidades do Tomador de Decisão",
        "Tomador de Decisão admite necessidades",
        "Tomador de Decisão admite razões e sintomas causadores de dor",
        "Tomador de Decisão admite dor",
        "Vendedor documenta dor e Power concorda"
    ],
    poder: [
        "Tomador de Decisão não foi identificado ainda",
        "Processo de decisão revelado por Pessoa de Contato",
        "Tomador de Decisão Potencial identificado",
        "Pedido de acesso a Tomador de Decisão concedido",
        "Tomador de Decisão acessado",
        "Tomador de Decisão concorda em explorar oportunidade",
        "Processo de decisão e compra confirmado pelo Tomador de Decisão",
        "Tomador de Decisão concorda em fazer uma Prova de Valor",
        "Tomador de Decisão concorda com conteúdo da proposta",
        "Tomador de Decisão confirma aprovação verbal",
        "Tomador de Decisão aprova formalmente"
    ],
    visao: [
        "Nenhuma visão ou visão concorrente estabelecida",
        "Visão criada em termos de produto",
        "Visão criada em termos: Situação/Problema/Implicação",
        "Visão diferenciada criada com Pessoa de Contato",
        "Visão diferenciada documentada com Pessoa de Contato",
        "Documentação concordada por Pessoa de Contato",
        "Visão Power criada em termos de produto",
        "Visão Power criada em termos: SPI",
        "Visão diferenciada criada com Tomador de Decisão",
        "Visão diferenciada documentada com Tomador de Decisão",
        "Documentação concordada por Tomador de Decisão"
    ],
    valor: [
        "Valor não identificado",
        "Vendedor identifica proposição de valor",
        "Pessoa de Contato concorda em explorar valor",
        "Tomador de Decisão concorda em explorar valor",
        "Critérios de valor estabelecidos com Tomador de Decisão",
        "Valor descoberto conduzido e visão Tomador de Decisão",
        "Análise de valor conduzida por vendedor (demo)",
        "Análise de valor conduzida pelo Pessoa de Contato (trial)",
        "Tomador de Decisão concorda com análise de Valor",
        "Conclusão da análise de valor documentada",
        "Tomador de Decisão confirma conclusões por escrito"
    ],
    controle: [
        "Nenhum follow documentado",
        "1a visão (SPI) enviada para Pessoa de Contato",
        "1a visão concordada por Pessoa de Contato",
        "1a visão enviada para Tomador de Decisão",
        "1a visão concordada por Tomador de Decisão",
        "Vendedor recebe aprovação para explorar Valor",
        "Plano de avaliação enviado para Tomador de Decisão",
        "Tomador de Decisão concorda com Avaliação",
        "Plano de Avaliação conduzido",
        "Resultado da Avaliação aprovado",
        "Tomador de Decisão aprova proposta final"
    ],
    compras: [
        "Processo de compras desconhecido",
        "Processo de compras esclarecido pela pessoa de contato",
        "Processo de compras confirmado pelo Tomador de Decisão",
        "Condições comerciais validadas",
        "Proposta apresentada",
        "Negociação iniciada com compras",
        "Condições comerciais aprovadas",
        "Contrato assinado",
        "Pedido de compras recebido",
        "Cobrança emitida",
        "Pagamento realizado"
    ]
};

// --- MAPEO DE SCORES ---
function mapScoresToCRM(prospectorScores) {
    if (!prospectorScores || typeof prospectorScores !== 'object') {
        return emptyScales();
    }
    const scaleKeys = ['dor', 'poder', 'visao', 'valor', 'controle', 'compras'];
    const mapped = {};
    scaleKeys.forEach(key => {
        const rawScore = prospectorScores[key]
            || prospectorScores[key.replace('dor', 'pain')]
            || prospectorScores[key.replace('poder', 'power')]
            || prospectorScores[key.replace('visao', 'vision')]
            || prospectorScores[key.replace('valor', 'value')]
            || prospectorScores[key.replace('controle', 'control')]
            || prospectorScores[key.replace('compras', 'purchase')]
            || 0;
        const cappedScore = Math.min(Math.round(rawScore * 0.3), 3);
        mapped[key] = {
            score: cappedScore,
            description: (SCALE_DESCRIPTIONS[key] || [])[cappedScore] || ''
        };
    });
    return mapped;
}

function emptyScales() {
    const mapped = {};
    ['dor', 'poder', 'visao', 'valor', 'controle', 'compras'].forEach(key => {
        mapped[key] = { score: 0, description: SCALE_DESCRIPTIONS[key]?.[0] || '' };
    });
    return mapped;
}

// --- ESTIMACIÓN DE VALOR ---
function estimateOpportunityValue(company, analysis) {
    const employees = company.estimated_num_employees || 100;
    const industry = (company.industry || '').toLowerCase();
    const estimatedBoxes = analysis?.estimated_boxes_day || null;

    let boxesPerDay;
    if (estimatedBoxes && estimatedBoxes > 0) {
        boxesPerDay = estimatedBoxes;
    } else {
        const ratios = {
            'logistics': { base: 0.8, min: 200 },
            'fulfillment': { base: 1.2, min: 300 },
            'ecommerce': { base: 0.6, min: 150 },
            'retail': { base: 0.4, min: 100 },
            'manufacturing': { base: 0.3, min: 80 },
            'food': { base: 0.5, min: 120 },
            'automotive': { base: 0.2, min: 50 },
            'pharma': { base: 0.15, min: 30 },
            'cosmetic': { base: 0.15, min: 30 },
            'default': { base: 0.1, min: 20 }
        };
        let ratio = ratios.default;
        for (const [key, val] of Object.entries(ratios)) {
            if (industry.includes(key)) { ratio = val; break; }
        }
        boxesPerDay = Math.max(Math.round(employees * ratio.base), ratio.min);
    }

    const boxesPerMonth = boxesPerDay * 22;
    const rollsPerMonth = Math.ceil(boxesPerMonth / 200);
    const monthlyValueBRL = rollsPerMonth * 45;

    return {
        boxesPerDay,
        boxesPerMonth,
        rollsPerMonth,
        monthlyValueBRL,
        annualValueBRL: monthlyValueBRL * 12
    };
}

// --- HANDLER PRINCIPAL ---
module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    // Verificar config
    if (!process.env.CRM_SUPABASE_URL || !process.env.CRM_SUPABASE_KEY) {
        return res.status(500).json({
            success: false,
            error: 'CRM_SUPABASE_URL y CRM_SUPABASE_KEY no configurados en Vercel env vars'
        });
    }

    try {
        const { company, contact, analysis } = req.body;

        if (!company || !contact || !analysis) {
            return res.status(400).json({
                success: false,
                error: 'Faltan datos: company, contact y analysis son obligatorios'
            });
        }

        // 1. Check duplicados
        const { data: existing, error: dupError } = await supabase
            .from('opportunities')
            .select('id, name, client, stage, vendor, value')
            .ilike('client', `%${company.name}%`);

        if (dupError) {
            console.error('Error checking duplicates:', dupError);
        }

        const duplicates = existing && existing.length > 0 ? existing : [];

        // 2. Mapear scores
        const crmScales = mapScoresToCRM(analysis.scores || {});

        // 3. Estimar valor
        const valueEstimate = estimateOpportunityValue(company, analysis);

        // 4. Prioridad
        const totalScore = analysis.total_score || 0;
        let crmPriority;
        if (totalScore >= 7 || analysis.priority === 'HOT') {
            crmPriority = 'alta';
        } else if (totalScore >= 5 || analysis.priority === 'WARM') {
            crmPriority = 'média';
        } else {
            crmPriority = 'baixa';
        }

        // 5. Next action
        const nextParts = [];
        if (contact.name) {
            nextParts.push(`Contatar ${contact.name} (${contact.title || 'cargo N/A'})`);
        }
        if (contact.phone || (contact.all_phones && contact.all_phones.length > 0)) {
            nextParts.push('via telefone/WhatsApp');
        } else if (contact.email && contact.email !== 'Não disponível') {
            nextParts.push('via email');
        } else if (contact.linkedin_url) {
            nextParts.push('via LinkedIn');
        }
        if (analysis.approach) {
            const approach = analysis.approach.length > 150
                ? analysis.approach.substring(0, 147) + '...'
                : analysis.approach;
            nextParts.push(`| Abordagem: ${approach}`);
        }

        // 6. Contact summary
        const contactParts = [];
        if (contact.email && contact.email !== 'Não disponível') {
            contactParts.push(`Email: ${contact.email}`);
        }
        if (contact.all_phones && contact.all_phones.length > 0) {
            contactParts.push(`Tel: ${contact.all_phones[0].number} (${contact.all_phones[0].type || 'N/A'})`);
        } else if (contact.phone) {
            contactParts.push(`Tel: ${contact.phone}`);
        }
        if (contact.linkedin_url) {
            contactParts.push(`LinkedIn: ${contact.linkedin_url}`);
        }

        // 7. Expected close: +90 días
        const expectedClose = new Date();
        expectedClose.setDate(expectedClose.getDate() + 90);

        // 8. Construir oportunidad
        const opportunity = {
            name: `Fita WAT - ${company.name}`,
            client: company.name,
            vendor: '',   // Pool
            value: valueEstimate.annualValueBRL,
            stage: 1,
            priority: crmPriority,
            probability: 0,
            last_update: new Date().toISOString().split('T')[0],
            scales: crmScales,
            expected_close: expectedClose.toISOString().split('T')[0],
            next_action: nextParts.join(' ') || 'Realizar primeiro contato com decisor identificado',
            product: 'Fita WAT',
            power_sponsor: null,
            sponsor: contact.name || null,
            influencer: null,
            support_contact: contactParts.join(' | ') || null,
            industry: company.industry || null
        };

        // 9. Insertar
        const { data: result, error: insertError } = await supabase
            .from('opportunities')
            .insert([opportunity])
            .select()
            .single();

        if (insertError) throw insertError;

        console.log('✅ Oportunidade criada via API:', result.id, company.name);

        return res.status(200).json({
            success: true,
            opportunity: result,
            duplicates: duplicates,
            valueEstimate: valueEstimate,
            priority: crmPriority
        });

    } catch (error) {
        console.error('❌ Erro ao criar oportunidade:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Erro interno ao criar oportunidade'
        });
    }
};
