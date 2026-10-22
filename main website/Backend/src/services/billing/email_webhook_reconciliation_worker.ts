/**
 * ZdexCloud Email Webhook Reconciliation Worker Service
 * Phase 8.4 Batch E.5 & E.5.1 Hardened Architecture
 *
 * Implements a durable, conservative background reconciliation worker that processes
 * persisted EmailWebhookInbox records and reconciles them with InvoiceNotificationOutbox
 * and central email delivery tracking records.
 *
 * Core Hardened Reconciliation Invariants:
 * 1. Durable Inbox Processing: Processes ONLY webhook records that have already been durably
 *    persisted to EmailWebhookInbox.
 * 2. Strongest Evidence Matching: Matches strictly via providerMessageId (normalized, angle brackets stripped).
 *    Also matches historical providerMessageIds archived in outbox metadata across prior authorized resends.
 *    Never matches solely on recipient email, event type, or approximate timestamp.
 * 3. Ambiguous Collision Protection: If multiple outbox records match a providerMessageId,
 *    leaves the event UNMATCHED with explicit error diagnostics for operator triage. Never guesses.
 * 4. Strict Provider Event Semantics:
 *    - ONLY authoritative delivery confirmations ('delivered') may advance DISPATCHED / AMBIGUOUS_OUTCOME to DELIVERED.
 *    - Engagement events ('opened', 'clicked', 'proxy_open') record engagement telemetry in metadata but
 *      NEVER advance outbox delivery status or clear AMBIGUOUS_OUTCOME.
 *    - Duplicate delivery webhooks are idempotent and NEVER trigger side effects or duplicate sends.
 *    - Older/conflicting events never regress an already DELIVERED state.
 *    - Terminal failures (hard bounce, blocked, spam) advance DISPATCHED / AMBIGUOUS_OUTCOME to PERMANENT_FAILURE.
 *    - Conflicting events (bounce on DELIVERED, or delivery on PERMANENT_FAILURE) preserve contradictory evidence
 *      in outbox metadata (`hasConflictingEvidence = true`) for operator audit and never silently discard.
 *    - SHADOW_PENDING is never treated as proof of dispatch and never triggers sends.
 *    - PERMANENT_FAILURE, EXHAUSTED, and HISTORICAL_UNTRACKED NEVER become automatically resendable through reconciliation.
 *    - A webhook alone NEVER authorizes an automated resend.
 * 5. Invoice Immutability: Reconciler NEVER reissues invoices, mutates tax snapshots, alters invoice numbers,
 *    or recalculates totals.
 * 6. Concurrency & Stale Worker Fencing:
 *    - Uses atomic state lease transitions (RECEIVED -> PROCESSING) with attempt-counter optimistic fencing.
 *    - Completion updates require `WHERE id = ? AND status = 'PROCESSING' AND processingAttempts = ?`.
 *    - Outbox updates and inbox completion execute inside an atomic database transaction (`prisma.$transaction`).
 */

import os from 'node:os';
import { prisma } from '../../config/database.js';
import { config } from '../../config/env.js';
import { appLogger } from '../../observability/logger.js';
import {
  InvoiceNotificationOutboxStatus,
  EmailWebhookInboxStatus,
  EmailMessageStatus,
  Prisma
} from '@prisma/client';
import {
  sanitizeFailureReason,
  sanitizeLogString,
  sanitizeJsonPayload
} from '../../utils/email_sanitizer.js';

export interface ReconciliationWorkerOptions {
  workerId?: string;
  enabled?: boolean;
  pollIntervalMs?: number;
  batchSize?: number;
  leaseTimeoutMs?: number;
}

export interface ReconciliationBatchResult {
  processedCount: number;
  matchedOutboxCount: number;
  matchedEmailMessageCount: number;
  deliveredCount: number;
  engagementRecordedCount: number;
  permanentFailureCount: number;
  conflictingEvidenceCount: number;
  unmatchedCount: number;
  duplicateCount: number;
  staleFencingCount: number;
  errorCount: number;
}

/**
 * Normalizes Brevo event string to delivery confirmation, engagement, terminal failure, or transient categories.
 */
export function classifyWebhookEventCategory(eventType: string): {
  isDeliveryConfirmation: boolean;
  isEngagement: boolean;
  isTerminalFailure: boolean;
  isTransientOrInformational: boolean;
  normalizedEvent: string;
} {
  const norm = (eventType || '').trim().toLowerCase();
  switch (norm) {
    case 'delivered':
      return {
        isDeliveryConfirmation: true,
        isEngagement: false,
        isTerminalFailure: false,
        isTransientOrInformational: false,
        normalizedEvent: norm
      };

    case 'unique_opened':
    case 'opened':
    case 'clicked':
    case 'proxy_open':
    case 'unique_proxy_open':
      return {
        isDeliveryConfirmation: false,
        isEngagement: true,
        isTerminalFailure: false,
        isTransientOrInformational: false,
        normalizedEvent: norm
      };

    case 'hard_bounce':
    case 'invalid_email':
    case 'blocked':
    case 'spam':
    case 'unsubscribed':
      return {
        isDeliveryConfirmation: false,
        isEngagement: false,
        isTerminalFailure: true,
        isTransientOrInformational: false,
        normalizedEvent: norm
      };

    case 'request':
    case 'sent':
    case 'deferred':
    case 'soft_bounce':
    default:
      return {
        isDeliveryConfirmation: false,
        isEngagement: false,
        isTerminalFailure: false,
        isTransientOrInformational: true,
        normalizedEvent: norm
      };
  }
}

export class EmailWebhookReconciliationWorker {
  private static instance: EmailWebhookReconciliationWorker;

  private readonly workerId: string;
  private readonly enabled: boolean;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly leaseTimeoutMs: number;

  private pollTimer: NodeJS.Timeout | null = null;
  private isTickRunning = false;
  private isStarted = false;

  public static getInstance(options?: ReconciliationWorkerOptions): EmailWebhookReconciliationWorker {
    if (!EmailWebhookReconciliationWorker.instance) {
      EmailWebhookReconciliationWorker.instance = new EmailWebhookReconciliationWorker(options);
    }
    return EmailWebhookReconciliationWorker.instance;
  }

