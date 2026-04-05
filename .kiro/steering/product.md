# Voxara Browser Extension — Product Summary

Voxara is a cross-browser extension that intercepts PDFs opened in the browser and transforms them into an interactive, audio-first reading experience. Users listen to documents read aloud while holding AI-powered chat conversations about the content.

## Core Behaviours

- Auto-detects PDFs in any tab and injects a player UI
- Reads documents aloud via Web Speech API (free) or cloud TTS (premium: OpenAI, Azure)
- Every AI response is delivered simultaneously as streaming text AND spoken audio — this dual-channel delivery is non-negotiable and always on
- Two chat modes: per-document (grounded in current PDF) and global (cross-document research)
- Playback controls: play/pause, skip ±10s, 0.5x–3.0x speed, pitch, volume

## Target Users

Readers who want to consume PDFs hands-free — students, researchers, professionals, non-native speakers.

## v1.0 Scope Boundaries

- Browser extension only (no mobile app)
- PDF documents only (no EPUB, DOCX)
- No on-device LLM inference
- No collaborative/shared sessions
