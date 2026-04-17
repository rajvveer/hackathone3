const Groq = require('groq-sdk');
const axios = require('axios');
const { MODELS } = require('../config/constants');

class LLMService {
  constructor() {
    this.provider = process.env.LLM_PROVIDER || 'groq';
    this.ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';

    if (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== 'your_groq_api_key_here') {
      this.groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    }
  }

  /**
   * Standard (non-streaming) generation
   */
  async generate(prompt, { model = MODELS.REASONING, systemPrompt = '', temperature = 0.3, maxTokens = 4096, jsonMode = false } = {}) {
    try {
      if (this.groq && this.provider === 'groq') {
        return await this._groqGenerate(prompt, { model, systemPrompt, temperature, maxTokens, jsonMode });
      }
      return await this._ollamaGenerate(prompt, { model: 'llama3', systemPrompt, temperature });
    } catch (error) {
      console.error(`LLM error (${this.provider}):`, error.message);
      if (this.provider === 'groq') {
        console.log('⚠️  Groq failed — trying Ollama fallback...');
        try {
          return await this._ollamaGenerate(prompt, { model: 'llama3', systemPrompt, temperature });
        } catch (ollamaErr) {
          console.error('❌ Ollama also failed:', ollamaErr.message);
        }
      }
      throw new Error('All LLM providers failed. Set GROQ_API_KEY or start Ollama with: ollama run llama3');
    }
  }

