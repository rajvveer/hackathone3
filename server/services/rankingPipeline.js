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

    // First: Strict relevance filter (Simulation of hybrid semantic matching mechanism)
    const diseaseLower = (expansion.disease || '').toLowerCase().trim();
    const intentLower = (expansion.intent || '').toLowerCase().trim();

    const hasSemanticOverlap = (pub) => {
      const text = `${pub.title} ${pub.abstract}`.toLowerCase();
      // Strict check: explicitly mentions both the disease and the user intent as exact phrases
      const hasDisease = !diseaseLower || text.includes(diseaseLower);
      const hasIntent = !intentLower || text.includes(intentLower);
      return hasDisease && hasIntent;
    };

    const MIN_SCORE = 0.52;
    // Apply strict semantic filtering first
    let strictPubs = scoredPubs.filter(p => p.compositeScore >= MIN_SCORE && hasSemanticOverlap(p));
    let lowRelevance = false;

    // Fallback strategy: Broaden to related domains if highly relevant results are insufficient
    let finalPubs = strictPubs;
    if (strictPubs.length < 6) {
      // Broaden search constraint - drop strict intent requirement but strictly require the disease domain
      const broadenedPubs = scoredPubs.filter(p => {
        if (p.compositeScore < MIN_SCORE) return false;
        const text = `${p.title} ${p.abstract}`.toLowerCase();
        return !diseaseLower || text.includes(diseaseLower);
      });
      
      finalPubs = broadenedPubs;
      lowRelevance = finalPubs.length < 4;
    } else {
      lowRelevance = strictPubs.length < 4;
    }
    
    const topPubs = finalPubs.slice(0, TOP_PUBLICATIONS);

    // Apply similar fallback logic to Clinical Trials
    let strictTrials = scoredTrials.filter(t => t.compositeScore >= MIN_SCORE && hasSemanticOverlap(t));
    let finalTrials = strictTrials;
    if (strictTrials.length < 6) {
      finalTrials = scoredTrials.filter(t => {
        if (t.compositeScore < MIN_SCORE) return false;
        const text = `${t.title} ${t.summary}`.toLowerCase();
        return !diseaseLower || text.includes(diseaseLower);
      });
    }
    const topTrials = finalTrials.slice(0, TOP_CLINICAL_TRIALS);


    // Indirect evidence detection: publications match the disease domain
    // but none directly address the user's specific query intent.
    // e.g., "Vitamin D + lung cancer" returns general lung cancer papers
    const indirectEvidence = this._detectIndirectEvidence(topPubs, expansion);

    console.log(`📊 Ranking: ${publications.length} pubs → top ${topPubs.length} | ${clinicalTrials.length} trials → top ${topTrials.length}${indirectEvidence ? ' [INDIRECT EVIDENCE]' : ''}`);

    return {
      publications: topPubs,
      clinicalTrials: topTrials,
      lowRelevance,
      indirectEvidence,
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
   * Detect when publications match the disease domain but NOT the specific query intent.
   * Returns false if direct evidence exists, or a descriptive object if only indirect evidence is available.
   */
  _detectIndirectEvidence(publications, expansion) {
    if (!publications.length || !expansion.intent || !expansion.disease) return false;
    
    const intentLower = (expansion.intent || '').toLowerCase().trim();
    const diseaseLower = (expansion.disease || '').toLowerCase().trim();
    const originalQuery = (expansion.originalQuery || '').toLowerCase().trim();

    // If the intent IS the disease (e.g., "lung cancer treatment"), no gap to detect
    if (intentLower === diseaseLower || intentLower.includes(diseaseLower)) return false;
    
    // Extract key intent-specific terms (exclude the disease name and common words)
    const commonWords = new Set(['the', 'for', 'with', 'and', 'can', 'take', 'my', 'current', 'treatment', 'therapy', 'latest', 'recent', 'new', 'best', 'what', 'how', 'does', 'about']);
    const intentTerms = originalQuery
      .split(/\s+/)
      .filter(w => w.length > 2 && !commonWords.has(w) && !diseaseLower.includes(w))
      .slice(0, 3);
    
    if (intentTerms.length === 0) return false;

    // Check how many publications directly mention the intent-specific terms
    let directMatches = 0;
    for (const pub of publications) {
      const text = `${pub.title} ${pub.abstract || ''}`.toLowerCase();
      const matchesIntent = intentTerms.some(term => text.includes(term));
      if (matchesIntent) directMatches++;
    }

    // If fewer than 25% of publications directly mention intent terms → indirect evidence
    const directRatio = directMatches / publications.length;
    if (directRatio < 0.25) {
      // Build a human-readable description of what the user was asking about
      const querySubject = this._extractQuerySubject(originalQuery, diseaseLower);
      const diseaseCapitalized = expansion.disease;

      return {
        isIndirect: true,
        queryIntent: querySubject,
        disease: diseaseCapitalized,
        directMatchCount: directMatches,
        totalCount: publications.length,
        message: `No ${diseaseCapitalized}–specific studies on ${querySubject} were found. The following insights are based on related oncology research and treatment context.`
      };
    }

    return false;
  }

  /**
   * Extract a clean, human-readable subject from the user's query.
   * e.g., "can i take vitamin d with my current treatment" → "Vitamin D"
   */
  _extractQuerySubject(query, diseaseLower) {
    // Strip common filler words and the disease name
    const fillers = /\b(can|i|take|with|my|current|the|a|an|is|it|does|do|how|what|about|for|and|or|of|in|on|to|this|that|these|those|should|would|could|will|treatment|therapy|medication|medicine|drug|during|after|before|while|safe|safety|ok|okay)\b/gi;
    let cleaned = query
      .replace(new RegExp(diseaseLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '')
      .replace(fillers, '')
      .replace(/[?.!,]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleaned || cleaned.length < 2) return 'this topic';

    // Capitalize first letter of each word for readability
    return cleaned
      .split(' ')
      .filter(w => w.length > 0)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
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
