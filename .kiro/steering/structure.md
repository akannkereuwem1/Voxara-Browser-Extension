# Project Structure

## Source Layout

```
/src
  /background       # Service Worker — PDF detection, message routing, API calls, state authority
  /content          # Content Script — PDF interception, DOM overlay injection, Web Speech orchestration
  /sidepanel        # Side Panel UI — chat interface, playback controls, voice selector, library
  /offscreen        # Offscreen Document — SpeechSynthesisUtterance management, AudioContext for premium TTS
  /options          # Options Page — account settings, voice prefs, storage management, API key config
  /shared           # Shared utilities, types, constants used across contexts
```

## Key Architectural Rules

- **Service Worker is the single source of truth** for `appState` — all other components hold read-only local copies
- **No component writes state directly** — dispatch `ACTION` messages to the Service Worker; it updates state and broadcasts `STATE_UPDATE`
- **Content scripts never make direct API calls** — all external requests go through the Service Worker
- **All browser API differences are abstracted** in `browser-compat.js` — never call `chrome.*` or `browser.*` directly outside that module

## Inter-Component Communication

All messages use a typed envelope:
```json
{ "type": "PLAY_CHUNK | AI_QUERY | ...", "payload": {}, "requestId": "uuid" }
```

Message flow: Side Panel / Content Script → Service Worker → Offscreen Document / Side Panel

## Storage Conventions

- IndexedDB object stores: `documents`, `chunks`, `playbackStates`, `chatThreads`
- Use the `idb` wrapper — never raw `indexedDB` API
- `chrome.storage.sync` for user preferences only — keep under 5KB total
- Never use `localStorage`

## Browser Compatibility

- Wrap all browser-specific APIs in `src/shared/browser-compat.js`
- Firefox ships MV2 with a background page instead of a Service Worker — logic must be identical
- Offscreen Document is Chrome/Edge only — Firefox/Safari use a hidden `<iframe>` in a content script

## Build Outputs

```
/dist
  /chrome-mv3
  /firefox-mv2
  /edge-mv3
```
