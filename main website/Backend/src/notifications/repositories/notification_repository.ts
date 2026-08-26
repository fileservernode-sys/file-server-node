/**
 * RemoteNode Prisma Notification Persistence Repositories
 * Track 4 — Batch NT-1.2 Architecture
 */

import {
  NotificationRecordStatus,
  ChannelDeliveryStatus,
  PushPlatform,
  Prisma
} from '@prisma/client';
import { prisma } from '../../config/database.js';
import { SafeNotificationMetadata } from '../types/event.js';
import {
  UserNotificationPreferences,
  getDefaultNotificationPreferences
} from '../types/preference.js';

export interface CreateNotificationRecordInput {
  id?: string;
  eventId: string;
  userId: string;
  deviceId?: string;
  serverId?: string;
  eventType: string;
  category: string;
  severity: string;
  title: string;
  body: string;
  deepLinkUri?: string;
  webPath?: string;
  metadata?: SafeNotificationMetadata;
  idempotencyKey: string;
  occurredAt?: Date;
}

export interface CreateChannelDeliveryRecordInput {
  notificationId: string;
  channel: string;
  targetAddress?: string;
  targetDeviceId?: string;
  status?: ChannelDeliveryStatus;
  providerMessageId?: string;
  failureReason?: string;
  deliveredAt?: Date;
}

export interface RegisterPushTokenInput {
  userId: string;
  deviceId: string;
  token: string;
  platform?: PushPlatform;
  appVersion?: string;
}

export class NotificationRepository {
  // ---------------------------------------------------------------------------
  // 1. NotificationRecord Persistence
  // ---------------------------------------------------------------------------