  constructor(options: ReconciliationWorkerOptions = {}) {
    const hostname = os.hostname().replace(/[^a-zA-Z0-9-]/g, '').toLowerCase() || 'node';
    const randId = Math.random().toString(36).substring(2, 8);
    this.workerId = options.workerId || `webhook-reconciler-${hostname}-${randId}`;

    this.enabled = options.enabled ?? (config.EMAIL_WEBHOOK_RECONCILIATION_WORKER_ENABLED ?? false);
    this.pollIntervalMs = options.pollIntervalMs ?? (config.EMAIL_WEBHOOK_RECONCILIATION_POLL_INTERVAL_MS ?? 10000);
    this.batchSize = options.batchSize ?? (config.EMAIL_WEBHOOK_RECONCILIATION_BATCH_SIZE ?? 25);
    this.leaseTimeoutMs = options.leaseTimeoutMs ?? (config.EMAIL_WEBHOOK_RECONCILIATION_LEASE_MS ?? 300000);
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

    if (!this.enabled) {
      appLogger.info('[EmailWebhookReconciler] Webhook reconciliation worker is disabled by configuration (EMAIL_WEBHOOK_RECONCILIATION_WORKER_ENABLED=false)');
      return;
    }

    this.isStarted = true;
    appLogger.info(`[EmailWebhookReconciler] Starting background webhook reconciler (${this.workerId})`, {
      operation: 'WEBHOOK_RECONCILER_START',
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

    appLogger.info(`[EmailWebhookReconciler] Stopping worker (${this.workerId})`, {
      operation: 'WEBHOOK_RECONCILER_STOP',
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
        appLogger.error('[EmailWebhookReconciler] Unexpected error in reconciler tick', err, {
          operation: 'WEBHOOK_RECONCILER_TICK_ERROR',
          metadata: { workerId: this.workerId }
        });
      } finally {
        this.scheduleNextPoll();
      }
    }, this.pollIntervalMs);
  }

  /**
   * Executes a single bounded poll and reconciliation pass.
   */
  public async processTick(): Promise<ReconciliationBatchResult> {
    const result: ReconciliationBatchResult = {
      processedCount: 0,
      matchedOutboxCount: 0,
      matchedEmailMessageCount: 0,
      deliveredCount: 0,
      engagementRecordedCount: 0,
      permanentFailureCount: 0,
      conflictingEvidenceCount: 0,
      unmatchedCount: 0,
      duplicateCount: 0,
      staleFencingCount: 0,
      errorCount: 0
    };

    if (this.isTickRunning || !this.enabled) return result;
    this.isTickRunning = true;

    try {
      // 1. Recover expired in-flight leases from crashed workers
      await this.recoverExpiredLeases();

      // 2. Fetch candidate inbox records eligible for reconciliation
      const candidateRecords = await this.fetchCandidateRecords();
      if (candidateRecords.length === 0) {
        return result;
      }

      // 3. Process candidate records with individual error boundaries
      for (const record of candidateRecords) {
        try {
          const processed = await this.reconcileSingleRecord(record, result);
          if (processed) {
            result.processedCount++;
          }
        } catch (itemErr: any) {
          result.errorCount++;
          appLogger.warn('[EmailWebhookReconciler] Error processing inbox record', {
            operation: 'WEBHOOK_RECONCILE_ITEM_ERROR',
            metadata: {
              inboxId: record.id,
              error: itemErr instanceof Error ? itemErr.message : String(itemErr)
            }
          });

          // Mark record as FAILED with error message, keeping payload intact
          await this.markRecordFailed(record.id, itemErr instanceof Error ? itemErr.message : 'Unknown reconciliation error', record.processingAttempts + 1);
        }
      }
    } finally {
      this.isTickRunning = false;
    }

    return result;
  }

  /**
   * Reclaims leases on records stuck in PROCESSING due to worker crashes.
   */
  private async recoverExpiredLeases(): Promise<void> {
    const expirationCutoff = new Date(Date.now() - this.leaseTimeoutMs);

    try {
      await prisma.$executeRawUnsafe(
        `UPDATE \`EmailWebhookInbox\`
         SET \`status\` = 'RECEIVED',
             \`processingAttempts\` = \`processingAttempts\` + 1,
             \`updatedAt\` = NOW(3)
         WHERE \`status\` = 'PROCESSING'
           AND \`updatedAt\` <= ?`,
        expirationCutoff
      );
    } catch (err: any) {
      appLogger.warn('[EmailWebhookReconciler] Failed to recover expired leases', {
        operation: 'WEBHOOK_RECONCILER_LEASE_RECOVERY_ERROR',
        metadata: { error: err?.message || String(err) }
      });
    }
  }

  /**
   * Queries a bounded batch of candidate EmailWebhookInbox rows.
   */
  private async fetchCandidateRecords(): Promise<Array<{
    id: string;
    provider: string;
    eventId: string;
    eventType: string;
    providerMessageId: string | null;
    recipientEmail: string | null;
    eventTimestamp: Date | null;
    status: string;
    processingAttempts: number;
    rawPayload: any;
  }>> {
    try {
      const records = await prisma.$queryRawUnsafe<Array<any>>(
        `SELECT \`id\`, \`provider\`, \`eventId\`, \`eventType\`, \`providerMessageId\`,
                \`recipientEmail\`, \`eventTimestamp\`, \`status\`, \`processingAttempts\`,
                \`rawPayload\`
         FROM \`EmailWebhookInbox\`
         WHERE \`status\` IN ('RECEIVED', 'UNMATCHED')
           AND \`processingAttempts\` < 5
         ORDER BY \`createdAt\` ASC
         LIMIT ?`,
        this.batchSize
      );

      return records.map((r) => ({
        id: String(r.id),
        provider: String(r.provider || 'BREVO'),
        eventId: String(r.eventId),
        eventType: String(r.eventType || '').toLowerCase().trim(),
        providerMessageId: r.providerMessageId ? String(r.providerMessageId).trim() : null,
        recipientEmail: r.recipientEmail ? String(r.recipientEmail).trim().toLowerCase() : null,
        eventTimestamp: r.eventTimestamp ? new Date(r.eventTimestamp) : null,
        receivedAt: r.receivedAt ? new Date(r.receivedAt) : null,
        status: String(r.status),
        processingAttempts: Number(r.processingAttempts || 0),
        rawPayload: typeof r.rawPayload === 'string' ? JSON.parse(r.rawPayload) : r.rawPayload
      }));
    } catch (err: any) {
      appLogger.error('[EmailWebhookReconciler] Failed to fetch candidate inbox records', err, {
        operation: 'WEBHOOK_RECONCILER_FETCH_ERROR'
      });
      return [];
    }
  }

  /**
   * Reconciles a single staged EmailWebhookInbox record.
   */
  private async reconcileSingleRecord(
    record: {
      id: string;
      provider: string;
      eventId: string;
      eventType: string;
      providerMessageId: string | null;
      recipientEmail: string | null;
      eventTimestamp: Date | null;
      receivedAt?: Date | null;
      status: string;
      processingAttempts: number;
      rawPayload: any;
    },
    result: ReconciliationBatchResult
  ): Promise<boolean> {
    const expectedAttempts = record.processingAttempts;
    const claimedAttempts = expectedAttempts + 1;

    // 1. Atomic Concurrency Claim: Transition from RECEIVED/UNMATCHED to PROCESSING with attempt token fencing
    const claimRes = await prisma.$executeRawUnsafe(
      `UPDATE \`EmailWebhookInbox\`
       SET \`status\` = 'PROCESSING',
           \`processingAttempts\` = ?,
           \`updatedAt\` = NOW(3)
       WHERE \`id\` = ? AND \`status\` IN ('RECEIVED', 'UNMATCHED') AND \`processingAttempts\` = ?`,
      claimedAttempts,
      record.id,
      expectedAttempts
    );

    if (claimRes === 0) {
      // Record claimed or mutated concurrently by another worker
      return false;
    }

    // 2. Validate providerMessageId presence
    const cleanMessageId = record.providerMessageId
      ? record.providerMessageId.replace(/^<|>$/g, '').trim()
      : null;

    if (!cleanMessageId) {
      // Invariant: Do not discard payload! Preserve as UNMATCHED_NO_IDENTIFIER for operator inspection
      await prisma.$executeRawUnsafe(
        `UPDATE \`EmailWebhookInbox\`
         SET \`status\` = 'UNMATCHED_NO_IDENTIFIER',
             \`lastError\` = 'Missing providerMessageId in webhook payload; cannot safely correlate',
             \`updatedAt\` = NOW(3)
         WHERE \`id\` = ? AND \`status\` = 'PROCESSING' AND \`processingAttempts\` = ?`,
        record.id,
        claimedAttempts
      );
      result.unmatchedCount++;
      return true;
    }

    // 3. Search Candidate Records using strongest evidence (exact providerMessageId)
    // Also searches historical providerMessageIds archived in metadata across prior authorized resends
    const candidateOutboxRows = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT \`id\`, \`status\`, \`invoiceId\`, \`invoiceNumber\`, \`providerMessageId\`,
              \`emailMessageId\`, \`deliveredAt\`, \`failedAt\`, \`ambiguousReason\`,
              \`claimVersion\`, \`metadata\`
       FROM \`InvoiceNotificationOutbox\`
       WHERE \`providerMessageId\` = ? OR \`providerMessageId\` = ?
          OR \`metadata\` LIKE ?`,
      cleanMessageId,
      `<${cleanMessageId}>`,
      `%"${cleanMessageId}"%`
    );

    // Filter to ensure strict match either on current providerMessageId or archived previousProviderMessageIds
    const outboxMatches = candidateOutboxRows.filter((row) => {
      const rowCleanId = row.providerMessageId ? String(row.providerMessageId).replace(/^<|>$/g, '').trim() : null;
      if (rowCleanId === cleanMessageId) return true;
      const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata || '{}') : (row.metadata || {});
      const previousIds: string[] = Array.isArray(meta.previousProviderMessageIds) ? meta.previousProviderMessageIds : [];
      return previousIds.some((pId) => pId.replace(/^<|>$/g, '').trim() === cleanMessageId);
    });

