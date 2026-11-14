/**
 * ZDEXCLOUD — CAMERA LIFECYCLE RECONCILIATION WORKER SERVICE (Phase 20.4.1)
 *
 * Schedules and executes periodic stale-camera & expired-stream-session reconciliation
 * by invoking `CameraLifecycleService.reconcileStaleCameras()` at a configurable interval.
 *
 * Key Operational Invariants:
 * 1. Non-blocking HTTP Startup: `start()` schedules initial work asynchronously via bounded
 *    delay and never blocks server readiness or `app.listen()`.
 * 2. Strict In-Process Overlap Prevention: Chained `setTimeout` after cycle settlement plus
 *    `isCycleRunning` mutex prevents overlapping executions within a worker instance.
 * 3. Multi-Instance Concurrency Safety: Stagger jitter reduces scan synchronization across
 *    replicas, while `CameraLifecycleService.reconcileStaleCameras()` enforces database-level
 *    single-winner `FOR UPDATE` locking and optimistic Compare-And-Set (`status`, `updatedAt`,
 *    `lastSeenAt` cutoff) so concurrent instances cannot produce duplicate transitions or audits.
 * 4. Failure Isolation & Secret Redaction: Exceptions inside reconciliation never crash the
 *    API process or halt future cycles; logged messages sanitize tokens, hashes, and DSNs.
 * 5. Graceful Shutdown: `stop()` cancels pending timers immediately and awaits any in-flight
 *    reconciliation cycle up to a bounded grace window.
 */

import os from 'node:os';
import { config } from '../config/env.js';
import { ValidationError } from '../errors/app-error.js';
import { appLogger, sanitizeLogString } from '../observability/logger.js';
import { metricsCollector } from '../observability/metrics.js';
import { errorIngestionService } from './error_ingestion_service.js';
import {
  CameraLifecycleService,
  type ReconcileStaleCamerasOptions,
  type ReconcileStaleCamerasResult
} from './camera_lifecycle_service.js';

export type CameraReconcileExecutor = (
  options?: ReconcileStaleCamerasOptions
) => Promise<ReconcileStaleCamerasResult>;

export interface CameraReconciliationWorkerOptions {
  workerId?: string;
  enabled?: boolean;
  intervalMs?: number;
  initialDelayMs?: number;
  runOnStartup?: boolean;
  maxJitterMs?: number;
  batchSize?: number;
  heartbeatTimeoutMs?: number;
  connectingTimeoutMs?: number;
  reconnectGraceMs?: number;
  reconcileFn?: CameraReconcileExecutor;
}

export interface CameraReconciliationRunOutcome {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  success: boolean;
  skipped: boolean;
  skippedReason?: string;
  error?: string;
  result?: ReconcileStaleCamerasResult;
}

export interface CameraReconciliationStopOptions {
  warnAfterMs?: number;
  timeoutMs?: number;
}

export interface CameraReconciliationStopResult {
  alreadyStopped: boolean;
  waitedForCycle: boolean;
  timedOut: boolean;
  cycleStillActive: boolean;
  elapsedMs: number;
}

export interface CameraReconciliationWorkerMetrics {
  workerId: string;
  enabled: boolean;
  isStarted: boolean;
  isExecuting: boolean;
  intervalMs: number;
  initialDelayMs: number;
  batchSize: number;
  startedAt: string | null;
  lastRunAt: string | null;
  lastDurationMs: number;
  lastSuccess: boolean;
  totalRuns: number;
  totalFailures: number;
  totalSkippedOverlap: number;
  totalExpiredSessionsTimedOut: number;
  totalStreamingReconciledToOnline: number;
  totalTransitionedToReconnecting: number;
  totalTransitionedToOffline: number;
  totalSkippedConcurrentOrFresh: number;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  lastResult: {
    evaluatedAt: string;
    camerasEvaluated: number;
    expiredSessionsTimedOut: number;
    streamingReconciledToOnline: number;
    transitionedToReconnecting: number;
    transitionedToOffline: number;
    skippedConcurrentOrFresh: number;
    cameraErrorCount: number;
  } | null;
}

