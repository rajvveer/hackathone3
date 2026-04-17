const {
  PUB_RELEVANCE_WEIGHT, PUB_RECENCY_WEIGHT, PUB_CREDIBILITY_WEIGHT, PUB_CITATION_WEIGHT,
  CT_RELEVANCE_WEIGHT, CT_STATUS_WEIGHT, CT_LOCATION_WEIGHT, CT_RECENCY_WEIGHT,
  TOP_PUBLICATIONS, TOP_CLINICAL_TRIALS, HIGH_IMPACT_JOURNALS
} = require('../config/constants');

class RankingPipeline {
  /**
   * Rank and filter retrieved results
   * Publications: relevance × recency × credibility × citations
   * Clinical Trials: relevance × status × location × recency
   */
  rank(publications, clinicalTrials, expansion) {
    const startTime = Date.now();
    const queryTerms = this._extractQueryTerms(expansion);

    // Score and rank publications
    const scoredPubs = publications.map(pub => ({
      ...pub,
      compositeScore: this._scorePublication(pub, queryTerms)
    }));
    scoredPubs.sort((a, b) => b.compositeScore - a.compositeScore);

    // Score and rank clinical trials
    const scoredTrials = clinicalTrials.map(trial => ({
      ...trial,
      compositeScore: this._scoreClinicalTrial(trial, queryTerms, expansion.location)
    }));
    scoredTrials.sort((a, b) => b.compositeScore - a.compositeScore);

    const topPubs = scoredPubs.slice(0, TOP_PUBLICATIONS);
    const topTrials = scoredTrials.slice(0, TOP_CLINICAL_TRIALS);

    console.log(`📊 Ranking: ${publications.length} pubs → top ${topPubs.length} | ${clinicalTrials.length} trials → top ${topTrials.length}`);

    return {
      publications: topPubs,
      clinicalTrials: topTrials,
      rankingMetrics: {
        totalPublications: publications.length,
        totalTrials: clinicalTrials.length,
        selectedPublications: topPubs.length,
        selectedTrials: topTrials.length,
        topPubScore: topPubs[0]?.compositeScore || 0,
        topTrialScore: topTrials[0]?.compositeScore || 0,
        timeMs: Date.now() - startTime
      }
    };
  }

  /**
   * Score a publication using multi-factor formula
   * score = (relevance × 0.40) + (recency × 0.25) + (credibility × 0.20) + (citations × 0.15)
   */
  _scorePublication(pub, queryTerms) {
    const relevance = this._calculateRelevance(pub, queryTerms);
    const recency = this._calculateRecency(pub.year);
    const credibility = this._calculateCredibility(pub.sourceJournal);
    const citations = this._calculateCitationScore(pub.citationCount);

    return (
      relevance * PUB_RELEVANCE_WEIGHT +
      recency * PUB_RECENCY_WEIGHT +
      credibility * PUB_CREDIBILITY_WEIGHT +
      citations * PUB_CITATION_WEIGHT
    );
  }

  /**
   * Score a clinical trial using multi-factor formula
   * score = (relevance × 0.35) + (status × 0.25) + (location × 0.25) + (recency × 0.15)
   */
  _scoreClinicalTrial(trial, queryTerms, userLocation) {
    const relevance = this._calculateTrialRelevance(trial, queryTerms);
    const status = this._calculateStatusScore(trial.status);
    const location = this._calculateLocationScore(trial.location, userLocation);
    const recency = this._calculateTrialRecency(trial.startDate);

    return (
      relevance * CT_RELEVANCE_WEIGHT +
      status * CT_STATUS_WEIGHT +
      location * CT_LOCATION_WEIGHT +
      recency * CT_RECENCY_WEIGHT
    );
  }

  /**
   * TF-IDF-style relevance scoring for publications
   */
  _calculateRelevance(pub, queryTerms) {
    const text = `${pub.title} ${pub.abstract} ${(pub.topics || []).join(' ')}`.toLowerCase();
    let matchScore = 0;
    let totalTerms = queryTerms.length || 1;

    for (const term of queryTerms) {
      const termLower = term.toLowerCase();
      // Title matches worth more
      if (pub.title.toLowerCase().includes(termLower)) {
        matchScore += 2;
      }
      // Abstract matches
      if (text.includes(termLower)) {
        matchScore += 1;
      }
      // Check individual words
      const words = termLower.split(/\s+/);
      const wordMatches = words.filter(w => w.length > 2 && text.includes(w)).length;
      matchScore += (wordMatches / words.length) * 0.5;
    }

    // Normalize to 0-1
    const maxPossible = totalTerms * 3.5;
    return Math.min(matchScore / maxPossible, 1);
  }

