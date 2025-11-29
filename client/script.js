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
const AUDIO_SAVE_ENDPOINT = 'http://localhost:3001/api/save-agent-audio'; // backend endpoint that persists agent audio chunks
let localWS = null;
let localWSConnected = false;
let localWSQueue = [];
let localWSBackoff = 500; // ms
let localWSConnecting = false;
let lastForwardedPath = '';
let lastForwardedPathAt = 0;

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
const audioChunkQueue = []; // preserves audio chunk ordering between capture, disk write, and websocket forwarding
let audioQueueDraining = false;
let audioChunkSeq = 0;
let conversationOutputFormat = 'pcm';
let conversationOutputSampleRate = 44100;
const DEFAULT_SAMPLE_RATE = 44100;
const DEFAULT_CHANNELS = 1;
const ULAW_DECODE_TABLE = [0,132,396,924,1980,4092,8316,16764];

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
  // Remove any queued lstext^ payloads (now carrying file paths) that haven't been flushed yet
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

function forwardAudioPathToLocalWS(filepath) {
  if (!filepath) return;
  const safePath = String(filepath).trim();
  if (!safePath) return;
  if (unrealPaused) {
    console.log(`[WS-direct] Paused; dropping audio path: "${safePath}"`);
    return;
  }
  const now = Date.now();
  if (safePath === lastForwardedPath && now - lastForwardedPathAt < 1000) return; // basic dedupe
  lastForwardedPath = safePath;
  lastForwardedPathAt = now;
  console.log(`[WS-direct] Sending audio path to LOCAL_WS_URL: "${safePath}"`);
  _sendLocal(`lstext^${safePath}`);
}

function clearPendingAudioChunks(reason = 'reset') {
  if (!audioChunkQueue.length) return;
  console.log(`[AudioQueue] Cleared ${audioChunkQueue.length} pending chunk(s) (${reason}).`);
  audioChunkQueue.length = 0;
}

function resetAgentTurnState(reason = 'reset') {
  lastForwardedPath = '';
  lastForwardedPathAt = 0;
  if (reason !== 'new-turn') {
    clearPendingAudioChunks(reason);
  }
}

function enqueueAgentAudioChunk(blob) {
  if (!blob || typeof blob.size === 'number' && blob.size === 0) return;
  audioChunkQueue.push({ blob, seq: ++audioChunkSeq });
  drainAudioChunkQueue().catch((err) => console.error('[AudioQueue] Drain failed:', err));
}

async function drainAudioChunkQueue() {
  if (audioQueueDraining) return;
  audioQueueDraining = true;
  try {
    while (audioChunkQueue.length) {
      if (unrealPaused) {
        if (audioChunkQueue.length) {
          console.log(`[AudioQueue] Paused; dropping ${audioChunkQueue.length} pending chunk(s).`);
          audioChunkQueue.length = 0;
        }
        break;
      }
      const { blob, seq } = audioChunkQueue.shift();
      try {
        const saved = await saveAgentAudioChunk(blob, seq);
        if (!saved || !saved.filepath) continue;
        if (unrealPaused) {
          console.log(`[AudioQueue] Paused after saving chunk ${seq}; not forwarding path.`);
          continue;
        }
        forwardAudioPathToLocalWS(saved.filepath);
      } catch (err) {
        console.error(`[AudioQueue] Failed to persist chunk ${seq}:`, err);
      }
    }
  } finally {
    audioQueueDraining = false;
  }
}

