// Post-build script: copies the target manifest.json into the dist directory.
// Usage: node scripts/copy-manifest.js <target>
// Targets: firefox
import { copyFileSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const target = process.argv[2]
const map = {
  firefox: { src: 'manifests/manifest.firefox.json', dest: 'dist/firefox-mv2/manifest.json' },
}

if (!map[target]) {
  console.error(`Unknown target: ${target}`)
  process.exit(1)
}

const { src, dest } = map[target]
mkdirSync(dirname(resolve(root, dest)), { recursive: true })
copyFileSync(resolve(root, src), resolve(root, dest))
console.log(`Copied ${src} → ${dest}`)