  /**
   * Groq standard completion
   */
  async _groqGenerate(prompt, { model, systemPrompt, temperature, maxTokens, jsonMode }) {
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });

    const params = { model, messages, temperature, max_tokens: maxTokens };
    if (jsonMode) params.response_format = { type: 'json_object' };

    const completion = await this.groq.chat.completions.create(params);
    return completion.choices[0]?.message?.content || '';
  }

  /**
   * Ollama local generation
   */
  async _ollamaGenerate(prompt, { model, systemPrompt, temperature }) {
    const response = await axios.post(`${this.ollamaUrl}/api/generate`, {
      model,
      prompt: systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt,
      stream: false,
      options: { temperature }
    }, { timeout: 120000 });

    return response.data.response || '';
  }

  /**
   * Classify user query intent to prevent conversational/general queries from entering the heavy medical pipeline.
   */
  async classifyQuery(userQuery) {
    const systemPrompt = `You are an intent classifier for Curalink, an AI Medical Research Assistant.
Your task is to determine if the user's input requires fetching external medical research.

RULES:
- If the query asks about symptoms, diseases, medications, research, clinical trials, or any medical condition, it REQUIRES research.
- If it is a simple greeting (e.g., "hi", "hey"), conversational ("who are you"), or non-medical, it DOES NOT require research.

Respond ONLY in valid JSON format:
{
  "requiresResearch": boolean,
  "response": "If requiresResearch is false, provide a friendly conversational response here. E.g., 'Hello! I am Curalink, an AI Medical Research Assistant. How can I help you with your health or research questions today?'. If true, leave empty."
}`;

    const prompt = `User Input: "${userQuery}"`;
    try {
      const result = await this.generate(prompt, {
        model: MODELS.QUERY_EXPANSION, // use fast model
        systemPrompt,
        temperature: 0.1,
        maxTokens: 256,
        jsonMode: true
      });
      return JSON.parse(result);
    } catch (e) {
      console.error('Classification LLM failed:', e.message);
      const isGreeting = /^(hi|hello|hey|greetings|what'?s up)[.!]?\s*$/i.test(userQuery.trim());
      return {
        requiresResearch: !isGreeting,
        response: isGreeting ? "Hello! How can I assist you with your medical research today?" : ""
      };
    }
  }

  /**
   * Query expansion — uses fast 8B model
   */
  async expandQuery(userQuery, context = {}) {
    const systemPrompt = `You are a medical query expansion engine. Given a user's medical query and context, generate expanded search terms for retrieving research publications and clinical trials.

RULES:
- CRITICAL: Determine if the user is describing SYMPTOMS or asking about a SPECIFIC DISEASE.
- If the user describes SYMPTOMS (e.g., "headache and nausea", "I feel dizzy", "chest pain"):
  - Set "isSymptomQuery" to true
  - Set "disease" to the PRIMARY symptom(s) mentioned (e.g., "headache and nausea"), NOT a guessed disease
  - Generate expanded queries that search for the symptoms and their MULTIPLE possible causes
  - Include queries for differential diagnosis of those symptoms
  - DO NOT assume or lock onto a single disease — symptoms can have many causes
- If the user asks about a SPECIFIC DISEASE (e.g., "Alzheimer's treatment", "lung cancer"):
  - Set "isSymptomQuery" to false
  - Set "disease" to the identified disease name
  - Generate queries specific to that disease
- Add medical synonyms and related terms
- Generate 3-5 search query variants
- If a follow-up question, incorporate previous disease/context
- Output ONLY valid JSON, no markdown`;

    const prompt = `User Query: "${userQuery}"
Disease Context: "${context.disease || 'not specified'}"
Previous Disease: "${context.lastDisease || 'none'}"
Previous Intent: "${context.lastIntent || 'none'}"
Location: "${context.location || 'not specified'}"

Generate expanded search queries as JSON:
{
  "disease": "the specific disease name OR the symptom(s) described by the user",
  "isSymptomQuery": true/false,
  "intent": "what the user wants to know",
  "expandedQueries": ["query1", "query2", "query3", "query4"],
  "searchTerms": {
    "primary": "main search term",
    "pubmed": "optimized PubMed search (use AND/OR for combining terms)",
    "clinicalTrials": "condition term for ClinicalTrials.gov"
  }
}`;

    try {
      const result = await this.generate(prompt, {
        model: MODELS.QUERY_EXPANSION,
        systemPrompt,
        temperature: 0.2,
        maxTokens: 1024,
        jsonMode: true
      });
      return JSON.parse(result);
    } catch (e) {
      console.error('Query expansion LLM failed:', e.message);
      return this._basicExpansion(userQuery, context);
    }
  }

  _basicExpansion(query, context) {
    const disease = context.disease || context.lastDisease || '';
    const combined = disease ? `${query} ${disease}` : query;
    return {
      disease: disease || query,
      intent: query,
      expandedQueries: [combined, query, disease].filter(Boolean),
      searchTerms: {
        primary: combined,
        pubmed: combined.replace(/\s+/g, '+'),
        clinicalTrials: disease || query
      }
    };
  }

  /**
   * Generate conversation title (short, via fast model)
   */
  async generateTitle(disease, intent) {
    try {
      const result = await this.generate(
        `Generate a short (max 6 words) title for a medical research conversation about: "${intent}" for "${disease}". Just the title, nothing else.`,
        { model: MODELS.TITLE_GEN, temperature: 0.3, maxTokens: 30 }
      );
      return result.trim().replace(/^["']|["']$/g, '').substring(0, 60);
    } catch {
      return disease ? `${disease} Research` : 'Medical Research';
    }
  }

  /**
   * Medical reasoning — uses large 70B model, returns structured JSON
   */
  async generateMedicalResponse(userQuery, context, publications, clinicalTrials, conversationHistory = [], researchers = []) {
    const isSymptomQuery = context.isSymptomQuery || false;

    const systemPrompt = `You are Curalink, an advanced AI Medical Research Assistant powered by evidence-based research. You provide structured, citation-backed medical research insights.

CRITICAL RULES:
1. ONLY reference information from the provided research data — never hallucinate facts
2. Always cite specific study titles, authors, and years [Author et al., Year]
3. Personalize based on the user's disease context and query
4. Always include a disclaimer to consult healthcare providers
5. Be thorough but accessible — explain medical terms
6. If data is limited, acknowledge it
7. Respond in valid JSON format ONLY
8. IMPORTANT: If the user described SYMPTOMS (not a specific disease), your "conditionOverview" MUST discuss MULTIPLE possible conditions/causes for those symptoms — provide a differential diagnosis approach. NEVER fixate on a single disease when the user only described symptoms.`;

    const pubsSummary = publications.slice(0, 8).map((p, i) =>
      `[${i + 1}] "${p.title}" — ${(p.authors || []).slice(0, 2).join(', ')}${(p.authors || []).length > 2 ? ' et al.' : ''} (${p.year}) [${p.source}]
   Journal: ${p.sourceJournal || 'N/A'}
   Abstract: ${(p.abstract || 'No abstract').substring(0, 250)}...
   URL: ${p.url || 'N/A'}`
    ).join('\n\n');

    const trialsSummary = clinicalTrials.slice(0, 6).map((t, i) =>
      `[${i + 1}] "${t.title}"
   Status: ${t.status} | Phase: ${t.phase || 'N/A'}
   Location: ${(t.location || 'N/A').substring(0, 100)}
   Eligibility: ${(t.eligibility || 'N/A').substring(0, 200)}
   Contact: ${t.contact || 'N/A'}
   URL: ${t.url || 'N/A'}`
    ).join('\n\n');

    const researchersSummary = researchers.length > 0
      ? researchers.slice(0, 5).map((r, i) =>
        `[${i + 1}] ${r.name} — ${r.institution} (${r.citationCount?.toLocaleString()} citations, h-index: ${r.hIndex})`
      ).join('\n')
      : '';

    const historyText = conversationHistory.slice(-4).map(m =>
      `${m.role.toUpperCase()}: ${m.content.substring(0, 200)}`
    ).join('\n');

    const symptomGuidance = isSymptomQuery
      ? `\nIMPORTANT: The user described SYMPTOMS, not a specific disease. You MUST:
- List multiple possible conditions that could cause these symptoms (differential diagnosis)
- Explain when each condition is more likely
- Do NOT focus on just one disease
- In keyFindings, include findings about DIFFERENT possible causes`
      : '';

    const prompt = `USER CONTEXT:
- Patient: ${context.patientName || 'Not specified'}
- Disease/Symptoms: ${context.disease || 'Not specified'}
- Query Type: ${isSymptomQuery ? 'SYMPTOM-BASED (provide differential diagnosis with multiple possible causes)' : 'DISEASE-SPECIFIC'}
- Query: "${userQuery}"
- Location: ${context.location || 'Not specified'}
${symptomGuidance}

CONVERSATION HISTORY:
${historyText || 'First message in conversation'}

RESEARCH PUBLICATIONS (${publications.length} retrieved, showing top ${Math.min(publications.length, 8)}):
${pubsSummary || 'No publications found for this query.'}

CLINICAL TRIALS (${clinicalTrials.length} retrieved, showing top ${Math.min(clinicalTrials.length, 6)}):
${trialsSummary || 'No clinical trials found for this query.'}
${researchersSummary ? `\nTOP RESEARCHERS:\n${researchersSummary}` : ''}

Based on the above research data, provide a highly concise, personalized medical research analysis. Keep answers brief to ensure fast reading. Respond ONLY in this exact JSON format:
{
  "conditionOverview": "${isSymptomQuery ? '1 short paragraph: concise differential diagnosis listing 2-3 possible causes.' : '1 short paragraph: extremely concise overview of the condition (3-4 sentences max)'}",
  "researchInsights": "1 short paragraph: strictly the key statistical or treatment findings from the publications. Very brief.",
  "clinicalTrialsSummary": "3-4 concise sentences summarizing the most relevant trials",
  "personalizedRecommendation": "1 brief paragraph tailored specifically to this user's context. End with a 1-sentence medical disclaimer.",
  "keyFindings": ["Finding 1 [Author, Year]", "Finding 2"]
}`;

    try {
      const result = await this.generate(prompt, {
        model: MODELS.REASONING, // Typically llama-3.3-70b-versatile
        systemPrompt,
        temperature: 0.2, // slightly lower temp for faster, more direct info
        maxTokens: 1024,  // Huge cutoff to enforce sub-10 second speed limits
        jsonMode: true
      });

      return JSON.parse(result);
    } catch (e) {
      console.error('Medical reasoning failed:', e.message);
      // Structured fallback without LLM
      return {
        conditionOverview: `Based on analysis of ${publications.length} research publications and ${clinicalTrials.length} clinical trials related to "${userQuery}", here is what current research shows.`,
        researchInsights: publications.slice(0, 4).map(p =>
          `• "${p.title}" (${p.year}) — ${(p.abstract || '').substring(0, 150)}...`
        ).join('\n\n') || 'Research data is being processed.',
        clinicalTrialsSummary: clinicalTrials.slice(0, 3).map(t =>
          `• "${t.title}" — Status: ${t.status}, Phase: ${t.phase || 'N/A'}`
        ).join('\n\n') || 'No clinical trials data available.',
        personalizedRecommendation: 'Please consult with a qualified healthcare provider for personalized medical advice based on these research findings.',
        keyFindings: publications.slice(0, 4).map(p => `${p.title} (${p.year})`)
      };
    }
  }
}

module.exports = new LLMService();
