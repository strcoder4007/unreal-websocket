// Frontend conversation logic using @elevenlabs/client
// Follow the docs: start a session with either an agentId (for public agents)
// or with a signedUrl retrieved from a backend (for private agents).

import { Conversation } from '@elevenlabs/client';

const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const connectionStatus = document.getElementById('connectionStatus');
const agentStatus = document.getElementById('agentStatus');

// Configuration: set your Agent ID here for public agents
// For private agents, leave this as null and enable SIGNED_URL_FLOW below.
const AGENT_ID = 'agent_0101k6w6hvhjfyb8h0ph5q0ebwn8'; // TODO: replace with your actual agent ID

// If using a private agent, set this to true and ensure the backend is running
// on http://localhost:3001 as implemented in backend/server.js.
const SIGNED_URL_FLOW = false;

let conversation;

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
    });
  } catch (error) {
    console.error('Failed to start conversation:', error);
  }
}

async function stopConversation() {
  if (conversation) {
    await conversation.endSession();
    conversation = null;
  }
}

startButton.addEventListener('click', startConversation);
stopButton.addEventListener('click', stopConversation);

