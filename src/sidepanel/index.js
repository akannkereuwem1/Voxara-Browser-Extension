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
  renderPlayer(state, document)
  renderChatState(state, document)
}

// ---------------------------------------------------------------------------
// Phase 4 - Chat UI
// ---------------------------------------------------------------------------

let activeAssistantBubble = null;

export function renderChatState(state, document) {
  const input = document.getElementById('chat-input')
  const sendBtn = document.getElementById('chat-send')
  const muteBtn = document.getElementById('chat-mute')
  
  if (!input || !sendBtn || !muteBtn) return

  const disabled = !state.activeDocumentId || (state.chat && state.chat.isStreaming)
  input.disabled = disabled
  sendBtn.disabled = disabled

  const isMuted = state.chat ? state.chat.isMuted : false
  muteBtn.setAttribute('aria-pressed', isMuted ? 'true' : 'false')
}

export function initChatControls(compat, document) {
  const input = document.getElementById('chat-input')
  const sendBtn = document.getElementById('chat-send')
  const muteBtn = document.getElementById('chat-mute')

  if (!input || !sendBtn || !muteBtn) return

  const sendQuery = () => {
    const text = input.value.trim()
    if (!text || input.disabled) return
    input.value = ''
    appendUserBubble(text, document)
    appendAssistantBubble(document)
    sendMessage(MSG_TYPES.AI_QUERY, { query: text }, compat)
      .catch(e => console.warn('[SidePanel] AI_QUERY failed', e))
  }

  sendBtn.addEventListener('click', sendQuery)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendQuery()
    }
  })

  muteBtn.addEventListener('click', () => {
    const current = muteBtn.getAttribute('aria-pressed') === 'true'
    sendMessage(MSG_TYPES.ACTION, { type: 'SET_CHAT_MUTED', data: { muted: !current } }, compat)
      .catch(e => console.warn('[SidePanel] SET_CHAT_MUTED failed', e))
  })
}

export function appendUserBubble(text, document) {
  const container = document.getElementById('chat-messages')
  if (!container) return
  const bubble = document.createElement('div')
  bubble.className = 'chat-bubble user-bubble'
  bubble.style.textAlign = 'right'
  bubble.style.margin = '4px 0'
  bubble.style.padding = '6px 10px'
  bubble.style.background = '#e1f5fe'
  bubble.style.borderRadius = '8px'
  bubble.style.alignSelf = 'flex-end'
  bubble.textContent = text
  container.appendChild(bubble)
  container.scrollTop = container.scrollHeight
}

export function appendAssistantBubble(document) {
  const container = document.getElementById('chat-messages')
  if (!container) return null
  const bubble = document.createElement('div')
  bubble.className = 'chat-bubble assistant-bubble'
  bubble.style.textAlign = 'left'
  bubble.style.margin = '4px 0'
  bubble.style.padding = '6px 10px'
  bubble.style.background = '#f5f5f5'
  bubble.style.borderRadius = '8px'
  bubble.style.alignSelf = 'flex-start'
  bubble.innerHTML = '<span class="content"></span><span class="cursor" style="animation: blink 1s step-end infinite;">|</span>'
  container.appendChild(bubble)
  container.scrollTop = container.scrollHeight
  activeAssistantBubble = bubble
  return bubble
}

export function appendTokenToActiveBubble(token, document) {
  if (!activeAssistantBubble) return
  const span = activeAssistantBubble.querySelector('.content')
  if (span) {
    span.textContent += token
    const container = document.getElementById('chat-messages')
    if (container) container.scrollTop = container.scrollHeight
  }
}

export function finaliseAssistantBubble(_document) {
  if (!activeAssistantBubble) return
  const cursor = activeAssistantBubble.querySelector('.cursor')
  if (cursor) cursor.remove()
  activeAssistantBubble = null
}

export function renderChatError(message, isApiKeyError, document) {
  if (!activeAssistantBubble) {
    appendAssistantBubble(document)
  }
  const span = activeAssistantBubble.querySelector('.content')
  if (span) {
    span.textContent = `Error: ${message}`
    span.style.color = 'red'
  }
  finaliseAssistantBubble(document)
}

