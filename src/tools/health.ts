// Per-provider circuit breaker + retry helpers for tool execution.
//
// Strategy:
//   - States: 'closed' (normal) and 'open' (failing fast).
//   - `failureThreshold` consecutive failures within `failureWindowMs` flip
//     to 'open'. The breaker stays open for `cooldownMs`, then auto-recovers
//     to 'closed' on next call attempt. Cooldown doubles on each re-open
//     (exponential backoff, capped at `cooldownMaxMs`) and resets only after
//     a clean success.
//   - Half-open is intentionally omitted: cooldown-based recovery is simpler
//     and avoids the "probe in flight" concurrency complexity. The trade-off
//     is one wasted call attempt at recovery, which is acceptable.

export type CircuitState = 'closed' | 'open';

export interface CircuitBreakerConfig {
  failureThreshold: number;
  failureWindowMs: number;
  cooldownMs: number;
  cooldownMaxMs: number;
}

export const DEFAULT_CB_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  failureWindowMs: 60_000,
  cooldownMs: 30_000,
  cooldownMaxMs: 300_000,
};

export interface CircuitBreakerSnapshot {
  state: CircuitState;
  consecutiveFailures: number;
  cooldownRemainingMs: number;
  nextCooldownMs: number;
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private firstFailureAt = 0;
  private openUntil = 0;
  private currentCooldownMs: number;

  constructor(
    public readonly name: string,
    private readonly cfg: CircuitBreakerConfig = DEFAULT_CB_CONFIG,
  ) {
    this.currentCooldownMs = cfg.cooldownMs;
  }

  canCall(now: number = Date.now()): boolean {
    return this.effectiveState(now) === 'closed';
  }

  getState(now: number = Date.now()): CircuitState {
    return this.effectiveState(now);
  }

  onSuccess(): void {
    this.consecutiveFailures = 0;
    this.firstFailureAt = 0;
    // Clean success → reset exponential backoff.
    this.currentCooldownMs = this.cfg.cooldownMs;
  }

  // Returns true if this failure caused a transition to 'open'.
  onFailure(now: number = Date.now()): boolean {
    if (this.effectiveState(now) === 'open') return false;
    if (this.firstFailureAt === 0 || now - this.firstFailureAt > this.cfg.failureWindowMs) {
      this.firstFailureAt = now;
      this.consecutiveFailures = 1;
    } else {
      this.consecutiveFailures++;
    }
    if (this.consecutiveFailures >= this.cfg.failureThreshold) {
      this.transitionToOpen(now);
      return true;
    }
    return false;
  }

  snapshot(now: number = Date.now()): CircuitBreakerSnapshot {
    const state = this.effectiveState(now);
    return {
      state,
      consecutiveFailures: this.consecutiveFailures,
      cooldownRemainingMs: state === 'open' ? Math.max(0, this.openUntil - now) : 0,
      nextCooldownMs: this.currentCooldownMs,
    };
  }

  private transitionToOpen(now: number): void {
    this.state = 'open';
    this.openUntil = now + this.currentCooldownMs;
    this.currentCooldownMs = Math.min(this.currentCooldownMs * 2, this.cfg.cooldownMaxMs);
    this.consecutiveFailures = 0;
    this.firstFailureAt = 0;
  }

  // Lazy transition open → closed when cooldown expires. Cooldown ladder
  // is preserved (only a clean success resets it).
  private effectiveState(now: number): CircuitState {
    if (this.state === 'open' && now >= this.openUntil) {
      this.state = 'closed';
    }
    return this.state;
  }
}

// Conservative classifier: prefer false negatives (missing a retry) over
// false positives (retrying a non-idempotent failure that already mutated).
export function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  if (msg.includes('econnreset') || msg.includes('econnrefused') || msg.includes('econnaborted')) return true;
  if (msg.includes('etimedout') || msg.includes('timeout') || msg.includes('timed out')) return true;
  if (msg.includes('fetch failed') || msg.includes('socket hang up')) return true;
  if (msg.includes('eai_again') || msg.includes('enotfound')) return true;
  if (msg.includes('temporarily unavailable')) return true;
  if (msg.includes('service unavailable')) return true;
  return false;
}

export interface RetryConfig {
  maxAttempts: number;       // total attempts including the first
  baseDelayMs: number;       // first retry backoff (multiplied by 3^(attempt-1))
  isRetriable: (err: unknown) => boolean;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  cfg: RetryConfig,
  onRetry?: (attempt: number, err: unknown, delayMs: number) => void,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === cfg.maxAttempts || !cfg.isRetriable(err)) throw err;
      const base = cfg.baseDelayMs * Math.pow(3, attempt - 1);
      const delayMs = Math.round(base * (0.8 + Math.random() * 0.4));
      onRetry?.(attempt, err, delayMs);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}
