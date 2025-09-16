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

        // Opción 1: Si tenemos LinkedIn URL, usar el endpoint de LinkedIn
        if (person.linkedin_url) {
            try {
                console.log('Trying Lusha with LinkedIn URL:', person.linkedin_url);
                
                // Limpiar la URL de LinkedIn
                let linkedinUrl = person.linkedin_url;
                if (!linkedinUrl.startsWith('https://')) {
                    linkedinUrl = linkedinUrl.replace('http://', 'https://');
                }
                
                const linkedinResponse = await axios.get(
                    'https://api.lusha.com/v2/linkedin',
                    {
                        headers: { 
                            'api_key': apiKey,
                            'Accept': 'application/json'
                        },
                        params: {
                            url: linkedinUrl
                        },
                        timeout: 15000
                    }
                );

                if (linkedinResponse.data?.data) {
                    const data = linkedinResponse.data.data;
                    const phones = data.phoneNumbers || [];
                    const bestPhone = phones.find(p => p.phoneType === 'mobile') || 
                                     phones.find(p => p.phoneType === 'direct') || 
                                     phones[0];

                    return res.status(200).json({
                        success: true,
                        enriched: true,
                        source: 'lusha_linkedin',
                        phone: bestPhone?.internationalNumber || bestPhone?.localizedNumber || null,
                        phone_type: bestPhone?.phoneType || null,
                        all_phones: phones,
                        email: data.emailAddress || null,
                        full_name: data.fullName
                    });
                }
            } catch (linkedinError) {
                console.log('LinkedIn lookup failed:', linkedinError.message);
            }
        }

        // Opción 2: Buscar por empresa y nombre
        if (company || person.organization?.name) {
            try {
                const companyName = company || person.organization?.name;
                const companyDomain = person.organization?.primary_domain || 
                                     person.organization?.website_url?.replace(/https?:\/\//, '').split('/')[0];

                console.log('Trying Lusha company search:', { companyName, companyDomain });

                // Primero buscar la empresa
                const companySearchResponse = await axios.get(
                    'https://api.lusha.com/v2/companies',
                    {
                        headers: { 
                            'api_key': apiKey,
                            'Accept': 'application/json'
                        },
                        params: companyDomain ? { domain: companyDomain } : { company: companyName },
                        timeout: 15000
                    }
                );

                if (companySearchResponse.data?.data) {
                    const companyData = Array.isArray(companySearchResponse.data.data) 
                        ? companySearchResponse.data.data[0] 
                        : companySearchResponse.data.data;
                    
                    const companyId = companyData.companyId || companyData.id;

                    if (companyId) {
                        // Buscar contactos en esa empresa
                        const contactsResponse = await axios.get(
                            'https://api.lusha.com/v2/contacts',
                            {
                                headers: { 
                                    'api_key': apiKey,
                                    'Accept': 'application/json'
                                },
                                params: {
                                    companyId: companyId,
                                    firstName: person.first_name,
                                    lastName: person.last_name
                                },
                                timeout: 15000
                            }
                        );

                        if (contactsResponse.data?.data) {
                            const contactData = Array.isArray(contactsResponse.data.data) 
                                ? contactsResponse.data.data[0] 
                                : contactsResponse.data.data;
                            
                            const phones = contactData.phoneNumbers || [];
                            const bestPhone = phones.find(p => p.phoneType === 'mobile') || 
                                             phones.find(p => p.phoneType === 'direct') || 
                                             phones[0];

                            return res.status(200).json({
                                success: true,
                                enriched: true,
                                source: 'lusha_company',
                                phone: bestPhone?.internationalNumber || bestPhone?.localizedNumber || null,
                                phone_type: bestPhone?.phoneType || null,
                                all_phones: phones,
                                email: contactData.emailAddress || null,
                                full_name: contactData.fullName
                            });
                        }
                    }
                }
            } catch (companyError) {
                console.log('Company search failed:', companyError.message);
            }
        }

        // Si ninguna opción funcionó
        return res.status(200).json({ 
            success: false,
            enriched: false,
            message: 'No data found in Lusha',
            tried: ['linkedin', 'company']
        });

    } catch (error) {
        console.error('Lusha error:', error.response?.data || error.message);
        
        return res.status(200).json({
            success: false,
            enriched: false,
            error: 'Lusha enrichment failed',
            details: error.response?.data || error.message
        });
    }
};
