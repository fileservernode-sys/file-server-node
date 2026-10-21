/**
 * RemoteNode User Notification Preference Model
 * Track 4 — Batch NT-1.1 Architecture
 */

import { NotificationCategory } from './category.js';
import { NotificationChannel } from './channel.js';

export interface CategoryPreference {
  enabled: boolean;
  channels: Record<NotificationChannel, boolean>;
}

export interface UserNotificationPreferences {
  userId: string;
  globalPushEnabled: boolean;
  globalEmailEnabled: boolean;
  categories: Record<NotificationCategory, CategoryPreference>;
  updatedAt: Date;
}

export function getDefaultNotificationPreferences(userId: string): UserNotificationPreferences {
  return {
    userId,
    globalPushEnabled: true,
    globalEmailEnabled: true,
    categories: {
      [NotificationCategory.ACCOUNT_SECURITY]: {
        enabled: true,
        channels: {
          [NotificationChannel.IN_APP]: true,
          [NotificationChannel.PUSH]: true,
          [NotificationChannel.EMAIL]: true
        }
      },
      [NotificationCategory.DEVICE_SERVER]: {
        enabled: true,
        channels: {
          [NotificationChannel.IN_APP]: true,
          [NotificationChannel.PUSH]: true,
          [NotificationChannel.EMAIL]: true
        }
      },
      [NotificationCategory.FILE_OPERATIONS]: {
        enabled: true,
        channels: {
          [NotificationChannel.IN_APP]: true,
          [NotificationChannel.PUSH]: true,
          [NotificationChannel.EMAIL]: false
        }
      },
      [NotificationCategory.STORAGE]: {
        enabled: true,
        channels: {
          [NotificationChannel.IN_APP]: true,
          [NotificationChannel.PUSH]: true,
          [NotificationChannel.EMAIL]: true
        }
      },
      [NotificationCategory.SYSTEM]: {
        enabled: true,
        channels: {
          [NotificationChannel.IN_APP]: true,
          [NotificationChannel.PUSH]: true,
          [NotificationChannel.EMAIL]: false
        }
      },
      [NotificationCategory.BILLING]: {
        enabled: true,
        channels: {
          [NotificationChannel.IN_APP]: true,
          [NotificationChannel.PUSH]: true,
          [NotificationChannel.EMAIL]: true
        }
      }
    },
    updatedAt: new Date()
  };
}

/**
 * Normalizes user notification preferences ensuring all registered categories
 * and channels exist with sensible defaults, while enforcing mandatory security policy invariants.
 */
export function normalizeNotificationPreferences(
  userId: string,
  partial?: Partial<UserNotificationPreferences>
): UserNotificationPreferences {
  const defaults = getDefaultNotificationPreferences(userId);
  if (!partial) {
    return defaults;
  }

  const globalPushEnabled = typeof partial.globalPushEnabled === 'boolean'
    ? partial.globalPushEnabled
    : defaults.globalPushEnabled;

  const globalEmailEnabled = typeof partial.globalEmailEnabled === 'boolean'
    ? partial.globalEmailEnabled
    : defaults.globalEmailEnabled;

  const inputCategories = (partial.categories || {}) as Record<string, any>;
  const normalizedCategories: Record<NotificationCategory, CategoryPreference> = {} as any;

  for (const cat of Object.values(NotificationCategory)) {
    const defaultCat = defaults.categories[cat];
    const incomingCat = inputCategories[cat];

    if (!incomingCat || typeof incomingCat !== 'object') {
      normalizedCategories[cat] = {
        enabled: defaultCat.enabled,
        channels: { ...defaultCat.channels }
      };
    } else {
      const incomingChannels = (incomingCat.channels || {}) as Record<string, any>;
      normalizedCategories[cat] = {
        enabled: typeof incomingCat.enabled === 'boolean' ? incomingCat.enabled : defaultCat.enabled,
        channels: {
          [NotificationChannel.IN_APP]: typeof incomingChannels[NotificationChannel.IN_APP] === 'boolean'
            ? incomingChannels[NotificationChannel.IN_APP]
            : defaultCat.channels[NotificationChannel.IN_APP],
          [NotificationChannel.PUSH]: typeof incomingChannels[NotificationChannel.PUSH] === 'boolean'
            ? incomingChannels[NotificationChannel.PUSH]
            : defaultCat.channels[NotificationChannel.PUSH],
          [NotificationChannel.EMAIL]: typeof incomingChannels[NotificationChannel.EMAIL] === 'boolean'
            ? incomingChannels[NotificationChannel.EMAIL]
            : defaultCat.channels[NotificationChannel.EMAIL]
        }
      };
    }
  }

  // MANDATORY SECURITY POLICY ENFORCEMENT:
  // Account security notifications and their primary delivery channels cannot be disabled by customer preferences.
  normalizedCategories[NotificationCategory.ACCOUNT_SECURITY].enabled = true;
  normalizedCategories[NotificationCategory.ACCOUNT_SECURITY].channels[NotificationChannel.IN_APP] = true;
  normalizedCategories[NotificationCategory.ACCOUNT_SECURITY].channels[NotificationChannel.EMAIL] = true;

  return {
    userId,
    globalPushEnabled,
    globalEmailEnabled,
    categories: normalizedCategories,
    updatedAt: partial.updatedAt instanceof Date ? partial.updatedAt : new Date()
  };
}

