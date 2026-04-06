// Feature: extension-shell, Property 1: CompatAPI exposes all Phase 1 namespaces
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { BrowserCompat, BrowserCompatError } from '../../src/shared/browser-compat.js'

// ---------------------------------------------------------------------------
// Minimal mock builders
// ---------------------------------------------------------------------------

function makeChromeEnv(overrides = {}) {
  return {
    chrome: {
      storage: { local: { get: () => {}, set: () => {}, remove: () => {} } },
      runtime: {
        lastError: null,
        sendMessage: () => {},
        onMessage: { addListener: () => {} },
        connect: () => mockPort(),
        onConnect: { addListener: () => {} },
      },
      tabs: { query: () => {}, update: () => {} },
      webNavigation: { onCommitted: { addListener: () => {} } },
      offscreen: { createDocument: () => Promise.resolve(), closeDocument: () => Promise.resolve() },
      ...overrides,
    },
  }
}

function makeFirefoxEnv(overrides = {}) {
  return {
    browser: {
      storage: { local: { get: () => {}, set: () => {}, remove: () => {} } },
      runtime: {
        sendMessage: () => {},
        onMessage: { addListener: () => {} },
        connect: () => mockPort(),
        onConnect: { addListener: () => {} },
      },
      tabs: { query: () => {}, update: () => {} },
      webNavigation: { onCommitted: { addListener: () => {} } },
      ...overrides,
    },
  }
}

function mockPort() {
  return { onMessage: { addListener: () => {} }, onDisconnect: { addListener: () => {} }, postMessage: () => {} }
}

// ---------------------------------------------------------------------------
// Property 1: CompatAPI exposes all Phase 1 namespaces
// ---------------------------------------------------------------------------

const REQUIRED_NAMESPACES = ['storage', 'runtime', 'sidePanel', 'tabs', 'webNavigation', 'ports', 'offscreen']

describe('BrowserCompat — namespace completeness (Property 1)', () => {
  it('Chrome env exposes all 7 namespaces', () => {
    const compat = BrowserCompat.initWithEnv(makeChromeEnv())
    for (const ns of REQUIRED_NAMESPACES) {
      expect(compat, `missing namespace: ${ns}`).toHaveProperty(ns)
    }
  })

  it('Firefox env exposes all 7 namespaces', () => {
    const compat = BrowserCompat.initWithEnv(makeFirefoxEnv())
    for (const ns of REQUIRED_NAMESPACES) {
      expect(compat, `missing namespace: ${ns}`).toHaveProperty(ns)
    }
  })

  it('webNavigation.addListener is callable on Chrome', () => {
    const compat = BrowserCompat.initWithEnv(makeChromeEnv())
    expect(typeof compat.webNavigation.addListener).toBe('function')
  })

  it('webNavigation.addListener is callable on Firefox', () => {
    const compat = BrowserCompat.initWithEnv(makeFirefoxEnv())
    expect(typeof compat.webNavigation.addListener).toBe('function')
  })

  it('ports.connect and ports.onConnect are callable on Chrome', () => {
    const compat = BrowserCompat.initWithEnv(makeChromeEnv())
    expect(typeof compat.ports.connect).toBe('function')
    expect(typeof compat.ports.onConnect).toBe('function')
  })

  it('ports.connect and ports.onConnect are callable on Firefox', () => {
    const compat = BrowserCompat.initWithEnv(makeFirefoxEnv())
    expect(typeof compat.ports.connect).toBe('function')
    expect(typeof compat.ports.onConnect).toBe('function')
  })

  it('offscreen.create and offscreen.close are callable on Chrome', () => {
    const compat = BrowserCompat.initWithEnv(makeChromeEnv())
    expect(typeof compat.offscreen.create).toBe('function')
    expect(typeof compat.offscreen.close).toBe('function')
  })

  it('offscreen.create and offscreen.close return resolved Promises on Firefox (noop)', async () => {
    const compat = BrowserCompat.initWithEnv(makeFirefoxEnv())
    await expect(compat.offscreen.create({})).resolves.toBeUndefined()
    await expect(compat.offscreen.close()).resolves.toBeUndefined()
  })

  it('unavailable webNavigation falls back to noop without throwing', () => {
    // Chrome env without webNavigation
    const compat = BrowserCompat.initWithEnv(makeChromeEnv({ webNavigation: undefined }))
    expect(() => compat.webNavigation.addListener(() => {})).not.toThrow()
  })

  it('unavailable offscreen falls back to noop that resolves', async () => {
    const compat = BrowserCompat.initWithEnv(makeChromeEnv({ offscreen: undefined }))
    await expect(compat.offscreen.create({})).resolves.toBeUndefined()
    await expect(compat.offscreen.close()).resolves.toBeUndefined()
  })

  it('throws BrowserCompatError when neither chrome nor browser is present', () => {
    expect(() => BrowserCompat.initWithEnv({})).toThrow(BrowserCompatError)
  })

  // Property-based: for any supported env shape, all namespaces are present
  it('property: Chrome env always exposes all namespaces regardless of optional APIs', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (hasWebNav, hasOffscreen) => {
        const env = makeChromeEnv({
          webNavigation: hasWebNav ? { onCommitted: { addListener: () => {} } } : undefined,
          offscreen: hasOffscreen ? { createDocument: () => Promise.resolve(), closeDocument: () => Promise.resolve() } : undefined,
        })
        const compat = BrowserCompat.initWithEnv(env)
        for (const ns of REQUIRED_NAMESPACES) {
          if (!(ns in compat)) return false
        }
        return true
      }),
      { numRuns: 100 }
    )
  })
})
