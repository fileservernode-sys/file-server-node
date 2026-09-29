import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { adminAuthenticate } from '../../../../middleware/admin-auth.js';
import { requireOperationPermission } from '../middleware/require_operation_permission.js';
import { createSuccessResponse } from '../../../../schemas/response.js';
import { ValidationError } from '../../../../errors/app-error.js';
import { AdminSupportService } from './service.js';
import {
  SupportCaseListQuerySchema,
  CreateSupportCaseSchema,
  UpdateSupportCaseSchema,
  AssignSupportCaseSchema,
  AddSupportCaseNoteSchema
} from './schemas.js';

export * from './types.js';
export * from './schemas.js';
export * from './service.js';

export async function adminSupportOperationsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/admin/operations/support/overview
   * Returns operational metrics and case counts for the customer support desk.
   * Permission required: 'support.read'
   */
  app.get(
    '/admin/operations/support/overview',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('support.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const overview = await AdminSupportService.getSupportOverview();
      return reply.status(200).send(createSuccessResponse(overview));
    }
  );

  /**
   * GET /api/v1/admin/operations/support/cases
   * Lists customer support cases with filtering and bounded pagination.
   * Permission required: 'support.read'
   */
  app.get(
    '/admin/operations/support/cases',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('support.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = SupportCaseListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid support case query parameters');
      }

      const result = await AdminSupportService.listCases(parsed.data);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * POST /api/v1/admin/operations/support/cases
   * Creates a new customer support ticket / case.
   * Permission required: 'support.write'
   */
  app.post(
    '/admin/operations/support/cases',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('support.write')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = CreateSupportCaseSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid support case creation payload');
      }

      const context = request.operationContext!;
      const result = await AdminSupportService.createCase(parsed.data, context);
      return reply.status(201).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/operations/support/cases/:caseId
   * Inspects detailed state of a single support case with bounded customer context.
   * Permission required: 'support.read'
   */
  app.get(
    '/admin/operations/support/cases/:caseId',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('support.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { caseId } = request.params as { caseId: string };
      if (!caseId) {
        throw new ValidationError('Support case ID parameter is required');
      }

      const context = request.operationContext!;
      const detail = await AdminSupportService.getCaseDetail(caseId, context);
      return reply.status(200).send(createSuccessResponse(detail));
    }
  );

  /**
   * PATCH /api/v1/admin/operations/support/cases/:caseId
   * Updates state, priority, category, or resolution notes of a support case.
   * Permission required: 'support.write'
   */
  app.patch(
    '/admin/operations/support/cases/:caseId',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('support.write')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { caseId } = request.params as { caseId: string };
      if (!caseId) {
        throw new ValidationError('Support case ID parameter is required');
      }

      const parsed = UpdateSupportCaseSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid support case update payload');
      }

      const context = request.operationContext!;
      const result = await AdminSupportService.updateCase(caseId, parsed.data, context);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * POST /api/v1/admin/operations/support/cases/:caseId/assign
   * Assigns a support case to a specific admin agent or unassigns it.
   * Permission required: 'support.assign'
   */
  app.post(
    '/admin/operations/support/cases/:caseId/assign',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('support.assign')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { caseId } = request.params as { caseId: string };
      if (!caseId) {
        throw new ValidationError('Support case ID parameter is required');
      }

      const parsed = AssignSupportCaseSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid assignment payload');
      }

      const context = request.operationContext!;
      const result = await AdminSupportService.assignCase(caseId, parsed.data, context);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * POST /api/v1/admin/operations/support/cases/:caseId/notes
   * Appends an internal operator note to a support case.
   * Permission required: 'support.notes'
   */
  app.post(
    '/admin/operations/support/cases/:caseId/notes',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('support.notes')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { caseId } = request.params as { caseId: string };
      if (!caseId) {
        throw new ValidationError('Support case ID parameter is required');
      }

      const parsed = AddSupportCaseNoteSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid support note payload');
      }

      const context = request.operationContext!;
      const result = await AdminSupportService.addCaseNote(caseId, parsed.data, context);
      return reply.status(201).send(createSuccessResponse(result));
    }
  );
}
