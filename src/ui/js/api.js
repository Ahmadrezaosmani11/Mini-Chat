export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message ?? 'Request failed.');
    this.status = status;
    this.code = body?.error?.code ?? 'INTERNAL';
    this.retryAfterSeconds = body?.error?.retryAfterSeconds;
  }
}

let csrfToken = null;
export const setCsrf = (t) => {
  csrfToken = t;
};
async function request(method, path, body, headers = {}) {
  const init = { method, headers: { ...headers }, credentials: 'same-origin' };
  if (method !== 'GET') init.headers['X-CSRF-Token'] = csrfToken ?? '';
  if (body !== undefined) {
    if (body instanceof Blob) {
      init.body = body;
      init.headers['Content-Type'] = 'image/jpeg';
    } else {
      init.body = JSON.stringify(body);
      init.headers['Content-Type'] = 'application/json';
    }
  } else if (method !== 'GET') {
    init.body = '{}';
    init.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, init);
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
export const api = {
  session: () => request('GET', '/api/session'),
  register: (b) => request('POST', '/api/auth/register', b),
  login: (b) => request('POST', '/api/auth/login', b),
  logout: () => request('POST', '/api/auth/logout'),
  reset: () => request('POST', '/api/auth/reset', { confirm: 'RESET' }),
  deleteAccount: (password) => request('DELETE', '/api/account', { password, confirm: 'DELETE' }),
  me: () => request('GET', '/api/me'),
  setName: (displayName) => request('PATCH', '/api/me/profile', { displayName }),
  setPhoto: (blob) => request('PUT', '/api/me/photo', blob),
  removePhoto: () => request('DELETE', '/api/me/photo'),
  setHistory: (historyEnabled) => request('PATCH', '/api/me/settings', { historyEnabled }),
  changePassword: (currentPassword, newPassword) => request('POST', '/api/me/password', { currentPassword, newPassword }),
  peers: () => request('GET', '/api/peers'),
  contacts: (q = '') => request('GET', `/api/contacts?q=${encodeURIComponent(q)}`),
  addContact: (peerId, source) => request('POST', '/api/contacts', { peerId, source }),
  verify: (peerId, verificationValue) => request('POST', `/api/contacts/${peerId}/verify`, { verificationValue }),
  removeContact: (peerId) => request('DELETE', `/api/contacts/${peerId}`),
  openConversation: (peerId) => request('POST', '/api/conversations', { peerId }),
  conversations: () => request('GET', '/api/conversations'),
  messages: (id, before) => request('GET', `/api/conversations/${id}/messages${before ? `?before=${before}` : ''}`),
  markRead: (id) => request('POST', `/api/conversations/${id}/read`),
  deleteConversation: (id) => request('DELETE', `/api/conversations/${id}`),
  send: (peerId, text) => request('POST', '/api/messages', { peerId, text }),
};
export function openEvents(handlers) {
  const es = new EventSource('/api/events');
  for (const type of ['presence', 'contact', 'connection', 'message', 'message.state', 'profile', 'conversation', 'history', 'error', 'session']) {
    es.addEventListener(type, (e) => handlers[type]?.(JSON.parse(e.data)));
  }
  es.addEventListener('open', () => handlers.open?.());
  return es;
}
