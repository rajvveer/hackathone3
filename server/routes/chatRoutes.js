const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');

// Main chat endpoint (standard JSON)
router.post('/chat', chatController.handleChat);

// Streaming chat endpoint (Server-Sent Events)
// Frontend reads this as a stream, getting real-time pipeline step updates
router.post('/chat/stream', chatController.handleChatStream);

// Conversation management
router.get('/conversations', chatController.getConversations);
router.get('/conversations/:id', chatController.getConversation);
router.post('/conversations/new', chatController.createConversation);
router.delete('/conversations/:id', chatController.deleteConversation);

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
