import { BrowserCompat } from '../shared/browser-compat.js'
import { MSG_TYPES, sendMessage } from '../shared/message-bus.js'
import { initDB } from '../shared/db.js'

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------

export function initTabs(document) {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'))
      document.querySelectorAll('.tab-content').forEach((c) => c.classList.add('hidden'))
      btn.classList.add('active')
      document.getElementById(btn.dataset.tab).classList.remove('hidden')
    })
  })
}

// ---------------------------------------------------------------------------
// State rendering
// ---------------------------------------------------------------------------

export function renderState(state, document) {
  const urlEl = document.getElementById('pdf-url')
  const statusEl = document.getElementById('playback-status')
  if (urlEl) urlEl.textContent = state.activePdfUrl ?? 'No PDF detected'
  if (statusEl) statusEl.textContent = state.playbackStatus ?? 'idle'
  renderProgress(state, document)
}

// ---------------------------------------------------------------------------
// Progress indicator (Player tab) — Phase 2
// ---------------------------------------------------------------------------

export function renderProgress(state, document) {
  const bar = document.getElementById('parse-progress')
  const msg = document.getElementById('parse-message')
  if (!bar || !msg) return

  if (state.parseStatus === 'pending') {
    bar.style.display = 'block'
    msg.textContent = 'Preparing your document...'
    if (state.parseProgress) {
      bar.value = Math.round(
        (state.parseProgress.pagesProcessed / state.parseProgress.totalPages) * 100
      )
    }
  } else if (state.parseStatus === 'failed') {
    bar.style.display = 'none'
    msg.textContent = 'Parse failed. Tap to retry.'
  } else {
    bar.style.display = 'none'
    msg.textContent = ''
  }
}

// ---------------------------------------------------------------------------
// Library tab — Phase 2
// ---------------------------------------------------------------------------

export function formatRelativeTime(ts) {
  const diff = Date.now() - ts
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

export function renderCard(doc) {
  const title = doc.title ?? 'Untitled'
  const relTime = formatRelativeTime(doc.lastOpenedAt)
  if (doc.parseStatus === 'pending') {
    return `<div class="doc-card">
      <span class="title">${title}</span>
      <span class="status">Parsing...</span>
      <button data-delete="${doc.id}">Delete</button>
    </div>`
  }
  if (doc.parseStatus === 'failed') {
    return `<div class="doc-card">
      <span class="title">${title}</span>
      <span class="status error">Parse failed</span>
      <button data-load="${doc.id}">Retry</button>
      <button data-delete="${doc.id}">Delete</button>
    </div>`
  }
  return `<div class="doc-card">
    <span class="title">${title}</span>
    <span class="meta">${doc.pageCount ?? '?'}p · ${doc.chunkCount ?? 0} chunks · ${relTime}</span>
    <button data-load="${doc.id}">Open</button>
    <button data-delete="${doc.id}">Delete</button>
  </div>`
}

export async function confirmDelete(documentId, compat, doc) {
  if (!doc.defaultView.confirm('Delete this document?')) return
  await sendMessage(MSG_TYPES.ACTION, { type: 'DELETE_DOCUMENT', data: { documentId } }, compat)
  await renderLibrary(doc, compat)
}

export async function renderLibrary(document, compat) {
  const container = document.getElementById('library')
  if (!container) return

  const db = await initDB()
  const docs = await db.getAll('documents')
  docs.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)

  if (!docs.length) {
    container.innerHTML = '<p class="empty">No documents yet. Open a PDF to get started.</p>'
    return
  }

  container.innerHTML = docs.map((doc) => renderCard(doc)).join('')

  container.querySelectorAll('[data-load]').forEach((btn) => {
    btn.addEventListener('click', () =>
      sendMessage(MSG_TYPES.LOAD_DOCUMENT, { documentId: btn.dataset.load }, compat)
        .catch((err) => console.warn('[SidePanel] LOAD_DOCUMENT failed:', err))
    )
  })
  container.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', () =>
      confirmDelete(btn.dataset.delete, compat, document)
    )
  })
}

// ---------------------------------------------------------------------------
// Port connection with exponential backoff
// ---------------------------------------------------------------------------

const MAX_RETRIES = 5
const BASE_DELAY_MS = 500

export function createPortManager(compat, onStateUpdate) {
  let retryCount = 0
  let port = null

  function connect() {
    port = compat.ports.connect('sidepanel')
    port.onMessage.addListener((msg) => {
      if (msg.type === MSG_TYPES.STATE_UPDATE) {
        onStateUpdate(msg.payload)
      }
    })
    port.onDisconnect.addListener(() => {
      port = null
      if (retryCount < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, retryCount)
        retryCount++
        setTimeout(connect, delay)
      } else {
        console.warn('[SidePanel] Max reconnect attempts reached')
      }
    })
    retryCount = 0
  }

  return { connect, getRetryCount: () => retryCount }
}

// ---------------------------------------------------------------------------
// Bootstrap (only in real browser context)
// ---------------------------------------------------------------------------

if (typeof chrome !== 'undefined' || typeof browser !== 'undefined') {
  const compat = BrowserCompat.init()
  initTabs(document)

  // Wire Library tab to load documents on activation
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    if (btn.dataset.tab === 'library') {
      btn.addEventListener('click', () => renderLibrary(document, compat))
    }
  })

  const manager = createPortManager(compat, (state) => renderState(state, document))
  manager.connect()
}
