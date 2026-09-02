const axios = require('axios');
const apolloCache = require('./_apollo-cache');

const UNIDENTIFIED_COMPANY = 'Empresa não identificada';

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

// Resuelve el nombre de empresa a organization_ids de Apollo (búsqueda de compañías, cacheada).
// Apollo people search no tiene filtro por nombre de empresa: solo q_keywords (fuzzy) u organization_ids (exacto).
async function resolveCompanyIds(companyName, apiKey) {
    const payload = {
        page: 1,
        per_page: 10,
        q_organization_name: companyName,
        organization_locations: ['Brazil']
    };

    try {
        const data = await fetchApolloOrCache(
            'mixed_companies/search',
            'https://api.apollo.io/api/v1/mixed_companies/search',
            payload,
            apiKey
        );

        const orgs = (data?.organizations || []).filter(o => o && o.id);
        if (orgs.length === 0) return { ids: [], organizations: [] };

        const q = companyName.toLowerCase();
        orgs.sort((a, b) => {
            const an = (a.name || '').toLowerCase();
            const bn = (b.name || '').toLowerCase();
            const aExact = an === q, bExact = bn === q;
            if (aExact !== bExact) return aExact ? -1 : 1;
            const aStarts = an.startsWith(q), bStarts = bn.startsWith(q);
            if (aStarts !== bStarts) return aStarts ? -1 : 1;
            return (b.estimated_num_employees || 0) - (a.estimated_num_employees || 0);
        });

        // Si hay match exacto, usar solo ese; si no, los 5 mejores (evita traer homónimos irrelevantes)
        const exact = orgs.filter(o => (o.name || '').toLowerCase() === q);
        const chosen = exact.length > 0 ? exact : orgs.slice(0, 5);

        return {
            ids: chosen.map(o => o.id),
            organizations: chosen.map(o => ({ id: o.id, name: o.name, primary_domain: o.primary_domain || null }))
        };
    } catch (err) {
        console.error('Company resolution failed, falling back to keyword search:', err.message);
        return { ids: [], organizations: [] };
    }
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

        let apiCalls = 0;
        let companyResolved = null;      // { ids, organizations } cuando la empresa se resolvió a IDs de Apollo
        let companyFilterMode = 'none';  // 'none' | 'organization_ids' | 'keyword'

        if (cleanCompany) {
            companyResolved = await resolveCompanyIds(cleanCompany, apiKey);
            apiCalls++;
            companyFilterMode = companyResolved.ids.length > 0 ? 'organization_ids' : 'keyword';
        }

        // Apollo people search: q_keywords es fuzzy (nombre / cargo / empresa), no un AND estricto.
        // Con empresa resuelta: q_keywords = nombre + organization_ids (AND real).
        // Sin resolver: nombre + empresa en el keyword (fallback) + filtro en cliente.
        const apolloPayload = {
            page: page,
            per_page: 25,
            q_keywords: companyFilterMode === 'keyword' ? `${cleanName} ${cleanCompany}` : cleanName
        };

        if (companyFilterMode === 'organization_ids') {
            apolloPayload.organization_ids = companyResolved.ids;
        }

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
        apiCalls++;

        let people = peopleData?.people || [];
        const pagination = peopleData?.pagination || {};

        console.log(`Found ${people.length} people matching "${cleanName}" (company mode: ${companyFilterMode})`);

        // Fallback por keyword: filtrar en cliente por nombre de empresa. Sin "rescate" a lista sin filtrar:
        // si el usuario pidió una empresa, no mostramos gente de otras empresas.
        let clientFilterApplied = false;
        if (companyFilterMode === 'keyword') {
            const c = cleanCompany.toLowerCase();
            people = people.filter(p =>
                (p.organization?.name || p.organization_name || '').toLowerCase().includes(c)
            );
            clientFilterApplied = true;
        }

        // Cuando filtramos en cliente, la paginación de Apollo (sin filtrar) no describe lo que mostramos.
        const effectivePage = pagination.page || page;
        const effectiveTotalPages = clientFilterApplied ? 1 : (pagination.total_pages ?? 0);
        const effectiveTotalPeople = clientFilterApplied ? people.length : (pagination.total_entries || people.length);

        const baseResponse = {
            success: true,
            search_term: cleanName,
            company_term: cleanCompany || null,
            company_filter_mode: companyFilterMode,
            company_resolved: companyResolved ? companyResolved.organizations : null,
            client_filter_applied: clientFilterApplied,
            page: effectivePage,
            per_page: pagination.per_page || 25,
            total_pages: effectiveTotalPages,
            total_people: effectiveTotalPeople,
            api_calls_used: apiCalls
        };

        if (people.length === 0) {
            return res.status(200).json({
                ...baseResponse,
                organizations: [],
                people: [],
                total: 0,
                total_pages: clientFilterApplied ? 0 : effectiveTotalPages,
                total_people: clientFilterApplied ? 0 : effectiveTotalPeople
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
            const orgName = org.name || person.organization_name || null;
            const key = org.id || orgName || '__sem_empresa__';

            if (!byCompany.has(key)) {
                orderedKeys.push(key);
                byCompany.set(key, {
                    id: org.id || null,
                    name: orgName || UNIDENTIFIED_COMPANY,
                    unidentified: !orgName,
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
            ...baseResponse,
            organizations,
            people,
            total: organizations.length
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
