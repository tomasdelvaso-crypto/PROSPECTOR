const Anthropic = require('@anthropic-ai/sdk');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { company, contact, context } = req.body;

  // Si no hay API key de Claude, usar análisis basado en reglas
  if (!process.env.CLAUDE_API_KEY) {
    const rulesBasedAnalysis = analyzeWithRules(company, contact);
    return res.status(200).json(rulesBasedAnalysis);
  }

  try {
    const anthropic = new Anthropic({
      apiKey: process.env.CLAUDE_API_KEY,
    });

    const prompt = `
    Analiza este prospecto para Ventapel Brasil (soluciones de cierre y empaque B2B):
    
    CONTEXTO VENTAPEL:
    - Reducción de 64% en costos de sistema de cierre
    - Clientes: Mercado Livre, Amazon, L'Oréal, Honda, Nestlé
    - Foco: E-commerce, 3PL, Alimentos, Farmacéutica, Cosmética
    - Dolor principal: violación de cajas, pérdidas en tránsito, retrabajos
    
    PROSPECTO:
    Empresa: ${company.name || 'No especificada'}
    Industria: ${company.industry || 'No especificada'}
    Empleados: ${company.estimated_num_employees || 'No especificado'}
    Sede: ${company.headquarters_location || 'Brasil'}
    
    CONTACTO:
    Nombre: ${contact.name}
    Cargo: ${contact.title}
    Email: ${contact.email || 'No disponible'}
    
    Evalúa según metodología PPVVC (0-10 cada uno):
    
    PAIN (Dolor): 
    - ¿La industria tiene problemas de logística/empaque?
    - ¿Volumen sugiere dolor operacional?
    - ¿Mercado competitivo requiere eficiencia?
    
    POWER (Poder):
    - ¿El cargo tiene autoridad de decisión?
    - ¿Es un influenciador técnico?
    
    VISION (Visión):
    - ¿Entendería rápidamente la solución?
    - ¿Industria familiarizada con automatización?
    
    VALUE (Valor):
    - ¿El ROI sería significativo para su volumen?
    - ¿Presupuesto probable para soluciones?
    
    CONTROL:
    - ¿Podemos controlar el proceso de venta?
    - ¿Hay competencia directa?
    
    COMPRAS:
    - ¿Proceso de compras complejo?
    - ¿Decisión rápida o larga?
    
    Responde SOLO en JSON sin markdown:
    {
      "scores": {
        "pain": [0-10],
        "power": [0-10],
        "vision": [0-10],
        "value": [0-10],
        "control": [0-10],
        "compras": [0-10]
      },
      "total_score": [promedio con 1 decimal],
      "reasoning": "[explicación en portugués de máximo 50 palabras]",
      "recommended_approach": "[estrategia de abordaje en portugués, máximo 30 palabras]",
      "estimated_potential": "[bajo/medio/alto]",
      "key_pain_points": ["dolor1", "dolor2"],
      "decision_timeline": "[inmediato/3-6 meses/6-12 meses/largo plazo]"
    }
    `;

    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 600,
      temperature: 0.3,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    // Parsear respuesta
    let analysis;
    try {
      const responseText = response.content[0].text;
      // Limpiar markdown si existe
      const cleanJson = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      analysis = JSON.parse(cleanJson);
    } catch (parseError) {
      console.error('Error parseando respuesta de Claude:', parseError);
      // Fallback a análisis basado en reglas
      analysis = analyzeWithRules(company, contact);
    }

    res.status(200).json(analysis);

  } catch (error) {
    console.error('Error con Claude API:', error);
    // Fallback a análisis basado en reglas
    const rulesBasedAnalysis = analyzeWithRules(company, contact);
    res.status(200).json(rulesBasedAnalysis);
  }
};

