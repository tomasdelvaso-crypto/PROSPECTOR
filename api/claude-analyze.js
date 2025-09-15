const Anthropic = require('@anthropic-ai/sdk');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { company, contact, enrichment } = req.body;

  if (!process.env.CLAUDE_API_KEY) {
    const rulesBasedAnalysis = analyzeWithRules(company, contact, enrichment);
    return res.status(200).json(rulesBasedAnalysis);
  }

  try {
    const anthropic = new Anthropic({
      apiKey: process.env.CLAUDE_API_KEY,
    });

    const prompt = `
    Analiza este prospecto para Ventapel (solución B2B de cierre de cajas).
    
    EMPRESA: ${company.name}
    - Industria: ${company.industry || 'No especificada'}
    - Empleados: ${company.estimated_num_employees || 'Desconocido'}
    - Ubicación: ${company.headquarters_location || 'Brasil'}
    
    CONTACTO: ${contact.name} - ${contact.title}
    
    INTELIGENCIA DE MERCADO:
    ${enrichment?.enrichmentData?.publicProblems?.length > 0 ? 
      `Problemas detectados: ${JSON.stringify(enrichment.enrichmentData.publicProblems)}` : 
      'Sin problemas públicos detectados'}
    ${enrichment?.enrichmentData?.buyingSignals?.length > 0 ? 
      'ALERTA: Buscando proveedores activamente' : 
      'No hay señales de compra activas'}
    
    Evalúa PPVVC con JUSTIFICACIÓN para cada score:
    
    PAIN (0-10): 
    - 0-3: Sin dolor aparente
    - 4-6: Dolor moderado  
    - 7-10: Dolor urgente/crítico
    Considera: ¿Hay problemas reales detectados? ¿La industria típicamente tiene problemas de empaque?
    
    POWER (0-10):
    - 0-3: Sin poder (analista, coordinador junior)
    - 4-6: Influenciador (gerente medio)
    - 7-10: Decisor (director, VP, C-level)
    Considera: ¿El cargo "${contact.title}" puede aprobar compras de $50k-200k?
    
    VISION (0-10):
    - 0-3: No entenderá la solución
    - 4-6: Entenderá con educación
    - 7-10: Entenderá inmediatamente
    Considera: ¿Operaciones/Logística entienden el problema de cierre?
    
    VALUE (0-10):
    - 0-3: ROI no claro
    - 4-6: ROI moderado
    - 7-10: ROI obvio y alto
    Considera: Con ${company.estimated_num_employees} empleados, ¿justifica la inversión?
    
    CONTROL (0-10):
    - 0-3: Cliente controla totalmente
    - 4-6: Control compartido
    - 7-10: Nosotros controlamos
    Considera: ¿Hay urgencia? ¿Competencia establecida?
    
    COMPRAS (0-10):
    - 0-3: Proceso muy complejo (multinacional, licitación)
    - 4-6: Proceso normal (aprobaciones múltiples)
    - 7-10: Proceso simple (decisión rápida)
    Considera: Empresa de ${company.estimated_num_employees} empleados, ¿qué tan burocrático será?
    
    Responde en JSON con EXPLICACIÓN para cada score:
    {
      "scores": {
        "pain": X,
        "power": X,
        "vision": X,
        "value": X,
        "control": X,
        "compras": X
      },
      "explanations": {
        "pain": "Por qué este score: ...",
        "power": "Por qué este score: ...",
        "vision": "Por qué este score: ...",
        "value": "Por qué este score: ...",
        "control": "Por qué este score: ...",
        "compras": "Por qué este score: ..."
      },
      "total_score": X.X,
      "reasoning": "Resumen general en 50 palabras",
      "recommended_approach": "Acción específica",
      "key_pain_points": ["dolor1", "dolor2"],
      "decision_timeline": "inmediato/3-6 meses/6-12 meses"
    }
    `;

    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 800, // Aumentado para explicaciones
      temperature: 0.3,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const responseText = response.content[0].text;
    const cleanJson = responseText.replace(/```json?\n?/g, '').replace(/```\n?/g, '').trim();
    const analysis = JSON.parse(cleanJson);
    
    res.status(200).json(analysis);

  } catch (error) {
    console.error('Error con Claude:', error);
    const rulesBasedAnalysis = analyzeWithRules(company, contact, enrichment);
    res.status(200).json(rulesBasedAnalysis);
  }
};

