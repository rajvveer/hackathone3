const { v4: uuidv4 } = require('uuid');
const Conversation = require('../models/Conversation');
const queryExpander = require('../services/queryExpander');
const retrievalManager = require('../services/retrievalManager');
const rankingPipeline = require('../services/rankingPipeline');
const llmService = require('../services/llmService');
const clinicalTrialsService = require('../services/clinicalTrialsService');
const PDFDocument = require('pdfkit');

// ──────────────────────────────────────────────────────────────
// Shared helpers
// ──────────────────────────────────────────────────────────────

function buildPublicationResponse(pub) {
  return {
    title: pub.title,
    authors: pub.authors?.slice(0, 5) || [],
    year: pub.year,
    source: pub.source,
    sourceJournal: pub.sourceJournal,
    url: pub.url,
    abstract: pub.abstract?.substring(0, 400) || '',
    citationCount: pub.citationCount,
    relevanceScore: Math.round((pub.compositeScore || 0) * 100) / 100,
    isOpenAccess: pub.isOpenAccess || false,
    topics: pub.topics || []
  };
}

function buildTrialResponse(trial) {
  return {
    nctId: trial.nctId,
    title: trial.title,
    status: trial.status,
    phase: trial.phase,
    eligibility: trial.eligibility?.substring(0, 600) || '',
    eligibilitySex: trial.eligibilitySex || 'ALL',
    eligibilityMinAge: trial.eligibilityMinAge || '',
    eligibilityMaxAge: trial.eligibilityMaxAge || '',
    location: trial.location,
    contact: trial.contact,
    url: trial.url,
    summary: trial.summary?.substring(0, 400) || '',
    sponsor: trial.sponsor || '',
    startDate: trial.startDate || '',
    completionDate: trial.completionDate || '',
    enrollmentCount: trial.enrollmentCount || 0,
    relevanceScore: Math.round((trial.compositeScore || 0) * 100) / 100
  };
}

async function loadOrCreateConversation(conversationId, userInput, user) {
  let convId = conversationId || uuidv4();
  let conversation = await Conversation.findOne({ conversationId: convId });

  let dbUser = null;
  if (user) {
    const User = require('../models/User');
    dbUser = await User.findById(user._id);
  }

  if (!conversation) {
    // If structured input was provided, use it. Otherwise seamlessly inject defaults from global medical profile.
    const defaultProfile = dbUser?.medicalProfile || {};

    conversation = new Conversation({
      conversationId: convId,
      userId: user ? user._id : undefined,
      title: typeof userInput === 'string'
        ? userInput.substring(0, 60)
        : (userInput.query || userInput.disease || defaultProfile.diseaseOfInterest || 'New Research Chat'),
      userProfile: typeof userInput === 'object' ? {
        patientName: userInput.patientName || defaultProfile.patientName,
        diseaseOfInterest: userInput.disease || defaultProfile.diseaseOfInterest,
        location: userInput.location || defaultProfile.location
      } : {
        patientName: defaultProfile.patientName,
        diseaseOfInterest: defaultProfile.diseaseOfInterest,
        location: defaultProfile.location
      }
    });
  } else {
    // Update userProfile on pre-created conversations (from /conversations/new)
    const defaultProfile = dbUser?.medicalProfile || {};
    const hasExistingProfile = conversation.userProfile && conversation.userProfile.diseaseOfInterest;
    
    if (!hasExistingProfile || typeof userInput === 'object') {
      conversation.userProfile = {
        patientName: (typeof userInput === 'object' ? userInput.patientName : '') || conversation.userProfile?.patientName || defaultProfile.patientName || '',
        diseaseOfInterest: (typeof userInput === 'object' ? userInput.disease : '') || conversation.userProfile?.diseaseOfInterest || defaultProfile.diseaseOfInterest || '',
        location: (typeof userInput === 'object' ? userInput.location : '') || conversation.userProfile?.location || defaultProfile.location || ''
      };
    }
  }

  // Backwards compat: if user logs in on an anonymous session, claim it
  if (user && !conversation.userId) {
    conversation.userId = user._id;
  }

  return { conversation, convId };
}

