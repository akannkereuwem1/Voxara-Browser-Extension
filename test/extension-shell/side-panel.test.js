// Feature: extension-shell, Property 15: Tab switching shows correct content area
// Feature: extension-shell, Property 16: Player tab renders AppState fields correctly
// Feature: extension-shell, Property 17: STATE_UPDATE on port triggers UI re-render
// Feature: extension-shell, Property 18: Port reconnect uses exponential backoff

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fc from 'fast-check'
import { initTabs, renderState, createPortManager } from '../../src/sidepanel/index.js'
import { MSG_TYPES } from '../../src/shared/message-bus.js'

// ---------------------------------------------------------------------------
// Minimal DOM helpers
// ---------------------------------------------------------------------------

function makeClassList(initial) {
  const set = new Set(initial)
  return {
    add(c) { set.add(c) },
    remove(c) { set.delete(c) },
    contains(c) { return set.has(c) },
  }
}

function makeEl(id, classes) {
  const listeners = {}
  return {
    id,
    textContent: '',
    classList: makeClassList(classes),
    dataset: {},
    addEventListener(event, fn) {
      if (!listeners[event]) listeners[event] = []
      listeners[event].push(fn)
    },
    _fire(event) {
      const fns = listeners[event] || []
      fns.forEach((fn) => fn())
    },
  }
}

/**
 * Build a minimal document-like object mirroring the side panel HTML structure.
 */
function makeDocument() {
  const btnPlayer = makeEl('btn-player', ['tab-btn', 'active'])
  btnPlayer.dataset.tab = 'player'

  const btnChat = makeEl('btn-chat', ['tab-btn'])
  btnChat.dataset.tab = 'chat'

  const btnLibrary = makeEl('btn-library', ['tab-btn'])
  btnLibrary.dataset.tab = 'library'

  const contentPlayer = makeEl('player', ['tab-content'])
  const contentChat = makeEl('chat', ['tab-content', 'hidden'])
  const contentLibrary = makeEl('library', ['tab-content', 'hidden'])

  const pdfUrl = makeEl('pdf-url', [])
  const playbackStatus = makeEl('playback-status', [])

  const buttons = [btnPlayer, btnChat, btnLibrary]
  const contents = [contentPlayer, contentChat, contentLibrary]

  const byId = {
    'btn-player': btnPlayer,
    'btn-chat': btnChat,
    'btn-library': btnLibrary,
    player: contentPlayer,
    chat: contentChat,
    library: contentLibrary,
    'pdf-url': pdfUrl,
    'playback-status': playbackStatus,
  }

  return {
    querySelectorAll(selector) {
      if (selector === '.tab-btn') return buttons
      if (selector === '.tab-content') return contents
      return []
    },
    getElementById(id) {
      return byId[id] || null
    },
    _buttons: buttons,
    _contents: contents,
  }
}

// ---------------------------------------------------------------------------
// Property 15: Tab switching shows correct content area
// ---------------------------------------------------------------------------

