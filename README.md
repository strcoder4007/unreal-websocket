# ElevenLabs Agents – Voice Conversation (Vite)

This repo contains a Vite-based frontend that enables voice conversations with ElevenLabs AI agents.

Structure
- `client/` — Vite root with `index.html` and `script.js`.
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

Run
- Frontend only (public agent):
  ```bash
  npm run dev:frontend
  ```
  Visit the URL Vite prints (default http://localhost:5173) and click “Start Conversation”.

- Frontend:
  ```bash
  npm run dev
  ```
  Frontend runs via Vite.
- Windows helper:
  ```bash
  run-dev
  ```
  Double-click `run-dev.bat` or run it from a terminal—its absolute paths mean you can run it from anywhere, it opens `http://localhost:5173` automatically, and it triggers `npm run dev` plus auto-launches `MyProject6.exe` (edit the paths/URL at the top of the script if your locations differ).

Notes
- The frontend imports `@elevenlabs/client` and calls `Conversation.startSession` with either `agentId` or `signedUrl`, mirroring the ElevenLabs quickstart.
- For production, add error handling and URL refresh logic for expiring signed URLs.

Voice-to-Text streaming to local WebSocket
- Sources of text:
  - `onMessage` from the Agents SDK (used for UI display only)
- Incremental agent text forwarding:
  - Agent text from `onMessage` and optional STT partials is diffed and any new portion is streamed to `LOCAL_WS_URL` as `lstext^<chunk>`.
  - Interruptions emit `action^pause`, mute audio, and clear any pending text so Unreal stops immediately.
  - New speaking turns reset the diff tracker so streaming restarts cleanly after an interruption.
- Configure in `client/script.js`:
  - `LOCAL_WS_URL` for your local WebSocket
  - `CHUNK_MS` MediaRecorder pacing; lower is lower latency
  - `MAX_IN_FLIGHT` caps concurrent STT requests
  - `SEND_STOP_ON_INTERRUPT` and `STOP_CONTROL_MESSAGE` if your Unreal server supports an explicit stop control signal
