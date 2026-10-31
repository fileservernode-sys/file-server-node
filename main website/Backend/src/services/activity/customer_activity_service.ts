import { prisma } from '../../config/database.js';
import { AppError, UnauthorizedError, ValidationError } from '../../errors/app-error.js';
import {
  ALL_CUSTOMER_ACTIVITY_CATEGORIES,
  CUSTOMER_ACTIVITY_TAXONOMY,
  CustomerActivityCategory,
  CustomerActivityEventSpec,
  CustomerActivityEventType,
  EXISTING_AUDIT_EVENT_CLASSIFICATION,
  INTERNAL_ONLY_AUDIT_EVENT_TYPES,
  containsSensitiveOrDiagnosticActivityValue,
  maskIpAddressForCustomerDisplay,
  resolveAuditEventToCustomerActivity,
  sanitizeCustomerActivityMetadata
} from './customer_activity_taxonomy.js';

// =============================================================================
// PHASE 9.2, 9.3 & 9.5: CENTRALIZED CUSTOMER ACTIVITY SERVICE
// =============================================================================
// Authoritative backend service for persisting and querying customer-visible
// activity events defined by the Phase 9.1 taxonomy (`customer_activity_taxonomy.ts`).
//
// Core Guarantees:
// 1. Strict Taxonomy Enforcement: Only registered CustomerActivityEventType
//    identifiers are accepted; internal/admin/webhook/worker events are rejected.
// 2. Privacy & Sanitization: Enforces per-event metadata whitelists, forbidden
//    key/value stripping, HTML/script stripping, IP masking, and user-agent
//    summarization on both write and read.
// 3. Deduplication & Cooldowns: Supports deterministic idempotency keys (P2002-safe),
//    per-event cooldown windows, and state-transition guards to suppress noise.
// 4. Non-Blocking Business Safety: Activity recording failures are caught and
//    logged safely so they never roll back or break primary customer actions.
// 5. Strict Ownership Isolation on Read: Activity queries require an authenticated
//    server-side userId and return only allowlisted, customer-safe fields.
// =============================================================================

export type CustomerActivitySeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export type CustomerActivityEventDefinition = CustomerActivityEventSpec;

export const ALL_CUSTOMER_ACTIVITY_EVENT_TYPES: readonly CustomerActivityEventType[] = Object.freeze(
  Object.values(CustomerActivityEventType)
);

const VALID_EVENT_TYPE_SET: ReadonlySet<string> = new Set<string>(ALL_CUSTOMER_ACTIVITY_EVENT_TYPES);
const VALID_CATEGORY_SET: ReadonlySet<string> = new Set<string>(ALL_CUSTOMER_ACTIVITY_CATEGORIES);

export const DEFAULT_ACTIVITY_PAGE_LIMIT = 20;
export const MIN_ACTIVITY_PAGE_LIMIT = 1;
export const MAX_ACTIVITY_PAGE_LIMIT = 100;

/**
 * Checks whether a value is a valid customer-visible `CustomerActivityEventType`.
 */
export function isValidCustomerActivityEventType(value: unknown): value is CustomerActivityEventType {
  return typeof value === 'string' && VALID_EVENT_TYPE_SET.has(value);
}

/**
 * Checks whether a value is a valid customer-visible `CustomerActivityCategory`.
 */
export function isValidCustomerActivityCategory(value: unknown): value is CustomerActivityCategory {
  return typeof value === 'string' && VALID_CATEGORY_SET.has(value);
}

/**
 * Checks whether an internal `AuditEventType` can map to a customer-visible activity event.
 */
export function isCustomerVisibleAuditEvent(auditEventType: unknown): boolean {
  if (typeof auditEventType !== 'string' || !auditEventType.trim()) {
    return false;
  }
  if (INTERNAL_ONLY_AUDIT_EVENT_TYPES.has(auditEventType)) {
    return false;
  }
  const entry = EXISTING_AUDIT_EVENT_CLASSIFICATION[auditEventType];
  return Boolean(entry && entry.visibility !== 'INTERNAL_ONLY');
}

/**
 * Deterministically resolves the customer-facing severity level for a taxonomy event type.
 */
export function resolveCustomerActivitySeverity(
  eventType: CustomerActivityEventType
): CustomerActivitySeverity {
  switch (eventType) {
    case CustomerActivityEventType.AUTH_SIGN_IN_FAILED:
    case CustomerActivityEventType.SECURITY_PASSWORD_RESET_REQUESTED:
    case CustomerActivityEventType.SECURITY_PASSWORD_RESET_COMPLETED:
    case CustomerActivityEventType.SECURITY_PASSWORD_CHANGED:
    case CustomerActivityEventType.SECURITY_DEVICE_CREDENTIALS_REVOKED:
    case CustomerActivityEventType.DEVICE_UNLINKED:
    case CustomerActivityEventType.REMOTE_TUNNEL_FAILED:
    case CustomerActivityEventType.FILE_SERVER_LOGIN_FAILED:
    case CustomerActivityEventType.SUBSCRIPTION_CANCELLATION_REQUESTED:
    case CustomerActivityEventType.SUBSCRIPTION_CANCELLED:
    case CustomerActivityEventType.SUBSCRIPTION_PAYMENT_PAST_DUE:
    case CustomerActivityEventType.SUBSCRIPTION_GRACE_PERIOD_STARTED:
    case CustomerActivityEventType.PAYMENT_FAILED:
    case CustomerActivityEventType.NOTIFICATION_STORAGE_ALERT_SENT:
      return 'WARNING';
    case CustomerActivityEventType.SUBSCRIPTION_EXPIRED:
      return 'CRITICAL';
    default:
      return 'INFO';
  }
}

