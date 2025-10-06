# Unreal WebSocket — Browser Client

A lightweight, dependency‑free WebSocket client you can open in a browser to connect to any WebSocket server, send text or binary messages, and inspect responses. No build step or package manager required.

## Features
- Connect to any WebSocket URI (default: `ws://127.0.0.1:8080/`).
- Send text or binary (Blob) messages.
- Copyable sample messages for quick testing.
- Scrollback output with simple status and error reporting.

## Quick Start
1. Serve the static files (avoid `file://` so Clipboard APIs work):
   - Python: `python3 -m http.server 8000`
   - Then open `http://localhost:8000/websocket.html`
2. Enter your WebSocket URI and click `Connect`.
3. Type a message and click `Send` (or press Enter) — or use `Send as Binary` for Blob payloads.

## Example Echo Server (Node.js)
If you need something to talk to while testing, this minimal echo server using `ws` will do:

```js
// save as server.js
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', (ws) => {
  ws.send('Connected to echo server');
  ws.on('message', (data) => {
    // Echo back what we received
    ws.send(data);
  });
});

console.log('ws echo server listening on ws://127.0.0.1:8080/');
```

Run with:

```bash
npm init -y && npm i ws
node server.js
```

Then connect from the client using `ws://127.0.0.1:8080/`.

## Usage Tips
- Use the `Copy` buttons under Sample Queries to quickly try messages.
- The output panel auto‑scrolls as new messages arrive.
- Binary messages are displayed by converting Blob to text.

## Project Structure
- `websocket.html` — UI and layout; loads the script and stylesheet.
- `app.js` — WebSocket connection and UI logic.
- `styles.css` — Styling; dark, minimal theme.

## Development Notes
- This is a static project; please don’t introduce build tools or frameworks.
- Keep changes small and consistent with the existing style.
- See `AGENTS.md` for conventions and guidance for contributors and coding agents.

## Troubleshooting
- Mixed content: Browsers block `ws://` from `https://` origins. Use `http://` for local dev, or use `wss://` with HTTPS.
- Connection fails immediately: Check that your server is running and reachable from the browser (CORS is not applicable to WebSockets, but networks/firewalls can still block ports).
- Clipboard copy doesn’t work: Serve over `http://localhost` rather than opening via `file://`.