export function sanitizeWorkerErrorMessage(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
      ? err
      : String(err ?? 'Unknown error');

  const scrubbed = raw
    .replace(/mysql:\/\/[^@\s]+@[^\s/]+/gi, 'mysql://***:***@***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+)?\b/g, '[REDACTED_JWT]')
    .replace(/\b(?:dst|cvt|pct|zdc|sess)_[A-Za-z0-9_-]{8,}/g, '[REDACTED_TOKEN]')
    .replace(/\b[a-f0-9]{32,}\b/gi, '[REDACTED_HASH]')
    .replace(/(password|secret|token|authorization|credentialHash|otp)\s*[:=]\s*\S+/gi, '$1=[REDACTED]');

  return sanitizeLogString(scrubbed, 300);
}

export function validateCameraReconciliationWorkerConfig(options: {
  enabled: boolean;
  intervalMs: number;
  initialDelayMs: number;
  runOnStartup: boolean;
  batchSize: number;
}): void {
  if (typeof options.enabled !== 'boolean') {
    throw new ValidationError('CAMERA_RECONCILIATION_ENABLED must be a boolean.');
  }
  if (typeof options.runOnStartup !== 'boolean') {
    throw new ValidationError('CAMERA_RECONCILIATION_RUN_ON_STARTUP must be a boolean.');
  }
  if (!Number.isInteger(options.intervalMs) || options.intervalMs < 5000 || options.intervalMs > 3600000) {
    throw new ValidationError(
      'CAMERA_RECONCILIATION_INTERVAL_MS must be an integer between 5000 and 3600000 milliseconds.'
    );
  }
  if (!Number.isInteger(options.initialDelayMs) || options.initialDelayMs < 0 || options.initialDelayMs > 300000) {
    throw new ValidationError(
      'CAMERA_RECONCILIATION_INITIAL_DELAY_MS must be an integer between 0 and 300000 milliseconds.'
    );
  }
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 500) {
    throw new ValidationError('CAMERA_RECONCILIATION_BATCH_SIZE must be an integer between 1 and 500.');
  }
}

export class CameraReconciliationWorker {
  private static instance: CameraReconciliationWorker;

  private readonly workerId: string;
  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private readonly initialDelayMs: number;
  private readonly runOnStartup: boolean;
  private readonly maxJitterMs: number;
  private readonly batchSize: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly connectingTimeoutMs: number;
  private readonly reconnectGraceMs: number;
  private readonly reconcileFn: CameraReconcileExecutor;

  private timer: NodeJS.Timeout | null = null;
  private isStarted = false;
  private isStopping = false;
  private isCycleRunning = false;
  private currentCyclePromise: Promise<CameraReconciliationRunOutcome> | null = null;
  private stopPromise: Promise<CameraReconciliationStopResult> | null = null;

  private startedAt: string | null = null;
  private lastRunAt: string | null = null;
  private lastDurationMs = 0;
  private lastSuccess = true;
  private totalRuns = 0;
  private totalFailures = 0;
  private totalSkippedOverlap = 0;
  private totalExpiredSessionsTimedOut = 0;
  private totalStreamingReconciledToOnline = 0;
  private totalTransitionedToReconnecting = 0;
  private totalTransitionedToOffline = 0;
  private totalSkippedConcurrentOrFresh = 0;
  private lastErrorAt: string | null = null;
  private lastErrorMessage: string | null = null;
  private lastResult: CameraReconciliationWorkerMetrics['lastResult'] = null;

  public static getInstance(): CameraReconciliationWorker {
    if (!CameraReconciliationWorker.instance) {
      CameraReconciliationWorker.instance = new CameraReconciliationWorker();
    }
    return CameraReconciliationWorker.instance;
  }

