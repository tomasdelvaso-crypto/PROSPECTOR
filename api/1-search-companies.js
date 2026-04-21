const axios = require('axios');
const apolloCache = require('./_apollo-cache');

async function fetchApolloOrCache(endpoint, url, payload, apiKey) {
    const cached = await apolloCache.tryGet(endpoint, payload);
    if (cached.hit) return cached.data;

    const response = await axios.post(url, payload, {
        headers: {
            'X-Api-Key': apiKey,
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache'
        },
        timeout: 30000
    });

    await apolloCache.set(
        cached.cacheKey,
        endpoint,
        cached.normalized,
        response.data,
        response.data?.pagination?.total_entries
    );

    return response.data;
}

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

        const { filters = {}, page = 1 } = req.body;

        // Build Apollo payload with smart defaults for Ventapel
        const apolloPayload = {
            page: page,
            per_page: filters.per_page || 25,
            organization_locations: [],
            organization_num_employees_ranges: [],
            q_organization_keyword_tags: []
        };

        // Keywords - Default to logistics/manufacturing if not specified
        if (filters.keywords && filters.keywords.length > 0) {
            apolloPayload.q_organization_keyword_tags = filters.keywords;
        } else {
            apolloPayload.q_organization_keyword_tags = [
                "logistics",
                "manufacturing",
                "ecommerce",
                "fulfillment",
                "warehouse",
                "distribution",
                "packaging",
                "industrial",
                "supply chain"
            ];
        }

        // Location filter
        if (filters.location) {
            apolloPayload.organization_locations = [filters.location];
        }

        // Size filter
        if (filters.size) {
            apolloPayload.organization_num_employees_ranges = [filters.size];
        }

        console.log('Apollo request payload:', JSON.stringify(apolloPayload, null, 2));

        const data = await fetchApolloOrCache(
            'mixed_companies/search',
            'https://api.apollo.io/api/v1/mixed_companies/search',
            apolloPayload,
            apiKey
        );

        const organizations = data?.organizations || [];

        // Sort by employee count (larger companies first)
        organizations.sort((a, b) =>
            (b.estimated_num_employees || 0) - (a.estimated_num_employees || 0)
        );

        res.status(200).json({
            success: true,
            organizations: organizations,
            total: data?.pagination?.total_entries || organizations.length,
            page: data?.pagination?.page || 1,
            per_page: data?.pagination?.per_page || 25,
            total_pages: data?.pagination?.total_pages || 1
        });

    } catch (error) {
        console.error('Apollo company search error:', error.response?.data || error.message);

        res.status(500).json({
            success: false,
            error: 'Failed to fetch companies from Apollo',
            details: error.response?.data?.error || error.message,
            status: error.response?.status
        });
    }
};
