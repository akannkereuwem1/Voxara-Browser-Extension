/**
 * Chunker
 *
 * Splits PageText[] into sentence-bounded Chunk objects using Intl.Segmenter,
 * targeting 120–180 words per chunk.
 * Requirements: 5.1–5.9
 */

const TARGET_MIN = 120
const TARGET_MAX = 180

/**
 * Count words in a string.
 * @param {string} str
 * @returns {number}
 */
function countWords(str) {
  return str.trim().split(/\s+/).filter(Boolean).length
}

/**
 * Split PageText[] into Chunk objects.
 * @param {Array<{pageNumber: number, text: string, headings: string[]}>} pages
 * @param {string} documentId
 * @returns {Array<object>} Chunk[]
 */
export function chunkPages(pages, documentId) {
  const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' })
  const chunks = []

  let buffer = []        // sentence strings accumulated for current chunk
  let wordCount = 0
  let pageStart = pages.length ? pages[0].pageNumber : 1
  let currentHeading = null
  let seqIndex = 0

  function flush(pageEnd) {
    if (!buffer.length) return
    const text = buffer.join(' ').replace(/\s+/g, ' ').trim()
    chunks.push({
      id: crypto.randomUUID(),
      documentId,
      sequenceIndex: seqIndex++,
      text,
      wordCount,
      pageStart,
      pageEnd,
      headingContext: currentHeading,
      sectionLabel: currentHeading,
    })
    buffer = []
    wordCount = 0
    pageStart = pageEnd
  }

  for (const page of pages) {
    // Update heading context from this page's headings
    for (const heading of page.headings) {
      currentHeading = heading
    }

    if (!page.text) continue

    const sentences = [...segmenter.segment(page.text)].map((s) => s.segment)

    for (const sentence of sentences) {
      const words = countWords(sentence)
      if (words === 0) continue

      // Flush if adding this sentence would exceed TARGET_MAX and we already
      // have at least TARGET_MIN words
      if (wordCount >= TARGET_MIN && wordCount + words > TARGET_MAX) {
        flush(page.pageNumber)
        pageStart = page.pageNumber
      }

      buffer.push(sentence)
      wordCount += words
    }
  }

  // Flush any remaining content
  const lastPage = pages.length ? pages[pages.length - 1].pageNumber : 1
  flush(lastPage)

  return chunks
}
