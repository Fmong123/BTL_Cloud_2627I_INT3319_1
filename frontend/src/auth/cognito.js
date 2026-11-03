const KEY = 'maysec.pkce.v1';
const bytes = (data) =>
  btoa(String.fromCharCode(...data))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export function cognitoConfig() {
  const domain = import.meta.env.VITE_COGNITO_DOMAIN?.trim();
  return {
    domain: domain
      ? new URL(domain.startsWith('https://') ? domain : `https://${domain}`).origin
      : null,
    clientId: import.meta.env.VITE_COGNITO_APP_CLIENT_ID || '75a0p1bv9bihkmgrkrrbb6nk7p',
    redirect: import.meta.env.VITE_COGNITO_REDIRECT_URI || `${location.origin}/callback`,
    logout: import.meta.env.VITE_COGNITO_LOGOUT_URI || location.origin,
  };
}

export async function startCognitoLogin() {
  const config = cognitoConfig();
  if (!config.domain) throw new Error('Chưa cấu hình địa chỉ đăng nhập Cognito');
  const verifier = bytes(crypto.getRandomValues(new Uint8Array(48)));
  const state = bytes(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = bytes(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
  );
  sessionStorage.setItem(
    KEY,
    JSON.stringify({ verifier, state, createdAt: Date.now(), redirect: config.redirect }),
  );
  const url = new URL('/oauth2/authorize', config.domain);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirect,
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'login',
  });
  location.assign(url.href);
}

export async function finishCognitoLogin(signal) {
  const query = new URLSearchParams(location.search);
  if (!query.has('code') && !query.has('error')) return null;
  const stored = sessionStorage.getItem(KEY);
  sessionStorage.removeItem(KEY);
  // Remove authorization codes from the address bar before rendering the workspace.
  history.replaceState(null, '', '/#/files');
  if (query.has('error')) throw new Error('Cognito chưa hoàn tất đăng nhập. Vui lòng thử lại.');
  const pending = stored ? JSON.parse(stored) : null;
  if (!pending || pending.state !== query.get('state') || Date.now() - pending.createdAt > 600000)
    throw new Error('Phiên đăng nhập không khớp hoặc đã hết hạn. Vui lòng thử lại.');
  const config = cognitoConfig();
  const response = await fetch(new URL('/oauth2/token', config.domain), {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      code: query.get('code'),
      redirect_uri: pending.redirect,
      code_verifier: pending.verifier,
    }),
  });
  if (!response.ok) throw new Error('Không đổi được mã đăng nhập Cognito. Vui lòng đăng nhập lại.');
  return response.json();
}
