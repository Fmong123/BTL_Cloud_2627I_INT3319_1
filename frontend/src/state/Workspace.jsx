import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { demoUpload, uploadFile, validateApiBaseUrl } from '../api/client.js';
import { validateFile } from '../utils/files.js';
import {
  canRetry,
  fileFingerprint,
  isBusy,
  readPreferences,
  savePreferences,
} from '../utils/workspace.js';
import { isAttention, mergeServerFiles, scanStates } from '../utils/processing.js';
import { UploadQueue } from '../utils/uploadQueue.js';
import { useRemoteLibrary } from './useRemoteLibrary.js';
import { useNotifications } from './useNotifications.js';
import Modal from '../components/Modal.jsx';

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
function connectionScope(connection) {
  if (connection.mode === 'demo') return 'demo';
  try {
    return `api:${validateApiBaseUrl(connection.baseUrl)}`;
  } catch {
    return `api:${connection.baseUrl}`;
  }
}

export function WorkspaceProvider({ children }) {
  const [entries, renderEntries] = useState([]);
  const [serverStars, setServerStars] = useState(new Map());
  const entriesRef = useRef([]);
  const [preferences, setPreferences] = useState(() => readPreferences(defaultPreferences));
  const scope = connectionScope(preferences);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [health, setHealth] = useState(null);
  const [notice, setNotice] = useState(null);
  const [undoState, setUndo] = useState(null);
  const undoRef = useRef(null);
  const [duplicates, setDuplicates] = useState([]);
  const duplicateRef = useRef(null);
  const [retryConfirmation, setRetryConfirmation] = useState(null);
  const [inspectedId, inspect] = useState(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const mounted = useRef(true);
  const inputRef = useRef(null);
  const scheduler = useRef(null);
  const callbacks = useRef(null);
  const identities = useRef(new Map());
  const notifications = useNotifications(scope);
  const notificationsRef = useRef(notifications);
  notificationsRef.current = notifications;
  const busy = entries.some(isBusy);
  const limit =
    preferences.mode === 'api' && health?.baseUrl === preferences.baseUrl
      ? health.max_file_size_bytes
      : defaultLimit;

  function setEntries(change) {
    entriesRef.current = change(entriesRef.current);
    if (mounted.current) renderEntries(entriesRef.current);
  }
  function update(id, patch) {
    if (mounted.current)
      setEntries((current) =>
        current.map((file) => (file.id === id ? { ...file, ...patch } : file)),
      );
  }
  function notify(message) {
    setNotice(message);
  }
  function stableId(file) {
    return identities.current.get(`${file.scope}|${file.remoteId}`) || file.id;
  }
  function receiveRecord(record) {
    if (
      !entriesRef.current.some(
        (file) => file.scope === record.scope && file.remoteId === record.remoteId,
      )
    )
      return;
    setEntries((current) => mergeServerFiles(current, [record]));
  }
  function serverEvent(record, prior) {
    const fileId = stableId(record);
    const event = {
      scope: record.scope,
      fileId,
      message: record.name || 'Thông tin tệp đã được cập nhật.',
    };
    if (!prior) {
      notificationsRef.current.addEvent({
        ...event,
        kind: 'server-new',
        title: isAttention(record) ? 'Có tệp cần chú ý' : 'Có tệp mới trên máy chủ',
        tone: isAttention(record) ? 'warning' : 'info',
      });
      return;
    }
    if (record.uploadState !== prior.uploadState && record.uploadState === 'uploaded')
      notificationsRef.current.addEvent({
        ...event,
        kind: 'upload-reconciled',
        title: 'Đã xác nhận tệp được lưu',
        tone: 'success',
      });
    if (
      record.scanStatus !== prior.scanStatus &&
      !['not_started', 'scanning'].includes(record.scanStatus)
    ) {
      notificationsRef.current.addEvent({
        ...event,
        kind: `scan-${record.scanStatus}`,
        title: scanStates[record.scanStatus]?.label || 'Kết quả xử lý đã thay đổi',
        tone:
          record.scanStatus === 'safe'
            ? 'success'
            : ['error', 'quarantine_delete_failed'].includes(record.scanStatus)
              ? 'error'
              : 'warning',
      });
    }
  }
  const remote = useRemoteLibrary({
    scope,
    preferences,
    localFiles: entries,
    onHealth: (data) =>
      setHealth((current) => (!current || data.checkedAt >= current.checkedAt ? data : current)),
    onTransition: serverEvent,
    onRecord: receiveRecord,
    onSyncError: (message) =>
      notificationsRef.current.addEvent({
        scope,
        kind: 'sync-error',
        title: 'Chưa đồng bộ được thư viện',
        message,
        tone: 'warning',
      }),
  });
  const remoteRef = useRef(remote);
  remoteRef.current = remote;
  const localFiles = entries.filter((file) => file.scope === scope);
  const serverFiles = remote.records
    .filter((file) => file.scope === scope)
    .map((file) => ({ ...file, id: stableId(file) }));
  const files = useMemo(
    () =>
      mergeServerFiles(localFiles, serverFiles).map((file) =>
        !file.original && serverStars.has(`${file.scope}|${file.remoteId}`)
          ? { ...file, starred: serverStars.get(`${file.scope}|${file.remoteId}`) }
          : file,
      ),
    [entries, remote.records, scope, serverStars],
  );
  const activityFiles = useMemo(() => {
    const ids = new Set(localFiles.map((file) => file.id));
    return files.filter((file) => ids.has(file.id));
  }, [files]);

  useEffect(() => {
    setStorageFailed(!savePreferences(preferences));
  }, [preferences]);
  useEffect(() => {
    inspect(null);
    setRetryConfirmation(null);
  }, [scope]);
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
      scheduler.current?.dispose();
      scheduler.current = null;
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
    if (!undoState) return;
    const timer = setTimeout(() => {
      undoRef.current = null;
      setUndo(null);
    }, 8000);
    return () => clearTimeout(timer);
  }, [undoState]);

  callbacks.current = {
    onStart: (item) => update(item.id, { status: 'uploading', progress: 0, error: null }),
    async run(item, signal) {
      return (item.connection.mode === 'demo' ? demoUpload : uploadFile)(item.original, {
        baseUrl: item.connection.baseUrl,
        signal,
        onProgress: (progress) => update(item.id, { progress }),
      });
    },
    onSuccess(item, result) {
      const patch = {
        status: 'success',
        progress: 100,
        remoteId: result.id,
        key: result.key,
        storage: result.storage,
        scanStatus: result.scanStatus,
        uploadState: result.uploadState ?? 'uploaded',
        updatedAt: result.createdAt || 0,
        findingsCount: result.findingsCount ?? 0,
        findingTypes: result.findingTypes ?? [],
        statusReason: result.statusReason ?? null,
        reconciling: false,
        outcomeUnknown: false,
        error: null,
      };
      if (item.mode === 'api' && result.id)
        identities.current.set(`${item.scope}|${result.id}`, item.id);
      update(item.id, patch);
      notificationsRef.current.addEvent({
        scope: item.scope,
        fileId: item.id,
        kind: item.mode === 'demo' ? 'demo-success' : 'upload-success',
        title: item.mode === 'demo' ? 'Đã hoàn tất trải nghiệm' : 'Tệp đã được lưu',
        message: item.name,
        tone: 'success',
      });
      if (item.mode === 'api' && item.scope === scopeRef.current && result.id)
        remoteRef.current.seedFile({
          ...item,
          ...patch,
          origin: 'server',
          serverOnly: true,
          original: undefined,
        });
    },
    onError(item, error) {
      const cancelled = error.name === 'AbortError';
      const patch = {
        status: cancelled
          ? 'cancelled'
          : error.outcomeUnknown || error.reconciling
            ? 'unknown'
            : 'error',
        error: cancelled ? null : error.message,
        retryable: error.retryable !== false,
        reconciling: Boolean(error.reconciling),
        outcomeUnknown: Boolean(error.outcomeUnknown),
        ...(error.remoteId
          ? { remoteId: error.remoteId, key: error.key, uploadState: 'unknown' }
          : {}),
      };
      if (error.remoteId) identities.current.set(`${item.scope}|${error.remoteId}`, item.id);
      update(item.id, patch);
      if (!cancelled)
        notificationsRef.current.addEvent({
          scope: item.scope,
          fileId: item.id,
          kind: 'upload-error',
          title: patch.status === 'unknown' ? 'Cần đối soát kết quả upload' : 'Chưa tải được tệp',
          message: `${item.name}: ${error.message}`,
          tone: 'error',
        });
      if (error.remoteId && item.scope === scopeRef.current)
        remoteRef.current.seedFile({
          ...item,
          ...patch,
          origin: 'server',
          serverOnly: true,
          original: undefined,
          updatedAt: 0,
        });
    },
  };
  function queue() {
    if (!scheduler.current)
      scheduler.current = new UploadQueue({
        concurrency: 5,
        run: (...args) => callbacks.current.run(...args),
        onStart: (...args) => callbacks.current.onStart(...args),
        onSuccess: (...args) => callbacks.current.onSuccess(...args),
        onError: (...args) => callbacks.current.onError(...args),
      });
    return scheduler.current;
  }
  function enqueue(
    selected,
    connection = { mode: preferences.mode, baseUrl: preferences.baseUrl },
    maxBytes = limit,
  ) {
    const targetScope = connectionScope(connection);
    const next = selected.map((original) => {
      const error = validateFile(original, maxBytes);
      return {
        id: crypto.randomUUID(),
        name: original.name,
        size: original.size,
        type: original.type,
        original,
        connection: { ...connection },
        scope: targetScope,
        origin: 'local',
        mode: connection.mode,
        createdAt: Date.now(),
        status: error ? 'error' : 'queued',
        error,
        validationError: Boolean(error),
        retryable: !error,
        progress: 0,
        starred: false,
        scanStatus: connection.mode === 'demo' ? 'unknown' : 'not_started',
        uploadState: null,
      };
    });
    setEntries((current) => [...next, ...current]);
    queue().enqueue(next.filter((file) => !file.validationError));
    notify(
      `Đã thêm ${next.length} tệp${next.some((file) => file.validationError) ? ' — có tệp cần kiểm tra' : ''}`,
    );
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
    const known = new Set(
      entriesRef.current
        .filter((file) => file.scope === scope && file.original)
        .map((file) => fileFingerprint(file.original)),
    );
    const fresh = [],
      repeated = [];
    for (const file of selected) {
      const key = fileFingerprint(file);
      (known.has(key) ? repeated : fresh).push(file);
      known.add(key);
    }
    if (fresh.length) enqueue(fresh);
    if (repeated.length) {
      duplicateRef.current = {
        connection: { mode: preferences.mode, baseUrl: preferences.baseUrl },
        limit,
      };
      setDuplicates(repeated);
    }
  }
  function resolveDuplicates(keep) {
    if (keep && duplicateRef.current)
      enqueue(duplicates, duplicateRef.current.connection, duplicateRef.current.limit);
    duplicateRef.current = null;
    setDuplicates([]);
  }
  function cancel(ids) {
    queue().cancel(ids);
    setEntries((current) =>
      current.map((file) =>
        ids.includes(file.id) && isBusy(file)
          ? { ...file, status: 'cancelled', error: null }
          : file,
      ),
    );
  }
  function retry(ids, confirmed = false) {
    const pending = entriesRef.current.filter(
      (file) =>
        file.scope === scope &&
        ids.includes(file.id) &&
        (canRetry(file) || (confirmed && (file.outcomeUnknown || file.reconciling))) &&
        file.original &&
        !queue().has(file.id),
    );
    const next = pending.map((file) => ({
      ...file,
      ...(file.remoteId
        ? { id: crypto.randomUUID(), remoteId: undefined, key: undefined, createdAt: Date.now() }
        : {}),
      status: 'queued',
      progress: 0,
      error: null,
      retryable: true,
      reconciling: false,
      outcomeUnknown: false,
      uploadState: null,
      scanStatus: file.mode === 'demo' ? 'unknown' : 'not_started',
      updatedAt: undefined,
      statusSource: undefined,
      syncError: null,
      trackingExpired: false,
    }));
    setEntries((current) => [
      ...next.filter((file) => !current.some((old) => old.id === file.id)),
      ...current.map((file) => next.find((item) => item.id === file.id) || file),
    ]);
    queue().enqueue(next);
  }
  function requestRetry(id) {
    const file = entriesRef.current.find(
      (file) => file.id === id && file.scope === scope && file.original,
    );
    if (file) setRetryConfirmation(file);
  }
  function star(ids, value) {
    setEntries((current) =>
      current.map((file) =>
        ids.includes(file.id) ? { ...file, starred: value ?? !file.starred } : file,
      ),
    );
    // Store presentation flags separately, never a stale copy of server metadata.
    setServerStars((current) => {
      const next = new Map(current);
      for (const id of ids) {
        const file = files.find((file) => file.id === id);
        if (file && !file.original)
          next.set(`${file.scope}|${file.remoteId}`, value ?? !file.starred);
      }
      return next;
    });
  }
  function remove(ids) {
    const removed = entriesRef.current.filter(
      (file) => file.scope === scope && ids.includes(file.id) && file.original && !isBusy(file),
    );
    if (!removed.length) return;
    const state = {
      scope,
      items: [...(undoRef.current?.scope === scope ? undoRef.current.items : []), ...removed],
    };
    undoRef.current = state;
    setUndo(state);
    setEntries((current) => current.filter((file) => !removed.includes(file)));
  }
  function restore() {
    if (undoRef.current?.scope === scope)
      setEntries((current) =>
        [...undoRef.current.items, ...current].sort((a, b) => b.createdAt - a.createdAt),
      );
    undoRef.current = null;
    setUndo(null);
    notify('Đã khôi phục các tệp vào lịch sử');
  }
  function saveConnection(value) {
    if (entriesRef.current.some(isBusy) || duplicateRef.current) {
      notify('Chờ hoặc hủy các tệp đang tải trước khi đổi kết nối');
      return false;
    }
    const next = {
      ...value,
      baseUrl: value.mode === 'api' ? validateApiBaseUrl(value.baseUrl) : value.baseUrl,
    };
    if (connectionScope(next) !== scope) setHealth(null);
    setPreferences((current) => ({ ...current, ...next }));
    notify('Đã lưu kết nối');
    return true;
  }
  function recheck(id) {
    const file = files.find((file) => file.id === id);
    if (file) remote.recheckFile(file);
  }

  return (
    <Context.Provider
      value={{
        files,
        activityFiles: activityFiles.filter((file) => file.original),
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
        requestRetry,
        star,
        remove,
        notify,
        notice,
        setNotice,
        undo: undoState?.scope === scope ? undoState.items : null,
        restore,
        duplicates,
        resolveDuplicates,
        saveConnection,
        storageFailed,
        online,
        sync: remote.sync,
        refreshFiles: remote.refreshFiles,
        recheck,
        inspectedId,
        inspect,
        notifications: notifications.notifications,
        toasts: notifications.toasts,
        markRead: notifications.markRead,
        dismissToast: notifications.dismissToast,
      }}
    >
      {children}
      {retryConfirmation && (
        <Modal title="Tải lại có thể tạo bản sao" onClose={() => setRetryConfirmation(null)}>
          <p>
            Chưa biết chắc máy chủ đã lưu tệp “{retryConfirmation.name}” hay chưa. Hãy kiểm tra kết
            quả trước khi gửi lại. Một lần upload mới có thể tạo thêm bản sao.
          </p>
          <div className="modal-footer">
            <button className="button secondary" onClick={() => setRetryConfirmation(null)}>
              Để sau
            </button>
            <button
              className="button primary"
              onClick={() => {
                retry([retryConfirmation.id], true);
                setRetryConfirmation(null);
              }}
            >
              Vẫn tải lại
            </button>
          </div>
        </Modal>
      )}
    </Context.Provider>
  );
}
export function useWorkspace() {
  return useContext(Context);
}
