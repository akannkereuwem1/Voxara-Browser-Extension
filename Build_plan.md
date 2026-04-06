# Voxara Browser Extension — Precise Build Plan
**From zero to shipped, across every browser.**

---

## How to Read This Document

Each phase has a clear goal, exact deliverables, and step-by-step tasks in the order they must be done. Dependencies between phases are called out explicitly. Time estimates assume one focused developer working full-time.

**Total estimated time: 14–16 weeks**

---

## Phase Overview

| Phase | Name | Duration | Output |
|---|---|---|---|
| 0 | Foundation & Tooling | Week 1 | Working monorepo, all tooling configured |
| 1 | Extension Shell | Week 2 | Installable extension, all contexts wired |
| 2 | PDF Engine | Weeks 3–4 | PDF detection, parsing, chunking working |
| 3 | Audio Engine | Weeks 5–6 | Full playback with voice + pace controls |
| 4 | AI Chat (Per-Document) | Weeks 7–8 | Per-doc chat working, dual-channel output |
| 5 | AI Chat (Global) | Week 9 | Cross-document chat working |
| 6 | Backend & Auth | Weeks 10–11 | FastAPI backend, Supabase auth, sync |
| 7 | Cross-Browser | Week 12 | Firefox + Edge + Safari working |
| 8 | Polish & Performance | Week 13 | Performance targets hit, UX complete |
| 9 | Testing & QA | Week 14 | All tests written and passing |
| 10 | Deployment & Release | Weeks 15–16 | Live on all browser stores |

---

---

# PHASE 0 — Foundation & Tooling
**Goal:** A clean monorepo where every tool works before a single line of product code is written.
**Duration:** Week 1 (5 days)
**Prerequisite:** Node.js 20+, Python 3.11+, pnpm installed globally.

---

## Day 1 — Monorepo Setup

### Step 1 — Initialise the monorepo

```bash
mkdir Voxara && cd Voxara
git init
pnpm init
```

### Step 2 — Create workspace structure

```
Voxara/
├── packages/
│   └── extension/          # The browser extension
├── apps/
│   └── backend/            # FastAPI backend
├── pnpm-workspace.yaml
├── .gitignore
├── .npmrc
└── README.md
```

Create `pnpm-workspace.yaml`:
```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

Create `.npmrc`:
```
shamefully-hoist=true
```

Create `.gitignore`:
```
node_modules/
dist/
.env
.env.local
__pycache__/
*.pyc
.venv/
```

### Step 3 — Commit baseline

```bash
git add .
git commit -m "chore: monorepo scaffold"
```

---

## Day 2 — Extension Project Setup

### Step 4 — Scaffold the extension package

```bash
cd packages/extension
pnpm create vite . --template react-ts
```

### Step 5 — Install core dependencies

```bash
pnpm add -D @crxjs/vite-plugin vite-plugin-react
pnpm add react react-dom zustand idb compromise
pnpm add -D typescript @types/react @types/react-dom tailwindcss @tailwindcss/vite
pnpm add -D biome vitest @vitest/ui
pnpm add pdfjs-dist
```

### Step 6 — Configure Vite for CRXJS

Create `vite.config.ts`:
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.chrome.json'

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }),
  ],
})
```

### Step 7 — Create the Chrome manifest (mv3)

Create `manifest.chrome.json`:
```json
{
  "manifest_version": 3,
  "name": "Voxara",
  "version": "0.1.0",
  "description": "Audio-first AI PDF reader",
  "permissions": [
    "storage",
    "activeTab",
    "scripting",
    "sidePanel",
    "offscreen",
    "alarms",
    "webNavigation"
  ],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "src/background/index.ts",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["src/content/index.ts"],
      "run_at": "document_start"
    }
  ],
  "side_panel": {
    "default_path": "src/sidepanel/index.html"
  },
  "action": {
    "default_title": "Voxara",
    "default_popup": ""
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

### Step 8 — Configure Biome (linting + formatting)

```bash
pnpm add -D @biomejs/biome
pnpm biome init
```

Update `biome.json`:
```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2
  }
}
```

Add to `package.json` scripts:
```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "lint": "biome check .",
    "format": "biome format . --write",
    "test": "vitest"
  }
}
```

---

## Day 3 — Source Directory Structure

### Step 9 — Create all source folders and entry files

```
packages/extension/src/
├── background/
│   └── index.ts              # Service Worker entry
├── content/
│   └── index.ts              # Content Script entry
├── sidepanel/
│   ├── index.html
│   ├── main.tsx
│   └── App.tsx
├── offscreen/
│   ├── index.html
│   └── index.ts
├── options/
│   ├── index.html
│   ├── main.tsx
│   └── App.tsx
├── shared/
│   ├── types/
│   │   ├── messages.ts       # All message type definitions
│   │   ├── models.ts         # Document, Chunk, PlaybackState etc.
│   │   └── index.ts
│   ├── constants.ts
│   └── utils/
│       ├── uuid.ts
│       └── hash.ts
└── lib/
    ├── compat/
    │   └── index.ts          # Cross-browser abstraction layer
    ├── db/
    │   └── index.ts          # IndexedDB via idb
    └── state/
        └── index.ts          # Zustand store
```

Create all empty entry files with placeholder exports so TypeScript doesn't complain.

### Step 10 — Define the full type system first

Populate `src/shared/types/messages.ts` with every message type the system will ever send:

```typescript
export type MessageType =
  | 'PDF_DETECTED'
  | 'PDF_PARSED'
  | 'PLAY'
  | 'PAUSE'
  | 'RESUME'
  | 'SKIP_FORWARD'
  | 'SKIP_BACK'
  | 'SET_VOICE'
  | 'SET_RATE'
  | 'SET_PITCH'
  | 'SET_VOLUME'
  | 'CHUNK_STARTED'
  | 'CHUNK_ENDED'
  | 'AI_QUERY'
  | 'AI_RESPONSE_TOKEN'
  | 'AI_RESPONSE_DONE'
  | 'STATE_UPDATE'
  | 'OPEN_SIDE_PANEL'

export interface Message<T = unknown> {
  type: MessageType
  payload: T
  requestId: string
}
```

Populate `src/shared/types/models.ts`:

```typescript
export interface VoxaraDocument {
  id: string
  url: string
  fileHash: string
  title: string
  pageCount: number
  chunkCount: number
  language: string
  parseStatus: 'pending' | 'complete' | 'failed'
  createdAt: number
  lastOpenedAt: number
}

export interface Chunk {
  id: string
  documentId: string
  sequenceIndex: number
  text: string
  wordCount: number
  pageStart: number
  pageEnd: number
  headingContext: string
  sectionLabel: string
}

export interface PlaybackState {
  documentId: string
  currentChunkIndex: number
  currentOffsetChars: number
  playbackRate: number
  pitch: number
  volume: number
  voiceId: string
  bookmarks: Bookmark[]
  completionPercent: number
  updatedAt: number
}

export interface Bookmark {
  chunkIndex: number
  label: string
  createdAt: number
}

export type ChatRole = 'user' | 'assistant' | 'system'

export interface ChatMessage {
  role: ChatRole
  content: string
  timestamp: number
  contextChunks?: string[]
}

export interface ChatThread {
  id: string  // documentId or 'global'
  messages: ChatMessage[]
  messageCount: number
  createdAt: number
  updatedAt: number
}

