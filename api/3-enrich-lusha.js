const axios = require('axios');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    console.log('========== LUSHA ENRICH DEBUG START ==========');
    console.log('1. REQUEST BODY:', JSON.stringify(req.body, null, 2));

    try {
        const { person, company } = req.body;
        const apiKey = process.env.LUSHA_API_KEY;
        
        console.log('2. API KEY EXISTS:', !!apiKey);
        
        if (!apiKey) {
            return res.status(200).json({ 
                success: false,
                enriched: false,
                message: 'Lusha API key not configured'
            });
        }
        
        // Extraer campos con múltiples fallbacks
        const firstName = person?.first_name || person?.firstName || null;
        const lastName = person?.last_name || person?.lastName || null;
        const companyName = company || person?.organization?.name || person?.company || null;
        const domain = person?.organization?.primary_domain || person?.organization?.website_url || null;
        const linkedinUrl = person?.linkedin_url || person?.linkedinUrl || null;
        
        console.log('3. EXTRACTED FIELDS:', {
            firstName,
            lastName,
            companyName,
            domain,
            linkedinUrl
        });
        
        // Construir parámetros
        const params = {};
        
        if (linkedinUrl) params.linkedinUrl = linkedinUrl;
        if (firstName) params.firstName = firstName;
        if (lastName) params.lastName = lastName;
        if (companyName) params.companyName = companyName;
        if (domain) {
            // Limpiar el domain
            params.companyDomain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
        }
        
        // Probar con ambos: string y booleano
        params.revealPhones = "true";  // Intentar primero como string
        params.revealEmails = "true";
        
        console.log('4. API PARAMS:', params);
        console.log('5. CALLING LUSHA API...');
        
        const response = await axios({
            method: 'GET',
            url: 'https://api.lusha.com/v2/person',
            headers: {
                'api_key': apiKey,
                'Content-Type': 'application/json'
            },
            params: params
        });
        
        console.log('6. RESPONSE STATUS:', response.status);
        console.log('7. RESPONSE HEADERS:', response.headers);
        console.log('8. FULL RESPONSE DATA:', JSON.stringify(response.data, null, 2));
        
        // Buscar datos en múltiples paths posibles
        let personData = null;
        const paths = [
            'data.data',
            'data',
            'rawData.data',
            'contact.rawData.data',
            'contact.rawData.contact.data',
            'person'
        ];
        
        console.log('9. SEARCHING FOR DATA IN PATHS...');
        for (const path of paths) {
            const parts = path.split('.');
            let current = response.data;
            
            for (const part of parts) {
                if (current && current[part]) {
                    current = current[part];
                } else {
                    current = null;
                    break;
                }
            }
            
            if (current) {
                console.log(`   ✓ Found data at path: ${path}`);
                personData = current;
                break;
            } else {
                console.log(`   ✗ No data at path: ${path}`);
            }
        }
        
        if (!personData) {
            // Último intento: usar response.data directamente
            if (response.data && (response.data.phoneNumbers || response.data.emailAddresses)) {
                console.log('   ✓ Using response.data directly');
                personData = response.data;
            }
        }
        
        console.log('10. PERSON DATA FOUND:', !!personData);
        
        if (personData) {
            console.log('11. PERSON DATA STRUCTURE:', Object.keys(personData));
            
            // Procesar teléfonos
            const phones = [];
            const phoneFields = ['phoneNumbers', 'phone_numbers', 'phones'];
            let phoneArray = null;
            
            for (const field of phoneFields) {
                if (personData[field] && Array.isArray(personData[field])) {
                    phoneArray = personData[field];
                    console.log(`12. PHONE ARRAY FOUND AT: ${field}`);
                    break;
                }
            }
            
            if (phoneArray) {
                console.log(`13. PROCESSING ${phoneArray.length} PHONES...`);
                phoneArray.forEach((phone, idx) => {
                    console.log(`    Phone ${idx + 1}:`, phone);
                    if (phone && (phone.number || phone.phoneNumber || phone.phone)) {
                        phones.push({
                            number: phone.number || phone.phoneNumber || phone.phone,
                            type: phone.phoneType || phone.type || 'unknown',
                            doNotCall: phone.doNotCall || false,
                            source: 'Lusha'
                        });
                    }
                });
            }
            
            // Procesar emails
            const emails = [];
            const emailFields = ['emailAddresses', 'email_addresses', 'emails'];
            let emailArray = null;
            
            for (const field of emailFields) {
                if (personData[field] && Array.isArray(personData[field])) {
                    emailArray = personData[field];
                    console.log(`14. EMAIL ARRAY FOUND AT: ${field}`);
                    break;
                }
            }
            
            if (emailArray) {
                console.log(`15. PROCESSING ${emailArray.length} EMAILS...`);
                emailArray.forEach((email, idx) => {
                    console.log(`    Email ${idx + 1}:`, email);
                    if (typeof email === 'string') {
                        emails.push(email);
                    } else if (email && (email.email || email.emailAddress)) {
                        emails.push(email.email || email.emailAddress);
                    }
                });
            }
            
            // Buscar email directo también
            if (personData.email) {
                emails.push(personData.email);
            }
            
            console.log('16. FINAL RESULTS:');
            console.log(`    - Phones found: ${phones.length}`);
            console.log(`    - Emails found: ${emails.length}`);
            
            // Seleccionar mejor teléfono
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
                
                console.log(`17. BEST PHONE: ${bestPhone} (${bestPhoneType})`);
            }
            
            const result = {
                success: true,
                enriched: true,
                source: 'lusha',
                phone: bestPhone,
                phone_type: bestPhoneType,
                email: emails[0] || null,
                all_phones: phones,
                full_name: personData.fullName || personData.full_name || `${firstName} ${lastName}`.trim(),
                credit_charged: response.data.isCreditCharged || response.data.creditCharged || false
            };
            
            console.log('18. FINAL RESPONSE:', result);
            console.log('========== LUSHA ENRICH DEBUG END ==========');
            
            return res.status(200).json(result);
        }
        
        // No se encontraron datos
        console.log('ERROR: No person data found in any expected structure');
        console.log('========== LUSHA ENRICH DEBUG END ==========');
        
        return res.status(200).json({
            success: false,
            enriched: false,
            message: 'No data found in Lusha response',
            debug: {
                responseKeys: Object.keys(response.data),
                hasData: !!response.data.data,
                hasRawData: !!response.data.rawData,
                fullResponse: response.data
            }
        });
        
    } catch (error) {
        console.log('ERROR OCCURRED:', error.message);
        console.log('ERROR DETAILS:', error.response?.data);
        console.log('========== LUSHA ENRICH DEBUG END ==========');
        
        return res.status(200).json({ 
            success: false,
            enriched: false,
            error: error.message,
            status: error.response?.status,
            details: error.response?.data
        });
    }
};
