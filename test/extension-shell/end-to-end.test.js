// Feature: extension-shell, Property 23: URL is not modified during end-to-end transit
//
// Simulates the full message round-trip:
//   Content Script PDF_DETECTED → Service Worker state update → Side Panel STATE_UPDATE display
//
// Validates: Requirements 13.1, 13.2, 13.3, 13.4

import { describe, it, expect, vi } from 'vitest'
import * as fc from 'fast-check'

import { isPdfTab } from '../../src/content/index.js'

// Fast URL generator — avoids the slow fc.webUrl() arbitrary
const pdfUrl = fc.tuple(
  fc.constantFrom('http', 'https'),
  fc.stringMatching(/^[a-z]{3,10}$/),
  fc.stringMatching(/^[a-z]{3,10}$/),
).map(([scheme, host, path]) => `${scheme}://${host}.com/${path}.pdf`)
import {
  DEFAULT_APP_STATE,
  handlePdfDetected,
  broadcastState,
  serializeState,
} from '../../src/background/index.js'
import { renderState } from '../../src/sidepanel/index.js'
import { MSG_TYPES } from '../../src/shared/message-bus.js'

// ---------------------------------------------------------------------------
// Minimal DOM for side panel rendering
// ---------------------------------------------------------------------------

function makeDocument() {
  const els = {}
  function el(id) {
    els[id] = { id, textContent: '' }
    return els[id]
  }
  el('pdf-url')
  el('playback-status')
  return {
    querySelectorAll: () => [],
    getElementById: (id) => els[id] || null,
    _els: els,
  }
}

// ---------------------------------------------------------------------------
// Property 23: URL is not modified during end-to-end transit
// ---------------------------------------------------------------------------

describe('Property 23: URL is not modified during end-to-end transit', () => {
  it('property: activePdfUrl rendered in side panel is byte-for-byte identical to original URL', () => {
    fc.assert(
      fc.property(pdfUrl, (originalUrl) => {
          // ── Step 1: Content Script detects PDF ──────────────────────────
          expect(isPdfTab('text/html', originalUrl)).toBe(true)

          // ── Step 2: Service Worker receives PDF_DETECTED ─────────────────
          const state = { ...DEFAULT_APP_STATE, connectedPorts: [] }

          // Capture what gets broadcast
          const broadcastMessages = []
          const mockPort = {
            postMessage: vi.fn((msg) => broadcastMessages.push(msg)),
          }
          state.connectedPorts = [mockPort]

          handlePdfDetected({ url: originalUrl }, state, {})

          // State must be updated
          expect(state.activePdfUrl).toBe(originalUrl)

          // ── Step 3: Side Panel receives STATE_UPDATE ──────────────────────
          expect(broadcastMessages.length).toBe(1)
          const stateUpdate = broadcastMessages[0]
          expect(stateUpdate.type).toBe(MSG_TYPES.STATE_UPDATE)
          expect(stateUpdate.payload.activePdfUrl).toBe(originalUrl)

          // ── Step 4: Side Panel renders the URL ───────────────────────────
          const doc = makeDocument()
          renderState(stateUpdate.payload, doc)

          const rendered = doc.getElementById('pdf-url').textContent
          expect(rendered).toBe(originalUrl)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('property: serializeState never mutates activePdfUrl', () => {
    fc.assert(
      fc.property(pdfUrl, (url) => {
          const state = { ...DEFAULT_APP_STATE, activePdfUrl: url }
          const serialized = serializeState(state)
          expect(serialized.activePdfUrl).toBe(url)
          // Original state unchanged
          expect(state.activePdfUrl).toBe(url)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('full round-trip completes within 300ms', async () => {
    const url = 'https://example.com/document.pdf'
    const state = { ...DEFAULT_APP_STATE, connectedPorts: [] }

    const broadcastMessages = []
    const mockPort = { postMessage: vi.fn((msg) => broadcastMessages.push(msg)) }
    state.connectedPorts = [mockPort]

    const doc = makeDocument()

    const start = performance.now()

    // Content Script detects PDF
    expect(isPdfTab('text/html', url)).toBe(true)

    // Service Worker handles message
    handlePdfDetected({ url }, state, {})

    // Side Panel renders
    const stateUpdate = broadcastMessages[0]
    renderState(stateUpdate.payload, doc)

    const elapsed = performance.now() - start

    expect(doc.getElementById('pdf-url').textContent).toBe(url)
    expect(elapsed).toBeLessThan(300)
  })

  it('non-PDF URLs are not detected by content script', () => {
    const nonPdfUrl = fc.tuple(
      fc.constantFrom('http', 'https'),
      fc.stringMatching(/^[a-z]{3,10}$/),
      fc.stringMatching(/^[a-z]{3,10}$/),
    ).map(([scheme, host, path]) => `${scheme}://${host}.com/${path}.html`)

    fc.assert(
      fc.property(nonPdfUrl, (url) => {
          expect(isPdfTab('text/html', url)).toBe(false)
        }
      ),
      { numRuns: 100 }
    )
  })
})
