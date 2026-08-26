/**
 * RemoteNode Central Channel Router & Preference Evaluation Engine
 * Track 4 — Batch NT-1.1 Architecture
 */

import { NotificationChannel } from '../types/channel.js';
import { NotificationEvent } from '../types/event.js';
import { getNotificationTypeMeta } from '../types/type_registry.js';
import {
  UserNotificationPreferences,
  getDefaultNotificationPreferences
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
    const prefs = userPreferences || getDefaultNotificationPreferences(event.userId);
    const typeMeta = getNotificationTypeMeta(event.eventType);

    // SECURITY POLICY CHECK (Step 11)
    // Security critical events override user preferences to enforce delivery
    if (typeMeta.isSecurityCritical) {
      const targetDevices = this.resolveTargetDevices(event, userDevices);
      return {
        eventId: event.eventId,
        userId: event.userId,
        allowedChannels: [NotificationChannel.IN_APP, NotificationChannel.PUSH, NotificationChannel.EMAIL],
        targetDevices,
        securityBypassTriggered: true
      };
    }

    // Standard Preference Evaluation
    const catPref = prefs.categories[event.category];
    if (!catPref || !catPref.enabled) {
      return {
        eventId: event.eventId,
        userId: event.userId,
        allowedChannels: [NotificationChannel.IN_APP], // In-app always preserved for history unless explicitly purged
        targetDevices: [],
        securityBypassTriggered: false,
        suppressionReason: `Category ${event.category} disabled by user preferences`
      };
    }

    const allowedChannels: NotificationChannel[] = [NotificationChannel.IN_APP];

    if (prefs.globalPushEnabled && catPref.channels[NotificationChannel.PUSH]) {
      allowedChannels.push(NotificationChannel.PUSH);
    }

    if (prefs.globalEmailEnabled && catPref.channels[NotificationChannel.EMAIL]) {
      allowedChannels.push(NotificationChannel.EMAIL);
    }

    const targetDevices = this.resolveTargetDevices(event, userDevices);

    return {
      eventId: event.eventId,
      userId: event.userId,
      allowedChannels,
      targetDevices,
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
