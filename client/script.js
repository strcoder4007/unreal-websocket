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
// Enable and map to Unreal's pause control so interruptions stop output immediately.
const SEND_STOP_ON_INTERRUPT = true;
const STOP_CONTROL_MESSAGE = 'action^pause';

// Messages state
let messages = [];
let msgSeq = 0;
let lastAppendedText = '';
let lastAppendedAt = 0;
let currentMode = 'idle';
let userWindowUntil = 0;
// When true, drop any outgoing text to Unreal and send a pause signal
let unrealPaused = false;
let lastPauseSentAt = 0;
let savedVolume = 1;
let agentTurnBuffer = '';

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
    console.log(`[WS] Connecting to ${LOCAL_WS_URL}...`);
    localWS = new WebSocket(LOCAL_WS_URL);
    localWS.onopen = () => {
      localWSConnected = true;
      localWSConnecting = false;
      setLocalWsStatus('connected');
      console.log('[WS] Connected. Flushing queue...');
      while (localWSQueue.length) {
        try {
          const payload = localWSQueue.shift();
          localWS.send(payload);
          console.log('[WS] Flushed queued payload:', payload);
        } catch (e) { console.warn('[WS] Failed sending queued payload:', e); break; }
      }
      localWSBackoff = 500;
    };
    localWS.onclose = () => {
      localWSConnected = false;
      localWSConnecting = false;
      setLocalWsStatus('disconnected');
      console.warn('[WS] Disconnected. Will retry...', { backoff: localWSBackoff });
      setTimeout(connectLocalWS, localWSBackoff);
      localWSBackoff = Math.min(localWSBackoff * 2, 10000);
    };
    localWS.onerror = () => {
      // handled by onclose
      console.warn('[WS] Error event.');
    };
  } catch (e) {
    localWSConnected = false;
    localWSConnecting = false;
    setLocalWsStatus('error');
    console.error('[WS] Connect threw:', e);
    setTimeout(connectLocalWS, localWSBackoff);
    localWSBackoff = Math.min(localWSBackoff * 2, 10000);
  }
}

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

function sendPauseToUnreal() {
  const now = Date.now();
  if (now - lastPauseSentAt < 150) return; // guard against rapid duplicates
  lastPauseSentAt = now;
  try { _sendLocal('action^pause'); } catch (_) {}
}

function clearLocalTextQueue() {
  // Remove any queued lstext^ payloads that haven't been flushed yet
  if (Array.isArray(localWSQueue) && localWSQueue.length) {
    const before = localWSQueue.length;
    localWSQueue = localWSQueue.filter((p) => {
      try { return !(typeof p === 'string' && p.startsWith('lstext^')); }
      catch { return true; }
    });
    const after = localWSQueue.length;
    if (before !== after) console.log(`[WS] Cleared ${before - after} queued lstext^ payload(s) on interrupt.`);
  }
}

function forwardTextToLocalWS(text) {
  if (!text) return;
  const s = String(text).trim();
  if (!s) return;
  if (unrealPaused) {
    console.log(`[WS-direct] Paused; dropping full text: "${s}"`);
    return;
  }
  const now = Date.now();
  if (s === lastForwardedText && now - lastForwardedAt < 2000) return; // basic dedupe
  lastForwardedText = s;
  lastForwardedAt = now;
  console.log(`[WS-direct] Sending full text to LOCAL_WS_URL: "${s}"`);
  _sendLocal(`lstext^${s}`);
}

function resetAgentTurnState() {
  agentTurnBuffer = '';
  lastForwardedText = '';
  lastForwardedAt = 0;
}

function sendAgentDelta(text, source = 'agent') {
  if (unrealPaused) {
    console.log(`[AgentOut] Paused; dropping ${source} chunk.`);
    return;
  }
  let raw = typeof text === 'string' ? text : (text == null ? '' : String(text));
  if (!raw) return;
  raw = raw.trim();
  if (!raw) return;

  if (agentTurnBuffer && raw === agentTurnBuffer) {
    return; // nothing new
  }

  let chunk = raw;
  if (agentTurnBuffer && raw.startsWith(agentTurnBuffer)) {
    chunk = raw.slice(agentTurnBuffer.length).trim();
    if (!chunk) {
      agentTurnBuffer = raw;
      return;
    }
  } else if (agentTurnBuffer && agentTurnBuffer.length > raw.length && agentTurnBuffer.startsWith(raw)) {
    // Agent text shrank (likely correction). Reset so we resend the new content.
    resetAgentTurnState();
    chunk = raw;
  }

  agentTurnBuffer = raw;
  forwardTextToLocalWS(chunk);
}