// Función de fallback CORREGIDA
function analyzeWithRules(company, contact, enrichment) {
  const scores = {};
  const explanations = {};
  
  // PAIN - Dolor real
  scores.pain = 5;
  if (enrichment?.enrichmentData?.publicProblems?.length > 0) {
    scores.pain = 8;
    explanations.pain = "Problemas públicos detectados por Serper";
  } else if (company.industry?.toLowerCase().includes('logistic')) {
    scores.pain = 7;
    explanations.pain = "Industria logística típicamente tiene problemas de empaque";
  } else {
    explanations.pain = "Sin evidencia clara de dolor";
  }
  
  // POWER - Autoridad real
  const title = (contact.title || '').toLowerCase();
  if (title.includes('diretor') || title.includes('vp') || title.includes('ceo')) {
    scores.power = 9;
    explanations.power = "Cargo de alta dirección con presupuesto";
  } else if (title.includes('gerente')) {
    scores.power = 6;
    explanations.power = "Gerente puede influenciar pero no decidir solo";
  } else {
    scores.power = 3;
    explanations.power = "Cargo sin autoridad de compra clara";
  }
  
  // VISION - Comprensión
  if (title.includes('operac') || title.includes('logist')) {
    scores.vision = 8;
    explanations.vision = "Área operativa entiende el problema de cierre";
  } else {
    scores.vision = 5;
    explanations.vision = "Necesitará educación sobre el problema";
  }
  
  // VALUE - ROI
  const employees = company.estimated_num_employees || 100;
  if (employees > 1000) {
    scores.value = 8;
    explanations.value = `${employees} empleados = alto volumen = ROI claro`;
  } else if (employees > 500) {
    scores.value = 6;
    explanations.value = `${employees} empleados = volumen medio = ROI moderado`;
  } else {
    scores.value = 4;
    explanations.value = `${employees} empleados = volumen bajo = ROI cuestionable`;
  }
  
  // CONTROL - Quién maneja el proceso
  if (enrichment?.enrichmentData?.buyingSignals?.length > 0) {
    scores.control = 8;
    explanations.control = "Están buscando, podemos guiar el proceso";
  } else {
    scores.control = 5;
    explanations.control = "Sin urgencia clara, proceso normal";
  }
  
  // COMPRAS - Complejidad CORREGIDA
  if (employees > 5000) {
    scores.compras = 3; // Empresa grande = proceso COMPLEJO = score BAJO
    explanations.compras = "Empresa grande, proceso largo con múltiples aprobaciones";
  } else if (employees > 1000) {
    scores.compras = 5;
    explanations.compras = "Empresa mediana, proceso estándar de compras";
  } else {
    scores.compras = 7; // Empresa chica = proceso SIMPLE = score ALTO
    explanations.compras = "Empresa menor, decisión más ágil";
  }
  
  const total_score = (Object.values(scores).reduce((a, b) => a + b, 0) / 6).toFixed(1);
  
  return {
    scores,
    explanations,
    total_score: parseFloat(total_score),
    reasoning: `Score ${total_score}/10. ${scores.pain >= 7 ? 'Dolor alto. ' : ''}${scores.power >= 7 ? 'Decisor identificado.' : 'Necesita acceso a decisor.'}`,
    recommended_approach: total_score >= 7 ? 'Contacto inmediato con demo' : 'Nutrir con casos de éxito',
    key_pain_points: ['eficiencia operacional', 'reducción de costos'],
    decision_timeline: scores.pain >= 7 ? 'inmediato' : '3-6 meses'
  };
}
