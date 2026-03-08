//! Token bucket rate limiter.

use std::time::Instant;

use parking_lot::Mutex;

/// Simple token bucket rate limiter.
pub struct RateLimiter {
    state: Mutex<RateLimiterState>,
    capacity: f64,
    refill_rate: f64, // tokens per second
}

struct RateLimiterState {
    tokens: f64,
    last_refill: Instant,
}

impl RateLimiter {
    pub fn new(capacity: f64, refill_rate: f64) -> Self {
        Self {
            state: Mutex::new(RateLimiterState {
                tokens: capacity,
                last_refill: Instant::now(),
            }),
            capacity,
            refill_rate,
        }
    }

    /// Try to consume one token. Returns true if allowed.
    pub fn try_acquire(&self) -> bool {
        self.try_acquire_n(1.0)
    }

    /// Try to consume N tokens.
    pub fn try_acquire_n(&self, n: f64) -> bool {
        let mut state = self.state.lock();
        let now = Instant::now();
        let elapsed = now.duration_since(state.last_refill).as_secs_f64();
        state.tokens = (state.tokens + elapsed * self.refill_rate).min(self.capacity);
        state.last_refill = now;

        if state.tokens >= n {
            state.tokens -= n;
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rate_limiter_basic() {
        let limiter = RateLimiter::new(5.0, 1.0);
        for _ in 0..5 {
            assert!(limiter.try_acquire());
        }
        // 6th should fail (no time to refill)
        assert!(!limiter.try_acquire());
    }
}
