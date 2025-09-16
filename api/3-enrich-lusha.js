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
        const { person, company } = req.body;
        const apiKey = process.env.LUSHA_API_KEY;

        if (!apiKey) {
            return res.status(200).json({ 
                success: false,
                enriched: false,
                message: 'Lusha API key not configured' 
            });
        }

        if (!person) {
            return res.status(400).json({ 
                success: false,
                error: 'Person data is required' 
            });
        }

        // Construir parámetros para el endpoint GET /v2/person
        const params = {
            revealPhones: "true",  // Crítico: debe ser string "true", no booleano
            revealEmails: "true"   // Crítico: debe ser string "true", no booleano
        };

        // Prioridad 1: Si tenemos LinkedIn URL
        if (person.linkedin_url) {
            params.linkedinUrl = person.linkedin_url;
            console.log('Using LinkedIn URL for Lusha lookup:', person.linkedin_url);
        } 
        // Prioridad 2: Si tenemos email
        else if (person.email) {
            params.email = person.email;
            console.log('Using email for Lusha lookup:', person.email);
        } 
        // Prioridad 3: Buscar por nombre + empresa
        else if (person.first_name && person.last_name) {
            params.firstName = person.first_name;
            params.lastName = person.last_name;
            
            // Intentar con domain primero, luego con nombre de empresa
            if (person.organization?.primary_domain) {
                params.companyDomain = person.organization.primary_domain.replace(/^https?:\/\//, '').split('/')[0];
                console.log('Using name + domain for Lusha lookup:', params.firstName, params.lastName, params.companyDomain);
            } else if (person.organization?.name || company) {
                params.companyName = person.organization?.name || company;
                console.log('Using name + company for Lusha lookup:', params.firstName, params.lastName, params.companyName);
            }
        } else {
            return res.status(200).json({ 
                success: false,
                enriched: false,
                message: 'Insufficient data for Lusha lookup (need LinkedIn URL, email, or full name)' 
            });
        }

        // Hacer la petición GET a Lusha Person Enrichment API
        console.log('Calling Lusha API with params:', params);
        
        const response = await axios.get(
            'https://api.lusha.com/v2/person',
            {
                headers: { 
                    'api_key': apiKey,
                    'Accept': 'application/json'
                },
                params: params,
                timeout: 15000
            }
        );

        // La respuesta viene en response.data.data
        const lushaData = response.data?.data;
        
        if (!lushaData) {
            console.log('No data returned from Lusha');
            return res.status(200).json({ 
                success: false,
                enriched: false,
                message: 'No data found in Lusha',
                tried: Object.keys(params).filter(k => k !== 'revealPhones' && k !== 'revealEmails')
            });
        }

        console.log('Lusha returned data. Processing phone numbers...');
        
        // Extraer teléfonos
        const phoneNumbers = lushaData.phoneNumbers || [];
        
        // Priorizar: móvil > directo > otros
        let bestPhone = null;
        let phoneType = null;
        
        if (phoneNumbers.length > 0) {
            const mobilePhone = phoneNumbers.find(p => p.phoneType === 'mobile');
            const directPhone = phoneNumbers.find(p => p.phoneType === 'direct');
            const anyPhone = phoneNumbers[0];
            
            if (mobilePhone) {
                bestPhone = mobilePhone.internationalNumber || mobilePhone.number;
                phoneType = 'mobile';
            } else if (directPhone) {
                bestPhone = directPhone.internationalNumber || directPhone.number;
                phoneType = 'direct';
            } else if (anyPhone) {
                bestPhone = anyPhone.internationalNumber || anyPhone.number;
                phoneType = anyPhone.phoneType || 'unknown';
            }
            
            console.log(`Found ${phoneNumbers.length} phone(s). Best phone: ${bestPhone} (${phoneType})`);
        }

        // Extraer email
        const emails = lushaData.emailAddresses || [];
        const bestEmail = emails.length > 0 ? emails[0] : (lushaData.email || null);

        // Construir respuesta limpia
        const result = {
            success: true,
            enriched: true,
            source: 'lusha',
            phone: bestPhone,
            phone_type: phoneType,
            email: bestEmail,
            full_name: lushaData.fullName || `${person.first_name || ''} ${person.last_name || ''}`.trim(),
            all_phones: phoneNumbers.map(p => ({
                number: p.internationalNumber || p.number,
                type: p.phoneType,
                country: p.countryCode
            }))
        };

        console.log('Lusha enrichment successful. Returning result.');
        res.status(200).json(result);

    } catch (error) {
        console.error('Lusha API error:', error.response?.data || error.message);
        
        // Log específico si es un error 404 (persona no encontrada)
        if (error.response?.status === 404) {
            return res.status(200).json({ 
                success: false,
                enriched: false,
                message: 'Person not found in Lusha database',
                tried: req.body.person?.linkedin_url || req.body.person?.email || 'name search'
            });
        }

        // Log específico si es un error de límite de rate
        if (error.response?.status === 429) {
            return res.status(200).json({ 
                success: false,
                enriched: false,
                error: 'Lusha API rate limit exceeded',
                retry_after: error.response?.headers?.['retry-after'] || '60 seconds'
            });
        }

        // Error genérico
        return res.status(200).json({
            success: false,
            enriched: false,
            error: 'Lusha enrichment failed',
            details: error.response?.data || error.message,
            status: error.response?.status
        });
    }
};
