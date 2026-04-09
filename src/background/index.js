import { BrowserCompat } from '../shared/browser-compat.js'
import { MSG_TYPES, sendMessage, onMessage } from '../shared/message-bus.js'
import { initDB } from '../shared/db.js'
import { loadPdf } from '../content/pdf/loader.js'
import { extractText } from '../content/pdf/extractor.js'
import { chunkPages } from '../content/pdf/chunker.js'
import { hashArrayBuffer } from '../shared/hash.js'
import { appendMessage, getThread } from '../lib/db/chat.js'
import { assembleContext } from '../lib/ai/context.js'
import { streamAnswer } from '../lib/ai/service.js'

// ---------------------------------------------------------------------------
// AppState
// ---------------------------------------------------------------------------

export const DEFAULT_APP_STATE = {
  activePdfUrl:      null,
  playbackStatus:    'idle',   // 'idle' | 'playing' | 'paused' | 'ended'
  currentChunkIndex: 0,
  connectedPorts:    [],
  offscreenOpen:     false,
  // Phase 2 additions
  activeDocumentId:  null,
  parseStatus:       'idle',
  parseProgress:     null,
  // Phase 3 additions
  playbackRate:      1.0,      // clamped to [0.5, 3.0]
  pitch:             1.0,      // clamped to [0.5, 2.0]
  volume:            1.0,      // clamped to [0, 1]
  voiceId:           null,     // string | null — voiceURI of selected voice
  // Phase 4 additions
  chat:              { isStreaming: false, isMuted: false, pendingQuery: null },
}

export let appState = { ...DEFAULT_APP_STATE }
const parsingUrls = new Set()

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
    // Phase 3 additions
    playbackRate:      state.playbackRate,
    pitch:             state.pitch,
    volume:            state.volume,
    voiceId:           state.voiceId,
    // Phase 4 additions
    chat:              {
      isStreaming: state.chat.isStreaming,
      isMuted: state.chat.isMuted,
      pendingQuery: state.chat.pendingQuery
    },
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

