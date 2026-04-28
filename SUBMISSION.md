# Hackathon Submission: Curalink AI

**Name:** Rajveer
**Email ID:** rajveershekhawat626@gmail.com  

### Project Name: Curalink AI — Intelligent Medical Research Assistant

---

### 📝 Project Description
Curalink AI is a precision-engineered medical research workstation designed to bridge the gap between massive, unstructured clinical data and actionable medical insights. Unlike generic AI chatbots, Curalink dynamically retrieves, actively ranks, and intelligently reasons over live global research data from PubMed, OpenAlex, and ClinicalTrials.gov. It is built for clinicians and researchers who require evidence-backed, high-integrity medical intelligence delivered at lightning speeds.

### 🔥 Key Features
*   **🎙️ Real-time Voice AI Assistant:** Hands-free interaction via high-performance WebSockets, featuring live captions and a custom "Thinking" visualizer for low-latency medical queries.
*   **📄 Multi-Modal Medical Vision:** Capability to drag-and-drop clinical PDFs or lab imaging for instant OCR and semantic analysis of medical values and prescriptions.
*   **🗺️ Global Trials Heatmap:** Interactive heatmap geocoded from live clinical data to visualize research access hubs and clinical trial density worldwide.
*   **🧠 Intelligent Ranking & Deduplication:** A proprietary 4-factor scoring algorithm (Relevance, Recency, Credibility, Citations) that identifies and promotes high-tier clinical evidence.
*   **🛡️ Hallucination Guard:** Built-in semantic gap detection and context-aware intent filtering that ensures the AI remains strictly grounded in retrieved research facts.
*   **🗂️ 3-Pane Research Dashboard:** A premium UI featuring Navigational History, a Central Medical Canvas, and a Right Contextual Panel for live metrics.
*   **📑 AI Trial Eligibility Matcher:** Automatically evaluates patient eligibility for trials and dynamically generates follow-up questions for missing clinical parameters.

### 🤖 5 AI Models Integrated (4 Open-Source)
We have utilized an ensemble of 5 specialized models to deliver premium performance:
1.  **Llama 3.1 8B (Open-Source):** Used for low-latency Query Expansion and Intent Classification.
2.  **Qwen 32B (Open-Source):** Our heavy reasoning engine for synthesizing structured medical summaries from multiple data sources.
3.  **Llama 3.2 90B Vision (Open-Source):** Handles multimodal parsing and semantic understanding of medical documents and imaging.
4.  **Whisper Large V3 Turbo (Open-Source):** Provides highly accurate speech-to-text for complex medical terminology.
5.  **Sarvam AI TTS:** Generates high-fidelity, natural-sounding audio for the AI doctor persona.

### ⚙️ Tech Stack
*   **Frontend:** React 19, Vite, Socket.io-client, React-Leaflet, OAuth2 (Google), Vanilla Glassmorphic CSS.
*   **Backend:** Node.js, Express, Socket.IO, Multer, PDFKit.
*   **Databases & Caching:** MongoDB (Persistence), Redis (L1 In-Memory Cache), Cloudinary (Medical Image Storage).
*   **Inference:** high-performance parallel processing for sub-second latency.
*   **APIs:** PubMed (NCBI), OpenAlex, ClinicalTrials.gov V2.

### 🔗 Project Links
*   **URL Link:** [https://delicate-strudel-6e6afe.netlify.app/](https://delicate-strudel-6e6afe.netlify.app/)
- **Demo Video:** [https://www.youtube.com/watch?v=GOidE1kmLyY](https://www.youtube.com/watch?v=GOidE1kmLyY)

### 🧠 How It Works
1.  **Input:** User provides a query via Text, Voice, or Medical File (PDF/Image).
2.  **Expansion:** Llama 8B expands the query into 5+ structured medical search terms.
3.  **Parallel Retrieval:** Simultaneously polls PubMed, OpenAlex, and ClinicalTrials.gov, fetching up to 600+ documents in seconds.
4.  **Ranking Engine:** Algorithmic deduplication and 4-factor scoring (TF-IDF + Exponential Age Decay + Credibility Regex).
5.  **Reasoning Engine:** Top results are context-injected into Qwen 32B to generate a structured, cited medical summary.
6.  **Response:** The system streams a high-precision response back to the user with interactive follow-up chips and voice output.

---
*Developed for the Hackathon. Innovating the speed of medical intelligence.*
