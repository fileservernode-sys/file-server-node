import {
  Prisma,
  BillingStatus,
  PaymentStatus,
  RefundStatus,
  ReconciliationStatus,
  ReconciliationRunStatus,
  AdminAuditAction,
  CurrencyCode,
  PaymentProvider,
  PaymentEnvironment
} from '@prisma/client';
import { prisma } from '../../../../config/database.js';
import { NotFoundError, ConflictError, ValidationError } from '../../../../errors/app-error.js';
import { createPaginatedResponse, PaginatedResult } from '../utils/pagination.js';
import { executeAdminOperation } from '../utils/operation_executor.js';
import { AdminOperationContext } from '../types.js';
import { RazorpayClient } from '../../../../services/billing/providers/razorpay/razorpay_client.js';
import { PAID_ENTITLED_STATUSES } from '../../../../services/billing/billing_state_service.js';
import {
  AdminSubscriptionSummary,
  AdminSubscriptionDetail,
  AdminSubscriptionDunningDetail,
  AdminCancelSubscriptionResult,
  AdminProviderSubscriptionInspectionResult,
  AdminPaymentSummary,
  AdminPaymentDetail,
  AdminRefundSummary,
  AdminRefundDetail,
  AdminReconciliationRunSummary,
  AdminReconciliationDiscrepancySummary,
  AdminPlanSummary,
  AdminBillingOverviewMetrics
} from './types.js';
import {
  AdminSubscriptionListQuery,
  AdminPaymentListQuery,
  AdminRefundListQuery,
  AdminReconciliationRunListQuery,
  AdminDiscrepancyListQuery,
  AdminPlanListQuery
} from './schemas.js';

