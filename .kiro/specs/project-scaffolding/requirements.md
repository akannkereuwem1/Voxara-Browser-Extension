# Requirements Document

## Introduction

Phase 0 establishes the complete project foundation for the Voxara browser extension. This phase produces a working, buildable skeleton with no functional features — but with every structural, tooling, and infrastructure decision locked in so that all subsequent phases can build on a stable base.

Deliverables include: multi-target manifest files (Chrome MV3, Firefox MV2, Edge MV3), a Vite + CRXJS build system, the canonical source folder layout, a browser compatibility abstraction layer, a typed message-passing infrastructure, a bootstrapped IndexedDB schema, and a GitHub Actions CI/CD pipeline.

## Glossary

- **Build_System**: The Vite + CRXJS plugin configuration responsible for bundling and packaging the extension for each browser target.
- **Browser_Compat**: The `src/shared/browser-compat.js` module that wraps all browser-specific APIs and exposes a unified interface to the rest of the codebase.
- **CI_Pipeline**: The GitHub Actions workflow that runs lint, tests, and multi-target builds on every push and pull request.
- **DB_Schema**: The IndexedDB database initialised via the `idb` wrapper, containing the `documents`, `chunks`, `playbackStates`, and `chatThreads` object stores.
- **Extension_Skeleton**: The set of manifest files, entry-point source files, and folder structure that constitute a loadable (but non-functional) browser extension for all three targets.
- **Message_Bus**: The typed message-passing infrastructure used for inter-component communication between the Service Worker, Content Script, Side Panel, Offscreen Document, and Options Page.
- **Service_Worker**: The background script that acts as the single source of truth for application state in Chrome MV3 and Edge MV3 builds.
- **Background_Page**: The Firefox MV2 equivalent of the Service Worker — a persistent background page running identical logic.
- **Manifest**: The `manifest.json` file that declares extension metadata, permissions, and entry points for a given browser target.

---

## Requirements

### Requirement 1: Extension Skeleton — Chrome MV3

**User Story:** As a developer, I want a loadable Chrome MV3 extension skeleton, so that I can verify the build system produces a valid, installable package from day one.

#### Acceptance Criteria

1. THE Build_System SHALL produce a `dist/chrome-mv3/` output directory containing a valid `manifest.json` conforming to Manifest V3 specification.
2. THE Manifest SHALL declare the permissions: `storage`, `activeTab`, `scripting`, `sidePanel`, `offscreen`, and `alarms`.
3. THE Manifest SHALL declare `host_permissions` containing `<all_urls>`.
4. THE Manifest SHALL reference a Service Worker entry point at `background/index.js`.
5. THE Manifest SHALL reference content script, side panel, offscreen, and options page entry points matching the canonical source layout.
6. WHEN the `npm run build:chrome` command is executed, THE Build_System SHALL complete without errors and produce the `dist/chrome-mv3/` directory.
7. WHEN the `npm run dev:chrome` command is executed, THE Build_System SHALL start a development server with hot module replacement enabled for the extension.

---

### Requirement 2: Extension Skeleton — Firefox MV2

**User Story:** As a developer, I want a loadable Firefox MV2 extension skeleton, so that Firefox compatibility is validated from the start of the project.

#### Acceptance Criteria

1. THE Build_System SHALL produce a `dist/firefox-mv2/` output directory containing a valid `manifest.json` conforming to Manifest V2 specification.
2. THE Manifest SHALL declare a background page entry point (not a service worker) for the Firefox MV2 target.
3. THE Manifest SHALL declare equivalent permissions to the Chrome MV3 manifest, using Firefox-compatible permission names.
4. WHEN the `npm run build:firefox` command is executed, THE Build_System SHALL complete without errors and produce the `dist/firefox-mv2/` directory.
5. WHEN the `npm run dev:firefox` command is executed, THE Build_System SHALL start a development server targeting the Firefox MV2 manifest.
6. THE Extension_Skeleton SHALL load in Firefox Developer Edition without manifest validation errors.

---

### Requirement 3: Extension Skeleton — Edge MV3

**User Story:** As a developer, I want a loadable Edge MV3 extension skeleton, so that the Edge build target is verified alongside Chrome from the beginning.

#### Acceptance Criteria