  public async createNotificationRecord(input: CreateNotificationRecordInput) {
    try {
      return await prisma.notificationRecord.create({
        data: {
          id: input.id,
          eventId: input.eventId,
          userId: input.userId,
          deviceId: input.deviceId || null,
          serverId: input.serverId || null,
          eventType: input.eventType,
          category: input.category,
          severity: input.severity,
          title: input.title,
          body: input.body,
          deepLinkUri: input.deepLinkUri || null,
          webPath: input.webPath || null,
          metadata: input.metadata ? (input.metadata as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
          status: NotificationRecordStatus.UNREAD,
          idempotencyKey: input.idempotencyKey,
          occurredAt: input.occurredAt || new Date()
        }
      });
    } catch (err: any) {
      if (err?.code === 'P2003') {
        return null;
      }
      throw err;
    }
  }

  public async getNotificationById(id: string) {
    return prisma.notificationRecord.findUnique({
      where: { id },
      include: { deliveries: true }
    });
  }

  public async getNotificationByIdempotencyKey(idempotencyKey: string) {
    return prisma.notificationRecord.findUnique({
      where: { idempotencyKey }
    });
  }

  public async getUserNotifications(
    userId: string,
    options: { status?: NotificationRecordStatus; limit?: number; page?: number } = {}
  ) {
    const limit = Math.min(Math.max(options.limit || 20, 1), 100);
    const page = Math.max(options.page || 1, 1);
    const skip = (page - 1) * limit;

    const where: Prisma.NotificationRecordWhereInput = {
      userId,
      ...(options.status ? { status: options.status } : {})
    };

    const [items, total] = await Promise.all([
      prisma.notificationRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip
      }),
      prisma.notificationRecord.count({ where })
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  }

  public async getUnreadCount(userId: string): Promise<number> {
    return prisma.notificationRecord.count({
      where: {
        userId,
        status: NotificationRecordStatus.UNREAD
      }
    });
  }

  public async markAsRead(notificationId: string, userId: string) {
    const existing = await prisma.notificationRecord.findFirst({
      where: { id: notificationId, userId }
    });
    if (!existing) return null;

    return prisma.notificationRecord.update({
      where: { id: notificationId },
      data: {
        status: NotificationRecordStatus.READ,
        readAt: new Date()
      }
    });
  }

  public async markAsArchived(notificationId: string, userId: string) {
    const existing = await prisma.notificationRecord.findFirst({
      where: { id: notificationId, userId }
    });
    if (!existing) return null;

    return prisma.notificationRecord.update({
      where: { id: notificationId },
      data: {
        status: NotificationRecordStatus.ARCHIVED,
        archivedAt: new Date()
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 2. ChannelDeliveryRecord Persistence
  // ---------------------------------------------------------------------------

  public async createChannelDeliveryRecord(input: CreateChannelDeliveryRecordInput) {
    try {
      return await prisma.channelDeliveryRecord.create({
        data: {
          notificationId: input.notificationId,
          channel: input.channel,
          targetAddress: input.targetAddress || null,
          targetDeviceId: input.targetDeviceId || null,
          status: input.status || ChannelDeliveryStatus.QUEUED,
          attemptCount: 1,
          maxAttempts: 5,
          lastAttemptAt: new Date(),
          deliveredAt: input.deliveredAt || null,
          providerMessageId: input.providerMessageId || null,
          failureReason: input.failureReason || null
        }
      });
    } catch (err: any) {
      if (err?.code === 'P2003') {
        return null;
      }
      throw err;
    }
  }

  public async updateChannelDeliveryRecord(
    id: string,
    data: {
      status: ChannelDeliveryStatus;
      attemptCount?: number;
      lastAttemptAt?: Date;
      nextRetryAt?: Date;
      deliveredAt?: Date;
      failedAt?: Date;
      providerMessageId?: string;
      failureReason?: string;
    }
  ) {
    return prisma.channelDeliveryRecord.update({
      where: { id },
      data
    });
  }

  // ---------------------------------------------------------------------------
  // 3. UserNotificationPreferences Persistence
  // ---------------------------------------------------------------------------

  public async getUserPreferences(userId: string): Promise<UserNotificationPreferences> {
    const record = await prisma.userNotificationPreferences.findUnique({
      where: { userId }
    });

    if (!record) {
      return getDefaultNotificationPreferences(userId);
    }

    return {
      userId: record.userId,
      globalPushEnabled: record.globalPushEnabled,
      globalEmailEnabled: record.globalEmailEnabled,
      categories: record.categoryPreferences as any,
      updatedAt: record.updatedAt
    };
  }

  public async updateUserPreferences(
    userId: string,
    data: {
      globalPushEnabled?: boolean;
      globalEmailEnabled?: boolean;
      categories?: Record<string, any>;
    }
  ): Promise<UserNotificationPreferences> {
    const current = await this.getUserPreferences(userId);

    const updatedGlobalPush = data.globalPushEnabled ?? current.globalPushEnabled;
    const updatedGlobalEmail = data.globalEmailEnabled ?? current.globalEmailEnabled;
    const updatedCategories = {
      ...current.categories,
      ...(data.categories || {})
    };

    const record = await prisma.userNotificationPreferences.upsert({
      where: { userId },
      create: {
        userId,
        globalPushEnabled: updatedGlobalPush,
        globalEmailEnabled: updatedGlobalEmail,
        categoryPreferences: updatedCategories as unknown as Prisma.InputJsonValue
      },
      update: {
        globalPushEnabled: updatedGlobalPush,
        globalEmailEnabled: updatedGlobalEmail,
        categoryPreferences: updatedCategories as unknown as Prisma.InputJsonValue
      }
    });

    return {
      userId: record.userId,
      globalPushEnabled: record.globalPushEnabled,
      globalEmailEnabled: record.globalEmailEnabled,
      categories: record.categoryPreferences as any,
      updatedAt: record.updatedAt
    };
  }

  // ---------------------------------------------------------------------------
  // 4. DevicePushToken Persistence
  // ---------------------------------------------------------------------------

  public async registerOrUpdatePushToken(input: RegisterPushTokenInput) {
    const platform = input.platform || PushPlatform.ANDROID;
    const now = new Date();

    // Revoke any old active token for this exact device that differs from incoming token
    await prisma.devicePushToken.updateMany({
      where: {
        deviceId: input.deviceId,
        token: { not: input.token },
        isActive: true
      },
      data: {
        isActive: false,
        revokedAt: now
      }
    });

    // Upsert the token entity
    return prisma.devicePushToken.upsert({
      where: { token: input.token },
      create: {
        userId: input.userId,
        deviceId: input.deviceId,
        token: input.token,
        platform,
        appVersion: input.appVersion || null,
        isActive: true,
        lastSeenAt: now
      },
      update: {
        userId: input.userId,
        deviceId: input.deviceId,
        platform,
        appVersion: input.appVersion || null,
        isActive: true,
        revokedAt: null,
        lastSeenAt: now
      }
    });
  }

  public async revokePushToken(token: string, userId: string, deviceId: string) {
    const record = await prisma.devicePushToken.findFirst({
      where: { token, userId, deviceId }
    });
    if (!record) return null;

    return prisma.devicePushToken.update({
      where: { id: record.id },
      data: {
        isActive: false,
        revokedAt: new Date()
      }
    });
  }

  public async revokeDevicePushTokens(deviceId: string) {
    return prisma.devicePushToken.updateMany({
      where: { deviceId, isActive: true },
      data: {
        isActive: false,
        revokedAt: new Date()
      }
    });
  }

  public async getActivePushTokensForUser(userId: string) {
    return prisma.devicePushToken.findMany({
      where: { userId, isActive: true }
    });
  }

  public async getActivePushTokenForDevice(deviceId: string) {
    return prisma.devicePushToken.findFirst({
      where: { deviceId, isActive: true }
    });
  }
}

export const notificationRepository = new NotificationRepository();
