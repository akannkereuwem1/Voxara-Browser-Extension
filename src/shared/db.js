import { openDB } from 'idb'

const DB_NAME = 'voxara'
const DB_VERSION = 2

export async function initDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, _transaction) {
      try {
        // documents store
        let docs
        if (oldVersion < 1) {
          docs = db.createObjectStore('documents', { keyPath: 'id' })
          docs.createIndex('url', 'url', { unique: false })
        } else {
          docs = _transaction.objectStore('documents')
        }
        // Phase 2: fileHash index for deduplication
        if (oldVersion < 2 && !docs.indexNames.contains('fileHash')) {
          docs.createIndex('fileHash', 'fileHash', { unique: false })
        }

        // chunks store
        if (oldVersion < 1) {
          const chunks = db.createObjectStore('chunks', { keyPath: 'id' })
          chunks.createIndex('documentId', 'documentId')
          chunks.createIndex('sequenceIndex', 'sequenceIndex')
          chunks.createIndex('text', 'text')

          // playbackStates store
          db.createObjectStore('playbackStates', { keyPath: 'documentId' })

          // chatThreads store
          db.createObjectStore('chatThreads', { keyPath: 'id' })
        }
      } catch (error) {
        throw new Error('IndexedDB upgrade failed: ' + error.message)
      }
    }
  })
}
