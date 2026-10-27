import { fileCategory, normalizedSearch } from './files.js';
import { isAttention, needsTracking } from './processing.js';

export const PREFERENCES_KEY = 'maysec.preferences.v1';
export const themes = ['light', 'dark', 'system'];
export const sorts = ['newest', 'oldest', 'name', 'name-desc', 'size', 'size-desc'];
export const isBusy = (file) =>
  Boolean(file.original) && ['queued', 'uploading'].includes(file.status);
export const canRetry = (file) =>
  Boolean(file.original) &&
  ['error', 'cancelled'].includes(file.status) &&
  !file.validationError &&
  file.retryable !== false &&
  !file.reconciling &&
  !file.outcomeUnknown;
export const fileFingerprint = (file) =>
  file ? JSON.stringify([file.name, file.size, file.lastModified]) : null;

export function readPreferences(defaults, storage) {
  try {
    storage ??= globalThis.localStorage;
    const saved = JSON.parse(storage.getItem(PREFERENCES_KEY));
    if (saved?.version !== 1) return defaults;
    return {
      ...defaults,
      theme: themes.includes(saved.theme) ? saved.theme : defaults.theme,
      view: ['list', 'grid'].includes(saved.view) ? saved.view : defaults.view,
      sort: sorts.includes(saved.sort) ? saved.sort : defaults.sort,
      mode: ['demo', 'api'].includes(saved.mode) ? saved.mode : defaults.mode,
      baseUrl: typeof saved.baseUrl === 'string' ? saved.baseUrl : defaults.baseUrl,
    };
  } catch {
    return defaults;
  }
}

export function savePreferences(value, storage) {
  try {
    storage ??= globalThis.localStorage;
    storage.setItem(PREFERENCES_KEY, JSON.stringify({ ...value, version: 1 }));
    return true;
  } catch {
    return false;
  }
}

export function filterFiles(
  files,
  {
    q = '',
    category = 'all',
    status = 'all',
    section = 'all',
    sort = 'newest',
    area = 'all',
    scan = 'all',
  } = {},
  now = Date.now(),
) {
  return files
    .filter(
      (file) =>
        normalizedSearch(file.name).includes(normalizedSearch(q)) &&
        (category === 'all' || fileCategory(file) === category) &&
        (status === 'all' ||
          (status === 'active'
            ? isBusy(file) || file.status === 'processing' || needsTracking(file)
            : file.status === status)) &&
        (area === 'all' || (area === 'attention' ? isAttention(file) : !isAttention(file))) &&
        (scan === 'all' || file.scanStatus === scan) &&
        (section !== 'starred' || file.starred) &&
        (section !== 'recent' || now - file.createdAt < 86400000),
    )
    .sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name, 'vi');
      if (sort === 'name-desc') return b.name.localeCompare(a.name, 'vi');
      if (sort === 'size') return a.size - b.size;
      if (sort === 'size-desc') return b.size - a.size;
      return sort === 'oldest' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt;
    });
}
