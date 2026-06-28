export class RateLimiter {
  private readonly timestamps = new Map<string, number[]>();

  allow(key: string, maxEvents: number, windowMs: number): boolean {
    const now = Date.now();
    const windowStart = now - windowMs;
    const existing = (this.timestamps.get(key) ?? []).filter((timestamp) => timestamp > windowStart);
    if (existing.length >= maxEvents) {
      this.timestamps.set(key, existing);
      return false;
    }
    existing.push(now);
    this.timestamps.set(key, existing);
    return true;
  }

  reset(key: string): void {
    this.timestamps.delete(key);
  }
}
