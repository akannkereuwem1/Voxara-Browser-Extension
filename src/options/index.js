import { BrowserCompat } from '../shared/browser-compat.js'

export async function loadApiKey(compat, document) {
  const input = document.getElementById('api-key-input')
  if (!input) return
  const result = await compat.storage.get('openai_api_key')
  if (result && result.openai_api_key) {
    input.placeholder = 'sk-... (Key Configured)'
    input.value = ''
  } else {
    input.placeholder = 'sk-...'
    input.value = ''
  }
}

export async function saveApiKey(key, compat, document) {
  const status = document.getElementById('api-key-status')
  if (!status) return

  if (!key || typeof key !== 'string' || !key.startsWith('sk-')) {
    status.textContent = 'Invalid API key. Must start with sk-'
    status.style.color = 'red'
    return
  }
  
  try {
    await compat.storage.set('openai_api_key', key)
    const input = document.getElementById('api-key-input')
    if (input) {
      input.value = ''
      input.placeholder = 'sk-... (Key Configured)'
    }
    status.textContent = 'Saved successfully!'
    status.style.color = 'green'
    setTimeout(() => {
      if (status.textContent === 'Saved successfully!') {
        status.textContent = ''
      }
    }, 2000)
  } catch {
    status.textContent = 'Failed to save key.'
    status.style.color = 'red'
  }
}

export function initOptionsPage(compat, document) {
  const saveBtn = document.getElementById('api-key-save')
  const input = document.getElementById('api-key-input')
  if (saveBtn && input) {
    saveBtn.addEventListener('click', () => {
      saveApiKey(input.value.trim(), compat, document)
    })
  }
  loadApiKey(compat, document)
}

if (typeof chrome !== 'undefined' || typeof browser !== 'undefined') {
  const compat = BrowserCompat.init()
  initOptionsPage(compat, document)
}
