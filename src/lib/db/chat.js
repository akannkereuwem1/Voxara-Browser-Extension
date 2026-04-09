/**
 * Upserts a message into the chatThreads store.
 *
 * @param {object} db - idb database instance
 * @param {string} threadId - ID of the thread (usually activeDocumentId)
 * @param {{ role: string, content: string, timestamp: number, contextChunks: string[] }} message - The message to append
 * @returns {Promise<void>}
 */
export async function appendMessage(db, threadId, message) {
  const tx = db.transaction('chatThreads', 'readwrite')
  const store = tx.objectStore('chatThreads')
  
  let thread = await store.get(threadId)
  const now = Date.now()

  if (!thread) {
    thread = {
      id: threadId,
      messages: [message],
      messageCount: 1,
      createdAt: now,
      updatedAt: now,
    }
  } else {
    thread.messages.push(message)
    thread.messageCount = thread.messages.length
    thread.updatedAt = now
  }

  await store.put(thread)
  await tx.done
}

/**
 * Retrieves a chat thread from the store by ID.
 *
 * @param {object} db - idb database instance
 * @param {string} threadId - ID of the thread
 * @returns {Promise<object|null>}
 */
export async function getThread(db, threadId) {
  const thread = await db.get('chatThreads', threadId)
  return thread || null
}