export type AppStatePlaybackStatus =
  | 'IDLE'
  | 'LOADING'
  | 'READY'
  | 'PLAYING'
  | 'PAUSED'
  | 'AI_RESPONDING'
  | 'ENDED'
  | 'ERROR'

export interface AppState {
  activeDocument: VoxaraDocument | null
  playback: PlaybackState | null
  playbackStatus: AppStatePlaybackStatus
  chat: {
    activeMode: 'document' | 'global'
    isStreaming: boolean
    pendingQuery: string | null
  }
}
```

---

## Day 4 — Database & State Layer

### Step 11 — Set up IndexedDB schema

Populate `src/lib/db/index.ts`:

```typescript
import { openDB, DBSchema, IDBPDatabase } from 'idb'
import type { VoxaraDocument, Chunk, PlaybackState, ChatThread } from '../../shared/types/models'

interface VoxaraDB extends DBSchema {
  documents: {
    key: string
    value: VoxaraDocument
    indexes: { 'by-lastOpenedAt': number }
  }
  chunks: {
    key: string
    value: Chunk
    indexes: {
      'by-documentId': string
      'by-documentId-sequence': [string, number]
    }
  }
  playbackStates: {
    key: string
    value: PlaybackState
  }
  chatThreads: {
    key: string
    value: ChatThread
    indexes: { 'by-updatedAt': number }
  }
}

let db: IDBPDatabase<VoxaraDB>

export async function getDB() {
  if (db) return db
  db = await openDB<VoxaraDB>('Voxara', 1, {
    upgrade(db) {
      const docs = db.createObjectStore('documents', { keyPath: 'id' })
      docs.createIndex('by-lastOpenedAt', 'lastOpenedAt')

      const chunks = db.createObjectStore('chunks', { keyPath: 'id' })
      chunks.createIndex('by-documentId', 'documentId')
      chunks.createIndex('by-documentId-sequence', ['documentId', 'sequenceIndex'])

      db.createObjectStore('playbackStates', { keyPath: 'documentId' })

      const threads = db.createObjectStore('chatThreads', { keyPath: 'id' })
      threads.createIndex('by-updatedAt', 'updatedAt')
    },
  })
  return db
}
```

### Step 12 — Set up Zustand store

Populate `src/lib/state/index.ts`:

```typescript
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { AppState } from '../../shared/types/models'

interface VoxaraStore extends AppState {
  setActiveDocument: (doc: AppState['activeDocument']) => void
  setPlaybackStatus: (status: AppState['playbackStatus']) => void
  updatePlayback: (patch: Partial<AppState['playback']>) => void
  setChatMode: (mode: 'document' | 'global') => void
  setChatStreaming: (streaming: boolean) => void
  applyStateUpdate: (state: Partial<AppState>) => void
}

export const useStore = create<VoxaraStore>()(
  subscribeWithSelector((set) => ({
    activeDocument: null,
    playback: null,
    playbackStatus: 'IDLE',
    chat: { activeMode: 'document', isStreaming: false, pendingQuery: null },

    setActiveDocument: (doc) => set({ activeDocument: doc }),
    setPlaybackStatus: (status) => set({ playbackStatus: status }),
    updatePlayback: (patch) =>
      set((s) => ({ playback: s.playback ? { ...s.playback, ...patch } : null })),
    setChatMode: (mode) =>
      set((s) => ({ chat: { ...s.chat, activeMode: mode } })),
    setChatStreaming: (streaming) =>
      set((s) => ({ chat: { ...s.chat, isStreaming: streaming } })),
    applyStateUpdate: (patch) => set(patch),
  }))
)
```

---

## Day 5 — CI/CD Pipeline

### Step 13 — GitHub Actions workflow

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main, dev]
  pull_request:
    branches: [main]

jobs:
  extension:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter extension lint
      - run: pnpm --filter extension test --run
      - run: pnpm --filter extension build

  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - run: pip install -r apps/backend/requirements.txt
      - run: cd apps/backend && pytest
```

### Step 14 — Verify everything runs

```bash
# From monorepo root
pnpm install
pnpm --filter extension dev
# Load unpacked extension in Chrome from packages/extension/dist/
# Confirm extension icon appears in toolbar with no errors in background service worker console
```

**Phase 0 complete ✓** — Working monorepo, all tooling configured, TypeScript, Biome, Vitest, CI all green.

---

---

# PHASE 1 — Extension Shell
**Goal:** A fully wired extension where all five runtime contexts exist and can communicate with each other.
**Duration:** Week 2 (5 days)

---

## Day 6 — Cross-Browser Compatibility Layer

### Step 15 — Build the compat module

Populate `src/lib/compat/index.ts`:

```typescript
// Unified API surface regardless of browser
const isFirefox = navigator.userAgent.includes('Firefox')
const isChrome = !!chrome

export const compat = {
  storage: {
    sync: {
      get: (key: string) => chrome.storage.sync.get(key),
      set: (data: object) => chrome.storage.sync.set(data),
    },
    local: {
      get: (key: string) => chrome.storage.local.get(key),
      set: (data: object) => chrome.storage.local.set(data),
    },
  },
  runtime: {
    sendMessage: (msg: object) => chrome.runtime.sendMessage(msg),
    onMessage: chrome.runtime.onMessage,
  },
  tabs: {
    query: (opts: chrome.tabs.QueryInfo) => chrome.tabs.query(opts),
    sendMessage: (tabId: number, msg: object) =>
      chrome.tabs.sendMessage(tabId, msg),
  },
}
```

---

## Day 7 — Service Worker (Background)

### Step 16 — Implement the Service Worker

Populate `src/background/index.ts` with:

- PDF detection via `chrome.webNavigation.onCommitted`
- Message router that dispatches to the correct handler
- `AppState` holder (in-memory, hydrated from IndexedDB on startup)
- State broadcaster that sends `STATE_UPDATE` to all ports on every change

```typescript
import { getDB } from '../lib/db'
import type { Message } from '../shared/types/messages'

// Hydrate state from IndexedDB on service worker start
self.addEventListener('activate', async () => {
  const db = await getDB()
  // Load last active document + playback state
})

// PDF detection
chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.url.toLowerCase().endsWith('.pdf')) {
    await chrome.scripting.executeScript({
      target: { tabId: details.tabId },
      files: ['src/content/index.js'],
    })
    chrome.sidePanel.open({ tabId: details.tabId })
  }
})

// Message router
chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse)
  return true  // keep channel open for async response
})

async function handleMessage(message: Message, sender: chrome.runtime.MessageSender) {
  switch (message.type) {
    case 'PDF_DETECTED':
      return handlePdfDetected(message.payload, sender.tab?.id)
    case 'AI_QUERY':
      return handleAiQuery(message.payload)
    // ... other cases
  }
}
```

---

## Day 8 — Content Script

### Step 17 — Implement PDF detection in Content Script

Populate `src/content/index.ts`:

```typescript
// Level 1: URL-based detection (backup, Service Worker handles primary)
if (document.contentType === 'application/pdf' ||
    window.location.href.toLowerCase().endsWith('.pdf')) {
  notifyPdfDetected(window.location.href)
}

// Level 2: Embedded PDF detection
const observer = new MutationObserver(() => {
  const embeds = document.querySelectorAll('embed[type="application/pdf"], iframe')
  embeds.forEach((el) => {
    const src = (el as HTMLEmbedElement).src
    if (src && !processedUrls.has(src)) {
      processedUrls.add(src)
      notifyPdfDetected(src)
    }
  })
})

observer.observe(document.body, { childList: true, subtree: true })

function notifyPdfDetected(url: string) {
  chrome.runtime.sendMessage({
    type: 'PDF_DETECTED',
    payload: { url, tabId: undefined },
    requestId: crypto.randomUUID(),
  })
}
```

