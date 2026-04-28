# Curalink AI — Demo Walkthrough Pitch (Simple Version)

**For:** Hackathon Demo Meeting  
**Duration:** 8–10 minutes  
**Deployed At:** https://delicate-strudel-6e6afe.netlify.app

---

## ✅ Before You Start (30 Min Before)

- [ ] Open the app in Chrome — make sure it loads
- [ ] Do a test search like "lung cancer" — make sure results come back
- [ ] Open Voice Mode — check mic works and greeting plays
- [ ] Upload a test PDF — make sure analysis works
- [ ] Check Railway backend logs — no crashes
- [ ] Close extra tabs, turn off notifications
- [ ] Keep GitHub repo open in another tab
- [ ] Keep this pitch on your phone or second screen

---

## Part 1: Opening (0:00 – 1:30) 🎤

> "Hi, I'm Rajveer. Thanks for having me.
> 
> This is **Curalink** — an AI-powered medical research assistant.
> 
> Let me be clear about what this is NOT:
> - It's NOT a ChatGPT wrapper
> - It's NOT a single API call with a nice UI
> 
> Curalink is a **full RAG system** — that means Retrieval-Augmented Generation. 
> When you ask it a medical question, it goes out and searches **three real medical 
> databases** — PubMed, OpenAlex, and ClinicalTrials.gov — pulls back **600+ real 
> research papers**, scores and ranks them using a custom algorithm, and then feeds 
> the best ones into an AI model that writes you a research summary with real citations.
> 
> We use **5 different AI models**, each picked for a specific job, all running on 
> Groq's hardware at 800+ tokens per second.
> 
> The whole thing takes **under 10 seconds**.
> 
> Let me show you."

---

## Part 2: Live Demo (1:30 – 7:30) 🖥️

### Demo 1: Medical Search (1:30 – 3:00)

**Action:** Type `Latest treatment for lung cancer` → hit Enter

**While it loads, say:**

> "So when I hit send, here's what's happening behind the scenes:
> 
> **Step 1** — My query goes to a fast AI model called Llama 8B. It takes my 
> simple question and turns it into 5 smart medical search terms — like 
> 'NSCLC immunotherapy' or 'lung cancer targeted therapy'. You can see 
> those expanded queries showing up right now.
> 
> **Step 2** — Those 5 search terms get sent to three databases at the same 
> time — PubMed, OpenAlex, and ClinicalTrials.gov. We're pulling up to 
> 450 papers from OpenAlex, 150 from PubMed, and 75 clinical trials — 
> all at once, in parallel.
> 
> **Step 3** — Now we have 600+ results. We can't show all of them, so our 
> **Ranking Engine** scores every paper on four things:
> - **40% Relevance** — how closely the paper matches the search
> - **25% Recency** — newer papers score higher, older ones drop off
> - **20% Credibility** — papers from top journals like Nature and Lancet get a boost
> - **15% Citations** — highly cited papers rank higher
> 
> From 600 papers, we pick the **Top 8**. Same for trials — Top 6.
> 
> **Step 4** — Those top results go into **Qwen 32B**, a powerful reasoning 
> model. It reads all the abstracts and writes a structured summary — 
> condition overview, key findings with citations, trial summaries, and 
> a personalized recommendation."

**When results show up, point out:**

- 📊 Pipeline metrics — how many papers retrieved, how long it took
- 📄 Publication cards — citations, open access tags, relevance scores
- 🏥 Trial cards — status, phase, enrollment count, sponsor
- 💡 Follow-up question chips at the bottom

---

### Demo 2: Context Memory + Hallucination Guard (3:00 – 4:00)

**Action:** Type `Can I take Vitamin D with my current treatment`

