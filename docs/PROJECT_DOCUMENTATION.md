# Webinar Agent – Real‑Time Conversational Avatar

## Overview

This project delivers a webinar presenter you can talk to naturally and effortlessly. You can interrupt at any time, and the agent gracefully adapts—just like a real presenter. The result is a low‑latency, human‑feeling conversation with a photorealistic MetaHuman avatar hosting the session.

The system combines a browser front end, an ElevenLabs Audio Agent with a knowledge base, and a WebSocket bridge into Unreal Engine where the MetaHuman speaks and lip‑syncs in real time.

## Experience Highlights

- Natural, low‑latency conversation with barge‑in: speak over the agent at any moment to redirect or follow up.
- Knowledge‑aware answers: the agent can leverage presentation materials such as PPT slide decks and PDF documents as a knowledge base.
- Presenter realism: a MetaHuman avatar hosts the webinar, with synchronized speech and facial animation for credible delivery.
- Built for live sessions: smooth start/stop, quick recovery from interruptions, and responsive behavior.

## Architecture Overview

- Frontend (Vite web app)
  - Captures live microphone input, manages the session, and renders agent status and messages.
  - Plays back the agent’s voice replies and coordinates interruption behavior for human‑like flow.
  - Streams sentence‑level text to Unreal Engine over a local WebSocket.

- ElevenLabs Audio Agent (cloud)
  - Acts as the conversational brain for the webinar.
  - Supports knowledge bases assembled from materials like PPT and PDF, enabling grounded, content‑aware responses.
  - Produces natural, responsive voice answers during the session.

- Unreal Engine Runtime
  - Hosts a local WebSocket server that receives sentence‑level text from the browser.
  - Uses ElevenLabs via the Runtime AI Chatbot Integrator to take text input and handle speech synthesis/recognition as needed.
  - Plays audio using the Runtime Audio Importer and drives facial animation with the Runtime MetaHuman Lipsync plugin.
  - A MetaHuman serves as the on‑screen webinar avatar.

## End‑to‑End Flow

1. The participant speaks into the browser for a natural, two‑way conversation.
2. The frontend manages the live session with the ElevenLabs Audio Agent and plays back the agent’s audio reply.
3. The agent’s audio reply is transcribed to text using ElevenLabs speech‑to‑text.
4. The resulting text is streamed over a WebSocket to Unreal Engine.
5. Inside Unreal, the Runtime AI Chatbot Integrator consumes the text and works with ElevenLabs services to produce speech as appropriate.
6. Audio is imported and played in real time via the Runtime Audio Importer, while the Runtime MetaHuman Lipsync plugin drives the avatar’s mouth and facial timing.
7. If the participant interrupts mid‑utterance, the system prioritizes the participant’s input, smoothly pausing or canceling pending speech so the interaction stays realistic.

## Technical Details

- Conversation State and Interruption
  - The frontend tracks conversation modes and supports barge‑in so participants can interject at any moment without waiting for turn‑taking.

- Knowledge Base
  - The ElevenLabs Audio Agent can incorporate external materials such as PPT and PDF files, enabling context‑rich answers grounded in the webinar’s source content.

- Transcription and Text Streaming
  - Agent audio is transcribed through ElevenLabs speech‑to‑text and segmented into sentence‑level chunks for timely delivery to Unreal.
  - Text is streamed over a local WebSocket, preserving order and enabling responsive updates inside the engine.

- Unreal Presentation Pipeline
  - Unreal receives text, leverages ElevenLabs via the Runtime AI Chatbot Integrator, plays audio using the Runtime Audio Importer, and animates the MetaHuman with the Runtime MetaHuman Lipsync plugin.
  - This combination yields synchronized speech and lip movement for a lifelike webinar presenter.