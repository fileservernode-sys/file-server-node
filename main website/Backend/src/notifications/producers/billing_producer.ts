/**
 * ZdexCloud Billing & Invoice Event Notification Producer
 * Phase 11.2 Architecture
 *
 * Emits canonical billing events to CentralNotificationService for:
 * - Statutory Tax Invoice finalization / issuance
 * - Confirmed Payment success & failure
 * - Subscription activation, renewal, grace period, cancellation, and expiration
 * - Refund outcomes
 *
 * Invariants:
 * 1. Non-Blocking Execution: Never throws errors or aborts billing transactions.
 * 2. Strict Account Scoping: Always scopes notifications to verified userId.
 * 3. Zero Secrets: Never transmits tokens, raw webhook bodies, card data, or private document URLs.
 * 4. Idempotency Guaranteed: Uses deterministic keys to prevent duplicate customer notices.
 */

import { centralNotificationService } from '../services/notification_service.js';
import { NotificationType } from '../types/type_registry.js';
import { NotificationCategory } from '../types/category.js';
import { NotificationSeverity } from '../types/severity.js';
import { createDeepLink } from '../types/deep_link.js';
import { appLogger } from '../../observability/logger.js';

export interface InvoiceIssuedNotificationInput {
  id: string;
  userId: string;
  invoiceNumber: string;
  currency: string;
  totalMinorUnits: number;
  status: string;
  issuedAt?: Date;
}

export interface PaymentSucceededNotificationInput {
  id: string;
  userId: string;
  userEmail?: string;
  amountMinorUnits: number;
  currency: string;
  planName?: string;
  chargedAt?: Date;
}

export interface PaymentFailedNotificationInput {
  id?: string;
  userId: string;
  userEmail?: string;
  amountMinorUnits?: number;
  currency?: string;
  reason?: string;
  eventId?: string;
}

export interface SubscriptionActivatedNotificationInput {
  id: string;
  userId: string;
  userEmail?: string;
  planName: string;
  planCode?: string;
  currency: string;
  amountMinorUnits: number;
  eventId?: string;
}

export interface SubscriptionRenewedNotificationInput {
  id: string;
  userId: string;
  userEmail?: string;
  planName: string;
  planCode?: string;
  currency: string;
  amountMinorUnits: number;
  isRecovery?: boolean;
  eventId?: string;
}

export interface SubscriptionDunningNotificationInput {
  userId: string;
  userEmail?: string;
  subscriptionId: string;
  planName: string;
  milestone: number;
  gracePeriodEndsAt: Date;
}

export interface SubscriptionCancelledNotificationInput {
  id: string;
  userId: string;
  userEmail?: string;
  planName: string;
  currentPeriodEnd: Date;
  eventId?: string;
}

export interface SubscriptionExpiredNotificationInput {
  id: string;
  userId: string;
  userEmail?: string;
  planName: string;
  reason?: string;
  eventId?: string;
}

export interface RefundNotificationInput {
  id: string;
  userId: string;
  userEmail?: string;
  amountMinorUnits: number;
  currency: string;
  reason?: string;
}

export class BillingEventProducer {
  private formatAmount(minorUnits: number): string {
    return (minorUnits / 100).toFixed(2);
  }

  /**
   * Emits an in-app & push notification when a statutory tax invoice reaches ISSUED status.
   */
  public async emitInvoiceIssued(invoice: InvoiceIssuedNotificationInput): Promise<void> {
    try {
      if (!invoice || !invoice.userId || invoice.status !== 'ISSUED') {
        return;
      }

      const formattedAmount = this.formatAmount(invoice.totalMinorUnits);
      const idempotencyKey = `notif_inv_issued_${invoice.id}`;

      await centralNotificationService.dispatchEvent({
        eventType: NotificationType.INVOICE_ISSUED,
        userId: invoice.userId,
        category: NotificationCategory.BILLING,
        severity: NotificationSeverity.SUCCESS,
        idempotencyKey,
        occurredAt: invoice.issuedAt || new Date(),
        metadata: {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          currency: invoice.currency,
          totalMinorUnits: invoice.totalMinorUnits,
          formattedAmount
        },
        deepLink: createDeepLink('billing', 'https://zdexcloud.com/pages/invoices.html', '/pages/invoices.html'),
        source: 'billing-invoice-service'
      });
    } catch (err: any) {
      appLogger.warn('[BillingEventProducer] Failed to emit invoice issued notification (isolated)', {
        metadata: { invoiceId: invoice.id, error: err?.message }
      });
    }
  }

