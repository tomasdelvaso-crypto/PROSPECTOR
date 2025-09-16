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

        const { 
            organizationId, 
            titles = [], 
            seniorities = [],
            page = 1,
            per_page = 10 
        } = req.body;
        
        if (!organizationId) {
            return res.status(400).json({ 
                success: false,
                error: 'Organization ID is required' 
            });
        }

        // Build Apollo payload
        const apolloPayload = {
            page,
            per_page,
            organization_ids: [organizationId],
            contact_email_status: ["verified", "unverified", "likely to engage"]
        };

        // Add title filters if provided
        if (titles.length > 0) {
            apolloPayload.person_titles = titles;
        } else {
            // Default titles for Ventapel prospects
            apolloPayload.person_titles = [
                "Operations Manager",
                "Logistics Manager", 
                "Supply Chain Manager",
                "Quality Manager",
                "Production Manager",
                "Warehouse Manager",
                "Plant Manager",
                "Operations Director",
                "COO"
            ];
        }

        // Add seniority filters if provided
        if (seniorities.length > 0) {
            apolloPayload.person_seniorities = seniorities;
        } else {
            // Default seniorities for decision makers
            apolloPayload.person_seniorities = [
                "manager",
                "director",
                "head",
                "vp",
                "c_suite",
                "owner"
            ];
        }

        console.log('Apollo contacts search payload:', JSON.stringify(apolloPayload, null, 2));

        const response = await axios.post(
            'https://api.apollo.io/api/v1/mixed_people/search',
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

        const people = response.data?.people || [];

        res.status(200).json({
            success: true,
            people: people,
            total: response.data?.pagination?.total_entries || people.length,
            page: response.data?.pagination?.page || 1
        });

    } catch (error) {
        console.error('Apollo contact search error:', error.response?.data || error.message);
        
        res.status(500).json({
            success: false,
            error: 'Failed to fetch contacts from Apollo',
            details: error.response?.data?.error || error.message
        });
    }
};
