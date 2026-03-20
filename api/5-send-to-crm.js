const { createClient } = require('@supabase/supabase-js');

var SCALE_DESCRIPTIONS = {
    dor: ["Não há identificação de necessidade","Vendedor assume necessidades","PC admite necessidade","PC admite razões e sintomas","PC admite dor","Vendedor documenta dor e PC concorda","PC formaliza necessidades do TD","TD admite necessidades","TD admite razões e sintomas","TD admite dor","Vendedor documenta dor e Power concorda"],
    poder: ["TD não identificado","Processo de decisão revelado","TD Potencial identificado","Acesso a TD concedido","TD acessado","TD concorda em explorar","Processo confirmado pelo TD","TD concorda em fazer Prova de Valor","TD concorda com proposta","TD confirma aprovação verbal","TD aprova formalmente"],
    visao: ["Nenhuma visão estabelecida","Visão em termos de produto","Visão em termos SPI","Visão diferenciada criada","Visão diferenciada documentada","Documentação concordada por PC","Visão Power em termos de produto","Visão Power em termos SPI","Visão diferenciada com TD","Visão documentada com TD","Documentação concordada por TD"],
    valor: ["Valor não identificado","Vendedor identifica valor","PC concorda em explorar valor","TD concorda em explorar valor","Critérios de valor estabelecidos","Valor associado a visão TD","Análise de valor por vendedor","Análise de valor por PC","TD concorda com análise","Conclusão documentada","TD confirma por escrito"],
    controle: ["Nenhum follow documentado","1a visão enviada para PC","1a visão concordada por PC","1a visão enviada para TD","1a visão concordada por TD","Aprovação para explorar Valor","Plano de avaliação enviado","TD concorda com Avaliação","Plano conduzido","Resultado aprovado","TD aprova proposta final"],
    compras: ["Processo desconhecido","Processo esclarecido por PC","Processo confirmado pelo TD","Condições validadas","Proposta apresentada","Negociação iniciada","Condições aprovadas","Contrato assinado","Pedido recebido","Cobrança emitida","Pagamento realizado"]
};

function mapScoresToCRM(scores) {
    var result = {};
    ['dor','poder','visao','valor','controle','compras'].forEach(function(key) {
        var raw = (scores && scores[key]) ? scores[key] : 0;
        var capped = Math.min(Math.round(raw * 0.3), 3);
        result[key] = { score: capped, description: (SCALE_DESCRIPTIONS[key] || [])[capped] || '' };
    });
    return result;
}

function estimateValue(company, analysis) {
    var employees = company.estimated_num_employees || 100;
    var industry = (company.industry || '').toLowerCase();
    var boxesPerDay;

    if (analysis && analysis.estimated_boxes_day && analysis.estimated_boxes_day > 0) {
        boxesPerDay = analysis.estimated_boxes_day;
    } else {
        var base = 0.1, min = 20;
        if (industry.indexOf('logistics') >= 0 || industry.indexOf('fulfillment') >= 0) { base = 1.0; min = 200; }
        else if (industry.indexOf('ecommerce') >= 0) { base = 0.6; min = 150; }
        else if (industry.indexOf('manufacturing') >= 0) { base = 0.3; min = 80; }
        else if (industry.indexOf('food') >= 0) { base = 0.5; min = 120; }
        else if (industry.indexOf('automotive') >= 0) { base = 0.2; min = 50; }
        boxesPerDay = Math.max(Math.round(employees * base), min);
    }

    var rollsPerMonth = Math.ceil((boxesPerDay * 22) / 200);
    var monthly = rollsPerMonth * 45;
    return { boxesPerDay: boxesPerDay, rollsPerMonth: rollsPerMonth, monthlyValueBRL: monthly, annualValueBRL: monthly * 12 };
}

