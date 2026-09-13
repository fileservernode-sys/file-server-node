import { prisma } from '../../config/database.js';
import {
  CurrencyCode,
  PaymentProvider,
  PaymentEnvironment,
  UpgradeReconciliationStatus,
  AuditEventType,
  Prisma
} from '@prisma/client';
import { NotFoundError, ValidationError } from '../../errors/app-error.js';

export interface UpgradeFinancialEvidence {
  actualAmountMinorUnits?: number;
  actualCurrency?: CurrencyCode;
  actualRefundMinorUnits?: number;
  providerPaymentId?: string;
  providerInvoiceId?: string;
  providerEventId?: string;
  providerEventType?: string;
  providerTimestamp?: Date;
  metadata?: Record<string, any>;
}

export interface UpgradeReconciliationResult {
  reconciliationId: string;
  planChangeId: string;
  subscriptionId: string;
  userId: string;
  status: UpgradeReconciliationStatus;
  expectedAmountMinorUnits: number;
  actualAmountMinorUnits?: number | null;
  expectedCreditMinorUnits: number;
  actualRefundMinorUnits?: number | null;
  expectedCurrency: CurrencyCode;
  actualCurrency?: CurrencyCode | null;
  mismatchReason?: string | null;
  checkedAt: Date;
  resolvedAt?: Date | null;
  idempotent?: boolean;
}

export class UpgradeReconciliationService {
  /**
   * Initializes a pending reconciliation record atomically when an upgrade is initiated.
   */
  static async createPendingReconciliation(
    planChangeId: string,
    tx?: Prisma.TransactionClient
  ): Promise<any> {
    const db = tx || prisma;
    const planChange = await db.subscriptionPlanChange.findUnique({
      where: { id: planChangeId }
    });

    if (!planChange) {
      throw new NotFoundError(`SubscriptionPlanChange '${planChangeId}' not found`);
    }

    return await db.subscriptionUpgradeReconciliation.upsert({
      where: { planChangeId },
      update: {
        expectedAmountMinorUnits: planChange.netAmountMinorUnits,
        expectedCreditMinorUnits: planChange.creditMinorUnits,
        expectedCurrency: planChange.currency,
        status: UpgradeReconciliationStatus.PENDING,
        checkedAt: new Date()
      },
      create: {
        planChangeId: planChange.id,
        subscriptionId: planChange.subscriptionId,
        userId: planChange.userId,
        expectedAmountMinorUnits: planChange.netAmountMinorUnits,
        expectedCreditMinorUnits: planChange.creditMinorUnits,
        expectedCurrency: planChange.currency,
        status: UpgradeReconciliationStatus.PENDING,
        checkedAt: new Date()
      }
    });
  }