---

## Day 9 — Side Panel UI Shell

### Step 18 — Build the Side Panel React app shell

Create the three tabs that will exist in the Side Panel:

```
src/sidepanel/
├── index.html
├── main.tsx
├── App.tsx
└── components/
    ├── tabs/
    │   ├── PlayerTab.tsx      # Playback controls
    │   ├── ChatTab.tsx        # AI chat interface
    │   └── LibraryTab.tsx     # Document list
    ├── TabBar.tsx
    └── StatusBar.tsx          # "Chapter 3 · Page 12 · 23%"
```

`App.tsx` at this stage is just the tab shell — no real functionality yet:

```tsx
import { useState } from 'react'
import TabBar from './components/TabBar'
import PlayerTab from './components/tabs/PlayerTab'
import ChatTab from './components/tabs/ChatTab'
import LibraryTab from './components/tabs/LibraryTab'

type Tab = 'player' | 'chat' | 'library'

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('player')

  return (
    <div className="flex flex-col h-screen bg-white text-slate-900">
      <TabBar active={activeTab} onChange={setActiveTab} />
      {activeTab === 'player' && <PlayerTab />}
      {activeTab === 'chat' && <ChatTab />}
      {activeTab === 'library' && <LibraryTab />}
    </div>
  )
}
```

---

## Day 10 — Offscreen Document

### Step 19 — Implement Offscreen Document

The Offscreen Document is the audio host. Create `src/offscreen/index.ts`:

```typescript
// Create offscreen document from Service Worker (call once)
async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  })
  if (existingContexts.length > 0) return

  await chrome.offscreen.createDocument({
    url: 'src/offscreen/index.html',
    reasons: ['AUDIO_PLAYBACK'],
    justification: 'Speak document text via Web Speech API',
  })
}

// In offscreen/index.ts — listen for speech commands
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SPEAK_CHUNK') {
    speakChunk(message.payload.text, message.payload.voice, message.payload.rate)
  }
  if (message.type === 'STOP_SPEECH') {
    window.speechSynthesis.cancel()
  }
})

function speakChunk(text: string, voiceId: string, rate: number) {
  const utterance = new SpeechSynthesisUtterance(text)
  const voices = window.speechSynthesis.getVoices()
  utterance.voice = voices.find(v => v.voiceURI === voiceId) ?? null
  utterance.rate = rate

  utterance.onstart = () =>
    chrome.runtime.sendMessage({ type: 'CHUNK_STARTED' })
  utterance.onend = () =>
    chrome.runtime.sendMessage({ type: 'CHUNK_ENDED' })

  window.speechSynthesis.speak(utterance)
}
```

### Step 20 — Verify full message round-trip

Write a Vitest test that mocks all browser APIs and verifies:
- Content script sends `PDF_DETECTED`
- Service Worker routes correctly
- Side Panel receives `STATE_UPDATE`

**Phase 1 complete ✓** — All five runtime contexts live, message passing works, no browser console errors.

---

---

# PHASE 2 — PDF Engine
**Goal:** Any PDF the user opens is detected, parsed, chunked, and stored in IndexedDB.
**Duration:** Weeks 3–4 (10 days)

---

## Day 11-12 — PDF.js Integration

### Step 21 — Load PDF.js in Content Script

PDF.js needs a worker. Bundle the worker with Vite:

```typescript
// src/content/pdf/loader.ts
import * as pdfjsLib from 'pdfjs-dist'
import PDFWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = PDFWorker

export async function loadPdf(url: string) {
  const response = await fetch(url)
  const arrayBuffer = await response.arrayBuffer()
  return pdfjsLib.getDocument({ data: arrayBuffer }).promise
}
```

### Step 22 — Text extraction with reading order

```typescript
// src/content/pdf/extractor.ts
import type { PDFDocumentProxy } from 'pdfjs-dist'

export interface PageText {
  pageNumber: number
  text: string
  headings: string[]
}

export async function extractText(pdf: PDFDocumentProxy): Promise<PageText[]> {
  const pages: PageText[] = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()

    // Sort items by vertical position (y desc), then horizontal (x asc)
    const sorted = content.items
      .filter((item): item is typeof item & { str: string } => 'str' in item)
      .sort((a, b) => {
        const yDiff = b.transform[5] - a.transform[5]
        return Math.abs(yDiff) > 2 ? yDiff : a.transform[4] - b.transform[4]
      })

    // Detect headings by font size
    const fontSizes = sorted.map(item => item.transform[3])
    const avgSize = fontSizes.reduce((a, b) => a + b, 0) / fontSizes.length
    const headings = sorted
      .filter(item => item.transform[3] > avgSize * 1.2 && item.str.trim().length > 3)
      .map(item => item.str.trim())

    pages.push({
      pageNumber: i,
      text: sorted.map(item => item.str).join(' ').replace(/\s+/g, ' ').trim(),
      headings,
    })
  }

  return pages
}
```

---

## Day 13-14 — Chunking Algorithm

### Step 23 — Implement sentence-boundary chunking

```typescript
// src/content/pdf/chunker.ts
import type { PageText } from './extractor'
import type { Chunk } from '../../shared/types/models'

const TARGET_WORDS_MIN = 120
const TARGET_WORDS_MAX = 180

export function chunkPages(pages: PageText[], documentId: string): Chunk[] {
  const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' })
  const chunks: Chunk[] = []

  let buffer = ''
  let bufferWordCount = 0
  let bufferPageStart = 1
  let currentHeading = ''
  let sequenceIndex = 0

  const flushBuffer = (pageEnd: number) => {
    if (!buffer.trim()) return
    chunks.push({
      id: crypto.randomUUID(),
      documentId,
      sequenceIndex: sequenceIndex++,
      text: buffer.trim(),
      wordCount: bufferWordCount,
      pageStart: bufferPageStart,
      pageEnd,
      headingContext: currentHeading,
      sectionLabel: currentHeading || `Page ${bufferPageStart}`,
    })
    buffer = ''
    bufferWordCount = 0
    bufferPageStart = pageEnd
  }

  for (const page of pages) {
    if (page.headings.length > 0) currentHeading = page.headings[0]
    const sentences = [...segmenter.segment(page.text)].map(s => s.segment)

    for (const sentence of sentences) {
      const words = sentence.trim().split(/\s+/).length
      if (bufferWordCount + words > TARGET_WORDS_MAX && bufferWordCount >= TARGET_WORDS_MIN) {
        flushBuffer(page.pageNumber)
      }
      buffer += (buffer ? ' ' : '') + sentence.trim()
      bufferWordCount += words
    }
  }

  flushBuffer(pages[pages.length - 1].pageNumber)
  return chunks
}
```

### Step 24 — Write unit tests for chunking

```typescript
// src/content/pdf/chunker.test.ts
import { describe, it, expect } from 'vitest'
import { chunkPages } from './chunker'

describe('chunkPages', () => {
  it('never produces chunks below 120 words except the last', () => { ... })
  it('never breaks mid-sentence', () => { ... })
  it('preserves heading context across chunks', () => { ... })
  it('assigns sequential indexes starting at 0', () => { ... })
})
```

---

## Day 15-16 — Storage & Deduplication