export async function handleAction(payload, state, compat, db) {
  if (payload.type === 'SET_CHAT_MUTED') {
    handleSetChatMuted(payload, state)
  }
  if (payload.type === 'PLAY') {
    if (!state.activeDocumentId && state.activePdfUrl && db) {
      await parsePdfForPlayback(state.activePdfUrl, state, db, compat)
    }

    if (!state.activeDocumentId) {
      console.warn('[SW] PLAY ignored: no activeDocumentId (PDF not parsed/loaded yet)')
      state.playbackStatus = 'idle'
      broadcastState(state, state.connectedPorts)
      return
    }

    if (db) {
      const doc = await db.get('documents', state.activeDocumentId)
      if (!doc || !doc.chunkCount) {
        console.warn('[SW] PLAY ignored: active document has no playable chunks')
        state.playbackStatus = 'idle'
        broadcastState(state, state.connectedPorts)
        return
      }
    }

    state.playbackStatus = 'playing'
    const ready = await ensureOffscreen(state, compat)
    if (!ready) {
      console.warn('[SW] PLAY aborted: offscreen document did not become ready')
      state.playbackStatus = 'idle'
      broadcastState(state, state.connectedPorts)
      return
    }

    sendMessage(MSG_TYPES.SPEAK_CHUNK, {
      documentId:      state.activeDocumentId,
      startChunkIndex: state.currentChunkIndex,
      playbackRate:    state.playbackRate,
      pitch:           state.pitch,
      volume:          state.volume,
      voiceId:         state.voiceId,
    }, compat).catch((e) => console.warn('[SW] SPEAK_CHUNK delivery failed:', e))
  }
  if (payload.type === 'PAUSE') {
    state.playbackStatus = 'paused'
    sendMessage(MSG_TYPES.STOP_SPEECH, {}, compat)
      .catch((e) => console.warn('[SW] STOP_SPEECH delivery failed:', e))
  }
  if (payload.type === 'RESUME') state.playbackStatus = 'playing'
  if (payload.type === 'STOP')   state.playbackStatus = 'idle'

  if (payload.type === 'DELETE_DOCUMENT' && db) {
    const { documentId } = payload.data ?? {}
    if (documentId) {
      try {
        const tx = db.transaction(['documents', 'chunks', 'playbackStates'], 'readwrite')
        tx.objectStore('documents').delete(documentId)
        tx.objectStore('playbackStates').delete(documentId)
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

export async function parsePdfForPlayback(url, state, db, compat) {
  if (!url || !db) return
  if (parsingUrls.has(url)) return
  parsingUrls.add(url)

  try {
    await handlePdfParseStart({ url, title: null, pageCount: null }, state, db)

    const { arrayBuffer, pdf } = await loadPdf(url, undefined, compat)
    const fileHash = await hashArrayBuffer(arrayBuffer)
    const dedupResult = await handleDedupCheck({ fileHash }, db)
    if (dedupResult?.duplicate) {
      await handleLoadDocument({ documentId: dedupResult.documentId }, state, db)
      return
    }

    const meta = await pdf.getMetadata().catch(() => ({}))
    const title =
      meta?.info?.Title?.trim() ||
      url.split('/').pop()?.replace(/\.pdf$/i, '') ||
      'Untitled'
    const language = meta?.info?.Language || 'en'

    const pages = await extractText(pdf)
    for (let i = 0; i < pages.length; i++) {
      const pageNum = i + 1
      if (pageNum % 10 === 0) {
        handleParseProgress(
          { url, pagesProcessed: pageNum, totalPages: pdf.numPages },
          state
        )
      }
    }

    const documentId = crypto.randomUUID()
    const chunks = chunkPages(pages, documentId)
    await handlePdfParsed(
      {
        url,
        fileHash,
        title,
        pageCount: pdf.numPages,
        language,
        chunks,
      },
      state,
      db
    )
  } catch (err) {
    await handlePdfParseStart({ url, parseStatus: 'failed', error: err.message }, state, db)
  } finally {
    parsingUrls.delete(url)
  }
}

export function handleChunkStarted(payload, state) {
  state.currentChunkIndex = payload.chunkIndex
  broadcastState(state, state.connectedPorts)
}

export async function handleChunkEnded(payload, state, db) {
  state.currentChunkIndex = payload.chunkIndex
  broadcastState(state, state.connectedPorts)

  if (!db || !state.activeDocumentId) return
  try {
    const doc = await db.get('documents', state.activeDocumentId)
    const totalChunkCount = doc?.chunkCount ?? 1
    const record = {
      documentId:         state.activeDocumentId,
      currentChunkIndex:  payload.chunkIndex,
      currentOffsetChars: 0,
      playbackRate:       state.playbackRate,
      pitch:              state.pitch,
      volume:             state.volume,
      voiceId:            state.voiceId,
      completionPercent:  ((payload.chunkIndex + 1) / totalChunkCount) * 100,
      updatedAt:          Date.now(),
    }
    await db.put('playbackStates', record)
  } catch (err) {
    console.error('[SW] PlaybackState persistence failed:', err)
  }
}

export async function ensureOffscreen(state, compat) {
  if (!state.offscreenOpen) {
    try {
      await compat.offscreen.create({
        url: 'src/offscreen/index.html',
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Web Speech API host for TTS',
      })
      state.offscreenOpen = true
    } catch (e) {
      console.warn('[SW] offscreen.create failed:', e)
      state.offscreenOpen = false
      return false
    }
    // Give the offscreen document time to load and register its message listener.
    // chrome.runtime.sendMessage does not route SW→offscreen, so PING won't work.
    await new Promise((r) => setTimeout(r, 600))
  }
  return true
}

export async function handleSpeakChunk(payload, state, compat) {
  const ready = await ensureOffscreen(state, compat)
  if (!ready) {
    console.warn('[SW] SPEAK_CHUNK dropped: offscreen document not ready')
    return
  }
  sendMessage(MSG_TYPES.SPEAK_CHUNK, payload, compat)
}

export async function handleStopSpeech(payload, state, compat) {
  sendMessage(MSG_TYPES.STOP_SPEECH, payload, compat)
  await compat.offscreen.close()
    .catch((e) => console.warn('[SW] offscreen.close failed:', e))
  state.offscreenOpen = false
}

// ---------------------------------------------------------------------------
// Phase 3 handlers — playback controls
// ---------------------------------------------------------------------------

export function handlePlaybackEnded(payload, state) {
  state.playbackStatus = 'ended'
  broadcastState(state, state.connectedPorts)
}

export function handleSetVoice(payload, state, compat) {
  state.voiceId = payload.voiceId
  sendMessage(MSG_TYPES.SET_VOICE, payload, compat)
  broadcastState(state, state.connectedPorts)
}

export function handleSetRate(payload, state, compat) {
  state.playbackRate = Math.min(3.0, Math.max(0.5, payload.rate))
  sendMessage(MSG_TYPES.SET_RATE, { rate: state.playbackRate }, compat)
  broadcastState(state, state.connectedPorts)
}

export function handleSetPitch(payload, state, compat) {
  state.pitch = Math.min(2.0, Math.max(0.5, payload.pitch))
  sendMessage(MSG_TYPES.SET_PITCH, { pitch: state.pitch }, compat)
  broadcastState(state, state.connectedPorts)
}

export function handleSetVolume(payload, state, compat) {
  state.volume = Math.min(1.0, Math.max(0.0, payload.volume))
  sendMessage(MSG_TYPES.SET_VOLUME, { volume: state.volume }, compat)
  broadcastState(state, state.connectedPorts)
}

/**
 * Calculate chunk delta for a time-based skip.
 * delta = floor(seconds * playbackRate * 150wpm / 60s / avgWordsPerChunk)
 *
 * @param {number} seconds
 * @param {number} playbackRate
 * @param {number} [avgWordsPerChunk=150]
 * @returns {number}
 */
export function calcChunkDelta(seconds, playbackRate, avgWordsPerChunk = 150) {
  const wordsPerSecond = (150 * playbackRate) / 60
  return Math.max(1, Math.floor((seconds * wordsPerSecond) / avgWordsPerChunk))
}

export async function handleSkipForward(payload, state, compat, db) {
  const doc = db ? await db.get('documents', state.activeDocumentId) : null
  const lastIndex = doc ? doc.chunkCount - 1 : state.currentChunkIndex
  const delta = calcChunkDelta(payload.seconds ?? 10, state.playbackRate)
  state.currentChunkIndex = Math.min(lastIndex, state.currentChunkIndex + delta)
  if (state.playbackStatus === 'playing') {
    sendMessage(MSG_TYPES.SEEK_TO_CHUNK, { chunkIndex: state.currentChunkIndex }, compat)
  }
  broadcastState(state, state.connectedPorts)
}

export async function handleSkipBack(payload, state, compat) {
  const delta = calcChunkDelta(payload.seconds ?? 10, state.playbackRate)
  state.currentChunkIndex = Math.max(0, state.currentChunkIndex - delta)
  if (state.playbackStatus === 'playing') {
    sendMessage(MSG_TYPES.SEEK_TO_CHUNK, { chunkIndex: state.currentChunkIndex }, compat)
  }
  broadcastState(state, state.connectedPorts)
}

export function handleSeekToChunk(payload, state, compat) {
  state.currentChunkIndex = payload.chunkIndex
  if (state.playbackStatus === 'playing') {
    sendMessage(MSG_TYPES.SEEK_TO_CHUNK, payload, compat)
  }
  broadcastState(state, state.connectedPorts)
}

// ---------------------------------------------------------------------------
// Phase 4 handlers — AI Chat
// ---------------------------------------------------------------------------

export function handleSetChatMuted(payload, state) {
  state.chat.isMuted = payload.data.muted
  broadcastState(state, state.connectedPorts)
}

export async function handleAiQuery(payload, state, compat, db) {
  const broadcast = (type, data) => {
    const alive = []
    for (const port of state.connectedPorts) {
      try {
        port.postMessage({ type, payload: data })
        alive.push(port)
      } catch (e) {
        console.warn('[SW] Port send failed:', e)
      }
    }
    state.connectedPorts = alive
  }

  if (!state.activeDocumentId) {
    broadcast(MSG_TYPES.AI_RESPONSE_DONE, { error: 'no_active_document' })
    return
  }
  if (state.chat.isStreaming) {
    broadcast(MSG_TYPES.AI_RESPONSE_DONE, { error: 'query_in_progress' })
    return
  }

  const priorStatus = state.playbackStatus
  state.chat.isStreaming = true
  state.chat.pendingQuery = payload.query
  state.playbackStatus = 'ai_responding'
  broadcastState(state, state.connectedPorts)

  let sentenceBuffer = ''

  try {
    const timestamp = Date.now()
    if (db) {
      await appendMessage(db, state.activeDocumentId, {
        role: 'user',
        content: payload.query,
        timestamp,
        contextChunks: []
      })
    }

    const contextText = db ? await assembleContext(db, state.activeDocumentId, state.currentChunkIndex, payload.query) : ''
    const thread = db ? await getThread(db, state.activeDocumentId) : null
    const history = thread ? thread.messages : []
    const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' })

    const stream = streamAnswer({ query: payload.query, contextText, history, compat })
    let fullResponse = ''

    for await (const token of stream) {
      broadcast(MSG_TYPES.AI_RESPONSE_TOKEN, { token })
      fullResponse += token
      sentenceBuffer += token

      const segments = [...segmenter.segment(sentenceBuffer)]
      if (segments.length > 1) {
        const completeSentence = segments[0].segment
        sentenceBuffer = segments.slice(1).map(s => s.segment).join('')
        if (!state.chat.isMuted) {
          sendMessage(MSG_TYPES.SPEAK_AI_SENTENCE, { sentence: completeSentence }, compat)
            .catch((e) => console.warn('[SW] SPEAK_AI_SENTENCE delivery failed:', e))
        }
      }
    }

    if (sentenceBuffer.trim().length > 0 && !state.chat.isMuted) {
      sendMessage(MSG_TYPES.SPEAK_AI_SENTENCE, { sentence: sentenceBuffer }, compat)
        .catch((e) => console.warn('[SW] SPEAK_AI_SENTENCE delivery failed:', e))
    }

    if (db) {
      await appendMessage(db, state.activeDocumentId, {
        role: 'assistant',
        content: fullResponse,
        timestamp: Date.now(),
        contextChunks: []
      })
    }

    state.chat.isStreaming = false
    state.chat.pendingQuery = null
    state.playbackStatus = priorStatus
    broadcastState(state, state.connectedPorts)
    broadcast(MSG_TYPES.AI_RESPONSE_DONE, {})

    if (priorStatus === 'playing') {
      sendMessage(MSG_TYPES.SPEAK_CHUNK, {
        documentId: state.activeDocumentId,
        startChunkIndex: state.currentChunkIndex,
        playbackRate: state.playbackRate,
        pitch: state.pitch,
        volume: state.volume,
        voiceId: state.voiceId,
      }, compat).catch((e) => console.warn('[SW] SPEAK_CHUNK delivery failed:', e))
    }
  } catch (err) {
    state.chat.isStreaming = false
    state.chat.pendingQuery = null
    state.playbackStatus = priorStatus
    broadcastState(state, state.connectedPorts)
    broadcast(MSG_TYPES.AI_RESPONSE_DONE, { error: err.message })
  }
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
    [MSG_TYPES.CHUNK_ENDED]:     (payload) => handleChunkEnded(payload, state, db),
    [MSG_TYPES.PDF_PARSE_START]: (payload) => handlePdfParseStart(payload, state, db),
    [MSG_TYPES.PARSE_PROGRESS]:  (payload) => handleParseProgress(payload, state),
    [MSG_TYPES.PDF_PARSED]:      (payload) => handlePdfParsed(payload, state, db),
    [MSG_TYPES.LOAD_DOCUMENT]:   (payload) => handleLoadDocument(payload, state, db),
    [MSG_TYPES.DEDUP_CHECK]:     (payload) => handleDedupCheck(payload, db),
    [MSG_TYPES.FETCH_PDF]:       (payload) => handleFetchPdf(payload),
    [MSG_TYPES.PING]:            () => ({ pong: true }),
    // Phase 3 additions
    [MSG_TYPES.PLAYBACK_ENDED]:  (payload) => handlePlaybackEnded(payload, state),
    [MSG_TYPES.SET_VOICE]:       (payload) => handleSetVoice(payload, state, compat),
    [MSG_TYPES.SET_RATE]:        (payload) => handleSetRate(payload, state, compat),
    [MSG_TYPES.SET_PITCH]:       (payload) => handleSetPitch(payload, state, compat),
    [MSG_TYPES.SET_VOLUME]:      (payload) => handleSetVolume(payload, state, compat),
    [MSG_TYPES.SKIP_FORWARD]:    (payload) => handleSkipForward(payload, state, compat, db),
    [MSG_TYPES.SKIP_BACK]:       (payload) => handleSkipBack(payload, state, compat),
    [MSG_TYPES.SEEK_TO_CHUNK]:   (payload) => handleSeekToChunk(payload, state, compat),
    // Phase 4 additions
    [MSG_TYPES.AI_QUERY]:        (payload) => handleAiQuery(payload, state, compat, db),
    [MSG_TYPES.SPEAK_AI_SENTENCE]: (payload) => sendMessage(MSG_TYPES.SPEAK_AI_SENTENCE, payload, compat).catch(e => console.warn(e)),
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
        // Phase 3: restore audio settings
        if (typeof latest.playbackRate === 'number') stateRef.playbackRate = latest.playbackRate
        if (typeof latest.pitch        === 'number') stateRef.pitch        = latest.pitch
        if (typeof latest.volume       === 'number') stateRef.volume       = latest.volume
        if (latest.voiceId != null)                  stateRef.voiceId      = latest.voiceId
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
