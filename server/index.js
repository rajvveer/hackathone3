require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const connectDB = require('./config/db');
const { connectRedis } = require('./config/redis');
const chatRoutes = require('./routes/chatRoutes');
const errorHandler = require('./middleware/errorHandler');
const { initSocket } = require('./socket');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

// Connect to MongoDB
connectDB();

// Connect to Redis (non-blocking, graceful degradation)
connectRedis();

// Middleware
app.use(helmet());
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://localhost:3000',
    'https://delicate-strudel-6e6afe.netlify.app',
    'https://aidoctor-f-5xoc.vercel.app'
  ],
  credentials: true
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));

const authRoutes = require('./routes/authRoutes');
const { synthesizeSpeech } = require('./services/sarvamService');

// Routes
app.use('/api/auth', authRoutes);
app.use('/api', chatRoutes);

// Quick Sarvam TTS health-check (no auth needed for dev)
app.get('/api/voice/test', async (req, res) => {
  try {
    const buf = await synthesizeSpeech('Hello, I am Dr. Curalink. Voice system is working perfectly.');
    res.json({ ok: true, bytes: buf.length, message: 'Sarvam TTS is working!' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Curalink API',
    version: '2.0.0',
    description: 'AI Medical Research Assistant',
    cache: 'Redis (L1) + MongoDB (L2)',
    endpoints: {
      chat: 'POST /api/chat',
      chatStream: 'POST /api/chat/stream',
      conversations: 'GET /api/conversations',
      voice: 'WebSocket /voice',
      health: 'GET /api/health'
    }
  });
});

// Error handler
app.use(errorHandler);

// Initialize Socket.io for Voice-to-Voice
initSocket(server);

server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║          🧬 CURALINK API SERVER 🧬           ║
║══════════════════════════════════════════════║
║  Port:     ${PORT}                              ║
║  LLM:      ${(process.env.LLM_PROVIDER || 'groq').padEnd(33)}║
║  Cache:    Redis (L1) + MongoDB (L2)         ║
║  Pipeline: Expand → Retrieve → Rank → LLM   ║
║  Voice:    WebSocket (Groq + Sarvam)    ║
╚══════════════════════════════════════════════╝
  `);
});

// Graceful shutdown to prevent EADDRINUSE on restarts
const gracefulShutdown = () => {
  console.log('Shutting down server...');
  server.close(() => {
    console.log('Server stopped.');
    process.exit(0);
  });
  // Force exit after 3s if hanging
  setTimeout(() => process.exit(1), 3000);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

module.exports = app;

