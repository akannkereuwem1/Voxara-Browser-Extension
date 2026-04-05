# Tech Stack & Build System

## Package Manager

- **ALWAYS use `pnpm`** — never `npm` or `yarn`
- Install deps: `pnpm install`
- Add dep: `pnpm add <pkg>`
- Add dev dep: `pnpm add -D <pkg>`
- Run scripts: `pnpm run <script>` or `pnpm <script>`
- `package.json` scripts are invoked via `pnpm`, not `npm run`

## Bundler & Build

- **Bundler:** Vite with CRXJS plugin (MV3 HMR in dev, produces extension zip for prod)
- **CI:** GitHub Actions — lint → test → build all targets → upload artifacts
- **Browser targets:** `chrome-mv3`, `firefox-mv2`, `edge-mv3` (separate build configs)

## Core Libraries & APIs

| Library/API | Purpose |
|---|---|
| PDF.js (Mozilla, Apache 2.0) | Client-side PDF parsing — bundled, no CDN |
| idb | Promise-based IndexedDB wrapper |
| compromise.js (~30KB) | Lightweight client-side NLP for global chat entity extraction |
| Web Speech API | Free TTS — browser-native, no library |
| Intl.Segmenter | Sentence boundary detection — browser-native |
| OpenAI TTS API | Premium voice synthesis |
| Azure Neural TTS | Premium+ voice synthesis with SSML |

## Backend (Optional)

FastAPI — provides user accounts, cloud sync, premium TTS proxying, shared AI response caching. Free-tier users can call OpenAI directly without a backend.

## Storage

- **IndexedDB** (via `idb`): all document data, chunks, playback state, chat history
- **`chrome.storage.sync`**: lightweight user preferences only (~5KB max)
- No `localStorage` — it is synchronous, size-limited, and cleared aggressively by browsers

## Extension Manifest

- Chrome/Edge: Manifest V3
- Firefox: Manifest V2 (MV3 migration planned post-launch)
- Key permissions: `storage`, `activeTab`, `scripting`, `sidePanel`, `offscreen`, `alarms`, `<all_urls>`

## Common Commands

```bash
# Development (Chrome)
pnpm dev:chrome

# Development (Firefox)
pnpm dev:firefox

# Production build (all targets)
pnpm build

# Build specific target
pnpm build:chrome
pnpm build:firefox
pnpm build:edge

# Lint
pnpm lint

# Tests
pnpm test
```

## Performance Budgets

- Extension install package: <5MB
- Memory at idle (side panel open): <80MB
- PDF detection → player UI: <500ms
- First audio utterance: <800ms from play tap
