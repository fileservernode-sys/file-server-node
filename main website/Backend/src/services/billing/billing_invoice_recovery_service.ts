import { prisma } from '../../config/database.js';
import { config } from '../../config/env.js';
import {
  PaymentStatus,
  BillingPayment,
  BillingInvoice,
  BillingInvoiceStatus,
  EmailMessageStatus,
  Prisma
} from '@prisma/client';
import { appLogger } from '../../observability/logger.js';
import { StatutorySellerConfigService } from './statutory_seller_config_service.js';
import { BillingInvoiceService } from './billing_invoice_service.js';
import { BillingInvoiceNotificationService } from './billing_invoice_notification_service.js';
import {
  classifyEmailFailure,
  EmailFailureDisposition
} from '../email_failure_classifier.js';
import {
  StatutoryConfigurationMissingError,
  ValidationError,
  ConflictError
} from '../../errors/app-error.js';

export interface RecoveryCursor {
  createdAt: Date | string;
  id: string;
}

export interface DeferredInvoiceRecoveryOptions {
  batchSize?: number;
  offset?: number;
  cursor?: RecoveryCursor;
  dryRun?: boolean;
}

export interface DeferredInvoiceNotificationRecoveryOptions {
  batchSize?: number;
  offset?: number;
  cursor?: RecoveryCursor;
  dryRun?: boolean;
  maxAgeHours?: number;
}

export interface DeferredInvoiceNotificationRecoveryResult {
  success: boolean;
  dryRun: boolean;
  totalDiscovered: number;
  attempted: number;
  alreadyNotified: number;
  newlyDispatched: number;
  inProgressSkipped: number;
  skippedIneligible: number;
  failed: number;
  isCompleteSuccess: boolean;
  isPartialSuccess: boolean;
  isCompleteFailure: boolean;
  nextCursor?: RecoveryCursor | null;
  errors: Array<{
    invoiceId: string;
    invoiceNumber: string;
    error: string;
  }>;
}

export type RecoveryFailureCategory = 'PERMANENT' | 'TRANSIENT' | 'INELIGIBLE' | 'CONFIGURATION';

export interface RecoveryItemError {
  paymentId: string;
  error: string;
  errorCode?: string;
  category: RecoveryFailureCategory;
}

export interface DeferredInvoiceRecoveryResult {
  success: boolean;
  dryRun: boolean;
  totalDiscovered: number;
  attempted: number;
  succeeded: number;          // Newly issued invoices
  alreadyIssued: number;      // Idempotently skipped because invoice was already issued
  skippedIneligible: number;  // Skipped because payment transitioned to ineligible status (e.g. REFUNDED)
  skipped: number;            // Total skipped (alreadyIssued + skippedIneligible) for backward compatibility
  failed: number;             // Total failures
  transientFailures: number;  // Transient failures (deadlock, network, timeout)
  permanentFailures: number;  // Permanent failures (validation, configuration, address defects)
  isCompleteSuccess: boolean;
  isPartialSuccess: boolean;
  isCompleteFailure: boolean;
  nextCursor?: RecoveryCursor | null;
  reason?: string;
  configErrors?: string[];
  errors: RecoveryItemError[];
}

/**
 * Service for discovering and recovering deferred statutory tax invoices.
 *
 * Provides durable, queue-less recovery for payments that succeeded at the provider
 * but had their statutory tax invoices deferred (e.g., due to unconfigured seller details
 * or transient issuance blocks).
 *
 * Operates strictly fail-closed: if statutory seller configuration remains unapproved
 * or incomplete, the recovery loop aborts before attempting invoice issuance.
 */
