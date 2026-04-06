import {
  IDBFactory,
  IDBKeyRange,
  IDBCursor,
  IDBCursorWithValue,
  IDBDatabase,
  IDBIndex,
  IDBObjectStore,
  IDBOpenDBRequest,
  IDBRequest,
  IDBTransaction,
  IDBVersionChangeEvent,
} from 'fake-indexeddb'

// Install all fake-indexeddb globals so IndexedDB is available in the Node test environment
function installFakeIDB() {
  globalThis.indexedDB          = new IDBFactory()
  globalThis.IDBKeyRange        = IDBKeyRange
  globalThis.IDBCursor          = IDBCursor
  globalThis.IDBCursorWithValue = IDBCursorWithValue
  globalThis.IDBDatabase        = IDBDatabase
  globalThis.IDBIndex           = IDBIndex
  globalThis.IDBObjectStore     = IDBObjectStore
  globalThis.IDBOpenDBRequest   = IDBOpenDBRequest
  globalThis.IDBRequest         = IDBRequest
  globalThis.IDBTransaction     = IDBTransaction
  globalThis.IDBVersionChangeEvent = IDBVersionChangeEvent
}

installFakeIDB()

// Export so tests can call it to get a fresh isolated IDB instance
export { installFakeIDB }
