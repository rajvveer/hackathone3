const axios = require('axios');

const SARVAM_API_URL = 'https://api.sarvam.ai/text-to-speech';
const SARVAM_API_KEY = process.env.SARVAM_API_KEY;

/**
 * Synthesize speech from text using Sarvam AI Bulbul v3.
 * Returns a base64-encoded WAV audio buffer.
 *
 * @param {string} text  — Text to synthesize (max 2500 chars)
 * @param {object} opts  — Optional overrides
 * @returns {Promise<Buffer>} — Raw WAV audio buffer
 */
async function synthesizeSpeech(text, opts = {}) {
  if (!SARVAM_API_KEY) {
    throw new Error('SARVAM_API_KEY is not set in environment variables');
  }

  const trimmedText = text.substring(0, 2500);

  const body = {
    inputs: [trimmedText],
    model: 'bulbul:v3',
    target_language_code: opts.language || 'en-IN',
    speaker: opts.speaker || 'priya',
    pace: opts.pace || 1.05,
    sample_rate: 24000,
  };

  let response;
  try {
    response = await axios.post(SARVAM_API_URL, body, {
      headers: {
        'Content-Type': 'application/json',
        'api-subscription-key': SARVAM_API_KEY,
      },
      timeout: 30000,
    });
  } catch (err) {
    // Log the full error so we can debug API issues
    const status = err.response?.status;
    const errData = err.response?.data ? JSON.stringify(err.response.data).substring(0, 300) : err.message;
    console.error(`❌ Sarvam TTS failed [${status || 'network'}]: ${errData}`);
    throw new Error(`Sarvam TTS error ${status || ''}: ${errData}`);
  }

  // Sarvam returns { audios: ["base64..."] }
  const base64Audio = response.data?.audios?.[0];
  if (!base64Audio) {
    console.error('❌ Sarvam returned no audio. Full response:', JSON.stringify(response.data).substring(0, 300));
    throw new Error('No audio data returned from Sarvam API');
  }

  const buf = Buffer.from(base64Audio, 'base64');
  console.log(`✅ Sarvam TTS success: ${buf.length} bytes for text: "${trimmedText.substring(0, 50)}..."`);
  return buf;
}

/**
 * Split long text into Sarvam-friendly chunks (sentence-level)
 * and synthesize each. Returns an array of Buffers.
 */
async function synthesizeLongText(text, opts = {}) {
  // Split on sentence boundaries
  const sentences = text
    .replace(/([.!?])\s+/g, '$1|SPLIT|')
    .split('|SPLIT|')
    .filter(s => s.trim().length > 0);

  // Batch sentences into chunks under 2500 chars
  const chunks = [];
  let current = '';
  for (const sentence of sentences) {
    if ((current + ' ' + sentence).length > 2400) {
      if (current) chunks.push(current.trim());
      current = sentence;
    } else {
      current += (current ? ' ' : '') + sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  // Synthesize all chunks (sequentially to avoid rate limits)
  const buffers = [];
  for (const chunk of chunks) {
    try {
      const buf = await synthesizeSpeech(chunk, opts);
      buffers.push(buf);
    } catch (e) {
      console.error('Sarvam TTS chunk error:', e.message);
    }
  }

  return buffers;
}

module.exports = { synthesizeSpeech, synthesizeLongText };
