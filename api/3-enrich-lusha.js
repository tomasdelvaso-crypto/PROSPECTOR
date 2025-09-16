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
        
        // Extraer campos
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
        
        // BUSCAR DATOS EN LA ESTRUCTURA CORRECTA: response.data.contact.data
        let personData = null;
        let creditCharged = false;
        
        // Opción 1: response.data.contact.data (estructura que vemos en tu log)
        if (response.data?.contact?.data) {
            personData = response.data.contact.data;
            creditCharged = response.data.contact.isCreditCharged || false;
            console.log('✅ Found data at response.data.contact.data');
        }
        // Opción 2: response.data.data (otra estructura posible)
        else if (response.data?.data) {
            personData = response.data.data;
            creditCharged = response.data.isCreditCharged || false;
            console.log('✅ Found data at response.data.data');
        }
        // Opción 3: directamente en response.data
        else if (response.data && response.data.phoneNumbers) {
            personData = response.data;
            creditCharged = response.data.isCreditCharged || false;
            console.log('✅ Found data at response.data');
        }
        
        if (personData) {
            // Procesar teléfonos
            const phones = [];
            if (personData.phoneNumbers && Array.isArray(personData.phoneNumbers)) {
                personData.phoneNumbers.forEach(phone => {
                    if (phone && phone.number) {
                        phones.push({
                            number: phone.number,
                            type: phone.phoneType || 'unknown',
                            doNotCall: phone.doNotCall || false,
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
            
            // Seleccionar mejor teléfono
            let bestPhone = null;
            let bestPhoneType = null;
            
            if (phones.length > 0) {
                const mobilePhone = phones.find(p => p.type === 'mobile');
                const directPhone = phones.find(p => p.type === 'direct');
                
                if (mobilePhone) {
                    bestPhone = mobilePhone.number;
                    bestPhoneType = 'mobile';
                } else if (directPhone) {
                    bestPhone = directPhone.number;
                    bestPhoneType = 'direct';
                } else {
                    bestPhone = phones[0].number;
                    bestPhoneType = phones[0].type;
                }
                
                console.log(`📱 Best phone: ${bestPhone} (${bestPhoneType})`);
            }
            
            console.log(`💳 Credit charged: ${creditCharged}`);
            
            return res.status(200).json({
                success: true,
                enriched: true,
                source: 'lusha',
                phone: bestPhone,
                phone_type: bestPhoneType,
                email: emails[0] || null,
                all_phones: phones,
                full_name: personData.fullName || `${firstName} ${lastName}`.trim(),
                credit_charged: creditCharged
            });
        }
        
        // No se encontraron datos
        console.log('❌ No data found in expected structure');
        console.log('Response structure:', JSON.stringify(response.data, null, 2));
        
        return res.status(200).json({
            success: false,
            enriched: false,
            message: 'No data found in Lusha response'
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
        
        return res.status(200).json({ 
            success: false,
            enriched: false,
            error: error.message,
            status: error.response?.status
        });
    }
};
