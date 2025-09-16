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

        // STEP 1: Get companies (1st API call)
        const apolloPayload = {
            page: page,
            per_page: 10,
            organization_locations: [],
            organization_num_employees_ranges: [],
            q_organization_keyword_tags: []
        };

        if (filters.keywords && filters.keywords.length > 0) {
            apolloPayload.q_organization_keyword_tags = filters.keywords;
        } else {
            apolloPayload.q_organization_keyword_tags = [
                "logistics", "manufacturing", "ecommerce", 
                "fulfillment", "warehouse", "distribution"
            ];
        }

        if (filters.location) {
            apolloPayload.organization_locations = [filters.location];
        }

        if (filters.size) {
            apolloPayload.organization_num_employees_ranges = [filters.size];
        }

        console.log('Fetching companies with filters:', apolloPayload);

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

        if (organizations.length === 0) {
            return res.status(200).json({
                success: true,
                organizations: [],
                total: 0,
                page: 1,
                total_pages: 1
            });
        }

        // Extract all company IDs
        const companyIds = organizations.map(org => org.id).filter(Boolean);
        
        console.log(`Found ${organizations.length} companies. Fetching all contacts for these companies in one call...`);

        // STEP 2: Get ALL contacts for ALL companies in ONE call (2nd API call)
        const contactsPayload = {
            page: 1,
            per_page: 200, // Get max contacts in one call
            organization_ids: companyIds, // Array of all company IDs
            person_titles: [
                // Operations & Logistics
                "Operations Manager", "Operations Director", "COO", "VP Operations",
                "Logistics Manager", "Logistics Director", "Logistics Coordinator",
                "Supply Chain Manager", "Supply Chain Director", "Supply Chain Analyst",
                
                // Production & Quality
                "Production Manager", "Production Director", "Manufacturing Manager",
                "Plant Manager", "Plant Director", "Factory Manager",
                "Quality Manager", "Quality Director", "Quality Assurance Manager",
                
                // Warehouse & Distribution
                "Warehouse Manager", "Warehouse Director", "Distribution Manager",
                "Fulfillment Manager", "Inventory Manager", "Shipping Manager",
                
                // Procurement & Purchasing
                "Procurement Manager", "Procurement Director", "Purchasing Manager",
                "Buyer", "Strategic Sourcing Manager", "Suprimentos Manager",
                "Compras Manager", "Head of Procurement", "CPO",
                
                // General Management
                "General Manager", "General Director", "CEO", "Managing Director",
                "Site Manager", "Facility Manager", "Business Unit Manager"
            ],
            person_seniorities: ["manager", "director", "head", "vp", "c_suite", "owner"],
            contact_email_status: ["verified", "unverified", "likely to engage"]
        };

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
        
        console.log(`Retrieved ${allContacts.length} total contacts across all companies`);

        // STEP 3: Map contacts back to their companies
        const companiesWithContacts = organizations.map(company => {
            // Filter contacts that belong to this company
            const companyContacts = allContacts.filter(contact => 
                contact.organization_id === company.id || 
                contact.organization?.id === company.id ||
                contact.organization?.name === company.name
            );
            
            // Take top 10 contacts per company, prioritizing by seniority
            const prioritizedContacts = companyContacts
                .sort((a, b) => {
                    // Prioritize C-level and directors
                    const getPriority = (title) => {
                        if (!title) return 999;
                        const titleLower = title.toLowerCase();
                        if (titleLower.includes('ceo') || titleLower.includes('coo') || titleLower.includes('cfo')) return 1;
                        if (titleLower.includes('director') || titleLower.includes('diretor')) return 2;
                        if (titleLower.includes('head') || titleLower.includes('vp')) return 3;
                        if (titleLower.includes('manager') || titleLower.includes('gerente')) return 4;
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

        // Sort companies by employee count
        companiesWithContacts.sort((a, b) => 
            (b.estimated_num_employees || 0) - (a.estimated_num_employees || 0)
        );

        console.log('Successfully mapped contacts to companies. API calls used: 2');

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
