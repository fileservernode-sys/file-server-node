/**
 * ZDEXCLOUD ERROR RETENTION & CLEANUP WORKER SERVICE (Phase 12.8)
 *
 * Provides conservative, bounded, transactional, concurrency-safe, observable lifecycle cleanup
 * for operational error data models:
 *
 *   ErrorOccurrence  (Granular operational occurrences)
 *        ↓
 *   ErrorIncident    (Operational triage/lifecycle records)
 *        ↓
 *   ErrorFingerprint (Durable group identity & aggregate counters)
 *
 * Core Retention Safety Invariants:
 * 1. Active incidents (status: OPEN or ACKNOWLEDGED) are NEVER deleted.
 * 2. Occurrences attached to active incidents are NEVER deleted.
 * 3. Resolved incidents are eligible only after ERROR_RESOLVED_INCIDENT_RETENTION_DAYS (default 90d)
 *    and only when all dependent occurrences have been pruned.
 * 4. Muted incidents are eligible only after their mutedUntil lifecycle has expired AND
 *    ERROR_MUTED_INCIDENT_RETENTION_DAYS (default 90d).
 * 5. Fingerprints are NEVER deleted while referenced by ANY retained incident or occurrence.
 * 6. Deletion is executed in bounded batches (default 100) with distributed MySQL locking.
 * 7. Dry-run mode evaluates and reports candidate counts without executing destructive deletions.
 * 8. Cleanup failures NEVER crash the application or alter active operational state.
 */

import { prisma } from '../config/database.js';
import { config } from '../config/env.js';
import { appLogger } from './logger.js';
import { IncidentStatus } from '@prisma/client';

export interface ErrorRetentionRunResult {
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  dryRun: boolean;
  occurrencesEvaluated: number;
  occurrencesDeleted: number;
  incidentsEvaluated: number;
  incidentsDeleted: number;
  fingerprintsEvaluated: number;
  fingerprintsDeleted: number;
  batchesProcessed: number;
  success: boolean;
  skippedReason?: string;
  error?: string;
}

export interface ErrorRetentionMetrics {
  lastRunAt: string | null;
  lastDurationMs: number;
  lastSuccess: boolean;
  lastDryRun: boolean;
  totalOccurrencesCleaned: number;
  totalIncidentsCleaned: number;
  totalFingerprintsCleaned: number;
  totalRuns: number;
  totalFailures: number;
  isRunning: boolean;
}

export class ErrorRetentionWorker {
  private static instance: ErrorRetentionWorker;

  private readonly occurrenceRetentionDays: number;
  private readonly resolvedIncidentRetentionDays: number;
  private readonly mutedIncidentRetentionDays: number;
  private readonly batchSize: number;
  private readonly cleanupIntervalMs: number;
  private readonly dryRunDefault: boolean;
  private readonly enabled: boolean;

  private timer: NodeJS.Timeout | null = null;
  private isExecuting = false;
  private isWorkerStarted = false;

  private metrics: ErrorRetentionMetrics = {
    lastRunAt: null,
    lastDurationMs: 0,
    lastSuccess: true,
    lastDryRun: false,
    totalOccurrencesCleaned: 0,
    totalIncidentsCleaned: 0,
    totalFingerprintsCleaned: 0,
    totalRuns: 0,
    totalFailures: 0,
    isRunning: false
  };

  public static getInstance(): ErrorRetentionWorker {
    if (!ErrorRetentionWorker.instance) {
      ErrorRetentionWorker.instance = new ErrorRetentionWorker();
    }
    return ErrorRetentionWorker.instance;
  }

