//! WriteLock with priority queue for serialized database writes.
//!
//! SQLite allows concurrent reads but only one writer at a time.
//! This lock ensures writes are serialized and can be prioritized.

use parking_lot::Mutex;

/// Priority levels for write operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum WritePriority {
    Low = 0,
    Normal = 1,
    High = 2,
}

/// Simple write serialization lock.
///
/// For now, this is just a parking_lot Mutex wrapping unit.
/// Future: priority queue with fair scheduling.
pub struct WriteLock {
    lock: Mutex<()>,
}

impl WriteLock {
    pub fn new() -> Self {
        Self {
            lock: Mutex::new(()),
        }
    }

    /// Acquire the write lock. Blocks until available.
    pub fn acquire(&self) -> parking_lot::MutexGuard<'_, ()> {
        self.lock.lock()
    }

    /// Try to acquire the write lock without blocking.
    pub fn try_acquire(&self) -> Option<parking_lot::MutexGuard<'_, ()>> {
        self.lock.try_lock()
    }
}

impl Default for WriteLock {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_write_lock_acquire() {
        let lock = WriteLock::new();
        let _guard = lock.acquire();
        // Should not be able to acquire again while held
        assert!(lock.try_acquire().is_none());
    }

    #[test]
    fn test_write_lock_release() {
        let lock = WriteLock::new();
        {
            let _guard = lock.acquire();
        }
        // Should be acquirable after release
        assert!(lock.try_acquire().is_some());
    }
}
