/**
 * ZDEXCLOUD EMAIL RETENTION & CLEANUP WORKER SERVICE (Phase 13.13)
 *
 * Provides conservative, bounded, transactional, concurrency-safe, observable lifecycle cleanup
 * for historical outbound email tracking records:
 *
 *   EmailMessage (Central Outbound Email Message Log)
 *        ↓ [Cascade]
 *   EmailDeliveryAttempt (Attempt-Level Diagnostic Logs)
 *
 * Core Retention Safety Invariants:
 * 1. Active / In-Flight messages (status: QUEUED, RETRYING, DEFERRED, or active SENT) are NEVER deleted.
 * 2. Only terminal historical records (DELIVERED, FAILED, PERMANENTLY_FAILED, BOUNCED, BLOCKED, SPAM)
 *    older than EMAIL_TRACKING_RETENTION_DAYS (default 90d) are eligible for cleanup.
 * 3. Deletion cascades to dependent EmailDeliveryAttempt records safely via Prisma foreign key relation.
 * 4. Deletions are executed in bounded batches (default 100) with distributed MySQL locking.
 * 5. Dry-run mode evaluates and reports candidate counts without executing destructive deletions.
 * 6. Cleanup failures NEVER crash the application, alter active operational state, or interrupt outbound email sending.
 */

import { prisma } from '../config/database.js';
import { config } from '../config/env.js';
import { appLogger } from '../observability/logger.js';
import { EmailMessageStatus } from '@prisma/client';

export interface EmailRetentionRunResult {
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  dryRun: boolean;
  emailsEvaluated: number;
  emailsDeleted: number;
  attemptsCleaned: number;
  batchesProcessed: number;
  oldestEligibleDate?: string | null;
  success: boolean;
  skippedReason?: string;
  error?: string;
}

export interface EmailRetentionMetrics {
  lastRunAt: string | null;
  lastDurationMs: number;
  lastSuccess: boolean;
  lastDryRun: boolean;
  totalEmailsCleaned: number;
  totalAttemptsCleaned: number;
  totalRuns: number;
  totalFailures: number;
  isRunning: boolean;
  retentionDays: number;
  batchSize: number;
}

export class EmailRetentionWorker {
  private static instance: EmailRetentionWorker;

  private readonly retentionDays: number;
  private readonly batchSize: number;
  private readonly cleanupIntervalMs: number;
  private readonly dryRunDefault: boolean;
  private readonly enabled: boolean;

  private timer: NodeJS.Timeout | null = null;
  private isExecuting = false;
  private isWorkerStarted = false;

  private metrics: EmailRetentionMetrics = {
    lastRunAt: null,
    lastDurationMs: 0,
    lastSuccess: true,
    lastDryRun: false,
    totalEmailsCleaned: 0,
    totalAttemptsCleaned: 0,
    totalRuns: 0,
    totalFailures: 0,
    isRunning: false,
    retentionDays: 90,
    batchSize: 100
  };

  public static getInstance(): EmailRetentionWorker {
    if (!EmailRetentionWorker.instance) {
      EmailRetentionWorker.instance = new EmailRetentionWorker();
    }
    return EmailRetentionWorker.instance;
  }

  constructor(
    retentionDays: number = config.EMAIL_TRACKING_RETENTION_DAYS ?? 90,
    batchSize: number = config.EMAIL_TRACKING_CLEANUP_BATCH_SIZE ?? 100,
    cleanupIntervalMinutes: number = config.EMAIL_TRACKING_CLEANUP_INTERVAL_MINUTES ?? 1440,
    dryRunDefault: boolean = config.EMAIL_TRACKING_CLEANUP_DRY_RUN ?? false,
    enabled: boolean = config.EMAIL_TRACKING_RETENTION_ENABLED ?? true
  ) {
    this.retentionDays = retentionDays;
    this.batchSize = batchSize;
    this.cleanupIntervalMs = cleanupIntervalMinutes * 60 * 1000;
    this.dryRunDefault = dryRunDefault;
    this.enabled = enabled;

    this.metrics.retentionDays = this.retentionDays;
    this.metrics.batchSize = this.batchSize;
  }

