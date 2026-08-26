/**
 * RemoteNode Notification Idempotency Manager
 * Track 4 — Batch NT-1.1 Architecture
 *
 * Prevents duplicate notification events from generating duplicate user alerts
 * during worker restarts, API retries, or WebSocket event loops.
 */

export interface IdempotencyRecord {
  idempotencyKey: string;
  eventId: string;
  processedAt: Date;
  expiresAt: Date;
}

export interface IdempotencyManager {
  isProcessed(idempotencyKey: string): Promise<boolean>;
  recordProcessing(idempotencyKey: string, eventId: string, ttlSeconds?: number): Promise<void>;
  clearExpired(): Promise<number>;
}

export class InMemoryIdempotencyManager implements IdempotencyManager {
  private cache: Map<string, IdempotencyRecord> = new Map();
  private defaultTtlMs: number;

  constructor(defaultTtlSeconds: number = 86400) { // 24 hours default TTL
    this.defaultTtlMs = defaultTtlSeconds * 1000;
  }

  public async isProcessed(idempotencyKey: string): Promise<boolean> {
    const record = this.cache.get(idempotencyKey);
    if (!record) {
      return false;
    }
    if (new Date() > record.expiresAt) {
      this.cache.delete(idempotencyKey);
      return false;
    }
    return true;
  }

  public async recordProcessing(
    idempotencyKey: string,
    eventId: string,
    ttlSeconds?: number
  ): Promise<void> {
    const ttl = ttlSeconds ? ttlSeconds * 1000 : this.defaultTtlMs;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttl);

    this.cache.set(idempotencyKey, {
      idempotencyKey,
      eventId,
      processedAt: now,
      expiresAt
    });
  }

  public async clearExpired(): Promise<number> {
    const now = new Date();
    let count = 0;
    for (const [key, record] of this.cache.entries()) {
      if (now > record.expiresAt) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  public size(): number {
    return this.cache.size;
  }
}

export const defaultIdempotencyManager = new InMemoryIdempotencyManager();
