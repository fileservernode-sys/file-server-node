/**
 * RemoteNode Canonical Notification Event Contract & Safe Metadata Validation
 * Track 4 — Batch NT-1.1 Architecture
 */

import { NotificationCategory } from './category.js';
import { NotificationSeverity } from './severity.js';
import { NotificationType, getNotificationTypeMeta } from './type_registry.js';
import { NotificationDeepLink } from './deep_link.js';

export interface SafeNotificationMetadata {
  userName?: string;
  userEmail?: string;
  deviceName?: string;
  serverName?: string;
  fileCount?: number;
  filePath?: string;
  fileName?: string;
  fileSizeBytes?: number;
  ipAddress?: string;
  userAgent?: string;
  storageFreeBytes?: number;
  storageTotalBytes?: number;
  storageUsedPercent?: number;
  reason?: string;
  customSummary?: string;
  [key: string]: string | number | boolean | undefined;
}

const PROHIBITED_KEYS = new Set([
  'password',
  'passwordhash',
  'adminpassword',
  'adminpasswordhash',
  'token',
  'jwt',
  'accesstoken',
  'refreshtoken',
  'sessiontoken',
  'connectiontoken',
  'secret',
  'apikey',
  'privatekey',
  'gatewaycredential',
  'credential',
  'credentials',
  'authheader',
  'cookie',
  'rawexception',
  'stack',
  'stacktrace',
  'errorstack'
]);

export function validateAndSanitizeMetadata(metadata: Record<string, any> = {}): SafeNotificationMetadata {
  const safeMeta: SafeNotificationMetadata = {};

  for (const [key, value] of Object.entries(metadata)) {
    const lowerKey = key.toLowerCase();
    if (PROHIBITED_KEYS.has(lowerKey)) {
      continue; // Strictly omit sensitive fields
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      safeMeta[key] = value;
    }
  }

  return safeMeta;
}

export interface NotificationEventInput {
  eventId?: string;
  eventType: NotificationType;
  userId: string;
  deviceId?: string;
  serverId?: string;
  category?: NotificationCategory;
  severity?: NotificationSeverity;
  occurredAt?: Date;
  idempotencyKey?: string;
  metadata?: Record<string, any>;
  source?: string;
  deepLink?: NotificationDeepLink;
}

export interface NotificationEvent {
  eventId: string;
  eventType: NotificationType;
  userId: string;
  deviceId?: string;
  serverId?: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  occurredAt: Date;
  idempotencyKey: string;
  metadata: SafeNotificationMetadata;
  source: string;
  deepLink?: NotificationDeepLink;
}

export function createNotificationEvent(input: NotificationEventInput): NotificationEvent {
  if (!input.userId || input.userId.trim() === '') {
    throw new Error('Notification event requires a valid userId');
  }

  const meta = getNotificationTypeMeta(input.eventType);
  const category = input.category || meta.category;
  const severity = input.severity || meta.defaultSeverity;
  const occurredAt = input.occurredAt || new Date();
  const source = input.source || 'system';

  const sanitizedMetadata = validateAndSanitizeMetadata(input.metadata);

  const eventId = input.eventId || `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  // Default idempotency key strategy if not supplied
  const idempotencyKey = input.idempotencyKey ||
    `${input.eventType}:${input.userId}:${input.deviceId || 'nodev'}:${input.serverId || 'nosrv'}:${occurredAt.getTime()}`;

  return {
    eventId,
    eventType: input.eventType,
    userId: input.userId,
    deviceId: input.deviceId,
    serverId: input.serverId,
    category,
    severity,
    occurredAt,
    idempotencyKey,
    metadata: sanitizedMetadata,
    source,
    deepLink: input.deepLink
  };
}
