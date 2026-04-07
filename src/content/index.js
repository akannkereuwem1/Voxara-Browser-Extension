import { BrowserCompat } from '../shared/browser-compat.js'
import { MSG_TYPES, sendMessage } from '../shared/message-bus.js'
import { loadPdf } from './pdf/loader.js'
import { hashArrayBuffer } from '../shared/hash.js'
import { extractText } from './pdf/extractor.js'
import { chunkPages } from './pdf/chunker.js'

// ---------------------------------------------------------------------------
// Level 1 — contentType / URL check (synchronous, runs at document_start)
// ---------------------------------------------------------------------------

export function isPdfTab(contentType, href) {
  return (
    contentType === 'application/pdf' ||
    href.toLowerCase().endsWith('.pdf')
  )
}

export function checkNode(node, reportedUrls, compatRef) {
  if (!node || node.nodeType !== 1 /* ELEMENT_NODE */) return
  let url = null
  const tag = node.tagName?.toUpperCase()
  if ((tag === 'IFRAME' || tag === 'EMBED') && node.src?.toLowerCase().endsWith('.pdf')) {
    url = node.src
  } else if (tag === 'OBJECT' && node.data?.toLowerCase().endsWith('.pdf')) {
    url = node.data
  }
  if (url && !reportedUrls.has(url)) {
    reportedUrls.add(url)
    sendMessage(MSG_TYPES.PDF_DETECTED, { url }, compatRef)
  }
}

export function attachMutationObserver(reportedUrls, compatRef) {
  const observe = () => {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          checkNode(node, reportedUrls, compatRef)
          if (node.querySelectorAll) {
            node.querySelectorAll('iframe[src], embed[src], object[data]')
              .forEach((n) => checkNode(n, reportedUrls, compatRef))
          }
        }
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
  }

  if (document.body) {
    observe()
  } else {
    document.addEventListener('DOMContentLoaded', observe)
  }
}

// ---------------------------------------------------------------------------
// PDF parsing orchestration (Phase 2)
// ---------------------------------------------------------------------------

/**
 * Full PDF parsing pipeline. Called when a PDF URL is detected.
 * @param {string} url
 * @param {object} compat - BrowserCompat instance
 * @param {object} [pdfjsLib] - Optional injected PDF.js (for tests)
 */
export async function parsePdf(url, compat, pdfjsLib) {
  // 1. Notify service worker that parsing has started
  await sendMessage(MSG_TYPES.PDF_PARSE_START, { url, title: null, pageCount: null }, compat)

  try {
    // 2. Fetch PDF bytes and compute hash
    const { arrayBuffer, pdf } = await loadPdf(url, pdfjsLib, compat)
    const fileHash = await hashArrayBuffer(arrayBuffer)

    // 3. Deduplication check
    const dedupResult = await sendMessage(
      MSG_TYPES.DEDUP_CHECK,
      { fileHash },
      compat
    )
    if (dedupResult?.duplicate) {
      await sendMessage(MSG_TYPES.LOAD_DOCUMENT, { documentId: dedupResult.documentId }, compat)
      return
    }

    // 4. Extract title and language from metadata
    const meta = await pdf.getMetadata().catch(() => ({}))
    const title =
      meta?.info?.Title?.trim() ||
      url.split('/').pop().replace(/\.pdf$/i, '') ||
      'Untitled'
    const language = meta?.info?.Language || 'en'

    // 5. Extract text page-by-page, sending progress every 10 pages
    const pages = await extractText(pdf)
    for (let i = 0; i < pages.length; i++) {
      const pageNum = i + 1
      if (pageNum % 10 === 0) {
        await sendMessage(
          MSG_TYPES.PARSE_PROGRESS,
          { url, pagesProcessed: pageNum, totalPages: pdf.numPages },
          compat
        )
      }
    }

    // 6. Chunk and send final result
    const documentId = crypto.randomUUID()
    const chunks = chunkPages(pages, documentId)

    await sendMessage(MSG_TYPES.PDF_PARSED, {
      url,
      fileHash,
      title,
      pageCount: pdf.numPages,
      language,
      chunks,
    }, compat)

  } catch (err) {
    await sendMessage(
      MSG_TYPES.PDF_PARSE_START,
      { url, parseStatus: 'failed', error: err.message },
      compat
    )
  }
}



if (typeof chrome !== 'undefined' || typeof browser !== 'undefined') {
  const compat = BrowserCompat.init()
  if (isPdfTab(document.contentType, location.href)) {
    parsePdf(location.href, compat)
  } else {
    const reportedUrls = new Set()
    attachMutationObserver(reportedUrls, compat)
  }
}
