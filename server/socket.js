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
      origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:3000'],
      credentials: true,
    },
    maxHttpBufferSize: 10 * 1024 * 1024, // 10MB for audio
  });

  io.on('connection', (socket) => {
    console.log(`🎙️  Voice client connected: ${socket.id}`);
    
    // Track conversation history per socket session
    let voiceHistory = [];
    let hasGreeted = false;

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
Analyze the patient's message and classify it into one of three categories.

RULES:
- "greeting": casual greetings, "who are you", "hello", "thanks", "bye" etc.
- "vague": patient describes symptoms WITHOUT clear disease context. e.g. "I have headache", "my back hurts", "I feel dizzy", "I'm not feeling well". These need follow-up questions to narrow down.
- "research": patient asks about a SPECIFIC disease, treatment, medication, clinical trial, or research topic with enough context. e.g. "latest treatment for lung cancer", "gene therapy studies", "diabetes clinical trials", "what is immunotherapy".

For "greeting": provide a SHORT warm doctor-like response (1 sentence max).
For "vague": ask exactly ONE short follow-up question (max 2 sentences). First briefly acknowledge, then ask ONE specific thing — like "How long have you had this?" or "Any other symptoms along with it?" Do NOT ask multiple questions at once.
For "research": leave response empty, the system will fetch research.

Conversation history:
${voiceHistory.map(m => `${m.role}: ${m.content}`).join('\n') || 'None'}

Respond ONLY in valid JSON:
{"type": "greeting|vague|research", "response": "your response text if greeting or vague, empty if research"}`;

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

        console.log(`🧠 Voice classify: ${voiceClass.type}`);

        // Handle greeting or vague queries with a spoken reply
        if (voiceClass.type === 'greeting' || voiceClass.type === 'vague') {
          const reply = voiceClass.response || (voiceClass.type === 'greeting' 
            ? "Hello! I'm Dr. Curalink. What medical topic would you like to explore?"
            : "Could you tell me more about your symptoms? When did they start, and have you noticed anything else?");
          
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

        // ── Step 3: Query Expansion ───────────────────────────
        socket.emit('voice:thinking', { step: 'expanding', message: 'Analyzing your question...' });
        const expansion = await queryExpander.expand(transcription, '');
        console.log(`🧠 Disease: ${expansion.disease} | Queries: ${expansion.expandedQueries.join(', ')}`);

        // ── Step 4: Retrieval (with 18s timeout so it never hangs forever) ────
        socket.emit('voice:thinking', { step: 'retrieving', message: 'Searching medical databases...' });
        let retrieval;
        try {
          retrieval = await Promise.race([
            retrievalManager.retrieve(expansion),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Retrieval timeout')), 18000))
          ]);
        } catch (retErr) {
          console.warn('⚠️ Retrieval failed/timeout:', retErr.message);
          // Use empty results so the LLM can still respond from context
          retrieval = { publications: [], clinicalTrials: [], metadata: { totalResults: 0, pubmedCount: 0, openAlexCount: 0, clinicalTrialsCount: 0 } };
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

        // ── Step 5: Ranking ───────────────────────────────────
        socket.emit('voice:thinking', { step: 'ranking', message: 'Analyzing relevance...' });
        const ranked = rankingPipeline.rank(
          retrieval.publications, 
          retrieval.clinicalTrials, 
          expansion
        );

        // ── Step 6: Generate and Stream Voice Response ───────────────────
        socket.emit('voice:thinking', { step: 'speaking', message: 'Dr. Curalink is speaking...' });

        // Send research data for visual cards IMMEDIATELY so UI populates while speaking
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

        const stream = llmService.generateVoiceResponseStream(
          transcription,
          ranked.publications,
          ranked.clinicalTrials,
          voiceHistory
        );

        let currentSentence = '';
        let fullVoiceText = '';
        let ttsPromises = [];

        // Stream tokens from Groq
        for await (const chunk of stream) {
          currentSentence += chunk;
          fullVoiceText += chunk;
          
          socket.emit('voice:text_chunk', { text: fullVoiceText, isFinal: false });

          // Detect sentence boundaries
          if (/[.?!](\s|$)/.test(currentSentence)) {
            const sentenceToSpeak = currentSentence.trim();
            currentSentence = ''; // reset for next sentence

            if (sentenceToSpeak.length > 2) {
              const p = synthesizeSpeech(sentenceToSpeak).then(buf => {
                socket.emit('voice:audio_chunk', buf);
              }).catch(e => {
                console.error('Streaming TTS Error:', e.message);
                // If TTS fails, at least the text caption is visible — no crash
              });
              ttsPromises.push(p);
            }
          }
        }

        // Flush any remaining partial sentence
        if (currentSentence.trim().length > 2) {
          const p = synthesizeSpeech(currentSentence.trim()).then(buf => {
            socket.emit('voice:audio_chunk', buf);
          }).catch(e => console.error('Streaming TTS Error:', e.message));
          ttsPromises.push(p);
        }

        // Wait for all TTS chunks to finish (each has its own 30s timeout in sarvamService)
        await Promise.all(ttsPromises);

        // If no audio was produced at all (all TTS failed), emit a silent done so UI recovers
        if (ttsPromises.length === 0) {
          console.warn('⚠️ No TTS chunks produced — emitting done anyway');
        }

        socket.emit('voice:text_chunk', { text: fullVoiceText, isFinal: true });

        // Update conversation history
        voiceHistory.push({ role: 'user', content: transcription });
        voiceHistory.push({ role: 'assistant', content: fullVoiceText });

        if (voiceHistory.length > 12) voiceHistory = voiceHistory.slice(-12);

        socket.emit('voice:done', {});

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
