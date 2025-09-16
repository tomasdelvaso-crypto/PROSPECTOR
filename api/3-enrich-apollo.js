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

        // OPCIÓN 1: Usar el endpoint de people/enrich con el ID
        if (person.id) {
            try {
                console.log('Trying Apollo enrich with ID:', person.id);
                
                const enrichResponse = await axios.post(
                    `https://api.apollo.io/v1/people/enrich`,
                    {
                        person_id: person.id,  // Usar person_id en lugar de solo id
                        reveal_personal_emails: true,
                        reveal_phone_numbers: true
                    },
                    {
                        headers: {
                            'X-Api-Key': apiKey,
                            'Content-Type': 'application/json'
                        },
                        timeout: 15000
                    }
                );

                if (enrichResponse.data?.person) {
                    console.log('Enrich successful, email:', enrichResponse.data.person.email);
                    return res.status(200).json({
                        success: true,
                        enriched: true,
                        person: enrichResponse.data.person,
                        source: 'apollo_enrich'
                    });
                }
            } catch (enrichError) {
                console.log('Enrich failed, trying match:', enrichError.message);
            }
        }

        // OPCIÓN 2: Usar people/match si enrich falla
        const matchPayload = {
            first_name: person.first_name || person.name?.split(' ')[0],
            last_name: person.last_name || person.name?.split(' ').slice(1).join(' '),
            organization_name: person.organization?.name || person.company_name,
            reveal_personal_emails: true,
            reveal_phone_numbers: true
        };

        // Agregar LinkedIn si está disponible
        if (person.linkedin_url) {
            matchPayload.linkedin_url = person.linkedin_url;
        }

        console.log('Trying Apollo match with:', matchPayload);

        const matchResponse = await axios.post(
            'https://api.apollo.io/v1/people/match',
            matchPayload,
            {
                headers: {
                    'X-Api-Key': apiKey,
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            }
        );

        if (matchResponse.data?.person) {
            console.log('Match successful, email:', matchResponse.data.person.email);
            return res.status(200).json({
                success: true,
                enriched: true,
                person: matchResponse.data.person,
                source: 'apollo_match'
            });
        }

        // Si no hay match, devolver los datos originales
        return res.status(200).json({
            success: false,
            enriched: false,
            person: person,
            message: 'No match found in Apollo'
        });

    } catch (error) {
        console.error('Apollo error:', error.response?.data || error.message);
        
        return res.status(200).json({
            success: false,
            enriched: false,
            person: req.body.person,
            error: 'Apollo enrichment failed',
            details: error.response?.data?.error || error.message
        });
    }
};