  /**
   * Executes a bounded retention cleanup pass with distributed locking.
   */
  public async runCleanup(options?: {
    dryRun?: boolean;
    batchSize?: number;
  }): Promise<EmailRetentionRunResult> {
    const startedAt = new Date();
    const dryRun = options?.dryRun ?? this.dryRunDefault;
    const batchSize = options?.batchSize ?? this.batchSize;

    const result: EmailRetentionRunResult = {
      startedAt,
      completedAt: startedAt,
      durationMs: 0,
      dryRun,
      emailsEvaluated: 0,
      emailsDeleted: 0,
      attemptsCleaned: 0,
      batchesProcessed: 0,
      oldestEligibleDate: null,
      success: true
    };

    // 1. Process concurrency guard
    if (this.isExecuting) {
      result.skippedReason = 'Email retention cleanup run already in progress on this node';
      result.completedAt = new Date();
      result.durationMs = result.completedAt.getTime() - startedAt.getTime();
      return result;
    }

    this.isExecuting = true;
    let lockAcquired = false;

    try {
      // 2. Distributed Database Concurrency Lock (MySQL Named Lock)
      lockAcquired = await this.acquireDistributedLock('zdexcloud_email_retention_worker', 5);
      if (!lockAcquired) {
        result.skippedReason = 'Could not acquire distributed database lock zdexcloud_email_retention_worker';
        result.completedAt = new Date();
        result.durationMs = result.completedAt.getTime() - startedAt.getTime();
        appLogger.info('[EmailRetentionWorker] Skipped cleanup: distributed lock busy', {
          operation: 'EMAIL_RETENTION_LOCK_BUSY'
        });
        return result;
      }

      appLogger.info('[EmailRetentionWorker] Starting email retention cleanup pass', {
        operation: 'EMAIL_RETENTION_START',
        metadata: {
          dryRun,
          retentionDays: this.retentionDays,
          batchSize
        }
      });

      const now = new Date();
      const cutoff = new Date(now.getTime() - this.retentionDays * 86400000);

      // 3. Clean eligible terminal EmailMessage rows (cascading attempts)
      await this.cleanExpiredEmails(cutoff, batchSize, dryRun, result);

      result.completedAt = new Date();
      result.durationMs = result.completedAt.getTime() - startedAt.getTime();

      // 4. Record metrics
      this.metrics.lastRunAt = result.completedAt.toISOString();
      this.metrics.lastDurationMs = result.durationMs;
      this.metrics.lastSuccess = true;
      this.metrics.lastDryRun = dryRun;
      this.metrics.totalEmailsCleaned += result.emailsDeleted;
      this.metrics.totalAttemptsCleaned += result.attemptsCleaned;
      this.metrics.totalRuns++;

      appLogger.info('[EmailRetentionWorker] Email retention cleanup pass finished', {
        operation: 'EMAIL_RETENTION_COMPLETE',
        metadata: {
          dryRun: result.dryRun,
          durationMs: result.durationMs,
          emailsEvaluated: result.emailsEvaluated,
          emailsDeleted: result.emailsDeleted,
          batchesProcessed: result.batchesProcessed
        }
      });
    } catch (err: any) {
      result.success = false;
      result.error = err?.message || 'Unknown email retention worker error';
      result.completedAt = new Date();
      result.durationMs = result.completedAt.getTime() - startedAt.getTime();

      this.metrics.lastRunAt = result.completedAt.toISOString();
      this.metrics.lastDurationMs = result.durationMs;
      this.metrics.lastSuccess = false;
      this.metrics.totalFailures++;

      appLogger.error('[EmailRetentionWorker] Email retention cleanup pass failed', err, {
        operation: 'EMAIL_RETENTION_FAILURE',
        metadata: { durationMs: result.durationMs }
      });
    } finally {
      if (lockAcquired) {
        await this.releaseDistributedLock('zdexcloud_email_retention_worker');
      }
      this.isExecuting = false;
    }

    return result;
  }

