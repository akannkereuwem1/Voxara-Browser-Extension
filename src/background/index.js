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

export async function handleAction(payload, state, _compat, db) {
  if (payload.type === 'PLAY')   state.playbackStatus = 'playing'
  if (payload.type === 'PAUSE')  state.playbackStatus = 'paused'
  if (payload.type === 'RESUME') state.playbackStatus = 'playing'
  if (payload.type === 'STOP')   state.playbackStatus = 'idle'

  if (payload.type === 'DELETE_DOCUMENT' && db) {
    const { documentId } = payload.data ?? {}
    if (documentId) {
      try {
        const tx = db.transaction(['documents', 'chunks'], 'readwrite')
        tx.objectStore('documents').delete(documentId)
        const allChunks = await tx.objectStore('chunks').index('documentId').getAllKeys(documentId)
        for (const key of allChunks) tx.objectStore('chunks').delete(key)
        await tx.done
        if (state.activeDocumentId === documentId) {
          state.activeDocumentId = null
          state.parseStatus = 'idle'
        }
      } catch (err) {
        console.error('[SW] DELETE_DOCUMENT failed:', err)
      }
    }
  }

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
// Phase 2 handlers
// ---------------------------------------------------------------------------

export async function handlePdfParseStart(payload, state, db) {
  if (payload.parseStatus === 'failed') {
    // Update the existing pending record for this URL to failed
    if (db) {
      try {
        const existing = await db.getFromIndex('documents', 'url', payload.url)
        if (existing && existing.parseStatus === 'pending') {
          existing.parseStatus = 'failed'
          await db.put('documents', existing)
        }
      } catch (_) { /* index may not exist */ }
    }
    state.parseStatus = 'failed'
    broadcastState(state, state.connectedPorts)
    return
  }

  // Check if a pending record already exists for this URL — reuse it to avoid duplicates
  let doc = null
  if (db) {
    try {
      const existing = await db.getFromIndex('documents', 'url', payload.url)
      if (existing && existing.parseStatus === 'pending') {
        doc = existing
      }
    } catch (_) { /* index may not exist */ }
  }

  if (!doc) {
    doc = {
      id: crypto.randomUUID(),
      url: payload.url,
      fileHash: null,
      title: payload.title ?? null,
      pageCount: payload.pageCount ?? null,
      chunkCount: 0,
      language: 'en',
      parseStatus: 'pending',
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
      sizeBytesEstimate: 0,
    }
  }

  if (db) await db.put('documents', doc)
  state.parseStatus = 'pending'
  state.parseProgress = null
  broadcastState(state, state.connectedPorts)
}

export function handleParseProgress(payload, state) {
  state.parseProgress = {
    pagesProcessed: payload.pagesProcessed,
    totalPages: payload.totalPages,
  }
  broadcastState(state, state.connectedPorts)
}

export async function handlePdfParsed(payload, state, db) {
  try {
    const docId = payload.chunks?.[0]?.documentId ?? crypto.randomUUID()
    const doc = {
      id: docId,
      url: payload.url,
      fileHash: payload.fileHash,
      title: payload.title,
      pageCount: payload.pageCount,
      chunkCount: payload.chunks.length,
      language: payload.language ?? 'en',
      parseStatus: 'complete',
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
      sizeBytesEstimate: payload.chunks.reduce((s, c) => s + c.text.length * 2, 0),
    }
    if (db) {
      const tx = db.transaction(['documents', 'chunks'], 'readwrite')
      tx.objectStore('documents').put(doc)
      for (const chunk of payload.chunks) {
        tx.objectStore('chunks').put(chunk)
      }
      await tx.done
    }
    state.parseStatus = 'complete'
    state.parseProgress = null
    state.activeDocumentId = docId
  } catch (err) {
    console.error('[SW] IndexedDB write failed:', err)
    state.parseStatus = 'failed'
  }
  broadcastState(state, state.connectedPorts)
}

export async function handleLoadDocument(payload, state, db) {
  if (db) {
    const doc = await db.get('documents', payload.documentId)
    if (doc) {
      doc.lastOpenedAt = Date.now()
      await db.put('documents', doc)
      state.activeDocumentId = doc.id
      state.activePdfUrl = doc.url
    } else {
      console.warn('[SW] LOAD_DOCUMENT: documentId not found:', payload.documentId)
    }
  }
  broadcastState(state, state.connectedPorts)
}

export async function handleDedupCheck(payload, db) {
  if (!db) return { duplicate: false }
  try {
    const existing = await db.getFromIndex('documents', 'fileHash', payload.fileHash)
    if (existing && existing.parseStatus === 'complete') {
      return { duplicate: true, documentId: existing.id }
    }
  } catch (_) { /* index may not exist yet */ }
  return { duplicate: false }
}

export async function handleFetchPdf(payload) {
  try {
    const response = await fetch(payload.url)
    if (!response.ok) {
      return { error: `HTTP ${response.status}` }
    }
    const arrayBuffer = await response.arrayBuffer()
    // Transfer as Uint8Array — ArrayBuffer is not directly cloneable through sendMessage
    return { bytes: Array.from(new Uint8Array(arrayBuffer)) }
  } catch (err) {
    return { error: err.message }
  }
}

// ---------------------------------------------------------------------------
// Dispatch table
// ---------------------------------------------------------------------------

export function buildDispatchTable(state, compat, db) {
  return {
    [MSG_TYPES.PDF_DETECTED]:    (payload) => handlePdfDetected(payload, state, compat),
    [MSG_TYPES.ACTION]:          (payload) => handleAction(payload, state, compat, db),
    [MSG_TYPES.SPEAK_CHUNK]:     (payload) => handleSpeakChunk(payload, state, compat),
    [MSG_TYPES.STOP_SPEECH]:     (payload) => handleStopSpeech(payload, state, compat),
    [MSG_TYPES.CHUNK_STARTED]:   (payload) => handleChunkStarted(payload, state),
    [MSG_TYPES.CHUNK_ENDED]:     (payload) => handleChunkEnded(payload, state),
    [MSG_TYPES.PDF_PARSE_START]: (payload) => handlePdfParseStart(payload, state, db),
    [MSG_TYPES.PARSE_PROGRESS]:  (payload) => handleParseProgress(payload, state),
    [MSG_TYPES.PDF_PARSED]:      (payload) => handlePdfParsed(payload, state, db),
    [MSG_TYPES.LOAD_DOCUMENT]:   (payload) => handleLoadDocument(payload, state, db),
    [MSG_TYPES.DEDUP_CHECK]:     (payload) => handleDedupCheck(payload, db),
    [MSG_TYPES.FETCH_PDF]:       (payload) => handleFetchPdf(payload),
    [MSG_TYPES.PING]:            () => ({ pong: true }),
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
  const handlers = buildDispatchTable(stateRef, compat, db)
  onMessage((msg) => {
    const handler = handlers[msg.type]
    if (!handler) {
      console.warn('[SW] Unrecognised message type:', msg.type)
      return
    }
    return handler(msg.payload)
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
