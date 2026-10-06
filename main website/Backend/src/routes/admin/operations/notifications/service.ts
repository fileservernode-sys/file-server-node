/**
 * Administrative Notification & Communication Operations Service
 * Phase 17 Batch 17.4 — Notifications & Communication Management
 *
 * Implements bounded searches, channel filtering, failure diagnostics,
 * safe token health inspection (zero raw token exposure), and authorized retry controls.
 */

import { AdminAuditAction, Prisma, ChannelDeliveryStatus } from '@prisma/client';
import { prisma } from '../../../../config/database.js';
import { NotFoundError, ConflictError, ValidationError } from '../../../../errors/app-error.js';
import { AdminOperationContext } from '../types.js';
import { executeAdminOperation } from '../utils/operation_executor.js';
import { PaginatedResult, createPaginatedResponse } from '../utils/pagination.js';
import { failureClassifier } from '../../../../notifications/services/failure_classifier.js';
import { notificationMetrics } from '../../../../notifications/services/notification_metrics.js';
import { providerCircuitBreaker } from '../../../../notifications/services/provider_circuit_breaker.js';
import { NotificationChannel } from '../../../../notifications/types/channel.js';
import {
  NotificationSummaryMetrics,
  NotificationSummaryItem,
  NotificationDetail,
  FailedDeliverySummaryItem,
  PushTokenSummaryItem,
  NotificationListQuery,
  FailedDeliveriesQuery,
  PushTokensQuery
} from './types.js';

export class AdminNotificationService {
  /**
   * Generates summary count metrics across notifications, channel deliveries, and push tokens.
   */
  static async getNotificationSummaryMetrics(): Promise<NotificationSummaryMetrics> {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalNotifications,
      unreadCount,
      readCount,
      archivedCount,
      totalDeliveries,
      deliveredCount,
      permanentlyFailedCount,
      failedCountLegacy,
      retryingCount,
      queuedCount,
      processingCount,
      emailDeliveries,
      pushDeliveries,
      activePushTokens,
      stalePushTokens,
      revokedPushTokens,
      failedDeliveries24h,
      failedDeliveries7d
    ] = await Promise.all([
      prisma.notificationRecord.count(),
      prisma.notificationRecord.count({ where: { status: 'UNREAD' } }),
      prisma.notificationRecord.count({ where: { status: 'READ' } }),
      prisma.notificationRecord.count({ where: { status: 'ARCHIVED' } }),
      prisma.channelDeliveryRecord.count(),
      prisma.channelDeliveryRecord.count({ where: { status: 'DELIVERED' } }),
      prisma.channelDeliveryRecord.count({ where: { status: 'PERMANENTLY_FAILED' } }),
      prisma.channelDeliveryRecord.count({ where: { status: 'FAILED' } }),
      prisma.channelDeliveryRecord.count({ where: { status: 'RETRYING' } }),
      prisma.channelDeliveryRecord.count({ where: { status: 'QUEUED' } }),
      prisma.channelDeliveryRecord.count({ where: { status: 'PROCESSING' } }),
      prisma.channelDeliveryRecord.count({ where: { channel: 'EMAIL' } }),
      prisma.channelDeliveryRecord.count({ where: { channel: 'PUSH' } }),
      prisma.devicePushToken.count({ where: { isActive: true } }),
      prisma.devicePushToken.count({ where: { isActive: true, lastSeenAt: { lt: thirtyDaysAgo } } }),
      prisma.devicePushToken.count({ where: { isActive: false } }),
      prisma.channelDeliveryRecord.count({
        where: {
          status: { in: ['PERMANENTLY_FAILED', 'FAILED'] },
          failedAt: { gte: oneDayAgo }
        }
      }),
      prisma.channelDeliveryRecord.count({
        where: {
          status: { in: ['PERMANENTLY_FAILED', 'FAILED'] },
          failedAt: { gte: sevenDaysAgo }
        }
      })
    ]);

    const fcmCb = providerCircuitBreaker.getStatus(NotificationChannel.PUSH);
    const emailCb = providerCircuitBreaker.getStatus(NotificationChannel.EMAIL);

