import { BrowserCompat } from '../shared/browser-compat.js'
import { onMessage } from '../shared/message-bus.js'
import { initDB } from '../shared/db.js'

// Initialise IndexedDB on startup
initDB()
  .then(() => console.log('[Voxara] IndexedDB initialised'))
  .catch((err) => console.error('[Voxara] IndexedDB init failed:', err))

// Initialise browser compat and register message listener stub
const compat = BrowserCompat.init()

onMessage((msg) => {
  console.log('[Voxara] Background received message type:', msg.type)
}, compat)