### Step 25 — Store parsed document and chunks to IndexedDB

```typescript
// src/lib/db/documents.ts
import { getDB } from '.'
import type { VoxaraDocument, Chunk } from '../../shared/types/models'

export async function saveDocument(doc: VoxaraDocument): Promise<void> {
  const db = await getDB()
  await db.put('documents', doc)
}

export async function saveChunks(chunks: Chunk[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('chunks', 'readwrite')
  await Promise.all([
    ...chunks.map(chunk => tx.store.put(chunk)),
    tx.done,
  ])
}

export async function getChunksByDocument(documentId: string): Promise<Chunk[]> {
  const db = await getDB()
  return db.getAllFromIndex('chunks', 'by-documentId', documentId)
}

export async function getChunkRange(
  documentId: string,
  from: number,
  to: number
): Promise<Chunk[]> {
  const db = await getDB()
  const range = IDBKeyRange.bound([documentId, from], [documentId, to])
  return db.getAllFromIndex('chunks', 'by-documentId-sequence', range)
}
```

### Step 26 — Deduplication by file hash

```typescript
// src/shared/utils/hash.ts
export async function hashArrayBuffer(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}
```

Before parsing: check if a document with the same `fileHash` already exists in IndexedDB. If yes, skip parsing and load existing chunks directly. This prevents re-processing the same PDF opened from a different URL (e.g. a cached university portal URL).

---

## Day 17-18 — Library UI

### Step 27 — Build the Library tab

`LibraryTab.tsx` reads from IndexedDB and renders:
- Document card: title, page count, chunk count, completion % ring, last opened date
- Delete button with confirmation
- Tap to open: sends `LOAD_DOCUMENT` message to Service Worker

### Step 28 — Progress indicator during parsing

When a PDF is being parsed, the Side Panel should show:
- "Preparing your document..." with a progress bar
- Progress is updated by content script sending `PARSE_PROGRESS` messages (one per 10 pages)

**Phase 2 complete ✓** — PDFs detected, parsed, chunked, stored, deduplicated. Library shows all documents.

---

---

# PHASE 3 — Audio Engine
**Goal:** Full audio playback with voice selection, pace control, and all playback controls working.
**Duration:** Weeks 5–6 (10 days)

---

## Day 19-20 — Voice System

### Step 29 — Voice enumeration and selection

```typescript
// src/lib/audio/voices.ts
export interface VoiceOption {
  id: string        // SpeechSynthesisVoice.voiceURI
  name: string
  language: string
  isPremium: boolean
  preview: string   // Short sample text for preview
}

export function getAvailableVoices(): VoiceOption[] {
  // Note: getVoices() is async in some browsers — must wait for voiceschanged event
  return window.speechSynthesis.getVoices()
    .filter(v => v.lang.startsWith('en'))  // English first; expand later
    .map(v => ({
      id: v.voiceURI,
      name: v.name,
      language: v.lang,
      isPremium: false,
      preview: 'Hello, this is how I sound when reading your documents.',
    }))
}

export function previewVoice(voiceId: string, rate: number) {
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(
    'Hello, this is how I sound when reading your documents.'
  )
  const voice = window.speechSynthesis.getVoices().find(v => v.voiceURI === voiceId)
  if (voice) utterance.voice = voice
  utterance.rate = rate
  window.speechSynthesis.speak(utterance)
}
```

### Step 30 — Voice selector UI

Build a voice picker component with:
- Scrollable list of available voices with language flag emoji
- Preview button (plays 5-second sample)
- Premium badge placeholder (greyed out for now)
- Selection persists to `chrome.storage.sync`

---

## Day 21-22 — Chunk Queue & Buffer

### Step 31 — Audio buffer manager

```typescript
// src/lib/audio/buffer.ts
// Runs in the Offscreen Document

interface QueuedChunk {
  chunkIndex: number
  text: string
  utterance: SpeechSynthesisUtterance
}

const LOOKAHEAD = 3
const queue: QueuedChunk[] = []
let currentIndex = 0
let isPlaying = false

export async function loadAndPlay(chunks: Chunk[], startIndex: number, voice: VoiceOption, rate: number) {
  window.speechSynthesis.cancel()
  queue.length = 0
  currentIndex = startIndex

  // Pre-build utterances for next LOOKAHEAD chunks
  for (let i = startIndex; i < Math.min(startIndex + LOOKAHEAD, chunks.length); i++) {
    enqueueChunk(chunks[i], voice, rate)
  }

  playNext(chunks, voice, rate)
}

function enqueueChunk(chunk: Chunk, voice: VoiceOption, rate: number) {
  const utterance = buildUtterance(chunk.text, voice, rate)
  queue.push({ chunkIndex: chunk.sequenceIndex, text: chunk.text, utterance })
}

function playNext(chunks: Chunk[], voice: VoiceOption, rate: number) {
  if (queue.length === 0) {
    chrome.runtime.sendMessage({ type: 'PLAYBACK_ENDED' })
    return
  }

  const item = queue.shift()!
  chrome.runtime.sendMessage({ type: 'CHUNK_STARTED', payload: { chunkIndex: item.chunkIndex } })

  item.utterance.onend = () => {
    chrome.runtime.sendMessage({ type: 'CHUNK_ENDED', payload: { chunkIndex: item.chunkIndex } })
    currentIndex++

    // Refill lookahead
    const nextToBuffer = currentIndex + LOOKAHEAD - 1
    if (nextToBuffer < chunks.length) {
      enqueueChunk(chunks[nextToBuffer], voice, rate)
    }

    playNext(chunks, voice, rate)
  }

  window.speechSynthesis.speak(item.utterance)
  isPlaying = true
}
```

---

## Day 23-24 — Playback Controls

### Step 32 — Player UI

Build `PlayerTab.tsx` with these controls:

```
┌─────────────────────────────────────┐
│  Chapter 3 · Page 12 · 23%          │ ← StatusBar
├─────────────────────────────────────┤
│  [═══════════●──────────────────]   │ ← Progress scrubber (snaps to chunks)
├─────────────────────────────────────┤
│    ⏮   ⏪10s  ⏸  ⏩10s   ⏭        │ ← Playback controls
├─────────────────────────────────────┤
│  Speed: [0.75x] [1x] [1.25x] [1.5x] [2x]  │
├─────────────────────────────────────┤
│  Voice: [Aria ▾]  [Preview]         │
├─────────────────────────────────────┤
│  Volume: [══════●────]              │
│  Pitch:  [══════●────]              │
└─────────────────────────────────────┘
```

### Step 33 — Skip logic

Skip ±10 seconds maps to chunk boundaries:
- Calculate words-per-second at current rate (avg ~2.5 words/sec at 1x)
- 10 seconds at 1x ≈ 25 words
- Find chunk boundary closest to current position + 25 words
- Jump to that chunk index

### Step 34 — Playback state persistence

On every meaningful event (chunk change, pause, rate change, voice change), save `PlaybackState` to IndexedDB immediately. On document load, restore from IndexedDB and resume from saved position.

---

## Day 25-26 — Integration & Testing

### Step 35 — End-to-end audio test

Open a real PDF in Chrome with the extension loaded. Verify:
- [ ] Audio begins within 800ms of pressing play
- [ ] Chunk transitions are seamless (no gap > 100ms)
- [ ] Speed change takes effect on next chunk
- [ ] Pause saves position; resume continues correctly
- [ ] Progress bar moves smoothly
- [ ] Skip forward/back lands on correct chunk
- [ ] Voice change takes effect on next chunk

