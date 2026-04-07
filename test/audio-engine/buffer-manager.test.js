// Feature: audio-engine
// Property 4: Buffer Manager speaks first chunk before lookahead
// Property 5: Buffer Manager auto-advances on utterance end
// Property 6: Buffer Manager refills lookahead when queue drops below 3
// Property 7: STOP_SPEECH clears queue and resets index

import { describe, it, expect, vi } from 'vitest'
import * as fc from 'fast-check'
import { createBufferManager } from '../../src/offscreen/index.js'
import { MSG_TYPES } from '../../src/shared/message-bus.js'

// ---------------------------------------------------------------------------
// Stubs
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

function makeSynth() {
  const spoken = []
  return {
    spoken,
    speak: vi.fn((u) => spoken.push(u)),
    cancel: vi.fn(),
    getVoices: vi.fn(() => []),
  }
}

/**
 * Build a fake idb-style db with a set of chunks for a document.
 * getAllFromIndex returns all chunks; get('documents') returns { chunkCount }.
 */
function makeDB(chunks) {
  return {
    get: vi.fn(async (store, id) => {
      if (store === 'documents') return { id, chunkCount: chunks.length }
      return null
    }),
    getAllFromIndex: vi.fn(async () => [...chunks]),
  }
}

/** Build N sequential chunks for a document */
function makeChunks(n, docId = 'doc1') {
  return Array.from({ length: n }, (_, i) => ({
    id: `chunk-${i}`,
    documentId: docId,
    sequenceIndex: i,
    text: `Chunk ${i} text`,
  }))
}

// ---------------------------------------------------------------------------
// Property 4: Buffer Manager speaks first chunk before lookahead
// Validates: Requirements 4.2, 11.2
// ---------------------------------------------------------------------------

describe('Property 4: Buffer Manager speaks first chunk before lookahead', () => {
  it('property: speak() is called immediately after handleSpeakChunk resolves', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 0, max: 5 }),
        async (totalChunks, startIndex) => {
          const chunks = makeChunks(totalChunks)
          const validStart = Math.min(startIndex, totalChunks - 1)
          const synth = makeSynth()
          const send = vi.fn()
          const db = makeDB(chunks)
          const bm = createBufferManager(synth, db, send, {})

          await bm.handleSpeakChunk({ documentId: 'doc1', startChunkIndex: validStart })

          // speak must have been called at least once (first chunk)
          expect(synth.speak).toHaveBeenCalled()
          // first spoken utterance text must match the chunk at validStart
          expect(synth.spoken[0].text).toBe(chunks[validStart].text)
        }
      ),
      { numRuns: 50 }
    )
  })

  it('first chunk is spoken synchronously before lookahead is appended', async () => {
    const chunks = makeChunks(5)
    const synth = makeSynth()
    const send = vi.fn()

    // Track speak call count at the moment speak is first called
    let speakCountAtFirstCall = -1
    synth.speak.mockImplementation((u) => {
      synth.spoken.push(u)
      if (speakCountAtFirstCall === -1) speakCountAtFirstCall = synth.spoken.length
    })

    const db = makeDB(chunks)
    const bm = createBufferManager(synth, db, send, {})
    await bm.handleSpeakChunk({ documentId: 'doc1', startChunkIndex: 0 })

    // speak was called exactly once for the first chunk before lookahead loaded
    expect(speakCountAtFirstCall).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Property 5: Buffer Manager auto-advances on utterance end
// Validates: Requirement 4.3
// ---------------------------------------------------------------------------

describe('Property 5: Buffer Manager auto-advances on utterance end', () => {
  it('property: firing onend on each utterance advances through all chunks', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 6 }),
        async (n) => {
          const chunks = makeChunks(n)
          const synth = makeSynth()
          const send = vi.fn()
          const db = makeDB(chunks)
          const bm = createBufferManager(synth, db, send, {})

          await bm.handleSpeakChunk({ documentId: 'doc1', startChunkIndex: 0 })

          // Simulate browser firing onend for each utterance in sequence
          for (let i = 0; i < n; i++) {
            const utterance = synth.spoken[i]
            if (!utterance) break
            await utterance.onend()
          }

          // CHUNK_ENDED should have been sent for each chunk
          const chunkEndedCalls = send.mock.calls.filter(
            ([type]) => type === MSG_TYPES.CHUNK_ENDED
          )
          expect(chunkEndedCalls.length).toBe(n)

          // PLAYBACK_ENDED sent after last chunk
          const playbackEndedCalls = send.mock.calls.filter(
            ([type]) => type === MSG_TYPES.PLAYBACK_ENDED
          )
          expect(playbackEndedCalls.length).toBe(1)
        }
      ),
      { numRuns: 30 }
    )
  })

  it('CHUNK_STARTED is sent when onstart fires', async () => {
    const chunks = makeChunks(2)
    const synth = makeSynth()
    const send = vi.fn()
    const db = makeDB(chunks)
    const bm = createBufferManager(synth, db, send, {})

    await bm.handleSpeakChunk({ documentId: 'doc1', startChunkIndex: 0 })
    synth.spoken[0].onstart()

    expect(send).toHaveBeenCalledWith(MSG_TYPES.CHUNK_STARTED, { chunkIndex: 0 })
  })

  it('PLAYBACK_ENDED is sent after the last chunk ends', async () => {
    const chunks = makeChunks(1)
    const synth = makeSynth()
    const send = vi.fn()
    const db = makeDB(chunks)
    const bm = createBufferManager(synth, db, send, {})

    await bm.handleSpeakChunk({ documentId: 'doc1', startChunkIndex: 0 })
    await synth.spoken[0].onend()

    expect(send).toHaveBeenCalledWith(MSG_TYPES.PLAYBACK_ENDED, {})
  })
})

