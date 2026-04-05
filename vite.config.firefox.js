import { defineConfig } from 'vite'
import { createRequire } from 'module'
import { resolve } from 'path'

const require = createRequire(import.meta.url)

// Firefox MV2 — plain Vite build, no CRXJS (CRXJS only supports MV3)
export default defineConfig({
  build: {
    outDir: 'dist/firefox-mv2',
    sourcemap: true,
    rollupOptions: {
      input: {
        background: resolve('src/background/index.js'),
        content: resolve('src/content/index.js'),
        sidepanel: resolve('src/sidepanel/index.html'),
        options: resolve('src/options/index.html'),
      },
    },
  },
})
