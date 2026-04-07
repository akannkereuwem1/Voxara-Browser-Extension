/**
 * PDF Loader
 *
 * Fetches a PDF as an ArrayBuffer and instantiates a PDFDocumentProxy via PDF.js.
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
 *
 * pdfjsLib is injected so tests can supply a mock without importing the real
 * pdfjs-dist (which requires browser globals like DOMMatrix).
 */

// Default worker URL — resolved at runtime in the real extension context
let _workerSrc = ''
try {
  _workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href
} catch (_) {
  // In test environments import.meta.url may not resolve the package path
}

/** Override the worker URL (used in tests). */
export function setWorkerSrc(url) {
  _workerSrc = url
}

/**
 * Fetch a PDF and return its raw bytes and a PDFDocumentProxy.
 *
 * @param {string} url
 * @param {object} [pdfjsLib] - PDF.js library object (injected for testability)
 * @returns {Promise<{ arrayBuffer: ArrayBuffer, pdf: object }>}
 */
export async function loadPdf(url, pdfjsLib) {
  if (!pdfjsLib) {
    // Lazy-import the real library only in non-test contexts
    pdfjsLib = await import('pdfjs-dist')
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc = _workerSrc

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`PDF_Loader: fetch failed for ${url} — HTTP ${response.status}`)
  }
  const arrayBuffer = await response.arrayBuffer()

  let pdf
  try {
    pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  } catch (err) {
    throw new Error(`PDF_Loader: PDF.js parse error — ${err.message}`)
  }

  return { arrayBuffer, pdf }
}
