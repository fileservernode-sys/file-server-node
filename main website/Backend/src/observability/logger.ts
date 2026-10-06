import { config } from '../config/env.js';
import { RequestContextStore } from './request_context.js';

export interface StructuredLogPayload {
  level?: 'info' | 'warn' | 'error' | 'debug' | 'trace';
  service?: string;
  environment?: string;
  requestId?: string;
  operation?: string;
  resourceType?: string;
  resourceId?: string;
  userId?: string;
  adminId?: string;
  deviceId?: string;
  connectionId?: string;
  serverId?: string;
  gatewayNodeId?: string;
  event?: string;
  durationMs?: number;
  statusCode?: number;
  errorCode?: string;
  message?: string;
  metadata?: Record<string, any>;
  error?: Error | unknown;
}

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /key/i,
  /otp/i,
  /auth/i,
  /cookie/i,
  /credential/i,
  /signature/i,
  /session/i,
  /csrf/i,
  /database/i,
  /private/i,
  /filecontent/i,
  /payload/i,
  /base64/i,
  /buffer/i
];

/**
 * Strips control characters, newlines, and terminal escape sequences to prevent log injection.
 */
export function sanitizeLogString(str: string, maxLength = 1024): string {
  if (!str || typeof str !== 'string') return '';
  let cleaned = str
    .replace(/[\r\n\t\0\x1b]/g, ' ') // Strip newlines, tabs, null bytes, and ANSI escape codes
    .trim();

  if (cleaned.length > maxLength) {
    cleaned = `${cleaned.substring(0, maxLength)}...[Truncated ${cleaned.length} bytes]`;
  }

  // Redact token/secret patterns embedded in strings
  return cleaned
    .replace(/Bearer\s+[A-Za-z0-9-_.]+/gi, 'Bearer [REDACTED_TOKEN]')
    .replace(/__Host-zdex_session=[A-Za-z0-9-_.]+/gi, '__Host-zdex_session=[REDACTED_COOKIE]')
    .replace(/__Host-zdex_admin_session=[A-Za-z0-9-_.]+/gi, '__Host-zdex_admin_session=[REDACTED_COOKIE]')
    .replace(/x-zdex-csrf-token:\s*[^\r\n ]+/gi, 'x-zdex-csrf-token: [REDACTED_CSRF]')
    .replace(/x-zdex-admin-csrf-token:\s*[^\r\n ]+/gi, 'x-zdex-admin-csrf-token: [REDACTED_CSRF]')
    .replace(/([?&](?:token|accessToken|sessionToken|authToken|connectionToken|secret|key|apiKey)=)[^&\s]+/gi, '$1[REDACTED_URL_TOKEN]')
    .replace(/mysql:\/\/[^@\s]+@[^\s/]+/gi, 'mysql://[REDACTED_DB_CREDENTIALS]@***')
    .replace(/((?:password|otp|secret|credential)=)[^&\s]+/gi, '$1[REDACTED]');
}

/**
 * Checks whether a key matches any sensitive security pattern.
 */
export function isSensitiveKey(key: string): boolean {
  if (!key) return false;
  const lower = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_KEY_PATTERNS.some(p => p.test(lower));
}

/**
 * Recursively sanitizes structured metadata to guarantee zero secrets, PII,
 * or raw file payloads leak into logs, with log injection prevention and depth bounds.
 */
export function sanitizeLogMetadata(obj: unknown, depth = 0): any {
  if (depth > 5) return '[MaxDepthExceeded]';
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    return sanitizeLogString(obj, 1024);
  }

  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return obj;
  }

  if (obj instanceof Error) {
    return {
      name: sanitizeLogString(obj.name),
      message: sanitizeLogString(obj.message),
      stack: config.NODE_ENV === 'production' ? undefined : sanitizeLogString(obj.stack || '')
    };
  }

  if (Array.isArray(obj)) {
    return obj.slice(0, 50).map(item => sanitizeLogMetadata(item, depth + 1));
  }

  if (typeof obj === 'object') {
    const sanitized: Record<string, any> = {};
    const entries = Object.entries(obj as Record<string, any>);

    for (const [key, val] of entries.slice(0, 50)) {
      const sanitizedKey = sanitizeLogString(key, 128);

      if (isSensitiveKey(key)) {
        sanitized[sanitizedKey] = '[REDACTED]';
      } else {
        sanitized[sanitizedKey] = sanitizeLogMetadata(val, depth + 1);
      }
    }

    return sanitized;
  }

  return sanitizeLogString(String(obj));
}

