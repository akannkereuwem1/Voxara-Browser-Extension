// Feature: audio-engine
// Property 21: End-to-end playback flow state transitions
// Validates: Requirements 5.2, 5.7, 10.1, 10.2, 14.1, 14.2

import { describe, it, expect, vi } from 'vitest'
import { installFakeIDB } from '../setup.js'
import { initDB } from '../../src/shared/db.js'
import {
  DEFAULT_APP_STATE,
  handleAction,
  handleChunkEnded,
  handleChunkStarted,
  handlePlaybackEnded,
  buildDispatchTable,
  startup,
} from '../../src/background/index.js'
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

function makeState(overrides = {}) {
  return { ...DEFAULT_APP_STATE, connectedPorts: [], offscreenOpen: false, ...overrides }
}

function makeCompat() {
  return {
    runtime: { sendMessage: vi.fn(() => Promise.resolve()), onMessage: vi.fn() },
    offscreen: { create: vi.fn(() => Promise.resolve()), close: vi.fn(() => Promise.resolve()) },
    webNavigation: { addListener: vi.fn() },
    ports: { onConnect: vi.fn() },
  }
}

// ---------------------------------------------------------------------------
// Property 21: End-to-end playback flow state transitions
// Validates: Requirements 14.1, 14.2
// ---------------------------------------------------------------------------

describe('Property 21: End-to-end playback flow state transitions', () => {
  it('full playback: idle → playing → (CHUNK_STARTED/ENDED per chunk) → ended, with PlaybackState at 100%', async () => {
    installFakeIDB()
    const db = await initDB()

    // Seed document and 3 chunks
    const docId = 'e2e-doc'
    const chunkCount = 3
    await db.put('documents', { id: docId, chunkCount, url: 'https://x.com/test.pdf' })
    for (let i = 0; i < chunkCount; i++) {
      await db.put('chunks', {
        id: `chunk-${i}`,
        documentId: docId,
        sequenceIndex: i,
        text: `Chunk ${i} text`,
      })
    }

    // --- Service Worker state ---
    const swState = makeState({ activeDocumentId: docId })
    const compat = makeCompat()
    const statusHistory = []

    // Track STATE_UPDATE broadcasts via a fake port
    const port = {
      messages: [],
      postMessage(msg) { this.messages.push(msg) },
      onDisconnect: { addListener: vi.fn() },
    }
    swState.connectedPorts = [port]

    // --- Buffer Manager (Offscreen Document side) ---
    const synth = makeSynth()

    // The BM sends messages back to the SW — we wire them directly
    const swMessages = []
    const bmSend = (type, payload) => swMessages.push({ type, payload })
    const bm = createBufferManager(synth, db, bmSend, {})

    // --- Verify initial state ---
    expect(swState.playbackStatus).toBe('idle')
    statusHistory.push(swState.playbackStatus)

    // --- ACTION PLAY ---
    await handleAction({ type: 'PLAY' }, swState, compat, db)
    expect(swState.playbackStatus).toBe('playing')
    statusHistory.push(swState.playbackStatus)

    // --- Simulate Buffer Manager receiving SPEAK_CHUNK ---
    await bm.handleSpeakChunk({ documentId: docId, startChunkIndex: 0 })
    expect(synth.speak).toHaveBeenCalled()

    // --- Simulate each utterance lifecycle ---
    for (let i = 0; i < chunkCount; i++) {
      const utterance = synth.spoken[i]
      expect(utterance).toBeDefined()

      // onstart → CHUNK_STARTED
      utterance.onstart()
      const startedMsg = swMessages.find(
        (m) => m.type === MSG_TYPES.CHUNK_STARTED && m.payload.chunkIndex === i
      )
      expect(startedMsg).toBeDefined()

      // SW handles CHUNK_STARTED
      handleChunkStarted({ chunkIndex: i }, swState)
      expect(swState.currentChunkIndex).toBe(i)

      // onend → CHUNK_ENDED (async — triggers refill and speakNext)
      await utterance.onend()
      const endedMsg = swMessages.find(
        (m) => m.type === MSG_TYPES.CHUNK_ENDED && m.payload.chunkIndex === i
      )
      expect(endedMsg).toBeDefined()

      // SW handles CHUNK_ENDED — persists PlaybackState
      await handleChunkEnded({ chunkIndex: i }, swState, db)

      // Verify PlaybackState was written
      const ps = await db.get('playbackStates', docId)
      expect(ps).toBeDefined()
      expect(ps.currentChunkIndex).toBe(i)
      expect(ps.completionPercent).toBeCloseTo(((i + 1) / chunkCount) * 100, 5)
    }

    // --- PLAYBACK_ENDED ---
    const playbackEndedMsg = swMessages.find((m) => m.type === MSG_TYPES.PLAYBACK_ENDED)
    expect(playbackEndedMsg).toBeDefined()

    handlePlaybackEnded({}, swState)
    expect(swState.playbackStatus).toBe('ended')
    statusHistory.push(swState.playbackStatus)

    // --- Verify state transition order ---
    expect(statusHistory).toEqual(['idle', 'playing', 'ended'])

    // --- Verify final PlaybackState has completionPercent === 100 ---
    const finalPs = await db.get('playbackStates', docId)
    expect(finalPs.completionPercent).toBeCloseTo(100, 5)

    // --- Verify STATE_UPDATE broadcasts carried correct data ---
    const stateUpdates = port.messages.filter((m) => m.type === MSG_TYPES.STATE_UPDATE)
    expect(stateUpdates.length).toBeGreaterThan(0)

    // At least one broadcast should show playbackStatus === 'playing'
    expect(stateUpdates.some((m) => m.payload.playbackStatus === 'playing')).toBe(true)
    // At least one should show playbackStatus === 'ended'
    expect(stateUpdates.some((m) => m.payload.playbackStatus === 'ended')).toBe(true)
  })

  it('STATE_UPDATE broadcasts carry correct currentChunkIndex at each stage', async () => {
    installFakeIDB()
    const db = await initDB()

    const docId = 'e2e-doc-2'
    await db.put('documents', { id: docId, chunkCount: 2, url: 'https://x.com/b.pdf' })
    for (let i = 0; i < 2; i++) {
      await db.put('chunks', { id: `c${i}`, documentId: docId, sequenceIndex: i, text: `T${i}` })
    }

    const swState = makeState({ activeDocumentId: docId })
    const port = {
      messages: [],
      postMessage(msg) { this.messages.push(msg) },
      onDisconnect: { addListener: vi.fn() },
    }
    swState.connectedPorts = [port]

    // Simulate chunk 0 ending
    await handleChunkEnded({ chunkIndex: 0 }, swState, db)
    const updates = port.messages.filter((m) => m.type === MSG_TYPES.STATE_UPDATE)
    expect(updates.some((m) => m.payload.currentChunkIndex === 0)).toBe(true)

    // Simulate chunk 1 ending
    await handleChunkEnded({ chunkIndex: 1 }, swState, db)
    const updates2 = port.messages.filter((m) => m.type === MSG_TYPES.STATE_UPDATE)
    expect(updates2.some((m) => m.payload.currentChunkIndex === 1)).toBe(true)
  })
})
