/**
 * ZdexCloud Invoice Notification Outbox Worker Service
 * Phase 8.4 Batch E.4 Architecture
 *
 * Implements a durable, bounded, fenced transactional outbox worker for customer statutory
 * invoice availability notifications.
 *
 * Core Fencing & Dispatch Invariants:
 * 1. Single-Owner Dispatch: Evaluates INVOICE_NOTIFICATION_DISPATCH_MODE. Worker ONLY dispatches
 *    when mode is 'OUTBOX_WORKER' and worker is enabled.
 * 2. Short Transactions: Row claim and state updates happen in short atomic DB transactions.
 *    Network transport (Brevo API/SMTP) is NEVER executed inside a database transaction.
 * 3. Monotonic Fencing: Claim acquisition increments `claimVersion`. State updates verify
 *    `claimVersion = :expectedVersion`. Stale workers cannot overwrite database rows.
 * 4. Durable Transport Boundary: `transportStartedAt` is durably persisted BEFORE opening
 *    the transport network socket.
 * 5. Crash Recovery & Ambiguity Quarantine:
 *    - Crash before transport start (`transportStartedAt IS NULL`): Sweeper resets to `PENDING` for safe retry.
 *    - Crash during/after transport start (`transportStartedAt IS NOT NULL`): Quarantined as `AMBIGUOUS_OUTCOME`.
 *      Automated retries are permanently forbidden until matching webhook or operator resolution.
 * 6. Historical Invoice Invariant: Does NOT reissue invoices, mutate tax snapshots, or regenerate invoice numbers.
 */

import os from 'node:os';
import { prisma } from '../../config/database.js';
import { config } from '../../config/env.js';
import { appLogger } from '../../observability/logger.js';
import {
  InvoiceNotificationOutboxStatus,
  EmailMessageStatus,
  Prisma
} from '@prisma/client';
import { BillingInvoiceNotificationService } from './billing_invoice_notification_service.js';
import { billingEventProducer } from '../../notifications/producers/billing_producer.js';
import {
  classifyEmailFailure,
  EmailFailureDisposition,
  calculateNextRetryDate,
  sanitizeFailureReason
} from '../email_failure_classifier.js';
import { sanitizeJsonPayload } from '../../utils/email_sanitizer.js';

export interface OutboxWorkerOptions {
  workerId?: string;
  enabled?: boolean;
  pollIntervalMs?: number;
  batchSize?: number;
  leaseTimeoutMs?: number;
}

export interface OutboxBatchResult {
  processedCount: number;
  dispatchedCount: number;
  reclaimedCount: number;
  quarantinedCount: number;
  transientFailureCount: number;
  permanentFailureCount: number;
  staleFencingCount: number;
  skippedShadowCount: number;
}

export class InvoiceNotificationOutboxWorker {
  private static instance: InvoiceNotificationOutboxWorker;

  private readonly workerId: string;
  private readonly enabled: boolean;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly leaseTimeoutMs: number;

  private pollTimer: NodeJS.Timeout | null = null;
  private isTickRunning = false;
  private isStarted = false;

  public static getInstance(options?: OutboxWorkerOptions): InvoiceNotificationOutboxWorker {
    if (!InvoiceNotificationOutboxWorker.instance) {
      InvoiceNotificationOutboxWorker.instance = new InvoiceNotificationOutboxWorker(options);
    }
    return InvoiceNotificationOutboxWorker.instance;
  }

  constructor(options: OutboxWorkerOptions = {}) {
    const hostname = os.hostname().replace(/[^a-zA-Z0-9-]/g, '').toLowerCase() || 'node';
    const randId = Math.random().toString(36).substring(2, 8);
    this.workerId = options.workerId || `outbox-worker-${hostname}-${randId}`;

    this.enabled = options.enabled ?? (config.INVOICE_OUTBOX_WORKER_ENABLED ?? false);
    this.pollIntervalMs = options.pollIntervalMs ?? (config.INVOICE_OUTBOX_WORKER_POLL_INTERVAL_MS ?? 5000);
    this.batchSize = options.batchSize ?? (config.INVOICE_OUTBOX_WORKER_BATCH_SIZE ?? 10);
    this.leaseTimeoutMs = options.leaseTimeoutMs ?? (config.INVOICE_OUTBOX_WORKER_LEASE_MS ?? 300000);
  }

