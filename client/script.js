// Frontend conversation logic using @elevenlabs/client
// Follow the docs: start a session with either an agentId (for public agents)
// or with a signedUrl retrieved from a backend (for private agents).

import { Conversation } from '@elevenlabs/client';

const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const connectionStatus = document.getElementById('connectionStatus');
const agentStatus = document.getElementById('agentStatus');
const agentAudioEl = document.getElementById('agentAudio');
const localWsStatusEl = document.getElementById('localWsStatus');
const lastSttTextEl = document.getElementById('lastSttText');

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

function setLocalWsStatus(text) {
  if (localWsStatusEl) localWsStatusEl.textContent = text;
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
        startButton.disabled = true;
        stopButton.disabled = false;
      },
      onDisconnect: () => {
        connectionStatus.textContent = 'Disconnected';
        startButton.disabled = false;
        stopButton.disabled = true;
      },
      onError: (error) => {
        console.error('Error:', error);
      },
      onModeChange: (mode) => {
        agentStatus.textContent = mode.mode === 'speaking' ? 'speaking' : 'listening';
      },
      onMessage: (msg) => {
        const text = typeof msg === 'string' ? msg : (msg && (msg.text || msg.message || msg.content));
        if (text) {
          if (lastSttTextEl) lastSttTextEl.textContent = text;
          forwardTextToLocalWS(text);
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

startButton.addEventListener('click', startConversation);
stopButton.addEventListener('click', stopConversation);

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
        if (lastSttTextEl) lastSttTextEl.textContent = text;
        forwardTextToLocalWS(text);
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