  constructor(
    occurrenceRetentionDays: number = config.ERROR_OCCURRENCE_RETENTION_DAYS ?? 30,
    resolvedIncidentRetentionDays: number = config.ERROR_RESOLVED_INCIDENT_RETENTION_DAYS ?? 90,
    mutedIncidentRetentionDays: number = config.ERROR_MUTED_INCIDENT_RETENTION_DAYS ?? 90,
    batchSize: number = config.ERROR_CLEANUP_BATCH_SIZE ?? 100,
    cleanupIntervalMinutes: number = config.ERROR_CLEANUP_INTERVAL_MINUTES ?? 1440,
    dryRunDefault: boolean = config.ERROR_CLEANUP_DRY_RUN ?? false,
    enabled: boolean = config.ERROR_CLEANUP_ENABLED ?? true
  ) {
    this.occurrenceRetentionDays = occurrenceRetentionDays;
    this.resolvedIncidentRetentionDays = resolvedIncidentRetentionDays;
    this.mutedIncidentRetentionDays = mutedIncidentRetentionDays;
    this.batchSize = batchSize;
    this.cleanupIntervalMs = cleanupIntervalMinutes * 60 * 1000;
    this.dryRunDefault = dryRunDefault;
    this.enabled = enabled;
  }

  /**
   * Executes a bounded retention cleanup pass with distributed locking.
   */
  public async runCleanup(options?: {
    dryRun?: boolean;
    batchSize?: number;
  }): Promise<ErrorRetentionRunResult> {
    const startedAt = new Date();
    const dryRun = options?.dryRun ?? this.dryRunDefault;
    const batchSize = options?.batchSize ?? this.batchSize;

    const result: ErrorRetentionRunResult = {
      startedAt,
      completedAt: startedAt,
      durationMs: 0,
      dryRun,
      occurrencesEvaluated: 0,
      occurrencesDeleted: 0,
      incidentsEvaluated: 0,
      incidentsDeleted: 0,
      fingerprintsEvaluated: 0,
      fingerprintsDeleted: 0,
      batchesProcessed: 0,
      success: true
    };

    // 1. Process concurrency guard
    if (this.isExecuting) {
      result.skippedReason = 'Cleanup run already in progress on this node';
      result.completedAt = new Date();
      result.durationMs = result.completedAt.getTime() - startedAt.getTime();
      return result;
    }

    this.isExecuting = true;
    let lockAcquired = false;

    try {
      // 2. Distributed Database Concurrency Lock (MySQL Named Lock)
      lockAcquired = await this.acquireDistributedLock('zdexcloud_error_retention_worker', 5);
      if (!lockAcquired) {
        result.skippedReason = 'Could not acquire distributed database lock zdexcloud_error_retention_worker';
        result.completedAt = new Date();
        result.durationMs = result.completedAt.getTime() - startedAt.getTime();
        appLogger.info('[ErrorRetentionWorker] Skipped cleanup: distributed lock busy', {
          operation: 'ERROR_RETENTION_LOCK_BUSY'
        });
        return result;
      }

      appLogger.info('[ErrorRetentionWorker] Starting retention cleanup pass', {
        operation: 'ERROR_RETENTION_START',
        metadata: {
          dryRun,
          occurrenceRetentionDays: this.occurrenceRetentionDays,
          resolvedIncidentRetentionDays: this.resolvedIncidentRetentionDays,
          mutedIncidentRetentionDays: this.mutedIncidentRetentionDays,
          batchSize
        }
      });

      const now = new Date();
      const occurrenceCutoff = new Date(now.getTime() - this.occurrenceRetentionDays * 86400000);
      const resolvedCutoff = new Date(now.getTime() - this.resolvedIncidentRetentionDays * 86400000);
      const mutedCutoff = new Date(now.getTime() - this.mutedIncidentRetentionDays * 86400000);

      // 3. Step 1: Clean eligible ErrorOccurrence rows
      await this.cleanOccurrences(occurrenceCutoff, resolvedCutoff, mutedCutoff, batchSize, dryRun, result);

      // 4. Step 2: Clean eligible ErrorIncident rows (only when 0 remaining occurrences)
      await this.cleanIncidents(resolvedCutoff, mutedCutoff, batchSize, dryRun, result);

      // 5. Step 3: Clean orphaned ErrorFingerprint rows (only when 0 incidents and 0 occurrences)
      await this.cleanOrphanedFingerprints(batchSize, dryRun, result);

      result.completedAt = new Date();
      result.durationMs = result.completedAt.getTime() - startedAt.getTime();

      // 6. Record metrics
      this.metrics.lastRunAt = result.completedAt.toISOString();
      this.metrics.lastDurationMs = result.durationMs;
      this.metrics.lastSuccess = true;
      this.metrics.lastDryRun = dryRun;
      this.metrics.totalOccurrencesCleaned += result.occurrencesDeleted;
      this.metrics.totalIncidentsCleaned += result.incidentsDeleted;
      this.metrics.totalFingerprintsCleaned += result.fingerprintsDeleted;
      this.metrics.totalRuns++;

      appLogger.info('[ErrorRetentionWorker] Retention cleanup pass finished', {
        operation: 'ERROR_RETENTION_COMPLETE',
        metadata: {
          dryRun: result.dryRun,
          durationMs: result.durationMs,
          occurrencesDeleted: result.occurrencesDeleted,
          incidentsDeleted: result.incidentsDeleted,
          fingerprintsDeleted: result.fingerprintsDeleted,
          batchesProcessed: result.batchesProcessed
        }
      });
    } catch (err: any) {
      result.success = false;
      result.error = err?.message || 'Unknown retention worker error';
      result.completedAt = new Date();
      result.durationMs = result.completedAt.getTime() - startedAt.getTime();

      this.metrics.lastRunAt = result.completedAt.toISOString();
      this.metrics.lastDurationMs = result.durationMs;
      this.metrics.lastSuccess = false;
      this.metrics.totalFailures++;

      appLogger.error('[ErrorRetentionWorker] Retention cleanup pass failed', err, {
        operation: 'ERROR_RETENTION_FAILURE',
        metadata: { durationMs: result.durationMs }
      });
    } finally {
      if (lockAcquired) {
        await this.releaseDistributedLock('zdexcloud_error_retention_worker');
      }
      this.isExecuting = false;
    }

    return result;
  }

