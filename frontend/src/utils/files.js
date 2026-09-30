export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: index ? 1 : 0 }).format(bytes / 1024 ** index)} ${units[index]}`;
}

export function fileCategory(file) {
  const extension = file.name.split('.').pop().toLowerCase();
  if (file.type?.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'heic', 'avif'].includes(extension)) return 'image';
  if (['xls', 'xlsx', 'csv', 'ods'].includes(extension)) return 'sheet';
  if (['pdf', 'doc', 'docx', 'txt', 'md', 'ppt', 'pptx', 'rtf', 'odt'].includes(extension)) return 'document';
  return 'other';
}

export function normalizedSearch(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}

export function validateFile(file, maxBytes) {
  if (file.size === 0) return 'Tệp trống — hãy chọn một tệp có nội dung';
  if (file.size > maxBytes) return `Tệp vượt quá giới hạn ${formatBytes(maxBytes)}`;
  return null;
}