### Step 36 — Storage limit guardrails

Implement `StorageMonitor`:
- Check `navigator.storage.estimate()` before each parse
- If less than 100MB available: warn user and offer to clear old documents
- If less than 50MB: block parsing with clear error message

**Phase 3 complete ✓** — Full audio playback working. Voice selection, pace control, all controls functional.

---

---

# PHASE 4 — AI Chat (Per-Document)
**Goal:** User can ask questions about the active document during playback. Answers appear as text and are read aloud simultaneously.
**Duration:** Weeks 7–8 (10 days)

---

## Day 27-28 — Context Assembly

### Step 37 — Context builder

```typescript
// src/lib/ai/context.ts
import { getChunkRange, getDB } from '../db'
import type { Chunk } from '../../shared/types/models'

const LOCAL_WINDOW = 3      // chunks before and after current
const KEYWORD_RESULTS = 3   // top matching chunks from full-text search

export async function buildDocumentContext(
  documentId: string,
  currentChunkIndex: number,
  query: string
): Promise<{ chunks: Chunk[]; metadata: string }> {
  // 1. Local window: chunks around current position
  const from = Math.max(0, currentChunkIndex - LOCAL_WINDOW)
  const to = currentChunkIndex + LOCAL_WINDOW
  const localChunks = await getChunkRange(documentId, from, to)

  // 2. Keyword search across full document using compromise.js
  const keywords = extractKeywords(query)
  const allChunks = await getChunksByDocument(documentId)
  const keywordChunks = searchChunks(allChunks, keywords, KEYWORD_RESULTS)

  // 3. Merge and deduplicate by id, sort by sequenceIndex
  const seen = new Set<string>()
  const merged = [...localChunks, ...keywordChunks]
    .filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true })
    .sort((a, b) => a.sequenceIndex - b.sequenceIndex)
    .slice(0, 10)  // hard cap

  const metadata = `Document: ${documentId}\nCurrent section: ${localChunks.find(c => c.sequenceIndex === currentChunkIndex)?.sectionLabel ?? 'Unknown'}`

  return { chunks: merged, metadata }
}

function extractKeywords(query: string): string[] {
  // compromise.js noun extraction
  const nlp = require('compromise')
  const doc = nlp(query)
  return doc.nouns().out('array')
}

function searchChunks(chunks: Chunk[], keywords: string[], limit: number): Chunk[] {
  return chunks
    .map(chunk => ({
      chunk,
      score: keywords.filter(kw => chunk.text.toLowerCase().includes(kw.toLowerCase())).length,
    }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(r => r.chunk)
}
```

---

## Day 29-30 — AI API Integration

### Step 38 — AI service (Option A: direct to OpenAI)

```typescript
// src/lib/ai/service.ts
import type { ChatMessage, Chunk } from '../../shared/types/models'

const SYSTEM_PROMPT = `You are Voxara, an AI reading assistant. The user is currently listening to a document. Your job is to help them understand it.

Rules:
- Answer using ONLY the provided document context. Never invent information.
- Write in flowing prose — no bullet points, no markdown headers. Your answer will be read aloud.
- Be concise. Aim for 2–4 sentences unless a longer answer is genuinely needed.
- If the answer is not in the context, say: "That doesn't appear to be covered in the section you're listening to."
- Address the user directly and conversationally.`

export async function* streamAnswer(
  query: string,
  contextChunks: Chunk[],
  history: ChatMessage[],
  apiKey: string
): AsyncGenerator<string> {
  const contextText = contextChunks
    .map(c => `[${c.sectionLabel}]\n${c.text}`)
    .join('\n\n')

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.slice(-8).map(m => ({ role: m.role, content: m.content })),
    {
      role: 'user',
      content: `[DOCUMENT CONTEXT]\n${contextText}\n\n[QUESTION]\n${query}`,
    },
  ]

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages,
      max_tokens: 300,
      stream: true,
    }),
  })

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const lines = decoder.decode(value).split('\n').filter(l => l.startsWith('data: '))
    for (const line of lines) {
      const data = line.slice(6)
      if (data === '[DONE]') return
      const token = JSON.parse(data).choices[0]?.delta?.content
      if (token) yield token
    }
  }
}
```

---

## Day 31-32 — Dual-Channel Response Delivery

### Step 39 — Text streaming in Side Panel

```tsx
// src/sidepanel/components/tabs/ChatTab.tsx
// As tokens stream in from Service Worker STATE_UPDATE messages,
// append them to the current assistant message bubble.

const [streamingMessage, setStreamingMessage] = useState('')

useEffect(() => {
  const unsubscribe = useStore.subscribe(
    state => state.chat.isStreaming,
    (isStreaming) => {
      if (!isStreaming) setStreamingMessage('')
    }
  )
  return unsubscribe
}, [])

// Listen for AI_RESPONSE_TOKEN messages
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'AI_RESPONSE_TOKEN') {
    setStreamingMessage(prev => prev + msg.payload.token)
  }
})
```

### Step 40 — Voice channel: sentence-boundary dispatch

```typescript
// In Service Worker — AI response handler
let sentenceBuffer = ''
const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' })

for await (const token of streamAnswer(query, chunks, history, apiKey)) {
  // Send token to Side Panel (text channel)
  chrome.runtime.sendMessage({ type: 'AI_RESPONSE_TOKEN', payload: { token } })

  sentenceBuffer += token

  // Check if buffer contains a complete sentence
  const segments = [...segmenter.segment(sentenceBuffer)]
  if (segments.length > 1) {
    const completeSentence = segments[0].segment
    sentenceBuffer = sentenceBuffer.slice(completeSentence.length)

    // Send to Offscreen Document for immediate speech
    chrome.runtime.sendMessage({
      type: 'SPEAK_AI_SENTENCE',
      payload: { text: completeSentence }
    })
  }
}

// Flush remaining buffer
if (sentenceBuffer.trim()) {
  chrome.runtime.sendMessage({ type: 'SPEAK_AI_SENTENCE', payload: { text: sentenceBuffer } })
}

chrome.runtime.sendMessage({ type: 'AI_RESPONSE_DONE' })
```

---

## Day 33-34 — Chat History & Storage

### Step 41 — Persist chat history to IndexedDB

```typescript
// src/lib/db/chat.ts
export async function appendMessage(threadId: string, message: ChatMessage): Promise<void> {
  const db = await getDB()
  const thread = await db.get('chatThreads', threadId)
  if (thread) {
    thread.messages.push(message)
    thread.messageCount++
    thread.updatedAt = Date.now()
    await db.put('chatThreads', thread)
  } else {
    await db.put('chatThreads', {
      id: threadId,
      messages: [message],
      messageCount: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  }
}
```

### Step 42 — Chat UI completion

Full chat UI in `ChatTab.tsx`:
- Message bubbles (user right, assistant left)
- Streaming assistant bubble shows cursor while generating
- Input bar at bottom: text input + mic icon
- Mute toggle: silences voice channel without stopping text stream
- Mode toggle at top: "This document ↔ All documents"
- Auto-scroll to bottom on new message

**Phase 4 complete ✓** — Per-document AI chat working. Text streams in. Voice reads answers aloud simultaneously.

---

---

# PHASE 5 — AI Chat (Global)
**Goal:** Cross-document chat that searches across all stored documents.
**Duration:** Week 9 (5 days)

---

