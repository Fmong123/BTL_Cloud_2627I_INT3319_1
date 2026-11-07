// Both the bell and floating notices use the same internal navigation rules.
export function notificationTarget(event, files = []) {
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
