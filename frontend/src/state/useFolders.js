import { useCallback, useEffect, useState } from 'react';
import { listFolders } from '../api/client.js';

export function folderPath(items, id) {
  const result = [],
    seen = new Set();
  while (id && !seen.has(id)) {
    seen.add(id);
    const item = items.find((folder) => folder.id === id);
    if (!item) break;
    result.unshift(item);
    id = item.parent_id;
  }
  return result;
}

export function useFolders({ baseUrl, scope, available }) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ scope: null, items: [], loading: true, error: null });
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!available) return;
    const controller = new AbortController();
    setState((prior) => ({
      scope,
      items: prior.scope === scope ? prior.items : [],
      loading: true,
      error: null,
    }));
    listFolders(baseUrl, controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) setState({ scope, items, loading: false, error: null });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState((prior) => ({ ...prior, loading: false, error: error.message }));
      });
    return () => controller.abort();
  }, [baseUrl, scope, available, revision]);
  useEffect(() => {
    if (!available) return;
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [available, refresh]);
  const current = state.scope === scope ? state : { items: [], loading: available, error: null };
  return {
    ...current,
    available,
    refresh,
    active: current.items.filter(
      (item) => !item.lifecycle_state || item.lifecycle_state === 'active',
    ),
    trash: current.items.filter(
      (item) => item.lifecycle_state === 'trashed' && item.trash_root_id === item.id,
    ),
  };
}