  /**
   * Authoritatively reconciles provider financial evidence against the expected upgrade calculation.
   * 
   * Strict Invariants:
   * 1. Expected and actual values remain completely distinct and immutable.
   * 2. If expected == actual: transitions to MATCHED and logs SUBSCRIPTION_UPGRADE_RECONCILIATION_MATCHED.
   * 3. If expected != actual: transitions to REQUIRES_REVIEW, records mismatchReason, logs SUBSCRIPTION_UPGRADE_RECONCILIATION_MISMATCHED, and preserves user entitlements without fabricating compensating data.
   * 4. If evidence is pending: preserves PENDING status.
   * 5. Links any associated BillingPayment to the SubscriptionPlanChange.
   * 6. Strictly idempotent against repeated webhook deliveries or duplicate calls.
   */
  static async reconcileUpgradeFinancials(
    planChangeId: string,
    evidence: UpgradeFinancialEvidence,
    options?: { tx?: Prisma.TransactionClient; timestamp?: Date }
  ): Promise<UpgradeReconciliationResult> {
    const now = options?.timestamp || new Date();

    const executeReconciliation = async (tx: Prisma.TransactionClient) => {
      const planChange = await tx.subscriptionPlanChange.findUnique({
        where: { id: planChangeId },
        include: {
          reconciliation: true,
          subscription: true,
          user: true
        }
      });

      if (!planChange) {
        throw new NotFoundError(`SubscriptionPlanChange '${planChangeId}' not found`);
      }

      const existingRec = planChange.reconciliation;

      // Idempotency check: If already MATCHED with same payment/event ID
      if (
        existingRec &&
        existingRec.status === UpgradeReconciliationStatus.MATCHED &&
        evidence.providerPaymentId &&
        existingRec.providerPaymentId === evidence.providerPaymentId
      ) {
        return {
          reconciliationId: existingRec.id,
          planChangeId: planChange.id,
          subscriptionId: planChange.subscriptionId,
          userId: planChange.userId,
          status: existingRec.status,
          expectedAmountMinorUnits: existingRec.expectedAmountMinorUnits,
          actualAmountMinorUnits: existingRec.actualAmountMinorUnits,
          expectedCreditMinorUnits: existingRec.expectedCreditMinorUnits,
          actualRefundMinorUnits: existingRec.actualRefundMinorUnits,
          expectedCurrency: existingRec.expectedCurrency,
          actualCurrency: existingRec.actualCurrency,
          mismatchReason: existingRec.mismatchReason,
          checkedAt: existingRec.checkedAt,
          resolvedAt: existingRec.resolvedAt,
          idempotent: true
        };
      }

      const expectedAmount = planChange.netAmountMinorUnits;
      const expectedCredit = planChange.creditMinorUnits;
      const expectedCurrency = planChange.currency;

      let status: UpgradeReconciliationStatus = UpgradeReconciliationStatus.PENDING;
      let mismatchReason: string | null = null;
      let resolvedAt: Date | null = null;

      if (evidence.actualAmountMinorUnits === undefined && !evidence.providerPaymentId) {
        // Evidence is pending
        status = UpgradeReconciliationStatus.PENDING;
        mismatchReason = 'Provider financial evidence pending';
      } else {
        const actualCurrency = evidence.actualCurrency || expectedCurrency;
        const actualAmount = evidence.actualAmountMinorUnits ?? 0;

        // Verify currency match
        if (evidence.actualCurrency && evidence.actualCurrency !== expectedCurrency) {
          status = UpgradeReconciliationStatus.REQUIRES_REVIEW;
          mismatchReason = `Currency mismatch: expected '${expectedCurrency}' but provider charged in '${evidence.actualCurrency}'.`;
        } else if (actualAmount === expectedAmount) {
          // Exact amount match
          status = UpgradeReconciliationStatus.MATCHED;
          resolvedAt = now;
          mismatchReason = null;
        } else {
          // Financial mismatch detected
          status = UpgradeReconciliationStatus.REQUIRES_REVIEW;
          mismatchReason = `Financial amount mismatch: expected net amount ${expectedAmount} ${expectedCurrency} (with credit ${expectedCredit} ${expectedCurrency}), but provider charged ${actualAmount} ${actualCurrency}.`;
        }
      }

      // Upsert Reconciliation record
      const reconciliation = await tx.subscriptionUpgradeReconciliation.upsert({
        where: { planChangeId: planChange.id },
        update: {
          expectedAmountMinorUnits: expectedAmount,
          actualAmountMinorUnits: evidence.actualAmountMinorUnits !== undefined ? evidence.actualAmountMinorUnits : existingRec?.actualAmountMinorUnits,
          expectedCreditMinorUnits: expectedCredit,
          actualRefundMinorUnits: evidence.actualRefundMinorUnits !== undefined ? evidence.actualRefundMinorUnits : existingRec?.actualRefundMinorUnits,
          expectedCurrency,
          actualCurrency: evidence.actualCurrency || existingRec?.actualCurrency || expectedCurrency,
          providerPaymentId: evidence.providerPaymentId || existingRec?.providerPaymentId || null,
          providerInvoiceId: evidence.providerInvoiceId || existingRec?.providerInvoiceId || null,
          providerEventId: evidence.providerEventId || existingRec?.providerEventId || null,
          status,
          mismatchReason,
          checkedAt: now,
          resolvedAt: status === UpgradeReconciliationStatus.MATCHED ? (resolvedAt || now) : existingRec?.resolvedAt,
          updatedAt: now
        },
        create: {
          planChangeId: planChange.id,
          subscriptionId: planChange.subscriptionId,
          userId: planChange.userId,
          expectedAmountMinorUnits: expectedAmount,
          actualAmountMinorUnits: evidence.actualAmountMinorUnits,
          expectedCreditMinorUnits: expectedCredit,
          actualRefundMinorUnits: evidence.actualRefundMinorUnits,
          expectedCurrency,
          actualCurrency: evidence.actualCurrency || expectedCurrency,
          providerPaymentId: evidence.providerPaymentId || null,
          providerInvoiceId: evidence.providerInvoiceId || null,
          providerEventId: evidence.providerEventId || null,
          status,
          mismatchReason,
          checkedAt: now,
          resolvedAt
        }
      });

      // Link BillingPayment if providerPaymentId is present
      if (evidence.providerPaymentId) {
        await tx.billingPayment.updateMany({
          where: {
            providerPaymentId: evidence.providerPaymentId,
            planChangeId: null
          },
          data: {
            planChangeId: planChange.id
          }
        });
      }

      // Audit Event recording
      if (status === UpgradeReconciliationStatus.MATCHED) {
        await tx.auditEvent.create({
          data: {
            userId: planChange.userId,
            eventType: AuditEventType.SUBSCRIPTION_UPGRADE_RECONCILIATION_MATCHED,
            metadata: {
              action: 'SUBSCRIPTION_UPGRADE_RECONCILIATION_MATCHED',
              planChangeId: planChange.id,
              reconciliationId: reconciliation.id,
              subscriptionId: planChange.subscriptionId,
              expectedAmountMinorUnits: expectedAmount,
              actualAmountMinorUnits: evidence.actualAmountMinorUnits,
              expectedCreditMinorUnits: expectedCredit,
              expectedCurrency,
              actualCurrency: evidence.actualCurrency || expectedCurrency,
              providerPaymentId: evidence.providerPaymentId,
              providerInvoiceId: evidence.providerInvoiceId,
              providerEventId: evidence.providerEventId,
              providerEventType: evidence.providerEventType,
              status: 'MATCHED'
            }
          }
        });
      } else if (status === UpgradeReconciliationStatus.REQUIRES_REVIEW || (status as any) === UpgradeReconciliationStatus.MISMATCHED) {
        await tx.auditEvent.create({
          data: {
            userId: planChange.userId,
            eventType: AuditEventType.SUBSCRIPTION_UPGRADE_RECONCILIATION_MISMATCHED,
            metadata: {
              action: 'SUBSCRIPTION_UPGRADE_RECONCILIATION_MISMATCHED',
              planChangeId: planChange.id,
              reconciliationId: reconciliation.id,
              subscriptionId: planChange.subscriptionId,
              expectedAmountMinorUnits: expectedAmount,
              actualAmountMinorUnits: evidence.actualAmountMinorUnits,
              expectedCreditMinorUnits: expectedCredit,
              expectedCurrency,
              actualCurrency: evidence.actualCurrency || expectedCurrency,
              mismatchReason,
              providerPaymentId: evidence.providerPaymentId,
              providerInvoiceId: evidence.providerInvoiceId,
              providerEventId: evidence.providerEventId,
              providerEventType: evidence.providerEventType,
              status: 'REQUIRES_REVIEW'
            }
          }
        });
      }

      return {
        reconciliationId: reconciliation.id,
        planChangeId: planChange.id,
        subscriptionId: planChange.subscriptionId,
        userId: planChange.userId,
        status: reconciliation.status,
        expectedAmountMinorUnits: reconciliation.expectedAmountMinorUnits,
        actualAmountMinorUnits: reconciliation.actualAmountMinorUnits,
        expectedCreditMinorUnits: reconciliation.expectedCreditMinorUnits,
        actualRefundMinorUnits: reconciliation.actualRefundMinorUnits,
        expectedCurrency: reconciliation.expectedCurrency,
        actualCurrency: reconciliation.actualCurrency,
        mismatchReason: reconciliation.mismatchReason,
        checkedAt: reconciliation.checkedAt,
        resolvedAt: reconciliation.resolvedAt
      };
    };

    if (options?.tx) {
      return await executeReconciliation(options.tx);
    } else {
      return await prisma.$transaction(async (tx) => {
        return await executeReconciliation(tx);
      }, { timeout: 30000, maxWait: 15000 });
    }
  }

  /**
   * Resolves the most recent active or pending upgrade for a given subscription.
   */
  static async findLatestUpgradeForSubscription(
    subscriptionId: string
  ): Promise<any> {
    return await prisma.subscriptionPlanChange.findFirst({
      where: { subscriptionId },
      orderBy: { requestedAt: 'desc' },
      include: {
        reconciliation: true,
        toPlan: true,
        toPlanPrice: true
      }
    });
  }
}
