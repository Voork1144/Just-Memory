/**
 * Just-Memory Write Lock (v4.0)
 * Async mutex with FIFO queue for serializing SQLite writes.
 * Multiple concurrent readers are unaffected (WAL mode handles this).
 * Writers take the lock; additional writers wait in queue.
 *
 * When @rocicorp/zero-sqlite3 is used (BEGIN CONCURRENT), the lock
 * becomes advisory — two writers proceed concurrently, conflicts
 * detected at COMMIT time. The mutex still prevents >2 concurrent writers.
 */

interface QueueEntry {
  resolve: () => void;
  reject: (err: Error) => void;
}

export class WriteLock {
  private _queue: QueueEntry[] = [];
  private _maxConcurrent: number;
  private _activeCount = 0;
  private _totalAcquires = 0;
  private _totalWaits = 0;
  private _maxQueueDepth = 0;

  /**
   * @param maxConcurrent Maximum concurrent writers.
   *   1 = standard SQLite (single writer, others queue)
   *   2 = BEGIN CONCURRENT mode (two writers, others queue)
   */
  constructor(maxConcurrent = 1) {
    this._maxConcurrent = Math.max(1, maxConcurrent);
  }

  /** Acquire the write lock. Resolves when it's your turn. Optional timeout in ms. */
  async acquire(timeoutMs?: number): Promise<void> {
    this._totalAcquires++;

    if (this._activeCount < this._maxConcurrent) {
      this._activeCount++;
      return;
    }

    // Queue this writer
    this._totalWaits++;
    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const entry: QueueEntry = {
        resolve: () => { if (timer) clearTimeout(timer); resolve(); },
        reject: (err: Error) => { if (timer) clearTimeout(timer); reject(err); },
      };
      this._queue.push(entry);
      if (this._queue.length > this._maxQueueDepth) {
        this._maxQueueDepth = this._queue.length;
      }
      if (timeoutMs && timeoutMs > 0) {
        timer = setTimeout(() => {
          const idx = this._queue.indexOf(entry);
          if (idx !== -1) this._queue.splice(idx, 1);
          reject(new Error(`Write lock timeout after ${timeoutMs}ms`));
        }, timeoutMs);
      }
    });
  }

  /** Release the write lock. Wakes next queued writer. */
  release(): void {
    if (this._activeCount <= 0) return;

    const next = this._queue.shift();
    if (next) {
      // Hand lock directly to next waiter (no gap)
      next.resolve();
    } else {
      this._activeCount--;
    }
  }

  /**
   * Execute a function while holding the write lock.
   * Automatically releases on completion or error.
   */
  async withLock<T>(fn: () => T | Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /** Drain all queued waiters with an error (for shutdown). */
  drain(reason = 'Write lock shutting down'): void {
    const err = new Error(reason);
    while (this._queue.length > 0) {
      const entry = this._queue.shift()!;
      entry.reject(err);
    }
    this._activeCount = 0;
  }

  /** Diagnostics */
  get stats() {
    return {
      activeWriters: this._activeCount,
      queueDepth: this._queue.length,
      maxConcurrent: this._maxConcurrent,
      totalAcquires: this._totalAcquires,
      totalWaits: this._totalWaits,
      maxQueueDepth: this._maxQueueDepth,
    };
  }
}
