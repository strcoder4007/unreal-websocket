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

Voice-to-Text streaming to local WebSocket
- Sources of text:
  - `onMessage` from the Agents SDK (used for UI display only)
  - Optional MediaRecorder capture of agent audio -> backend STT -> partial transcripts
- Robust sentence chunking and queue:
  - Partial transcripts are accumulated and segmented into sentences with basic abbreviation/decimal handling.
  - Sentences are queued and streamed to `LOCAL_WS_URL` as `lstext^<sentence>`.
  - On interruption (`onModeChange` transitions from `speaking` -> `listening`), the queue is canceled and pending sentences are dropped, so Unreal stops receiving new text.
  - On natural completion (leaving `speaking` to any other mode), the remaining partial is flushed as one final chunk.
- Configure in `client/script.js`:
  - `LOCAL_WS_URL` for your local WebSocket
  - `CHUNK_MS` MediaRecorder pacing; lower is lower latency
  - `MAX_IN_FLIGHT` caps concurrent STT requests
  - `SEND_STOP_ON_INTERRUPT` and `STOP_CONTROL_MESSAGE` if your Unreal server supports an explicit stop control signal
- Backend STT route: `POST http://localhost:3001/api/stt-chunk` accepts audio blobs and calls ElevenLabs STT. Requires `ELEVENLABS_API_KEY`.
