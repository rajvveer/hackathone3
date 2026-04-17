const { MEDICAL_SYNONYMS } = require('../config/constants');
const llmService = require('./llmService');

// Patterns that indicate a researcher-focused query
const RESEARCHER_PATTERNS = [
  /top\s+researcher/i,
  /leading\s+expert/i,
  /best\s+scientist/i,
  /who\s+(?:studies|researches|works\s+on)/i,
  /experts?\s+in/i,
  /scientists?\s+(?:in|studying)/i,
  /prominent\s+(?:researcher|scientist)/i,
  /notable\s+(?:researcher|scientist|author)/i,
  /pioneers?\s+in/i,
];

class QueryExpander {
  /**
   * Expand a user query into optimized search terms for all 3 APIs.
   * Strategy: LLM-powered expansion first, fallback to rule-based.
   */
  async expand(userInput, conversationContext = {}) {
    const startTime = Date.now();
    const parsed = this._parseInput(userInput);
    const merged = this._mergeWithContext(parsed, conversationContext);

    // Detect researcher queries before LLM call
    const isResearcherQuery = this._isResearcherQuery(
      typeof userInput === 'string' ? userInput : (userInput.query || userInput.disease || '')
    );

    let expansion;
    try {
      expansion = await llmService.expandQuery(merged.query, {
        disease: merged.disease,
        lastDisease: conversationContext.lastDisease,
        lastIntent: conversationContext.lastIntent,
        location: merged.location
      });
    } catch (e) {
      console.log('LLM expansion failed, using rule-based fallback');
      expansion = this._ruleBasedExpansion(merged);
    }

    const enriched = this._enrichWithSynonyms(expansion);

    return {
      ...enriched,
      isResearcherQuery,
      location: merged.location,
      patientName: merged.patientName,
      originalQuery: typeof userInput === 'string' ? userInput : merged.query,
      timeMs: Date.now() - startTime
    };
  }

  /**
   * Detect researcher-focused queries ("top researchers in Alzheimer's disease")
   */
  _isResearcherQuery(text) {
    return RESEARCHER_PATTERNS.some(pattern => pattern.test(text));
  }

  /**
   * Parse structured object or free-text string
   */
  _parseInput(input) {
    if (typeof input === 'object' && input.disease) {
      return {
        disease: input.disease,
        query: input.query || input.disease,
        location: input.location || '',
        patientName: input.patientName || ''
      };
    }

    const text = typeof input === 'string' ? input : input.message || '';
    return {
      disease: this._extractDisease(text),
      query: text,
      location: this._extractLocation(text),
      patientName: ''
    };
  }

  /**
   * Extract disease name from natural language using synonym table and patterns
   */
  _extractDisease(text) {
    const lowerText = text.toLowerCase();

    for (const [key, synonyms] of Object.entries(MEDICAL_SYNONYMS)) {
      if (lowerText.includes(key)) return key;
      for (const syn of synonyms) {
        if (lowerText.includes(syn.toLowerCase())) return key;
      }
    }

    const patterns = [
      /(?:for|about|on|regarding|treat(?:ing|ment)s?\s+(?:for|of))\s+(.+?)(?:\s+(?:treatment|therapy|drug|study|trial|research))?$/i,
      /^(?:latest|recent|new|current)\s+(?:treatment|therapy|research|studies?)\s+(?:for|on|in)\s+(.+)$/i,
      /clinical\s+trials?\s+(?:for|on)\s+(.+)$/i,
      /top\s+researchers?\s+(?:in|on|for)\s+(.+)$/i,
      /(.+?)\s+(?:treatment|therapy|clinical trial|research|study|drugs?)/i
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) return match[1].trim();
    }

    return text;
  }

  /**
   * Extract location mentions from free text
   */
  _extractLocation(text) {
    const patterns = [
      /(?:in|near|around|at)\s+([\w\s,]+(?:canada|usa|us|uk|india|germany|france|australia|japan|china|brazil|toronto|new york|london|boston|california|texas|chicago|houston|los angeles|seattle))/i,
      /location:\s*(.+?)(?:\.|$)/i
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1].trim();
    }
    return '';
  }

  /**
   * Merge parsed values with conversation context for follow-up handling
   */
  _mergeWithContext(parsed, context) {
    const result = { ...parsed };
    // Carry forward disease from previous turn if none detected
    if ((!result.disease || result.disease === result.query) && context.lastDisease) {
      result.disease = context.lastDisease;
    }
    if (!result.location && context.lastLocation) {
      result.location = context.lastLocation;
    }
    return result;
  }

  /**
   * Rule-based fallback expansion (no LLM required)
   */
  _ruleBasedExpansion(merged) {
    const { disease, query } = merged;
    const expandedQueries = [];

    if (disease && disease !== query) {
      expandedQueries.push(`${query} ${disease}`);
    }
    expandedQueries.push(query);

    const lowerDisease = disease.toLowerCase();
    if (MEDICAL_SYNONYMS[lowerDisease]) {
      const mainSynonym = MEDICAL_SYNONYMS[lowerDisease][0];
      expandedQueries.push(`${query} ${mainSynonym}`);
    }

    return {
      disease,
      intent: query,
      expandedQueries: [...new Set(expandedQueries)],
      searchTerms: {
        primary: disease !== query ? `${query} ${disease}` : query,
        pubmed: (disease !== query ? `${query} AND ${disease}` : query).replace(/\s+/g, '+'),
        clinicalTrials: disease
      }
    };
  }

  /**
   * Enrich LLM expansion with synonym-based additional queries
   */
  _enrichWithSynonyms(expansion) {
    const enrichedQueries = [...(expansion.expandedQueries || [])];
    const disease = (expansion.disease || '').toLowerCase();

    if (MEDICAL_SYNONYMS[disease]) {
      for (const synonym of MEDICAL_SYNONYMS[disease].slice(0, 2)) {
        const intent = expansion.intent || expansion.disease;
        if (intent && intent.toLowerCase() !== disease) {
          enrichedQueries.push(`${intent} ${synonym}`);
        } else {
          enrichedQueries.push(synonym);
        }
      }
    }

    return {
      ...expansion,
      expandedQueries: [...new Set(enrichedQueries)].slice(0, 5)
    };
  }
}

module.exports = new QueryExpander();
