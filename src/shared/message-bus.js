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
  const wrappedHandler = (msg) => {
    const isValid =
      typeof msg.type === 'string' &&
      msg.payload !== null &&
      typeof msg.payload === 'object' &&
      typeof msg.requestId === 'string' &&
      msg.requestId.length > 0

    if (!isValid) {
      console.warn('[MessageBus] Discarded malformed message:', msg)
      return
    }

    handler(msg)
  }

  compat.runtime.onMessage(wrappedHandler)
}