export class AdminBillingService {
  /**
   * Retrieves high-level operational metrics for the billing subsystem.
   */
  static async getBillingOverview(): Promise<AdminBillingOverviewMetrics> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      activeSubscriptions,
      pastDueSubscriptions,
      gracePeriodSubscriptions,
      cancellingSubscriptions,
      totalPaidUsers,
      recentPayments,
      recentRefunds,
      pendingDiscrepancies,
      stuckWebhooksCount,
      latestRun
    ] = await Promise.all([
      prisma.subscription.count({ where: { status: BillingStatus.ACTIVE } }),
      prisma.subscription.count({ where: { status: BillingStatus.PAST_DUE } }),
      prisma.subscription.count({ where: { status: BillingStatus.GRACE_PERIOD } }),
      prisma.subscription.count({ where: { status: BillingStatus.CANCELLING } }),
      prisma.accountBillingState.count({ where: { status: { in: [BillingStatus.ACTIVE, BillingStatus.PAST_DUE, BillingStatus.GRACE_PERIOD, BillingStatus.CANCELLING] } } }),
      prisma.billingPayment.findMany({
        where: { chargedAt: { gte: thirtyDaysAgo }, status: PaymentStatus.SUCCESS },
        select: { amountMinorUnits: true, currency: true }
      }),
      prisma.billingRefund.findMany({
        where: { requestedAt: { gte: thirtyDaysAgo }, status: RefundStatus.PROCESSED },
        select: { amountMinorUnits: true, currency: true }
      }),
      prisma.billingReconciliationDiscrepancy.count({
        where: { status: { in: [ReconciliationStatus.PENDING, ReconciliationStatus.REQUIRES_REVIEW] } }
      }),
      prisma.billingWebhookEvent.count({
        where: { status: 'FAILED' }
      }),
      prisma.billingReconciliationRun.findFirst({
        orderBy: { startedAt: 'desc' },
        select: {
          id: true,
          status: true,
          completedAt: true,
          mismatchCount: true
        }
      })
    ]);

    const revenue30dMinorUnits: Record<string, number> = {};
    for (const p of recentPayments) {
      revenue30dMinorUnits[p.currency] = (revenue30dMinorUnits[p.currency] || 0) + p.amountMinorUnits;
    }

    const refunds30dMinorUnits: Record<string, number> = {};
    for (const r of recentRefunds) {
      refunds30dMinorUnits[r.currency] = (refunds30dMinorUnits[r.currency] || 0) + r.amountMinorUnits;
    }

    return {
      activeSubscriptions,
      pastDueSubscriptions,
      gracePeriodSubscriptions,
      cancellingSubscriptions,
      totalPaidUsers,
      revenue30dMinorUnits,
      refunds30dMinorUnits,
      pendingDiscrepancies,
      stuckWebhooksCount,
      latestReconciliationRun: latestRun ? {
        id: latestRun.id,
        status: latestRun.status,
        completedAt: latestRun.completedAt ? latestRun.completedAt.toISOString() : null,
        mismatchCount: latestRun.mismatchCount
      } : null
    };
  }

  /**
   * Lists customer subscriptions with bounded pagination, filters, and safe projection.
   */
  static async listSubscriptions(query: AdminSubscriptionListQuery): Promise<PaginatedResult<AdminSubscriptionSummary>> {
    const page = Math.max(1, query.page);
    const pageSize = Math.min(100, Math.max(1, query.pageSize));
    const skip = (page - 1) * pageSize;

    const where: Prisma.SubscriptionWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }
    if (query.planCode) {
      where.plan = { code: query.planCode };
    }
    if (query.currency) {
      where.currency = query.currency;
    }
    if (query.userId) {
      where.userId = query.userId;
    }
    if (query.cancelAtPeriodEnd !== undefined) {
      where.cancelAtPeriodEnd = query.cancelAtPeriodEnd;
    }
    if (query.search) {
      const search = query.search.trim();
      where.OR = [
        { user: { email: { contains: search } } },
        { user: { fullName: { contains: search } } },
        { providerSubscriptionId: { contains: search } }
      ];
    }

    const [total, items] = await Promise.all([
      prisma.subscription.count({ where }),
      prisma.subscription.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, email: true, fullName: true } },
          plan: { select: { id: true, code: true, name: true } }
        }
      })
    ]);

    const projected: AdminSubscriptionSummary[] = items.map((sub) => ({
      id: sub.id,
      userId: sub.userId,
      userEmail: sub.user.email,
      userFullName: sub.user.fullName,
      planId: sub.planId,
      planCode: sub.plan.code,
      planName: sub.plan.name,
      status: sub.status,
      billingInterval: sub.billingInterval,
      currency: sub.currency,
      amountMinorUnits: sub.amountMinorUnits,
      priceVersion: sub.priceVersion,
      currentPeriodStart: sub.currentPeriodStart.toISOString(),
      currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      cancelledAt: sub.cancelledAt ? sub.cancelledAt.toISOString() : null,
      gracePeriodStartedAt: sub.gracePeriodStartedAt ? sub.gracePeriodStartedAt.toISOString() : null,
      gracePeriodEndsAt: sub.gracePeriodEndsAt ? sub.gracePeriodEndsAt.toISOString() : null,
      expiredAt: sub.expiredAt ? sub.expiredAt.toISOString() : null,
      refundedAt: sub.refundedAt ? sub.refundedAt.toISOString() : null,
      provider: sub.provider,
      providerEnvironment: sub.providerEnvironment,
      providerSubscriptionId: sub.providerSubscriptionId,
      createdAt: sub.createdAt.toISOString(),
      updatedAt: sub.updatedAt.toISOString()
    }));

    return createPaginatedResponse(projected, total, page, pageSize);
  }

  /**
   * Retrieves single subscription detailed record including plan changes, payments, and reconciliations.
   */
  static async getSubscriptionDetail(subscriptionId: string): Promise<AdminSubscriptionDetail> {
    const sub = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            billingState: true
          }
        },
        plan: true,
        planPrice: true,
        payments: {
          take: 10,
          orderBy: { chargedAt: 'desc' },
          include: { receipt: { select: { id: true } } }
        },
        refunds: {
          take: 10,
          orderBy: { requestedAt: 'desc' }
        },
        planChanges: {
          take: 5,
          orderBy: { requestedAt: 'desc' },
          include: { fromPlan: true, toPlan: true }
        },
        upgradeReconciliations: {
          take: 5,
          orderBy: { checkedAt: 'desc' }
        }
      }
    });

    if (!sub) {
      throw new NotFoundError(`Subscription with ID '${subscriptionId}' not found`);
    }

    return {
      id: sub.id,
      userId: sub.userId,
      userEmail: sub.user.email,
      userFullName: sub.user.fullName,
      planId: sub.planId,
      planCode: sub.plan.code,
      planName: sub.plan.name,
      status: sub.status,
      billingInterval: sub.billingInterval,
      currency: sub.currency,
      amountMinorUnits: sub.amountMinorUnits,
      priceVersion: sub.priceVersion,
      currentPeriodStart: sub.currentPeriodStart.toISOString(),
      currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      cancelledAt: sub.cancelledAt ? sub.cancelledAt.toISOString() : null,
      gracePeriodStartedAt: sub.gracePeriodStartedAt ? sub.gracePeriodStartedAt.toISOString() : null,
      gracePeriodEndsAt: sub.gracePeriodEndsAt ? sub.gracePeriodEndsAt.toISOString() : null,
      expiredAt: sub.expiredAt ? sub.expiredAt.toISOString() : null,
      refundedAt: sub.refundedAt ? sub.refundedAt.toISOString() : null,
      provider: sub.provider,
      providerEnvironment: sub.providerEnvironment,
      providerSubscriptionId: sub.providerSubscriptionId,
      createdAt: sub.createdAt.toISOString(),
      updatedAt: sub.updatedAt.toISOString(),
      planDetails: {
        id: sub.plan.id,
        code: sub.plan.code,
        name: sub.plan.name,
        serverLimit: sub.plan.serverLimit,
        priorityRelay: sub.plan.priorityRelay,
        isActive: sub.plan.isActive
      },
      priceDetails: {
        id: sub.planPrice.id,
        currency: sub.planPrice.currency,
        amountMinorUnits: sub.planPrice.amountMinorUnits,
        effectiveFrom: sub.planPrice.effectiveFrom.toISOString(),
        effectiveTo: sub.planPrice.effectiveTo ? sub.planPrice.effectiveTo.toISOString() : null,
        version: sub.planPrice.version
      },
      userAccountBillingState: sub.user.billingState ? {
        status: sub.user.billingState.status,
        billingCountry: sub.user.billingState.billingCountry,
        billingPostalCode: sub.user.billingState.billingPostalCode,
        currency: sub.user.billingState.currency
      } : null,
      recentPayments: sub.payments.map(p => ({
        id: p.id,
        amountMinorUnits: p.amountMinorUnits,
        currency: p.currency,
        status: p.status,
        chargedAt: p.chargedAt.toISOString(),
        providerPaymentId: p.providerPaymentId,
        hasReceipt: Boolean(p.receipt)
      })),
      recentRefunds: sub.refunds.map(r => ({
        id: r.id,
        amountMinorUnits: r.amountMinorUnits,
        currency: r.currency,
        status: r.status,
        reason: r.reason,
        requestedAt: r.requestedAt.toISOString()
      })),
      recentPlanChanges: sub.planChanges.map(pc => ({
        id: pc.id,
        fromPlanCode: pc.fromPlan.code,
        toPlanCode: pc.toPlan.code,
        status: pc.status,
        creditMinorUnits: pc.creditMinorUnits,
        netAmountMinorUnits: pc.netAmountMinorUnits,
        requestedAt: pc.requestedAt.toISOString(),
        completedAt: pc.completedAt ? pc.completedAt.toISOString() : null
      })),
      upgradeReconciliations: sub.upgradeReconciliations.map(ur => ({
        id: ur.id,
        status: ur.status,
        expectedAmountMinorUnits: ur.expectedAmountMinorUnits,
        actualAmountMinorUnits: ur.actualAmountMinorUnits,
        checkedAt: ur.checkedAt.toISOString(),
        resolvedAt: ur.resolvedAt ? ur.resolvedAt.toISOString() : null,
        mismatchReason: ur.mismatchReason
      }))
    };
  }

  /**
   * Retrieves dunning operational triage information for a subscription.
   */
  static async getSubscriptionDunningState(subscriptionId: string): Promise<AdminSubscriptionDunningDetail> {
    const sub = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        user: { select: { id: true, email: true } },
        plan: { select: { code: true, name: true } },
        payments: {
          where: { status: PaymentStatus.FAILED },
          orderBy: { chargedAt: 'desc' },
          take: 5
        }
      }
    });

    if (!sub) {
      throw new NotFoundError(`Subscription with ID '${subscriptionId}' not found`);
    }

    const isInDunning = sub.status === BillingStatus.PAST_DUE || sub.status === BillingStatus.GRACE_PERIOD;
    const now = new Date();

    let gracePeriodDaysRemaining: number | null = null;
    if (sub.gracePeriodEndsAt) {
      const diffMs = sub.gracePeriodEndsAt.getTime() - now.getTime();
      gracePeriodDaysRemaining = Math.max(0, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
    }

    let milestones: number[] = [];
    if (Array.isArray(sub.dunningMilestones)) {
      milestones = (sub.dunningMilestones as any[]).map(m => Number(m));
    }

    const latestMilestone = milestones.length > 0 ? Math.max(...milestones) : null;

    let recommendedAction = 'Subscription is healthy and active.';
    if (sub.status === BillingStatus.GRACE_PERIOD) {
      recommendedAction = `Grace period active (${gracePeriodDaysRemaining ?? 0} days remaining). Automated retries scheduled. If unrecovered, subscription will expire on ${sub.gracePeriodEndsAt ? sub.gracePeriodEndsAt.toLocaleDateString('en-US') : 'period end'}.`;
    } else if (sub.status === BillingStatus.PAST_DUE) {
      recommendedAction = 'Renewal charge failed. Awaiting grace period trigger or manual customer retry.';
    } else if (sub.status === BillingStatus.CANCELLING) {
      recommendedAction = `Scheduled to cancel on ${sub.currentPeriodEnd.toLocaleDateString('en-US')}. Entitlements active until period end.`;
    } else if (sub.status === BillingStatus.EXPIRED) {
      recommendedAction = 'Subscription expired. Account reverted to Free tier.';
    }

    return {
      subscriptionId: sub.id,
      userId: sub.userId,
      userEmail: sub.user.email,
      status: sub.status,
      isInDunning,
      gracePeriodStartedAt: sub.gracePeriodStartedAt ? sub.gracePeriodStartedAt.toISOString() : null,
      gracePeriodEndsAt: sub.gracePeriodEndsAt ? sub.gracePeriodEndsAt.toISOString() : null,
      gracePeriodDaysTotal: 5,
      gracePeriodDaysRemaining,
      dunningMilestones: milestones,
      latestMilestone,
      dunningLastEvaluatedAt: sub.dunningLastEvaluatedAt ? sub.dunningLastEvaluatedAt.toISOString() : null,
      failedPaymentCount: sub.payments.length,
      recentFailedPayments: sub.payments.map(p => ({
        id: p.id,
        amountMinorUnits: p.amountMinorUnits,
        currency: p.currency,
        status: p.status,
        chargedAt: p.chargedAt.toISOString(),
        providerPaymentId: p.providerPaymentId
      })),
      entitlementConsequence: {
        currentEntitled: PAID_ENTITLED_STATUSES.has(sub.status),
        willExpireAt: sub.gracePeriodEndsAt ? sub.gracePeriodEndsAt.toISOString() : (sub.cancelAtPeriodEnd ? sub.currentPeriodEnd.toISOString() : null),
        afterExpirationPlan: 'FREE'
      },
      recommendedAction
    };
  }

  /**
   * Executes administrative subscription cancellation (either at period end or immediate).
   */
  static async cancelSubscription(
    subscriptionId: string,
    context: AdminOperationContext,
    options?: { mode?: 'PERIOD_END' | 'IMMEDIATE'; reason?: string }
  ): Promise<AdminCancelSubscriptionResult> {
    const sub = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true }
    });

    if (!sub) {
      throw new NotFoundError(`Subscription with ID '${subscriptionId}' not found`);
    }

    const mode = options?.mode || 'PERIOD_END';
    const reason = options?.reason && options.reason.trim().length > 0 ? options.reason.trim() : 'Administrative cancellation';

    if (sub.status === BillingStatus.EXPIRED || sub.status === BillingStatus.REFUNDED) {
      throw new ConflictError(`Cannot cancel subscription in terminal status '${sub.status}'`);
    }

    if (mode === 'PERIOD_END' && sub.status === BillingStatus.CANCELLING && sub.cancelAtPeriodEnd) {
      return {
        id: sub.id,
        userId: sub.userId,
        previousStatus: sub.status,
        newStatus: sub.status,
        cancelAtPeriodEnd: true,
        cancelledAt: (sub.cancelledAt || new Date()).toISOString(),
        currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
        mode,
        reason
      };
    }

    // Call Razorpay API cancellation if provider ID present and client configured
    if (sub.provider === PaymentProvider.RAZORPAY && sub.providerSubscriptionId) {
      const client = new RazorpayClient();
      if (client.isConfigured()) {
        try {
          const cancelAtCycleEnd = mode === 'PERIOD_END' ? 1 : 0;
          await client.cancelSubscription(sub.providerSubscriptionId, { cancel_at_cycle_end: cancelAtCycleEnd });
        } catch (providerErr: any) {
          console.warn('[AdminBillingService] Razorpay subscription cancel notice:', providerErr.message);
          if (!providerErr.message?.toLowerCase()?.includes('cancelled')) {
            throw providerErr;
          }
        }
      }
    }

    const now = new Date();
    const newStatus = mode === 'IMMEDIATE' ? BillingStatus.EXPIRED : BillingStatus.CANCELLING;
    const cancelAtPeriodEnd = mode === 'PERIOD_END';

    return executeAdminOperation({
      operationName: 'admin_subscription_cancel',
      targetResourceType: 'subscription',
      targetResourceId: subscriptionId,
      context,
      action: AdminAuditAction.ADMIN_STATUS_UPDATED,
      metadata: {
        subscriptionId,
        userId: sub.userId,
        previousStatus: sub.status,
        newStatus,
        mode,
        reason
      },
      execute: async (tx) => {
        const updated = await tx.subscription.update({
          where: { id: subscriptionId },
          data: {
            status: newStatus,
            cancelAtPeriodEnd,
            cancelledAt: now,
            expiredAt: mode === 'IMMEDIATE' ? now : undefined,
            updatedAt: now
          }
        });

        await tx.accountBillingState.update({
          where: { userId: sub.userId },
          data: {
            status: newStatus === BillingStatus.EXPIRED ? BillingStatus.FREE : BillingStatus.CANCELLING,
            activeSubscriptionId: newStatus === BillingStatus.EXPIRED ? null : undefined,
            updatedAt: now
          }
        });

        return {
          id: updated.id,
          userId: updated.userId,
          previousStatus: sub.status,
          newStatus: updated.status,
          cancelAtPeriodEnd: updated.cancelAtPeriodEnd,
          cancelledAt: (updated.cancelledAt || now).toISOString(),
          currentPeriodEnd: updated.currentPeriodEnd.toISOString(),
          mode,
          reason
        };
      }
    });
  }

  /**
   * Inspects live subscription state directly on payment provider (Razorpay).
   */
  static async inspectProviderSubscription(
    subscriptionId: string,
    context: AdminOperationContext
  ): Promise<AdminProviderSubscriptionInspectionResult> {
    const sub = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true }
    });

    if (!sub) {
      throw new NotFoundError(`Subscription with ID '${subscriptionId}' not found`);
    }

    const client = new RazorpayClient();
    const isConfigured = client.isConfigured();

    let providerData: any = null;
    const mismatches: string[] = [];
    let isMatched = true;
    let statusMatches = true;
    let periodMatches = true;

    if (isConfigured && sub.providerSubscriptionId) {
      try {
        providerData = await client.fetchSubscription(sub.providerSubscriptionId);

        if (providerData) {
          const provStatus = String(providerData.status || '').toUpperCase();
          const localStatus = String(sub.status).toUpperCase();

          if (provStatus === 'ACTIVE' && localStatus !== 'ACTIVE' && localStatus !== 'CANCELLING') {
            statusMatches = false;
            mismatches.push(`Status mismatch: Local is '${localStatus}' but Provider is '${provStatus}'`);
          } else if (provStatus === 'CANCELLED' && localStatus !== 'CANCELLING' && localStatus !== 'EXPIRED') {
            statusMatches = false;
            mismatches.push(`Status mismatch: Local is '${localStatus}' but Provider is '${provStatus}'`);
          }

          if (providerData.current_end) {
            const provEndDate = new Date(providerData.current_end * 1000);
            const diffDays = Math.abs((provEndDate.getTime() - sub.currentPeriodEnd.getTime()) / (24 * 60 * 60 * 1000));
            if (diffDays > 2) {
              periodMatches = false;
              mismatches.push(`Period end drift: Local ends ${sub.currentPeriodEnd.toISOString()} vs Provider ends ${provEndDate.toISOString()}`);
            }
          }
        }
      } catch (err: any) {
        mismatches.push(`Provider fetch error: ${err.message}`);
        isMatched = false;
      }
    } else if (!sub.providerSubscriptionId) {
      mismatches.push('No external providerSubscriptionId associated with this subscription');
    }

    isMatched = mismatches.length === 0;

    return {
      subscriptionId: sub.id,
      userId: sub.userId,
      provider: sub.provider,
      providerEnvironment: sub.providerEnvironment,
      providerSubscriptionId: sub.providerSubscriptionId,
      isConfigured,
      localState: {
        status: sub.status,
        planCode: sub.plan.code,
        currency: sub.currency,
        amountMinorUnits: sub.amountMinorUnits,
        currentPeriodStart: sub.currentPeriodStart.toISOString(),
        currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd
      },
      providerState: providerData ? {
        status: providerData.status,
        planId: providerData.plan_id,
        currentEnd: providerData.current_end ? new Date(providerData.current_end * 1000).toISOString() : null,
        endedAt: providerData.ended_at ? new Date(providerData.ended_at * 1000).toISOString() : null,
        chargeAt: providerData.charge_at ? new Date(providerData.charge_at * 1000).toISOString() : null,
        totalCount: providerData.total_count,
        paidCount: providerData.paid_count,
        remainingCount: providerData.remaining_count,
        shortUrl: providerData.short_url
      } : null,
      comparison: {
        isMatched,
        statusMatches,
        periodMatches,
        mismatches
      },
      inspectedAt: new Date().toISOString()
    };
  }

  /**
   * Lists payment transactions with filters and pagination.
   */
  static async listPayments(query: AdminPaymentListQuery): Promise<PaginatedResult<AdminPaymentSummary>> {
    const page = Math.max(1, query.page);
    const pageSize = Math.min(100, Math.max(1, query.pageSize));
    const skip = (page - 1) * pageSize;

    const where: Prisma.BillingPaymentWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }
    if (query.currency) {
      where.currency = query.currency;
    }
    if (query.userId) {
      where.userId = query.userId;
    }
    if (query.subscriptionId) {
      where.subscriptionId = query.subscriptionId;
    }
    if (query.providerPaymentId) {
      where.providerPaymentId = { contains: query.providerPaymentId.trim() };
    }
    if (query.startDate || query.endDate) {
      where.chargedAt = {};
      if (query.startDate) where.chargedAt.gte = new Date(query.startDate);
      if (query.endDate) where.chargedAt.lte = new Date(query.endDate);
    }
    if (query.search) {
      const search = query.search.trim();
      where.OR = [
        { user: { email: { contains: search } } },
        { user: { fullName: { contains: search } } },
        { providerPaymentId: { contains: search } },
        { providerSubscriptionId: { contains: search } }
      ];
    }

    const [total, items] = await Promise.all([
      prisma.billingPayment.count({ where }),
      prisma.billingPayment.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { chargedAt: 'desc' },
        include: {
          user: { select: { id: true, email: true, fullName: true } },
          subscription: { include: { plan: { select: { code: true } } } },
          receipt: { select: { receiptNumber: true } },
          tax: { select: { taxAmountMinorUnits: true } },
          processingFee: { select: { totalFeeMinorUnits: true } },
          refunds: { select: { amountMinorUnits: true, status: true } }
        }
      })
    ]);

    const projected: AdminPaymentSummary[] = items.map((p) => {
      const nonFailedRefunds = p.refunds.filter(r => r.status === RefundStatus.PROCESSED || r.status === RefundStatus.PROCESSING || r.status === RefundStatus.REQUESTED);
      const refundedAmount = nonFailedRefunds.reduce((sum, r) => sum + r.amountMinorUnits, 0);

      return {
        id: p.id,
        userId: p.userId,
        userEmail: p.user.email,
        userFullName: p.user.fullName,
        subscriptionId: p.subscriptionId,
        planCode: p.subscription?.plan?.code || null,
        amountMinorUnits: p.amountMinorUnits,
        currency: p.currency,
        status: p.status,
        chargedAt: p.chargedAt.toISOString(),
        provider: p.provider,
        providerEnvironment: p.environment,
        providerPaymentId: p.providerPaymentId,
        providerSubscriptionId: p.providerSubscriptionId,
        receiptNumber: p.receipt?.receiptNumber || null,
        totalTaxMinorUnits: p.tax?.taxAmountMinorUnits || null,
        totalFeeMinorUnits: p.processingFee?.totalFeeMinorUnits || null,
        refundCount: nonFailedRefunds.length,
        refundedAmountMinorUnits: refundedAmount,
        createdAt: p.createdAt.toISOString()
      };
    });

    return createPaginatedResponse(projected, total, page, pageSize);
  }

  /**
   * Retrieves single payment transaction details with receipt, taxes, fees, and refunds.
   */
  static async getPaymentDetail(paymentId: string): Promise<AdminPaymentDetail> {
    const p = await prisma.billingPayment.findUnique({
      where: { id: paymentId },
      include: {
        user: { select: { id: true, email: true, fullName: true } },
        subscription: { include: { plan: { select: { code: true } } } },
        receipt: true,
        tax: true,
        processingFee: true,
        refunds: {
          orderBy: { requestedAt: 'desc' }
        },
        reconciliationRecords: {
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!p) {
      throw new NotFoundError(`Payment with ID '${paymentId}' not found`);
    }

    const nonFailedRefunds = p.refunds.filter(r => r.status === RefundStatus.PROCESSED || r.status === RefundStatus.PROCESSING || r.status === RefundStatus.REQUESTED);
    const refundedAmount = nonFailedRefunds.reduce((sum, r) => sum + r.amountMinorUnits, 0);

    return {
      id: p.id,
      userId: p.userId,
      userEmail: p.user.email,
      userFullName: p.user.fullName,
      subscriptionId: p.subscriptionId,
      planCode: p.subscription?.plan?.code || null,
      amountMinorUnits: p.amountMinorUnits,
      currency: p.currency,
      status: p.status,
      chargedAt: p.chargedAt.toISOString(),
      provider: p.provider,
      providerEnvironment: p.environment,
      providerPaymentId: p.providerPaymentId,
      providerSubscriptionId: p.providerSubscriptionId,
      receiptNumber: p.receipt?.receiptNumber || null,
      totalTaxMinorUnits: p.tax?.taxAmountMinorUnits || null,
      totalFeeMinorUnits: p.processingFee?.totalFeeMinorUnits || null,
      refundCount: nonFailedRefunds.length,
      refundedAmountMinorUnits: refundedAmount,
      createdAt: p.createdAt.toISOString(),
      receipt: p.receipt ? {
        id: p.receipt.id,
        receiptNumber: p.receipt.receiptNumber,
        status: p.receipt.status,
        type: p.receipt.type,
        subtotalMinorUnits: p.receipt.subtotalMinorUnits,
        taxMinorUnits: p.receipt.taxMinorUnits,
        totalMinorUnits: p.receipt.totalMinorUnits,
        issuedAt: p.receipt.issuedAt.toISOString()
      } : null,
      tax: p.tax ? {
        id: p.tax.id,
        jurisdiction: p.tax.jurisdiction,
        taxType: p.tax.taxType,
        isInclusive: p.tax.isInclusive,
        taxRateBasisPoints: p.tax.taxRateBasisPoints,
        taxableAmountMinorUnits: p.tax.taxableAmountMinorUnits,
        taxAmountMinorUnits: p.tax.taxAmountMinorUnits,
        breakdown: p.tax.breakdown as Record<string, unknown> | null
      } : null,
      processingFee: p.processingFee ? {
        id: p.processingFee.id,
        feeAmountMinorUnits: p.processingFee.feeAmountMinorUnits,
        feeTaxMinorUnits: p.processingFee.feeTaxMinorUnits,
        totalFeeMinorUnits: p.processingFee.totalFeeMinorUnits,
        feeCurrency: p.processingFee.feeCurrency,
        netSettlementAmountMinorUnits: p.processingFee.netSettlementAmountMinorUnits,
        status: p.processingFee.status,
        source: p.processingFee.source
      } : null,
      refunds: p.refunds.map(r => ({
        id: r.id,
        amountMinorUnits: r.amountMinorUnits,
        currency: r.currency,
        reason: r.reason,
        status: r.status,
        requestedBy: r.requestedBy,
        requestedAt: r.requestedAt.toISOString(),
        providerRefundId: r.providerRefundId
      })),
      reconciliationRecords: p.reconciliationRecords.map(rec => ({
        id: rec.id,
        runId: rec.runId,
        status: rec.status,
        settled: rec.settled,
        settledAt: rec.settledAt ? rec.settledAt.toISOString() : null,
        providerFeeMinorUnits: rec.providerFeeMinorUnits
      }))
    };
  }

  /**
   * Lists customer refund transactions with filters and pagination.
   */
  static async listRefunds(query: AdminRefundListQuery): Promise<PaginatedResult<AdminRefundSummary>> {
    const page = Math.max(1, query.page);
    const pageSize = Math.min(100, Math.max(1, query.pageSize));
    const skip = (page - 1) * pageSize;

    const where: Prisma.BillingRefundWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }
    if (query.reason) {
      where.reason = query.reason;
    }
    if (query.userId) {
      where.userId = query.userId;
    }
    if (query.paymentId) {
      where.paymentId = query.paymentId;
    }
    if (query.providerRefundId) {
      where.providerRefundId = { contains: query.providerRefundId.trim() };
    }
    if (query.startDate || query.endDate) {
      where.requestedAt = {};
      if (query.startDate) where.requestedAt.gte = new Date(query.startDate);
      if (query.endDate) where.requestedAt.lte = new Date(query.endDate);
    }
    if (query.search) {
      const search = query.search.trim();
      where.OR = [
        { user: { email: { contains: search } } },
        { user: { fullName: { contains: search } } },
        { providerRefundId: { contains: search } },
        { providerPaymentId: { contains: search } }
      ];
    }

    const [total, items] = await Promise.all([
      prisma.billingRefund.count({ where }),
      prisma.billingRefund.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { requestedAt: 'desc' },
        include: {
          user: { select: { id: true, email: true, fullName: true } }
        }
      })
    ]);

    const projected: AdminRefundSummary[] = items.map((r) => ({
      id: r.id,
      userId: r.userId,
      userEmail: r.user.email,
      userFullName: r.user.fullName,
      paymentId: r.paymentId,
      subscriptionId: r.subscriptionId,
      amountMinorUnits: r.amountMinorUnits,
      currency: r.currency,
      reason: r.reason,
      reasonDetails: r.reasonDetails,
      status: r.status,
      requestedBy: r.requestedBy,
      requestedAt: r.requestedAt.toISOString(),
      providerRequestedAt: r.providerRequestedAt ? r.providerRequestedAt.toISOString() : null,
      providerProcessedAt: r.providerProcessedAt ? r.providerProcessedAt.toISOString() : null,
      providerRefundId: r.providerRefundId,
      providerPaymentId: r.providerPaymentId,
      failureCode: r.failureCode,
      failureReason: r.failureReason,
      createdAt: r.createdAt.toISOString()
    }));

    return createPaginatedResponse(projected, total, page, pageSize);
  }

  /**
   * Retrieves single refund record details.
   */
  static async getRefundDetail(refundId: string): Promise<AdminRefundDetail> {
    const r = await prisma.billingRefund.findUnique({
      where: { id: refundId },
      include: {
        user: { select: { id: true, email: true, fullName: true } },
        payment: {
          select: {
            id: true,
            amountMinorUnits: true,
            currency: true,
            status: true,
            chargedAt: true,
            providerPaymentId: true
          }
        },
        subscription: {
          select: {
            id: true,
            status: true,
            plan: { select: { code: true } }
          }
        },
        reconciliationRecords: {
          select: {
            id: true,
            status: true,
            providerRefundId: true
          }
        }
      }
    });

    if (!r) {
      throw new NotFoundError(`Refund with ID '${refundId}' not found`);
    }

    return {
      id: r.id,
      userId: r.userId,
      userEmail: r.user.email,
      userFullName: r.user.fullName,
      paymentId: r.paymentId,
      subscriptionId: r.subscriptionId,
      amountMinorUnits: r.amountMinorUnits,
      currency: r.currency,
      reason: r.reason,
      reasonDetails: r.reasonDetails,
      status: r.status,
      requestedBy: r.requestedBy,
      requestedAt: r.requestedAt.toISOString(),
      providerRequestedAt: r.providerRequestedAt ? r.providerRequestedAt.toISOString() : null,
      providerProcessedAt: r.providerProcessedAt ? r.providerProcessedAt.toISOString() : null,
      providerRefundId: r.providerRefundId,
      providerPaymentId: r.providerPaymentId,
      failureCode: r.failureCode,
      failureReason: r.failureReason,
      createdAt: r.createdAt.toISOString(),
      payment: {
        id: r.payment.id,
        amountMinorUnits: r.payment.amountMinorUnits,
        currency: r.payment.currency,
        status: r.payment.status,
        chargedAt: r.payment.chargedAt.toISOString(),
        providerPaymentId: r.payment.providerPaymentId
      },
      subscription: r.subscription ? {
        id: r.subscription.id,
        planCode: r.subscription.plan.code,
        status: r.subscription.status
      } : null,
      reconciliationRecords: r.reconciliationRecords
    };
  }

  /**
   * Lists reconciliation runs with pagination and filters.
   */
  static async listReconciliationRuns(query: AdminReconciliationRunListQuery): Promise<PaginatedResult<AdminReconciliationRunSummary>> {
    const page = Math.max(1, query.page);
    const pageSize = Math.min(100, Math.max(1, query.pageSize));
    const skip = (page - 1) * pageSize;

    const where: Prisma.BillingReconciliationRunWhereInput = {};

    if (query.status) where.status = query.status;
    if (query.provider) where.provider = query.provider;
    if (query.environment) where.environment = query.environment;
    if (query.startDate || query.endDate) {
      where.periodStart = {};
      if (query.startDate) where.periodStart.gte = new Date(query.startDate);
      if (query.endDate) where.periodStart.lte = new Date(query.endDate);
    }

    const [total, items] = await Promise.all([
      prisma.billingReconciliationRun.count({ where }),
      prisma.billingReconciliationRun.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { startedAt: 'desc' }
      })
    ]);

    const projected: AdminReconciliationRunSummary[] = items.map(run => ({
      id: run.id,
      provider: run.provider,
      environment: run.environment,
      periodStart: run.periodStart.toISOString(),
      periodEnd: run.periodEnd.toISOString(),
      status: run.status,
      totalRecords: run.totalRecords,
      paymentRecords: run.paymentRecords,
      refundRecords: run.refundRecords,
      transferRecords: run.transferRecords,
      adjustmentRecords: run.adjustmentRecords,
      matchedCount: run.matchedCount,
      mismatchCount: run.mismatchCount,
      reviewCount: run.reviewCount,
      duplicateCount: run.duplicateCount,
      failureCount: run.failureCount,
      durationMs: run.durationMs,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt ? run.completedAt.toISOString() : null,
      createdAt: run.createdAt.toISOString()
    }));

    return createPaginatedResponse(projected, total, page, pageSize);
  }

  /**
   * Lists reconciliation discrepancies with filters.
   */
  static async listDiscrepancies(query: AdminDiscrepancyListQuery): Promise<PaginatedResult<AdminReconciliationDiscrepancySummary>> {
    const page = Math.max(1, query.page);
    const pageSize = Math.min(100, Math.max(1, query.pageSize));
    const skip = (page - 1) * pageSize;

    const where: Prisma.BillingReconciliationDiscrepancyWhereInput = {};

    if (query.status) where.status = query.status;
    if (query.discrepancyType) where.discrepancyType = query.discrepancyType;
    if (query.entityType) where.entityType = query.entityType;
    if (query.runId) where.runId = query.runId;
    if (query.providerEntityId) where.providerEntityId = { contains: query.providerEntityId.trim() };

    const [total, items] = await Promise.all([
      prisma.billingReconciliationDiscrepancy.count({ where }),
      prisma.billingReconciliationDiscrepancy.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' }
      })
    ]);

    const projected: AdminReconciliationDiscrepancySummary[] = items.map(disc => ({
      id: disc.id,
      runId: disc.runId,
      provider: disc.provider,
      entityType: disc.entityType,
      providerEntityId: disc.providerEntityId,
      internalEntityId: disc.internalEntityId,
      discrepancyType: disc.discrepancyType,
      status: disc.status,
      expectedValue: disc.expectedValue,
      actualValue: disc.actualValue,
      resolutionReason: disc.resolutionReason,
      resolvedBy: disc.resolvedBy,
      resolvedAt: disc.resolvedAt ? disc.resolvedAt.toISOString() : null,
      createdAt: disc.createdAt.toISOString(),
      updatedAt: disc.updatedAt.toISOString()
    }));

    return createPaginatedResponse(projected, total, page, pageSize);
  }

  /**
   * Lists plan catalog offerings with active subscriber counts.
   */
  static async listPlans(query: AdminPlanListQuery): Promise<PaginatedResult<AdminPlanSummary>> {
    const page = Math.max(1, query.page);
    const pageSize = Math.min(100, Math.max(1, query.pageSize));
    const skip = (page - 1) * pageSize;

    const where: Prisma.PlanWhereInput = {};

    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    const [total, items] = await Promise.all([
      prisma.plan.count({ where }),
      prisma.plan.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { code: 'asc' },
        include: {
          prices: { orderBy: { version: 'desc' } },
          entitlements: { include: { entitlementDefinition: true } },
          _count: {
            select: {
              subscriptions: {
                where: { status: { in: [BillingStatus.ACTIVE, BillingStatus.PAST_DUE, BillingStatus.GRACE_PERIOD, BillingStatus.CANCELLING] } }
              }
            }
          }
        }
      })
    ]);

    const projected: AdminPlanSummary[] = items.map(p => ({
      id: p.id,
      code: p.code,
      name: p.name,
      description: p.description,
      interval: p.interval,
      intervalCount: p.intervalCount,
      serverLimit: p.serverLimit,
      priorityRelay: p.priorityRelay,
      isActive: p.isActive,
      prices: p.prices.map(pr => ({
        id: pr.id,
        currency: pr.currency,
        amountMinorUnits: pr.amountMinorUnits,
        effectiveFrom: pr.effectiveFrom.toISOString(),
        effectiveTo: pr.effectiveTo ? pr.effectiveTo.toISOString() : null,
        isActive: pr.isActive,
        version: pr.version
      })),
      entitlements: p.entitlements.map(e => ({
        code: e.entitlementDefinition.code,
        name: e.entitlementDefinition.name,
        intValue: e.intValue,
        boolValue: e.boolValue
      })),
      activeSubscriberCount: p._count.subscriptions,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString()
    }));

    return createPaginatedResponse(projected, total, page, pageSize);
  }
}
