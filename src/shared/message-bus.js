/**
 * Message Bus
 *
 * Typed message-passing helpers for inter-context communication.
 * All messages use a validated envelope: { type, payload, requestId }
 */

// ---------------------------------------------------------------------------
// 6.1 — MSG_TYPES frozen enum
// ---------------------------------------------------------------------------

export const MSG_TYPES = Object.freeze({
  // Playback
  PLAY_CHUNK: 'PLAY_CHUNK',
  PAUSE_PLAYBACK: 'PAUSE_PLAYBACK',
  RESUME_PLAYBACK: 'RESUME_PLAYBACK',
  CHUNK_STARTED: 'CHUNK_STARTED',
  CHUNK_ENDED: 'CHUNK_ENDED',
  // AI
  AI_QUERY: 'AI_QUERY',
  AI_RESPONSE: 'AI_RESPONSE',
  // State
  STATE_UPDATE: 'STATE_UPDATE',
  ACTION: 'ACTION',
  // Voice
  VOICE_CHANGE: 'VOICE_CHANGE',
  // PDF detection
  PDF_DETECTED: 'PDF_DETECTED',
  // Speech synthesis
  SPEAK_CHUNK: 'SPEAK_CHUNK',
  STOP_SPEECH: 'STOP_SPEECH',
  // Phase 2 — PDF parsing pipeline
  PDF_PARSE_START: 'PDF_PARSE_START',
  PARSE_PROGRESS:  'PARSE_PROGRESS',
  PDF_PARSED:      'PDF_PARSED',
  LOAD_DOCUMENT:   'LOAD_DOCUMENT',
  DEDUP_CHECK:     'DEDUP_CHECK',
  FETCH_PDF:       'FETCH_PDF',
  PING:            'PING',
  // Phase 3 — Audio Engine
  PLAYBACK_ENDED: 'PLAYBACK_ENDED',
  SET_VOICE:      'SET_VOICE',
  SET_RATE:       'SET_RATE',
  SET_PITCH:      'SET_PITCH',
  SET_VOLUME:     'SET_VOLUME',
  SKIP_FORWARD:   'SKIP_FORWARD',
  SKIP_BACK:      'SKIP_BACK',
  SEEK_TO_CHUNK:  'SEEK_TO_CHUNK',
})

// ---------------------------------------------------------------------------
// 6.2 — sendMessage(type, payload, compat)
// ---------------------------------------------------------------------------

/**
 * Construct a validated envelope and dispatch it via compat.runtime.sendMessage.
 * @param {string} type - One of MSG_TYPES values
 * @param {object} payload - Message-specific data
 * @param {import('./browser-compat.js').CompatAPI} compat - Unified browser API
 * @returns {Promise<any>}
 */
export async function sendMessage(type, payload, compat) {
  const requestId = crypto.randomUUID()
  const envelope = { type, payload, requestId }
  return compat.runtime.sendMessage(envelope)
}

// ---------------------------------------------------------------------------
// 6.3 — onMessage(handler, compat)
// ---------------------------------------------------------------------------

/**
 * Register a message listener that validates the envelope before invoking handler.
 * Malformed messages are discarded with a console warning.
 * @param {(msg: object) => void} handler - Called with valid envelopes only
 * @param {import('./browser-compat.js').CompatAPI} compat - Unified browser API
 */
export function onMessage(handler, compat) {
  const wrappedHandler = (msg, _sender, sendResponse) => {
    const respond = typeof sendResponse === 'function' ? sendResponse : () => {}

    const isValid =
      typeof msg.type === 'string' &&
      msg.payload !== null &&
      typeof msg.payload === 'object' &&
      typeof msg.requestId === 'string' &&
      msg.requestId.length > 0

    if (!isValid) {
      console.warn('[MessageBus] Discarded malformed message:', msg)
      return false
    }

    const result = handler(msg)

    // If the handler returns a Promise, keep the channel open and send the
    // resolved value back via sendResponse (required for Chrome MV3).
    if (result && typeof result.then === 'function') {
      result.then((value) => {
        respond(value !== undefined ? value : null)
      }).catch((err) => {
        console.error('[MessageBus] Handler error:', err)
        respond(null)
      })
      return true // keep message channel open for async response
    }

    // Synchronous return value — always respond to close the channel cleanly
    respond(result !== undefined ? result : null)
    return false
  }

  compat.runtime.onMessage(wrappedHandler)
}
