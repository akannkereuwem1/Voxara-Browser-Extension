// Feature: audio-engine
// Property 17: Player UI renders correct play/pause aria-label
// Property 18: Scrubber value tracks currentChunkIndex
// Property 19: Speed/pitch/volume controls send correct messages
// Property 20: Voice selector groups by language

import { describe, it, expect, vi } from 'vitest'
import * as fc from 'fast-check'
import {
  renderPlayer,
  renderVoiceSelector,
  initPlayerControls,
} from '../../src/sidepanel/index.js'
import { MSG_TYPES } from '../../src/shared/message-bus.js'

// ---------------------------------------------------------------------------
// Minimal DOM helpers
// ---------------------------------------------------------------------------

function makeEl(id, attrs = {}) {
  const listeners = {}
  const el = {
    id,
    textContent: '',
    value: attrs.value ?? '',
    disabled: attrs.disabled ?? false,
    max: attrs.max ?? '0',
    min: attrs.min ?? '0',
    innerHTML: '',
    _attrs: { 'aria-label': attrs['aria-label'] ?? '', 'aria-valuetext': '' },
    getAttribute(name) { return el._attrs[name] ?? null },
    setAttribute(name, val) { el._attrs[name] = val },
    addEventListener(event, fn) {
      if (!listeners[event]) listeners[event] = []
      listeners[event].push(fn)
    },
    _fire(event, detail) {
      ;(listeners[event] || []).forEach((fn) => fn(detail))
    },
    appendChild(child) {
      el._children = el._children || []
      el._children.push(child)
    },
    _children: [],
  }
  return el
}

function makeOptgroup(label) {
  const og = { label, _options: [], appendChild(o) { og._options.push(o) } }
  return og
}

function makeOption(value, text) {
  return { value, textContent: text, disabled: false }
}

function makeDocument(overrides = {}) {
  const playPauseBtn  = makeEl('play-pause-btn', { 'aria-label': 'Play' })
  const skipBackBtn   = makeEl('skip-back-btn')
  const skipFwdBtn    = makeEl('skip-fwd-btn')
  const scrubber      = makeEl('scrubber', { value: '0', max: '0' })
  const speedSelect   = makeEl('speed-select', { value: '1.0' })
  const pitchSlider   = makeEl('pitch-slider', { value: '1.0' })
  const volumeSlider  = makeEl('volume-slider', { value: '1.0' })
  const voiceSelect   = makeEl('voice-select')
  const previewBtn    = makeEl('voice-preview-btn')
  const parseProgress = makeEl('parse-progress')
  const parseMessage  = makeEl('parse-message')
  const pdfUrl        = makeEl('pdf-url')
  const playbackStatus = makeEl('playback-status')

  // Track createElement calls for voice selector tests
  const createdElements = []

  const byId = {
    'play-pause-btn':   playPauseBtn,
    'skip-back-btn':    skipBackBtn,
    'skip-fwd-btn':     skipFwdBtn,
    scrubber,
    'speed-select':     speedSelect,
    'pitch-slider':     pitchSlider,
    'volume-slider':    volumeSlider,
    'voice-select':     voiceSelect,
    'voice-preview-btn': previewBtn,
    'parse-progress':   parseProgress,
    'parse-message':    parseMessage,
    'pdf-url':          pdfUrl,
    'playback-status':  playbackStatus,
    ...overrides,
  }

  return {
    getElementById(id) { return byId[id] ?? null },
    querySelectorAll() { return [] },
    createElement(tag) {
      let el
      if (tag === 'optgroup') el = makeOptgroup('')
      else if (tag === 'option') el = makeOption('', '')
      else el = makeEl(tag)
      createdElements.push({ tag, el })
      return el
    },
    _els: byId,
    _created: createdElements,
    defaultView: { confirm: vi.fn(() => true) },
  }
}

function makeCompat() {
  return {
    runtime: { sendMessage: vi.fn(() => Promise.resolve()) },
    offscreen: { create: vi.fn(() => Promise.resolve()), close: vi.fn(() => Promise.resolve()) },
    webNavigation: { addListener: vi.fn() },
    ports: { connect: vi.fn(), onConnect: vi.fn() },
  }
}

