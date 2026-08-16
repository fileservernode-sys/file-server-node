import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { createSuccessResponse, createErrorResponse } from '../schemas/response.js';
import { ValidationError, UnauthorizedError, ForbiddenError, NotFoundError } from '../errors/app-error.js';
import { EndpointService } from '../services/endpoint.js';

const registerConnectionSchema = z.object({
  deviceId: z.string().min(1),
  gatewayNodeId: z.string().optional()
});

const updateHeartbeatSchema = z.object({
  status: z.enum(['DISCONNECTED', 'CONNECTING', 'CONNECTED', 'RECONNECTING', 'FAILED']).optional()
});

const connectionParamSchema = z.object({
  connectionId: z.string().min(1)
});

// Helper: Extract authenticated platform user
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

export async function connectionRoutes(app: FastifyInstance): Promise<void> {

  /**
   * POST /api/v1/connections/register
   * Registers intent for outbound remote connection from an Android device
   */
  app.post('/connections/register', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const body = registerConnectionSchema.safeParse(request.body);

    if (!body.success) {
      throw new ValidationError('deviceId is required to register a remote connection');
    }

    const { deviceId, gatewayNodeId } = body.data;
    const device = await prisma.device.findUnique({ where: { id: deviceId } });

    if (!device) {
      throw new NotFoundError('Device node not found');
    }

    if (device.userId !== user.id) {
      throw new ForbiddenError('You do not have permission to register connections for this device');
    }

    const serverInstance = await prisma.serverInstance.findFirst({ where: { deviceId } });
    let remoteEndpointStr = 'https://pending-allocation.remotenode.net';

    if (serverInstance) {
      const endpoint = await EndpointService.reserveEndpoint(serverInstance.id);
      remoteEndpointStr = `https://${endpoint.hostname}`;

      // Mark ServerInstance as RUNNING and record start timestamp
      await prisma.serverInstance.update({
        where: { id: serverInstance.id },
        data: {
          status: 'RUNNING',
          startedAt: new Date(),
          lastHeartbeatAt: new Date()
        }
      });
    }

    // Resolve or discover active GatewayNode
    let resolvedGatewayId = gatewayNodeId;
    if (!resolvedGatewayId) {
      const activeGateway = await prisma.gatewayNode.findFirst({ where: { status: 'ACTIVE' } });
      resolvedGatewayId = activeGateway?.id;
    }

    const token = `conn-token-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;

    const connection = await prisma.deviceConnection.create({
      data: {
        deviceId,
        gatewayNodeId: resolvedGatewayId,
        connectionToken: token,
        remoteEndpoint: remoteEndpointStr,
        status: 'CONNECTING',
        lastHeartbeatAt: new Date()
      }
    });

    await prisma.auditEvent.create({
      data: {
        userId: user.id,
        deviceId,
        eventType: 'REMOTE_CONNECTION_CREATED',
        metadata: { connectionId: connection.id, remoteEndpoint: remoteEndpointStr }
      }
    });

    let assignedHostname = '';
    if (serverInstance) {
      const activeEp = await prisma.serverEndpoint.findFirst({
        where: { serverInstanceId: serverInstance.id, status: 'ACTIVE' }
      });
      if (activeEp) {
        assignedHostname = activeEp.hostname;
      }
    }

    return reply.status(200).send(createSuccessResponse({
      connection: {
        id: connection.id,
        deviceId: connection.deviceId,
        gatewayNodeId: connection.gatewayNodeId,
        connectionToken: connection.connectionToken,
        remoteEndpoint: connection.remoteEndpoint,
        hostname: assignedHostname,
        publicUrl: remoteEndpointStr,
        status: connection.status,
        createdAt: connection.createdAt.toISOString()
      }
    }));
  });

  /**
   * POST /api/v1/connections/:connectionId/heartbeat
   * Reports heartbeat and status state transitions for remote connection
   */
  app.post('/connections/:connectionId/heartbeat', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const params = connectionParamSchema.safeParse(request.params);

    if (!params.success) {
      throw new ValidationError('Invalid connectionId parameter');
    }

    const connectionId = params.data.connectionId;
    const connection = await prisma.deviceConnection.findUnique({
      where: { id: connectionId },
      include: { device: true }
    });

    if (!connection) {
      throw new NotFoundError('Remote connection record not found');
    }

    if (connection.device.userId !== user.id) {
      throw new ForbiddenError('You do not have permission to manage this remote connection');
    }

    const body = updateHeartbeatSchema.safeParse(request.body);
    const newStatus = body.success && body.data.status ? body.data.status : connection.status;
    const now = new Date();

    const updated = await prisma.deviceConnection.update({
      where: { id: connectionId },
      data: {
        status: newStatus,
        lastHeartbeatAt: now,
        connectedAt: newStatus === 'CONNECTED' ? (connection.connectedAt ?? now) : connection.connectedAt,
        disconnectedAt: newStatus === 'DISCONNECTED' ? now : connection.disconnectedAt
      }
    });

    return reply.status(200).send(createSuccessResponse({
      connectionId: updated.id,
      status: updated.status,
      lastHeartbeatAt: now.toISOString()
    }));
  });

  /**
   * POST /api/v1/connections/:connectionId/disconnect
   * Gracefully disconnects a remote connection
   */
  app.post('/connections/:connectionId/disconnect', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const params = connectionParamSchema.safeParse(request.params);

    if (!params.success) {
      throw new ValidationError('Invalid connectionId parameter');
    }

    const connectionId = params.data.connectionId;
    const connection = await prisma.deviceConnection.findUnique({
      where: { id: connectionId },
      include: { device: true }
    });

    if (!connection) {
      throw new NotFoundError('Remote connection record not found');
    }

    if (connection.device.userId !== user.id) {
      throw new ForbiddenError('You do not have permission to manage this remote connection');
    }

    const now = new Date();
    const updated = await prisma.deviceConnection.update({
      where: { id: connectionId },
      data: {
        status: 'DISCONNECTED',
        disconnectedAt: now
      }
    });

    await prisma.auditEvent.create({
      data: {
        userId: user.id,
        deviceId: connection.deviceId,
        eventType: 'REMOTE_CONNECTION_DISCONNECTED',
        metadata: { connectionId }
      }
    });

    return reply.status(200).send(createSuccessResponse({
      connectionId: updated.id,
      status: updated.status,
      disconnectedAt: now.toISOString()
    }));
  });

  /**
   * GET /api/v1/connections/:connectionId
   * Retrieves current status and metrics for a remote connection
   */
  app.get('/connections/:connectionId', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const params = connectionParamSchema.safeParse(request.params);

    if (!params.success) {
      throw new ValidationError('Invalid connectionId parameter');
    }

    const connectionId = params.data.connectionId;
    const connection = await prisma.deviceConnection.findUnique({
      where: { id: connectionId },
      include: { device: true }
    });

    if (!connection) {
      throw new NotFoundError('Remote connection record not found');
    }

    if (connection.device.userId !== user.id) {
      throw new ForbiddenError('You do not have permission to view this remote connection');
    }

    const serverInst = await prisma.serverInstance.findFirst({
      where: { deviceId: connection.deviceId },
      include: { endpoints: true }
    });
    const activeEp = serverInst?.endpoints.find(e => e.status === 'ACTIVE');

    return reply.status(200).send(createSuccessResponse({
      connection: {
        id: connection.id,
        deviceId: connection.deviceId,
        status: connection.status,
        remoteEndpoint: connection.remoteEndpoint,
        hostname: activeEp?.hostname ?? '',
        publicUrl: connection.remoteEndpoint ?? (activeEp ? `https://${activeEp.hostname}` : null),
        connectedAt: connection.connectedAt?.toISOString(),
        disconnectedAt: connection.disconnectedAt?.toISOString(),
        lastHeartbeatAt: connection.lastHeartbeatAt?.toISOString()
      }
    }));
  });
}