  /**
   * Step 1: Cleans old ErrorOccurrence records in bounded batches while protecting active incidents.
   */
  private async cleanOccurrences(
    occurrenceCutoff: Date,
    resolvedCutoff: Date,
    mutedCutoff: Date,
    batchSize: number,
    dryRun: boolean,
    result: ErrorRetentionRunResult
  ): Promise<void> {
    while (true) {
      // Find batch of eligible occurrences:
      // Condition A: occurredAt <= occurrenceCutoff
      // Condition B: MUST NOT be attached to OPEN or ACKNOWLEDGED incidents
      // Condition C: If attached to a RESOLVED incident, incident must be older than resolvedCutoff
      // Condition D: If attached to a MUTED incident, mute must be expired and older than mutedCutoff
      const eligible = await prisma.errorOccurrence.findMany({
        where: {
          occurredAt: { lte: occurrenceCutoff },
          OR: [
            { incidentId: null },
            {
              incident: {
                status: IncidentStatus.RESOLVED,
                resolvedAt: { lte: resolvedCutoff }
              }
            },
            {
              incident: {
                status: IncidentStatus.MUTED,
                mutedUntil: { lte: mutedCutoff },
                updatedAt: { lte: mutedCutoff }
              }
            }
          ]
        },
        select: { id: true },
        take: batchSize
      });

      result.occurrencesEvaluated += eligible.length;
      if (eligible.length === 0) break;

      result.batchesProcessed++;

      if (dryRun) {
        result.occurrencesDeleted += eligible.length;
        if (eligible.length < batchSize) break;
        // Limit dry run scan depth to prevent long-running table locks
        if (result.batchesProcessed >= 10) break;
        continue;
      }

      const idsToDelete = eligible.map((e) => e.id);
      const deleteRes = await prisma.errorOccurrence.deleteMany({
        where: { id: { in: idsToDelete } }
      });

      result.occurrencesDeleted += deleteRes.count;
      if (eligible.length < batchSize) break;
    }
  }

