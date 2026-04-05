/**
 * Browser Compatibility Abstraction Layer
 *
 * This is the ONLY module permitted to reference chrome.* or browser.* directly.
 * All other modules must use the unified API returned by BrowserCompat.init().
 */

export class BrowserCompatError extends Error {
  constructor(message) {
    super(message)
    this.name = 'BrowserCompatError'
  }
}

export class BrowserCompat {
  /**
   * Synchronous factory — detects the current browser environment via globals
   * and returns a unified API object.
   * @returns {CompatAPI}
   * @throws {BrowserCompatError} if neither chrome nor browser global is present
   */
  static init() {
    const env = {
      chrome: typeof chrome !== 'undefined' ? chrome : undefined,
      browser: typeof browser !== 'undefined' ? browser : undefined,
    }
    return BrowserCompat.initWithEnv(env)
  }

  /**
   * Testable factory — accepts a mock env object { chrome?, browser? } and
   * applies the same detection logic against the provided env instead of globals.
   * @param {{ chrome?: object, browser?: object }} env
   * @returns {CompatAPI}
   * @throws {BrowserCompatError}
   */
  static initWithEnv(env) {
    if (env.chrome !== undefined) {
      return BrowserCompat._buildChromeAPI(env.chrome)
    } else if (env.browser !== undefined) {
      return BrowserCompat._buildFirefoxAPI(env.browser)
    } else {
      throw new BrowserCompatError(
        'Unsupported browser environment: neither chrome nor browser global found'
      )
    }
  }

  // ---------------------------------------------------------------------------
  // Chrome / Edge path
  // ---------------------------------------------------------------------------

  static _buildChromeAPI(c) {
    return {
      storage: {
        get: (key) =>
          new Promise((resolve, reject) =>
            c.storage.local.get(key, (result) => {
              if (c.runtime.lastError) reject(c.runtime.lastError)
              else resolve(result)
            })
          ),
        set: (key, value) =>
          new Promise((resolve, reject) =>
            c.storage.local.set({ [key]: value }, () => {
              if (c.runtime.lastError) reject(c.runtime.lastError)
              else resolve()
            })
          ),
        remove: (key) =>
          new Promise((resolve, reject) =>
            c.storage.local.remove(key, () => {
              if (c.runtime.lastError) reject(c.runtime.lastError)
              else resolve()
            })
          ),
      },

      runtime: {
        sendMessage: (msg) =>
          new Promise((resolve, reject) =>
            c.runtime.sendMessage(msg, (response) => {
              if (c.runtime.lastError) reject(c.runtime.lastError)
              else resolve(response)
            })
          ),
        onMessage: (handler) => c.runtime.onMessage.addListener(handler),
      },

      sidePanel: BrowserCompat._buildChromeSidePanelAPI(c),

      tabs: {
        query: (opts) =>
          new Promise((resolve, reject) =>
            c.tabs.query(opts, (tabs) => {
              if (c.runtime.lastError) reject(c.runtime.lastError)
              else resolve(tabs)
            })
          ),
        update: (tabId, props) =>
          new Promise((resolve, reject) =>
            c.tabs.update(tabId, props, (tab) => {
              if (c.runtime.lastError) reject(c.runtime.lastError)
              else resolve(tab)
            })
          ),
      },
    }
  }

  static _buildChromeSidePanelAPI(c) {
    if (c.sidePanel) {
      return {
        open: () => Promise.resolve(c.sidePanel.open()),
        close: () => Promise.resolve(c.sidePanel.close()),
      }
    }
    return BrowserCompat._noopSidePanelAPI()
  }

  // ---------------------------------------------------------------------------
  // Firefox path
  // ---------------------------------------------------------------------------

  static _buildFirefoxAPI(b) {
    return {
      storage: {
        get: (key) => b.storage.local.get(key),
        set: (key, value) => b.storage.local.set({ [key]: value }),
        remove: (key) => b.storage.local.remove(key),
      },

      runtime: {
        sendMessage: (msg) => b.runtime.sendMessage(msg),
        onMessage: (handler) => b.runtime.onMessage.addListener(handler),
      },

      sidePanel: BrowserCompat._buildFirefoxSidePanelAPI(b),

      tabs: {
        query: (opts) => b.tabs.query(opts),
        update: (tabId, props) => b.tabs.update(tabId, props),
      },
    }
  }

  static _buildFirefoxSidePanelAPI(b) {
    if (b.sidebarAction) {
      return {
        open: () => Promise.resolve(b.sidebarAction.open()),
        close: () => Promise.resolve(b.sidebarAction.close()),
      }
    }
    return BrowserCompat._noopSidePanelAPI()
  }

  // ---------------------------------------------------------------------------
  // Fallback
  // ---------------------------------------------------------------------------

  static _noopSidePanelAPI() {
    const warn = () => {
      console.warn('[BrowserCompat] sidePanel API not available in this environment')
      return Promise.resolve()
    }
    return { open: warn, close: warn }
  }
}
