// Feature: audio-engine
// Property 8:  SET_RATE clamps to [0.5, 3.0]
// Property 9:  SET_PITCH clamps to [0.5, 2.0]
// Property 10: SET_VOLUME clamps to [0, 1]
// Property 11: SKIP_FORWARD/SKIP_BACK chunk delta calculation
// Property 12: SEEK_TO_CHUNK updates index and forwards when playing
// Property 16: AppState Phase 3 default shape
// (Properties 13-15 are in task 7)

import { describe, it, expect, vi } from 'vitest'
import * as fc from 'fast-check'
import { installFakeIDB } from '../setup.js'
import {
  DEFAULT_APP_STATE,
  handleSetRate,
  handleSetPitch,
  handleSetVolume,
  handleSetVoice,
  handleSkipForward,
  handleSkipBack,
  handleSeekToChunk,
  handlePlaybackEnded,
  calcChunkDelta,
  serializeState,
} from '../../src/background/index.js'
import { MSG_TYPES } from '../../src/shared/message-bus.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(overrides = {}) {
  return { ...DEFAULT_APP_STATE, connectedPorts: [], offscreenOpen: false, ...overrides }
}

function makeCompat() {
  return {
    runtime: { sendMessage: vi.fn(() => Promise.resolve()) },
    offscreen: { create: vi.fn(() => Promise.resolve()), close: vi.fn(() => Promise.resolve()) },
    webNavigation: { addListener: vi.fn() },
    ports: { connect: vi.fn(), onConnect: vi.fn() },
  }
}

// ---------------------------------------------------------------------------
// Property 16: AppState Phase 3 default shape
// Validates: Requirement 9.1
// ---------------------------------------------------------------------------

describe('Property 16: AppState Phase 3 default shape', () => {
  it('DEFAULT_APP_STATE has all Phase 3 fields with correct defaults', () => {
    expect(DEFAULT_APP_STATE.playbackRate).toBe(1.0)
    expect(DEFAULT_APP_STATE.pitch).toBe(1.0)
    expect(DEFAULT_APP_STATE.volume).toBe(1.0)
    expect(DEFAULT_APP_STATE.voiceId).toBeNull()
  })

  it('serializeState includes all Phase 3 fields', () => {
    const state = makeState({ playbackRate: 1.5, pitch: 0.8, volume: 0.6, voiceId: 'urn:v:1' })
    const s = serializeState(state)
    expect(s.playbackRate).toBe(1.5)
    expect(s.pitch).toBe(0.8)
    expect(s.volume).toBe(0.6)
    expect(s.voiceId).toBe('urn:v:1')
  })
})

// ---------------------------------------------------------------------------
// Property 8: SET_RATE clamps to [0.5, 3.0]
// Validates: Requirement 8.7
// ---------------------------------------------------------------------------

describe('Property 8: SET_RATE clamps to [0.5, 3.0]', () => {
  it('property: any rate value is clamped to [0.5, 3.0]', () => {
    fc.assert(
      fc.property(fc.float({ min: -10, max: 10, noNaN: true }), (rate) => {
        const state = makeState()
        const compat = makeCompat()
        handleSetRate({ rate }, state, compat)
        expect(state.playbackRate).toBeGreaterThanOrEqual(0.5)
        expect(state.playbackRate).toBeLessThanOrEqual(3.0)
      }),
      { numRuns: 100 }
    )
  })

  it('valid rate within range is stored as-is', () => {
    const state = makeState()
    const compat = makeCompat()
    handleSetRate({ rate: 1.5 }, state, compat)
    expect(state.playbackRate).toBe(1.5)
  })

  it('forwards clamped rate to offscreen and broadcasts', () => {
    const state = makeState()
    const compat = makeCompat()
    handleSetRate({ rate: 99 }, state, compat)
    expect(state.playbackRate).toBe(3.0)
    expect(compat.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: MSG_TYPES.SET_RATE, payload: { rate: 3.0 } })
    )
  })
})

// ---------------------------------------------------------------------------
// Property 9: SET_PITCH clamps to [0.5, 2.0]
// Validates: Requirement 8.8
// ---------------------------------------------------------------------------

describe('Property 9: SET_PITCH clamps to [0.5, 2.0]', () => {
  it('property: any pitch value is clamped to [0.5, 2.0]', () => {
    fc.assert(
      fc.property(fc.float({ min: -10, max: 10, noNaN: true }), (pitch) => {
        const state = makeState()
        const compat = makeCompat()
        handleSetPitch({ pitch }, state, compat)
        expect(state.pitch).toBeGreaterThanOrEqual(0.5)
        expect(state.pitch).toBeLessThanOrEqual(2.0)
      }),
      { numRuns: 100 }
    )
  })

  it('valid pitch within range is stored as-is', () => {
    const state = makeState()
    const compat = makeCompat()
    handleSetPitch({ pitch: 1.2 }, state, compat)
    expect(state.pitch).toBe(1.2)
  })
})

// ---------------------------------------------------------------------------
// Property 10: SET_VOLUME clamps to [0, 1]
// Validates: Requirement 8.9
// ---------------------------------------------------------------------------

