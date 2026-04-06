import { BrowserCompat } from '../shared/browser-compat.js'
import { MSG_TYPES, sendMessage } from '../shared/message-bus.js'

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
// Bootstrap (only in real browser context)
// ---------------------------------------------------------------------------

if (typeof chrome !== 'undefined' || typeof browser !== 'undefined') {
  const compat = BrowserCompat.init()
  if (isPdfTab(document.contentType, location.href)) {
    sendMessage(MSG_TYPES.PDF_DETECTED, { url: location.href }, compat)
  } else {
    const reportedUrls = new Set()
    attachMutationObserver(reportedUrls, compat)
  }
}
