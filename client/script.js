// Frontend conversation logic using @elevenlabs/client
// Follow the docs: start a session with either an agentId (for public agents)
// or with a signedUrl retrieved from a backend (for private agents).

import { Conversation } from '@elevenlabs/client';

const connectionStatus = document.getElementById('connectionStatus');
const agentAudioEl = document.getElementById('agentAudio');
const localWsStatusEl = document.getElementById('localWsStatus');
const messagesEl = document.getElementById('messages');
const micButton = document.getElementById('micButton');
const connBadge = document.getElementById('connBadge');
const wsBadge = document.getElementById('wsBadge');

// Configuration: set your Agent ID here for public agents
// For private agents, leave this as null and enable SIGNED_URL_FLOW below.
const AGENT_ID = 'agent_9201k6ytycfdeyzrhkxaz5kfc6vn'; // TODO: replace with your actual agent ID

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

// Optional: if your Unreal avatar supports a stop command, set this and define the message.
const SEND_STOP_ON_INTERRUPT = false;
const STOP_CONTROL_MESSAGE = 'lsstop^';

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

// ---------------------------------------------------------------------------
// Outbound sentence queue with robust segmentation + interruption cancelation
// ---------------------------------------------------------------------------

// Basic abbreviation list to avoid splitting on common dotted words.
const ABBREV = new Set([
  'mr','mrs','ms','dr','prof','sr','jr','st','rd','ave','blvd','apt','no','fig','al',
  'etc','e.g','i.e','vs','approx','est','dept','inc','ltd','co','u.s','u.k','usa','uk',
  'jan','feb','mar','apr','jun','jul','aug','sep','sept','oct','nov','dec'
]);

function isLetter(ch){ return /[A-Za-z]/.test(ch); }
function isDigit(ch){ return /[0-9]/.test(ch); }

