// Both the bell and floating notices use the same internal navigation rules.
export function notificationText(event, value) {
  const text = String(value || '');
  if (!event.kind?.startsWith('billing-')) return text;
  return text
    .replace(/theo dõi\s+pay\s+as\s+(?:you|u)\s+go/gi, 'tính phí theo sử dụng')
    .replace(/pay\s+as\s+(?:you|u)\s+go/gi, 'tính phí theo sử dụng');
}

export function notificationTarget(event, files = []) {
  if (event.destination === 'pricing') return { to: '/pricing' };
  if (event.destination === 'costs') return { to: '/costs' };
  if (event.destination === 'admin/costs') return { to: '/admin/costs' };
  if (event.destination === 'admin/quarantine' && event.targetOwnerId && event.fileId)
    return {
      to: `/admin/quarantine?${new URLSearchParams({ owner: event.targetOwnerId, file: event.fileId })}`,
      state: { focusReview: true },
    };
  if (event.destination === 'settings' || event.kind === 'sync-error') return { to: '/settings' };
  if (event.destination === 'trash') return { to: '/trash' };
  if (event.folderId || event.destination === 'files')
    return { to: `/files?${new URLSearchParams({ folder: event.folderId || 'root' })}` };
  if (event.fileId) {
    const file = files.find((item) => item.id === event.fileId || item.remoteId === event.fileId);
    if (file?.lifecycleState === 'purged') return { to: '/uploads' };
    return {
      to: ['trashed', 'deleting'].includes(file?.lifecycleState) ? '/trash' : '/files?folder=all',
      inspect: event.fileId,
    };
  }
  return { to: '/uploads' };
}
