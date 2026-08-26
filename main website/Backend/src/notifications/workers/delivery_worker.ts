/**
 * RemoteNode Background Notification Delivery Worker Service
 * Track 4 — Batch NT-1.5 Architecture
 */

import os from 'node:os';
import { config } from '../../config/env.js';
import { DeliveryProcessor, defaultDeliveryProcessor, DeliveryProcessorResult } from './delivery_processor.js';
import { notificationMetrics, NotificationMetricsSnapshot } from '../services/notification_metrics.js';

export type WorkerStatus = 'STARTING' | 'RUNNING' | 'STOPPING' | 'STOPPED' | 'DEGRADED';

export interface DeliveryWorkerOptions {
  workerId?: string;
  enabled?: boolean;
  pollIntervalMs?: number;
  batchSize?: number;
  leaseTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  processor?: DeliveryProcessor;
}

export interface WorkerHealthStatus {
  workerId: string;
  status: WorkerStatus;
  enabled: boolean;
  startedAt: Date | null;
  lastHeartbeatAt: Date | null;
  lastPollAt: Date | null;
  lastSuccessfulPollAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorMessage: string | null;
  currentProcessingCount: number;
  totalProcessedCount: number;
  totalDeliveredCount: number;
  metricsSnapshot: NotificationMetricsSnapshot;
}

export class DeliveryWorker {
  private readonly workerId: string;
  private readonly enabled: boolean;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly leaseTimeoutMs: number;
  private readonly shutdownTimeoutMs: number;
  private readonly processor: DeliveryProcessor;

  private status: WorkerStatus = 'STOPPED';
  private startedAt: Date | null = null;
  private lastHeartbeatAt: Date | null = null;
  private lastPollAt: Date | null = null;
  private lastSuccessfulPollAt: Date | null = null;
  private lastErrorAt: Date | null = null;
  private lastErrorMessage: string | null = null;
  private currentProcessingCount = 0;
  private totalProcessedCount = 0;
  private totalDeliveredCount = 0;

  private pollTimer: NodeJS.Timeout | null = null;
  private isTickRunning = false;

  constructor(options: DeliveryWorkerOptions = {}) {
    const hostname = os.hostname().replace(/[^a-zA-Z0-9-]/g, '').toLowerCase() || 'node';
    const randId = Math.random().toString(36).substring(2, 8);
    this.workerId = options.workerId || `notification-worker-${hostname}-${randId}`;

    this.enabled = options.enabled ?? (config.NOTIFICATION_WORKER_ENABLED ?? true);
    this.pollIntervalMs = options.pollIntervalMs ?? (config.NOTIFICATION_WORKER_POLL_INTERVAL_MS ?? 5000);
    this.batchSize = options.batchSize ?? (config.NOTIFICATION_WORKER_BATCH_SIZE ?? 20);
    this.leaseTimeoutMs = options.leaseTimeoutMs ?? (config.NOTIFICATION_WORKER_LEASE_MS ?? 300000);
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? (config.NOTIFICATION_WORKER_SHUTDOWN_TIMEOUT_MS ?? 10000);
    this.processor = options.processor || defaultDeliveryProcessor;
  }

  public getWorkerId(): string {
    return this.workerId;
  }

  public getStatus(): WorkerHealthStatus {
    return {
      workerId: this.workerId,
      status: this.status,
      enabled: this.enabled,
      startedAt: this.startedAt,
      lastHeartbeatAt: this.lastHeartbeatAt,
      lastPollAt: this.lastPollAt,
      lastSuccessfulPollAt: this.lastSuccessfulPollAt,
      lastErrorAt: this.lastErrorAt,
      lastErrorMessage: this.lastErrorMessage,
      currentProcessingCount: this.currentProcessingCount,
      totalProcessedCount: this.totalProcessedCount,
      totalDeliveredCount: this.totalDeliveredCount,
      metricsSnapshot: notificationMetrics.getSnapshot()
    };
  }

  public start(): void {
    if (!this.enabled) {
      console.log(`[DeliveryWorker] Worker ${this.workerId} is disabled by configuration (NOTIFICATION_WORKER_ENABLED=false).`);
      this.status = 'STOPPED';
      return;
    }

    if (this.status === 'RUNNING' || this.status === 'STARTING') {
      return;
    }

    this.status = 'STARTING';
    this.startedAt = new Date();
    console.log(`[DeliveryWorker] Starting notification delivery worker ${this.workerId} (pollInterval=${this.pollIntervalMs}ms, batchSize=${this.batchSize})...`);

    this.status = 'RUNNING';
    
    // Execute initial tick immediately
    this.executeTick().catch(() => {});

    // Schedule periodic polling tick
    this.pollTimer = setInterval(() => {
      this.executeTick().catch(() => {});
    }, this.pollIntervalMs);
  }

  public async executeTick(): Promise<DeliveryProcessorResult> {
    if (this.isTickRunning || this.status === 'STOPPING' || this.status === 'STOPPED') {
      return { processedCount: 0, deliveredCount: 0, retryingCount: 0, failedCount: 0 };
    }

    this.isTickRunning = true;
    const now = new Date();
    this.lastPollAt = now;
    this.lastHeartbeatAt = now;
    notificationMetrics.recordPollingCycle();

    try {
      const res = await this.processor.processPendingDeliveries(
        this.batchSize,
        this.workerId,
        this.leaseTimeoutMs
      );

      this.lastSuccessfulPollAt = new Date();
      this.totalProcessedCount += res.processedCount;
      this.totalDeliveredCount += res.deliveredCount;

      if (this.status === 'DEGRADED') {
        this.status = 'RUNNING';
      }

      return res;
    } catch (err: any) {
      this.lastErrorAt = new Date();
      this.lastErrorMessage = err?.message || String(err);
      this.status = 'DEGRADED';
      console.error(`[DeliveryWorker] Error during worker tick (${this.workerId}):`, err);
      return { processedCount: 0, deliveredCount: 0, retryingCount: 0, failedCount: 0 };
    } finally {
      this.isTickRunning = false;
    }
  }

  public async stop(): Promise<void> {
    if (this.status === 'STOPPED') {
      return;
    }

    console.log(`[DeliveryWorker] Stopping worker ${this.workerId}...`);
    this.status = 'STOPPING';

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    const startWait = Date.now();
    while (this.isTickRunning && Date.now() - startWait < this.shutdownTimeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    this.status = 'STOPPED';
    console.log(`[DeliveryWorker] Worker ${this.workerId} stopped cleanly.`);
  }
}

export const defaultDeliveryWorker = new DeliveryWorker();