  constructor(options: CameraReconciliationWorkerOptions = {}) {
    const hostname = os.hostname().replace(/[^a-zA-Z0-9-]/g, '').toLowerCase() || 'node';
    const randSuffix = Math.random().toString(36).substring(2, 8);

    this.workerId = options.workerId || `camera-reconciler-${hostname}-${randSuffix}`;
    this.enabled = options.enabled ?? config.CAMERA_RECONCILIATION_ENABLED;
    this.intervalMs = options.intervalMs ?? config.CAMERA_RECONCILIATION_INTERVAL_MS;
    this.initialDelayMs = options.initialDelayMs ?? config.CAMERA_RECONCILIATION_INITIAL_DELAY_MS;
    this.runOnStartup = options.runOnStartup ?? config.CAMERA_RECONCILIATION_RUN_ON_STARTUP;
    this.batchSize = options.batchSize ?? config.CAMERA_RECONCILIATION_BATCH_SIZE;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? config.CAMERA_HEARTBEAT_TIMEOUT_MS;
    this.connectingTimeoutMs = options.connectingTimeoutMs ?? config.CAMERA_CONNECTING_TIMEOUT_MS;
    this.reconnectGraceMs = options.reconnectGraceMs ?? config.CAMERA_RECONNECT_GRACE_MS;

    validateCameraReconciliationWorkerConfig({
      enabled: this.enabled,
      intervalMs: this.intervalMs,
      initialDelayMs: this.initialDelayMs,
      runOnStartup: this.runOnStartup,
      batchSize: this.batchSize
    });

    this.maxJitterMs =
      options.maxJitterMs !== undefined
        ? Math.max(0, options.maxJitterMs)
        : Math.min(2000, Math.floor(this.intervalMs * 0.1));

    this.reconcileFn =
      options.reconcileFn ||
      ((opts) => CameraLifecycleService.reconcileStaleCameras(opts));
  }

  public getWorkerId(): string {
    return this.workerId;
  }

  public isRunning(): boolean {
    return this.isStarted;
  }

  public isExecuting(): boolean {
    return this.isCycleRunning;
  }

  public isShutdownRequested(): boolean {
    return this.isStopping;
  }

  public getMetrics(): CameraReconciliationWorkerMetrics {
    return {
      workerId: this.workerId,
      enabled: this.enabled,
      isStarted: this.isStarted,
      isExecuting: this.isCycleRunning,
      intervalMs: this.intervalMs,
      initialDelayMs: this.initialDelayMs,
      batchSize: this.batchSize,
      startedAt: this.startedAt,
      lastRunAt: this.lastRunAt,
      lastDurationMs: this.lastDurationMs,
      lastSuccess: this.lastSuccess,
      totalRuns: this.totalRuns,
      totalFailures: this.totalFailures,
      totalSkippedOverlap: this.totalSkippedOverlap,
      totalExpiredSessionsTimedOut: this.totalExpiredSessionsTimedOut,
      totalStreamingReconciledToOnline: this.totalStreamingReconciledToOnline,
      totalTransitionedToReconnecting: this.totalTransitionedToReconnecting,
      totalTransitionedToOffline: this.totalTransitionedToOffline,
      totalSkippedConcurrentOrFresh: this.totalSkippedConcurrentOrFresh,
      lastErrorAt: this.lastErrorAt,
      lastErrorMessage: this.lastErrorMessage,
      lastResult: this.lastResult ? { ...this.lastResult } : null
    };
  }

  /**
   * Starts periodic reconciliation scheduling without blocking HTTP server startup.
   */
  public start(): void {
    if (this.isStarted || this.isStopping || this.isCycleRunning) return;

    if (!this.enabled) {
      appLogger.info('[CameraReconciliationWorker] Periodic camera reconciliation disabled by configuration', {
        operation: 'CAMERA_RECONCILIATION_WORKER_DISABLED',
        metadata: { workerId: this.workerId }
      });
      return;
    }

    this.isStarted = true;
    this.startedAt = new Date().toISOString();

    appLogger.info(
      `[CameraReconciliationWorker] Starting periodic camera reconciliation (${this.workerId}, interval=${this.intervalMs}ms, batchSize=${this.batchSize})`,
      {
        operation: 'CAMERA_RECONCILIATION_WORKER_START',
        metadata: {
          workerId: this.workerId,
          intervalMs: this.intervalMs,
          initialDelayMs: this.initialDelayMs,
          runOnStartup: this.runOnStartup,
          batchSize: this.batchSize
        }
      }
    );

    const firstDelay = this.runOnStartup
      ? this.initialDelayMs
      : this.computeNextDelayMs();
    this.scheduleNextTick(firstDelay);
  }

