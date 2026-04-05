import { defineConfig } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const manifest = require('./manifests/manifest.edge.json')

export default defineConfig({
  plugins: [crx({ manifest })],
  build: { outDir: 'dist/edge-mv3', sourcemap: true }
})
