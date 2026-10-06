/**
 * Fastify Operations Routes for Admin System Configuration & Feature Flags
 * Phase 17 Batch 17.7 — System Configuration
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { adminAuthenticate } from '../../../../../middleware/admin-auth.js';
import { requireOperationPermission, resolveOperationContext } from '../../middleware/require_operation_permission.js';
import { createSuccessResponse } from '../../../../../schemas/response.js';
import { ValidationError } from '../../../../../errors/app-error.js';
import { adminOperationsRateLimitConfig, highCapacityHealthRateLimitConfig } from '../../../../../middleware/rate_limit_presets.js';
import { AdminSystemConfigService } from './service.js';
import {
  systemConfigQuerySchema,
  systemSettingParamSchema,
  updateSystemSettingSchema,
  featureFlagParamSchema,
  updateFeatureFlagSchema
} from './schemas.js';

export async function adminSystemConfigOperationsRoutes(app: FastifyInstance): Promise<void> {

  /**
   * GET /api/v1/admin/operations/system/config
   * Comprehensive System Configuration Overview & Inventory.
   */
  app.get(
    '/admin/operations/system/config',
    {
      config: { rateLimit: highCapacityHealthRateLimitConfig },
      preHandler: [adminAuthenticate, requireOperationPermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const overview = await AdminSystemConfigService.getConfigOverview();
      return reply.status(200).send(createSuccessResponse(overview));
    }
  );

  /**
   * GET /api/v1/admin/operations/system/config/settings
   * List all categorized system settings with optional filters.
   */
  app.get(
    '/admin/operations/system/config/settings',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requireOperationPermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = systemConfigQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid config query parameters');
      }

      const result = await AdminSystemConfigService.listSettings(parsed.data);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/operations/system/config/settings/:key
   * Retrieve a single system setting by key.
   */
  app.get(
    '/admin/operations/system/config/settings/:key',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requireOperationPermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = systemSettingParamSchema.safeParse(request.params);
      if (!params.success) {
        throw new ValidationError('Invalid setting key parameter');
      }

      const setting = await AdminSystemConfigService.getSetting(params.data.key);
      return reply.status(200).send(createSuccessResponse({ setting }));
    }
  );

  /**
   * PUT /api/v1/admin/operations/system/config/settings/:key
   * Updates an editable runtime setting with optimistic concurrency and audit logging.
   */
  app.put(
    '/admin/operations/system/config/settings/:key',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requireOperationPermission('system.write')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = systemSettingParamSchema.safeParse(request.params);
      if (!params.success) {
        throw new ValidationError('Invalid setting key parameter');
      }

      const body = updateSystemSettingSchema.safeParse(request.body);
      if (!body.success) {
        throw new ValidationError(body.error.errors[0]?.message || 'Invalid setting update payload');
      }

      const context = await resolveOperationContext(request);
      const result = await AdminSystemConfigService.updateSetting(params.data.key, body.data, context);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/operations/system/config/flags
   * List all recognized feature flags and current states.
   */
  app.get(
    '/admin/operations/system/config/flags',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requireOperationPermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const result = await AdminSystemConfigService.listFeatureFlags();
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * PUT /api/v1/admin/operations/system/config/flags/:key
   * Toggles a known feature flag state.
   */
  app.put(
    '/admin/operations/system/config/flags/:key',
    {
      config: { rateLimit: adminOperationsRateLimitConfig },
      preHandler: [adminAuthenticate, requireOperationPermission('system.write')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = featureFlagParamSchema.safeParse(request.params);
      if (!params.success) {
        throw new ValidationError('Invalid feature flag key parameter');
      }

      const body = updateFeatureFlagSchema.safeParse(request.body);
      if (!body.success) {
        throw new ValidationError(body.error.errors[0]?.message || 'Invalid feature flag update payload');
      }

      const context = await resolveOperationContext(request);
      const result = await AdminSystemConfigService.updateFeatureFlag(params.data.key, body.data, context);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/operations/system/config/environment
   * Returns safe allowlisted environment topology.
   */
  app.get(
    '/admin/operations/system/config/environment',
    {
      config: { rateLimit: highCapacityHealthRateLimitConfig },
      preHandler: [adminAuthenticate, requireOperationPermission('system.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const environment = AdminSystemConfigService.getEnvironmentInventory();
      return reply.status(200).send(createSuccessResponse({ environment }));
    }
  );
}
