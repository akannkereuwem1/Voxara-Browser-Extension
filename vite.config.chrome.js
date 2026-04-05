import { defineConfig } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifests/manifest.chrome.json' with { type: 'json' }

export default defineConfig({
  plugins: [crx({ manifest })],
  build: { outDir: 'dist/chrome-mv3', sourcemap: true }
})