export interface RecordCustomerActivityInput {
  /** Authoritative owner user ID (Required) */
  userId: string;
  /** Phase 9.1 taxonomy event identifier */
  eventType: CustomerActivityEventType | string;
  /** Optional raw or pre-sanitized metadata to whitelist and interpolate */
  metadata?: Record<string, unknown> | null;
  /** Optional raw client IP address (automatically masked before persistence; raw IP is never stored) */
  ipAddress?: string | null;
  /** Optional raw User-Agent header (automatically summarized into a short client label) */
  userAgent?: string | null;
  /** Optional associated entity references (stored as scalar IDs without destructive cascades) */
  deviceId?: string | null;
  serverId?: string | null;
  invoiceId?: string | null;
  subscriptionId?: string | null;
  paymentId?: string | null;
  receiptId?: string | null;
  /** Optional deterministic idempotency key to prevent duplicates across retries/webhooks */
  idempotencyKey?: string | null;
  /** Optional state transition values for STATE_TRANSITION_ONLY deduplication */
  previousState?: string | null;
  newState?: string | null;
  nextState?: string | null;
  /** Optional explicit business timestamp (defaults to new Date()) */
  occurredAt?: Date;
  /** Optional custom customer-safe title override */
  titleOverride?: string | null;
  /** Optional custom customer-safe description override */
  descriptionOverride?: string | null;
  /** Optional Prisma transaction client or custom DB client for testing */
  tx?: unknown;
  /** Optional logger for non-blocking warning output */
  logger?: {
    warn?: (msg: string, meta?: unknown) => void;
    error?: (msg: string, meta?: unknown) => void;
  };
  /** When false (default), catches persistence errors so business flows never fail */
  throwOnError?: boolean;
}

export interface RecordCustomerActivityOptions {
  db?: unknown;
  tx?: unknown;
  throwOnError?: boolean;
  logger?: {
    warn?: (msg: string, meta?: unknown) => void;
    error?: (msg: string, meta?: unknown) => void;
  };
}

export interface RecordCustomerActivityResult {
  recorded: boolean;
  deduplicated?: boolean;
  reason?:
    | 'RECORDED'
    | 'INVALID_USER_ID'
    | 'UNKNOWN_OR_INTERNAL_EVENT_TYPE'
    | 'NO_STATE_TRANSITION'
    | 'IDEMPOTENCY_KEY_EXISTS'
    | 'COOLDOWN_WINDOW_ACTIVE'
    | 'PERSISTENCE_ERROR';
  event?: {
    id: string;
    userId: string;
    eventType: CustomerActivityEventType;
    category: CustomerActivityCategory;
    severity: CustomerActivitySeverity;
    title: string;
    description: string;
    deviceId: string | null;
    serverId: string | null;
    invoiceId: string | null;
    subscriptionId: string | null;
    paymentId: string | null;
    receiptId: string | null;
    metadata: Record<string, unknown>;
    idempotencyKey: string | null;
    occurredAt: Date;
    createdAt: Date;
  };
}

export interface DecodedActivityCursor {
  occurredAt: Date;
  id: string;
}

export interface ListCustomerActivityParams {
  cursor?: string | null;
  limit?: number | string | null;
  category?: string | null;
  eventType?: string | null;
  from?: string | Date | null;
  to?: string | Date | null;
}

export interface SerializedCustomerActivityEntities {
  deviceId?: string;
  serverId?: string;
  invoiceId?: string;
  subscriptionId?: string;
  paymentId?: string;
  receiptId?: string;
}

export interface SerializedCustomerActivityItem {
  id: string;
  eventType: CustomerActivityEventType;
  category: CustomerActivityCategory;
  severity: CustomerActivitySeverity;
  title: string;
  description: string;
  occurredAt: string;
  entities: SerializedCustomerActivityEntities;
  metadata: Record<string, string | number | boolean | null>;
}