> "Notice I didn't say 'lung cancer' anywhere. But Curalink still knows 
> I'm talking about lung cancer. 
> 
> That's because we save **conversation context** in the database — it remembers 
> the disease, the intent, and the location from your previous messages.
> 
> But here's the important part — we also built a **Hallucination Guard**. 
> Normal AI models will sometimes make up a disease when you ask something 
> vague. Like if I say 'my treatment', ChatGPT might randomly guess 
> 'heart disease'. Our system catches that and forces it back to 
> the actual disease from the conversation — lung cancer.
> 
> And see this blue **'Indirect Evidence' banner**? That's our transparency 
> system. The app checks whether the research papers actually mention 
> Vitamin D specifically. If most of them don't, it honestly tells you: 
> 'Hey, we don't have direct research on this — here's background 
> research instead.' No fake answers. Full transparency."

---

### Demo 3: Voice AI Doctor (4:00 – 5:30)

**Action:** Click the 🎙️ mic icon → tap the orb → ask: *"What are the latest treatments for lymphoma?"*

> "This is our Voice AI feature. It runs on **WebSockets** for real-time 
> communication — no page refreshes, no delays.
> 
> Watch the particle sphere — it changes colors:
> - **Orange** = listening to you
> - **Blue** = thinking  
> - **Green** = speaking back
> 
> Here's the flow:
> 1. Your voice gets recorded as audio and sent to the server
> 2. **Whisper** (a speech recognition model) converts it to text
> 3. The system figures out if you're asking a real medical question or just saying hello
> 4. If it's a real question — the full research pipeline runs
> 5. The AI response gets cleaned up — some models write internal 'thinking' notes, 
>    we strip those out so the voice doesn't read its own thoughts
> 6. The text gets split into sentences and each one is converted to audio 
>    using **Sarvam AI's text-to-speech**
> 7. Audio plays back through the browser instantly
> 
> We also handle edge cases — if you close the browser mid-response, 
> we stop all the audio processing immediately so the server doesn't waste resources."

---

### Demo 4: Document Upload (5:30 – 6:00)

**Action:** Click 📎 → upload a medical PDF or lab report photo

> "Patients can upload their medical documents directly.
> 
> - **PDFs** get the text extracted automatically
> - **Images** (like a photo of a lab report) go to a **90B Vision AI model** 
>   that can read and understand the document
> 
> It pulls out key info — test names, values, normal ranges — and flags 
> anything **abnormal or critical** with color-coded status badges.
> 
> A patient can literally take a photo of their blood test and get an 
> AI breakdown in seconds — all inside the same chat."

---

### Demo 5: Trial Eligibility Checker (6:00 – 6:30)

**Action:** Open a trial card from Demo 1 → click **"Am I Eligible?"**

> "Clinical trial eligibility criteria are huge blocks of text — pages of 
> rules about who can and can't join.
> 
> When you click 'Am I Eligible?', we send that criteria text along with 
> your conversation history to the AI.
> 
> If it doesn't have enough info — like your age or disease stage — it 
> doesn't guess. Instead, it asks you specific follow-up questions. 
> You answer them, and it re-evaluates.
> 
> It's a **back-and-forth dialogue**, not a one-shot guess."

---

### Demo 6: Smart Query Routing (6:30 – 7:00)

**Action:** New chat → type just `headache`

> "What if someone types something super vague — like just 'headache'?
> 
> Running 600 papers through the whole pipeline for 'headache' would be 
> a waste of compute and give bad results.
> 
> So we built a **smart router**. Before the pipeline starts, the AI 
> checks: 'Is this query specific enough?' If not — it skips the whole 
> research pipeline and instead shows **interactive follow-up questions**: 
> What do you want to know? Who is this for? Any specific symptoms?
> 
> Only once you give enough context does the heavy research start. 
> This saves time and gives much better results."

---

### Demo 7: Quick Feature Highlights (7:00 – 7:30)

Briefly show or mention:

| Feature | What to say |
|---------|-------------|
| **PDF Export** | "One-click export — generates a formatted research report as a PDF" |
| **Google Login** | "Sign in with Google to save your profile — disease, location, name — it auto-fills into every query" |
| **Smart Caching** | "Two-layer cache — Redis for instant lookups, MongoDB as backup. Same query twice? Zero API calls." |
| **Trials Map** | "Clinical trial locations shown on an interactive world map" |
| **Researcher Cards** | "We show top researchers in the field with citation counts and h-index scores" |