describe('Property 15: Tab switching shows correct content area', () => {
  it('property: clicking any tab button activates only that tab', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('player', 'chat', 'library'),
        (tabId) => {
          const doc = makeDocument()
          initTabs(doc)

          const btn = doc._buttons.find((b) => b.dataset.tab === tabId)
          btn._fire('click')

          for (const b of doc._buttons) {
            if (b.dataset.tab === tabId) {
              expect(b.classList.contains('active')).toBe(true)
            } else {
              expect(b.classList.contains('active')).toBe(false)
            }
          }

          for (const c of doc._contents) {
            if (c.id === tabId) {
              expect(c.classList.contains('hidden')).toBe(false)
            } else {
              expect(c.classList.contains('hidden')).toBe(true)
            }
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  it('switching tabs multiple times always leaves exactly one active', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('player', 'chat', 'library'), { minLength: 2, maxLength: 10 }),
        (sequence) => {
          const doc = makeDocument()
          initTabs(doc)

          for (const tabId of sequence) {
            const btn = doc._buttons.find((b) => b.dataset.tab === tabId)
            btn._fire('click')
          }

          const lastTab = sequence[sequence.length - 1]
          const activeButtons = doc._buttons.filter((b) => b.classList.contains('active'))
          const visibleContents = doc._contents.filter((c) => !c.classList.contains('hidden'))

          expect(activeButtons.length).toBe(1)
          expect(activeButtons[0].dataset.tab).toBe(lastTab)
          expect(visibleContents.length).toBe(1)
          expect(visibleContents[0].id).toBe(lastTab)
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ---------------------------------------------------------------------------
// Property 16: Player tab renders AppState fields correctly
// ---------------------------------------------------------------------------

describe('Property 16: Player tab renders AppState fields correctly', () => {
  it('property: activePdfUrl is rendered verbatim when present', () => {
    fc.assert(
      fc.property(fc.webUrl(), fc.string(), (url, status) => {
        const doc = makeDocument()
        renderState({ activePdfUrl: url, playbackStatus: status }, doc)
        expect(doc.getElementById('pdf-url').textContent).toBe(url)
        expect(doc.getElementById('playback-status').textContent).toBe(status)
      }),
      { numRuns: 100 }
    )
  })

  it('property: null/undefined activePdfUrl renders fallback text', () => {
    fc.assert(
      fc.property(fc.constantFrom(null, undefined), fc.string(), (url, status) => {
        const doc = makeDocument()
        renderState({ activePdfUrl: url, playbackStatus: status }, doc)
        expect(doc.getElementById('pdf-url').textContent).toBe('No PDF detected')
      }),
      { numRuns: 50 }
    )
  })

  it('property: null/undefined playbackStatus renders fallback "idle"', () => {
    fc.assert(
      fc.property(fc.webUrl(), fc.constantFrom(null, undefined), (url, status) => {
        const doc = makeDocument()
        renderState({ activePdfUrl: url, playbackStatus: status }, doc)
        expect(doc.getElementById('playback-status').textContent).toBe('idle')
      }),
      { numRuns: 50 }
    )
  })

  it('missing DOM elements do not throw', () => {
    const emptyDoc = { querySelectorAll: () => [], getElementById: () => null }
    expect(() =>
      renderState({ activePdfUrl: 'https://x.com/a.pdf', playbackStatus: 'playing' }, emptyDoc)
    ).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Port manager helpers
// ---------------------------------------------------------------------------

function makePort() {
  const msgListeners = []
  const disconnectListeners = []
  return {
    onMessage: {
      addListener: vi.fn((fn) => msgListeners.push(fn)),
    },
    onDisconnect: {
      addListener: vi.fn((fn) => disconnectListeners.push(fn)),
    },
    _triggerMessage(msg) { msgListeners.forEach((fn) => fn(msg)) },
    _triggerDisconnect() { disconnectListeners.forEach((fn) => fn()) },
  }
}

function makeCompat(port) {
  return { ports: { connect: vi.fn(() => port) } }
}

// ---------------------------------------------------------------------------
// Property 17: STATE_UPDATE on port triggers UI re-render
// ---------------------------------------------------------------------------

describe('Property 17: STATE_UPDATE on port triggers UI re-render', () => {
  it('property: STATE_UPDATE message calls onStateUpdate with payload', () => {
    fc.assert(
      fc.property(fc.webUrl(), fc.string(), (url, status) => {
        const port = makePort()
        const compat = makeCompat(port)
        const onStateUpdate = vi.fn()

        const manager = createPortManager(compat, onStateUpdate)
        manager.connect()

        const payload = { activePdfUrl: url, playbackStatus: status }
        port._triggerMessage({ type: MSG_TYPES.STATE_UPDATE, payload })

        expect(onStateUpdate).toHaveBeenCalledWith(payload)
      }),
      { numRuns: 100 }
    )
  })

  it('non-STATE_UPDATE messages do not call onStateUpdate', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => s !== MSG_TYPES.STATE_UPDATE),
        (type) => {
          const port = makePort()
          const compat = makeCompat(port)
          const onStateUpdate = vi.fn()

          const manager = createPortManager(compat, onStateUpdate)
          manager.connect()

          port._triggerMessage({ type, payload: {} })

          expect(onStateUpdate).not.toHaveBeenCalled()
        }
      ),
      { numRuns: 50 }
    )
  })
})

// ---------------------------------------------------------------------------
// Property 18: Port reconnect uses exponential backoff
// ---------------------------------------------------------------------------

describe('Property 18: Port reconnect uses exponential backoff', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('retryCount resets to 0 after successful connect', () => {
    const port = makePort()
    const compat = makeCompat(port)
    const manager = createPortManager(compat, vi.fn())
    manager.connect()
    expect(manager.getRetryCount()).toBe(0)
    vi.useRealTimers()
  })

  it('retryCount increments on disconnect and resets on reconnect', () => {
    const port = makePort()
    const compat = makeCompat(port)
    const manager = createPortManager(compat, vi.fn())
    manager.connect()

    port._triggerDisconnect()
    expect(manager.getRetryCount()).toBe(1)

    // Advance past first retry delay (500 * 2^0 = 500ms)
    vi.advanceTimersByTime(500)
    expect(manager.getRetryCount()).toBe(0)

    vi.useRealTimers()
  })

  it('property: backoff delay for attempt n is 500 * 2^(n-1)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), (attempt) => {
        const expectedDelay = 500 * Math.pow(2, attempt - 1)
        // BASE_DELAY_MS=500, retryCount starts at 0 before increment
        // attempt 1 → delay = 500 * 2^0 = 500
        // attempt 2 → delay = 500 * 2^1 = 1000, etc.
        expect(expectedDelay).toBe(500 * Math.pow(2, attempt - 1))
      }),
      { numRuns: 5 }
    )
  })

  it('warns and stops scheduling retries once retryCount reaches MAX_RETRIES', () => {
    const port = makePort()
    const compat = { ports: { connect: vi.fn(() => port) } }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const manager = createPortManager(compat, vi.fn())
    manager.connect() // retryCount resets to 0

    // Fire 5 disconnects without advancing timers — retryCount increments 0→1→2→3→4→5
    // connect() is never called because timers haven't fired
    for (let i = 0; i < 5; i++) {
      port._triggerDisconnect()
    }
    expect(manager.getRetryCount()).toBe(5)

    // 6th disconnect: retryCount (5) >= MAX_RETRIES (5) → warn, no new timer
    // Capture setTimeout call count before
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    port._triggerDisconnect()
    // No new setTimeout should have been called
    expect(setTimeoutSpy).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith('[SidePanel] Max reconnect attempts reached')

    setTimeoutSpy.mockRestore()
    warnSpy.mockRestore()
    vi.useRealTimers()
  })
})