  /**
   * Recency scoring with exponential decay
   */
  _calculateRecency(year) {
    if (!year) return 0;
    const currentYear = new Date().getFullYear();
    const age = currentYear - year;
    return Math.exp(-0.15 * age); // Stronger decay for older papers
  }

  /**
   * Journal credibility scoring
   */
  _calculateCredibility(journal) {
    if (!journal) return 0.3;
    const normalized = journal.toLowerCase();

    // Check against high-impact journals
    for (const highImpact of HIGH_IMPACT_JOURNALS) {
      if (normalized.includes(highImpact)) return 1.0;
    }

    // Medium credibility for known publishers
    if (normalized.includes('springer') || normalized.includes('elsevier') ||
        normalized.includes('wiley') || normalized.includes('oxford') ||
        normalized.includes('cambridge') || normalized.includes('taylor')) {
      return 0.6;
    }

    return 0.3; // Default
  }

  /**
   * Citation score (log-normalized)
   */
  _calculateCitationScore(citations) {
    if (!citations) return 0;
    // Log normalization: papers with 100+ citations score high
    return Math.min(Math.log(1 + citations) / Math.log(1 + 500), 1);
  }

  /**
   * Relevance scoring for clinical trials
   */
  _calculateTrialRelevance(trial, queryTerms) {
    const text = `${trial.title} ${trial.summary} ${(trial.conditions || []).join(' ')}`.toLowerCase();
    let matchScore = 0;
    let totalTerms = queryTerms.length || 1;

    for (const term of queryTerms) {
      const termLower = term.toLowerCase();
      if (trial.title.toLowerCase().includes(termLower)) matchScore += 2;
      if (text.includes(termLower)) matchScore += 1;

      const words = termLower.split(/\s+/);
      const wordMatches = words.filter(w => w.length > 2 && text.includes(w)).length;
      matchScore += (wordMatches / words.length) * 0.5;
    }

    return Math.min(matchScore / (totalTerms * 3.5), 1);
  }

  /**
   * Trial status scoring
   */
  _calculateStatusScore(status) {
    const scores = {
      'RECRUITING': 1.0,
      'ACTIVE_NOT_RECRUITING': 0.8,
      'ENROLLING_BY_INVITATION': 0.7,
      'COMPLETED': 0.5,
      'NOT_YET_RECRUITING': 0.4,
      'SUSPENDED': 0.2,
      'TERMINATED': 0.1,
      'WITHDRAWN': 0.05
    };
    return scores[status] || 0.3;
  }

  /**
   * Location proximity scoring
   */
  _calculateLocationScore(trialLocation, userLocation) {
    if (!userLocation || !trialLocation) return 0.5; // Neutral if no location

    const trialLower = trialLocation.toLowerCase();
    const userLower = userLocation.toLowerCase();

    // Extract key location parts
    const userParts = userLower.split(/[,\s]+/).filter(p => p.length > 2);

    let matchLevel = 0;
    for (const part of userParts) {
      if (trialLower.includes(part)) matchLevel++;
    }

    if (matchLevel >= 2) return 1.0;   // City + Country match
    if (matchLevel >= 1) return 0.7;   // Country match
    return 0.3;                         // No match
  }

  /**
   * Trial recency scoring
   */
  _calculateTrialRecency(startDate) {
    if (!startDate) return 0.3;
    try {
      const start = new Date(startDate);
      const now = new Date();
      const yearsAgo = (now - start) / (365.25 * 24 * 60 * 60 * 1000);
      return Math.exp(-0.2 * yearsAgo);
    } catch {
      return 0.3;
    }
  }

  /**
   * Extract flat query terms from expansion
   */
  _extractQueryTerms(expansion) {
    const terms = new Set();
    if (expansion.disease) terms.add(expansion.disease);
    if (expansion.intent && expansion.intent !== expansion.disease) terms.add(expansion.intent);
    if (expansion.expandedQueries) {
      expansion.expandedQueries.forEach(q => terms.add(q));
    }
    if (expansion.originalQuery) terms.add(expansion.originalQuery);
    return [...terms];
  }
}

module.exports = new RankingPipeline();