// Análisis basado en reglas (sin IA)
function analyzeWithRules(company, contact) {
  const scores = {
    pain: 5,
    power: 5,
    vision: 5,
    value: 5,
    control: 5,
    compras: 5
  };
  
  // PAIN - Análisis de dolor basado en industria
  if (company.industry) {
    const industry = company.industry.toLowerCase();
    if (industry.includes('commerce') || industry.includes('marketplace') || 
        industry.includes('logistics') || industry.includes('3pl')) {
      scores.pain = 8;
    } else if (industry.includes('food') || industry.includes('pharma') || 
               industry.includes('cosmetic')) {
      scores.pain = 7;
    } else if (industry.includes('automotive') || industry.includes('manufacturing')) {
      scores.pain = 6;
    }
  }
  
  // Ajuste por tamaño de empresa
  if (company.estimated_num_employees > 1000) {
    scores.pain += 1;
    scores.value += 2;
  }
  
  // POWER - Análisis de poder basado en cargo
  if (contact.title) {
    const title = contact.title.toLowerCase();
    if (title.includes('ceo') || title.includes('president') || title.includes('owner')) {
      scores.power = 9;
    } else if (title.includes('director') || title.includes('vp') || title.includes('head')) {
      scores.power = 8;
    } else if (title.includes('gerente') || title.includes('manager')) {
      scores.power = 6;
    } else if (title.includes('coordinator') || title.includes('supervisor')) {
      scores.power = 4;
    } else if (title.includes('compras') || title.includes('procurement')) {
      scores.power = 3;
    }
  }
  
  // VISION - Capacidad de entender la solución
  if (contact.title) {
    const title = contact.title.toLowerCase();
    if (title.includes('operac') || title.includes('operations') || 
        title.includes('logistic') || title.includes('quality')) {
      scores.vision = 7;
    }
  }
  
  // VALUE - Percepción de valor
  if (company.estimated_num_employees > 500) {
    scores.value = 7;
  }
  if (company.estimated_num_employees > 5000) {
    scores.value = 8;
  }
  
  // CONTROL - Control del proceso
  scores.control = contact.email ? 6 : 4;
  
  // COMPRAS - Complejidad del proceso
  if (company.estimated_num_employees > 1000) {
    scores.compras = 4; // Más complejo
  } else {
    scores.compras = 7; // Más simple
  }
  
  // Calcular score total
  const total_score = (Object.values(scores).reduce((a, b) => a + b, 0) / 6).toFixed(1);
  
  // Generar recomendaciones basadas en scores
  let reasoning = '';
  let recommended_approach = '';
  let estimated_potential = 'medio';
  let decision_timeline = '3-6 meses';
  
  if (parseFloat(total_score) >= 7) {
    reasoning = `${contact.name} em ${company.name || 'empresa'} apresenta forte potencial. Indústria ${company.industry || ''} com alta necessidade de soluções de fechamento.`;
    recommended_approach = 'Contato imediato via LinkedIn com case de sucesso similar. Propor demo em 48h.';
    estimated_potential = 'alto';
    decision_timeline = 'inmediato';
  } else if (parseFloat(total_score) >= 5) {
    reasoning = `Prospecto qualificado com potencial médio. Necessita educação sobre ROI da solução.`;
    recommended_approach = 'Enviar case study relevante e agendar follow-up em 1 semana.';
    estimated_potential = 'medio';
    decision_timeline = '3-6 meses';
  } else {
    reasoning = `Prospecto requer maior qualificação. Pode não ter volume ou urgência suficiente.`;
    recommended_approach = 'Adicionar a campanhas de nutrição e monitorar sinais de compra.';
    estimated_potential = 'bajo';
    decision_timeline = '6-12 meses';
  }
  
  // Identificar pain points baseados en industria
  const key_pain_points = [];
  if (company.industry) {
    const industry = company.industry.toLowerCase();
    if (industry.includes('commerce')) {
      key_pain_points.push('violação em trânsito', 'devoluções por avaria');
    } else if (industry.includes('food')) {
      key_pain_points.push('contaminação', 'rastreabilidade');
    } else if (industry.includes('pharma')) {
      key_pain_points.push('segurança', 'compliance regulatório');
    } else {
      key_pain_points.push('eficiência operacional', 'redução de custos');
    }
  }
  
  return {
    scores,
    total_score: parseFloat(total_score),
    reasoning,
    recommended_approach,
    estimated_potential,
    key_pain_points,
    decision_timeline
  };
}