function getContext(conversation) {
  return {
    lastDisease: conversation.metadata?.lastDisease || '',
    lastIntent: conversation.metadata?.lastIntent || '',
    lastLocation: conversation.metadata?.lastLocation || '',
    diseaseOfInterest: conversation.userProfile?.diseaseOfInterest || '',
    location: conversation.userProfile?.location || '',
    patientName: conversation.userProfile?.patientName || ''
  };
}

function getHistory(conversation) {
  return (conversation.messages || []).slice(-6).map(m => ({
    role: m.role,
    content: m.content
  }));
}

async function saveConversation(conversation, expansion, userInput, llmResponse, response) {
  // Ensure content is never empty (Mongoose required validator)
  const userContent = typeof userInput === 'string'
    ? (userInput.trim() || 'Medical research query')
    : `Query: ${userInput.disease || userInput.query || 'Medical research'}`;

  const userMessage = {
    role: 'user',
    content: userContent,
    structuredInput: typeof userInput === 'object' ? userInput : undefined,
    timestamp: new Date()
  };

  const assistantMessage = {
    role: 'assistant',
    content: llmResponse.conditionOverview || llmResponse.researchInsights || 'Research analysis complete.',
    response: {
      ...llmResponse,
      publications: response.publications,
      clinicalTrials: response.clinicalTrials,
      researchers: response.researchers || []
    },
    pipelineMetrics: response.pipelineMetrics,
    timestamp: new Date()
  };

  conversation.messages.push(userMessage, assistantMessage);
  conversation.metadata.lastDisease = expansion.disease;
  conversation.metadata.lastIntent = expansion.intent;
  conversation.metadata.lastLocation = expansion.location || getContext(conversation).lastLocation;

  // Update title after first exchange
  if (conversation.messages.length === 2) {
    conversation.title = await llmService.generateTitle(expansion.disease, expansion.intent)
      .catch(() => expansion.disease || 'Medical Research');
  }

  await conversation.save();
}

