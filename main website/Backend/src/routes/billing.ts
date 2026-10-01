import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  ReconciliationStatus,
  ReconciliationRunStatus,
  ReconciliationEntityType,
  ReconciliationDiscrepancyType,
  WebhookEventStatus,
  AuditEventType
} from '@prisma/client';
import { prisma } from '../config/database.js';
import { UnauthorizedError, ValidationError } from '../errors/app-error.js';
import { BillingStateService } from '../services/billing/billing_state_service.js';
import { BillingRefundService } from '../services/billing/billing_refund_service.js';
import { BillingReceiptService } from '../services/billing/billing_receipt_service.js';
import { BillingReconciliationService, billingReconciliationService } from '../services/billing/billing_reconciliation_service.js';
import { EntitlementService } from '../services/billing/entitlement_service.js';
import { RazorpayCheckoutService, RazorpayWebhookService } from '../services/billing/providers/razorpay/index.js';
import { createSuccessResponse } from '../schemas/response.js';
import { adminAuthenticate } from '../middleware/admin-auth.js';
import { requirePermission } from '../middleware/admin-rbac.js';
import { hashSessionToken } from '../utils/crypto.js';

// Helper: Extract authenticated user from Bearer token
async function getAuthUser(request: FastifyRequest) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or invalid Authorization Bearer header');
  }

  const token = authHeader.substring(7).trim();
  const tokenHash = hashSessionToken(token);
  const session = await prisma.userSession.findFirst({
    where: { tokenHash, expiresAt: { gt: new Date() } },
    include: { user: true }
  });

  if (!session || !session.user) {
    throw new UnauthorizedError('Session expired or invalid token');
  }

  return session.user;
}

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/billing
   * Authenticated, IDOR-safe endpoint returning the current user's authoritative billing state,
   * active subscription summary, and resolved technical entitlements.
   */
  app.get('/billing', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);

    // 1. Authoritatively resolve effective plan and billing state from database
    const effective = await BillingStateService.getEffectivePlan(user.id);

    // 2. Authoritatively resolve technical capabilities for the effective plan
    const entitlements = await EntitlementService.resolvePlanEntitlements(effective.planCode);

    // 3. Format safe subscription summary (without internal provider secrets)
    const subscriptionSummary = effective.subscription
      ? {
          id: effective.subscription.id,
          planCode: effective.subscription.plan.code,
          planName: effective.subscription.plan.name,
          status: effective.subscription.status,
          billingInterval: effective.subscription.billingInterval,
          currency: effective.subscription.currency,
          amountMinorUnits: effective.subscription.amountMinorUnits,
          priceVersion: effective.subscription.priceVersion,
          currentPeriodStart: effective.subscription.currentPeriodStart,
          currentPeriodEnd: effective.subscription.currentPeriodEnd,
          cancelAtPeriodEnd: effective.subscription.cancelAtPeriodEnd,
          cancelledAt: effective.subscription.cancelledAt,
          gracePeriodStartedAt: effective.subscription.gracePeriodStartedAt,
          gracePeriodEndsAt: effective.subscription.gracePeriodEndsAt,
          expiredAt: effective.subscription.expiredAt,
          refundedAt: effective.subscription.refundedAt
        }
      : null;

    return createSuccessResponse({
      status: effective.status,
      plan: effective.planCode,
      currency: effective.currency,
      billingCountry: effective.billingCountry,
      billingPostalCode: effective.billingPostalCode,
      countryConfirmed: Boolean(effective.billingCountry),
      subscription: subscriptionSummary,
      entitlements: {
        maxServers: entitlements.maxServers,
        priorityRelay: entitlements.priorityRelay,
        ...entitlements.entitlements
      }
    });
  });

  /**
   * Handler for confirming billing country and postal code.
   * Enforces authentication, IDOR protection, mass assignment safety, ISO alpha-2 validation,
   * and authoritative server-side currency derivation.
   */
  const confirmCountryHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const body = request.body as Record<string, unknown> | undefined;

    if (!body || typeof body !== 'object') {
      throw new ValidationError('Request body is required');
    }

    const { country, postalCode } = body;

    if (!country) {
      throw new ValidationError('Billing country is required');
    }

    if (!postalCode) {
      throw new ValidationError('Billing postal code is required');
    }

    const result = await BillingStateService.confirmBillingCountry(user.id, {
      country: String(country),
      postalCode: String(postalCode)
    });

    return createSuccessResponse({
      billingCountry: result.billingCountry,
      billingPostalCode: result.billingPostalCode,
      currency: result.currency,
      countryConfirmed: result.countryConfirmed
    });
  };

  /**
   * PUT /api/v1/billing/country
   * Authenticated endpoint to confirm or update customer billing country and postal code.
   */
  app.put('/billing/country', confirmCountryHandler);

  /**
   * PATCH /api/v1/billing
   * Convenience alias for partial billing state updates (confirming billing country).
   */
  app.patch('/billing', confirmCountryHandler);

  /**
   * POST /api/v1/billing/checkout/session
   * Authenticated endpoint to initialize a secure Razorpay checkout session and Subscription.
   * Rate limited to prevent checkout creation flooding.
   */
  app.post(
    '/billing/checkout/session',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute'
        }
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await getAuthUser(request);
      const body = request.body as Record<string, unknown> | undefined;

      if (!body || typeof body !== 'object') {
        throw new ValidationError('Request body is required');
      }

      const { planCode } = body;

      if (!planCode || typeof planCode !== 'string') {
        throw new ValidationError('planCode is required');
      }

      const result = await RazorpayCheckoutService.createCheckoutSession(user.id, {
        planCode: String(planCode)
      });

      return createSuccessResponse(result);
    }
  );

  /**
   * GET /api/v1/billing/checkout/price-breakdown
   * Authenticated endpoint to retrieve authoritative checkout price breakdown prior to payment modal.
   * Rate limited to prevent scraping/flooding.
   */
  app.get(
    '/billing/checkout/price-breakdown',
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute'
        }
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await getAuthUser(request);
      const query = request.query as Record<string, unknown> | undefined;
      const planCode = query?.planCode;

      if (!planCode || typeof planCode !== 'string') {
        throw new ValidationError('planCode query parameter is required');
      }

      const result = await RazorpayCheckoutService.getPriceBreakdown(user.id, String(planCode));
      return createSuccessResponse(result);
    }
  );

  /**
   * POST /api/v1/billing/checkout/verify
   * Authenticated endpoint to verify Razorpay checkout payment signature and confirm subscription activation.
   */
  app.post(
    '/billing/checkout/verify',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute'
        }
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await getAuthUser(request);
      const body = request.body as Record<string, unknown> | undefined;

      if (!body || typeof body !== 'object') {
        throw new ValidationError('Request body is required');
      }

      const { paymentId, subscriptionId, signature } = body;

      if (!paymentId || typeof paymentId !== 'string') {
        throw new ValidationError('paymentId is required');
      }

      if (!subscriptionId || typeof subscriptionId !== 'string') {
        throw new ValidationError('subscriptionId is required');
      }

      if (!signature || typeof signature !== 'string') {
        throw new ValidationError('signature is required');
      }

      const result = await RazorpayCheckoutService.verifyCheckoutPayment(user.id, {
        paymentId: String(paymentId),
        subscriptionId: String(subscriptionId),
        signature: String(signature)
      });

      return createSuccessResponse(result);
    }
  );

  /**
   * POST /api/v1/billing/webhooks/razorpay
   * Unauthenticated webhook receiver for Razorpay subscription events.
   * Authentication is enforced via raw-body HMAC-SHA256 signature verification.
   */
  /**
   * POST /api/v1/billing/subscription/cancel
   * Authenticated, IDOR-safe endpoint to schedule subscription cancellation at the end of the paid billing period.
   * Derives user identity strictly from authenticated session token.
   */
  const cancelSubscriptionHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const body = request.body as Record<string, unknown> | undefined;
    const reason = body?.reason && typeof body.reason === 'string' ? body.reason : undefined;

    const result = await BillingStateService.requestSubscriptionCancellation(user.id, { reason });

    return createSuccessResponse({
      status: result.status,
      cancelAtPeriodEnd: result.cancelAtPeriodEnd,
      cancelledAt: result.cancelledAt,
      currentPeriodEnd: result.currentPeriodEnd,
      planCode: result.plan.code,
      planName: result.plan.name
    });
  };

  app.post('/billing/subscription/cancel', cancelSubscriptionHandler);
  app.post('/billing/cancel', cancelSubscriptionHandler);

  /**
   * POST /api/v1/billing/subscription/cancel/undo
   * Authenticated, IDOR-safe endpoint to reverse a scheduled subscription cancellation before the paid period ends.
   * Derives user identity strictly from authenticated session token.
   */
  const undoCancelSubscriptionHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const body = request.body as Record<string, unknown> | undefined;
    const reason = body?.reason && typeof body.reason === 'string' ? body.reason : undefined;

    const result = await BillingStateService.undoSubscriptionCancellation(user.id, { reason });

    return createSuccessResponse({
      status: result.status,
      cancelAtPeriodEnd: result.cancelAtPeriodEnd,
      cancelledAt: result.cancelledAt,
      currentPeriodEnd: result.currentPeriodEnd,
      planCode: result.plan.code,
      planName: result.plan.name
    });
  };

  app.post('/billing/subscription/cancel/undo', undoCancelSubscriptionHandler);
  app.post('/billing/cancel/undo', undoCancelSubscriptionHandler);

  /**
   * POST /api/v1/billing/subscription/upgrade
   * Authenticated, IDOR-safe endpoint to upgrade an active Pro Monthly subscription to Pro Yearly with proration credit.
   * Derives user identity strictly from authenticated session token.
   */
  const upgradeSubscriptionHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const body = request.body as Record<string, unknown> | undefined;
    const targetPlanCode = body?.targetPlanCode && typeof body.targetPlanCode === 'string' ? body.targetPlanCode : 'PRO_YEARLY';

    const result = await BillingStateService.upgradeSubscription(user.id, { targetPlanCode });

    return createSuccessResponse(result);
  };

  app.post('/billing/subscription/upgrade', upgradeSubscriptionHandler);
  app.post('/billing/upgrade', upgradeSubscriptionHandler);

  /**
   * POST /api/v1/billing/subscription/downgrade
   * Authenticated endpoint to schedule a Pro Yearly -> Pro Monthly subscription downgrade at the end of the billing cycle.
   */
  const downgradeSubscriptionHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const body = request.body as Record<string, unknown> | undefined;
    const targetPlanCode = body?.targetPlanCode && typeof body.targetPlanCode === 'string' ? body.targetPlanCode : 'PRO_MONTHLY';

    const result = await BillingStateService.downgradeSubscription(user.id, { targetPlanCode });

    return createSuccessResponse(result);
  };

  app.post('/billing/subscription/downgrade', downgradeSubscriptionHandler);
  app.post('/billing/downgrade', downgradeSubscriptionHandler);

  /**
   * POST /api/v1/billing/subscription/downgrade/cancel
   * Authenticated endpoint to cancel a scheduled subscription downgrade before it becomes effective.
   */
  const cancelDowngradeSubscriptionHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);

    const result = await BillingStateService.cancelPendingDowngrade(user.id);

    return createSuccessResponse(result);
  };

  app.post('/billing/subscription/downgrade/cancel', cancelDowngradeSubscriptionHandler);
  app.post('/billing/downgrade/cancel', cancelDowngradeSubscriptionHandler);

  /**
   * POST /api/v1/billing/refunds
   * Authenticated, IDOR-safe endpoint to request a refund for a payment.
   */
  const requestRefundHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const body = request.body as Record<string, unknown> | undefined;

    if (!body || !body.paymentId || typeof body.paymentId !== 'string') {
      throw new ValidationError('paymentId is required');
    }

    const amountMinorUnits = typeof body.amountMinorUnits === 'number' ? Math.floor(body.amountMinorUnits) : undefined;
    const reason = body.reason as any;
    const reasonDetails = typeof body.reasonDetails === 'string' ? body.reasonDetails : undefined;
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined;
    const terminateSubscription = Boolean(body.terminateSubscription);

    const result = await BillingRefundService.requestRefund(user.id, {
      paymentId: body.paymentId,
      amountMinorUnits,
      reason,
      reasonDetails,
      idempotencyKey,
      terminateSubscription
    });

    return createSuccessResponse(result);
  };

  app.post('/billing/refunds', requestRefundHandler);
  app.post('/billing/refund', requestRefundHandler);

  /**
   * GET /api/v1/billing/refunds/:id
   * Authenticated, IDOR-safe endpoint to retrieve a refund record.
   */
  const getRefundHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const { id } = request.params as { id: string };

    const refund = await BillingRefundService.getRefund(user.id, id);

    return createSuccessResponse(refund);
  };

  app.get('/billing/refunds/:id', getRefundHandler);

  /**
   * GET /api/v1/billing/payments/:id/refunds
   * Authenticated, IDOR-safe endpoint to retrieve all refunds for a payment.
   */
  const getPaymentRefundsHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const { id } = request.params as { id: string };

    const refunds = await BillingRefundService.getPaymentRefunds(user.id, id);

    return createSuccessResponse(refunds);
  };

  app.get('/billing/payments/:id/refunds', getPaymentRefundsHandler);

  /**
   * GET /api/v1/billing/receipts
   * Lists customer's billing receipts.
   */
  const listReceiptsHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const query = request.query as { page?: string; limit?: string } | undefined;
    const page = query?.page ? parseInt(query.page, 10) : 1;
    const limit = query?.limit ? parseInt(query.limit, 10) : 20;

    const result = await BillingReceiptService.listCustomerReceipts(user.id, { page, limit });
    return createSuccessResponse(result);
  };

  app.get('/billing/receipts', listReceiptsHandler);

  /**
   * GET /api/v1/billing/receipts/:id
   * Retrieves single billing receipt metadata.
   */
  const getReceiptHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const { id } = request.params as { id: string };

    const receipt = await BillingReceiptService.getReceipt(user.id, id);
    return createSuccessResponse(receipt);
  };

  app.get('/billing/receipts/:id', getReceiptHandler);

  /**
   * GET /api/v1/billing/receipts/:id/html
   * Returns rendered HTML of the billing receipt for browser viewing.
   */
  const getReceiptHtmlHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const { id } = request.params as { id: string };

    const receipt = await BillingReceiptService.getReceipt(user.id, id);
    const html = BillingReceiptService.renderReceiptHtml(receipt);

    reply.type('text/html; charset=utf-8');
    return reply.send(html);
  };

  app.get('/billing/receipts/:id/html', getReceiptHtmlHandler);

  /**
   * GET /api/v1/billing/receipts/:id/download
   * Returns rendered HTML document as a downloadable file attachment.
   */
  const downloadReceiptHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const { id } = request.params as { id: string };

    const receipt = await BillingReceiptService.getReceipt(user.id, id);
    const html = BillingReceiptService.renderReceiptHtml(receipt);

    try {
      await prisma.auditEvent.create({
        data: {
          userId: user.id,
          eventType: 'BILLING_RECEIPT_DOWNLOAD_REQUESTED' as any,
          metadata: {
            receiptId: receipt.id,
            receiptNumber: receipt.receiptNumber
          }
        }
      });
    } catch {
      // Non-blocking
    }

    reply.header('Content-Disposition', `attachment; filename="receipt-${receipt.receiptNumber}.html"`);
    reply.type('text/html; charset=utf-8');
    return reply.send(html);
  };

  app.get('/billing/receipts/:id/download', downloadReceiptHandler);

  /**
   * GET /api/v1/billing/payments/:id/receipt
   * Retrieves billing receipt by payment ID.
   */
  const getPaymentReceiptHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const { id } = request.params as { id: string };

    const receipt = await BillingReceiptService.getReceiptByPayment(user.id, id);
    return createSuccessResponse(receipt);
  };

  app.get('/billing/payments/:id/receipt', getPaymentReceiptHandler);

  app.post('/billing/webhooks/razorpay', async (request: FastifyRequest, reply: FastifyReply) => {
    const signature = (request.headers['x-razorpay-signature'] || request.headers['X-Razorpay-Signature']) as string | undefined;
    const eventIdHeader = (request.headers['x-razorpay-event-id'] || request.headers['X-Razorpay-Event-Id']) as string | undefined;
    const rawBody = (request as any).rawBody || JSON.stringify(request.body || {});

    const result = await RazorpayWebhookService.handleWebhook(
      rawBody,
      signature,
      eventIdHeader,
      request.body,
      { logger: request.log }
    );

    return createSuccessResponse(result);
  });

  /**
   * POST /api/v1/billing/operations/reconcile
   * Internal/Admin operational endpoint to trigger drift reconciliation for the account or specified subscription.
   * Enforces administrative authentication and 'billing.reconcile' RBAC permission.
   * Safe server-side bounds on lookback range (max 90 days).
   */
  app.post(
    '/billing/operations/reconcile',
    {
      preHandler: [adminAuthenticate, requirePermission('billing.reconcile')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const admin = request.admin!;
      const body = request.body as Record<string, unknown> | undefined;

      const subscriptionId = body?.subscriptionId ? String(body.subscriptionId) : undefined;
      const autoRepair = body?.autoRepair !== undefined ? Boolean(body.autoRepair) : true;
      const providerSubscriptionData = body?.providerSubscriptionData as any;
      const targetUserId = body?.userId ? String(body.userId) : undefined;

      if (body?.lookbackDays !== undefined) {
        const lookback = Number(body.lookbackDays);
        if (isNaN(lookback) || lookback < 1) {
          throw new ValidationError('lookbackDays must be a positive integer');
        }
        if (lookback > 90) {
          throw new ValidationError('lookbackDays cannot exceed 90 days to prevent unbounded provider API calls');
        }
      }

      try {
        await prisma.auditEvent.create({
          data: {
            userId: targetUserId,
            eventType: AuditEventType.BILLING_RECONCILIATION_STARTED,
            metadata: {
              triggeredByAdminId: admin.id,
              adminEmail: admin.email,
              autoRepair,
              subscriptionId,
              targetUserId,
              lookbackDays: body?.lookbackDays ? Number(body.lookbackDays) : 3
            }
          }
        });
      } catch {
        // Non-blocking
      }

      const result = await billingReconciliationService.reconcileSubscriptionDrift({
        userId: targetUserId,
        subscriptionId,
        autoRepair,
        providerSubscriptionData
      });

      return createSuccessResponse(result);
    }
  );

  /**
   * GET /api/v1/billing/operations/drift
   * Internal/Admin operational endpoint to inspect drift findings (read-only without auto-repair).
   * Enforces administrative authentication and 'billing.read' RBAC permission.
   */
  app.get(
    '/billing/operations/drift',
    {
      preHandler: [adminAuthenticate, requirePermission('billing.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as Record<string, unknown> | undefined;
      const targetUserId = query?.userId ? String(query.userId) : undefined;
      const subscriptionId = query?.subscriptionId ? String(query.subscriptionId) : undefined;

      const result = await billingReconciliationService.reconcileSubscriptionDrift({
        userId: targetUserId,
        subscriptionId,
        autoRepair: false
      });

      return createSuccessResponse(result);
    }
  );

  /**
   * GET /api/v1/billing/operations/metrics
   * Internal/Admin operational endpoint to retrieve reconciliation metrics and pending discrepancy counts.
   * Enforces administrative authentication and 'billing.read' RBAC permission.
   */
  app.get(
    '/billing/operations/metrics',
    {
      preHandler: [adminAuthenticate, requirePermission('billing.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const metrics = await billingReconciliationService.getReconciliationMetrics();
      return createSuccessResponse(metrics);
    }
  );

  /**
   * GET /api/v1/billing/operations/runs
   * Internal/Admin operational endpoint to list paginated reconciliation runs with status & date filters.
   * Enforces administrative authentication and 'billing.read' RBAC permission.
   */
  app.get(
    '/billing/operations/runs',
    {
      preHandler: [adminAuthenticate, requirePermission('billing.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as Record<string, unknown> | undefined;

      const page = query?.page ? Number(query.page) : 1;
      const limit = query?.limit ? Number(query.limit) : 20;
      const status = query?.status as ReconciliationRunStatus | undefined;
      const startDate = query?.startDate ? new Date(String(query.startDate)) : undefined;
      const endDate = query?.endDate ? new Date(String(query.endDate)) : undefined;

      const result = await billingReconciliationService.getReconciliationRuns({
        page,
        limit,
        status,
        startDate,
        endDate
      });

      return createSuccessResponse(result);
    }
  );

  /**
   * GET /api/v1/billing/operations/discrepancies
   * Internal/Admin operational endpoint to list paginated reconciliation discrepancies with granular filters.
   * Enforces administrative authentication and 'billing.read' RBAC permission.
   */
  app.get(
    '/billing/operations/discrepancies',
    {
      preHandler: [adminAuthenticate, requirePermission('billing.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as Record<string, unknown> | undefined;

      const page = query?.page ? Number(query.page) : 1;
      const limit = query?.limit ? Number(query.limit) : 20;
      const status = query?.status as ReconciliationStatus | undefined;
      const entityType = query?.entityType as ReconciliationEntityType | undefined;
      const discrepancyType = query?.discrepancyType as ReconciliationDiscrepancyType | undefined;
      const runId = query?.runId ? String(query.runId) : undefined;

      const result = await billingReconciliationService.getDiscrepancies({
        page,
        limit,
        status,
        entityType,
        discrepancyType,
        runId
      });

      return createSuccessResponse(result);
    }
  );

  /**
   * GET /api/v1/billing/operations/discrepancies/:id
   * Internal/Admin operational endpoint to inspect a single reconciliation discrepancy in detail.
   * Enforces administrative authentication and 'billing.read' RBAC permission.
   */
  app.get(
    '/billing/operations/discrepancies/:id',
    {
      preHandler: [adminAuthenticate, requirePermission('billing.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const result = await billingReconciliationService.getDiscrepancyById(id);
      return createSuccessResponse(result);
    }
  );

  /**
   * PATCH /api/v1/billing/operations/discrepancies/:id
   * Internal/Admin operational endpoint to resolve or dismiss a discrepancy record with audit trail.
   * Enforces administrative authentication and 'billing.reconcile' RBAC permission.
   */
  app.patch(
    '/billing/operations/discrepancies/:id',
    {
      preHandler: [adminAuthenticate, requirePermission('billing.reconcile')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const admin = request.admin!;
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown> | undefined;

      if (!body || !body.status || !body.resolutionReason) {
        throw new ValidationError('Both status and resolutionReason are required');
      }

      const result = await billingReconciliationService.updateDiscrepancyStatus(id, {
        status: body.status as ReconciliationStatus,
        resolutionReason: String(body.resolutionReason),
        operatorUserId: admin.id
      });

      return createSuccessResponse(result);
    }
  );

  /**
   * GET /api/v1/billing/operations/webhooks
   * Internal/Admin operational endpoint to inspect paginated webhook event ledger for stuck/failed event diagnosis.
   * Enforces administrative authentication and 'billing.read' RBAC permission.
   */
  app.get(
    '/billing/operations/webhooks',
    {
      preHandler: [adminAuthenticate, requirePermission('billing.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as Record<string, unknown> | undefined;

      const page = query?.page ? Number(query.page) : 1;
      const limit = query?.limit ? Number(query.limit) : 20;
      const status = query?.status as WebhookEventStatus | undefined;
      const eventType = query?.eventType ? String(query.eventType) : undefined;

      const result = await billingReconciliationService.getWebhookEvents({
        page,
        limit,
        status,
        eventType
      });

      return createSuccessResponse(result);
    }
  );

  /**
   * GET /api/v1/billing/operations/webhooks/health
   * Internal/Admin operational endpoint to check webhook pipeline health, stuck events, and processing latency.
   * Enforces administrative authentication and 'billing.read' RBAC permission.
   */
  app.get(
    '/billing/operations/webhooks/health',
    {
      preHandler: [adminAuthenticate, requirePermission('billing.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const health = await RazorpayWebhookService.getWebhookProcessingHealth();
      return createSuccessResponse(health);
    }
  );

  /**
   * POST /api/v1/billing/operations/webhooks/replay
   * Internal/Admin operational endpoint to safely replay a verified webhook event.
   * Enforces administrative authentication and 'billing.reconcile' RBAC permission.
   */
  app.post(
    '/billing/operations/webhooks/replay',
    {
      preHandler: [adminAuthenticate, requirePermission('billing.reconcile')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const admin = request.admin!;
      const body = request.body as Record<string, unknown> | undefined;

      if (!body || !body.providerEventId || typeof body.providerEventId !== 'string') {
        throw new ValidationError('providerEventId is required for webhook replay');
      }

      const result = await RazorpayWebhookService.replayWebhookEvent(String(body.providerEventId), {
        payload: body.payload,
        actorUserId: admin.id
      });

      return createSuccessResponse(result);
    }
  );
}