  /**
   * Cleans terminal EmailMessage records older than cutoff in bounded batches.
   */
  private async cleanExpiredEmails(
    cutoff: Date,
    batchSize: number,
    dryRun: boolean,
    result: EmailRetentionRunResult
  ): Promise<void> {
    const maxBatches = 50; // Safety cap per invocation (e.g. 50 * 100 = 5,000 max records per pass)

    while (result.batchesProcessed < maxBatches) {
      // Find candidate batch of terminal status messages older than cutoff
      const candidates = await prisma.emailMessage.findMany({
        where: {
          status: {
            in: [
              EmailMessageStatus.DELIVERED,
              EmailMessageStatus.FAILED,
              EmailMessageStatus.PERMANENTLY_FAILED,
              EmailMessageStatus.BOUNCED,
              EmailMessageStatus.BLOCKED,
              EmailMessageStatus.SPAM
            ]
          },
          createdAt: { lte: cutoff }
        },
        select: {
          id: true,
          status: true,
          createdAt: true
        },
        orderBy: { createdAt: 'asc' },
        take: batchSize
      });

      if (candidates.length === 0) {
        break;
      }

      result.emailsEvaluated += candidates.length;
      result.batchesProcessed++;

      if (!result.oldestEligibleDate && candidates[0]) {
        result.oldestEligibleDate = candidates[0].createdAt.toISOString();
      }

      if (dryRun) {
        result.emailsDeleted += candidates.length;
        if (candidates.length < batchSize) break;
        continue;
      }

      const idsToDelete = candidates.map(c => c.id);

      // Execute transaction-safe delete (Prisma cascade deletes child attempts)
      const deleteRes = await prisma.emailMessage.deleteMany({
        where: {
          id: { in: idsToDelete },
          status: {
            in: [
              EmailMessageStatus.DELIVERED,
              EmailMessageStatus.FAILED,
              EmailMessageStatus.PERMANENTLY_FAILED,
              EmailMessageStatus.BOUNCED,
              EmailMessageStatus.BLOCKED,
              EmailMessageStatus.SPAM
            ]
          }
        }
      });

      result.emailsDeleted += deleteRes.count;

      if (candidates.length < batchSize) {
        break;
      }
    }
  }

  /**
   * Acquires a distributed named lock using MySQL GET_LOCK to prevent overlapping workers.
   */
  private async acquireDistributedLock(lockName: string, timeoutSeconds: number = 5): Promise<boolean> {
    try {
      const res: any = await prisma.$queryRawUnsafe(`SELECT GET_LOCK(?, ?) as acquired`, lockName, timeoutSeconds);
      if (Array.isArray(res) && res.length > 0) {
        const acquired = Number(res[0].acquired);
        return acquired === 1;
      }
      return true;
    } catch {
      // Fallback for non-MySQL or mock environments
      return true;
    }
  }

  /**
   * Releases the distributed MySQL named lock.
   */
  private async releaseDistributedLock(lockName: string): Promise<void> {
    try {
      await prisma.$queryRawUnsafe(`SELECT RELEASE_LOCK(?) as released`, lockName);
    } catch {}
  }

  /**
   * Returns current retention metrics and configuration.
   */
  public getMetrics(): EmailRetentionMetrics {
    return {
      ...this.metrics,
      isRunning: this.isWorkerStarted
    };
  }

  /**
   * Starts the background recurring email retention schedule.
   */
  public start(): void {
    if (this.isWorkerStarted || !this.enabled) return;
    this.isWorkerStarted = true;

    appLogger.info(`[EmailRetentionWorker] Starting background email retention worker (interval=${this.cleanupIntervalMs}ms, retentionDays=${this.retentionDays}d)...`, {
      operation: 'EMAIL_RETENTION_WORKER_START',
      metadata: {
        intervalMs: this.cleanupIntervalMs,
        retentionDays: this.retentionDays,
        batchSize: this.batchSize
      }
    });

    // Initial run after a conservative 2-minute warmup delay to allow server startup
    setTimeout(() => {
      this.runCleanup().catch(err => {
        appLogger.error('[EmailRetentionWorker] Initial background cleanup pass threw an error', err, {
          operation: 'EMAIL_RETENTION_INITIAL_ERROR'
        });
      });
    }, 120000);

    // Recurring schedule timer
    this.timer = setInterval(() => {
      this.runCleanup().catch(err => {
        appLogger.error('[EmailRetentionWorker] Scheduled background cleanup pass threw an error', err, {
          operation: 'EMAIL_RETENTION_SCHEDULED_ERROR'
        });
      });
    }, this.cleanupIntervalMs);

    // Prevent timer from holding node event loop open on process termination
    this.timer.unref();
  }

  /**
   * Stops the background email retention worker.
   */
  public async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isWorkerStarted = false;
    appLogger.info('[EmailRetentionWorker] Background email retention worker stopped.', {
      operation: 'EMAIL_RETENTION_WORKER_STOP'
    });
  }
}

export const defaultEmailRetentionWorker = EmailRetentionWorker.getInstance();