export async function loadChatHistory(threadId, db, document) {
  const container = document.getElementById('chat-messages')
  if (!container || !threadId || !db) return
  
  container.innerHTML = ''
  
  try {
    const thread = await db.get('chatThreads', threadId)
    if (!thread || !thread.messages) return
    for (const msg of thread.messages) {
      if (msg.role === 'user') {
        appendUserBubble(msg.content, document)
      } else {
        const bubble = appendAssistantBubble(document)
        const span = bubble.querySelector('.content')
        if (span) span.textContent = msg.content
        finaliseAssistantBubble(document)
      }
    }
  } catch(e) {
    console.warn('[SidePanel] Failed to load chat history', e)
  }
}

// ---------------------------------------------------------------------------
// Player UI rendering — Phase 3
// ---------------------------------------------------------------------------

export function renderPlayer(state, document) {
  const playPauseBtn = document.getElementById('play-pause-btn')
  const scrubber     = document.getElementById('scrubber')
  const speedSelect  = document.getElementById('speed-select')
  const pitchSlider  = document.getElementById('pitch-slider')
  const volumeSlider = document.getElementById('volume-slider')
  const voiceSelect  = document.getElementById('voice-select')

  if (playPauseBtn) {
    const label = state.playbackStatus === 'playing' ? 'Pause' : 'Play'
    playPauseBtn.setAttribute('aria-label', label)
  }

  if (scrubber) {
    const hasDoc = !!state.activeDocumentId
    scrubber.disabled = !hasDoc
    if (typeof state.currentChunkIndex === 'number') {
      scrubber.value = state.currentChunkIndex
    }
    // aria-valuetext updated by initPlayerControls on change; set initial here
    const total = parseInt(scrubber.max, 10) + 1 || 1
    scrubber.setAttribute(
      'aria-valuetext',
      `Chunk ${(state.currentChunkIndex ?? 0) + 1} of ${total}`
    )
  }

  if (speedSelect && typeof state.playbackRate === 'number') {
    speedSelect.value = String(state.playbackRate)
  }
  if (pitchSlider && typeof state.pitch === 'number') {
    pitchSlider.value = state.pitch
  }
  if (volumeSlider && typeof state.volume === 'number') {
    volumeSlider.value = state.volume
  }
  if (voiceSelect && state.voiceId != null) {
    voiceSelect.value = state.voiceId
  }
}

