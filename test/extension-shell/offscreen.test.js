// Feature: extension-shell, Property 19: SPEAK_CHUNK triggers speechSynthesis.speak with correct text
// Feature: extension-shell, Property 20: Utterance lifecycle sends CHUNK_STARTED and CHUNK_ENDED

import { describe, it, expect, vi } from 'vitest'
import * as fc from 'fast-check'
import { handleSpeakChunk, handleStopSpeech, registerHandlers } from '../../src/offscreen/index.js'
import { MSG_TYPES } from '../../src/shared/message-bus.js'

// ---------------------------------------------------------------------------
// SpeechSynthesisUtterance stub
// ---------------------------------------------------------------------------

class FakeUtterance {
  constructor(text) {
    this.text = text
    this.onstart = null
    this.onend = null
  }
}

// Install globally so handleSpeakChunk can use `new SpeechSynthesisUtterance`
globalThis.SpeechSynthesisUtterance = FakeUtterance

// ---------------------------------------------------------------------------
// Fake speechSynthesis
// ---------------------------------------------------------------------------

function makeSynth() {
  const spoken = []
  return {
    spoken,
    speak: vi.fn((utterance) => spoken.push(utterance)),
    cancel: vi.fn(),
  }
}

// ---------------------------------------------------------------------------
// Property 19: SPEAK_CHUNK triggers speechSynthesis.speak with correct text
// ---------------------------------------------------------------------------

describe('Property 19: SPEAK_CHUNK triggers speechSynthesis.speak with correct text', () => {
  it('property: speak is called with an utterance whose text matches payload.text', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.integer({ min: 0, max: 999 }), (text, chunkIndex) => {
        const synth = makeSynth()
        const send = vi.fn()

        handleSpeakChunk({ text, chunkIndex }, synth, send)

        expect(synth.speak).toHaveBeenCalledOnce()
        const utterance = synth.spoken[0]
        expect(utterance).toBeInstanceOf(FakeUtterance)
        expect(utterance.text).toBe(text)
      }),
      { numRuns: 100 }
    )
  })

  it('property: each SPEAK_CHUNK call produces exactly one speak() call', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 5 }),
        (texts) => {
          const synth = makeSynth()
          const send = vi.fn()

          texts.forEach((text, i) => handleSpeakChunk({ text, chunkIndex: i }, synth, send))

          expect(synth.speak).toHaveBeenCalledTimes(texts.length)
          synth.spoken.forEach((u, i) => expect(u.text).toBe(texts[i]))
        }
      ),
      { numRuns: 50 }
    )
  })

  it('STOP_SPEECH calls synth.cancel()', () => {
    const synth = makeSynth()
    handleStopSpeech(synth)
    expect(synth.cancel).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// Property 20: Utterance lifecycle sends CHUNK_STARTED and CHUNK_ENDED
// ---------------------------------------------------------------------------

describe('Property 20: Utterance lifecycle sends CHUNK_STARTED and CHUNK_ENDED', () => {
  it('property: onstart fires CHUNK_STARTED with correct chunkIndex', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.integer({ min: 0, max: 999 }), (text, chunkIndex) => {
        const synth = makeSynth()
        const send = vi.fn()

        handleSpeakChunk({ text, chunkIndex }, synth, send)
        const utterance = synth.spoken[0]

        // Simulate browser firing onstart
        utterance.onstart()

        expect(send).toHaveBeenCalledWith(MSG_TYPES.CHUNK_STARTED, { chunkIndex })
      }),
      { numRuns: 100 }
    )
  })

  it('property: onend fires CHUNK_ENDED with correct chunkIndex', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.integer({ min: 0, max: 999 }), (text, chunkIndex) => {
        const synth = makeSynth()
        const send = vi.fn()

        handleSpeakChunk({ text, chunkIndex }, synth, send)
        const utterance = synth.spoken[0]

        // Simulate browser firing onend
        utterance.onend()

        expect(send).toHaveBeenCalledWith(MSG_TYPES.CHUNK_ENDED, { chunkIndex })
      }),
      { numRuns: 100 }
    )
  })

  it('property: onstart and onend both fire for the same chunkIndex', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.integer({ min: 0, max: 999 }), (text, chunkIndex) => {
        const synth = makeSynth()
        const send = vi.fn()

        handleSpeakChunk({ text, chunkIndex }, synth, send)
        const utterance = synth.spoken[0]

        utterance.onstart()
        utterance.onend()

        expect(send).toHaveBeenCalledTimes(2)
        expect(send).toHaveBeenNthCalledWith(1, MSG_TYPES.CHUNK_STARTED, { chunkIndex })
        expect(send).toHaveBeenNthCalledWith(2, MSG_TYPES.CHUNK_ENDED, { chunkIndex })
      }),
      { numRuns: 100 }
    )
  })

  it('onstart and onend are not called before browser fires them', () => {
    const synth = makeSynth()
    const send = vi.fn()

    handleSpeakChunk({ text: 'hello', chunkIndex: 0 }, synth, send)

    // No lifecycle events fired yet
    expect(send).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// registerHandlers integration
// ---------------------------------------------------------------------------

describe('registerHandlers: routes messages to correct handlers', () => {
  it('SPEAK_CHUNK message triggers speak', () => {
    const msgListeners = []
    const compat = {
      runtime: {
        sendMessage: vi.fn(() => Promise.resolve()),
        onMessage: vi.fn((fn) => msgListeners.push(fn)),
      },
    }
    const synth = makeSynth()

    registerHandlers(compat, synth)

    // Simulate a valid SPEAK_CHUNK envelope arriving
    const envelope = {
      type: MSG_TYPES.SPEAK_CHUNK,
      payload: { text: 'Hello world', chunkIndex: 3 },
      requestId: 'test-id',
    }
    msgListeners.forEach((fn) => fn(envelope))

    expect(synth.speak).toHaveBeenCalledOnce()
    expect(synth.spoken[0].text).toBe('Hello world')
  })

  it('STOP_SPEECH message triggers cancel', () => {
    const msgListeners = []
    const compat = {
      runtime: {
        sendMessage: vi.fn(() => Promise.resolve()),
        onMessage: vi.fn((fn) => msgListeners.push(fn)),
      },
    }
    const synth = makeSynth()

    registerHandlers(compat, synth)

    const envelope = {
      type: MSG_TYPES.STOP_SPEECH,
      payload: {},
      requestId: 'test-id-2',
    }
    msgListeners.forEach((fn) => fn(envelope))

    expect(synth.cancel).toHaveBeenCalledOnce()
  })
})
