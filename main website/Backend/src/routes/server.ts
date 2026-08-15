import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { createSuccessResponse, createErrorResponse } from '../schemas/response.js';
import { ValidationError, UnauthorizedError, ForbiddenError } from '../errors/app-error.js';

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

    let serverInstance = await prisma.serverInstance.findFirst({
      where: { deviceId }
    });

    if (!serverInstance) {
      serverInstance = await prisma.serverInstance.create({
        data: {
          deviceId,
          status: 'STOPPED'
        }
      });
    }

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