export interface ListCustomerActivityResult {
  items: SerializedCustomerActivityItem[];
  pagination: {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
  filters: {
    category: CustomerActivityCategory | null;
    eventType: CustomerActivityEventType | null;
    from: string | null;
    to: string | null;
  };
}

/**
 * Validates and normalizes an entity reference ID (e.g., deviceId, serverId, invoiceId).
 * Rejects strings containing HTML, whitespace, path traversal ('..'), or control characters.
 */
export function sanitizeEntityReferenceId(rawId: unknown): string | null {
  if (typeof rawId !== 'string') {
    return null;
  }
  const trimmed = rawId.trim();
  if (!trimmed || trimmed.length > 128 || trimmed.includes('..')) {
    return null;
  }
  if (!/^[A-Za-z0-9_.:-]+$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * Sanitizes customer-facing title or description text.
 * - Rejects strings containing embedded secrets, JWTs, password hashes, provider keys, or stack traces
 *   and falls back to `fallbackText`.
 * - Strips HTML/script tags, control characters, and dangerous URL schemes (`javascript:`, `data:`, `vbscript:`).
 * - Masks any raw IPv4 addresses accidentally interpolated into text.
 */
export function sanitizeCustomerFacingActivityText(
  rawText: unknown,
  fallbackText: string,
  maxLength: number
): string {
  const safeFallback = (fallbackText || 'Account activity').trim().slice(0, maxLength);
  if (typeof rawText !== 'string' || !rawText.trim()) {
    return safeFallback;
  }

  if (containsSensitiveOrDiagnosticActivityValue(rawText)) {
    return safeFallback;
  }

  const cleaned = rawText
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\b(?:javascript|vbscript|data)\s*:/gi, '')
    .replace(/\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g, (match, o1, o2, o3, o4) => {
      const nums = [Number(o1), Number(o2), Number(o3), Number(o4)];
      if (nums.every((n) => n >= 0 && n <= 255)) {
        return `${nums[0]}.${nums[1]}.${nums[2]}.xxx`;
      }
      return match;
    })
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    return safeFallback;
  }

  return cleaned.slice(0, maxLength);
}

/**
 * Summarizes a raw HTTP User-Agent string into a concise, customer-friendly browser/OS label
 * without storing full raw fingerprinting strings or headers.
 */
export function summarizeUserAgentForCustomerDisplay(rawUserAgent: string | null | undefined): string | null {
  if (!rawUserAgent || typeof rawUserAgent !== 'string') {
    return null;
  }
  const ua = rawUserAgent.trim();
  if (!ua) {
    return null;
  }

  if (containsSensitiveOrDiagnosticActivityValue(ua)) {
    return 'Web Browser';
  }

  // Detect Android Server Application / Flutter / Dart HTTP client
  if (/Dart\/|dart:io|ServerApp|ZdexCloud-Server|ZdexCloud.*Android/i.test(ua)) {
    return 'Android';
  }

  // If already a short summary (e.g. "Chrome on Windows"), strip any HTML/control chars and keep bounded
  if (ua.length <= 60 && !ua.includes('Mozilla/') && !ua.includes('AppleWebKit/') && !ua.includes('curl/')) {
    const cleaned = ua
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned || 'Web Browser';
  }

  let browser = 'Web Browser';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = 'Safari';
  else if (/curl\//i.test(ua)) browser = 'CLI Client';

  let os = '';
  if (/Windows NT/i.test(ua)) os = 'Windows';
  else if (/Macintosh|Mac OS X/i.test(ua)) os = 'macOS';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  return os ? `${browser} on ${os}` : browser;
}

/**
 * Resolves the user-facing application name ('Website Dashboard' vs 'Server Application').
 */
export function resolveClientApplicationName(
  rawUserAgent?: string | null,
  userAgentSummary?: string | null
): string {
  const combined = `${rawUserAgent || ''} ${userAgentSummary || ''}`;
  if (/Dart\/|dart:io|ServerApp|ZdexCloud-Server|ZdexCloud.*Android|Server Application/i.test(combined)) {
    return 'Server Application';
  }
  return 'Website Dashboard';
}

/**
 * Formats integer minor currency units into a human-readable display string
 * (e.g., 19900 + "INR" -> "INR 199.00", 500 + "USD" -> "USD 5.00").
 */
export function formatMinorUnitsForActivityDisplay(
  amountMinorUnits: unknown,
  currency: unknown
): string | null {
  if (typeof amountMinorUnits !== 'number' || !Number.isFinite(amountMinorUnits)) {
    return null;
  }
  const curr = typeof currency === 'string' && currency.trim() ? currency.trim().toUpperCase() : '';
  const major = (amountMinorUnits / 100).toFixed(2);
  return curr ? `${curr} ${major}` : major;
}

/**
 * Safely interpolates a taxonomy `descriptionTemplate` with sanitized metadata values
 * and sensible human-readable fallbacks so raw `{placeholder}` tokens never leak.
 */
export function renderCustomerActivityDescription(
  definition: CustomerActivityEventDefinition,
  sanitizedMetadata: Record<string, unknown>
): string {
  const template = definition.descriptionTemplate;

  const values: Record<string, string> = {
    serverName: 'your server',
    deviceName: 'your device',
    fileName: 'a file',
    folderName: 'a folder',
    itemName: 'an item',
    oldName: 'previous name',
    newName: 'new name',
    previousName: 'previous name',
    targetDirectory: '/',
    parentDirectory: '/',
    planName: 'ZdexCloud Pro',
    fromPlanName: 'previous plan',
    toPlanName: 'new plan',
    invoiceNumber: 'your invoice',
    receiptNumber: 'your receipt',
    billingCountry: 'your region',
    currency: '',
    maskedIp: 'masked IP',
    userAgentSummary: 'Web Browser',
    purposeLabel: 'account verification',
    effectiveDate: 'the end of your billing period',
    gracePeriodEndsAt: 'the end of your grace period',
    clientApplication: 'Website Dashboard'
  };

  for (const [key, val] of Object.entries(sanitizedMetadata)) {
    if (val === null || val === undefined) continue;
    if (typeof val === 'string' && val.trim().length > 0) {
      values[key] = val.trim();
    } else if (typeof val === 'number' && Number.isFinite(val)) {
      values[key] = String(val);
    } else if (typeof val === 'boolean') {
      values[key] = String(val);
    }
  }

  if (!sanitizedMetadata.clientApplication) {
    if (values.userAgentSummary && /dart|server|android/i.test(values.userAgentSummary)) {
      values.clientApplication = 'Server Application';
    }
  }
  if (/dart\/|dart:io/i.test(values.userAgentSummary)) {
    values.userAgentSummary = 'Android';
  }

  if (!sanitizedMetadata.planName && typeof sanitizedMetadata.planCode === 'string') {
    const code = sanitizedMetadata.planCode.trim().toUpperCase();
    if (code === 'PRO_MONTHLY') values.planName = 'Pro Monthly';
    else if (code === 'PRO_YEARLY') values.planName = 'Pro Yearly';
    else if (code === 'FREE') values.planName = 'Free';
    else values.planName = sanitizedMetadata.planCode.trim();
  }

  if (!values.formattedAmount) {
    const formattedAmount = formatMinorUnitsForActivityDisplay(
      sanitizedMetadata.amountMinorUnits ?? sanitizedMetadata.totalMinorUnits,
      sanitizedMetadata.currency
    );
    if (formattedAmount) {
      values.formattedAmount = formattedAmount;
    }
  }

  const rendered = template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, token: string) => {
    if (Object.prototype.hasOwnProperty.call(values, token) && values[token] !== '') {
      return values[token];
    }
    return 'N/A';
  });

