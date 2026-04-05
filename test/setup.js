import { IDBFactory } from 'fake-indexeddb'
import { IDBKeyRange } from 'fake-indexeddb'

// Install fake-indexeddb globals so IndexedDB is available in the Node test environment
globalThis.indexedDB = new IDBFactory()
globalThis.IDBKeyRange = IDBKeyRange
