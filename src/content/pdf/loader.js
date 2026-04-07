/**
 * PDF Loader
 *
 * Fetches a PDF as an ArrayBuffer and instantiates a PDFDocumentProxy via PDF.js.
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
 *
 * pdfjsLib is injected so tests can supply a mock without importing the real
 * pdfjs-dist (which requires browser globals like DOMMatrix).
 */

// Import the worker URL via Vite's ?url suffix so the hashed asset path is
// baked in at build time. In extension context this resolves to the correct
// chrome-extension:// URL automatically via CRXJS.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// Default worker src — Vite resolves this to the correct hashed asset path.
// Falls back to empty string in test environments where the ?url import is mocked.
let _workerSrc = workerUrl ?? ''

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

  let arrayBuffer
  if (url.startsWith('file://')) {
    // fetch() cannot read file:// URLs in content scripts — use XHR instead
    arrayBuffer = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('GET', url, true)
      xhr.responseType = 'arraybuffer'
      xhr.onload = () => {
        if (xhr.status === 0 || xhr.status === 200) resolve(xhr.response)
        else reject(new Error(`PDF_Loader: fetch failed for ${url} — HTTP ${xhr.status}`))
      }
      xhr.onerror = () => reject(new Error(`PDF_Loader: fetch failed for ${url} — network error`))
      xhr.send()
    })
  } else {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`PDF_Loader: fetch failed for ${url} — HTTP ${response.status}`)
    }
    arrayBuffer = await response.arrayBuffer()
  }

  let pdf
  try {
    pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  } catch (err) {
    throw new Error(`PDF_Loader: PDF.js parse error — ${err.message}`)
  }

  return { arrayBuffer, pdf }
}