1. THE Build_System SHALL produce a `dist/edge-mv3/` output directory containing a valid `manifest.json` conforming to Manifest V3 specification.
2. THE Manifest SHALL be functionally identical to the Chrome MV3 manifest, differing only in the `name` field suffix or edge-specific metadata where required.
3. WHEN the `npm run build:edge` command is executed, THE Build_System SHALL complete without errors and produce the `dist/edge-mv3/` directory.
4. THE Extension_Skeleton SHALL load in Microsoft Edge without manifest validation errors.

---

### Requirement 4: Build System Configuration

**User Story:** As a developer, I want a fully configured Vite + CRXJS build system, so that I have a single, consistent toolchain for development and production across all browser targets.

#### Acceptance Criteria

1. THE Build_System SHALL use Vite as the bundler with the CRXJS plugin installed and configured.
2. THE Build_System SHALL support separate build configurations for `chrome-mv3`, `firefox-mv2`, and `edge-mv3` targets selectable via npm scripts.
3. WHEN the `npm run build` command is executed, THE Build_System SHALL build all three targets sequentially and place outputs in `dist/chrome-mv3/`, `dist/firefox-mv2/`, and `dist/edge-mv3/` respectively.
4. THE Build_System SHALL produce a production-ready extension zip file for each target suitable for store submission.
5. THE Build_System SHALL enforce a maximum extension install package size of 5MB per target.
6. WHERE a development build is active, THE Build_System SHALL enable source maps for all entry points.

---

### Requirement 5: Source Folder Structure

**User Story:** As a developer, I want the canonical source folder layout in place, so that all team members and future phases have a consistent, agreed-upon location for every type of code.

#### Acceptance Criteria

1. THE Extension_Skeleton SHALL contain a `/src/background/` directory with an `index.js` entry point for the Service Worker / Background Page.
2. THE Extension_Skeleton SHALL contain a `/src/content/` directory with an `index.js` entry point for the Content Script.
3. THE Extension_Skeleton SHALL contain a `/src/sidepanel/` directory with an `index.html` and `index.js` entry point for the Side Panel UI.
4. THE Extension_Skeleton SHALL contain a `/src/offscreen/` directory with an `index.html` and `index.js` entry point for the Offscreen Document.
5. THE Extension_Skeleton SHALL contain a `/src/options/` directory with an `index.html` and `index.js` entry point for the Options Page.
6. THE Extension_Skeleton SHALL contain a `/src/shared/` directory for utilities, constants, and shared modules used across all contexts.
7. THE Extension_Skeleton SHALL contain no functional implementation code — each entry point SHALL export or execute only a clearly labelled stub or no-op.

---

### Requirement 6: Browser Compatibility Abstraction Layer

**User Story:** As a developer, I want a browser-compat.js module that abstracts all browser API differences, so that no other module in the codebase ever calls `chrome.*` or `browser.*` directly.

#### Acceptance Criteria

1. THE Browser_Compat module SHALL be located at `src/shared/browser-compat.js` and export a single initialisation function `BrowserCompat.init()`.
2. WHEN `BrowserCompat.init()` is called, THE Browser_Compat module SHALL detect the current browser environment and return a unified API object.
3. THE Browser_Compat module SHALL expose a `storage` namespace that wraps `chrome.storage` (Chrome/Edge) and `browser.storage` (Firefox) behind a single async interface.
4. THE Browser_Compat module SHALL expose a `runtime` namespace that wraps `chrome.runtime.sendMessage` and `browser.runtime.sendMessage` behind a single async interface.
5. THE Browser_Compat module SHALL expose a `sidePanel` namespace that abstracts the Chrome `sidePanel` API, the Firefox Sidebar API, and a fallback popover for unsupported browsers.
6. THE Browser_Compat module SHALL expose a `tabs` namespace that wraps tab query and update APIs consistently across Chrome and Firefox.
7. IF a requested API is not available in the current browser environment, THEN THE Browser_Compat module SHALL throw a descriptive error identifying the missing capability and the current browser.
8. THE Browser_Compat module SHALL be the only module in the codebase permitted to reference `chrome.*` or `browser.*` globals directly.

---

### Requirement 7: Message Passing Infrastructure

