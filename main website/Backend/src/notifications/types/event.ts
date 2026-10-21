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
  'authorization',
  'cookie',
  'otp',
  'otpcode',
  'otphash',
  'verificationcode',
  'authcode',
  'rawexception',
  'stack',
  'stacktrace',
  'errorstack',
  // Sensitive Billing & Financial Keys
  'cvv',
  'cardnumber',
  'card_number',
  'pan',
  'paymentcredential',
  'signature',
  'razorpay_signature',
  'rawpayload',
  'taxid',
  'customertaxid',
  'gstin',
  'vatnumber',
  'accountnumber',
  'account_number',
  'privatedocumenturl',
  'downloadurl',
  'pdfurl'
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

  // Deterministic idempotency key derivation strategy:
  // 1. Explicitly supplied idempotencyKey has highest precedence.
  // 2. Stable domain entity identifier from metadata if available (prevents replay drift across retries).
  // 3. Explicit input.occurredAt if supplied by caller.
  // 4. Default fallback: eventType, userId, deviceId/serverId, and timestamp.
  let idempotencyKey = input.idempotencyKey;
  if (!idempotencyKey || idempotencyKey.trim() === '') {
    const domainEntity =
      sanitizedMetadata.invoiceId ||
      sanitizedMetadata.paymentId ||
      sanitizedMetadata.subscriptionId ||
      sanitizedMetadata.refundId ||
      sanitizedMetadata.orderId ||
      sanitizedMetadata.transactionId ||
      sanitizedMetadata.attemptId ||
      sanitizedMetadata.auditId ||
      sanitizedMetadata.ticketId ||
      sanitizedMetadata.sessionId;

    if (domainEntity) {
      idempotencyKey = `${input.eventType}:${input.userId}:${String(domainEntity)}`;
    } else if (input.occurredAt) {
      idempotencyKey = `${input.eventType}:${input.userId}:${input.deviceId || 'nodev'}:${input.serverId || 'nosrv'}:${input.occurredAt.getTime()}`;
    } else {
      idempotencyKey = `${input.eventType}:${input.userId}:${input.deviceId || 'nodev'}:${input.serverId || 'nosrv'}:${occurredAt.getTime()}`;
    }
  }

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
