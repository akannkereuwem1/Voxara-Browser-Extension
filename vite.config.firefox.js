import { defineConfig } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifests/manifest.firefox.json' with { type: 'json' }

export default defineConfig({
  plugins: [crx({ manifest })],
  build: { outDir: 'dist/firefox-mv2', sourcemap: true }
})
