module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { company, contact } = req.body;

  try {
    // Por ahora, retornamos un análisis mock
    // Después podés integrar Claude API acá
    const mockAnalysis = {
      scores: {
        pain: Math.floor(Math.random() * 5) + 5,
        power: contact.title?.includes('Gerente') ? 7 : 5,
        vision: Math.floor(Math.random() * 5) + 3,
        value: Math.floor(Math.random() * 5) + 4,
        control: Math.floor(Math.random() * 5) + 3,
        compras: Math.floor(Math.random() * 5) + 2
      },
      total_score: 0,
      reasoning: `${contact.name} en ${company.name || 'la empresa'} podría beneficiarse de soluciones de empaque automatizado debido a su rol en ${contact.title}.`,
      recommended_approach: "Contacto inicial por email presentando caso de éxito similar en su industria."
    };
    
    mockAnalysis.total_score = Object.values(mockAnalysis.scores).reduce((a, b) => a + b, 0) / 6;
    mockAnalysis.total_score = mockAnalysis.total_score.toFixed(1);

    res.status(200).json(mockAnalysis);
  } catch (error) {
    console.error('Error en análisis:', error);
    res.status(500).json({ error: 'Error analyzing prospect' });
  }
};
