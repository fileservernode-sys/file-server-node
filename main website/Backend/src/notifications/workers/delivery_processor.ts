/**
 * RemoteNode Persistent Notification Delivery Processor & Retry Worker
 * Track 4 — Batch NT-1.6 Architecture
 */

import { prisma } from '../../config/database.js';
import { NotificationChannel } from '../types/channel.js';
import { calculateRetryDecision } from '../services/retry_policy.js';
import { notificationService, CentralNotificationService } from '../services/notification_service.js';
import { templateRegistry } from '../services/template_registry.js';
import { NotificationType } from '../types/type_registry.js';
import { ProviderDeliveryRequest } from '../providers/provider_interface.js';
import { notificationRepository } from '../repositories/notification_repository.js';
import { notificationMetrics } from '../services/notification_metrics.js';
import { providerCircuitBreaker } from '../services/provider_circuit_breaker.js';
import { failureClassifier } from '../services/failure_classifier.js';

export interface DeliveryProcessorResult {
  processedCount: number;
  deliveredCount: number;
  retryingCount: number;
  failedCount: number;
}

export class DeliveryProcessor {
  private service: CentralNotificationService;
  private providerTimeoutMs: number;

  constructor(service: CentralNotificationService = notificationService, providerTimeoutMs: number = 10000) {
    this.service = service;
    this.providerTimeoutMs = providerTimeoutMs;
  }

  /**
   * Atomically claims a delivery job for a specific worker instance.
   * Ensures multi-worker concurrency protection: returns true only if this worker successfully transitions row status to PROCESSING.
   */
  public async claimDeliveryJob(deliveryId: string, workerId: string): Promise<boolean> {
    const now = new Date();
    try {
      const updateResult = await prisma.channelDeliveryRecord.updateMany({
        where: {
          id: deliveryId,
          status: { in: ['QUEUED', 'RETRYING'] }
        },
        data: {
          status: 'PROCESSING',
          processingStartedAt: now,
          processingWorkerId: workerId,
          lastAttemptAt: now,
          attemptCount: { increment: 1 }
        }
      });
      return updateResult.count > 0;
    } catch {
      return false;
    }
  }

  /**
   * Identifies stuck PROCESSING records whose processing lease has expired and returns them to RETRYING for re-delivery.
   */
  public async recoverStaleProcessingClaims(leaseTimeoutMs: number = 300000): Promise<number> {
    try {
      const cutoff = new Date(Date.now() - leaseTimeoutMs);
      const updateResult = await prisma.channelDeliveryRecord.updateMany({
        where: {
          status: 'PROCESSING',
          processingStartedAt: { lte: cutoff }
        },
        data: {
          status: 'RETRYING',
          nextRetryAt: new Date(),
          processingStartedAt: null,
          processingWorkerId: null,
          failureReason: 'Stale processing claim lease expired (worker crash recovery)'
        }
      });

      if (updateResult.count > 0) {
        notificationMetrics.recordStaleClaimRecovery(updateResult.count);
      }
      return updateResult.count;
    } catch (err) {
      console.error('[DeliveryProcessor] Stale processing claim recovery error:', err);
      return 0;
    }
  }

