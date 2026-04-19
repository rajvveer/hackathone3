import React, { useState, useRef, useEffect, useCallback } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = 'http://localhost:5000';
const PARTICLE_COUNT = 280;
const BASE_RADIUS = 100;

export default function VoiceAssistant({ onClose, onResearchData }) {
  const [status, setStatus] = useState('idle');
  const statusRef = useRef('idle');
  const updateStatus = useCallback((s) => { statusRef.current = s; setStatus(s); }, []);

  const [liveCaption, setLiveCaption] = useState('');
  const [thinkingMsg, setThinkingMsg] = useState('');
  const [error, setError] = useState('');

  const socketRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const playbackCtxRef = useRef(null);
  const micAnalyserRef = useRef(null);
  const micCtxRef = useRef(null);
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const audioQueueRef = useRef([]);
  const isPlayingRef = useRef(false);
  const streamRef = useRef(null);
  const doneRef = useRef(false);
  const silenceStartRef = useRef(null);
  const particlesRef = useRef(null);
  const timeRef = useRef(0);
  const volumeRef = useRef(0);
  const recordStartRef = useRef(0);
  const currentSourceRef = useRef(null);
  const closedRef = useRef(false);

  // These refs always hold the freshest function versions —
  // avoids stale closures in the socket useEffect (which runs only once)
  const startListeningRef = useRef(null);
  const playQueueRef = useRef(null);
  const updateStatusRef = useRef(updateStatus);
  useEffect(() => { updateStatusRef.current = updateStatus; }, [updateStatus]);

  // ── Hard stop ────────────────────────────────────────────
  const hardStop = useCallback(() => {
    closedRef.current = true;
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    if (currentSourceRef.current) { 
      try { currentSourceRef.current.stop(); } catch (_) {} 
      try { currentSourceRef.current.pause(); } catch (_) {} 
    }
    if (playbackCtxRef.current) { try { playbackCtxRef.current.close(); } catch (_) {} playbackCtxRef.current = null; }
    if (mediaRecorderRef.current?.state !== 'inactive') { try { mediaRecorderRef.current?.stop(); } catch (_) {} }
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (micCtxRef.current) { try { micCtxRef.current.close(); } catch (_) {} }
    if (socketRef.current) socketRef.current.disconnect();
    if (animRef.current) cancelAnimationFrame(animRef.current);
  }, []);

  const handleClose = useCallback(() => { hardStop(); onClose(); }, [hardStop, onClose]);

  // ── Particles ────────────────────────────────────────────
  useEffect(() => {
    const particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const phi = Math.acos(1 - 2 * (i + 0.5) / PARTICLE_COUNT);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      particles.push({ phi, theta, baseR: BASE_RADIUS, offset: Math.random() * Math.PI * 2, speed: 0.2 + Math.random() * 0.5, size: 1.2 + Math.random() * 1.8 });
    }
    particlesRef.current = particles;
  }, []);

  // ── Stop Mic ─────────────────────────────────────────────
  const stopMic = useCallback(() => {
    updateStatusRef.current('thinking');
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== 'inactive') {
      mr.stop();
    } else {
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    }
  }, []);

  // ── Play audio queue ─────────────────────────────────────
  const playQueue = useCallback(async () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;
    isPlayingRef.current = true;
    updateStatusRef.current('speaking');

    if (!playbackCtxRef.current || playbackCtxRef.current.state === 'closed') {
      playbackCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (playbackCtxRef.current.state === 'suspended') {
      playbackCtxRef.current.resume().catch(() => {});
      // Wait up to 500ms max
      await Promise.race([
        new Promise(r => {
          if (playbackCtxRef.current.state === 'running') return r();
          const handler = () => { if (playbackCtxRef.current.state === 'running') { playbackCtxRef.current.removeEventListener('statechange', handler); r(); } };
          playbackCtxRef.current.addEventListener('statechange', handler);
        }),
        new Promise(r => setTimeout(r, 500))
      ]);
    }

    while (audioQueueRef.current.length > 0) {
      if (closedRef.current) break;
      const chunk = audioQueueRef.current.shift();
      try {
        let ab;
        if (chunk instanceof ArrayBuffer) {
          ab = chunk.slice(0);
        } else if (chunk instanceof Blob) {
          ab = await chunk.arrayBuffer();
        } else if (ArrayBuffer.isView(chunk)) {
          ab = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
        } else {
          continue;
        }

        console.log(`🎵 Decoding chunk: ${ab.byteLength} bytes`);

        // Use Promise.race to ensure decodeAudioData NEVER hangs indefinitely
        let decoded;
        try {
          decoded = await Promise.race([
            playbackCtxRef.current.decodeAudioData(ab),
            new Promise((_, reject) => setTimeout(() => reject(new Error('decodeAudioData timeout')), 4000))
          ]);
        } catch (decodeErr) {
          console.error('Audio decode failed or timed out:', decodeErr?.message || decodeErr);
          continue;
        }

        if (closedRef.current) break;

        const src = playbackCtxRef.current.createBufferSource();
        currentSourceRef.current = src;
        src.buffer = decoded;
        src.connect(playbackCtxRef.current.destination);
        
        console.log(`▶️ Playing ${decoded.duration.toFixed(2)}s`);
        
        // Ensure playback Promise resolves via onended OR a duration-based fallback
        await new Promise(resolve => {
          let hasFinished = false;
          const finish = () => {
            if (hasFinished) return;
            hasFinished = true;
            resolve();
          };
          src.onended = finish;
          src.start(0);
          setTimeout(finish, decoded.duration * 1000 + 500);
        });

        currentSourceRef.current = null;
        console.log(`⏹️ Chunk done`);
      } catch (e) {
        console.error('Playback loop error:', e?.message || e);
      }
    }

    isPlayingRef.current = false;
    if (closedRef.current) return;

    if (doneRef.current) {
      setTimeout(() => { if (startListeningRef.current && !closedRef.current) startListeningRef.current(); }, 600);
    } else {
      updateStatusRef.current('thinking');
    }
  }, []); // no deps — uses refs only


  useEffect(() => { playQueueRef.current = playQueue; }, [playQueue]);

  // ── Start Listening ──────────────────────────────────────
  const startListening = useCallback(async () => {
    if (closedRef.current) return;
    try {
      setError('');
      setLiveCaption('');
      setThinkingMsg('');
      audioQueueRef.current = [];
      doneRef.current = false;
      isPlayingRef.current = false;
      silenceStartRef.current = null;

      if (micCtxRef.current) { try { micCtxRef.current.close(); } catch (_) {} micCtxRef.current = null; }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true }
      });
      streamRef.current = stream;

      const actx = new (window.AudioContext || window.webkitAudioContext)();
      micCtxRef.current = actx;
      const mediaSrc = actx.createMediaStreamSource(stream);
      const analyser = actx.createAnalyser();
      analyser.fftSize = 256;
      mediaSrc.connect(analyser);
      micAnalyserRef.current = analyser;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const mr = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mr;

      mr.ondataavailable = (e) => {
        if (e.data.size > 0 && !closedRef.current) {
          console.log(`🎤 Sending audio blob: ${e.data.size} bytes`);
          e.data.arrayBuffer().then(buf => {
            if (socketRef.current?.connected) socketRef.current.emit('voice:complete_audio', buf);
          });
        }
      };
      mr.onstop = () => {
        if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      };

      mr.start();
      recordStartRef.current = Date.now();
      updateStatusRef.current('listening');
    } catch (e) {
      console.error('Mic error:', e);
      setError('Microphone access denied.');
      updateStatusRef.current('idle');
    }
  }, []); // no deps — uses refs only

  useEffect(() => { startListeningRef.current = startListening; }, [startListening]);

  // ── Socket (runs once, everything via refs) ──────────────
  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket'], reconnection: true });
    socketRef.current = socket;

    socket.on('connect', () => console.log('🎙️ Socket connected:', socket.id));
    socket.on('disconnect', () => console.log('🎙️ Socket disconnected'));

    socket.on('voice:transcription', (d) => {
      setLiveCaption(d.text);
      updateStatusRef.current('thinking');
    });

    socket.on('voice:thinking', (d) => {
      setThinkingMsg(d.message);
      updateStatusRef.current('thinking');
    });

    socket.on('voice:text_chunk', (d) => {
      setLiveCaption(d.text);
    });

    socket.on('voice:audio_chunk', async (audioData) => {
      // Normalise to ArrayBuffer — socket.io may deliver as Blob, ArrayBuffer, or TypedArray
      let buf;
      try {
        if (audioData instanceof Blob) {
          buf = await audioData.arrayBuffer();
        } else if (audioData instanceof ArrayBuffer) {
          buf = audioData;
        } else if (ArrayBuffer.isView(audioData)) {
          buf = audioData.buffer.slice(audioData.byteOffset, audioData.byteOffset + audioData.byteLength);
        } else {
          buf = audioData; // try whatever it is
        }
        console.log(`🔊 Audio chunk queued: ${buf.byteLength || buf.length} bytes`);
        audioQueueRef.current.push(buf);
        updateStatusRef.current('speaking');
        if (playQueueRef.current) playQueueRef.current();
      } catch (e) {
        console.error('Failed to process audio chunk:', e.message);
      }
    });


    socket.on('voice:research_data', (d) => { if (onResearchData) onResearchData(d); });

    socket.on('voice:done', () => {
      console.log(`✅ voice:done | isPlaying: ${isPlayingRef.current} | queueLen: ${audioQueueRef.current.length}`);
      doneRef.current = true;
      // If nothing is in the queue and not playing → start listening now.
      // If audio IS still playing, playQueue's loop will call startListening when done.
      // Safety fallback: poll every 500ms until we're sure it's done.
      const tryStartListening = () => {
        if (closedRef.current) return;
        if (!isPlayingRef.current && audioQueueRef.current.length === 0) {
          setTimeout(() => { if (startListeningRef.current && !closedRef.current) startListeningRef.current(); }, 600);
        } else {
          // Still playing — check again soon
          setTimeout(tryStartListening, 500);
        }
      };
      tryStartListening();
    });

    socket.on('voice:error', (d) => {
      console.error('🔴 voice:error:', d.message);
      setError(d.message);
      updateStatusRef.current('idle');
      setTimeout(() => setError(''), 4000);
      // Don't auto-restart — let user tap the sphere to try again
    });

    return () => { hardStop(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Animation + VAD ──────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
      ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener('resize', resize);

    const SILENCE_THRESHOLD = 18;
    const SILENCE_MS = 1800;
    const MIN_RECORD_MS = 2500;

    const loop = () => {
      animRef.current = requestAnimationFrame(loop);
      const W = canvas.offsetWidth, H = canvas.offsetHeight;
      ctx.clearRect(0, 0, W, H);
      timeRef.current += 0.008;
      const t = timeRef.current;

      let vol = 0;
      if (micAnalyserRef.current && statusRef.current === 'listening') {
        const data = new Uint8Array(micAnalyserRef.current.frequencyBinCount);
        micAnalyserRef.current.getByteFrequencyData(data);
        vol = data.reduce((a, v) => a + v, 0) / data.length;

        const elapsed = Date.now() - (recordStartRef.current || Date.now());
        if (elapsed > MIN_RECORD_MS && vol < SILENCE_THRESHOLD) {
          if (!silenceStartRef.current) silenceStartRef.current = Date.now();
          else if (Date.now() - silenceStartRef.current > SILENCE_MS) {
            silenceStartRef.current = null;
            stopMic();
            return;
          }
        } else {
          silenceStartRef.current = null;
        }
      }
      volumeRef.current += (vol - volumeRef.current) * 0.15;
      const sv = volumeRef.current;

      let hue1 = 16, hue2 = 30, pulseAmp = 0;
      if (statusRef.current === 'listening') { hue1 = 16; hue2 = 36; pulseAmp = sv / 255 * 40; }
      else if (statusRef.current === 'thinking') { hue1 = 210; hue2 = 240; pulseAmp = 6 + Math.sin(t * 4) * 4; }
      else if (statusRef.current === 'speaking') { hue1 = 150; hue2 = 170; pulseAmp = 10 + Math.sin(t * 3) * 8; }
      else { hue1 = 16; hue2 = 30; pulseAmp = 2 + Math.sin(t * 2) * 2; }

      const cx = W / 2, cy = H / 2;

      if (particlesRef.current) {
        const projected = particlesRef.current.map(p => {
          const wobble = Math.sin(t * p.speed + p.offset) * (5 + pulseAmp * 0.4);
          const r = p.baseR + wobble + pulseAmp * 0.3;
          const phi = p.phi + Math.sin(t * 0.3 + p.offset) * 0.05;
          const theta = p.theta + t * 0.15;
          const x3d = r * Math.sin(phi) * Math.cos(theta);
          const y3d = r * Math.cos(phi);
          const z3d = r * Math.sin(phi) * Math.sin(theta);
          const scale = 300 / (300 + z3d);
          return { x: cx + x3d * scale, y: cy + y3d * scale, z: z3d, size: p.size * scale };
        });
        projected.sort((a, b) => a.z - b.z);
        for (const pt of projected) {
          const depthNorm = (pt.z + 150) / 300;
          const hue = hue1 + (hue2 - hue1) * depthNorm;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
          ctx.fillStyle = `hsla(${hue}, 75%, ${55 + depthNorm * 25}%, ${0.15 + depthNorm * 0.7})`;
          ctx.fill();
        }
      }

      const grd = ctx.createRadialGradient(cx, cy, 30, cx, cy, BASE_RADIUS + 60);
      grd.addColorStop(0, `hsla(${hue1}, 60%, 50%, ${0.06 + pulseAmp * 0.002})`);
      grd.addColorStop(1, 'transparent');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, W, H);
    };
    loop();
    return () => { cancelAnimationFrame(animRef.current); window.removeEventListener('resize', resize); };
  }, [stopMic]);

  // ── Label ────────────────────────────────────────────────
  const label = (() => {
    if (error) return error;
    if (status === 'listening') return liveCaption || 'Listening... speak now';
    if (status === 'thinking') return thinkingMsg || liveCaption || 'Processing...';
    if (status === 'speaking') return liveCaption || 'Speaking...';
    return 'Tap the sphere to begin';
  })();

  // ── Tap sphere ───────────────────────────────────────────
  const handleSphereClick = () => {
    if (status === 'idle') {
      if (!socketRef.current?.greeted) {
        socketRef.current.greeted = true;
        // MUST resume/create AudioContext inside a user gesture
        if (!playbackCtxRef.current || playbackCtxRef.current.state === 'closed') {
          playbackCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
        } else if (playbackCtxRef.current.state === 'suspended') {
          playbackCtxRef.current.resume();
        }
        socketRef.current?.emit('voice:greet');
        updateStatusRef.current('thinking');
      } else {
        if (startListeningRef.current) startListeningRef.current();
      }
    } else if (status === 'listening') {
      stopMic(); // Manual early stop
    }
  };

  return (
    <div className="va-overlay" onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
      <button className="va-close" onClick={handleClose} aria-label="Close voice mode">
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <path d="M6 6L16 16M16 6L6 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      </button>

      <canvas ref={canvasRef} className="va-canvas" onClick={handleSphereClick} />

      <div className="va-bottom">
        <div className={`va-status-pill ${status}`}>
          <span className="va-status-dot" />
          <span>
            {status === 'listening' ? 'Listening'
              : status === 'thinking' ? 'Thinking'
              : status === 'speaking' ? 'Speaking'
              : 'Ready'}
          </span>
        </div>
        <p className="va-caption">{label}</p>
        {status === 'listening' && (
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '12px', marginTop: '4px' }}>
            Tap sphere to stop early
          </p>
        )}
      </div>
    </div>
  );
}
