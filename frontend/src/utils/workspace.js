import { fileCategory, normalizedSearch } from './files.js';
import { isAttention, needsTracking } from './processing.js';

export const PREFERENCES_KEY = 'maysec.preferences.v2';
export const LEGACY_PREFERENCES_KEY = 'maysec.preferences.v1';
export const uiPreferenceDefaults = {
  density: 'comfortable',
  nameColumnWidth: 320,
  showSize: true,
  showDate: true,
  sidebarCollapsed: false,
  savedFilters: {},
};
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

const filterFields = [
  'q',
  'category',
  'status',
  'section',
  'area',
  'scan',
  'date',
  'dateFrom',
  'dateTo',
  'sort',
];
export function savedFilterValues(value) {
  return Object.fromEntries(
    filterFields
      .filter((key) => typeof value?.[key] === 'string')
      .map((key) => [key, value[key].slice(0, 512)]),
  );
}
function savedViews(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 32)
      .filter(
        ([key, items]) => (key === 'demo' || /^api:https?:\/\//.test(key)) && Array.isArray(items),
      )
      .map(([key, items]) => [
        key,
        items
          .slice(0, 10)
          .filter(
            (item) =>
              item &&
              typeof item.id === 'string' &&
              typeof item.name === 'string' &&
              item.name.trim(),
          )
          .map((item) => ({
            id: item.id.slice(0, 80),
            name: item.name.trim().slice(0, 60),
            filters: savedFilterValues(item.filters),
          })),
      ]),
  );
}

export function readPreferences(defaults, storage) {
  try {
    storage ??= globalThis.localStorage;
    const saved = JSON.parse(
      storage.getItem(PREFERENCES_KEY) ?? storage.getItem(LEGACY_PREFERENCES_KEY),
    );
    if (![1, 2].includes(saved?.version)) return defaults;
    return {
      ...defaults,
      theme: themes.includes(saved.theme) ? saved.theme : defaults.theme,
      view: ['list', 'grid'].includes(saved.view) ? saved.view : defaults.view,
      sort: sorts.includes(saved.sort) ? saved.sort : defaults.sort,
      mode: ['demo', 'api'].includes(saved.mode) ? saved.mode : defaults.mode,
      baseUrl: typeof saved.baseUrl === 'string' ? saved.baseUrl : defaults.baseUrl,
      density: ['comfortable', 'compact'].includes(saved.density)
        ? saved.density
        : defaults.density,
      nameColumnWidth: Number.isFinite(saved.nameColumnWidth)
        ? Math.min(720, Math.max(240, saved.nameColumnWidth))
        : defaults.nameColumnWidth,
      showSize: typeof saved.showSize === 'boolean' ? saved.showSize : defaults.showSize,
      showDate: typeof saved.showDate === 'boolean' ? saved.showDate : defaults.showDate,
      sidebarCollapsed:
        typeof saved.sidebarCollapsed === 'boolean'
          ? saved.sidebarCollapsed
          : defaults.sidebarCollapsed,
      savedFilters: savedViews(saved.savedFilters ?? defaults.savedFilters),
    };
  } catch {
    return defaults;
  }
}

export function savePreferences(value, storage) {
  try {
    storage ??= globalThis.localStorage;
    storage.setItem(PREFERENCES_KEY, JSON.stringify({ ...value, version: 2 }));
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
    date = 'all',
    dateFrom = '',
    dateTo = '',
  } = {},
  now = Date.now(),
) {
  const bounds = dateBounds(date, dateFrom, dateTo, now);
  return files
    .filter(
      (file) =>
        normalizedSearch(file.name).includes(normalizedSearch(q)) &&
        (!bounds || (file.createdAt >= bounds[0] && file.createdAt < bounds[1])) &&
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

export function dateBounds(date, from, to, now = Date.now()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (['today', '7d', '30d'].includes(date)) {
    const start = new Date(today),
      end = new Date(today);
    start.setDate(start.getDate() - (date === '7d' ? 6 : date === '30d' ? 29 : 0));
    end.setDate(end.getDate() + 1);
    return [+start, +end];
  }
  if (date !== 'custom') return null;
  const parse = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
    const [y, m, d] = value.split('-').map(Number),
      parsed = new Date(y, m - 1, d);
    return parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d
      ? +parsed
      : NaN;
  };
  const first = from ? parse(from) : -Infinity,
    last = to ? parse(to) : Infinity;
  if (Number.isNaN(first) || Number.isNaN(last) || first > last) return [Infinity, -Infinity];
  if (last === Infinity) return [first, last];
  const end = new Date(last);
  end.setDate(end.getDate() + 1);
  return [first, +end];
}