  return sanitizeCustomerFacingActivityText(rendered, definition.title, 500);
}

/**
 * Encodes an activity pagination cursor `(occurredAt, id)` into an opaque base64url token.
 */
export function encodeActivityCursor(occurredAt: Date | string, id: string): string {
  const dateObj = occurredAt instanceof Date ? occurredAt : new Date(occurredAt);
  const payload = JSON.stringify({
    t: dateObj.toISOString(),
    i: String(id).trim()
  });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

/**
 * Decodes and strictly validates an opaque activity pagination cursor.
 * Throws `ValidationError` if the cursor is malformed or tampered with.
 */
export function decodeActivityCursor(rawCursor: unknown): DecodedActivityCursor {
  if (typeof rawCursor !== 'string' || !rawCursor.trim() || rawCursor.length > 512) {
    throw new ValidationError('Invalid pagination cursor');
  }

  const trimmed = rawCursor.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    throw new ValidationError('Invalid pagination cursor encoding');
  }

  let parsed: any;
  try {
    const json = Buffer.from(trimmed, 'base64url').toString('utf8');
    parsed = JSON.parse(json);
  } catch {
    throw new ValidationError('Invalid pagination cursor');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ValidationError('Invalid pagination cursor payload');
  }

  const rawTime = parsed.t ?? parsed.occurredAt;
  const rawId = parsed.i ?? parsed.id;

  if (typeof rawTime !== 'string' || !rawTime.trim() || typeof rawId !== 'string' || !rawId.trim()) {
    throw new ValidationError('Invalid pagination cursor structure');
  }

  const occurredAt = new Date(rawTime);
  const year = occurredAt.getUTCFullYear();
  if (Number.isNaN(occurredAt.getTime()) || year < 2000 || year > 2100) {
    throw new ValidationError('Invalid pagination cursor timestamp');
  }

  const id = sanitizeEntityReferenceId(rawId);
  if (!id) {
    throw new ValidationError('Invalid pagination cursor identifier');
  }

  return { occurredAt, id };
}

/**
 * Parses and validates an optional ISO-8601 date filter parameter.
 */
function parseDateFilterParam(value: unknown, paramName: string): Date | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new ValidationError(`Invalid '${paramName}' date parameter`);
    }
    return value;
  }
  if (typeof value !== 'string') {
    throw new ValidationError(`Invalid '${paramName}' date parameter`);
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64) {
    throw new ValidationError(`Invalid '${paramName}' date parameter`);
  }

  // Require ISO-8601 date or timestamp format (YYYY-MM-DD...)
  if (!/^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(trimmed)) {
    throw new ValidationError(`Invalid '${paramName}' date format. Expected ISO-8601 date or timestamp`);
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`Invalid '${paramName}' date value`);
  }

  return parsed;
}

/**
 * Explicit allowlist serializer for `CustomerActivityEvent` rows.
 *
 * Security & Privacy Guarantees:
 * - Rejects any row whose `eventType` is not in the customer-visible taxonomy.
 * - Never exposes `userId`, `idempotencyKey`, `createdAt`, or raw database fields.
 * - Re-runs `sanitizeCustomerActivityMetadata`, IP masking, User-Agent summarization,
 *   and `sanitizeCustomerFacingActivityText` on read as defense-in-depth so sensitive keys,
 *   raw IPs, stack traces, or HTML/script payloads can never leak.
 * - Preserves scalar entity IDs (`deviceId`, `serverId`, `invoiceId`, etc.) even if
 *   the underlying device or server was subsequently unlinked/deleted.
 */