## Day 35-36 — Global Context Assembly

### Step 43 — Cross-document search

```typescript
// src/lib/ai/globalContext.ts
export async function buildGlobalContext(query: string): Promise<{
  chunks: (Chunk & { documentTitle: string })[]
  sources: string[]
}> {
  const db = await getDB()
  const keywords = extractKeywords(query)

  // Get all documents
  const documents = await db.getAll('documents')

  const results: (Chunk & { documentTitle: string })[] = []

  // Search each document's chunks
  for (const doc of documents) {
    const chunks = await getChunksByDocument(doc.id)
    const matches = searchChunks(chunks, keywords, 2)  // top 2 per doc
    results.push(...matches.map(c => ({ ...c, documentTitle: doc.title })))
  }

  // Rank by score + recency of document
  const ranked = results
    .sort((a, b) => b.sequenceIndex - a.sequenceIndex)  // placeholder; score properly in prod
    .slice(0, 6)

  const sources = [...new Set(ranked.map(c => c.documentTitle))]
  return { chunks: ranked, sources }
}
```

### Step 44 — Global system prompt

```typescript
const GLOBAL_SYSTEM_PROMPT = `You are Voxara, a personal AI research assistant with access to the user's document library.

Rules:
- You may synthesise information across multiple documents.
- Always cite your sources inline like this: (From: filename, Page N).
- Write in flowing prose suitable for being read aloud. No markdown formatting.
- If you cannot find relevant information, say so honestly.
- Maintain conversational continuity — reference earlier messages naturally.`
```

---

## Day 37-38 — Global Chat UI

### Step 45 — Mode switching in ChatTab

The mode toggle at the top of ChatTab switches between per-document and global threads:
- **Per-document:** Header shows "Talking about: [document title]". Disabled when no document is active.
- **Global:** Header shows "Your Document Library". Always available.

Both modes use the same chat UI — only the context assembly and system prompt differ. The Service Worker routes based on `chatMode` in app state.

### Step 46 — Source attribution in responses

For global chat, parse source citations from AI responses and render them as tappable chips below the message bubble:

```
[From: Research Methods.pdf, Page 12]  [From: Thesis Draft.pdf, Page 45]
```

Tapping a source chip sends `LOAD_DOCUMENT` to the Service Worker and jumps to that page.

---

## Day 39 — Chat Search & Export

### Step 47 — Search past messages

Add a search bar to ChatTab that queries IndexedDB full-text on both thread types. Results show message snippet + document context + timestamp.

### Step 48 — Export chat history

Options page feature: export any thread as:
- Markdown file (plain text, formatted)
- Copy to clipboard

**Phase 5 complete ✓** — Both chat modes fully working. Global search finds content across all documents. Sources are tappable.

---

---

# PHASE 6 — Backend & Auth
**Goal:** Optional FastAPI backend live. Users can create accounts, sync progress, and access premium TTS.
**Duration:** Weeks 10–11 (10 days)

---

## Day 40-41 — FastAPI Project Setup

### Step 49 — Backend scaffold

```
apps/backend/
├── main.py
├── requirements.txt
├── routers/
│   ├── auth.py
│   ├── chat.py
│   ├── tts.py
│   └── sync.py
├── services/
│   ├── ai_service.py
│   ├── tts_service.py
│   └── cache_service.py
├── models/
│   └── schemas.py
├── db/
│   └── database.py
└── Dockerfile
```

`requirements.txt`:
```
fastapi==0.115.0
uvicorn[standard]==0.30.0
supabase==2.7.0
openai==1.40.0
redis==5.0.8
python-jose==3.3.0
httpx==0.27.0
python-dotenv==1.0.0
pytest==8.3.0
pytest-asyncio==0.23.0
```

### Step 50 — Supabase connection

```python
# db/database.py
from supabase import create_client, Client
import os

supabase: Client = create_client(
    os.environ['SUPABASE_URL'],
    os.environ['SUPABASE_SERVICE_KEY']
)
```

---

## Day 42-43 — Auth Endpoints

### Step 51 — Auth router

```python
# routers/auth.py
from fastapi import APIRouter, HTTPException
from db.database import supabase

router = APIRouter(prefix='/auth', tags=['auth'])

@router.post('/register')
async def register(email: str, password: str):
    response = supabase.auth.sign_up({'email': email, 'password': password})
    if response.user is None:
        raise HTTPException(400, 'Registration failed')
    return {'user_id': response.user.id}

@router.post('/token')
async def login(email: str, password: str):
    response = supabase.auth.sign_in_with_password({'email': email, 'password': password})
    return {'access_token': response.session.access_token}
```

### Step 52 — JWT middleware

```python
# middleware/auth.py
from fastapi import Depends, HTTPException, Header
from jose import jwt, JWTError
import os

async def get_current_user(authorization: str = Header(...)):
    try:
        token = authorization.replace('Bearer ', '')
        payload = jwt.decode(token, os.environ['SUPABASE_JWT_SECRET'], algorithms=['HS256'])
        return payload['sub']  # user_id
    except JWTError:
        raise HTTPException(401, 'Invalid token')
```

---

## Day 44-45 — Chat & TTS Endpoints

### Step 53 — Streaming chat endpoint

```python
# routers/chat.py
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from openai import AsyncOpenAI
from middleware.auth import get_current_user
import json

router = APIRouter(prefix='/api/v1', tags=['chat'])
client = AsyncOpenAI()

@router.post('/chat')
async def chat(body: ChatRequest, user_id: str = Depends(get_current_user)):
    async def generate():
        stream = await client.chat.completions.create(
            model=body.model or 'gpt-4o-mini',
            messages=body.messages,
            max_tokens=300,
            stream=True,
        )
        async for chunk in stream:
            token = chunk.choices[0].delta.content or ''
            if token:
                yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"
        yield "data: {\"type\": \"done\"}\n\n"

    return StreamingResponse(generate(), media_type='text/event-stream')
```

### Step 54 — Premium TTS endpoint with caching

```python
# routers/tts.py
@router.post('/tts')
async def synthesize(body: TtsRequest, user_id: str = Depends(get_current_user)):
    cache_key = f"tts:{hashlib.sha256(f'{body.text}{body.voice}{body.speed}'.encode()).hexdigest()}"

    # Check Redis cache
    cached_url = await redis_client.get(cache_key)
    if cached_url:
        return {'audioUrl': cached_url}

    # Generate via OpenAI TTS
    response = await openai_client.audio.speech.create(
        model='tts-1',
        voice=body.voice,
        input=body.text,
        speed=body.speed,
    )

    # Upload to Cloudflare R2
    audio_bytes = response.content
    r2_key = f"tts/{cache_key}.mp3"
    await upload_to_r2(r2_key, audio_bytes)
    cdn_url = f"https://cdn.Voxara.app/{r2_key}"

    # Cache URL in Redis for 30 days
    await redis_client.setex(cache_key, 60 * 60 * 24 * 30, cdn_url)

    return {'audioUrl': cdn_url}
```

---

## Day 46-47 — Sync Endpoint & Extension Integration

### Step 55 — Sync endpoint

```python
# routers/sync.py
@router.post('/sync')
async def sync(body: SyncRequest, user_id: str = Depends(get_current_user)):
    # Merge playback states: max completionPercent wins
    merged_states = merge_playback_states(body.playbackStates, user_id)
    # Merge chat threads: union of messages, dedup by timestamp
    merged_threads = merge_chat_threads(body.chatThreads, user_id)
    return {'merged': {'playbackStates': merged_states, 'chatThreads': merged_threads}}
```

