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
        const apiKey = process.env.APOLLO_API_KEY;
        
        if (!apiKey) {
            return res.status(500).json({ 
                success: false,
                error: 'Apollo API key not configured' 
            });
        }

        const { filters = {}, page = 1 } = req.body;

        // STEP 1: Get companies
        const apolloPayload = {
            page: page,
            per_page: 10,
            organization_locations: filters.location ? [filters.location] : [],
            organization_num_employees_ranges: filters.size ? [filters.size] : [],
            q_organization_keyword_tags: filters.keywords && filters.keywords.length > 0 
                ? filters.keywords 
                : ["logistics", "manufacturing", "ecommerce", "fulfillment", "warehouse", "distribution"]
        };

        console.log('Fetching companies with filters:', JSON.stringify(apolloPayload, null, 2));

        const companiesResponse = await axios.post(
            'https://api.apollo.io/api/v1/mixed_companies/search',
            apolloPayload,
            {
                headers: {
                    'X-Api-Key': apiKey,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );

        const organizations = companiesResponse.data?.organizations || [];
        const pagination = companiesResponse.data?.pagination || {};
        
        console.log(`Found ${organizations.length} companies`);

        if (organizations.length === 0) {
            return res.status(200).json({
                success: true,
                organizations: [],
                total: 0,
                page: 1,
                total_pages: 1
            });
        }

        // Extract company IDs
        const companyIds = organizations.map(org => org.id).filter(Boolean);
        console.log('Company IDs:', companyIds);

        // STEP 2: Get contacts - Apollo permite máximo 100 per_page
        const contactsPayload = {
            page: 1,
            per_page: 100,  // Cambiado de 200 a 100 - máximo permitido por Apollo
            organization_ids: companyIds,
            person_seniorities: ["manager", "director", "head", "vp", "c_suite", "owner"],
            person_titles: [
                "Operations Manager", "Operations Director", "COO",
                "Logistics Manager", "Logistics Director", 
                "Supply Chain Manager", "Supply Chain Director",
                "Production Manager", "Production Director",
                "Quality Manager", "Quality Director",
                "Plant Manager", "Plant Director",
                "Warehouse Manager", "Warehouse Director",
                "Procurement Manager", "Purchasing Manager",
                "General Manager", "CEO"
            ]
        };

        console.log(`Fetching contacts for ${companyIds.length} companies...`);

        const contactsResponse = await axios.post(
            'https://api.apollo.io/api/v1/mixed_people/search',
            contactsPayload,
            {
                headers: {
                    'X-Api-Key': apiKey,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );

        const allContacts = contactsResponse.data?.people || [];
        console.log(`Retrieved ${allContacts.length} total contacts`);

        // STEP 3: Map contacts to companies
        const companiesWithContacts = organizations.map(company => {
            const companyContacts = allContacts.filter(contact => 
                contact.organization_id === company.id || 
                contact.organization?.id === company.id ||
                contact.organization?.name === company.name
            );
            
            // Ordenar por senioridad y tomar top 10
            const prioritizedContacts = companyContacts
                .sort((a, b) => {
                    const getPriority = (title) => {
                        if (!title) return 999;
                        const titleLower = title.toLowerCase();
                        if (titleLower.includes('ceo') || titleLower.includes('coo')) return 1;
                        if (titleLower.includes('director')) return 2;
                        if (titleLower.includes('head') || titleLower.includes('vp')) return 3;
                        if (titleLower.includes('manager')) return 4;
                        return 5;
                    };
                    return getPriority(a.title) - getPriority(b.title);
                })
                .slice(0, 10);

            return {
                ...company,
                contacts: prioritizedContacts
            };
        });

        // Ordenar empresas por número de empleados
        companiesWithContacts.sort((a, b) => 
            (b.estimated_num_employees || 0) - (a.estimated_num_employees || 0)
        );

        console.log('Successfully processed companies and contacts');

        res.status(200).json({
            success: true,
            organizations: companiesWithContacts,
            total: pagination.total_entries || companiesWithContacts.length,
            page: pagination.page || 1,
            per_page: pagination.per_page || 10,
            total_pages: pagination.total_pages || 1,
            total_contacts_found: allContacts.length,
            api_calls_used: 2
        });

    } catch (error) {
        console.error('Apollo search error:', error.response?.data || error.message);
        
        res.status(500).json({
            success: false,
            error: 'Failed to fetch companies and contacts',
            details: error.response?.data?.error || error.message
        });
    }
};
