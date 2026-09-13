import crypto from 'node:crypto';
import { prisma } from '../../config/database.js';
import {
  CurrencyCode,
  PaymentProvider,
  PaymentEnvironment,
  PaymentStatus,
  RefundStatus,
  RefundReason,
  AuditEventType,
  BillingInterval,
  BillingStatus
} from '@prisma/client';
import {
  AppError,
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError
} from '../../errors/app-error.js';
import { RazorpayClient, RazorpayRefundResponse } from './providers/razorpay/razorpay_client.js';
import { EntitlementService } from './entitlement_service.js';

export interface RequestRefundParams {
  paymentId: string;
  amountMinorUnits?: number;
  reason?: RefundReason;
  reasonDetails?: string;
  idempotencyKey?: string;
  correlationId?: string;
  terminateSubscription?: boolean;
  isAdmin?: boolean;
}

export interface RefundValidationResult {
  payment: any;
  subscription: any | null;
  requestedAmountMinorUnits: number;
  refundableAmountMinorUnits: number;
  cumulativeRefundedAmountMinorUnits: number;
  isFullRefund: boolean;
}

export class BillingRefundService {
  /**
   * Validates whether a payment is eligible for full or partial refund under ZdexCloud commercial policy.
   * Never mutates any database record.
   */
  public static async validateRefundEligibility(
    userId: string,
    paymentId: string,
    params?: {
      amountMinorUnits?: number;
      reason?: RefundReason;
      isAdmin?: boolean;
      requestedAt?: Date;
    }
  ): Promise<RefundValidationResult> {
    if (!paymentId || typeof paymentId !== 'string') {
      throw new ValidationError('paymentId is required to validate refund eligibility');
    }

    const payment = await prisma.billingPayment.findUnique({
      where: { id: paymentId },
      include: {
        subscription: {
          include: { plan: true }
        },
        refunds: true
      }
    });

    if (!payment) {
      throw new NotFoundError('Payment transaction not found');
    }

    const isAdmin = params?.isAdmin === true;
    if (!isAdmin && payment.userId !== userId) {
      throw new ForbiddenError('Payment does not belong to the authenticated user');
    }

    if (payment.status !== PaymentStatus.SUCCESS && payment.status !== PaymentStatus.REFUNDED) {
      throw new ConflictError('Only successfully captured payments can be refunded');
    }

    if (!payment.providerPaymentId) {
      throw new ConflictError('Payment record lacks an external provider transaction reference');
    }

    // 1. Calculate cumulative refunded amount from immutable non-failed refunds
    const nonFailedRefunds = payment.refunds.filter(
      r => r.status === RefundStatus.PROCESSED || r.status === RefundStatus.PROCESSING || r.status === RefundStatus.REQUESTED
    );

    const cumulativeRefundedAmountMinorUnits = nonFailedRefunds.reduce(
      (sum, r) => sum + r.amountMinorUnits,
      0
    );

    const refundableAmountMinorUnits = payment.amountMinorUnits - cumulativeRefundedAmountMinorUnits;

    if (refundableAmountMinorUnits <= 0) {
      const err = new ConflictError('Payment has already been fully refunded');
      (err as any).errorCode = 'PAYMENT_ALREADY_REFUNDED';
      throw err;
    }

    // 2. Resolve requested refund amount
    const requestedAmountMinorUnits = params?.amountMinorUnits !== undefined
      ? params.amountMinorUnits
      : refundableAmountMinorUnits;

    if (requestedAmountMinorUnits <= 0) {
      throw new ValidationError('Refund amount must be an integer greater than zero');
    }

    if (requestedAmountMinorUnits > refundableAmountMinorUnits) {
      const err = new ConflictError(
        `Requested refund amount (${requestedAmountMinorUnits}) exceeds remaining refundable amount (${refundableAmountMinorUnits})`
      );
      (err as any).errorCode = 'REFUND_AMOUNT_EXCEEDS_REFUNDABLE';
      throw err;
    }

    const isFullRefund = requestedAmountMinorUnits === payment.amountMinorUnits && cumulativeRefundedAmountMinorUnits === 0;

    // 3. Commercial Policy Enforcement
    const reason = params?.reason || RefundReason.ADMIN_APPROVED_EXCEPTION;
    const isException =
      reason === RefundReason.DUPLICATE_PAYMENT ||
      reason === RefundReason.ERRONEOUS_PAYMENT ||
      reason === RefundReason.TECHNICAL_SERVICE_FAILURE ||
      reason === RefundReason.ADMIN_APPROVED_EXCEPTION ||
      reason === RefundReason.OTHER_APPROVED;

    if (!isAdmin && !isException) {
      const sub = payment.subscription;
      if (sub) {
        if (sub.billingInterval === BillingInterval.MONTHLY) {
          // Monthly policy: generally non-refundable after cycle start unless exception
          const err = new ConflictError('Monthly subscriptions are non-refundable after the billing cycle begins');
          (err as any).errorCode = 'MONTHLY_NON_REFUNDABLE';
          throw err;
        }

        if (sub.billingInterval === BillingInterval.YEARLY) {
          // Yearly policy: 14-day refund window from charge timestamp
          const chargeTime = (payment.chargedAt || payment.createdAt).getTime();
          const checkTime = (params?.requestedAt || new Date()).getTime();
          const ageMs = checkTime - chargeTime;
          const fourteenDaysMs = 14 * 86400 * 1000;

          if (ageMs > fourteenDaysMs) {
            const err = new ConflictError('Yearly subscription 14-day refund window has expired');
            (err as any).errorCode = 'ANNUAL_REFUND_WINDOW_EXPIRED';
            throw err;
          }
        }
      }
    }

    return {
      payment,
      subscription: payment.subscription || null,
      requestedAmountMinorUnits,
      refundableAmountMinorUnits,
      cumulativeRefundedAmountMinorUnits,
      isFullRefund
    };
  }

