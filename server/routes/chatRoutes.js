const express = require('express');
const router = express.Router();
const multer = require('multer');
const chatController = require('../controllers/chatController');
const { optionalAuth, requireAuth } = require('../middleware/auth');

// Multer config — memory storage, 10MB limit, PDF + images only
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, JPG, PNG, and WEBP are allowed.'), false);
    }
  }
});

// Main chat endpoint (standard JSON)
router.post('/chat', optionalAuth, chatController.handleChat);

// Streaming chat endpoint (Server-Sent Events)
router.post('/chat/stream', optionalAuth, chatController.handleChatStream);

// Follow-up clarification questions endpoint
router.post('/chat/clarify', optionalAuth, chatController.handleClarification);

// Medical file upload & AI analysis
router.post('/chat/upload', optionalAuth, upload.single('file'), chatController.handleFileUpload);

// Trial Matcher
router.post('/chat/trial-match', optionalAuth, chatController.matchTrial);

// Heatmap Coordinates
router.post('/chat/heatmap-coords', optionalAuth, chatController.getHeatmapCoords);

// Conversation management
router.get('/conversations', optionalAuth, chatController.getConversations);
router.get('/conversations/:id', optionalAuth, chatController.getConversation);
router.get('/conversations/:id/export', optionalAuth, chatController.exportPDF);
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