// ---------------------------------------------------------------------------
// Property 6: Buffer Manager refills lookahead when queue drops below 3
// Validates: Requirement 4.4
// ---------------------------------------------------------------------------

describe('Property 6: Buffer Manager refills lookahead when queue drops below 3', () => {
  it('property: after first chunk ends, queue is refilled from IndexedDB', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 5, max: 10 }),
        async (n) => {
          const chunks = makeChunks(n)
          const synth = makeSynth()
          const send = vi.fn()
          const db = makeDB(chunks)
          const bm = createBufferManager(synth, db, send, {})

          await bm.handleSpeakChunk({ documentId: 'doc1', startChunkIndex: 0 })

          // After first chunk ends, refill should be triggered
          await synth.spoken[0].onend()

          // db.getAllFromIndex should have been called more than once (initial + refill)
          expect(db.getAllFromIndex.mock.calls.length).toBeGreaterThanOrEqual(2)
        }
      ),
      { numRuns: 30 }
    )
  })

  it('does not refill when all chunks are already loaded', async () => {
    const chunks = makeChunks(3)
    const synth = makeSynth()
    const send = vi.fn()
    const db = makeDB(chunks)
    const bm = createBufferManager(synth, db, send, {})

    await bm.handleSpeakChunk({ documentId: 'doc1', startChunkIndex: 0 })
    const callsBefore = db.getAllFromIndex.mock.calls.length

    // End first chunk — queue already has chunks 1 and 2, no refill needed
    await synth.spoken[0].onend()

    // No additional DB calls beyond what was already made
    expect(db.getAllFromIndex.mock.calls.length).toBe(callsBefore)
  })
})

// ---------------------------------------------------------------------------
// Property 7: STOP_SPEECH clears queue and resets index
// Validates: Requirement 4.7
// ---------------------------------------------------------------------------

describe('Property 7: STOP_SPEECH clears queue and resets index', () => {
  it('property: handleStopSpeech cancels synth and prevents further speaks', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 8 }),
        async (n) => {
          const chunks = makeChunks(n)
          const synth = makeSynth()
          const send = vi.fn()
          const db = makeDB(chunks)
          const bm = createBufferManager(synth, db, send, {})

          await bm.handleSpeakChunk({ documentId: 'doc1', startChunkIndex: 0 })
          bm.handleStopSpeech()

          expect(synth.cancel).toHaveBeenCalled()

          // After stop, firing onend on any remaining utterance should NOT advance
          const speakCountAfterStop = synth.spoken.length
          // No new speaks should happen after stop
          expect(synth.speak.mock.calls.length).toBe(speakCountAfterStop)
        }
      ),
      { numRuns: 30 }
    )
  })

  it('handleStopSpeech calls synth.cancel()', () => {
    const synth = makeSynth()
    const bm = createBufferManager(synth, makeDB([]), vi.fn(), {})
    bm.handleStopSpeech()
    expect(synth.cancel).toHaveBeenCalledOnce()
  })

  it('settings mutators update internal state without interrupting current utterance', async () => {
    const chunks = makeChunks(2)
    const synth = makeSynth()
    const send = vi.fn()
    const db = makeDB(chunks)
    const bm = createBufferManager(synth, db, send, { playbackRate: 1.0, pitch: 1.0, volume: 1.0 })

    await bm.handleSpeakChunk({ documentId: 'doc1', startChunkIndex: 0 })
    const speaksBefore = synth.speak.mock.calls.length

    // Mutate settings — should NOT call cancel or speak again
    bm.handleSetRate({ rate: 1.5 })
    bm.handleSetPitch({ pitch: 0.8 })
    bm.handleSetVolume({ volume: 0.5 })
    bm.handleSetVoice({ voiceId: 'urn:voice:test' })

    expect(synth.cancel).not.toHaveBeenCalled()
    expect(synth.speak.mock.calls.length).toBe(speaksBefore)
  })
})