module.exports = async function(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

    var url = process.env.SUPABASE_URL;
    var key = process.env.SUPABASE_ANON_KEY;

    console.log('ENV:', { hasUrl: !!url, hasKey: !!key });

    if (!url || !key) {
        return res.status(500).json({ success: false, error: 'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing in Vercel env' });
    }

    var supabase = createClient(url, key);

    try {
        var company = req.body.company;
        var contact = req.body.contact;
        var analysis = req.body.analysis;

        if (!company || !contact || !analysis) {
            return res.status(400).json({ success: false, error: 'company, contact, analysis required' });
        }

        var dupCheck = await supabase.from('opportunities').select('id, name, client, stage, vendor').ilike('client', '%' + company.name + '%');
        var duplicates = (dupCheck.data && dupCheck.data.length > 0) ? dupCheck.data : [];

        var crmScales = mapScoresToCRM(analysis.scores || {});
        var val = estimateValue(company, analysis);

        var totalScore = analysis.total_score || 0;
        var priority = 'baixa';
        if (totalScore >= 7 || analysis.priority === 'HOT') priority = 'alta';
        else if (totalScore >= 5 || analysis.priority === 'WARM') priority = 'média';

        var nextParts = [];
        if (contact.name) nextParts.push('Contatar ' + contact.name + ' (' + (contact.title || 'N/A') + ')');
        var hasPhone = contact.phone || (contact.all_phones && contact.all_phones.length > 0);
        var hasEmail = (contact.all_emails && contact.all_emails.some(function(e) { var addr = e.email || e; return addr && addr !== 'Não disponível' && addr !== 'email_not_unlocked@domain.com' && addr.indexOf('@') > 0; })) || (contact.email && contact.email !== 'Não disponível' && contact.email !== 'email_not_unlocked@domain.com' && contact.email.indexOf('@') > 0);
        if (hasPhone) nextParts.push('via telefone/WhatsApp');
        else if (hasEmail) nextParts.push('via email');
        else if (contact.linkedin_url) nextParts.push('via LinkedIn');
        if (analysis.approach) nextParts.push('| ' + (analysis.approach.length > 200 ? analysis.approach.substring(0, 197) + '...' : analysis.approach));

        var closeDate = new Date();
        closeDate.setDate(closeDate.getDate() + 90);

        // Build contact string with all details
        var contactDetails = [];
        if (contact.email && contact.email !== 'Não disponível' && contact.email !== 'email_not_unlocked@domain.com') contactDetails.push('Email: ' + contact.email);
        if (contact.all_phones && contact.all_phones.length > 0) {
            contact.all_phones.forEach(function(p) { contactDetails.push('Tel: ' + p.number + (p.type ? ' (' + p.type + ')' : '')); });
        } else if (contact.phone) { contactDetails.push('Tel: ' + contact.phone); }
        if (contact.linkedin_url) contactDetails.push('LinkedIn: ' + contact.linkedin_url);

        // Build sponsor name with title and contact info
        var sponsorName = contact.name || null;
        if (sponsorName && contact.title) sponsorName = contact.name + ' (' + contact.title + ')';

        // Build support_contact with ALL contact details
        var supportParts = [];
        // Emails: use all_emails array first, fallback to single email
        var validEmails = [];
        if (contact.all_emails && contact.all_emails.length > 0) {
            contact.all_emails.forEach(function(e) {
                var addr = e.email || e;
                if (addr && addr !== 'Não disponível' && addr !== 'email_not_unlocked@domain.com' && addr.indexOf('@') > 0) {
                    validEmails.push(addr);
                }
            });
        } else if (contact.email && contact.email !== 'Não disponível' && contact.email !== 'email_not_unlocked@domain.com' && contact.email.indexOf('@') > 0) {
            validEmails.push(contact.email);
        }
        validEmails.forEach(function(em) { supportParts.push(em); });
        // Phones: use all_phones array first, fallback to single phone
        if (contact.all_phones && contact.all_phones.length > 0) {
            contact.all_phones.forEach(function(p) { supportParts.push(p.number); });
        } else if (contact.phone) { supportParts.push(contact.phone); }
        if (contact.linkedin_url) supportParts.push(contact.linkedin_url);
        
        console.log('📧 Emails para CRM:', validEmails);
        console.log('📱 Phones para CRM:', (contact.all_phones || []).map(function(p){return p.number;}));
        console.log('📋 Support contact:', supportParts.join(' | '));

        // Enrich DOR scale with pain/approach description
        if (analysis.approach || analysis.pain_description) {
            var painText = analysis.pain_description || analysis.approach || '';
            if (painText) crmScales.dor.description = (crmScales.dor.description || '') + '. Prospector: ' + painText.substring(0, 300);
        }

        // Product name from analysis if available
        var productName = 'Fita WAT';
        if (analysis.recommended_products && analysis.recommended_products.length > 0) {
            productName = analysis.recommended_products.join(' + ');
        }

        var opp = {
            name: (productName || 'Fita WAT') + ' - ' + company.name,
            client: company.name,
            vendor: '',
            value: val.annualValueBRL,
            stage: 1,
            priority: priority,
            probability: 0,
            last_update: new Date().toISOString().split('T')[0],
            scales: crmScales,
            expected_close: closeDate.toISOString().split('T')[0],
            next_action: nextParts.join(' ') || 'Realizar primeiro contato',
            product: productName,
            power_sponsor: null,
            sponsor: sponsorName,
            influencer: null,
            support_contact: supportParts.join(' | ') || null,
            industry: company.industry || null
        };

        console.log('Inserting:', company.name);
        var result = await supabase.from('opportunities').insert([opp]).select().single();

        if (result.error) throw result.error;

        console.log('Created #' + result.data.id);
        return res.status(200).json({
            success: true,
            opportunity: result.data,
            duplicates: duplicates,
            valueEstimate: val,
            priority: priority
        });

    } catch (err) {
        console.error('Error:', err);
        return res.status(500).json({ success: false, error: err.message || 'Internal error' });
    }
};
