import { openDB } from 'idb'

const DB_NAME = 'voxara'
const DB_VERSION = 1

export async function initDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, newVersion, transaction) {
      try {
        // documents store
        const docs = db.createObjectStore('documents', { keyPath: 'id' })
        docs.createIndex('url', 'url', { unique: false })

        // chunks store
        const chunks = db.createObjectStore('chunks', { keyPath: 'id' })
        chunks.createIndex('documentId', 'documentId')
        chunks.createIndex('sequenceIndex', 'sequenceIndex')
        chunks.createIndex('text', 'text')

        // playbackStates store
        db.createObjectStore('playbackStates', { keyPath: 'documentId' })

        // chatThreads store
        db.createObjectStore('chatThreads', { keyPath: 'id' })
      } catch (error) {
        throw new Error('IndexedDB upgrade failed: ' + error.message)
      }
    }
  })
}