describe('Property 10: SET_VOLUME clamps to [0, 1]', () => {
  it('property: any volume value is clamped to [0, 1]', () => {
    fc.assert(
      fc.property(fc.float({ min: -10, max: 10, noNaN: true }), (volume) => {
        const state = makeState()
        const compat = makeCompat()
        handleSetVolume({ volume }, state, compat)
        expect(state.volume).toBeGreaterThanOrEqual(0)
        expect(state.volume).toBeLessThanOrEqual(1)
      }),
      { numRuns: 100 }
    )
  })

  it('valid volume within range is stored as-is', () => {
    const state = makeState()
    const compat = makeCompat()
    handleSetVolume({ volume: 0.75 }, state, compat)
    expect(state.volume).toBe(0.75)
  })
})

// ---------------------------------------------------------------------------
// Property 11: SKIP_FORWARD/SKIP_BACK chunk delta calculation
// Validates: Requirements 6.3, 6.4
// ---------------------------------------------------------------------------

describe('Property 11: SKIP_FORWARD/SKIP_BACK chunk delta calculation', () => {
  it('property: calcChunkDelta always returns at least 1', () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(0.1), max: Math.fround(60), noNaN: true }),
        fc.float({ min: Math.fround(0.5), max: Math.fround(3.0), noNaN: true }),
        fc.integer({ min: 50, max: 300 }),
        (seconds, rate, avgWords) => {
          const delta = calcChunkDelta(seconds, rate, avgWords)
          expect(delta).toBeGreaterThanOrEqual(1)
          expect(Number.isInteger(delta)).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('calcChunkDelta(10, 1.0, 150) returns 1 (10s * 150wpm / 60 / 150 = 0.167 → floor → max(1,0)=1)', () => {
    expect(calcChunkDelta(10, 1.0, 150)).toBe(1)
  })

  it('calcChunkDelta(60, 2.0, 150) returns 2 (60s * 2 * 150/60/150 = 2)', () => {
    expect(calcChunkDelta(60, 2.0, 150)).toBe(2)
  })

  it('property: SKIP_FORWARD clamps currentChunkIndex to [0, lastIndex]', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 0, max: 50 }),
        async (chunkCount, startIndex) => {
          const validStart = Math.min(startIndex, chunkCount - 1)
          const state = makeState({
            currentChunkIndex: validStart,
            activeDocumentId: 'doc1',
            playbackStatus: 'idle',
          })
          const compat = makeCompat()
          const db = { get: vi.fn(async () => ({ chunkCount })) }
          await handleSkipForward({ seconds: 10 }, state, compat, db)
          expect(state.currentChunkIndex).toBeGreaterThanOrEqual(0)
          expect(state.currentChunkIndex).toBeLessThanOrEqual(chunkCount - 1)
        }
      ),
      { numRuns: 50 }
    )
  })

  it('property: SKIP_BACK clamps currentChunkIndex to 0', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 20 }),
        async (startIndex) => {
          const state = makeState({ currentChunkIndex: startIndex, playbackStatus: 'idle' })
          const compat = makeCompat()
          await handleSkipBack({ seconds: 10 }, state, compat)
          expect(state.currentChunkIndex).toBeGreaterThanOrEqual(0)
        }
      ),
      { numRuns: 50 }
    )
  })

  it('SKIP_FORWARD does not send SEEK_TO_CHUNK when not playing', async () => {
    const state = makeState({ currentChunkIndex: 5, playbackStatus: 'paused', activeDocumentId: 'doc1' })
    const compat = makeCompat()
    const db = { get: vi.fn(async () => ({ chunkCount: 20 })) }
    await handleSkipForward({ seconds: 10 }, state, compat, db)
    expect(compat.runtime.sendMessage).not.toHaveBeenCalled()
  })

  it('SKIP_FORWARD sends SEEK_TO_CHUNK when playing', async () => {
    const state = makeState({ currentChunkIndex: 5, playbackStatus: 'playing', activeDocumentId: 'doc1' })
    const compat = makeCompat()
    const db = { get: vi.fn(async () => ({ chunkCount: 20 })) }
    await handleSkipForward({ seconds: 10 }, state, compat, db)
    expect(compat.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: MSG_TYPES.SEEK_TO_CHUNK })
    )
  })
})

// ---------------------------------------------------------------------------
// Property 12: SEEK_TO_CHUNK updates index and forwards when playing
// Validates: Requirement 7.4
// ---------------------------------------------------------------------------

describe('Property 12: SEEK_TO_CHUNK updates index and forwards when playing', () => {
  it('property: SEEK_TO_CHUNK always updates currentChunkIndex', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.constantFrom('idle', 'playing', 'paused', 'ended'),
        (chunkIndex, status) => {
          const state = makeState({ playbackStatus: status })
          const compat = makeCompat()
          handleSeekToChunk({ chunkIndex }, state, compat)
          expect(state.currentChunkIndex).toBe(chunkIndex)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('forwards SEEK_TO_CHUNK to offscreen only when playing', () => {
    const playingState = makeState({ playbackStatus: 'playing' })
    const pausedState  = makeState({ playbackStatus: 'paused' })
    const compat1 = makeCompat()
    const compat2 = makeCompat()

    handleSeekToChunk({ chunkIndex: 5 }, playingState, compat1)
    handleSeekToChunk({ chunkIndex: 5 }, pausedState, compat2)

    expect(compat1.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: MSG_TYPES.SEEK_TO_CHUNK })
    )
    expect(compat2.runtime.sendMessage).not.toHaveBeenCalled()
  })

  it('PLAYBACK_ENDED sets playbackStatus to ended', () => {
    const state = makeState({ playbackStatus: 'playing' })
    handlePlaybackEnded({}, state)
    expect(state.playbackStatus).toBe('ended')
  })
})
