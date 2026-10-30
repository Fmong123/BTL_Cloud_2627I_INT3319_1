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
    const statusActive = new Map();
    const connection = { mode: preferences.mode, baseUrl: preferences.baseUrl };
    setRecords(library);
    setSync(state);

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
      library = mergeServerFiles(library, scoped(incoming), { replace });
      setRecords(library);
      for (const record of library) {
        const prior = previous.find((item) => item.remoteId === record.remoteId);
        if (record === prior) continue;
        inputs.current.onRecord?.(record);
        if (announce && (initialized || sessionIds.has(record.remoteId)))
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
      for (const file of currentCandidates()) {
        if (!needsTracking(file) && !tracking.get(file.remoteId)?.forced) continue;
        remember(file);
        const entry = tracking.get(file.remoteId);
        if (entry.expired || statusActive.has(file.remoteId)) continue;
        if (now - entry.startedAt >= 600000) {
          entry.expired = true;
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
      recheck(file) {
        if (!file?.remoteId || file.scope !== scope) return;
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
    refreshFiles: () => methods.current.refresh(),
    recheckFile: (file) => methods.current.recheck(file),
    seedFile: (file) => methods.current.seed(file),
    applyPreferences: (patch) => methods.current.preferences(patch),
  };
}
