import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { createSuccessResponse, createErrorResponse } from '../schemas/response.js';
import { ValidationError, UnauthorizedError, ForbiddenError } from '../errors/app-error.js';

import { hashPassword } from '../utils/crypto.js';

const registerDeviceSchema = z.object({
  deviceName: z.string().min(1),
  platform: z.string().default('Android'),
  osVersion: z.string().optional(),
  appVersion: z.string().optional(),
  installationId: z.string().min(1),
  serverName: z.string().optional(),
  adminUsername: z.string().optional(),
  adminPassword: z.string().optional()
});

const heartbeatSchema = z.object({
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

export async function deviceRoutes(app: FastifyInstance): Promise<void> {

  /**
   * POST /api/v1/devices/register
   * Registers or updates an Android device node under the authenticated platform user.
   */
  app.post('/devices/register', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const body = registerDeviceSchema.safeParse(request.body);

    if (!body.success) {
      throw new ValidationError('Invalid device registration metadata. deviceName and installationId are required.');
    }

    const { deviceName, platform, osVersion, appVersion, installationId, serverName, adminUsername, adminPassword } = body.data;

    // Check if a device with this name already exists for the user
    const existingDevice = await prisma.device.findFirst({
      where: {
        userId: user.id,
        deviceName: deviceName
      }
    });

    let device;
    const adminPasswordHash = adminPassword ? hashPassword(adminPassword) : undefined;

    if (existingDevice) {
      // Idempotent update
      device = await prisma.device.update({
        where: { id: existingDevice.id },
        data: {
          deviceName,
          osVersion,
          appVersion,
          status: 'ONLINE',
          lastSeenAt: new Date()
        }
      });

      // Update or ensure ServerInstance exists
      const existingServer = await prisma.serverInstance.findFirst({
        where: { deviceId: device.id }
      });

      if (existingServer) {
        await prisma.serverInstance.update({
          where: { id: existingServer.id },
          data: {
            serverName: serverName || existingServer.serverName || deviceName,
            adminUsername: adminUsername || existingServer.adminUsername,
            ...(adminPasswordHash ? { adminPasswordHash } : {})
          }
        });
      } else {
        await prisma.serverInstance.create({
          data: {
            deviceId: device.id,
            serverName: serverName || deviceName,
            adminUsername: adminUsername,
            adminPasswordHash: adminPasswordHash,
            status: 'STARTING'
          }
        });
      }
    } else {
      // Create new Device
      device = await prisma.device.create({
        data: {
          userId: user.id,
          deviceName,
          platform,
          osVersion,
          appVersion,
          status: 'ONLINE',
          lastSeenAt: new Date()
        }
      });

      // Create initial ServerInstance (status STARTING)
      await prisma.serverInstance.create({
        data: {
          deviceId: device.id,
          serverName: serverName || deviceName,
          adminUsername: adminUsername,
          adminPasswordHash: adminPasswordHash,
          status: 'STARTING'
        }
      });

      await prisma.auditEvent.create({
        data: {
          userId: user.id,
          deviceId: device.id,
          eventType: 'DEVICE_REGISTERED'
        }
      });

      await prisma.auditEvent.create({
        data: {
          userId: user.id,
          deviceId: device.id,
          eventType: 'SERVER_CREATED',
          metadata: { serverName: serverName || deviceName, adminUsername }
        }
      });
    }

    return reply.status(200).send(createSuccessResponse({
      device: {
        id: device.id,
        deviceName: device.deviceName,
        platform: device.platform,
        osVersion: device.osVersion,
        appVersion: device.appVersion,
        status: device.status,
        lastSeenAt: device.lastSeenAt?.toISOString()
      }
    }));
  });

  /**
   * POST /api/v1/devices/:deviceId/heartbeat
   * Reports heartbeat for an authenticated device, updating lastSeenAt timestamp.
   */
  app.post('/devices/:deviceId/heartbeat', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const params = heartbeatSchema.safeParse(request.params);

    if (!params.success) {
      throw new ValidationError('Invalid device ID parameter');
    }

    const deviceId = params.data.deviceId;
    const device = await prisma.device.findUnique({ where: { id: deviceId } });

    if (!device) {
      return reply.status(404).send(createErrorResponse('DEVICE_NOT_FOUND', 'Device node not found'));
    }

    if (device.userId !== user.id) {
      throw new ForbiddenError('You do not have permission to manage this device');
    }

    const now = new Date();
    const updatedDevice = await prisma.device.update({
      where: { id: deviceId },
      data: {
        status: 'ONLINE',
        lastSeenAt: now
      }
    });

    // Update server instance heartbeat if active
    await prisma.serverInstance.updateMany({
      where: { deviceId },
      data: { lastHeartbeatAt: now }
    });

    return reply.status(200).send(createSuccessResponse({
      status: 'ok',
      deviceId: updatedDevice.id,
      lastSeenAt: now.toISOString()
    }));
  });

  /**
   * GET /api/v1/devices
   * Retrieves all registered devices for the authenticated user along with their active servers and endpoints.
   */
  app.get('/devices', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);

    const devices = await prisma.device.findMany({
      where: { userId: user.id },
      include: {
        servers: {
          include: {
            endpoints: true
          }
        },
        connections: {
          include: {
            gatewayNode: true
          },
          orderBy: { createdAt: 'desc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return reply.status(200).send(createSuccessResponse({
      devices: devices.map(d => {
        const activeServer = d.servers[0];
        const activeEndpoint = activeServer?.endpoints?.find(e => e.status === 'ACTIVE') ?? activeServer?.endpoints?.[0];
        const activeConn = d.connections?.[0];

        return {
          id: d.id,
          deviceName: d.deviceName,
          platform: d.platform,
          osVersion: d.osVersion,
          appVersion: d.appVersion,
          status: d.status,
          lastSeenAt: d.lastSeenAt?.toISOString(),
          server: activeServer ? {
            id: activeServer.id,
            status: activeServer.status,
            startedAt: activeServer.startedAt?.toISOString(),
            endpoint: activeEndpoint ? {
              id: activeEndpoint.id,
              hostname: activeEndpoint.hostname,
              publicUrl: `https://${activeEndpoint.hostname}`,
              status: activeEndpoint.status
            } : null
          } : null,
          connection: activeConn ? {
            id: activeConn.id,
            status: activeConn.status,
            remoteEndpoint: activeConn.remoteEndpoint,
            gatewayHost: activeConn.gatewayNode?.hostname ?? null,
            lastHeartbeatAt: activeConn.lastHeartbeatAt?.toISOString()
          } : null
        };
      })
    }));
  });

  /**
   * GET /api/v1/devices/:deviceId
   * Retrieves a single device by ID with its active server and endpoint.
   */
  app.get('/devices/:deviceId', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const params = heartbeatSchema.safeParse(request.params);

    if (!params.success) {
      throw new ValidationError('Invalid device ID parameter');
    }

    const deviceId = params.data.deviceId;
    const device = await prisma.device.findUnique({
      where: { id: deviceId },
      include: {
        servers: {
          include: {
            endpoints: true
          }
        },
        connections: {
          include: {
            gatewayNode: true
          },
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!device) {
      return reply.status(404).send(createErrorResponse('DEVICE_NOT_FOUND', 'Device node not found'));
    }

    if (device.userId !== user.id) {
      throw new ForbiddenError('You do not have permission to access this device');
    }

    const activeServer = device.servers[0];
    const activeEndpoint = activeServer?.endpoints?.find(e => e.status === 'ACTIVE') ?? activeServer?.endpoints?.[0];
    const activeConn = device.connections?.[0];

    return reply.status(200).send(createSuccessResponse({
      device: {
        id: device.id,
        deviceName: device.deviceName,
        platform: device.platform,
        osVersion: device.osVersion,
        appVersion: device.appVersion,
        status: device.status,
        lastSeenAt: device.lastSeenAt?.toISOString(),
        server: activeServer ? {
          id: activeServer.id,
          status: activeServer.status,
          startedAt: activeServer.startedAt?.toISOString(),
          endpoint: activeEndpoint ? {
            id: activeEndpoint.id,
            hostname: activeEndpoint.hostname,
            publicUrl: `https://${activeEndpoint.hostname}`,
            status: activeEndpoint.status
          } : null
        } : null,
        connection: activeConn ? {
          id: activeConn.id,
          status: activeConn.status,
          remoteEndpoint: activeConn.remoteEndpoint,
          gatewayHost: activeConn.gatewayNode?.hostname ?? null,
          lastHeartbeatAt: activeConn.lastHeartbeatAt?.toISOString()
        } : null
      }
    }));
  });
}
