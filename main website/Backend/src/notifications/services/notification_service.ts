/**
 * RemoteNode Central Notification Service Engine with Persistence & Reliability Controls
 * Track 4 — Batch NT-1.6 Architecture
 */

import { NotificationEvent, NotificationEventInput, createNotificationEvent } from '../types/event.js';
import { NotificationState } from '../types/lifecycle.js';
import { NotificationChannel } from '../types/channel.js';
import { templateRegistry } from './template_registry.js';
import { defaultIdempotencyManager, IdempotencyManager } from './idempotency.js';
import { defaultStormProtection, NotificationStormProtection } from './storm_protection.js';
import { defaultChannelRouter, ChannelRouter, DeviceRoutingTarget } from './channel_router.js';
import { UserNotificationPreferences } from '../types/preference.js';
import {
  NotificationProvider,
  ProviderDeliveryResult
} from '../providers/provider_interface.js';
import { defaultFcmPushProvider } from '../providers/fcm_provider.js';
import { defaultEmailNotificationProvider } from '../providers/email_provider.js';
import { notificationRepository, NotificationRepository } from '../repositories/notification_repository.js';
import { notificationMetrics } from './notification_metrics.js';
import { notificationRateLimiter, NotificationRateLimiter } from './rate_limiter.js';
import { providerCircuitBreaker } from './provider_circuit_breaker.js';
import { prisma } from '../../config/database.js';

export interface NotificationRecordDTO {
  id: string;
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
  metadata: Record<string, any>;
  state: NotificationState;
  correlationId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationProcessingResult {
  notificationId?: string;
  eventId: string;
  idempotencyKey: string;
  correlationId?: string;
  processed: boolean;
  duplicateSuppressed: boolean;
  stormSuppressed: boolean;
  coalesced: boolean;
  throttled: boolean;
  renderedTitle?: string;
  renderedBody?: string;
  allowedChannels: NotificationChannel[];
  deliveryResults: ProviderDeliveryResult[];
}

export class CentralNotificationService {
  private idempotencyManager: IdempotencyManager;
  private stormProtection: NotificationStormProtection;
  private channelRouter: ChannelRouter;
  private repository: NotificationRepository;
  private rateLimiter: NotificationRateLimiter;
  private providers: Map<NotificationChannel, NotificationProvider> = new Map();

  // In-memory fallback cache for fast lookups
  private notificationRecordsCache: Map<string, NotificationRecordDTO> = new Map();

  constructor(
    idempotencyManager: IdempotencyManager = defaultIdempotencyManager,
    stormProtection: NotificationStormProtection = defaultStormProtection,
    channelRouter: ChannelRouter = defaultChannelRouter,
    repository: NotificationRepository = notificationRepository,
    rateLimiter: NotificationRateLimiter = notificationRateLimiter
  ) {
    this.idempotencyManager = idempotencyManager;
    this.stormProtection = stormProtection;
    this.channelRouter = channelRouter;
    this.repository = repository;
    this.rateLimiter = rateLimiter;

    // Register production & fallback providers
    this.registerProvider(defaultFcmPushProvider);
    this.registerProvider(defaultEmailNotificationProvider);
  }

  public registerProvider(provider: NotificationProvider): void {
    this.providers.set(provider.channel, provider);
  }

  public getProvider(channel: NotificationChannel): NotificationProvider | undefined {
    return this.providers.get(channel);
  }