/**
 * Standardized Structured Logger for ZdexCloud Control Plane & Gateway
 */
export class StructuredLogger {
  private serviceName: string;

  constructor(serviceName = 'zdex-control-plane') {
    this.serviceName = serviceName;
  }

  public log(payload: StructuredLogPayload): void {
    const level = payload.level || 'info';
    const timestamp = new Date().toISOString();
    const environment = payload.environment || config.NODE_ENV;

    const structuredRecord = {
      timestamp,
      level,
      service: payload.service || this.serviceName,
      environment,
      requestId: payload.requestId || RequestContextStore.getRequestId(),
      operation: payload.operation ? sanitizeLogString(payload.operation, 128) : undefined,
      event: payload.event ? sanitizeLogString(payload.event, 128) : undefined,
      resourceType: payload.resourceType ? sanitizeLogString(payload.resourceType, 128) : undefined,
      resourceId: payload.resourceId ? sanitizeLogString(payload.resourceId, 128) : undefined,
      userId: payload.userId ? sanitizeLogString(payload.userId, 128) : undefined,
      adminId: payload.adminId ? sanitizeLogString(payload.adminId, 128) : undefined,
      deviceId: payload.deviceId ? sanitizeLogString(payload.deviceId, 128) : undefined,
      serverId: payload.serverId ? sanitizeLogString(payload.serverId, 128) : undefined,
      gatewayNodeId: payload.gatewayNodeId ? sanitizeLogString(payload.gatewayNodeId, 128) : undefined,
      durationMs: payload.durationMs,
      statusCode: payload.statusCode,
      errorCode: payload.errorCode ? sanitizeLogString(payload.errorCode, 128) : undefined,
      message: payload.message ? sanitizeLogString(payload.message, 1024) : undefined,
      metadata: payload.metadata ? sanitizeLogMetadata(payload.metadata) : undefined,
      error: payload.error instanceof Error
        ? {
            name: sanitizeLogString(payload.error.name),
            message: sanitizeLogString(payload.error.message),
            stack: environment === 'production' ? undefined : sanitizeLogString(payload.error.stack || '')
          }
        : payload.error ? sanitizeLogString(String(payload.error)) : undefined
    };

    const serialized = JSON.stringify(structuredRecord);
    if (level === 'error') {
      console.error(serialized);
    } else if (level === 'warn') {
      console.warn(serialized);
    } else if (level === 'debug' || level === 'trace') {
      if (config.LOG_LEVEL === 'debug' || config.LOG_LEVEL === 'trace') {
        console.debug(serialized);
      }
    } else {
      console.log(serialized);
    }
  }

  public info(message: string, context?: Partial<StructuredLogPayload>): void {
    this.log({ level: 'info', message, ...context });
  }

  public warn(message: string, context?: Partial<StructuredLogPayload>): void {
    this.log({ level: 'warn', message, ...context });
  }

  public error(message: string, error?: Error | unknown, context?: Partial<StructuredLogPayload>): void {
    this.log({ level: 'error', message, error, ...context });
  }

  public debug(message: string, context?: Partial<StructuredLogPayload>): void {
    this.log({ level: 'debug', message, ...context });
  }
}

export const appLogger = new StructuredLogger('zdex-control-plane');
export const gatewayLogger = new StructuredLogger('zdex-gateway-relay');
export const auditLogger = new StructuredLogger('zdex-security-audit');
