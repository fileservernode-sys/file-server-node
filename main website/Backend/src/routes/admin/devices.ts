/**
 * Administrative Device Management API Routes (/api/v1/admin/devices)
 * Phase 17 Batch 17.3 — Device & Server Management
 *
 * Protected by admin authentication, RBAC permissions ('devices.read', 'devices.disconnect'),
 * rate limiting, and tamper-evident SHA-256 audit logging.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { adminAuthenticate } from '../../middleware/admin-auth.js';
import { requirePermission } from '../../middleware/admin-rbac.js';
import { AdminDeviceService } from './operations/devices/service.js';
import {
  deviceListQuerySchema,
  deviceParamSchema,
  deviceDisconnectSchema
} from './operations/devices/schemas.js';
import { createSuccessResponse } from '../../schemas/response.js';
import { ValidationError } from '../../errors/app-error.js';
import { adminOperationsRateLimitConfig } from '../../middleware/rate_limit_presets.js';
import { resolveClientIp } from '../../utils/ip.js';
import { resolveOperationContext } from './operations/middleware/require_operation_permission.js';

export async function adminDevicesRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/admin/devices/metrics
   * Summary count metrics across registered devices.
   */
  app.get(
    '/admin/devices/metrics',
    {
      config: {
        rateLimit: adminOperationsRateLimitConfig
      },
      preHandler: [adminAuthenticate, requirePermission('devices.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const metrics = await AdminDeviceService.getDeviceSummaryMetrics();
      return reply.status(200).send(createSuccessResponse({ metrics }));
    }
  );

  /**
   * GET /api/v1/admin/devices
   * Lists registered devices with search, filtering, and pagination.
   */
  app.get(
    '/admin/devices',
    {
      config: {
        rateLimit: adminOperationsRateLimitConfig
      },
      preHandler: [adminAuthenticate, requirePermission('devices.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = deviceListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid query parameters');
      }

      const result = await AdminDeviceService.listDevices(parsed.data);
      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/admin/devices/:deviceId
   * Retrieves operational metadata and resource overview for a specific device.
   */
  app.get(
    '/admin/devices/:deviceId',
    {
      config: {
        rateLimit: adminOperationsRateLimitConfig
      },
      preHandler: [adminAuthenticate, requirePermission('devices.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParam = deviceParamSchema.safeParse(request.params);
      if (!parsedParam.success) {
        throw new ValidationError(parsedParam.error.errors[0]?.message || 'Invalid deviceId parameter');
      }

      const { deviceId } = parsedParam.data;
      const device = await AdminDeviceService.getDeviceDetail(deviceId);
      return reply.status(200).send(createSuccessResponse({ device }));
    }
  );

  /**
   * POST /api/v1/admin/devices/:deviceId/disconnect
   * Disconnects an active device session, evicting its WebSocket and updating connection records.
   */
  app.post(
    '/admin/devices/:deviceId/disconnect',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest) => {
            const adminId = req.admin?.id || 'anonymous';
            const clientIp = resolveClientIp(req) || 'unknown';
            return `devices_disconnect_${adminId}_${clientIp}`;
          }
        }
      },
      preHandler: [adminAuthenticate, requirePermission('devices.disconnect')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParam = deviceParamSchema.safeParse(request.params);
      if (!parsedParam.success) {
        throw new ValidationError(parsedParam.error.errors[0]?.message || 'Invalid deviceId parameter');
      }

      const parsedBody = deviceDisconnectSchema.safeParse(request.body || {});
      if (!parsedBody.success) {
        throw new ValidationError(parsedBody.error.errors[0]?.message || 'Invalid payload');
      }

      const { deviceId } = parsedParam.data;
      const context = await resolveOperationContext(request, 'device_disconnect', 'device', deviceId);

      const result = await AdminDeviceService.disconnectDevice(
        deviceId,
        context,
        parsedBody.data.reason
      );

      return reply.status(200).send(createSuccessResponse({
        device: result,
        message: `Device '${result.deviceName}' disconnected successfully`
      }));
    }
  );
}
