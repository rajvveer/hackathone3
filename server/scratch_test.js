const { synthesizeSpeech } = require('./services/sarvamService');
const fs = require('fs');

async function test() {
  require('dotenv').config({ path: './.env' });
  try {
    const buf = await synthesizeSpeech("Hello! I'm Dr. Curalink, your AI medical research assistant. How can I help you today?", { language: 'en-IN' });
    fs.writeFileSync('test_audio.wav', buf);
    console.log("Wrote test_audio.wav. Size:", buf.length);
    console.log("Header bytes:", buf.slice(0, 44).toString('hex'));
  } catch (e) {
    console.error("Error:", e.message);
  }
}
test();
