# Voxara Browser Extension — Product Requirements Document

**Version:** v1.0  
**Status:** Design-Ready  
**Date:** Q2 2025  
**Platform:** All Major Browsers  
**Tags:** Cross-browser · Audio-First · AI Chat · Multi-voice · Variable Pace

---

## Table of Contents

1. [Product Overview & Scope](#1-product-overview--scope)
2. [Extension Architecture](#2-extension-architecture)
3. [PDF Interception & Parsing](#3-pdf-interception--parsing)
4. [Audio Engine & Voice System](#4-audio-engine--voice-system)
5. [AI Chat System](#5-ai-chat-system)
6. [Data Model](#6-data-model)
7. [Cross-Browser Compatibility Layer](#7-cross-browser-compatibility-layer)
8. [State Management](#8-state-management)
9. [Security & Privacy](#9-security--privacy)
10. [Performance Targets](#10-performance-targets)
11. [API Reference](#11-api-reference)
12. [Deployment & Release Strategy](#12-deployment--release-strategy)

---

## 1. Product Overview & Scope

### 1.1 What Voxara Extension Does

Voxara is a browser extension that intercepts any PDF a user opens in their browser and transforms it into an interactive, audio-first reading experience. The user can listen to the document read aloud in a chosen voice and pace, and simultaneously hold a natural AI chat conversation — either about the active document or across all their documents globally.

Every AI response is delivered in two channels simultaneously: rendered as text in the chat panel and spoken aloud via the selected voice. This dual-channel delivery is not a toggle — it is the default and defining behaviour of the product.

### 1.2 Core Capability Summary

| Capability | Description |
|---|---|
| PDF Interception | Auto-detects PDFs opened in any tab; injects player UI without disrupting browser |
| Audio Playback | Reads document aloud via Web Speech API (free) or cloud TTS (premium) |
| Voice Selection | 5+ free voices (browser-native) + premium neural voices (cloud); persistent preference |
| Pace Control | 0.5x – 3.0x speed slider; fine-grained pitch and volume controls |
| Per-Document Chat | Scoped AI conversation grounded in current PDF; full history persisted |
| Global Chat | Cross-document AI assistant with awareness of all user's documents |
| Dual-Channel AI Response | Every AI answer rendered as text + spoken aloud simultaneously |
| Playback Controls | Play/pause, skip ±10s, chapter navigation, progress scrubbing |

### 1.3 Out of Scope (v1.0)

- Native mobile app (separate product track)
- On-device LLM inference
- Collaborative / shared document sessions
- PDF annotation or editing
- Support for non-PDF document types (EPUB, DOCX) — Phase 2

---

## 2. Extension Architecture

### 2.1 Component Map

The extension consists of five distinct runtime contexts, each with different privileges and lifetimes:

| Component | Runtime Context | Responsibilities |
|---|---|---|
| Service Worker | Background (persistent) | PDF detection, message routing, API calls, IndexedDB writes, alarm scheduling |
| Content Script | Injected per tab | PDF interception, DOM overlay injection, Web Speech API orchestration, user event capture |
| Side Panel (UI) | Extension side panel | Chat interface, playback controls, voice selector, pace slider, document library |
| Options Page | Extension page | Account settings, voice preferences, storage management, API key config |
| Offscreen Document | Hidden background page | Audio synthesis via Web Speech API when tab is not focused; audio queue management |

> **Why Offscreen Document:** Web Speech API requires a visible DOM context to speak. The Offscreen Document (Chrome MV3 API) provides a headless DOM that keeps audio alive even when the user switches tabs — solving the most common TTS extension bug.

### 2.2 Message Passing Architecture

All inter-component communication uses the browser's native message passing. Every message has a typed envelope:

```json
{
  "type": "PLAY_CHUNK | AI_QUERY | VOICE_CHANGE | ...",
  "payload": {},
  "requestId": "uuid"
}
```

Message flow for the primary use case (user asks AI question during playback):

1. Side Panel sends `AI_QUERY` message → Service Worker
2. Service Worker pauses audio: sends `PAUSE_PLAYBACK` → Offscreen Document
3. Service Worker fetches AI response from backend API
4. Service Worker sends `AI_RESPONSE` → Side Panel (renders text) AND Offscreen Document (speaks text)
5. Both channels execute in parallel — text appears as voice begins
6. On speech end: Service Worker sends `RESUME_PLAYBACK` → Offscreen Document

### 2.3 Extension Manifest (MV3) Key Permissions

```json
"permissions": ["storage", "activeTab", "scripting", "sidePanel", "offscreen", "alarms"],
"host_permissions": ["<all_urls>"],
"content_scripts": [{ "matches": ["<all_urls>"], "run_at": "document_start" }]
```

> **Cross-Browser Note:** Firefox uses Manifest V2 with background pages (not service workers). Edge uses MV3 identically to Chrome. Safari requires additional WKWebView bridging. The compatibility layer in Section 7 handles all divergences.

---

## 3. PDF Interception & Parsing

### 3.1 Detection Strategy

PDF detection happens at two levels to maximise coverage:

**Level 1 — URL-based (Service Worker)**
- Service Worker listens to `chrome.webNavigation.onCommitted` events
- Checks if URL ends in `.pdf` OR if response `Content-Type` header is `application/pdf`
- If match: injects content script into the tab with `executeScript()`
- This catches PDFs opened directly via URL (most common case)

**Level 2 — Embed/iframe-based (Content Script)**
- Content script scans DOM for `<embed type='application/pdf'>` and `<iframe>` elements
- `MutationObserver` watches for dynamically injected PDF embeds (e.g. Google Drive preview)
- On detection: extracts `src` URL, fetches PDF bytes, hands off to parser

### 3.2 PDF Parsing with PDF.js

PDF.js (Mozilla, Apache 2.0 license) handles all client-side parsing. It is loaded as a bundled dependency — no CDN dependency at runtime.

**Extraction Pipeline:**

1. Fetch PDF as `ArrayBuffer` via `fetch()` in content script
2. Instantiate `pdfjsLib.getDocument({ data: arrayBuffer })`
3. Iterate pages: `page.getTextContent()` returns `TextItem[]` with strings and transform coordinates
4. Reconstruct reading order: sort `TextItem`s by vertical position (y), then horizontal (x)
5. Detect headings: `TextItem`s with `fontSize` > body average by 20%+ are tagged as headings
6. Concatenate into full text string with page boundary markers: `[PAGE_BREAK:5]`
7. Post-extraction: send raw text to Service Worker for chunking

### 3.3 Chunking Algorithm

Chunking targets natural speech segments — not arbitrary token windows. The algorithm:

1. Split text on sentence boundaries using `Intl.Segmenter` (browser-native, no library needed)
2. Accumulate sentences into a chunk until word count reaches 120–180 words (optimal for ~45s of speech at 1x pace)
3. Never break a chunk mid-sentence — if adding next sentence exceeds limit, start new chunk
4. Tag each chunk: `{ id, documentId, pageStart, pageEnd, headingContext, text, wordCount, sequenceIndex }`
5. Store all chunks to IndexedDB under document record

> **Design Decision:** 120–180 words per chunk (not tokens) because the audio engine thinks in time, not tokens. At 1x speed, 150 words ≈ 60 seconds — a natural paragraph unit. The AI layer assembles its own context window by fetching N chunks regardless of this boundary.

---

## 4. Audio Engine & Voice System

### 4.1 Voice Tier Architecture

| Tier | Engine | Quality | Cost |
|---|---|---|---|
| Free | Web Speech API (browser-native) | Good — varies by OS/browser | $0.00 always |
| Premium | OpenAI TTS (tts-1 model) | Excellent — natural prosody | ~$0.015 / 1K chars |
| Premium+ | Azure Neural TTS | Best — SSML control, emotions | ~$0.016 / 1K chars |

### 4.2 Web Speech API Voice Selection

The free tier surfaces all voices available on the user's OS via `window.speechSynthesis.getVoices()`. This returns different sets across platforms:

| Platform | Available Voices (English) | Notable Voices |
|---|---|---|
| Windows 11 | 20+ Microsoft neural voices | Microsoft Aria, Guy, Jenny (all neural-quality) |
| macOS / iOS | Siri voices (Samantha, etc.) | High quality; limited selection |
| Android / ChromeOS | Google Text-to-Speech voices | Good quality; language packs downloadable |
| Linux | espeak-ng (usually) | Robotic — recommend premium upsell |

Voice selection UI shows: voice name, language flag, a 5-second preview button ('Hear sample'), and a PREMIUM badge for cloud voices. User preference is saved to `chrome.storage.sync` so it persists across devices.

### 4.3 Pace Control

Web Speech API exposes `SpeechSynthesisUtterance.rate` (range: 0.1–10, default 1.0). Voxara exposes 0.5x–3.0x via a labelled slider with preset buttons:

| Speed | Use Case |
|---|---|
| 0.5x | Careful listening, non-native speakers |
| 0.75x | Comfortable slow pace |
| 1.0x | Normal reading speed (default) |
| 1.25x | Slightly accelerated |
| 1.5x | Power user default |
| 2.0x / 2.5x / 3.0x | Speed-reading modes |

Rate change takes effect on the next utterance (current chunk finishes at old rate — this is a Web Speech API limitation). Premium TTS rate changes are applied server-side via SSML `<prosody rate='fast'>` tags, so they can apply mid-stream.

Additional controls exposed: Pitch (0.5–2.0) and Volume (0–1) sliders — both real-time via Web Speech API.

### 4.4 Audio Playback Engine

**Chunk Queue & Buffer**
- `AudioQueue`: a circular buffer holding the next 3 chunks as pre-synthesised utterances (Web Speech API) or pre-fetched audio blobs (premium TTS)
- On playback start: synthesise chunks [0, 1, 2] in parallel
- On chunk N completing: immediately begin synthesising chunk N+3, maintaining 3-chunk lookahead
- Skip forward/back: flush queue, re-synthesise from new position — target <800ms gap

**Offscreen Document Audio Management**
- All `SpeechSynthesisUtterance` objects created and spoken in the Offscreen Document
- Offscreen Document sends `CHUNK_STARTED` and `CHUNK_ENDED` events to Service Worker with chunk index
- Service Worker relays to Side Panel for UI sync (progress bar, page indicator, text highlight)
- Premium TTS: Offscreen Document uses `AudioContext` + `decodeAudioData` to play fetched audio blobs

**Playback State Machine**

| State | Description & Transitions |
|---|---|
| IDLE | No document loaded. → LOADING on PDF detection |
| LOADING | PDF.js parsing + chunking in progress. → READY when chunks stored |
| READY | Chunks available, audio pre-synthesising. User can play. → PLAYING |
| PLAYING | Audio active. → PAUSED (user) \| AI_RESPONDING (query) \| ENDED |
| PAUSED | Position saved. → PLAYING on resume |
| AI_RESPONDING | Playback suspended. AI text streaming + voice speaking. → PAUSED on complete |
| ENDED | Last chunk finished. Show completion UI. → IDLE on new doc |
| ERROR | Parse failure / speech synthesis error. Show retry option. |

---

## 5. AI Chat System

### 5.1 Dual Chat Mode Architecture

Voxara maintains two distinct chat session types that coexist and are navigable from the Side Panel:

| Dimension | Per-Document Chat | Global Chat |
|---|---|---|
| Scope | Grounded in current PDF only | Aware of all user documents |
| Context source | Active document chunks + position | IndexedDB full-text search across docs |
| History persistence | Per `documentId` in IndexedDB | Separate global thread in IndexedDB |
| Session continuity | Resumes on same doc re-open | Always-on; never resets unless cleared |
| System prompt | Document-grounded tutor | Cross-document research assistant |
| Voice behaviour | Pauses document, speaks answer, resumes | Speaks answer; no playback to pause |

### 5.2 Context Assembly

**Per-Document Context**
1. Retrieve current chunk index from playback state
2. Fetch chunks [N-3 .. N+3] from IndexedDB — 7 chunks ≈ 1,000 words of local context
3. Run keyword search in IndexedDB full-text index for query terms — fetch top 3 matching chunks from anywhere in document
4. Merge: deduplicate, sort by `sequence_index`, truncate to 2,500 words
5. Prepend: `{ document_title, current_section, current_page }` as metadata header

**Global Context**
1. Extract key nouns/entities from user query using lightweight client-side NLP (compromise.js, ~30KB)
2. Search IndexedDB across ALL documents using extracted terms
3. Rank results by: BM25 relevance score + recency of document + user interaction frequency
4. Fetch top 5 matching chunks from up to 3 different documents
5. Prepend source attribution: `[From: 'Research Methodology.pdf', Page 12]`

### 5.3 System Prompts

**Per-Document System Prompt**
```
You are Voxara, an AI reading assistant. The user is currently listening to a document.
Your job is to help them understand it.

Rules:
- Answer using ONLY the provided document context. Never invent information.
- Write in flowing prose — no bullet points, no markdown headers. Your answer will be read aloud.
- Be concise. Aim for 2–4 sentences. If a longer answer is genuinely needed, structure it as short paragraphs.
- If the answer is not in the context, say: "That doesn't appear to be covered in the section you're
  listening to. Would you like me to search the rest of the document?"
- Address the user directly and conversationally.
```

**Global System Prompt**
```
You are Voxara, a personal AI research assistant with access to the user's document library.

Rules:
- You may synthesise information across multiple documents. Always cite your sources inline:
  (Source: filename, Page N).
- Write in flowing prose suitable for being read aloud. No markdown.
- If you cannot find relevant information in the provided context, say so honestly.
- You may ask the user clarifying questions if the query is ambiguous.
- Maintain conversational continuity — reference earlier messages in the thread naturally.
```

### 5.4 Dual-Channel Response Delivery

When an AI response is received, two parallel pipelines fire simultaneously:

**Text Channel (Side Panel)**
- AI response streamed via SSE (Server-Sent Events) from backend
- Tokens rendered progressively in the chat panel as they arrive (streaming UI)
- User sees text appearing word-by-word — same feel as ChatGPT
- Message stored to IndexedDB on stream completion

**Voice Channel (Offscreen Document)**
- Service Worker buffers incoming SSE tokens, waiting for first complete sentence (detected by punctuation + `Intl.Segmenter`)
- First sentence dispatched to Offscreen Document for immediate speech synthesis — voice starts within ~1–2s of response beginning
- Subsequent sentences queued and spoken sequentially as they complete
- Voice uses the same selected voice and pace as document playback
- User can press mute button to silence voice channel without stopping text stream

> **Key Insight:** Sentence-boundary detection for voice dispatch means the user hears the first sentence while the AI is still generating the rest. This makes the experience feel instantaneous even for longer answers.

### 5.5 Chat History Management

- Full history stored in IndexedDB — never truncated locally
- When assembling API payload: include last 8 message pairs (user + assistant) from history
- If total tokens exceed 6,000: drop oldest pairs first, always keeping system prompt + document context + last 2 pairs
- User can export chat history as Markdown or PDF from the Options page
- Global chat history is searchable — search bar in Side Panel queries IndexedDB full-text index on past messages

---

## 6. Data Model

### 6.1 Storage Overview

All client-side persistence uses IndexedDB (via the `idb` library wrapper for promise-based access). `chrome.storage.sync` holds only lightweight user preferences (~5KB). No `localStorage` is used — it is synchronous, size-limited, and cleared by browsers aggressively.

### 6.2 IndexedDB Schema

**Object Store: `documents`**

| Field | Type | Notes |
|---|---|---|
| id | string (UUID) | Primary key |
| url | string | Original PDF URL — used as dedup key |
| fileHash | string | SHA-256 of PDF bytes — dedup across URLs |
| title | string | From PDF metadata or filename |
| pageCount | number | Total pages |
| chunkCount | number | Total chunks generated |
| language | string | Detected language code (e.g. 'en') |
| parseStatus | enum | `pending \| complete \| failed` |
| createdAt | number | Unix timestamp |
| lastOpenedAt | number | For LRU eviction ordering |
| sizeBytesEstimate | number | For storage quota management |

**Object Store: `chunks`**

| Field | Type | Notes |
|---|---|---|
| id | string (UUID) | Primary key |
| documentId | string | FK → documents.id; indexed |
| sequenceIndex | number | Ordered position; indexed |
| text | string | Chunk text content; full-text indexed |
| wordCount | number | Pre-computed for pace estimation |
| pageStart | number | First page of this chunk |
| pageEnd | number | Last page of this chunk |
| headingContext | string | Nearest heading above chunk |
| sectionLabel | string | Human-readable section e.g. 'Chapter 2' |

**Object Store: `playbackStates`**

| Field | Type | Notes |
|---|---|---|
| documentId | string | Primary key (one state per doc) |
| currentChunkIndex | number | Last active chunk |
| currentOffsetChars | number | Character offset within chunk (for mid-sentence resume) |
| playbackRate | number | Current speed 0.5–3.0 |
| pitch | number | Voice pitch 0.5–2.0 |
| volume | number | Volume 0–1 |
| voiceId | string | Selected voice URI or premium voice name |
| bookmarks | array | `[ { chunkIndex, label, createdAt } ]` |
| completionPercent | number | Derived: `currentChunkIndex / chunkCount * 100` |
| updatedAt | number | Last modified timestamp — sync tiebreaker |

**Object Store: `chatThreads`**

| Field | Type | Notes |
|---|---|---|
| id | string | `documentId` for per-doc threads; `'global'` for global thread |
| messages | array | `[ { role, content, timestamp, contextChunks[] } ]` |
| messageCount | number | Cached count for UI display |
| createdAt | number | Thread creation timestamp |
| updatedAt | number | Last message timestamp |

**`chrome.storage.sync` — User Preferences**

| Key | Type | Default / Notes |
|---|---|---|
| preferredVoiceId | string | Last selected voice URI |
| preferredRate | number | 1.0 |
| preferredPitch | number | 1.0 |
| preferredVolume | number | 1.0 |
| ttsProvider | string | `'browser' \| 'openai' \| 'azure'` |
| aiModel | string | `'gpt-4o-mini'` (default) \| `'gpt-4o'` |
| voiceMuted | boolean | false — controls AI response voice channel |
| maxStorageMB | number | 200 — user-configurable IndexedDB limit |
| autoplayOnOpen | boolean | true — begin reading when PDF detected |

---

## 7. Cross-Browser Compatibility Layer

### 7.1 Compatibility Matrix

| Feature | Chrome | Edge | Firefox | Safari |
|---|---|---|---|---|
| Manifest Version | MV3 | MV3 | MV2* | MV3 (partial) |
| Service Worker | ✅ Full | ✅ Full | ❌ → Background Page | ✅ Partial |
| Side Panel API | ✅ Chrome 114+ | ✅ Edge 114+ | ❌ → Sidebar API | ❌ → Popover |
| Offscreen Document | ✅ Chrome 109+ | ✅ Edge 109+ | ❌ → Hidden iframe | ❌ → Hidden iframe |
| Web Speech API | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| IndexedDB | ✅ Full | ✅ Full | ✅ Full | ⚠️ Volatile in ITP |
| PDF.js interception | ✅ Full | ✅ Full | ✅ Full | ⚠️ Needs WKWebView bridge |

*Firefox MV3 support is in progress as of 2025 — ship MV2 for Firefox at launch with planned MV3 migration.*

### 7.2 Abstraction Strategy

A browser compatibility module (`browser-compat.js`) wraps all browser-specific APIs and exposes a unified interface to the rest of the codebase:

```js
const compat = await BrowserCompat.init();
await compat.storage.get('preferredVoiceId');      // wraps chrome.storage / browser.storage
await compat.runtime.sendMessage({ type: 'PLAY' }); // unified message passing
await compat.sidePanel.open();  // Chrome sidePanel | Firefox sidebar | Safari popover
```

**Background context abstraction:**
- Chrome/Edge: Service Worker in `background.js`
- Firefox: background page (`background.html` + `background.js`) — identical logic, different host
- Offscreen Document: Chrome/Edge only. Firefox/Safari use a hidden `<iframe>` injected into a content script

---

## 8. State Management

### 8.1 State Architecture

Voxara uses a unidirectional state flow. The Service Worker holds the authoritative application state object in memory. All components read state via message requests and receive state updates via broadcast messages.

```js
// Authoritative state shape (held in Service Worker memory)
const appState = {
  activeDocument: { id, title, chunkCount, parseStatus },
  playback: { state, chunkIndex, offsetChars, rate, pitch, volume, voiceId },
  chat: { activeMode: 'document' | 'global', isStreaming, pendingQuery },
  ui: { sidePanelOpen, activeTab: 'player' | 'chat' | 'library' }
};
```

State is persisted to IndexedDB on every meaningful change. On Service Worker restart (browsers kill service workers after ~30s of inactivity), state is hydrated from IndexedDB before handling the first message. This means state survives browser restarts transparently.

### 8.2 State Sync Across Components

- Service Worker broadcasts `STATE_UPDATE` messages to all connected ports on every state change
- Side Panel, Content Script, and Offscreen Document each maintain a local copy of the last received state
- Components never write directly to state — they dispatch `ACTION` messages to the Service Worker
- Service Worker processes action → updates state → broadcasts `STATE_UPDATE`

This eliminates race conditions between the chat panel, audio engine, and content script all trying to modify playback state simultaneously.

---

## 9. Security & Privacy

### 9.1 Data Handling

- PDF content never leaves the user's device except when an AI query is made
- AI queries send only the relevant context chunks (not the full document) to the API
- API key (OpenAI/Azure) is stored in `chrome.storage.local` (encrypted by browser) — never in code
- No analytics or telemetry without explicit user opt-in
- IndexedDB data is scoped to the extension origin — inaccessible to web pages

### 9.2 Content Security Policy

```json
"content_security_policy": {
  "extension_pages": "script-src 'self'; object-src 'none';"
}
```

- No inline scripts anywhere in extension pages
- All external API calls go through Service Worker — content scripts never make direct API calls
- PDF.js runs in content script context — isolated from extension pages

### 9.3 Permission Justification

| Permission | Justification (shown in store listing) |
|---|---|
| `<all_urls>` | Required to intercept PDFs on any website, including university portals and cloud storage |
| `storage` | Saves reading progress, voice preferences, and chat history locally on your device |
| `activeTab` | Reads the current tab's URL to detect PDFs |
| `scripting` | Injects the audio player interface into PDF tabs |
| `sidePanel` | Opens the chat and controls panel alongside your document |
| `offscreen` | Keeps audio playing when you switch to another tab |

---

## 10. Performance Targets

| Operation | Target | Failure Threshold |
|---|---|---|
| PDF detection to player UI appearing | <500ms | >1.5s = bug |
| PDF.js parse + chunk (50-page doc) | <3s | >8s = show progress bar |
| First audio utterance (Web Speech API) | <800ms from play tap | >2s = investigate |
| Chunk-to-chunk transition gap | <100ms | >300ms = jarring |
| AI response first token (streaming) | <1.5s | >3s = show spinner |
| AI response first spoken sentence | <2.5s from query submit | >4s = user frustration |
| Voice change taking effect | Next chunk boundary | >2 chunks = bug |
| IndexedDB read for context assembly | <50ms | >200ms = needs indexing fix |
| Extension install size (MV3 package) | <5MB | >10MB = store rejection risk |
| Memory usage (idle, side panel open) | <80MB | >200MB = memory leak |

---

## 11. API Reference

All backend calls are made from the Service Worker. The backend is optional for free-tier users (all AI calls can go directly to OpenAI). A Voxara backend (FastAPI) provides: user accounts, cloud sync, premium TTS proxying, and shared AI response caching.

### 11.1 AI Chat Endpoint

```
POST /api/v1/chat
```

```json
{
  "threadId": "doc_<documentId> | global",
  "message": "What is the main argument in chapter 3?",
  "context": [{ "chunkId": "", "text": "", "source": "" }],
  "history": [{ "role": "user|assistant", "content": "..." }],
  "model": "gpt-4o-mini",
  "stream": true
}
```

Response: SSE stream of `{ type: 'token'|'done', content: '...' }`

### 11.2 Premium TTS Endpoint

```
POST /api/v1/tts
```

```json
{
  "text": "...",
  "voice": "alloy|echo|fable|onyx|nova|shimmer",
  "speed": 1.0,
  "provider": "openai|azure"
}
```

Response: `audio/mpeg` stream OR `{ audioUrl: 'cdn_cached_url' }` if previously generated

### 11.3 Sync Endpoint (Optional)

```
POST /api/v1/sync
```

```json
{
  "playbackStates": [],
  "chatThreads": [],
  "deviceId": "browser_fingerprint",
  "syncedAt": 1234567890
}
```

Response: `{ merged: { playbackStates, chatThreads }, conflicts: [] }`

---

## 12. Deployment & Release Strategy

### 12.1 Build System

- **Bundler:** Vite with CRXJS plugin (handles MV3 HMR in development, produces correct extension zip for production)
- **Source structure:** `/src/background/`, `/src/content/`, `/src/sidepanel/`, `/src/offscreen/`, `/src/shared/`
- **Browser targets:** separate build configs for `chrome-mv3`, `firefox-mv2`, `edge-mv3`
- **CI:** GitHub Actions — lint → test → build all targets → upload artifacts

### 12.2 Store Submission

| Store | Review Time (est.) | Key Requirements |
|---|---|---|
| Chrome Web Store | 1–3 business days | MV3, privacy policy, permission justification |
| Firefox Add-ons (AMO) | 1–2 weeks | Source code submission required for review |
| Edge Add-ons | 1–5 business days | Uses Chrome package directly — minimal delta |
| Safari Extensions | 1–2 weeks (App Review) | Requires macOS/Xcode build via `safari-web-extension-converter` |

### 12.3 Launch Sequence

1. Internal alpha: Chrome only, 20 testers — validate PDF parsing, audio engine, AI chat
2. Closed beta: Chrome + Edge, 200 users — performance profiling, voice selection UX
3. Chrome Web Store public launch — primary acquisition channel
4. Firefox AMO submission — secondary (developer/researcher audience)
5. Edge + Safari — third wave, after Chrome feedback incorporated

---

*Voxara Browser Extension — PRD v1.0 · Confidential*