  /**
   * Emits notification for a confirmed payment success.
   */
  public async emitPaymentSucceeded(payment: PaymentSucceededNotificationInput): Promise<void> {
    try {
      if (!payment || !payment.userId) return;

      const formattedAmount = this.formatAmount(payment.amountMinorUnits);
      const idempotencyKey = `notif_pay_succ_${payment.id}`;

      await centralNotificationService.dispatchEvent({
        eventType: NotificationType.PAYMENT_SUCCEEDED,
        userId: payment.userId,
        category: NotificationCategory.BILLING,
        severity: NotificationSeverity.SUCCESS,
        idempotencyKey,
        occurredAt: payment.chargedAt || new Date(),
        metadata: {
          paymentId: payment.id,
          currency: payment.currency,
          amountMinorUnits: payment.amountMinorUnits,
          formattedAmount,
          planName: payment.planName,
          userEmail: payment.userEmail
        },
        deepLink: createDeepLink('billing', 'https://zdexcloud.com/pages/billing.html', '/pages/billing.html'),
        source: 'billing-payment-service'
      });
    } catch (err: any) {
      appLogger.warn('[BillingEventProducer] Failed to emit payment succeeded notification (isolated)', {
        metadata: { paymentId: payment.id, error: err?.message }
      });
    }
  }

  /**
   * Emits notification for a confirmed payment authorization failure.
   */
  public async emitPaymentFailed(params: PaymentFailedNotificationInput): Promise<void> {
    try {
      if (!params || !params.userId) return;

      const fallbackSuffix = params.amountMinorUnits !== undefined
        ? `${params.userId}_${params.currency || 'INR'}_${params.amountMinorUnits}_${(params.reason || 'failed').replace(/[^a-zA-Z0-9]/g, '_')}`
        : `${params.userId}_${(params.reason || 'failed').replace(/[^a-zA-Z0-9]/g, '_')}`;
      const keySuffix = params.id || params.eventId || fallbackSuffix;
      const idempotencyKey = `notif_pay_fail_${keySuffix}`;
      const formattedAmount = params.amountMinorUnits ? this.formatAmount(params.amountMinorUnits) : undefined;

      await centralNotificationService.dispatchEvent({
        eventType: NotificationType.PAYMENT_FAILED,
        userId: params.userId,
        category: NotificationCategory.BILLING,
        severity: NotificationSeverity.WARNING,
        idempotencyKey,
        metadata: {
          paymentId: params.id,
          currency: params.currency,
          amountMinorUnits: params.amountMinorUnits,
          formattedAmount,
          customSummary: params.reason ? `Payment authorization failed: ${params.reason}. Please update your payment method.` : undefined,
          userEmail: params.userEmail
        },
        deepLink: createDeepLink('billing', 'https://zdexcloud.com/pages/billing.html', '/pages/billing.html'),
        source: 'billing-payment-service'
      });
    } catch (err: any) {
      appLogger.warn('[BillingEventProducer] Failed to emit payment failed notification (isolated)', {
        metadata: { error: err?.message }
      });
    }
  }

  /**
   * Emits notification when a subscription is activated.
   */
  public async emitSubscriptionActivated(sub: SubscriptionActivatedNotificationInput): Promise<void> {
    try {
      if (!sub || !sub.userId) return;

      const idempotencyKey = `notif_sub_act_${sub.id}_${sub.eventId || 'v1'}`;

      await centralNotificationService.dispatchEvent({
        eventType: NotificationType.SUBSCRIPTION_ACTIVATED,
        userId: sub.userId,
        category: NotificationCategory.BILLING,
        severity: NotificationSeverity.SUCCESS,
        idempotencyKey,
        metadata: {
          subscriptionId: sub.id,
          planName: sub.planName,
          planCode: sub.planCode,
          currency: sub.currency,
          formattedAmount: this.formatAmount(sub.amountMinorUnits),
          userEmail: sub.userEmail
        },
        deepLink: createDeepLink('billing', 'https://zdexcloud.com/pages/subscription.html', '/pages/subscription.html'),
        source: 'billing-subscription-service'
      });
    } catch (err: any) {
      appLogger.warn('[BillingEventProducer] Failed to emit subscription activated notification (isolated)', {
        metadata: { subscriptionId: sub.id, error: err?.message }
      });
    }
  }

