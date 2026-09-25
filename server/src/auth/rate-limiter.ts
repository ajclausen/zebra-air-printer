/** Sliding-window, in-memory attempt limiter keyed by client (e.g. IP address). */
export class RateLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly clock: () => number = Date.now,
  ) {}

  /**
   * Records an attempt. Returns 0 when allowed, otherwise the number of seconds until
   * the next attempt will be allowed (the attempt is not recorded).
   */
  attempt(key: string): number {
    const now = this.clock();
    const recent = (this.attempts.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.attempts.set(key, recent);
      return Math.max(1, Math.ceil((recent[0]! + this.windowMs - now) / 1000));
    }
    recent.push(now);
    this.attempts.set(key, recent);
    this.sweep(now);
    return 0;
  }

  /** Drops keys with no recent attempts so the map cannot grow without bound. */
  private sweep(now: number): void {
    if (this.attempts.size < 1000) return;
    for (const [key, times] of this.attempts) {
      if (times.every((t) => now - t >= this.windowMs)) this.attempts.delete(key);
    }
  }
}