// Extract as many complete sentences as possible, leaving remainder for next chunk.
function extractSentences(buffer) {
  const sentences = [];
  const s = String(buffer || '');
  const n = s.length;
  let i = 0;
  let start = 0;

  const pushSentence = (endIdx) => {
    let end = endIdx;
    // include trailing quotes/parens
    while (end < n && /[)\]\"'”’»]/.test(s[end])) end++;
    // include following space
    let sentence = s.slice(start, end).trim();
    if (sentence) sentences.push(sentence);
    // advance start to next non-space
    start = end;
    while (start < n && /\s/.test(s[start])) start++;
  };

  while (i < n) {
    const ch = s[i];
    if (ch === '.' || ch === '!' || ch === '?') {
      // ellipses: treat as boundary at the last dot
      if (ch === '.' && i + 2 < n && s[i + 1] === '.' && s[i + 2] === '.') {
        i += 2; // move to the 3rd dot
        pushSentence(i + 1);
      } else if (ch === '.') {
        // decimal number: 3.14
        const prev = i > 0 ? s[i - 1] : '';
        const next = i + 1 < n ? s[i + 1] : '';
        if (isDigit(prev) && isDigit(next)) {
          // not a boundary
        } else {
          // check abbreviation just before dot
          let k = i - 1;
          while (k >= 0 && isLetter(s[k])) k--;
          const word = s.slice(k + 1, i).toLowerCase();
          if (!ABBREV.has(word)) {
            pushSentence(i + 1);
          }
        }
      } else {
        // ! or ? are boundaries
        pushSentence(i + 1);
      }
    } else if (ch === '\n') {
      // treat double newlines or line followed by uppercase start as boundary
      const prev = i > 0 ? s[i - 1] : '';
      const next = i + 1 < n ? s[i + 1] : '';
      if (prev === '\n' || /[A-Z"'“(]/.test(next)) {
        pushSentence(i);
      }
    }
    i++;
  }
  const remainder = s.slice(start);
  return { sentences, remainder };
}

class SentenceQueue {
  constructor(sendFn) {
    this.sendFn = sendFn;
    this.pending = [];
    this.buffer = '';
    this.gen = 0; // increments on abort
    this.draining = false;
    this.lastSent = '';
    this.lastSentAt = 0;
    this.SEND_DELAY_MS = 50; // throttle a touch to avoid flooding
  }

  pushPartial(text) {
    if (!text) return;
    this.buffer = this.buffer ? `${this.buffer} ${String(text)}` : String(text);
    const { sentences, remainder } = extractSentences(this.buffer);
    if (sentences.length) {
      console.log(`[Segmentation] Extracted ${sentences.length} sentence(s):`, sentences);
      this.pending.push(...sentences);
    } else {
      const len = String(remainder || '').trim().length;
      console.log(`[Segmentation] No complete sentence yet; remainder len=${len}`);
    }
    this.buffer = remainder;
    this.#drainSoon();
  }

  flushRemainder() {
    const rem = String(this.buffer || '').trim();
    if (rem) {
      console.log(`[Segmentation] Flushing remainder as final sentence: "${rem}"`);
      this.pending.push(rem);
    } else {
      console.log('[Segmentation] No remainder to flush.');
    }
    this.buffer = '';
    this.#drainSoon();
  }

  abort(reason = 'interrupted') {
    // Increment generation to cancel drainers, drop anything queued.
    const dropped = this.pending.length;
    const remLen = String(this.buffer || '').trim().length;
    this.gen++;
    this.pending.length = 0;
    this.buffer = '';
    console.log(`[Interrupt] Aborting sentence queue (${reason}). Dropped ${dropped} pending; cleared remainder len=${remLen}.`);
    // Optionally signal Unreal to stop
    if (SEND_STOP_ON_INTERRUPT) {
      try { this.sendFn(STOP_CONTROL_MESSAGE); } catch (_) {}
    }
  }

  async #drain(genAtStart) {
    const myGen = this.gen;
    if (genAtStart !== undefined && genAtStart !== myGen) return;
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.pending.length && myGen === this.gen) {
        const item = String(this.pending.shift()).trim();
        if (!item) continue;
        // lightweight dedupe
        const now = Date.now();
        if (item !== this.lastSent || now - this.lastSentAt > 2000) {
          console.log(`[Queue] Sending sentence to LOCAL_WS_URL: "${item}"`);
          this.sendFn(`lstext^${item}`);
          this.lastSent = item;
          this.lastSentAt = now;
        }
        if (this.SEND_DELAY_MS > 0) await new Promise(r => setTimeout(r, this.SEND_DELAY_MS));
      }
    } finally {
      this.draining = false;
      // If more arrived while draining, loop again
      if (this.pending.length && this.gen === myGen) {
        // Schedule microtask to avoid deep recursion
        queueMicrotask(() => this.#drain(myGen));
      }
    }
  }

  #drainSoon() {
    // Kick a drain pass in a microtask
    queueMicrotask(() => this.#drain());
  }
}

const sentenceQueue = new SentenceQueue((payload) => {
  _sendLocal(payload);
});

function _sendLocal(payload) {
  if (localWSConnected && localWS && localWS.readyState === WebSocket.OPEN) {
    try { localWS.send(payload); } catch (_) {}
  } else {
    console.log('[WS] Not connected; queueing payload for send.');
    localWSQueue.push(payload);
    if (localWSQueue.length > 50) localWSQueue.shift();
    connectLocalWS();
  }
}

function forwardTextToLocalWS(text) {
  if (!text) return;
  const s = String(text).trim();
  if (!s) return;
  const now = Date.now();
  if (s === lastForwardedText && now - lastForwardedAt < 2000) return; // basic dedupe
  lastForwardedText = s;
  lastForwardedAt = now;
  console.log(`[WS-direct] Sending full text to LOCAL_WS_URL: "${s}"`);
  _sendLocal(`lstext^${s}`);
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
    if (connected) updateMicState('waiting'); else updateMicState('idle');
  }
  if (connBadge) {
    connBadge.classList.remove('ok','warn','err');
    connBadge.classList.add(connected ? 'ok' : 'err');
  }
}

