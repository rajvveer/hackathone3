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

    try {
      // Prevent Groq from hanging indefinitely on rate limits or API outages
      const completion = await this.groq.chat.completions.create(params, { timeout: 10000 });
      return completion.choices[0]?.message?.content || '';
    } catch (error) {
      // Some responses fail Groq's strict JSON validator even with json_object mode.
      // Retry once without strict response_format and salvage JSON from the output.
      if (jsonMode && this._isJsonValidationError(error)) {
        const retryMessages = [];
        if (systemPrompt) retryMessages.push({ role: 'system', content: systemPrompt });
        retryMessages.push({
          role: 'system',
          content: 'Return ONLY one valid JSON object. No markdown, no prose, no code fences, no trailing text.'
        });
        retryMessages.push({ role: 'user', content: prompt });

        const retryCompletion = await this.groq.chat.completions.create({
          model,
          messages: retryMessages,
          temperature: 0,
          max_tokens: maxTokens
        }, { timeout: 10000 });

        const retryContent = retryCompletion.choices[0]?.message?.content || '';
        return this._extractJsonObject(retryContent);
      }
      throw error;
    }
  }

  _isJsonValidationError(error) {
    const msg = (error && (error.message || String(error))) || '';
    return msg.includes('json_validate_failed') || msg.includes('Failed to validate JSON');
  }

  _extractJsonObject(text) {
    if (!text || typeof text !== 'string') return '{}';
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return '{}';
    return text.slice(start, end + 1);
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
- CRITICAL FOLLOW-UP RULE: If "Previous Disease" is NOT "none", the user is continuing a conversation about that disease. Words like "my treatment", "my condition", "current treatment", "this cancer" ALL refer to the Previous Disease. You MUST:
  1. Set "disease" to EXACTLY the Previous Disease value
  2. Include the Previous Disease name in EVERY expanded query
  3. NEVER substitute a different disease — if the user says "my treatment", that means the Previous Disease's treatment
  4. Example: If Previous Disease is "lung cancer" and user asks "Can I take Vitamin D with my current treatment", generate queries like "Vitamin D interaction lung cancer treatment", "Vitamin D supplementation NSCLC", etc.
- For supplement or interaction queries, always generate terms combining the supplement + disease + treatment type + safety/interaction/dosage intent
- CRITICAL: Generate ONLY terse medical keyword queries (e.g., "Vitamin D interaction lung cancer"). NEVER include conversational phrasing like "Can I take", "What is", or "How to".
- CRITICAL: If the user asks about a treatment/supplement but does NOT name a disease, AND "Previous Disease" is "none", you MUST set "disease" to an empty string "". NEVER hallucinate or guess a disease (like "heart attack") if it is not explicitly mentioned or provided in the context.
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

    const indirectGuidance = context.indirectEvidence && context.indirectEvidence.isIndirect
      ? `\nIMPORTANT — INDIRECT EVIDENCE DETECTED: The research database did not return publications directly addressing the user's specific query ("${userQuery}"). The publications shown are general ${context.disease || 'medical'} research provided as background context. You MUST:
- In "conditionOverview": Briefly acknowledge that direct research on the user's specific question is limited in current databases, then provide relevant general context about ${context.disease}
- In "researchInsights": Clearly state that the publications below are general ${context.disease} research, not specific to the user's exact question. Still summarize their key findings as useful background
- In "personalizedRecommendation": Emphasize that due to limited direct evidence, consulting a healthcare provider is especially important for this specific question
- Do NOT pretend the publications directly address the user's question — be transparent about the evidence gap`
      : '';

    const prompt = `USER CONTEXT:
- Patient: ${context.patientName || 'Not specified'}
- Disease/Symptoms: ${context.disease || 'Not specified'}
- Query Type: ${isSymptomQuery ? 'SYMPTOM-BASED (provide differential diagnosis with multiple possible causes)' : 'DISEASE-SPECIFIC'}
- Query: "${userQuery}"
- Location: ${context.location || 'Not specified'}
${symptomGuidance}${indirectGuidance}

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

      const parsed = JSON.parse(result);
      return {
        conditionOverview: parsed.conditionOverview || `Based on the latest data, here is an overview of research regarding "${userQuery}".`,
        researchInsights: parsed.researchInsights || 'Research insights are currently being compiled.',
        clinicalTrialsSummary: parsed.clinicalTrialsSummary || (clinicalTrials.length > 0 ? `Found ${clinicalTrials.length} relevant clinical trials.` : ''),
        personalizedRecommendation: parsed.personalizedRecommendation || 'Please consult your healthcare provider for specific guidance.',
        keyFindings: parsed.keyFindings || publications.slice(0, 3).map(p => `${p.title} (${p.year})`),
        suggestedQuestions: parsed.suggestedQuestions || []
      };
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

    const systemPrompt = `You are Dr. Curalink, a warm and experienced physician having a face-to-face consultation.

SPEAK LIKE A REAL DOCTOR — not a textbook. Imagine the patient is sitting right in front of you.

RESPONSE STRUCTURE (strict):
1. One warm sentence acknowledging their concern
2. Your clinical take — 2-3 SHORT sentences covering the most important thing they need to know
3. One practical next-step or reassurance
4. End with ONE short question to guide the conversation forward

ABSOLUTE RULES:
- MAXIMUM 80 words total. This is a conversation, not a lecture
- Every sentence MUST be under 15 words
- NO author names, NO study titles, NO journal names, NO citations
- NO markdown, NO asterisks, NO lists, NO numbering, NO special characters
- Say "recent research shows" or "studies suggest" instead of naming sources
- Sound warm and human. Use contractions. Say "you" and "your"
- This is SPOKEN output for TTS — must sound natural when read aloud
- NEVER use <think> tags or internal reasoning in your output

DO NOT REPEAT yourself from conversation history.`;

    // Provide research context WITHOUT author names to prevent AI from reading them
    const pubContext = publications.slice(0, 4).map((p, i) =>
      `${i + 1}. ${p.title} (${p.year || 'Recent'}) — ${p.abstract?.substring(0, 150) || 'No details'}`
    ).join('\n');

    const trialContext = clinicalTrials.slice(0, 2).map((t, i) =>
      `${i + 1}. ${t.title} — Phase: ${t.phase || 'N/A'}, Status: ${t.status}`
    ).join('\n');

    // Build history context with clear "already said" markers
    let historyContext = '';
    if (conversationHistory.length > 0) {
      const prevAssistantMsgs = conversationHistory
        .filter(m => m.role === 'assistant')
        .map(m => m.content);

      historyContext = `\nConversation so far:\n${conversationHistory.map(m => `${m.role}: ${m.content}`).join('\n')}`;

      if (prevAssistantMsgs.length > 0) {
        historyContext += `\n\nYOU ALREADY SAID THIS — do NOT repeat:\n${prevAssistantMsgs.join('\n---\n')}`;
      }
    }

    const prompt = `Patient asked: "${query}"
${historyContext}

=== RESEARCH (your reference only — do NOT read aloud) ===
${pubContext || 'No publications found'}

Trials: ${trialContext || 'None found'}

Respond as Dr. Curalink in 80 words or less. Be brief, warm, and direct.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ];

    try {
      const stream = await this.groq.chat.completions.create({
        model: MODELS.REASONING,
        messages,
        temperature: 0.4,
        max_tokens: 350,
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
    const systemPrompt = `You are Curalink, an advanced AI Medical Document Analyzer. A user has uploaded a medical document and you need to provide a thorough, structured analysis.

The document could be ANY type: lab report, prescription, discharge summary, radiology report, research brief, clinical trial summary, pathology report, doctor's note, insurance document, etc.

CRITICAL RULES:
1. ONLY analyze what is actually present in the document text — never hallucinate values or facts
2. Identify the document type accurately and adapt your analysis style accordingly
3. For LAB REPORTS: extract actual numeric values, reference ranges, and flag abnormalities
4. For RESEARCH/CLINICAL documents: extract key medical insights, conditions studied, treatment approaches, and notable statistical findings
5. For PRESCRIPTIONS: list medications, dosages, frequencies, and any noted interactions
6. For RADIOLOGY/IMAGING: summarize findings, measurements, and clinical impressions
7. Use simple language that patients can understand
8. Always include a disclaimer to consult healthcare providers
9. If the document is unclear or partial, acknowledge limitations
10. Respond in valid JSON format ONLY`;

    const prompt = `EXTRACTED DOCUMENT TEXT:
---
${extractedText.substring(0, 4000)}
---

${userQuery ? `USER'S SPECIFIC QUESTION: "${userQuery}"` : 'No specific question — provide a full analysis.'}

Analyze this medical document and respond ONLY in this exact JSON format:
{
  "documentType": "Precise document type (e.g., Complete Blood Count Report, Research Dossier, Prescription, Discharge Summary, MRI Report, Clinical Trial Summary, etc.)",
  "primaryCondition": "The PRIMARY medical condition, disease, or health topic this document is about (e.g., 'heart disease', 'type 2 diabetes', 'lung cancer', 'hypertension'). This MUST be a concise medical term, not a sentence. If multiple conditions, pick the most prominent one.",
  "summary": "3-4 sentence plain-language summary covering: what this document is, the key takeaways, and what it means for the patient. Be specific — mention actual conditions, values, or findings from the document.",
  "keyFindings": [
    {
      "parameter": "Test name, finding title, or key insight",
      "value": "Actual value, result, or key detail from the document",
      "referenceRange": "Normal range if available, or 'N/A'",
      "status": "normal | elevated | low | critical | notable",
      "explanation": "What this means in simple, actionable terms for the patient"
    }
  ],
  "abnormalValues": ["List of concerning or out-of-range findings, each with a brief explanation of clinical significance"],
  "medications": ["List of any medications mentioned with dosages if available"],
  "recommendations": "Specific, actionable recommendations based on the document findings. Reference specific findings. End with a 1-sentence medical disclaimer.",
  "suggestedResearchTopics": ["3 specific medical research topics the user might want to explore, based on the actual conditions/findings in this document. Be specific (e.g., 'latest treatments for atrial fibrillation' not 'heart disease research')"]
}

IMPORTANT:
- For "keyFindings": adapt to the document type. Lab reports should have numeric values and ranges. Research documents should have key medical insights with specific data points. Prescriptions should list each medication as a finding.
- The "primaryCondition" must be a short medical term (1-4 words max), not a description.
- Make "summary" genuinely informative — avoid generic statements like "this document shows research". Instead say what specific conditions/findings it covers.
- Make "recommendations" specific to the findings, not generic advice.`;

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
        primaryCondition: '',
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
      disease: userContext.disease || '',
      context: (userContext.context || '').substring(0, 1500),
      additionalNotes: userContext.structuredData?.query || '',
      patientName: userContext.structuredData?.patientName || 'Patient',
      userDirectAnswers: additionalContext || '' // User's direct answers to follow up questions
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
        max_tokens: 512,
        response_format: { type: 'json_object' }
      }, { timeout: 15000 });

      const rawContent = response.choices[0]?.message?.content || '';
      
      let parsed;
      try {
        parsed = JSON.parse(rawContent);
      } catch {
        // Salvage JSON from potentially malformed output
        const salvaged = this._extractJsonObject(rawContent);
        parsed = JSON.parse(salvaged);
      }

      // Validate and normalize the response shape
      return {
        isEligible: typeof parsed.isEligible === 'boolean' ? parsed.isEligible : false,
        reasoning: parsed.reasoning || 'Analysis complete.',
        missingQuestions: Array.isArray(parsed.missingQuestions) ? parsed.missingQuestions : []
      };
    } catch (error) {
      console.error('LLM Eligibility Error:', error.message);
      return {
        isEligible: false,
        reasoning: 'Could not automatically determine eligibility due to a processing error. Please review the criteria manually or try again.',
        missingQuestions: []
      };
    }
  }

  geoCoordsCache = new Map();

  // Hardcoded fallback coordinates for common cities — ensures the map ALWAYS renders
  static CITY_COORDS = {
    'new york': { lat: 40.71, lng: -74.01 }, 'los angeles': { lat: 34.05, lng: -118.24 },
    'chicago': { lat: 41.88, lng: -87.63 }, 'houston': { lat: 29.76, lng: -95.37 },
    'boston': { lat: 42.36, lng: -71.06 }, 'seattle': { lat: 47.61, lng: -122.33 },
    'san francisco': { lat: 37.77, lng: -122.42 }, 'philadelphia': { lat: 39.95, lng: -75.17 },
    'baltimore': { lat: 39.29, lng: -76.61 }, 'rochester': { lat: 44.02, lng: -92.47 },
    'cleveland': { lat: 41.50, lng: -81.69 }, 'pittsburgh': { lat: 40.44, lng: -79.99 },
    'atlanta': { lat: 33.75, lng: -84.39 }, 'miami': { lat: 25.76, lng: -80.19 },
    'dallas': { lat: 32.78, lng: -96.80 }, 'phoenix': { lat: 33.45, lng: -112.07 },
    'denver': { lat: 39.74, lng: -104.99 }, 'detroit': { lat: 42.33, lng: -83.05 },
    'minneapolis': { lat: 44.98, lng: -93.27 }, 'nashville': { lat: 36.16, lng: -86.78 },
    'portland': { lat: 45.52, lng: -122.68 }, 'san diego': { lat: 32.72, lng: -117.16 },
    'tampa': { lat: 27.95, lng: -82.46 }, 'st. louis': { lat: 38.63, lng: -90.20 },
    'salt lake city': { lat: 40.76, lng: -111.89 }, 'indianapolis': { lat: 39.77, lng: -86.16 },
    'milwaukee': { lat: 43.04, lng: -87.91 }, 'jacksonville': { lat: 30.33, lng: -81.66 },
    'columbus': { lat: 39.96, lng: -82.99 }, 'charlotte': { lat: 35.23, lng: -80.84 },
    'raleigh': { lat: 35.78, lng: -78.64 }, 'durham': { lat: 35.99, lng: -78.90 },
    'new haven': { lat: 41.31, lng: -72.92 }, 'ann arbor': { lat: 42.28, lng: -83.74 },
    'chapel hill': { lat: 35.91, lng: -79.05 }, 'gainesville': { lat: 29.65, lng: -82.32 },
    'birmingham': { lat: 33.52, lng: -86.80 }, 'memphis': { lat: 35.15, lng: -90.05 },
    'richmond': { lat: 37.54, lng: -77.44 }, 'omaha': { lat: 41.26, lng: -95.94 },
    'daphne': { lat: 30.60, lng: -87.90 }, 'fairhope': { lat: 30.52, lng: -87.90 },
    'mobile': { lat: 30.70, lng: -88.04 }, 'malbis': { lat: 30.62, lng: -87.83 },
    'london': { lat: 51.51, lng: -0.13 }, 'paris': { lat: 48.86, lng: 2.35 },
    'berlin': { lat: 52.52, lng: 13.41 }, 'munich': { lat: 48.14, lng: 11.58 },
    'amsterdam': { lat: 52.37, lng: 4.90 }, 'rome': { lat: 41.90, lng: 12.50 },
    'milan': { lat: 45.46, lng: 9.19 }, 'madrid': { lat: 40.42, lng: -3.70 },
    'barcelona': { lat: 41.39, lng: 2.17 }, 'vienna': { lat: 48.21, lng: 16.37 },
    'zurich': { lat: 47.38, lng: 8.54 }, 'brussels': { lat: 50.85, lng: 4.35 },
    'copenhagen': { lat: 55.68, lng: 12.57 }, 'stockholm': { lat: 59.33, lng: 18.07 },
    'oslo': { lat: 59.91, lng: 10.75 }, 'helsinki': { lat: 60.17, lng: 24.94 },
    'toronto': { lat: 43.65, lng: -79.38 }, 'montreal': { lat: 45.50, lng: -73.57 },
    'vancouver': { lat: 49.28, lng: -123.12 }, 'ottawa': { lat: 45.42, lng: -75.70 },
    'beijing': { lat: 39.90, lng: 116.40 }, 'shanghai': { lat: 31.23, lng: 121.47 },
    'guangzhou': { lat: 23.13, lng: 113.26 }, 'shenzhen': { lat: 22.54, lng: 114.06 },
    'chengdu': { lat: 30.57, lng: 104.07 }, 'wuhan': { lat: 30.59, lng: 114.31 },
    'hangzhou': { lat: 30.27, lng: 120.15 }, 'nanjing': { lat: 32.06, lng: 118.80 },
    'changsha': { lat: 28.23, lng: 112.94 }, 'fuzhou': { lat: 26.07, lng: 119.30 },
    'foshan': { lat: 23.02, lng: 113.12 }, 'tokyo': { lat: 35.68, lng: 139.69 },
    'osaka': { lat: 34.69, lng: 135.50 }, 'seoul': { lat: 37.57, lng: 126.98 },
    'sydney': { lat: -33.87, lng: 151.21 }, 'melbourne': { lat: -37.81, lng: 144.96 },
    'mumbai': { lat: 19.08, lng: 72.88 }, 'delhi': { lat: 28.61, lng: 77.21 },
    'new delhi': { lat: 28.61, lng: 77.21 }, 'bangalore': { lat: 12.97, lng: 77.59 },
    'chennai': { lat: 13.08, lng: 80.27 }, 'hyderabad': { lat: 17.39, lng: 78.49 },
    'sao paulo': { lat: -23.55, lng: -46.63 }, 'rio de janeiro': { lat: -22.91, lng: -43.17 },
    'mexico city': { lat: 19.43, lng: -99.13 }, 'buenos aires': { lat: -34.60, lng: -58.38 },
    'cairo': { lat: 30.04, lng: 31.24 }, 'cape town': { lat: -33.92, lng: 18.42 },
    'tel aviv': { lat: 32.09, lng: 34.78 }, 'jerusalem': { lat: 31.77, lng: 35.23 },
    'singapore': { lat: 1.35, lng: 103.82 }, 'bangkok': { lat: 13.76, lng: 100.50 },
    'taipei': { lat: 25.03, lng: 121.57 }, 'hong kong': { lat: 22.32, lng: 114.17 },
    'united states': { lat: 39.83, lng: -98.58 }, 'china': { lat: 35.86, lng: 104.20 },
    'canada': { lat: 56.13, lng: -106.35 }, 'italy': { lat: 41.87, lng: 12.57 },
    'germany': { lat: 51.17, lng: 10.45 }, 'france': { lat: 46.23, lng: 2.21 },
    'spain': { lat: 40.46, lng: -3.75 }, 'japan': { lat: 36.20, lng: 138.25 },
    'south korea': { lat: 35.91, lng: 127.77 }, 'australia': { lat: -25.27, lng: 133.78 },
    'india': { lat: 20.59, lng: 78.96 }, 'brazil': { lat: -14.24, lng: -51.93 },
    'uk': { lat: 55.38, lng: -3.44 }, 'united kingdom': { lat: 55.38, lng: -3.44 },
  };

  /**
   * Extract approximate coordinates for an array of location strings.
   * 
   * Strategy:
   *  1. Split compound pipe-delimited location strings into individual city/country fragments
   *  2. Check hardcoded fallback dictionary first (instant, no API call)
   *  3. Only call Groq LLM for genuinely unknown locations
   *  4. Map resolved coordinates back to the ORIGINAL compound location strings
   */
  async extractCoordinatesBatch(locationsList) {
    if (!locationsList || locationsList.length === 0) return [];

    const results = [];

    // For each compound location string, try to resolve coordinates
    for (const fullLoc of locationsList) {
      // Check full-string cache first
      if (this.geoCoordsCache.has(fullLoc)) {
        const cached = this.geoCoordsCache.get(fullLoc);
        if (cached) results.push({ location: fullLoc, lat: cached.lat, lng: cached.lng });
        continue;
      }

      // Split compound location strings (pipe-delimited) into fragments
      // e.g. "Mayo Clinic, Rochester, Minnesota, US | Hospital B, London, UK" → ["Rochester", "Minnesota", "London"]
      const fragments = fullLoc.split('|').flatMap(part => 
        part.split(',').map(s => s.trim().toLowerCase()).filter(s => s.length > 2)
      );

      // Try hardcoded fallback first (most reliable, instant)
      let resolved = false;
      for (const frag of fragments) {
        if (LLMService.CITY_COORDS[frag]) {
          const coords = LLMService.CITY_COORDS[frag];
          this.geoCoordsCache.set(fullLoc, coords);
          results.push({ location: fullLoc, lat: coords.lat, lng: coords.lng });
          resolved = true;
          break;
        }
      }
      if (resolved) continue;

      // Try partial matches (e.g. "rochester, minnesota" contains "rochester")
      for (const [city, coords] of Object.entries(LLMService.CITY_COORDS)) {
        if (fragments.some(frag => frag.includes(city) || city.includes(frag))) {
          this.geoCoordsCache.set(fullLoc, coords);
          results.push({ location: fullLoc, lat: coords.lat, lng: coords.lng });
          resolved = true;
          break;
        }
      }
      if (resolved) continue;

      // Queue for LLM geocoding — extract just the first meaningful city/country fragment
      const simplifiedLoc = this._extractSimpleLocation(fullLoc);
      if (simplifiedLoc) {
        // Check if simplified version is in cache
        if (this.geoCoordsCache.has(simplifiedLoc)) {
          const cached = this.geoCoordsCache.get(simplifiedLoc);
          if (cached) {
            this.geoCoordsCache.set(fullLoc, cached); // also cache under full string
            results.push({ location: fullLoc, lat: cached.lat, lng: cached.lng });
          }
        } else {
          // Will be resolved by LLM batch below
        }
      }
    }

    // Collect unresolved locations for LLM batch geocoding
    const unresolved = locationsList.filter(loc => !this.geoCoordsCache.has(loc));
    if (unresolved.length > 0 && this.groq) {
      const simplifiedBatch = unresolved
        .map(loc => ({ original: loc, simple: this._extractSimpleLocation(loc) }))
        .filter(item => item.simple)
        .slice(0, 12);

      if (simplifiedBatch.length > 0) {
        const simpleNames = simplifiedBatch.map(item => item.simple);
        
        try {
          const prompt = `Return approximate latitude/longitude coordinates for these locations. Respond ONLY in valid JSON.

Locations: ${JSON.stringify(simpleNames)}

{"coordinates": [{"location": "string", "lat": number, "lng": number}]}`;

          const response = await this.groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: MODELS.QUERY_EXPANSION,
            temperature: 0,
            max_tokens: 1200,
            response_format: { type: "json_object" }
          }, { timeout: 8000 });

          const rawContent = response.choices[0]?.message?.content || '{"coordinates":[]}';
          const parsed = JSON.parse(rawContent);
          const newCoords = parsed.coordinates || [];

          // Map LLM results back to original compound strings
          for (const coord of newCoords) {
            if (!coord || !coord.location || coord.lat == null || coord.lng == null) continue;

            const matchingItem = simplifiedBatch.find(
              item => item.simple.toLowerCase() === coord.location.toLowerCase()
            );
            if (matchingItem) {
              const coordObj = { lat: coord.lat, lng: coord.lng };
              this.geoCoordsCache.set(coord.location, coordObj);
              this.geoCoordsCache.set(matchingItem.original, coordObj);
              results.push({ location: matchingItem.original, lat: coord.lat, lng: coord.lng });
            }
          }
        } catch (err) {
          console.error('LLM Coordinate Extractor Error:', err.message);
          // Fallback already handled above — we just won't have coords for these
        }
      }
    }

    console.log(`🗺️ Geocoded ${results.length}/${locationsList.length} locations (${locationsList.length - unresolved.length} from cache/fallback)`);
    return results;
  }

  /**
   * Extract a simple "City, Country" from a compound location string.
   * e.g. "Mayo Clinic in Rochester, Rochester, Minnesota, United States" → "Rochester, United States"
   */
  _extractSimpleLocation(fullLoc) {
    if (!fullLoc) return null;
    // Take the first pipe-delimited entry
    const firstEntry = fullLoc.split('|')[0].trim();
    // Split by comma and extract city + country (typically last two meaningful parts)
    const parts = firstEntry.split(',').map(s => s.trim()).filter(s => s.length > 1);
    if (parts.length >= 2) {
      // Return "City, Country" — usually the 2nd and last parts
      const city = parts.length >= 3 ? parts[parts.length - 3] : parts[0];
      const country = parts[parts.length - 1];
      return `${city}, ${country}`;
    }
    return parts[0] || null;
  }
}
module.exports = new LLMService();
