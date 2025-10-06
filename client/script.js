// Frontend conversation logic using @elevenlabs/client
// Follow the docs: start a session with either an agentId (for public agents)
// or with a signedUrl retrieved from a backend (for private agents).

import { Conversation } from '@elevenlabs/client';

const connectionStatus = document.getElementById('connectionStatus');
const agentStatus = document.getElementById('agentStatus');
const agentAudioEl = document.getElementById('agentAudio');
const localWsStatusEl = document.getElementById('localWsStatus');
const messagesEl = document.getElementById('messages');
const micButton = document.getElementById('micButton');
const sendButton = document.getElementById('sendButton');
const chatInput = document.getElementById('chatInput');
const connBadge = document.getElementById('connBadge');
const modeBadge = document.getElementById('modeBadge');
const wsBadge = document.getElementById('wsBadge');

// Configuration: set your Agent ID here for public agents
// For private agents, leave this as null and enable SIGNED_URL_FLOW below.
const AGENT_ID = 'agent_0101k6w6hvhjfyb8h0ph5q0ebwn8'; // TODO: replace with your actual agent ID

// If using a private agent, set this to true and ensure the backend is running
// on http://localhost:3001 as implemented in backend/server.js.
const SIGNED_URL_FLOW = false;

// Local WebSocket forwarder (sends lstext^<text> to ws://127.0.0.1:8080)
const LOCAL_WS_URL = 'ws://127.0.0.1:8080';
let localWS = null;
let localWSConnected = false;
let localWSQueue = [];
let localWSBackoff = 500; // ms
let localWSConnecting = false;
let lastForwardedText = '';
let lastForwardedAt = 0;

// Messages state
let messages = [];
let msgSeq = 0;
let lastAppendedText = '';
let lastAppendedAt = 0;
let currentMode = 'idle';
let userWindowUntil = 0;

function tsShort(d = new Date()) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function appendMessage(role, text, source = 'onMessage') {
  if (!text) return;
  const now = Date.now();
  if (text === lastAppendedText && now - lastAppendedAt < 1500) {
    // avoid spammy duplicates across onMessage/STT
  } else {
    messages.push({ id: ++msgSeq, role, text, source, ts: new Date() });
    lastAppendedText = text;
    lastAppendedAt = now;
  }
  renderMessages();
}

