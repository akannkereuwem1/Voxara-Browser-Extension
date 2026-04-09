import { BrowserCompat } from '../shared/browser-compat.js'
import { MSG_TYPES, onMessage, sendMessage } from '../shared/message-bus.js'
import { initDB } from '../shared/db.js'

// ---------------------------------------------------------------------------
// Web Speech API availability check
// ---------------------------------------------------------------------------

if (typeof window !== 'undefined' && !window.speechSynthesis) {
  console.warn('[Offscreen] window.speechSynthesis is not available in this environment')
}

// ---------------------------------------------------------------------------
// Buffer Manager
// Replaces the old single-utterance handleSpeakChunk / handleStopSpeech.
// ---------------------------------------------------------------------------

/**
 * Create a Buffer Manager instance.
 *
 * @param {SpeechSynthesis} synth - window.speechSynthesis
 * @param {object} db - idb database instance
 * @param {function} send - fn(type, payload) — sends a message to the Service Worker
 * @param {object} settings - { playbackRate, pitch, volume, voiceId }
 */
export function createBufferManager(synth, db, send, settings) {
  /** @type {Array<{id:string, documentId:string, sequenceIndex:number, text:string}>} */
  let queue = []
  let aiQueue = []
  let currentIndex = 0
  let documentId = null
  let totalChunks = 0

  // Internal settings — mutated by SET_* handlers; take effect on next utterance
  let rate     = settings?.playbackRate ?? 1.0
  let pitch    = settings?.pitch        ?? 1.0
  let volume   = settings?.volume       ?? 1.0
  let voiceURI = settings?.voiceId      ?? null

  async function loadChunks(docId, fromIndex, count = 4) {
    const all = await db.getAllFromIndex('chunks', 'documentId', docId)
    all.sort((a, b) => a.sequenceIndex - b.sequenceIndex)
    return all.slice(fromIndex, fromIndex + count)
  }

  function applySettings(utterance) {
    utterance.rate   = rate
    utterance.pitch  = pitch
    utterance.volume = volume
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      const voice = window.speechSynthesis.getVoices().find((v) => v.voiceURI === voiceURI)
      if (voice) utterance.voice = voice
    } else if (synth.getVoices) {
      const voice = synth.getVoices().find((v) => v.voiceURI === voiceURI)
      if (voice) utterance.voice = voice
    }
  }

  function speakNext() {
    if (!queue.length) return

    const chunk = queue[0]
    const utterance = new SpeechSynthesisUtterance(chunk.text)
    applySettings(utterance)

    utterance.onstart = () => {
      send(MSG_TYPES.CHUNK_STARTED, { chunkIndex: chunk.sequenceIndex })
    }

    utterance.onend = async () => {
      send(MSG_TYPES.CHUNK_ENDED, { chunkIndex: chunk.sequenceIndex })
      queue.shift()
      currentIndex = chunk.sequenceIndex + 1

      // Refill lookahead if below 3 and more chunks exist
      if (queue.length < 3 && currentIndex + queue.length < totalChunks) {
        const refillFrom = currentIndex + queue.length
        const newChunks = await loadChunks(documentId, refillFrom, 3 - queue.length)
        queue.push(...newChunks)
      }

      if (queue.length > 0) {
        speakNext()
      } else {
        send(MSG_TYPES.PLAYBACK_ENDED, {})
      }
    }

    synth.speak(utterance)
  }

  function speakNextAi() {
    if (!aiQueue.length) return
    const utterance = new SpeechSynthesisUtterance(aiQueue[0])
    applySettings(utterance)
    utterance.onend = () => {
      aiQueue.shift()
      speakNextAi()
    }
    synth.speak(utterance)
  }

  function handleSpeakAiSentence(payload) {
    aiQueue.push(payload.sentence)
    if (aiQueue.length === 1) {
      speakNextAi()
    }
  }

  async function handleSpeakChunk(payload) {
    documentId = payload.documentId
    const startIndex = payload.startChunkIndex ?? 0

    if (!documentId) {
      console.warn('[Offscreen] SPEAK_CHUNK ignored: missing documentId')
      send(MSG_TYPES.PLAYBACK_ENDED, {})
      return
    }

    // Load total chunk count for refill calculations
    const doc = await db.get('documents', documentId)
    totalChunks = doc?.chunkCount ?? 0

    if (totalChunks <= 0) {
      console.warn('[Offscreen] SPEAK_CHUNK ignored: document has zero chunks')
      send(MSG_TYPES.PLAYBACK_ENDED, {})
      return
    }

    // Load first chunk immediately and speak before loading lookahead
    const first = await loadChunks(documentId, startIndex, 1)
    if (!first.length) {
      send(MSG_TYPES.PLAYBACK_ENDED, {})
      return
    }
    queue = first
    currentIndex = startIndex
    speakNext()

    // Load lookahead asynchronously — does NOT block first utterance
    const lookahead = await loadChunks(documentId, startIndex + 1, 3)
    queue.push(...lookahead)
  }

  function handleStopSpeech() {
    synth.cancel()
    queue = []
    aiQueue = []
    currentIndex = 0
  }

  async function handleSeekToChunk(payload) {
    synth.cancel()
    queue = []
    currentIndex = payload.chunkIndex
    const chunks = await loadChunks(documentId, currentIndex, 4)
    queue = chunks
    speakNext()
  }

  function handleSetRate(payload)   { rate     = payload.rate    }
  function handleSetPitch(payload)  { pitch    = payload.pitch   }
  function handleSetVolume(payload) { volume   = payload.volume  }
  function handleSetVoice(payload)  { voiceURI = payload.voiceId }

  return {
    handleSpeakChunk,
    handleStopSpeech,
    handleSeekToChunk,
    handleSetRate,
    handleSetPitch,
    handleSetVolume,
    handleSetVoice,
    handleSpeakAiSentence,
  }
}

