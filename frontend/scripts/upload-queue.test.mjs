import test from 'node:test';
import assert from 'node:assert/strict';
import { UploadQueue } from '../src/utils/uploadQueue.js';

const turn = () => new Promise((resolve) => setImmediate(resolve));
test('queue never exceeds five active requests and fills freed slots', async () => {
  const releases = new Map();
  const completed = [];
  let active = 0,
    peak = 0;
  const queue = new UploadQueue({
    concurrency: 5,
    run: (item) =>
      new Promise((resolve) => {
        active++;
        peak = Math.max(peak, active);
        releases.set(item.id, () => {
          active--;
          resolve(item.id);
        });
      }),
    onSuccess: (item, result) => completed.push(result),
  });
  queue.enqueue(Array.from({ length: 12 }, (_, id) => ({ id })));
  await turn();
  assert.equal(active, 5);
  const first = releases.get(0);
  releases.delete(0);
  first();
  await turn();
  assert.equal(active, 5);
  assert.equal(queue.pending.length, 6);
  for (let wave = 0; wave < 3; wave++) {
    for (const [id, release] of [...releases]) {
      releases.delete(id);
      release();
    }
    await turn();
  }
  assert.equal(peak, 5);
  assert.equal(completed.length, 12);
  queue.dispose();
});
test('aborted requests keep their slots until settled and cancelled pending files never run', async () => {
  const started = [],
    rejected = new Map();
  const queue = new UploadQueue({
    concurrency: 2,
    run: (item, signal) =>
      new Promise((resolve, reject) => {
        started.push(item.id);
        signal.addEventListener('abort', () =>
          rejected.set(item.id, () => reject(new DOMException('Aborted', 'AbortError'))),
        );
      }),
  });
  queue.enqueue([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
  await turn();
  queue.cancel([1, 3]);
  await turn();
  assert.deepEqual(started, [1, 2]);
  rejected.get(1)();
  await turn();
  assert.deepEqual(started, [1, 2, 4]);
  queue.dispose();
  rejected.get(2)?.();
  rejected.get(4)?.();
  await turn();
});
test('disposal suppresses late success and double enqueue never starts a second copy', async () => {
  let resolveRequest;
  let successes = 0,
    starts = 0;
  const queue = new UploadQueue({
    run: () => {
      starts++;
      return new Promise((resolve) => {
        resolveRequest = resolve;
      });
    },
    onSuccess: () => successes++,
  });
  queue.enqueue([{ id: 'same' }, { id: 'same' }]);
  await turn();
  queue.enqueue([{ id: 'same' }]);
  queue.dispose();
  resolveRequest('done');
  await turn();
  assert.equal(starts, 1);
  assert.equal(successes, 0);
});
