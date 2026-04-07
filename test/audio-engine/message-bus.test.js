// Feature: audio-engine, Property 1: MSG_TYPES Phase 3 completeness and immutability
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { MSG_TYPES } from '../../src/shared/message-bus.js'

const PHASE3_TYPES = [
  'PLAYBACK_ENDED',
  'SET_VOICE',
  'SET_RATE',
  'SET_PITCH',
  'SET_VOLUME',
  'SKIP_FORWARD',
  'SKIP_BACK',
  'SEEK_TO_CHUNK',
]

// Property 1: MSG_TYPES Phase 3 completeness and immutability
// Validates: Requirements 1.1–1.10
describe('MSG_TYPES Phase 3', () => {
  it('contains all Phase 3 constants with matching string values', () => {
    for (const type of PHASE3_TYPES) {
      expect(MSG_TYPES).toHaveProperty(type)
      expect(MSG_TYPES[type]).toBe(type)
    }
  })

  it('property: all Phase 3 constants are present and self-referential', () => {
    fc.assert(
      fc.property(fc.constantFrom(...PHASE3_TYPES), (type) => {
        return MSG_TYPES[type] === type
      }),
      { numRuns: 100 }
    )
  })

  it('property: MSG_TYPES is frozen — Phase 3 additions cannot be mutated', () => {
    fc.assert(
      fc.property(fc.constantFrom(...PHASE3_TYPES), fc.string({ minLength: 1 }), (key, newVal) => {
        const original = MSG_TYPES[key]
        try { MSG_TYPES[key] = newVal } catch (_) { /* strict mode throws */ }
        expect(MSG_TYPES[key]).toBe(original)
      }),
      { numRuns: 100 }
    )
  })

  it('property: MSG_TYPES is frozen — Phase 3 entries cannot be deleted', () => {
    fc.assert(
      fc.property(fc.constantFrom(...PHASE3_TYPES), (key) => {
        try { delete MSG_TYPES[key] } catch (_) { /* strict mode throws */ }
        expect(MSG_TYPES[key]).toBe(key)
      }),
      { numRuns: 100 }
    )
  })

  it('property: no new keys can be injected at runtime', () => {
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
})
