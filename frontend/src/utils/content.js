const MiB = 1024 ** 2;
export const DOWNLOAD_LIMIT = 100 * MiB;
export function canReadContent(file) {
  return Boolean(
    file?.mode === 'api' &&
    file.remoteId &&
    file.uploadState === 'uploaded' &&
    file.scanStatus === 'safe',
  );
}
export function previewInfo(file) {
  if (!canReadContent(file))
    return { kind: null, reason: 'Chỉ mở tệp đã tải lên và An toàn', limit: 0 };
  const type = (file.type || '').split(';')[0].toLowerCase();
  let kind = null,
    limit = 0;
  if (['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(type)) {
    kind = 'image';
    limit = 10 * MiB;
  } else if (type === 'application/pdf') {
    kind = 'pdf';
    limit = 20 * MiB;
  } else if (
    ['text/plain', 'text/csv', 'application/json'].includes(type) ||
    (['application/octet-stream', ''].includes(type) && /\.(txt|csv|json)$/i.test(file.name || ''))
  ) {
    kind = 'text';
    limit = MiB;
  }
  if (!kind) return { kind: null, reason: 'Chưa hỗ trợ xem trước định dạng này', limit: 0 };
  if (file.size > limit) return { kind: null, reason: 'Tệp lớn, tải xuống để mở', limit };
  return { kind, reason: '', limit };
}
