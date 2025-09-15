const axios = require('axios');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { person_id, email } = req.body;
    const apiKey = process.env.APOLLO_API_KEY;
    
    if (!apiKey) {
      return res.status(500).json({ error: 'API key not configured' });
    }

    // Apollo people/enrich endpoint
    const response = await axios({
      method: 'POST',
      url: 'https://api.apollo.io/v1/people/enrich',
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json'
      },
      data: {
        id: person_id,  // Si tenemos el ID de Apollo
        email: email,   // O buscar por email
        reveal_personal_emails: true,
        reveal_phone_numbers: true
      },
      timeout: 10000
    });

    console.log('Apollo enrich response:', response.data);

    res.status(200).json({
      success: true,
      person: response.data.person || response.data
    });

  } catch (error) {
    console.error('Apollo enrich error:', error.message);
    res.status(200).json({ 
      success: false,
      error: error.message 
    });
  }
};
