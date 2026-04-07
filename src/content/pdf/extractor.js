/**
 * Text Extractor
 *
 * Iterates PDF pages, sorts TextItems into reading order (top-to-bottom,
 * left-to-right), detects headings by font size, and produces a PageText[].
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */

const Y_TOLERANCE = 2

/**
 * Extract text from all pages of a PDFDocumentProxy.
 * @param {object} pdf - PDFDocumentProxy
 * @returns {Promise<Array<{pageNumber: number, text: string, headings: string[]}>>}
 */
export async function extractText(pdf) {
  const pages = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    pages.push(processPage(i, content.items))
  }
  return pages
}

/**
 * Process a single page's text items into a PageText object.
 * @param {number} pageNumber
 * @param {object[]} items - TextItem array from PDF.js
 * @returns {{pageNumber: number, text: string, headings: string[]}}
 */
export function processPage(pageNumber, items) {
  if (!items || !items.length) return { pageNumber, text: '', headings: [] }

  // transform[3] = fontSize, transform[4] = x, transform[5] = y
  const avgFontSize = items.reduce((s, it) => s + it.transform[3], 0) / items.length

  const sorted = [...items].sort((a, b) => {
    const dy = b.transform[5] - a.transform[5]
    if (Math.abs(dy) > Y_TOLERANCE) return dy
    return a.transform[4] - b.transform[4]
  })

  const headings = []
  const parts = []
  for (const item of sorted) {
    const str = item.str
    if (!str) continue
    parts.push(str)
    if (item.transform[3] > avgFontSize * 1.2 && str.trim().length > 3) {
      headings.push(str.trim())
    }
  }

  const text = parts.join(' ').replace(/\s+/g, ' ').trim()
  return { pageNumber, text, headings }
}
