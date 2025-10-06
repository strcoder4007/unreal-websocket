# AGENTS Guidelines

Scope: This file applies to the entire repository.

Coding style and structure
- Keep changes minimal and focused on the task.
- Prefer clear, descriptive names (no single-letter vars).
- Avoid adding unrelated dependencies or frameworks unless requested.

Project layout
- `client/` — Vite frontend. Entry: `client/index.html`.
- `backend/` — optional Express server for signed URLs.
- `README.md` — quickstart instructions for running and developing.

Contributing in this workspace
- Update `README.md` when adding new commands or steps.
- If adding runtime code, include a short usage note near the change.
- Avoid license headers unless explicitly requested.

Testing and validation
- Keep frontend self-contained and easy to open locally.
- If a backend is added, document env vars in `.env.example`.

Notes
- This repo mirrors the ElevenLabs Vite quickstart structure with a `client/` root for Vite and optional `backend/` for private-agent auth.
