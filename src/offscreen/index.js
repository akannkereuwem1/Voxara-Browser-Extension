import { BrowserCompat } from '../shared/browser-compat.js'
import { MSG_TYPES, onMessage, sendMessage } from '../shared/message-bus.js'
import { initDB } from '../shared/db.js'
import { createVoiceManager } from '../lib/audio/voices.js'

// ---------------------------------------------------------------------------
// Web Speech API availability check
// ---------------------------------------------------------------------------

if (typeof window !== 'undefined' && !window.speechSynthesis) {
  console.warn('[Offscreen] window.speechSynthesis is not available in this environment')
}

// ---------------------------------------------------------------------------
// Buffer Manager
// ---------------------------------------------------------------------------

/**
 * Create a Buffer Manager instance.
 *
 * Maintains a ChunkQueue with up to 3 lookahead chunks, speaks utterances
 * sequentially, and emits CHUNK_STARTED / CHUNK_ENDED / PLAYBACK_ENDED events.
 *
 * @param {SpeechSynthesis} synth
 * @param {object} db - idb database instance
 * @param {function} send - fn(type, payload)
 * @param {object} settings - { playbackRate, pitch, volume, voiceId }
 * @returns {object} handler methods
 */
export function createBufferManager(synth, db, send, settings) {
  let queue = []
  let currentIndex = 0
  let documentId = null
  let totalChunks = 0

  let rate    = settings.playbackRate ?? 1.0
  let pitch   = settings.pitch        ?? 1.0
  let volume  = settings.volume       ?? 1.0
  let voiceURI = settings.voiceId     ?? null

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

  async function handleSpeakChunk(payload) {
    documentId = payload.documentId
    const startIndex = payload.startChunkIndex ?? 0

    // Load total chunk count for refill calculations
    const doc = await db.get('documents', documentId)
    totalChunks = doc?.chunkCount ?? 0

    // Load first chunk immediately — critical path for 800ms budget
    const first = await loadChunks(documentId, startIndex, 1)
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
  }
}

// ---------------------------------------------------------------------------
// Register handlers
// ---------------------------------------------------------------------------

/**
 * Register all Phase 3 message handlers against a compat instance.
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
    if (msg.type === MSG_TYPES.SPEAK_CHUNK)   return bm.handleSpeakChunk(msg.payload)
    if (msg.type === MSG_TYPES.STOP_SPEECH)   return bm.handleStopSpeech()
    if (msg.type === MSG_TYPES.SEEK_TO_CHUNK) return bm.handleSeekToChunk(msg.payload)
    if (msg.type === MSG_TYPES.SET_RATE)      return bm.handleSetRate(msg.payload)
    if (msg.type === MSG_TYPES.SET_PITCH)     return bm.handleSetPitch(msg.payload)
    if (msg.type === MSG_TYPES.SET_VOLUME)    return bm.handleSetVolume(msg.payload)
    if (msg.type === MSG_TYPES.SET_VOICE)     return bm.handleSetVoice(msg.payload)
  }, compat)
}

// ---------------------------------------------------------------------------
// Bootstrap (browser context only)
// ---------------------------------------------------------------------------

if (typeof chrome !== 'undefined' || typeof browser !== 'undefined') {
  const compat = BrowserCompat.init()
  initDB().then((db) => {
    const vm = createVoiceManager(window.speechSynthesis, compat.storage ?? chrome.storage.sync)
    vm.init()
    registerHandlers(compat, window.speechSynthesis, db, {
      playbackRate: 1.0, pitch: 1.0, volume: 1.0, voiceId: null,
    })
  }).catch((err) => console.error('[Offscreen] DB init failed:', err))
}
