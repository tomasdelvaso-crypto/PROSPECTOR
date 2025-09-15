const Anthropic = require('@anthropic-ai/sdk');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { company, contact, enrichment } = req.body; // AÑADIR enrichment

  // Si no hay API key de Claude, usar análisis basado en reglas
  if (!process.env.CLAUDE_API_KEY) {
    const rulesBasedAnalysis = analyzeWithRules(company, contact, enrichment);
    return res.status(200).json(rulesBasedAnalysis);
  }

  try {
    const anthropic = new Anthropic({
      apiKey: process.env.CLAUDE_API_KEY,
    });

    // PROMPT MEJORADO CON CONTEXTO DE SERPER
    const prompt = `
    Analiza este prospecto para Ventapel Brasil (soluciones de cierre y empaque B2B):
    
    CONTEXTO VENTAPEL:
    - Reducción de 64% en costos de sistema de cierre
    - Solución: máquinas BP555/755 + cinta VENOM inviolable
    - Clientes actuales: Mercado Livre, Amazon, L'Oréal, Honda
    
    DATOS DEL PROSPECTO:
    Empresa: ${company.name || 'No especificada'}
    Industria: ${company.industry || 'No especificada'}
    Empleados: ${company.estimated_num_employees || 'No especificado'}
    Ubicación: ${company.headquarters_location || 'Brasil'}
    
    CONTACTO:
    Nombre: ${contact.name}
    Cargo: ${contact.title}
    Email: ${contact.email ? 'Disponible' : 'No disponible'}
    
    ${enrichment?.enriched ? `
    INTELIGENCIA DE MERCADO (SERPER):
    ${enrichment.enrichmentData?.publicProblems?.length > 0 ? 
      `- PROBLEMAS DETECTADOS: ${enrichment.enrichmentData.publicProblems.map(p => p.issue).join(', ')}` : 
      '- Sin problemas públicos detectados'}
    ${enrichment.enrichmentData?.buyingSignals?.length > 0 ? 
      '- SEÑAL DE COMPRA: Buscando activamente proveedores/soluciones' : ''}
    ${enrichment.enrichmentData?.news?.length > 0 ? 
      `- NOTICIAS: ${enrichment.enrichmentData.news[0].title}` : ''}
    Score adicional Serper: ${enrichment.additionalScore || 0}
    ` : 'Sin datos de enriquecimiento'}
    
    Evalúa PPVVC considerando TODA la información anterior:
    
    PAIN (0-10): ¿Qué tan urgente es su dolor? Considera problemas detectados por Serper
    POWER (0-10): ¿El cargo puede decidir o influenciar?
    VISION (0-10): ¿Entenderá rápidamente el valor de nuestra solución?
    VALUE (0-10): ¿El ROI justifica la inversión para su tamaño?
    CONTROL (0-10): ¿Podemos controlar el proceso de venta?
    COMPRAS (0-10): ¿Qué tan simple será el proceso de compra?
    
    Responde SOLO en JSON:
    {
      "scores": {
        "pain": [0-10],
        "power": [0-10],
        "vision": [0-10],
        "value": [0-10],
        "control": [0-10],
        "compras": [0-10]
      },
      "total_score": [promedio],
      "reasoning": "[explicación en portugués, máx 60 palabras, mencionando datos Serper si existen]",
      "recommended_approach": "[acción específica en portugués, máx 30 palabras]",
      "estimated_potential": "[bajo/medio/alto]",
      "key_pain_points": ["dolor1", "dolor2"],
      "decision_timeline": "[inmediato/3-6 meses/6-12 meses]"
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
      const cleanJson = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      analysis = JSON.parse(cleanJson);
    } catch (parseError) {
      console.error('Error parseando respuesta de Claude:', parseError);
      analysis = analyzeWithRules(company, contact, enrichment);
    }

    res.status(200).json(analysis);

  } catch (error) {
    console.error('Error con Claude API:', error);
    const rulesBasedAnalysis = analyzeWithRules(company, contact, enrichment);
    res.status(200).json(rulesBasedAnalysis);
  }
};

// Función mejorada con enrichment
function analyzeWithRules(company, contact, enrichment) {
  const scores = {
    pain: 5,
    power: 5,
    vision: 5,
    value: 5,
    control: 5,
    compras: 5
  };
  
  // AJUSTAR PAIN BASADO EN SERPER
  if (enrichment?.enriched) {
    if (enrichment.enrichmentData?.publicProblems?.length > 0) {
      scores.pain = Math.min(scores.pain + 3, 10); // Problemas detectados = más dolor
    }
    if (enrichment.enrichmentData?.buyingSignals?.length > 0) {
      scores.pain = Math.min(scores.pain + 2, 10); // Buscando soluciones = dolor activo
      scores.control = Math.min(scores.control + 2, 10); // Mejor timing
    }
  }
  
  // Resto del análisis basado en reglas...
  // [mantener el código existente]
  
  // Calcular score total
  const total_score = (Object.values(scores).reduce((a, b) => a + b, 0) / 6).toFixed(1);
  
  // Ajustar reasoning si hay datos de Serper
  let reasoning = '';
  if (enrichment?.enrichmentData?.publicProblems?.length > 0) {
    reasoning = `Problemas públicos detectados. Alta urgencia para solución Ventapel.`;
  } else if (enrichment?.enrichmentData?.buyingSignals?.length > 0) {
    reasoning = `Empresa buscando activamente proveedores. Timing perfecto.`;
  } else {
    reasoning = `Prospecto con potencial basado en industria y tamaño.`;
  }
  
  return {
    scores,
    total_score: parseFloat(total_score),
    reasoning,
    recommended_approach: scores.pain >= 7 ? 'Contactar inmediatamente con demo' : 'Nutrir con casos de éxito',
    estimated_potential: total_score >= 7 ? 'alto' : total_score >= 5 ? 'medio' : 'bajo',
    key_pain_points: ['eficiência operacional', 'redução de custos'],
    decision_timeline: scores.pain >= 7 ? 'inmediato' : '3-6 meses'
  };
}