// ---------------------------------------------------------------------------
// Register all Phase 3 message handlers
// ---------------------------------------------------------------------------

/**
 * Register message handlers against a compat instance.
 * Exported for testing.
 *
 * @param {object} compat - BrowserCompat API
 * @param {SpeechSynthesis} synth
 * @param {object} db - idb database instance
 * @param {object} initialSettings
 */
export function registerHandlers(compat, synth, db, initialSettings = {}) {
  const send = (type, payload) => sendMessage(type, payload, compat)
  const bm = createBufferManager(synth, db, send, initialSettings)

  onMessage((msg) => {
    if (msg.type === MSG_TYPES.PING)        return { pong: true }
    if (msg.type === MSG_TYPES.SPEAK_CHUNK)   return bm.handleSpeakChunk(msg.payload)
    if (msg.type === MSG_TYPES.STOP_SPEECH)   return bm.handleStopSpeech()
    if (msg.type === MSG_TYPES.SEEK_TO_CHUNK) return bm.handleSeekToChunk(msg.payload)
    if (msg.type === MSG_TYPES.SET_RATE)      return bm.handleSetRate(msg.payload)
    if (msg.type === MSG_TYPES.SET_PITCH)     return bm.handleSetPitch(msg.payload)
    if (msg.type === MSG_TYPES.SET_VOLUME)    return bm.handleSetVolume(msg.payload)
    if (msg.type === MSG_TYPES.SET_VOICE)     return bm.handleSetVoice(msg.payload)
    if (msg.type === MSG_TYPES.SPEAK_AI_SENTENCE) return bm.handleSpeakAiSentence(msg.payload)
  }, compat)
}

// ---------------------------------------------------------------------------
// Bootstrap (browser context only)
// ---------------------------------------------------------------------------

if (typeof chrome !== 'undefined' || typeof browser !== 'undefined') {
  ;(async () => {
    const compat = BrowserCompat.init()
    let db = null
    try {
      db = await initDB()
    } catch (err) {
      console.warn('[Offscreen] initDB failed:', err)
    }
    registerHandlers(compat, window.speechSynthesis, db, {})
  })()
}
