/* global fetch, TextDecoder */

/**
 * Async generator — yields token strings as they arrive from the SSE stream.
 *
 * @param {object} params
 * @param {string} params.query
 * @param {string} params.contextText
 * @param {Array}  params.history
 * @param {object} params.compat
 * @yields {string} token
 * @throws {Error} if API key absent or HTTP status !== 200
 */
export async function* streamAnswer({ query, contextText, history, compat }) {
  const result = await compat.storage.get('openai_api_key')
  const apiKey = result?.openai_api_key
  if (!apiKey) {
    throw new Error('OpenAI API key not configured')
  }

  const systemMessage = {
    role: 'system',
    content: 'Answer the user query only from the provided document context. Write in flowing prose with no markdown formatting. Aim for 2-4 sentences. If the answer is not present in the context, you must respond with "That doesn\'t appear to be covered in the section you\'re listening to."'
  }

  const recentHistory = (history || []).slice(-16).map(m => ({
    role: m.role,
    content: m.content
  }))

  const userMessage = {
    role: 'user',
    content: `Context:\n${contextText}\n\nQuery:\n${query}`
  }

  const messages = [systemMessage, ...recentHistory, userMessage]

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      stream: true,
      max_tokens: 300,
      messages
    })
  })

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop()

    for (let line of lines) {
      line = line.trim()
      if (!line) continue

      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim()
        if (data === '[DONE]') {
          return
        }

        try {
          const parsed = JSON.parse(data)
          const token = parsed.choices?.[0]?.delta?.content
          if (token) {
            yield token
          }
        } catch {
          // Ignore parse errors on potentially invalid or partial chunks
        }
      }
    }
  }
}
