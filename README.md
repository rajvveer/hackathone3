# 🧬 Curalink — AI Medical Research Assistant

An advanced **MERN stack** AI-powered medical research companion that retrieves, ranks, and reasons over real research data from **PubMed**, **OpenAlex**, and **ClinicalTrials.gov** using **Llama 3 70B** (via Groq).

---

## 🏗️ Architecture

```
User Query
    ↓
🧠 Query Expansion (Llama-3.1-8b — LLM-powered synonym expansion)
    ↓
🔍 Parallel Retrieval (3 sources simultaneously)
   ├── OpenAlex API    → 150+ publications (multi-page, 2018–present)
   ├── PubMed NCBI API → 100+ publications (two-step: search IDs → fetch XML)
   └── ClinicalTrials.gov v2 → 150+ trials (3 status groups)
    ↓
⚡ Two-Tier Cache (Redis L1 → MongoDB L2)
    ↓
📊 Multi-Factor Ranking Pipeline
   ├── Publications:    Relevance(40%) + Recency(25%) + Credibility(20%) + Citations(15%)
   └── Clinical Trials: Relevance(35%) + Status(25%) + Location(25%) + Recency(15%)
    ↓
🤖 LLM Reasoning (Llama-3.3-70b-versatile — structured JSON output)
    ↓
📋 Structured Response (Condition Overview + Research Insights + Trials + Recommendations)
```

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- MongoDB (local or Atlas)
- Redis (optional, auto-degrades to MongoDB cache)
- Groq API key (free at [console.groq.com](https://console.groq.com))

### 1. Clone & install
```bash
cd server && npm install
cd ../client && npm install --legacy-peer-deps
```

### 2. Configure environment
```bash
cp server/.env.example server/.env
# Edit server/.env and set GROQ_API_KEY
```

### 3. Run
```bash
# Terminal 1 — Backend
cd server && npm run dev

# Terminal 2 — Frontend
cd client && npm run dev
```

Open **http://localhost:5173**

---

## ⚙️ Configuration

| Variable | Description | Default |
|---|---|---|
| `GROQ_API_KEY` | **Required** — Get free at console.groq.com | — |
| `MONGODB_URI` | MongoDB connection string | `localhost:27017/curalink` |
| `REDIS_URL` | Cloud Redis URL (Upstash etc.) | — |
| `REDIS_HOST` | Local Redis host | `127.0.0.1` |
| `REDIS_PORT` | Local Redis port | `6379` |
| `NCBI_API_KEY` | PubMed rate limit: 3→10 req/sec | — |
| `LLM_PROVIDER` | `groq` or `ollama` | `groq` |
| `OLLAMA_URL` | Ollama server URL | `localhost:11434` |

---

## 🛠️ Tech Stack

### Backend
- **Node.js + Express** — REST API with SSE streaming
- **MongoDB + Mongoose** — Conversation history, persistent cache (24hr TTL)
- **Redis (ioredis)** — In-memory L1 cache (1hr TTL), graceful degradation
- **Groq SDK** — Llama 3 inference (llama-3.3-70b-versatile + llama-3.1-8b-instant)
- **Ollama** — Local LLM fallback

### Frontend
- **React 19 + Vite 8** — SPA
- **Vanilla CSS** — Dark glassmorphism design system
- **SSE streaming** — Real-time pipeline step updates (server-driven)

### Data Sources
- **OpenAlex API** — Open academic publications (3 pages × 50 = 150 per query)
- **PubMed NCBI E-utilities** — Biomedical literature (100 per query, XML parsing)
- **ClinicalTrials.gov API v2** — Clinical trials (3 status groups × 50 = 150 total)

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/chat` | Standard JSON response |
| `POST` | `/api/chat/stream` | **SSE streaming** — real-time pipeline events |
| `GET` | `/api/conversations` | List all conversations |
| `GET` | `/api/conversations/:id` | Get conversation with full history |
| `POST` | `/api/conversations/new` | Create new conversation |
| `DELETE` | `/api/conversations/:id` | Delete conversation |
| `GET` | `/api/health` | Health check (shows Redis/LLM status) |

### Streaming Events (`/api/chat/stream`)
```
event: step       → { step: 1-4, message: "..." }        (pipeline progress)
event: expanded   → { disease, queries[], isResearcherQuery }
event: retrieved  → { openAlex, pubmed, trials, fromCache }
event: ranked     → { selectedPubs, selectedTrials }
event: result     → { full response JSON }
event: done       → {}
event: error      → { message }
```

---

## 📊 Demo Queries

- `"Latest treatment for lung cancer"`
- `"Clinical trials for diabetes"`
- `"Top researchers in Alzheimer's disease"` — triggers OpenAlex Authors API
- `"Recent studies on heart disease"`
- Structured: Patient Name + Disease + Query + Location

---

## 📁 Project Structure

```
hakathone3/
├── client/                     # React frontend
│   ├── src/
│   │   ├── App.jsx             # Main layout + pipeline banner
│   │   ├── components/
│   │   │   ├── MessageBubble.jsx   # Full response renderer
│   │   │   ├── LoadingState.jsx    # 4-step pipeline progress
│   │   │   ├── Sidebar.jsx         # Conversation history
│   │   │   └── StructuredForm.jsx  # Structured query form
│   │   ├── hooks/useChat.js        # SSE streaming state management
│   │   └── services/api.js         # API + streaming client
│   └── vite.config.js
└── server/                     # Node.js backend
    ├── index.js                # Express + Redis init
    ├── config/
    │   ├── constants.js        # API endpoints, weights, models
    │   ├── db.js               # MongoDB connection
    │   └── redis.js            # Redis client (graceful degradation)
    ├── controllers/
    │   └── chatController.js   # Pipeline orchestration + SSE handler
    ├── middleware/errorHandler.js
    ├── models/
    │   ├── Conversation.js     # Chat history schema
    │   └── ResearchCache.js    # Query result cache (TTL: 24hr)
    ├── routes/chatRoutes.js
    └── services/
        ├── queryExpander.js        # LLM + rule-based expansion
        ├── openAlexService.js      # Publications + Top Researchers
        ├── pubmedService.js        # Two-step PubMed retrieval
        ├── clinicalTrialsService.js
        ├── retrievalManager.js     # Two-tier cache + parallel fetch
        ├── rankingPipeline.js      # Multi-factor scoring
        └── llmService.js           # Groq/Ollama reasoning
```