  /**
   * Requests a refund through Razorpay with idempotency, concurrency protection, audit logs, and notification.
   */
  public static async requestRefund(
    userId: string,
    params: RequestRefundParams,
    options?: {
      client?: RazorpayClient;
      logger?: any;
      now?: Date;
    }
  ): Promise<{ success: boolean; refund: any; idempotent?: boolean }> {
    const idempotencyKey = params.idempotencyKey || `ref_idem_${crypto.randomUUID()}`;

    // 1. Check existing refund with same idempotencyKey
    const existing = await prisma.billingRefund.findUnique({
      where: { idempotencyKey },
      include: { payment: true }
    });

    if (existing) {
      if (
        existing.status === RefundStatus.PROCESSED ||
        existing.status === RefundStatus.PROCESSING ||
        existing.status === RefundStatus.REQUESTED
      ) {
        return { success: true, refund: existing, idempotent: true };
      }
    }

    // 2. Validate eligibility and reserve refund record atomically
    const requestedAt = options?.now || new Date();
    let validation: RefundValidationResult;

    try {
      validation = await this.validateRefundEligibility(userId, params.paymentId, {
        amountMinorUnits: params.amountMinorUnits,
        reason: params.reason,
        isAdmin: params.isAdmin,
        requestedAt
      });
    } catch (err: any) {
      // Record policy rejection audit event if payment exists
      if (params.paymentId) {
        try {
          await prisma.auditEvent.create({
            data: {
              userId,
              eventType: AuditEventType.REFUND_POLICY_REJECTED,
              metadata: {
                paymentId: params.paymentId,
                reason: params.reason,
                error: err.message,
                errorCode: err.errorCode,
                requestedAmountMinorUnits: params.amountMinorUnits
              }
            }
          });
        } catch {
          // Non-blocking audit failure
        }
      }
      throw err;
    }

    const { payment, subscription, requestedAmountMinorUnits } = validation;
    const reason = params.reason || RefundReason.ADMIN_APPROVED_EXCEPTION;

    // 3. Create pending BillingRefund record
    const refundRecord = await prisma.$transaction(async (tx) => {
      // Double check cumulative amount inside transaction
      const currentRefunds = await tx.billingRefund.findMany({
        where: {
          paymentId: payment.id,
          status: { in: [RefundStatus.PROCESSED, RefundStatus.PROCESSING, RefundStatus.REQUESTED] }
        }
      });

      const currentTotal = currentRefunds.reduce((sum, r) => sum + r.amountMinorUnits, 0);
      if (currentTotal + requestedAmountMinorUnits > payment.amountMinorUnits) {
        const err = new ConflictError('Concurrent refund conflict: total refunded amount would exceed payment amount');
        (err as any).errorCode = 'REFUND_AMOUNT_EXCEEDS_REFUNDABLE';
        throw err;
      }

      const created = await tx.billingRefund.create({
        data: {
          userId,
          subscriptionId: subscription?.id || null,
          paymentId: payment.id,
          provider: payment.provider,
          providerEnvironment: payment.environment,
          providerPaymentId: payment.providerPaymentId,
          amountMinorUnits: requestedAmountMinorUnits,
          currency: payment.currency,
          reason,
          reasonDetails: params.reasonDetails || null,
          status: RefundStatus.PROCESSING,
          idempotencyKey,
          correlationId: params.correlationId || null,
          requestedBy: params.isAdmin ? 'ADMIN' : userId,
          requestedAt,
          providerRequestedAt: requestedAt
        }
      });

      await tx.auditEvent.create({
        data: {
          userId,
          eventType: AuditEventType.REFUND_REQUESTED,
          metadata: {
            refundId: created.id,
            paymentId: payment.id,
            providerPaymentId: payment.providerPaymentId,
            subscriptionId: subscription?.id || null,
            amountMinorUnits: requestedAmountMinorUnits,
            currency: payment.currency,
            reason,
            idempotencyKey
          }
        }
      });

      return created;
    });

    // 4. Call Razorpay API
    const client = options?.client || new RazorpayClient();
    let rzpResponse: RazorpayRefundResponse | null = null;
    let providerError: any = null;

    try {
      rzpResponse = await client.createRefund(
        payment.providerPaymentId,
        {
          amount: requestedAmountMinorUnits,
          notes: {
            internalRefundId: refundRecord.id,
            userId,
            reason: String(reason)
          }
        },
        { idempotencyKey }
      );
    } catch (err: any) {
      providerError = err;
    }

    // 5. Update Refund state according to provider response
    if (providerError) {
      const isTimeout =
        providerError.name === 'AbortError' ||
        providerError.code === 'TIMEOUT_ERROR' ||
        providerError.message?.includes('timed out');

      if (isTimeout) {
        // Network timeout / ambiguous -> Move to REQUIRES_REVIEW to avoid blind failure
        const updated = await prisma.billingRefund.update({
          where: { id: refundRecord.id },
          data: {
            status: RefundStatus.REQUIRES_REVIEW,
            failureReason: `Provider timeout: ${providerError.message}`
          }
        });

        await prisma.auditEvent.create({
          data: {
            userId,
            eventType: AuditEventType.REFUND_REQUIRES_REVIEW,
            metadata: {
              refundId: refundRecord.id,
              paymentId: payment.id,
              error: providerError.message,
              reason: 'PROVIDER_TIMEOUT'
            }
          }
        });

        return { success: true, refund: updated };
      }

      // Explicit provider failure
      const updated = await prisma.billingRefund.update({
        where: { id: refundRecord.id },
        data: {
          status: RefundStatus.FAILED,
          failureCode: providerError.code || 'PROVIDER_ERROR',
          failureReason: providerError.message || 'Razorpay refund request failed'
        }
      });

      await prisma.auditEvent.create({
        data: {
          userId,
          eventType: AuditEventType.REFUND_FAILED,
          metadata: {
            refundId: refundRecord.id,
            paymentId: payment.id,
            error: providerError.message
          }
        }
      });

      // Emit failure notification
      await this.emitNotification({
        userId,
        eventType: 'BILLING_REFUND_FAILED',
        title: 'Refund Request Failed',
        body: `We were unable to process your refund of ${payment.currency} ${(requestedAmountMinorUnits / 100).toFixed(2)}. Please contact support if you need assistance.`,
        metadata: { refundId: refundRecord.id, paymentId: payment.id }
      });

      throw providerError;
    }

    // Provider succeeded
    const isProcessed = rzpResponse?.status === 'processed';
    const finalStatus = isProcessed ? RefundStatus.PROCESSED : RefundStatus.PROCESSING;
    const providerProcessedAt = isProcessed ? new Date() : null;

    const updated = await prisma.billingRefund.update({
      where: { id: refundRecord.id },
      data: {
        providerRefundId: rzpResponse?.id || null,
        status: finalStatus,
        providerProcessedAt,
        metadata: rzpResponse ? JSON.parse(JSON.stringify(rzpResponse)) : undefined
      }
    });

    await prisma.auditEvent.create({
      data: {
        userId,
        eventType: AuditEventType.REFUND_PROVIDER_REQUESTED,
        metadata: {
          refundId: updated.id,
          providerRefundId: rzpResponse?.id,
          paymentId: payment.id,
          amountMinorUnits: requestedAmountMinorUnits,
          currency: payment.currency
        }
      }
    });

    if (isProcessed) {
      await prisma.auditEvent.create({
        data: {
          userId,
          eventType: AuditEventType.REFUND_PROCESSED,
          metadata: {
            refundId: updated.id,
            providerRefundId: rzpResponse?.id,
            paymentId: payment.id,
            amountMinorUnits: requestedAmountMinorUnits,
            currency: payment.currency
          }
        }
      });

      // Dispatch success notification once
      await this.emitNotification({
        userId,
        eventType: 'BILLING_REFUND_PROCESSED',
        title: 'Refund Processed',
        body: `Your refund of ${payment.currency} ${(requestedAmountMinorUnits / 100).toFixed(2)} has been successfully processed.`,
        metadata: {
          refundId: updated.id,
          providerRefundId: rzpResponse?.id,
          amountMinorUnits: requestedAmountMinorUnits,
          currency: payment.currency
        }
      });
    }

    // 6. Optional Subscription Termination (Authorized immediate-refund policy)
    if (params.terminateSubscription && subscription) {
      await prisma.$transaction(async (tx) => {
        await tx.subscription.update({
          where: { id: subscription.id },
          data: {
            status: BillingStatus.REFUNDED,
            refundedAt: new Date()
          }
        });

        await tx.accountBillingState.upsert({
          where: { userId },
          update: {
            status: BillingStatus.FREE,
            activeSubscriptionId: null
          },
          create: {
            userId,
            status: BillingStatus.FREE,
            activeSubscriptionId: null
          }
        });

        await tx.auditEvent.create({
          data: {
            userId,
            eventType: AuditEventType.SUBSCRIPTION_REFUNDED,
            metadata: {
              subscriptionId: subscription.id,
              refundId: updated.id,
              terminated: true
            }
          }
        });
      });
    }

    return { success: true, refund: updated };
  }

