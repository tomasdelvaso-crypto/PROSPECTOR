const axios = require('axios');
const apolloCache = require('./_apollo-cache');

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

                const enrichPayload = {
                    person_id: person.id,
                    reveal_personal_emails: true,
                    reveal_phone_numbers: true
                };

                // Try cache first
                const cachedEnrich = await apolloCache.tryGet('people/enrich', enrichPayload);
                if (cachedEnrich.hit && cachedEnrich.data?.person) {
                    console.log('Enrich cache hit, email:', cachedEnrich.data.person.email);
                    return res.status(200).json({
                        success: true,
                        enriched: true,
                        person: cachedEnrich.data.person,
                        source: 'apollo_enrich_cache'
                    });
                }

                const enrichResponse = await axios.post(
                    `https://api.apollo.io/v1/people/enrich`,
                    enrichPayload,
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

                    // Cache only successful enrich results
                    await apolloCache.set(
                        cachedEnrich.cacheKey,
                        'people/enrich',
                        cachedEnrich.normalized,
                        enrichResponse.data,
                        null
                    );

                    return res.status(200).json({
                        success: true,
                        enriched: true,
                        person: enrichResponse.data.person,
                        source: 'apollo_enrich'
                    });
                }
            } catch (enrichError) {
                console.log('Enrich failed, trying match:', enrichError.message);
                // NO cachear errores — caer al match
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

        // Try cache first
        const cachedMatch = await apolloCache.tryGet('people/match', matchPayload);
        if (cachedMatch.hit && cachedMatch.data?.person) {
            console.log('Match cache hit, email:', cachedMatch.data.person.email);
            return res.status(200).json({
                success: true,
                enriched: true,
                person: cachedMatch.data.person,
                source: 'apollo_match_cache'
            });
        }

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

            // Cache only successful match results
            await apolloCache.set(
                cachedMatch.cacheKey,
                'people/match',
                cachedMatch.normalized,
                matchResponse.data,
                null
            );

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
