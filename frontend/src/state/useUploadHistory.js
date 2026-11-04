import { useEffect, useState } from 'react';
import { listFiles } from '../api/client.js';

export function useUploadHistory({ scope, baseUrl, available, revision }) {
  const [result, setResult] = useState({ scope, items: [], error: null });
  useEffect(() => {
    if (!available) return;
    let alive = true;
    let request;
    async function refresh() {
      if (!navigator.onLine || document.hidden || request) return;
      request = new AbortController();
      try {
        const items = [],
          seen = new Set();
        let cursor;
        do {
          const page = await listFiles(baseUrl, {
            path: '/upload-history',
            cursor,
            signal: request.signal,
          });
          if (page.skippedItems.length) throw new Error('Có bản ghi lịch sử chưa đọc được');
          if (page.items.some((file) => file.lifecycleState !== 'purged'))
            throw new Error('Lịch sử xóa chưa đúng trạng thái xác nhận');
          items.push(
            ...page.items.map((file) => ({ ...file, scope, connection: { mode: 'api', baseUrl } })),
          );
          cursor = page.nextCursor;
          if (cursor && seen.has(cursor)) throw new Error('Cursor lịch sử bị lặp');
          seen.add(cursor);
        } while (cursor);
        if (alive) setResult({ scope, items, error: null });
      } catch (error) {
        if (alive && error.name !== 'AbortError')
          setResult((prior) => ({
            ...(prior.scope === scope ? prior : { items: [] }),
            scope,
            error: error.message,
          }));
      } finally {
        request = null;
      }
    }
    void refresh();
    const timer = setInterval(refresh, 30000);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      alive = false;
      request?.abort();
      clearInterval(timer);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [scope, baseUrl, available, revision]);
  return result.scope === scope ? result : { items: [], error: null };
}
