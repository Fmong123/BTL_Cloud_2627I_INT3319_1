import { useEffect, useRef, useState } from 'react';
import { listNotifications, persistNotification } from '../api/client.js';
import { NOTIFICATIONS_KEY, readNotificationRecords, writeRecords } from '../utils/persistence.js';

export function useNotifications(scope, { baseUrl, available = false } = {}) {
  const [events, renderEvents] = useState(readNotificationRecords);
  const ref = useRef(events);
  const [storageError, setStorageError] = useState(null);
  const synced = useRef(new Map());
  const [visible, setVisible] = useState([]);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  function update(next) {
    ref.current = next;
    renderEvents(next);
    if (!writeRecords(NOTIFICATIONS_KEY, next))
      setStorageError('Chưa lưu được thông báo trên trình duyệt');
  }
  useEffect(() => {
    if (!available) return;
    let alive = true,
      running = false;
    let firstRead = true;
    const controller = new AbortController();
    async function sync() {
      if (running || !navigator.onLine || document.hidden) return;
      running = true;
      try {
        // Upload local offline events first; a read flag only moves false -> true.
        for (const event of ref.current.filter((item) => item.scope === scope)) {
          const signature = JSON.stringify(event);
          if (synced.current.get(`${scope}|${event.id}`) === signature) continue;
          await persistNotification(baseUrl, event, { signal: controller.signal });
          synced.current.set(`${scope}|${event.id}`, signature);
        }
        const saved = await listNotifications(baseUrl, {
          signal: controller.signal,
          includeHistory: firstRead,
        });
        firstRead = false;
        if (!alive) return;
        const merged = new Map(ref.current.map((event) => [`${event.scope}|${event.id}`, event]));
        for (const event of saved) {
          const key = `${scope}|${event.id}`,
            prior = merged.get(key);
          const next = { ...prior, ...event, scope, read: event.read || prior?.read || false };
          merged.set(key, next);
          // A locally-read flag still pending server acknowledgement is retried.
          if (event.read || !prior?.read) synced.current.set(key, JSON.stringify(next));
        }
        update([...merged.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 2000));
        setStorageError(null);
      } catch (error) {
        if (alive && error.name !== 'AbortError')
          setStorageError('Thông báo đang lưu trên trình duyệt; chưa đồng bộ máy chủ.');
      } finally {
        running = false;
      }
    }
    void sync();
    const timer = setInterval(sync, 5000);
    window.addEventListener('online', sync);
    return () => {
      alive = false;
      controller.abort();
      clearInterval(timer);
      window.removeEventListener('online', sync);
    };
  }, [scope, baseUrl, available]);
  function addEvent(event) {
    const now = Date.now();
    const eventScope = event.scope ?? scopeRef.current;
    const grouped =
      ['upload-success', 'demo-success'].includes(event.kind) &&
      ref.current.find(
        (previous) =>
          previous.kind === event.kind &&
          !previous.read &&
          previous.scope === eventScope &&
          now - previous.createdAt < 2000,
      );
    const id = grouped?.id || event.id || crypto.randomUUID();
    const count = (grouped?.count || 0) + 1;
    const next = {
      ...event,
      scope: eventScope,
      id,
      createdAt: grouped?.createdAt || event.createdAt || now,
      read: false,
      count,
      ...(grouped
        ? {
            title:
              event.kind === 'demo-success'
                ? `${count} tệp trải nghiệm hoàn tất`
                : `${count} tệp đã lưu`,
            message:
              event.kind === 'demo-success'
                ? 'Mô phỏng giao diện, không gửi nội dung tệp.'
                : 'Nội dung đã được máy chủ xác nhận. Kết quả quét được cập nhật riêng.',
            fileId: undefined,
          }
        : {}),
    };
    update([next, ...ref.current.filter((item) => item.id !== id)].slice(0, 2000));
    setVisible((current) =>
      [
        ...current.filter((item) => item.id !== id),
        {
          id,
          scope: eventScope,
          expiresAt: now + (['warning', 'error'].includes(next.tone) ? 10000 : 6000),
        },
      ].slice(-3),
    );
  }
  useEffect(() => {
    const timer = setInterval(
      () =>
        setVisible((current) => {
          const remaining = current.filter((item) => item.expiresAt > Date.now());
          return remaining.length === current.length ? current : remaining;
        }),
      1000,
    );
    return () => clearInterval(timer);
  }, []);
  return {
    storageError,
    addEvent,
    notifications: events.filter((item) => item.scope === scope),
    toasts: visible
      .filter((item) => item.scope === scope)
      .map((item) => events.find((event) => event.id === item.id))
      .filter(Boolean),
    dismissToast: (id) => setVisible((current) => current.filter((item) => item.id !== id)),
    markRead: (id) =>
      update(
        ref.current.map((item) =>
          item.scope === scopeRef.current && (!id || item.id === id)
            ? { ...item, read: true }
            : item,
        ),
      ),
  };
}
