const axios = require('axios');

module.exports = async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const { person } = req.body;
        
        if (!person) {
            return res.status(400).json({ 
                success: false,
                error: 'Person data is required' 
            });
        }

        const apiKey = process.env.APOLLO_API_KEY;
        
        if (!apiKey) {
            return res.status(200).json({ 
                success: false,
                message: 'Apollo API key not configured',
                person: person 
            });
        }

        // Try to match the person using available data
        const matchPayload = {
            first_name: person.first_name || person.name?.split(' ')[0],
            last_name: person.last_name || person.name?.split(' ').slice(1).join(' '),
            organization_name: person.organization?.name || person.company_name,
            reveal_personal_emails: true,
            reveal_phone_numbers: true
        };

        // Add LinkedIn if available
        if (person.linkedin_url) {
            matchPayload.linkedin_url = person.linkedin_url;
        }

        // Add email if available for better matching
        if (person.email) {
            matchPayload.email = person.email;
        }

        console.log('Apollo match request:', JSON.stringify(matchPayload, null, 2));

        const response = await axios.post(
            'https://api.apollo.io/v1/people/match',
            matchPayload,
            {
                headers: {
                    'X-Api-Key': apiKey,
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache'
                },
                timeout: 15000
            }
        );

        if (response.data?.person) {
            res.status(200).json({
                success: true,
                enriched: true,
                person: response.data.person,
                source: 'apollo_match'
            });
        } else {
            res.status(200).json({
                success: false,
                enriched: false,
                person: person,
                message: 'No match found in Apollo'
            });
        }

    } catch (error) {
        console.error('Apollo enrich error:', error.response?.data || error.message);
        
        // Return original person data even if enrichment fails
        res.status(200).json({
            success: false,
            enriched: false,
            person: req.body.person,
            error: 'Apollo enrichment failed',
            details: error.response?.data?.error || error.message
        });
    }
};