function renderMessages() {
  if (!messagesEl) return;
  let html = '';
  for (const m of messages.slice(-400)) {
    const roleClass = m.role === 'user' ? 'user' : (m.role === 'stt' ? 'stt' : 'agent');
    const tag = m.role === 'user' ? 'Me' : (m.role === 'stt' ? 'Agent' : 'Agent');
    html += `
      <div class="msg-row ${roleClass}">
        <div class="bubble ${roleClass}">
          <div class="meta"><span class="tag ${roleClass}">${tag}</span><span>${tsShort(m.ts)}</span></div>
          <div class="content">${escapeHtml(m.text)}</div>
        </div>
      </div>`;
  }
  messagesEl.innerHTML = html;
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

function setLocalWsStatus(text) {
  if (localWsStatusEl) localWsStatusEl.textContent = text;
  if (!wsBadge) return;
  wsBadge.classList.remove('ok','warn','err');
  if (text === 'connected') wsBadge.classList.add('ok');
  else if (text === 'error') wsBadge.classList.add('err');
  else wsBadge.classList.add('warn');
}

function connectLocalWS() {
  if (localWSConnected || localWSConnecting) return;
  localWSConnecting = true;
  try {
    localWS = new WebSocket(LOCAL_WS_URL);
    localWS.onopen = () => {
      localWSConnected = true;
      localWSConnecting = false;
      setLocalWsStatus('connected');
      while (localWSQueue.length) {
        try { localWS.send(localWSQueue.shift()); } catch (_) { break; }
      }
      localWSBackoff = 500;
    };
    localWS.onclose = () => {
      localWSConnected = false;
      localWSConnecting = false;
      setLocalWsStatus('disconnected');
      setTimeout(connectLocalWS, localWSBackoff);
      localWSBackoff = Math.min(localWSBackoff * 2, 10000);
    };
    localWS.onerror = () => {
      // handled by onclose
    };
  } catch (e) {
    localWSConnected = false;
    localWSConnecting = false;
    setLocalWsStatus('error');
    setTimeout(connectLocalWS, localWSBackoff);
    localWSBackoff = Math.min(localWSBackoff * 2, 10000);
  }
}

function forwardTextToLocalWS(text) {
  if (!text) return;
  const now = Date.now();
  if (text === lastForwardedText && now - lastForwardedAt < 2000) {
    return; // dedupe burst duplicates
  }
  lastForwardedText = text;
  lastForwardedAt = now;
  const payload = `lstext^${text}`;
  if (localWSConnected && localWS && localWS.readyState === WebSocket.OPEN) {
    try { localWS.send(payload); } catch (_) {}
  } else {
    localWSQueue.push(payload);
    if (localWSQueue.length > 50) localWSQueue.shift();
    connectLocalWS();
  }
}

let conversation;
let mediaRecorder;
let recordingActive = false;
let sttInFlight = 0;
const MAX_IN_FLIGHT = 2;
const CHUNK_MS = 4000; // tune latency vs accuracy
let convActive = false;

function setConnectedUI(connected) {
  convActive = connected;
  if (micButton) {
    micButton.classList.toggle('active', connected);
    micButton.setAttribute('aria-pressed', String(connected));
  }
  if (connBadge) {
    connBadge.classList.remove('ok','warn','err');
    connBadge.classList.add(connected ? 'ok' : 'err');
  }
}

async function getSignedUrl() {
  const response = await fetch('http://localhost:3001/api/get-signed-url');
  if (!response.ok) {
    throw new Error(`Failed to get signed url: ${response.statusText}`);
  }
  const { signedUrl } = await response.json();
  return signedUrl;
}

async function startConversation() {
  try {
    // Request microphone permission before starting
    await navigator.mediaDevices.getUserMedia({ audio: true });

    const options = {};
    if (SIGNED_URL_FLOW) {
      const signedUrl = await getSignedUrl();
      options.signedUrl = signedUrl;
    } else {
      if (!AGENT_ID || AGENT_ID === 'YOUR_AGENT_ID') {
        throw new Error('Please set AGENT_ID in client/script.js');
      }
      options.agentId = AGENT_ID;
    }

    conversation = await Conversation.startSession({
      ...options,
      onConnect: () => {
        connectionStatus.textContent = 'Connected';
        setConnectedUI(true);
      },
      onDisconnect: () => {
        connectionStatus.textContent = 'Disconnected';
        setConnectedUI(false);
      },
      onError: (error) => {
        console.error('Error:', error);
      },
      onModeChange: (mode) => {
        currentMode = mode.mode || 'idle';
        agentStatus.textContent = currentMode;
        if (modeBadge) {
          modeBadge.classList.remove('ok','warn','err');
          if (currentMode === 'speaking') modeBadge.classList.add('warn');
          else if (currentMode === 'listening') modeBadge.classList.add('ok');
          else modeBadge.classList.add('warn');
        }
        // Short window where incoming onMessage is treated as user transcripts
        if (currentMode === 'listening') userWindowUntil = Date.now() + 6000; else userWindowUntil = 0;
      },
      onMessage: (msg) => {
        const text = typeof msg === 'string' ? msg : (msg && (msg.text || msg.message || msg.content));
        if (text) {
          forwardTextToLocalWS(text);
          const role = classifyIncomingMessage(msg);
          appendMessage(role, text, 'onMessage');
        }
      },
    });

    // Try to capture agent audio and push to STT in chunks
    tryStartAgentAudioCapture();
    // Ensure local WS is connected
    connectLocalWS();
  } catch (error) {
    console.error('Failed to start conversation:', error);
  }
}

async function stopConversation() {
  if (conversation) {
    await conversation.endSession();
    conversation = null;
  }
  stopAgentAudioCapture();
}

// Mic toggle and mock send
if (micButton) {
  micButton.addEventListener('click', async () => {
    if (!convActive) {
      await startConversation();
    } else {
      await stopConversation();
      setConnectedUI(false);
    }
  });
}
if (sendButton && chatInput) {
  sendButton.addEventListener('click', () => {
    const val = chatInput.value.trim();
    if (!val) return;
    appendMessage('user', val, 'mock');
    chatInput.value = '';
  });
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendButton.click();
    }
  });
}

