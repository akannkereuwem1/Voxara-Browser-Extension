// Feature: pdf-engine
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { MSG_TYPES } from '../../src/shared/message-bus.js'

// ---------------------------------------------------------------------------
// Property 1: MSG_TYPES Phase 2 completeness and immutability
// Validates: Requirements 1.1–1.6
// ---------------------------------------------------------------------------

describe('MSG_TYPES Phase 2 completeness and immutability', () => {
  const PHASE2_KEYS = ['PDF_PARSE_START', 'PARSE_PROGRESS', 'PDF_PARSED', 'LOAD_DOCUMENT']

  it('contains all four Phase 2 constants', () => {
    for (const key of PHASE2_KEYS) {
      expect(MSG_TYPES).toHaveProperty(key)
      expect(typeof MSG_TYPES[key]).toBe('string')
      expect(MSG_TYPES[key].length).toBeGreaterThan(0)
    }
  })

  it('is frozen', () => {
    expect(Object.isFrozen(MSG_TYPES)).toBe(true)
  })

  it('Property 1: assigning a new key has no effect', () => {
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

  it('all Phase 2 string values are present as values in MSG_TYPES', () => {
    const values = Object.values(MSG_TYPES)
    for (const key of PHASE2_KEYS) {
      expect(values).toContain(MSG_TYPES[key])
    }
  })
})