// ──────────────────────────────────────────────────────────────
// POST /api/chat — Standard JSON response
// ──────────────────────────────────────────────────────────────
exports.handleChat = async (req, res) => {
  const totalStart = Date.now();

  try {
    const { message, conversationId, structured } = req.body;
    const userInput = structured || message;
    if (!userInput) return res.status(400).json({ error: 'Message or structured input is required' });

    const { conversation, convId } = await loadOrCreateConversation(conversationId, userInput, req.user);
    const context = getContext(conversation);
    const conversationHistory = getHistory(conversation);

    // 0. Intent Classification (Bypass heavy pipeline for non-medical queries)
    if (typeof userInput === 'string') {
      const classification = await llmService.classifyQuery(userInput);
      if (!classification.requiresResearch) {
        console.log('\n💬 Conversational Intent Detected: bypassed research pipeline.');
        const replyText = classification.response || "Hello! I am Curalink. How can I help you with your health or research questions today?";

        conversation.messages.push(
          { role: 'user', content: userInput, timestamp: new Date() },
          { role: 'assistant', content: replyText, timestamp: new Date() }
        );
        if (conversation.messages.length === 2) conversation.title = "Chat";
        await conversation.save();

        return res.json({
          conversationId: convId,
          isConversational: true,
          content: replyText
        });
      }
    }

    // 1. Query Expansion
    console.log('\n🧠 Step 1: Query Expansion...');
    const expansion = await queryExpander.expand(userInput, context);
    console.log(`   Disease: ${expansion.disease} | Researcher: ${expansion.isResearcherQuery} | Symptoms: ${expansion.isSymptomQuery || false}`);
    console.log(`   Queries: ${expansion.expandedQueries.join(', ')}`);

    // 2. Parallel Retrieval
    console.log('\n🔍 Step 2: Retrieving from all sources...');
    const retrieval = await retrievalManager.retrieve(expansion);

    // 3. Ranking
    console.log('\n📊 Step 3: Ranking...');
    let ranked = rankingPipeline.rank(retrieval.publications, retrieval.clinicalTrials, expansion);

    // Fallback for missing publications
    if (ranked.publications.length < 4 && expansion.disease && expansion.intent) {
      console.log('⚠️ <4 publications found, running fallback retrieval with disease name...');
      const fallbackExpansion = { ...expansion, intent: '', expandedQueries: [expansion.disease] };
      const fallbackRetrieval = await retrievalManager.retrieve(fallbackExpansion);
      const fallbackRanked = rankingPipeline.rank(fallbackRetrieval.publications, [], fallbackExpansion);
      
      const existingIds = new Set(ranked.publications.map(p => p.id));
      const addedPubs = fallbackRanked.publications.filter(p => !existingIds.has(p.id));
      
      ranked.publications = [...ranked.publications, ...addedPubs].slice(0, 8);
      ranked.lowRelevance = true;
      ranked.rankingMetrics.selectedPublications = ranked.publications.length;
    }

    if (ranked.clinicalTrials.length === 0 && expansion.disease) {
      console.log('⚠️ 0 trials found, running fallback with disease name...');
      const fallbackTrials = await clinicalTrialsService.fetchTrials(expansion.disease, '', expansion.location);
      const fallbackRanked = rankingPipeline.rank([], fallbackTrials, { ...expansion, intent: '' });
      ranked.clinicalTrials = fallbackRanked.clinicalTrials;
      ranked.rankingMetrics.selectedTrials = fallbackRanked.rankingMetrics.selectedTrials;
    }

    // 4. LLM Reasoning
    console.log('\n🤖 Step 4: LLM generating response...');
    const llmStart = Date.now();
    const llmResponse = await llmService.generateMedicalResponse(
      typeof userInput === 'string' ? userInput : (userInput.query || userInput.disease),
      { disease: expansion.disease, intent: expansion.intent, location: expansion.location || '', patientName: expansion.patientName || '', isSymptomQuery: expansion.isSymptomQuery || false, indirectEvidence: ranked.indirectEvidence || false },
      ranked.publications,
      ranked.clinicalTrials,
      conversationHistory,
      retrieval.researchers || []
    );
    const llmTimeMs = Date.now() - llmStart;

    const totalTimeMs = Date.now() - totalStart;
    const response = {
      conversationId: convId,
      ...llmResponse,
      publications: ranked.publications.map(buildPublicationResponse),
      clinicalTrials: ranked.clinicalTrials.map(buildTrialResponse),
      lowRelevance: ranked.lowRelevance,
      indirectEvidence: ranked.indirectEvidence || false,
      researchers: retrieval.researchers || [],
      pipelineMetrics: {
        totalRetrieved: (retrieval.metadata.totalBeforeDedup || 0) + (retrieval.metadata.clinicalTrialsCount || 0) || retrieval.metadata.totalResults || 0,
        totalAfterDedup: (retrieval.metadata.totalAfterDedup || 0) + (retrieval.metadata.clinicalTrialsCount || 0) || retrieval.metadata.totalResults || 0,
        selectedPublications: ranked.rankingMetrics.selectedPublications,
        selectedTrials: ranked.rankingMetrics.selectedTrials,
        queryExpansionTimeMs: expansion.timeMs,
        retrievalTimeMs: retrieval.timeMs,
        rankingTimeMs: ranked.rankingMetrics.timeMs,
        llmTimeMs,
        totalTimeMs,
        expandedQueries: expansion.expandedQueries,
        isResearcherQuery: expansion.isResearcherQuery,
        fromCache: retrieval.fromCache || null,
        sources: retrieval.metadata.sources
      }
    };

    await saveConversation(conversation, expansion, userInput, llmResponse, response);
    console.log(`\n✅ Done in ${totalTimeMs}ms`);
    res.json(response);

  } catch (error) {
    console.error('Chat handler error:', error);
    res.status(500).json({ error: 'Failed to process your query', details: error.message });
  }
};

