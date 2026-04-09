// Feature: extension-shell, Property 19: SPEAK_CHUNK triggers speechSynthesis.speak with correct text
// Feature: extension-shell, Property 20: Utterance lifecycle sends CHUNK_STARTED and CHUNK_ENDED

import { describe, it, expect, vi } from 'vitest'
import * as fc from 'fast-check'
import { createBufferManager, registerHandlers } from '../../src/offscreen/index.js'
import { MSG_TYPES } from '../../src/shared/message-bus.js'
import { installFakeIDB } from '../setup.js'
import { initDB } from '../../src/shared/db.js'

// ---------------------------------------------------------------------------
// SpeechSynthesisUtterance stub
// ---------------------------------------------------------------------------

class FakeUtterance {
  constructor(text) {
    this.text = text
    this.onstart = null
    this.onend = null
    this.rate = 1; this.pitch = 1; this.volume = 1; this.voice = null
  }
}
globalThis.SpeechSynthesisUtterance = FakeUtterance

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSynth() {
  const spoken = []
  return {
    spoken,
    speak: vi.fn((u) => spoken.push(u)),
    cancel: vi.fn(),
    getVoices: vi.fn(() => []),
  }
}

function makeDB(chunks = []) {
  return {
    get: vi.fn(async (store, id) => {
      if (store === 'documents') return { id, chunkCount: chunks.length }
      return null
    }),
    getAllFromIndex: vi.fn(async () => chunks),
  }
}

// ---------------------------------------------------------------------------
// Property 19: SPEAK_CHUNK triggers speechSynthesis.speak with correct text
// ---------------------------------------------------------------------------

describe('Property 19: SPEAK_CHUNK triggers speechSynthesis.speak with correct text', () => {
  it('property: speak is called with an utterance whose text matches the first chunk', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        async (text) => {
          const synth = makeSynth()
          const send = vi.fn()
          // sequenceIndex always 0 so loadChunks(docId, 0, 1) returns it
          const chunk = { id: 'c1', documentId: 'doc1', sequenceIndex: 0, text }
          const db = makeDB([chunk])
          const bm = createBufferManager(synth, db, send, {})

          await bm.handleSpeakChunk({ documentId: 'doc1', startChunkIndex: 0 })

          expect(synth.speak).toHaveBeenCalled()
          const utterance = synth.spoken[0]
          expect(utterance).toBeInstanceOf(FakeUtterance)
          expect(utterance.text).toBe(text)
        }
      ),
      { numRuns: 50 }
    )
  })

  it('STOP_SPEECH calls synth.cancel()', () => {
    const synth = makeSynth()
    const bm = createBufferManager(synth, makeDB(), vi.fn(), {})
    bm.handleStopSpeech()
    expect(synth.cancel).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// Property 20: Utterance lifecycle sends CHUNK_STARTED and CHUNK_ENDED
// ---------------------------------------------------------------------------

describe('Property 20: Utterance lifecycle sends CHUNK_STARTED and CHUNK_ENDED', () => {
  it('property: onstart fires CHUNK_STARTED with correct chunkIndex', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        async (text) => {
          const synth = makeSynth()
          const send = vi.fn()
          const chunk = { id: 'c1', documentId: 'doc1', sequenceIndex: 0, text }
          const db = makeDB([chunk])
          const bm = createBufferManager(synth, db, send, {})

          await bm.handleSpeakChunk({ documentId: 'doc1', startChunkIndex: 0 })
          synth.spoken[0].onstart()

          expect(send).toHaveBeenCalledWith(MSG_TYPES.CHUNK_STARTED, { chunkIndex: 0 })
        }
      ),
      { numRuns: 50 }
    )
  })

  it('property: onend fires CHUNK_ENDED with correct chunkIndex', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        async (text) => {
          const synth = makeSynth()
          const send = vi.fn()
          const chunk = { id: 'c1', documentId: 'doc1', sequenceIndex: 0, text }
          const db = makeDB([chunk])
          const bm = createBufferManager(synth, db, send, {})

          await bm.handleSpeakChunk({ documentId: 'doc1', startChunkIndex: 0 })
          await synth.spoken[0].onend()

          expect(send).toHaveBeenCalledWith(MSG_TYPES.CHUNK_ENDED, { chunkIndex: 0 })
        }
      ),
      { numRuns: 50 }
    )
  })

  it('onstart and onend are not called before browser fires them', async () => {
    const synth = makeSynth()
    const send = vi.fn()
    const chunk = { id: 'c1', documentId: 'doc1', sequenceIndex: 0, text: 'hello' }
    const db = makeDB([chunk])
    const bm = createBufferManager(synth, db, send, {})

    await bm.handleSpeakChunk({ documentId: 'doc1', startChunkIndex: 0 })

    // No lifecycle events fired yet
    expect(send).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// registerHandlers integration
// ---------------------------------------------------------------------------

describe('registerHandlers: routes messages to correct handlers', () => {
  it('STOP_SPEECH message triggers cancel', async () => {
    installFakeIDB()
    const db = await initDB()
    const msgListeners = []
    const compat = {
      runtime: {
        sendMessage: vi.fn(() => Promise.resolve()),
        onMessage: vi.fn((fn) => msgListeners.push(fn)),
      },
    }
    const synth = makeSynth()

    registerHandlers(compat, synth, db)

    const envelope = { type: MSG_TYPES.STOP_SPEECH, payload: {}, requestId: 'test-id-2' }
    msgListeners.forEach((fn) => fn(envelope))

    expect(synth.cancel).toHaveBeenCalledOnce()
  })
})