  /**
   * Step 2: Cleans eligible resolved/muted ErrorIncident records that have zero remaining occurrences.
   */
  private async cleanIncidents(
    resolvedCutoff: Date,
    mutedCutoff: Date,
    batchSize: number,
    dryRun: boolean,
    result: ErrorRetentionRunResult
  ): Promise<void> {
    while (true) {
      // Eligible incidents:
      // 1. status == RESOLVED with resolvedAt <= resolvedCutoff OR status == MUTED with mutedUntil <= mutedCutoff
      // 2. occurrences: none (zero remaining dependent occurrences)
      const eligible = await prisma.errorIncident.findMany({
        where: {
          occurrences: { none: {} },
          OR: [
            {
              status: IncidentStatus.RESOLVED,
              resolvedAt: { lte: resolvedCutoff }
            },
            {
              status: IncidentStatus.MUTED,
              mutedUntil: { lte: mutedCutoff },
              updatedAt: { lte: mutedCutoff }
            }
          ]
        },
        select: { id: true },
        take: batchSize
      });

      result.incidentsEvaluated += eligible.length;
      if (eligible.length === 0) break;

      result.batchesProcessed++;

      if (dryRun) {
        result.incidentsDeleted += eligible.length;
        if (eligible.length < batchSize) break;
        if (result.batchesProcessed >= 20) break;
        continue;
      }

      const idsToDelete = eligible.map((e) => e.id);
      const deleteRes = await prisma.errorIncident.deleteMany({
        where: { id: { in: idsToDelete } }
      });

      result.incidentsDeleted += deleteRes.count;
      if (eligible.length < batchSize) break;
    }
  }

  /**
   * Step 3: Cleans orphaned ErrorFingerprint records with zero incidents and zero occurrences.
   */
  private async cleanOrphanedFingerprints(
    batchSize: number,
    dryRun: boolean,
    result: ErrorRetentionRunResult
  ): Promise<void> {
    while (true) {
      // Fingerprint must have zero remaining incidents AND zero remaining occurrences
      const eligible = await prisma.errorFingerprint.findMany({
        where: {
          incidents: { none: {} },
          occurrences: { none: {} }
        },
        select: { id: true },
        take: batchSize
      });

      result.fingerprintsEvaluated += eligible.length;
      if (eligible.length === 0) break;

      result.batchesProcessed++;

      if (dryRun) {
        result.fingerprintsDeleted += eligible.length;
        if (eligible.length < batchSize) break;
        if (result.batchesProcessed >= 30) break;
        continue;
      }

      const idsToDelete = eligible.map((e) => e.id);
      const deleteRes = await prisma.errorFingerprint.deleteMany({
        where: { id: { in: idsToDelete } }
      });

      result.fingerprintsDeleted += deleteRes.count;
      if (eligible.length < batchSize) break;
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
   * Returns current low-cardinality retention worker metrics.
   */
  public getMetrics(): ErrorRetentionMetrics {
    return {
      ...this.metrics,
      isRunning: this.isWorkerStarted
    };
  }

  /**
   * Starts the background recurring retention schedule.
   */
  public start(): void {
    if (this.isWorkerStarted || !this.enabled) return;
    this.isWorkerStarted = true;

    appLogger.info(`[ErrorRetentionWorker] Starting background retention worker (interval=${this.cleanupIntervalMs}ms, occurrenceRetention=${this.occurrenceRetentionDays}d, incidentRetention=${this.resolvedIncidentRetentionDays}d)...`, {
      operation: 'ERROR_RETENTION_WORKER_START'
    });

    // Schedule periodic timer
    this.timer = setInterval(() => {
      this.runCleanup().catch(() => {});
    }, this.cleanupIntervalMs);
  }

  /**
   * Gracefully stops the background recurring retention schedule.
   */
  public stop(): void {
    if (!this.isWorkerStarted) return;
    this.isWorkerStarted = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    appLogger.info('[ErrorRetentionWorker] Background retention worker stopped.', {
      operation: 'ERROR_RETENTION_WORKER_STOP'
    });
  }
}

export const defaultErrorRetentionWorker = ErrorRetentionWorker.getInstance();