export function serializeCustomerActivityEvent(row: any): SerializedCustomerActivityItem | null {
  if (!row || typeof row !== 'object') {
    return null;
  }

  const rawEventType = typeof row.eventType === 'string' ? row.eventType.trim() : '';
  if (!isValidCustomerActivityEventType(rawEventType)) {
    return null;
  }

  const eventType: CustomerActivityEventType = rawEventType;
  const spec = CUSTOMER_ACTIVITY_TAXONOMY[eventType];
  if (!spec) {
    return null;
  }

  const id = sanitizeEntityReferenceId(row.id);
  if (!id) {
    return null;
  }

  const occurredAtDate =
    row.occurredAt instanceof Date
      ? row.occurredAt
      : typeof row.occurredAt === 'string' || typeof row.occurredAt === 'number'
        ? new Date(row.occurredAt)
        : null;

  if (!occurredAtDate || Number.isNaN(occurredAtDate.getTime())) {
    return null;
  }

  // Defense-in-depth metadata sanitization on read
  const rawMeta =
    row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? { ...(row.metadata as Record<string, unknown>) }
      : {};

  if (typeof rawMeta.maskedIp === 'string') {
    rawMeta.maskedIp = maskIpAddressForCustomerDisplay(rawMeta.maskedIp);
  }
  if (typeof rawMeta.userAgentSummary === 'string') {
    rawMeta.userAgentSummary =
      summarizeUserAgentForCustomerDisplay(rawMeta.userAgentSummary) || 'Web Browser';
  }
  if (!rawMeta.clientApplication) {
    const isServerApp = (typeof rawMeta.userAgentSummary === 'string' && /dart|server|android/i.test(rawMeta.userAgentSummary))
      || (typeof row.description === 'string' && /dart/i.test(row.description));
    rawMeta.clientApplication = isServerApp ? 'Server Application' : 'Website Dashboard';
  }

  const sanitizedMetadata = sanitizeCustomerActivityMetadata(eventType, rawMeta);
  const fallbackDescription = renderCustomerActivityDescription(spec, sanitizedMetadata);

  const title = sanitizeCustomerFacingActivityText(row.title, spec.title, 200);
  let description = sanitizeCustomerFacingActivityText(row.description, fallbackDescription, 500);
  if (eventType === CustomerActivityEventType.AUTH_SIGN_IN_SUCCEEDED && description.startsWith('Signed in to your ZdexCloud account')) {
    if (!description.includes('Website Dashboard') && !description.includes('Server Application')) {
      description = fallbackDescription;
    }
  }

  const rawSeverity = typeof row.severity === 'string' ? row.severity.trim().toUpperCase() : '';
  const severity: CustomerActivitySeverity =
    rawSeverity === 'INFO' || rawSeverity === 'WARNING' || rawSeverity === 'CRITICAL'
      ? rawSeverity
      : resolveCustomerActivitySeverity(eventType);

  // Allowlist entity references defined by the taxonomy specification
  const entities: SerializedCustomerActivityEntities = {};
  const safeDeviceId = spec.entityReferences.deviceId ? sanitizeEntityReferenceId(row.deviceId) : null;
  if (safeDeviceId) entities.deviceId = safeDeviceId;

  const safeServerId = spec.entityReferences.serverId ? sanitizeEntityReferenceId(row.serverId) : null;
  if (safeServerId) entities.serverId = safeServerId;

  const safeInvoiceId = spec.entityReferences.invoiceId ? sanitizeEntityReferenceId(row.invoiceId) : null;
  if (safeInvoiceId) entities.invoiceId = safeInvoiceId;

  const safeSubscriptionId = spec.entityReferences.subscriptionId
    ? sanitizeEntityReferenceId(row.subscriptionId)
    : null;
  if (safeSubscriptionId) entities.subscriptionId = safeSubscriptionId;

  const safePaymentId = spec.entityReferences.paymentId ? sanitizeEntityReferenceId(row.paymentId) : null;
  if (safePaymentId) entities.paymentId = safePaymentId;

  const safeReceiptId = spec.entityReferences.receiptId ? sanitizeEntityReferenceId(row.receiptId) : null;
  if (safeReceiptId) entities.receiptId = safeReceiptId;

  return {
    id,
    eventType,
    category: spec.category,
    severity,
    title,
    description,
    occurredAt: occurredAtDate.toISOString(),
    entities,
    metadata: sanitizedMetadata
  };
}

export class CustomerActivityService {
  /**
   * Resolves the Prisma delegate for `CustomerActivityEvent` from either a custom DB/tx
   * client or the global `prisma` client.
   */
  private static getDelegate(txOrDb?: unknown): any {
    const client = (txOrDb as any) || (prisma as any);
    return client?.customerActivityEvent || null;
  }

