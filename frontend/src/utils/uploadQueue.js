// Limits actual in-flight requests, including requests whose abort is still settling.
export class UploadQueue {
  constructor({
    concurrency = 5,
    run,
    onStart = () => {},
    onSuccess = () => {},
    onError = () => {},
  }) {
    this.concurrency = concurrency;
    this.run = run;
    this.onStart = onStart;
    this.onSuccess = onSuccess;
    this.onError = onError;
    this.pending = [];
    this.active = new Map();
    this.closed = false;
  }
  enqueue(items) {
    if (this.closed) return;
    for (const item of items) {
      if (!this.active.has(item.id) && !this.pending.some((queued) => queued.id === item.id))
        this.pending.push(item);
    }
    this.pump();
  }
  pump() {
    while (!this.closed && this.active.size < this.concurrency && this.pending.length) {
      const item = this.pending.shift();
      const controller = new AbortController();
      this.active.set(item.id, { item, controller });
      this.onStart(item);
      Promise.resolve()
        .then(() => this.run(item, controller.signal))
        .then((result) => {
          if (!this.closed && !controller.signal.aborted) this.onSuccess(item, result);
        })
        .catch((error) => {
          if (!this.closed) this.onError(item, error);
        })
        .finally(() => {
          this.active.delete(item.id);
          this.pump();
        });
    }
  }
  cancel(ids) {
    const set = new Set(ids);
    this.pending = this.pending.filter((item) => !set.has(item.id));
    for (const id of ids) this.active.get(id)?.controller.abort();
  }
  has(id) {
    return this.active.has(id) || this.pending.some((item) => item.id === id);
  }
  dispose() {
    this.closed = true;
    this.pending = [];
    this.active.forEach(({ controller }) => controller.abort());
  }
}
