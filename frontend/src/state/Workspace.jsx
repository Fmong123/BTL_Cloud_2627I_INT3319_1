import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  demoUpload,
  uploadFile,
  validateApiBaseUrl,
  getFileContent,
  changeFile,
} from '../api/client.js';
import { MB, UPLOAD_LIMIT, validateFile } from '../utils/files.js';
import {
  canRetry,
  fileFingerprint,
  isBusy,
  readPreferences,
  savePreferences,
  uiPreferenceDefaults,
} from '../utils/workspace.js';
import { isAttention, mergeServerFiles, scanStates, needsTracking } from '../utils/processing.js';
import { UploadQueue } from '../utils/uploadQueue.js';
import { useRemoteLibrary } from './useRemoteLibrary.js';
import { useNotifications } from './useNotifications.js';
import { usePersistentStars } from './usePersistentStars.js';
import { useStorageQuota } from './useStorageQuota.js';
import { useUploadHistory } from './useUploadHistory.js';
import { HISTORY_KEY, historySnapshot, readHistory, writeRecords } from '../utils/persistence.js';
import { canReadContent, previewInfo, downloadBlockReason } from '../utils/content.js';
import { saveFile } from '../utils/saveFile.js';
import Modal from '../components/Modal.jsx';

const Context = createContext(null);
const configuredSize = Number(import.meta.env.VITE_MAX_FILE_SIZE_MB || 100);
const defaultLimit = Math.min(
  UPLOAD_LIMIT,
  (Number.isFinite(configuredSize) && configuredSize > 0 ? configuredSize : 100) * MB,
);
export const defaultPreferences = {
  ...uiPreferenceDefaults,
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
  const [entries, renderEntries] = useState(readHistory);
  const entriesRef = useRef(entries);
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
  const [inspection, setInspection] = useState({ id: null, tab: 'information' });
  const { id: inspectedId, tab: inspectedTab } = inspection;
  const [previewId, setPreviewId] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);
  const downloadRequest = useRef(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const [historyStorageFailed, setHistoryStorageFailed] = useState(false);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [fileDialog, setFileDialog] = useState(null);
  const [dialogValue, setDialogValue] = useState('');
  const [dialogError, setDialogError] = useState(null);
  const [changingFiles, setChangingFiles] = useState(false);
  const changeLock = useRef(false);
  const [online, setOnline] = useState(navigator.onLine);
  const mounted = useRef(true);
  const inputRef = useRef(null);
  const scheduler = useRef(null);
  const callbacks = useRef(null);
  const identities = useRef(
    new Map(
      entries
        .filter((file) => file.remoteId)
        .map((file) => [`${file.scope}|${file.remoteId}`, file.id]),
    ),
  );
  const activityAvailable =
    preferences.mode === 'api' &&
    health?.capabilities?.persistent_activity === true &&
    connectionScope({ mode: 'api', baseUrl: health.baseUrl }) === scope;
  const notifications = useNotifications(scope, {
    baseUrl: preferences.baseUrl,
    available: activityAvailable,
  });
  const notificationsRef = useRef(notifications);
  notificationsRef.current = notifications;
  const busy = entries.some(isBusy);
  const limit = Math.min(
    UPLOAD_LIMIT,
    preferences.mode === 'api' && health?.baseUrl === preferences.baseUrl
      ? health.max_file_size_bytes
      : defaultLimit,
  );

  function inspect(id, tab = 'information') {
    setInspection({ id, tab });
  }

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
      fileId: record.remoteId || fileId,
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
  const archived = useUploadHistory({
    scope,
    baseUrl: preferences.baseUrl,
    available: activityAvailable,
    revision: historyRevision,
  });
  useEffect(() => {
    if (!archived.items.length) return;
    setEntries((current) =>
      mergeServerFiles(
        current,
        archived.items.filter((record) =>
          current.some((file) => file.scope === record.scope && file.remoteId === record.remoteId),
        ),
      ),
    );
  }, [archived.items]);
  const localFiles = entries.filter((file) => file.scope === scope);
  const serverFiles = remote.records
    .filter((file) => file.scope === scope)
    .map((file) => ({ ...file, id: stableId(file) }));
  const baseFiles = useMemo(
    () => mergeServerFiles(mergeServerFiles(localFiles, serverFiles), archived.items),
    [entries, remote.records, archived.items, scope],
  );
  const currentHealth =
    health && connectionScope({ mode: 'api', baseUrl: health.baseUrl }) === scope ? health : null;
  const favoritesAvailable =
    preferences.mode === 'api' && currentHealth?.capabilities?.persistent_favorites === true;
  const contentAvailable =
    preferences.mode === 'api' && currentHealth?.capabilities?.file_content === true;
  const stars = usePersistentStars({
    files: baseFiles,
    scope,
    available: favoritesAvailable,
    notify,
    onApply(patch) {
      setEntries((current) => mergeServerFiles(current, [patch]));
      if (patch.scope === scopeRef.current) remoteRef.current.applyPreferences(patch);
    },
  });
  const allFiles = baseFiles.map(stars.decorate);
  const files = allFiles.filter((file) => !file.lifecycleState || file.lifecycleState === 'active');
  const trashFiles = allFiles.filter((file) =>
    ['trashed', 'deleting'].includes(file.lifecycleState),
  );
  const lifecycleAvailable =
    preferences.mode === 'demo' || currentHealth?.capabilities?.file_lifecycle === true;
  const quotaAvailable =
    preferences.mode === 'api' && currentHealth?.capabilities?.storage_quota === true;
  const storageQuota = useStorageQuota({
    scope,
    baseUrl: preferences.baseUrl,
    available: quotaAvailable,
    files: allFiles,
  });
  const scanReportAvailable =
    preferences.mode === 'api' && currentHealth?.capabilities?.scan_report === true;
  const rescanAvailable =
    preferences.mode === 'api' && currentHealth?.capabilities?.rescan === true;
  useEffect(() => {
    if (!downloadingId || !downloadRequest.current) return;
    const file = files.find((item) => item.id === downloadingId);
    if (!contentAvailable || !canReadContent(file)) {
      downloadRequest.current.abort();
      notify('Trạng thái tệp đã đổi, đã dừng đọc nội dung');
    }
  }, [files, downloadingId, contentAvailable]);
  const activityFiles = allFiles;

  useEffect(() => {
    const timer = setTimeout(
      () => setHistoryStorageFailed(!writeRecords(HISTORY_KEY, historySnapshot(entries))),
      150,
    );
    return () => clearTimeout(timer);
  }, [entries]);
  useEffect(() => {
    const flush = () => writeRecords(HISTORY_KEY, historySnapshot(entriesRef.current));
    const cleanDemo = () => {
      const now = Date.now();
      if (
        entriesRef.current.some(
          (file) =>
            file.mode === 'demo' && file.lifecycleState === 'trashed' && file.trashExpiresAt <= now,
        )
      )
        setEntries((current) =>
          current.map((file) =>
            file.mode === 'demo' && file.lifecycleState === 'trashed' && file.trashExpiresAt <= now
              ? { ...file, lifecycleState: 'purged', lifecycleUpdatedAt: now }
              : file,
          ),
        );
    };
    cleanDemo();
    const timer = setInterval(cleanDemo, 60000);
    window.addEventListener('pagehide', flush);
    return () => {
      clearInterval(timer);
      window.removeEventListener('pagehide', flush);
    };
  }, []);

  useEffect(() => {
    setStorageFailed(!savePreferences(preferences));
  }, [preferences]);
  useEffect(() => {
    inspect(null);
    setPreviewId(null);
    downloadRequest.current?.abort();
    setRetryConfirmation(null);
    setFileDialog(null);
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
      downloadRequest.current?.abort();
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
        fileId: result.id || item.id,
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
          title: patch.status === 'unknown' ? 'Cần đối soát kết quả tải lên' : 'Chưa tải được tệp',
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
    batch = { id: crypto.randomUUID(), createdAt: Date.now() },
  ) {
    const targetScope = connectionScope(connection);
    const next = selected.map((original) => {
      const error = validateFile(original, maxBytes);
      return {
        id: crypto.randomUUID(),
        batchId: batch.id,
        batchFileId: crypto.randomUUID(),
        batchCreatedAt: batch.createdAt,
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
    const batch = { id: crypto.randomUUID(), createdAt: Date.now() };
    if (fresh.length) enqueue(fresh, undefined, limit, batch);
    if (repeated.length) {
      duplicateRef.current = {
        connection: { mode: preferences.mode, baseUrl: preferences.baseUrl },
        limit,
        batch,
      };
      setDuplicates(repeated);
    }
  }
  function resolveDuplicates(keep) {
    if (keep && duplicateRef.current)
      enqueue(
        duplicates,
        duplicateRef.current.connection,
        duplicateRef.current.limit,
        duplicateRef.current.batch,
      );
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
    if (preferences.mode === 'api') {
      stars.star(ids, value);
      return;
    }
    setEntries((current) =>
      current.map((file) =>
        ids.includes(file.id) ? { ...file, starred: value ?? !file.starred } : file,
      ),
    );
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
  function requestFileChange(action, ids) {
    const source = action === 'restore' || action === 'purge' ? trashFiles : files;
    const targets = source.filter((file) => ids.includes(file.id));
    if (!targets.length || changeLock.current) return;
    setFileDialog({ action, targets, scope });
    setDialogValue(targets[0].name);
    setDialogError(null);
  }
  function canManage(file) {
    return (
      lifecycleAvailable &&
      !changingFiles &&
      file.lifecycleState !== 'purged' &&
      !isBusy(file) &&
      (file.mode === 'demo' || Boolean(file.remoteId))
    );
  }
  async function submitFileChange(event) {
    event.preventDefault();
    if (changeLock.current || !fileDialog || fileDialog.scope !== scopeRef.current) return;
    changeLock.current = true;
    setChangingFiles(true);
    setDialogError(null);
    const { action, targets, scope: targetScope } = fileDialog;
    const errors = [];
    const failedIds = new Set();
    let succeeded = 0;
    try {
      for (const file of targets) {
        try {
          let patch;
          if (file.mode === 'demo') {
            const now = Date.now();
            if (action === 'name') {
              const name = dialogValue.trim();
              if (
                !name ||
                name.length > 255 ||
                /[\\/:*?"<>|\x00-\x1f]/.test(name) ||
                name === '.' ||
                name === '..' ||
                name.endsWith('.')
              )
                throw new Error('Tên tệp không hợp lệ');
              patch = { ...file, name, nameUpdatedAt: now };
            } else if (action === 'trash')
              patch = {
                ...file,
                lifecycleState: 'trashed',
                trashedAt: now,
                trashExpiresAt: now + 30 * 86400000,
                lifecycleUpdatedAt: now,
              };
            else if (action === 'restore') {
              if (file.trashExpiresAt <= now) throw new Error('Tệp đã hết thời hạn khôi phục');
              patch = { ...file, lifecycleState: 'active', lifecycleUpdatedAt: now };
            } else patch = { ...file, lifecycleState: 'purged', lifecycleUpdatedAt: now };
          } else {
            patch = await changeFile(
              file.connection.baseUrl,
              file.remoteId,
              action,
              action === 'name' ? { name: dialogValue } : undefined,
            );
            if (action === 'purge')
              patch = { ...file, lifecycleState: 'purged', lifecycleUpdatedAt: Date.now() };
          }
          patch = { ...patch, id: file.id, scope: targetScope, connection: file.connection };
          if (action === 'purge') patch.original = undefined;
          setEntries((current) =>
            current.some((item) => item.id === file.id && item.scope === targetScope)
              ? current.map((item) =>
                  item.id === file.id && item.scope === targetScope ? { ...item, ...patch } : item,
                )
              : [patch, ...current],
          );
          if (targetScope === scopeRef.current) {
            if (action === 'purge') remoteRef.current.removeFile(file.remoteId);
            else remoteRef.current.applyPreferences(patch);
            inspect(null);
          }
          notificationsRef.current.addEvent({
            scope: targetScope,
            kind: `file-${action}`,
            fileId: file.remoteId || file.id,
            title: {
              name: 'Đã đổi tên tệp',
              trash: 'Đã chuyển vào Thùng rác',
              restore: 'Đã khôi phục tệp',
              purge: 'Đã xóa vĩnh viễn',
            }[action],
            message: action === 'name' ? patch.name : file.name,
            tone: 'success',
          });
          succeeded++;
        } catch (error) {
          failedIds.add(file.id);
          errors.push(`${file.name}: ${error.message}`);
        }
      }
      if (mounted.current && targetScope === scopeRef.current) {
        setHistoryRevision((value) => value + 1);
        remoteRef.current.refreshFiles();
        if (errors.length) {
          setFileDialog((prior) =>
            prior
              ? { ...prior, targets: prior.targets.filter((file) => failedIds.has(file.id)) }
              : null,
          );
          setDialogError(
            `${succeeded ? `${succeeded} tệp thành công. ` : ''}${errors.join(' · ')}`,
          );
        } else {
          setFileDialog(null);
          notify(`Đã xử lý ${succeeded} tệp`);
        }
      }
    } finally {
      changeLock.current = false;
      if (mounted.current) setChangingFiles(false);
    }
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
    if (file) remote.recheckFile(file, { manual: true });
  }
  function preview(id) {
    inspect(null);
    setPreviewId(id);
  }
  function openFile(id) {
    const file = files.find((item) => item.id === id);
    if (contentAvailable && previewInfo(file).kind) preview(id);
    else inspect(id);
  }
  async function download(id) {
    const file = files.find((item) => item.id === id);
    const blocked = downloadBlockReason(file, { contentAvailable, downloadingId });
    if (blocked) {
      notify(blocked);
      return;
    }
    if (downloadRequest.current) {
      notify('Đang chuẩn bị một tệp khác');
      return;
    }
    const controller = new AbortController();
    const targetScope = scope;
    downloadRequest.current = controller;
    setDownloadingId(id);
    try {
      const result = await saveFile(
        file.name,
        () =>
          getFileContent(file.connection.baseUrl, file.remoteId, {
            mode: 'download',
            signal: controller.signal,
          }),
        { signal: controller.signal },
      );
      if (controller.signal.aborted || targetScope !== scopeRef.current || !mounted.current) return;
      notify(result === 'saved' ? 'Đã lưu tệp vào thư mục đã chọn' : 'Đã bắt đầu tải xuống');
    } catch (error) {
      if (!controller.signal.aborted && mounted.current && targetScope === scopeRef.current) {
        let message = error.message;
        if (error.name === 'AbortError') message = 'Đã hủy tải xuống';
        else if (['NotAllowedError', 'SecurityError'].includes(error.name))
          message =
            'Trình duyệt chưa cho phép lưu tệp. Hãy chọn thư mục khác hoặc kiểm tra quyền lưu.';
        else if (error.name === 'QuotaExceededError')
          message = 'Ổ đĩa không đủ dung lượng để lưu tệp.';
        notify(message);
      }
    } finally {
      if (downloadRequest.current === controller) {
        downloadRequest.current = null;
        if (mounted.current) setDownloadingId(null);
      }
    }
  }
  const batchMap = new Map();
  for (const file of activityFiles) {
    const id = file.batchId || file.id;
    if (!batchMap.has(id))
      batchMap.set(id, { id, createdAt: file.batchCreatedAt || file.createdAt, files: [] });
    batchMap.get(id).files.push(file);
  }
  const uploadBatches = [...batchMap.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((batch) => {
      const latest = new Map();
      for (const file of batch.files) {
        const key = file.batchFileId || file.id;
        if (!latest.has(key) || latest.get(key).createdAt < file.createdAt) latest.set(key, file);
      }
      return { ...batch, files: [...latest.values()] };
    })
    .map((batch) => ({
      ...batch,
      total: batch.files.length,
      uploaded: batch.files.filter((file) => file.status === 'success').length,
      active: batch.files.filter(isBusy).length,
      failed: batch.files.filter((file) => file.status === 'error').length,
      cancelled: batch.files.filter((file) => file.status === 'cancelled').length,
      uncertain: batch.files.filter((file) => file.status === 'unknown').length,
      tracking: batch.files.filter(needsTracking).length,
      retryableIds: batch.files.filter(canRetry).map((file) => file.id),
    }));

  return (
    <Context.Provider
      value={{
        files,
        allFiles,
        trashFiles,
        activityFiles,
        historyError: archived.error,
        lifecycleAvailable,
        canManage,
        requestFileChange,
        changingFiles,
        notificationStorageError: notifications.storageError,
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
        scope,
        canStar: (file) =>
          file.lifecycleState !== 'purged' &&
          (file.mode === 'demo' ||
            (favoritesAvailable && Boolean(file.remoteId) && !file.starPending)),
        favoritesAvailable,
        contentAvailable,
        quotaAvailable,
        storageQuota,
        scanReportAvailable,
        rescanAvailable,
        applyScanStatus: (file, patch) => {
          const record = { ...patch, scope: file.scope };
          setEntries((current) => mergeServerFiles(current, [record]));
          remoteRef.current.applyPreferences(record);
          remoteRef.current.recheckFile({ ...file, ...patch });
        },
        previewId,
        preview,
        openFile,
        closePreview: () => setPreviewId(null),
        download,
        downloadingId,
        uploadBatches,
        retryBatch: (id) =>
          retry(uploadBatches.find((batch) => batch.id === id)?.retryableIds || []),
        remove,
        notify,
        notice,
        setNotice,
        undo: undoState?.scope === scope ? undoState.items : null,
        restore,
        duplicates,
        resolveDuplicates,
        saveConnection,
        storageFailed: storageFailed || historyStorageFailed,
        online,
        sync: remote.sync,
        statusChecks: remote.statusChecks,
        refreshFiles: () => {
          setHistoryRevision((value) => value + 1);
          remote.refreshFiles();
        },
        recheck,
        inspectedId,
        inspectedTab,
        inspection,
        inspect,
        notifications: notifications.notifications,
        toasts: notifications.toasts,
        markRead: notifications.markRead,
        dismissToast: notifications.dismissToast,
      }}
    >
      {children}
      {fileDialog && (
        <Modal
          title={
            {
              name: 'Đổi tên tệp',
              trash: 'Chuyển vào Thùng rác',
              restore: 'Khôi phục tệp',
              purge: 'Xóa vĩnh viễn',
            }[fileDialog.action]
          }
          onClose={() => {
            if (!changingFiles) setFileDialog(null);
          }}
        >
          <form onSubmit={submitFileChange}>
            {fileDialog.action === 'name' ? (
              <label className="rename-field">
                Tên tệp
                <input
                  autoFocus
                  required
                  maxLength={255}
                  value={dialogValue}
                  disabled={changingFiles}
                  onChange={(event) => setDialogValue(event.target.value)}
                />
              </label>
            ) : (
              <p>
                {fileDialog.targets.length} tệp được chọn.{' '}
                {fileDialog.action === 'trash'
                  ? 'Có thể khôi phục trong 30 ngày. Tệp vẫn tính vào dung lượng 1 GB.'
                  : fileDialog.action === 'restore'
                    ? 'Giữ nguyên kết quả quét và trạng thái cách ly.'
                    : 'Xóa toàn bộ nội dung và các phiên bản đã lưu. Không thể hoàn tác.'}
              </p>
            )}
            {dialogError && (
              <p className="banner error" role="alert">
                {dialogError}
              </p>
            )}
            <div className="modal-footer">
              <button
                type="button"
                className="button secondary"
                disabled={changingFiles}
                onClick={() => setFileDialog(null)}
              >
                Hủy
              </button>
              <button
                className={`button ${fileDialog.action === 'purge' ? 'danger' : 'primary'}`}
                disabled={changingFiles}
              >
                {changingFiles
                  ? 'Đang xử lý…'
                  : {
                      name: 'Lưu tên',
                      trash: 'Chuyển vào Thùng rác',
                      restore: 'Khôi phục',
                      purge: 'Xóa vĩnh viễn',
                    }[fileDialog.action]}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {retryConfirmation && (
        <Modal title="Tải lại có thể tạo bản sao" onClose={() => setRetryConfirmation(null)}>
          <p>
            Chưa biết chắc máy chủ đã lưu tệp “{retryConfirmation.name}” hay chưa. Hãy kiểm tra kết
            quả trước khi gửi lại. Một lần tải lên mới có thể tạo thêm bản sao.
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
