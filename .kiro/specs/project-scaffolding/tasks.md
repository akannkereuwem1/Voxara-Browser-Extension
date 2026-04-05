# Implementation Plan: Project Scaffolding (Phase 0)

## Overview

Bootstrap the complete structural and tooling foundation for the Voxara browser extension: multi-target manifests, Vite + CRXJS build system, canonical source layout, browser compatibility abstraction, typed message-passing, IndexedDB schema, and GitHub Actions CI/CD. No functional features — every entry point is a stub.

## Tasks

- [x] 1. Initialise project and install dependencies
  - Create `package.json` with all required dependencies: `vite`, `@crxjs/vite-plugin`, `idb`, `fast-check`, `fake-indexeddb`, `vitest`, `eslint`
  - Create `vitest.config.js` with `environment: 'node'` and `setupFiles: ['./test/setup.js']`
  - Create `test/setup.js` that installs `fake-indexeddb` globals
  - Create `.eslintrc.js` (or `eslint.config.js`) targeting `src/`
  - _Requirements: 4.1, 9.4, 9.5_

- [x] 2. Create manifest files
  - [x] 2.1 Create `manifests/manifest.chrome.json` (MV3)
    - Declare `manifest_version: 3`, permissions (`storage`, `activeTab`, `scripting`, `sidePanel`, `offscreen`, `alarms`), `host_permissions: ["<all_urls>"]`
    - Reference service worker at `src/background/index.js`, content script, side panel, offscreen document, and options page entry points
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  - [x] 2.2 Create `manifests/manifest.edge.json` (MV3)
    - Copy Chrome manifest structure, change `name` field to Edge variant
    - _Requirements: 3.1, 3.2_
  - [x] 2.3 Create `manifests/manifest.firefox.json` (MV2)
    - Declare `manifest_version: 2`, use `background.scripts` (no service worker), omit `sidePanel` and `offscreen`, use Firefox-compatible permissions
    - _Requirements: 2.1, 2.2, 2.3_

- [x] 3. Configure Vite build system
  - [x] 3.1 Create `vite.config.chrome.js` using CRXJS plugin pointing at `manifests/manifest.chrome.json`, output to `dist/chrome-mv3`, sourcemaps enabled
    - _Requirements: 4.1, 4.2, 4.6, 1.6, 1.7_
  - [x] 3.2 Create `vite.config.firefox.js` pointing at `manifests/manifest.firefox.json`, output to `dist/firefox-mv2`
    - _Requirements: 4.2, 2.4, 2.5_
  - [x] 3.3 Create `vite.config.edge.js` pointing at `manifests/manifest.edge.json`, output to `dist/edge-mv3`
    - _Requirements: 4.2, 3.3_
  - [x] 3.4 Add all npm scripts to `package.json`: `dev:chrome`, `dev:firefox`, `build:chrome`, `build:firefox`, `build:edge`, `build` (all three sequentially), `lint`, `test`
    - _Requirements: 4.2, 4.3_

- [x] 4. Create source entry-point stubs
  - [x] 4.1 Create `src/background/index.js` — imports `BrowserCompat`, `MessageBus`, `initDB`; calls `initDB()` on startup; registers `onMessage` listener stub
    - _Requirements: 5.1, 5.7, 7.6_
  - [x] 4.2 Create `src/content/index.js` — imports `BrowserCompat`, `MessageBus`; logs context ready
    - _Requirements: 5.2, 5.7_
  - [x] 4.3 Create `src/sidepanel/index.html` and `src/sidepanel/index.js` — shell HTML; JS imports `BrowserCompat`, `MessageBus`; logs context ready
    - _Requirements: 5.3, 5.7_
  - [x] 4.4 Create `src/offscreen/index.html` and `src/offscreen/index.js` — shell HTML; JS imports `BrowserCompat`, `MessageBus`; logs context ready
    - _Requirements: 5.4, 5.7_
  - [x] 4.5 Create `src/options/index.html` and `src/options/index.js` — shell HTML; JS imports `BrowserCompat`; logs context ready
    - _Requirements: 5.5, 5.7_

- [x] 5. Implement `src/shared/browser-compat.js`
  - [x] 5.1 Implement `BrowserCompat` class with static `init()` factory
    - Detect environment via `typeof chrome` / `typeof browser` globals
    - Return unified API object with `storage`, `runtime`, `sidePanel`, `tabs` namespaces
    - Chrome/Edge path: wrap `chrome.*` APIs
    - Firefox path: wrap `browser.*` APIs (native Promises)
    - `sidePanel`: Chrome/Edge → `chrome.sidePanel.*`; Firefox → `browser.sidebarAction.*`; fallback → no-op with `console.warn`
    - Throw `BrowserCompatError('Unsupported browser environment: neither chrome nor browser global found')` when neither global is present
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_
  - [ ]* 5.2 Write unit tests for `BrowserCompat`
    - Test Chrome mock: `init()` returns object with all four namespaces, each with expected methods
    - Test Firefox mock: same shape check
    - Test unsupported env: `init()` throws `BrowserCompatError`
    - _Requirements: 6.2, 6.3, 6.7_
  - [ ]* 5.3 Write property test for `BrowserCompat.init()` — Property 3
    - **Property 3: BrowserCompat init returns a complete API object**
    - **Validates: Requirements 6.2, 6.3, 6.4, 6.5, 6.6**
  - [ ]* 5.4 Write property test for `BrowserCompat` unsupported env — Property 4
    - **Property 4: BrowserCompat throws on unsupported environments**
    - **Validates: Requirements 6.7**

