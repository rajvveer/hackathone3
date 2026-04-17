const axios = require('axios');
const { parseStringPromise } = require('xml2js');
const { PUBMED_SEARCH, PUBMED_FETCH, PUBMED_RETMAX } = require('../config/constants');

class PubMedService {
  /**
   * Two-step PubMed retrieval: search IDs → fetch full article details
   * Adds NCBI_API_KEY header if configured (raises rate limit from 3→10 req/sec)
   */
  async fetchPublications(searchTerms) {
    const allResults = [];
    const queries = Array.isArray(searchTerms) ? searchTerms : [searchTerms];

    const searchPromises = queries.slice(0, 3).map(query => 
      this._searchIds(query).then(ids => ({ query, ids })).catch(error => {
        console.error(`PubMed search error (q:"${query}"):`, error.message);
        return { query, ids: [] };
      })
    );

    const searchResults = await Promise.all(searchPromises);

    const fetchPromises = [];
    const batchSize = 50;

    for (const { query, ids } of searchResults) {
      if (!ids || ids.length === 0) continue;
      for (let i = 0; i < ids.length; i += batchSize) {
        const batch = ids.slice(i, i + batchSize);
        fetchPromises.push(
          this._fetchDetails(batch).catch(error => {
             console.error(`PubMed detail fetch error:`, error.message);
             return [];
          })
        );
      }
    }

    const detailResults = await Promise.all(fetchPromises);
    allResults.push(...detailResults.flat());

    console.log(`📖 PubMed: Retrieved ${allResults.length} publications`);
    return this._deduplicate(allResults);
  }

  /**
   * Step 1: Search PubMed for article IDs (sorted by recency)
   */
  async _searchIds(query) {
    const params = {
      db: 'pubmed',
      term: query.replace(/\s+/g, '+'),
      retmax: PUBMED_RETMAX,
      sort: 'pub+date',
      retmode: 'json'
    };

    // NCBI API key raises rate limit from 3 req/sec to 10 req/sec
    if (process.env.NCBI_API_KEY) {
      params.api_key = process.env.NCBI_API_KEY;
    }

    const response = await axios.get(PUBMED_SEARCH, {
      params,
      timeout: 15000
    });

    return response.data?.esearchresult?.idlist || [];
  }

  /**
   * Step 2: Fetch full article details by ID list (XML format)
   */
  async _fetchDetails(ids) {
    if (!ids.length) return [];

    const params = {
      db: 'pubmed',
      id: ids.join(','),
      retmode: 'xml'
    };

    if (process.env.NCBI_API_KEY) {
      params.api_key = process.env.NCBI_API_KEY;
    }

    const response = await axios.get(PUBMED_FETCH, { params, timeout: 20000 });

    try {
      const parsed = await parseStringPromise(response.data, {
        explicitArray: false,
        ignoreAttrs: false
      });

      const articles = parsed?.PubmedArticleSet?.PubmedArticle;
      if (!articles) return [];

      const articleArray = Array.isArray(articles) ? articles : [articles];
      return articleArray.map(article => this._parseArticle(article)).filter(Boolean);
    } catch (error) {
      console.error('PubMed XML parse error:', error.message);
      return [];
    }
  }

  /**
   * Parse a PubMed XML article into unified format
   */
  _parseArticle(article) {
    try {
      const medlineCitation = article.MedlineCitation;
      if (!medlineCitation) return null;
      const articleData = medlineCitation.Article;
      if (!articleData) return null;

      const pmid = typeof medlineCitation.PMID === 'object'
        ? medlineCitation.PMID._ || medlineCitation.PMID
        : medlineCitation.PMID;

      const title = typeof articleData.ArticleTitle === 'object'
        ? articleData.ArticleTitle._ || JSON.stringify(articleData.ArticleTitle)
        : articleData.ArticleTitle || 'Untitled';

      let abstract = '';
      if (articleData.Abstract?.AbstractText) {
        const absText = articleData.Abstract.AbstractText;
        if (Array.isArray(absText)) {
          abstract = absText.map(t => (typeof t === 'object' ? t._ || '' : t)).join(' ');
        } else {
          abstract = typeof absText === 'object' ? absText._ || '' : absText;
        }
      }

      const authors = [];
      const authorList = articleData.AuthorList?.Author;
      if (authorList) {
        const authArray = Array.isArray(authorList) ? authorList : [authorList];
        for (const auth of authArray.slice(0, 10)) {
          const name = [auth.ForeName, auth.LastName].filter(Boolean).join(' ');
          if (name) authors.push(name);
        }
      }

      let year = 0;
      const pubDate = articleData.Journal?.JournalIssue?.PubDate;
      if (pubDate) {
        year = parseInt(pubDate.Year) || parseInt(pubDate.MedlineDate?.substring(0, 4)) || 0;
      }

      const journal = articleData.Journal?.Title ||
        articleData.Journal?.ISOAbbreviation || 'Unknown Journal';

      const keywords = [];
      const kwList = medlineCitation.KeywordList?.Keyword;
      if (kwList) {
        const kwArr = Array.isArray(kwList) ? kwList : [kwList];
        kwArr.slice(0, 5).forEach(kw => {
          const word = typeof kw === 'object' ? kw._ : kw;
          if (word) keywords.push(word);
        });
      }

      return {
        id: `pmid:${pmid}`,
        title: this._cleanText(title),
        abstract: this._cleanText(abstract),
        authors,
        year,
        source: 'PubMed',
        sourceJournal: journal,
        url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}`,
        doi: this._extractDOI(article),
        pmid: String(pmid),
        citationCount: 0,
        relevanceScore: 0,
        keywords,
        type: 'article'
      };
    } catch (error) {
      return null;
    }
  }

  _extractDOI(article) {
    try {
      const idList = article.PubmedData?.ArticleIdList?.ArticleId;
      if (!idList) return '';
      const idArray = Array.isArray(idList) ? idList : [idList];
      const doiEntry = idArray.find(id => id.$ && id.$.IdType === 'doi');
      return doiEntry ? (doiEntry._ || '') : '';
    } catch {
      return '';
    }
  }

  _cleanText(text) {
    if (!text) return '';
    return text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }

  _deduplicate(results) {
    const seen = new Set();
    return results.filter(r => {
      const key = r.pmid || r.title.toLowerCase().substring(0, 80);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

module.exports = new PubMedService();
