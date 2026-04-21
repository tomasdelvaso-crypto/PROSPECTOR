const axios = require('axios');
const lushaCache = require('./_lusha-cache');

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

        // Intentar cache primero — shared entre vendedores, TTL 30 días
        const cached = await lushaCache.tryGet(params);
        if (cached.hit) {
            const d = cached.data;

            // Normalizar al shape PROSPECTOR por si el cache vino del ProspMini.
            const all_emails = d.all_emails
                || (d.enriched_data?.emails || []).map(e => ({
                    email: typeof e === 'string' ? e : e.email,
                    type: 'work',
                    status: 'cached'
                }));
            const all_phones = d.all_phones
                || d.enriched_data?.phones_detailed
                || (d.enriched_data?.phones || []).map(p => ({
                    number: typeof p === 'string' ? p : p.number,
                    type: 'unknown',
                    source: 'Lusha_cache'
                }));

            return res.status(200).json({
                ...d,
                all_emails,
                all_phones,
                phone: all_phones[0]?.number || null,
                email: all_emails[0]?.email || null,
                from_cache: true,
                credit_charged: false  // NO quemar crédito si vino del cache
            });
        }

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
        
        // BUSCAR DATOS EN LA ESTRUCTURA CORRECTA
        let personData = null;
        let creditCharged = false;
        
        // Verificar diferentes estructuras posibles de respuesta
        if (response.data?.contact?.data) {
            personData = response.data.contact.data;
            creditCharged = response.data.contact.isCreditCharged || false;
            console.log('✅ Found data at response.data.contact.data');
        } else if (response.data?.data) {
            personData = response.data.data;
            creditCharged = response.data.isCreditCharged || false;
            console.log('✅ Found data at response.data.data');
        } else if (response.data && response.data.phoneNumbers) {
            personData = response.data;
            creditCharged = response.data.isCreditCharged || false;
            console.log('✅ Found data at response.data');
        }
        
        if (personData) {
            // PROCESAR TODOS LOS TELÉFONOS
            const phones = [];
            if (personData.phoneNumbers && Array.isArray(personData.phoneNumbers)) {
                personData.phoneNumbers.forEach(phone => {
                    if (phone && phone.number) {
                        phones.push({
                            number: phone.number,
                            type: phone.phoneType || 'unknown',
                            doNotCall: phone.doNotCall || false,
                            source: 'Lusha',
                            country: phone.countryCode || null,
                            formatted: phone.internationalNumber || phone.number
                        });
                    }
                });
                console.log(`✅ Found ${phones.length} phone(s)`);
            }
            
            // PROCESAR TODOS LOS EMAILS
            const emails = [];
            if (personData.emailAddresses && Array.isArray(personData.emailAddresses)) {
                personData.emailAddresses.forEach(email => {
                    if (email && email.email) {
                        emails.push({
                            email: email.email,
                            type: email.emailType || 'work',
                            status: email.status || 'unknown'
                        });
                    }
                });
                console.log(`✅ Found ${emails.length} email(s)`);
            }
            
            // CLASIFICAR TELÉFONOS POR PRIORIDAD
            const mobilePhones = phones.filter(p => p.type === 'mobile');
            const directPhones = phones.filter(p => p.type === 'direct');
            const workPhones = phones.filter(p => p.type === 'work' || p.type === 'company');
            const otherPhones = phones.filter(p => !['mobile', 'direct', 'work', 'company'].includes(p.type));
            
            // Seleccionar mejor teléfono principal (para compatibilidad)
            let bestPhone = null;
            let bestPhoneType = null;
            
            if (mobilePhones.length > 0) {
                bestPhone = mobilePhones[0].number;
                bestPhoneType = 'mobile';
            } else if (directPhones.length > 0) {
                bestPhone = directPhones[0].number;
                bestPhoneType = 'direct';
            } else if (workPhones.length > 0) {
                bestPhone = workPhones[0].number;
                bestPhoneType = 'work';
            } else if (otherPhones.length > 0) {
                bestPhone = otherPhones[0].number;
                bestPhoneType = otherPhones[0].type;
            }
            
            console.log(`📱 Best phone: ${bestPhone} (${bestPhoneType})`);
            console.log(`📱 Total phones found: ${phones.length}`);
            console.log(`💳 Credit charged: ${creditCharged}`);
            
            // INFORMACIÓN ADICIONAL DE LA PERSONA
            const additionalInfo = {
                full_name: personData.fullName || `${firstName} ${lastName}`.trim(),
                title: personData.title || person?.title || null,
                company: personData.company?.name || companyName || null,
                location: personData.location || null,
                social_profiles: []
            };
            
            // Agregar perfiles sociales si existen
            if (personData.linkedin) {
                additionalInfo.social_profiles.push({
                    type: 'linkedin',
                    url: personData.linkedin
                });
            }
            if (personData.twitter) {
                additionalInfo.social_profiles.push({
                    type: 'twitter',
                    url: personData.twitter
                });
            }
            
            const responsePayload = {
                success: true,
                enriched: true,
                source: 'lusha',

                // COMPATIBILIDAD: Campos anteriores
                phone: bestPhone,
                phone_type: bestPhoneType,
                email: emails[0]?.email || null,

                // DATOS COMPLETOS NUEVOS
                all_phones: phones,
                phone_summary: {
                    total: phones.length,
                    mobile: mobilePhones.length,
                    direct: directPhones.length,
                    work: workPhones.length,
                    other: otherPhones.length,
                    best_phone: bestPhone,
                    best_type: bestPhoneType
                },

                all_emails: emails,
                email_summary: {
                    total: emails.length,
                    primary: emails[0]?.email || null
                },

                person_info: additionalInfo,
                credit_charged: creditCharged,
                from_cache: false,

                // Para debug
                phones_by_type: {
                    mobile: mobilePhones,
                    direct: directPhones,
                    work: workPhones,
                    other: otherPhones
                }
            };

            // Guardar en cache — el helper filtra resultados vacíos internamente
            await lushaCache.set(cached.cacheKey, params, responsePayload, null);

            return res.status(200).json(responsePayload);
        }
        
        // No se encontraron datos
        console.log('⌛ No data found in Lusha response');
        
        return res.status(200).json({
            success: false,
            enriched: false,
            message: 'No data found in Lusha',
            all_phones: [],
            all_emails: [],
            phone_summary: {
                total: 0,
                mobile: 0,
                direct: 0,
                work: 0,
                other: 0
            }
        });
        
    } catch (error) {
        console.error('❌ Lusha error:', error.message);
        
        if (error.response?.status === 404) {
            return res.status(200).json({ 
                success: false,
                enriched: false,
                message: 'Person not found in Lusha',
                all_phones: [],
                all_emails: []
            });
        }
        
        return res.status(200).json({ 
            success: false,
            enriched: false,
            error: error.message,
            status: error.response?.status,
            all_phones: [],
            all_emails: []
        });
    }
};
