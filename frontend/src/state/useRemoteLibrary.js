import { useEffect, useRef, useState } from 'react';
import { checkHealth, getFileStatus, listFiles } from '../api/client.js';
import { mergeServerFiles, needsTracking } from '../utils/processing.js';

const emptySync = { phase: 'idle', loaded: 0, lastSyncedAt: null, error: null, skippedItems: [] };

// One coordinator per active connection; never one poller per mounted page.
export function useRemoteLibrary({
  scope,
  preferences,
  localFiles,
  onHealth,
  onTransition,
  onRecord,
  onSyncError,
}) {
  const [records, setRecords] = useState([]);
  const [sync, setSync] = useState(emptySync);
  const [checks, setChecks] = useState({ scope, items: {} });
  const inputs = useRef(null);
  inputs.current = { localFiles, onHealth, onTransition, onRecord, onSyncError };
  const methods = useRef({ refresh() {}, recheck() {}, seed() {}, preferences() {} });
  const cache = useRef(new Map());

  useEffect(() => {
    let alive = true;
    let library = cache.current.get(scope)?.records || [];
    let state = { ...emptySync, ...cache.current.get(scope)?.sync };
    let initialized = Boolean(state.lastSyncedAt);
    let enabled = null;
    let loading = false;
    let lastRefresh = 0;
    let refreshRetryAt = 0;
    let refreshFailures = 0;
    let outageNotified = false;
    let pausedAt = document.hidden || !navigator.onLine ? Date.now() : null;
    const controllers = new Set();
    const tracking = new Map();
    const sessionIds = new Set();
    const removedIds = new Set();
    const statusActive = new Map();
    const manualChecks = new Set();
    const connection = { mode: preferences.mode, baseUrl: preferences.baseUrl };
    setRecords(library);
    setSync(state);
    setChecks({ scope, items: {} });

    function checkFeedback(id, result) {
      if (alive)
        setChecks((previous) => ({
          scope,
          items: { ...(previous.scope === scope ? previous.items : {}), [id]: result },
        }));
    }
    function finishCheck(id, result) {
      if (!manualChecks.delete(id)) return;
      checkFeedback(id, result);
    }

    function emitSync(patch) {
      if (!alive) return;
      state = { ...state, ...patch, loaded: library.length };
      setSync(state);
      cache.current.set(scope, { records: library, sync: state });
    }
    function scoped(records) {
      return records.map((record) => ({ ...record, scope, connection }));
    }
    function publish(incoming, { replace = false, announce = true } = {}) {
      if (!alive) return;
      const previous = library;
      library = mergeServerFiles(
        library,
        scoped(incoming.filter((file) => !removedIds.has(file.remoteId))),
        { replace },
      );
      setRecords(library);
      for (const record of library) {
        const prior =
          previous.find((item) => item.remoteId === record.remoteId) ||
          inputs.current.localFiles.find(
            (item) => item.scope === scope && item.remoteId === record.remoteId,
          );
        if (record === prior) continue;
        inputs.current.onRecord?.(record);
        if (announce && (initialized || sessionIds.has(record.remoteId) || prior))
          inputs.current.onTransition?.(record, prior);
      }
      cache.current.set(scope, { records: library, sync: { ...state, loaded: library.length } });
    }
    function controller() {
      const item = new AbortController();
      controllers.add(item);
      return item;
    }
    function usable() {
      return alive && !document.hidden && navigator.onLine;
    }
    async function refresh() {
      if (!usable() || loading || connection.mode !== 'api') return;
      loading = true;
      lastRefresh = Date.now();
      const request = controller();
      emitSync({ phase: library.length ? 'partial' : 'loading', error: null });
      try {
        const health = await checkHealth(connection.baseUrl, { signal: request.signal });
        if (!alive) return;
        inputs.current.onHealth?.(health);
        if (health.metadata_mode === 'disabled') {
          enabled = false;
          refreshRetryAt = 0;
          refreshFailures = 0;
          outageNotified = false;
          library = [];
          setRecords([]);
          emitSync({ phase: 'disabled', error: null, lastSyncedAt: null, skippedItems: [] });
          return;
        }
        enabled = true;
        const accumulated = [];
        const skippedItems = [];
        const seen = new Set();
        let cursor;
        do {
          if (!usable()) {
            emitSync({ phase: 'partial' });
            return;
          }
          const page = await listFiles(connection.baseUrl, {
            area: health.capabilities?.file_lifecycle ? 'all' : undefined,
            cursor,
            limit: 100,
            signal: request.signal,
          });
          if (!alive) return;
          accumulated.push(...page.items);
          skippedItems.push(...page.skippedItems);
          publish(page.items);
          emitSync({ phase: 'partial', skippedItems: [...skippedItems] });
          cursor = page.nextCursor;
          if (cursor && seen.has(cursor))
            throw new Error('Máy chủ trả cursor lặp lại — danh sách chưa được tải đầy đủ');
          if (cursor) seen.add(cursor);
        } while (cursor);
        publish(accumulated, { replace: true, announce: false });
        initialized = true;
        outageNotified = false;
        refreshFailures = 0;
        refreshRetryAt = 0;
        emitSync({ phase: 'ready', error: null, lastSyncedAt: Date.now() });
      } catch (error) {
        if (!alive || error.name === 'AbortError') return;
        emitSync({ phase: 'error', error: error.message });
        refreshRetryAt = Date.now() + Math.min(30000, 5000 * 2 ** refreshFailures++);
        if (!outageNotified) inputs.current.onSyncError?.(error.message);
        outageNotified = true;
      } finally {
        controllers.delete(request);
        loading = false;
      }
    }

    function currentCandidates() {
      const locals = inputs.current.localFiles.filter(
        (file) => file.scope === scope && file.remoteId,
      );
      return mergeServerFiles(locals, library);
    }
    function remember(file, force = false) {
      const current = tracking.get(file.remoteId);
      if (!current || force)
        tracking.set(file.remoteId, {
          startedAt: Date.now(),
          nextAt: Date.now(),
          failures: 0,
          expired: false,
        });
    }
    async function fetchStatus(file) {
      const entry = tracking.get(file.remoteId);
      const request = controller();
      statusActive.set(file.remoteId, request);
      try {
        const patch = await getFileStatus(connection.baseUrl, String(file.remoteId), {
          signal: request.signal,
        });
        if (!alive) return;
        const previous = library.find((record) => record.remoteId === file.remoteId) || file;
        publish([{ ...previous, ...patch, syncError: null, trackingExpired: false }]);
        // A local attempt may exist before a corresponding list row arrives.
        inputs.current.onRecord?.({
          ...file,
          ...patch,
          scope,
          syncError: null,
          trackingExpired: false,
        });
        entry.failures = 0;
        entry.nextAt = Date.now() + (Date.now() - entry.startedAt < 60000 ? 3000 : 10000);
        const changed =
          [
            'scanStatus',
            'uploadState',
            'findingsCount',
            'statusReason',
            'scannedAt',
            'quarantinedAt',
          ].some((key) => previous[key] !== patch[key]) ||
          JSON.stringify(previous.findingTypes) !== JSON.stringify(patch.findingTypes);
        finishCheck(
          file.remoteId,
          patch.updatedAt < previous.updatedAt
            ? { phase: 'error', error: 'Máy chủ trả dữ liệu cũ — hãy thử lại.' }
            : { phase: 'success', checkedAt: Date.now(), changed },
        );
      } catch (error) {
        if (!alive || error.name === 'AbortError') return;
        entry.nextAt = Date.now() + Math.min(30000, 5000 * 2 ** entry.failures++);
        const patch = {
          ...file,
          scope,
          syncError:
            error.status === 404
              ? 'Chưa tìm thấy metadata của tệp — chưa thể xác nhận kết quả'
              : error.message,
        };
        publish([patch], { announce: false });
        inputs.current.onRecord?.(patch);
        finishCheck(file.remoteId, { phase: 'error', error: patch.syncError });
      } finally {
        controllers.delete(request);
        statusActive.delete(file.remoteId);
      }
    }
    function tick() {
      if (!usable() || connection.mode !== 'api') return;
      const now = Date.now();
      if (
        !loading &&
        (refreshRetryAt ? now >= refreshRetryAt : enabled !== false && now - lastRefresh >= 30000)
      )
        void refresh();
      if (enabled === false) return;
      const candidates = currentCandidates().sort(
        (a, b) => Number(manualChecks.has(b.remoteId)) - Number(manualChecks.has(a.remoteId)),
      );
      for (const file of candidates) {
        if (!needsTracking(file) && !tracking.get(file.remoteId)?.forced) continue;
        remember(file);
        const entry = tracking.get(file.remoteId);
        if (entry.expired || statusActive.has(file.remoteId)) continue;
        if (now - entry.startedAt >= 600000) {
          entry.expired = true;
          finishCheck(file.remoteId, {
            phase: 'error',
            error: 'Đã hết thời gian chờ — hãy thử lại.',
          });
          const patch = { ...file, trackingExpired: true };
          publish([patch], { announce: false });
          inputs.current.onRecord?.(patch);
          continue;
        }
        if (entry.nextAt <= now && statusActive.size < 4) {
          entry.forced = false;
          void fetchStatus(file);
        }
      }
    }
    function resume() {
      if (!usable()) {
        pausedAt ??= Date.now();
        return;
      }
      if (pausedAt !== null) {
        const elapsed = Date.now() - pausedAt;
        tracking.forEach((entry) => {
          entry.startedAt += elapsed;
          entry.nextAt = Date.now();
        });
        pausedAt = null;
      }
      if (connection.mode === 'api') {
        void refresh();
        tick();
      }
    }
    methods.current = {
      refresh,
      preferences(patch) {
        if (patch.scope === scope) publish([patch], { announce: false });
      },
      remove(id) {
        removedIds.add(id);
        library = library.filter((file) => file.remoteId !== id);
        setRecords(library);
        tracking.delete(id);
        cache.current.set(scope, { records: library, sync: state });
      },
      recheck(file, { manual = false } = {}) {
        if (!file?.remoteId || file.scope !== scope) return;
        if (manual) {
          if (manualChecks.has(file.remoteId)) return;
          if (!navigator.onLine || enabled === false) {
            checkFeedback(file.remoteId, {
              phase: 'error',
              error: !navigator.onLine
                ? 'Đang ngoại tuyến — hãy kết nối mạng rồi thử lại.'
                : 'Máy chủ chưa bật chức năng đọc trạng thái.',
            });
            return;
          }
          manualChecks.add(file.remoteId);
          checkFeedback(file.remoteId, { phase: 'checking' });
          // Join a current poll instead of starting a duplicate request.
          if (statusActive.has(file.remoteId)) return;
        }
        remember(file, true);
        tracking.get(file.remoteId).forced = true;
        tick();
      },
      seed(file) {
        if (file.scope !== scope || !file.remoteId || enabled === false) return;
        sessionIds.add(file.remoteId);
        publish([{ ...file, updatedAt: file.updatedAt || 0, statusSource: 'upload' }], {
          announce: false,
        });
        remember(file);
        tick();
      },
    };
    const interval = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    window.addEventListener('offline', resume);
    if (connection.mode === 'api') {
      void refresh();
    } else {
      library = [];
      setRecords([]);
      emitSync({ ...emptySync });
    }
    return () => {
      alive = false;
      clearInterval(interval);
      controllers.forEach((request) => request.abort());
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', resume);
      methods.current = { refresh() {}, recheck() {}, seed() {}, preferences() {} };
    };
  }, [scope]);

  return {
    records,
    sync,
    statusChecks: checks.scope === scope ? checks.items : {},
    refreshFiles: () => methods.current.refresh(),
    recheckFile: (file, options) => methods.current.recheck(file, options),
    seedFile: (file) => methods.current.seed(file),
    applyPreferences: (patch) => methods.current.preferences(patch),
    removeFile: (id) => methods.current.remove?.(id),
  };
}
