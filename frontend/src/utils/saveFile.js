function suggestedName(value) {
  return (
    String(value || 'file')
      .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_')
      .replace(/[. ]+$/g, '') || 'file'
  );
}

// The picker must run before the first network await to retain the button's user activation.
export async function saveFile(name, loadBlob, { signal, browser = globalThis } = {}) {
  signal?.throwIfAborted();
  const filename = suggestedName(name);
  const handle =
    browser.isSecureContext && typeof browser.showSaveFilePicker === 'function'
      ? await browser.showSaveFilePicker({
          id: 'maysec-downloads',
          startIn: 'downloads',
          suggestedName: filename,
        })
      : null;
  signal?.throwIfAborted();
  const blob = await loadBlob();
  signal?.throwIfAborted();
  if (handle) {
    let writable;
    const abort = () => writable?.abort().catch(() => {});
    signal?.addEventListener('abort', abort, { once: true });
    try {
      writable = await handle.createWritable();
      signal?.throwIfAborted();
      await writable.write(blob);
      signal?.throwIfAborted();
      await writable.close();
      writable = null;
      return 'saved';
    } catch (error) {
      await writable?.abort().catch(() => {});
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }
  const url = browser.URL.createObjectURL(blob);
  const link = browser.document.createElement('a');
  try {
    link.href = url;
    link.download = filename;
    browser.document.body.append(link);
    link.click();
    return 'downloaded';
  } finally {
    link.remove();
    browser.setTimeout(() => browser.URL.revokeObjectURL(url), 1000);
  }
}
