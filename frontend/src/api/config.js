import { validateApiBaseUrl } from './client.js';

export const API_STORAGE_KEY = 'maysec.auth.api.v1';

// One API address for sign-in, workspace and account changes. A saved override
// belongs to the environment where it was chosen, not to another launcher port.
export function resolveApiBase({ configured, saved, page, development = false } = {}) {
  const fallback =
    !development && page?.origin && /^https?:/.test(page.protocol)
      ? `${page.origin}/api`
      : 'http://127.0.0.1:8000';
  const configuredBase = validateApiBaseUrl(
    configured?.trim() ? new URL(configured.trim(), page?.origin || fallback).href : fallback,
    page?.protocol,
  );
  try {
    if (saved && typeof saved === 'object' && saved.configuredBase === configuredBase)
      return { baseUrl: validateApiBaseUrl(saved.baseUrl, page?.protocol), configuredBase };
    if (typeof saved === 'string' && !configured?.trim())
      return { baseUrl: validateApiBaseUrl(saved, page?.protocol), configuredBase };
  } catch {
    /* Ignore corrupt or incompatible preferences. */
  }
  return { baseUrl: configuredBase, configuredBase };
}

export function apiConfiguration() {
  let saved;
  try {
    const raw = localStorage.getItem(API_STORAGE_KEY);
    if (raw) {
      try {
        saved = JSON.parse(raw);
      } catch {
        saved = raw;
      }
    }
  } catch {
    /* Storage is optional. */
  }
  return resolveApiBase({
    configured: import.meta.env?.VITE_API_BASE_URL,
    saved,
    page: globalThis.location,
    development: import.meta.env?.DEV,
  });
}
