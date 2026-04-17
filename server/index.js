require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const connectDB = require('./config/db');
const { connectRedis } = require('./config/redis');
const chatRoutes = require('./routes/chatRoutes');
const errorHandler = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 5000;

// Connect to MongoDB
connectDB();

// Connect to Redis (non-blocking, graceful degradation)
connectRedis();

// Middleware
app.use(helmet());
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));

// Routes
app.use('/api', chatRoutes);

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
      health: 'GET /api/health'
    }
  });
});

// Error handler
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║          🧬 CURALINK API SERVER 🧬           ║
║══════════════════════════════════════════════║
║  Port:     ${PORT}                              ║
║  LLM:      ${(process.env.LLM_PROVIDER || 'groq').padEnd(33)}║
║  Cache:    Redis (L1) + MongoDB (L2)         ║
║  Pipeline: Expand → Retrieve → Rank → LLM   ║
╚══════════════════════════════════════════════╝
  `);
});

module.exports = app;
