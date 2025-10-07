# ElevenLabs Agents – Voice Conversation (Vite)

This repo contains a Vite-based frontend that enables voice conversations with ElevenLabs AI agents, plus an optional backend for generating signed URLs when working with private agents.

Structure
- `client/` — Vite root with `index.html` and `script.js`.
- `backend/` — optional Express server exposing `/api/get-signed-url`.
- `AGENTS.md` — guidance for working in this repo.

Prerequisites
- Node.js and npm installed
- An ElevenLabs Agent ID (public or private)

Install dependencies
```bash
npm install
```

Configure agent
- Public agent: set your Agent ID in `client/script.js` (`AGENT_ID`).
- Private agent (optional): copy `backend/.env.example` to `.env` at repo root or inside `backend/`, and set:
  - `ELEVENLABS_API_KEY=...`
  - `AGENT_ID=...`

Run
- Frontend only (public agent):
  ```bash
  npm run dev:frontend
  ```
  Visit the URL Vite prints (default http://localhost:5173) and click “Start Conversation”.

- Frontend + backend (private agent):
  ```bash
  npm run dev
  ```
  Frontend runs via Vite and backend runs on http://localhost:3001.
  In `client/script.js`, set `SIGNED_URL_FLOW = true`.

Notes
- The frontend imports `@elevenlabs/client` and calls `Conversation.startSession` with either `agentId` or `signedUrl`, mirroring the ElevenLabs quickstart.
- For production, add error handling and URL refresh logic for expiring signed URLs.

Voice-to-Text forwarding to local WebSocket
- The frontend attempts two paths to obtain text:
  - onMessage callback from the Agents SDK (low latency, robust)
  - Optional audio capture of agent output with MediaRecorder -> POST chunks to `backend` STT -> map to text
- Complete agent responses (no sentence chunking) are forwarded once per speaking turn to `ws://127.0.0.1:8080` with `lstext^` prefix via a resilient WebSocket client.
- Configure in `client/script.js`:
  - `LOCAL_WS_URL` if your local server is different
  - `CHUNK_MS` controls MediaRecorder chunking; STT chunks are internally accumulated and only the final combined transcript is sent
  - `MAX_IN_FLIGHT` to cap concurrent STT requests
- Backend STT route: `POST http://localhost:3001/api/stt-chunk` accepts `audio/webm` (and some other audio mime types) and calls ElevenLabs STT. Requires `ELEVENLABS_API_KEY`.