export class BillingInvoiceRecoveryService {
  /**
   * Discovers successful payments that currently lack an associated statutory invoice.
   *
   * Supports stable keyset pagination using (createdAt, id) composite cursor to prevent
   * pagination drift when previous records receive invoices and leave the { invoice: null } set.
   * Preserves backward compatibility with legacy numeric offset pagination when cursor is omitted.
   */
  public static async findPendingUninvoicedPayments(
    options?: { limit?: number; offset?: number; cursor?: RecoveryCursor }
  ): Promise<BillingPayment[]> {
    const limit = Math.min(200, Math.max(1, options?.limit || 50));

    let whereClause: any = {
      status: PaymentStatus.SUCCESS,
      providerPaymentId: { not: null },
      invoice: null
    };

    if (options?.cursor) {
      if (!options.cursor.createdAt || !options.cursor.id) {
        throw new ValidationError('Both cursor.createdAt and cursor.id are required for keyset pagination');
      }

      const cursorDate = options.cursor.createdAt instanceof Date
        ? options.cursor.createdAt
        : new Date(options.cursor.createdAt);

      if (isNaN(cursorDate.getTime())) {
        throw new ValidationError('Invalid cursor createdAt timestamp: must be a valid ISO Date');
      }

      if (typeof options.cursor.id !== 'string' || options.cursor.id.trim().length === 0) {
        throw new ValidationError('Invalid cursor id: must be a non-empty string');
      }

      whereClause = {
        ...whereClause,
        OR: [
          { createdAt: { gt: cursorDate } },
          { createdAt: cursorDate, id: { gt: options.cursor.id.trim() } }
        ]
      };

      return prisma.billingPayment.findMany({
        where: whereClause,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit
      });
    }

    const skip = Math.max(0, options?.offset || 0);
    return prisma.billingPayment.findMany({
      where: whereClause,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip,
      take: limit
    });
  }

  /**
   * Returns the count of successful payments that are pending invoice issuance.
   */
  public static async countPendingUninvoicedPayments(): Promise<number> {
    return prisma.billingPayment.count({
      where: {
        status: PaymentStatus.SUCCESS,
        providerPaymentId: { not: null },
        invoice: null
      }
    });
  }

