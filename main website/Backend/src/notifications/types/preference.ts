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
      }
    },
    updatedAt: new Date()
  };
}
