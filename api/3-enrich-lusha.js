const axios = require('axios');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        // El frontend envía un objeto 'person' y opcionalmente 'company'
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
        
        // Construir parámetros para Lusha
        const params = {};
        
        if (linkedinUrl) params.linkedinUrl = linkedinUrl;
        if (firstName) params.firstName = firstName;
        if (lastName) params.lastName = lastName;
        if (companyName) params.companyName = companyName;
        if (domain) params.companyDomain = domain;
        
        // CRÍTICO: Deben ser strings "true", no booleanos
        params.revealPhones = "true";
        params.revealEmails = "true";
        
        console.log('Lusha API params:', params);
        
        const response = await axios({
            method: 'GET',
            url: 'https://api.lusha.com/v2/person',
            headers: {
                'api_key': apiKey,
                'Content-Type': 'application/json'
            },
            params: params
        });
        
        console.log('Lusha response status:', response.status);
        console.log('Credit charged:', response.data?.isCreditCharged);
        
        // ESTRUCTURA CORRECTA: Los datos vienen en response.data.data
        if (response.data && response.data.data) {
            const personData = response.data.data;
            
            // Procesar teléfonos
            const phones = [];
            if (personData.phoneNumbers && Array.isArray(personData.phoneNumbers)) {
                personData.phoneNumbers.forEach(phone => {
                    if (phone && phone.number) {
                        phones.push({
                            number: phone.number,
                            type: phone.phoneType || 'unknown',
                            doNotCall: phone.doNotCall || false,
                            updateDate: phone.updateDate,
                            source: 'Lusha'
                        });
                    }
                });
                console.log(`✅ Found ${phones.length} phone(s)`);
            }
            
            // Procesar emails
            const emails = [];
            if (personData.emailAddresses && Array.isArray(personData.emailAddresses)) {
                personData.emailAddresses.forEach(email => {
                    if (email && email.email) {
                        emails.push(email.email);
                    }
                });
                console.log(`✅ Found ${emails.length} email(s)`);
            }
            
            // Seleccionar el mejor teléfono (prioridad: mobile > direct > work > cualquier otro)
            let bestPhone = null;
            let bestPhoneType = null;
            
            if (phones.length > 0) {
                const mobilePhone = phones.find(p => p.type === 'mobile');
                const directPhone = phones.find(p => p.type === 'direct');
                const workPhone = phones.find(p => p.type === 'work');
                
                if (mobilePhone) {
                    bestPhone = mobilePhone.number;
                    bestPhoneType = 'mobile';
                } else if (directPhone) {
                    bestPhone = directPhone.number;
                    bestPhoneType = 'direct';
                } else if (workPhone) {
                    bestPhone = workPhone.number;
                    bestPhoneType = 'work';
                } else {
                    bestPhone = phones[0].number;
                    bestPhoneType = phones[0].type;
                }
                
                console.log(`📱 Best phone: ${bestPhone} (${bestPhoneType})`);
            }
            
            // Devolver respuesta limpia y consistente
            return res.status(200).json({
                success: true,
                enriched: true,
                source: 'lusha',
                phone: bestPhone,
                phone_type: bestPhoneType,
                email: emails[0] || null,
                all_phones: phones,
                full_name: personData.fullName || `${firstName} ${lastName}`.trim(),
                credit_charged: response.data.isCreditCharged || false,
                // Datos adicionales útiles
                location: personData.location || null,
                title: personData.jobTitle?.title || null,
                company_name: personData.company?.name || companyName
            });
        }
        
        // Si no hay datos en la estructura esperada
        console.log('❌ No data found in expected structure');
        console.log('Response structure:', JSON.stringify(response.data, null, 2));
        
        return res.status(200).json({
            success: false,
            enriched: false,
            message: 'No data found in Lusha response',
            debug_response: response.data
        });
        
    } catch (error) {
        console.error('❌ Lusha API error:', error.message);
        
        // Manejo específico de errores
        if (error.response?.status === 404) {
            return res.status(200).json({ 
                success: false,
                enriched: false,
                message: 'Person not found in Lusha database'
            });
        }
        
        if (error.response?.status === 403) {
            return res.status(200).json({ 
                success: false,
                enriched: false,
                error: 'Plan restriction',
                message: 'Your Lusha plan may not support revealing phones/emails via API'
            });
        }
        
        if (error.response?.status === 429) {
            return res.status(200).json({ 
                success: false,
                enriched: false,
                error: 'Rate limit exceeded',
                retry_after: error.response?.headers?.['retry-after'] || '60 seconds'
            });
        }
        
        // Error genérico
        return res.status(200).json({ 
            success: false,
            enriched: false,
            error: error.message,
            status: error.response?.status,
            details: error.response?.data
        });
    }
};
