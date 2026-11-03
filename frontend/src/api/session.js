// Tokens are held in memory and sent only to the API chosen at sign-in.
let active = null;
let version = 0;
const requests = new Set();
let onExpired = () => {};
const normalize = (url) => new URL(url).href.replace(/\/$/, '');

export function setApiSession(session, expired = () => {}) {
  version += 1;
  for (const controller of requests) controller.abort();
  requests.clear();
  active = session ? { ...session, baseUrl: normalize(session.baseUrl) } : null;
  onExpired = expired;
}

export function apiLease(baseUrl) {
  const current = version;
  const controller = new AbortController();
  const protectedApi = active && normalize(baseUrl) === active.baseUrl;
  // Authenticated workspaces cannot forward requests/credentials to another API.
  if (active && !protectedApi) throw new Error('Đổi tài khoản để kết nối với máy chủ khác');
  if (protectedApi && active.expiresAt <= Date.now()) {
    onExpired();
    throw new DOMException('Phiên đăng nhập đã hết hạn', 'AbortError');
  }
  requests.add(controller);
  return {
    signal: controller.signal,
    headers: protectedApi && active.token ? { Authorization: `Bearer ${active.token}` } : {},
    assertCurrent() {
      if (current !== version || controller.signal.aborted)
        throw new DOMException('Tài khoản đã thay đổi', 'AbortError');
    },
    response(status) {
      this.assertCurrent();
      if (status === 401 && protectedApi) onExpired();
    },
    release() {
      requests.delete(controller);
    },
  };
}