**User Story:** As a developer, I want a typed message-passing infrastructure in place, so that all inter-component communication follows a consistent, validated envelope format from the first line of feature code.

#### Acceptance Criteria

1. THE Message_Bus SHALL define a typed message envelope with the shape `{ type: string, payload: object, requestId: string }`.
2. THE Message_Bus SHALL define and export an enumeration of all valid message type constants (e.g. `MSG_TYPES.PLAY_CHUNK`, `MSG_TYPES.AI_QUERY`, `MSG_TYPES.STATE_UPDATE`, `MSG_TYPES.ACTION`).
3. THE Message_Bus SHALL provide a `sendMessage(type, payload)` helper that generates a `requestId` (UUID v4), constructs the envelope, and dispatches it via `Browser_Compat.runtime.sendMessage`.
4. THE Message_Bus SHALL provide an `onMessage(handler)` helper that registers a listener and passes the typed envelope to the handler function.
5. IF a received message does not conform to the envelope schema, THEN THE Message_Bus SHALL log a warning and discard the message without invoking the handler.
6. THE Service_Worker entry point SHALL register a message listener using `Message_Bus.onMessage` on initialisation.
7. THE Message_Bus SHALL be located in `src/shared/message-bus.js` and importable by all extension contexts.

---

### Requirement 8: IndexedDB Schema Bootstrap

**User Story:** As a developer, I want the IndexedDB schema initialised with all required object stores and indexes on first run, so that all subsequent phases can read and write data without performing migrations.

#### Acceptance Criteria

1. THE DB_Schema SHALL be initialised using the `idb` library wrapper — the raw `indexedDB` API SHALL NOT be used anywhere in the codebase.
2. THE DB_Schema SHALL create an object store named `documents` with `id` as the primary key and an index on `url`.
3. THE DB_Schema SHALL create an object store named `chunks` with `id` as the primary key, an index on `documentId`, an index on `sequenceIndex`, and a full-text-compatible index on `text`.
4. THE DB_Schema SHALL create an object store named `playbackStates` with `documentId` as the primary key.
5. THE DB_Schema SHALL create an object store named `chatThreads` with `id` as the primary key.
6. THE DB_Schema initialisation function SHALL be located in `src/shared/db.js` and export an `initDB()` function that returns a promise resolving to the opened database instance.
7. WHEN `initDB()` is called on a fresh browser profile, THE DB_Schema SHALL create all four object stores in a single `onupgradeneeded` transaction.
8. WHEN `initDB()` is called on a profile where the database already exists at the current version, THE DB_Schema SHALL open the existing database without modifying any object stores.
9. IF the database upgrade transaction fails, THEN THE DB_Schema SHALL reject the returned promise with a descriptive error message.

---

### Requirement 9: CI/CD Pipeline

**User Story:** As a developer, I want a GitHub Actions CI/CD pipeline, so that every push and pull request is automatically linted, tested, and built for all three browser targets with artifacts uploaded.

#### Acceptance Criteria

1. THE CI_Pipeline SHALL be defined as a GitHub Actions workflow file at `.github/workflows/ci.yml`.
2. WHEN a push or pull request targets the `main` branch, THE CI_Pipeline SHALL trigger automatically.
3. THE CI_Pipeline SHALL execute the following jobs in order: lint, test, build.
4. WHEN the lint job runs, THE CI_Pipeline SHALL execute `npm run lint` and fail the workflow if any lint errors are reported.
5. WHEN the test job runs, THE CI_Pipeline SHALL execute `npm run test` and fail the workflow if any tests fail.
6. WHEN the build job runs, THE CI_Pipeline SHALL build all three targets (`chrome-mv3`, `firefox-mv2`, `edge-mv3`) and fail the workflow if any build fails.
7. WHEN all build jobs succeed, THE CI_Pipeline SHALL upload the contents of `dist/chrome-mv3/`, `dist/firefox-mv2/`, and `dist/edge-mv3/` as named workflow artifacts.
8. THE CI_Pipeline SHALL cache `node_modules` between runs using the `actions/cache` action keyed on `package-lock.json` to reduce build times.
9. IF any job in the pipeline fails, THEN THE CI_Pipeline SHALL report the failure status on the pull request check and prevent merge if branch protection is enabled.
