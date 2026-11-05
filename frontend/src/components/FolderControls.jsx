import { useEffect, useState } from 'react';
import { listFolders, moveFilesToFolder, saveFolder } from '../api/client.js';

export default function FolderControls({ baseUrl, folder, onFolder, selected, onMoved }) {
  const [folders, setFolders] = useState([]);
  const [destination, setDestination] = useState('');
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    listFolders(baseUrl, controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) setFolders(items);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [baseUrl, open]);

  async function run(action) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const active = folders.find((item) => item.id === folder);
  const canMove =
    selected.length > 0 &&
    selected.every(
      (file) =>
        file.remoteId &&
        file.uploadState === 'uploaded' &&
        (!file.lifecycleState || file.lifecycleState === 'active'),
    );
  const options = folders.map((item) => (
    <option key={item.id} value={item.id}>
      {item.name}
    </option>
  ));
  return (
    <details
      className="technical-details folder-controls"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {folder
          ? `Thư mục · ${active?.name || (folder === 'root' ? 'Gốc' : 'Đang tải')}`
          : 'Thư mục'}
      </summary>
      <div className="inline-actions">
        <select
          aria-label="Mở thư mục"
          value={folder || 'all'}
          onChange={(event) => onFolder(event.target.value)}
        >
          <option value="all">Tất cả thư mục</option>
          <option value="root">Thư mục gốc</option>
          {folder && folder !== 'root' && !active && (
            <option value={folder}>Thư mục hiện tại</option>
          )}
          {options}
        </select>
        <button
          className="button secondary"
          disabled={busy || loading}
          onClick={() => {
            setEditing('new');
            setName('');
          }}
        >
          Tạo thư mục
        </button>
        {active && (
          <button
            className="button secondary"
            disabled={busy || loading}
            onClick={() => {
              setEditing(active.id);
              setName(active.name);
            }}
          >
            Đổi tên
          </button>
        )}
      </div>
      {editing && (
        <form
          className="inline-actions"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const saved = await saveFolder(
                baseUrl,
                editing === 'new' ? null : editing,
                name.trim(),
              );
              setFolders((current) =>
                [...current.filter((item) => item.id !== saved.id), saved].sort((a, b) =>
                  a.name.localeCompare(b.name, 'vi'),
                ),
              );
              setEditing(null);
            });
          }}
        >
          <input
            aria-label="Tên thư mục"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            required
          />
          <button className="button primary" disabled={busy || !name.trim()}>
            Lưu
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={busy}
            onClick={() => setEditing(null)}
          >
            Hủy
          </button>
        </form>
      )}
      {canMove && (
        <div className="inline-actions">
          <select
            aria-label="Thư mục đích"
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
          >
            <option value="">Chọn thư mục đích</option>
            <option value="root">Thư mục gốc</option>
            {options}
          </select>
          <button
            className="button secondary"
            disabled={!destination || busy}
            onClick={() =>
              void run(async () => {
                const result = await moveFilesToFolder(
                  baseUrl,
                  selected.map((file) => file.remoteId),
                  destination === 'root' ? null : destination,
                );
                setMessage(`Đã chuyển ${result.moved} tệp.`);
                onMoved();
              })
            }
          >
            Chuyển {selected.length} tệp đã chọn
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="muted">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </details>
  );
}