  /**
   * Stops future scheduling immediately, prevents subsequent cycles from starting,
   * clears pending timers, and waits safely for any active DB reconciliation cycle
   * before returning (so Prisma never disconnects mid-cycle).
   */
  public async stop(
    options?: number | CameraReconciliationStopOptions
  ): Promise<CameraReconciliationStopResult> {
    const resolvedOptions: CameraReconciliationStopOptions =
      typeof options === 'number' ? { timeoutMs: options } : options || {};
    const warnAfterMs = resolvedOptions.warnAfterMs ?? 10000;
    const explicitTimeoutMs = resolvedOptions.timeoutMs;

    const wasStarted = this.isStarted;
    const wasAlreadyStopping = this.isStopping;
    this.isStarted = false;
    this.isStopping = true;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    // Deduplicate concurrent stop() calls by awaiting the in-flight shutdown barrier
    if (this.stopPromise) {
      return this.stopPromise;
    }

    if (!this.currentCyclePromise && !this.isCycleRunning) {
      if (wasStarted && !wasAlreadyStopping) {
        appLogger.info(`[CameraReconciliationWorker] Stopped cleanly (${this.workerId})`, {
          operation: 'CAMERA_RECONCILIATION_WORKER_STOP',
          metadata: {
            workerId: this.workerId,
            totalRuns: this.totalRuns,
            totalFailures: this.totalFailures
          }
        });
      }
      return {
        alreadyStopped: !wasStarted && wasAlreadyStopping,
        waitedForCycle: false,
        timedOut: false,
        cycleStillActive: false,
        elapsedMs: 0
      };
    }

    const stopStartedAt = Date.now();
    this.stopPromise = (async (): Promise<CameraReconciliationStopResult> => {
      const cyclePromise = this.currentCyclePromise;
      let warnTimer: NodeJS.Timeout | null = null;
      let timeoutHandle: NodeJS.Timeout | null = null;
      let timedOut = false;

      if (warnAfterMs > 0) {
        warnTimer = setTimeout(() => {
          appLogger.warn(
            `[CameraReconciliationWorker] Shutdown still waiting on active reconciliation cycle (${this.workerId}); holding database disconnect`,
            {
              operation: 'CAMERA_RECONCILIATION_WORKER_STOP_WAITING',
              metadata: {
                workerId: this.workerId,
                elapsedMs: Date.now() - stopStartedAt
              }
            }
          );
        }, warnAfterMs);
        warnTimer.unref?.();
      }

      try {
        if (cyclePromise) {
          if (typeof explicitTimeoutMs === 'number' && Number.isFinite(explicitTimeoutMs) && explicitTimeoutMs > 0) {
            await Promise.race([
              cyclePromise.catch(() => undefined),
              new Promise<void>((resolve) => {
                timeoutHandle = setTimeout(() => {
                  if (this.isCycleRunning) {
                    timedOut = true;
                  }
                  resolve();
                }, explicitTimeoutMs);
                timeoutHandle.unref?.();
              })
            ]);
          } else {
            // Default shutdown mode: wait until the active reconciliation cycle finishes cleanly
            await cyclePromise.catch(() => undefined);
          }
        }
      } finally {
        if (warnTimer) clearTimeout(warnTimer);
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }

      const elapsedMs = Math.max(0, Date.now() - stopStartedAt);

      if (timedOut || this.isCycleRunning) {
        appLogger.error(
          `[CameraReconciliationWorker] Shutdown timeout (${explicitTimeoutMs ?? 'bounded'}ms) reached while reconciliation cycle is still active (${this.workerId})`,
          undefined,
          {
            operation: 'CAMERA_RECONCILIATION_STOP_TIMEOUT',
            metadata: {
              workerId: this.workerId,
              elapsedMs,
              cycleStillActive: this.isCycleRunning
            }
          }
        );
        const timeoutErr: any = new Error(
          `Camera reconciliation worker shutdown timed out after ${elapsedMs}ms while database cycle is still active.`
        );
        timeoutErr.code = 'CAMERA_RECONCILIATION_SHUTDOWN_TIMEOUT';
        throw timeoutErr;
      }

      appLogger.info(`[CameraReconciliationWorker] Stopped cleanly (${this.workerId})`, {
        operation: 'CAMERA_RECONCILIATION_WORKER_STOP',
        metadata: {
          workerId: this.workerId,
          waitedForCycle: true,
          elapsedMs,
          totalRuns: this.totalRuns,
          totalFailures: this.totalFailures
        }
      });

      return {
        alreadyStopped: false,
        waitedForCycle: true,
        timedOut: false,
        cycleStillActive: false,
        elapsedMs
      };
    })().finally(() => {
      this.stopPromise = null;
    });

    return this.stopPromise;
  }

