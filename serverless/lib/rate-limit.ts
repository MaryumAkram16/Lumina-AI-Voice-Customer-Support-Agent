export interface RateDecision {
  allowed: boolean;
  /** Seconds until the window resets, for the Retry-After header. */
  retryAfterSeconds: number;
}

/**
 * Fixed-window counter kept in memory.
 *
 * On serverless this is per warm instance, so it slows a burst hitting one
 * instance rather than enforcing an exact global quota. See SECURITY.md for
 * the shared-store option.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  check(key: string, limit: number, now: number = Date.now()): RateDecision {
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      if (this.hits.size >= this.maxKeys) this.prune(now);
      entry = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, entry);
    }
    entry.count += 1;
    return {
      allowed: entry.count <= limit,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }

  /** Whether one more hit would be allowed, without counting it. */
  peek(key: string, limit: number, now: number = Date.now()): RateDecision {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) return { allowed: true, retryAfterSeconds: 0 };
    return {
      allowed: entry.count < limit,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }

  private prune(now: number): void {
    for (const [key, entry] of this.hits) {
      if (entry.resetAt <= now) this.hits.delete(key);
    }
    // Still full of live keys: drop the oldest so memory stays bounded.
    while (this.hits.size >= this.maxKeys) {
      const oldest = this.hits.keys().next();
      if (oldest.done) break;
      this.hits.delete(oldest.value);
    }
  }
}
