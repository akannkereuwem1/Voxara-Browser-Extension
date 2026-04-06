import { BrowserCompat } from '../shared/browser-compat.js'
import { MSG_TYPES } from '../shared/message-bus.js'

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
  const manager = createPortManager(compat, (state) => renderState(state, document))
  manager.connect()
}