  private computeNextDelayMs(): number {
    if (this.maxJitterMs <= 0) return this.intervalMs;
    const jitter = Math.floor(Math.random() * (this.maxJitterMs + 1));
    return this.intervalMs + jitter;
  }

  private scheduleNextTick(delayMs: number = this.computeNextDelayMs()): void {
    if (!this.isStarted || this.isStopping) return;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.isStarted || this.isStopping) return;

      this.runCycle()
        .catch(() => undefined)
        .finally(() => {
          if (this.isStarted && !this.isStopping) {
            this.scheduleNextTick();
          }
        });
    }, delayMs);

    this.timer.unref?.();
  }

  /**
   * Executes one stale-camera reconciliation pass with strict overlap & shutdown protection,
   * failure isolation, sanitized error logging, and telemetry aggregation.
   */
  public async runCycle(): Promise<CameraReconciliationRunOutcome> {
    const startedDate = new Date();
    const startedAtIso = startedDate.toISOString();

    if (this.isStopping) {
      return {
        startedAt: startedAtIso,
        completedAt: startedAtIso,
        durationMs: 0,
        success: true,
        skipped: true,
        skippedReason: 'Worker shutdown in progress'
      };
    }

    if (this.isCycleRunning) {
      this.totalSkippedOverlap++;
      return {
        startedAt: startedAtIso,
        completedAt: startedAtIso,
        durationMs: 0,
        success: true,
        skipped: true,
        skippedReason: 'Reconciliation cycle already in progress on this worker'
      };
    }

    this.isCycleRunning = true;
    const cyclePromise = this.executeCycleInternal(startedDate, startedAtIso);
    this.currentCyclePromise = cyclePromise;

    try {
      return await cyclePromise;
    } finally {
      this.isCycleRunning = false;
      this.currentCyclePromise = null;
    }
  }

  private async executeCycleInternal(
    startedDate: Date,
    startedAtIso: string
  ): Promise<CameraReconciliationRunOutcome> {
    this.totalRuns++;

    appLogger.debug('[CameraReconciliationWorker] Reconciliation cycle started', {
      operation: 'CAMERA_RECONCILIATION_CYCLE_START',
      metadata: {
        workerId: this.workerId,
        batchSize: this.batchSize
      }
    });

    try {
      const result = await this.reconcileFn({
        now: startedDate,
        heartbeatTimeoutMs: this.heartbeatTimeoutMs,
        connectingTimeoutMs: this.connectingTimeoutMs,
        reconnectGraceMs: this.reconnectGraceMs,
        batchSize: this.batchSize
      });

      const completedDate = new Date();
      const durationMs = Math.max(0, completedDate.getTime() - startedDate.getTime());

      this.lastRunAt = completedDate.toISOString();
      this.lastDurationMs = durationMs;
      this.lastSuccess = true;
      this.totalExpiredSessionsTimedOut += result.expiredSessionsTimedOut;
      this.totalStreamingReconciledToOnline += result.streamingReconciledToOnline;
      this.totalTransitionedToReconnecting += result.transitionedToReconnecting;
      this.totalTransitionedToOffline += result.transitionedToOffline;
      this.totalSkippedConcurrentOrFresh += result.skippedConcurrentOrFresh;

      this.lastResult = {
        evaluatedAt: result.evaluatedAt,
        camerasEvaluated: result.camerasEvaluated,
        expiredSessionsTimedOut: result.expiredSessionsTimedOut,
        streamingReconciledToOnline: result.streamingReconciledToOnline,
        transitionedToReconnecting: result.transitionedToReconnecting,
        transitionedToOffline: result.transitionedToOffline,
        skippedConcurrentOrFresh: result.skippedConcurrentOrFresh,
        cameraErrorCount: result.errors.length
      };

      const totalChanges =
        result.expiredSessionsTimedOut +
        result.streamingReconciledToOnline +
        result.transitionedToReconnecting +
        result.transitionedToOffline;

      if (result.errors.length > 0) {
        appLogger.warn('[CameraReconciliationWorker] Reconciliation cycle completed with per-camera warnings', {
          operation: 'CAMERA_RECONCILIATION_CYCLE_COMPLETED',
          metadata: {
            workerId: this.workerId,
            durationMs,
            ...this.lastResult
          }
        });
      } else if (totalChanges > 0) {
        appLogger.info('[CameraReconciliationWorker] Reconciliation cycle completed with camera transitions', {
          operation: 'CAMERA_RECONCILIATION_CYCLE_COMPLETED',
          metadata: {
            workerId: this.workerId,
            durationMs,
            ...this.lastResult
          }
        });
      } else {
        appLogger.debug('[CameraReconciliationWorker] Reconciliation cycle completed (idle)', {
          operation: 'CAMERA_RECONCILIATION_CYCLE_COMPLETED',
          metadata: {
            workerId: this.workerId,
            durationMs,
            camerasEvaluated: result.camerasEvaluated,
            skippedConcurrentOrFresh: result.skippedConcurrentOrFresh
          }
        });
      }

      return {
        startedAt: startedAtIso,
        completedAt: completedDate.toISOString(),
        durationMs,
        success: true,
        skipped: false,
        result
      };
    } catch (err: unknown) {
      const completedDate = new Date();
      const durationMs = Math.max(0, completedDate.getTime() - startedDate.getTime());
      const safeMessage = sanitizeWorkerErrorMessage(err);

      this.totalFailures++;
      this.lastSuccess = false;
      this.lastRunAt = completedDate.toISOString();
      this.lastDurationMs = durationMs;
      this.lastErrorAt = this.lastRunAt;
      this.lastErrorMessage = safeMessage;

      appLogger.error('[CameraReconciliationWorker] Reconciliation cycle failed cleanly', undefined, {
        operation: 'CAMERA_RECONCILIATION_CYCLE_FAILED',
        durationMs,
        metadata: {
          workerId: this.workerId,
          durationMs,
          errorMessage: safeMessage
        }
      });

      try {
        metricsCollector.recordCameraLifecycleTransitionFailure('INTERNAL_ERROR');
      } catch {
        // Observability failure must never impact worker fault isolation
      }

      try {
        void errorIngestionService
          .ingest({
            error: err,
            component: 'CAMERA_RECONCILIATION',
            severity: 'ERROR',
            errorCode: 'CAMERA_RECONCILIATION_CYCLE_FAILED',
            message: safeMessage,
            metadata: {
              workerId: this.workerId,
              durationMs,
              totalFailures: this.totalFailures
            }
          })
          .catch(() => {});
      } catch {
        // Observability failure must never impact worker fault isolation
      }

      return {
        startedAt: startedAtIso,
        completedAt: completedDate.toISOString(),
        durationMs,
        success: false,
        skipped: false,
        error: safeMessage
      };
    }
  }
}

export const defaultCameraReconciliationWorker = CameraReconciliationWorker.getInstance();