- [x] 6. Implement `src/shared/message-bus.js`
  - [x] 6.1 Implement `MSG_TYPES` frozen enum with all message type constants: `PLAY_CHUNK`, `PAUSE_PLAYBACK`, `RESUME_PLAYBACK`, `CHUNK_STARTED`, `CHUNK_ENDED`, `AI_QUERY`, `AI_RESPONSE`, `STATE_UPDATE`, `ACTION`, `VOICE_CHANGE`
    - _Requirements: 7.2_
  - [x] 6.2 Implement `sendMessage(type, payload, compat)` helper
    - Generate UUID v4 `requestId`, construct envelope `{ type, payload, requestId }`, dispatch via `compat.runtime.sendMessage`
    - _Requirements: 7.1, 7.3_
  - [x] 6.3 Implement `onMessage(handler, compat)` helper
    - Register listener via `compat.runtime.onMessage`
    - Validate envelope: `type` is string, `payload` is object, `requestId` is non-empty string
    - Discard malformed messages with `console.warn('[MessageBus] Discarded malformed message:', msg)`
    - _Requirements: 7.4, 7.5, 7.7_
  - [ ]* 6.4 Write unit tests for `message-bus.js`
    - Test `sendMessage` constructs envelope with UUID requestId
    - Test `onMessage` invokes handler for valid envelopes
    - Test `onMessage` does not invoke handler for messages missing `type`, `payload`, or `requestId`
    - _Requirements: 7.1, 7.3, 7.4, 7.5_
  - [ ]* 6.5 Write property test for `sendMessage` — Property 5
    - **Property 5: sendMessage produces valid envelopes**
    - **Validates: Requirements 7.1, 7.3**
  - [ ]* 6.6 Write property test for `onMessage` malformed discard — Property 6
    - **Property 6: onMessage discards malformed envelopes**
    - **Validates: Requirements 7.5**
  - [ ]* 6.7 Write property test for `MSG_TYPES` frozen enum — Property 9
    - **Property 9: MSG_TYPES enum is exhaustive and frozen**
    - **Validates: Requirements 7.2**

- [x] 7. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement `src/shared/db.js`
  - [x] 8.1 Implement `initDB()` using `openDB` from `idb`
    - DB name `voxara`, version `1`
    - `upgrade` callback creates: `documents` store (keyPath `id`, index on `url`), `chunks` store (keyPath `id`, indexes on `documentId`, `sequenceIndex`, `text`), `playbackStates` store (keyPath `documentId`), `chatThreads` store (keyPath `id`)
    - Reject with `'IndexedDB upgrade failed: ' + error.message` on upgrade transaction failure
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.9_
  - [ ]* 8.2 Write unit tests for `initDB()`
    - Test fresh DB: all four stores present
    - Test existing DB at version 1: opens without error, stores unchanged
    - Uses `fake-indexeddb` from test setup
    - _Requirements: 8.7, 8.8_
  - [ ]* 8.3 Write property test for `initDB()` fresh profile — Property 7
    - **Property 7: initDB creates all four object stores**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.7**
  - [ ]* 8.4 Write property test for `initDB()` idempotency — Property 8
    - **Property 8: initDB is idempotent on existing databases**
    - **Validates: Requirements 8.8**

- [-] 9. Create GitHub Actions CI/CD pipeline
  - Create `.github/workflows/ci.yml` with three sequential jobs: `lint` → `test` → `build`
  - `lint` job: checkout, setup Node, restore cache, `npm ci`, `npm run lint`
  - `test` job: depends on `lint`, runs `npm run test`
  - `build` job: depends on `test`, runs `npm run build:chrome`, `npm run build:firefox`, `npm run build:edge`; uploads `dist/chrome-mv3`, `dist/firefox-mv2`, `dist/edge-mv3` as named artifacts
  - Cache `node_modules` keyed on `package-lock.json` hash using `actions/cache`
  - Trigger on push and pull_request to `main`
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9_

- [~] 10. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests use `fast-check` with `numRuns: 100`; IndexedDB tests use `fake-indexeddb`
- `BrowserCompat` is the only module permitted to reference `chrome.*` or `browser.*` directly