---

## Part 3: Closing (7:30 – 8:30) 🏁

> "Let me wrap up with the key numbers:
> 
> | What | Details |
> |------|---------|
> | AI Models | 5 — Llama 8B, Qwen 32B, Llama 90B Vision, Whisper, Sarvam TTS |
> | Open-Source | 4 out of 5 models are open-source |
> | Data Sources | PubMed, OpenAlex, ClinicalTrials.gov |
> | Papers per Query | Up to 675 |
> | Ranking | 4-factor custom algorithm |
> | Caching | Two-tier: Redis + MongoDB |
> | Speed | Under 10 seconds for 600+ documents |
> 
> Curalink processes more clinical research in one query than most doctors 
> review in a week. And it does it in under 10 seconds.
> 
> Thank you — happy to take any questions."

---

## 🧠 If Judges Ask Questions

**"How is this different from ChatGPT?"**
> "ChatGPT makes up medical facts. Curalink pulls from real databases — 
> PubMed, ClinicalTrials.gov — and cites real papers. We also have a 
> Hallucination Guard that stops the AI from inventing diseases. Plus, 
> ChatGPT can't give you live clinical trial data with eligibility matching."

**"Why 5 models instead of one?"**
> "Each model is picked for its job. The small fast one handles quick tasks 
> like classifying queries. The big one handles medical reasoning. The 
> vision model reads documents. We're not wasting a huge model on small tasks."

**"How do you handle rate limits?"**
> "We use API keys to get higher limits on PubMed. We have timeouts and 
> fallbacks if any API is slow. And our cache means repeated queries 
> never hit external APIs at all."

**"What about patient privacy?"**
> "Uploaded files are processed in memory — never saved to disk. Auth uses 
> Google OAuth with secure tokens. No patient data is stored beyond chat 
> history, which is tied to the user's account."

**"Can this scale?"**
> "Yes — the backend is stateless, deployed on Railway which auto-scales. 
> Frontend is on Netlify. MongoDB and Redis handle all the data. The 
> architecture is built for horizontal scaling."

**"What was hardest to build?"**
> "The Hallucination Guard and the Ranking Algorithm. Getting an AI to 
> NOT make things up is harder than getting it to answer correctly. Our 
> system uses two layers of checking — one at the query level and one 
> at the results level."

**"Show me the code"**
> Have GitHub ready. Key files:
> - `rankingPipeline.js` — the scoring algorithm
> - `queryExpander.js` — hallucination guard
> - `socket.js` — voice pipeline
> - `chatController.js` — main research pipeline
> - `retrievalManager.js` — caching system

---

## ⏱️ Timing Guide

| Section | Time | Total |
|---------|------|-------|
| Opening | 1:30 | 1:30 |
| Demo 1: Search | 1:30 | 3:00 |
| Demo 2: Context + Guard | 1:00 | 4:00 |
| Demo 3: Voice AI | 1:30 | 5:30 |
| Demo 4: File Upload | 0:30 | 6:00 |
| Demo 5: Eligibility | 0:30 | 6:30 |
| Demo 6: Smart Routing | 0:30 | 7:00 |
| Demo 7: Quick Features | 0:30 | 7:30 |
| Closing | 1:00 | 8:30 |
| Q&A Buffer | 1:30 | 10:00 |

---

## 💡 Tips

- **Talk while it loads** — explain what's happening. Don't stand there silently.
- **If something breaks** — say "Let me show you the code while that loads" and open GitHub. Don't panic.
- **Use real numbers** — "600 papers", "under 10 seconds", "Top 8". Judges love concrete data.
- **Have a backup** — if deployed version is slow, be ready to run locally.
- **Test the app every morning this week** — judges might check it anytime.
