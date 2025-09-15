async function searchProspects() {
    // Reset
    currentPage = 1;
    allResults = [];
    analyzedCount = 0;
    
    const resultsDiv = document.getElementById('results');
    resultsDiv.innerHTML = '<p class="text-blue-600"><i class="fas fa-spinner fa-spin mr-2"></i>Buscando prospectos...</p>';
    
    try {
        const titleType = document.getElementById('titleFilter').value;
        const location = document.getElementById('locationFilter').value;
        const size = document.getElementById('sizeFilter').value;
        const company = document.getElementById('companyFilter').value;
        const industryType = document.getElementById('industryFilter').value;
        const keywords = document.getElementById('keywordsFilter').value;
        
        const requestBody = {
            query: keywords || '',
            filters: {
                titles: titleType ? TITLE_MAPPING[titleType] : null,
                location: location || 'Brazil',
                size: size || '501,1000',
                company_names: company ? [company] : null,
                industries: industryType ? INDUSTRY_MAPPING[industryType] : null,
                seniority_levels: ['manager', 'director', 'vp', 'owner', 'c_suite'],
                departments: ['operations', 'logistics', 'supply_chain', 'procurement', 'quality', 'manufacturing', 'production']
            },
            page: 1,
            per_page: 25
        };
        
        console.log('Sending request:', requestBody);
        
        const response = await fetch('/api/apollo-search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        });
        
        console.log('Response status:', response.status);
        
        if (!response.ok) {
            const errorData = await response.json();
            console.error('API Error:', errorData);
            throw new Error(errorData.message || `Error ${response.status}`);
        }
        
        const data = await response.json();
        console.log('API Response:', data);
        
        currentResults = data.people || [];
        
        if (currentResults.length === 0) {
            resultsDiv.innerHTML = `
                <div class="bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-3 rounded">
                    <p class="font-bold">Nenhum prospecto encontrado</p>
                    <p class="text-sm">Tente ajustar os filtros ou remover o filtro de empresa.</p>
                </div>
            `;
            return;
        }
        
        // Calcular prioridad y mostrar
        currentResults = prioritizeResults(currentResults, industryType);
        allResults = currentResults;
        
        displayResults(currentResults);
        updateStats();
        
        // Mostrar botón de cargar más si hay más resultados
        if (data.pagination?.has_more || currentResults.length >= 25) {
            document.getElementById('loadMoreContainer').classList.remove('hidden');
        }
        
    } catch (error) {
        console.error('Error completo:', error);
        resultsDiv.innerHTML = `
            <div class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                <p class="font-bold">Erro ao buscar prospectos</p>
                <p class="text-sm">${error.message}</p>
                <p class="text-xs mt-2">Verifique o console para mais detalhes.</p>
            </div>
        `;
    }
}
