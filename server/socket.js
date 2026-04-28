const { Server } = require('socket.io');
const llmService = require('./services/llmService');
const { synthesizeSpeech, synthesizeLongText } = require('./services/sarvamService');
const queryExpander = require('./services/queryExpander');
const retrievalManager = require('./services/retrievalManager');
const rankingPipeline = require('./services/rankingPipeline');

/**
 * Initialize Socket.io for the Voice-to-Voice pipeline.
 * 
 * Events received from client:
 *   voice:audio_chunk  — Raw audio buffer from browser MediaRecorder
 *   voice:stop         — User finished speaking
 *
 * Events sent to client:
 *   voice:transcription  — Whisper transcription result
 *   voice:thinking       — Pipeline status updates
 *   voice:text_chunk     — LLM text being generated
 *   voice:audio_chunk    — TTS audio buffer to play
 *   voice:done           — Pipeline complete
 *   voice:error          — Error occurred
 */
function initSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: [
        'http://localhost:5173', 
        'http://localhost:5174', 
        'http://localhost:5175', 
        'http://localhost:3000',
        'https://delicate-strudel-6e6afe.netlify.app',
        'https://aidoctor-f-5xoc.vercel.app'
      ],
      credentials: true,
    },
    maxHttpBufferSize: 10 * 1024 * 1024, // 10MB for audio
  });

  io.on('connection', (socket) => {
    console.log(`🎙️  Voice client connected: ${socket.id}`);

    // Track conversation history per socket session
    let voiceHistory = [];
    let hasGreeted = false;
    let followUpCount = 0; // Max 2 vague follow-ups, then force research
    let cachedResearch = null; // Cache research results per session for follow-ups

    /**
     * Send a warm greeting when the user first opens voice mode.
     */
    socket.on('voice:greet', async () => {
      if (hasGreeted) return;
      hasGreeted = true;
      const greeting = "Hello! I'm Dr. Curalink, your AI medical research assistant. How can I help you today?";
      socket.emit('voice:text_chunk', { text: greeting, isFinal: true });
      try {
        const audioBuf = await synthesizeSpeech(greeting);
        socket.emit('voice:audio_chunk', audioBuf);
        console.log(`✅ Greeting TTS OK: ${audioBuf.length} bytes`);
      } catch (e) {
        console.error('Greeting TTS error:', e.message);
        // Still emit done so the UI transitions — user will see text caption
      }
      socket.emit('voice:done', {});
      voiceHistory.push({ role: 'assistant', content: greeting });
    });

    /**
     * Client sends the COMPLETE audio file as one buffer.
     */
    socket.on('voice:complete_audio', async (audioData) => {
      const fullAudio = Buffer.from(audioData);

      console.log(`🎤 Complete audio received: ${fullAudio.length} bytes, header: [${fullAudio.slice(0, 4).toString('hex')}]`);

      // Minimum size guard
      if (fullAudio.length < 2000) {
        console.log('⚠️ Audio too short, skipping');
        socket.emit('voice:error', { message: 'No speech detected. Please try again.' });
        return;
      }

      // WebM header validation
      const header = fullAudio.slice(0, 4).toString('hex');
      if (header !== '1a45dfa3') {
        console.log(`⚠️ Invalid WebM header: ${header}`);
        socket.emit('voice:error', { message: 'Audio recording error. Please try again.' });
        return;
      }

      try {
        // ── Step 1: Transcribe with Groq Whisper ──────────────
        socket.emit('voice:thinking', { step: 'transcribing', message: 'Listening...' });

        const transcription = await llmService.transcribeAudio(fullAudio, 'recording.webm');

        if (!transcription || transcription.trim().length === 0) {
          socket.emit('voice:error', { message: 'Could not understand audio. Please try again.' });
          return;
        }

        console.log(`🎤 Transcription: "${transcription}"`);
        socket.emit('voice:transcription', { text: transcription });

        // ── Step 2: Smart Voice Classification ────────────────
        socket.emit('voice:thinking', { step: 'classifying', message: 'Understanding your question...' });

        const voiceClassPrompt = `You are an intent classifier for a voice-based AI doctor named Dr. Curalink.
Classify the patient's message into one of FOUR categories.

RULES:
- "greeting": casual greetings, "who are you", "hello", "thanks", "bye" etc.
- "vague": patient describes symptoms WITHOUT clear disease context. e.g. "I have headache", "my back hurts". These need follow-up.
- "detail": patient is asking for MORE DETAIL about the SAME topic already discussed. e.g. "tell me more", "what about the side effects", "explain that treatment", "can you elaborate". They are NOT introducing a new disease, region, or topic.
- "research": patient asks about a SPECIFIC topic, disease, treatment, OR introduces a NEW angle/region/aspect not yet discussed. e.g. "lung cancer treatment", "clinical trials in Asia", "what about immunotherapy for this", "trials in India". Even if it's related to the previous conversation, if it's a meaningfully different sub-topic or adds new specifics (like a region, drug name, treatment type), classify as "research".

IMPORTANT: We have already asked ${followUpCount} follow-up question(s). If this is 2 or more, classify as "research".
${cachedResearch ? 'We have previously researched and discussed a topic in this session.' : 'This is a fresh session with no prior research.'}

For "greeting": provide a SHORT warm doctor-like response (1 sentence max).
For "vague": ask exactly ONE short follow-up question (max 2 sentences).
For "detail": leave response empty — the system will use cached research.
For "research": leave response empty — the system will fetch fresh research.

Conversation history:
${voiceHistory.map(m => `${m.role}: ${m.content}`).join('\n') || 'None'}

Respond ONLY in valid JSON:
{"type": "greeting|vague|detail|research", "response": "text if greeting or vague, empty otherwise"}`;

        let voiceClass = { type: 'research', response: '' };
        try {
          const classResult = await llmService.generate(`Patient says: "${transcription}"`, {
            systemPrompt: voiceClassPrompt,
            temperature: 0.1,
            maxTokens: 256,
            jsonMode: true
          });
          voiceClass = JSON.parse(classResult);
        } catch (e) {
          console.error('Voice classify error:', e.message);
        }

        console.log(`🧠 Voice classify: ${voiceClass.type} (followUps: ${followUpCount})`);

        // Force research after 2 vague follow-ups
        if (voiceClass.type === 'vague' && followUpCount >= 2) {
          console.log(`🔄 Max follow-ups reached (${followUpCount}), forcing research mode`);
          voiceClass.type = 'research';
        }

        // Handle greeting or vague queries with a spoken reply
        if (voiceClass.type === 'greeting' || voiceClass.type === 'vague') {
          if (voiceClass.type === 'vague') followUpCount++;
          const reply = voiceClass.response || (voiceClass.type === 'greeting'
            ? "Hello! I'm Dr. Curalink. What medical topic would you like to explore?"
            : "Could you tell me more about your symptoms?");

          socket.emit('voice:text_chunk', { text: reply, isFinal: true });
          voiceHistory.push({ role: 'user', content: transcription });
          voiceHistory.push({ role: 'assistant', content: reply });

          try {
            const audioBuf = await synthesizeSpeech(reply);
            socket.emit('voice:audio_chunk', audioBuf);
          } catch (ttsErr) {
            console.error('TTS error:', ttsErr.message);
          }
          socket.emit('voice:done', {});
          return;
        }

        // ── Step 3: Research (fresh or cached) ─────────────────────────
        let ranked;

        if (voiceClass.type === 'detail' && cachedResearch) {
          // Genuine follow-up — reuse cached data
          console.log(`♻️ Detail follow-up — reusing cached research`);
          socket.emit('voice:thinking', { step: 'analyzing', message: 'Looking deeper into the research...' });
          ranked = cachedResearch;
        } else {
          // New topic or no cache — fresh research
          if (cachedResearch) console.log(`🔄 New research topic detected — clearing cache`);
          socket.emit('voice:thinking', { step: 'expanding', message: 'Analyzing your question...' });
          const expansion = await queryExpander.expand(transcription, {});
          console.log(`🧠 Disease: ${expansion.disease} | Queries: ${expansion.expandedQueries.join(', ')}`);

          socket.emit('voice:thinking', { step: 'retrieving', message: 'Searching medical databases...' });
          let retrieval;
          try {
            retrieval = await Promise.race([
              retrievalManager.retrieve(expansion),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Retrieval timeout')), 18000))
            ]);
          } catch (retErr) {
            console.warn('⚠️ Retrieval failed/timeout:', retErr.message);
            retrieval = { publications: [], clinicalTrials: [], metadata: { totalResults: 0, totalBeforeDedup: 0, totalAfterDedup: 0, pubmedCount: 0, openAlexCount: 0, clinicalTrialsCount: 0, sources: { openAlex: 'timeout', pubmed: 'timeout', clinicalTrials: 'timeout' } }, timeMs: 0 };
          }

          socket.emit('voice:thinking', {
            step: 'retrieved',
            message: `Found ${retrieval.metadata.totalResults || 0} results`,
            stats: {
              pubmed: retrieval.metadata.pubmedCount || 0,
              openAlex: retrieval.metadata.openAlexCount || 0,
              trials: retrieval.metadata.clinicalTrialsCount || 0,
            }
          });

          socket.emit('voice:thinking', { step: 'ranking', message: 'Analyzing relevance...' });
          ranked = rankingPipeline.rank(
            retrieval.publications,
            retrieval.clinicalTrials,
            expansion
          );

          cachedResearch = ranked;

          socket.emit('voice:research_data', {
            publications: ranked.publications.slice(0, 8).map(p => ({
              title: p.title,
              authors: p.authors?.slice(0, 3) || [],
              year: p.year,
              url: p.url,
              source: p.source,
              citationCount: p.citationCount || 0,
              relevanceScore: p.relevanceScore || 0,
            })),
            clinicalTrials: ranked.clinicalTrials.slice(0, 6).map(t => ({
              title: t.title,
              status: t.status,
              phase: t.phase,
              url: t.url,
              sponsor: t.sponsor,
            })),
            pipelineMetrics: {
              totalRetrieved: retrieval.metadata.totalResults || 0,
              selectedPublications: ranked.rankingMetrics.selectedPublications,
              selectedTrials: ranked.rankingMetrics.selectedTrials,
            }
          });
        }

        // ── Step 4: Generate FULL LLM response ─────────────────────────
        socket.emit('voice:thinking', { step: 'generating', message: 'Dr. Curalink is thinking...' });

        let fullVoiceText = '';
        const stream = llmService.generateVoiceResponseStream(
          transcription,
          ranked.publications,
          ranked.clinicalTrials,
          voiceHistory
        );
        for await (const chunk of stream) {
          fullVoiceText += chunk;
        }

        // Strip <think>...</think> reasoning blocks (Qwen/DeepSeek models emit these)
        fullVoiceText = fullVoiceText
          .replace(/<think>[\s\S]*?<\/think>/gi, '')  // complete think blocks
          .replace(/<think>[\s\S]*/gi, '')              // unclosed think block at end
          .replace(/<\/think>/gi, '')                   // stray closing tags
          .trim();

        console.log(`📝 Full voice response (${fullVoiceText.length} chars): "${fullVoiceText.substring(0, 80)}..."`);

        // Update conversation history
        voiceHistory.push({ role: 'user', content: transcription });
        voiceHistory.push({ role: 'assistant', content: fullVoiceText });
        if (voiceHistory.length > 12) voiceHistory = voiceHistory.slice(-12);

        // ── Step 5: TTS the complete response ─────────────────────────
        socket.emit('voice:thinking', { step: 'speaking', message: 'Dr. Curalink is speaking...' });
        socket.emit('voice:text_chunk', { text: fullVoiceText, isFinal: true });

        // Split into sentences for TTS
        const sentences = fullVoiceText
          .split(/(?<=[.!?])\s+/)
          .filter(s => s.trim().length > 2);

        for (const sentence of sentences) {
          // Stop TTS if client disconnected (prevents orphaned API calls)
          if (!socket.connected) {
            console.log('⚠️ Client disconnected — aborting TTS loop');
            break;
          }
          try {
            const audioBuf = await synthesizeSpeech(sentence.trim());
            if (!socket.connected) break; // Check again after async TTS call
            socket.emit('voice:audio_chunk', audioBuf);
          } catch (ttsErr) {
            console.error('TTS sentence error:', ttsErr.message);
          }
        }

        if (socket.connected) socket.emit('voice:done', {});

      } catch (error) {
        console.error('Voice pipeline error:', error);
        socket.emit('voice:error', { message: error.message || 'Something went wrong' });
      }
    });

    /**
     * Quick TTS test — client sends text, gets audio back
     */
    socket.on('voice:tts_test', async (data) => {
      try {
        const buf = await synthesizeSpeech(data.text || 'Hello, I am Dr. Curalink.');
        socket.emit('voice:audio_chunk', buf);
        socket.emit('voice:done', {});
      } catch (e) {
        socket.emit('voice:error', { message: e.message });
      }
    });

    socket.on('disconnect', () => {
      console.log(`🎙️  Voice client disconnected: ${socket.id}`);
      voiceHistory = [];
    });
  });

  return io;
}

module.exports = { initSocket };