  /**
   * Records a customer-visible activity event after validating against the Phase 9.1
   * taxonomy, sanitizing metadata, masking IPs, checking deduplication/cooldown rules,
   * and persisting to `CustomerActivityEvent`.
   *
   * By default (`throwOnError: false`), any unexpected database error is caught and
   * logged as a warning so primary customer mutations never fail due to activity logging.
   */
  public static async recordEvent(
    input: RecordCustomerActivityInput,
    options?: RecordCustomerActivityOptions
  ): Promise<RecordCustomerActivityResult> {
    const shouldThrow = Boolean(options?.throwOnError ?? input?.throwOnError);
    const logger = options?.logger ?? input?.logger;
    const dbClient = options?.db ?? options?.tx ?? input?.tx;

    try {
      // 1. Validate userId
      const userId = typeof input?.userId === 'string' ? input.userId.trim() : '';
      if (!userId) {
        if (shouldThrow) {
          throw new ValidationError('userId is required to record customer activity');
        }
        return {
          recorded: false,
          reason: 'INVALID_USER_ID'
        };
      }

      // 2. Validate eventType against Phase 9.1 taxonomy (rejects internal-only and unknown types)
      const rawEventType = typeof input?.eventType === 'string' ? input.eventType.trim() : '';
      if (!isValidCustomerActivityEventType(rawEventType)) {
        if (shouldThrow) {
          throw new ValidationError(`Unsupported or internal-only activity eventType '${rawEventType}'`);
        }
        return {
          recorded: false,
          reason: 'UNKNOWN_OR_INTERNAL_EVENT_TYPE'
        };
      }

      const eventType: CustomerActivityEventType = rawEventType;
      const definition = CUSTOMER_ACTIVITY_TAXONOMY[eventType];
      const dedupeMode: string = definition.deduplication?.mode || (definition as any).deduplicationRule || 'NONE';
      const cooldownSeconds =
        definition.deduplication?.cooldownSeconds ?? (definition as any).cooldownSeconds ?? 0;

      // 3. State-transition deduplication check (when applicable)
      const effectiveNextState = input.newState !== undefined ? input.newState : input.nextState;
      if (
        (dedupeMode === 'STATE_TRANSITION_ONLY' || dedupeMode === 'STATE_TRANSITION') &&
        input.previousState !== undefined &&
        effectiveNextState !== undefined &&
        input.previousState !== null &&
        effectiveNextState !== null &&
        input.previousState === effectiveNextState
      ) {
        return {
          recorded: false,
          deduplicated: true,
          reason: 'NO_STATE_TRANSITION'
        };
      }

      // 4. Prepare raw metadata with automatic IP masking, User-Agent summarization, and formattedAmount
      const enrichedRawMeta: Record<string, unknown> = {
        ...(input.metadata && typeof input.metadata === 'object' ? input.metadata : {})
      };

      if (input.ipAddress && !enrichedRawMeta.maskedIp) {
        const maskedIp = maskIpAddressForCustomerDisplay(input.ipAddress);
        if (maskedIp) {
          enrichedRawMeta.maskedIp = maskedIp;
        }
      } else if (typeof enrichedRawMeta.maskedIp === 'string') {
        enrichedRawMeta.maskedIp =
          maskIpAddressForCustomerDisplay(enrichedRawMeta.maskedIp) || enrichedRawMeta.maskedIp;
      }

      if (input.userAgent && !enrichedRawMeta.userAgentSummary) {
        const uaSummary = summarizeUserAgentForCustomerDisplay(input.userAgent);
        if (uaSummary) {
          enrichedRawMeta.userAgentSummary = uaSummary;
        }
      }

      if (!enrichedRawMeta.clientApplication) {
        enrichedRawMeta.clientApplication = resolveClientApplicationName(
          input.userAgent,
          typeof enrichedRawMeta.userAgentSummary === 'string' ? enrichedRawMeta.userAgentSummary : undefined
        );
      }

      if (
        !enrichedRawMeta.formattedAmount &&
        (typeof enrichedRawMeta.amountMinorUnits === 'number' ||
          typeof enrichedRawMeta.totalMinorUnits === 'number') &&
        typeof enrichedRawMeta.currency === 'string'
      ) {
        const minor =
          typeof enrichedRawMeta.amountMinorUnits === 'number'
            ? enrichedRawMeta.amountMinorUnits
            : (enrichedRawMeta.totalMinorUnits as number);
        const formatted = formatMinorUnitsForActivityDisplay(minor, enrichedRawMeta.currency);
        if (formatted) {
          enrichedRawMeta.formattedAmount = formatted;
        }
      }

      // 5. Sanitize metadata strictly via Phase 9.1 taxonomy whitelist & forbidden-key/value filter
      const sanitizedMetadata = sanitizeCustomerActivityMetadata(eventType, enrichedRawMeta);

      // 6. Render and sanitize customer-safe title, description, and severity
      const defaultDescription = renderCustomerActivityDescription(definition, sanitizedMetadata);
      const title = sanitizeCustomerFacingActivityText(input.titleOverride, definition.title, 200);
      const description = sanitizeCustomerFacingActivityText(
        input.descriptionOverride,
        defaultDescription,
        500
      );

      const severity = resolveCustomerActivitySeverity(eventType);

      const occurredAt =
        input.occurredAt instanceof Date && !Number.isNaN(input.occurredAt.getTime())
          ? input.occurredAt
          : new Date();

      const idempotencyKey =
        typeof input.idempotencyKey === 'string' && input.idempotencyKey.trim()
          ? input.idempotencyKey.trim().slice(0, 191)
          : null;

      // Enforce per-event entity reference allowlist and scalar ID validation on write
      const deviceId = definition.entityReferences?.deviceId
        ? sanitizeEntityReferenceId(input.deviceId)
        : null;
      const serverId = definition.entityReferences?.serverId
        ? sanitizeEntityReferenceId(input.serverId)
        : null;
      const invoiceId = definition.entityReferences?.invoiceId
        ? sanitizeEntityReferenceId(input.invoiceId)
        : null;
      const subscriptionId = definition.entityReferences?.subscriptionId
        ? sanitizeEntityReferenceId(input.subscriptionId)
        : null;
      const paymentId = definition.entityReferences?.paymentId
        ? sanitizeEntityReferenceId(input.paymentId)
        : null;
      const receiptId = definition.entityReferences?.receiptId
        ? sanitizeEntityReferenceId(input.receiptId)
        : null;

      const delegate = this.getDelegate(dbClient);
      if (!delegate) {
        return {
          recorded: false,
          reason: 'PERSISTENCE_ERROR'
        };
      }

      // 7. Check deterministic idempotencyKey if supplied
      if (idempotencyKey && typeof delegate.findUnique === 'function') {
        const existingByKey = await delegate.findUnique({
          where: { idempotencyKey }
        });
        if (existingByKey) {
          return {
            recorded: false,
            deduplicated: true,
            reason: 'IDEMPOTENCY_KEY_EXISTS',
            event: existingByKey
          };
        }
      }

      // 8. Check cooldown window deduplication when configured on the taxonomy definition
      if (cooldownSeconds > 0 && !idempotencyKey && typeof delegate.findFirst === 'function') {
        const cutoff = new Date(occurredAt.getTime() - cooldownSeconds * 1000);
        const cooldownWhere: Record<string, unknown> = {
          userId,
          eventType,
          occurredAt: { gte: cutoff }
        };

        if (deviceId) cooldownWhere.deviceId = deviceId;
        if (serverId) cooldownWhere.serverId = serverId;
        if (invoiceId) cooldownWhere.invoiceId = invoiceId;
        if (subscriptionId) cooldownWhere.subscriptionId = subscriptionId;
        if (paymentId) cooldownWhere.paymentId = paymentId;
        if (receiptId) cooldownWhere.receiptId = receiptId;

        const recentDuplicate = await delegate.findFirst({
          where: cooldownWhere,
          orderBy: { occurredAt: 'desc' }
        });

        if (recentDuplicate) {
          return {
            recorded: false,
            deduplicated: true,
            reason: 'COOLDOWN_WINDOW_ACTIVE',
            event: recentDuplicate
          };
        }
      }

      // 9. Persist CustomerActivityEvent row
      try {
        const created = await delegate.create({
          data: {
            userId,
            eventType,
            category: definition.category,
            severity,
            title,
            description,
            deviceId,
            serverId,
            invoiceId,
            subscriptionId,
            paymentId,
            receiptId,
            metadata: sanitizedMetadata,
            idempotencyKey,
            occurredAt
          }
        });

        return {
          recorded: true,
          reason: 'RECORDED',
          event: created
        };
      } catch (createErr: any) {
        if (createErr?.code === 'P2002' && idempotencyKey) {
          const raceExisting =
            typeof delegate.findUnique === 'function'
              ? await delegate.findUnique({ where: { idempotencyKey } })
              : undefined;
          return {
            recorded: false,
            deduplicated: true,
            reason: 'IDEMPOTENCY_KEY_EXISTS',
            event: raceExisting || undefined
          };
        }
        throw createErr;
      }
    } catch (err: any) {
      if (logger?.warn) {
        logger.warn('[CustomerActivityService] Non-blocking failure recording customer activity event', {
          eventType: input?.eventType,
          userId: input?.userId,
          error: err?.message || String(err)
        });
      }
      if (shouldThrow) {
        throw err;
      }
      return {
        recorded: false,
        reason: 'PERSISTENCE_ERROR'
      };
    }
  }