  public getWorkerId(): string {
    return this.workerId;
  }

  public isRunning(): boolean {
    return this.isStarted && !this.isTickRunning;
  }

  /**
   * Starts background worker loop if configuration authorizes it.
   */
  public start(): void {
    if (this.isStarted) return;

    const dispatchMode = config.INVOICE_NOTIFICATION_DISPATCH_MODE;
    if (dispatchMode !== 'OUTBOX_WORKER') {
      appLogger.info('[InvoiceOutboxWorker] Outbox worker NOT started: dispatch mode is not OUTBOX_WORKER', {
        operation: 'OUTBOX_WORKER_STANDBY',
        metadata: { currentMode: dispatchMode }
      });
      return;
    }

    if (!this.enabled) {
      appLogger.info('[InvoiceOutboxWorker] Outbox worker is disabled by configuration (INVOICE_OUTBOX_WORKER_ENABLED=false)');
      return;
    }

    this.isStarted = true;
    appLogger.info(`[InvoiceOutboxWorker] Starting background worker daemon (${this.workerId})`, {
      operation: 'OUTBOX_WORKER_START',
      metadata: {
        workerId: this.workerId,
        pollIntervalMs: this.pollIntervalMs,
        batchSize: this.batchSize,
        leaseTimeoutMs: this.leaseTimeoutMs
      }
    });

    this.scheduleNextPoll();
  }

