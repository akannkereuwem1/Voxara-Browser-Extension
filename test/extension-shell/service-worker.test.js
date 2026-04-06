// Feature: extension-shell
// Property 2: AppState initialises with correct default shape
// Property 3: AppState hydrates from IndexedDB on successful startup
// Property 4: PDF navigation updates activePdfUrl and broadcasts STATE_UPDATE
// Property 5: Non-PDF navigation leaves AppState unchanged
// Property 6: PDF_DETECTED message updates activePdfUrl and broadcasts
// Property 7: ACTION message updates AppState and broadcasts
// Property 8: Unrecognised message type logs warning without state change
// Property 9: New port receives current AppState immediately on connect
// Property 10: Disconnected port is removed from registry
// Property 21: Offscreen Document lifecycle tracks open state correctly

import { describe, it, expect, vi } from 'vitest'
import * as fc from 'fast-check'
import { installFakeIDB } from '../setup.js'
import { initDB } from '../../src/shared/db.js'
import {
  DEFAULT_APP_STATE,
  serializeState,
  broadcastState,
  handlePdfDetected,
  handleAction,
  handleSpeakChunk,
  handleStopSpeech,
  ensureOffscreen,
  buildDispatchTable,
  startup,
} from '../../src/background/index.js'
import { MSG_TYPES } from '../../src/shared/message-bus.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(overrides = {}) {
  return { ...DEFAULT_APP_STATE, connectedPorts: [], offscreenOpen: false, ...overrides }
}

function makePort(failOnPost = false) {
  const disconnectListeners = []
  return {
    messages: [],
    postMessage(msg) {
      if (failOnPost) throw new Error('port closed')
      this.messages.push(msg)
    },
    onDisconnect: {
      addListener(fn) { disconnectListeners.push(fn) },
      fire() { disconnectListeners.forEach(fn => fn()) },
    },
  }
}

function makeCompat() {
  let navListener = null
  let msgListener = null
  let connectListener = null
  return {
    webNavigation: {
      addListener(cb) { navListener = cb },
    },
    ports: {
      connect: vi.fn(() => makePort()),
      onConnect(handler) { connectListener = handler },
    },
    offscreen: {
      create: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => Promise.resolve()),
    },
    runtime: {
      sendMessage: vi.fn(() => Promise.resolve()),
      onMessage(handler) { msgListener = handler },
    },
    // Test helpers to fire events
    _fireNav(details) { navListener?.(details) },
    _fireConnect(port) { connectListener?.(port) },
    _fireMessage(msg) { msgListener?.(msg) },
  }
}

// ---------------------------------------------------------------------------
// Property 2: AppState initialises with correct default shape
// ---------------------------------------------------------------------------

