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

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

