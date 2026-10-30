import { MB } from './files.js';
export const DOWNLOAD_LIMIT = 100 * MB;
export function canReadContent(file) {
  return Boolean(
    file?.mode === 'api' &&
    file.remoteId &&
    file.uploadState === 'uploaded' &&
    file.scanStatus === 'safe',
  );
}
export function downloadBlockReason(file, { contentAvailable = false, downloadingId = null } = {}) {
  if (!contentAvailable) return 'Máy chủ chưa hỗ trợ tải nội dung';
  if (!canReadContent(file)) return 'Chỉ tải tệp đã lưu và không phát hiện dữ liệu nhạy cảm';
  if (file.size > DOWNLOAD_LIMIT) return 'Tải xuống tối đa 100 MB mỗi tệp';
  if (downloadingId) return 'Đang chuẩn bị một tệp khác';
  return '';
}
export function previewInfo(file) {
  if (!canReadContent(file))
    return {
      kind: null,
      reason: 'Chỉ mở tệp đã lưu và không phát hiện dữ liệu nhạy cảm',
      limit: 0,
    };
  const type = (file.type || '').split(';')[0].toLowerCase();
  let kind = null,
    limit = 0;
  if (['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(type)) {
    kind = 'image';
    limit = 10 * MB;
  } else if (type === 'application/pdf') {
    kind = 'pdf';
    limit = 20 * MB;
  } else if (
    ['text/plain', 'text/csv', 'application/json'].includes(type) ||
    (['application/octet-stream', ''].includes(type) && /\.(txt|csv|json)$/i.test(file.name || ''))
  ) {
    kind = 'text';
    limit = MB;
  }
  if (!kind) return { kind: null, reason: 'Chưa hỗ trợ xem trước định dạng này', limit: 0 };
  if (file.size > limit) return { kind: null, reason: 'Tệp lớn, tải xuống để mở', limit };
  return { kind, reason: '', limit };
}
