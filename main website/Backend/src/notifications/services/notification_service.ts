/**
 * RemoteNode Central Notification Service Engine with Database Persistence
 * Track 4 — Batch NT-1.2 Architecture
 */

import { NotificationEvent, NotificationEventInput, createNotificationEvent } from '../types/event.js';
import { NotificationState, ChannelDeliveryRecord, DeliveryStatus } from '../types/lifecycle.js';
import { NotificationChannel } from '../types/channel.js';
import { templateRegistry } from './template_registry.js';
import { defaultIdempotencyManager, IdempotencyManager } from './idempotency.js';
import { defaultStormProtection, NotificationStormProtection } from './storm_protection.js';
import { defaultChannelRouter, ChannelRouter, DeviceRoutingTarget } from './channel_router.js';
import { UserNotificationPreferences } from '../types/preference.js';
import {
  NotificationProvider,
  ProviderDeliveryResult,
  FoundationMockEmailProvider
} from '../providers/provider_interface.js';
import { defaultFcmPushProvider, FcmPushProvider } from '../providers/fcm_provider.js';
import { notificationRepository, NotificationRepository } from '../repositories/notification_repository.js';
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
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationProcessingResult {
  notificationId?: string;
  eventId: string;
  idempotencyKey: string;
  processed: boolean;
  duplicateSuppressed: boolean;
  stormSuppressed: boolean;
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
  private providers: Map<NotificationChannel, NotificationProvider> = new Map();

  // In-memory fallback cache for fast lookups
  private notificationRecordsCache: Map<string, NotificationRecordDTO> = new Map();

  constructor(
    idempotencyManager: IdempotencyManager = defaultIdempotencyManager,
    stormProtection: NotificationStormProtection = defaultStormProtection,
    channelRouter: ChannelRouter = defaultChannelRouter,
    repository: NotificationRepository = notificationRepository
  ) {
    this.idempotencyManager = idempotencyManager;
    this.stormProtection = stormProtection;
    this.channelRouter = channelRouter;
    this.repository = repository;

    // Register production & fallback providers
    this.registerProvider(defaultFcmPushProvider);
    this.registerProvider(new FoundationMockEmailProvider());
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

    // 1. IDEMPOTENCY CHECK (Memory + Database)
    const isMemoryDuplicate = await this.idempotencyManager.isProcessed(event.idempotencyKey);
    if (isMemoryDuplicate) {
      return {
        eventId: event.eventId,
        idempotencyKey: event.idempotencyKey,
        processed: false,
        duplicateSuppressed: true,
        stormSuppressed: false,
        allowedChannels: [],
        deliveryResults: []
      };
    }

    try {
      const dbExisting = await this.repository.getNotificationByIdempotencyKey(event.idempotencyKey);
      if (dbExisting) {
        await this.idempotencyManager.recordProcessing(event.idempotencyKey, event.eventId);
        return {
          eventId: event.eventId,
          idempotencyKey: event.idempotencyKey,
          processed: false,
          duplicateSuppressed: true,
          stormSuppressed: false,
          allowedChannels: [],
          deliveryResults: []
        };
      }
    } catch {
      // Non-blocking database check fallback
    }

    // Record memory idempotency key
    await this.idempotencyManager.recordProcessing(event.idempotencyKey, event.eventId);

    // 2. STORM PROTECTION CHECK
    if (this.stormProtection.shouldSuppress(event)) {
      return {
        eventId: event.eventId,
        idempotencyKey: event.idempotencyKey,
        processed: false,
        duplicateSuppressed: false,
        stormSuppressed: true,
        allowedChannels: [],
        deliveryResults: []
      };
    }

    // 3. RESOLVE USER PREFERENCES & ACTIVE PUSH TOKENS
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

    // 4. TEMPLATE RENDERING
    const rendered = templateRegistry.render(event.eventType, event.metadata, event.occurredAt);

    // 5. PREFERENCE & MULTI-DEVICE ROUTING EVALUATION
    const routingDecision = this.channelRouter.evaluateRouting(event, effectivePreferences, effectiveDevices);

    // 6. CREATE PERSISTENT NOTIFICATION RECORD
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
        occurredAt: event.occurredAt
      });
    } catch (dbErr: any) {
      // If unique constraint on idempotencyKey violated during race condition
      if (dbErr?.code === 'P2002') {
        return {
          eventId: event.eventId,
          idempotencyKey: event.idempotencyKey,
          processed: false,
          duplicateSuppressed: true,
          stormSuppressed: false,
          allowedChannels: [],
          deliveryResults: []
        };
      }
    }

    // 7. CHANNEL DELIVERY DISPATCH & PERSISTENCE
    const deliveryResults: ProviderDeliveryResult[] = [];

    for (const channel of routingDecision.allowedChannels) {
      if (channel === NotificationChannel.IN_APP) {
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
            deliveredAt: new Date()
          });
        } catch {}
        continue;
      }

      const provider = this.providers.get(channel);
      if (provider) {
        // Resolve target address for Push / Email
        let targetAddresses: string[] = [];
        if (channel === NotificationChannel.PUSH) {
          const targetDevices = routingDecision.targetDevices.length > 0
            ? routingDecision.targetDevices
            : effectiveDevices;
          targetAddresses = targetDevices.map(d => d.pushToken || '').filter(t => t.length > 0);
          if (targetAddresses.length === 0 && event.metadata.pushToken) {
            targetAddresses.push(String(event.metadata.pushToken));
          }
        } else if (channel === NotificationChannel.EMAIL) {
          if (event.metadata.userEmail) {
            targetAddresses.push(String(event.metadata.userEmail));
          }
        }

        // If no addresses registered, record queued delivery attempt
        if (targetAddresses.length === 0) {
          try {
            await this.repository.createChannelDeliveryRecord({
              notificationId,
              channel,
              status: 'QUEUED' as any,
              failureReason: 'No registered push tokens or email address'
            });
          } catch {}
          continue;
        }

        for (const address of targetAddresses) {
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
                providerMessageId: result.externalMessageId,
                failureReason: result.errorMessage,
                deliveredAt: result.deliveredAt
              });
            } catch {}
          } catch (err: any) {
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

    // 8. OPTIONAL AUDIT EVENT INTEGRATION
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
              severity: event.severity
            }
          }
        }).catch(() => {});
      }
    } catch {}

    return {
      notificationId,
      eventId: event.eventId,
      idempotencyKey: event.idempotencyKey,
      processed: true,
      duplicateSuppressed: false,
      stormSuppressed: false,
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
}

export const notificationService = new CentralNotificationService();
