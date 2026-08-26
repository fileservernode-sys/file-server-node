/**
 * RemoteNode Canonical Delivery Channels
 * Track 4 — Batch NT-1.1 Architecture
 */

export enum NotificationChannel {
  IN_APP = 'IN_APP',
  PUSH = 'PUSH',
  EMAIL = 'EMAIL'
}

export const ALL_NOTIFICATION_CHANNELS: readonly NotificationChannel[] = Object.freeze([
  NotificationChannel.IN_APP,
  NotificationChannel.PUSH,
  NotificationChannel.EMAIL
]);

export function isValidNotificationChannel(channel: string): channel is NotificationChannel {
  return Object.values(NotificationChannel).includes(channel as NotificationChannel);
}
