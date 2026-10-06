/**
 * Types & Interfaces for Admin Notification Operations
 * Phase 17 Batch 17.4 — Notifications & Communication Management
 */

import {
  NotificationRecordStatus,
  ChannelDeliveryStatus,
  PushPlatform,
  EmailMessageStatus
} from '@prisma/client';

export interface NotificationSummaryMetrics {
  totalNotifications: number;
  unreadCount: number;
  readCount: number;
  archivedCount: number;
  totalDeliveries: number;
  deliveredCount: number;
  failedCount: number;
  retryingCount: number;
  queuedCount: number;
  emailDeliveries: number;
  pushDeliveries: number;
  activePushTokens: number;
  stalePushTokens: number;
  revokedPushTokens: number;
  failedDeliveries24h: number;
  failedDeliveries7d: number;
  circuitBreakers: {
    fcm: string;
    email: string;
  };
}

export interface NotificationSummaryItem {
  id: string;
  eventId: string;
  userId: string;
  userEmail: string;
  userName: string | null;
  deviceId: string | null;
  deviceName: string | null;
  platform: string | null;
  eventType: string;
  category: string;
  severity: string;
  title: string;
  bodyPreview: string;
  status: NotificationRecordStatus;
  occurredAt: string;
  createdAt: string;
  deliveries: {
    id: string;
    channel: string;
    status: ChannelDeliveryStatus;
    attemptCount: number;
    maxAttempts: number;
    lastAttemptAt: string | null;
    nextRetryAt: string | null;
    failureReason: string | null;
  }[];
}

export interface NotificationDetail {
  id: string;
  eventId: string;
  userId: string;
  userEmail: string;
  userName: string | null;
  deviceId: string | null;
  deviceName: string | null;
  platform: string | null;
  serverId: string | null;
  eventType: string;
  category: string;
  severity: string;
  title: string;
  body: string;
  deepLinkUri: string | null;
  webPath: string | null;
  status: NotificationRecordStatus;
  idempotencyKey: string;
  correlationId: string | null;
  metadata: Record<string, unknown> | null;
  readAt: string | null;
  archivedAt: string | null;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
  deliveries: {
    id: string;
    channel: string;
    targetAddress: string | null;
    targetDeviceId: string | null;
    status: ChannelDeliveryStatus;
    attemptCount: number;
    maxAttempts: number;
    lastAttemptAt: string | null;
    nextRetryAt: string | null;
    deliveredAt: string | null;
    failedAt: string | null;
    failureReason: string | null;
    providerMessageId: string | null;
    providerResponseCode: string | null;
    retryable: boolean;
  }[];
  emailMessages: {
    id: string;
    emailType: string;
    templateId: string;
    recipientEmail: string;
    subject: string;
    status: EmailMessageStatus;
    provider: string;
    sentAt: string | null;
    deliveredAt: string | null;
    failedAt: string | null;
    failureReason: string | null;
  }[];
}

export interface FailedDeliverySummaryItem {
  id: string;
  notificationId: string;
  notificationTitle: string;
  eventType: string;
  category: string;
  userId: string;
  userEmail: string;
  channel: string;
  targetAddress: string | null;
  targetDeviceId: string | null;
  status: ChannelDeliveryStatus;
  attemptCount: number;
  maxAttempts: number;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  failedAt: string | null;
  failureReason: string | null;
  providerResponseCode: string | null;
  retryable: boolean;
  createdAt: string;
}

export interface PushTokenSummaryItem {
  id: string;
  userId: string;
  userEmail: string;
  deviceId: string;
  deviceName: string;
  platform: PushPlatform;
  tokenFingerprint: string;
  appVersion: string | null;
  isActive: boolean;
  lastSeenAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface NotificationListQuery {
  page: number;
  pageSize: number;
  search?: string;
  status?: NotificationRecordStatus;
  channel?: string;
  category?: string;
  severity?: string;
  userId?: string;
  deviceId?: string;
  startDate?: string;
  endDate?: string;
  sortBy: 'createdAt' | 'occurredAt' | 'title' | 'status' | 'category' | 'severity';
  sortOrder: 'asc' | 'desc';
}

export interface FailedDeliveriesQuery {
  page: number;
  pageSize: number;
  search?: string;
  channel?: string;
  failureCategory?: string;
  startDate?: string;
  endDate?: string;
  sortBy: 'createdAt' | 'lastAttemptAt' | 'failedAt' | 'attemptCount';
  sortOrder: 'asc' | 'desc';
}

export interface PushTokensQuery {
  page: number;
  pageSize: number;
  search?: string;
  platform?: PushPlatform;
  isActive?: boolean;
  userId?: string;
  deviceId?: string;
  sortBy: 'createdAt' | 'lastSeenAt';
  sortOrder: 'asc' | 'desc';
}