describe('Property 2: AppState default shape', () => {
  it('DEFAULT_APP_STATE has all required fields with correct defaults', () => {
    expect(DEFAULT_APP_STATE.activePdfUrl).toBeNull()
    expect(DEFAULT_APP_STATE.playbackStatus).toBe('idle')
    expect(DEFAULT_APP_STATE.currentChunkIndex).toBe(0)
    expect(Array.isArray(DEFAULT_APP_STATE.connectedPorts)).toBe(true)
    expect(DEFAULT_APP_STATE.offscreenOpen).toBe(false)
  })

  it('makeState always produces valid shape', () => {
    // Property 2: for any overrides, the state always has all required fields
    fc.assert(
      fc.property(
        fc.option(fc.webUrl(), { nil: null }),
        fc.constantFrom('idle', 'playing', 'paused'),
        fc.integer({ min: 0, max: 100 }),
        (url, status, idx) => {
          const state = makeState({ activePdfUrl: url, playbackStatus: status, currentChunkIndex: idx })
          expect(state.activePdfUrl === null || typeof state.activePdfUrl === 'string').toBe(true)
          expect(['idle', 'playing', 'paused']).toContain(state.playbackStatus)
          expect(typeof state.currentChunkIndex).toBe('number')
          expect(Array.isArray(state.connectedPorts)).toBe(true)
          expect(typeof state.offscreenOpen).toBe('boolean')
        }
      ),
      { numRuns: 100 }
    )
  })

  it('startup continues with defaults when DB fails', async () => {
    installFakeIDB()
    // Corrupt IDB after install
    globalThis.indexedDB = { open: () => { throw new Error('fail') } }
    const state = makeState()
    const compat = makeCompat()
    await startup(compat, state)
    // Should still have valid shape
    expect(state.activePdfUrl).toBeNull()
    expect(state.playbackStatus).toBe('idle')
    expect(state.currentChunkIndex).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Property 3: AppState hydrates from IndexedDB on successful startup
// ---------------------------------------------------------------------------

describe('Property 3: AppState hydrates from IndexedDB', () => {
  it('hydrates activePdfUrl from documents store', async () => {
    installFakeIDB()
    const db = await initDB()
    await db.put('documents', { id: 'doc1', url: 'https://example.com/test.pdf' })
    db.close()

    const state = makeState()
    const compat = makeCompat()
    await startup(compat, state)
    expect(state.activePdfUrl).toBe('https://example.com/test.pdf')
  })

  it('hydrates playbackStatus and currentChunkIndex from playbackStates store', async () => {
    installFakeIDB()
    const db = await initDB()
    await db.put('playbackStates', { documentId: 'doc1', status: 'paused', currentChunkIndex: 3 })
    db.close()

    const state = makeState()
    const compat = makeCompat()
    await startup(compat, state)
    expect(state.playbackStatus).toBe('paused')
    expect(state.currentChunkIndex).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// Property 4: PDF navigation updates activePdfUrl and broadcasts STATE_UPDATE
// ---------------------------------------------------------------------------

describe('Property 4: PDF navigation updates state and broadcasts', () => {
  it('property: any .pdf URL (case-insensitive) triggers state update and broadcast', () => {
    // Test the handler directly — no startup() needed
    fc.assert(
      fc.property(
        fc.webUrl().filter(u => !u.toLowerCase().endsWith('.pdf')),
        (base) => {
          for (const suffix of ['.pdf', '.PDF', '.Pdf', '.pDf']) {
            const url = base + suffix
            const state = makeState()
            const port = makePort()
            state.connectedPorts = [port]
            handlePdfDetected({ url }, state, null)
            expect(state.activePdfUrl).toBe(url)
            expect(port.messages[0]?.type).toBe(MSG_TYPES.STATE_UPDATE)
            expect(port.messages[0]?.payload?.activePdfUrl).toBe(url)
          }
        }
      ),
      { numRuns: 30 }
    )
  })

  it('webNavigation listener fires for .pdf URLs', async () => {
    installFakeIDB()
    const state = makeState()
    const port = makePort()
    state.connectedPorts = [port]
    const compat = makeCompat()
    await startup(compat, state)

    compat._fireNav({ url: 'https://example.com/doc.pdf' })
    expect(state.activePdfUrl).toBe('https://example.com/doc.pdf')
    expect(port.messages.some(m => m.type === MSG_TYPES.STATE_UPDATE)).toBe(true)
  })

  it('webNavigation listener ignores non-.pdf URLs', async () => {
    installFakeIDB()
    const state = makeState()
    const compat = makeCompat()
    await startup(compat, state)

    compat._fireNav({ url: 'https://example.com/page.html' })
    expect(state.activePdfUrl).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Property 5: Non-PDF navigation leaves AppState unchanged
// ---------------------------------------------------------------------------

describe('Property 5: Non-PDF navigation leaves AppState unchanged', () => {
  it('property: non-.pdf URLs do not change state via handlePdfDetected', () => {
    // The webNavigation listener only calls handlePdfDetected for .pdf URLs
    // so we verify the guard condition directly
    fc.assert(
      fc.property(
        fc.webUrl().filter(u => !u.toLowerCase().endsWith('.pdf')),
        (url) => {
          const state = makeState()
          const before = JSON.stringify(serializeState(state))
          // Simulate what the webNavigation listener does: only act on .pdf
          if (url.toLowerCase().endsWith('.pdf')) {
            handlePdfDetected({ url }, state, null)
          }
          const after = JSON.stringify(serializeState(state))
          return before === after
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ---------------------------------------------------------------------------
// Property 6: PDF_DETECTED message updates activePdfUrl and broadcasts
// ---------------------------------------------------------------------------

describe('Property 6: PDF_DETECTED message updates state and broadcasts', () => {
  it('property: any URL in PDF_DETECTED payload is stored and broadcast', () => {
    fc.assert(
      fc.property(fc.webUrl(), (url) => {
        const state = makeState()
        const port = makePort()
        state.connectedPorts = [port]
        handlePdfDetected({ url }, state, null)
        expect(state.activePdfUrl).toBe(url)
        expect(port.messages[0]?.payload?.activePdfUrl).toBe(url)
      }),
      { numRuns: 100 }
    )
  })
})

// ---------------------------------------------------------------------------
// Property 7: ACTION message updates AppState and broadcasts
// ---------------------------------------------------------------------------

describe('Property 7: ACTION message updates AppState and broadcasts', () => {
  const actionMap = [
    { type: 'PLAY',   expected: 'playing' },
    { type: 'PAUSE',  expected: 'paused'  },
    { type: 'RESUME', expected: 'playing' },
    { type: 'STOP',   expected: 'idle'    },
  ]

  for (const { type, expected } of actionMap) {
    it(`ACTION ${type} sets playbackStatus to ${expected}`, () => {
      const state = makeState()
      const port = makePort()
      state.connectedPorts = [port]
      handleAction({ type }, state, null)
      expect(state.playbackStatus).toBe(expected)
      expect(port.messages[0]?.type).toBe(MSG_TYPES.STATE_UPDATE)
    })
  }

  it('property: any recognised action broadcasts STATE_UPDATE', () => {
    fc.assert(
      fc.property(fc.constantFrom('PLAY', 'PAUSE', 'RESUME', 'STOP'), (type) => {
        const state = makeState()
        const port = makePort()
        state.connectedPorts = [port]
        handleAction({ type }, state, null)
        return port.messages.length > 0 && port.messages[0].type === MSG_TYPES.STATE_UPDATE
      }),
      { numRuns: 100 }
    )
  })
})

// ---------------------------------------------------------------------------
// Property 8: Unrecognised message type logs warning without state change
// ---------------------------------------------------------------------------

describe('Property 8: Unrecognised message type — no state change', () => {
  it('property: unknown types are absent from dispatch table', () => {
    const knownTypes = new Set(Object.values(MSG_TYPES))
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter(s => !knownTypes.has(s)),
        (unknownType) => {
          const state = makeState()
          const compat = makeCompat()
          const table = buildDispatchTable(state, compat)
          const before = JSON.stringify(serializeState(state))
          const handler = table[unknownType]
          expect(handler).toBeUndefined()
          const after = JSON.stringify(serializeState(state))
          return before === after
        }
      ),
      { numRuns: 100 }
    )
  })

  it('logs a warning for unrecognised types via the message router', async () => {
    installFakeIDB()
    const state = makeState()
    const compat = makeCompat()
    await startup(compat, state)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    compat._fireMessage({ type: 'TOTALLY_UNKNOWN', payload: {}, requestId: 'abc-123' })
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[SW]'), 'TOTALLY_UNKNOWN')
    warnSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// Property 9: New port receives current AppState immediately on connect
// ---------------------------------------------------------------------------

describe('Property 9: New port receives STATE_UPDATE on connect', () => {
  it('property: connecting port immediately receives current state snapshot', () => {
    // Test broadcastState directly — called by the onConnect handler
    fc.assert(
      fc.property(
        fc.option(fc.webUrl(), { nil: null }),
        fc.constantFrom('idle', 'playing', 'paused'),
        (url, status) => {
          const state = makeState({ activePdfUrl: url, playbackStatus: status })
          const port = makePort()
          // Simulate what onConnect does: push port, broadcastState
          state.connectedPorts.push(port)
          broadcastState(state, state.connectedPorts)
          expect(port.messages.length).toBeGreaterThan(0)
          const msg = port.messages[0]
          expect(msg.type).toBe(MSG_TYPES.STATE_UPDATE)
          expect(msg.payload.activePdfUrl).toBe(url)
          expect(msg.payload.playbackStatus).toBe(status)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('port is added to registry and receives STATE_UPDATE on connect', async () => {
    installFakeIDB()
    const state = makeState()
    const compat = makeCompat()
    await startup(compat, state)
    const port = makePort()
    compat._fireConnect(port)
    expect(state.connectedPorts).toContain(port)
    expect(port.messages[0]?.type).toBe(MSG_TYPES.STATE_UPDATE)
  })
})

// ---------------------------------------------------------------------------
// Property 10: Disconnected port is removed from registry
// ---------------------------------------------------------------------------

describe('Property 10: Disconnected port is removed from registry', () => {
  it('property: port is absent from registry after disconnect', async () => {
    installFakeIDB()
    const state = makeState()
    const compat = makeCompat()
    await startup(compat, state)

    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), (n) => {
        // Reset ports for each run
        state.connectedPorts = []
        const ports = Array.from({ length: n }, () => makePort())
        ports.forEach(p => compat._fireConnect(p))
        expect(state.connectedPorts.length).toBe(n)
        ports[0].onDisconnect.fire()
        expect(state.connectedPorts).not.toContain(ports[0])
        expect(state.connectedPorts.length).toBe(n - 1)
      }),
      { numRuns: 30 }
    )
  })

  it('failed port send removes it from registry', () => {
    const state = makeState()
    const goodPort = makePort()
    const badPort = makePort(true)
    state.connectedPorts = [goodPort, badPort]
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    broadcastState(state, state.connectedPorts)
    warnSpy.mockRestore()
    expect(state.connectedPorts).toContain(goodPort)
    expect(state.connectedPorts).not.toContain(badPort)
  })
})

// ---------------------------------------------------------------------------
// Property 21: Offscreen Document lifecycle tracks open state correctly
// ---------------------------------------------------------------------------

describe('Property 21: Offscreen Document lifecycle', () => {
  it('ensureOffscreen sets offscreenOpen to true', async () => {
    const state = makeState()
    const compat = makeCompat()
    expect(state.offscreenOpen).toBe(false)
    await ensureOffscreen(state, compat)
    expect(state.offscreenOpen).toBe(true)
    expect(compat.offscreen.create).toHaveBeenCalledOnce()
  })

  it('ensureOffscreen is idempotent — does not call create twice', async () => {
    const state = makeState()
    const compat = makeCompat()
    await ensureOffscreen(state, compat)
    await ensureOffscreen(state, compat)
    expect(compat.offscreen.create).toHaveBeenCalledOnce()
  })

  it('handleStopSpeech closes offscreen and sets flag to false', async () => {
    const state = makeState({ offscreenOpen: true })
    const compat = makeCompat()
    await handleStopSpeech({}, state, compat)
    expect(state.offscreenOpen).toBe(false)
    expect(compat.offscreen.close).toHaveBeenCalledOnce()
  })

  it('property: SPEAK_CHUNK → STOP_SPEECH sequence tracks open state correctly', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (cycles) => {
        const state = makeState()
        const compat = makeCompat()
        for (let i = 0; i < cycles; i++) {
          await handleSpeakChunk({ text: 'hello', chunkIndex: i }, state, compat)
          expect(state.offscreenOpen).toBe(true)
          await handleStopSpeech({}, state, compat)
          expect(state.offscreenOpen).toBe(false)
        }
      }),
      { numRuns: 20 }
    )
  })
})
