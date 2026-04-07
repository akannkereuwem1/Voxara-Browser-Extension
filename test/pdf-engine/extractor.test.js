// Feature: pdf-engine
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { extractText, processPage } from '../../src/content/pdf/extractor.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal TextItem with the given fields. */
function makeItem(str, x, y, fontSize) {
  // transform = [scaleX, skewX, skewY, fontSize, x, y]
  return { str, transform: [1, 0, 0, fontSize, x, y] }
}

/** Build a mock PDFDocumentProxy from an array of page item arrays. */
function makePdf(pageItemArrays) {
  return {
    numPages: pageItemArrays.length,
    getPage: async (i) => ({
      getTextContent: async () => ({ items: pageItemArrays[i - 1] }),
    }),
  }
}

// ---------------------------------------------------------------------------
// Property 5: extractText page count invariant
// Validates: Requirement 4.6
// ---------------------------------------------------------------------------

describe('extractText page count invariant', () => {
  it('Property 5: output.length === pdf.numPages for any N pages', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 50 }), async (n) => {
        const pageItems = Array.from({ length: n }, () => [])
        const pdf = makePdf(pageItems)
        const result = await extractText(pdf)
        expect(result.length).toBe(n)
      }),
      { numRuns: 100 }
    )
  })

  it('empty pages produce text:"" and headings:[]', async () => {
    const pdf = makePdf([[], []])
    const result = await extractText(pdf)
    for (const page of result) {
      expect(page.text).toBe('')
      expect(page.headings).toEqual([])
    }
  })
})

// ---------------------------------------------------------------------------
// Property 6: extractText reading order (y-descending, x-ascending)
// Validates: Requirement 4.2
// ---------------------------------------------------------------------------

describe('extractText reading order', () => {
  it('Property 6: items sorted top-to-bottom then left-to-right', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            str: fc.string({ minLength: 1, maxLength: 10 }),
            x: fc.float({ min: 0, max: 500, noNaN: true }),
            y: fc.float({ min: 0, max: 800, noNaN: true }),
            fontSize: fc.float({ min: 8, max: 24, noNaN: true }),
          }),
          { minLength: 2, maxLength: 20 }
        ),
        (itemDefs) => {
          const items = itemDefs.map((d) => makeItem(d.str, d.x, d.y, d.fontSize))
          const { text } = processPage(1, items)

          // Reconstruct the sorted order by re-running the sort logic
          const Y_TOL = 2
          const sorted = [...items].sort((a, b) => {
            const dy = b.transform[5] - a.transform[5]
            if (Math.abs(dy) > Y_TOL) return dy
            return a.transform[4] - b.transform[4]
          })

          // The text should be the sorted items joined
          const expected = sorted
            .map((it) => it.str)
            .filter(Boolean)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim()

          expect(text).toBe(expected)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('items on the same line (y within tolerance) are sorted left-to-right', () => {
    // Two items at same y, different x
    const items = [
      makeItem('right', 200, 100, 12),
      makeItem('left', 50, 100, 12),
    ]
    const { text } = processPage(1, items)
    expect(text).toBe('left right')
  })

  it('items at different y positions are sorted top-to-bottom', () => {
    // Higher y = higher on page in PDF coordinate space
    const items = [
      makeItem('bottom', 50, 100, 12),
      makeItem('top', 50, 700, 12),
    ]
    const { text } = processPage(1, items)
    expect(text).toBe('top bottom')
  })
})
