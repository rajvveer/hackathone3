const API_BASE = import.meta.env.VITE_API_URL || '/api';

export async function sendMessage(conversationId, message) {
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, conversationId })
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function sendStructuredQuery(conversationId, formData) {
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ structured: formData, conversationId })
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

/**
 * Streaming chat — yields SSE events as they arrive
 * Each yielded item: { event: string, data: any }
 */
export async function* sendMessageStream(conversationId, input, isStructured = false) {
  const body = isStructured
    ? { structured: input, conversationId }
    : { message: input, conversationId };

  const response = await fetch(`${API_BASE}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) throw new Error(`API error: ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    // SSE messages are separated by double newline
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || ''; // keep incomplete chunk

    for (const part of parts) {
      if (!part.trim()) continue;
      const lines = part.split('\n');
      let eventType = 'message';
      let data = null;

      for (const line of lines) {
        if (line.startsWith('event: ')) eventType = line.slice(7).trim();
        if (line.startsWith('data: ')) {
          try { data = JSON.parse(line.slice(6).trim()); } catch (e) { /* ignore */ }
        }
      }

      if (data !== null) yield { event: eventType, data };
    }
  }
}

export async function getConversations() {
  const res = await fetch(`${API_BASE}/conversations`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function getConversation(id) {
  const res = await fetch(`${API_BASE}/conversations/${id}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function createConversation() {
  const res = await fetch(`${API_BASE}/conversations/new`, { method: 'POST' });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function deleteConversation(id) {
  const res = await fetch(`${API_BASE}/conversations/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function checkHealth() {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}
