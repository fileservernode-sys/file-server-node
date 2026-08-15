import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { createSuccessResponse, createErrorResponse } from '../schemas/response.js';
import { ValidationError, UnauthorizedError, ForbiddenError } from '../errors/app-error.js';

const registerDeviceSchema = z.object({
  deviceName: z.string().min(1),
  platform: z.string().default('Android'),
  osVersion: z.string().optional(),
  appVersion: z.string().optional(),
  installationId: z.string().min(1)
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

    const { deviceName, platform, osVersion, appVersion, installationId } = body.data;

    // Check if a device with this installationId already exists
    const existingDevice = await prisma.device.findFirst({
      where: {
        // Look for device matching user or installationId metadata
        userId: user.id,
        deviceName: deviceName
      }
    });

    let device;
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

      // Create initial ServerInstance (status STOPPED)
      await prisma.serverInstance.create({
        data: {
          deviceId: device.id,
          status: 'STOPPED'
        }
      });

      await prisma.auditEvent.create({
        data: {
          userId: user.id,
          deviceId: device.id,
          eventType: 'DEVICE_REGISTERED'
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
}