// ---------------------------------------------------------------------------
// Property 17: Player UI renders correct play/pause aria-label
// Validates: Requirement 13.2
// ---------------------------------------------------------------------------

describe('Property 17: Player UI renders correct play/pause aria-label', () => {
  it('property: aria-label is "Pause" when playing, "Play" otherwise', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('idle', 'playing', 'paused', 'ended'),
        (playbackStatus) => {
          const doc = makeDocument()
          renderPlayer({ playbackStatus, currentChunkIndex: 0, activeDocumentId: null }, doc)
          const label = doc._els['play-pause-btn'].getAttribute('aria-label')
          if (playbackStatus === 'playing') {
            expect(label).toBe('Pause')
          } else {
            expect(label).toBe('Play')
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  it('scrubber is disabled when no active document', () => {
    const doc = makeDocument()
    renderPlayer({ playbackStatus: 'idle', currentChunkIndex: 0, activeDocumentId: null }, doc)
    expect(doc._els['scrubber'].disabled).toBe(true)
  })

  it('scrubber is enabled when a document is active', () => {
    const doc = makeDocument()
    renderPlayer({ playbackStatus: 'idle', currentChunkIndex: 0, activeDocumentId: 'doc1' }, doc)
    expect(doc._els['scrubber'].disabled).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Property 18: Scrubber value tracks currentChunkIndex
// Validates: Requirements 7.1, 7.2
// ---------------------------------------------------------------------------

describe('Property 18: Scrubber value tracks currentChunkIndex', () => {
  it('property: scrubber value equals currentChunkIndex after renderPlayer', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 200 }), (idx) => {
        const doc = makeDocument()
        renderPlayer({ playbackStatus: 'idle', currentChunkIndex: idx, activeDocumentId: 'doc1' }, doc)
        expect(Number(doc._els['scrubber'].value)).toBe(idx)
      }),
      { numRuns: 100 }
    )
  })

  it('speed/pitch/volume controls reflect state values', () => {
    const doc = makeDocument()
    renderPlayer({
      playbackStatus: 'idle',
      currentChunkIndex: 0,
      activeDocumentId: 'doc1',
      playbackRate: 1.5,
      pitch: 0.8,
      volume: 0.6,
    }, doc)
    expect(doc._els['speed-select'].value).toBe('1.5')
    expect(Number(doc._els['pitch-slider'].value)).toBeCloseTo(0.8)
    expect(Number(doc._els['volume-slider'].value)).toBeCloseTo(0.6)
  })
})

// ---------------------------------------------------------------------------
// Property 19: Speed/pitch/volume controls send correct messages
// Validates: Requirements 8.1–8.6
// ---------------------------------------------------------------------------

describe('Property 19: Speed/pitch/volume controls send correct messages', () => {
  it('speed change sends SET_RATE with parsed float', () => {
    const doc = makeDocument()
    const compat = makeCompat()
    initPlayerControls(compat, doc)

    doc._els['speed-select'].value = '1.5'
    doc._els['speed-select']._fire('change')

    expect(compat.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: MSG_TYPES.SET_RATE, payload: { rate: 1.5 } })
    )
  })

  it('pitch input sends SET_PITCH with parsed float', () => {
    const doc = makeDocument()
    const compat = makeCompat()
    initPlayerControls(compat, doc)

    doc._els['pitch-slider'].value = '0.8'
    doc._els['pitch-slider']._fire('input')

    expect(compat.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: MSG_TYPES.SET_PITCH, payload: { pitch: 0.8 } })
    )
  })

  it('volume input sends SET_VOLUME with parsed float', () => {
    const doc = makeDocument()
    const compat = makeCompat()
    initPlayerControls(compat, doc)

    doc._els['volume-slider'].value = '0.5'
    doc._els['volume-slider']._fire('input')

    expect(compat.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: MSG_TYPES.SET_VOLUME, payload: { volume: 0.5 } })
    )
  })

  it('scrubber change sends SEEK_TO_CHUNK with integer chunkIndex', () => {
    const doc = makeDocument()
    const compat = makeCompat()
    initPlayerControls(compat, doc)

    doc._els['scrubber'].value = '7'
    doc._els['scrubber']._fire('change')

    expect(compat.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: MSG_TYPES.SEEK_TO_CHUNK, payload: { chunkIndex: 7 } })
    )
  })

  it('skip-back sends SKIP_BACK with seconds: 10', () => {
    const doc = makeDocument()
    const compat = makeCompat()
    initPlayerControls(compat, doc)
    doc._els['skip-back-btn']._fire('click')
    expect(compat.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: MSG_TYPES.SKIP_BACK, payload: { seconds: 10 } })
    )
  })

  it('skip-forward sends SKIP_FORWARD with seconds: 10', () => {
    const doc = makeDocument()
    const compat = makeCompat()
    initPlayerControls(compat, doc)
    doc._els['skip-fwd-btn']._fire('click')
    expect(compat.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: MSG_TYPES.SKIP_FORWARD, payload: { seconds: 10 } })
    )
  })

  it('play button sends ACTION PLAY when aria-label is Play', () => {
    const doc = makeDocument()
    const compat = makeCompat()
    doc._els['play-pause-btn']._attrs['aria-label'] = 'Play'
    initPlayerControls(compat, doc)
    doc._els['play-pause-btn']._fire('click')
    expect(compat.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: MSG_TYPES.ACTION, payload: { type: 'PLAY' } })
    )
  })

  it('pause button sends ACTION PAUSE when aria-label is Pause', () => {
    const doc = makeDocument()
    const compat = makeCompat()
    doc._els['play-pause-btn']._attrs['aria-label'] = 'Pause'
    initPlayerControls(compat, doc)
    doc._els['play-pause-btn']._fire('click')
    expect(compat.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: MSG_TYPES.ACTION, payload: { type: 'PAUSE' } })
    )
  })

  it('voice selector change sends SET_VOICE', () => {
    const doc = makeDocument()
    const compat = makeCompat()
    initPlayerControls(compat, doc)
    doc._els['voice-select'].value = 'urn:v:test'
    doc._els['voice-select']._fire('change')
    expect(compat.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: MSG_TYPES.SET_VOICE, payload: { voiceId: 'urn:v:test' } })
    )
  })
})

