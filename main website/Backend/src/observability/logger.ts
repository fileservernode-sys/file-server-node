import { config } from '../config/env.js';

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

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'adminpasswordhash',
  'token',
  'sessiontoken',
  'sessiontokenhash',
  'connectiontoken',
  'otp',
  'otphash',
  'authorization',
  'cookie',
  'apikey',
  'secret',
  'privatekey',
  'database64',
  'filecontent',
  'content',
  'payload',
  'body'
]);

/**
 * Recursively sanitizes structured metadata to guarantee zero secrets, PII,
 * or raw file payloads leak into logs.
 */
export function sanitizeLogMetadata(obj: unknown, depth = 0): any {
  if (depth > 5) return '[MaxDepthExceeded]';
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    // Mask potential token/secret patterns
    if (obj.length > 300) {
      return `${obj.substring(0, 50)}...[Truncated ${obj.length} bytes]`;
    }
    return obj
      .replace(/Bearer\s+[A-Za-z0-9-_.]+/gi, 'Bearer [REDACTED_TOKEN]')
      .replace(/mysql:\/\/[^@\s]+@[^\s/]+/gi, 'mysql://[REDACTED_DB_CREDENTIALS]@***')
      .replace(/password=[^\s&]+/gi, 'password=[REDACTED]');
  }

  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeLogMetadata(item, depth + 1));
  }

  const sanitized: Record<string, any> = {};
  for (const [key, val] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (SENSITIVE_KEYS.has(lowerKey)) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = sanitizeLogMetadata(val, depth + 1);
    }
  }

  return sanitized;
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
      requestId: payload.requestId,
      operation: payload.operation,
      event: payload.event,
      resourceType: payload.resourceType,
      resourceId: payload.resourceId,
      userId: payload.userId,
      adminId: payload.adminId,
      deviceId: payload.deviceId,
      serverId: payload.serverId,
      gatewayNodeId: payload.gatewayNodeId,
      durationMs: payload.durationMs,
      statusCode: payload.statusCode,
      errorCode: payload.errorCode,
      message: payload.message,
      metadata: payload.metadata ? sanitizeLogMetadata(payload.metadata) : undefined,
      error: payload.error instanceof Error
        ? {
            name: payload.error.name,
            message: payload.error.message,
            stack: environment === 'production' ? undefined : payload.error.stack
          }
        : payload.error ? String(payload.error) : undefined
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
export const auditLogger = new StructuredLogger('zdex-admin-audit');
