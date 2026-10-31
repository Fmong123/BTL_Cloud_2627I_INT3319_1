import { useEffect, useState } from 'react';
import { getStorageUsage } from '../api/client.js';

export function useStorageQuota({ scope, baseUrl, available, files }) {
  const [state, setState] = useState(null);
  const revision = files
    .map(
      (file) => `${file.id}:${file.status}:${file.uploadState}:${file.lifecycleState || 'active'}`,
    )
    .join('|');
  useEffect(() => {
    if (!available) return;
    let alive = true;
    let active = null;
    async function refresh() {
      if (!navigator.onLine || document.hidden || active) return;
      active = new AbortController();
      try {
        const usage = await getStorageUsage(baseUrl, { signal: active.signal });
        if (alive) setState({ ...usage, scope, error: null });
      } catch (error) {
        if (alive && error.name !== 'AbortError')
          setState((prior) => ({
            ...(prior?.scope === scope ? prior : {}),
            scope,
            error: error.message,
          }));
      } finally {
        active = null;
      }
    }
    void refresh();
    const timer = setInterval(refresh, 30000);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      alive = false;
      active?.abort();
      clearInterval(timer);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [scope, baseUrl, available, revision]);
  return available && state?.scope === scope ? state : null;
}
