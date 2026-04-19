const API_BASE = import.meta.env.VITE_API_URL || '/api';

function getAuthHeaders(extraHeaders = {}) {
  const token = localStorage.getItem('curalink-token');
  return {
    ...extraHeaders,
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

export async function sendMessage(conversationId, message) {
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ message, conversationId })
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function sendStructuredQuery(conversationId, formData) {
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
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
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
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

/**
 * Request follow-up clarification questions for a medical query
 */
export async function requestClarification(message) {
  const res = await fetch(`${API_BASE}/chat/clarify`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ message })
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function getConversations(localIds = []) {
  const query = localIds.length > 0 ? `?ids=${localIds.join(',')}` : '';
  const res = await fetch(`${API_BASE}/conversations${query}`, {
    headers: getAuthHeaders()
  });
  if (!res.ok) {
    if (res.status === 401) return []; // Unauth ok
    throw new Error(`API error: ${res.status}`);
  }
  return res.json();
}

export async function getConversation(id) {
  const res = await fetch(`${API_BASE}/conversations/${id}`, {
    headers: getAuthHeaders()
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function createConversation() {
  const res = await fetch(`${API_BASE}/conversations/new`, {
    method: 'POST',
    headers: getAuthHeaders()
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function deleteConversation(id) {
  const res = await fetch(`${API_BASE}/conversations/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders()
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function checkHealth() {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function loginWithGoogle(credential) {
  const res = await fetch(`${API_BASE}/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential })
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  return res.json();
}

export async function migrateConversations(localIds) {
  const res = await fetch(`${API_BASE}/conversations/migrate`, {
    method: 'POST',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ localIds })
  });
  if (!res.ok) throw new Error(`Migration failed: ${res.status}`);
  return res.json();
}

/**
 * Upload a medical file (PDF or image) for AI analysis
 */
export async function uploadMedicalFile(conversationId, file, userQuery = '') {
  const formData = new FormData();
  formData.append('file', file);
  if (conversationId) formData.append('conversationId', conversationId);
  if (userQuery) formData.append('userQuery', userQuery);

  const token = localStorage.getItem('curalink-token');
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  const res = await fetch(`${API_BASE}/chat/upload`, {
    method: 'POST',
    headers,
    body: formData
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `Upload failed: ${res.status}` }));
    throw new Error(err.error || `Upload failed: ${res.status}`);
  }
  return res.json();
}

export async function getProfile() {
  const res = await fetch(`${API_BASE}/auth/profile`, {
    headers: getAuthHeaders()
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function updateProfile(medicalProfile) {
  const res = await fetch(`${API_BASE}/auth/profile`, {
    method: 'PUT',
    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ medicalProfile })
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}
