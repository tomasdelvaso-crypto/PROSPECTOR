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

        // Build Lusha query parameters
        const params = {
            property: 'person' // Required for v2 API
        };

        // Add name parameters
        if (person.first_name) {
            params.firstName = person.first_name;
        } else if (person.name) {
            const nameParts = person.name.split(' ');
            params.firstName = nameParts[0];
            params.lastName = nameParts.slice(1).join(' ');
        }

        if (person.last_name) {
            params.lastName = person.last_name;
        }

        // Add company information
        if (company) {
            params.companyName = company;
        } else if (person.organization?.name) {
            params.companyName = person.organization.name;
        } else if (person.company_name) {
            params.companyName = person.company_name;
        }

        // Add LinkedIn URL if available (most important for Lusha)
        if (person.linkedin_url) {
            params.linkedinUrl = person.linkedin_url;
        }

        console.log('Lusha request params:', params);

        const response = await axios.get(
            'https://api.lusha.com/v2/person',
            {
                headers: { 
                    'api_key': apiKey,
                    'Content-Type': 'application/json'
                },
                params: params,
                timeout: 15000
            }
        );

        const lushaData = response.data?.data;

        if (lushaData) {
            // Extract phone numbers
            const phoneNumbers = lushaData.phoneNumbers || [];
            const directPhone = phoneNumbers.find(p => p.phoneType === 'direct');
            const mobilePhone = phoneNumbers.find(p => p.phoneType === 'mobile');
            const workPhone = phoneNumbers.find(p => p.phoneType === 'work');
            
            // Get the best available phone
            const bestPhone = directPhone || mobilePhone || workPhone || phoneNumbers[0];

            res.status(200).json({
                success: true,
                enriched: true,
                source: 'lusha',
                phone: bestPhone?.internationalNumber || null,
                phone_type: bestPhone?.phoneType || null,
                all_phones: phoneNumbers.map(p => ({
                    number: p.internationalNumber,
                    type: p.phoneType,
                    countryCode: p.countryCode
                })),
                email: lushaData.emailAddress || null,
                full_name: lushaData.fullName,
                company: lushaData.company?.name
            });
        } else {
            res.status(200).json({ 
                success: false,
                enriched: false,
                message: 'No data found in Lusha' 
            });
        }

    } catch (error) {
        console.error('Lusha error:', error.response?.data || error.message);
        
        res.status(200).json({
            success: false,
            enriched: false,
            error: 'Lusha enrichment failed',
            details: error.response?.data?.message || error.message
        });
    }
};
