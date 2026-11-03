import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { setApiSession } from '../api/session.js';
import { validateApiBaseUrl } from '../api/client.js';
import { apiConfiguration, API_STORAGE_KEY } from '../api/config.js';
import { cognitoConfig, finishCognitoLogin, startCognitoLogin } from './cognito.js';
import Login from './Login.jsx';

const Context = createContext(null);
function initialApi() {
  return apiConfiguration().baseUrl;
}

async function authRequest(base, path, { signal, token, body } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) throw new DOMException('Đã hủy yêu cầu', 'AbortError');
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 15000);
  try {
    const response = await fetch(`${validateApiBaseUrl(base)}${path}`, {
      signal: controller.signal,
      cache: 'no-store',
      method: body ? 'POST' : 'GET',
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error('Máy chủ chưa trả JSON hợp lệ. Kiểm tra địa chỉ API.');
    }
    if (!response.ok)
      throw new Error(
        response.status === 404 && path === '/auth/config'
          ? 'Backend đang kết nối chưa có API đăng nhập mới. Hãy khởi động lại backend đúng thư mục project.'
          : typeof data.detail === 'string'
            ? data.detail
            : `Yêu cầu thất bại (HTTP ${response.status})`,
      );
    return data;
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Đã hủy yêu cầu', 'AbortError');
    if (controller.signal.aborted)
      throw new Error('Máy chủ chưa phản hồi sau 15 giây. Kiểm tra kết nối và thử lại.');
    if (error instanceof TypeError)
      throw new Error('Không kết nối được máy chủ. Kiểm tra địa chỉ API, backend và CORS.');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export function AuthProvider({ children }) {
  const [baseUrl, setBase] = useState(initialApi);
  const [session, setSession] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [config, setConfig] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [revision, refresh] = useState(0);
  const action = useRef(null);
  const callback = useRef(null);

  function clear(message = '') {
    action.current?.abort();
    setApiSession(null);
    setSession(null);
    setBusy(null);
    setError(message);
  }
  async function accept(result, signal) {
    if (!result.access_token || !Number.isFinite(result.expires_in) || result.expires_in <= 0)
      throw new Error('Phiên đăng nhập trả về chưa hợp lệ');
    const user = await authRequest(baseUrl, '/me', { token: result.access_token, signal });
    if (signal.aborted) return;
    if (
      !user.id ||
      !['user', 'admin'].includes(user.role) ||
      (result.user && result.user.id !== user.id)
    )
      throw new Error('Danh tính đăng nhập chưa khớp');
    const next = {
      baseUrl: validateApiBaseUrl(baseUrl),
      token: result.access_token,
      expiresAt: Date.now() + result.expires_in * 1000,
      user: { ...result.user, ...user, name: result.user?.name || user.username || 'Người dùng' },
      demo: Boolean(result.user),
    };
    setApiSession(next, () => clear('Phiên đăng nhập đã hết hạn. Hãy chọn lại tài khoản.'));
    setSession(next);
  }

  useEffect(() => {
    if (session) return;
    let alive = true;
    const controller = new AbortController();
    setLoading(true);
    setConfig(null);
    setAccounts([]);
    async function load() {
      if (load.running) return;
      load.running = true;
      try {
        const info = await authRequest(baseUrl, '/auth/config', { signal: controller.signal });
        if (
          !info ||
          typeof info.demo_enabled !== 'boolean' ||
          !['cognito', 'dev'].includes(info.auth_mode)
        )
          throw new Error('Cấu hình đăng nhập của backend chưa đúng định dạng MâySec.');
        if (!alive) return;
        setConfig(info);
        if (info.demo_enabled) {
          const result = await authRequest(baseUrl, '/auth/demo/accounts', {
            signal: controller.signal,
          });
          if (
            !Array.isArray(result?.items) ||
            result.items.some(
              (account) =>
                typeof account.id !== 'string' ||
                typeof account.name !== 'string' ||
                typeof account.username !== 'string' ||
                typeof account.active !== 'boolean',
            )
          )
            throw new Error('Danh sách tài khoản của backend chưa đúng định dạng.');
          if (alive) {
            setAccounts(result.items);
            setError('');
          }
        }
      } catch (e) {
        if (alive && e.name !== 'AbortError') setError(e.message || 'Không kết nối được máy chủ');
      } finally {
        load.running = false;
        if (alive) setLoading(false);
      }
    }
    void load();
    const timer = setInterval(() => {
      if (!document.hidden && !session) void load();
    }, 30000);
    return () => {
      alive = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [baseUrl, revision, Boolean(session)]);

  useEffect(() => {
    // Reuse the exchange promise under React StrictMode; OAuth codes are single-use.
    callback.current ??= finishCognitoLogin();
    let alive = true;
    const controller = new AbortController();
    callback.current
      .then(async (result) => {
        if (!result || !alive) return;
        setBusy('cognito');
        try {
          await accept(result, controller.signal);
        } catch (e) {
          if (alive && e.name !== 'AbortError') setError(e.message);
        } finally {
          if (alive) setBusy(null);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(
      () => clear('Phiên đăng nhập đã hết hạn. Hãy chọn lại tài khoản.'),
      Math.max(0, session.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [session]);

  async function choose(account) {
    if (busy) return;
    action.current?.abort();
    const controller = new AbortController();
    action.current = controller;
    setBusy(account.id);
    setError('');
    try {
      const result = await authRequest(baseUrl, '/auth/demo/login', {
        signal: controller.signal,
        body: { account_id: account.id },
      });
      await accept(result, controller.signal);
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message || 'Không đăng nhập được');
    } finally {
      if (!controller.signal.aborted) setBusy(null);
    }
  }
  async function loginLocal() {
    if (busy || config?.auth_mode !== 'dev') return;
    const controller = new AbortController();
    action.current = controller;
    setBusy('local');
    setError('');
    try {
      const user = await authRequest(baseUrl, '/me', { signal: controller.signal });
      if (!user.id || !['user', 'admin'].includes(user.role))
        throw new Error('Danh tính local chưa hợp lệ');
      const next = {
        baseUrl: validateApiBaseUrl(baseUrl),
        user: { ...user, name: 'Không gian cục bộ' },
        demo: true,
        localDev: true,
        expiresAt: Date.now() + 3600000,
      };
      setApiSession(next, () => clear('Phiên đã hết hạn. Vui lòng đăng nhập lại.'));
      setSession(next);
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message);
    } finally {
      if (!controller.signal.aborted) setBusy(null);
    }
  }
  function connect(value) {
    try {
      const base = validateApiBaseUrl(value);
      clear();
      try {
        localStorage.setItem(
          API_STORAGE_KEY,
          JSON.stringify({ configuredBase: apiConfiguration().configuredBase, baseUrl: base }),
        );
      } catch {
        /* Keep working for this session. */
      }
      setBase(base);
      refresh((x) => x + 1);
    } catch (e) {
      setError(e.message);
    }
  }
  function logout() {
    const standard = session && !session.demo;
    clear();
    if (standard) {
      const cfg = cognitoConfig();
      if (cfg.domain) {
        const url = new URL('/logout', cfg.domain);
        url.search = new URLSearchParams({ client_id: cfg.clientId, logout_uri: cfg.logout });
        location.assign(url.href);
      }
    }
  }
  function explore() {
    clear();
    setSession({
      baseUrl: validateApiBaseUrl(baseUrl),
      user: { id: 'local-experience', name: 'Khách trải nghiệm', role: 'user' },
      demo: true,
      localOnly: true,
      expiresAt: Date.now() + 86400000,
    });
  }
  return (
    <Context.Provider
      value={{
        session,
        baseUrl,
        accounts,
        config,
        error,
        loading,
        busy,
        choose,
        loginLocal,
        connect,
        refresh: () => refresh((x) => x + 1),
        logout,
        explore,
        loginCognito: async () => {
          try {
            await startCognitoLogin();
          } catch (e) {
            setError(e.message);
          }
        },
      }}
    >
      {session ? children : <Login />}
    </Context.Provider>
  );
}
export const useAuth = () => useContext(Context);
