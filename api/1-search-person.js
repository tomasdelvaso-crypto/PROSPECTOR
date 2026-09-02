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

// Ordena personas: coincidencia exacta de nombre primero, luego "empieza con", luego seniority
function scorePerson(person, personName) {
    const q = personName.toLowerCase();
    const name = (person.name || `${person.first_name || ''} ${person.last_name || ''}`).trim().toLowerCase();
    if (name === q) return 0;
    if (name.startsWith(q)) return 1;
    if (name.includes(q)) return 2;
    return 3;
}

function titlePriority(title) {
    if (!title) return 999;
    const t = title.toLowerCase();
    if (t.includes('ceo') || t.includes('coo') || t.includes('presidente')) return 1;
    if (t.includes('director') || t.includes('diretor')) return 2;
    if (t.includes('head') || t.includes('vp')) return 3;
    if (t.includes('manager') || t.includes('gerente')) return 4;
    return 5;
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

        const {
            personName,
            companyName = '',
            onlyBrazil = true,
            page = 1
        } = req.body;

        if (!personName || personName.trim() === '') {
            return res.status(400).json({
                success: false,
                error: 'Person name is required'
            });
        }

        const cleanName = personName.trim();
        const cleanCompany = (companyName || '').trim();

        // Apollo people search: q_keywords matchea nombre / cargo / empresa.
        // Si el usuario dio empresa, la sumamos al keyword para acotar.
        const apolloPayload = {
            page: page,
            per_page: 25,
            q_keywords: cleanCompany ? `${cleanName} ${cleanCompany}` : cleanName
        };

        if (onlyBrazil) {
            apolloPayload.person_locations = ['Brazil'];
        }

        console.log('Apollo person search payload:', JSON.stringify(apolloPayload, null, 2));

        const peopleData = await fetchApolloOrCache(
            'mixed_people/search',
            'https://api.apollo.io/api/v1/mixed_people/search',
            apolloPayload,
            apiKey
        );

        let people = peopleData?.people || [];
        const pagination = peopleData?.pagination || {};

        console.log(`Found ${people.length} people matching "${cleanName}"`);

        // Si se especificó empresa, filtrar en cliente para descartar ruido del keyword search
        if (cleanCompany) {
            const c = cleanCompany.toLowerCase();
            const filtered = people.filter(p =>
                (p.organization?.name || p.organization_name || '').toLowerCase().includes(c)
            );
            // Solo aplicar el filtro si no elimina todo (Apollo puede tener el nombre de empresa distinto)
            if (filtered.length > 0) people = filtered;
        }

        if (people.length === 0) {
            return res.status(200).json({
                success: true,
                organizations: [],
                people: [],
                total: 0,
                total_people: 0,
                page: 1,
                per_page: 25,
                total_pages: 0,
                search_term: cleanName,
                company_term: cleanCompany || null
            });
        }

        people.sort((a, b) => {
            const sa = scorePerson(a, cleanName);
            const sb = scorePerson(b, cleanName);
            if (sa !== sb) return sa - sb;
            return titlePriority(a.title) - titlePriority(b.title);
        });

        // Agrupar personas por empresa para reutilizar el flujo company-first del frontend
        const byCompany = new Map();
        const orderedKeys = [];

        people.forEach(person => {
            const org = person.organization || {};
            const key = org.id || org.name || person.organization_name || '__sem_empresa__';

            if (!byCompany.has(key)) {
                orderedKeys.push(key);
                byCompany.set(key, {
                    id: org.id || null,
                    name: org.name || person.organization_name || 'Empresa não identificada',
                    website_url: org.website_url || null,
                    primary_domain: org.primary_domain || null,
                    industry: org.industry || null,
                    estimated_num_employees: org.estimated_num_employees || null,
                    city: org.city || person.city || null,
                    state: org.state || person.state || null,
                    country: org.country || person.country || null,
                    linkedin_url: org.linkedin_url || null,
                    logo_url: org.logo_url || null,
                    contacts: []
                });
            }

            byCompany.get(key).contacts.push(person);
        });

        const organizations = orderedKeys.map(k => byCompany.get(k));

        console.log(`Grouped into ${organizations.length} companies for person search`);

        res.status(200).json({
            success: true,
            organizations,
            people,
            total: organizations.length,
            total_people: pagination.total_entries || people.length,
            page: pagination.page || page,
            per_page: pagination.per_page || 25,
            total_pages: pagination.total_pages || 1,
            search_term: cleanName,
            company_term: cleanCompany || null,
            api_calls_used: 1
        });

    } catch (error) {
        console.error('Apollo person search error:', error.response?.data || error.message);

        res.status(500).json({
            success: false,
            error: 'Failed to search person',
            details: error.response?.data?.error || error.message,
            status: error.response?.status
        });
    }
};
