const openAlexService = require('./openAlexService');
const pubmedService = require('./pubmedService');
const clinicalTrialsService = require('./clinicalTrialsService');
const ResearchCache = require('../models/ResearchCache');
const { getRedis } = require('../config/redis');
const crypto = require('crypto');

const REDIS_TTL = parseInt(process.env.REDIS_TTL || '3600'); // 1 hour
const REDIS_PREFIX = 'curalink:research:';

class RetrievalManager {
  /**
   * Two-tier cached retrieval:
   *   Layer 1: Redis  (in-memory, ~1ms, 1-hour TTL)
   *   Layer 2: MongoDB (persistent, ~10ms, 24-hour TTL)
   *   Layer 3: Live API calls (parallel, 5-20s)
   *
   * Also handles researcher queries by calling the OpenAlex Authors API.
   */
  async retrieve(expansion) {
    const startTime = Date.now();
    const { expandedQueries, searchTerms, disease, intent, location, isResearcherQuery } = expansion;

    const cacheKey = this._generateCacheKey(expandedQueries);
    const redisKey = `${REDIS_PREFIX}${cacheKey}`;

    // ── Layer 1: Redis ─────────────────────────────────────
    const redis = getRedis();
    if (redis) {
      try {
        const cached = await redis.get(redisKey);
        if (cached) {
          console.log('⚡ Redis cache hit!');
          return { ...JSON.parse(cached), fromCache: 'redis', timeMs: Date.now() - startTime };
        }
      } catch (e) {
        console.warn('Redis GET error:', e.message);
      }
    }

    // ── Layer 2: MongoDB ────────────────────────────────────
    const mongoResult = await this._checkMongo(cacheKey);
    if (mongoResult) {
      console.log('💾 MongoDB cache hit — back-filling Redis...');
      if (redis) {
        redis.setex(redisKey, REDIS_TTL, JSON.stringify(mongoResult)).catch(() => { });
      }
      return { ...mongoResult, fromCache: 'mongodb', timeMs: Date.now() - startTime };
    }

    // ── Layer 3: Live API retrieval (parallel) ──────────────
    console.log('🔍 Fetching from all sources in parallel...');

    const fetchPromises = [
      openAlexService.fetchPublications(expandedQueries),
      pubmedService.fetchPublications(expandedQueries.map(q => q.replace(/\s+/g, '+'))),
      clinicalTrialsService.fetchTrials(
        searchTerms?.clinicalTrials || disease,
        intent,
        location
      )
    ];

    // Also fetch researchers if this is a researcher-type query
    if (isResearcherQuery) {
      console.log('👨‍🔬 Researcher query detected — fetching top authors...');
      fetchPromises.push(openAlexService.fetchTopResearchers(disease));
    }

    const settled = await Promise.allSettled(fetchPromises);
    const [openAlexResult, pubmedResult, trialsResult, researchersResult] = settled;

    const openAlex = openAlexResult.status === 'fulfilled' ? openAlexResult.value : [];
    const pubmed = pubmedResult.status === 'fulfilled' ? pubmedResult.value : [];
    const trials = trialsResult.status === 'fulfilled' ? trialsResult.value : [];
    const researchers = (researchersResult?.status === 'fulfilled') ? researchersResult.value : [];

    if (openAlexResult.status === 'rejected') console.error('❌ OpenAlex failed:', openAlexResult.reason?.message);
    if (pubmedResult.status === 'rejected') console.error('❌ PubMed failed:', pubmedResult.reason?.message);
    if (trialsResult.status === 'rejected') console.error('❌ ClinicalTrials failed:', trialsResult.reason?.message);
    if (isResearcherQuery && researchersResult?.status === 'rejected') {
      console.error('❌ Researcher fetch failed:', researchersResult.reason?.message);
    }

    const allPublications = this._deduplicateAcrossSources(openAlex, pubmed);

    const result = {
      publications: allPublications,
      clinicalTrials: trials,
      researchers,
      metadata: {
        openAlexCount: openAlex.length,
        pubmedCount: pubmed.length,
        clinicalTrialsCount: trials.length,
        researchersCount: researchers.length,
        totalBeforeDedup: openAlex.length + pubmed.length,
        totalAfterDedup: allPublications.length,
        sources: {
          openAlex: openAlexResult.status === 'fulfilled' ? 'success' : 'failed',
          pubmed: pubmedResult.status === 'fulfilled' ? 'success' : 'failed',
          clinicalTrials: trialsResult.status === 'fulfilled' ? 'success' : 'failed'
        }
      },
      timeMs: Date.now() - startTime
    };

    // ── Save to both cache layers (non-blocking) ───────────
    const cachePayload = {
      publications: result.publications,
      clinicalTrials: result.clinicalTrials,
      researchers: result.researchers,
      metadata: result.metadata
    };

    const saves = [this._saveToMongo(cacheKey, expandedQueries, result)];
    if (redis) {
      saves.push(
        redis.setex(redisKey, REDIS_TTL, JSON.stringify(cachePayload))
          .catch(e => console.warn('Redis SET error:', e.message))
      );
    }
    Promise.all(saves).catch(e => console.error('Cache save error:', e.message));

    console.log(`✅ Retrieved: ${allPublications.length} pubs + ${trials.length} trials + ${researchers.length} researchers (${result.timeMs}ms)`);
    return result;
  }

  /**
   * Cross-source deduplication (OpenAlex + PubMed)
   * Matches by DOI first, then PMID, then normalized title
   */
  _deduplicateAcrossSources(openAlex, pubmed) {
    const combined = [];
    const seenKeys = new Set();

    // OpenAlex gets priority (has citation counts, topics, open-access info)
    const allPubs = [
      ...openAlex.map(p => ({ ...p, _priority: 1 })),
      ...pubmed.map(p => ({ ...p, _priority: 2 }))
    ];

    for (const pub of allPubs) {
      const keys = [];
      if (pub.doi) keys.push(pub.doi.toLowerCase().replace('https://doi.org/', ''));
      if (pub.pmid) keys.push(`pmid:${pub.pmid}`);
      if (pub.title) keys.push(pub.title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 60));

      const isDuplicate = keys.some(k => seenKeys.has(k));
      if (!isDuplicate) {
        keys.forEach(k => seenKeys.add(k));
        const { _priority, ...rest } = pub;
        combined.push(rest);
      }
    }

    return combined;
  }

  _generateCacheKey(queries) {
    const normalized = [...queries].sort().join('|').toLowerCase().trim();
    return crypto.createHash('md5').update(normalized).digest('hex');
  }

  async _checkMongo(key) {
    try {
      const cached = await ResearchCache.findOne({ queryHash: key }).lean();
      if (cached) {
        return {
          publications: cached.publications || [],
          clinicalTrials: cached.clinicalTrials || [],
          researchers: cached.researchers || [],
          metadata: { ...cached.metadata, fromCache: 'mongodb', totalResults: cached.totalResults }
        };
      }
    } catch (e) {
      // Cache miss or MongoDB error — proceed with fresh retrieval
    }
    return null;
  }

  async _saveToMongo(key, queries, result) {
    try {
      await ResearchCache.findOneAndUpdate(
        { queryHash: key },
        {
          queryHash: key,
          queryTerms: queries,
          publications: result.publications,
          clinicalTrials: result.clinicalTrials,
          researchers: result.researchers || [],
          totalResults: result.publications.length + result.clinicalTrials.length,
          metadata: result.metadata,
          cachedAt: new Date()
        },
        { upsert: true, new: true }
      );
    } catch (e) {
      console.error('MongoDB cache save error:', e.message);
    }
  }
}

module.exports = new RetrievalManager();