  /**
   * Fire-and-forget safe wrapper that never rejects or throws.
   */
  public static async recordEventSafe(
    input: RecordCustomerActivityInput,
    options?: Omit<RecordCustomerActivityOptions, 'throwOnError'>
  ): Promise<RecordCustomerActivityResult> {
    return await this.recordEvent({ ...input, throwOnError: false }, { ...options, throwOnError: false });
  }

  /**
   * Bridges an existing internal `AuditEventType` + metadata into a `CustomerActivityEvent`
   * if and only if the Phase 9.1 taxonomy classifies it as customer-visible.
   * Internal-only audit events (`INTERNAL_ONLY`) are strictly ignored.
   */
  public static async recordFromAuditEvent(
    params: {
      userId: string;
      auditEventType: string;
      metadata?: Record<string, unknown> | null;
      ipAddress?: string | null;
      userAgent?: string | null;
      deviceId?: string | null;
      serverId?: string | null;
      invoiceId?: string | null;
      subscriptionId?: string | null;
      paymentId?: string | null;
      receiptId?: string | null;
      idempotencyKey?: string | null;
      occurredAt?: Date;
      tx?: unknown;
    },
    options?: RecordCustomerActivityOptions
  ): Promise<RecordCustomerActivityResult> {
    if (!isCustomerVisibleAuditEvent(params.auditEventType)) {
      return {
        recorded: false,
        reason: 'UNKNOWN_OR_INTERNAL_EVENT_TYPE'
      };
    }

    const resolvedEventType = resolveAuditEventToCustomerActivity(
      params.auditEventType,
      params.metadata
    );

    if (!resolvedEventType) {
      return {
        recorded: false,
        reason: 'UNKNOWN_OR_INTERNAL_EVENT_TYPE'
      };
    }

    const sanitizedMetadata = sanitizeCustomerActivityMetadata(
      resolvedEventType,
      params.metadata
    );

    return await this.recordEvent(
      {
        userId: params.userId,
        eventType: resolvedEventType,
        metadata: sanitizedMetadata,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        deviceId: params.deviceId,
        serverId: params.serverId,
        invoiceId: params.invoiceId,
        subscriptionId: params.subscriptionId,
        paymentId: params.paymentId,
        receiptId: params.receiptId,
        idempotencyKey: params.idempotencyKey,
        occurredAt: params.occurredAt,
        tx: params.tx
      },
      options
    );
  }

