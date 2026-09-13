import { BillingCountryService, ConfirmBillingCountryParams, ConfirmedBillingRegion } from './billing_country_service.js';
import { RazorpayClient } from './providers/razorpay/razorpay_client.js';
import { prisma } from '../../config/database.js';
import {
  BillingStatus,
  CurrencyCode,
  BillingInterval,
  PaymentProvider,
  PaymentEnvironment,
  PlanChangeStatus,
  AuditEventType,
  AccountBillingState,
  Subscription,
  Plan,
  PlanPrice,
  NotificationRecordStatus,
  UpgradeReconciliationStatus,
  Prisma
} from '@prisma/client';
import { RazorpayProviderError } from './providers/razorpay/razorpay_error.js';
import { RazorpayPlanCatalogService } from './providers/razorpay/razorpay_plan_catalog_service.js';
import { UpgradeReconciliationService } from './upgrade_reconciliation_service.js';
import { ValidationError, NotFoundError, ConflictError } from '../../errors/app-error.js';

export interface CreateSubscriptionParams {
  userId: string;
  planCode: string;
  currency?: CurrencyCode;
  priceVersion?: number;
  periodDays?: number;
  billingCountry?: string;
  billingPostalCode?: string;
}

export interface EffectivePlanResult {
  planCode: string;
  status: BillingStatus;
  subscription: (Subscription & { plan: Plan; planPrice: PlanPrice }) | null;
  billingCountry: string | null;
  billingPostalCode: string | null;
  currency: CurrencyCode | null;
}

// Set of statuses that grant full active plan capabilities
export const PAID_ENTITLED_STATUSES: Set<BillingStatus> = new Set([
  BillingStatus.ACTIVE,
  BillingStatus.CANCELLING,
  BillingStatus.PAST_DUE,
  BillingStatus.GRACE_PERIOD
]);

export interface UpgradeSubscriptionParams {
  targetPlanCode?: string;
}

export interface ProrationCalculationResult {
  creditMinorUnits: number;
  netAmountMinorUnits: number;
  remainingSeconds: number;
  totalPeriodSeconds: number;
}

export interface UpgradeSubscriptionResult {
  success: boolean;
  sourcePlan: string;
  targetPlan: string;
  sourceAmountMinorUnits: number;
  targetAmountMinorUnits: number;
  creditMinorUnits: number;
  netAmountMinorUnits: number;
  currency: CurrencyCode;
  status: string;
  subscriptionId: string;
  planChangeId: string;
  reconciliationStatus?: UpgradeReconciliationStatus | string;
}

export interface DowngradeSubscriptionParams {
  targetPlanCode?: string;
}

export interface DowngradeSubscriptionResult {
  success: boolean;
  sourcePlan: string;
  targetPlan: string;
  sourceAmountMinorUnits: number;
  targetAmountMinorUnits: number;
  creditMinorUnits: number;
  netAmountMinorUnits: number;
  currency: CurrencyCode;
  status: string;
  subscriptionId: string;
  planChangeId: string;
  effectiveAt: Date;
}

export interface CancelDowngradeResult {
  success: boolean;
  planChangeId: string;
  status: string;
  currentPlan: string;
}

class KeyedMutex {
  private locks = new Map<string, Promise<void>>();

  public async runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    while (this.locks.has(key)) {
      await this.locks.get(key);
    }

    let release: () => void = () => {};
    const lockPromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(key, lockPromise);

    try {
      return await fn();
    } finally {
      this.locks.delete(key);
      release();
    }
  }
}

const upgradeMutex = new KeyedMutex();

export class BillingStateService {
  /**
   * Retrieves or initializes the persistent AccountBillingState for a user.
   * Defaults safely to FREE status with INR currency.
   */
  static async getBillingState(userId: string): Promise<AccountBillingState> {
    if (!userId) {
      throw new ValidationError('userId is required');
    }

    const state = await prisma.accountBillingState.findUnique({
      where: { userId }
    });

    if (state) {
      return state;
    }

    // Lazily initialize default FREE billing state for account (unconfirmed currency is null)
    return await prisma.accountBillingState.create({
      data: {
        userId,
        status: BillingStatus.FREE,
        currency: null
      }
    });
  }

  /**
   * Retrieves the current governing active subscription for a user account, if any.
   */
  static async getActiveSubscription(
    userId: string
  ): Promise<(Subscription & { plan: Plan; planPrice: PlanPrice }) | null> {
    const state = await prisma.accountBillingState.findUnique({
      where: { userId },
      include: {
        activeSubscription: {
          include: {
            plan: true,
            planPrice: true
          }
        }
      }
    });

    if (!state || !state.activeSubscription) {
      return null;
    }

    // Only return if subscription status is among valid paid entitled statuses
    if (PAID_ENTITLED_STATUSES.has(state.activeSubscription.status)) {
      return state.activeSubscription;
    }

    return null;
  }

  /**
   * Authoritatively determines the effective commercial plan and billing state for an account.
   */
  static async getEffectivePlan(userId: string): Promise<EffectivePlanResult> {
    if (!userId) {
      return {
        planCode: 'FREE',
        status: BillingStatus.FREE,
        subscription: null,
        billingCountry: null,
        billingPostalCode: null,
        currency: null
      };
    }

    const state = await prisma.accountBillingState.findUnique({
      where: { userId },
      include: {
        activeSubscription: {
          include: {
            plan: true,
            planPrice: true
          }
        }
      }
    });

    if (!state) {
      return {
        planCode: 'FREE',
        status: BillingStatus.FREE,
        subscription: null,
        billingCountry: null,
        billingPostalCode: null,
        currency: null
      };
    }

    const sub = state.activeSubscription;

    if (sub && PAID_ENTITLED_STATUSES.has(sub.status) && sub.plan && sub.plan.isActive) {
      return {
        planCode: sub.plan.code,
        status: state.status,
        subscription: sub,
        billingCountry: state.billingCountry,
        billingPostalCode: state.billingPostalCode,
        currency: state.currency || sub.currency
      };
    }

    return {
      planCode: 'FREE',
      status: state.status,
      subscription: null,
      billingCountry: state.billingCountry,
      billingPostalCode: state.billingPostalCode,
      currency: state.billingCountry ? state.currency : null
    };
  }

  /**
   * Authoritatively creates and activates an internal subscription contract for a user.
   * Enforces plan/price integrity, price grandfathering, and atomic state transitions.
   */
  static async createSubscription(
    params: CreateSubscriptionParams
  ): Promise<Subscription & { plan: Plan; planPrice: PlanPrice }> {
    const { userId, planCode, currency = CurrencyCode.INR, priceVersion, periodDays, billingCountry, billingPostalCode } = params;

    const normalizedCode = planCode?.trim()?.toUpperCase();

    // 1. Verify user exists
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundError('User account not found');
    }

    // 2. Fetch Plan
    const plan = await prisma.plan.findUnique({
      where: { code: normalizedCode },
      include: { prices: true }
    });

    if (!plan || !plan.isActive) {
      throw new NotFoundError(`Plan '${planCode}' not found or inactive`);
    }

    // 3. Find matched PlanPrice with price versioning
    let targetPrice: PlanPrice | undefined;

    if (priceVersion !== undefined) {
      targetPrice = plan.prices.find(
        (p) => p.currency === currency && p.version === priceVersion
      );
    } else {
      // Pick latest active version for the currency
      targetPrice = plan.prices
        .filter((p) => p.currency === currency && p.isActive)
        .sort((a, b) => b.version - a.version)[0];
    }

