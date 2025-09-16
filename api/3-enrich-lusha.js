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
            revealPhones: "true",
            revealEmails: "true"
        };

        // Prioridad: LinkedIn > Email > Nombre+Empresa
        if (person.linkedin_url) {
            let linkedinUrl = person.linkedin_url.trim();
            if (!linkedinUrl.startsWith('http')) {
                linkedinUrl = 'https://' + linkedinUrl;
            }
            linkedinUrl = linkedinUrl.replace(/\/$/, '');
            params.linkedinUrl = linkedinUrl;
            console.log('Using LinkedIn URL for Lusha:', linkedinUrl);
        } else if (person.email) {
            params.email = person.email;
            console.log('Using email for Lusha:', person.email);
        } else if (person.first_name && person.last_name) {
            params.firstName = person.first_name;
            params.lastName = person.last_name;
            
            if (person.organization?.primary_domain) {
                params.companyDomain = person.organization.primary_domain
                    .replace(/^https?:\/\//, '')
                    .replace(/^www\./, '')
                    .split('/')[0];
                console.log('Using name + domain:', params.firstName, params.lastName, params.companyDomain);
            } else if (person.organization?.name || company) {
                params.companyName = person.organization?.name || company;
                console.log('Using name + company:', params.firstName, params.lastName, params.companyName);
            }
        } else {
            return res.status(200).json({ 
                success: false,
                enriched: false,
                message: 'Insufficient data for Lusha lookup' 
            });
        }

        console.log('Calling Lusha API with params:', JSON.stringify(params));
        
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

        console.log('Lusha API Response Status:', response.status);
        
        // IMPORTANTE: La estructura real de la respuesta es diferente
        // Los datos vienen en response.data.data O response.data.rawData.data
        let lushaData = null;
        
        // Intentar múltiples paths para encontrar los datos
        if (response.data?.data) {
            lushaData = response.data.data;
            console.log('Found data in response.data.data');
        } else if (response.data?.rawData?.data) {
            lushaData = response.data.rawData.data;
            console.log('Found data in response.data.rawData.data');
        } else if (response.data) {
            // A veces viene directamente en response.data
            lushaData = response.data;
            console.log('Using response.data directly');
        }
        
        if (!lushaData) {
            console.log('No data found in Lusha response');
            console.log('Full response structure:', JSON.stringify(response.data, null, 2));
            return res.status(200).json({ 
                success: false,
                enriched: false,
                message: 'No data found in Lusha response',
                debug_response: response.data
            });
        }

        // Extraer teléfonos
        const phoneNumbers = lushaData.phoneNumbers || [];
        console.log(`Found ${phoneNumbers.length} phone numbers`);
        
        let bestPhone = null;
        let phoneType = null;
        
        if (phoneNumbers.length > 0) {
            // Loguear todos los teléfonos encontrados
            phoneNumbers.forEach((phone, idx) => {
                console.log(`Phone ${idx + 1}: ${phone.number} (${phone.phoneType})`);
            });
            
            // Priorizar: móvil > directo > cualquier otro
            const mobilePhone = phoneNumbers.find(p => p.phoneType === 'mobile');
            const directPhone = phoneNumbers.find(p => p.phoneType === 'direct');
            const anyPhone = phoneNumbers[0];
            
            if (mobilePhone) {
                bestPhone = mobilePhone.number;
                phoneType = 'mobile';
            } else if (directPhone) {
                bestPhone = directPhone.number;
                phoneType = 'direct';
            } else if (anyPhone) {
                bestPhone = anyPhone.number;
                phoneType = anyPhone.phoneType || 'unknown';
            }
            
            console.log(`Best phone selected: ${bestPhone} (${phoneType})`);
        }

        // Extraer emails
        const emailAddresses = lushaData.emailAddresses || [];
        const bestEmail = emailAddresses.length > 0 
            ? (emailAddresses[0].email || emailAddresses[0]) 
            : null;
        
        if (bestEmail) {
            console.log(`Email found: ${bestEmail}`);
        }

        // Verificar si se cobró crédito
        const creditCharged = response.data?.isCreditCharged || 
                            response.data?.rawData?.isCreditCharged || 
                            false;

        // Construir respuesta limpia
        const result = {
            success: true,
            enriched: true,
            source: 'lusha',
            phone: bestPhone,
            phone_type: phoneType,
            email: bestEmail,
            full_name: lushaData.fullName || lushaData.firstName && lushaData.lastName 
                ? `${lushaData.firstName} ${lushaData.lastName}` 
                : `${person.first_name || ''} ${person.last_name || ''}`.trim(),
            all_phones: phoneNumbers.map(p => ({
                number: p.number,
                type: p.phoneType,
                doNotCall: p.doNotCall || false,
                updateDate: p.updateDate
            })),
            credit_charged: creditCharged,
            lusha_person_id: lushaData.personId || null
        };

        console.log('Lusha enrichment successful');
        console.log('Result:', JSON.stringify(result, null, 2));
        
        res.status(200).json(result);

    } catch (error) {
        console.error('Lusha API error:', error.response?.data || error.message);
        
        if (error.response?.status === 403) {
            return res.status(200).json({ 
                success: false,
                enriched: false,
                error: 'Plan restriction',
                message: 'Your Lusha plan may not support revealing phones/emails via API'
            });
        }

        if (error.response?.status === 404) {
            return res.status(200).json({ 
                success: false,
                enriched: false,
                message: 'Person not found in Lusha database'
            });
        }

        if (error.response?.status === 429) {
            return res.status(200).json({ 
                success: false,
                enriched: false,
                error: 'Lusha API rate limit exceeded',
                retry_after: error.response?.headers?.['retry-after'] || '60 seconds'
            });
        }

        return res.status(200).json({
            success: false,
            enriched: false,
            error: 'Lusha enrichment failed',
            details: error.response?.data || error.message
        });
    }
};
