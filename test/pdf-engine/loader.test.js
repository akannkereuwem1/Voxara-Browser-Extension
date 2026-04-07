// Feature: pdf-engine
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadPdf, setWorkerSrc } from '../../src/content/pdf/loader.js'

setWorkerSrc('')

// ---------------------------------------------------------------------------
// Mock pdfjs-dist factory — passed directly to loadPdf as the second argument
// so the real pdfjs-dist (which needs DOMMatrix) is never imported in tests.
// ---------------------------------------------------------------------------

function makePdfjsLib(numPages = 3) {
  return {
    GlobalWorkerOptions: { workerSrc: '' },
    getDocument: vi.fn().mockReturnValue({
      promise: Promise.resolve({ numPages }),
    }),
  }
}

function makePdfjsLibFailing(message) {
  return {
    GlobalWorkerOptions: { workerSrc: '' },
    getDocument: vi.fn().mockReturnValue({
      promise: Promise.reject(new Error(message)),
    }),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('loadPdf', () => {
  const TEST_URL = 'https://example.com/test.pdf'
  const fakeBytes = new ArrayBuffer(8)

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('successful fetch returns correct { arrayBuffer, pdf } shape', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(fakeBytes),
    })

    const pdfjs = makePdfjsLib(5)
    const result = await loadPdf(TEST_URL, pdfjs)

    expect(result).toHaveProperty('arrayBuffer')
    expect(result).toHaveProperty('pdf')
    expect(result.arrayBuffer).toBe(fakeBytes)
    expect(result.pdf.numPages).toBe(5)
  })

  it('non-OK HTTP status rejects with URL and status code in message', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 })

    const pdfjs = makePdfjsLib()
    await expect(loadPdf(TEST_URL, pdfjs)).rejects.toThrow(/403/)
    await expect(loadPdf(TEST_URL, pdfjs)).rejects.toThrow(TEST_URL)
  })

  it('PDF.js rejection rejects with parse error message', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(fakeBytes),
    })

    const pdfjs = makePdfjsLibFailing('Invalid PDF structure')
    await expect(loadPdf(TEST_URL, pdfjs)).rejects.toThrow(/PDF\.js parse error/)
    await expect(loadPdf(TEST_URL, pdfjs)).rejects.toThrow(/Invalid PDF structure/)
  })
})