  /**
   * Retrieves an individual refund by ID.
   */
  public static async getRefund(userId: string, refundId: string, options?: { isAdmin?: boolean }) {
    if (!refundId) {
      throw new ValidationError('refundId is required');
    }

    const refund = await prisma.billingRefund.findUnique({
      where: { id: refundId },
      include: {
        payment: true,
        subscription: { include: { plan: true } }
      }
    });

    if (!refund) {
      throw new NotFoundError('Refund record not found');
    }

    if (!options?.isAdmin && refund.userId !== userId) {
      throw new ForbiddenError('Refund record does not belong to authenticated user');
    }

    return refund;
  }

  /**
   * Retrieves all refunds for a specific payment.
   */
  public static async getPaymentRefunds(userId: string, paymentId: string, options?: { isAdmin?: boolean }) {
    if (!paymentId) {
      throw new ValidationError('paymentId is required');
    }

    const payment = await prisma.billingPayment.findUnique({
      where: { id: paymentId }
    });

    if (!payment) {
      throw new NotFoundError('Payment transaction not found');
    }

    if (!options?.isAdmin && payment.userId !== userId) {
      throw new ForbiddenError('Payment does not belong to authenticated user');
    }

    const refunds = await prisma.billingRefund.findMany({
      where: { paymentId },
      orderBy: { requestedAt: 'desc' }
    });

    return refunds;
  }

  /**
   * Helper to emit idempotent in-app notifications without throwing.
   */
  private static async emitNotification(opts: {
    userId: string;
    eventType: string;
    title: string;
    body: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    try {
      const idempotencyKey = `notif_${opts.eventType}_${opts.userId}_${opts.metadata?.refundId || Date.now()}`;
      await prisma.notificationRecord.upsert({
        where: { idempotencyKey },
        update: {},
        create: {
          eventId: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          userId: opts.userId,
          eventType: opts.eventType,
          category: 'BILLING',
          severity: 'INFO',
          title: opts.title,
          body: opts.body,
          metadata: opts.metadata || {},
          idempotencyKey
        }
      });
    } catch {
      // Non-blocking notification emission
    }
  }
}