    if (!targetPrice) {
      throw new ValidationError(
        `No valid price found for plan '${plan.code}', currency '${currency}'${priceVersion ? ` and version ${priceVersion}` : ''}`
      );
    }

    // 4. Validate Plan and Price consistency
    if (targetPrice.planId !== plan.id) {
      throw new ValidationError('PlanPrice does not belong to the specified Plan');
    }

    // 5. Calculate subscription period
    const now = new Date();
    let days = periodDays;
    if (!days) {
      if (plan.interval === BillingInterval.YEARLY) {
        days = 365;
      } else {
        days = 30;
      }
    }
    const currentPeriodEnd = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    // 6. Execute atomic subscription creation and account billing state transition
    return await prisma.$transaction(async (tx) => {
      // Row-lock User to prevent concurrent subscription activations
      await tx.$executeRawUnsafe('SELECT id FROM `User` WHERE id = ? FOR UPDATE', user.id);

      // Fetch or create AccountBillingState inside transaction
      let billingState = await tx.accountBillingState.findUnique({
        where: { userId: user.id }
      });

      if (!billingState) {
        billingState = await tx.accountBillingState.create({
          data: {
            userId: user.id,
            status: BillingStatus.FREE,
            currency
          }
        });
      }

      // If existing active subscription exists, mark it replaced/cancelled
      if (billingState.activeSubscriptionId) {
        const existingSub = await tx.subscription.findUnique({
          where: { id: billingState.activeSubscriptionId }
        });

        if (existingSub && PAID_ENTITLED_STATUSES.has(existingSub.status)) {
          await tx.subscription.update({
            where: { id: existingSub.id },
            data: {
              status: BillingStatus.EXPIRED,
              expiredAt: now
            }
          });
        }
      }

      // Create new Subscription
      const sub = await tx.subscription.create({
        data: {
          userId: user.id,
          planId: plan.id,
          planPriceId: targetPrice.id,
          status: BillingStatus.ACTIVE,
          billingInterval: plan.interval,
          currency: targetPrice.currency,
          amountMinorUnits: targetPrice.amountMinorUnits,
          priceVersion: targetPrice.version,
          currentPeriodStart: now,
          currentPeriodEnd,
          cancelAtPeriodEnd: false
        },
        include: {
          plan: true,
          planPrice: true
        }
      });

      // Update AccountBillingState
      const updateData: Prisma.AccountBillingStateUpdateInput = {
        status: BillingStatus.ACTIVE,
        activeSubscription: { connect: { id: sub.id } },
        currency: targetPrice.currency
      };

      if (billingCountry) {
        updateData.billingCountry = billingCountry;
      }
      if (billingPostalCode) {
        updateData.billingPostalCode = billingPostalCode;
      }

      await tx.accountBillingState.update({
        where: { userId: user.id },
        data: updateData
      });

      // Record Audit Event
      await tx.auditEvent.create({
        data: {
          userId: user.id,
          eventType: AuditEventType.SUBSCRIPTION_ACTIVATED,
          metadata: {
            subscriptionId: sub.id,
            planCode: plan.code,
            priceVersion: targetPrice.version,
            currency: targetPrice.currency,
            amountMinorUnits: targetPrice.amountMinorUnits,
            currentPeriodStart: now.toISOString(),
            currentPeriodEnd: currentPeriodEnd.toISOString()
          }
        }
      });

      return sub;
    }, { maxWait: 15000, timeout: 30000 });
  }

  /**
   * Transitions subscription to PAST_DUE on payment failure.
   */
  static async markPastDue(subscriptionId: string): Promise<Subscription> {
    return await prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.findUnique({ where: { id: subscriptionId } });
      if (!sub) throw new NotFoundError('Subscription not found');

      if (sub.status !== BillingStatus.ACTIVE && sub.status !== BillingStatus.GRACE_PERIOD) {
        throw new ConflictError(`Cannot mark subscription in status '${sub.status}' as PAST_DUE`);
      }

      const updated = await tx.subscription.update({
        where: { id: sub.id },
        data: { status: BillingStatus.PAST_DUE }
      });

      await tx.accountBillingState.update({
        where: { userId: sub.userId },
        data: { status: BillingStatus.PAST_DUE }
      });

      await tx.auditEvent.create({
        data: {
          userId: sub.userId,
          eventType: AuditEventType.SUBSCRIPTION_PAST_DUE,
          metadata: { subscriptionId: sub.id }
        }
      });

      return updated;
    }, { maxWait: 15000, timeout: 30000 });
  }

  /**
   * Starts grace period for subscription. Entitlements remain active.
   */
  static async startGracePeriod(subscriptionId: string, graceDays = 5): Promise<Subscription> {
    return await prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.findUnique({ where: { id: subscriptionId } });
      if (!sub) throw new NotFoundError('Subscription not found');

      if (sub.status !== BillingStatus.ACTIVE && sub.status !== BillingStatus.PAST_DUE) {
        throw new ConflictError(`Cannot start grace period for subscription in status '${sub.status}'`);
      }

      const now = new Date();
      const gracePeriodEndsAt = new Date(now.getTime() + graceDays * 24 * 60 * 60 * 1000);

      const updated = await tx.subscription.update({
        where: { id: sub.id },
        data: {
          status: BillingStatus.GRACE_PERIOD,
          gracePeriodStartedAt: now,
          gracePeriodEndsAt
        }
      });

      await tx.accountBillingState.update({
        where: { userId: sub.userId },
        data: { status: BillingStatus.GRACE_PERIOD }
      });

      await tx.auditEvent.create({
        data: {
          userId: sub.userId,
          eventType: AuditEventType.SUBSCRIPTION_GRACE_PERIOD_STARTED,
          metadata: { subscriptionId: sub.id, gracePeriodEndsAt: gracePeriodEndsAt.toISOString() }
        }
      });

      return updated;
    }, { maxWait: 15000, timeout: 30000 });
  }

  /**
   * Recovers subscription from grace period back to ACTIVE upon successful charge.
   */
  static async recoverGracePeriod(subscriptionId: string): Promise<Subscription> {
    return await prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.findUnique({ where: { id: subscriptionId } });
      if (!sub) throw new NotFoundError('Subscription not found');

      if (sub.status !== BillingStatus.PAST_DUE && sub.status !== BillingStatus.GRACE_PERIOD) {
        throw new ConflictError(`Cannot recover grace period for subscription in status '${sub.status}'`);
      }

      const updated = await tx.subscription.update({
        where: { id: sub.id },
        data: {
          status: BillingStatus.ACTIVE,
          gracePeriodStartedAt: null,
          gracePeriodEndsAt: null,
          dunningMilestones: Prisma.DbNull,
          dunningLastEvaluatedAt: null
        }
      });

      await tx.accountBillingState.update({
        where: { userId: sub.userId },
        data: { status: BillingStatus.ACTIVE }
      });

      await tx.auditEvent.create({
        data: {
          userId: sub.userId,
          eventType: AuditEventType.SUBSCRIPTION_GRACE_PERIOD_RECOVERED,
          metadata: { subscriptionId: sub.id }
        }
      });

      return updated;
    }, { maxWait: 15000, timeout: 30000 });
  }

  /**
   * Authoritatively handles customer-requested subscription cancellation.
   * Cancels subscription at the end of the paid billing period (cancel-at-period-end).
   * Enforces session identity, provider cancellation synchronization, idempotency, and transactional row locking.
   */
  static async requestSubscriptionCancellation(
    userId: string,
    options?: { client?: RazorpayClient; reason?: string }
  ): Promise<Subscription & { plan: Plan; planPrice: PlanPrice }> {
    if (!userId) {
      throw new ValidationError('userId is required');
    }

    const state = await prisma.accountBillingState.findUnique({
      where: { userId },
      include: {
        activeSubscription: {
          include: {
            plan: true,
            planPrice: true
          }
        }
      }
    });

    if (!state) {
      throw new NotFoundError('Account billing state not found');
    }

    // Locate active or canceling subscription
    let targetSub = state.activeSubscription;
    if (!targetSub) {
      targetSub = await prisma.subscription.findFirst({
        where: {
          userId,
          status: { in: [BillingStatus.ACTIVE, BillingStatus.CANCELLING, BillingStatus.PAST_DUE, BillingStatus.GRACE_PERIOD] }
        },
        orderBy: { createdAt: 'desc' },
        include: {
          plan: true,
          planPrice: true
        }
      });
    }

    if (!targetSub) {
      throw new NotFoundError('No active or eligible subscription found for cancellation');
    }

    // Idempotency: If already CANCELLING, return existing cancellation state
    if (targetSub.status === BillingStatus.CANCELLING && targetSub.cancelAtPeriodEnd) {
      return targetSub;
    }

    if (
      targetSub.status !== BillingStatus.ACTIVE &&
      targetSub.status !== BillingStatus.PAST_DUE &&
      targetSub.status !== BillingStatus.GRACE_PERIOD
    ) {
      throw new ConflictError(`Cannot cancel subscription in status '${targetSub.status}'`);
    }

    // Call Razorpay API cancellation if providerSubscriptionId exists and provider client is configured
    if (targetSub.provider === 'RAZORPAY' && targetSub.providerSubscriptionId) {
      const client = options?.client || new RazorpayClient();
      if (options?.client || client.isConfigured()) {
        try {
          await client.cancelSubscription(targetSub.providerSubscriptionId, { cancel_at_cycle_end: 1 });
        } catch (providerErr: any) {
          // If provider fails, fail safely without updating local DB
          throw providerErr;
        }
      }
    }

    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SELECT id FROM `User` WHERE id = ? FOR UPDATE', userId);

      const subUpdated = await tx.subscription.update({
        where: { id: targetSub!.id },
        data: {
          status: BillingStatus.CANCELLING,
          cancelAtPeriodEnd: true,
          cancelledAt: now,
          updatedAt: now
        },
        include: {
          plan: true,
          planPrice: true
        }
      });

      await tx.accountBillingState.update({
        where: { userId },
        data: {
          status: BillingStatus.CANCELLING,
          updatedAt: now
        }
      });

      await tx.auditEvent.create({
        data: {
          userId,
          eventType: AuditEventType.SUBSCRIPTION_CANCELLATION_REQUESTED,
          metadata: {
            action: 'SUBSCRIPTION_CANCELLATION_REQUESTED',
            subscriptionId: targetSub!.id,
            providerSubscriptionId: targetSub!.providerSubscriptionId,
            currentPeriodEnd: targetSub!.currentPeriodEnd.toISOString(),
            reason: options?.reason || 'Customer requested cancel-at-period-end'
          }
        }
      });

      return subUpdated;
    }, { maxWait: 15000, timeout: 30000 });

    // In-app notification (non-blocking)
    try {
      const idempotencyKey = `notif_cancel_req_${updated.id}`;
      const existing = await prisma.notificationRecord.findUnique({ where: { idempotencyKey } });
      if (!existing) {
        const formattedDate = updated.currentPeriodEnd.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        });
        await prisma.notificationRecord.create({
          data: {
            userId,
            eventId: idempotencyKey,
            eventType: 'SUBSCRIPTION_CANCELLATION_REQUESTED',
            category: 'BILLING',
            severity: 'INFO',
            title: 'Subscription Cancellation Scheduled',
            body: `Your ZdexCloud ${updated.plan.name} subscription is scheduled to cancel on ${formattedDate}. You will retain full paid access until the end of your billing cycle.`,
            idempotencyKey,
            status: NotificationRecordStatus.UNREAD,
            metadata: {
              subscriptionId: updated.id,
              currentPeriodEnd: updated.currentPeriodEnd.toISOString()
            }
          }
        });
      }
    } catch {
      // Non-blocking notification
    }

    return updated;
  }

  /**
   * Attempts to undo a scheduled subscription cancellation before the paid period ends.
   * Authoritative Provider Invariant: Razorpay API does not support reversing/reactivating a cancelled subscription.
   * To prevent a dangerous split-brain state (local ACTIVE vs provider scheduled-cancellation),
   * cancellation reversal is explicitly rejected with 409 Conflict (CANCELLATION_REVERSAL_UNSUPPORTED).
   * The subscription remains safely in CANCELLING with full paid entitlements until the period ends.
   */
  static async undoSubscriptionCancellation(
    userId: string,
    options?: { client?: RazorpayClient; reason?: string }
  ): Promise<Subscription & { plan: Plan; planPrice: PlanPrice }> {
    if (!userId) {
      throw new ValidationError('userId is required');
    }

    const state = await prisma.accountBillingState.findUnique({
      where: { userId },
      include: {
        activeSubscription: {
          include: {
            plan: true,
            planPrice: true
          }
        }
      }
    });

    if (!state) {
      throw new NotFoundError('Account billing state not found');
    }

    let targetSub = state.activeSubscription;
    if (!targetSub) {
      targetSub = await prisma.subscription.findFirst({
        where: {
          userId,
          status: { in: [BillingStatus.ACTIVE, BillingStatus.CANCELLING] }
        },
        orderBy: { createdAt: 'desc' },
        include: {
          plan: true,
          planPrice: true
        }
      });
    }

    if (!targetSub) {
      throw new NotFoundError('No active or cancelling subscription found to resume');
    }

    // Idempotency: If already ACTIVE and not cancelling
    if (targetSub.status === BillingStatus.ACTIVE && !targetSub.cancelAtPeriodEnd) {
      return targetSub;
    }

    if (targetSub.status !== BillingStatus.CANCELLING) {
      throw new ConflictError(`Cannot undo cancellation for subscription in status '${targetSub.status}'`);
    }

    const now = new Date();
    if (now >= targetSub.currentPeriodEnd) {
      throw new ConflictError('Cannot undo cancellation because the paid period has already ended');
    }

    // Authoritative Provider Invariant: Razorpay does not support cancellation reversal.
    // Local state remains safely in CANCELLING with paid entitlements intact.
    throw new ConflictError(
      'Subscription cancellation reversal is not supported by the payment provider once scheduled. Your paid subscription will remain active until the end of your billing cycle.',
      'CANCELLATION_REVERSAL_UNSUPPORTED'
    );
  }

  /**
   * Sets cancelAtPeriodEnd flag. Paid entitlements remain active until current period ends.
   */
  static async cancelAtPeriodEnd(subscriptionId: string): Promise<Subscription> {
    const sub = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
    if (!sub) throw new NotFoundError('Subscription not found');
    return await this.requestSubscriptionCancellation(sub.userId);
  }

  /**
   * Expires a subscription after period end or grace period expiry.
   * Entitlements fall back to FREE. Existing servers are preserved without deletion.
   */
  static async expireSubscription(subscriptionId: string): Promise<Subscription> {
    return await prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.findUnique({ where: { id: subscriptionId } });
      if (!sub) throw new NotFoundError('Subscription not found');

      if (sub.status === BillingStatus.EXPIRED) {
        return sub;
      }

      const updated = await tx.subscription.update({
        where: { id: sub.id },
        data: {
          status: BillingStatus.EXPIRED,
          expiredAt: new Date()
        }
      });

      await tx.accountBillingState.update({
        where: { userId: sub.userId },
        data: {
          status: BillingStatus.EXPIRED,
          activeSubscriptionId: null
        }
      });

      await tx.auditEvent.create({
        data: {
          userId: sub.userId,
          eventType: AuditEventType.SUBSCRIPTION_EXPIRED,
          metadata: { subscriptionId: sub.id }
        }
      });

      return updated;
    }, { maxWait: 15000, timeout: 30000 });
  }

  /**
   * Marks a subscription as REFUNDED. Entitlements revert to FREE.
   */
  static async refundSubscription(subscriptionId: string): Promise<Subscription> {
    return await prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.findUnique({ where: { id: subscriptionId } });
      if (!sub) throw new NotFoundError('Subscription not found');

      if (
        sub.status !== BillingStatus.ACTIVE &&
        sub.status !== BillingStatus.CANCELLING &&
        sub.status !== BillingStatus.PAST_DUE &&
        sub.status !== BillingStatus.GRACE_PERIOD
      ) {
        throw new ConflictError(`Cannot refund subscription in status '${sub.status}'`);
      }

      const updated = await tx.subscription.update({
        where: { id: sub.id },
        data: {
          status: BillingStatus.REFUNDED,
          refundedAt: new Date()
        }
      });

      await tx.accountBillingState.update({
        where: { userId: sub.userId },
        data: {
          status: BillingStatus.REFUNDED,
          activeSubscriptionId: null
        }
      });

      await tx.auditEvent.create({
        data: {
          userId: sub.userId,
          eventType: AuditEventType.SUBSCRIPTION_REFUNDED,
          metadata: { subscriptionId: sub.id }
        }
      });

      return updated;
    }, { maxWait: 15000, timeout: 30000 });
  }

  /**
   * Confirms and persists customer billing country and postal code, deriving authoritative currency.
   */
  static async confirmBillingCountry(
    userId: string,
    params: ConfirmBillingCountryParams
  ): Promise<ConfirmedBillingRegion> {
    return await BillingCountryService.confirmBillingCountry(userId, params);
  }

  /**
   * Deterministically calculates proration credit for unused portion of current billing period.
   * Enforces integer minor-unit arithmetic (no floats), never negative, never exceeds original amount.
   */
  static calculateUpgradeProration(
    subscription: {
      amountMinorUnits: number;
      currentPeriodStart: Date;
      currentPeriodEnd: Date;
      currency: CurrencyCode;
    },
    targetAmountMinorUnits: number,
    timestamp: Date = new Date()
  ): ProrationCalculationResult {
    const periodStartMs = subscription.currentPeriodStart.getTime();
    const periodEndMs = subscription.currentPeriodEnd.getTime();
    const nowMs = timestamp.getTime();

    const totalPeriodSeconds = Math.max(1, Math.floor((periodEndMs - periodStartMs) / 1000));
    const remainingSeconds = Math.max(0, Math.floor((periodEndMs - nowMs) / 1000));

    if (remainingSeconds <= 0 || nowMs >= periodEndMs) {
      return {
        creditMinorUnits: 0,
        netAmountMinorUnits: targetAmountMinorUnits,
        remainingSeconds: 0,
        totalPeriodSeconds
      };
    }

    const fromAmount = subscription.amountMinorUnits;
    // Deterministic integer minor units arithmetic:
    // credit = Math.min(fromAmount, Math.max(0, Math.floor((fromAmount * remainingSeconds) / totalPeriodSeconds)))
    const creditMinorUnits = Math.min(
      fromAmount,
      Math.max(0, Math.floor((fromAmount * remainingSeconds) / totalPeriodSeconds))
    );

    const netAmountMinorUnits = Math.max(0, targetAmountMinorUnits - creditMinorUnits);

    return {
      creditMinorUnits,
      netAmountMinorUnits,
      remainingSeconds,
      totalPeriodSeconds
    };
  }

  /**
   * Upgrades an active Pro Monthly subscription to Pro Yearly with proration credit.
   * 
   * Strict Invariants:
   * 1. Requires authenticated user with active PRO_MONTHLY subscription.
   * 2. Rejects FREE, PRO_YEARLY, PAST_DUE, GRACE_PERIOD, CANCELLING, EXPIRED, REFUNDED, CREATED.
   * 3. Calculates exact deterministic integer minor-unit credit from original contracted monthly price.
   * 4. Resolves target Yearly PlanPrice server-side from active catalog (no client-controlled price).
   * 5. Validates verified Provider Plan Mapping.
   * 6. Serialized per userId via KeyedMutex to prevent race conditions.
   * 7. Calls Razorpay PATCH /v1/subscriptions/:id to update plan.
   * 8. On provider failure, leaves local state active in PRO_MONTHLY.
   * 9. On provider success, atomically updates Subscription, records SubscriptionPlanChange, and creates AuditEvent.
   */
  static async upgradeSubscription(
    userId: string,
    params: UpgradeSubscriptionParams,
    options?: { client?: RazorpayClient; environment?: PaymentEnvironment; timestamp?: Date }
  ): Promise<UpgradeSubscriptionResult> {
    if (!userId) {
      throw new ValidationError('userId is required');
    }

    const targetPlanCode = (params?.targetPlanCode || 'PRO_YEARLY').trim().toUpperCase();

    if (targetPlanCode !== 'PRO_YEARLY') {
      throw new ValidationError(`Unsupported upgrade target plan '${params?.targetPlanCode}'. Only PRO_YEARLY is supported.`);
    }

    return upgradeMutex.runExclusive(userId, async () => {
      const now = options?.timestamp || new Date();

      // 1. Authoritative Billing State & Active Subscription Resolution
      const billingState = await prisma.accountBillingState.findUnique({
        where: { userId },
        include: {
          activeSubscription: {
            include: {
              plan: true,
              planPrice: true
            }
          }
        }
      });

      if (!billingState) {
        throw new NotFoundError('Account billing state not found');
      }

      if (billingState.status === BillingStatus.FREE || !billingState.activeSubscription) {
        throw new ConflictError('Account is on FREE plan. Use checkout to subscribe to Pro.');
      }

      if (billingState.status === BillingStatus.PAST_DUE || billingState.status === BillingStatus.GRACE_PERIOD) {
        throw new ConflictError('Cannot upgrade subscription while payment is past due or in grace period.');
      }

      if (billingState.status === BillingStatus.CANCELLING) {
        throw new ConflictError('Cannot upgrade a subscription scheduled for cancellation.');
      }

      if (billingState.status === BillingStatus.EXPIRED || billingState.status === BillingStatus.REFUNDED) {
        throw new ConflictError('Cannot upgrade an expired or refunded subscription. Please purchase a new subscription.');
      }

      if (billingState.status === BillingStatus.CREATED) {
        throw new ConflictError('Cannot upgrade an unactivated subscription.');
      }

      const activeSub = billingState.activeSubscription;

      if (activeSub.status === BillingStatus.CANCELLING || activeSub.cancelAtPeriodEnd) {
        throw new ConflictError('Cannot upgrade a subscription scheduled for cancellation.');
      }

      if (activeSub.status !== BillingStatus.ACTIVE) {
        throw new ConflictError(`Cannot upgrade subscription in status '${activeSub.status}'.`);
      }

      if (activeSub.billingInterval === BillingInterval.YEARLY || activeSub.plan.code === 'PRO_YEARLY') {
        throw new ConflictError('Subscription is already on Pro Yearly.');
      }

      if (activeSub.plan.code !== 'PRO_MONTHLY' || activeSub.billingInterval !== BillingInterval.MONTHLY) {
        throw new ConflictError(`Cannot upgrade subscription from plan '${activeSub.plan.code}'. Only PRO_MONTHLY is supported.`);
      }

      if (now >= activeSub.currentPeriodEnd) {
        throw new ConflictError('Current billing period has already ended.');
      }

      // 2. Billing Country and Currency Verification
      if (!billingState.billingCountry) {
        throw new ValidationError('Billing country must be confirmed before upgrading subscription.');
      }

      const derivedCurrency = BillingCountryService.deriveBillingCurrency(billingState.billingCountry);
      if (activeSub.currency !== derivedCurrency) {
        throw new ConflictError(`Subscription currency '${activeSub.currency}' does not match confirmed billing region currency '${derivedCurrency}'.`);
      }

      // 3. Resolve Target Plan and Active PlanPrice
      const targetPlan = await prisma.plan.findUnique({
        where: { code: targetPlanCode },
        include: { prices: true }
      });

      if (!targetPlan || !targetPlan.isActive) {
        throw new NotFoundError(`Active target plan '${targetPlanCode}' not found.`);
      }

      const targetPlanPrice = targetPlan.prices
        .filter((p) => p.currency === derivedCurrency && p.isActive)
        .sort((a, b) => b.version - a.version)[0];

      if (!targetPlanPrice) {
        throw new NotFoundError(`Active PlanPrice not found for plan '${targetPlanCode}' and currency '${derivedCurrency}'.`);
      }

      // 4. Resolve Verified Provider Plan Mapping
      const environment = options?.environment || activeSub.providerEnvironment || RazorpayPlanCatalogService.resolvePaymentEnvironment();

      const mapping = await prisma.billingProviderPlanMapping.findUnique({
        where: {
          provider_environment_planPriceId: {
            provider: PaymentProvider.RAZORPAY,
            environment,
            planPriceId: targetPlanPrice.id
          }
        }
      });

      if (!mapping || !mapping.isActive || !mapping.providerPlanId) {
        throw new RazorpayProviderError(
          'CATALOG_INCOMPLETE',
          `No active Razorpay plan mapping found for '${targetPlanCode}' (${derivedCurrency}) in environment '${environment}'. Please ensure catalog synchronization has run.`
        );
      }

      // 5. Calculate Proration Credit
      const proration = this.calculateUpgradeProration(
        activeSub,
        targetPlanPrice.amountMinorUnits,
        now
      );

      // 6. Concurrency / Duplicate Upgrade Check
      const existingInProgress = await prisma.subscriptionPlanChange.findFirst({
        where: {
          subscriptionId: activeSub.id,
          status: PlanChangeStatus.PROCESSING
        }
      });

      if (existingInProgress) {
        throw new ConflictError('An upgrade is already in progress for this subscription.');
      }

      // 7. Verify Provider Subscription Existence and Client Initialization
      if (!activeSub.providerSubscriptionId) {
        throw new RazorpayProviderError('VALIDATION_ERROR', 'Provider subscription ID is missing on active subscription.');
      }

      const client = options?.client || new RazorpayClient();

      // 8. Fetch Provider Subscription to inspect Payment Method & Duration
      let providerSub: any;
      try {
        providerSub = await client.fetchSubscription(activeSub.providerSubscriptionId);
      } catch (fetchErr: any) {
        throw new RazorpayProviderError('API_ERROR', `Failed to verify provider subscription eligibility: ${fetchErr.message}`);
      }

      // 9. Payment-Method Safety Verification
      // Razorpay documentation restricts live subscription updates by payment method (specifically excludes UPI/eMandate).
      const paymentMethod = (providerSub?.payment_method || providerSub?.auth_transaction?.payment_method || '').toLowerCase();
      if (paymentMethod === 'upi' || paymentMethod === 'emandate') {
        throw new ConflictError(
          `The current subscription payment method ('${paymentMethod}') does not support immediate plan upgrade on Razorpay. Please start a new yearly subscription after your monthly billing period ends.`,
          'UPGRADE_PAYMENT_METHOD_UNSUPPORTED'
        );
      }

      // 10. Safe remaining_count derivation
      let remainingCount: number | undefined;
      if (providerSub?.total_count !== undefined && providerSub?.paid_count !== undefined) {
        remainingCount = Math.max(1, Number(providerSub.total_count) - Number(providerSub.paid_count));
      } else if (providerSub?.remaining_count !== undefined) {
        remainingCount = Math.max(1, Number(providerSub.remaining_count));
      }

      // 11. Record Plan Change Audit Record (PROCESSING) & Initial Pending Reconciliation
      const planChange = await prisma.$transaction(async (tx) => {
        const pc = await tx.subscriptionPlanChange.create({
          data: {
            userId,
            subscriptionId: activeSub.id,
            fromPlanId: activeSub.planId,
            fromPlanPriceId: activeSub.planPriceId,
            toPlanId: targetPlan.id,
            toPlanPriceId: targetPlanPrice.id,
            fromAmountMinorUnits: activeSub.amountMinorUnits,
            toAmountMinorUnits: targetPlanPrice.amountMinorUnits,
            currency: activeSub.currency,
            creditMinorUnits: proration.creditMinorUnits,
            netAmountMinorUnits: proration.netAmountMinorUnits,
            provider: PaymentProvider.RAZORPAY,
            providerEnvironment: environment,
            providerSubscriptionId: activeSub.providerSubscriptionId,
            status: PlanChangeStatus.PROCESSING,
            requestedAt: now
          }
        });

        await tx.subscriptionUpgradeReconciliation.create({
          data: {
            planChangeId: pc.id,
            subscriptionId: activeSub.id,
            userId,
            expectedAmountMinorUnits: proration.netAmountMinorUnits,
            expectedCreditMinorUnits: proration.creditMinorUnits,
            expectedCurrency: activeSub.currency,
            status: UpgradeReconciliationStatus.PENDING,
            checkedAt: now
          }
        });

        return pc;
      });

      // 12. Record SUBSCRIPTION_UPGRADE_REQUESTED Audit Event
      await prisma.auditEvent.create({
        data: {
          userId,
          eventType: AuditEventType.SUBSCRIPTION_UPGRADE_REQUESTED,
          metadata: {
            action: 'SUBSCRIPTION_UPGRADE_REQUESTED',
            subscriptionId: activeSub.id,
            planChangeId: planChange.id,
            fromPlan: activeSub.plan.code,
            toPlan: targetPlan.code,
            fromPlanPriceId: activeSub.planPriceId,
            toPlanPriceId: targetPlanPrice.id,
            fromAmountMinorUnits: activeSub.amountMinorUnits,
            toAmountMinorUnits: targetPlanPrice.amountMinorUnits,
            creditMinorUnits: proration.creditMinorUnits,
            netAmountMinorUnits: proration.netAmountMinorUnits,
            currency: activeSub.currency,
            provider: 'RAZORPAY',
            providerSubscriptionId: activeSub.providerSubscriptionId,
            environment
          }
        }
      });

      // 13. Execute Provider Plan Update
      let providerResponse: any;
      try {
        providerResponse = await client.updateSubscription(activeSub.providerSubscriptionId, {
          plan_id: mapping.providerPlanId,
          schedule_change_at: 'now',
          customer_notify: 1,
          ...(remainingCount !== undefined ? { remaining_count: remainingCount } : {})
        });
      } catch (providerErr: any) {
        await prisma.subscriptionPlanChange.update({
          where: { id: planChange.id },
          data: {
            status: PlanChangeStatus.FAILED,
            failureReason: providerErr?.message ? String(providerErr.message).substring(0, 1000) : 'Provider update failed'
          }
        });

        // Re-throw so caller receives error; original subscription remains intact
        throw providerErr;
      }

      // 14. Atomic Database State Update on Provider Success
      const nextPeriodStart = providerResponse?.current_start ? new Date(providerResponse.current_start * 1000) : now;
      let nextPeriodEnd: Date;
      if (providerResponse?.current_end) {
        nextPeriodEnd = new Date(providerResponse.current_end * 1000);
      } else {
        nextPeriodEnd = new Date(nextPeriodStart);
        nextPeriodEnd.setFullYear(nextPeriodEnd.getFullYear() + (targetPlan.intervalCount || 1));
      }

      await prisma.$transaction(async (tx) => {
        // A. Update Subscription to Yearly plan & price
        await tx.subscription.update({
          where: { id: activeSub.id },
          data: {
            planId: targetPlan.id,
            planPriceId: targetPlanPrice.id,
            providerPlanId: mapping.providerPlanId,
            billingInterval: BillingInterval.YEARLY,
            amountMinorUnits: targetPlanPrice.amountMinorUnits,
            priceVersion: targetPlanPrice.version,
            currentPeriodStart: nextPeriodStart,
            currentPeriodEnd: nextPeriodEnd,
            updatedAt: now
          }
        });

        // B. Complete SubscriptionPlanChange
        await tx.subscriptionPlanChange.update({
          where: { id: planChange.id },
          data: {
            status: PlanChangeStatus.COMPLETED,
            completedAt: now,
            updatedAt: now
          }
        });

        // C. Record Authoritative SUBSCRIPTION_UPGRADED Audit Event
        await tx.auditEvent.create({
          data: {
            userId,
            eventType: AuditEventType.SUBSCRIPTION_UPGRADED,
            metadata: {
              action: 'SUBSCRIPTION_UPGRADED',
              subscriptionId: activeSub.id,
              planChangeId: planChange.id,
              fromPlan: activeSub.plan.code,
              toPlan: targetPlan.code,
              fromPlanPriceId: activeSub.planPriceId,
              toPlanPriceId: targetPlanPrice.id,
              fromAmountMinorUnits: activeSub.amountMinorUnits,
              toAmountMinorUnits: targetPlanPrice.amountMinorUnits,
              creditMinorUnits: proration.creditMinorUnits,
              netAmountMinorUnits: proration.netAmountMinorUnits,
              currency: activeSub.currency,
              provider: 'RAZORPAY',
              providerSubscriptionId: activeSub.providerSubscriptionId,
              environment
            }
          }
        });
      }, { timeout: 30000, maxWait: 15000 });

      // 15. In-App Notification Dispatch (Non-blocking)
      try {
        const notifIdempotencyKey = `notif_upgrade_${activeSub.id}_${planChange.id}`;
        const existingNotif = await prisma.notificationRecord.findUnique({
          where: { idempotencyKey: notifIdempotencyKey }
        });

        if (!existingNotif) {
          await prisma.notificationRecord.create({
            data: {
              userId,
              eventId: planChange.id,
              eventType: 'SUBSCRIPTION_UPGRADED',
              category: 'BILLING',
              severity: 'INFO',
              title: 'Subscription Upgraded to Pro Yearly',
              body: `Your subscription has been successfully upgraded to ${targetPlan.name}.`,
              idempotencyKey: notifIdempotencyKey,
              status: NotificationRecordStatus.UNREAD,
              metadata: {
                subscriptionId: activeSub.id,
                planChangeId: planChange.id,
                fromPlan: activeSub.plan.code,
                toPlan: targetPlan.code,
                creditMinorUnits: proration.creditMinorUnits,
                netAmountMinorUnits: proration.netAmountMinorUnits,
                currency: activeSub.currency
              }
            }
          });
        }
      } catch {
        // Non-blocking notification
      }

      return {
        success: true,
        sourcePlan: activeSub.plan.code,
        targetPlan: targetPlan.code,
        sourceAmountMinorUnits: activeSub.amountMinorUnits,
        targetAmountMinorUnits: targetPlanPrice.amountMinorUnits,
        creditMinorUnits: proration.creditMinorUnits,
        netAmountMinorUnits: proration.netAmountMinorUnits,
        currency: activeSub.currency,
        status: 'COMPLETED',
        subscriptionId: activeSub.id,
        planChangeId: planChange.id
      };
    });
  }

  /**
   * ZC-BILLING-6.2: Schedules a Pro Yearly -> Pro Monthly subscription downgrade at the end of the current billing cycle.
   */
  static async downgradeSubscription(
    userId: string,
    params?: DowngradeSubscriptionParams,
    options?: { client?: RazorpayClient; environment?: PaymentEnvironment; timestamp?: Date }
  ): Promise<DowngradeSubscriptionResult> {
    if (!userId) {
      throw new ValidationError('userId is required');
    }

    const targetPlanCode = (params?.targetPlanCode || 'PRO_MONTHLY').trim().toUpperCase();

    if (targetPlanCode !== 'PRO_MONTHLY') {
      throw new ValidationError(`Unsupported downgrade target plan '${params?.targetPlanCode}'. Only PRO_MONTHLY is supported.`);
    }

    return upgradeMutex.runExclusive(userId, async () => {
      const now = options?.timestamp || new Date();

      // 1. Authoritative Billing State & Active Subscription Resolution
      const billingState = await prisma.accountBillingState.findUnique({
        where: { userId },
        include: {
          activeSubscription: {
            include: {
              plan: true,
              planPrice: true
            }
          }
        }
      });

      if (!billingState) {
        throw new NotFoundError('Account billing state not found');
      }

      if (billingState.status === BillingStatus.FREE || !billingState.activeSubscription) {
        throw new ConflictError('Account is on FREE plan. Use checkout to subscribe to Pro.');
      }

      if (billingState.status === BillingStatus.PAST_DUE || billingState.status === BillingStatus.GRACE_PERIOD) {
        throw new ConflictError('Cannot downgrade subscription while payment is past due or in grace period.');
      }

      if (billingState.status === BillingStatus.CANCELLING) {
        throw new ConflictError('Cannot downgrade a subscription scheduled for cancellation.');
      }

      if (billingState.status === BillingStatus.EXPIRED || billingState.status === BillingStatus.REFUNDED) {
        throw new ConflictError('Cannot downgrade an expired or refunded subscription.');
      }

      if (billingState.status === BillingStatus.CREATED) {
        throw new ConflictError('Cannot downgrade an unactivated subscription.');
      }

      const activeSub = billingState.activeSubscription;

      if (activeSub.status === BillingStatus.CANCELLING || activeSub.cancelAtPeriodEnd) {
        throw new ConflictError('Cannot downgrade a subscription scheduled for cancellation.');
      }

      if (activeSub.status !== BillingStatus.ACTIVE) {
        throw new ConflictError(`Cannot downgrade subscription in status '${activeSub.status}'.`);
      }

      if (activeSub.billingInterval !== BillingInterval.YEARLY || activeSub.plan.code !== 'PRO_YEARLY') {
        throw new ConflictError(`Cannot downgrade subscription from plan '${activeSub.plan.code}'. Only PRO_YEARLY is supported for downgrade to PRO_MONTHLY.`);
      }

      if (now >= activeSub.currentPeriodEnd) {
        throw new ConflictError('Current billing period has already ended.');
      }

      // 2. Billing Country and Currency Verification
      if (!billingState.billingCountry) {
        throw new ValidationError('Billing country must be confirmed before changing subscription.');
      }

      const derivedCurrency = BillingCountryService.deriveBillingCurrency(billingState.billingCountry);
      if (activeSub.currency !== derivedCurrency) {
        throw new ConflictError(`Subscription currency '${activeSub.currency}' does not match confirmed billing region currency '${derivedCurrency}'.`);
      }

      // 3. Resolve Target Plan and Active PlanPrice
      const targetPlan = await prisma.plan.findUnique({
        where: { code: targetPlanCode },
        include: { prices: true }
      });

      if (!targetPlan || !targetPlan.isActive) {
        throw new NotFoundError(`Active target plan '${targetPlanCode}' not found.`);
      }

      const targetPlanPrice = targetPlan.prices
        .filter((p) => p.currency === derivedCurrency && p.isActive)
        .sort((a, b) => b.version - a.version)[0];

      if (!targetPlanPrice) {
        throw new NotFoundError(`Active PlanPrice not found for plan '${targetPlanCode}' and currency '${derivedCurrency}'.`);
      }

      // 4. Resolve Verified Provider Plan Mapping
      const environment = options?.environment || activeSub.providerEnvironment || RazorpayPlanCatalogService.resolvePaymentEnvironment();

      const mapping = await prisma.billingProviderPlanMapping.findUnique({
        where: {
          provider_environment_planPriceId: {
            provider: PaymentProvider.RAZORPAY,
            environment,
            planPriceId: targetPlanPrice.id
          }
        }
      });

      if (!mapping || !mapping.isActive || !mapping.providerPlanId) {
        throw new RazorpayProviderError(
          'CATALOG_INCOMPLETE',
          `No active Razorpay plan mapping found for '${targetPlanCode}' (${derivedCurrency}) in environment '${environment}'. Please ensure catalog synchronization has run.`
        );
      }

      // 5. Concurrency / Duplicate Plan Change Check
      const existingPending = await prisma.subscriptionPlanChange.findFirst({
        where: {
          subscriptionId: activeSub.id,
          status: {
            in: [PlanChangeStatus.PROCESSING, PlanChangeStatus.SCHEDULED]
          }
        }
      });

      if (existingPending) {
        throw new ConflictError('A plan change or downgrade is already scheduled or in progress for this subscription.');
      }

      // 6. Verify Provider Subscription Existence and Client Initialization
      if (!activeSub.providerSubscriptionId) {
        throw new RazorpayProviderError('VALIDATION_ERROR', 'Provider subscription ID is missing on active subscription.');
      }

      const client = options?.client || new RazorpayClient();

      // 7. Fetch Provider Subscription to inspect Payment Method & Duration
      let providerSub: any;
      try {
        providerSub = await client.fetchSubscription(activeSub.providerSubscriptionId);
      } catch (fetchErr: any) {
        throw new RazorpayProviderError('API_ERROR', `Failed to verify provider subscription eligibility: ${fetchErr.message}`);
      }

      // 8. Payment-Method Safety Verification
      const paymentMethod = (providerSub?.payment_method || providerSub?.auth_transaction?.payment_method || '').toLowerCase();
      if (paymentMethod === 'upi' || paymentMethod === 'emandate') {
        throw new ConflictError(
          `The current subscription payment method ('${paymentMethod}') does not support scheduled plan downgrade on Razorpay.`,
          'DOWNGRADE_PAYMENT_METHOD_UNSUPPORTED'
        );
      }

      // 9. Safe remaining_count derivation (never 0)
      let remainingCount: number | undefined;
      if (providerSub?.total_count !== undefined && providerSub?.paid_count !== undefined) {
        remainingCount = Math.max(1, Number(providerSub.total_count) - Number(providerSub.paid_count));
      } else if (providerSub?.remaining_count !== undefined) {
        remainingCount = Math.max(1, Number(providerSub.remaining_count));
      }

      // 10. Record Plan Change Audit Record (PROCESSING)
      const planChange = await prisma.subscriptionPlanChange.create({
        data: {
          userId,
          subscriptionId: activeSub.id,
          fromPlanId: activeSub.planId,
          fromPlanPriceId: activeSub.planPriceId,
          toPlanId: targetPlan.id,
          toPlanPriceId: targetPlanPrice.id,
          fromAmountMinorUnits: activeSub.amountMinorUnits,
          toAmountMinorUnits: targetPlanPrice.amountMinorUnits,
          currency: activeSub.currency,
          creditMinorUnits: 0,
          netAmountMinorUnits: 0,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: environment,
          providerSubscriptionId: activeSub.providerSubscriptionId,
          status: PlanChangeStatus.PROCESSING,
          scheduledFor: activeSub.currentPeriodEnd,
          requestedAt: now
        }
      });

      // 11. Record SUBSCRIPTION_DOWNGRADE_REQUESTED Audit Event
      await prisma.auditEvent.create({
        data: {
          userId,
          eventType: AuditEventType.SUBSCRIPTION_DOWNGRADE_REQUESTED,
          metadata: {
            action: 'SUBSCRIPTION_DOWNGRADE_REQUESTED',
            subscriptionId: activeSub.id,
            planChangeId: planChange.id,
            fromPlan: activeSub.plan.code,
            toPlan: targetPlan.code,
            fromPlanPriceId: activeSub.planPriceId,
            toPlanPriceId: targetPlanPrice.id,
            fromAmountMinorUnits: activeSub.amountMinorUnits,
            toAmountMinorUnits: targetPlanPrice.amountMinorUnits,
            currency: activeSub.currency,
            provider: 'RAZORPAY',
            providerSubscriptionId: activeSub.providerSubscriptionId,
            scheduledFor: activeSub.currentPeriodEnd.toISOString(),
            environment
          }
        }
      });

      // 12. Execute Provider Plan Update (schedule_change_at: 'cycle_end')
      try {
        await client.updateSubscription(activeSub.providerSubscriptionId, {
          plan_id: mapping.providerPlanId,
          schedule_change_at: 'cycle_end',
          customer_notify: 1,
          ...(remainingCount !== undefined ? { remaining_count: remainingCount } : {})
        });
      } catch (providerErr: any) {
        await prisma.subscriptionPlanChange.update({
          where: { id: planChange.id },
          data: {
            status: PlanChangeStatus.FAILED,
            failureReason: providerErr?.message ? String(providerErr.message).substring(0, 1000) : 'Provider scheduled update failed'
          }
        });

        throw providerErr;
      }

      // 13. Update SubscriptionPlanChange to SCHEDULED
      await prisma.subscriptionPlanChange.update({
        where: { id: planChange.id },
        data: {
          status: PlanChangeStatus.SCHEDULED,
          scheduledFor: activeSub.currentPeriodEnd,
          updatedAt: now
        }
      });

      // 14. Record SUBSCRIPTION_DOWNGRADE_SCHEDULED Audit Event
      await prisma.auditEvent.create({
        data: {
          userId,
          eventType: AuditEventType.SUBSCRIPTION_DOWNGRADE_SCHEDULED,
          metadata: {
            action: 'SUBSCRIPTION_DOWNGRADE_SCHEDULED',
            subscriptionId: activeSub.id,
            planChangeId: planChange.id,
            fromPlan: activeSub.plan.code,
            toPlan: targetPlan.code,
            fromPlanPriceId: activeSub.planPriceId,
            toPlanPriceId: targetPlanPrice.id,
            fromAmountMinorUnits: activeSub.amountMinorUnits,
            toAmountMinorUnits: targetPlanPrice.amountMinorUnits,
            currency: activeSub.currency,
            provider: 'RAZORPAY',
            providerSubscriptionId: activeSub.providerSubscriptionId,
            scheduledFor: activeSub.currentPeriodEnd.toISOString(),
            environment
          }
        }
      });

      // 15. In-App Notification (Non-blocking)
      try {
        const notifIdempotencyKey = `notif_downgrade_sched_${activeSub.id}_${planChange.id}`;
        const existingNotif = await prisma.notificationRecord.findUnique({
          where: { idempotencyKey: notifIdempotencyKey }
        });

        if (!existingNotif) {
          await prisma.notificationRecord.create({
            data: {
              userId,
              eventId: planChange.id,
              eventType: 'SUBSCRIPTION_DOWNGRADE_SCHEDULED',
              category: 'BILLING',
              severity: 'INFO',
              title: 'Pro Monthly Downgrade Scheduled',
              body: `Your subscription will transition to Pro Monthly at the end of your current yearly billing cycle on ${activeSub.currentPeriodEnd.toISOString().split('T')[0]}.`,
              idempotencyKey: notifIdempotencyKey,
              status: NotificationRecordStatus.UNREAD,
              metadata: {
                subscriptionId: activeSub.id,
                planChangeId: planChange.id,
                fromPlan: activeSub.plan.code,
                toPlan: targetPlan.code,
                scheduledFor: activeSub.currentPeriodEnd.toISOString(),
                currency: activeSub.currency
              }
            }
          });
        }
      } catch {
        // Non-blocking notification
      }

      return {
        success: true,
        sourcePlan: activeSub.plan.code,
        targetPlan: targetPlan.code,
        sourceAmountMinorUnits: activeSub.amountMinorUnits,
        targetAmountMinorUnits: targetPlanPrice.amountMinorUnits,
        creditMinorUnits: 0,
        netAmountMinorUnits: 0,
        currency: activeSub.currency,
        status: 'SCHEDULED',
        subscriptionId: activeSub.id,
        planChangeId: planChange.id,
        effectiveAt: activeSub.currentPeriodEnd
      };
    });
  }

  /**
   * ZC-BILLING-6.2: Cancels a scheduled subscription downgrade before it becomes effective.
   */
  static async cancelPendingDowngrade(
    userId: string,
    options?: { client?: RazorpayClient; timestamp?: Date }
  ): Promise<CancelDowngradeResult> {
    if (!userId) {
      throw new ValidationError('userId is required');
    }

    return upgradeMutex.runExclusive(userId, async () => {
      const now = options?.timestamp || new Date();

      const billingState = await prisma.accountBillingState.findUnique({
        where: { userId },
        include: {
          activeSubscription: {
            include: {
              plan: true,
              planPrice: true
            }
          }
        }
      });

      if (!billingState || !billingState.activeSubscription) {
        throw new NotFoundError('Active subscription not found for account');
      }

      const activeSub = billingState.activeSubscription;

      // Find pending SCHEDULED plan change
      const pendingChange = await prisma.subscriptionPlanChange.findFirst({
        where: {
          subscriptionId: activeSub.id,
          status: PlanChangeStatus.SCHEDULED
        },
        include: {
          toPlan: true
        },
        orderBy: { requestedAt: 'desc' }
      });

      if (!pendingChange) {
        throw new NotFoundError('No scheduled downgrade found for this subscription.');
      }

      // Check if downgrade is already effective
      if (pendingChange.scheduledFor && now >= pendingChange.scheduledFor) {
        throw new ConflictError('Scheduled downgrade is already effective and cannot be cancelled.', 'DOWNGRADE_ALREADY_EFFECTIVE');
      }

      if (!activeSub.providerSubscriptionId) {
        throw new RazorpayProviderError('VALIDATION_ERROR', 'Provider subscription ID is missing on active subscription.');
      }

      // Record SUBSCRIPTION_DOWNGRADE_CANCEL_REQUESTED Audit Event
      await prisma.auditEvent.create({
        data: {
          userId,
          eventType: AuditEventType.SUBSCRIPTION_DOWNGRADE_CANCEL_REQUESTED,
          metadata: {
            action: 'SUBSCRIPTION_DOWNGRADE_CANCEL_REQUESTED',
            subscriptionId: activeSub.id,
            planChangeId: pendingChange.id,
            providerSubscriptionId: activeSub.providerSubscriptionId
          }
        }
      });

      const client = options?.client || new RazorpayClient();

      // Call Provider cancel_scheduled_changes
      await client.cancelScheduledChanges(activeSub.providerSubscriptionId);

      // On provider success, atomically mark SubscriptionPlanChange as CANCELLED
      await prisma.$transaction(async (tx) => {
        await tx.subscriptionPlanChange.update({
          where: { id: pendingChange.id },
          data: {
            status: PlanChangeStatus.CANCELLED,
            cancelledAt: now,
            updatedAt: now
          }
        });

        await tx.auditEvent.create({
          data: {
            userId,
            eventType: AuditEventType.SUBSCRIPTION_DOWNGRADE_CANCELLED,
            metadata: {
              action: 'SUBSCRIPTION_DOWNGRADE_CANCELLED',
              subscriptionId: activeSub.id,
              planChangeId: pendingChange.id,
              providerSubscriptionId: activeSub.providerSubscriptionId
            }
          }
        });
      });

      // Dispatch In-App Notification (Non-blocking)
      try {
        const notifIdempotencyKey = `notif_downgrade_cancel_${activeSub.id}_${pendingChange.id}`;
        const existingNotif = await prisma.notificationRecord.findUnique({
          where: { idempotencyKey: notifIdempotencyKey }
        });

        if (!existingNotif) {
          await prisma.notificationRecord.create({
            data: {
              userId,
              eventId: pendingChange.id,
              eventType: 'SUBSCRIPTION_DOWNGRADE_CANCELLED',
              category: 'BILLING',
              severity: 'INFO',
              title: 'Subscription Downgrade Cancelled',
              body: 'Your scheduled downgrade has been cancelled. Your Pro Yearly subscription will continue renewing normally.',
              idempotencyKey: notifIdempotencyKey,
              status: NotificationRecordStatus.UNREAD,
              metadata: {
                subscriptionId: activeSub.id,
                planChangeId: pendingChange.id,
                currentPlan: activeSub.plan.code
              }
            }
          });
        }
      } catch {
        // Non-blocking notification
      }

      return {
        success: true,
        planChangeId: pendingChange.id,
        status: 'CANCELLED',
        currentPlan: activeSub.plan.code
      };
    });
  }
}

export { BillingCountryService, ConfirmBillingCountryParams, ConfirmedBillingRegion };
export { DunningService } from './dunning_service.js';
