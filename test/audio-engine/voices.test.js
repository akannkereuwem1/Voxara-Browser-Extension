// Feature: audio-engine
// Property 2: Voice enumeration exposes required fields
// Property 3: Voice persistence round-trip
import { describe, it, expect, vi } from 'vitest'
import * as fc from 'fast-check'
import { createVoiceManager } from '../../src/lib/audio/voices.js'

// ---------------------------------------------------------------------------
// Stub SpeechSynthesisUtterance for Node environment
// ---------------------------------------------------------------------------

class FakeUtterance {
  constructor(text) { this.text = text; this.voice = null }
}
globalThis.SpeechSynthesisUtterance = FakeUtterance

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRawVoice(overrides = {}) {
  return {
    voiceURI:     overrides.voiceURI     ?? 'urn:voice:test',
    name:         overrides.name         ?? 'Test Voice',
    lang:         overrides.lang         ?? 'en-US',
    localService: overrides.localService ?? true,
    default:      false,
    _extra:       'should-be-stripped',
  }
}

function makeSynth(rawVoices = []) {
  const listeners = {}
  const synth = {
    _rawVoices: rawVoices,
    getVoices: vi.fn(() => synth._rawVoices),
    cancel: vi.fn(),
    speak: vi.fn(),
    addEventListener: vi.fn((event, fn) => { listeners[event] = fn }),
    _fireVoicesChanged() { listeners['voiceschanged']?.() },
  }
  return synth
}

function makeStorage(initial = {}) {
  const store = { ...initial }
  return {
    store,
    get: vi.fn(async (key) => ({ [key]: store[key] })),
    set: vi.fn(async (obj) => Object.assign(store, obj)),
  }
}

// ---------------------------------------------------------------------------
// Property 2: Voice enumeration exposes required fields
// Validates: Requirements 2.1, 2.2
// ---------------------------------------------------------------------------

describe('Property 2: Voice enumeration exposes required fields', () => {
  it('property: every enumerated voice has voiceURI, name, lang, localService', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            voiceURI:     fc.string({ minLength: 1 }),
            name:         fc.string({ minLength: 1 }),
            lang:         fc.string({ minLength: 2 }),
            localService: fc.boolean(),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        async (rawVoices) => {
          const synth = makeSynth(rawVoices)
          const storage = makeStorage()
          const vm = createVoiceManager(synth, storage)
          // init() calls enumerate() and registers voiceschanged listener
          await vm.init()

          const voices = vm.getVoices()
          expect(voices.length).toBe(rawVoices.length)
          for (const v of voices) {
            expect(typeof v.voiceURI).toBe('string')
            expect(typeof v.name).toBe('string')
            expect(typeof v.lang).toBe('string')
            expect(typeof v.localService).toBe('boolean')
            expect(v).not.toHaveProperty('_extra')
            expect(v).not.toHaveProperty('default')
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  it('logs a warning and returns empty array when no voices available after voiceschanged', async () => {
    const synth = makeSynth([])
    const storage = makeStorage()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const vm = createVoiceManager(synth, storage)
    await vm.init()
    // fire voiceschanged with still-empty list
    synth._fireVoicesChanged()
    expect(vm.getVoices()).toEqual([])
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[VoiceManager]'))
    warnSpy.mockRestore()
  })

  it('re-enumerates on voiceschanged', async () => {
    const synth = makeSynth([])
    const storage = makeStorage()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const vm = createVoiceManager(synth, storage)
    await vm.init()
    expect(vm.getVoices()).toEqual([])

    // Add voices and fire event
    const newVoice = makeRawVoice({ voiceURI: 'urn:voice:new', name: 'New Voice' })
    synth._rawVoices.push(newVoice)
    synth._fireVoicesChanged()

    expect(vm.getVoices().length).toBe(1)
    expect(vm.getVoices()[0].voiceURI).toBe('urn:voice:new')
    warnSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// Property 3: Voice persistence round-trip
// Validates: Requirements 2.4, 2.5
// ---------------------------------------------------------------------------

describe('Property 3: Voice persistence round-trip', () => {
  it('property: selectVoice persists voiceURI and getSelectedVoiceURI returns it', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        async (voiceURI) => {
          const synth = makeSynth([makeRawVoice({ voiceURI })])
          const storage = makeStorage()
          const vm = createVoiceManager(synth, storage)

          await vm.selectVoice(voiceURI)

          expect(vm.getSelectedVoiceURI()).toBe(voiceURI)
          expect(storage.set).toHaveBeenCalledWith({ voiceId: voiceURI })
          expect(storage.store.voiceId).toBe(voiceURI)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('init restores persisted voiceId when voice is still in list', async () => {
    const voice = makeRawVoice({ voiceURI: 'urn:voice:persisted' })
    const synth = makeSynth([voice])
    const storage = makeStorage({ voiceId: 'urn:voice:persisted' })
    const vm = createVoiceManager(synth, storage)

    await vm.init()

    expect(vm.getSelectedVoiceURI()).toBe('urn:voice:persisted')
  })

  it('init falls back to first voice when persisted voiceId is stale', async () => {
    const voice = makeRawVoice({ voiceURI: 'urn:voice:current' })
    const synth = makeSynth([voice])
    const storage = makeStorage({ voiceId: 'urn:voice:stale' })
    const vm = createVoiceManager(synth, storage)

    await vm.init()

    expect(vm.getSelectedVoiceURI()).toBe('urn:voice:current')
  })

  it('init does not throw when no voices are available and voiceId is stale', async () => {
    const synth = makeSynth([])
    const storage = makeStorage({ voiceId: 'urn:voice:stale' })
    const vm = createVoiceManager(synth, storage)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(vm.init()).resolves.not.toThrow()
    expect(vm.getSelectedVoiceURI()).toBeNull()
    warnSpy.mockRestore()
  })

  it('preview cancels any in-progress speech before speaking', async () => {
    const voice = makeRawVoice({ voiceURI: 'urn:voice:test' })
    const synth = makeSynth([voice])
    const storage = makeStorage()
    const vm = createVoiceManager(synth, storage)
    await vm.init()

    await vm.selectVoice('urn:voice:test')
    vm.preview()

    // cancel must be called before speak
    expect(synth.cancel).toHaveBeenCalled()
    expect(synth.speak).toHaveBeenCalledOnce()
    const cancelOrder = synth.cancel.mock.invocationCallOrder[0]
    const speakOrder  = synth.speak.mock.invocationCallOrder[0]
    expect(cancelOrder).toBeLessThan(speakOrder)
  })
})
