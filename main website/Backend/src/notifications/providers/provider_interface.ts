/**
 * RemoteNode Notification Provider Base Interfaces
 * Track 4 — Batch NT-1.1 Architecture
 */

import { NotificationChannel } from '../types/channel.js';
import { RenderedTemplate } from '../types/template.js';
import { NotificationEvent } from '../types/event.js';

export interface ProviderDeliveryRequest {
  deliveryId: string;
  notificationId: string;
  userId: string;
  targetAddress?: string;
  targetDeviceId?: string;
  event: NotificationEvent;
  rendered: RenderedTemplate;
}

export interface ProviderDeliveryResult {
  success: boolean;
  channel: NotificationChannel;
  providerName: string;
  externalMessageId?: string;
  errorMessage?: string;
  deliveredAt?: Date;
}

export interface NotificationProvider {
  readonly channel: NotificationChannel;
  readonly providerName: string;
  send(request: ProviderDeliveryRequest): Promise<ProviderDeliveryResult>;
}

export interface PushNotificationProvider extends NotificationProvider {
  readonly channel: NotificationChannel.PUSH;
}

export interface EmailNotificationProvider extends NotificationProvider {
  readonly channel: NotificationChannel.EMAIL;
}

/**
 * Foundation Mock Push Provider for testing and default registry
 */
export class FoundationMockPushProvider implements PushNotificationProvider {
  readonly channel = NotificationChannel.PUSH;
  readonly providerName = 'FoundationMockPushProvider';
  public dispatched: ProviderDeliveryRequest[] = [];

  async send(request: ProviderDeliveryRequest): Promise<ProviderDeliveryResult> {
    this.dispatched.push(request);
    return {
      success: true,
      channel: NotificationChannel.PUSH,
      providerName: this.providerName,
      externalMessageId: `push_mock_${Date.now()}`,
      deliveredAt: new Date()
    };
  }
}

/**
 * Foundation Mock Email Provider for testing and default registry
 */
export class FoundationMockEmailProvider implements EmailNotificationProvider {
  readonly channel = NotificationChannel.EMAIL;
  readonly providerName = 'FoundationMockEmailProvider';
  public dispatched: ProviderDeliveryRequest[] = [];

  async send(request: ProviderDeliveryRequest): Promise<ProviderDeliveryResult> {
    this.dispatched.push(request);
    return {
      success: true,
      channel: NotificationChannel.EMAIL,
      providerName: this.providerName,
      externalMessageId: `email_mock_${Date.now()}`,
      deliveredAt: new Date()
    };
  }
}