export function renderVoiceSelector(voices, selectedVoiceURI, document) {
  const select = document.getElementById('voice-select')
  if (!select) return

  select.innerHTML = ''

  if (!voices || voices.length === 0) {
    select.disabled = true
    const opt = document.createElement('option')
    opt.textContent = 'No voices available'
    opt.disabled = true
    select.appendChild(opt)
    return
  }

  select.disabled = false

  // Group by lang
  const byLang = {}
  for (const v of voices) {
    if (!byLang[v.lang]) byLang[v.lang] = []
    byLang[v.lang].push(v)
  }

  for (const [lang, langVoices] of Object.entries(byLang)) {
    const group = document.createElement('optgroup')
    group.label = lang
    for (const v of langVoices) {
      const opt = document.createElement('option')
      opt.value = v.voiceURI
      opt.textContent = v.name
      group.appendChild(opt)
    }
    select.appendChild(group)
  }

  if (selectedVoiceURI) select.value = selectedVoiceURI
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
// Player controls — Phase 3
// ---------------------------------------------------------------------------

export function initPlayerControls(compat, document) {
  const playPauseBtn  = document.getElementById('play-pause-btn')
  const skipBackBtn   = document.getElementById('skip-back-btn')
  const skipFwdBtn    = document.getElementById('skip-fwd-btn')
  const scrubber      = document.getElementById('scrubber')
  const speedSelect   = document.getElementById('speed-select')
  const pitchSlider   = document.getElementById('pitch-slider')
  const volumeSlider  = document.getElementById('volume-slider')
  const voiceSelect   = document.getElementById('voice-select')
  const previewBtn    = document.getElementById('voice-preview-btn')

  if (playPauseBtn) {
    playPauseBtn.addEventListener('click', () => {
      const label = playPauseBtn.getAttribute('aria-label')
      const type = label === 'Pause' ? 'PAUSE' : 'PLAY'
      sendMessage(MSG_TYPES.ACTION, { type }, compat)
        .catch((e) => console.warn('[SidePanel] ACTION failed:', e))
    })
  }

  if (skipBackBtn) {
    skipBackBtn.addEventListener('click', () =>
      sendMessage(MSG_TYPES.SKIP_BACK, { seconds: 10 }, compat)
        .catch((e) => console.warn('[SidePanel] SKIP_BACK failed:', e))
    )
  }

  if (skipFwdBtn) {
    skipFwdBtn.addEventListener('click', () =>
      sendMessage(MSG_TYPES.SKIP_FORWARD, { seconds: 10 }, compat)
        .catch((e) => console.warn('[SidePanel] SKIP_FORWARD failed:', e))
    )
  }

  if (scrubber) {
    scrubber.addEventListener('change', () => {
      const chunkIndex = parseInt(scrubber.value, 10)
      const total = parseInt(scrubber.max, 10) + 1 || 1
      scrubber.setAttribute('aria-valuetext', `Chunk ${chunkIndex + 1} of ${total}`)
      sendMessage(MSG_TYPES.SEEK_TO_CHUNK, { chunkIndex }, compat)
        .catch((e) => console.warn('[SidePanel] SEEK_TO_CHUNK failed:', e))
    })
  }

  if (speedSelect) {
    speedSelect.addEventListener('change', () =>
      sendMessage(MSG_TYPES.SET_RATE, { rate: parseFloat(speedSelect.value) }, compat)
        .catch((e) => console.warn('[SidePanel] SET_RATE failed:', e))
    )
  }

  if (pitchSlider) {
    pitchSlider.addEventListener('input', () =>
      sendMessage(MSG_TYPES.SET_PITCH, { pitch: parseFloat(pitchSlider.value) }, compat)
        .catch((e) => console.warn('[SidePanel] SET_PITCH failed:', e))
    )
  }

  if (volumeSlider) {
    volumeSlider.addEventListener('input', () =>
      sendMessage(MSG_TYPES.SET_VOLUME, { volume: parseFloat(volumeSlider.value) }, compat)
        .catch((e) => console.warn('[SidePanel] SET_VOLUME failed:', e))
    )
  }

  if (voiceSelect) {
    voiceSelect.addEventListener('change', () =>
      sendMessage(MSG_TYPES.SET_VOICE, { voiceId: voiceSelect.value }, compat)
        .catch((e) => console.warn('[SidePanel] SET_VOICE failed:', e))
    )
  }

  if (previewBtn) {
    previewBtn.addEventListener('click', () => {
      const voiceId = voiceSelect?.value
      if (voiceId) {
        sendMessage(MSG_TYPES.SET_VOICE, { voiceId }, compat)
          .catch((e) => console.warn('[SidePanel] SET_VOICE (preview) failed:', e))
      }
    })
  }
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
      } else if (msg.type === MSG_TYPES.AI_RESPONSE_TOKEN) {
        appendTokenToActiveBubble(msg.payload.token, document)
      } else if (msg.type === MSG_TYPES.AI_RESPONSE_DONE) {
        if (msg.payload.error) {
          const isApiKeyError = msg.payload.error.includes('configured')
          renderChatError(msg.payload.error, isApiKeyError, document)
        } else {
          finaliseAssistantBubble(document)
        }
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

  // Wire Library and Chat tabs
  let localState = null
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    if (btn.dataset.tab === 'library') {
      btn.addEventListener('click', () => renderLibrary(document, compat))
    }
    if (btn.dataset.tab === 'chat') {
      btn.addEventListener('click', async () => {
        if (localState && localState.activeDocumentId) {
          const db = await initDB()
          await loadChatHistory(localState.activeDocumentId, db, document)
        }
      })
    }
  })

  initPlayerControls(compat, document)
  initChatControls(compat, document)

  const manager = createPortManager(compat, (state) => {
    localState = state
    renderState(state, document)
  })
  manager.connect()
}
