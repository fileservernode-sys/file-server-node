import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { createSuccessResponse } from '../schemas/response.js';
import { ValidationError, UnauthorizedError, ForbiddenError, NotFoundError } from '../errors/app-error.js';
import { EndpointService } from '../services/endpoint.js';
import { getAuthUser } from '../middleware/customer-auth.js';
import { customerStandardRateLimitConfig } from '../middleware/rate_limit_presets.js';

const serverParamSchema = z.object({
  serverId: z.string().min(1)
});

export async function endpointRoutes(app: FastifyInstance): Promise<void> {

  /**
   * GET /api/v1/servers/:serverId/endpoint
   * Retrieves allocated remote endpoint details for a ServerInstance
   */
  app.get(
    '/servers/:serverId/endpoint',
    {
      config: {
        rateLimit: customerStandardRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
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
