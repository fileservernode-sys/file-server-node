import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { createSuccessResponse, createErrorResponse } from '../schemas/response.js';
import { ValidationError, UnauthorizedError, ForbiddenError, ConflictError } from '../errors/app-error.js';
import { EntitlementService } from '../services/billing/entitlement_service.js';

const createServerSchema = z.object({
  deviceId: z.string().min(1)
});

// Helper: Extract authenticated user from Bearer token
async function getAuthUser(request: FastifyRequest) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or invalid Authorization Bearer header');
  }

  const token = authHeader.substring(7).trim();
  const session = await prisma.userSession.findFirst({
    where: { token, expiresAt: { gt: new Date() } },
    include: { user: true }
  });

  if (!session || !session.user) {
    throw new UnauthorizedError('Session expired or invalid token');
  }

  return session.user;
}

export async function serverRoutes(app: FastifyInstance): Promise<void> {

  /**
   * POST /api/v1/servers
   * Creates or initializes a logical ServerInstance for an authenticated device.
   * Enforces:
   * 1. Max 5 active servers per account (MAX_SERVERS_REACHED)
   * 2. Max 1 active server per device (idempotent reuse, no duplicate ServerInstance)
   */
  app.post('/servers', async (request: FastifyRequest, reply: FastifyReply) => {
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
}