  /**
   * Retries deferred invoice generation in bounded batches.
   * Enforces fail-closed statutory configuration checks prior to processing.
   *
   * Uses keyset cursor pagination to prevent offset drift and accurately categorizes
   * outcomes into newly issued, already existing, ineligible, permanent, and transient failures.
   */
  public static async retryDeferredInvoices(
    options: DeferredInvoiceRecoveryOptions = {}
  ): Promise<DeferredInvoiceRecoveryResult> {
    const dryRun = Boolean(options.dryRun);
    const batchSize = Math.min(200, Math.max(1, options.batchSize || 50));
    const offset = Math.max(0, options.offset || 0);

    // 1. Fail-closed prerequisite check: evaluate seller configuration
    const configEval = StatutorySellerConfigService.evaluateSellerConfig();
    if (!configEval.isValid) {
      const configErrors = configEval.missingFields.concat(configEval.validationErrors);
      appLogger.warn(
        '[BillingInvoiceRecovery] Aborting deferred invoice recovery: statutory seller configuration is unapproved or incomplete',
        {
          metadata: {
            missingFields: configEval.missingFields,
            validationErrors: configEval.validationErrors
          }
        }
      );

      return {
        success: false,
        dryRun,
        totalDiscovered: 0,
        attempted: 0,
        succeeded: 0,
        alreadyIssued: 0,
        skippedIneligible: 0,
        skipped: 0,
        failed: 0,
        transientFailures: 0,
        permanentFailures: 0,
        isCompleteSuccess: false,
        isPartialSuccess: false,
        isCompleteFailure: true,
        nextCursor: null,
        reason: 'STATUTORY_SELLER_CONFIG_INCOMPLETE',
        configErrors,
        errors: []
      };
    }

    // 2. Discover pending uninvoiced payments using keyset cursor or offset
    const pendingPayments = await this.findPendingUninvoicedPayments({
      limit: batchSize,
      offset: options.cursor ? undefined : offset,
      cursor: options.cursor
    });

    const totalDiscovered = pendingPayments.length;
    const lastPayment = pendingPayments.length > 0 ? pendingPayments[pendingPayments.length - 1] : null;
    const nextCursor: RecoveryCursor | null = lastPayment
      ? { createdAt: lastPayment.createdAt, id: lastPayment.id }
      : null;

    if (dryRun) {
      appLogger.info(
        `[BillingInvoiceRecovery] Dry-run preview: discovered ${totalDiscovered} pending payments for recovery`,
        {
          metadata: {
            totalDiscovered,
            paymentIds: pendingPayments.map((p) => p.id),
            nextCursor
          }
        }
      );

      return {
        success: true,
        dryRun: true,
        totalDiscovered,
        attempted: 0,
        succeeded: 0,
        alreadyIssued: 0,
        skippedIneligible: 0,
        skipped: 0,
        failed: 0,
        transientFailures: 0,
        permanentFailures: 0,
        isCompleteSuccess: false,
        isPartialSuccess: false,
        isCompleteFailure: false,
        nextCursor,
        errors: []
      };
    }

    // 3. Process discovered payments sequentially with isolation
    let attempted = 0;
    let succeeded = 0;
    let alreadyIssued = 0;
    let skippedIneligible = 0;
    let failed = 0;
    let transientFailures = 0;
    let permanentFailures = 0;
    const errors: RecoveryItemError[] = [];

    for (const payment of pendingPayments) {
      attempted++;
      try {
        const result = await BillingInvoiceService.generateInvoiceForPayment(payment.id);
        if (result.isExisting) {
          alreadyIssued++;
        } else {
          succeeded++;
        }
      } catch (err: any) {
        const errorMessage = err?.message || String(err);
        const errorCode = err?.errorCode || err?.code || (err?.name ? String(err.name) : 'UNKNOWN_ERROR');

        if (err instanceof ConflictError) {
          // Payment transitioned to ineligible status (e.g. REFUNDED) or duplicate conflict - skip issuance
          skippedIneligible++;
          errors.push({
            paymentId: payment.id,
            error: errorMessage,
            errorCode,
            category: 'INELIGIBLE'
          });

          appLogger.warn(
            `[BillingInvoiceRecovery] Payment ${payment.id} skipped due to ineligibility: ${errorMessage}`,
            {
              metadata: {
                paymentId: payment.id,
                error: errorMessage,
                errorCode,
                category: 'INELIGIBLE'
              }
            }
          );
        } else {
          failed++;
          let category: RecoveryFailureCategory = 'TRANSIENT';
          if (err instanceof ValidationError) {
            category = 'PERMANENT';
            permanentFailures++;
          } else if (err instanceof StatutoryConfigurationMissingError) {
            category = 'CONFIGURATION';
            permanentFailures++;
          } else {
            category = 'TRANSIENT';
            transientFailures++;
          }

          errors.push({
            paymentId: payment.id,
            error: errorMessage,
            errorCode,
            category
          });

          appLogger.error(
            `[BillingInvoiceRecovery] Failed to generate invoice for payment ${payment.id}: ${errorMessage}`,
            {
              metadata: {
                paymentId: payment.id,
                error: errorMessage,
                errorCode,
                category
              }
            }
          );
        }
      }
    }

    const skipped = alreadyIssued + skippedIneligible;
    const isCompleteSuccess = attempted > 0 && succeeded > 0 && failed === 0 && skippedIneligible === 0;
    const isPartialSuccess = succeeded > 0 && failed > 0;
    const isCompleteFailure = attempted > 0 && succeeded === 0 && failed > 0;

    appLogger.info(
      `[BillingInvoiceRecovery] Batch completed: attempted=${attempted}, succeeded=${succeeded}, alreadyIssued=${alreadyIssued}, skippedIneligible=${skippedIneligible}, failed=${failed}`,
      {
        metadata: {
          totalDiscovered,
          attempted,
          succeeded,
          alreadyIssued,
          skippedIneligible,
          skipped,
          failed,
          transientFailures,
          permanentFailures,
          isCompleteSuccess,
          isPartialSuccess,
          isCompleteFailure,
          nextCursor,
          errorCount: errors.length
        }
      }
    );

    return {
      success: failed === 0,
      dryRun: false,
      totalDiscovered,
      attempted,
      succeeded,
      alreadyIssued,
      skippedIneligible,
      skipped,
      failed,
      transientFailures,
      permanentFailures,
      isCompleteSuccess,
      isPartialSuccess,
      isCompleteFailure,
      nextCursor,
      errors
    };
  }