  /**
   * Emits notification when a subscription recurring renewal completes.
   */
  public async emitSubscriptionRenewed(sub: SubscriptionRenewedNotificationInput): Promise<void> {
    try {
      if (!sub || !sub.userId) return;

      const idempotencyKey = `notif_sub_renew_${sub.id}_${sub.eventId || 'v1'}`;
      const summary = sub.isRecovery
        ? `Payment recovered! Your recurring payment of ${sub.currency} ${this.formatAmount(sub.amountMinorUnits)} for ${sub.planName} has been processed. Full service restored.`
        : `Your recurring renewal payment of ${sub.currency} ${this.formatAmount(sub.amountMinorUnits)} for ${sub.planName} was successfully processed.`;

      await centralNotificationService.dispatchEvent({
        eventType: NotificationType.SUBSCRIPTION_RENEWED,
        userId: sub.userId,
        category: NotificationCategory.BILLING,
        severity: NotificationSeverity.INFO,
        idempotencyKey,
        metadata: {
          subscriptionId: sub.id,
          planName: sub.planName,
          planCode: sub.planCode,
          currency: sub.currency,
          formattedAmount: this.formatAmount(sub.amountMinorUnits),
          customSummary: summary,
          isRecovery: sub.isRecovery,
          userEmail: sub.userEmail
        },
        deepLink: createDeepLink('billing', 'https://zdexcloud.com/pages/subscription.html', '/pages/subscription.html'),
        source: 'billing-subscription-service'
      });
    } catch (err: any) {
      appLogger.warn('[BillingEventProducer] Failed to emit subscription renewed notification (isolated)', {
        metadata: { subscriptionId: sub.id, error: err?.message }
      });
    }
  }

  /**
   * Emits notification for dunning milestone warnings (Day 0, Day 2, Day 4).
   */
  public async emitSubscriptionDunningMilestone(params: SubscriptionDunningNotificationInput): Promise<void> {
    try {
      if (!params || !params.userId) return;

      const { userId, subscriptionId, milestone, planName, gracePeriodEndsAt } = params;
      const formattedDate = gracePeriodEndsAt.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });

      let severity: NotificationSeverity = NotificationSeverity.WARNING;
      let summary: string;

      switch (milestone) {
        case 0:
          summary = `Your renewal payment for ZdexCloud ${planName} failed. Paid features remain active until ${formattedDate}. Please update your payment details.`;
          break;
        case 2:
          summary = `Renewal reminder: Your ZdexCloud ${planName} payment is past due. Your grace period will end on ${formattedDate}.`;
          break;
        case 4:
          severity = NotificationSeverity.CRITICAL;
          summary = `Final notice: Your grace period for ZdexCloud ${planName} expires on ${formattedDate}. Your account will revert to the Free tier if payment is not completed.`;
          break;
        default:
          summary = `Your subscription renewal requires attention. Grace period ends on ${formattedDate}.`;
      }

      const idempotencyKey = `notif_dunning_${subscriptionId}_day_${milestone}`;

