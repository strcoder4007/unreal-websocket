# unreal-websocket - Project Handoff

## 1. Project Overview

**unreal-websocket** enables voice conversations with ElevenLabs AI agents, forwarding audio to a local WebSocket for Unreal Engine avatar lip-sync/animation.

### Key Features
- ElevenLabs Agent integration via @elevenlabs/client SDK
- Real-time audio chunk forwarding to local WebSocket
- PCM/µ-law to WAV conversion
- Ordered audio queue with replay on reconnect
- Interrupt handling (mute on pause)

---

## 2. Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Vite, React |
| **Voice AI** | ElevenLabs Agents SDK |
| **Audio** | WebSocket (local) |
| **Avatar** | Unreal Engine |
| **Backend** | Node.js/Express |

---

## 3. File Structure

```
unreal-websocket/
├── client/               # Vite frontend (index.html, script.js)
├── server/                # Express backend
├── backend/              # Additional backend
├── audios/               # Audio files (gitignored)
├── docs/                 # Documentation
├── Web_updated.html      # Web interface
├── websocket.html        # WebSocket test page
├── package.json
├── run-dev.bat          # Windows dev launcher
└── README.md
```

---

## 4. Setup & Running

### Prerequisites
- Node.js + npm
- ElevenLabs Agent ID (public or private)

### Install
```bash
npm install
```

### Configure
Edit `client/script.js`:
- `AGENT_ID` - Your ElevenLabs agent ID
- `LOCAL_WS_URL` - Local WebSocket target for Unreal
- `AUDIO_SAVE_ENDPOINT` - Backend endpoint (default: http://localhost:3001/api/save-agent-audio)

### Run
```bash
npm run dev              # Full stack
npm run dev:frontend     # Frontend only
```

Or use `run-dev.bat` on Windows (auto-launches Unreal Engine).

Access: http://localhost:5173

---

## 5. Audio Forwarding Flow

1. ElevenLabs SDK emits audio chunks via `onAudio` callback
2. Frontend converts PCM/µ-law to WAV blobs
3. POSTs to `/api/save-agent-audio`
4. Backend writes to `audios/` directory
5. Filepath sent via WebSocket as `lstext^<path>`
6. Unreal Engine consumes for lip-sync

### Message Types
- `lstext^<path>` - Audio file path
- `action^pause` - Interrupt/stop signal

---

## 6. Environment Variables

Create `.env`:
```
# (Check actual required vars in code)
```

---

## 7. What a New Agent Needs to Know

- **Frontend logic**: `client/script.js` - ElevenLabs SDK integration, audio handling
- **Backend**: `server/` or `backend/` - Express API for audio saving
- **WebSocket**: `LOCAL_WS_URL` config must match Unreal server
- **Audio queue**: Prevents overlapping sends, replays on reconnect

---

*Generated: February 21, 2026*
