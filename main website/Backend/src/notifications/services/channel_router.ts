/**
 * RemoteNode Central Channel Router & Preference Evaluation Engine
 * Track 4 — Batch NT-1.1 Architecture
 */

import { NotificationChannel } from '../types/channel.js';
import { NotificationEvent } from '../types/event.js';
import { NotificationSeverity } from '../types/severity.js';
import { getNotificationTypeMeta, NotificationType } from '../types/type_registry.js';
import {
  UserNotificationPreferences,
  getDefaultNotificationPreferences,
  normalizeNotificationPreferences
} from '../types/preference.js';

export interface DeviceRoutingTarget {
  deviceId: string;
  installationId?: string;
  deviceName?: string;
  pushToken?: string;
}

export interface ChannelRoutingDecision {
  eventId: string;
  userId: string;
  allowedChannels: NotificationChannel[];
  targetDevices: DeviceRoutingTarget[];
  securityBypassTriggered: boolean;
  suppressionReason?: string;
}

export class ChannelRouter {
  /**
   * Resolves target channels based on canonical event, user preferences, and security policy rules.
   */
  public evaluateRouting(
    event: NotificationEvent,
    userPreferences?: UserNotificationPreferences,
    userDevices: DeviceRoutingTarget[] = []
  ): ChannelRoutingDecision {
    const prefs = userPreferences
      ? normalizeNotificationPreferences(event.userId, userPreferences)
      : getDefaultNotificationPreferences(event.userId);
    const typeMeta = getNotificationTypeMeta(event.eventType);

    // 1. SECURITY POLICY CHECK
    // Essential security communications enforce mandatory delivery channels
    if (typeMeta.isSecurityCritical) {
      const targetDevices = this.resolveTargetDevices(event, userDevices);
      const allowedChannels: NotificationChannel[] = [
        NotificationChannel.IN_APP,
        NotificationChannel.EMAIL
      ];

      // Push channel for security-critical events:
      // Routed if devices are present AND (global push is enabled OR severity is high SECURITY/CRITICAL)
      const catPref = prefs.categories[event.category];
      const pushPermittedByPref = prefs.globalPushEnabled && (!catPref || catPref.channels[NotificationChannel.PUSH] !== false);
      const isUrgentSecurity = event.severity === NotificationSeverity.SECURITY || event.severity === NotificationSeverity.CRITICAL;

      const allowPush = targetDevices.length > 0 && (pushPermittedByPref || isUrgentSecurity);
      if (allowPush) {
        allowedChannels.push(NotificationChannel.PUSH);
      }

      // Check whether user preferences would have suppressed delivery without the security policy enforcement
      const wouldNormalRoutingAllowEmail = prefs.globalEmailEnabled && catPref?.enabled && catPref?.channels[NotificationChannel.EMAIL];
      const securityBypassTriggered = !catPref?.enabled || !wouldNormalRoutingAllowEmail;

      return {
        eventId: event.eventId,
        userId: event.userId,
        allowedChannels,
        targetDevices: allowPush ? targetDevices : [],
        securityBypassTriggered
      };
    }

    // 2. Standard Preference Evaluation for non-security-critical events
    const catPref = prefs.categories[event.category];
    if (!catPref || !catPref.enabled) {
      return {
        eventId: event.eventId,
        userId: event.userId,
        allowedChannels: [NotificationChannel.IN_APP], // In-app preserved for customer history
        targetDevices: [],
        securityBypassTriggered: false,
        suppressionReason: `Category ${event.category} disabled by user preferences`
      };
    }

    const allowedChannels: NotificationChannel[] = [];

    // In-App channel (enabled by default for category)
    if (catPref.channels[NotificationChannel.IN_APP] !== false) {
      allowedChannels.push(NotificationChannel.IN_APP);
    }

    // Push channel (requires globalPushEnabled AND category push enabled)
    if (prefs.globalPushEnabled && catPref.channels[NotificationChannel.PUSH]) {
      allowedChannels.push(NotificationChannel.PUSH);
    }

    // Email channel (requires globalEmailEnabled AND category email enabled)
    if (prefs.globalEmailEnabled && catPref.channels[NotificationChannel.EMAIL]) {
      allowedChannels.push(NotificationChannel.EMAIL);
    }

    const targetDevices = this.resolveTargetDevices(event, userDevices);

    // DEDICATED OUTBOX DEDUPLICATION GUARD:
    // Invoice notification emails are delivered exclusively by the dedicated BillingInvoiceNotificationService
    // and InvoiceNotificationOutboxWorker (with strict fencing, signed PDF links, and statutory formatting).
    // CentralNotificationService handles IN_APP and PUSH channels for INVOICE_ISSUED to guarantee zero duplicate emails.
    const effectiveChannels = event.eventType === NotificationType.INVOICE_ISSUED
      ? allowedChannels.filter((ch) => ch !== NotificationChannel.EMAIL)
      : allowedChannels;

    return {
      eventId: event.eventId,
      userId: event.userId,
      allowedChannels: effectiveChannels,
      targetDevices: effectiveChannels.includes(NotificationChannel.PUSH) ? targetDevices : [],
      securityBypassTriggered: false
    };
  }

  /**
   * MULTI-DEVICE ROUTING MODEL (Step 12)
   * Resolves targeted devices for device/server events or account-wide broadcast
   */
  public resolveTargetDevices(
    event: NotificationEvent,
    userDevices: DeviceRoutingTarget[]
  ): DeviceRoutingTarget[] {
    if (userDevices.length === 0) return [];

    // If event explicitly targets a specific device ID
    if (event.deviceId) {
      const matched = userDevices.filter(d => d.deviceId === event.deviceId);
      if (matched.length > 0) return matched;
    }

    // Default: Route to all user's registered Android devices
    return userDevices;
  }
}

export const defaultChannelRouter = new ChannelRouter();