  public async processPendingDeliveries(
    batchSize: number = 20,
    workerId: string = 'default-processor',
    leaseTimeoutMs: number = 300000
  ): Promise<DeliveryProcessorResult> {
    const result: DeliveryProcessorResult = {
      processedCount: 0,
      deliveredCount: 0,
      retryingCount: 0,
      failedCount: 0
    };

    try {
      // 1. Recover stale processing claims
      await this.recoverStaleProcessingClaims(leaseTimeoutMs);

      const now = new Date();

      // 2. Fetch eligible QUEUED and RETRYING records
      const eligibleRecords = await prisma.channelDeliveryRecord.findMany({
        where: {
          status: { in: ['QUEUED', 'RETRYING'] },
          OR: [
            { nextRetryAt: null },
            { nextRetryAt: { lte: now } }
          ]
        },
        take: batchSize,
        orderBy: { createdAt: 'asc' }
      });

      if (eligibleRecords.length === 0) {
        return result;
      }

      // 3. Atomically claim and process each record
      for (const delivery of eligibleRecords) {
        const claimed = await this.claimDeliveryJob(delivery.id, workerId);
        if (!claimed) {
          continue; // Competitor worker claimed it concurrently
        }

        notificationMetrics.recordJobClaim();
        result.processedCount++;

        const deliveryResult = await this.processSingleDelivery(delivery, workerId);

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

  private async processSingleDelivery(
    delivery: any,
    workerId: string
  ): Promise<'DELIVERED' | 'RETRYING' | 'PERMANENTLY_FAILED'> {
    const now = new Date();

    const notifRecord = await prisma.notificationRecord.findUnique({
      where: { id: delivery.notificationId }
    });

    if (!notifRecord) {
      await prisma.channelDeliveryRecord.update({
        where: { id: delivery.id },
        data: {
          status: 'PERMANENTLY_FAILED',
          failedAt: now,
          failureReason: 'Associated NotificationRecord not found',
          processingStartedAt: null,
          processingWorkerId: workerId
        }
      });
      return 'PERMANENTLY_FAILED';
    }

    const channel = delivery.channel as NotificationChannel;

    // Circuit Breaker Guard Check
    if (!providerCircuitBreaker.canExecute(channel)) {
      notificationMetrics.recordCircuitBreakerBlocked();
      const reason = `Provider circuit breaker OPEN for channel ${channel}`;
      await prisma.channelDeliveryRecord.update({
        where: { id: delivery.id },
        data: {
          status: 'RETRYING',
          nextRetryAt: new Date(Date.now() + 60000), // Retry after 1 min cooldown
          failureReason: reason,
          processingStartedAt: null,
          processingWorkerId: workerId
        }
      });
      notificationMetrics.recordDeliveryFailure(channel, false, reason);
      return 'RETRYING';
    }

    const provider = this.service.getProvider(channel);

    if (!provider) {
      const reason = `No provider registered for channel ${channel}`;
      await prisma.channelDeliveryRecord.update({
        where: { id: delivery.id },
        data: {
          status: 'PERMANENTLY_FAILED',
          failedAt: now,
          failureReason: reason,
          processingStartedAt: null,
          processingWorkerId: workerId
        }
      });
      notificationMetrics.recordDeliveryFailure(channel, true, reason);
      return 'PERMANENTLY_FAILED';
    }

    const rendered = templateRegistry.render(
      notifRecord.eventType as NotificationType,
      (notifRecord.metadata as any) || {},
      notifRecord.occurredAt
    );

    const correlationId =
      delivery.correlationId ||
      notifRecord.correlationId ||
      `notif_corr_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

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

    try {
      // 10-Second Timeout Race Wrapper
      let timeoutHandle: NodeJS.Timeout | null = null;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error('Provider request timed out after 10000ms')), this.providerTimeoutMs);
      });

      const providerResult = await Promise.race([provider.send(request), timeoutPromise]).finally(() => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      });

      if (providerResult.success) {
        providerCircuitBreaker.recordSuccess(channel);

        const deliveredTime = providerResult.deliveredAt || new Date();
        await prisma.channelDeliveryRecord.update({
          where: { id: delivery.id },
          data: {
            status: 'DELIVERED',
            deliveredAt: deliveredTime,
            providerMessageId: providerResult.externalMessageId || null,
            correlationId,
            processingStartedAt: null,
            processingWorkerId: workerId
          }
        });

        // Calculate latency metrics
        const queueLatencyMs = Math.max(0, now.getTime() - new Date(delivery.createdAt).getTime());
        const deliveryLatencyMs = Math.max(0, deliveredTime.getTime() - now.getTime());
        const totalLatencyMs = queueLatencyMs + deliveryLatencyMs;

        notificationMetrics.recordDeliverySuccess(channel, {
          queueLatencyMs,
          deliveryLatencyMs,
          totalLatencyMs
        });

        return 'DELIVERED';
      } else {
        const rawMsg = providerResult.errorMessage || 'Unknown delivery failure';
        const classification = failureClassifier.classify(rawMsg, providerResult.externalMessageId);

        if (!classification.retryable) {
          providerCircuitBreaker.recordFailure(channel);

          await prisma.channelDeliveryRecord.update({
            where: { id: delivery.id },
            data: {
              status: 'PERMANENTLY_FAILED',
              failedAt: now,
              failureReason: classification.safePublicReason,
              providerResponseCode: classification.providerResponseCode,
              correlationId,
              processingStartedAt: null,
              processingWorkerId: workerId
            }
          });

          if (classification.category === 'INVALID_TOKEN' && delivery.targetAddress && notifRecord.deviceId) {
            await notificationRepository.revokePushToken(notifRecord.userId, notifRecord.deviceId, delivery.targetAddress);
          }

          notificationMetrics.recordDeliveryFailure(channel, true, classification.safePublicReason);
          return 'PERMANENTLY_FAILED';
        } else {
          providerCircuitBreaker.recordFailure(channel);

          const currentAttemptNumber = (delivery.attemptCount || 0) + 1;
          const isExhausted = currentAttemptNumber >= delivery.maxAttempts;

          if (isExhausted) {
            await prisma.channelDeliveryRecord.update({
              where: { id: delivery.id },
              data: {
                status: 'PERMANENTLY_FAILED',
                failedAt: now,
                failureReason: `Retry attempts exhausted (${currentAttemptNumber}/${delivery.maxAttempts}): ${classification.safePublicReason}`,
                providerResponseCode: classification.providerResponseCode,
                correlationId,
                processingStartedAt: null,
                processingWorkerId: workerId
              }
            });

            notificationMetrics.recordDeliveryFailure(channel, true, classification.safePublicReason);
            return 'PERMANENTLY_FAILED';
          } else {
            const retryDecision = calculateRetryDecision(currentAttemptNumber, rawMsg);

            await prisma.channelDeliveryRecord.update({
              where: { id: delivery.id },
              data: {
                status: 'RETRYING',
                nextRetryAt: retryDecision.nextAttemptAt || new Date(Date.now() + classification.recommendedDelayMs),
                failureReason: classification.safePublicReason,
                providerResponseCode: classification.providerResponseCode,
                correlationId,
                processingStartedAt: null,
                processingWorkerId: workerId
              }
            });

            notificationMetrics.recordDeliveryFailure(channel, false, classification.safePublicReason);
            return 'RETRYING';
          }
        }
      }
    } catch (err: any) {
      providerCircuitBreaker.recordFailure(channel);

      const rawMsg = err?.message || String(err);
      const classification = failureClassifier.classify(rawMsg);
      const currentAttemptNumber = (delivery.attemptCount || 0) + 1;
      const isExhausted = !classification.retryable || currentAttemptNumber >= delivery.maxAttempts;

      await prisma.channelDeliveryRecord.update({
        where: { id: delivery.id },
        data: {
          status: isExhausted ? 'PERMANENTLY_FAILED' : 'RETRYING',
          failedAt: isExhausted ? now : null,
          nextRetryAt: isExhausted ? null : new Date(Date.now() + classification.recommendedDelayMs),
          failureReason: classification.safePublicReason,
          providerResponseCode: classification.providerResponseCode,
          correlationId,
          processingStartedAt: null,
          processingWorkerId: workerId
        }
      });

      notificationMetrics.recordDeliveryFailure(channel, isExhausted, classification.safePublicReason);
      return isExhausted ? 'PERMANENTLY_FAILED' : 'RETRYING';
    }
  }
}

export const defaultDeliveryProcessor = new DeliveryProcessor();
