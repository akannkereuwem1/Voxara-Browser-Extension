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

// ---------------------------------------------------------------------------
// hashArrayBuffer property tests
// Validates: Requirements 2.2, 2.3, 2.5
// ---------------------------------------------------------------------------

import { hashArrayBuffer } from '../../src/shared/hash.js'

describe('hashArrayBuffer', () => {
  // Property 2: determinism — same bytes → same hash
  it('Property 2: determinism (same bytes → same hash)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 1, maxLength: 1024 }), async (bytes) => {
        const buf1 = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        const buf2 = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        const [h1, h2] = await Promise.all([hashArrayBuffer(buf1), hashArrayBuffer(buf2)])
        expect(h1).toBe(h2)
      }),
      { numRuns: 100 }
    )
  })

  // Property 3: collision resistance — different bytes → different hash
  it('Property 3: collision resistance (different bytes → different hash)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 1, maxLength: 512 }),
        fc.uint8Array({ minLength: 1, maxLength: 512 }),
        async (a, b) => {
          // Only test when arrays differ
          const aStr = Array.from(a).join(',')
          const bStr = Array.from(b).join(',')
          if (aStr === bStr) return
          const bufA = a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength)
          const bufB = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
          const [hA, hB] = await Promise.all([hashArrayBuffer(bufA), hashArrayBuffer(bufB)])
          expect(hA).not.toBe(hB)
        }
      ),
      { numRuns: 100 }
    )
  })

  // Property 4: output format — always 64 lowercase hex chars
  it('Property 4: output format (always 64 lowercase hex chars)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 1, maxLength: 1024 }), async (bytes) => {
        const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        const hash = await hashArrayBuffer(buf)
        expect(hash).toMatch(/^[0-9a-f]{64}$/)
      }),
      { numRuns: 100 }
    )
  })
})
