# AGENTS.md

Scope: entire repository (`/`). This file guides coding agents working on this project.

## Project Overview
- Static, dependency-free WebSocket client built with plain HTML/CSS/JS.
- Files:
  - `websocket.html` — UI markup, loads the script and styles.
  - `app.js` — all WebSocket and UI logic (no bundlers, no frameworks).
  - `styles.css` — styling; keep it lightweight and framework-free.

## Principles
- Keep the project static (no build step, no runtime deps).
- Don’t introduce frameworks, bundlers, or package managers.
- Prefer small, focused changes; avoid refactors that span files unnecessarily.
- Maintain accessibility and keyboard usability.

## Code Style
- JavaScript:
  - Use function declarations and `var` where consistent with existing code.
  - Two-space indentation; end statements with semicolons.
  - Double quotes for strings.
  - Escape any user-controlled content before inserting into the DOM. Use `escapeHtml()`.
  - Keep logic in `app.js`; do not inline scripts into HTML.
- CSS:
  - Two-space indentation, CSS variables at `:root` where appropriate.
  - Keep selectors and rules minimal; avoid adding utility frameworks.
- HTML:
  - Keep structure in `websocket.html`; do not add inline styles or scripts.

## Running Locally
- Serve the static files; avoid `file://` to ensure Clipboard APIs work:
  - Python: `python3 -m http.server 8000` then open `http://localhost:8000/websocket.html`.
- The client defaults to `ws://127.0.0.1:8080/`; you can change the URI in the UI.

## Testing Changes (Manual)
- Connect to a local WebSocket server (echo behavior is sufficient).
- Verify:
  - Connect/Disconnect messages render in the Output panel.
  - Sending text and binary (Blob) works; responses render and auto-scroll.
  - Sample copy buttons copy content and provide feedback.
  - Keyboard Enter sends a text message from the input.

## Security & Robustness
- Never inject unescaped content into the DOM. Keep using `escapeHtml()` for display.
- Handle binary messages by converting Blob to text for display (as implemented).
- Avoid adding credentials/secrets or hard-coding production endpoints.

## Feature Work Guidance
- Keep features optional and progressive; don’t break current flows.
- If adding settings or UI, keep them in the existing visual style.
- Update `README.md` if behavior, usage, or defaults change.

## What Not To Do
- Don’t add NPM/yarn/pnpm, bundlers, transpilers, or third-party UI libs.
- Don’t split the single-page client into multiple pages or frameworks.
- Don’t add server code to this repo; examples belong in `README.md` only.

