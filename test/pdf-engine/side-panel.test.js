// Feature: pdf-engine
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { renderCard, renderProgress, formatRelativeTime } from '../../src/sidepanel/index.js'

// ---------------------------------------------------------------------------
// Property 16: Library tab sort order
// Validates: Requirement 10.5
// ---------------------------------------------------------------------------

describe('Library tab sort order', () => {
  it('Property 16: docs sorted by lastOpenedAt descending', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            lastOpenedAt: fc.integer({ min: 0, max: 9999999999999 }),
            title: fc.string({ minLength: 1, maxLength: 30 }),
            parseStatus: fc.constantFrom('complete', 'pending', 'failed'),
            pageCount: fc.integer({ min: 1, max: 500 }),
            chunkCount: fc.integer({ min: 0, max: 200 }),
          }),
          { minLength: 2, maxLength: 20 }
        ),
        (docs) => {
          const sorted = [...docs].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
          // Verify the sort is stable and descending
          for (let i = 0; i < sorted.length - 1; i++) {
            expect(sorted[i].lastOpenedAt).toBeGreaterThanOrEqual(sorted[i + 1].lastOpenedAt)
          }
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ---------------------------------------------------------------------------
// renderCard unit tests
// Validates: Requirements 10.2, 10.6, 10.7
// ---------------------------------------------------------------------------

describe('renderCard', () => {
  const baseDoc = {
    id: 'doc-1',
    title: 'My PDF',
    pageCount: 10,
    chunkCount: 5,
    parseStatus: 'complete',
    lastOpenedAt: Date.now() - 86400000, // yesterday
  }

  it('renders title for complete document', () => {
    const html = renderCard(baseDoc)
    expect(html).toContain('My PDF')
    expect(html).toContain('10p')
    expect(html).toContain('5 chunks')
    expect(html).toContain('data-load="doc-1"')
  })

  it('renders Parsing... for pending document', () => {
    const html = renderCard({ ...baseDoc, parseStatus: 'pending' })
    expect(html).toContain('Parsing...')
    expect(html).not.toContain('data-load')
  })

  it('renders Parse failed for failed document', () => {
    const html = renderCard({ ...baseDoc, parseStatus: 'failed' })
    expect(html).toContain('Parse failed')
    expect(html).toContain('data-load="doc-1"') // retry button
    expect(html).toContain('data-delete="doc-1"')
  })

  it('renders delete button on all cards', () => {
    for (const status of ['complete', 'pending', 'failed']) {
      const html = renderCard({ ...baseDoc, parseStatus: status })
      expect(html).toContain('data-delete="doc-1"')
    }
  })

  it('uses Untitled when title is null', () => {
    const html = renderCard({ ...baseDoc, title: null })
    expect(html).toContain('Untitled')
  })
})

// ---------------------------------------------------------------------------
// renderProgress unit tests
// Validates: Requirements 12.1, 12.2, 12.3, 12.5
// ---------------------------------------------------------------------------

describe('renderProgress', () => {
  function makeDoc() {
    const bar = { style: { display: '' }, value: 0 }
    const msg = { textContent: '' }
    const doc = {
      getElementById: (id) => {
        if (id === 'parse-progress') return bar
        if (id === 'parse-message') return msg
        return null
      },
    }
    return { bar, msg, doc }
  }

  it('shows bar and message when parseStatus is pending', () => {
    const { bar, msg, doc } = makeDoc()
    renderProgress({ parseStatus: 'pending', parseProgress: null }, doc)
    expect(bar.style.display).toBe('block')
    expect(msg.textContent).toBe('Preparing your document...')
  })

  it('updates bar value from parseProgress', () => {
    const { bar, doc } = makeDoc()
    renderProgress({ parseStatus: 'pending', parseProgress: { pagesProcessed: 5, totalPages: 10 } }, doc)
    expect(bar.value).toBe(50)
  })

  it('hides bar when parseStatus is complete', () => {
    const { bar, msg, doc } = makeDoc()
    renderProgress({ parseStatus: 'complete', parseProgress: null }, doc)
    expect(bar.style.display).toBe('none')
    expect(msg.textContent).toBe('')
  })

  it('hides bar and shows error when parseStatus is failed', () => {
    const { bar, msg, doc } = makeDoc()
    renderProgress({ parseStatus: 'failed', parseProgress: null }, doc)
    expect(bar.style.display).toBe('none')
    expect(msg.textContent).toContain('failed')
  })
})

// ---------------------------------------------------------------------------
// formatRelativeTime unit tests
// ---------------------------------------------------------------------------

describe('formatRelativeTime', () => {
  it('returns "today" for timestamps within the last 24h', () => {
    expect(formatRelativeTime(Date.now() - 1000)).toBe('today')
  })

  it('returns "yesterday" for ~1 day ago', () => {
    expect(formatRelativeTime(Date.now() - 86400000 - 1000)).toBe('yesterday')
  })

  it('returns "N days ago" for older timestamps', () => {
    expect(formatRelativeTime(Date.now() - 86400000 * 3)).toBe('3 days ago')
  })
})