// ──────────────────────────────────────────────────────────────
// POST /api/chat/stream — Server-Sent Events streaming response
// (pipeline steps are server-driven, not timer-driven)
// ──────────────────────────────────────────────────────────────
exports.handleChatStream = async (req, res) => {
  const totalStart = Date.now();

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // prevents nginx buffering
  res.flushHeaders();

  const send = (event, data) => {
    if (!res.writableEnded) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  const finish = (event, data) => {
    send(event, data);
    if (!res.writableEnded) res.end();
  };

  try {
    const { message, conversationId, structured } = req.body;
    const userInput = structured || message;
    if (!userInput) return finish('error', { message: 'Message is required' });

    const { conversation, convId } = await loadOrCreateConversation(conversationId, userInput, req.user);
    const context = getContext(conversation);
    const conversationHistory = getHistory(conversation);

    // Step 0: Intent Classification
    if (typeof userInput === 'string') {
      const classification = await llmService.classifyQuery(userInput);
      if (!classification.requiresResearch) {
        console.log('\n💬 Conversational Intent Detected: bypassed research pipeline.');
        const replyText = classification.response || "Hello! I am Curalink. How can I help you with your health or research questions today?";

        conversation.messages.push(
          { role: 'user', content: userInput, timestamp: new Date() },
          { role: 'assistant', content: replyText, timestamp: new Date() }
        );
        if (conversation.messages.length === 2) conversation.title = "Chat";
        await conversation.save();

        send('result', {
          conversationId: convId,
          isConversational: true,
          content: replyText
        });
        return finish('done', {});
      }
    }

    // Step 1: Query Expansion
    send('step', { step: 1, message: 'Expanding query with AI...' });
    const expansion = await queryExpander.expand(userInput, context);
    send('expanded', {
      disease: expansion.disease,
      queries: expansion.expandedQueries,
      isResearcherQuery: expansion.isResearcherQuery
    });

    // Step 2: Retrieval
    send('step', { step: 2, message: 'Fetching from PubMed, OpenAlex & ClinicalTrials.gov...' });
    const retrieval = await retrievalManager.retrieve(expansion);
    send('retrieved', {
      openAlex: retrieval.metadata.openAlexCount,
      pubmed: retrieval.metadata.pubmedCount,
      trials: retrieval.metadata.clinicalTrialsCount,
      researchers: retrieval.metadata.researchersCount || 0,
      fromCache: retrieval.fromCache || null
    });

    // Step 3: Ranking
    send('step', { step: 3, message: 'Ranking & filtering results...' });
    let ranked = rankingPipeline.rank(retrieval.publications, retrieval.clinicalTrials, expansion);

    if (ranked.publications.length < 4 && expansion.disease && expansion.intent) {
      console.log('⚠️ <4 publications found, running fallback retrieval with disease name...');
      send('step', { step: 3.2, message: 'Running publications fallback...' });
      const fallbackExpansion = { ...expansion, intent: '', expandedQueries: [expansion.disease] };
      const fallbackRetrieval = await retrievalManager.retrieve(fallbackExpansion);
      const fallbackRanked = rankingPipeline.rank(fallbackRetrieval.publications, [], fallbackExpansion);
      
      const existingIds = new Set(ranked.publications.map(p => p.id));
      const addedPubs = fallbackRanked.publications.filter(p => !existingIds.has(p.id));
      
      ranked.publications = [...ranked.publications, ...addedPubs].slice(0, 8);
      ranked.lowRelevance = true;
      ranked.rankingMetrics.selectedPublications = ranked.publications.length;
    }

    if (ranked.clinicalTrials.length === 0 && expansion.disease) {
      console.log('⚠️ 0 trials found, running fallback with disease name...');
      send('step', { step: 3.5, message: 'Running trials fallback...' });
      const fallbackTrials = await clinicalTrialsService.fetchTrials(expansion.disease, '', expansion.location);
      const fallbackRanked = rankingPipeline.rank([], fallbackTrials, { ...expansion, intent: '' });
      ranked.clinicalTrials = fallbackRanked.clinicalTrials;
      ranked.rankingMetrics.selectedTrials = fallbackRanked.rankingMetrics.selectedTrials;
    }

    send('ranked', {
      selectedPubs: ranked.rankingMetrics.selectedPublications,
      selectedTrials: ranked.rankingMetrics.selectedTrials
    });

    // Step 4: LLM Reasoning
    send('step', { step: 4, message: 'Generating research insights with Qwen 32B...' });
    const llmStart = Date.now();
    const llmResponse = await llmService.generateMedicalResponse(
      typeof userInput === 'string' ? userInput : (userInput.query || userInput.disease),
      { disease: expansion.disease, intent: expansion.intent, location: expansion.location || '', patientName: expansion.patientName || '', isSymptomQuery: expansion.isSymptomQuery || false, indirectEvidence: ranked.indirectEvidence || false },
      ranked.publications,
      ranked.clinicalTrials,
      conversationHistory,
      retrieval.researchers || []
    );
    const llmTimeMs = Date.now() - llmStart;

    const totalTimeMs = Date.now() - totalStart;
    const response = {
      conversationId: convId,
      ...llmResponse,
      publications: ranked.publications.map(buildPublicationResponse),
      clinicalTrials: ranked.clinicalTrials.map(buildTrialResponse),
      lowRelevance: ranked.lowRelevance,
      indirectEvidence: ranked.indirectEvidence || false,
      researchers: retrieval.researchers || [],
      pipelineMetrics: {
        totalRetrieved: (retrieval.metadata.totalBeforeDedup || 0) + (retrieval.metadata.clinicalTrialsCount || 0) || retrieval.metadata.totalResults || 0,
        totalAfterDedup: (retrieval.metadata.totalAfterDedup || 0) + (retrieval.metadata.clinicalTrialsCount || 0) || retrieval.metadata.totalResults || 0,
        selectedPublications: ranked.rankingMetrics.selectedPublications,
        selectedTrials: ranked.rankingMetrics.selectedTrials,
        queryExpansionTimeMs: expansion.timeMs,
        retrievalTimeMs: retrieval.timeMs,
        rankingTimeMs: ranked.rankingMetrics.timeMs,
        llmTimeMs,
        totalTimeMs,
        expandedQueries: expansion.expandedQueries,
        isResearcherQuery: expansion.isResearcherQuery,
        fromCache: retrieval.fromCache || null,
        sources: retrieval.metadata.sources
      }
    };

    await saveConversation(conversation, expansion, userInput, llmResponse, response);
    console.log(`\n✅ Stream complete in ${totalTimeMs}ms`);

    send('result', response);
    finish('done', {});

  } catch (error) {
    console.error('Stream chat error:', error);
    finish('error', { message: error.message || 'Failed to process query' });
  }
};

// ──────────────────────────────────────────────────────────────
// Conversation CRUD
// ──────────────────────────────────────────────────────────────
exports.getConversation = async (req, res) => {
  try {
    const q = { conversationId: req.params.id };
    if (req.user) q.userId = req.user._id;

    const conversation = await Conversation.findOne(q).lean();
    if (!conversation) return res.status(404).json({ error: 'Conversation not found or unauthorized' });
    res.json(conversation);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getConversations = async (req, res) => {
  try {
    let query = {};
    if (req.user) {
      query = { userId: req.user._id };
    } else {
      const localIds = req.query.ids ? req.query.ids.split(',') : [];
      if (localIds.length === 0) {
        return res.json([]);
      }
      query = { conversationId: { $in: localIds } };
    }
    const conversations = await Conversation.find(query)
      .select('conversationId title metadata createdAt updatedAt')
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean();
    res.json(conversations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createConversation = async (req, res) => {
  try {
    let userProfile = {};
    if (req.user) {
      const User = require('../models/User');
      const dbUser = await User.findById(req.user._id);
      if (dbUser && dbUser.medicalProfile) {
        userProfile = {
          patientName: dbUser.medicalProfile.patientName || '',
          diseaseOfInterest: dbUser.medicalProfile.diseaseOfInterest || '',
          location: dbUser.medicalProfile.location || ''
        };
      }
    }

    const conversation = new Conversation({
      conversationId: uuidv4(),
      title: 'New Conversation',
      userId: req.user ? req.user._id : undefined,
      userProfile
    });
    await conversation.save();
    res.json({ conversationId: conversation.conversationId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deleteConversation = async (req, res) => {
  try {
    const q = { conversationId: req.params.id };
    if (req.user) {
      q.userId = req.user._id;
    } else {
      q.userId = { $exists: false }; // Anonymous can only delete unowned chats
    }

    const result = await Conversation.deleteOne(q);
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Conversation not found or unauthorized' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.migrateConversations = async (req, res) => {
  try {
    const { localIds } = req.body;
    if (!req.user || !localIds || !Array.isArray(localIds)) {
      return res.status(400).json({ error: 'Invalid payload or unauthenticated' });
    }
    // Update all these anonymous convos to belong to this user
    await Conversation.updateMany(
      { conversationId: { $in: localIds }, userId: { $exists: false } },
      { $set: { userId: req.user._id } }
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ──────────────────────────────────────────────────────────────
// POST /api/chat/clarify — Generate follow-up questions
// ──────────────────────────────────────────────────────────────
exports.handleClarification = async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    // First check if it's conversational (greeting, etc.)
    const classification = await llmService.classifyQuery(message);
    if (!classification.requiresResearch) {
      return res.json({
        type: 'conversational',
        content: classification.response || "Hello! I am Curalink. How can I help you with your health or research questions today?"
      });
    }

    // Evaluate context and optionally generate follow-up questions
    const followUp = await llmService.generateFollowUpQuestions(message);

    // If query is detailed enough, skip clarification
    if (followUp.needsClarification === false || !followUp.questions || followUp.questions.length === 0) {
      return res.json({ type: 'sufficient_context' });
    }

    return res.json({
      type: 'clarification',
      originalQuery: message,
      questions: followUp.questions || []
    });
  } catch (error) {
    console.error('Clarification error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ──────────────────────────────────────────────────────────────
// POST /api/chat/upload — Medical File Upload & AI Analysis
// ──────────────────────────────────────────────────────────────
const fileUploadService = require('../services/fileUploadService');

exports.handleFileUpload = async (req, res) => {
  const totalStart = Date.now();

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { conversationId, userQuery } = req.body;
    const file = req.file;

    console.log(`\n📎 File upload: ${file.originalname} (${file.mimetype}, ${file.size} bytes)`);

    // Load or create conversation
    const { conversation, convId } = await loadOrCreateConversation(
      conversationId,
      userQuery || `Uploaded: ${file.originalname}`,
      req.user
    );

    // Step 1: Process file (extract text from PDF or upload image + vision)
    console.log('📄 Step 1: Processing file...');
    const processed = await fileUploadService.processFile(
      file.buffer,
      file.mimetype,
      file.originalname
    );

    console.log(`✅ Extracted ${processed.extractedText.length} chars (${processed.type})`);

    // Step 2: AI Analysis
    console.log('🤖 Step 2: AI analyzing document...');
    const analysis = await llmService.analyzeMedicalDocument(
      processed.extractedText,
      userQuery || ''
    );

    // Step 3: RAG Integration
    if (analysis.primaryCondition) {
      console.log(`\n🧠 Step 3: Triggering RAG for extracted condition: ${analysis.primaryCondition}...`);
      const context = getContext(conversation);
      const ragQuery = userQuery || `Latest treatments and research for ${analysis.primaryCondition}`;
      
      const expansion = await queryExpander.expand(ragQuery, {
        ...context,
        disease: analysis.primaryCondition,
        lastDisease: analysis.primaryCondition
      });

      const retrieval = await retrievalManager.retrieve(expansion);
      let ranked = rankingPipeline.rank(retrieval.publications, retrieval.clinicalTrials, expansion);

      if (ranked.clinicalTrials.length === 0 && expansion.disease) {
        const fallbackTrials = await clinicalTrialsService.fetchTrials(expansion.disease, '', expansion.location);
        const fallbackRanked = rankingPipeline.rank([], fallbackTrials, { ...expansion, intent: '' });
        ranked.clinicalTrials = fallbackRanked.clinicalTrials;
      }

      analysis.publications = ranked.publications.map(buildPublicationResponse);
      analysis.clinicalTrials = ranked.clinicalTrials.map(buildTrialResponse);
      analysis.researchers = retrieval.researchers || [];
    }

    const totalTimeMs = Date.now() - totalStart;
    console.log(`✅ File analysis complete in ${totalTimeMs}ms`);

    // Build response
    const response = {
      conversationId: convId,
      fileInfo: processed.fileInfo,
      fileType: processed.type,
      analysis,
      pipelineMetrics: {
        totalTimeMs,
        fileProcessingMs: totalTimeMs, // simplified
      }
    };

    // Save to conversation
    const userContent = userQuery
      ? `📎 Uploaded: ${file.originalname} — "${userQuery}"`
      : `📎 Uploaded: ${file.originalname}`;

    conversation.messages.push(
      {
        role: 'user',
        content: userContent,
        fileAttachment: processed.fileInfo,
        timestamp: new Date()
      },
      {
        role: 'assistant',
        content: analysis.summary || 'Document analysis complete.',
        response: {
          ...analysis,
          fileInfo: processed.fileInfo,
        },
        isFileAnalysis: true,
        timestamp: new Date()
      }
    );

    // Update title if first exchange
    if (conversation.messages.length === 2) {
      conversation.title = `📎 ${analysis.documentType || file.originalname}`;
    }

    await conversation.save();

    res.json(response);

  } catch (error) {
    console.error('File upload error:', error);
    res.status(500).json({ error: error.message || 'Failed to process file' });
  }
};

exports.matchTrial = async (req, res) => {
  const { criteria, conversationId, additionalContext } = req.body;
  if (!criteria) {
    return res.status(400).json({ error: 'Eligibility criteria required.' });
  }

  try {
    let context = {};
    if (conversationId) {
      const conv = await Conversation.findOne({ id: conversationId });
      if (conv) {
        context = {
          disease: conv.structuredData?.disease || '',
          context: conv.messages.map(m => m.content).join(' '),
          structuredData: conv.structuredData
        };
      }
    }

    const matchData = await llmService.evaluateEligibility(criteria, context, additionalContext);
    res.json(matchData);
  } catch (err) {
    console.error('Trial Match Error:', err);
    res.status(500).json({ error: 'Failed to match trial.' });
  }
};

exports.getHeatmapCoords = async (req, res) => {
  const { locations } = req.body;
  if (!locations || !locations.length) {
    return res.status(400).json({ error: 'Locations array required.' });
  }

  try {
    const coords = await llmService.extractCoordinatesBatch(locations);
    res.json(coords);
  } catch (err) {
    console.error('Heatmap Extractor Error:', err);
    res.status(500).json({ error: 'Failed to extract heatmap coords.' });
  }
};

exports.exportPDF = async (req, res) => {
  try {
    const { id } = req.params;
    const conversation = await Conversation.findOne({ conversationId: id });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const doc = new PDFDocument({ margin: 50, size: 'A4' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Curalink_Research_Brief_${id}.pdf`);

    doc.pipe(res);

    // Deep blue top banner
    doc.rect(0, 0, doc.page.width, 110).fill('#1E3A8A');

    doc.fillColor('#FFFFFF').fontSize(26).font('Helvetica-Bold').text('Curalink Research Dossier', 50, 35);
    doc.fillColor('#93C5FD').fontSize(14).font('Helvetica').text(`Topic: ${conversation.title}`, 50, 70);

    let y = 140;

    // Patient Profile Box
    if (conversation.userProfile && (conversation.userProfile.patientName || conversation.userProfile.diseaseOfInterest)) {
      doc.roundedRect(50, y, doc.page.width - 100, 75, 8).fill('#F8FAFC');
      doc.fillColor('#3B82F6').fontSize(14).font('Helvetica-Bold').text('Patient Context & Settings', 70, y + 15);

      doc.fillColor('#334155').fontSize(11).font('Helvetica');
      let pY = y + 40;
      if (conversation.userProfile.patientName) {
        doc.text(`Patient: ${conversation.userProfile.patientName}`, 70, pY);
      }
      if (conversation.userProfile.diseaseOfInterest) {
        doc.text(`Condition: ${conversation.userProfile.diseaseOfInterest}`, 250, pY);
      }
      if (conversation.userProfile.location) {
        doc.text(`Location: ${conversation.userProfile.location}`, 430, pY);
      }
      y += 105;
    }

    // Messages
    for (const msg of conversation.messages) {
      if (doc.y > doc.page.height - 150) {
        doc.addPage();
      }

      doc.x = 50; // Reset X margin

      if (msg.role === 'user') {
        const startY = doc.y;
        // We draw the text first to correctly compute its height and advance doc.y natively
        doc.moveDown(0.5);
        doc.fillColor('#0F172A').fontSize(12).font('Helvetica-Bold');
        const textH = doc.heightOfString('Q: ' + msg.content, { width: doc.page.width - 140 });

        // Background for query
        doc.roundedRect(50, startY, doc.page.width - 100, textH + 20, 8).fill('#F1F5F9');

        // Actually print the text inside it
        doc.fillColor('#0F172A').text('Q: ' + msg.content, 70, startY + 10, { width: doc.page.width - 140 });

        // Reset X and move down natively
        doc.x = 50;
        doc.y = startY + textH + 40;
      } else if (msg.role === 'assistant') {
        doc.fillColor('#2563EB').fontSize(16).font('Helvetica-Bold').text('Clinical Intelligence');
        doc.moveDown(1);

        if (msg.response && msg.response.conditionOverview) {
          doc.fillColor('#0F172A').fontSize(13).font('Helvetica-Bold').text('Overview');
          doc.fillColor('#475569').fontSize(11).font('Helvetica').text(msg.response.conditionOverview, { lineGap: 3 });
          doc.moveDown(1);

          doc.fillColor('#0F172A').fontSize(13).font('Helvetica-Bold').text('Key Research Findings');
          doc.fillColor('#475569').fontSize(11).font('Helvetica').text(msg.response.researchInsights, { lineGap: 3 });
          doc.moveDown(1);

          if (msg.response.clinicalTrialsSummary) {
            doc.fillColor('#0F172A').fontSize(13).font('Helvetica-Bold').text('Clinical Trials Summary');
            doc.fillColor('#475569').fontSize(11).font('Helvetica').text(msg.response.clinicalTrialsSummary, { lineGap: 3 });
            doc.moveDown(1);
          }

          if (msg.response.personalizedRecommendation) {
            doc.fillColor('#0F172A').fontSize(13).font('Helvetica-Bold').text('Recommendation');
            doc.fillColor('#475569').fontSize(11).font('Helvetica').text(msg.response.personalizedRecommendation, { lineGap: 3 });
            doc.moveDown(1);
          }

          if (msg.response.keyFindings && msg.response.keyFindings.length > 0) {
            doc.fillColor('#64748B').fontSize(12).font('Helvetica-Bold').text('Primary Citations');
            doc.fillColor('#64748B').fontSize(9).font('Helvetica-Oblique');
            msg.response.keyFindings.forEach(kf => {
              doc.text(`• ${kf}`, { lineGap: 2 });
            });
            doc.moveDown(1);
          }

          // EXTRACTED PUBLICATIONS
          if (msg.response.publications && msg.response.publications.length > 0) {
            doc.fillColor('#0F172A').fontSize(13).font('Helvetica-Bold').text('Corroborating Publications');
            doc.moveDown(0.3);
            msg.response.publications.slice(0, 5).forEach((pub, i) => {
              doc.fillColor('#3B82F6').fontSize(10).font('Helvetica-Bold').text(`${i + 1}. ${pub.title || 'Untitled Publication'}`);
              doc.fillColor('#94A3B8').fontSize(9).font('Helvetica').text(`Year: ${pub.year || 'N/A'} | Citations: ${pub.citationCount || '0'} | Relevance: ${(pub.relevanceScore * 100).toFixed(0)}%`);
              if (pub.url) {
                doc.fillColor('#60A5FA').fontSize(9).text(pub.url, { link: pub.url, underline: true });
              }
              doc.moveDown(0.5);
            });
            doc.moveDown(1);
          }

          // EXTRACTED TRIALS
          if (msg.response.clinicalTrials && msg.response.clinicalTrials.length > 0) {
            doc.fillColor('#0F172A').fontSize(13).font('Helvetica-Bold').text('Targeted Clinical Trials');
            doc.moveDown(0.3);
            msg.response.clinicalTrials.slice(0, 5).forEach((trial, i) => {
              doc.fillColor('#10B981').fontSize(10).font('Helvetica-Bold').text(`${i + 1}. ${trial.title || 'Untitled Trial'}`);
              doc.fillColor('#94A3B8').fontSize(9).font('Helvetica').text(`Status: ${trial.status || 'Unknown'} | Phase: ${trial.phase || 'N/A'} | Enrollment: ${trial.enrollmentCount || 'N/A'}`);
              if (trial.nctId) {
                const tUrl = `https://clinicaltrials.gov/study/${trial.nctId}`;
                doc.fillColor('#60A5FA').fontSize(9).text(tUrl, { link: tUrl, underline: true });
              }
              doc.moveDown(0.5);
            });
            doc.moveDown(1);
          }

        } else {
          doc.fillColor('#475569').fontSize(11).font('Helvetica').text(msg.content, { lineGap: 3 });
          doc.moveDown(2);
        }
      }
    }

    // Footer at very bottom
    let pageCount = doc.bufferedPageRange ? doc.bufferedPageRange().count : 1;
    doc.fillColor('#94A3B8').fontSize(10).font('Helvetica-Oblique').text('Generated globally by Curalink AI Medical Pipeline', 50, doc.page.height - 50, { align: 'center' });

    doc.end();

  } catch (error) {
    console.error('PDF Export Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate PDF' });
    }
  }
};
