// The free plan is 1 GB in decimal units (1,000 MB).
export const FREE_STORAGE_BYTES = 1_000_000_000;

export function storedBytes(files) {
  const stored = new Map();
  for (const file of files) {
    const confirmed =
      file.mode === 'demo' ? file.status === 'success' : file.uploadState === 'uploaded';
    if (!confirmed || !Number.isSafeInteger(file.size) || file.size < 0) continue;
    const id = file.remoteId ? `remote:${file.scope || ''}:${file.remoteId}` : file.id;
    if (!id) continue;
    // A local upload and its server record represent one logical file.
    stored.set(id, Math.max(stored.get(id) || 0, file.size));
  }
  return [...stored.values()].reduce((sum, size) => sum + size, 0);
}

export function formatStorageUsage(bytes) {
  if (bytes > 0 && bytes < 10_000) return '< 0,01 MB';
  const gb = bytes >= FREE_STORAGE_BYTES;
  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(bytes / (gb ? FREE_STORAGE_BYTES : 1_000_000))} ${gb ? 'GB' : 'MB'}`;
}
