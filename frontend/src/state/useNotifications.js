import { useEffect, useRef, useState } from 'react';

export function useNotifications(scope) {
  const [events, renderEvents] = useState([]);
  const ref = useRef([]);
  const [visible, setVisible] = useState([]);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  function update(next) {
    ref.current = next;
    renderEvents(next);
  }
  function addEvent(event) {
    const now = Date.now();
    const eventScope = event.scope ?? scopeRef.current;
    const grouped =
      ['upload-success', 'demo-success'].includes(event.kind) &&
      ref.current.find(
        (previous) =>
          previous.kind === event.kind &&
          previous.scope === eventScope &&
          now - previous.createdAt < 2000,
      );
    const id = grouped?.id || crypto.randomUUID();
    const count = (grouped?.count || 0) + 1;
    const next = {
      ...event,
      scope: eventScope,
      id,
      createdAt: now,
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
    update([next, ...ref.current.filter((item) => item.id !== id)].slice(0, 200));
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
