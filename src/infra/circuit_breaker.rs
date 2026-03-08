//! Circuit breaker for external service resilience (vector stores, Ollama).

use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

use parking_lot::Mutex;

/// Circuit breaker states.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CircuitState {
    Closed,   // Normal operation
    Open,     // Failing, reject calls
    HalfOpen, // Testing recovery
}

/// Circuit breaker pattern implementation.
pub struct CircuitBreaker {
    name: String,
    failure_threshold: u32,
    reset_timeout: Duration,
    failure_count: AtomicU32,
    state: Mutex<CircuitState>,
    last_failure: Mutex<Option<Instant>>,
}

impl CircuitBreaker {
    pub fn new(name: &str, failure_threshold: u32, reset_timeout: Duration) -> Self {
        Self {
            name: name.to_string(),
            failure_threshold,
            reset_timeout,
            failure_count: AtomicU32::new(0),
            state: Mutex::new(CircuitState::Closed),
            last_failure: Mutex::new(None),
        }
    }

    /// Check if the circuit allows a call.
    pub fn can_call(&self) -> bool {
        let mut state = self.state.lock();
        match *state {
            CircuitState::Closed => true,
            CircuitState::Open => {
                // Check if reset timeout has elapsed
                if let Some(last) = *self.last_failure.lock() {
                    if last.elapsed() >= self.reset_timeout {
                        *state = CircuitState::HalfOpen;
                        return true;
                    }
                }
                false
            }
            CircuitState::HalfOpen => true,
        }
    }

    /// Record a successful call.
    pub fn record_success(&self) {
        self.failure_count.store(0, Ordering::Relaxed);
        *self.state.lock() = CircuitState::Closed;
    }

    /// Record a failed call.
    pub fn record_failure(&self) {
        let count = self.failure_count.fetch_add(1, Ordering::Relaxed) + 1;
        *self.last_failure.lock() = Some(Instant::now());
        if count >= self.failure_threshold {
            *self.state.lock() = CircuitState::Open;
        }
    }

    pub fn state(&self) -> CircuitState {
        *self.state.lock()
    }

    pub fn name(&self) -> &str {
        &self.name
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_circuit_breaker_opens_on_failures() {
        let cb = CircuitBreaker::new("test", 3, Duration::from_secs(30));
        assert!(cb.can_call());
        assert_eq!(cb.state(), CircuitState::Closed);

        cb.record_failure();
        cb.record_failure();
        assert!(cb.can_call()); // Still closed (2 < 3)

        cb.record_failure();
        assert_eq!(cb.state(), CircuitState::Open);
        assert!(!cb.can_call());
    }

    #[test]
    fn test_circuit_breaker_resets_on_success() {
        let cb = CircuitBreaker::new("test", 2, Duration::from_secs(30));
        cb.record_failure();
        cb.record_failure();
        assert_eq!(cb.state(), CircuitState::Open);

        cb.record_success();
        assert_eq!(cb.state(), CircuitState::Closed);
        assert!(cb.can_call());
    }
}
