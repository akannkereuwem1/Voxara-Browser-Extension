// Feature: extension-shell, Property 22: MSG_TYPES is complete and frozen
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { MSG_TYPES } from '../../src/shared/message-bus.js'

const EXPECTED_TYPES = [
  'PLAY_CHUNK',
  'PAUSE_PLAYBACK',
  'RESUME_PLAYBACK',
  'CHUNK_STARTED',
  'CHUNK_ENDED',
  'AI_QUERY',
  'AI_RESPONSE',
  'STATE_UPDATE',
  'ACTION',
  'VOICE_CHANGE',
  'PDF_DETECTED',
  'SPEAK_CHUNK',
  'STOP_SPEECH',
]

describe('MSG_TYPES', () => {
  it('contains all expected Phase 1 constants', () => {
    for (const type of EXPECTED_TYPES) {
      expect(MSG_TYPES).toHaveProperty(type)
      expect(MSG_TYPES[type]).toBe(type)
    }
  })

  it('is frozen — additions are silently ignored', () => {
    // Property 22: MSG_TYPES is complete and frozen
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (key) => {
        const before = Object.keys(MSG_TYPES).length
        try { MSG_TYPES[key] = 'INJECTED' } catch (_) { /* strict mode throws */ }
        expect(Object.keys(MSG_TYPES).length).toBe(before)
        expect(MSG_TYPES[key]).not.toBe('INJECTED')
      }),
      { numRuns: 100 }
    )
  })

  it('is frozen — deletions are silently ignored', () => {
    fc.assert(
      fc.property(fc.constantFrom(...EXPECTED_TYPES), (key) => {
        try { delete MSG_TYPES[key] } catch (_) { /* strict mode throws */ }
        expect(MSG_TYPES[key]).toBe(key)
      }),
      { numRuns: 100 }
    )
  })

  it('is frozen — modifications are silently ignored', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...EXPECTED_TYPES),
        fc.string({ minLength: 1 }),
        (key, newVal) => {
          const original = MSG_TYPES[key]
          try { MSG_TYPES[key] = newVal } catch (_) { /* strict mode throws */ }
          expect(MSG_TYPES[key]).toBe(original)
        }
      ),
      { numRuns: 100 }
    )
  })
})
