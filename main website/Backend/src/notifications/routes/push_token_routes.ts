/**
 * RemoteNode Device Push Token REST API Routes
 * Track 4 — Batch NT-1.2 Architecture
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../config/database.js';
import { createSuccessResponse, createErrorResponse } from '../../schemas/response.js';
import { UnauthorizedError, ForbiddenError, NotFoundError } from '../../errors/app-error.js';
import { notificationRepository } from '../repositories/notification_repository.js';
import { PushPlatform } from '@prisma/client';

const registerPushTokenSchema = z.object({
  token: z.string().min(10, 'Push token must be at least 10 characters'),
  platform: z.enum(['ANDROID', 'IOS', 'WEB']).default('ANDROID'),
  appVersion: z.string().optional()
});

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

export async function pushTokenRoutes(app: FastifyInstance): Promise<void> {

  /**
   * Helper: Verify authenticated user owns target device
   */
  async function verifyDeviceOwnership(userId: string, deviceId: string) {
    const device = await prisma.device.findUnique({
      where: { id: deviceId }
    });

    if (!device) {
      throw new NotFoundError(`Device with ID ${deviceId} not found`);
    }

    if (device.userId !== userId) {
      throw new ForbiddenError('You do not have permission to manage push tokens for this device');
    }

    return device;
  }

  /**
   * POST /api/v1/devices/:deviceId/push-token
   * Registers or updates an active FCM push token for an authenticated device node.
   */
  app.post('/devices/:deviceId/push-token', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const { deviceId } = request.params as { deviceId: string };

    await verifyDeviceOwnership(user.id, deviceId);

    const body = registerPushTokenSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send(createErrorResponse('VALIDATION_ERROR', body.error.errors[0].message));
    }

    const tokenRecord = await notificationRepository.registerOrUpdatePushToken({
      userId: user.id,
      deviceId,
      token: body.data.token,
      platform: body.data.platform as PushPlatform,
      appVersion: body.data.appVersion
    });

    // Audit Event Integration
    try {
      await prisma.auditEvent.create({
        data: {
          userId: user.id,
          deviceId,
          eventType: 'PUSH_TOKEN_REGISTERED',
          metadata: { platform: body.data.platform }
        }
      });
    } catch {}

    return reply.send(createSuccessResponse({
      message: 'FCM push token registered successfully',
      deviceId,
      platform: tokenRecord.platform,
      isActive: tokenRecord.isActive,
      updatedAt: tokenRecord.updatedAt
    }));
  });

  /**
   * PATCH /api/v1/devices/:deviceId/push-token
   * Updates or rotates FCM token for an authenticated device.
   */
  app.patch('/devices/:deviceId/push-token', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const { deviceId } = request.params as { deviceId: string };

    await verifyDeviceOwnership(user.id, deviceId);

    const body = registerPushTokenSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send(createErrorResponse('VALIDATION_ERROR', body.error.errors[0].message));
    }

    const tokenRecord = await notificationRepository.registerOrUpdatePushToken({
      userId: user.id,
      deviceId,
      token: body.data.token,
      platform: body.data.platform as PushPlatform,
      appVersion: body.data.appVersion
    });

    try {
      await prisma.auditEvent.create({
        data: {
          userId: user.id,
          deviceId,
          eventType: 'PUSH_TOKEN_UPDATED',
          metadata: { platform: body.data.platform }
        }
      });
    } catch {}

    return reply.send(createSuccessResponse({
      message: 'FCM push token updated successfully',
      deviceId,
      platform: tokenRecord.platform,
      isActive: tokenRecord.isActive,
      updatedAt: tokenRecord.updatedAt
    }));
  });

  /**
   * DELETE /api/v1/devices/:deviceId/push-token
   * Revokes/deactivates FCM push token for an authenticated device (e.g. app logout).
   */
  app.delete('/devices/:deviceId/push-token', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const { deviceId } = request.params as { deviceId: string };

    await verifyDeviceOwnership(user.id, deviceId);

    const queryToken = (request.query as any)?.token as string | undefined;
    if (queryToken) {
      await notificationRepository.revokePushToken(queryToken, user.id, deviceId);
    } else {
      await notificationRepository.revokeDevicePushTokens(deviceId);
    }

    try {
      await prisma.auditEvent.create({
        data: {
          userId: user.id,
          deviceId,
          eventType: 'PUSH_TOKEN_REVOKED',
          metadata: {}
        }
      });
    } catch {}

    return reply.send(createSuccessResponse({
      message: 'Device push tokens revoked successfully',
      deviceId
    }));
  });
}