      await centralNotificationService.dispatchEvent({
        eventType: NotificationType.SUBSCRIPTION_PAYMENT_FAILED,
        userId,
        category: NotificationCategory.BILLING,
        severity,
        idempotencyKey,
        metadata: {
          subscriptionId,
          planName,
          milestone,
          gracePeriodEndsAt: gracePeriodEndsAt.toISOString(),
          customSummary: summary,
          userEmail: params.userEmail
        },
        deepLink: createDeepLink('billing', 'https://zdexcloud.com/pages/billing.html', '/pages/billing.html'),
        source: 'billing-dunning-service'
      });
    } catch (err: any) {
      appLogger.warn('[BillingEventProducer] Failed to emit dunning milestone notification (isolated)', {
        metadata: { subscriptionId: params.subscriptionId, error: err?.message }
      });
    }
  }

  /**
   * Emits notification when subscription cancellation is scheduled.
   */
  public async emitSubscriptionCancelled(sub: SubscriptionCancelledNotificationInput): Promise<void> {
    try {
      if (!sub || !sub.userId) return;

      const idempotencyKey = `notif_sub_cancel_${sub.id}_${sub.eventId || sub.currentPeriodEnd.toISOString()}`;
      const formattedDate = sub.currentPeriodEnd.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });

      await centralNotificationService.dispatchEvent({
        eventType: NotificationType.SUBSCRIPTION_CANCELLED,
        userId: sub.userId,
        category: NotificationCategory.BILLING,
        severity: NotificationSeverity.WARNING,
        idempotencyKey,
        metadata: {
          subscriptionId: sub.id,
          planName: sub.planName,
          currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
          customSummary: `Your ${sub.planName} cancellation is scheduled. You retain full access until ${formattedDate}.`,
          userEmail: sub.userEmail
        },
        deepLink: createDeepLink('billing', 'https://zdexcloud.com/pages/subscription.html', '/pages/subscription.html'),
        source: 'billing-subscription-service'
      });
    } catch (err: any) {
      appLogger.warn('[BillingEventProducer] Failed to emit subscription cancelled notification (isolated)', {
        metadata: { subscriptionId: sub.id, error: err?.message }
      });
    }
  }

  /**
   * Emits notification when subscription expires and account reverts to Free tier.
   */
  public async emitSubscriptionExpired(sub: SubscriptionExpiredNotificationInput): Promise<void> {
    try {
      if (!sub || !sub.userId) return;

      const idempotencyKey = `notif_sub_exp_${sub.id}_${sub.eventId || 'final'}`;

      await centralNotificationService.dispatchEvent({
        eventType: NotificationType.SUBSCRIPTION_EXPIRED,
        userId: sub.userId,
        category: NotificationCategory.BILLING,
        severity: NotificationSeverity.CRITICAL,
        idempotencyKey,
        metadata: {
          subscriptionId: sub.id,
          planName: sub.planName,
          customSummary: `Your ${sub.planName} subscription has ended and your account reverted to the Free tier. Your servers and files remain safe.`,
          userEmail: sub.userEmail
        },
        deepLink: createDeepLink('billing', 'https://zdexcloud.com/pages/subscription.html', '/pages/subscription.html'),
        source: 'billing-subscription-service'
      });
    } catch (err: any) {
      appLogger.warn('[BillingEventProducer] Failed to emit subscription expired notification (isolated)', {
        metadata: { subscriptionId: sub.id, error: err?.message }
      });
    }
  }

  /**
   * Emits notification when a refund is processed.
   */
  public async emitRefundProcessed(refund: RefundNotificationInput): Promise<void> {
    try {
      if (!refund || !refund.userId) return;

      const formattedAmount = this.formatAmount(refund.amountMinorUnits);
      const idempotencyKey = `notif_ref_proc_${refund.id}`;

      await centralNotificationService.dispatchEvent({
        eventType: NotificationType.BILLING_REFUND_PROCESSED,
        userId: refund.userId,
        category: NotificationCategory.BILLING,
        severity: NotificationSeverity.INFO,
        idempotencyKey,
        metadata: {
          refundId: refund.id,
          currency: refund.currency,
          amountMinorUnits: refund.amountMinorUnits,
          formattedAmount,
          userEmail: refund.userEmail
        },
        deepLink: createDeepLink('billing', 'https://zdexcloud.com/pages/billing.html', '/pages/billing.html'),
        source: 'billing-refund-service'
      });
    } catch (err: any) {
      appLogger.warn('[BillingEventProducer] Failed to emit refund processed notification (isolated)', {
        metadata: { refundId: refund.id, error: err?.message }
      });
    }
  }

  /**
   * Emits notification when a refund fails.
   */
  public async emitRefundFailed(refund: RefundNotificationInput): Promise<void> {
    try {
      if (!refund || !refund.userId) return;

      const formattedAmount = this.formatAmount(refund.amountMinorUnits);
      const idempotencyKey = `notif_ref_fail_${refund.id}`;

      await centralNotificationService.dispatchEvent({
        eventType: NotificationType.BILLING_REFUND_FAILED,
        userId: refund.userId,
        category: NotificationCategory.BILLING,
        severity: NotificationSeverity.WARNING,
        idempotencyKey,
        metadata: {
          refundId: refund.id,
          currency: refund.currency,
          amountMinorUnits: refund.amountMinorUnits,
          formattedAmount,
          customSummary: refund.reason ? `Refund failed: ${refund.reason}` : undefined,
          userEmail: refund.userEmail
        },
        deepLink: createDeepLink('billing', 'https://zdexcloud.com/pages/billing.html', '/pages/billing.html'),
        source: 'billing-refund-service'
      });
    } catch (err: any) {
      appLogger.warn('[BillingEventProducer] Failed to emit refund failed notification (isolated)', {
        metadata: { refundId: refund.id, error: err?.message }
      });
    }
  }
}

export const billingEventProducer = new BillingEventProducer();
