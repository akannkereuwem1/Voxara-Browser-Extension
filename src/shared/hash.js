/**
 * Hash Utility
 *
 * SHA-256 fingerprinting of raw PDF bytes for deduplication.
 * Uses only crypto.subtle — no third-party library.
 */

/**
 * Compute a SHA-256 hex digest of an ArrayBuffer.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<string>} 64-character lowercase hex string
 */
export async function hashArrayBuffer(buffer) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
