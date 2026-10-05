import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { createSuccessResponse, createErrorResponse } from '../schemas/response.js';
import { ValidationError, UnauthorizedError, ForbiddenError, NotFoundError, ConflictError } from '../errors/app-error.js';
import { EntitlementService } from '../services/billing/entitlement_service.js';
import { defaultGatewayService } from '../gateway/gateway_service.js';
import { ConnectionStateMachine } from '../services/connection_state_machine.js';
import { getAuthUser } from '../middleware/customer-auth.js';
import { expensiveCustomerRateLimitConfig, customerStandardRateLimitConfig } from '../middleware/rate_limit_presets.js';

const createServerSchema = z.object({
  deviceId: z.string().min(1)
});

const serverIdParamSchema = z.object({
  serverId: z.string().min(1)
});

export async function serverRoutes(app: FastifyInstance): Promise<void> {

  /**
   * POST /api/v1/servers
   * Creates or initializes a logical ServerInstance for an authenticated device.
   * Enforces:
   * 1. Max 5 active servers per account (MAX_SERVERS_REACHED)
   * 2. Max 1 active server per device (idempotent reuse, no duplicate ServerInstance)
   */
  app.post(
    '/servers',
    {
      config: {
        rateLimit: expensiveCustomerRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const body = createServerSchema.safeParse(request.body);

    if (!body.success) {
      throw new ValidationError('deviceId is required to create a server instance');
    }

    const { deviceId } = body.data;
    const device = await prisma.device.findUnique({ where: { id: deviceId } });

    if (!device) {
      return reply.status(404).send(createErrorResponse('DEVICE_NOT_FOUND', 'Device node not found'));
    }

    if (device.userId !== user.id) {
      throw new ForbiddenError('You do not have permission to configure servers on this device');
    }

    // Authoritative server entitlement limit for user
    const entitlements = await EntitlementService.resolveUserEntitlements(user.id);

    const serverInstance = await prisma.$transaction(async (tx) => {
      // 1. Lock user row to prevent race conditions during concurrent creations
      await tx.$executeRawUnsafe('SELECT id FROM `User` WHERE id = ? FOR UPDATE', user.id);

      // 2. Enforce 1 server per device: if device already has a server, reuse idempotently
      const existingOnDevice = await tx.serverInstance.findFirst({
        where: { deviceId }
      });
      if (existingOnDevice) {
        return existingOnDevice;
      }

      // 3. Enforce authoritative server entitlement limit per account
      const serverCount = await tx.serverInstance.count({
        where: { device: { userId: user.id } }
      });

      if (serverCount >= entitlements.maxServers) {
        throw new ConflictError(`Your account has reached the maximum limit of ${entitlements.maxServers} active servers.`, 'MAX_SERVERS_REACHED');
      }

      // 4. Create new ServerInstance
      return await tx.serverInstance.create({
        data: {
          deviceId,
          status: 'STOPPED'
        }
      });
    }, { maxWait: 15000, timeout: 30000 });

    return reply.status(200).send(createSuccessResponse({
      serverInstance: {
        id: serverInstance.id,
        deviceId: serverInstance.deviceId,
        status: serverInstance.status,
        startedAt: serverInstance.startedAt?.toISOString(),
        lastHeartbeatAt: serverInstance.lastHeartbeatAt?.toISOString()
      }
    }));
  });

  /**
   * POST /api/v1/servers/:serverId/stop
   * Explicitly marks a server instance as STOPPED, evicts its active gateway connection,
   * and sets associated endpoints to INACTIVE.
   */
  app.post(
    '/servers/:serverId/stop',
    {
      config: {
        rateLimit: customerStandardRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await getAuthUser(request, { allowDeviceRuntime: true });
      const params = serverIdParamSchema.safeParse(request.params);
      if (!params.success) throw new ValidationError('Invalid server ID');

      const { serverId } = params.data;
      const serverInstance = await prisma.serverInstance.findUnique({
        where: { id: serverId },
        include: { device: true, endpoints: true }
      });

      if (!serverInstance) {
        throw new NotFoundError('Server not found');
      }

      if (serverInstance.device.userId !== user.id) {
        throw new ForbiddenError('You do not have permission to stop this server');
      }

      if (request.deviceScope && request.deviceScope.deviceId !== serverInstance.deviceId) {
        throw new ForbiddenError('Device runtime token is not authorized for this server');
      }

      const now = new Date();

      // 1. Evict active gateway connection session promptly
      defaultGatewayService.evictDeviceSession(serverInstance.deviceId, 'Explicit user stop');

      // 2. Transition active connections for this device to DISCONNECTED
      const activeConns = await prisma.deviceConnection.findMany({
        where: {
          deviceId: serverInstance.deviceId,
          status: { in: ['CONNECTED', 'CONNECTING', 'RECONNECTING', 'STALE'] }
        }
      });

      for (const conn of activeConns) {
        await ConnectionStateMachine.transition({
          connectionId: conn.id,
          nextStatus: 'DISCONNECTED' as any,
          eventSource: 'DISCONNECT_EXPLICIT',
          timestamp: now
        });
      }

      // 3. Mark ServerInstance as STOPPED and ServerEndpoints as INACTIVE
      await prisma.serverInstance.update({
        where: { id: serverInstance.id },
        data: { status: 'STOPPED' }
      });

      await prisma.serverEndpoint.updateMany({
        where: { serverInstanceId: serverInstance.id },
        data: { status: 'INACTIVE' }
      });

      await prisma.auditEvent.create({
        data: {
          userId: user.id,
          deviceId: serverInstance.deviceId,
          eventType: 'SERVER_STOPPED',
          metadata: { serverId, stoppedAt: now.toISOString() }
        }
      });

      return reply.status(200).send(createSuccessResponse({
        serverId: serverInstance.id,
        status: 'STOPPED',
        stoppedAt: now.toISOString()
      }));
    }
  );
}
