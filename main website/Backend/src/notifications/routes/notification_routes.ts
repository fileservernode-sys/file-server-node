/**
 * RemoteNode User Notification History & State REST API Routes
 * Track 4 — Batch NT-1.2 Architecture
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../config/database.js';
import { createSuccessResponse, createErrorResponse } from '../../schemas/response.js';
import { UnauthorizedError, NotFoundError, ForbiddenError } from '../../errors/app-error.js';
import { notificationRepository } from '../repositories/notification_repository.js';
import { NotificationRecordStatus } from '@prisma/client';
import { notificationMetrics } from '../services/notification_metrics.js';
import { defaultDeliveryWorker } from '../workers/delivery_worker.js';
import { providerCircuitBreaker } from '../services/provider_circuit_breaker.js';
import { NotificationChannel } from '../types/channel.js';

const paginationQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: z.enum(['UNREAD', 'READ', 'ARCHIVED']).optional()
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

export async function notificationRoutes(app: FastifyInstance): Promise<void> {

  /**
   * GET /api/v1/notifications
   * Returns paginated notification history for authenticated user.
   */
  app.get('/notifications', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const query = paginationQuerySchema.safeParse(request.query);

    if (!query.success) {
      return reply.status(400).send(createErrorResponse('VALIDATION_ERROR', query.error.errors[0].message));
    }

    const result = await notificationRepository.getUserNotifications(user.id, {
      page: query.data.page,
      limit: query.data.limit,
      status: query.data.status as NotificationRecordStatus | undefined
    });

    const formattedItems = result.items.map(item => ({
      id: item.id,
      type: item.eventType,
      category: item.category,
      severity: item.severity,
      title: item.title,
      body: item.body,
      deepLink: item.deepLinkUri ? { uri: item.deepLinkUri, webPath: item.webPath || undefined } : null,
      status: item.status,
      createdAt: item.createdAt,
      occurredAt: item.occurredAt
    }));

    return reply.send(createSuccessResponse({
      notifications: formattedItems,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: result.totalPages
      }
    }));
  });

  /**
   * GET /api/v1/notifications/unread-count
   * Returns count of unread notifications for authenticated user.
   */
  app.get('/notifications/unread-count', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const unreadCount = await notificationRepository.getUnreadCount(user.id);
    return reply.send(createSuccessResponse({ unreadCount }));
  });

  /**
   * PATCH /api/v1/notifications/:notificationId/read
   * Marks a notification as read (user ownership enforced).
   */
  app.patch('/notifications/:notificationId/read', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const { notificationId } = request.params as { notificationId: string };

    const updated = await notificationRepository.markAsRead(notificationId, user.id);
    if (!updated) {
      // Check if notification exists under another user to return 403 vs 404
      const existing = await notificationRepository.getNotificationById(notificationId);
      if (existing && existing.userId !== user.id) {
        throw new ForbiddenError('You do not have permission to modify this notification');
      }
      throw new NotFoundError(`Notification ${notificationId} not found`);
    }

    return reply.send(createSuccessResponse({
      id: updated.id,
      status: updated.status,
      readAt: updated.readAt
    }));
  });

  /**
   * PATCH /api/v1/notifications/:notificationId/archive
   * Marks a notification as archived (user ownership enforced).
   */
  app.patch('/notifications/:notificationId/archive', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAuthUser(request);
    const { notificationId } = request.params as { notificationId: string };

    const updated = await notificationRepository.markAsArchived(notificationId, user.id);
    if (!updated) {
      const existing = await notificationRepository.getNotificationById(notificationId);
      if (existing && existing.userId !== user.id) {
        throw new ForbiddenError('You do not have permission to modify this notification');
      }
      throw new NotFoundError(`Notification ${notificationId} not found`);
    }

    return reply.send(createSuccessResponse({
      id: updated.id,
      status: updated.status,
      archivedAt: updated.archivedAt
    }));
  });

  /**
   * GET /api/v1/notifications/health
   * Returns operational notification health state (Authenticated).
   */
  app.get('/notifications/health', async (request: FastifyRequest, reply: FastifyReply) => {
    await getAuthUser(request); // Authentication required

    const metricsSnapshot = notificationMetrics.getSnapshot();
    const workerStatus = defaultDeliveryWorker.getStatus();
    const fcmCb = providerCircuitBreaker.getStatus(NotificationChannel.PUSH);
    const emailCb = providerCircuitBreaker.getStatus(NotificationChannel.EMAIL);

    const fcmHealth = metricsSnapshot.providers['PUSH']?.status || 'HEALTHY';
    const emailHealth = metricsSnapshot.providers['EMAIL']?.status || 'HEALTHY';

    let notificationSystem = 'healthy';
    if (fcmCb.state === 'OPEN' || emailCb.state === 'OPEN' || workerStatus.status === 'DEGRADED') {
      notificationSystem = 'degraded';
    }
    if (fcmCb.state === 'OPEN' && emailCb.state === 'OPEN') {
      notificationSystem = 'unhealthy';
    }

    return reply.send(createSuccessResponse({
      notificationSystem,
      providers: {
        fcm: fcmHealth.toLowerCase(),
        email: emailHealth.toLowerCase()
      },
      workers: {
        delivery: workerStatus.status.toLowerCase(),
        retention: 'running'
      },
      queue: {
        queued: metricsSnapshot.counters.dispatchedEvents - metricsSnapshot.counters.deliveredCount - metricsSnapshot.counters.permanentlyFailedCount,
        processing: workerStatus.currentProcessingCount,
        retrying: metricsSnapshot.counters.retryingCount,
        failed: metricsSnapshot.counters.permanentlyFailedCount
      },
      circuitBreakers: {
        fcm: fcmCb.state.toLowerCase(),
        email: emailCb.state.toLowerCase()
      }
    }));
  });

  /**
   * GET /api/v1/notifications/metrics
   * Returns operational notification metrics snapshot (Authenticated).
   */
  app.get('/notifications/metrics', async (request: FastifyRequest, reply: FastifyReply) => {
    await getAuthUser(request); // Authentication required

    const metricsSnapshot = notificationMetrics.getSnapshot();
    const workerStatus = defaultDeliveryWorker.getStatus();

    return reply.send(createSuccessResponse({
      metrics: metricsSnapshot,
      worker: {
        workerId: workerStatus.workerId,
        status: workerStatus.status,
        lastHeartbeatAt: workerStatus.lastHeartbeatAt,
        totalProcessedCount: workerStatus.totalProcessedCount,
        totalDeliveredCount: workerStatus.totalDeliveredCount
      }
    }));
  });
}
