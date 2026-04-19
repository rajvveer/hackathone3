const Groq = require('groq-sdk');
const { toFile } = require('groq-sdk');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
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

    // Prevent Groq from hanging indefinitely on rate limits or API outages
    const completion = await this.groq.chat.completions.create(params, { timeout: 10000 });
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
    }, { timeout: 30000 }); // Fail fast if local Ollama is hanging

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
   * Generate follow-up clarifying questions for a medical query.
   * If the query is detailed enough, it bypasses clarification.
   */
  async generateFollowUpQuestions(userQuery) {
    const systemPrompt = `You are a medical intake assistant for Curalink, an AI Medical Research Assistant.
Your job is to analyze the user's query and decide if it provides enough specific context to run a detailed medical research pipeline (PubMed and Clinicaltrials.gov).

RULES:
1. "needsClarification" must be FALSE if the query specifies WHAT they are looking for (e.g., "Latest treatment for lung cancer", "clinical trials for diabetes", "causes of headache", "research on asthma"). The AI pipeline is powerful enough to handle these!
2. "needsClarification" should ONLY be TRUE if the query is extremely vague, just a lone symptom, or just a disease name (e.g., "headache", "lung cancer", "my stomach hurts", "pain").
3. If needsClarification is true, generate exactly 3-4 follow-up questions to gather more context.
4. Each generated question should have 4-5 clickable options. Options should be short (2-6 words max).
5. For vague queries, cover these areas IN ORDER:
   - What specifically they want to know (treatments, research, trials, causes)
   - Who is this for (age group/patient context)
   - Any specific aspect or subtype
   - Geographic preference for trials (optional)
6. Respond ONLY in valid JSON. No markdown.`;

    const prompt = `User Query: "${userQuery}"

Generate JSON response:
{
  "needsClarification": true or false,
  "questions": [
    {
      "question": "What would you like to know about [topic]?",
      "options": ["Option 1", "Option 2", "Option 3", "Option 4"]
    }
  ]
}`;

    try {
      const result = await this.generate(prompt, {
        model: MODELS.QUERY_EXPANSION,
        systemPrompt,
        temperature: 0.3,
        maxTokens: 1024,
        jsonMode: true
      });
      const parsed = JSON.parse(result);
      return parsed;
    } catch (e) {
      console.error('Follow-up question generation failed:', e.message);
      // Fallback: generic questions
      return {
        questions: [
          {
            question: `What would you like to know about "${userQuery}"?`,
            options: ['Latest treatments', 'Recent research', 'Clinical trials', 'Causes & prevention', 'Diagnosis methods']
          },
          {
            question: 'Who is this research for?',
            options: ['Myself (adult)', 'Child/pediatric', 'Elderly parent', 'General research', 'Medical professional']
          },
          {
            question: 'What type of information is most important?',
            options: ['Evidence-based studies', 'Treatment comparisons', 'Side effects & risks', 'Expert opinions', 'Patient outcomes']
          }
        ]
      };
    }
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
  "keyFindings": ["Finding 1 [Author, Year]", "Finding 2"],
  "suggestedQuestions": ["Follow up question 1?", "Follow up question 2?", "Follow up question 3?"]
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
        keyFindings: publications.slice(0, 4).map(p => `${p.title} (${p.year})`),
        suggestedQuestions: [
          `Are there any active clinical trials for ${userQuery}?`,
          `What are the most recent treatment breakthroughs?`,
          `Can you find top researchers studying this?`
        ]
      };
    }
  }

  /**
   * Generates a streaming voice response.
   * Yields text chunks instantly as they arrive from Groq.
   */
  async *generateVoiceResponseStream(query, publications = [], clinicalTrials = [], conversationHistory = []) {
    if (!this.groq) throw new Error('Groq client not initialized for streaming');

    const systemPrompt = `You are Dr. Curalink, a highly skilled AI medical research physician in a real-time voice consultation.

YOUR PERSONALITY:
- Warm, confident, empathetic — like a senior doctor in a clinic
- Use simple language anyone can understand
- Sound natural and human, like a real conversation

HOW TO ANSWER:
1. Briefly acknowledge their question (1 sentence)
2. Give a clear overview of the topic (2-3 sentences)
3. Share 2-3 KEY INSIGHTS from the research — describe WHAT was found, not WHO found it. Say things like "Recent studies show that..." or "New research suggests..." NEVER read out author names, journal names, or study titles
4. If relevant trials exist, mention them generally: "There are active clinical trials exploring this approach"
5. End with ONE short follow-up question giving the patient choices

CRITICAL VOICE RULES:
- SHORT clear sentences (under 20 words). End every sentence with a period.
- NO markdown, NO asterisks, NO bullet points, NO numbered lists, NO special characters
- NEVER read out author names, paper titles, or institution names — just describe the findings
- Keep response 120-180 words
- This is SPOKEN output — it must sound natural when read aloud by TTS

NEVER REPEAT YOURSELF:
- If you have already discussed something in the conversation history, do NOT say it again
- For follow-up questions, provide NEW details, different angles, or deeper explanations
- If the patient asks about something you already covered, go DEEPER — mention specific mechanisms, dosages, trial phases, regional availability, or practical next steps
- NEVER say "as I mentioned" and then repeat the same content`;

    // Provide research context WITHOUT author names to prevent AI from reading them
    const pubContext = publications.slice(0, 5).map((p, i) =>
      `${i + 1}. Finding: ${p.title} (${p.year || 'Recent'}) — ${p.abstract?.substring(0, 200) || 'No details'}`
    ).join('\n');

    const trialContext = clinicalTrials.slice(0, 3).map((t, i) =>
      `${i + 1}. Trial: ${t.title} — Phase: ${t.phase || 'N/A'}, Status: ${t.status}`
    ).join('\n');

    // Build history context with clear "already said" markers
    let historyContext = '';
    if (conversationHistory.length > 0) {
      const prevAssistantMsgs = conversationHistory
        .filter(m => m.role === 'assistant')
        .map(m => m.content);

      historyContext = `\nConversation so far:\n${conversationHistory.map(m => `${m.role}: ${m.content}`).join('\n')}`;

      if (prevAssistantMsgs.length > 0) {
        historyContext += `\n\n⚠️ YOU ALREADY SAID THE FOLLOWING — do NOT repeat any of this:\n${prevAssistantMsgs.join('\n---\n')}`;
      }
    }

    const prompt = `Patient asked: "${query}"
${historyContext}

=== RESEARCH FINDINGS (for your reference only — do NOT read these verbatim) ===
Key publications (${publications.length} found):
${pubContext || 'None found'}

Clinical Trials (${clinicalTrials.length} found):
${trialContext || 'None found'}

Analyze these findings and respond as Dr. Curalink. Provide NEW information you haven't covered yet. Do NOT repeat previous answers. End with a short follow-up question.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ];

    try {
      const stream = await this.groq.chat.completions.create({
        model: MODELS.VOICE || 'llama-3.1-8b-instant',
        messages,
        temperature: 0.6,
        max_tokens: 800,
        stream: true,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          yield content.replace(/[*_#`~\[\]]/g, '');
        }
      }
    } catch (e) {
      console.error('Voice LLM Stream error:', e.message);
      yield " I'm sorry, I encountered a technical issue. Could you please repeat your question? ";
    }
  }

  /**
   * Analyze extracted text from a medical document (PDF or image).
   * Returns structured analysis with key findings, abnormal values, etc.
   */
  async analyzeMedicalDocument(extractedText, userQuery = '') {
    const systemPrompt = `You are Curalink, an advanced AI Medical Document Analyzer. A user has uploaded a medical document (lab report, prescription, discharge summary, radiology report, etc.) and you need to provide a thorough, structured analysis.

CRITICAL RULES:
1. ONLY analyze what is actually present in the document text — never hallucinate values
2. Identify the document type accurately
3. Highlight ANY abnormal or critical values with clear explanations
4. Use simple language that patients can understand
5. Always include a disclaimer to consult healthcare providers
6. If the document is unclear or partial, acknowledge limitations
7. Respond in valid JSON format ONLY`;

    const prompt = `EXTRACTED DOCUMENT TEXT:
---
${extractedText.substring(0, 4000)}
---

${userQuery ? `USER'S SPECIFIC QUESTION: "${userQuery}"` : 'No specific question — provide a full analysis.'}

Analyze this medical document and respond ONLY in this exact JSON format:
{
  "documentType": "Type of document (e.g., Complete Blood Count Report, Prescription, Discharge Summary, MRI Report, etc.)",
  "summary": "2-3 sentence plain-language summary of what this document shows",
  "keyFindings": [
    {
      "parameter": "Test/Parameter name",
      "value": "The value found",
      "referenceRange": "Normal range if available",
      "status": "normal | elevated | low | critical",
      "explanation": "What this means in simple terms"
    }
  ],
  "abnormalValues": ["List of any concerning or out-of-range findings with brief explanation"],
  "medications": ["List of any medications mentioned with dosages if available"],
  "recommendations": "Brief personalized recommendation based on the findings. End with a medical disclaimer.",
  "suggestedResearchTopics": ["2-3 medical topics the user might want to research based on this document"]
}`;

    try {
      const result = await this.generate(prompt, {
        model: MODELS.REASONING,
        systemPrompt,
        temperature: 0.15,
        maxTokens: 2048,
        jsonMode: true
      });

      return JSON.parse(result);
    } catch (e) {
      console.error('Medical document analysis failed:', e.message);
      return {
        documentType: 'Medical Document',
        summary: `Analysis of uploaded document (${extractedText.length} characters extracted). The AI was unable to produce a structured analysis. Please review the extracted text below.`,
        keyFindings: [],
        abnormalValues: [],
        medications: [],
        recommendations: 'Please consult with a qualified healthcare provider for a professional interpretation of this document.',
        suggestedResearchTopics: [],
        rawExtractedText: extractedText.substring(0, 2000)
      };
    }
  }

  /**
   * Transcribe audio buffer using Groq Whisper.
   * Saves to temp file first for reliable file handling.
   */
  async transcribeAudio(audioBuffer, filename = 'audio.webm') {
    if (!this.groq) throw new Error('Groq client not initialized');

    const tmpPath = path.join(os.tmpdir(), `curalink_voice_${Date.now()}.webm`);
    fs.writeFileSync(tmpPath, audioBuffer);
    console.log(`🎤 Saved temp audio: ${tmpPath} (${audioBuffer.length} bytes)`);

    try {
      const transcription = await this.groq.audio.transcriptions.create({
        file: fs.createReadStream(tmpPath),
        model: 'whisper-large-v3-turbo',
        response_format: 'text',
        language: 'en',
      });

      return typeof transcription === 'string' ? transcription : transcription.text || '';
    } finally {
      // Clean up temp file
      try { fs.unlinkSync(tmpPath); } catch (_) { }
    }
  }
  /**
   * Evaluate if a user matches a clinical trial's eligibility criteria
   */
  async evaluateEligibility(trialCriteria, userContext, additionalContext = '') {
    if (!this.groq) throw new Error('Groq client not initialized');

    // Only pass relevant fields to avoid sending unnecessary data
    const safeContext = {
      disease: userContext.disease,
      context: userContext.context || '',
      additionalNotes: userContext.structuredData?.query || '',
      patientName: userContext.structuredData?.patientName || 'Patient',
      userDirectAnswers: additionalContext // User's direct answers to follow up questions
    };

    const prompt = `You are an expert Clinical Trial Coordinator AI.
Based on the following Clinical Trial Eligibility Criteria and the User's Context, determine if the user is likely eligible (True) or ineligible (False). 

CRITICAL RULE: If the user is missing CRITICAL information that is strictly required to determine eligibility (e.g., exact age, cancer stage, specific prior treatments), you must return "isEligible": false, explain what is missing in the reasoning, and provide exactly 1-2 short "missingQuestions" the user needs to answer.

[User Context]
${JSON.stringify(safeContext, null, 2)}

[Trial Eligibility Criteria]
${trialCriteria.substring(0, 3000)}

Respond ONLY in strictly valid JSON format matching this exact schema:
{
  "isEligible": boolean,
  "reasoning": "A simple 2-sentence explanation.",
  "missingQuestions": ["Array of 1 to 2 direct questions for the user, only if critical info is missing. Empty array if info is sufficient."]
}`;

    try {
      const response = await this.groq.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: MODELS.QUERY_EXPANSION,
        temperature: 0.1,
        response_format: { type: 'json_object' }
      });

      return JSON.parse(response.choices[0]?.message?.content || '{"isEligible": true, "reasoning": "Insufficient context to completely rule out eligibility. Recommend discussing with your provider."}');
    } catch (error) {
      console.error('LLM Eligibility Error:', error.message);
      return { isEligible: true, reasoning: 'Could not automatically determine eligibility. Please review criteria manually.' };
    }
  }

  geoCoordsCache = new Map();

  /**
   * Extract approximate coordinates for an array of location strings
   */
  async extractCoordinatesBatch(locationsList) {
    if (!this.groq || !locationsList || locationsList.length === 0) return [];

    const results = [];
    const uncached = [];

    for (const loc of locationsList) {
      if (this.geoCoordsCache.has(loc)) {
        const cached = this.geoCoordsCache.get(loc);
        if (cached) results.push({ location: loc, lat: cached.lat, lng: cached.lng });
      } else {
        uncached.push(loc);
      }
    }

    if (uncached.length === 0) return results;

    const prompt = `You are a geographical coordinate extractor. Given a list of location strings (e.g. cities, hospitals), return approximate latitude and longitude coordinates for each. Keep original strings matching perfectly.

Locations: ${JSON.stringify(uncached)}

Return ONLY valid JSON matching this schema:
{
  "coordinates": [
    { "location": "string", "lat": number, "lng": number }
  ]
}`; // keep prompt formatting

    try {
      const response = await this.groq.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: MODELS.QUERY_EXPANSION,
        temperature: 0,
        response_format: { type: "json_object" }
      });
      const parsed = JSON.parse(response.choices[0]?.message?.content || '{"coordinates":[]}');
      const newCoords = parsed.coordinates || [];

      newCoords.forEach(c => {
        if (c && c.location) {
          this.geoCoordsCache.set(c.location, { lat: c.lat, lng: c.lng });
          results.push(c);
        }
      });
      return results;
    } catch (err) {
      console.error('LLM Coordinate Extractor Error:', err.message);
      return results; // Return whatever we found in cache
    }
  }
}
module.exports = new LLMService();
