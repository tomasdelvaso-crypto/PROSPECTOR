const axios = require('axios');

module.exports = async (req, res) => {
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
        
        // Extraer los campos necesarios del objeto person
        const firstName = person?.first_name || person?.firstName;
        const lastName = person?.last_name || person?.lastName;
        const companyName = company || person?.organization?.name;
        const domain = person?.organization?.primary_domain;
        const linkedinUrl = person?.linkedin_url;
        
        console.log('Lusha request:', { firstName, lastName, companyName, domain, linkedinUrl });
        
        // Construir parámetros
        const params = {};
        
        if (linkedinUrl) params.linkedinUrl = linkedinUrl;
        if (firstName) params.firstName = firstName;
        if (lastName) params.lastName = lastName;
        if (companyName) params.companyName = companyName;
        if (domain) params.companyDomain = domain;
        
        // IMPORTANTE: Debe ser string "true", no booleano
        params.revealPhones = "true";
        params.revealEmails = "true";
        
        console.log('Lusha params:', params);
        
        const response = await axios({
            method: 'GET',
            url: 'https://api.lusha.com/v2/person',
            headers: {
                'api_key': apiKey,
                'Content-Type': 'application/json'
            },
            params: params
        });
        
        console.log('Lusha response received, isCreditCharged:', response.data?.isCreditCharged);
        
        // LA ESTRUCTURA CORRECTA ES response.data.data
        if (response.data && response.data.data) {
            const personData = response.data.data;
            
            // Procesar teléfonos - ESTÁN EN personData.phoneNumbers
            const phones = [];
            if (personData.phoneNumbers && Array.isArray(personData.phoneNumbers)) {
                personData.phoneNumbers.forEach(phone => {
                    if (phone && phone.number) {
                        phones.push({
                            number: phone.number,
                            type: phone.phoneType || 'unknown',
                            doNotCall: phone.doNotCall,
                            source: 'Lusha'
                        });
                    }
                });
            }
            
            // Procesar emails - ESTÁN EN personData.emailAddresses
            const emails = [];
            if (personData.emailAddresses && Array.isArray(personData.emailAddresses)) {
                personData.emailAddresses.forEach(email => {
                    if (email && email.email) {
                        emails.push(email.email);
                    }
                });
            }
            
            console.log('✅ Phones found:', phones);
            console.log('✅ Emails found:', emails);
            console.log('💳 Credits charged:', response.data.isCreditCharged);
            
            // Seleccionar mejor teléfono (priorizar móvil)
            const bestPhone = phones.find(p => p.type === 'mobile') || phones[0];
            
            return res.status(200).json({
                success: true,
                enriched: true,
                source: 'lusha',
                phone: bestPhone?.number || null,
                phone_type: bestPhone?.type || null,
                email: emails[0] || null,
                all_phones: phones,
                full_name: personData.fullName || `${firstName} ${lastName}`.trim(),
                credit_charged: response.data.isCreditCharged
            });
        }
        
        return res.status(200).json({
            success: false,
            enriched: false,
            message: 'No data found in expected structure',
            debug_response: response.data
        });
        
    } catch (error) {
        console.error('❌ Lusha error:', error.message);
        
        if (error.response?.status === 404) {
            return res.status(200).json({ 
                success: false,
                enriched: false,
                message: 'Person not found in Lusha'
            });
        }
        
        if (error.response?.status === 429) {
            return res.status(200).json({ 
                success: false,
                enriched: false,
                error: 'Rate limit exceeded',
                retry_after: error.response?.headers?.['retry-after']
            });
        }
        
        return res.status(200).json({ 
            success: false,
            enriched: false,
            error: error.message,
            status: error.response?.status
        });
    }
};
