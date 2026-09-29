import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { adminAuthenticate } from '../../../../middleware/admin-auth.js';
import { requireOperationPermission } from '../middleware/require_operation_permission.js';
import { createSuccessResponse } from '../../../../schemas/response.js';
import { ValidationError } from '../../../../errors/app-error.js';
import { AdminBillingService } from './service.js';
import {
  AdminSubscriptionListQuerySchema,
  AdminPaymentListQuerySchema,
  AdminRefundListQuerySchema,
  AdminReconciliationRunListQuerySchema,
  AdminDiscrepancyListQuerySchema,
  AdminPlanListQuerySchema,
  AdminCancelSubscriptionSchema,
  AdminExecuteRefundSchema
} from './schemas.js';

export * from './types.js';
export * from './schemas.js';
export * from './service.js';

export async function adminBillingOperationsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/admin/operations/billing/overview
   * Returns operational summary metrics for subscriptions, payments, discrepancies, and reconciliation state.
   * Permission required: 'billing.read'
   */
  app.get(
    '/admin/operations/billing/overview',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('billing.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const overview = await AdminBillingService.getBillingOverview();
      return reply.status(200).send(createSuccessResponse(overview));
    }
  );

  /**
   * GET /api/v1/admin/operations/billing/subscriptions
   * Lists customer subscriptions with filters and bounded pagination.
   * Permission required: 'billing.read'
   */
  app.get(
    '/admin/operations/billing/subscriptions',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('billing.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = AdminSubscriptionListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid subscription query parameters');
      }

      const result = await AdminBillingService.listSubscriptions(parsed.data);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/operations/billing/subscriptions/:id
   * Inspects detailed state of a single customer subscription.
   * Permission required: 'billing.read'
   */
  app.get(
    '/admin/operations/billing/subscriptions/:id',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('billing.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      if (!id || typeof id !== 'string') {
        throw new ValidationError('Subscription ID is required');
      }

      const result = await AdminBillingService.getSubscriptionDetail(id);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/operations/billing/subscriptions/:id/dunning
   * Retrieves dunning operational triage metrics, grace period countdown, and failed payment details.
   * Permission required: 'billing.read'
   */
  app.get(
    '/admin/operations/billing/subscriptions/:id/dunning',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('billing.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      if (!id || typeof id !== 'string') {
        throw new ValidationError('Subscription ID is required');
      }

      const result = await AdminBillingService.getSubscriptionDunningState(id);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/operations/billing/subscriptions/:id/provider-sync
   * Inspects live payment provider (Razorpay) subscription state and reports drift against local DB.
   * Permission required: 'billing.read'
   */
  app.get(
    '/admin/operations/billing/subscriptions/:id/provider-sync',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('billing.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      if (!id || typeof id !== 'string') {
        throw new ValidationError('Subscription ID is required');
      }

      const context = (request as any).adminOperationContext;
      const result = await AdminBillingService.inspectProviderSubscription(id, context);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * POST /api/v1/admin/operations/billing/subscriptions/:id/cancel
   * Executes administrative subscription cancellation (either at period end or immediate).
   * Permission required: 'billing.write'
   */
  app.post(
    '/admin/operations/billing/subscriptions/:id/cancel',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('billing.write')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      if (!id || typeof id !== 'string') {
        throw new ValidationError('Subscription ID is required');
      }

      const parsed = AdminCancelSubscriptionSchema.safeParse(request.body || {});
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid cancellation parameters');
      }

      const context = (request as any).adminOperationContext;
      const result = await AdminBillingService.cancelSubscription(id, context, parsed.data);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/operations/billing/payments
   * Lists customer payment transactions with filters and bounded pagination.
   * Permission required: 'billing.read'
   */
  app.get(
    '/admin/operations/billing/payments',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('billing.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = AdminPaymentListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid payment query parameters');
      }

      const result = await AdminBillingService.listPayments(parsed.data);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/operations/billing/payments/:id
   * Inspects detailed state of a single customer payment transaction.
   * Permission required: 'billing.read'
   */
  app.get(
    '/admin/operations/billing/payments/:id',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('billing.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      if (!id || typeof id !== 'string') {
        throw new ValidationError('Payment ID is required');
      }

      const result = await AdminBillingService.getPaymentDetail(id);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/operations/billing/payments/:id/provider-sync
   * Inspects live payment transaction status directly from Razorpay provider.
   * Permission required: 'billing.read'
   */
  app.get(
    '/admin/operations/billing/payments/:id/provider-sync',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('billing.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      if (!id || typeof id !== 'string') {
        throw new ValidationError('Payment ID is required');
      }

      const context = (request as any).adminOperationContext;
      const result = await AdminBillingService.inspectProviderPayment(id, context);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * POST /api/v1/admin/operations/billing/payments/:id/refund
   * Executes an administrative refund for a specific payment transaction.
   * Permission required: 'billing.refund'
   */
  app.post(
    '/admin/operations/billing/payments/:id/refund',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('billing.refund')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      if (!id || typeof id !== 'string') {
        throw new ValidationError('Payment ID is required');
      }

      const parsed = AdminExecuteRefundSchema.safeParse(request.body || {});
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid refund parameters');
      }

      const context = (request as any).adminOperationContext;
      const result = await AdminBillingService.executePaymentRefund(id, context, parsed.data);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * POST /api/v1/admin/operations/billing/refunds
   * Alternative endpoint to issue a refund with paymentId in the body.
   * Permission required: 'billing.refund'
   */
  app.post(
    '/admin/operations/billing/refunds',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('billing.refund')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as any;
      const paymentId = body?.paymentId;
      if (!paymentId || typeof paymentId !== 'string') {
        throw new ValidationError('paymentId is required in the refund request body');
      }

      const parsed = AdminExecuteRefundSchema.safeParse(body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid refund parameters');
      }

      const context = (request as any).adminOperationContext;
      const result = await AdminBillingService.executePaymentRefund(paymentId, context, parsed.data);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/operations/billing/refunds
   * Lists customer refund transactions with filters and bounded pagination.
   * Permission required: 'billing.read'
   */
  app.get(
    '/admin/operations/billing/refunds',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('billing.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = AdminRefundListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid refund query parameters');
      }

      const result = await AdminBillingService.listRefunds(parsed.data);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/operations/billing/refunds/:id
   * Inspects detailed state of a single refund transaction.
   * Permission required: 'billing.read'
   */
  app.get(
    '/admin/operations/billing/refunds/:id',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('billing.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      if (!id || typeof id !== 'string') {
        throw new ValidationError('Refund ID is required');
      }

      const result = await AdminBillingService.getRefundDetail(id);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/operations/billing/refunds/:id/provider-sync
   * Inspects live refund status directly from Razorpay provider.
   * Permission required: 'billing.read'
   */
  app.get(
    '/admin/operations/billing/refunds/:id/provider-sync',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('billing.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      if (!id || typeof id !== 'string') {
        throw new ValidationError('Refund ID is required');
      }

      const context = (request as any).adminOperationContext;
      const result = await AdminBillingService.inspectProviderRefund(id, context);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/operations/billing/reconciliation/runs
   * Lists batch reconciliation runs with filters and pagination.
   * Permission required: 'billing.reconcile'
   */
  app.get(
    '/admin/operations/billing/reconciliation/runs',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('billing.reconcile')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = AdminReconciliationRunListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid reconciliation run query parameters');
      }

      const result = await AdminBillingService.listReconciliationRuns(parsed.data);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/operations/billing/reconciliation/discrepancies
   * Lists identified reconciliation discrepancies with granular filters.
   * Permission required: 'billing.reconcile'
   */
  app.get(
    '/admin/operations/billing/reconciliation/discrepancies',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('billing.reconcile')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = AdminDiscrepancyListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid discrepancy query parameters');
      }

      const result = await AdminBillingService.listDiscrepancies(parsed.data);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/operations/billing/plans
   * Lists plan catalog offerings with pricing and active subscriber counts.
   * Permission required: 'billing.read'
   */
  app.get(
    '/admin/operations/billing/plans',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('billing.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = AdminPlanListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid plan query parameters');
      }

      const result = await AdminBillingService.listPlans(parsed.data);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );
}
