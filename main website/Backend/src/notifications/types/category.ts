/**
 * RemoteNode Canonical Notification Categories
 * Track 4 — Batch NT-1.1 Architecture
 */

export enum NotificationCategory {
  ACCOUNT_SECURITY = 'ACCOUNT_SECURITY',
  DEVICE_SERVER = 'DEVICE_SERVER',
  FILE_OPERATIONS = 'FILE_OPERATIONS',
  STORAGE = 'STORAGE',
  SYSTEM = 'SYSTEM'
}

export const ALL_NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = Object.freeze([
  NotificationCategory.ACCOUNT_SECURITY,
  NotificationCategory.DEVICE_SERVER,
  NotificationCategory.FILE_OPERATIONS,
  NotificationCategory.STORAGE,
  NotificationCategory.SYSTEM
]);

export function isValidNotificationCategory(category: string): category is NotificationCategory {
  return Object.values(NotificationCategory).includes(category as NotificationCategory);
}
