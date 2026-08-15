import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { createSuccessResponse } from '../schemas/response.js';
import { ValidationError, UnauthorizedError, ForbiddenError, NotFoundError } from '../errors/app-error.js';
import { EndpointService } from '../services/endpoint.js';

const serverParamSchema = z.object({
  serverId: z.string().min(1)
});

// Helper: Extract authenticated user
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

export async function endpointRoutes(app: FastifyInstance): Promise<void> {

  /**
   * GET /api/v1/servers/:serverId/endpoint
   * Retrieves allocated remote endpoint details for a ServerInstance
   */
  app.get('/servers/:serverId/endpoint', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const params = serverParamSchema.safeParse(request.params);

    if (!params.success) {
      throw new ValidationError('Invalid serverId parameter');
    }

    const serverId = params.data.serverId;
    const serverInstance = await prisma.serverInstance.findUnique({
      where: { id: serverId },
      include: { device: true }
    });

    if (!serverInstance) {
      throw new NotFoundError('Server instance not found');
    }

    if (serverInstance.device.userId !== user.id) {
      throw new ForbiddenError('You do not have permission to access endpoints for this server');
    }

    const endpoint = await EndpointService.reserveEndpoint(serverInstance.id);

    return reply.status(200).send(createSuccessResponse({
      endpoint: {
        id: endpoint.id,
        serverInstanceId: endpoint.serverInstanceId,
        hostname: endpoint.hostname,
        protocol: 'https',
        wsProtocol: 'wss',
        status: endpoint.status,
        url: `https://${endpoint.hostname}`,
        createdAt: endpoint.createdAt.toISOString()
      }
    }));
  });
}