### Step 56 — Connect extension to backend

Add to Options page:
- Login / Register form
- API key input (for users who prefer direct OpenAI)
- Toggle: "Use Voxara backend" vs "Use my own API key"

**Phase 6 complete ✓** — Backend live on Railway. Auth working. Premium TTS caches to R2. Sync endpoint merging states correctly.

---

---

# PHASE 7 — Cross-Browser Support
**Goal:** Extension works correctly on Firefox, Edge, and Safari.
**Duration:** Week 12 (5 days)

---

## Day 48 — Firefox (MV2)

### Step 57 — Firefox manifest

Create `manifest.firefox.json` (MV2):
```json
{
  "manifest_version": 2,
  "name": "Voxara",
  "version": "0.1.0",
  "permissions": ["storage", "activeTab", "tabs", "webNavigation", "<all_urls>"],
  "background": { "scripts": ["src/background/index.js"], "persistent": false },
  "content_scripts": [{ "matches": ["<all_urls>"], "js": ["src/content/index.js"] }],
  "sidebar_action": {
    "default_panel": "src/sidepanel/index.html",
    "default_title": "Voxara"
  }
}
```

### Step 58 — Firefox-specific divergences

- Replace `chrome.sidePanel` with `browser.sidebarAction`
- Replace `chrome.offscreen` with a hidden `<iframe>` injected by the background page
- Replace Service Worker with `background.js` (no module support in MV2 bg scripts — bundle with Vite)

Add a Firefox build config to `vite.config.ts`:
```typescript
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    crx({ manifest: mode === 'firefox' ? manifestFirefox : manifestChrome }),
  ],
}))
```

Add to `package.json`:
```json
{
  "scripts": {
    "build:chrome": "vite build",
    "build:firefox": "vite build --mode firefox",
    "build:edge": "vite build"  // Same as Chrome
  }
}
```

---

## Day 49 — Edge

### Step 59 — Edge build

