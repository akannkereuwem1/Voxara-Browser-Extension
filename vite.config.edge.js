import { defineConfig } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifests/manifest.edge.json' with { type: 'json' }

export default defineConfig({
  plugins: [crx({ manifest })],
  build: { outDir: 'dist/edge-mv3', sourcemap: true }
})
