/**
 * RemoteNode User Notification Preferences REST API Routes
 * Track 4 — Batch NT-1.2 Architecture
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../config/database.js';
import { hashSessionToken } from '../../utils/crypto.js';
import { createSuccessResponse, createErrorResponse } from '../../schemas/response.js';
import { UnauthorizedError } from '../../errors/app-error.js';
import { notificationRepository } from '../repositories/notification_repository.js';

const updatePreferencesSchema = z.object({
  globalPushEnabled: z.boolean().optional(),
  globalEmailEnabled: z.boolean().optional(),
  categories: z.record(z.object({
    enabled: z.boolean(),
    channels: z.record(z.boolean())
  })).optional()
});

import { getAuthUser } from '../../middleware/customer-auth.js';

export async function preferenceRoutes(app: FastifyInstance): Promise<void> {

  /**
   * GET /api/v1/notifications/preferences
   * Returns authenticated user's notification preferences.
   */
  app.get('/notifications/preferences', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const prefs = await notificationRepository.getUserPreferences(user.id);
    return reply.send(createSuccessResponse(prefs));
  });

  /**
   * PATCH /api/v1/notifications/preferences
   * Updates authenticated user's notification preferences.
   */
  app.patch('/notifications/preferences', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const body = updatePreferencesSchema.safeParse(request.body);

    if (!body.success) {
      return reply.status(400).send(createErrorResponse('VALIDATION_ERROR', body.error.errors[0].message));
    }

    const updated = await notificationRepository.updateUserPreferences(user.id, body.data);
    return reply.send(createSuccessResponse(updated));
  });
}
