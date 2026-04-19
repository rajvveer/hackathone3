const { v4: uuidv4 } = require('uuid');
const Conversation = require('../models/Conversation');
const queryExpander = require('../services/queryExpander');
const retrievalManager = require('../services/retrievalManager');
const rankingPipeline = require('../services/rankingPipeline');
const llmService = require('../services/llmService');

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

  if (!conversation) {
    conversation = new Conversation({
      conversationId: convId,
      userId: user ? user._id : undefined,
      title: typeof userInput === 'string'
        ? userInput.substring(0, 60)
        : (userInput.query || userInput.disease || 'New Research Chat'),
      userProfile: typeof userInput === 'object' ? {
        patientName: userInput.patientName,
        diseaseOfInterest: userInput.disease,
        location: userInput.location
      } : {}
    });
  } else if (typeof userInput === 'object' && userInput.disease) {
    // Update userProfile on pre-created conversations (from /conversations/new)
    conversation.userProfile = {
      patientName: userInput.patientName || conversation.userProfile?.patientName || '',
      diseaseOfInterest: userInput.disease || conversation.userProfile?.diseaseOfInterest || '',
      location: userInput.location || conversation.userProfile?.location || ''
    };
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
    lastLocation: conversation.metadata?.lastLocation || ''
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
    const ranked = rankingPipeline.rank(retrieval.publications, retrieval.clinicalTrials, expansion);

    // 4. LLM Reasoning
    console.log('\n🤖 Step 4: LLM generating response...');
    const llmStart = Date.now();
    const llmResponse = await llmService.generateMedicalResponse(
      typeof userInput === 'string' ? userInput : (userInput.query || userInput.disease),
      { disease: expansion.disease, intent: expansion.intent, location: expansion.location || '', patientName: expansion.patientName || '', isSymptomQuery: expansion.isSymptomQuery || false },
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
    const ranked = rankingPipeline.rank(retrieval.publications, retrieval.clinicalTrials, expansion);
    send('ranked', {
      selectedPubs: ranked.rankingMetrics.selectedPublications,
      selectedTrials: ranked.rankingMetrics.selectedTrials
    });

    // Step 4: LLM Reasoning
    send('step', { step: 4, message: 'Generating research insights with Llama 3 70B...' });
    const llmStart = Date.now();
    const llmResponse = await llmService.generateMedicalResponse(
      typeof userInput === 'string' ? userInput : (userInput.query || userInput.disease),
      { disease: expansion.disease, intent: expansion.intent, location: expansion.location || '', patientName: expansion.patientName || '', isSymptomQuery: expansion.isSymptomQuery || false },
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
    const conversation = new Conversation({
      conversationId: uuidv4(),
      title: 'New Conversation',
      userId: req.user ? req.user._id : undefined
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
