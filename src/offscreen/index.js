import { BrowserCompat } from '../shared/browser-compat.js'
import { MSG_TYPES, onMessage, sendMessage } from '../shared/message-bus.js'

// ---------------------------------------------------------------------------
// Web Speech API availability check
// ---------------------------------------------------------------------------

if (typeof window !== 'undefined' && !window.speechSynthesis) {
  console.warn('[Offscreen] window.speechSynthesis is not available in this environment')
}

// ---------------------------------------------------------------------------
// Exported core logic (testable without browser globals)
// ---------------------------------------------------------------------------

/**
 * Handle a SPEAK_CHUNK message.
 * Creates a SpeechSynthesisUtterance, wires lifecycle events, and speaks it.
 *
 * @param {object} payload - { text: string, chunkIndex: number }
 * @param {SpeechSynthesis} synth - speechSynthesis instance
 * @param {function} send - sendMessage-compatible fn(type, payload)
 */
export function handleSpeakChunk(payload, synth, send) {
  const { text, chunkIndex } = payload
  const utterance = new SpeechSynthesisUtterance(text)

  utterance.onstart = () => send(MSG_TYPES.CHUNK_STARTED, { chunkIndex })
  utterance.onend = () => send(MSG_TYPES.CHUNK_ENDED, { chunkIndex })

  synth.speak(utterance)
}

/**
 * Handle a STOP_SPEECH message.
 * @param {SpeechSynthesis} synth
 */
export function handleStopSpeech(synth) {
  synth.cancel()
}

/**
 * Register message handlers against a compat instance.
 * Exported for testing.
 *
 * @param {object} compat - BrowserCompat API
 * @param {SpeechSynthesis} synth
 */
export function registerHandlers(compat, synth) {
  onMessage((msg) => {
    if (msg.type === MSG_TYPES.SPEAK_CHUNK) {
      handleSpeakChunk(msg.payload, synth, (type, payload) => sendMessage(type, payload, compat))
    } else if (msg.type === MSG_TYPES.STOP_SPEECH) {
      handleStopSpeech(synth)
    }
  }, compat)
}

// ---------------------------------------------------------------------------
// Bootstrap (browser context only)
// ---------------------------------------------------------------------------

if (typeof chrome !== 'undefined' || typeof browser !== 'undefined') {
  const compat = BrowserCompat.init()
  registerHandlers(compat, window.speechSynthesis)
}