// ---------------------------------------------------------------------------
// Property 20: Voice selector groups by language
// Validates: Requirement 12.3
// ---------------------------------------------------------------------------

describe('Property 20: Voice selector groups by language', () => {
  it('property: voices are grouped into optgroups by lang', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            voiceURI:     fc.string({ minLength: 1 }),
            name:         fc.string({ minLength: 1 }),
            lang:         fc.constantFrom('en-US', 'en-GB', 'fr-FR', 'de-DE'),
            localService: fc.boolean(),
          }),
          { minLength: 1, maxLength: 8 }
        ),
        (voices) => {
          const doc = makeDocument()
          renderVoiceSelector(voices, null, doc)

          // Count unique langs
          const langs = new Set(voices.map((v) => v.lang))
          const optgroups = doc._created.filter((c) => c.tag === 'optgroup')
          expect(optgroups.length).toBe(langs.size)

          // Each optgroup label matches a lang
          for (const { el } of optgroups) {
            expect(langs.has(el.label)).toBe(true)
          }
        }
      ),
      { numRuns: 50 }
    )
  })

  it('renders disabled placeholder when voices list is empty', () => {
    const doc = makeDocument()
    renderVoiceSelector([], null, doc)
    expect(doc._els['voice-select'].disabled).toBe(true)
    const opts = doc._created.filter((c) => c.tag === 'option')
    expect(opts.length).toBe(1)
    expect(opts[0].el.textContent).toBe('No voices available')
  })

  it('sets selector value to selectedVoiceURI after populating', () => {
    const voices = [
      { voiceURI: 'urn:v:1', name: 'Voice 1', lang: 'en-US', localService: true },
      { voiceURI: 'urn:v:2', name: 'Voice 2', lang: 'en-US', localService: false },
    ]
    const doc = makeDocument()
    renderVoiceSelector(voices, 'urn:v:2', doc)
    expect(doc._els['voice-select'].value).toBe('urn:v:2')
  })
})
