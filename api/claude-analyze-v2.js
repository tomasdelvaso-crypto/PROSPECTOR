const Anthropic = require('@anthropic-ai/sdk');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { contact, company, enrichment_data } = req.body;
  
  // Si no hay Claude API, usar análisis basado en reglas
  if (!process.env.CLAUDE_API_KEY) {
    const rulesAnalysis = analyzeWithRules(contact, company, enrichment_data);
    return res.status(200).json(rulesAnalysis);
  }

  try {
    const anthropic = new Anthropic({
      apiKey: process.env.CLAUDE_API_KEY,
    });

    const prompt = `
    Analiza este prospecto para Ventapel Brasil (solución de cierre de cajas).
    
    EMPRESA: ${company?.name || 'No identificada'}
    - Industria: ${company?.industry || 'No especificada'}
    - Empleados: ${company?.estimated_num_employees || 'Desconocido'}
    - Ubicación: ${company?.location || 'Brasil'}
    
    CONTACTO: ${contact?.name} - ${contact?.title}
    - Email: ${contact?.email || 'No disponible'}
    - Teléfono: ${contact?.phone || 'No disponible'}
    
    INTELIGENCIA:
    - Centros distribución: ${enrichment_data?.serper?.distribution_centers?.length || 0}
    - Volumen: ${enrichment_data?.serper?.production_volume || 'Desconocido'}
    - Problemas: ${enrichment_data?.serper?.problems?.length || 0}
    
    CONTEXTO VENTAPEL:
    - Máquinas BP555/BP755: inversión $50k-200k USD
    - Cinta VENOM: consumible recurrente
    - ROI típico: 6-12 meses
    - Beneficios: 100% inviolabilidad, 27% más velocidad
    
    ESTIMAR cajas por día basado en empleados e industria.
    
    Evaluar PPVVC (0-10 cada uno):
    PAIN: ¿Dolor relacionado con cierre de cajas?
    POWER: ¿Puede aprobar $50-200k?
    VISION: ¿Entenderá el valor?
    VALUE: ¿ROI claro?
    CONTROL: ¿Podemos liderar?
    COMPRAS: ¿Proceso simple o complejo?
    
    Responder JSON:
    {
      "estimated_boxes_per_day": "número",
      "scores": {
        "pain": X,
        "power": X,
        "vision": X,
        "value": X,
        "control": X,
        "compras": X
      },
      "total_score": X.X,
      "key_insight": "insight en 30 palabras",
      "qualification": "HOT/WARM/COLD"
    }
    `;

    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 500,
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
    
    return res.status(200).json(analysis);

  } catch (error) {
    console.error('Claude error:', error);
    const rulesAnalysis = analyzeWithRules(contact, company, enrichment_data);
    return res.status(200).json(rulesAnalysis);
  }
};

function analyzeWithRules(contact, company, enrichment_data) {
  const employees = company?.estimated_num_employees || 100;
  const industry = (company?.industry || '').toLowerCase();
  const title = (contact?.title || '').toLowerCase();
  
  // Estimar cajas
  let boxesPerDay = Math.round(employees / 10);
  if (industry.includes('ecommerce') || industry.includes('fulfillment')) {
    boxesPerDay *= 3;
  } else if (industry.includes('food') || industry.includes('pharmaceutical')) {
    boxesPerDay *= 2;
  }
  
  const scores = {
    pain: enrichment_data?.serper?.problems?.length > 0 ? 8 : boxesPerDay > 500 ? 7 : 5,
    power: title.includes('director') || title.includes('coo') ? 9 : title.includes('manager') ? 6 : 3,
    vision: title.includes('operation') || title.includes('logistic') ? 8 : 5,
    value: boxesPerDay > 1000 ? 9 : boxesPerDay > 500 ? 7 : 4,
    control: enrichment_data?.serper?.problems?.length > 0 ? 7 : 5,
    compras: employees > 5000 ? 3 : employees > 1000 ? 5 : 7
  };
  
  const total_score = parseFloat((Object.values(scores).reduce((a, b) => a + b, 0) / 6).toFixed(1));
  
  return {
    estimated_boxes_per_day: boxesPerDay > 1000 ? `${Math.round(boxesPerDay/1000)}k` : boxesPerDay.toString(),
    scores,
    total_score,
    key_insight: boxesPerDay > 500 ? 
      `Volume alto de ${boxesPerDay} caixas/dia justifica investimento` : 
      `Volume moderado, focar em problemas específicos`,
    qualification: total_score >= 7 ? 'HOT' : total_score >= 5 ? 'WARM' : 'COLD'
  };
}
