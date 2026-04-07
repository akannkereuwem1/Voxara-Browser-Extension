import { BrowserCompat } from '../shared/browser-compat.js'
import { MSG_TYPES, sendMessage, onMessage } from '../shared/message-bus.js'
import { initDB } from '../shared/db.js'

// ---------------------------------------------------------------------------
// AppState
// ---------------------------------------------------------------------------

export const DEFAULT_APP_STATE = {
  activePdfUrl:      null,
  playbackStatus:    'idle',
  currentChunkIndex: 0,
  connectedPorts:    [],
  offscreenOpen:     false,
  // Phase 2 additions
  activeDocumentId:  null,
  parseStatus:       'idle',
  parseProgress:     null,
}

export let appState = { ...DEFAULT_APP_STATE }

// ---------------------------------------------------------------------------
// Serialise state for broadcast (omit runtime-only fields)
// ---------------------------------------------------------------------------

export function serializeState(state) {
  return {
    activePdfUrl:      state.activePdfUrl,
    playbackStatus:    state.playbackStatus,
    currentChunkIndex: state.currentChunkIndex,
    activeDocumentId:  state.activeDocumentId,
    parseStatus:       state.parseStatus,
    parseProgress:     state.parseProgress,
  }
}

// ---------------------------------------------------------------------------
// Broadcast helpers
// ---------------------------------------------------------------------------

export function broadcastState(state, ports) {
  const snapshot = serializeState(state)
  const alive = []
  for (const port of ports) {
    try {
      port.postMessage({ type: MSG_TYPES.STATE_UPDATE, payload: snapshot })
      alive.push(port)
    } catch (e) {
      console.warn('[SW] Port send failed, removing:', e)
    }
  }
  state.connectedPorts = alive
}

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------

export function handlePdfDetected(payload, state, _compat) {
  state.activePdfUrl = payload.url
  broadcastState(state, state.connectedPorts)
}

export function handleAction(payload, state, _compat) {
  if (payload.type === 'PLAY')   state.playbackStatus = 'playing'
  if (payload.type === 'PAUSE')  state.playbackStatus = 'paused'
  if (payload.type === 'RESUME') state.playbackStatus = 'playing'
  if (payload.type === 'STOP')   state.playbackStatus = 'idle'
  broadcastState(state, state.connectedPorts)
}

export function handleChunkStarted(payload, state) {
  state.currentChunkIndex = payload.chunkIndex
  broadcastState(state, state.connectedPorts)
}

export function handleChunkEnded(payload, state) {
  state.currentChunkIndex = payload.chunkIndex
  broadcastState(state, state.connectedPorts)
}

export async function ensureOffscreen(state, compat) {
  if (state.offscreenOpen) return
  await compat.offscreen.create({
    url: 'src/offscreen/index.html',
    reasons: ['AUDIO_PLAYBACK'],
    justification: 'Web Speech API host for TTS',
  }).catch((e) => console.warn('[SW] offscreen.create failed:', e))
  state.offscreenOpen = true
}

export async function handleSpeakChunk(payload, state, compat) {
  await ensureOffscreen(state, compat)
  sendMessage(MSG_TYPES.SPEAK_CHUNK, payload, compat)
}

export async function handleStopSpeech(payload, state, compat) {
  sendMessage(MSG_TYPES.STOP_SPEECH, payload, compat)
  await compat.offscreen.close()
    .catch((e) => console.warn('[SW] offscreen.close failed:', e))
  state.offscreenOpen = false
}

// ---------------------------------------------------------------------------
// Dispatch table
// ---------------------------------------------------------------------------

export function buildDispatchTable(state, compat) {
  return {
    [MSG_TYPES.PDF_DETECTED]:  (payload) => handlePdfDetected(payload, state, compat),
    [MSG_TYPES.ACTION]:        (payload) => handleAction(payload, state, compat),
    [MSG_TYPES.SPEAK_CHUNK]:   (payload) => handleSpeakChunk(payload, state, compat),
    [MSG_TYPES.STOP_SPEECH]:   (payload) => handleStopSpeech(payload, state, compat),
    [MSG_TYPES.CHUNK_STARTED]: (payload) => handleChunkStarted(payload, state),
    [MSG_TYPES.CHUNK_ENDED]:   (payload) => handleChunkEnded(payload, state),
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

export async function startup(compat, stateRef) {
  // 1. Await DB
  let db
  try {
    db = await initDB()
  } catch (err) {
    console.error('[SW] IndexedDB init failed:', err)
    // continue with defaults
  }

  // 2. Hydrate from IndexedDB
  if (db) {
    try {
      const tx = db.transaction(['playbackStates', 'documents'], 'readonly')
      const allPlayback = await tx.objectStore('playbackStates').getAll()
      const allDocs     = await tx.objectStore('documents').getAll()

      if (allPlayback.length > 0) {
        const latest = allPlayback[allPlayback.length - 1]
        if (latest.status) stateRef.playbackStatus = latest.status
        if (typeof latest.currentChunkIndex === 'number') {
          stateRef.currentChunkIndex = latest.currentChunkIndex
        }
      }
      if (allDocs.length > 0) {
        const latest = allDocs[allDocs.length - 1]
        if (latest.url) stateRef.activePdfUrl = latest.url
      }
    } catch (err) {
      console.warn('[SW] IndexedDB hydration failed:', err)
    }
  }

  // 3. webNavigation listener
  compat.webNavigation.addListener((details) => {
    if (details.url?.toLowerCase().endsWith('.pdf')) {
      stateRef.activePdfUrl = details.url
      broadcastState(stateRef, stateRef.connectedPorts)
    }
  }, { url: [{ schemes: ['http', 'https'] }] })

  // 4. Message router
  const handlers = buildDispatchTable(stateRef, compat)
  onMessage((msg) => {
    const handler = handlers[msg.type]
    if (!handler) {
      console.warn('[SW] Unrecognised message type:', msg.type)
      return
    }
    handler(msg.payload)
  }, compat)

  // 5. Port registry
  compat.ports.onConnect((port) => {
    stateRef.connectedPorts.push(port)
    broadcastState(stateRef, stateRef.connectedPorts)
    port.onDisconnect.addListener(() => {
      stateRef.connectedPorts = stateRef.connectedPorts.filter((p) => p !== port)
    })
  })
}

// ---------------------------------------------------------------------------
// Bootstrap (only runs in real extension context, not in tests)
// ---------------------------------------------------------------------------

if (typeof chrome !== 'undefined' || typeof browser !== 'undefined') {
  const compat = BrowserCompat.init()
  startup(compat, appState)
}
