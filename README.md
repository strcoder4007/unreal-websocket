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

Audio chunk forwarding to local WebSocket
- ElevenLabs emits agent audio chunks via the SDK `onAudio` callback. The frontend converts those PCM/µ-law buffers into small `.wav` blobs (preserving the SDK-provided sample rate) before enqueueing them.
- Each blob is POSTed to `/api/save-agent-audio`, which writes it into the git-ignored `audios/` directory and responds with the absolute filesystem path.
- Filepaths stream to `LOCAL_WS_URL` as `filepath^<absolute_path>` in the exact order the SDK delivered the audio; the queue prevents overlapping sends and automatically replays any pending paths once the Unreal bridge reconnects.
- Interruptions (`action^pause`) still mute the agent, clear queued payloads, and block new filepaths until the next speaking turn resumes so Unreal stops immediately.
- Configure in `client/script.js`:
  - `LOCAL_WS_URL` for your local WebSocket target
  - `AUDIO_SAVE_ENDPOINT` if your backend runs somewhere other than `http://localhost:3001/api/save-agent-audio`
  - `SEND_STOP_ON_INTERRUPT` and `STOP_CONTROL_MESSAGE` if your Unreal server supports an explicit stop control signal
