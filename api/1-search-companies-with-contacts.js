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

        const { filters = {}, page = 1, titleProfile = 'operations' } = req.body;

        // Define title profiles
        const TITLE_PROFILES = {
            'operations': {
                titles: ['Operations Manager', 'Logistics Manager', 'Supply Chain Manager', 'Warehouse Manager'],
                seniorities: ['manager', 'director', 'head', 'vp']
            },
            'quality': {
                titles: ['Quality Manager', 'Production Manager', 'Plant Manager'],
                seniorities: ['manager', 'director', 'head']
            },
            'directors': {
                titles: [],
                seniorities: ['director', 'vp', 'head']
            },
            'c_level': {
                titles: ['COO', 'CEO', 'CFO'],
                seniorities: ['c_suite', 'owner', 'founder']
            }
        };

        const profile = TITLE_PROFILES[titleProfile] || TITLE_PROFILES.operations;

        // First, get companies
        const apolloPayload = {
            page: page,
            per_page: filters.per_page || 10, // Reduced to 10 to avoid rate limits
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

        console.log('Searching companies with filters:', apolloPayload);

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

        // For each company, find contacts
        const companiesWithContacts = await Promise.all(
            organizations.map(async (company) => {
                try {
                    const contactsPayload = {
                        page: 1,
                        per_page: 5, // Get top 5 contacts
                        organization_ids: [company.id],
                        contact_email_status: ["verified", "unverified", "likely to engage"],
                        person_titles: profile.titles.length > 0 ? profile.titles : undefined,
                        person_seniorities: profile.seniorities
                    };

                    const contactsResponse = await axios.post(
                        'https://api.apollo.io/api/v1/mixed_people/search',
                        contactsPayload,
                        {
                            headers: {
                                'X-Api-Key': apiKey,
                                'Content-Type': 'application/json',
                                'Cache-Control': 'no-cache'
                            },
                            timeout: 15000
                        }
                    );

                    const contacts = contactsResponse.data?.people || [];
                    
                    return {
                        ...company,
                        contacts: contacts.slice(0, 5) // Limit to 5 contacts
                    };
                } catch (contactError) {
                    console.error(`Failed to get contacts for ${company.name}:`, contactError.message);
                    return {
                        ...company,
                        contacts: []
                    };
                }
            })
        );

        // Sort by employee count
        companiesWithContacts.sort((a, b) => 
            (b.estimated_num_employees || 0) - (a.estimated_num_employees || 0)
        );

        res.status(200).json({
            success: true,
            organizations: companiesWithContacts,
            total: pagination.total_entries || companiesWithContacts.length,
            page: pagination.page || 1,
            per_page: pagination.per_page || 10,
            total_pages: pagination.total_pages || 1
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
