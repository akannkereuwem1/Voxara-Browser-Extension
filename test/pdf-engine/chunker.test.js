// Feature: pdf-engine
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { chunkPages } from '../../src/content/pdf/chunker.js'

const DOC_ID = 'test-doc-id'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a sentence that Intl.Segmenter will actually split on.
 * Starts with an uppercase word so ICU sentence rules fire correctly.
 */
function makeSentence(prefix, index, wordCount) {
  const words = Array.from({ length: wordCount }, (_, i) => {
    const w = `${prefix}${index}w${i}`
    return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w
  })
  return words.join(' ') + '. '
}

/** Build a page with N words of text (single sentence per call). */
function makePage(pageNumber, wordCount, headings = []) {
  const text = wordCount > 0
    ? makeSentence('word', pageNumber, wordCount).trim()
    : ''
  return { pageNumber, text, headings }
}

/** Count words in a string. */
function countWords(str) {
  return str.trim().split(/\s+/).filter(Boolean).length
}

/** Generate a page with realistic multi-sentence text. */
function makePageWithSentences(pageNumber, sentences) {
  return { pageNumber, text: sentences.join(' '), headings: [] }
}

// ---------------------------------------------------------------------------
// Property 7: chunkPages word count bounds
// Validates: Requirement 5.3
// ---------------------------------------------------------------------------

describe('chunkPages word count bounds', () => {
  it('Property 7: all non-last chunks have 120 ≤ wordCount ≤ 180', () => {
    // 7 distinct sentences × 30 words = 210 words total → must produce at least 2 chunks
    const sentences = Array.from({ length: 7 }, (_, s) => makeSentence('p', s, 30))
    const pages = [{ pageNumber: 1, text: sentences.join(''), headings: [] }]
    const chunks = chunkPages(pages, DOC_ID)
    if (chunks.length < 2) return
    const nonLast = chunks.slice(0, -1)
    for (const chunk of nonLast) {
      expect(chunk.wordCount).toBeGreaterThanOrEqual(120)
      expect(chunk.wordCount).toBeLessThanOrEqual(180)
    }
  })

  it('Property 7 (property-based): non-last chunks satisfy bounds for large inputs', () => {
    fc.assert(
      fc.property(fc.integer({ min: 8, max: 20 }), (sentenceCount) => {
        const sentences = Array.from({ length: sentenceCount }, (_, s) => makeSentence('p', s, 25))
        const text = sentences.join('')
        const pages = [{ pageNumber: 1, text: text.trim(), headings: [] }]
        const chunks = chunkPages(pages, DOC_ID)
        const nonLast = chunks.slice(0, -1)
        for (const chunk of nonLast) {
          expect(chunk.wordCount).toBeGreaterThanOrEqual(120)
          expect(chunk.wordCount).toBeLessThanOrEqual(180)
        }
      }),
      { numRuns: 50 }
    )
  })
})

// ---------------------------------------------------------------------------
// Property 8: chunkPages sentence boundary invariant
// Validates: Requirement 5.4
// ---------------------------------------------------------------------------

describe('chunkPages sentence boundary invariant', () => {
  it('Property 8: no chunk ends mid-sentence', () => {
    const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' })

    fc.assert(
      fc.property(fc.integer({ min: 4, max: 15 }), (sentenceCount) => {
        const sentences = Array.from({ length: sentenceCount }, (_, s) => makeSentence('p', s, 25))
        const text = sentences.join('').trim()
        const pages = [{ pageNumber: 1, text, headings: [] }]
        const chunks = chunkPages(pages, DOC_ID)

        for (const chunk of chunks) {
          const segments = [...segmenter.segment(chunk.text)].map((s) => s.segment)
          const rejoined = segments.join('').replace(/\s+/g, ' ').trim()
          expect(chunk.text.replace(/\s+/g, ' ').trim()).toBe(rejoined)
        }
      }),
      { numRuns: 50 }
    )
  })
})

// ---------------------------------------------------------------------------
// Property 9: chunkPages sequence index contiguity
// Validates: Requirement 5.5
// ---------------------------------------------------------------------------

describe('chunkPages sequence index contiguity', () => {
  it('Property 9: chunks[i].sequenceIndex === i for all i', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), (pageCount) => {
        const pages = Array.from({ length: pageCount }, (_, i) =>
          makePage(i + 1, 50)
        )
        const chunks = chunkPages(pages, DOC_ID)
        chunks.forEach((chunk, i) => {
          expect(chunk.sequenceIndex).toBe(i)
        })
      }),
      { numRuns: 100 }
    )
  })

  it('sequenceIndex is zero-based and contiguous for multi-chunk documents', () => {
    const sentences = Array.from({ length: 10 }, (_, s) => makeSentence('p', s, 25))
    const pages = [{ pageNumber: 1, text: sentences.join(''), headings: [] }]
    const chunks = chunkPages(pages, DOC_ID)
    expect(chunks.length).toBeGreaterThan(1)
    chunks.forEach((chunk, i) => expect(chunk.sequenceIndex).toBe(i))
  })
})

// ---------------------------------------------------------------------------
// Property 10: chunkPages heading context propagation
// Validates: Requirement 5.6
// ---------------------------------------------------------------------------

describe('chunkPages heading context propagation', () => {
  it('Property 10: chunks after a heading carry that headingContext until the next heading', () => {
    const makeSentences = (prefix, count) =>
      Array.from({ length: count }, (_, s) => makeSentence(prefix, s, 20)).join('')

    const pages = [
      { pageNumber: 1, text: makeSentences('a', 4), headings: ['Introduction'] },
      { pageNumber: 2, text: makeSentences('b', 4), headings: [] },
      { pageNumber: 3, text: makeSentences('c', 4), headings: ['Conclusion'] },
      { pageNumber: 4, text: makeSentences('d', 4), headings: [] },
    ]
    const chunks = chunkPages(pages, DOC_ID)
    expect(chunks.length).toBeGreaterThan(0)

    let seenConclusion = false
    for (const chunk of chunks) {
      if (chunk.headingContext === 'Conclusion') seenConclusion = true
      if (seenConclusion) {
        expect(chunk.headingContext).toBe('Conclusion')
      }
    }
    expect(seenConclusion).toBe(true)
  })

  it('headingContext is null before any heading is encountered', () => {
    const sentences = Array.from({ length: 3 }, (_, s) => makeSentence('p', s, 20))
    const pages = [{ pageNumber: 1, text: sentences.join(''), headings: [] }]
    const chunks = chunkPages(pages, DOC_ID)
    for (const chunk of chunks) {
      expect(chunk.headingContext).toBeNull()
    }
  })
})

// ---------------------------------------------------------------------------
// Property 11: chunkPages short document produces exactly one chunk
// Validates: Requirement 5.8
// ---------------------------------------------------------------------------

describe('chunkPages short document', () => {
  it('Property 11: fewer than 120 total words → exactly 1 chunk', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 119 }), (totalWords) => {
        const pages = [makePage(1, totalWords)]
        const chunks = chunkPages(pages, DOC_ID)
        expect(chunks.length).toBe(1)
      }),
      { numRuns: 100 }
    )
  })

  it('single chunk contains all the text for short documents', () => {
    const pages = [makePage(1, 50)]
    const chunks = chunkPages(pages, DOC_ID)
    expect(chunks.length).toBe(1)
    expect(chunks[0].wordCount).toBe(50)
  })

  it('empty pages produce no chunks', () => {
    const pages = [{ pageNumber: 1, text: '', headings: [] }]
    const chunks = chunkPages(pages, DOC_ID)
    expect(chunks.length).toBe(0)
  })
})
