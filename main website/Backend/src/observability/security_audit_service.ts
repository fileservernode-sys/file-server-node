import { AuditEventType, Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { auditLogger, sanitizeLogMetadata, sanitizeLogString } from './logger.js';
import { RequestContextStore } from './request_context.js';
import { AdminAuditService } from '../services/admin/admin_audit_service.js';

export type SecuritySeverity = 'INFO' | 'NOTICE' | 'WARNING' | 'SECURITY' | 'ERROR' | 'CRITICAL';
export type SecurityActorType = 'USER' | 'ADMIN' | 'DEVICE' | 'GATEWAY' | 'SYSTEM' | 'ANONYMOUS';
export type SecurityResult = 'ALLOWED' | 'DENIED' | 'THROTTLED' | 'FAILED' | 'SUCCESS';

export interface SecurityEventParams {
  eventType: string;
  severity?: SecuritySeverity;
  actor?: {
    type?: SecurityActorType;
    id?: string | null;
    email?: string | null;
  };
  resource?: {
    type?: string;
    id?: string | null;
    name?: string | null;
  };
  action: string;
  result: SecurityResult;
  statusCode?: number;
  errorCode?: string;
  reason?: string;
  requestId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}

// Map security event types to matching database Prisma AuditEventType if compatible
const PRISMA_AUDIT_EVENT_TYPE_MAP: Record<string, AuditEventType> = {
  'AUTH_LOGIN_SUCCESS': AuditEventType.LOGIN_ATTEMPT_SUCCESS,
  'AUTH_LOGIN_FAILURE': AuditEventType.LOGIN_ATTEMPT_FAILED,
  'AUTH_OTP_SENT': AuditEventType.OTP_SENT,
  'AUTH_OTP_VERIFIED': AuditEventType.OTP_VERIFIED,
  'AUTH_EMAIL_VERIFIED': AuditEventType.EMAIL_VERIFIED,
  'AUTH_PASSWORD_RESET_REQUESTED': AuditEventType.PASSWORD_RESET_REQUESTED,
  'AUTH_PASSWORD_RESET_SUCCESS': AuditEventType.PASSWORD_RESET_SUCCESS,
  'ACCOUNT_CREATED': AuditEventType.ACCOUNT_CREATED,
  'DEVICE_REGISTERED': AuditEventType.DEVICE_REGISTERED,
  'DEVICE_CONNECTED': AuditEventType.DEVICE_CONNECTED,
  'DEVICE_DISCONNECTED': AuditEventType.DEVICE_DISCONNECTED,
  'SERVER_CREATED': AuditEventType.SERVER_CREATED,
  'SERVER_STARTED': AuditEventType.SERVER_STARTED,
  'SERVER_STOPPED': AuditEventType.SERVER_STOPPED,
  'FILE_MANAGER_LOGIN_SUCCESS': AuditEventType.FILE_MANAGER_LOGIN_SUCCESS,
  'FILE_MANAGER_LOGIN_FAILED': AuditEventType.FILE_MANAGER_LOGIN_FAILED,
  'REMOTE_CONNECTION_CREATED': AuditEventType.REMOTE_CONNECTION_CREATED,
  'REMOTE_CONNECTION_CONNECTED': AuditEventType.REMOTE_CONNECTION_CONNECTED,
  'REMOTE_CONNECTION_DISCONNECTED': AuditEventType.REMOTE_CONNECTION_DISCONNECTED,
  'REMOTE_CONNECTION_FAILED': AuditEventType.REMOTE_CONNECTION_FAILED
};

export class SecurityAuditService {
  /**
   * Centralized ingestion point for all security, audit, and abuse telemetry across ZdexCloud.
   * Enforces:
   * 1. Secret redaction on all payloads and query parameters
   * 2. Log injection stripping (CR/LF, control characters)
   * 3. Bounded payload sizes and depth limits
   * 4. Request context correlation ID attachment
   * 5. Server-generated timestamps and non-spoofed actor attribution
   * 6. Dual-destination dispatch: Structured JSON logs + Persistent Database Audit Trails
   */
  public static async recordSecurityEvent(params: SecurityEventParams): Promise<void> {
    const timestamp = new Date().toISOString();
    const severity = params.severity || (params.result === 'DENIED' || params.result === 'FAILED' ? 'SECURITY' : 'INFO');
    const effectiveRequestId = params.requestId || RequestContextStore.getRequestId() || 'req_untracked';

    const actorType = params.actor?.type || 'SYSTEM';
    const actorId = params.actor?.id ? sanitizeLogString(params.actor.id, 128) : null;
    const actorEmail = params.actor?.email ? sanitizeLogString(params.actor.email, 256) : null;

    const resourceType = params.resource?.type ? sanitizeLogString(params.resource.type, 128) : undefined;
    const resourceId = params.resource?.id ? sanitizeLogString(params.resource.id, 128) : undefined;

    const sanitizedIp = params.ipAddress ? sanitizeLogString(params.ipAddress, 64) : null;
    const sanitizedUserAgent = params.userAgent ? sanitizeLogString(params.userAgent, 512) : null;
    const sanitizedReason = params.reason ? sanitizeLogString(params.reason, 512) : undefined;
    const sanitizedMetadata = params.metadata ? sanitizeLogMetadata(params.metadata) : {};

    // 1. Structured Logging Dispatch to Standard Output / Log Aggregator
    const logLevel = severity === 'CRITICAL' || severity === 'ERROR' ? 'error' : (severity === 'WARNING' || severity === 'SECURITY' ? 'warn' : 'info');

    auditLogger.log({
      level: logLevel,
      event: sanitizeLogString(params.eventType, 128),
      requestId: effectiveRequestId,
      userId: actorType === 'USER' ? (actorId || undefined) : undefined,
      adminId: actorType === 'ADMIN' ? (actorId || undefined) : undefined,
      deviceId: actorType === 'DEVICE' ? (actorId || undefined) : undefined,
      operation: sanitizeLogString(params.action, 128),
      resourceType,
      resourceId,
      statusCode: params.statusCode,
      errorCode: params.errorCode ? sanitizeLogString(params.errorCode, 128) : undefined,
      message: `[SecurityAudit] [${severity}] ${params.eventType} - Result: ${params.result}${sanitizedReason ? ` (${sanitizedReason})` : ''}`,
      metadata: {
        severity,
        actor: { type: actorType, id: actorId, email: actorEmail ? actorEmail.replace(/(.{2})(.*)(@.*)/, '$1***$3') : undefined },
        resource: { type: resourceType, id: resourceId },
        result: params.result,
        reason: sanitizedReason,
        ipAddress: sanitizedIp,
        userAgent: sanitizedUserAgent,
        ...sanitizedMetadata
      }
    });

    // 2. Database Audit Dispatch (Fail-Safe)
    try {
      // For Admin operations, forward to AdminAuditService for cryptographic tamper-evident chaining
      if (actorType === 'ADMIN' && (params.metadata as any)?.adminAuditAction) {
        await AdminAuditService.logEvent({
          adminId: actorId,
          action: (params.metadata as any).adminAuditAction,
          status: params.result === 'SUCCESS' || params.result === 'ALLOWED' ? 'SUCCESS' : 'DENIED',
          ipAddress: sanitizedIp,
          userAgent: sanitizedUserAgent,
          metadata: {
            eventType: params.eventType,
            resourceType,
            resourceId,
            action: params.action,
            reason: sanitizedReason,
            ...sanitizedMetadata
          }
        });
        return;
      }

      // Check if event maps to native Prisma AuditEventType
      const mappedPrismaType = PRISMA_AUDIT_EVENT_TYPE_MAP[params.eventType];
      if (mappedPrismaType) {
        try {
          await prisma.auditEvent.create({
            data: {
              userId: actorType === 'USER' ? actorId : null,
              deviceId: actorType === 'DEVICE' ? actorId : null,
              eventType: mappedPrismaType,
              metadata: {
                severity,
                action: params.action,
                result: params.result,
                reason: sanitizedReason,
                resourceType,
                resourceId,
                requestId: effectiveRequestId,
                ipAddress: sanitizedIp,
                ...sanitizedMetadata
              } as Prisma.InputJsonValue
            }
          });
        } catch (fkErr: any) {
          // If foreign key constraint failed (e.g. anonymous/unregistered user or dummy ID), persist without FK constraint
          if (fkErr?.code === 'P2003' || String(fkErr?.message || fkErr).includes('Foreign key')) {
            await prisma.auditEvent.create({
              data: {
                userId: null,
                deviceId: null,
                eventType: mappedPrismaType,
                metadata: {
                  severity,
                  unverifiedActorId: actorId,
                  action: params.action,
                  result: params.result,
                  reason: sanitizedReason,
                  resourceType,
                  resourceId,
                  requestId: effectiveRequestId,
                  ipAddress: sanitizedIp,
                  ...sanitizedMetadata
                } as Prisma.InputJsonValue
              }
            });
          } else {
            throw fkErr;
          }
        }
      }
    } catch (err: any) {
      // Non-blocking fail-safe: log persistence failure without crashing caller
      auditLogger.warn(`[SecurityAudit] Database audit persistence failure: ${err.message}`, {
        requestId: effectiveRequestId,
        errorCode: 'AUDIT_DB_WRITE_FAILED'
      });
    }
  }

  // --- Specialized Convenience Helpers ---

  public static async recordAuthEvent(params: {
    eventType: 'AUTH_LOGIN_SUCCESS' | 'AUTH_LOGIN_FAILURE' | 'AUTH_OTP_SENT' | 'AUTH_OTP_VERIFIED' | 'AUTH_OTP_FAILED' | 'AUTH_LOGOUT' | 'AUTH_PASSWORD_RESET_REQUESTED' | 'AUTH_PASSWORD_RESET_SUCCESS' | 'AUTH_EMAIL_VERIFIED';
    userId?: string | null;
    email?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    reason?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const isSuccess = !params.eventType.includes('FAILURE') && !params.eventType.includes('FAILED');
    await this.recordSecurityEvent({
      eventType: params.eventType,
      severity: isSuccess ? 'INFO' : 'SECURITY',
      actor: { type: 'USER', id: params.userId, email: params.email },
      action: params.eventType,
      result: isSuccess ? 'SUCCESS' : 'FAILED',
      reason: params.reason,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      metadata: params.metadata
    });
  }

  public static async recordAuthzDenied(params: {
    userId?: string | null;
    resourceType: string;
    resourceId?: string | null;
    action: string;
    reason?: string;
    ipAddress?: string | null;
    userAgent?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.recordSecurityEvent({
      eventType: 'AUTHZ_DENIED',
      severity: 'SECURITY',
      actor: { type: 'USER', id: params.userId },
      resource: { type: params.resourceType, id: params.resourceId },
      action: params.action,
      result: 'DENIED',
      reason: params.reason || 'Unauthorized access attempt',
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      metadata: params.metadata
    });
  }

  public static async recordCrossTenantBlocked(params: {
    userId: string;
    targetTenantId?: string | null;
    resourceType: string;
    resourceId: string;
    action: string;
    ipAddress?: string | null;
  }): Promise<void> {
    await this.recordSecurityEvent({
      eventType: 'AUTHZ_CROSS_TENANT_BLOCKED',
      severity: 'SECURITY',
      actor: { type: 'USER', id: params.userId },
      resource: { type: params.resourceType, id: params.resourceId },
      action: params.action,
      result: 'DENIED',
      reason: 'Cross-tenant resource access violation blocked',
      ipAddress: params.ipAddress,
      metadata: { targetTenantId: params.targetTenantId }
    });
  }

  public static async recordGatewaySecurity(params: {
    eventType: 'GATEWAY_CONNECTION_ACCEPTED' | 'GATEWAY_CONNECTION_REJECTED' | 'GATEWAY_AUTH_FAILED' | 'GATEWAY_OWNERSHIP_MISMATCH' | 'GATEWAY_ABNORMAL_DISCONNECT';
    deviceId?: string | null;
    gatewayNodeId?: string | null;
    reason?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const isDenied = params.eventType.includes('REJECTED') || params.eventType.includes('FAILED') || params.eventType.includes('MISMATCH');
    await this.recordSecurityEvent({
      eventType: params.eventType,
      severity: isDenied ? 'SECURITY' : 'INFO',
      actor: { type: 'GATEWAY', id: params.gatewayNodeId },
      resource: { type: 'DEVICE', id: params.deviceId },
      action: params.eventType,
      result: isDenied ? 'DENIED' : 'ALLOWED',
      reason: params.reason,
      metadata: params.metadata
    });
  }

  public static async recordSsrfBlocked(params: {
    targetHost: string;
    reasonCode: string;
    reason: string;
    ipAddress?: string | null;
  }): Promise<void> {
    await this.recordSecurityEvent({
      eventType: 'SSRF_BLOCKED',
      severity: 'SECURITY',
      actor: { type: 'SYSTEM' },
      resource: { type: 'EGRESS_DESTINATION', id: sanitizeLogString(params.targetHost, 128) },
      action: 'OUTBOUND_HTTP_FETCH',
      result: 'DENIED',
      errorCode: params.reasonCode,
      reason: params.reason,
      ipAddress: params.ipAddress
    });
  }

  public static async recordRateLimitThrottled(params: {
    ipAddress?: string | null;
    endpoint: string;
    userId?: string | null;
    limitType?: string;
  }): Promise<void> {
    await this.recordSecurityEvent({
      eventType: 'RATE_LIMIT_TRIGGERED',
      severity: 'WARNING',
      actor: { type: params.userId ? 'USER' : 'ANONYMOUS', id: params.userId },
      resource: { type: 'API_ENDPOINT', id: sanitizeLogString(params.endpoint, 128) },
      action: 'HTTP_REQUEST',
      result: 'THROTTLED',
      statusCode: 429,
      errorCode: 'RATE_LIMIT_EXCEEDED',
      reason: `Rate limit threshold exceeded (${params.limitType || 'General'})`,
      ipAddress: params.ipAddress
    });
  }

  public static async recordFileManagerSecurity(params: {
    eventType: 'FILE_MANAGER_LOGIN_SUCCESS' | 'FILE_MANAGER_LOGIN_FAILED' | 'FILE_MANAGER_AUTHZ_DENIED' | 'FILE_MANAGER_PATH_TRAVERSAL_BLOCKED' | 'FILE_MANAGER_MUTATION';
    userId: string;
    serverId: string;
    action: string;
    sanitizedPath?: string;
    fileSize?: number;
    result: SecurityResult;
    reason?: string;
  }): Promise<void> {
    await this.recordSecurityEvent({
      eventType: params.eventType,
      severity: params.result === 'DENIED' || params.result === 'FAILED' ? 'SECURITY' : 'INFO',
      actor: { type: 'USER', id: params.userId },
      resource: { type: 'SERVER', id: params.serverId },
      action: params.action,
      result: params.result,
      reason: params.reason,
      metadata: {
        path: params.sanitizedPath ? sanitizeLogString(params.sanitizedPath, 256) : undefined,
        fileSize: params.fileSize
      }
    });
  }
}
