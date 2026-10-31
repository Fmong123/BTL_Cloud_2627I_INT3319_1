// Only metadata is persisted. File objects, bytes, credentials and object URLs
// are deliberately excluded; an interrupted upload needs a fresh file choice.
const historyFields = [
  'id',
  'remoteId',
  'scope',
  'connection',
  'mode',
  'origin',
  'name',
  'size',
  'type',
  'createdAt',
  'updatedAt',
  'status',
  'progress',
  'error',
  'validationError',
  'uploadState',
  'scanStatus',
  'batchId',
  'batchFileId',
  'batchCreatedAt',
  'key',
  'storage',
  'starred',
  'starredUpdatedAt',
  'findingsCount',
  'findingTypes',
  'statusReason',
  'scannedAt',
  'quarantinedAt',
  'lifecycleState',
  'lifecycleUpdatedAt',
  'trashedAt',
  'trashExpiresAt',
  'nameUpdatedAt',
];
export const HISTORY_KEY = 'maysec.upload-history.v1';
export const NOTIFICATIONS_KEY = 'maysec.notifications.v1';

export function readRecords(key, storage) {
  try {
    storage ??= globalThis.localStorage;
    const value = JSON.parse(storage.getItem(key));
    return value?.version === 1 && Array.isArray(value.items)
      ? value.items
          .filter((item) => item && typeof item.id === 'string' && typeof item.scope === 'string')
          .slice(0, 2000)
      : [];
  } catch {
    return [];
  }
}
export function writeRecords(key, items, storage) {
  try {
    storage ??= globalThis.localStorage;
    storage.setItem(key, JSON.stringify({ version: 1, items: items.slice(0, 2000) }));
    return true;
  } catch {
    return false;
  }
}
export function historySnapshot(entries) {
  return entries.map((file) =>
    Object.fromEntries(
      historyFields.filter((key) => file[key] !== undefined).map((key) => [key, file[key]]),
    ),
  );
}
export function readHistory(storage) {
  return readRecords(HISTORY_KEY, storage)
    .filter(
      (file) =>
        typeof file.name === 'string' &&
        Number.isFinite(file.size) &&
        file.size >= 0 &&
        Number.isFinite(file.createdAt),
    )
    .map((file) => ({
      ...file,
      original: undefined,
      retryable: false,
      serverOnly: true,
      ...(['queued', 'uploading'].includes(file.status)
        ? {
            status: file.remoteId ? 'unknown' : 'cancelled',
            progress: 0,
            error:
              'Phiên tải đã kết thúc. Chọn lại tệp để tải lên; kiểm tra thư viện trước khi gửi lại.',
          }
        : {}),
    }));
}

export function readNotificationRecords(storage) {
  return readRecords(NOTIFICATIONS_KEY, storage).filter(
    (event) =>
      typeof event.title === 'string' &&
      event.title.length <= 200 &&
      typeof event.kind === 'string' &&
      typeof event.message === 'string' &&
      Number.isFinite(event.createdAt) &&
      ['info', 'success', 'warning', 'error'].includes(event.tone),
  );
}
