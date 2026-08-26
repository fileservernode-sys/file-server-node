/**
 * RemoteNode Persistent Notification Delivery Processor & Retry Worker
 * Track 4 — Batch NT-1.4 Architecture
 */

import { prisma } from '../../config/database.js';
import { DeliveryStatus } from '../types/lifecycle.js';
import { NotificationChannel } from '../types/channel.js';
import { calculateRetryDecision } from '../services/retry_policy.js';
import { notificationService, CentralNotificationService } from '../services/notification_service.js';
import { templateRegistry } from '../services/template_registry.js';
import { NotificationType } from '../types/type_registry.js';
import { ProviderDeliveryRequest } from '../providers/provider_interface.js';
import { notificationRepository } from '../repositories/notification_repository.js';

export interface DeliveryProcessorResult {
  processedCount: number;
  deliveredCount: number;
  retryingCount: number;
  failedCount: number;
}

export class DeliveryProcessor {
  private service: CentralNotificationService;

  constructor(service: CentralNotificationService = notificationService) {
    this.service = service;
  }

  public async processPendingDeliveries(batchSize: number = 20): Promise<DeliveryProcessorResult> {
    const result: DeliveryProcessorResult = {
      processedCount: 0,
      deliveredCount: 0,
      retryingCount: 0,
      failedCount: 0
    };

    try {
      const now = new Date();

      const eligibleRecords = await prisma.channelDeliveryRecord.findMany({
        where: {
          status: { in: ['QUEUED', 'RETRYING'] },
          nextRetryAt: { lte: now }
        },
        take: batchSize,
        orderBy: { nextRetryAt: 'asc' }
      });

      if (eligibleRecords.length === 0) {
        return result;
      }

      for (const delivery of eligibleRecords) {
        result.processedCount++;
        const deliveryResult = await this.processSingleDelivery(delivery);

        if (deliveryResult === 'DELIVERED') {
          result.deliveredCount++;
        } else if (deliveryResult === 'RETRYING') {
          result.retryingCount++;
        } else {
          result.failedCount++;
        }
      }
    } catch (err) {
      console.error('[DeliveryProcessor] Error in processing tick:', err);
    }

    return result;
  }

  private async processSingleDelivery(delivery: any): Promise<'DELIVERED' | 'RETRYING' | 'PERMANENTLY_FAILED'> {
    const now = new Date();

    try {
      await prisma.channelDeliveryRecord.update({
        where: { id: delivery.id },
        data: {
          status: 'PROCESSING',
          lastAttemptAt: now,
          attemptCount: { increment: 1 }
        }
      });
    } catch {
      return 'PERMANENTLY_FAILED';
    }

    const notifRecord = await prisma.notificationRecord.findUnique({
      where: { id: delivery.notificationId }
    });

    if (!notifRecord) {
      await prisma.channelDeliveryRecord.update({
        where: { id: delivery.id },
        data: {
          status: 'PERMANENTLY_FAILED',
          failedAt: now,
          failureReason: 'Associated NotificationRecord not found'
        }
      });
      return 'PERMANENTLY_FAILED';
    }

    const channel = delivery.channel as NotificationChannel;
    const provider = this.service.getProvider(channel);

    if (!provider) {
      await prisma.channelDeliveryRecord.update({
        where: { id: delivery.id },
        data: {
          status: 'PERMANENTLY_FAILED',
          failedAt: now,
          failureReason: `No provider registered for channel ${channel}`
        }
      });
      return 'PERMANENTLY_FAILED';
    }

    const rendered = templateRegistry.render(
      notifRecord.eventType as NotificationType,
      (notifRecord.metadata as any) || {},
      notifRecord.occurredAt
    );

    const request: ProviderDeliveryRequest = {
      deliveryId: delivery.id,
      notificationId: notifRecord.id,
      userId: notifRecord.userId,
      targetAddress: delivery.targetAddress || undefined,
      targetDeviceId: delivery.targetDeviceId || notifRecord.deviceId || undefined,
      event: {
        eventId: notifRecord.eventId,
        userId: notifRecord.userId,
        deviceId: notifRecord.deviceId || undefined,
        serverId: notifRecord.serverId || undefined,
        eventType: notifRecord.eventType as NotificationType,
        category: notifRecord.category as any,
        severity: notifRecord.severity as any,
        metadata: (notifRecord.metadata as any) || {},
        occurredAt: notifRecord.occurredAt,
        idempotencyKey: notifRecord.idempotencyKey,
        source: 'delivery-processor'
      },
      rendered
    };

    const providerResult = await provider.send(request);

    if (providerResult.success) {
      await prisma.channelDeliveryRecord.update({
        where: { id: delivery.id },
        data: {
          status: 'DELIVERED',
          deliveredAt: providerResult.deliveredAt || now,
          providerMessageId: providerResult.externalMessageId || null
        }
      });
      return 'DELIVERED';
    } else {
      const errMsg = providerResult.errorMessage || 'Unknown delivery failure';
      const isPermanent =
        /PERMANENT_FAILURE/i.test(errMsg) ||
        /INVALID_TOKEN/i.test(errMsg) ||
        /INVALID_ADDRESS/i.test(errMsg) ||
        delivery.attemptCount >= delivery.maxAttempts;

      if (isPermanent) {
        await prisma.channelDeliveryRecord.update({
          where: { id: delivery.id },
          data: {
            status: 'PERMANENTLY_FAILED',
            failedAt: now,
            failureReason: errMsg
          }
        });

        if (/INVALID_TOKEN/i.test(errMsg) && delivery.targetAddress && notifRecord.deviceId) {
          await notificationRepository.revokePushToken(notifRecord.userId, notifRecord.deviceId, delivery.targetAddress);
        }

        return 'PERMANENTLY_FAILED';
      } else {
        const nextAttempt = delivery.attemptCount + 1;
        const retryDecision = calculateRetryDecision(nextAttempt, errMsg);

        await prisma.channelDeliveryRecord.update({
          where: { id: delivery.id },
          data: {
            status: 'RETRYING',
            nextRetryAt: retryDecision.nextAttemptAt || new Date(Date.now() + 60000),
            failureReason: errMsg
          }
        });
        return 'RETRYING';
      }
    }
  }
}

export const defaultDeliveryProcessor = new DeliveryProcessor();
