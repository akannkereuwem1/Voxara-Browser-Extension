/**
 * Returns chunks within [currentChunkIndex-3, currentChunkIndex+3] clamped to valid indices.
 * @param {Array<{sequenceIndex: number}>} chunks - All chunks for the document
 * @param {number} currentChunkIndex
 * @returns {Array<object>}
 */
export function localWindow(chunks, currentChunkIndex) {
  const minIdx = Math.max(0, currentChunkIndex - 3)
  const maxIdx = Math.min(chunks.length - 1, currentChunkIndex + 3)
  return chunks.filter(c => c.sequenceIndex >= minIdx && c.sequenceIndex <= maxIdx)
}

/**
 * Splits query on whitespace, scores chunks by case-insensitive word occurrences.
 * Returns top-3 chunks with score > 0, sorted by score descending.
 * @param {Array<{text: string}>} chunks - All chunks for the document
 * @param {string} query
 * @returns {Array<object>}
 */
export function keywordScore(chunks, query) {
  if (!query) return []
  const words = query.trim().split(/\s+/).filter(Boolean).map(w => w.toLowerCase())
  if (!words.length) return []

  const scored = chunks.map(chunk => {
    let score = 0
    const text = (chunk.text || '').toLowerCase()
    for (const word of words) {
      if (text.includes(word)) {
        score++
      }
    }
    return { chunk, score }
  })

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(s => s.chunk)
}

/**
 * Merges two arrays of chunks, deduplicates by id, sorts by sequenceIndex ascending, caps at 10.
 * @param {Array<{id: string, sequenceIndex: number}>} windowChunks
 * @param {Array<{id: string, sequenceIndex: number}>} keywordChunks
 * @returns {Array<object>}
 */
export function mergeChunks(windowChunks, keywordChunks) {
  const mergedMap = new Map()
  for (const c of windowChunks) mergedMap.set(c.id, c)
  for (const c of keywordChunks) mergedMap.set(c.id, c)
  
  const result = Array.from(mergedMap.values())
  result.sort((a, b) => a.sequenceIndex - b.sequenceIndex)
  return result.slice(0, 10)
}

/**
 * Assembles context for an AI query.
 * @param {object} db - idb database instance
 * @param {string} documentId
 * @param {number} currentChunkIndex
 * @param {string} query
 * @returns {Promise<string>}
 */
export async function assembleContext(db, documentId, currentChunkIndex, query) {
  const chunks = await db.getAllFromIndex('chunks', 'documentId', documentId)
  chunks.sort((a, b) => a.sequenceIndex - b.sequenceIndex)

  const doc = await db.get('documents', documentId)

  const windowChunks = localWindow(chunks, currentChunkIndex)
  const keyChunks = keywordScore(chunks, query)
  
  const finalChunks = mergeChunks(windowChunks, keyChunks)

  const currentChunk = chunks.find(c => c.sequenceIndex === currentChunkIndex)
  const docTitle = doc?.title || 'Unknown'
  const sectionLabel = currentChunk?.sectionLabel || 'Unknown'

  const header = `Document Title: ${docTitle}\nSection: ${sectionLabel}\n\n`
  const contextBody = finalChunks.map(c => c.text).join('\n\n')

  return header + contextBody
}
