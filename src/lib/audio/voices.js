/**
 * Voice Manager
 *
 * Enumerates SpeechSynthesisVoice objects, persists the user's selection to
 * chrome.storage.sync, and handles voice preview.
 *
 * Runs inside the Offscreen Document (has access to window.speechSynthesis).
 */

/**
 * @typedef {{ voiceURI: string, name: string, lang: string, localService: boolean }} VoiceInfo
 */

/**
 * Create a Voice Manager instance.
 *
 * @param {SpeechSynthesis} synth - window.speechSynthesis
 * @param {object} storage - chrome.storage.sync (or compat equivalent)
 * @returns {{ init: () => Promise<void>, getVoices: () => VoiceInfo[],
 *             getSelectedVoiceURI: () => string|null,
 *             selectVoice: (voiceURI: string) => Promise<void>,
 *             preview: () => void }}
 */
export function createVoiceManager(synth, storage) {
  /** @type {VoiceInfo[]} */
  let voices = []
  let selectedVoiceURI = null

  function enumerate() {
    const raw = synth.getVoices()
    if (!raw.length) {
      console.warn('[VoiceManager] No voices available after voiceschanged')
    }
    voices = raw.map((v) => ({
      voiceURI:     v.voiceURI,
      name:         v.name,
      lang:         v.lang,
      localService: v.localService,
    }))
  }

  async function init() {
    enumerate()
    synth.addEventListener('voiceschanged', enumerate)
    try {
      const result = await storage.get('voiceId')
      const persisted = result?.voiceId ?? null
      if (persisted && voices.some((v) => v.voiceURI === persisted)) {
        selectedVoiceURI = persisted
      } else if (voices.length > 0) {
        selectedVoiceURI = voices[0].voiceURI
      }
    } catch (err) {
      console.warn('[VoiceManager] Failed to restore voiceId:', err)
    }
  }

  async function selectVoice(voiceURI) {
    selectedVoiceURI = voiceURI
    try {
      await storage.set({ voiceId: voiceURI })
    } catch (err) {
      console.warn('[VoiceManager] Failed to persist voiceId:', err)
    }
  }

  function preview() {
    synth.cancel()
    const utterance = new SpeechSynthesisUtterance('This is a preview of the selected voice.')
    const voice = synth.getVoices().find((v) => v.voiceURI === selectedVoiceURI)
    if (voice) utterance.voice = voice
    synth.speak(utterance)
  }

  return {
    init,
    getVoices:           () => voices,
    getSelectedVoiceURI: () => selectedVoiceURI,
    selectVoice,
    preview,
  }
}
