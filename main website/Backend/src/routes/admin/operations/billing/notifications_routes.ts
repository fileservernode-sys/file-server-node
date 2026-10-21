/**
 * ZdexCloud Admin Billing Notification Operations Routes
 * Phase 8.4 Batch E.5 Architecture
 *
 * Exposes administrative endpoints for inspecting and reconciling invoice notification
 * outbox records and staged provider webhook events.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { adminAuthenticate } from '../../../../middleware/admin-auth.js';
import { requireOperationPermission } from '../middleware/require_operation_permission.js';
import { createSuccessResponse } from '../../../../schemas/response.js';
import { ValidationError } from '../../../../errors/app-error.js';
import { AdminInvoiceNotificationService } from './notifications_service.js';
import {
  AdminInvoiceNotificationListQuerySchema,
  AdminWebhookInboxListQuerySchema,
  AdminForceMarkDispatchedSchema,
  AdminAuthorizeResendSchema
} from './notifications_schemas.js';

export async function adminInvoiceNotificationOperationsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /admin/operations/billing/notifications
   * Lists invoice notification outbox records with multi-column filtering and bounded pagination.
   * Permission required: 'billing.read'
   */
  app.get(
    '/admin/operations/billing/notifications',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('billing.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = AdminInvoiceNotificationListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid notification query parameters');
      }

      const result = await AdminInvoiceNotificationService.listNotifications(parsed.data);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /admin/operations/billing/notifications/webhooks/inbox
   * Lists staged EmailWebhookInbox events with multi-column filtering and bounded pagination.
   * Permission required: 'billing.read'
   */
  app.get(
    '/admin/operations/billing/notifications/webhooks/inbox',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('billing.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = AdminWebhookInboxListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid webhook inbox query parameters');
      }

      const result = await AdminInvoiceNotificationService.listWebhookInbox(parsed.data);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /admin/operations/billing/notifications/webhooks/inbox/:id
   * Inspects detailed view of a single staged provider webhook event.
   * Permission required: 'billing.read'
   */
  app.get(
    '/admin/operations/billing/notifications/webhooks/inbox/:id',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('billing.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      if (!id || typeof id !== 'string') {
        throw new ValidationError('Webhook inbox ID is required');
      }

      const result = await AdminInvoiceNotificationService.getWebhookInboxDetail(id);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /admin/operations/billing/notifications/:id
   * Inspects detailed state of a single invoice notification outbox record.
   * Permission required: 'billing.read'
   */
  app.get(
    '/admin/operations/billing/notifications/:id',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('billing.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      if (!id || typeof id !== 'string') {
        throw new ValidationError('Notification ID is required');
      }

      const result = await AdminInvoiceNotificationService.getNotificationDetail(id);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * POST /admin/operations/billing/notifications/:id/force-mark-dispatched
   * Administrative mutation: Marks an ambiguous or stuck notification as DISPATCHED following out-of-band verification.
   * Permission required: 'billing.reconcile'
   */
  app.post(
    '/admin/operations/billing/notifications/:id/force-mark-dispatched',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('billing.reconcile')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      if (!id || typeof id !== 'string') {
        throw new ValidationError('Notification ID is required');
      }

      const parsed = AdminForceMarkDispatchedSchema.safeParse(request.body || {});
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid force-mark-dispatched parameters');
      }

      const context = request.operationContext || (request as any).adminOperationContext;
      const result = await AdminInvoiceNotificationService.forceMarkDispatched(id, parsed.data, context);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * POST /admin/operations/billing/notifications/:id/authorize-resend
   * Administrative mutation: Authorizes an explicit resend for an ambiguous, failed, or exhausted notification.
   * Resets status to PENDING for outbox worker pickup without direct send shortcut.
   * Permission required: 'billing.write'
   */
  app.post(
    '/admin/operations/billing/notifications/:id/authorize-resend',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('billing.write')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      if (!id || typeof id !== 'string') {
        throw new ValidationError('Notification ID is required');
      }

      const parsed = AdminAuthorizeResendSchema.safeParse(request.body || {});
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid authorize-resend parameters');
      }

      const context = request.operationContext || (request as any).adminOperationContext;
      const result = await AdminInvoiceNotificationService.authorizeResend(id, parsed.data, context);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );
}
