import { useEffect, useRef, useState } from 'react';
import { updateFilePreferences } from '../api/client.js';
import { UploadQueue } from '../utils/uploadQueue.js';

const keyOf = (file) => `${file.scope}|${file.remoteId}`;
export function usePersistentStars({ files, scope, available, onApply, notify }) {
  const [overrides, render] = useState(new Map());
  const values = useRef(new Map());
  const inputs = useRef(null);
  inputs.current = { files, scope, available, onApply, notify };
  const scheduler = useRef(null);
  const alive = useRef(true);
  function set(key, value) {
    const next = new Map(values.current);
    if (value) next.set(key, value);
    else next.delete(key);
    values.current = next;
    if (alive.current) render(next);
  }
  function finish(job, failed) {
    job.batch.remaining--;
    if (failed) job.batch.failed++;
    if (job.batch.remaining === 0 && alive.current && job.scope === inputs.current.scope)
      inputs.current.notify(
        job.batch.failed
          ? `Đã lưu ${job.batch.total - job.batch.failed}/${job.batch.total} đánh dấu. Hãy thử lại các tệp còn lại.`
          : job.batch.total > 1
            ? `Đã lưu đánh dấu cho ${job.batch.total} tệp`
            : job.starred
              ? 'Đã đánh dấu'
              : 'Đã bỏ đánh dấu',
      );
  }
  function queue() {
    if (!scheduler.current)
      scheduler.current = new UploadQueue({
        concurrency: 4,
        run: (job, signal) =>
          updateFilePreferences(job.baseUrl, job.remoteId, job.starred, { signal }),
        onSuccess(job, patch) {
          set(job.id, { ...patch, pending: false });
          inputs.current.onApply?.({ ...patch, scope: job.scope });
          finish(job, false);
        },
        onError(job) {
          set(job.id, job.previous);
          finish(job, true);
        },
      });
    return scheduler.current;
  }
  function decorate(file) {
    const current = overrides.get(keyOf(file));
    if (!current) return file;
    if (!current.pending && (file.starredUpdatedAt || 0) > (current.starredUpdatedAt || 0))
      return file;
    return { ...file, starred: current.starred, starPending: current.pending };
  }
  function star(ids, value) {
    const jobs = [];
    if (!inputs.current.available) {
      inputs.current.notify('Máy chủ chưa hỗ trợ lưu đánh dấu');
      return;
    }
    for (const file of inputs.current.files) {
      if (
        !ids.includes(file.id) ||
        !file.remoteId ||
        file.mode !== 'api' ||
        file.lifecycleState === 'purged'
      )
        continue;
      const id = keyOf(file),
        previous = values.current.get(id);
      if (previous?.pending) continue;
      const current =
        previous &&
        (previous.pending || (previous.starredUpdatedAt || 0) >= (file.starredUpdatedAt || 0))
          ? previous
          : file;
      const starred = value ?? !current.starred;
      set(id, { starred, pending: true, starredUpdatedAt: current.starredUpdatedAt || 0 });
      jobs.push({
        id,
        remoteId: file.remoteId,
        scope: file.scope,
        baseUrl: file.connection.baseUrl,
        starred,
        previous,
      });
    }
    const batch = { remaining: jobs.length, total: jobs.length, failed: 0 };
    queue().enqueue(jobs.map((job) => ({ ...job, batch })));
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      scheduler.current?.dispose();
      scheduler.current = null;
    };
  }, []);
  return { decorate, star };
}
