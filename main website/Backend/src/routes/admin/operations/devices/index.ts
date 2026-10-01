import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { adminAuthenticate } from '../../../../middleware/admin-auth.js';
import { requireOperationPermission } from '../middleware/require_operation_permission.js';
import { assertAdminCanOperateOnResource } from '../middleware/object_authorization.js';
import { createSuccessResponse } from '../../../../schemas/response.js';
import { ValidationError } from '../../../../errors/app-error.js';
import { resolveClientIp } from '../../../../utils/ip.js';
import { AdminDeviceService } from './service.js';
import {
  deviceListQuerySchema,
  deviceParamSchema,
  deviceDisconnectSchema
} from './schemas.js';

export * from './schemas.js';
export * from './service.js';

export async function adminDeviceOperationsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/admin/operations/devices
   * Lists registered devices with allowlisted filtering, search, and pagination.
   */
  app.get(
    '/admin/operations/devices',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('devices.read')]
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
   * GET /api/v1/admin/operations/devices/:deviceId
   * Retrieves operational metadata and resource overview for a specific device.
   */
  app.get(
    '/admin/operations/devices/:deviceId',
    {
      preHandler: [adminAuthenticate, requireOperationPermission('devices.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParam = deviceParamSchema.safeParse(request.params);
      if (!parsedParam.success) {
        throw new ValidationError(parsedParam.error.errors[0]?.message || 'Invalid deviceId parameter');
      }

      const { deviceId } = parsedParam.data;

      await assertAdminCanOperateOnResource({
        resourceType: 'device',
        resourceId: deviceId,
        operation: 'read',
        context: request.operationContext!
      });

      const device = await AdminDeviceService.getDeviceDetail(deviceId);
      return reply.status(200).send(createSuccessResponse({ device }));
    }
  );

  /**
   * POST /api/v1/admin/operations/devices/:deviceId/disconnect
   * Disconnects an active device session, evicting its WebSocket and updating connection records.
   */
  app.post(
    '/admin/operations/devices/:deviceId/disconnect',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest) => {
            const adminId = req.admin?.id || 'anonymous';
            const clientIp = resolveClientIp(req) || 'unknown';
            return `device_disconnect_${adminId}_${clientIp}`;
          }
        }
      },
      preHandler: [adminAuthenticate, requireOperationPermission('devices.disconnect')]
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

      await assertAdminCanOperateOnResource({
        resourceType: 'device',
        resourceId: deviceId,
        operation: 'disconnect',
        context: request.operationContext!
      });

      const result = await AdminDeviceService.disconnectDevice(
        deviceId,
        request.operationContext!,
        parsedBody.data.reason
      );

      return reply.status(200).send(createSuccessResponse({
        device: result,
        message: `Device '${result.deviceName}' disconnected successfully`
      }));
    }
  );
}