function haltAgentStreaming(reason = 'interrupted') {
  console.log(`[Interrupt] Halting agent output (${reason}).`);
  resetAgentTurnState();
  clearLocalTextQueue();
  if (SEND_STOP_ON_INTERRUPT) {
    sendPauseToUnreal();
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
        if (currentMode === 'speaking') {
          updateMicState('speaking');
          unrealPaused = false;
          // restore volume in case we muted on interrupt
          try { if (conversation && typeof conversation.setVolume === 'function') conversation.setVolume({ volume: savedVolume || 1 }); } catch (_) {}
        }
        else if (currentMode === 'listening') updateMicState('listening');
        else updateMicState('waiting');
        // Short window where incoming onMessage is treated as user transcripts
        if (currentMode === 'listening') userWindowUntil = Date.now() + 6000; else userWindowUntil = 0;
        // Attempt to start agent audio capture when the agent begins speaking
        if (currentMode === 'speaking') {
          // New turn: clear per-turn dedupe
          resetAgentTurnState();
          tryStartAgentAudioCapture();
        }
        // Handle interruption vs. natural completion
        if (prevMode === 'speaking' && currentMode === 'listening') {
          // Interrupted mid-utterance: halt any further output
          console.log('[Interrupt] Detected speaking -> listening during agent response. Halting output.');
          unrealPaused = true;
          haltAgentStreaming('mode-change');
          // mute agent output immediately
          try {
            if (conversation && typeof conversation.setVolume === 'function') {
              savedVolume = 1; // default
              conversation.setVolume({ volume: 0 });
            }
          } catch (_) {}
          try { if (agentAudioEl && typeof agentAudioEl.pause === 'function') agentAudioEl.pause(); } catch (_) {}
          try { stopAgentAudioCapture(); } catch (_) {}
        } else if (prevMode === 'speaking' && currentMode !== 'speaking') {
          // Natural end of speaking turn
          console.log('[Turn] Agent finished speaking.');
        }
      },
      // Official ElevenLabs interruption event: log only the event_id
      // and notify local Unreal bridge to pause
      onInterruption: (ev) => {
        try {
          console.log('[11labs/interruption]', { event_id: ev && ev.event_id });
        } catch (_) {
          console.log('[11labs/interruption]', ev && ev.event_id);
        }
        // Pause Unreal and stop any further text from being streamed this turn
        unrealPaused = true;
        haltAgentStreaming('interruption');
        // mute agent output immediately
        try {
          if (conversation && typeof conversation.setVolume === 'function') {
            savedVolume = 1; // default
            conversation.setVolume({ volume: 0 });
          }
        } catch (_) {}
        try { if (agentAudioEl && typeof agentAudioEl.pause === 'function') agentAudioEl.pause(); } catch (_) {}
        try { stopAgentAudioCapture(); } catch (_) {}
      },
      onMessage: (msg) => {
        const text = typeof msg === 'string' ? msg : (msg && (msg.text || msg.message || msg.content));
        if (text) {
          const role = classifyIncomingMessage(msg);
          appendMessage(role, text, 'onMessage');
          // Feed agent messages into the Unreal bridge as a fallback (or alongside STT).
          if (role !== 'user') {
            if (unrealPaused) {
              console.log('[AgentMsg] Paused; dropping onMessage text.');
            } else {
              console.log(`[AgentMsg] onMessage text received; processing. text="${text}"`);
              sendAgentDelta(text, 'message');
            }
          }
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
  unrealPaused = false;
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
        // Feed partial transcription into the Unreal bridge.
        if (unrealPaused) {
          console.log('[STT] Paused; dropping partial transcript.');
        } else {
          sendAgentDelta(text, 'stt');
          appendMessage('agent', text, 'stt');
        }
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
  resetAgentTurnState();
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