    // Search EmailMessage
    const emailMatches = await prisma.emailMessage.findMany({
      where: {
        OR: [
          { providerMessageId: cleanMessageId },
          { providerMessageId: `<${cleanMessageId}>` }
        ],
        provider: record.provider
      },
      select: {
        id: true,
        status: true,
        deliveredAt: true,
        failedAt: true,
        channelDeliveryRecordId: true,
        metadata: true
      }
    });

    const matchedEmail = emailMatches.length > 0 ? emailMatches[0] : null;

    // 4. Candidate Match Resolution
    if (outboxMatches.length > 1) {
      // Invariant: Multiple candidate outbox records match. Never guess or resolve arbitrarily!
      await prisma.$executeRawUnsafe(
        `UPDATE \`EmailWebhookInbox\`
         SET \`status\` = 'UNMATCHED',
             \`lastError\` = 'Multiple candidate InvoiceNotificationOutbox records matched providerMessageId; operator review required',
             \`updatedAt\` = NOW(3)
         WHERE \`id\` = ? AND \`status\` = 'PROCESSING' AND \`processingAttempts\` = ?`,
        record.id,
        claimedAttempts
      );
      result.unmatchedCount++;
      return true;
    }

    if (outboxMatches.length === 0) {
      // No outbox match found
      if (matchedEmail) {
        // Matched central email log (e.g., OTP or general notification)
        const txSuccess = await prisma.$transaction(async (tx) => {
          await this.reconcileGeneralEmail(tx, record, matchedEmail);

          const inboxUpdateRes = await tx.$executeRawUnsafe(
            `UPDATE \`EmailWebhookInbox\`
             SET \`status\` = 'PROCESSED',
                 \`matchedEmailMessageId\` = ?,
                 \`reconciledAt\` = NOW(3),
                 \`updatedAt\` = NOW(3)
             WHERE \`id\` = ? AND \`status\` = 'PROCESSING' AND \`processingAttempts\` = ?`,
            matchedEmail.id,
            record.id,
            claimedAttempts
          );

          if (inboxUpdateRes === 0) {
            throw new Error('STALE_WORKER_FENCING_REJECTED');
          }
          return true;
        }).catch((err) => {
          if (err?.message === 'STALE_WORKER_FENCING_REJECTED') {
            result.staleFencingCount++;
            return false;
          }
          throw err;
        });

        if (txSuccess) {
          result.matchedEmailMessageCount++;
          return true;
        }
        return false;
      }

      // Neither matched: Keep staged as UNMATCHED for future reconciliation or operator triage
      await prisma.$executeRawUnsafe(
        `UPDATE \`EmailWebhookInbox\`
         SET \`status\` = 'UNMATCHED',
             \`lastError\` = 'No matching outbox or email message record found for providerMessageId',
             \`updatedAt\` = NOW(3)
         WHERE \`id\` = ? AND \`status\` = 'PROCESSING' AND \`processingAttempts\` = ?`,
        record.id,
        claimedAttempts
      );
      result.unmatchedCount++;
      return true;
    }

    // Exactly one InvoiceNotificationOutbox record matched!
    const outbox = outboxMatches[0];
    result.matchedOutboxCount++;
    if (matchedEmail) {
      result.matchedEmailMessageCount++;
    }

    const rowCleanId = outbox.providerMessageId ? String(outbox.providerMessageId).replace(/^<|>$/g, '').trim() : null;
    const isCurrentAttempt = (rowCleanId === cleanMessageId);

    // 5. Apply Conservative Outbox State Transitions
    const category = classifyWebhookEventCategory(record.eventType);
    const currentStatus = outbox.status as InvoiceNotificationOutboxStatus;
    const providerEventTime: Date | null = record.eventTimestamp ? new Date(record.eventTimestamp) : null;
    const eventTimeForDb: Date = providerEventTime || new Date();
    const existingMeta = typeof outbox.metadata === 'string'
      ? JSON.parse(outbox.metadata || '{}')
      : (outbox.metadata || {});

    // TASK A: If event matches a historical attempt rather than the current providerMessageId,
    // dispatch to historical reconciliation to prevent mutating/corrupting active newer resends.
    if (!isCurrentAttempt) {
      return await this.reconcileHistoricalAttemptRecord({
        record,
        outbox,
        matchedEmail,
        cleanMessageId,
        category,
        currentStatus,
        existingMeta,
        providerEventTime,
        eventTimeForDb,
        claimedAttempts,
        result
      });
    }

