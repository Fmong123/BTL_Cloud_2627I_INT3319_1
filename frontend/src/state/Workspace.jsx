import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { demoUpload, uploadFile, validateApiBaseUrl } from '../api/client.js';
import { validateFile } from '../utils/files.js';
import {
  canRetry,
  fileFingerprint,
  isBusy,
  readPreferences,
  savePreferences,
} from '../utils/workspace.js';

const Context = createContext(null);
const configuredSize = Number(import.meta.env.VITE_MAX_FILE_SIZE_MB || 100);
const defaultLimit =
  (Number.isFinite(configuredSize) && configuredSize > 0 ? configuredSize : 100) * 1024 ** 2;
export const defaultPreferences = {
  theme: 'system',
  view: 'list',
  sort: 'newest',
  mode: import.meta.env.VITE_UPLOAD_MODE === 'api' ? 'api' : 'demo',
  baseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000',
};

export function WorkspaceProvider({ children }) {
  const [files, renderFiles] = useState([]);
  const filesRef = useRef([]);
  const [preferences, setPreferences] = useState(() => readPreferences(defaultPreferences));
  const [health, setHealth] = useState(null);
  const [notice, setNotice] = useState(null);
  const [undo, setUndo] = useState(null);
  const undoRef = useRef(null);
  const [duplicates, setDuplicates] = useState([]);
  const duplicateRef = useRef(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const active = useRef(new Map());
  const queue = useRef([]);
  const mounted = useRef(true);
  const inputRef = useRef(null);
  const busy = files.some(isBusy);
  const limit =
    preferences.mode === 'api' && health?.baseUrl === preferences.baseUrl
      ? health.max_file_size_bytes
      : defaultLimit;

  function setFiles(change) {
    filesRef.current = change(filesRef.current);
    if (mounted.current) renderFiles(filesRef.current);
  }
  function update(id, patch) {
    if (mounted.current)
      setFiles((current) => current.map((file) => (file.id === id ? { ...file, ...patch } : file)));
  }
  function notify(message) {
    setNotice(message);
  }

  useEffect(() => {
    setStorageFailed(!savePreferences(preferences));
  }, [preferences]);
  useEffect(() => {
    mounted.current = true;
    const offline = () => setOnline(navigator.onLine);
    const preventFileNavigation = (event) => {
      if (Array.from(event.dataTransfer?.types || []).includes('Files')) event.preventDefault();
    };
    window.addEventListener('online', offline);
    window.addEventListener('offline', offline);
    window.addEventListener('dragover', preventFileNavigation);
    window.addEventListener('drop', preventFileNavigation);
    return () => {
      mounted.current = false;
      queue.current = [];
      active.current.forEach((controller) => controller.abort());
      active.current.clear();
      window.removeEventListener('online', offline);
      window.removeEventListener('offline', offline);
      window.removeEventListener('dragover', preventFileNavigation);
      window.removeEventListener('drop', preventFileNavigation);
    };
  }, []);
  useEffect(() => {
    if (!busy) return;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => {
      undoRef.current = null;
      setUndo(null);
    }, 8000);
    return () => clearTimeout(timer);
  }, [undo]);

  async function processQueue() {
    if (active.current.size || !queue.current.length || !mounted.current) return;
    const item = queue.current.shift();
    const controller = new AbortController();
    active.current.set(item.id, controller);
    update(item.id, { status: 'uploading', progress: 0, error: null });
    try {
      const result = await (item.connection.mode === 'demo' ? demoUpload : uploadFile)(
        item.original,
        {
          baseUrl: item.connection.baseUrl,
          signal: controller.signal,
          onProgress: (progress) => update(item.id, { progress }),
        },
      );
      // Cancellation can happen while the response callback is being delivered.
      if (!controller.signal.aborted)
        update(item.id, {
          status: 'success',
          progress: 100,
          remoteId: result.id,
          key: result.key,
          storage: result.storage,
          scanStatus: result.scanStatus,
        });
    } catch (error) {
      update(item.id, {
        status: error.name === 'AbortError' ? 'cancelled' : 'error',
        error: error.name === 'AbortError' ? null : error.message,
        retryable: error.retryable !== false,
      });
    } finally {
      active.current.delete(item.id);
      processQueue();
    }
  }

  function enqueue(selected) {
    const connection = { mode: preferences.mode, baseUrl: preferences.baseUrl };
    const next = selected.map((original) => {
      const error = validateFile(original, limit);
      return {
        id: crypto.randomUUID(),
        name: original.name,
        size: original.size,
        type: original.type,
        original,
        connection,
        mode: connection.mode,
        createdAt: Date.now(),
        status: error ? 'error' : 'queued',
        error,
        validationError: Boolean(error),
        retryable: !error,
        progress: 0,
        starred: false,
      };
    });
    setFiles((current) => [...next, ...current]);
    queue.current.push(...next.filter((file) => !file.validationError));
    notify(
      `Đã thêm ${next.length} tệp${next.some((file) => file.validationError) ? ' — có tệp cần kiểm tra' : ''}`,
    );
    processQueue();
  }
  function addFiles(selected) {
    if (!selected.length) return;
    if (duplicateRef.current) {
      notify('Hãy xử lý các tệp trùng trước khi thêm lượt mới');
      return;
    }
    try {
      if (preferences.mode === 'api') validateApiBaseUrl(preferences.baseUrl);
    } catch {
      notify('Địa chỉ lưu trữ chưa hợp lệ — hãy kiểm tra trong Cài đặt');
      return;
    }
    const known = new Set(filesRef.current.map((file) => fileFingerprint(file.original)));
    const fresh = [],
      repeated = [];
    for (const file of selected) {
      const key = fileFingerprint(file);
      (known.has(key) ? repeated : fresh).push(file);
      known.add(key);
    }
    if (fresh.length) enqueue(fresh);
    if (repeated.length) {
      duplicateRef.current = true;
      setDuplicates(repeated);
    }
  }
  function resolveDuplicates(keep) {
    if (keep) enqueue(duplicates);
    duplicateRef.current = false;
    setDuplicates([]);
  }
  function cancel(ids) {
    const targets = new Set(ids);
    queue.current = queue.current.filter((file) => !targets.has(file.id));
    for (const id of ids) active.current.get(id)?.abort();
    setFiles((current) =>
      current.map((file) =>
        targets.has(file.id) && isBusy(file) ? { ...file, status: 'cancelled', error: null } : file,
      ),
    );
  }
  function retry(ids) {
    const pending = filesRef.current.filter(
      (file) =>
        ids.includes(file.id) &&
        canRetry(file) &&
        !active.current.has(file.id) &&
        !queue.current.some((item) => item.id === file.id),
    );
    if (!pending.length) return;
    setFiles((current) =>
      current.map((file) =>
        pending.some((item) => item.id === file.id)
          ? { ...file, status: 'queued', progress: 0, error: null }
          : file,
      ),
    );
    queue.current.push(...pending);
    processQueue();
  }
  function star(ids, value) {
    setFiles((current) =>
      current.map((file) =>
        ids.includes(file.id) ? { ...file, starred: value ?? !file.starred } : file,
      ),
    );
  }
  function remove(ids) {
    const removed = filesRef.current.filter((file) => ids.includes(file.id) && !isBusy(file));
    if (!removed.length) return;
    const nextUndo = [...(undoRef.current || []), ...removed];
    undoRef.current = nextUndo;
    setUndo(nextUndo);
    setFiles((current) => current.filter((file) => !removed.includes(file)));
  }
  function restore() {
    if (undoRef.current)
      setFiles((current) =>
        [...undoRef.current, ...current].sort((a, b) => b.createdAt - a.createdAt),
      );
    undoRef.current = null;
    setUndo(null);
    notify('Đã khôi phục các tệp vào danh sách');
  }
  function saveConnection(value) {
    if (filesRef.current.some(isBusy) || duplicateRef.current) {
      notify('Chờ hoặc hủy các tệp đang tải trước khi đổi kết nối');
      return false;
    }
    const next = {
      ...value,
      baseUrl: value.mode === 'api' ? validateApiBaseUrl(value.baseUrl) : value.baseUrl,
    };
    setPreferences((current) => ({ ...current, ...next }));
    setHealth(null);
    notify('Đã lưu kết nối');
    return true;
  }
  return (
    <Context.Provider
      value={{
        files,
        preferences,
        setPreferences,
        health,
        setHealth,
        limit,
        busy,
        inputRef,
        addFiles,
        cancel,
        retry,
        star,
        remove,
        notify,
        notice,
        setNotice,
        undo,
        restore,
        duplicates,
        resolveDuplicates,
        saveConnection,
        storageFailed,
        online,
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useWorkspace() {
  return useContext(Context);
}