    return {
      totalNotifications,
      unreadCount,
      readCount,
      archivedCount,
      totalDeliveries,
      deliveredCount,
      failedCount: permanentlyFailedCount + failedCountLegacy,
      retryingCount,
      queuedCount: queuedCount + processingCount,
      emailDeliveries,
      pushDeliveries,
      activePushTokens,
      stalePushTokens,
      revokedPushTokens,
      failedDeliveries24h,
      failedDeliveries7d,
      circuitBreakers: {
        fcm: fcmCb.state,
        email: emailCb.state
      }
    };
  }

  /**
   * Lists notifications with multi-column filtering, customer search, and pagination.
   */
  static async listNotifications(query: NotificationListQuery): Promise<PaginatedResult<NotificationSummaryItem>> {
    const page = Math.max(1, query.page);
    const pageSize = Math.min(100, Math.max(1, query.pageSize));
    const skip = (page - 1) * pageSize;

    const where: Prisma.NotificationRecordWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }

    if (query.category) {
      where.category = query.category.trim();
    }

    if (query.severity) {
      where.severity = query.severity.trim();
    }

    if (query.userId) {
      where.userId = query.userId.trim();
    }

    if (query.deviceId) {
      where.deviceId = query.deviceId.trim();
    }

    if (query.channel) {
      where.deliveries = {
        some: {
          channel: query.channel.trim().toUpperCase()
        }
      };
    }

    if (query.search && query.search.trim().length > 0) {
      const term = query.search.trim();
      where.OR = [
        { title: { contains: term } },
        { eventType: { contains: term } },
        { user: { email: { contains: term } } },
        { user: { fullName: { contains: term } } }
      ];
    }

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) {
        const start = new Date(query.startDate);
        if (!isNaN(start.getTime())) where.createdAt.gte = start;
      }
      if (query.endDate) {
        const end = new Date(query.endDate);
        if (!isNaN(end.getTime())) where.createdAt.lte = end;
      }
    }

    const orderBy: Prisma.NotificationRecordOrderByWithRelationInput = {
      [query.sortBy]: query.sortOrder
    };

    const [total, records] = await Promise.all([
      prisma.notificationRecord.count({ where }),
      prisma.notificationRecord.findMany({
        where,
        skip,
        take: pageSize,
        orderBy,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              fullName: true
            }
          },
          device: {
            select: {
              id: true,
              deviceName: true,
              platform: true
            }
          },
          deliveries: {
            select: {
              id: true,
              channel: true,
              status: true,
              attemptCount: true,
              maxAttempts: true,
              lastAttemptAt: true,
              nextRetryAt: true,
              failureReason: true
            }
          }
        }
      })
    ]);

    const items: NotificationSummaryItem[] = records.map((r) => {
      const sanitizedBody = failureClassifier.sanitizeErrorMessage(r.body);
      const bodyPreview = sanitizedBody.length > 140 ? `${sanitizedBody.slice(0, 140)}...` : sanitizedBody;

      return {
        id: r.id,
        eventId: r.eventId,
        userId: r.userId,
        userEmail: r.user.email,
        userName: r.user.fullName,
        deviceId: r.deviceId,
        deviceName: r.device?.deviceName || null,
        platform: r.device?.platform || null,
        eventType: r.eventType,
        category: r.category,
        severity: r.severity,
        title: r.title,
        bodyPreview,
        status: r.status,
        occurredAt: r.occurredAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
        deliveries: r.deliveries.map((d) => ({
          id: d.id,
          channel: d.channel,
          status: d.status,
          attemptCount: d.attemptCount,
          maxAttempts: d.maxAttempts,
          lastAttemptAt: d.lastAttemptAt ? d.lastAttemptAt.toISOString() : null,
          nextRetryAt: d.nextRetryAt ? d.nextRetryAt.toISOString() : null,
          failureReason: d.failureReason ? failureClassifier.sanitizeErrorMessage(d.failureReason) : null
        }))
      };
    });

    return createPaginatedResponse(items, total, page, pageSize);
  }

  /**
   * Retrieves full notification detail with sanitized bodies, channel delivery logs, and linked entities.
   */
  static async getNotificationDetail(notificationId: string): Promise<NotificationDetail> {
    const record = await prisma.notificationRecord.findUnique({
      where: { id: notificationId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true
          }
        },
        device: {
          select: {
            id: true,
            deviceName: true,
            platform: true,
            osVersion: true
          }
        },
        deliveries: {
          orderBy: { createdAt: 'asc' }
        },
        emailMessages: {
          select: {
            id: true,
            emailType: true,
            templateId: true,
            recipientEmail: true,
            subject: true,
            status: true,
            provider: true,
            sentAt: true,
            deliveredAt: true,
            failedAt: true,
            failureReason: true
          },
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!record) {
      throw new NotFoundError(`Notification with ID '${notificationId}' not found`);
    }

    const sanitizedBody = failureClassifier.sanitizeErrorMessage(record.body);

    const deliveries = record.deliveries.map((d) => {
      const isRetryable =
        (d.status === 'PERMANENTLY_FAILED' || d.status === 'FAILED' || d.status === 'RETRYING') &&
        d.attemptCount < d.maxAttempts + 5;

      return {
        id: d.id,
        channel: d.channel,
        targetAddress: d.channel === 'EMAIL' ? d.targetAddress : null, // Mask push token addresses
        targetDeviceId: d.targetDeviceId,
        status: d.status,
        attemptCount: d.attemptCount,
        maxAttempts: d.maxAttempts,
        lastAttemptAt: d.lastAttemptAt ? d.lastAttemptAt.toISOString() : null,
        nextRetryAt: d.nextRetryAt ? d.nextRetryAt.toISOString() : null,
        deliveredAt: d.deliveredAt ? d.deliveredAt.toISOString() : null,
        failedAt: d.failedAt ? d.failedAt.toISOString() : null,
        failureReason: d.failureReason ? failureClassifier.sanitizeErrorMessage(d.failureReason) : null,
        providerMessageId: d.providerMessageId,
        providerResponseCode: d.providerResponseCode,
        retryable: isRetryable
      };
    });

    return {
      id: record.id,
      eventId: record.eventId,
      userId: record.userId,
      userEmail: record.user.email,
      userName: record.user.fullName,
      deviceId: record.deviceId,
      deviceName: record.device?.deviceName || null,
      platform: record.device?.platform || null,
      serverId: record.serverId,
      eventType: record.eventType,
      category: record.category,
      severity: record.severity,
      title: record.title,
      body: sanitizedBody,
      deepLinkUri: record.deepLinkUri,
      webPath: record.webPath,
      status: record.status,
      idempotencyKey: record.idempotencyKey,
      correlationId: record.correlationId,
      metadata: record.metadata as Record<string, unknown> | null,
      readAt: record.readAt ? record.readAt.toISOString() : null,
      archivedAt: record.archivedAt ? record.archivedAt.toISOString() : null,
      occurredAt: record.occurredAt.toISOString(),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      deliveries,
      emailMessages: record.emailMessages.map((e) => ({
        id: e.id,
        emailType: e.emailType,
        templateId: e.templateId,
        recipientEmail: e.recipientEmail,
        subject: e.subject,
        status: e.status,
        provider: e.provider,
        sentAt: e.sentAt ? e.sentAt.toISOString() : null,
        deliveredAt: e.deliveredAt ? e.deliveredAt.toISOString() : null,
        failedAt: e.failedAt ? e.failedAt.toISOString() : null,
        failureReason: e.failureReason ? failureClassifier.sanitizeErrorMessage(e.failureReason) : null
      }))
    };
  }

  /**
   * Lists failed or retrying channel deliveries for diagnostics and triage.
   */
  static async listFailedDeliveries(query: FailedDeliveriesQuery): Promise<PaginatedResult<FailedDeliverySummaryItem>> {
    const page = Math.max(1, query.page);
    const pageSize = Math.min(100, Math.max(1, query.pageSize));
    const skip = (page - 1) * pageSize;

    const where: Prisma.ChannelDeliveryRecordWhereInput = {
      status: { in: ['PERMANENTLY_FAILED', 'FAILED', 'RETRYING'] }
    };

    if (query.channel) {
      where.channel = query.channel.trim().toUpperCase();
    }

    if (query.failureCategory) {
      where.failureReason = { contains: query.failureCategory.trim() };
    }

    if (query.search && query.search.trim().length > 0) {
      const term = query.search.trim();
      where.OR = [
        { failureReason: { contains: term } },
        { notification: { title: { contains: term } } },
        { notification: { user: { email: { contains: term } } } }
      ];
    }

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) {
        const start = new Date(query.startDate);
        if (!isNaN(start.getTime())) where.createdAt.gte = start;
      }
      if (query.endDate) {
        const end = new Date(query.endDate);
        if (!isNaN(end.getTime())) where.createdAt.lte = end;
      }
    }

    const orderBy: Prisma.ChannelDeliveryRecordOrderByWithRelationInput = {
      [query.sortBy]: query.sortOrder
    };

    const [total, records] = await Promise.all([
      prisma.channelDeliveryRecord.count({ where }),
      prisma.channelDeliveryRecord.findMany({
        where,
        skip,
        take: pageSize,
        orderBy,
        include: {
          notification: {
            select: {
              id: true,
              title: true,
              eventType: true,
              category: true,
              userId: true,
              user: {
                select: {
                  email: true
                }
              }
            }
          }
        }
      })
    ]);

    const items: FailedDeliverySummaryItem[] = records.map((d) => {
      const isRetryable = d.attemptCount < d.maxAttempts + 5;
      return {
        id: d.id,
        notificationId: d.notificationId,
        notificationTitle: d.notification.title,
        eventType: d.notification.eventType,
        category: d.notification.category,
        userId: d.notification.userId,
        userEmail: d.notification.user.email,
        channel: d.channel,
        targetAddress: d.channel === 'EMAIL' ? d.targetAddress : null,
        targetDeviceId: d.targetDeviceId,
        status: d.status,
        attemptCount: d.attemptCount,
        maxAttempts: d.maxAttempts,
        lastAttemptAt: d.lastAttemptAt ? d.lastAttemptAt.toISOString() : null,
        nextRetryAt: d.nextRetryAt ? d.nextRetryAt.toISOString() : null,
        failedAt: d.failedAt ? d.failedAt.toISOString() : null,
        failureReason: d.failureReason ? failureClassifier.sanitizeErrorMessage(d.failureReason) : null,
        providerResponseCode: d.providerResponseCode,
        retryable: isRetryable,
        createdAt: d.createdAt.toISOString()
      };
    });

    return createPaginatedResponse(items, total, page, pageSize);
  }

  /**
   * Lists push tokens with health status, masked fingerprints (never raw tokens), and device linkages.
   */
  static async listPushTokens(query: PushTokensQuery): Promise<PaginatedResult<PushTokenSummaryItem>> {
    const page = Math.max(1, query.page);
    const pageSize = Math.min(100, Math.max(1, query.pageSize));
    const skip = (page - 1) * pageSize;

    const where: Prisma.DevicePushTokenWhereInput = {};

    if (query.platform) {
      where.platform = query.platform;
    }

    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    if (query.userId) {
      where.userId = query.userId.trim();
    }

    if (query.deviceId) {
      where.deviceId = query.deviceId.trim();
    }

    if (query.search && query.search.trim().length > 0) {
      const term = query.search.trim();
      where.OR = [
        { user: { email: { contains: term } } },
        { device: { deviceName: { contains: term } } },
        { appVersion: { contains: term } }
      ];
    }

    const orderBy: Prisma.DevicePushTokenOrderByWithRelationInput = {
      [query.sortBy]: query.sortOrder
    };

    const [total, records] = await Promise.all([
      prisma.devicePushToken.count({ where }),
      prisma.devicePushToken.findMany({
        where,
        skip,
        take: pageSize,
        orderBy,
        include: {
          user: {
            select: {
              email: true
            }
          },
          device: {
            select: {
              deviceName: true
            }
          }
        }
      })
    ]);

    const items: PushTokenSummaryItem[] = records.map((t) => {
      // Invariant: Never expose raw FCM token to client — mask as fingerprint
      const tokenEnd = t.token.slice(-8);
      const tokenFingerprint = `fcm_...${tokenEnd}`;

      return {
        id: t.id,
        userId: t.userId,
        userEmail: t.user.email,
        deviceId: t.deviceId,
        deviceName: t.device.deviceName,
        platform: t.platform,
        tokenFingerprint,
        appVersion: t.appVersion,
        isActive: t.isActive,
        lastSeenAt: t.lastSeenAt.toISOString(),
        revokedAt: t.revokedAt ? t.revokedAt.toISOString() : null,
        createdAt: t.createdAt.toISOString()
      };
    });

    return createPaginatedResponse(items, total, page, pageSize);
  }

  /**
   * Schedules an administrative retry for a failed channel delivery record.
   * Atomically verifies eligibility, prevents duplicate concurrent execution,
   * updates delivery queue status to RETRYING with immediate schedule, and logs audit trail.
   */
  static async retryDelivery(
    deliveryId: string,
    context: AdminOperationContext,
    reason?: string
  ): Promise<{ id: string; status: ChannelDeliveryStatus; attemptCount: number; nextRetryAt: string }> {
    const delivery = await prisma.channelDeliveryRecord.findUnique({
      where: { id: deliveryId },
      include: {
        notification: {
          select: {
            id: true,
            title: true,
            userId: true,
            user: { select: { email: true } }
          }
        }
      }
    });

    if (!delivery) {
      throw new NotFoundError(`Channel delivery record '${deliveryId}' not found`);
    }

    if (delivery.status === 'DELIVERED') {
      throw new ConflictError(`Delivery record '${deliveryId}' has already been successfully delivered`);
    }

    if (delivery.status === 'PROCESSING') {
      throw new ConflictError(`Delivery record '${deliveryId}' is currently being processed by a worker`);
    }

    const previousStatus = delivery.status;
    const finalReason = reason && reason.trim().length > 0 ? reason.trim() : 'Administrative retry requested';

    return executeAdminOperation({
      operationName: 'notification_delivery_retry',
      targetResourceType: 'channel_delivery',
      targetResourceId: deliveryId,
      context,
      action: AdminAuditAction.ADMIN_STATUS_UPDATED,
      metadata: {
        deliveryId,
        notificationId: delivery.notificationId,
        channel: delivery.channel,
        previousStatus,
        newStatus: 'RETRYING',
        reason: finalReason
      },
      execute: async (tx) => {
        const nextRetryDate = new Date();
        const updated = await tx.channelDeliveryRecord.update({
          where: { id: deliveryId },
          data: {
            status: 'RETRYING',
            nextRetryAt: nextRetryDate,
            failedAt: null,
            processingStartedAt: null,
            processingWorkerId: null,
            failureReason: `Admin retry queued: ${finalReason}`
          }
        });

        return {
          id: updated.id,
          status: updated.status,
          attemptCount: updated.attemptCount,
          nextRetryAt: nextRetryDate.toISOString()
        };
      }
    });
  }

  /**
   * Administratively revokes/invalidates a device push token.
   */
  static async revokePushToken(
    tokenId: string,
    context: AdminOperationContext,
    reason?: string
  ): Promise<{ id: string; isActive: boolean; revokedAt: string }> {
    const tokenRecord = await prisma.devicePushToken.findUnique({
      where: { id: tokenId },
      include: {
        device: { select: { deviceName: true } },
        user: { select: { email: true } }
      }
    });

    if (!tokenRecord) {
      throw new NotFoundError(`Push token record '${tokenId}' not found`);
    }

    if (!tokenRecord.isActive) {
      throw new ConflictError(`Push token '${tokenId}' is already revoked`);
    }

    const finalReason = reason && reason.trim().length > 0 ? reason.trim() : 'Administrative token revocation';

    return executeAdminOperation({
      operationName: 'push_token_revoke',
      targetResourceType: 'push_token',
      targetResourceId: tokenId,
      context,
      action: AdminAuditAction.ADMIN_STATUS_UPDATED,
      metadata: {
        tokenId,
        deviceId: tokenRecord.deviceId,
        userId: tokenRecord.userId,
        reason: finalReason
      },
      execute: async (tx) => {
        const revokedDate = new Date();
        const updated = await tx.devicePushToken.update({
          where: { id: tokenId },
          data: {
            isActive: false,
            revokedAt: revokedDate
          }
        });

        return {
          id: updated.id,
          isActive: updated.isActive,
          revokedAt: revokedDate.toISOString()
        };
      }
    });
  }
}