    // A. AUTHORITATIVE DELIVERY CONFIRMATION ('delivered')
    if (category.isDeliveryConfirmation) {
      if (currentStatus === InvoiceNotificationOutboxStatus.DISPATCHED ||
          currentStatus === InvoiceNotificationOutboxStatus.AMBIGUOUS_OUTCOME) {
        // Authoritative resolution: External provider proves acceptance and delivery!
        const updatedMeta = sanitizeJsonPayload({
          ...existingMeta,
          reconciledBy: this.workerId,
          deliveryWebhookEvent: record.eventType,
          providerEventTimestamp: providerEventTime ? providerEventTime.toISOString() : null,
          eventTimestampMissing: !providerEventTime,
          resolvedFromStatus: currentStatus,
          reconciledAt: new Date().toISOString()
        });

        const txSuccess = await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            `UPDATE \`InvoiceNotificationOutbox\`
             SET \`status\` = 'DELIVERED',
                 \`deliveredAt\` = COALESCE(\`deliveredAt\`, ?),
                 \`ambiguousReason\` = CASE WHEN \`status\` = 'AMBIGUOUS_OUTCOME' THEN 'Resolved by verified delivery webhook' ELSE \`ambiguousReason\` END,
                 \`metadata\` = ?,
                 \`updatedAt\` = NOW(3)
             WHERE \`id\` = ? AND \`status\` = ?`,
            eventTimeForDb,
            JSON.stringify(updatedMeta),
            outbox.id,
            currentStatus
          );

          if (matchedEmail && matchedEmail.status !== EmailMessageStatus.DELIVERED) {
            await tx.emailMessage.update({
              where: { id: matchedEmail.id },
              data: {
                status: EmailMessageStatus.DELIVERED,
                deliveredAt: matchedEmail.deliveredAt || eventTimeForDb
              }
            }).catch(() => {});
          }

          const inboxUpdateRes = await tx.$executeRawUnsafe(
            `UPDATE \`EmailWebhookInbox\`
             SET \`status\` = 'PROCESSED',
                 \`matchedOutboxId\` = ?,
                 \`matchedEmailMessageId\` = ?,
                 \`reconciledAt\` = NOW(3),
                 \`updatedAt\` = NOW(3)
             WHERE \`id\` = ? AND \`status\` = 'PROCESSING' AND \`processingAttempts\` = ?`,
            outbox.id,
            matchedEmail ? matchedEmail.id : (outbox.emailMessageId || null),
            record.id,
            claimedAttempts
          );

          if (inboxUpdateRes === 0) {
            throw new Error('STALE_WORKER_FENCING_REJECTED');
          }
          return true;
        }).catch((err) => {
          if (err?.message === 'STALE_WORKER_FENCING_REJECTED') {
            result.staleFencingCount++;
            return false;
          }
          throw err;
        });

        if (txSuccess) {
          result.deliveredCount++;
          return true;
        }
        return false;
      }

      if (currentStatus === InvoiceNotificationOutboxStatus.DELIVERED) {
        // Idempotent duplicate delivery event
        await prisma.$executeRawUnsafe(
          `UPDATE \`EmailWebhookInbox\`
           SET \`status\` = 'DUPLICATE',
               \`matchedOutboxId\` = ?,
               \`matchedEmailMessageId\` = ?,
               \`reconciledAt\` = NOW(3),
               \`updatedAt\` = NOW(3)
           WHERE \`id\` = ? AND \`status\` = 'PROCESSING' AND \`processingAttempts\` = ?`,
          outbox.id,
          matchedEmail ? matchedEmail.id : (outbox.emailMessageId || null),
          record.id,
          claimedAttempts
        );
        result.duplicateCount++;
        return true;
      }

      if (currentStatus === InvoiceNotificationOutboxStatus.PERMANENT_FAILURE ||
          currentStatus === InvoiceNotificationOutboxStatus.EXHAUSTED) {
        // CONFLICTING EVIDENCE: Delivery reported after terminal failure recorded
        const conflictingEvents = Array.isArray(existingMeta.conflictingEvents)
          ? existingMeta.conflictingEvents
          : [];

        const updatedMeta = sanitizeJsonPayload({
          ...existingMeta,
          hasConflictingEvidence: true,
          conflictingEvents: [
            ...conflictingEvents.slice(-10),
            {
              eventType: record.eventType,
              isCurrentAttempt: true,
              providerMessageId: cleanMessageId,
              eventTimestamp: providerEventTime ? providerEventTime.toISOString() : null,
              eventTimestampMissing: !providerEventTime,
              receivedAt: record.receivedAt ? new Date(record.receivedAt).toISOString() : new Date().toISOString(),
              existingStatus: currentStatus,
              note: 'Delivery confirmation webhook received for record already in terminal failure'
            }
          ]
        });

        const txSuccess = await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            `UPDATE \`InvoiceNotificationOutbox\`
             SET \`metadata\` = ?,
                 \`updatedAt\` = NOW(3)
             WHERE \`id\` = ?`,
            JSON.stringify(updatedMeta),
            outbox.id
          );

          const inboxUpdateRes = await tx.$executeRawUnsafe(
            `UPDATE \`EmailWebhookInbox\`
             SET \`status\` = 'PROCESSED',
                 \`matchedOutboxId\` = ?,
                 \`matchedEmailMessageId\` = ?,
                 \`reconciledAt\` = NOW(3),
                 \`lastError\` = 'Conflicting delivery event received for outbox in terminal failure state; recorded in metadata for operator review',
                 \`updatedAt\` = NOW(3)
             WHERE \`id\` = ? AND \`status\` = 'PROCESSING' AND \`processingAttempts\` = ?`,
            outbox.id,
            matchedEmail ? matchedEmail.id : (outbox.emailMessageId || null),
            record.id,
            claimedAttempts
          );

          if (inboxUpdateRes === 0) {
            throw new Error('STALE_WORKER_FENCING_REJECTED');
          }
          return true;
        }).catch((err) => {
          if (err?.message === 'STALE_WORKER_FENCING_REJECTED') {
            result.staleFencingCount++;
            return false;
          }
          throw err;
        });

        if (txSuccess) {
          result.conflictingEvidenceCount++;
          return true;
        }
        return false;
      }

      if (currentStatus === InvoiceNotificationOutboxStatus.SHADOW_PENDING) {
        // Invariant: SHADOW_PENDING must not be treated as proof of dispatch
        await prisma.$executeRawUnsafe(
          `UPDATE \`EmailWebhookInbox\`
           SET \`status\` = 'UNMATCHED',
               \`lastError\` = 'Cannot advance SHADOW_PENDING outbox record solely via reconciliation; manual verification required',
               \`updatedAt\` = NOW(3)
           WHERE \`id\` = ? AND \`status\` = 'PROCESSING' AND \`processingAttempts\` = ?`,
          record.id,
          claimedAttempts
        );
        result.unmatchedCount++;
        return true;
      }

      // Other states (PENDING, CLAIMED): Acknowledge without contradictory state jump
      await prisma.$executeRawUnsafe(
        `UPDATE \`EmailWebhookInbox\`
         SET \`status\` = 'PROCESSED',
             \`matchedOutboxId\` = ?,
             \`matchedEmailMessageId\` = ?,
             \`reconciledAt\` = NOW(3),
             \`lastError\` = ?,
             \`updatedAt\` = NOW(3)
         WHERE \`id\` = ? AND \`status\` = 'PROCESSING' AND \`processingAttempts\` = ?`,
        outbox.id,
        matchedEmail ? matchedEmail.id : (outbox.emailMessageId || null),
        `Delivery webhook acknowledged for outbox in non-dispatch state: ${currentStatus}`,
        record.id,
        claimedAttempts
      );
      return true;

    // B. RECIPIENT ENGAGEMENT EVENT ('opened', 'clicked', 'proxy_open')
    // Invariant: Engagement is NOT proof of delivery confirmation and NEVER advances status to DELIVERED or clears AMBIGUOUS_OUTCOME.
    } else if (category.isEngagement) {
      const existingEngagement = (existingMeta.engagement as Record<string, any>) || {};
      const engagementTimeIso = (providerEventTime || new Date()).toISOString();
      const updatedEngagement: Record<string, any> = {
        ...existingEngagement,
        lastEvent: record.eventType,
        lastEngagementAt: engagementTimeIso
      };

      if (record.eventType.includes('open')) {
        updatedEngagement.openedAt = updatedEngagement.openedAt || engagementTimeIso;
        updatedEngagement.lastOpenedAt = engagementTimeIso;
        updatedEngagement.openCount = (updatedEngagement.openCount || 0) + 1;
      } else if (record.eventType.includes('click')) {
        updatedEngagement.clickedAt = updatedEngagement.clickedAt || engagementTimeIso;
        updatedEngagement.lastClickedAt = engagementTimeIso;
        updatedEngagement.clickCount = (updatedEngagement.clickCount || 0) + 1;
        if (record.rawPayload?.link) {
          updatedEngagement.lastClickedUrl = String(record.rawPayload.link).slice(0, 500);
        }
      }

      const updatedMeta = sanitizeJsonPayload({
        ...existingMeta,
        engagement: updatedEngagement
      });

      const txSuccess = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `UPDATE \`InvoiceNotificationOutbox\`
           SET \`metadata\` = ?,
               \`updatedAt\` = NOW(3)
           WHERE \`id\` = ?`,
          JSON.stringify(updatedMeta),
          outbox.id
        );

        if (matchedEmail) {
          const emailMeta = (matchedEmail.metadata as Record<string, any>) || {};
          await tx.emailMessage.update({
            where: { id: matchedEmail.id },
            data: {
              metadata: sanitizeJsonPayload({
                ...emailMeta,
                engagement: updatedEngagement
              })
            }
          }).catch(() => {});
        }

        const inboxUpdateRes = await tx.$executeRawUnsafe(
          `UPDATE \`EmailWebhookInbox\`
           SET \`status\` = 'PROCESSED',
               \`matchedOutboxId\` = ?,
               \`matchedEmailMessageId\` = ?,
               \`reconciledAt\` = NOW(3),
               \`updatedAt\` = NOW(3)
           WHERE \`id\` = ? AND \`status\` = 'PROCESSING' AND \`processingAttempts\` = ?`,
          outbox.id,
          matchedEmail ? matchedEmail.id : (outbox.emailMessageId || null),
          record.id,
          claimedAttempts
        );

        if (inboxUpdateRes === 0) {
          throw new Error('STALE_WORKER_FENCING_REJECTED');
        }
        return true;
      }).catch((err) => {
        if (err?.message === 'STALE_WORKER_FENCING_REJECTED') {
          result.staleFencingCount++;
          return false;
        }
        throw err;
      });

      if (txSuccess) {
        result.engagementRecordedCount++;
        return true;
      }
      return false;

    // C. TERMINAL FAILURE EVENT ('hard_bounce', 'invalid_email', 'blocked', 'spam')
    } else if (category.isTerminalFailure) {
      if (currentStatus === InvoiceNotificationOutboxStatus.DISPATCHED ||
          currentStatus === InvoiceNotificationOutboxStatus.AMBIGUOUS_OUTCOME) {
        const failureReason = sanitizeFailureReason(record.rawPayload?.reason || record.eventType);

        const updatedMeta = sanitizeJsonPayload({
          ...existingMeta,
          reconciledBy: this.workerId,
          providerEventTimestamp: providerEventTime ? providerEventTime.toISOString() : null,
          eventTimestampMissing: !providerEventTime,
          reconciledAt: new Date().toISOString()
        });

        const txSuccess = await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            `UPDATE \`InvoiceNotificationOutbox\`
             SET \`status\` = 'PERMANENT_FAILURE',
                 \`failedAt\` = COALESCE(\`failedAt\`, ?),
                 \`failureCode\` = ?,
                 \`failureReason\` = ?,
                 \`metadata\` = ?,
                 \`updatedAt\` = NOW(3)
             WHERE \`id\` = ? AND \`status\` = ?`,
            eventTimeForDb,
            `BREVO_WEBHOOK_${record.eventType.toUpperCase()}`,
            failureReason,
            JSON.stringify(updatedMeta),
            outbox.id,
            currentStatus
          );

          if (matchedEmail) {
            await tx.emailMessage.update({
              where: { id: matchedEmail.id },
              data: {
                status: EmailMessageStatus.BOUNCED,
                failedAt: matchedEmail.failedAt || eventTimeForDb,
                failureReason
              }
            }).catch(() => {});
          }

          const inboxUpdateRes = await tx.$executeRawUnsafe(
            `UPDATE \`EmailWebhookInbox\`
             SET \`status\` = 'PROCESSED',
                 \`matchedOutboxId\` = ?,
                 \`matchedEmailMessageId\` = ?,
                 \`reconciledAt\` = NOW(3),
                 \`updatedAt\` = NOW(3)
             WHERE \`id\` = ? AND \`status\` = 'PROCESSING' AND \`processingAttempts\` = ?`,
            outbox.id,
            matchedEmail ? matchedEmail.id : (outbox.emailMessageId || null),
            record.id,
            claimedAttempts
          );

          if (inboxUpdateRes === 0) {
            throw new Error('STALE_WORKER_FENCING_REJECTED');
          }
          return true;
        }).catch((err) => {
          if (err?.message === 'STALE_WORKER_FENCING_REJECTED') {
            result.staleFencingCount++;
            return false;
          }
          throw err;
        });

        if (txSuccess) {
          result.permanentFailureCount++;
          return true;
        }
        return false;
      }

      if (currentStatus === InvoiceNotificationOutboxStatus.DELIVERED) {
        // CONFLICTING EVIDENCE: Terminal bounce received after confirmed delivery
        const conflictingEvents = Array.isArray(existingMeta.conflictingEvents)
          ? existingMeta.conflictingEvents
          : [];

        const updatedMeta = sanitizeJsonPayload({
          ...existingMeta,
          hasConflictingEvidence: true,
          conflictingEvents: [
            ...conflictingEvents.slice(-10),
            {
              eventType: record.eventType,
              isCurrentAttempt: true,
              providerMessageId: cleanMessageId,
              eventTimestamp: providerEventTime ? providerEventTime.toISOString() : null,
              eventTimestampMissing: !providerEventTime,
              receivedAt: record.receivedAt ? new Date(record.receivedAt).toISOString() : new Date().toISOString(),
              existingStatus: 'DELIVERED',
              reason: record.rawPayload?.reason || record.eventType,
              note: 'Terminal bounce webhook received after delivery was already confirmed'
            }
          ]
        });

        const txSuccess = await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            `UPDATE \`InvoiceNotificationOutbox\`
             SET \`metadata\` = ?,
                 \`updatedAt\` = NOW(3)
             WHERE \`id\` = ?`,
            JSON.stringify(updatedMeta),
            outbox.id
          );

          const inboxUpdateRes = await tx.$executeRawUnsafe(
            `UPDATE \`EmailWebhookInbox\`
             SET \`status\` = 'PROCESSED',
                 \`matchedOutboxId\` = ?,
                 \`matchedEmailMessageId\` = ?,
                 \`reconciledAt\` = NOW(3),
                 \`lastError\` = 'Conflicting terminal failure received after confirmed delivery; recorded in metadata for operator review',
                 \`updatedAt\` = NOW(3)
             WHERE \`id\` = ? AND \`status\` = 'PROCESSING' AND \`processingAttempts\` = ?`,
            outbox.id,
            matchedEmail ? matchedEmail.id : (outbox.emailMessageId || null),
            record.id,
            claimedAttempts
          );

          if (inboxUpdateRes === 0) {
            throw new Error('STALE_WORKER_FENCING_REJECTED');
          }
          return true;
        }).catch((err) => {
          if (err?.message === 'STALE_WORKER_FENCING_REJECTED') {
            result.staleFencingCount++;
            return false;
          }
          throw err;
        });

        if (txSuccess) {
          result.conflictingEvidenceCount++;
          return true;
        }
        return false;
      }

      // Otherwise acknowledge
      await prisma.$executeRawUnsafe(
        `UPDATE \`EmailWebhookInbox\`
         SET \`status\` = 'PROCESSED',
             \`matchedOutboxId\` = ?,
             \`matchedEmailMessageId\` = ?,
             \`reconciledAt\` = NOW(3),
             \`updatedAt\` = NOW(3)
         WHERE \`id\` = ? AND \`status\` = 'PROCESSING' AND \`processingAttempts\` = ?`,
        outbox.id,
        matchedEmail ? matchedEmail.id : (outbox.emailMessageId || null),
        record.id,
        claimedAttempts
      );
      return true;

    // D. TRANSIENT OR INFORMATIONAL EVENT ('deferred', 'soft_bounce', 'request', 'sent')
    } else {
      const updatedMeta = sanitizeJsonPayload({
        ...existingMeta,
        lastProviderWebhookEvent: record.eventType,
        providerEventTimestamp: providerEventTime ? providerEventTime.toISOString() : null,
        eventTimestampMissing: !providerEventTime,
        lastProviderWebhookAt: (providerEventTime || new Date()).toISOString()
      });

      const txSuccess = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `UPDATE \`InvoiceNotificationOutbox\`
           SET \`metadata\` = ?,
               \`updatedAt\` = NOW(3)
           WHERE \`id\` = ?`,
          JSON.stringify(updatedMeta),
          outbox.id
        );

        const inboxUpdateRes = await tx.$executeRawUnsafe(
          `UPDATE \`EmailWebhookInbox\`
           SET \`status\` = 'PROCESSED',
               \`matchedOutboxId\` = ?,
               \`matchedEmailMessageId\` = ?,
               \`reconciledAt\` = NOW(3),
               \`updatedAt\` = NOW(3)
           WHERE \`id\` = ? AND \`status\` = 'PROCESSING' AND \`processingAttempts\` = ?`,
          outbox.id,
          matchedEmail ? matchedEmail.id : (outbox.emailMessageId || null),
          record.id,
          claimedAttempts
        );

        if (inboxUpdateRes === 0) {
          throw new Error('STALE_WORKER_FENCING_REJECTED');
        }
        return true;
      }).catch((err) => {
        if (err?.message === 'STALE_WORKER_FENCING_REJECTED') {
          result.staleFencingCount++;
          return false;
        }
        throw err;
      });

      if (txSuccess) {
        return true;
      }
      return false;
    }
  }

  /**
   * Reconciles a webhook event that matches a HISTORICAL providerMessageId from a prior attempt.
   * Ensures that older attempt events never overwrite or corrupt an active newer resend attempt.
   */
  private async reconcileHistoricalAttemptRecord(params: {
    record: any;
    outbox: any;
    matchedEmail: any;
    cleanMessageId: string;
    category: ReturnType<typeof classifyWebhookEventCategory>;
    currentStatus: InvoiceNotificationOutboxStatus;
    existingMeta: Record<string, any>;
    providerEventTime: Date | null;
    eventTimeForDb: Date;
    claimedAttempts: number;
    result: ReconciliationBatchResult;
  }): Promise<boolean> {
    const {
      record,
      outbox,
      matchedEmail,
      cleanMessageId,
      category,
      currentStatus,
      existingMeta,
      providerEventTime,
      eventTimeForDb,
      claimedAttempts,
      result
    } = params;

    const priorAttempts: any[] = Array.isArray(existingMeta.priorAttempts)
      ? [...existingMeta.priorAttempts]
      : [];

    const matchedIndex = priorAttempts.findIndex((p: any) => {
      const pId = p.providerMessageId ? String(p.providerMessageId).replace(/^<|>$/g, '').trim() : null;
      return pId === cleanMessageId;
    });

    const matchedPrior = matchedIndex >= 0 ? { ...priorAttempts[matchedIndex] } : null;

    // Build historical attempt event telemetry
    const histEvent = {
      providerMessageId: cleanMessageId,
      attemptNumber: matchedPrior?.attemptNumber ?? null,
      eventType: record.eventType,
      category: category.isDeliveryConfirmation
        ? 'DELIVERY_CONFIRMATION'
        : category.isTerminalFailure
        ? 'TERMINAL_FAILURE'
        : category.isEngagement
        ? 'ENGAGEMENT'
        : 'TRANSIENT',
      eventTimestamp: providerEventTime ? providerEventTime.toISOString() : null,
      eventTimestampMissing: !providerEventTime,
      receivedAt: record.receivedAt ? new Date(record.receivedAt).toISOString() : new Date().toISOString(),
      reconciledAt: new Date().toISOString()
    };

    const historicalAttemptEvents = Array.isArray(existingMeta.historicalAttemptEvents)
      ? [...existingMeta.historicalAttemptEvents.slice(-20), histEvent]
      : [histEvent];

    if (matchedPrior && matchedIndex >= 0) {
      matchedPrior.lastWebhookEvent = record.eventType;
      matchedPrior.lastWebhookAt = new Date().toISOString();
      matchedPrior.providerEventTimestamp = providerEventTime ? providerEventTime.toISOString() : null;
      if (category.isDeliveryConfirmation) {
        matchedPrior.deliveryConfirmed = true;
        matchedPrior.deliveredAt = providerEventTime ? providerEventTime.toISOString() : new Date().toISOString();
      } else if (category.isTerminalFailure) {
        matchedPrior.terminalFailure = true;
        matchedPrior.failureReason = sanitizeFailureReason(record.rawPayload?.reason || record.eventType);
      }
      priorAttempts[matchedIndex] = matchedPrior;
    }

    // A. HISTORICAL DELIVERY CONFIRMATION ('delivered')
    if (category.isDeliveryConfirmation) {
      // If customer received the statutory notification via the historical attempt:
      if (currentStatus === InvoiceNotificationOutboxStatus.DISPATCHED ||
          currentStatus === InvoiceNotificationOutboxStatus.AMBIGUOUS_OUTCOME ||
          currentStatus === InvoiceNotificationOutboxStatus.PENDING) {
        const updatedMeta = sanitizeJsonPayload({
          ...existingMeta,
          priorAttempts,
          historicalAttemptEvents,
          deliveredViaHistoricalAttempt: true,
          historicalDeliveryProviderMessageId: cleanMessageId,
          historicalDeliveryAttemptNumber: matchedPrior?.attemptNumber ?? null,
          historicalDeliveryNote: 'Statutory delivery fulfilled by historical attempt; current resend may result in duplicate recipient delivery',
          providerEventTimestamp: providerEventTime ? providerEventTime.toISOString() : null,
          eventTimestampMissing: !providerEventTime,
          reconciledBy: this.workerId,
          reconciledAt: new Date().toISOString()
        });

        const txSuccess = await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            `UPDATE \`InvoiceNotificationOutbox\`
             SET \`status\` = 'DELIVERED',
                 \`deliveredAt\` = COALESCE(\`deliveredAt\`, ?),
                 \`ambiguousReason\` = CASE WHEN \`status\` = 'AMBIGUOUS_OUTCOME' THEN 'Resolved by historical delivery webhook' ELSE \`ambiguousReason\` END,
                 \`metadata\` = ?,
                 \`updatedAt\` = NOW(3)
             WHERE \`id\` = ? AND \`status\` = ?`,
            eventTimeForDb,
            JSON.stringify(updatedMeta),
            outbox.id,
            currentStatus
          );

          if (matchedEmail && matchedEmail.status !== EmailMessageStatus.DELIVERED) {
            await tx.emailMessage.update({
              where: { id: matchedEmail.id },
              data: {
                status: EmailMessageStatus.DELIVERED,
                deliveredAt: matchedEmail.deliveredAt || eventTimeForDb
              }
            }).catch(() => {});
          }

          const inboxUpdateRes = await tx.$executeRawUnsafe(
            `UPDATE \`EmailWebhookInbox\`
             SET \`status\` = 'PROCESSED',
                 \`matchedOutboxId\` = ?,
                 \`matchedEmailMessageId\` = ?,
                 \`reconciledAt\` = NOW(3),
                 \`updatedAt\` = NOW(3)
             WHERE \`id\` = ? AND \`status\` = 'PROCESSING' AND \`processingAttempts\` = ?`,
            outbox.id,
            matchedEmail ? matchedEmail.id : (outbox.emailMessageId || null),
            record.id,
            claimedAttempts
          );

          if (inboxUpdateRes === 0) {
            throw new Error('STALE_WORKER_FENCING_REJECTED');
          }
          return true;
        }).catch((err) => {
          if (err?.message === 'STALE_WORKER_FENCING_REJECTED') {
            result.staleFencingCount++;
            return false;
          }
          throw err;
        });

        if (txSuccess) {
          result.deliveredCount++;
          return true;
        }
        return false;
      }

      if (currentStatus === InvoiceNotificationOutboxStatus.DELIVERED) {
        // Already DELIVERED: idempotent historical duplicate confirmation
        const updatedMeta = sanitizeJsonPayload({
          ...existingMeta,
          priorAttempts,
          historicalAttemptEvents
        });

        const txSuccess = await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            `UPDATE \`InvoiceNotificationOutbox\`
             SET \`metadata\` = ?,
                 \`updatedAt\` = NOW(3)
             WHERE \`id\` = ?`,
            JSON.stringify(updatedMeta),
            outbox.id
          );

          const inboxUpdateRes = await tx.$executeRawUnsafe(
            `UPDATE \`EmailWebhookInbox\`
             SET \`status\` = 'DUPLICATE',
                 \`matchedOutboxId\` = ?,
                 \`matchedEmailMessageId\` = ?,
                 \`reconciledAt\` = NOW(3),
                 \`updatedAt\` = NOW(3)
             WHERE \`id\` = ? AND \`status\` = 'PROCESSING' AND \`processingAttempts\` = ?`,
            outbox.id,
            matchedEmail ? matchedEmail.id : (outbox.emailMessageId || null),
            record.id,
            claimedAttempts
          );

          if (inboxUpdateRes === 0) {
            throw new Error('STALE_WORKER_FENCING_REJECTED');
          }
          return true;
        }).catch((err) => {
          if (err?.message === 'STALE_WORKER_FENCING_REJECTED') {
            result.staleFencingCount++;
            return false;
          }
          throw err;
        });

        if (txSuccess) {
          result.duplicateCount++;
          return true;
        }
        return false;
      }

      if (currentStatus === InvoiceNotificationOutboxStatus.PERMANENT_FAILURE ||
          currentStatus === InvoiceNotificationOutboxStatus.EXHAUSTED) {
        // Conflicting: Historical delivery on record in terminal failure
        const conflictingEvents = Array.isArray(existingMeta.conflictingEvents)
          ? existingMeta.conflictingEvents
          : [];

        const updatedMeta = sanitizeJsonPayload({
          ...existingMeta,
          priorAttempts,
          historicalAttemptEvents,
          hasConflictingEvidence: true,
          conflictingEvents: [
            ...conflictingEvents.slice(-10),
            {
              eventType: record.eventType,
              isHistoricalAttempt: true,
              providerMessageId: cleanMessageId,
              attemptNumber: matchedPrior?.attemptNumber ?? null,
              eventTimestamp: providerEventTime ? providerEventTime.toISOString() : null,
              eventTimestampMissing: !providerEventTime,
              receivedAt: record.receivedAt ? new Date(record.receivedAt).toISOString() : new Date().toISOString(),
              existingStatus: currentStatus,
              note: 'Delivery confirmation webhook received for historical attempt while current outbox is in terminal failure'
            }
          ]
        });

        const txSuccess = await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            `UPDATE \`InvoiceNotificationOutbox\`
             SET \`metadata\` = ?,
                 \`updatedAt\` = NOW(3)
             WHERE \`id\` = ?`,
            JSON.stringify(updatedMeta),
            outbox.id
          );

          const inboxUpdateRes = await tx.$executeRawUnsafe(
            `UPDATE \`EmailWebhookInbox\`
             SET \`status\` = 'PROCESSED',
                 \`matchedOutboxId\` = ?,
                 \`matchedEmailMessageId\` = ?,
                 \`reconciledAt\` = NOW(3),
                 \`lastError\` = 'Conflicting historical delivery event for outbox in terminal failure; recorded in metadata',
                 \`updatedAt\` = NOW(3)
             WHERE \`id\` = ? AND \`status\` = 'PROCESSING' AND \`processingAttempts\` = ?`,
            outbox.id,
            matchedEmail ? matchedEmail.id : (outbox.emailMessageId || null),
            record.id,
            claimedAttempts
          );

          if (inboxUpdateRes === 0) {
            throw new Error('STALE_WORKER_FENCING_REJECTED');
          }
          return true;
        }).catch((err) => {
          if (err?.message === 'STALE_WORKER_FENCING_REJECTED') {
            result.staleFencingCount++;
            return false;
          }
          throw err;
        });

        if (txSuccess) {
          result.conflictingEvidenceCount++;
          return true;
        }
        return false;
      }

    // B. HISTORICAL TERMINAL FAILURE ('hard_bounce', 'blocked', 'spam')
    } else if (category.isTerminalFailure) {
      // RULE: If a resend was authorized / running / dispatched (PENDING, CLAIMED, DISPATCHED),
      // an older attempt bouncing must NEVER terminate or mutate the current active resend attempt!
      if (currentStatus === InvoiceNotificationOutboxStatus.PENDING ||
          currentStatus === InvoiceNotificationOutboxStatus.CLAIMED ||
          currentStatus === InvoiceNotificationOutboxStatus.DISPATCHED) {
        const updatedMeta = sanitizeJsonPayload({
          ...existingMeta,
          priorAttempts,
          historicalAttemptEvents,
          historicalBounceObserved: true,
          lastHistoricalBounceMessageId: cleanMessageId
        });

        const txSuccess = await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            `UPDATE \`InvoiceNotificationOutbox\`
             SET \`metadata\` = ?,
                 \`updatedAt\` = NOW(3)
             WHERE \`id\` = ?`,
            JSON.stringify(updatedMeta),
            outbox.id
          );

          const inboxUpdateRes = await tx.$executeRawUnsafe(
            `UPDATE \`EmailWebhookInbox\`
             SET \`status\` = 'PROCESSED',
                 \`matchedOutboxId\` = ?,
                 \`matchedEmailMessageId\` = ?,
                 \`reconciledAt\` = NOW(3),
                 \`lastError\` = 'Historical attempt bounce recorded in metadata; active resend attempt preserved without mutation',
                 \`updatedAt\` = NOW(3)
             WHERE \`id\` = ? AND \`status\` = 'PROCESSING' AND \`processingAttempts\` = ?`,
            outbox.id,
            matchedEmail ? matchedEmail.id : (outbox.emailMessageId || null),
            record.id,
            claimedAttempts
          );

          if (inboxUpdateRes === 0) {
            throw new Error('STALE_WORKER_FENCING_REJECTED');
          }
          return true;
        }).catch((err) => {
          if (err?.message === 'STALE_WORKER_FENCING_REJECTED') {
            result.staleFencingCount++;
            return false;
          }
          throw err;
        });

        if (txSuccess) {
          result.processedCount++;
          return true;
        }
        return false;
      }

      if (currentStatus === InvoiceNotificationOutboxStatus.DELIVERED) {
        // Conflicting: Older attempt bounced while current is delivered
        const conflictingEvents = Array.isArray(existingMeta.conflictingEvents)
          ? existingMeta.conflictingEvents
          : [];

        const updatedMeta = sanitizeJsonPayload({
          ...existingMeta,
          priorAttempts,
          historicalAttemptEvents,
          hasConflictingEvidence: true,
          conflictingEvents: [
            ...conflictingEvents.slice(-10),
            {
              eventType: record.eventType,
              isHistoricalAttempt: true,
              providerMessageId: cleanMessageId,
              attemptNumber: matchedPrior?.attemptNumber ?? null,
              eventTimestamp: providerEventTime ? providerEventTime.toISOString() : null,
              eventTimestampMissing: !providerEventTime,
              receivedAt: record.receivedAt ? new Date(record.receivedAt).toISOString() : new Date().toISOString(),
              existingStatus: 'DELIVERED',
              reason: record.rawPayload?.reason || record.eventType,
              note: 'Terminal failure webhook for historical attempt received while notification is confirmed DELIVERED'
            }
          ]
        });

        const txSuccess = await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            `UPDATE \`InvoiceNotificationOutbox\`
             SET \`metadata\` = ?,
                 \`updatedAt\` = NOW(3)
             WHERE \`id\` = ?`,
            JSON.stringify(updatedMeta),
            outbox.id
          );

          const inboxUpdateRes = await tx.$executeRawUnsafe(
            `UPDATE \`EmailWebhookInbox\`
             SET \`status\` = 'PROCESSED',
                 \`matchedOutboxId\` = ?,
                 \`matchedEmailMessageId\` = ?,
                 \`reconciledAt\` = NOW(3),
                 \`lastError\` = 'Historical bounce for delivered record; recorded in conflictingEvents metadata',
                 \`updatedAt\` = NOW(3)
             WHERE \`id\` = ? AND \`status\` = 'PROCESSING' AND \`processingAttempts\` = ?`,
            outbox.id,
            matchedEmail ? matchedEmail.id : (outbox.emailMessageId || null),
            record.id,
            claimedAttempts
          );

          if (inboxUpdateRes === 0) {
            throw new Error('STALE_WORKER_FENCING_REJECTED');
          }
          return true;
        }).catch((err) => {
          if (err?.message === 'STALE_WORKER_FENCING_REJECTED') {
            result.staleFencingCount++;
            return false;
          }
          throw err;
        });

        if (txSuccess) {
          result.conflictingEvidenceCount++;
          return true;
        }
        return false;
      }

    // C. HISTORICAL ENGAGEMENT OR TRANSIENT EVENT
    } else {
      const updatedMeta = sanitizeJsonPayload({
        ...existingMeta,
        priorAttempts,
        historicalAttemptEvents
      });

      const txSuccess = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `UPDATE \`InvoiceNotificationOutbox\`
           SET \`metadata\` = ?,
               \`updatedAt\` = NOW(3)
           WHERE \`id\` = ?`,
          JSON.stringify(updatedMeta),
          outbox.id
        );

        const inboxUpdateRes = await tx.$executeRawUnsafe(
          `UPDATE \`EmailWebhookInbox\`
           SET \`status\` = 'PROCESSED',
               \`matchedOutboxId\` = ?,
               \`matchedEmailMessageId\` = ?,
               \`reconciledAt\` = NOW(3),
               \`updatedAt\` = NOW(3)
           WHERE \`id\` = ? AND \`status\` = 'PROCESSING' AND \`processingAttempts\` = ?`,
          outbox.id,
          matchedEmail ? matchedEmail.id : (outbox.emailMessageId || null),
          record.id,
          claimedAttempts
        );

        if (inboxUpdateRes === 0) {
          throw new Error('STALE_WORKER_FENCING_REJECTED');
        }
        return true;
      }).catch((err) => {
        if (err?.message === 'STALE_WORKER_FENCING_REJECTED') {
          result.staleFencingCount++;
          return false;
        }
        throw err;
      });

      if (txSuccess) {
        if (category.isEngagement) {
          result.engagementRecordedCount++;
        }
        return true;
      }
      return false;
    }

    return true;
  }

  /**
   * Helper to reconcile events matching an EmailMessage without an Outbox row.
   */
  private async reconcileGeneralEmail(
    tx: Prisma.TransactionClient,
    record: { eventType: string; eventTimestamp: Date | null },
    email: { id: string; status: EmailMessageStatus; deliveredAt: Date | null; failedAt: Date | null }
  ): Promise<void> {
    const category = classifyWebhookEventCategory(record.eventType);
    const eventTime = record.eventTimestamp ? new Date(record.eventTimestamp) : new Date();

    if (category.isDeliveryConfirmation && email.status !== EmailMessageStatus.DELIVERED) {
      await tx.emailMessage.update({
        where: { id: email.id },
        data: {
          status: EmailMessageStatus.DELIVERED,
          deliveredAt: email.deliveredAt || eventTime
        }
      }).catch(() => {});
    } else if (category.isTerminalFailure && email.status !== EmailMessageStatus.DELIVERED) {
      await tx.emailMessage.update({
        where: { id: email.id },
        data: {
          status: EmailMessageStatus.BOUNCED,
          failedAt: email.failedAt || eventTime
        }
      }).catch(() => {});
    }
  }

  /**
   * Updates an inbox record status to FAILED with error diagnostic information.
   */
  private async markRecordFailed(inboxId: string, errorReason: string, claimedAttempts?: number): Promise<void> {
    try {
      const whereClause = claimedAttempts !== undefined
        ? `WHERE \`id\` = ? AND \`status\` = 'PROCESSING' AND \`processingAttempts\` = ?`
        : `WHERE \`id\` = ?`;
      const params = claimedAttempts !== undefined
        ? [sanitizeFailureReason(errorReason).slice(0, 1000), inboxId, claimedAttempts]
        : [sanitizeFailureReason(errorReason).slice(0, 1000), inboxId];

      await prisma.$executeRawUnsafe(
        `UPDATE \`EmailWebhookInbox\`
         SET \`status\` = 'FAILED',
             \`lastError\` = ?,
             \`updatedAt\` = NOW(3)
         ${whereClause}`,
        ...params
      );
    } catch {
      // Best-effort error recording
    }
  }
}

export const emailWebhookReconciliationWorker = EmailWebhookReconciliationWorker.getInstance();