function updateMicState(state) {
  if (!micButton) return;
  const states = ['idle','waiting','listening','speaking'];
  for (const s of states) micButton.classList.remove(`state-${s}`);
  micButton.classList.add(`state-${state}`);
  const mapTitle = {
    idle: 'Tap to start conversation',
    waiting: 'Connected… waiting',
    listening: 'Listening… speak now',
    speaking: 'Agent speaking… tap to stop'
  };
  micButton.title = mapTitle[state] || 'Microphone';
  micButton.setAttribute('aria-label', micButton.title);
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
        updateMicState('waiting');
      },
      onDisconnect: () => {
        connectionStatus.textContent = 'Disconnected';
        setConnectedUI(false);
        updateMicState('idle');
      },
      onError: (error) => {
        console.error('Error:', error);
      },
      onModeChange: (mode) => {
        const prevMode = currentMode;
        currentMode = mode.mode || 'idle';
        console.log(`[Mode] ${prevMode} -> ${currentMode}`);
        if (currentMode === 'speaking') updateMicState('speaking');
        else if (currentMode === 'listening') updateMicState('listening');
        else updateMicState('waiting');
        // Short window where incoming onMessage is treated as user transcripts
        if (currentMode === 'listening') userWindowUntil = Date.now() + 6000; else userWindowUntil = 0;
        // Attempt to start agent audio capture when the agent begins speaking
        if (currentMode === 'speaking') {
          tryStartAgentAudioCapture();
        }
        // Handle interruption vs. natural completion
        if (prevMode === 'speaking' && currentMode === 'listening') {
          // Interrupted mid-utterance: cancel queued sentences and ignore remainder
          console.log('[Interrupt] Detected speaking -> listening during agent response. Canceling queued sentences.');
          sentenceQueue.abort('interrupted');
        } else if (prevMode === 'speaking' && currentMode !== 'speaking') {
          // Natural end of speaking turn: flush any remainder as final chunk
          console.log('[Turn] Agent finished speaking. Flushing remainder.');
          sentenceQueue.flushRemainder();
        }
      },
      onMessage: (msg) => {
        const text = typeof msg === 'string' ? msg : (msg && (msg.text || msg.message || msg.content));
        if (text) {
          const role = classifyIncomingMessage(msg);
          appendMessage(role, text, 'onMessage');
          // Do NOT forward full agent messages directly; we stream via STT sentenceQueue.
        }
      },
    });

    // Try to capture agent audio and push to STT in chunks (best-effort)
    try {
      tryStartAgentAudioCapture();
    } catch (e) {
      console.warn('Agent audio capture not available yet:', e);
    }
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

// Mic toggle only
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

// Attempt to resolve agent output audio stream for recording
function resolveAgentOutputStream() {
  try {
    if (conversation) {
      // Some SDKs expose direct media streams; if present, prefer them.
      if (typeof conversation.getOutputMediaStream === 'function') {
        try {
          const s = conversation.getOutputMediaStream();
          if (s) return s;
        } catch (_) {}
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
  // Ensure we have at least one audio track before starting the recorder.
  const audioTracks = typeof stream.getAudioTracks === 'function' ? stream.getAudioTracks() : [];
  if (!audioTracks || audioTracks.length === 0) {
    console.warn('No audio tracks on agent stream yet; waiting for track...');
    try {
      const onAddTrack = () => {
        try { stream.removeEventListener('addtrack', onAddTrack); } catch (_) {}
        // Defer slightly to let track become live
        setTimeout(() => { try { tryStartAgentAudioCapture(); } catch (_) {} }, 100);
      };
      stream.addEventListener && stream.addEventListener('addtrack', onAddTrack);
    } catch (_) {}
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
        console.log(`[STT] Partial transcript: "${text}"`);
        // Feed partial transcription into sentence queue for chunking & sending.
        sentenceQueue.pushPartial(text);
        appendMessage('agent', text, 'stt');
      }
    } catch (err) {
      console.error('STT chunk failed:', err);
    } finally {
      sttInFlight--;
    }
  };
  mediaRecorder.onerror = (e) => console.error('MediaRecorder error', e);
  try {
    mediaRecorder.start(CHUNK_MS);
  } catch (e) {
    console.warn('MediaRecorder.start failed:', e);
    try { mediaRecorder.stop(); } catch (_) {}
    mediaRecorder = null;
    return;
  }
  recordingActive = true;
}

function stopAgentAudioCapture() {
  try { if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop(); } catch (_) {}
  mediaRecorder = null;
  recordingActive = false;
  // Flush any remaining STT that wasn't sent yet
  sentenceQueue.flushRemainder();
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

// sentenceQueue handles flushing; no-op retained for compatibility
function flushSttTurnBuffer() {}

// Initialize status and local WS
setConnectedUI(false);
updateMicState('idle');
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