  /**
   * Phase 9.3 & 9.5: Retrieves a paginated, chronologically ordered list of customer-visible
   * activity events scoped strictly to `authenticatedUserId`.
   *
   * Enforces:
   * - Mandatory server-side `authenticatedUserId` (never trusts caller-supplied userId).
   * - Cursor-based pagination with deterministic `(occurredAt DESC, id DESC)` ordering.
   * - Bounded page size (`default: 20`, `min: 1`, `max: 100`).
   * - Taxonomy-validated `category` and `eventType` filters.
   * - Validated ISO-8601 `from` and `to` date-range filters.
   * - Explicit allowlist serialization (`serializeCustomerActivityEvent`) + strict row ownership guard.
   * - Sanitized database failure handling so internal Prisma/SQL details never leak to clients.
   */
  public static async listUserActivity(
    authenticatedUserId: string,
    params: ListCustomerActivityParams = {},
    options?: { db?: unknown }
  ): Promise<ListCustomerActivityResult> {
    const userId = typeof authenticatedUserId === 'string' ? authenticatedUserId.trim() : '';
    if (!userId) {
      throw new UnauthorizedError('Authentication required');
    }

    // 1. Validate limit (default 20, min 1, max 100)
    let limit = DEFAULT_ACTIVITY_PAGE_LIMIT;
    if (params.limit !== undefined && params.limit !== null && params.limit !== '') {
      const parsedLimit =
        typeof params.limit === 'number'
          ? params.limit
          : typeof params.limit === 'string' && /^\d+$/.test(params.limit.trim())
            ? Number.parseInt(params.limit.trim(), 10)
            : Number.NaN;

      if (
        !Number.isInteger(parsedLimit) ||
        parsedLimit < MIN_ACTIVITY_PAGE_LIMIT ||
        parsedLimit > MAX_ACTIVITY_PAGE_LIMIT
      ) {
        throw new ValidationError(
          `Invalid 'limit' parameter: must be an integer between ${MIN_ACTIVITY_PAGE_LIMIT} and ${MAX_ACTIVITY_PAGE_LIMIT}`
        );
      }
      limit = parsedLimit;
    }

    // 2. Validate optional category filter against taxonomy
    let categoryFilter: CustomerActivityCategory | null = null;
    if (params.category !== undefined && params.category !== null && params.category !== '') {
      const rawCat = typeof params.category === 'string' ? params.category.trim() : '';
      if (!isValidCustomerActivityCategory(rawCat)) {
        throw new ValidationError(
          `Invalid 'category' filter '${rawCat}'. Allowed categories: ${ALL_CUSTOMER_ACTIVITY_CATEGORIES.join(', ')}`
        );
      }
      categoryFilter = rawCat;
    }

    // 3. Validate optional eventType filter against customer-visible taxonomy
    let eventTypeFilter: CustomerActivityEventType | null = null;
    if (params.eventType !== undefined && params.eventType !== null && params.eventType !== '') {
      const rawType = typeof params.eventType === 'string' ? params.eventType.trim() : '';
      if (!isValidCustomerActivityEventType(rawType)) {
        throw new ValidationError(`Invalid or unsupported 'eventType' filter '${rawType}'`);
      }
      eventTypeFilter = rawType;
    }

    // Ensure category and eventType do not contradict each other when both are supplied
    if (categoryFilter && eventTypeFilter) {
      const spec = CUSTOMER_ACTIVITY_TAXONOMY[eventTypeFilter];
      if (spec.category !== categoryFilter) {
        throw new ValidationError(
          `Filter conflict: eventType '${eventTypeFilter}' does not belong to category '${categoryFilter}'`
        );
      }
    }

    // 4. Validate optional date-range filters (`from` and `to`)
    const fromDate = parseDateFilterParam(params.from, 'from');
    const toDate = parseDateFilterParam(params.to, 'to');

    if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
      throw new ValidationError("Invalid date range: 'from' must be earlier than or equal to 'to'");
    }

    // 5. Decode and validate optional cursor
    let decodedCursor: DecodedActivityCursor | null = null;
    if (params.cursor !== undefined && params.cursor !== null && params.cursor !== '') {
      decodedCursor = decodeActivityCursor(params.cursor);
    }

    // 6. Build indexed Prisma query strictly scoped to `userId`
    const where: Record<string, any> = {
      userId
    };

    if (eventTypeFilter) {
      where.eventType = eventTypeFilter;
    } else {
      where.eventType = { in: ALL_CUSTOMER_ACTIVITY_EVENT_TYPES as string[] };
    }

    if (categoryFilter) {
      where.category = categoryFilter;
    }

    if (fromDate || toDate) {
      where.occurredAt = {
        ...(fromDate ? { gte: fromDate } : {}),
        ...(toDate ? { lte: toDate } : {})
      };
    }

    if (decodedCursor) {
      where.AND = [
        {
          OR: [
            { occurredAt: { lt: decodedCursor.occurredAt } },
            {
              occurredAt: decodedCursor.occurredAt,
              id: { lt: decodedCursor.id }
            }
          ]
        }
      ];
    }

    const delegate = this.getDelegate(options?.db);
    if (!delegate || typeof delegate.findMany !== 'function') {
      return {
        items: [],
        pagination: {
          limit,
          hasMore: false,
          nextCursor: null
        },
        filters: {
          category: categoryFilter,
          eventType: eventTypeFilter,
          from: fromDate ? fromDate.toISOString() : null,
          to: toDate ? toDate.toISOString() : null
        }
      };
    }

    let rawRows: any[];
    try {
      rawRows = await delegate.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: limit + 1
      });
    } catch {
      throw new AppError(
        'Unable to retrieve account activity at this time.',
        500,
        'ACTIVITY_QUERY_FAILED'
      );
    }

    if (!Array.isArray(rawRows)) {
      rawRows = [];
    }

    const hasMore = rawRows.length > limit;
    const pageRows = hasMore ? rawRows.slice(0, limit) : rawRows;

    const serializedItems: SerializedCustomerActivityItem[] = [];
    let lastValidRow: any = null;
    for (const row of pageRows) {
      // Strict ownership assertion on every returned row (rejects null/missing/cross-tenant userId)
      if (!row || typeof row.userId !== 'string' || row.userId.trim() !== userId) {
        continue;
      }
      const serialized = serializeCustomerActivityEvent(row);
      if (serialized) {
        serializedItems.push(serialized);
        lastValidRow = row;
      }
    }

    const nextCursor =
      hasMore && lastValidRow && lastValidRow.occurredAt && lastValidRow.id
        ? encodeActivityCursor(lastValidRow.occurredAt, String(lastValidRow.id))
        : null;

    return {
      items: serializedItems,
      pagination: {
        limit,
        hasMore,
        nextCursor
      },
      filters: {
        category: categoryFilter,
        eventType: eventTypeFilter,
        from: fromDate ? fromDate.toISOString() : null,
        to: toDate ? toDate.toISOString() : null
      }
    };
  }
}
