import type { PrinterStatus } from '@eco/shared';

/**
 * Caches printer status briefly so many browsers polling every few seconds result in
 * at most one LPrint round trip per TTL. Concurrent callers share one in-flight request.
 */
export class StatusCache {
  private value: PrinterStatus | null = null;
  private fetchedAt = 0;
  private inFlight: Promise<PrinterStatus> | null = null;
  private generation = 0;

  constructor(
    private readonly load: () => Promise<PrinterStatus>,
    private readonly ttlMs = 2000,
    private readonly clock: () => number = Date.now,
  ) {}

  get(): Promise<PrinterStatus> {
    if (this.value && this.clock() - this.fetchedAt < this.ttlMs) return Promise.resolve(this.value);
    if (!this.inFlight) {
      const generation = this.generation;
      const request = this.load()
        .then((status) => {
          // Ignore results that were requested before the last invalidate().
          if (generation === this.generation) {
            this.value = status;
            this.fetchedAt = this.clock();
          }
          return status;
        })
        .finally(() => {
          if (this.inFlight === request) this.inFlight = null;
        });
      this.inFlight = request;
    }
    return this.inFlight;
  }

  /** Forces the next get() to ask the printer again (after printing, canceling, or settings changes). */
  invalidate(): void {
    this.value = null;
    this.inFlight = null;
    this.generation++;
  }
}
