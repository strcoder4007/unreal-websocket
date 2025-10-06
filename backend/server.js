require('dotenv').config();

const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

app.get('/api/get-signed-url', async (_req, res) => {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const agentId = process.env.AGENT_ID;
    if (!apiKey || !agentId) {
      return res.status(500).json({ error: 'Missing ELEVENLABS_API_KEY or AGENT_ID in environment' });
    }

    const url = `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`;
    const response = await fetch(url, {
      headers: {
        'xi-api-key': apiKey,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to get signed URL: ${response.status} ${text}`);
    }

    const data = await response.json();
    res.json({ signedUrl: data.signed_url });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to generate signed URL' });
  }
});

// Accepts audio chunks (e.g., audio/webm) and forwards to ElevenLabs STT
app.post(
  '/api/stt-chunk',
  express.raw({
    type: [
      'audio/webm',
      'audio/ogg',
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/x-wav',
      'audio/mp4',
      'application/octet-stream',
    ],
    limit: '25mb',
  }),
  async (req, res) => {
    try {
      const apiKey = process.env.ELEVENLABS_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'Missing ELEVENLABS_API_KEY in environment' });
      }
      if (!req.body || !Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: 'No audio body received' });
      }

      const contentType = req.headers['content-type'] || 'audio/webm';

      // Build multipart form-data
      const fd = new FormData();
      const blob = new Blob([req.body], { type: contentType });
      fd.append('file', blob, 'chunk.webm');
      // Model hint; adjust to match current API if needed
      fd.append('model', 'scribe_v1');
      // Optional language hint via query param (e.g., ?lang=en)
      if (req.query && req.query.lang) {
        fd.append('language_code', String(req.query.lang));
      }

      const sttUrl = 'https://api.elevenlabs.io/v1/speech-to-text';
      const response = await fetch(sttUrl, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'accept': 'application/json',
        },
        body: fd,
      });

      if (!response.ok) {
        const t = await response.text();
        return res.status(response.status).json({ error: `STT error: ${t}` });
      }

      const data = await response.json();
      // Normalize text field name
      const text = data.text || data.transcription || data.transcript || data.result || '';
      res.json({ text, raw: data });
    } catch (err) {
      console.error('STT error:', err);
      res.status(500).json({ error: 'Failed to transcribe audio' });
    }
  }
);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