  /**
   * Discovers finalized ISSUED invoices in bounded, deterministic batches.
   * Excludes DRAFT, VOIDED, and SUPERSEDED invoices.
   */
  public static async findInvoicesPendingNotification(
    options?: { limit?: number; cursor?: RecoveryCursor; offset?: number }
  ): Promise<BillingInvoice[]> {
    const limit = Math.min(200, Math.max(1, options?.limit || 50));
    const whereClause: Prisma.BillingInvoiceWhereInput = {
      status: BillingInvoiceStatus.ISSUED
    };

    if (options?.cursor) {
      const cursorDate = new Date(options.cursor.createdAt);
      return prisma.billingInvoice.findMany({
        where: {
          ...whereClause,
          OR: [
            { createdAt: { gt: cursorDate } },
            { createdAt: cursorDate, id: { gt: options.cursor.id } }
          ]
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit
      });
    }

    const skip = Math.max(0, options?.offset || 0);
    return prisma.billingInvoice.findMany({
      where: whereClause,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip,
      take: limit
    });
  }

  /**
   * Recovers missing or failed invoice-issued notifications for already-persisted invoices.
   *
   * ARCHITECTURAL & COMPLIANCE GUARANTEES:
   * 1. Operates SOLELY on already-committed BillingInvoice rows.
   * 2. NEVER allocates a sequence number, issues a new invoice, or calls sequence counters.
   * 3. NEVER recalculates taxes, discounts, or line item amounts.
   * 4. NEVER alters invoice snapshots, payment status, subscription, or entitlements.
   * 5. Explicitly skips DRAFT, VOIDED, and SUPERSEDED invoices.
   * 6. Uses keyset cursor pagination for deterministic, non-drifting traversal.
   * 7. Idempotently skips invoices that already have a SENT or DELIVERED EmailMessage.
   * 8. Skips in-progress dispatches holding an active worker lease (< 5 minutes).
   */
  public static async retryDeferredInvoiceNotifications(
    options: DeferredInvoiceNotificationRecoveryOptions = {}
  ): Promise<DeferredInvoiceNotificationRecoveryResult> {
    const dryRun = Boolean(options.dryRun);
    const batchSize = Math.min(200, Math.max(1, options.batchSize || 50));
    const offset = Math.max(0, options.offset || 0);

    // 1. Fetch eligible ISSUED invoices
    const invoices = await this.findInvoicesPendingNotification({
      limit: batchSize,
      cursor: options.cursor,
      offset: options.cursor ? undefined : offset
    });

    const totalDiscovered = invoices.length;
    const lastInvoice = invoices.length > 0 ? invoices[invoices.length - 1] : null;
    const nextCursor: RecoveryCursor | null = (lastInvoice && invoices.length === batchSize)
      ? { createdAt: lastInvoice.createdAt, id: lastInvoice.id }
      : null;

    let attempted = 0;
    let alreadyNotified = 0;
    let newlyDispatched = 0;
    let inProgressSkipped = 0;
    let skippedIneligible = 0;
    let failed = 0;
    const errors: Array<{ invoiceId: string; invoiceNumber: string; error: string }> = [];

    for (const invoice of invoices) {
      // Lifecycle check: strictly skip non-ISSUED invoices
      if (invoice.status !== BillingInvoiceStatus.ISSUED) {
        skippedIneligible++;
        continue;
      }

      // Check existing notification delivery state via correlationId
      const correlationId = `invoice_${invoice.id}`;
      const existingMessage = await prisma.emailMessage.findFirst({
        where: { correlationId },
        orderBy: { createdAt: 'desc' }
      });

      if (existingMessage) {
        if (
          existingMessage.status === EmailMessageStatus.SENT ||
          existingMessage.status === EmailMessageStatus.DELIVERED
        ) {
          alreadyNotified++;
          continue;
        }

        // Evaluate previous failure: do not blindly retry permanent or exhausted errors
        if (existingMessage.status === EmailMessageStatus.FAILED) {
          const classification = classifyEmailFailure({
            errorMessage: existingMessage.failureReason,
            attemptCount: existingMessage.attemptCount,
            maxAttempts: existingMessage.maxAttempts,
            currentStatus: existingMessage.status
          });

          if (
            classification.disposition === EmailFailureDisposition.PERMANENT ||
            classification.disposition === EmailFailureDisposition.BLOCKED ||
            classification.disposition === EmailFailureDisposition.SPAM ||
            classification.disposition === EmailFailureDisposition.EXHAUSTED
          ) {
            appLogger.info('[BillingInvoiceRecovery] Skipping notification retry for permanent failure', {
              metadata: {
                invoiceId: invoice.id,
                invoiceNumber: invoice.invoiceNumber,
                disposition: classification.disposition,
                reason: existingMessage.failureReason
              }
            });
            skippedIneligible++;
            continue;
          }

          // Suppress automatic retry for ambiguous transport outcomes (Phase 8.4 Batch E.4.1)
          if (/timeout|etimedout|econnreset|hang up|502|504|gateway/i.test(existingMessage.failureReason || '')) {
            appLogger.warn('[BillingInvoiceRecovery] Skipping ambiguous transport failure: automated retry prohibited to prevent duplicate delivery', {
              metadata: {
                invoiceId: invoice.id,
                invoiceNumber: invoice.invoiceNumber,
                previousFailureReason: existingMessage.failureReason
              }
            });
            skippedIneligible++;
            continue;
          }
        }
      }

      // Mode Ownership Guard (Phase 8.4 Batch E.4.1):
      // If OUTBOX_WORKER is active, direct recovery dispatch is suppressed to prevent dual sending.
      if (config.INVOICE_NOTIFICATION_DISPATCH_MODE === 'OUTBOX_WORKER') {
        appLogger.info('[BillingInvoiceRecovery] Skipping direct recovery dispatch: OUTBOX_WORKER mode is active exclusive dispatcher', {
          metadata: {
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber
          }
        });
        inProgressSkipped++;
        continue;
      }

      // Outbox Governance Guard (Phase 8.4 Batch E.4.2):
      // If ANY outbox record exists, the outbox pipeline is authoritative; direct legacy recovery must not bypass it.
      try {
        const outboxRow = await (prisma as any).invoiceNotificationOutbox?.findFirst({
          where: { invoiceId: invoice.id }
        });
        if (outboxRow) {
          appLogger.info('[BillingInvoiceRecovery] Skipping direct recovery dispatch: Invoice is governed by outbox record', {
            metadata: {
              invoiceId: invoice.id,
              outboxStatus: outboxRow.status
            }
          });
          inProgressSkipped++;
          continue;
        }
      } catch {
        // Table not accessible; continue with legacy flow
      }

      // Historical Lookback Guard (Phase 8.4 Batch E.4.2):
      // Invoices without an outbox row older than maxAgeHours (default 24h) cannot be safely dispatched
      // automatically because missing EmailMessage is not proof of non-acceptance and retention pruning may have occurred.
      const maxAgeMs = (options.maxAgeHours ?? 24) * 60 * 60 * 1000;
      const invoiceAgeMs = Date.now() - invoice.issuedAt.getTime();
      if (invoiceAgeMs > maxAgeMs) {
        appLogger.info('[BillingInvoiceRecovery] Skipping automated recovery for historical invoice beyond lookback threshold', {
          metadata: {
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            issuedAt: invoice.issuedAt.toISOString(),
            ageHours: (invoiceAgeMs / (3600 * 1000)).toFixed(1)
          }
        });
        skippedIneligible++;
        continue;
      }

      // Invoice requires notification dispatch (never sent, failed, or stale claim)
      if (dryRun) {
        newlyDispatched++;
        continue;
      }

      attempted++;
      try {
        const dispatchRes = await BillingInvoiceNotificationService.sendInvoiceIssuedNotification(invoice, {
          forceResend: false // Respect established idempotency checks
        });

        if (dispatchRes.sent) {
          newlyDispatched++;
        } else if (dispatchRes.skipped) {
          if (dispatchRes.reason === 'ALREADY_SENT') {
            alreadyNotified++;
          } else if (dispatchRes.reason === 'IN_PROGRESS') {
            inProgressSkipped++;
          } else {
            skippedIneligible++;
          }
        } else {
          failed++;
          errors.push({
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            error: dispatchRes.error || dispatchRes.reason || 'Dispatch failed'
          });
        }
      } catch (notifyErr: any) {
        failed++;
        errors.push({
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          error: notifyErr?.message || String(notifyErr)
        });
      }
    }

    const isCompleteSuccess = attempted > 0 && failed === 0;
    const isPartialSuccess = newlyDispatched > 0 && failed > 0;
    const isCompleteFailure = attempted > 0 && newlyDispatched === 0 && failed > 0;

    appLogger.info('[BillingInvoiceRecovery] Invoice notification recovery batch completed', {
      metadata: {
        dryRun,
        totalDiscovered,
        attempted,
        alreadyNotified,
        newlyDispatched,
        inProgressSkipped,
        skippedIneligible,
        failed,
        errorCount: errors.length
      }
    });

    return {
      success: failed === 0,
      dryRun,
      totalDiscovered,
      attempted,
      alreadyNotified,
      newlyDispatched,
      inProgressSkipped,
      skippedIneligible,
      failed,
      isCompleteSuccess,
      isPartialSuccess,
      isCompleteFailure,
      nextCursor,
      errors
    };
  }
}
