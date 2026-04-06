// Feature: extension-shell
// Property 11: Content Script sends PDF_DETECTED for all PDF tabs
// Property 12: Content Script stays dormant for non-PDF tabs
// Property 13: MutationObserver detects embedded PDF elements
// Property 14: Duplicate PDF URL detection is suppressed

import { describe, it, expect, vi } from 'vitest'
import * as fc from 'fast-check'
import { isPdfTab, checkNode } from '../../src/content/index.js'
import { MSG_TYPES } from '../../src/shared/message-bus.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(tag, attr, value) {
  return { nodeType: 1, tagName: tag.toUpperCase(), [attr]: value, querySelectorAll: () => [] }
}

function makeCompat() {
  const sent = []
  return {
    sent,
    runtime: {
      sendMessage: vi.fn((msg) => { sent.push(msg); return Promise.resolve() }),
      onMessage: vi.fn(),
    },
  }
}

// ---------------------------------------------------------------------------
// Property 11: Content Script sends PDF_DETECTED for all PDF tabs
// ---------------------------------------------------------------------------

describe('Property 11: isPdfTab detects PDF tabs', () => {
  it('property: application/pdf contentType always matches', () => {
    fc.assert(
      fc.property(fc.webUrl(), (href) => {
        expect(isPdfTab('application/pdf', href)).toBe(true)
      }),
      { numRuns: 100 }
    )
  })

  it('property: .pdf URL suffix always matches (case-insensitive)', () => {
    fc.assert(
      fc.property(
        fc.webUrl().filter(u => !u.toLowerCase().endsWith('.pdf')),
        fc.constantFrom('.pdf', '.PDF', '.Pdf', '.pDf', '.PDf'),
        (base, suffix) => {
          expect(isPdfTab('text/html', base + suffix)).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('property: both conditions together still match', () => {
    fc.assert(
      fc.property(
        fc.webUrl().filter(u => !u.toLowerCase().endsWith('.pdf')),
        (base) => {
          expect(isPdfTab('application/pdf', base + '.pdf')).toBe(true)
        }
      ),
      { numRuns: 50 }
    )
  })
})

// ---------------------------------------------------------------------------
// Property 12: Content Script stays dormant for non-PDF tabs
// ---------------------------------------------------------------------------

describe('Property 12: isPdfTab stays dormant for non-PDF tabs', () => {
  it('property: non-pdf contentType and non-.pdf URL never matches', () => {
    fc.assert(
      fc.property(
        fc.webUrl().filter(u => !u.toLowerCase().endsWith('.pdf')),
        fc.string().filter(s => s !== 'application/pdf'),
        (href, contentType) => {
          expect(isPdfTab(contentType, href)).toBe(false)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('empty string contentType and non-.pdf URL does not match', () => {
    expect(isPdfTab('', 'https://example.com/page.html')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Property 13: MutationObserver detects embedded PDF elements
// ---------------------------------------------------------------------------

describe('Property 13: checkNode detects embedded PDF elements', () => {
  it('property: IFRAME with .pdf src triggers PDF_DETECTED', () => {
    fc.assert(
      fc.property(
        fc.webUrl().filter(u => !u.toLowerCase().endsWith('.pdf')),
        fc.constantFrom('.pdf', '.PDF', '.Pdf'),
        (base, suffix) => {
          const url = base + suffix
          const node = makeNode('IFRAME', 'src', url)
          const reported = new Set()
          const compat = makeCompat()
          checkNode(node, reported, compat)
          expect(compat.sent.length).toBe(1)
          expect(compat.sent[0].type).toBe(MSG_TYPES.PDF_DETECTED)
          expect(compat.sent[0].payload.url).toBe(url)
        }
      ),
      { numRuns: 50 }
    )
  })

  it('property: EMBED with .pdf src triggers PDF_DETECTED', () => {
    fc.assert(
      fc.property(
        fc.webUrl().filter(u => !u.toLowerCase().endsWith('.pdf')),
        (base) => {
          const url = base + '.pdf'
          const node = makeNode('EMBED', 'src', url)
          const reported = new Set()
          const compat = makeCompat()
          checkNode(node, reported, compat)
          expect(compat.sent.length).toBe(1)
          expect(compat.sent[0].payload.url).toBe(url)
        }
      ),
      { numRuns: 50 }
    )
  })

  it('property: OBJECT with .pdf data triggers PDF_DETECTED', () => {
    fc.assert(
      fc.property(
        fc.webUrl().filter(u => !u.toLowerCase().endsWith('.pdf')),
        (base) => {
          const url = base + '.pdf'
          const node = makeNode('OBJECT', 'data', url)
          const reported = new Set()
          const compat = makeCompat()
          checkNode(node, reported, compat)
          expect(compat.sent.length).toBe(1)
          expect(compat.sent[0].payload.url).toBe(url)
        }
      ),
      { numRuns: 50 }
    )
  })

  it('non-PDF src does not trigger PDF_DETECTED', () => {
    const node = makeNode('IFRAME', 'src', 'https://example.com/page.html')
    const reported = new Set()
    const compat = makeCompat()
    checkNode(node, reported, compat)
    expect(compat.sent.length).toBe(0)
  })

  it('non-element node is ignored', () => {
    const textNode = { nodeType: 3, tagName: undefined }
    const reported = new Set()
    const compat = makeCompat()
    checkNode(textNode, reported, compat)
    expect(compat.sent.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Property 14: Duplicate PDF URL detection is suppressed
// ---------------------------------------------------------------------------

describe('Property 14: Duplicate PDF URL detection is suppressed', () => {
  it('property: same URL reported N times only sends one message', () => {
    fc.assert(
      fc.property(
        fc.webUrl().filter(u => !u.toLowerCase().endsWith('.pdf')),
        fc.integer({ min: 2, max: 10 }),
        (base, n) => {
          const url = base + '.pdf'
          const reported = new Set()
          const compat = makeCompat()
          for (let i = 0; i < n; i++) {
            const node = makeNode('IFRAME', 'src', url)
            checkNode(node, reported, compat)
          }
          expect(compat.sent.length).toBe(1)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('different URLs each get their own PDF_DETECTED message', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.webUrl().filter(u => !u.toLowerCase().endsWith('.pdf')),
          { minLength: 2, maxLength: 5 }
        ),
        (bases) => {
          const reported = new Set()
          const compat = makeCompat()
          for (const base of bases) {
            const node = makeNode('IFRAME', 'src', base + '.pdf')
            checkNode(node, reported, compat)
          }
          expect(compat.sent.length).toBe(bases.length)
        }
      ),
      { numRuns: 50 }
    )
  })
})