Edge uses the Chrome MV3 package with zero changes. Create an Edge-specific manifest only if Edge Add-ons store requires it (it doesn't — submit the Chrome zip directly).

Verify in Edge:
- Side Panel API works (Edge 114+ supported)
- Offscreen Document API works (Edge 109+)
- Web Speech API voices available (Edge uses Microsoft voices — excellent quality)

---

## Day 50 — Safari

### Step 60 — Safari Web Extension conversion

```bash
# Requires Xcode installed on macOS
xcrun safari-web-extension-converter packages/extension/dist/ \
  --app-name "Voxara" \
  --bundle-identifier "com.Voxara.extension" \
  --project-location apps/safari/
```

### Step 61 — Safari-specific fixes

- IndexedDB in Safari has ITP (Intelligent Tracking Prevention) — data may be cleared after 7 days of inactivity. Add a warning in the Options page for Safari users.
- `chrome.*` APIs become `browser.*` in Safari — the compat layer handles this.
- Side Panel becomes a popover (Safari has no side panel API) — resize the popover to 380px wide.
- Web Speech API available but voices are limited — upsell premium TTS more prominently on Safari.

---

## Day 51-52 — Cross-Browser QA

### Step 62 — Playwright cross-browser tests

```typescript
// tests/cross-browser.spec.ts
import { test, expect, chromium, firefox } from '@playwright/test'

test.describe('PDF detection', () => {
  for (const browserType of [chromium, firefox]) {
    test(`detects PDF in ${browserType.name()}`, async () => {
      const browser = await browserType.launch({ args: [`--load-extension=dist/`] })
      const page = await browser.newPage()
      await page.goto('https://example.com/sample.pdf')
      await expect(page.locator('[data-testid="Voxara-player"]')).toBeVisible()
      await browser.close()
    })
  }
})
```

**Phase 7 complete ✓** — Working on Chrome, Edge, Firefox, and Safari with browser-specific fixes applied.

---

---

# PHASE 8 — Polish & Performance
**Goal:** All performance targets from the system design doc are hit. UX is refined and complete.
**Duration:** Week 13 (5 days)

---

## Day 53-54 — Performance Profiling

### Step 63 — Measure and hit every target

For each target in the system design doc, write a measurement script and verify:

| Target | Tool | Pass Criteria |
|---|---|---|
| PDF detection → UI < 500ms | `performance.now()` in content script | p95 < 500ms |
| First audio utterance < 800ms | `voiceschanged` to `utterance.onstart` | p95 < 800ms |
| Chunk transition gap < 100ms | `onend` to next `onstart` delta | p95 < 100ms |
| AI first token < 1.5s | `fetch` start to first SSE token | p95 < 1.5s |
| AI first spoken sentence < 2.5s | Query submit to `utterance.onstart` | p95 < 2.5s |
| Memory (idle) < 80MB | Chrome DevTools Memory panel | Verify manually |

### Step 64 — Chunking latency for large PDFs

For a 200-page PDF, parsing must complete in < 8s. Profile with Chrome DevTools Performance panel. If slow:
- Move PDF.js extraction to a Web Worker (offloads from main thread)
- Process pages in batches of 10, yielding between batches with `setTimeout(0)`

---

## Day 55 — UX Refinements

### Step 65 — Onboarding flow

First install triggers a welcome screen in the Side Panel:
1. "Welcome to Voxara" — one sentence explanation
2. "Open any PDF in your browser to get started"
3. Optional: enter API key or create account

No forced account creation. The extension works immediately without any sign-up.

### Step 66 — Empty states

Design and implement empty states for:
- Library tab with no documents: "Open a PDF in any tab to start listening"
- Chat tab before any question: "Ask me anything about this document"
- Global chat with no documents: "Open some PDFs first — I'll be able to discuss them here"

### Step 67 — Error states

Every error must have a human-readable message and a clear action:
- PDF parse failed: "Couldn't read this PDF — it may be scanned or password-protected. [Try anyway with OCR] [Dismiss]"
- API key missing: "Add your OpenAI API key in Settings to enable AI chat."
- No voices available: "Your browser doesn't have any voices installed. [Learn how to add voices]"
- Network error during AI query: "Couldn't reach the AI right now. [Retry] [Work offline]"

---

## Day 56-57 — Accessibility & Final UI

### Step 68 — Accessibility audit

Run axe DevTools on the Side Panel HTML. Fix all critical and serious violations:
- All buttons must have `aria-label` attributes
- Voice selector must be keyboard navigable
- Progress scrubber must support arrow key input
- AI response bubbles must have `role="log"` on the container for screen reader live updates

### Step 69 — Dark mode

Implement via `prefers-color-scheme` media query in Tailwind. All colors must pass WCAG AA contrast in both modes.

**Phase 8 complete ✓** — All performance targets met. Onboarding, empty states, errors, accessibility done.

---

---

# PHASE 9 — Testing & QA
**Goal:** Comprehensive test coverage. No known bugs before submission.
**Duration:** Week 14 (5 days)

---

## Day 58-59 — Unit Tests

### Step 70 — Full unit test suite

Write Vitest unit tests for every pure function. Minimum coverage targets:

| Module | Target Coverage |
|---|---|
| `chunker.ts` | 100% |
| `context.ts` (AI context builder) | 90% |
| `voices.ts` | 80% |
| `hash.ts` | 100% |
| `db/*.ts` (mocked IndexedDB) | 85% |
| State management (Zustand) | 80% |

---

## Day 60 — Integration Tests

### Step 71 — Message passing integration tests

Use `vitest` with mocked `chrome.*` APIs (`jest-chrome` or a manual mock):
- PDF_DETECTED → Service Worker → Side Panel STATE_UPDATE round-trip
- AI_QUERY → context assembly → OpenAI mock → dual-channel dispatch
- CHUNK_ENDED → next chunk queued and played

---

## Day 61 — E2E Tests

### Step 72 — Playwright E2E suite

```typescript
// Key E2E scenarios
test('user opens PDF, listens, asks question, gets answer in text and voice')
test('user changes voice mid-playback, new voice applies on next chunk')
test('user switches to global chat, asks cross-document question')
test('user installs extension on Firefox, opens PDF, audio plays')
test('user resumes document after closing and reopening browser')
test('user with no API key sees correct upsell, not error')
```

---

## Day 62 — Manual QA Checklist

### Step 73 — Device and browser matrix

| Browser | Version | Platform | Tester |
|---|---|---|---|
| Chrome | Latest stable | Windows 11 | ✓ |
| Chrome | Latest stable | macOS Sonoma | ✓ |
| Edge | Latest stable | Windows 11 | ✓ |
| Firefox | Latest stable | Windows 11 | ✓ |
| Firefox | Latest stable | macOS | ✓ |
| Safari | 17+ | macOS Sonoma | ✓ |

For each: open 3 different PDFs (short, long, scanned), run all playback controls, send 5 AI queries, switch chat modes, check persistence after browser restart.

**Phase 9 complete ✓** — Test suite green. Manual QA passed on all browsers and platforms.

---

---

# PHASE 10 — Deployment & Release
**Goal:** Live on all browser stores. Backend deployed. Monitoring in place.
**Duration:** Weeks 15–16 (10 days)

---

## Day 63-64 — Backend Deployment

### Step 74 — Railway deployment

```dockerfile
# apps/backend/Dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

Railway setup:
1. Connect GitHub repo to Railway
2. Create service from `apps/backend/`
3. Add environment variables: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_JWT_SECRET`, `OPENAI_API_KEY`, `REDIS_URL`, `R2_BUCKET`, `R2_ACCESS_KEY`, `R2_SECRET_KEY`
4. Enable Railway's built-in HTTPS (auto-provisioned)
5. Set custom domain: `api.Voxara.app`

### Step 75 — Supabase production setup

1. Create production Supabase project
2. Run database migrations (auth tables auto-created by Supabase)
3. Enable Row Level Security on all tables
4. Configure SMTP for email verification

### Step 76 — Cloudflare R2 bucket

1. Create R2 bucket: `Voxara-tts-cache`
2. Create public access policy for `tts/*` prefix
3. Set custom domain: `cdn.Voxara.app`

---

## Day 65-66 — Chrome Web Store Submission

### Step 77 — Pre-submission checklist

- [ ] Extension version set to `1.0.0` in manifest
- [ ] All icons present: 16, 48, 128px PNG
- [ ] Screenshots prepared: 1280x800 PNG, at least 3
- [ ] Promotional tile: 440x280 PNG
- [ ] Privacy policy published at `Voxara.app/privacy`
- [ ] Permission justification written for all 7 permissions
- [ ] Extension tested on Chrome stable (not just dev/canary)
- [ ] No `eval()` or remote code execution anywhere

### Step 78 — Build final Chrome package

```bash
pnpm --filter extension build:chrome
cd packages/extension/dist && zip -r ../../../release/Voxara-chrome-1.0.0.zip .
```

### Step 79 — Submit to Chrome Web Store

1. Go to [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole)
2. Pay $5 developer fee (one-time)
3. Create new item → upload zip
4. Fill in: name, description (short + detailed), category (Productivity), language
5. Upload screenshots and promotional images
6. Submit for review
7. **Expected review time: 1–3 business days**

---

## Day 67 — Firefox Add-ons (AMO) Submission

### Step 80 — Build Firefox package

```bash
pnpm --filter extension build:firefox
cd packages/extension/dist-firefox && zip -r ../../../release/Voxara-firefox-1.0.0.zip .
```

### Step 81 — Submit to AMO

1. Go to [addons.mozilla.org/developers](https://addons.mozilla.org/developers)
2. Submit new add-on → upload zip
3. AMO requires source code for review — upload the full source zip separately
4. Add `SOURCE_CODE_NOTES.md` explaining how to build from source
5. **Expected review time: 1–2 weeks**

---

## Day 68 — Edge Add-ons Submission

### Step 82 — Submit to Edge Add-ons

1. Go to [partner.microsoft.com/dashboard](https://partner.microsoft.com/dashboard)
2. Submit the Chrome zip directly — Edge accepts Chrome MV3 packages
3. Fill in store listing details
4. **Expected review time: 1–5 business days**

---

## Day 69 — Safari Extension Submission

### Step 83 — Build and submit Safari extension

1. Open the Xcode project generated in Phase 7 Step 60
2. Set bundle ID, version, signing certificate (requires Apple Developer account — $99/year)
3. Archive → Upload to App Store Connect
4. Submit for App Review
5. **Expected review time: 1–2 weeks**

---

## Day 70 — Monitoring & Post-Launch

### Step 84 — Error monitoring

Install Sentry in the extension:
```bash
pnpm add @sentry/browser
```

```typescript
// src/background/index.ts
import * as Sentry from '@sentry/browser'
Sentry.init({
  dsn: 'YOUR_SENTRY_DSN',
  release: chrome.runtime.getManifest().version,
})
```

Backend Sentry:
```python
import sentry_sdk
sentry_sdk.init(dsn=os.environ['SENTRY_DSN'], traces_sample_rate=0.1)
```

### Step 85 — Analytics (privacy-respecting)

Use Plausible (not Google Analytics) for:
- Daily active users by browser
- Most-used features (aggregated, no PII)
- Error rates

### Step 86 — Post-launch monitoring checklist

For the first 72 hours after Chrome launch:
- [ ] Watch Sentry for new error types every 6 hours
- [ ] Monitor Railway backend CPU/memory — scale if >70% sustained
- [ ] Watch Chrome Web Store reviews daily — respond within 24h
- [ ] Check API cost dashboard (OpenAI) — set spend alerts at $50, $100, $200
- [ ] Verify R2 storage usage is growing correctly (TTS cache working)

---

## Release Summary

| Store | Build Command | Package | Submit Day |
|---|---|---|---|
| Chrome Web Store | `build:chrome` | `Voxara-chrome-1.0.0.zip` | Day 65 |
| Firefox AMO | `build:firefox` | `Voxara-firefox-1.0.0.zip` | Day 67 |
| Edge Add-ons | `build:chrome` (same) | (same as Chrome) | Day 68 |
| Safari App Store | Xcode archive | `.xcarchive` | Day 69 |

---

---

## What Comes After v1.0

Once v1.0 is live and stable, the priority order for v1.1:

1. **Premium TTS voices** — surface Azure Neural voices in the voice picker for paying users
2. **Voice input for queries** — mic button in chat sends audio to Whisper API for transcription
3. **EPUB support** — epub.js handles parsing; same chunking + audio pipeline
4. **Multi-language TTS** — detect document language, switch voice model automatically
5. **Self-hosted AI option** — point the AI service at a user-provided Ollama endpoint

---

*Voxara Build Plan v1.0 — 14–16 weeks, 86 steps, 4 browser stores.*