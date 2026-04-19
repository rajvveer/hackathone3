const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const { optionalAuth, requireAuth } = require('../middleware/auth');

// Main chat endpoint (standard JSON)
router.post('/chat', optionalAuth, chatController.handleChat);

// Streaming chat endpoint (Server-Sent Events)
router.post('/chat/stream', optionalAuth, chatController.handleChatStream);

// Follow-up clarification questions endpoint
router.post('/chat/clarify', optionalAuth, chatController.handleClarification);

// Conversation management
router.get('/conversations', optionalAuth, chatController.getConversations);
router.get('/conversations/:id', optionalAuth, chatController.getConversation);
router.post('/conversations/new', optionalAuth, chatController.createConversation);
router.post('/conversations/migrate', requireAuth, chatController.migrateConversations);
router.delete('/conversations/:id', optionalAuth, chatController.deleteConversation);

// Health check — shows LLM provider, Redis status, models
router.get('/health', (req, res) => {
  const { getRedis } = require('../config/redis');
  const redisClient = getRedis();

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    llmProvider: process.env.LLM_PROVIDER || 'groq',
    redis: redisClient ? 'connected' : 'unavailable (using MongoDB cache only)',
    models: require('../config/constants').MODELS,
    pipeline: {
      sources: ['OpenAlex', 'PubMed', 'ClinicalTrials.gov'],
      streaming: true,
      caching: redisClient ? 'Redis (L1) + MongoDB (L2)' : 'MongoDB only'
    }
  });
});

module.exports = router;
