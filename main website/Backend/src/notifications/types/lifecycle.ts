/**
 * RemoteNode Notification Lifecycle and Delivery Status Specifications
 * Track 4 — Batch NT-1.1 Architecture
 *
 * CRITICAL ARCHITECTURAL REQUIREMENT:
 * Notification status (user-facing in-app read state) must remain distinct from
 * Channel Delivery status (transport layer attempt state).
 */

export enum NotificationState {
  UNREAD = 'UNREAD',
  READ = 'READ',
  ARCHIVED = 'ARCHIVED'
}

export enum DeliveryStatus {
  QUEUED = 'QUEUED',
  PROCESSING = 'PROCESSING',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
  RETRYING = 'RETRYING',
  PERMANENTLY_FAILED = 'PERMANENTLY_FAILED'
}

export interface ChannelDeliveryRecord {
  id: string;
  notificationId: string;
  channel: string; // NotificationChannel
  targetAddress?: string; // e.g. Email address or Push Token ID
  targetDeviceId?: string; // Target device ID when targeted to specific phone
  status: DeliveryStatus;
  attemptCount: number;
  maxAttempts: number;
  lastAttemptAt?: Date;
  nextAttemptAt?: Date;
  errorMessage?: string;
  deliveredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
