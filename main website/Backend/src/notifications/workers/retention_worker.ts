/**
 * RemoteNode Notification Retention & Cleanup Worker Service
 * Track 4 — Batch NT-1.5 Architecture
 */

import { prisma } from '../../config/database.js';
import { config } from '../../config/env.js';
import { defaultIdempotencyManager } from '../services/idempotency.js';

export interface RetentionCleanupResult {
  notificationsCleaned: number;
  deliveriesCleaned: number;
  idempotencyKeysCleaned: number;
  executedAt: Date;
}

export class RetentionWorker {
  private readonly retentionDays: number;
  private readonly deliveryRetentionDays: number;
  private readonly cleanupIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    retentionDays: number = config.NOTIFICATION_RETENTION_DAYS ?? 90,
    deliveryRetentionDays: number = config.NOTIFICATION_DELIVERY_RETENTION_DAYS ?? 30,
    cleanupIntervalMs: number = config.NOTIFICATION_CLEANUP_INTERVAL_MS ?? 86400000
  ) {
    this.retentionDays = retentionDays;
    this.deliveryRetentionDays = deliveryRetentionDays;
    this.cleanupIntervalMs = cleanupIntervalMs;
  }

  public async executeCleanupTick(batchSize: number = 100): Promise<RetentionCleanupResult> {
    const result: RetentionCleanupResult = {
      notificationsCleaned: 0,
      deliveriesCleaned: 0,
      idempotencyKeysCleaned: 0,
      executedAt: new Date()
    };

    try {
      // 1. Clean expired idempotency TTL entries
      result.idempotencyKeysCleaned = await defaultIdempotencyManager.clearExpired();

      // 2. Clean old completed/failed delivery records (protecting QUEUED, PROCESSING, RETRYING)
      result.deliveriesCleaned = await this.cleanExpiredDeliveryRecords(this.deliveryRetentionDays, batchSize);

      // 3. Clean old read/archived notification records (protecting UNREAD and SECURITY category alerts)
      result.notificationsCleaned = await this.cleanExpiredNotificationRecords(this.retentionDays, batchSize);
    } catch (err) {
      console.error('[RetentionWorker] Error executing retention cleanup tick:', err);
    }

    return result;
  }

  /**
   * Safely deletes completed or permanently failed delivery records older than deliveryRetentionDays in bounded batches.
   */
  public async cleanExpiredDeliveryRecords(deliveryRetentionDays: number, batchSize: number = 100): Promise<number> {
    const cutoff = new Date(Date.now() - deliveryRetentionDays * 24 * 60 * 60 * 1000);
    let totalDeleted = 0;

    try {
      while (true) {
        // Find batch of eligible delivery IDs
        const eligible = await prisma.channelDeliveryRecord.findMany({
          where: {
            status: { in: ['DELIVERED', 'PERMANENTLY_FAILED', 'FAILED'] },
            createdAt: { lte: cutoff }
          },
          select: { id: true },
          take: batchSize
        });

        if (eligible.length === 0) break;

        const idsToDelete = eligible.map((e) => e.id);
        const deleteRes = await prisma.channelDeliveryRecord.deleteMany({
          where: { id: { in: idsToDelete } }
        });

        totalDeleted += deleteRes.count;
        if (eligible.length < batchSize) break;
      }
    } catch (err) {
      console.error('[RetentionWorker] Error cleaning delivery records:', err);
    }

    return totalDeleted;
  }

  /**
   * Safely deletes READ or ARCHIVED notification records older than retentionDays (protecting UNREAD & SECURITY category) in bounded batches.
   */
  public async cleanExpiredNotificationRecords(retentionDays: number, batchSize: number = 100): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    let totalDeleted = 0;

    try {
      while (true) {
        const eligible = await prisma.notificationRecord.findMany({
          where: {
            status: { in: ['READ', 'ARCHIVED'] },
            category: { notIn: ['ACCOUNT_SECURITY', 'SECURITY'] },
            createdAt: { lte: cutoff }
          },
          select: { id: true },
          take: batchSize
        });

        if (eligible.length === 0) break;

        const idsToDelete = eligible.map((e) => e.id);
        
        // Delete dependent delivery records first if any remain
        await prisma.channelDeliveryRecord.deleteMany({
          where: { notificationId: { in: idsToDelete } }
        });

        const deleteRes = await prisma.notificationRecord.deleteMany({
          where: { id: { in: idsToDelete } }
        });

        totalDeleted += deleteRes.count;
        if (eligible.length < batchSize) break;
      }
    } catch (err) {
      console.error('[RetentionWorker] Error cleaning notification records:', err);
    }

    return totalDeleted;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[RetentionWorker] Starting retention cleanup worker (interval=${this.cleanupIntervalMs}ms, retentionDays=${this.retentionDays}d)...`);

    this.timer = setInterval(() => {
      this.executeCleanupTick().catch(() => {});
    }, this.cleanupIntervalMs);
  }

  public stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[RetentionWorker] Retention cleanup worker stopped.');
  }
}

export const defaultRetentionWorker = new RetentionWorker();
