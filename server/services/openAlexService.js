const axios = require('axios');
const { OPENALEX_BASE, OPENALEX_AUTHORS_BASE, OPENALEX_PER_PAGE, OPENALEX_PAGES } = require('../config/constants');

class OpenAlexService {
  /**
   * Fetch publications from OpenAlex — multi-page, multi-query depth-first
   */
  async fetchPublications(searchTerms) {
    const allResults = [];
    const queries = Array.isArray(searchTerms) ? searchTerms : [searchTerms];
    const fetchPromises = [];

    for (const query of queries.slice(0, 3)) {
      for (let page = 1; page <= OPENALEX_PAGES; page++) {
        fetchPromises.push(
          axios.get(OPENALEX_BASE, {
            params: {
              search: query,
              'per-page': OPENALEX_PER_PAGE,
              page,
              sort: 'relevance_score:desc',
              filter: 'from_publication_date:2018-01-01',
              mailto: 'curalink@research.app'
            },
            timeout: 10000
          }).then(response => {
            if (response.data?.results) {
              return response.data.results.map(work => this._parseWork(work)).filter(Boolean);
            }
            return [];
          }).catch(error => {
            console.error(`OpenAlex fetch error (q:"${query}", page:${page}):`, error.message);
            return [];
          })
        );
      }
    }

    const unflatResults = await Promise.all(fetchPromises);
    allResults.push(...unflatResults.flat());

    console.log(`📚 OpenAlex: Retrieved ${allResults.length} publications`);
    return this._deduplicate(allResults);
  }

  /**
   * Fetch top researchers by citation count from OpenAlex Authors API
   * Used when user asks "top researchers in X" type queries
   */
  async fetchTopResearchers(disease, limit = 10) {
    try {
      const response = await axios.get(OPENALEX_AUTHORS_BASE, {
        params: {
          search: disease,
          'per-page': limit,
          sort: 'cited_by_count:desc',
          mailto: 'curalink@research.app'
        },
        timeout: 10000
      });

      const results = (response.data?.results || []).map(author => ({
        name: author.display_name || 'Unknown',
        institution: author.last_known_institutions?.[0]?.display_name || 'Unknown Institution',
        country: author.last_known_institutions?.[0]?.country_code || '',
        citationCount: author.cited_by_count || 0,
        worksCount: author.works_count || 0,
        hIndex: author.summary_stats?.h_index || 0,
        i10Index: author.summary_stats?.i10_index || 0,
        orcid: author.orcid || '',
        url: author.id || '',
        topics: (author.topics || []).slice(0, 3).map(t => t.display_name).filter(Boolean)
      }));

      console.log(`👨‍🔬 OpenAlex Authors: Retrieved ${results.length} researchers`);
      return results;
    } catch (error) {
      console.error('OpenAlex authors fetch error:', error.message);
      return [];
    }
  }

  /**
   * Parse an OpenAlex work into a unified publication format
   */
  _parseWork(work) {
    try {
      // Reconstruct abstract from inverted index (OpenAlex's compression format)
      let abstract = '';
      if (work.abstract_inverted_index) {
        const words = [];
        for (const [word, positions] of Object.entries(work.abstract_inverted_index)) {
          for (const pos of positions) {
            words[pos] = word;
          }
        }
        abstract = words.filter(Boolean).join(' ');
      }

      const authors = (work.authorships || []).map(a => a.author?.display_name).filter(Boolean);

      let url = '';
      if (work.doi) {
        url = work.doi.startsWith('http') ? work.doi : `https://doi.org/${work.doi}`;
      } else if (work.primary_location?.landing_page_url) {
        url = work.primary_location.landing_page_url;
      } else if (work.id) {
        url = work.id;
      }

      const sourceName = work.primary_location?.source?.display_name || 'Unknown Source';

      return {
        id: work.id || '',
        title: work.title || work.display_name || 'Untitled',
        abstract,
        authors,
        year: work.publication_year || 0,
        source: 'OpenAlex',
        sourceJournal: sourceName,
        url,
        doi: work.doi || '',
        citationCount: work.cited_by_count || 0,
        relevanceScore: work.relevance_score || 0,
        isOpenAccess: work.open_access?.is_oa || false,
        topics: (work.topics || []).slice(0, 3).map(t => t.display_name),
        type: work.type || 'article'
      };
    } catch (e) {
      return null;
    }
  }

  _deduplicate(results) {
    const seen = new Set();
    return results.filter(r => {
      const key = r.doi || r.title.toLowerCase().substring(0, 80);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

module.exports = new OpenAlexService();