  /**
   * Primary Entry Point: Create, Persist, and Dispatch a Canonical Notification Event
   */
  public async dispatchEvent(
    input: NotificationEventInput,
    userPreferences?: UserNotificationPreferences,
    userDevices: DeviceRoutingTarget[] = []
  ): Promise<NotificationProcessingResult> {
    const event: NotificationEvent = createNotificationEvent(input);
    const correlationId = `notif_corr_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    notificationMetrics.recordDispatchedEvent();

    // 1. IDEMPOTENCY CHECK (Memory + Database)
    const isMemoryDuplicate = await this.idempotencyManager.isProcessed(event.idempotencyKey);
    if (isMemoryDuplicate) {
      notificationMetrics.recordDuplicateSuppression();
      return {
        eventId: event.eventId,
        idempotencyKey: event.idempotencyKey,
        correlationId,
        processed: false,
        duplicateSuppressed: true,
        stormSuppressed: false,
        coalesced: false,
        throttled: false,
        allowedChannels: [],
        deliveryResults: []
      };
    }

    try {
      const dbExisting = await this.repository.getNotificationByIdempotencyKey(event.idempotencyKey);
      if (dbExisting) {
        await this.idempotencyManager.recordProcessing(event.idempotencyKey, event.eventId);
        notificationMetrics.recordDuplicateSuppression();
        return {
          eventId: event.eventId,
          idempotencyKey: event.idempotencyKey,
          correlationId: dbExisting.correlationId || correlationId,
          processed: false,
          duplicateSuppressed: true,
          stormSuppressed: false,
          coalesced: false,
          throttled: false,
          allowedChannels: [],
          deliveryResults: []
        };
      }
    } catch {
      // Non-blocking database check fallback
    }

    // Record memory idempotency key
    await this.idempotencyManager.recordProcessing(event.idempotencyKey, event.eventId);

    // 2. RATE LIMIT CHECK
    const rateLimitResult = this.rateLimiter.checkRateLimit({
      userId: event.userId,
      deviceId: event.deviceId,
      eventType: event.eventType,
      category: event.category,
      severity: event.severity
    });

    if (!rateLimitResult.allowed) {
      notificationMetrics.recordRateLimitThrottled();
      console.warn(`[NotificationService] Event ${event.eventType} throttled at tier ${rateLimitResult.tier} for user ${event.userId}`);
      return {
        eventId: event.eventId,
        idempotencyKey: event.idempotencyKey,
        correlationId,
        processed: false,
        duplicateSuppressed: false,
        stormSuppressed: false,
        coalesced: false,
        throttled: true,
        allowedChannels: [],
        deliveryResults: []
      };
    }

    // 3. EVENT COALESCING CHECK (Flapping State Protection)
    if (this.stormProtection.shouldCoalesceStateFlip(event)) {
      notificationMetrics.recordEventCoalesced();
      console.log(`[NotificationService] State flip event ${event.eventType} coalesced for target ${event.userId}:${event.deviceId}`);
      return {
        eventId: event.eventId,
        idempotencyKey: event.idempotencyKey,
        correlationId,
        processed: false,
        duplicateSuppressed: false,
        stormSuppressed: false,
        coalesced: true,
        throttled: false,
        allowedChannels: [],
        deliveryResults: []
      };
    }

    // 4. STORM PROTECTION CHECK
    if (this.stormProtection.shouldSuppress(event)) {
      notificationMetrics.recordStormSuppression();
      return {
        eventId: event.eventId,
        idempotencyKey: event.idempotencyKey,
        correlationId,
        processed: false,
        duplicateSuppressed: false,
        stormSuppressed: true,
        coalesced: false,
        throttled: false,
        allowedChannels: [],
        deliveryResults: []
      };
    }

    this.rateLimiter.recordEvent({
      userId: event.userId,
      deviceId: event.deviceId,
      eventType: event.eventType,
      category: event.category,
      severity: event.severity
    });

    // 5. RESOLVE USER PREFERENCES & ACTIVE PUSH TOKENS
    const effectivePreferences = userPreferences || (await this.repository.getUserPreferences(event.userId));

    let effectiveDevices = userDevices;
    if (effectiveDevices.length === 0) {
      try {
        const activeTokens = await this.repository.getActivePushTokensForUser(event.userId);
        effectiveDevices = activeTokens.map(t => ({
          deviceId: t.deviceId,
          pushToken: t.token
        }));
      } catch {
        effectiveDevices = [];
      }
    }

    // 6. TEMPLATE RENDERING
    const rendered = templateRegistry.render(event.eventType, event.metadata, event.occurredAt);

    // 7. PREFERENCE & MULTI-DEVICE ROUTING EVALUATION
    const routingDecision = this.channelRouter.evaluateRouting(event, effectivePreferences, effectiveDevices);

    // 8. CREATE PERSISTENT NOTIFICATION RECORD
    const notificationId = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const notificationDTO: NotificationRecordDTO = {
      id: notificationId,
      eventId: event.eventId,
      userId: event.userId,
      deviceId: event.deviceId,
      serverId: event.serverId,
      eventType: event.eventType,
      category: event.category,
      severity: event.severity,
      title: rendered.title,
      body: rendered.body,
      deepLinkUri: rendered.deepLink?.uri,
      webPath: rendered.deepLink?.webPath,
      metadata: event.metadata,
      state: NotificationState.UNREAD,
      correlationId,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.notificationRecordsCache.set(notificationId, notificationDTO);

    try {
      await this.repository.createNotificationRecord({
        id: notificationId,
        eventId: event.eventId,
        userId: event.userId,
        deviceId: event.deviceId,
        serverId: event.serverId,
        eventType: event.eventType,
        category: event.category,
        severity: event.severity,
        title: rendered.title,
        body: rendered.body,
        deepLinkUri: rendered.deepLink?.uri,
        webPath: rendered.deepLink?.webPath,
        metadata: event.metadata,
        idempotencyKey: event.idempotencyKey,
        correlationId,
        occurredAt: event.occurredAt
      });
    } catch (dbErr: any) {
      // If unique constraint on idempotencyKey violated during race condition
      if (dbErr?.code === 'P2002') {
        notificationMetrics.recordDuplicateSuppression();
        return {
          eventId: event.eventId,
          idempotencyKey: event.idempotencyKey,
          correlationId,
          processed: false,
          duplicateSuppressed: true,
          stormSuppressed: false,
          coalesced: false,
          throttled: false,
          allowedChannels: [],
          deliveryResults: []
        };
      }
    }

    // 9. CHANNEL DELIVERY DISPATCH & PERSISTENCE
    const deliveryResults: ProviderDeliveryResult[] = [];

    for (const channel of routingDecision.allowedChannels) {
      if (channel === NotificationChannel.IN_APP) {
        // Channel-level deduplication: Skip if already delivered for this notification
        try {
          const existingInApp = await this.repository.getDeliveryRecordByTarget(notificationId, NotificationChannel.IN_APP);
          if (existingInApp && existingInApp.status === ('DELIVERED' as any)) {
            deliveryResults.push({
              success: true,
              channel: NotificationChannel.IN_APP,
              providerName: 'InternalInAppStore',
              deliveredAt: existingInApp.deliveredAt || new Date()
            });
            continue;
          }
        } catch {}

        deliveryResults.push({
          success: true,
          channel: NotificationChannel.IN_APP,
          providerName: 'InternalInAppStore',
          deliveredAt: new Date()
        });

        try {
          await this.repository.createChannelDeliveryRecord({
            notificationId,
            channel: NotificationChannel.IN_APP,
            status: 'DELIVERED' as any,
            correlationId,
            deliveredAt: new Date()
          });
        } catch {}
        continue;
      }

      // Check Circuit Breaker prior to dispatch attempt
      if (!providerCircuitBreaker.canExecute(channel)) {
        notificationMetrics.recordCircuitBreakerBlocked();
        try {
          await this.repository.createChannelDeliveryRecord({
            notificationId,
            channel,
            status: 'QUEUED' as any,
            failureReason: `Provider circuit breaker OPEN for channel ${channel}`,
            correlationId
          });
        } catch {}
        continue;
      }

      const provider = this.providers.get(channel);
      if (provider) {
        let targetAddresses: string[] = [];
        if (channel === NotificationChannel.PUSH) {
          const targetDevices = routingDecision.targetDevices.length > 0
            ? routingDecision.targetDevices
            : effectiveDevices;
          const rawTokens = targetDevices.map(d => d.pushToken || '').filter(t => t.length > 0);
          if (rawTokens.length === 0 && event.metadata.pushToken) {
            rawTokens.push(String(event.metadata.pushToken));
          }
          // Deduplicate push tokens to prevent multi-send to same device
          targetAddresses = Array.from(new Set(rawTokens));
        } else if (channel === NotificationChannel.EMAIL) {
          const rawEmails: string[] = [];
          if (event.metadata.userEmail) {
            rawEmails.push(String(event.metadata.userEmail));
          } else if (event.userId) {
            try {
              const user = await prisma.user.findUnique({
                where: { id: event.userId },
                select: { email: true }
              });
              if (user?.email) {
                rawEmails.push(user.email.trim());
              }
            } catch {
              // Non-blocking lookup fallback
            }
          }
          // Deduplicate emails normalized to lowercase
          targetAddresses = Array.from(new Set(rawEmails.map(e => e.trim().toLowerCase()).filter(e => e.length > 0)));
        }

        if (targetAddresses.length === 0) {
          // If no devices or destination tokens exist for this channel, skip dispatch cleanly
          continue;
        }

        for (const address of targetAddresses) {
          // Channel-level deduplication: Skip if already delivered for this notification
          try {
            const existingDelivery = await this.repository.getDeliveryRecordByTarget(notificationId, channel, address);
            if (existingDelivery && existingDelivery.status === ('DELIVERED' as any)) {
              console.log(`[NotificationService] Duplicate channel delivery skipped: notificationId=${notificationId}, channel=${channel}, target=${address}`);
              deliveryResults.push({
                success: true,
                channel,
                providerName: provider.providerName,
                deliveredAt: existingDelivery.deliveredAt || new Date()
              });
              continue;
            }
          } catch {
            // Non-blocking check fallback
          }

          const deliveryId = `del_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          try {
            const result = await provider.send({
              deliveryId,
              notificationId,
              userId: event.userId,
              targetAddress: address,
              event,
              rendered
            });

            deliveryResults.push(result);

            if (result.success) {
              providerCircuitBreaker.recordSuccess(channel);
            } else {
              providerCircuitBreaker.recordFailure(channel);
            }

            // Handle FCM Invalid Token Revocation
            if (!result.success && result.errorMessage?.includes('INVALID_TOKEN')) {
              try {
                await prisma.devicePushToken.updateMany({
                  where: { token: address, isActive: true },
                  data: { isActive: false, revokedAt: new Date() }
                });
              } catch {}
            }

            try {
              await this.repository.createChannelDeliveryRecord({
                notificationId,
                channel,
                targetAddress: address,
                status: result.success
                  ? ('DELIVERED' as any)
                  : result.errorMessage?.includes('INVALID_TOKEN')
                  ? ('PERMANENTLY_FAILED' as any)
                  : ('FAILED' as any),
                providerMessageId: result.externalMessageId || undefined,
                failureReason: result.errorMessage,
                correlationId,
                deliveredAt: result.deliveredAt
              });
            } catch {}
          } catch (err: any) {
            providerCircuitBreaker.recordFailure(channel);
            deliveryResults.push({
              success: false,
              channel,
              providerName: provider.providerName,
              errorMessage: err?.message || 'Provider execution exception'
            });
          }
        }
      }
    }

    // 10. OPTIONAL AUDIT EVENT INTEGRATION
    try {
      if (prisma && prisma.auditEvent) {
        await prisma.auditEvent.create({
          data: {
            userId: event.userId,
            deviceId: event.deviceId || null,
            eventType: 'NOTIFICATION_CREATED',
            metadata: {
              notificationId,
              notificationType: event.eventType,
              category: event.category,
              severity: event.severity,
              correlationId
            }
          }
        }).catch(() => {});
      }
    } catch {}

    return {
      notificationId,
      eventId: event.eventId,
      idempotencyKey: event.idempotencyKey,
      correlationId,
      processed: true,
      duplicateSuppressed: false,
      stormSuppressed: false,
      coalesced: false,
      throttled: false,
      renderedTitle: rendered.title,
      renderedBody: rendered.body,
      allowedChannels: routingDecision.allowedChannels,
      deliveryResults
    };
  }

  public async getNotification(notificationId: string): Promise<NotificationRecordDTO | undefined> {
    const cached = this.notificationRecordsCache.get(notificationId);
    if (cached) return cached;

    try {
      const record = await this.repository.getNotificationById(notificationId);
      if (record) {
        return {
          id: record.id,
          eventId: record.eventId,
          userId: record.userId,
          deviceId: record.deviceId || undefined,
          serverId: record.serverId || undefined,
          eventType: record.eventType,
          category: record.category,
          severity: record.severity,
          title: record.title,
          body: record.body,
          deepLinkUri: record.deepLinkUri || undefined,
          webPath: record.webPath || undefined,
          metadata: (record.metadata as any) || {},
          state: record.status as any,
          correlationId: record.correlationId || undefined,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt
        };
      }
    } catch {}

    return undefined;
  }

  public async getUserNotifications(userId: string, limit = 20, page = 1) {
    try {
      return await this.repository.getUserNotifications(userId, { limit, page });
    } catch {
      const cached = Array.from(this.notificationRecordsCache.values())
        .filter(n => n.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return {
        items: cached,
        total: cached.length,
        page: 1,
        limit: 20,
        totalPages: 1
      };
    }
  }

  public async markAsRead(notificationId: string, userId: string): Promise<boolean> {
    const cached = this.notificationRecordsCache.get(notificationId);
    if (cached && cached.userId === userId) {
      cached.state = NotificationState.READ;
      cached.updatedAt = new Date();
    }

    try {
      const result = await this.repository.markAsRead(notificationId, userId);
      return !!result;
    } catch {
      return !!cached;
    }
  }

  public async markAsArchived(notificationId: string, userId: string): Promise<boolean> {
    const cached = this.notificationRecordsCache.get(notificationId);
    if (cached && cached.userId === userId) {
      cached.state = NotificationState.ARCHIVED;
      cached.updatedAt = new Date();
    }

    try {
      const result = await this.repository.markAsArchived(notificationId, userId);
      return !!result;
    } catch {
      return !!cached;
    }
  }

  /**
   * Retries undelivered channels for an existing notification without re-sending to channels that already succeeded.
   */
  public async redeliverNotification(notificationId: string): Promise<NotificationProcessingResult | null> {
    const record = await this.repository.getNotificationById(notificationId);
    if (!record) return null;

    const existingDeliveries = await this.repository.getDeliveryRecordsForNotification(notificationId);
    const deliveredChannels = new Set(
      existingDeliveries
        .filter(d => d.status === ('DELIVERED' as any))
        .map(d => `${d.channel}:${d.targetAddress || ''}`)
    );

    const input: NotificationEventInput = {
      eventId: record.eventId,
      eventType: record.eventType as any,
      userId: record.userId,
      deviceId: record.deviceId || undefined,
      serverId: record.serverId || undefined,
      category: record.category as any,
      severity: record.severity as any,
      idempotencyKey: record.idempotencyKey,
      metadata: (record.metadata as any) || {},
      occurredAt: record.occurredAt
    };

    const event = createNotificationEvent(input);
    const effectivePreferences = await this.repository.getUserPreferences(event.userId);
    let effectiveDevices: DeviceRoutingTarget[] = [];
    try {
      const activeTokens = await this.repository.getActivePushTokensForUser(event.userId);
      effectiveDevices = activeTokens.map(t => ({ deviceId: t.deviceId, pushToken: t.token }));
    } catch {}

    const routingDecision = this.channelRouter.evaluateRouting(event, effectivePreferences, effectiveDevices);
    const rendered = templateRegistry.render(event.eventType, event.metadata, event.occurredAt);
    const deliveryResults: ProviderDeliveryResult[] = [];

    for (const channel of routingDecision.allowedChannels) {
      if (channel === NotificationChannel.IN_APP) {
        if (deliveredChannels.has(`${NotificationChannel.IN_APP}:`)) {
          deliveryResults.push({
            success: true,
            channel: NotificationChannel.IN_APP,
            providerName: 'InternalInAppStore',
            deliveredAt: new Date()
          });
          continue;
        }
        try {
          await this.repository.createChannelDeliveryRecord({
            notificationId,
            channel: NotificationChannel.IN_APP,
            status: 'DELIVERED' as any,
            correlationId: record.correlationId || undefined,
            deliveredAt: new Date()
          });
          deliveryResults.push({
            success: true,
            channel: NotificationChannel.IN_APP,
            providerName: 'InternalInAppStore',
            deliveredAt: new Date()
          });
        } catch {}
        continue;
      }

      const provider = this.providers.get(channel);
      if (!provider) continue;

      let targetAddresses: string[] = [];
      if (channel === NotificationChannel.PUSH) {
        const rawTokens = (routingDecision.targetDevices.length > 0 ? routingDecision.targetDevices : effectiveDevices)
          .map(d => d.pushToken || '')
          .filter(t => t.length > 0);
        targetAddresses = Array.from(new Set(rawTokens));
      } else if (channel === NotificationChannel.EMAIL) {
        const rawEmails: string[] = [];
        if (event.metadata.userEmail) {
          rawEmails.push(String(event.metadata.userEmail));
        } else if (event.userId) {
          try {
            const user = await prisma.user.findUnique({ where: { id: event.userId }, select: { email: true } });
            if (user?.email) rawEmails.push(user.email.trim());
          } catch {}
        }
        targetAddresses = Array.from(new Set(rawEmails.map(e => e.trim().toLowerCase()).filter(e => e.length > 0)));
      }

      for (const address of targetAddresses) {
        if (deliveredChannels.has(`${channel}:${address}`)) {
          console.log(`[NotificationService] Redelivery skipped: already delivered on ${channel} to ${address}`);
          deliveryResults.push({
            success: true,
            channel,
            providerName: provider.providerName,
            deliveredAt: new Date()
          });
          continue;
        }

        const deliveryId = `redel_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        try {
          const result = await provider.send({
            deliveryId,
            notificationId,
            userId: event.userId,
            targetAddress: address,
            event,
            rendered
          });
          deliveryResults.push(result);

          await this.repository.createChannelDeliveryRecord({
            notificationId,
            channel,
            targetAddress: address,
            status: result.success ? ('DELIVERED' as any) : ('FAILED' as any),
            providerMessageId: result.externalMessageId || undefined,
            failureReason: result.errorMessage,
            correlationId: record.correlationId || undefined,
            deliveredAt: result.deliveredAt
          });
        } catch (err: any) {
          deliveryResults.push({
            success: false,
            channel,
            providerName: provider.providerName,
            errorMessage: err?.message
          });
        }
      }
    }

    return {
      notificationId,
      eventId: event.eventId,
      idempotencyKey: event.idempotencyKey,
      correlationId: record.correlationId || undefined,
      processed: true,
      duplicateSuppressed: false,
      stormSuppressed: false,
      coalesced: false,
      throttled: false,
      allowedChannels: routingDecision.allowedChannels,
      deliveryResults
    };
  }
}

export const notificationService = new CentralNotificationService();
export const centralNotificationService = notificationService;
