/**
 * Tests for src/write-lock.ts
 * WriteLock: async FIFO mutex for serializing SQLite writes.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { WriteLock } from '../src/write-lock.js';

describe('WriteLock', () => {
  describe('basic acquire/release', () => {
    it('should acquire immediately when no contention', async () => {
      const lock = new WriteLock();
      await lock.acquire();
      assert.strictEqual(lock.stats.activeWriters, 1);
      lock.release();
      assert.strictEqual(lock.stats.activeWriters, 0);
    });

    it('should track totalAcquires', async () => {
      const lock = new WriteLock();
      await lock.acquire();
      lock.release();
      await lock.acquire();
      lock.release();
      assert.strictEqual(lock.stats.totalAcquires, 2);
    });

    it('should not go below 0 on extra release', () => {
      const lock = new WriteLock();
      lock.release(); // no-op
      assert.strictEqual(lock.stats.activeWriters, 0);
    });
  });

  describe('queuing behavior', () => {
    it('should queue second writer when maxConcurrent=1', async () => {
      const lock = new WriteLock(1);
      await lock.acquire(); // writer 1 in

      let writer2Done = false;
      const writer2 = lock.acquire().then(() => { writer2Done = true; });

      // writer2 should be queued, not resolved yet
      await new Promise(r => setTimeout(r, 10));
      assert.strictEqual(writer2Done, false, 'Writer 2 should be queued');
      assert.strictEqual(lock.stats.queueDepth, 1);

      lock.release(); // hand off to writer 2
      await writer2;
      assert.strictEqual(writer2Done, true, 'Writer 2 should now be active');
      assert.strictEqual(lock.stats.activeWriters, 1);
      lock.release();
    });

    it('should maintain FIFO order', async () => {
      const lock = new WriteLock(1);
      const order: number[] = [];

      await lock.acquire(); // hold lock

      const p1 = lock.acquire().then(() => { order.push(1); });
      const p2 = lock.acquire().then(() => { order.push(2); });
      const p3 = lock.acquire().then(() => { order.push(3); });

      assert.strictEqual(lock.stats.queueDepth, 3);

      // Release 3 times to let all through in order
      lock.release();
      await p1;
      lock.release();
      await p2;
      lock.release();
      await p3;
      lock.release();

      assert.deepStrictEqual(order, [1, 2, 3], 'Should process in FIFO order');
    });

    it('should track maxQueueDepth', async () => {
      const lock = new WriteLock(1);
      await lock.acquire();

      const waiters = [lock.acquire(), lock.acquire(), lock.acquire()];
      assert.strictEqual(lock.stats.maxQueueDepth, 3);

      // Release all
      lock.release();
      lock.release();
      lock.release();
      lock.release();
      await Promise.all(waiters);
    });

    it('should track totalWaits', async () => {
      const lock = new WriteLock(1);
      await lock.acquire();

      const p1 = lock.acquire(); // waits
      const p2 = lock.acquire(); // waits

      lock.release();
      lock.release();
      lock.release();
      await Promise.all([p1, p2]);

      assert.strictEqual(lock.stats.totalWaits, 2);
    });
  });

  describe('maxConcurrent > 1', () => {
    it('should allow 2 concurrent writers with maxConcurrent=2', async () => {
      const lock = new WriteLock(2);
      await lock.acquire();
      await lock.acquire();
      assert.strictEqual(lock.stats.activeWriters, 2);

      let writer3Queued = false;
      const p3 = lock.acquire().then(() => { writer3Queued = true; });

      await new Promise(r => setTimeout(r, 10));
      assert.strictEqual(writer3Queued, false, 'Third writer should queue');

      lock.release(); // hand to writer 3
      await p3;
      assert.strictEqual(writer3Queued, true);
      lock.release();
      lock.release();
    });

    it('should clamp maxConcurrent to at least 1', () => {
      const lock = new WriteLock(0);
      assert.strictEqual(lock.stats.maxConcurrent, 1);
      const lock2 = new WriteLock(-5);
      assert.strictEqual(lock2.stats.maxConcurrent, 1);
    });
  });

  describe('withLock', () => {
    it('should execute function and return result', async () => {
      const lock = new WriteLock();
      const result = await lock.withLock(() => 42);
      assert.strictEqual(result, 42);
      assert.strictEqual(lock.stats.activeWriters, 0);
    });

    it('should handle async functions', async () => {
      const lock = new WriteLock();
      const result = await lock.withLock(async () => {
        await new Promise(r => setTimeout(r, 5));
        return 'async-result';
      });
      assert.strictEqual(result, 'async-result');
      assert.strictEqual(lock.stats.activeWriters, 0);
    });

    it('should release lock on error', async () => {
      const lock = new WriteLock();
      await assert.rejects(
        () => lock.withLock(() => { throw new Error('test error'); }),
        { message: 'test error' }
      );
      assert.strictEqual(lock.stats.activeWriters, 0, 'Lock should be released after error');
    });

    it('should release lock on async rejection', async () => {
      const lock = new WriteLock();
      await assert.rejects(
        () => lock.withLock(async () => { throw new Error('async error'); }),
        { message: 'async error' }
      );
      assert.strictEqual(lock.stats.activeWriters, 0);
    });

    it('should serialize concurrent withLock calls', async () => {
      const lock = new WriteLock(1);
      const order: number[] = [];

      const p1 = lock.withLock(async () => {
        await new Promise(r => setTimeout(r, 20));
        order.push(1);
      });
      const p2 = lock.withLock(async () => {
        order.push(2);
      });
      const p3 = lock.withLock(async () => {
        order.push(3);
      });

      await Promise.all([p1, p2, p3]);
      assert.deepStrictEqual(order, [1, 2, 3]);
    });
  });

  describe('drain', () => {
    it('should reject all queued waiters', async () => {
      const lock = new WriteLock(1);
      await lock.acquire();

      const errors: Error[] = [];
      const p1 = lock.acquire().catch((e: Error) => { errors.push(e); });
      const p2 = lock.acquire().catch((e: Error) => { errors.push(e); });

      lock.drain('shutting down');
      await Promise.all([p1, p2]);

      assert.strictEqual(errors.length, 2);
      assert.strictEqual(errors[0].message, 'shutting down');
      assert.strictEqual(errors[1].message, 'shutting down');
      assert.strictEqual(lock.stats.activeWriters, 0);
      assert.strictEqual(lock.stats.queueDepth, 0);
    });

    it('should use default reason when none provided', async () => {
      const lock = new WriteLock(1);
      await lock.acquire();

      let error: Error | null = null;
      const p = lock.acquire().catch((e: Error) => { error = e; });
      lock.drain();
      await p;

      assert.ok(error);
      assert.strictEqual(error!.message, 'Write lock shutting down');
    });

    it('should be safe to call on empty queue', () => {
      const lock = new WriteLock();
      lock.drain(); // no-op
      assert.strictEqual(lock.stats.queueDepth, 0);
    });
  });

  describe('stats', () => {
    it('should return all stat fields', () => {
      const lock = new WriteLock(2);
      const s = lock.stats;
      assert.strictEqual(s.activeWriters, 0);
      assert.strictEqual(s.queueDepth, 0);
      assert.strictEqual(s.maxConcurrent, 2);
      assert.strictEqual(s.totalAcquires, 0);
      assert.strictEqual(s.totalWaits, 0);
      assert.strictEqual(s.maxQueueDepth, 0);
    });
  });
});