  /**
   * Stops background worker cleanly.
   */
  public async stop(): Promise<void> {
    if (!this.isStarted) return;
    this.isStarted = false;

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    appLogger.info(`[InvoiceOutboxWorker] Stopping worker (${this.workerId})`, {
      operation: 'OUTBOX_WORKER_STOP',
      metadata: { workerId: this.workerId }
    });

    // Await active tick completion up to 10 seconds
    const startWait = Date.now();
    while (this.isTickRunning && Date.now() - startWait < 10000) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  private scheduleNextPoll(): void {
    if (!this.isStarted) return;
    this.pollTimer = setTimeout(async () => {
      try {
        await this.processTick();
      } catch (err: any) {
        appLogger.error('[InvoiceOutboxWorker] Unexpected error in worker process tick', err, {
          operation: 'OUTBOX_WORKER_TICK_ERROR',
          metadata: { workerId: this.workerId }
        });
      } finally {
        this.scheduleNextPoll();
      }
    }, this.pollIntervalMs);
  }

  /**
   * Executes a single bounded poll and recovery sweep.
   */
  public async processTick(): Promise<OutboxBatchResult> {
    const result: OutboxBatchResult = {
      processedCount: 0,
      dispatchedCount: 0,
      reclaimedCount: 0,
      quarantinedCount: 0,
      transientFailureCount: 0,
      permanentFailureCount: 0,
      staleFencingCount: 0,
      skippedShadowCount: 0
    };

    if (this.isTickRunning) return result;
    this.isTickRunning = true;

    try {
      // 1. Safety Check: Verify dispatch ownership mode
      const dispatchMode = config.INVOICE_NOTIFICATION_DISPATCH_MODE;
      if (dispatchMode !== 'OUTBOX_WORKER') {
        // Mode changed or worker invoked in non-worker mode. Refuse to dispatch.
        return result;
      }

      // 2. Supervisory Pass: Sweep expired worker leases
      await this.sweepExpiredLeases(result);

      // 3. Dispatch Pass: Claim and process ready rows
      await this.processReadyBatch(result);

    } finally {
      this.isTickRunning = false;
    }

    return result;
  }

  /**
   * Supervisory sweeper: Reclaims expired leases.
   * If transport never began (transportStartedAt IS NULL), resets to PENDING for safe retry.
   * If transport may have begun (transportStartedAt IS NOT NULL), quarantines to AMBIGUOUS_OUTCOME.
   */
  public async sweepExpiredLeases(result: OutboxBatchResult): Promise<void> {
    const now = new Date();

    // Query bounded batch of expired claimed records
    const expiredRows = await prisma.invoiceNotificationOutbox.findMany({
      where: {
        status: InvoiceNotificationOutboxStatus.CLAIMED,
        claimExpiresAt: { lte: now }
      },
      select: {
        id: true,
        claimVersion: true,
        transportStartedAt: true,
        attemptCount: true,
        maxAttempts: true,
        invoiceNumber: true
      },
      orderBy: { claimExpiresAt: 'asc' },
      take: this.batchSize
    });

    for (const row of expiredRows) {
      if (row.transportStartedAt === null) {
        // Safe Condition: Zero external I/O occurred before crash
        const nextAttempt = row.attemptCount >= row.maxAttempts
          ? InvoiceNotificationOutboxStatus.EXHAUSTED
          : InvoiceNotificationOutboxStatus.PENDING;

        const nextDelay = calculateNextRetryDate(row.attemptCount);

        const updateRes = await prisma.$executeRawUnsafe(
          `UPDATE \`InvoiceNotificationOutbox\`
           SET \`status\` = ?,
               \`claimedBy\` = NULL,
               \`claimedAt\` = NULL,
               \`claimExpiresAt\` = NULL,
               \`nextAttemptAt\` = ?,
               \`claimVersion\` = \`claimVersion\` + 1,
               \`updatedAt\` = NOW(3)
           WHERE \`id\` = ? AND \`claimVersion\` = ? AND \`status\` = 'CLAIMED'`,
          nextAttempt,
          nextDelay,
          row.id,
          row.claimVersion
        );

        if (updateRes > 0) {
          result.reclaimedCount++;
          appLogger.info('[InvoiceOutboxWorker] Expired lease safely reclaimed (no transport started)', {
            operation: 'OUTBOX_LEASE_RECLAIMED',
            metadata: {
              outboxId: row.id,
              invoiceNumber: row.invoiceNumber,
              newStatus: nextAttempt
            }
          });
        }
      } else {
        // Uncertain Condition: Transport started, outcome is unknown. Mandatory quarantine!
        const updateRes = await prisma.$executeRawUnsafe(
          `UPDATE \`InvoiceNotificationOutbox\`
           SET \`status\` = 'AMBIGUOUS_OUTCOME',
               \`ambiguousAt\` = NOW(3),
               \`ambiguousReason\` = 'Worker lease expired after transport initiation without confirmed result',
               \`claimedBy\` = NULL,
               \`claimExpiresAt\` = NULL,
               \`claimVersion\` = \`claimVersion\` + 1,
               \`updatedAt\` = NOW(3)
           WHERE \`id\` = ? AND \`claimVersion\` = ? AND \`status\` = 'CLAIMED'`,
          row.id,
          row.claimVersion
        );

        if (updateRes > 0) {
          result.quarantinedCount++;
          appLogger.warn('[InvoiceOutboxWorker] Lease expired after transport start; quarantined as AMBIGUOUS_OUTCOME', {
            operation: 'OUTBOX_AMBIGUOUS_QUARANTINE',
            metadata: {
              outboxId: row.id,
              invoiceNumber: row.invoiceNumber,
              transportStartedAt: row.transportStartedAt
            }
          });
        }
      }
    }
  }

  /**
   * Dispatch Pass: Atomically claims sendable rows and executes transport.
   */
  public async processReadyBatch(result: OutboxBatchResult): Promise<void> {
    const now = new Date();

    // 1. Fetch candidate IDs eligible for processing
    // Note: SHADOW_PENDING, AMBIGUOUS_OUTCOME, HISTORICAL_UNTRACKED, and EXHAUSTED are excluded by query!
    const candidates = await prisma.invoiceNotificationOutbox.findMany({
      where: {
        status: {
          in: [
            InvoiceNotificationOutboxStatus.PENDING,
            InvoiceNotificationOutboxStatus.RETRYABLE_FAILURE
          ]
        },
        OR: [
          { nextAttemptAt: null },
          { nextAttemptAt: { lte: now } }
        ]
      },
      select: {
        id: true,
        claimVersion: true
      },
      orderBy: { createdAt: 'asc' },
      take: this.batchSize
    });

    if (candidates.length === 0) return;

    for (const candidate of candidates) {
      result.processedCount++;
      await this.claimAndDispatchRecord(candidate.id, candidate.claimVersion, result);
    }
  }

  /**
   * Claims a single row atomically using monotonic claimVersion, then dispatches outside DB transaction.
   */
  private async claimAndDispatchRecord(
    recordId: string,
    expectedVersion: bigint,
    batchResult: OutboxBatchResult
  ): Promise<void> {
    const now = new Date();
    const leaseExpires = new Date(now.getTime() + this.leaseTimeoutMs);

    // 1. Atomic Fenced Claim in short DB transaction
    const claimRes = await prisma.$executeRawUnsafe(
      `UPDATE \`InvoiceNotificationOutbox\`
       SET \`status\` = 'CLAIMED',
           \`claimedBy\` = ?,
           \`claimedAt\` = ?,
           \`claimExpiresAt\` = ?,
           \`claimVersion\` = \`claimVersion\` + 1,
           \`attemptCount\` = \`attemptCount\` + 1,
           \`updatedAt\` = NOW(3)
       WHERE \`id\` = ?
         AND \`claimVersion\` = ?
         AND \`status\` IN ('PENDING', 'RETRYABLE_FAILURE')`,
      this.workerId,
      now,
      leaseExpires,
      recordId,
      expectedVersion
    );

    if (claimRes === 0) {
      // Another worker claimed or row mutated concurrently; skip cleanly
      return;
    }

    const currentClaimVersion = expectedVersion + 1n;

    // 2. Fetch full record with associated invoice
    const record = await prisma.invoiceNotificationOutbox.findUnique({
      where: { id: recordId },
      include: { invoice: true }
    });

    if (!record || !record.invoice) {
      appLogger.error('[InvoiceOutboxWorker] Record or associated invoice missing after claim', {
        operation: 'OUTBOX_ORPHAN_ERROR',
        metadata: { recordId }
      });
      return;
    }

    // 3. Pre-transport configuration and operational state check
    if (!this.isStarted || config.INVOICE_NOTIFICATION_DISPATCH_MODE !== 'OUTBOX_WORKER') {
      appLogger.info('[InvoiceOutboxWorker] Aborting dispatch: worker stopped or mode changed before transport', {
        operation: 'OUTBOX_DISPATCH_ABORTED_MODE_CHANGE',
        metadata: { recordId, mode: config.INVOICE_NOTIFICATION_DISPATCH_MODE }
      });
      return;
    }

    // 4. Durable Transport-Boundary Commitment (persisted BEFORE network call)
    const transportBoundaryRes = await prisma.$executeRawUnsafe(
      `UPDATE \`InvoiceNotificationOutbox\`
       SET \`transportStartedAt\` = NOW(3),
           \`updatedAt\` = NOW(3)
       WHERE \`id\` = ? AND \`claimVersion\` = ? AND \`claimedBy\` = ? AND \`status\` = 'CLAIMED'`,
      recordId,
      currentClaimVersion,
      this.workerId
    );

    if (transportBoundaryRes === 0) {
      batchResult.staleFencingCount++;
      appLogger.warn('[InvoiceOutboxWorker] Fencing rejected at transport boundary; claim lost', {
        operation: 'OUTBOX_FENCING_REJECTED',
        metadata: { recordId }
      });
      return;
    }

    // 4. External Network Transport (Executed entirely OUTSIDE of database transaction)
    let dispatchResult: any;
    let transportException: any = null;

    try {
      // Ensure in-app notification is emitted idempotently (Phase 11.2)
      if (record.invoice && (record.invoice as any).status === 'ISSUED') {
        billingEventProducer.emitInvoiceIssued(record.invoice as any).catch(() => {});
      }

      dispatchResult = await BillingInvoiceNotificationService.sendInvoiceIssuedNotification(
        record.invoice,
        {
          correlationId: `invoice_${record.invoice.id}`,
          forceResend: record.resendAuthorized
        }
      );
    } catch (err: any) {
      transportException = err;
    }

    // 5. Post-Transport Resolution under Monotonic Fencing
    if (transportException) {
      // Network crash or exception during/after provider call
      await this.handleTransportFailure(record, currentClaimVersion, transportException, batchResult);
    } else if (dispatchResult?.sent) {
      // Positive provider acceptance
      await this.handleTransportSuccess(record, currentClaimVersion, dispatchResult, batchResult);
    } else if (dispatchResult?.skipped && dispatchResult?.reason === 'ALREADY_SENT') {
      // Deduplicated against pre-existing delivered email record
      await this.handleAlreadySent(record, currentClaimVersion, dispatchResult, batchResult);
    } else {
      // Dispatch returned non-success result
      await this.handleTransportFailure(record, currentClaimVersion, dispatchResult, batchResult);
    }
  }

  private async handleTransportSuccess(
    record: any,
    claimVersion: bigint,
    dispatchResult: any,
    batchResult: OutboxBatchResult
  ): Promise<void> {
    const rawMessageId = dispatchResult.dispatchResult?.providerMessageId || null;
    const cleanMessageId = rawMessageId ? String(rawMessageId).trim().replace(/^<|>$/g, '') : null;
    const emailMessageId = dispatchResult.emailMessageId || null;

    const existingMeta = typeof record.metadata === 'string'
      ? JSON.parse(record.metadata || '{}')
      : (record.metadata || {});

    const previousProviderMessageIds: string[] = Array.isArray(existingMeta.previousProviderMessageIds)
      ? existingMeta.previousProviderMessageIds
      : [];

    if (record.providerMessageId && record.providerMessageId !== cleanMessageId && !previousProviderMessageIds.includes(record.providerMessageId)) {
      previousProviderMessageIds.push(record.providerMessageId);
    }

    const updatedMeta = sanitizeJsonPayload({
      ...existingMeta,
      previousProviderMessageIds,
      ...(record.resendAuthorized ? {
        lastResendDispatchedAt: new Date().toISOString(),
        lastResendProviderMessageId: cleanMessageId
      } : {})
    });

    const updateRes = await prisma.$executeRawUnsafe(
      `UPDATE \`InvoiceNotificationOutbox\`
       SET \`status\` = 'DISPATCHED',
           \`dispatchedAt\` = NOW(3),
           \`providerMessageId\` = ?,
           \`emailMessageId\` = COALESCE(?, \`emailMessageId\`),
           \`resendAuthorized\` = false,
           \`metadata\` = ?,
           \`claimedBy\` = NULL,
           \`claimExpiresAt\` = NULL,
           \`claimVersion\` = \`claimVersion\` + 1,
           \`updatedAt\` = NOW(3)
       WHERE \`id\` = ? AND \`claimVersion\` = ? AND \`claimedBy\` = ? AND \`status\` = 'CLAIMED'`,
      cleanMessageId,
      emailMessageId,
      JSON.stringify(updatedMeta),
      record.id,
      claimVersion,
      this.workerId
    );

    if (updateRes > 0) {
      batchResult.dispatchedCount++;
      appLogger.info('[InvoiceOutboxWorker] Successfully dispatched invoice notification', {
        operation: 'OUTBOX_DISPATCH_SUCCESS',
        metadata: {
          outboxId: record.id,
          invoiceNumber: record.invoiceNumber,
          providerMessageId: cleanMessageId
        }
      });
    } else {
      batchResult.staleFencingCount++;
      appLogger.warn('[InvoiceOutboxWorker] Successful dispatch completed but fencing check rejected DB update', {
        operation: 'OUTBOX_DISPATCH_FENCING_REJECTED',
        metadata: {
          outboxId: record.id,
          providerMessageId: cleanMessageId
        }
      });
    }
  }

  private async handleAlreadySent(
    record: any,
    claimVersion: bigint,
    dispatchResult: any,
    batchResult: OutboxBatchResult
  ): Promise<void> {
    const emailMessageId = dispatchResult.emailMessageId || null;

    const updateRes = await prisma.$executeRawUnsafe(
      `UPDATE \`InvoiceNotificationOutbox\`
       SET \`status\` = 'DISPATCHED',
           \`dispatchedAt\` = NOW(3),
           \`emailMessageId\` = ?,
           \`claimedBy\` = NULL,
           \`claimExpiresAt\` = NULL,
           \`claimVersion\` = \`claimVersion\` + 1,
           \`updatedAt\` = NOW(3)
       WHERE \`id\` = ? AND \`claimVersion\` = ? AND \`claimedBy\` = ? AND \`status\` = 'CLAIMED'`,
      emailMessageId,
      record.id,
      claimVersion,
      this.workerId
    );

    if (updateRes > 0) {
      batchResult.dispatchedCount++;
      appLogger.info('[InvoiceOutboxWorker] Notification already sent historically; marked DISPATCHED', {
        operation: 'OUTBOX_ALREADY_SENT_ALIGNED',
        metadata: { outboxId: record.id, emailMessageId }
      });
    }
  }

  private async handleTransportFailure(
    record: any,
    claimVersion: bigint,
    failureOrError: any,
    batchResult: OutboxBatchResult
  ): Promise<void> {
    const errorMsg = failureOrError?.error || failureOrError?.message || failureOrError?.failureReason || String(failureOrError);
    const failureCode = failureOrError?.failureCode || 'TRANSPORT_FAILED';

    // attemptCount was already incremented at claim time
    const currentAttempts = record.attemptCount;

    // Evaluate failure classification
    const classification = classifyEmailFailure({
      errorMessage: errorMsg,
      providerResponseCode: failureOrError?.providerResponseCode || null,
      attemptCount: currentAttempts,
      maxAttempts: record.maxAttempts
    });

    // Check if error is ambiguous: timeout, network reset, gateway error where provider state is uncertain
    const isAmbiguous = failureOrError?.providerResponseCode === 502 ||
      failureOrError?.providerResponseCode === 504 ||
      /timeout|etimedout|econnreset|hang up|502|504|gateway timeout|bad gateway/i.test(errorMsg);

    let nextStatus: InvoiceNotificationOutboxStatus;
    let ambiguousReason: string | null = null;
    let nextAttemptAt: Date | null = null;
    let ambiguousAt: Date | null = null;

    if (isAmbiguous) {
      nextStatus = InvoiceNotificationOutboxStatus.AMBIGUOUS_OUTCOME;
      ambiguousReason = `Transport outcome ambiguous: ${sanitizeFailureReason(errorMsg)}`;
      ambiguousAt = new Date();
      batchResult.quarantinedCount++;
    } else if (classification.disposition === EmailFailureDisposition.PERMANENT) {
      nextStatus = InvoiceNotificationOutboxStatus.PERMANENT_FAILURE;
      batchResult.permanentFailureCount++;
    } else if (currentAttempts >= record.maxAttempts) {
      nextStatus = InvoiceNotificationOutboxStatus.EXHAUSTED;
      batchResult.permanentFailureCount++;
    } else {
      nextStatus = InvoiceNotificationOutboxStatus.RETRYABLE_FAILURE;
      nextAttemptAt = calculateNextRetryDate(currentAttempts);
      batchResult.transientFailureCount++;
    }

    const safeReason = sanitizeFailureReason(errorMsg);

    await prisma.$executeRawUnsafe(
      `UPDATE \`InvoiceNotificationOutbox\`
       SET \`status\` = ?,
           \`failureCode\` = ?,
           \`failureReason\` = ?,
           \`ambiguousAt\` = ?,
           \`ambiguousReason\` = ?,
           \`resendAuthorized\` = CASE WHEN ? IN ('AMBIGUOUS_OUTCOME', 'PERMANENT_FAILURE', 'EXHAUSTED') THEN false ELSE \`resendAuthorized\` END,
           \`lastAttemptAt\` = NOW(3),
           \`nextAttemptAt\` = ?,
           \`claimedBy\` = NULL,
           \`claimExpiresAt\` = NULL,
           \`claimVersion\` = \`claimVersion\` + 1,
           \`updatedAt\` = NOW(3)
       WHERE \`id\` = ? AND \`claimVersion\` = ? AND \`claimedBy\` = ? AND \`status\` = 'CLAIMED'`,
      nextStatus,
      failureCode,
      safeReason,
      ambiguousAt,
      ambiguousReason,
      nextStatus,
      nextAttemptAt,
      record.id,
      claimVersion,
      this.workerId
    );

    appLogger.warn('[InvoiceOutboxWorker] Transport failure handled under monotonic fencing', {
      operation: 'OUTBOX_DISPATCH_FAILURE',
      metadata: {
        outboxId: record.id,
        invoiceNumber: record.invoiceNumber,
        nextStatus,
        failureCode,
        isAmbiguous
      }
    });
  }
}

export const invoiceNotificationOutboxWorker = InvoiceNotificationOutboxWorker.getInstance();