async function saveAgentAudioChunk(blob, seq) {
  const contentType = blob.type || 'audio/webm';
  const res = await fetch(AUDIO_SAVE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: blob,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Save audio HTTP ${res.status}: ${txt}`);
  }
  const data = await res.json();
  const displayPath = data.relativePath || data.filepath || '(unknown path)';
  console.log(`[AudioQueue] Saved chunk ${seq} -> ${displayPath}`);
  return data;
}

function updateConversationOutputFormat(source = 'unknown') {
  try {
    if (conversation && conversation.connection && conversation.connection.outputFormat) {
      const fmt = conversation.connection.outputFormat;
      if (fmt && fmt.format) conversationOutputFormat = fmt.format;
      if (fmt && fmt.sampleRate) conversationOutputSampleRate = fmt.sampleRate;
    }
  } catch (err) {
    console.warn(`[AudioQueue] Failed to read output format from ${source}:`, err);
  }
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToPCM16LE(uint8) {
  const len = Math.floor(uint8.byteLength / 2);
  const view = new DataView(uint8.buffer, uint8.byteOffset, uint8.byteLength);
  const pcm = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    pcm[i] = view.getInt16(i * 2, true);
  }
  return pcm;
}

function decodeUlawSample(sample) {
  let mu = ~sample & 0xff;
  const sign = mu & 0x80;
  mu &= 0x7f;
  const exponent = (mu >> 4) & 0x07;
  const mantissa = mu & 0x0f;
  let value = ULAW_DECODE_TABLE[exponent] + (mantissa << (exponent + 3));
  if (sign) value = -value;
  return value;
}

function ulawToPCM16(uint8) {
  const pcm = new Int16Array(uint8.length);
  for (let i = 0; i < uint8.length; i++) {
    pcm[i] = decodeUlawSample(uint8[i]);
  }
  return pcm;
}

function pcm16ToWavBlob(pcmSamples, sampleRate = DEFAULT_SAMPLE_RATE, channels = DEFAULT_CHANNELS) {
  const bytes = pcmSamples.length * 2;
  const buffer = new ArrayBuffer(44 + bytes);
  const view = new DataView(buffer);
  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };
  const blockAlign = channels * 2;
  const byteRate = sampleRate * blockAlign;

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // subchunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, bytes, true);

  let offset = 44;
  for (let i = 0; i < pcmSamples.length; i++, offset += 2) {
    view.setInt16(offset, pcmSamples[i], true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function handleAgentAudioChunk(audioBase64) {
  if (!audioBase64) return;
  if (unrealPaused) {
    console.log('[AudioQueue] Paused; ignoring incoming audio chunk.');
    return;
  }
  try {
    updateConversationOutputFormat('audio-chunk');
    const bytes = base64ToUint8Array(audioBase64);
    if (!bytes || !bytes.length) return;
    const fmt = (conversationOutputFormat || 'pcm').toLowerCase();
    const sampleRate = conversationOutputSampleRate || DEFAULT_SAMPLE_RATE;
    let pcmSamples;
    if (fmt === 'ulaw') {
      pcmSamples = ulawToPCM16(bytes);
    } else {
      pcmSamples = bytesToPCM16LE(bytes);
    }
    if (!pcmSamples || !pcmSamples.length) return;
    const wavBlob = pcm16ToWavBlob(pcmSamples, sampleRate);
    enqueueAgentAudioChunk(wavBlob);
  } catch (err) {
    console.error('[AudioQueue] Failed to convert audio chunk:', err);
  }
}

function haltAgentStreaming(reason = 'interrupted') {
  console.log(`[Interrupt] Halting agent output (${reason}).`);
  resetAgentTurnState(reason);
  clearLocalTextQueue();
  if (SEND_STOP_ON_INTERRUPT) {
    sendPauseToUnreal();
  }
}

let conversation;
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
        updateConversationOutputFormat('connect');
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
          updateConversationOutputFormat('mode-change');
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
          resetAgentTurnState('new-turn');
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
      },
      onMessage: (msg) => {
        const text = typeof msg === 'string' ? msg : (msg && (msg.text || msg.message || msg.content));
        if (text) {
          const role = classifyIncomingMessage(msg);
          appendMessage(role, text, 'onMessage');
          // Feed agent messages into the Unreal bridge as a fallback (or alongside STT).
          if (role !== 'user') {
            if (unrealPaused) {
              console.log('[AgentMsg] Paused; ignoring onMessage text.');
            } else {
              console.log(`[AgentMsg] onMessage text received (UI only). text="${text}"`);
            }
          }
        }
      },
      onAudio: (audioBase64) => {
        handleAgentAudioChunk(audioBase64);
      },
    });
    updateConversationOutputFormat('session-started');
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
  resetAgentTurnState('stop');
  clearLocalTextQueue();
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
