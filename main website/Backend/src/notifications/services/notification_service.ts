/**
 * RemoteNode Central Notification Service Engine
 * Track 4 — Batch NT-1.1 Architecture
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
  FoundationMockPushProvider,
  FoundationMockEmailProvider
} from '../providers/provider_interface.js';
import { prisma } from '../../config/database.js';

export interface NotificationRecord {
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
  private providers: Map<NotificationChannel, NotificationProvider> = new Map();

  // In-memory store for NT-1.1 foundation
  private notificationRecords: Map<string, NotificationRecord> = new Map();
  private deliveryRecords: Map<string, ChannelDeliveryRecord> = new Map();

  constructor(
    idempotencyManager: IdempotencyManager = defaultIdempotencyManager,
    stormProtection: NotificationStormProtection = defaultStormProtection,
    channelRouter: ChannelRouter = defaultChannelRouter
  ) {
    this.idempotencyManager = idempotencyManager;
    this.stormProtection = stormProtection;
    this.channelRouter = channelRouter;

    // Register default foundation providers
    this.registerProvider(new FoundationMockPushProvider());
    this.registerProvider(new FoundationMockEmailProvider());
  }

  public registerProvider(provider: NotificationProvider): void {
    this.providers.set(provider.channel, provider);
  }

  public getProvider(channel: NotificationChannel): NotificationProvider | undefined {
    return this.providers.get(channel);
  }

  /**
   * Primary Entry Point: Create and Dispatch a Canonical Notification Event
   */
  public async dispatchEvent(
    input: NotificationEventInput,
    userPreferences?: UserNotificationPreferences,
    userDevices: DeviceRoutingTarget[] = []
  ): Promise<NotificationProcessingResult> {
    const event: NotificationEvent = createNotificationEvent(input);

    // 1. IDEMPOTENCY CHECK (Step 14)
    const isDuplicate = await this.idempotencyManager.isProcessed(event.idempotencyKey);
    if (isDuplicate) {
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

    // Record idempotency processing key
    await this.idempotencyManager.recordProcessing(event.idempotencyKey, event.eventId);

    // 2. STORM PROTECTION CHECK (Step 16)
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

    // 3. TEMPLATE RENDERING (Step 17)
    const rendered = templateRegistry.render(event.eventType, event.metadata, event.occurredAt);

    // 4. PREFERENCE & MULTI-DEVICE ROUTING (Step 10, Step 11, Step 12)
    const routingDecision = this.channelRouter.evaluateRouting(event, userPreferences, userDevices);

    // 5. CREATE CANONICAL NOTIFICATION RECORD (Step 8, Step 9)
    const notificationId = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const notificationRecord: NotificationRecord = {
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

    this.notificationRecords.set(notificationId, notificationRecord);

    // 6. CHANNEL DELIVERY DISPATCH (Step 6)
    const deliveryResults: ProviderDeliveryResult[] = [];

    for (const channel of routingDecision.allowedChannels) {
      if (channel === NotificationChannel.IN_APP) {
        // In-App channel delivery is satisfied by saving the NotificationRecord
        deliveryResults.push({
          success: true,
          channel: NotificationChannel.IN_APP,
          providerName: 'InternalInAppStore',
          deliveredAt: new Date()
        });
        continue;
      }

      const provider = this.providers.get(channel);
      if (provider) {
        try {
          const deliveryId = `del_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          const result = await provider.send({
            deliveryId,
            notificationId,
            userId: event.userId,
            targetAddress: metadataAddressForChannel(event, channel),
            event,
            rendered
          });

          deliveryResults.push(result);

          // Track channel delivery record
          this.deliveryRecords.set(deliveryId, {
            id: deliveryId,
            notificationId,
            channel,
            status: result.success ? DeliveryStatus.DELIVERED : DeliveryStatus.FAILED,
            attemptCount: 1,
            maxAttempts: 5,
            lastAttemptAt: new Date(),
            deliveredAt: result.deliveredAt,
            errorMessage: result.errorMessage,
            createdAt: new Date(),
            updatedAt: new Date()
          });
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

    // 7. OPTIONAL AUDIT INTEGRATION (Step 19)
    try {
      if (prisma && prisma.auditEvent) {
        await prisma.auditEvent.create({
          data: {
            userId: event.userId,
            deviceId: event.deviceId || null,
            eventType: 'OTP_SENT', // Use safe fallback AuditEventType or standard audit record
            metadata: {
              notificationId,
              notificationType: event.eventType,
              category: event.category,
              severity: event.severity
            }
          }
        }).catch(() => {});
      }
    } catch {
      // Non-blocking audit integration
    }

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

  public getNotification(notificationId: string): NotificationRecord | undefined {
    return this.notificationRecords.get(notificationId);
  }

  public getUserNotifications(userId: string): NotificationRecord[] {
    return Array.from(this.notificationRecords.values())
      .filter(n => n.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  public markAsRead(notificationId: string): boolean {
    const notif = this.notificationRecords.get(notificationId);
    if (notif) {
      notif.state = NotificationState.READ;
      notif.updatedAt = new Date();
      return true;
    }
    return false;
  }
}

function metadataAddressForChannel(event: NotificationEvent, channel: NotificationChannel): string | undefined {
  if (channel === NotificationChannel.EMAIL) {
    return event.metadata.userEmail ? String(event.metadata.userEmail) : undefined;
  }
  return undefined;
}

export const notificationService = new CentralNotificationService();
