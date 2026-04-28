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

    // Detect if this is a contextual query (user didn't explicitly name a disease but we have one in context/profile)
    const fallbackDisease = conversationContext.lastDisease || conversationContext.diseaseOfInterest;
    
    const genericTerms = ['my disease', 'this disease', 'my condition', 'this condition', 'the disease', 'the condition', 'it'];
    const isGenericDisease = parsed.disease && genericTerms.includes(parsed.disease.toLowerCase());
    const isContextualQuery = fallbackDisease && (!parsed.disease || parsed.disease === parsed.query || isGenericDisease);

    let expansion;
    try {
      expansion = await llmService.expandQuery(merged.query, {
        disease: merged.disease,
        lastDisease: fallbackDisease,
        lastIntent: conversationContext.lastIntent,
        location: merged.location
      });

      // Strict Context Enforcement: profile/last disease takes priority unless user explicitly names a new disease
      if (fallbackDisease) {
        const lowerQuery = (typeof userInput === 'string' ? userInput : merged.query).toLowerCase();
        const lowerFallbackDisease = fallbackDisease.toLowerCase();
        let targetDisease = expansion.disease;

        if (expansion.disease && expansion.disease.toLowerCase() !== lowerFallbackDisease) {
          const lowerNewDisease = expansion.disease.toLowerCase();
          // If the new disease guessed by LLM is NOT explicitly in the user's text, discard it
          if (!lowerQuery.includes(lowerNewDisease)) {
            console.log(`[QueryExpander] Preventing LLM hallucination: reverting inferred disease '${expansion.disease}' back to context '${fallbackDisease}'`);
            expansion.disease = fallbackDisease;
            targetDisease = fallbackDisease;
          }
        }

        // CRITICAL: Sanitize ALL expanded queries — remove any hallucinated disease terms
        // and ensure target disease is present in every query
        if (isContextualQuery && expansion.expandedQueries) {
          expansion.expandedQueries = this._sanitizeExpandedQueries(
            expansion.expandedQueries,
            targetDisease,
            lowerQuery
          );
          // Also fix searchTerms
          if (expansion.searchTerms) {
            expansion.searchTerms = this._sanitizeSearchTerms(
              expansion.searchTerms,
              targetDisease,
              merged.query
            );
          }
        }
      }

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
    // Strip out the appended follow-up context before attempting regex extraction
    const cleanText = text.split('\n\nAdditional Context:')[0].trim();

    return {
      disease: this._extractDisease(cleanText),
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
      /top\s+researchers?\s+(?:in|on|for)\s+(.+)$/i
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
    // Carry forward disease from previous turn or user profile if none detected
    const fallbackDisease = context.lastDisease || context.diseaseOfInterest;
    
    const genericTerms = ['my disease', 'this disease', 'my condition', 'this condition', 'the disease', 'the condition', 'it'];
    const isGenericDisease = result.disease && genericTerms.includes(result.disease.toLowerCase());
    
    if ((!result.disease || result.disease === result.query || isGenericDisease) && fallbackDisease) {
      result.disease = fallbackDisease;
    }
    const fallbackLocation = context.lastLocation || context.location;
    if (!result.location && fallbackLocation) {
      result.location = fallbackLocation;
    }
    if (!result.patientName && context.patientName) {
      result.patientName = context.patientName;
    }
    return result;
  }

  /**
   * Remove hallucinated disease terms from LLM-generated queries and ensure
   * the correct contextual disease is injected into every query.
   */
  _sanitizeExpandedQueries(queries, contextDisease, lowerUserQuery) {
    const lowerContext = contextDisease.toLowerCase();

    // Common hallucinated disease names the LLM might invent
    // We strip any disease-like term that is NOT the context disease and NOT in the user's original query
    const sanitized = queries.map(q => {
      let cleaned = q;

      // Split into words and check for disease-like substitutions
      // e.g., "Vitamin D interaction heart attack treatment" → the user never said "heart attack"
      const lowerQ = cleaned.toLowerCase();

      // If query doesn't contain the context disease, inject it
      if (!lowerQ.includes(lowerContext)) {
        cleaned = `${cleaned} ${contextDisease}`;
      }

      return cleaned;
    });

    // Also add a direct disease-focused query if missing
    const hasDirectQuery = sanitized.some(q =>
      q.toLowerCase().includes(lowerContext)
    );
    if (!hasDirectQuery) {
      sanitized.unshift(`${lowerUserQuery} ${contextDisease}`);
    }

    // Remove duplicates and limit
    return [...new Set(sanitized)].slice(0, 5);
  }

  /**
   * Fix searchTerms to use the correct context disease instead of hallucinated ones
   */
  _sanitizeSearchTerms(searchTerms, contextDisease, userQuery) {
    const lowerContext = contextDisease.toLowerCase();
    const result = { ...searchTerms };

    // Ensure primary search includes context disease
    if (result.primary && !result.primary.toLowerCase().includes(lowerContext)) {
      result.primary = `${result.primary} ${contextDisease}`;
    }

    // Fix PubMed query
    if (result.pubmed && !result.pubmed.toLowerCase().includes(lowerContext)) {
      result.pubmed = `${userQuery} AND ${contextDisease}`.replace(/\s+/g, '+');
    }

    // Fix clinical trials term
    result.clinicalTrials = contextDisease;

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