// Attempt to resolve agent output audio stream for recording
function resolveAgentOutputStream() {
  try {
    if (conversation) {
      if (typeof conversation.getOutputMediaStream === 'function') {
        const s = conversation.getOutputMediaStream();
        if (s) return s;
      }
      if (conversation.outputStream instanceof MediaStream) {
        return conversation.outputStream;
      }
      if (conversation.audioElement instanceof HTMLAudioElement && typeof conversation.audioElement.captureStream === 'function') {
        return conversation.audioElement.captureStream();
      }
    }
  } catch (_) {}
  if (agentAudioEl && typeof agentAudioEl.captureStream === 'function') {
    try { return agentAudioEl.captureStream(); } catch (_) {}
  }
  return null;
}

function tryStartAgentAudioCapture() {
  if (recordingActive) return;
  const stream = resolveAgentOutputStream();
  if (!stream) {
    console.warn('Agent audio capture unavailable; relying on onMessage text');
    return;
  }
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/webm');
  try {
    mediaRecorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 128000 });
  } catch (e) {
    console.warn('Failed to init MediaRecorder:', e);
    return;
  }
  mediaRecorder.ondataavailable = async (ev) => {
    if (!ev.data || ev.data.size === 0) return;
    if (sttInFlight >= MAX_IN_FLIGHT) return;
    sttInFlight++;
    try {
      const text = await sttChunk(ev.data);
      if (text) {
        forwardTextToLocalWS(text);
        appendMessage('agent', text, 'stt');
      }
    } catch (err) {
      console.error('STT chunk failed:', err);
    } finally {
      sttInFlight--;
    }
  };
  mediaRecorder.onerror = (e) => console.error('MediaRecorder error', e);
  mediaRecorder.start(CHUNK_MS);
  recordingActive = true;
}

function stopAgentAudioCapture() {
  try { if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop(); } catch (_) {}
  mediaRecorder = null;
  recordingActive = false;
}

async function sttChunk(blob) {
  const contentType = blob.type || 'audio/webm';
  const res = await fetch('http://localhost:3001/api/stt-chunk', {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: blob,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`STT HTTP ${res.status}: ${t}`);
  }
  const data = await res.json();
  return data && (data.text || data.transcript || data.transcription || data.result);
}

// Initialize status and local WS
setConnectedUI(false);
if (modeBadge && agentStatus) {
  modeBadge.classList.remove('ok','warn','err');
  modeBadge.classList.add('warn');
  agentStatus.textContent = 'idle';
}
connectLocalWS();
function classifyIncomingMessage(msg) {
  // Try to infer whether this message comes from the user (mic) or agent
  if (msg && typeof msg === 'object') {
    const lower = (v) => (typeof v === 'string' ? v.toLowerCase() : v);
    const role = lower(msg.role || msg.author || msg.sender || msg.from || msg.source || msg.origin);
    const type = lower(msg.type || msg.messageType);
    if (role === 'user' || role === 'me' || role === 'client' || role === 'speaker' || role === 'microphone') return 'user';
    if (role === 'agent' || role === 'assistant' || role === 'system' || role === 'llm') return 'agent';
    if (type && (String(type).includes('user') || String(type).includes('transcript'))) return 'user';
  }
  // Fallback to time-window + mode heuristic
  const now = Date.now();
  if (now < userWindowUntil) return 'user';
  return currentMode === 'listening' ? 'user' : 'agent';
}
