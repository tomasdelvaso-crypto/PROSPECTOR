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
                error: 'Apollo API key not configured in environment variables' 
            });
        }

        const { companyName, page = 1 } = req.body;

        if (!companyName || companyName.trim() === '') {
            return res.status(400).json({ 
                success: false,
                error: 'Company name is required' 
            });
        }

        // Build Apollo payload for name search
        const apolloPayload = {
            page: page,
            per_page: 10, // Reducido para ahorrar créditos
            q_organization_name: companyName.trim(),
            organization_locations: ["Brazil"] // Filtro por Brasil para tu mercado
        };

        console.log('Apollo search by name payload:', JSON.stringify(apolloPayload, null, 2));

        // STEP 1: Search companies by name
        const companiesResponse = await axios.post(
            'https://api.apollo.io/api/v1/mixed_companies/search',
            apolloPayload,
            {
                headers: {
                    'X-Api-Key': apiKey,
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache'
                },
                timeout: 30000
            }
        );

        const organizations = companiesResponse.data?.organizations || [];
        const pagination = companiesResponse.data?.pagination || {};
        
        console.log(`Found ${organizations.length} companies matching "${companyName}"`);

        if (organizations.length === 0) {
            return res.status(200).json({
                success: true,
                organizations: [],
                total: 0,
                page: 1,
                per_page: 10,
                total_pages: 0,
                search_term: companyName
            });
        }

        // Sort by relevance (companies with more employees first as they're likely more relevant)
        organizations.sort((a, b) => {
            // First priority: exact name match
            const aExact = a.name.toLowerCase() === companyName.toLowerCase();
            const bExact = b.name.toLowerCase() === companyName.toLowerCase();
            if (aExact && !bExact) return -1;
            if (!aExact && bExact) return 1;
            
            // Second priority: starts with search term
            const aStarts = a.name.toLowerCase().startsWith(companyName.toLowerCase());
            const bStarts = b.name.toLowerCase().startsWith(companyName.toLowerCase());
            if (aStarts && !bStarts) return -1;
            if (!aStarts && bStarts) return 1;
            
            // Third priority: employee count
            return (b.estimated_num_employees || 0) - (a.estimated_num_employees || 0);
        });

        // Extract company IDs for contact search
        const companyIds = organizations.slice(0, 5).map(org => org.id).filter(Boolean); // Limit to top 5 to save credits
        
        console.log('Fetching contacts for top companies:', companyIds);

        // STEP 2: Get contacts for the found companies
        let allContacts = [];
        
        if (companyIds.length > 0) {
            const contactsPayload = {
                page: 1,
                per_page: 50, // Reducido de 100 a 50 para ahorrar créditos
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

            try {
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

                allContacts = contactsResponse.data?.people || [];
                console.log(`Retrieved ${allContacts.length} total contacts`);
            } catch (contactError) {
                console.error('Error fetching contacts:', contactError.message);
                // Continue without contacts if this fails
            }
        }

        // STEP 3: Map contacts to companies
        const companiesWithContacts = organizations.map(company => {
            const companyContacts = allContacts.filter(contact => 
                contact.organization_id === company.id || 
                contact.organization?.id === company.id ||
                contact.organization?.name === company.name
            );
            
            // Sort by seniority and take top 5 per company to save on enrichment later
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
                .slice(0, 5); // Reducido de 10 a 5 para ahorrar créditos

            return {
                ...company,
                contacts: prioritizedContacts
            };
        });

        console.log('Successfully processed companies and contacts for name search');

        res.status(200).json({
            success: true,
            organizations: companiesWithContacts,
            total: pagination.total_entries || companiesWithContacts.length,
            page: pagination.page || 1,
            per_page: pagination.per_page || 10,
            total_pages: pagination.total_pages || 1,
            total_contacts_found: allContacts.length,
            search_term: companyName,
            api_calls_used: companyIds.length > 0 ? 2 : 1
        });

    } catch (error) {
        console.error('Apollo company name search error:', error.response?.data || error.message);
        
        res.status(500).json({
            success: false,
            error: 'Failed to search companies by name',
            details: error.response?.data?.error || error.message,
            status: error.response?.status
        });
    }
};
