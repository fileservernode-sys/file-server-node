import crypto from 'node:crypto';
import {
  CameraInstance,
  CameraStatus,
  CameraEndpointStatus,
  CameraStreamSessionStatus,
  CameraTransportType,
  CameraAuditEventType,
  CameraUsageCategory,
  BillingStatus
} from '@prisma/client';
import { prisma } from '../config/database.js';
import {
  ValidationError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  SecurityAuditPersistenceError
} from '../errors/app-error.js';
import { hashSessionToken } from '../utils/crypto.js';
import { EntitlementService } from './billing/entitlement_service.js';
import { CameraDeviceIdentityService } from './camera_device_identity_service.js';
import { CameraLifecycleService } from './camera_lifecycle_service.js';
import { config } from '../config/env.js';
import { sanitizeLogString, sanitizeLogMetadata, auditLogger } from '../observability/logger.js';
import { RequestContextStore } from '../observability/request_context.js';

export enum AuditEventSeverity {
  CRITICAL = 'CRITICAL',
  OPERATIONAL = 'OPERATIONAL'
}

/**
 * Classifies an audit event by importance:
 * - Critical: denied access, viewing-token issuance, authorization failures, security-sensitive permission changes/unlinking.
 * - Operational: configuration updates, ordinary lifecycle requests, and status-related telemetry.
 */
export function classifyAuditEvent(eventType: CameraAuditEventType, result?: string): AuditEventSeverity {
  if (result === 'DENIED' || result === 'FAILED') {
    return AuditEventSeverity.CRITICAL;
  }

  switch (eventType) {
    case CameraAuditEventType.VIEWING_ACCESS_DENIED:
    case CameraAuditEventType.SIGNALING_AUTH_FAILED:
    case CameraAuditEventType.VIEWING_SESSION_REQUESTED:
    case CameraAuditEventType.CAMERA_UNLINKED:
      return AuditEventSeverity.CRITICAL;

    case CameraAuditEventType.CAMERA_CONFIG_UPDATED:
    case CameraAuditEventType.CAMERA_STARTED:
    case CameraAuditEventType.CAMERA_STOPPED:
    case CameraAuditEventType.CAMERA_REGISTERED:
    case CameraAuditEventType.VIEWING_SESSION_STARTED:
    case CameraAuditEventType.VIEWING_SESSION_ENDED:
    case CameraAuditEventType.TURN_CREDENTIALS_ISSUED:
    case CameraAuditEventType.SIGNALING_AUTHENTICATED:
    default:
      return AuditEventSeverity.OPERATIONAL;
  }
}

export interface RegisterCameraInput {
  cameraName?: string;
  deviceId?: string;
  installationId?: string;
  resolution?: string;
  fps?: number;
  audioEnabled?: boolean;
  lensFacing?: string;
  metadata?: Record<string, any>;
}

export interface ListCamerasQuery {
  status?: CameraStatus;
  deviceId?: string;
  limit?: number;
  page?: number;
  cursor?: string;
}

export interface UpdateCameraConfigInput {
  cameraName?: string;
  resolution?: string;
  fps?: number;
  audioEnabled?: boolean;
  lensFacing?: string;
  metadata?: Record<string, any>;
}

export interface GetUsageQuery {
  cameraId?: string;
  category?: CameraUsageCategory;
  from?: string;
  to?: string;
  limit?: number;
  page?: number;
}

export interface ViewingTokenResult {
  viewingToken: string;
  tokenType: string;
  expiresIn: number;
  expiresAt: string;
  sessionId: string;
  cameraId: string;
  transportType: CameraTransportType;
  signalingPath: string;
}

export interface ValidateViewingTokenResult {
  valid: boolean;
  reason?:
    | 'TOKEN_INVALID'
    | 'TOKEN_EXPIRY_MISSING'
    | 'TOKEN_EXPIRED'
    | 'SESSION_ENDED'
    | 'SESSION_REVOKED'
    | 'SESSION_INVALID'
    | 'CAMERA_NOT_FOUND'
    | 'UNAUTHORIZED_VIEWER'
    | 'CAMERA_MISMATCH'
    | 'STREAMING_NOT_ENTITLED';
  session?: any;
  camera?: any;
  userId?: string;
  expiresAt?: Date | null;
}

/**
 * CameraService
 * Core business logic, authorization, entitlement evaluation, and audit logging
 * for ZdexCloud Camera (Phase 20.2 API Foundation & Corrective Hardening).
 */
export class CameraService {

  /**
   * Internal helper: Records a structured CameraAccessAuditEvent inside an existing Prisma transaction.
   * Guarantees transactional consistency for critical business operations (e.g. token issuance, deletion).
   */
  public static async recordAuditEventWithTx(
    tx: any,
    params: {
      cameraInstanceId?: string | null;
      userId?: string | null;
      actorType?: string;
      eventType: CameraAuditEventType;
      action: string;
      result?: string;
      ipAddress?: string | null;
      userAgent?: string | null;
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    const sanitizedMeta = params.metadata ? sanitizeLogMetadata(params.metadata) : {};

    await tx.cameraAccessAuditEvent.create({
      data: {
        cameraInstanceId: params.cameraInstanceId || null,
        userId: params.userId || null,
        actorType: params.actorType || 'USER',
        eventType: params.eventType,
        action: params.action,
        result: params.result || 'SUCCESS',
        ipAddress: params.ipAddress ? sanitizeLogString(params.ipAddress, 64) : null,
        userAgent: params.userAgent ? sanitizeLogString(params.userAgent, 512) : null,
        metadata: sanitizedMeta
      }
    });

    auditLogger.log({
      level: params.result === 'FAILED' || params.result === 'DENIED' ? 'warn' : 'info',
      event: params.eventType,
      action: params.action,
      userId: params.userId || undefined,
      cameraId: params.cameraInstanceId || undefined,
      requestId: RequestContextStore.getRequestId() || 'req_untracked',
      result: params.result || 'SUCCESS'
    });
  }

  /**
   * Internal helper: Records a structured CameraAccessAuditEvent in the database and audit logger.
   * Enforces privacy by stripping sensitive tokens, credentials, and payloads.
   *
   * Reliability Guarantee:
   * - CRITICAL events (access denied, token issuance, unlinking): Retries up to 3 times with exponential backoff.
   *   If all retries fail, logs a fatal alert to auditLogger and throws SecurityAuditPersistenceError so security events
   *   are never silently erased.
   * - OPERATIONAL events: Best-effort database persistence with warning log on failure.
   */
  public static async recordAuditEvent(params: {
    cameraInstanceId?: string | null;
    userId?: string | null;
    actorType?: string;
    eventType: CameraAuditEventType;
    action: string;
    result?: string;
    ipAddress?: string | null;
    userAgent?: string | null;
    metadata?: Record<string, any>;
  }): Promise<void> {
    const severity = classifyAuditEvent(params.eventType, params.result);
    const sanitizedMeta = params.metadata ? sanitizeLogMetadata(params.metadata) : {};

    // Always log to persistent application audit logger first
    auditLogger.log({
      level: params.result === 'FAILED' || params.result === 'DENIED' ? 'warn' : 'info',
      event: params.eventType,
      action: params.action,
      userId: params.userId || undefined,
      cameraId: params.cameraInstanceId || undefined,
      requestId: RequestContextStore.getRequestId() || 'req_untracked',
      result: params.result || 'SUCCESS',
      severity
    });

    if (severity === AuditEventSeverity.CRITICAL) {
      // Reliable retry loop for critical security audit records
      const maxRetries = 3;
      let lastError: any = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          await prisma.cameraAccessAuditEvent.create({
            data: {
              cameraInstanceId: params.cameraInstanceId || null,
              userId: params.userId || null,
              actorType: params.actorType || 'USER',
              eventType: params.eventType,
              action: params.action,
              result: params.result || 'SUCCESS',
              ipAddress: params.ipAddress ? sanitizeLogString(params.ipAddress, 64) : null,
              userAgent: params.userAgent ? sanitizeLogString(params.userAgent, 512) : null,
              metadata: sanitizedMeta
            }
          });
          return; // Successfully persisted
        } catch (err) {
          lastError = err;
          if (attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, attempt * 50));
          }
        }
      }

      // If critical audit persistence failed after all retries, do NOT silently swallow
      auditLogger.log({
        level: 'fatal',
        event: 'SECURITY_AUDIT_PERSISTENCE_FAILED',
        targetEventType: params.eventType,
        targetAction: params.action,
        userId: params.userId || undefined,
        cameraId: params.cameraInstanceId || undefined,
        requestId: RequestContextStore.getRequestId() || 'req_untracked',
        error: lastError?.message || 'Database write failed'
      });

      throw new SecurityAuditPersistenceError(
        `Critical security audit event (${params.eventType}) could not be reliably persisted.`
      );
    } else {
      // Operational event: best-effort database write
      try {
        await prisma.cameraAccessAuditEvent.create({
          data: {
            cameraInstanceId: params.cameraInstanceId || null,
            userId: params.userId || null,
            actorType: params.actorType || 'USER',
            eventType: params.eventType,
            action: params.action,
            result: params.result || 'SUCCESS',
            ipAddress: params.ipAddress ? sanitizeLogString(params.ipAddress, 64) : null,
            userAgent: params.userAgent ? sanitizeLogString(params.userAgent, 512) : null,
            metadata: sanitizedMeta
          }
        });
      } catch (err: any) {
        auditLogger.log({
          level: 'warn',
          event: 'OPERATIONAL_AUDIT_WRITE_FAILED',
          targetEventType: params.eventType,
          error: err?.message || 'Database write failed'
        });
      }
    }
  }

  /**
   * Registers a new CameraInstance for the authenticated user.
   * Validates device ownership, checks Camera entitlements, enforces quota,
   * prevents duplicate registration, and records audit trail.
   */
  public static async registerCamera(
    userId: string,
    input: RegisterCameraInput,
    context?: { ip?: string; userAgent?: string }
  ): Promise<CameraInstance> {
    // 1. Verify user status and email verification
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new NotFoundError('User account not found');
    }

    CameraDeviceIdentityService.assertVerifiedUser(user);

    let targetDeviceId = input.deviceId || null;

    // 2. If installationId is supplied and no deviceId, resolve or register device
    if (input.installationId && !targetDeviceId) {
      const resolved = await CameraDeviceIdentityService.registerOrResolveCameraDevice({
        userId,
        installationId: input.installationId,
        deviceName: input.cameraName || 'Android Camera Device',
        context
      });
      targetDeviceId = resolved.device.id;
    } else if (targetDeviceId) {
      // If deviceId is supplied, verify physical device ownership and non-revoked status
      const device = await prisma.device.findUnique({
        where: { id: targetDeviceId },
        include: { credential: true }
      });

      if (!device) {
        throw new NotFoundError('Associated device node not found');
      }

      if (device.userId !== userId) {
        await this.recordAuditEvent({
          userId,
          eventType: CameraAuditEventType.CAMERA_REGISTERED,
          action: 'REGISTER_CAMERA',
          result: 'DENIED',
          ipAddress: context?.ip,
          userAgent: context?.userAgent,
          metadata: { attemptedDeviceId: targetDeviceId, reason: 'device_ownership_mismatch' }
        });
        throw new ForbiddenError('You do not have permission to register cameras for this device');
      }

      if (device.credential?.revokedAt) {
        throw new ForbiddenError(
          'Cannot register camera with a revoked device node. Re-authentication required.',
          'DEVICE_REVOKED'
        );
      }
    }

    // 3. Resolve authoritative Camera entitlements
    const entitlements = await EntitlementService.resolveUserEntitlements(userId);

    const maxCameras = entitlements.camera?.maxCameras ?? entitlements.maxCameras ?? 0;
    // If account has 0 camera entitlements (e.g. Storage Free or Storage Pro), require Camera subscription
    if (maxCameras <= 0) {
      await this.recordAuditEvent({
        userId,
        eventType: CameraAuditEventType.CAMERA_REGISTERED,
        action: 'REGISTER_CAMERA',
        result: 'DENIED',
        ipAddress: context?.ip,
        userAgent: context?.userAgent,
        metadata: { reason: 'no_camera_entitlement' }
      });
      throw new ForbiddenError(
        'An active ZdexCloud Camera or Unified Pro subscription is required to register camera instances.',
        'CAMERA_SUBSCRIPTION_REQUIRED'
      );
    }

    // 3. Atomically enforce max camera quota and check for duplicate registration
    const newCamera = await prisma.$transaction(async (tx) => {
      // User row write-lock to serialize concurrent camera creations
      await tx.$executeRawUnsafe('SELECT id FROM `User` WHERE id = ? FOR UPDATE', userId);

      // Check current owned camera count
      const cameraCount = await tx.cameraInstance.count({
        where: { userId }
      });

      if (cameraCount >= maxCameras) {
        throw new ConflictError(
          `Your account has reached the maximum limit of ${maxCameras} active camera instances.`,
          'MAX_CAMERAS_REACHED'
        );
      }

      // Check for duplicate registration on same device with identical name
      if (targetDeviceId && input.cameraName) {
        const existingDuplicate = await tx.cameraInstance.findFirst({
          where: {
            userId,
            deviceId: targetDeviceId,
            cameraName: input.cameraName
          }
        });
        if (existingDuplicate) {
          return existingDuplicate;
        }
      }

      const camera = await tx.cameraInstance.create({
        data: {
          userId,
          deviceId: targetDeviceId || null,
          cameraName: input.cameraName?.trim() || `Camera ${cameraCount + 1}`,
          status: CameraStatus.OFFLINE,
          resolution: input.resolution || '720p',
          fps: input.fps ?? 20,
          audioEnabled: input.audioEnabled ?? false,
          lensFacing: input.lensFacing || 'BACK',
          metadata: input.metadata ?? undefined
        }
      });

      // Create initial inactive endpoint metadata
      await tx.cameraEndpoint.create({
        data: {
          cameraInstanceId: camera.id,
          status: CameraEndpointStatus.INACTIVE
        }
      });

      // Link to multi-product AccountProductSubscription if available
      const activeSlot = await tx.accountProductSubscription.findFirst({
        where: {
          userId,
          productType: { in: ['CAMERA', 'UNIFIED_PRO'] },
          status: BillingStatus.ACTIVE
        }
      });

      if (activeSlot) {
        await tx.cameraSubscription.create({
          data: {
            cameraInstanceId: camera.id,
            userId,
            accountProductSubscriptionId: activeSlot.id,
            subscriptionId: activeSlot.subscriptionId,
            status: BillingStatus.ACTIVE
          }
        });
      }

      // Commit audit record atomically within the same database transaction
      await this.recordAuditEventWithTx(tx, {
        cameraInstanceId: camera.id,
        userId,
        eventType: CameraAuditEventType.CAMERA_REGISTERED,
        action: 'REGISTER_CAMERA',
        result: 'SUCCESS',
        ipAddress: context?.ip,
        userAgent: context?.userAgent,
        metadata: {
          cameraName: camera.cameraName,
          deviceId: camera.deviceId,
          resolution: camera.resolution
        }
      });

      return camera;
    }, { maxWait: 15000, timeout: 30000 });

    return newCamera;
  }

  /**
   * Lists cameras owned by the authenticated user with optional filtering and pagination.
   * Strictly scopes all queries to userId to prevent cross-account leakage.
   */
  public static async listCameras(
    userId: string,
    query: ListCamerasQuery
  ): Promise<{
    cameras: CameraInstance[];
    totalCount: number;
    page: number;
    limit: number;
    hasMore: boolean;
  }> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const whereClause: any = { userId };

    if (query.status) {
      whereClause.status = query.status;
    }

    if (query.deviceId) {
      whereClause.deviceId = query.deviceId;
    }

    const [cameras, totalCount] = await Promise.all([
      prisma.cameraInstance.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.cameraInstance.count({
        where: whereClause
      })
    ]);

    return {
      cameras,
      totalCount,
      page,
      limit,
      hasMore: skip + cameras.length < totalCount
    };
  }

  /**
   * Retrieves detailed camera record by ID.
   * Throws NotFoundError if camera does not exist or belongs to another user.
   */
  public static async getCameraDetails(
    userId: string,
    cameraId: string
  ): Promise<CameraInstance & { endpoint?: any; device?: any }> {
    const camera = await prisma.cameraInstance.findUnique({
      where: { id: cameraId },
      include: {
        device: {
          select: {
            id: true,
            deviceName: true,
            platform: true,
            status: true,
            lastSeenAt: true
          }
        },
        endpoints: {
          select: {
            id: true,
            status: true,
            signalingUrl: true,
            connectedAt: true,
            disconnectedAt: true,
            lastHeartbeatAt: true
          },
          take: 1
        }
      }
    });

    if (!camera || camera.userId !== userId) {
      throw new NotFoundError('Camera instance not found');
    }

    return camera as any;
  }

  /**
   * Updates supported camera configuration preferences.
   * Validates values against technical boundaries and prevents mass-assignment of protected fields.
   */
  public static async updateCameraConfig(
    userId: string,
    cameraId: string,
    input: UpdateCameraConfigInput,
    context?: { ip?: string; userAgent?: string }
  ): Promise<{
    camera: CameraInstance;
    configurationAppliedToDevice: boolean;
    message: string;
  }> {
    const existing = await prisma.cameraInstance.findUnique({
      where: { id: cameraId }
    });

    if (!existing || existing.userId !== userId) {
      throw new NotFoundError('Camera instance not found');
    }

    // Build safe sanitized update data, strictly excluding status, userId, deviceId, etc.
    const updateData: any = {};

    if (input.cameraName !== undefined) {
      const trimmed = input.cameraName.trim();
      if (trimmed.length < 1 || trimmed.length > 64) {
        throw new ValidationError('Camera name must be between 1 and 64 characters');
      }
      updateData.cameraName = trimmed;
    }

    if (input.resolution !== undefined) {
      const validResolutions = ['360p', '480p', '720p', '1080p'];
      if (!validResolutions.includes(input.resolution)) {
        throw new ValidationError(`Invalid resolution. Allowed values: ${validResolutions.join(', ')}`);
      }
      updateData.resolution = input.resolution;
    }

    if (input.fps !== undefined) {
      if (typeof input.fps !== 'number' || input.fps < 5 || input.fps > 30) {
        throw new ValidationError('FPS must be an integer between 5 and 30');
      }
      updateData.fps = input.fps;
    }

    if (input.audioEnabled !== undefined) {
      updateData.audioEnabled = Boolean(input.audioEnabled);
    }

    if (input.lensFacing !== undefined) {
      const validLenses = ['BACK', 'FRONT'];
      if (!validLenses.includes(input.lensFacing.toUpperCase())) {
        throw new ValidationError('lensFacing must be either BACK or FRONT');
      }
      updateData.lensFacing = input.lensFacing.toUpperCase();
    }

    if (input.metadata !== undefined) {
      const existingMeta = (existing.metadata as Record<string, any>) || {};
      updateData.metadata = { ...existingMeta, ...input.metadata };
    }

    const updatedCamera = await prisma.cameraInstance.update({
      where: { id: cameraId },
      data: updateData
    });

    await this.recordAuditEvent({
      cameraInstanceId: cameraId,
      userId,
      eventType: CameraAuditEventType.CAMERA_CONFIG_UPDATED,
      action: 'UPDATE_CONFIG',
      result: 'SUCCESS',
      ipAddress: context?.ip,
      userAgent: context?.userAgent,
      metadata: { updatedFields: Object.keys(updateData) }
    });

    return {
      camera: updatedCamera,
      configurationAppliedToDevice: false,
      message: 'Camera configuration updated on control plane. Settings will sync to Android device upon next connection.'
    };
  }

  /**
   * Requests camera streaming startup.
   * Records requested intent without falsely confirming Android capture state.
   */
  public static async requestStartCamera(
    userId: string,
    cameraId: string,
    context?: { ip?: string; userAgent?: string }
  ): Promise<{
    camera: CameraInstance;
    commandAccepted: boolean;
    stateConfirmedByDevice: boolean;
    message: string;
  }> {
    const camera = await prisma.cameraInstance.findUnique({
      where: { id: cameraId }
    });

    if (!camera || camera.userId !== userId) {
      throw new NotFoundError('Camera instance not found');
    }

    // Check streaming entitlement
    const entitlements = await EntitlementService.resolveUserEntitlements(userId);
    const hasStreaming = entitlements.camera?.liveStreamingEnabled ?? entitlements.cameraStreaming ?? false;
    if (!hasStreaming) {
      throw new ForbiddenError(
        'Live camera streaming requires an active Camera or Unified Pro subscription.',
        'CAMERA_STREAMING_NOT_ENTITLED'
      );
    }

    const existingMeta = (camera.metadata as Record<string, any>) || {};
    const pendingAction = existingMeta.pendingCommand?.action;

    // If already active and no STOP command needs to be superseded, return current confirmed state
    if ((camera.status === CameraStatus.ONLINE || camera.status === CameraStatus.STREAMING) && pendingAction !== 'STOP') {
      return {
        camera,
        commandAccepted: true,
        stateConfirmedByDevice: true,
        message: `Camera is already ${camera.status.toLowerCase()}.`
      };
    }

    // If already connecting for a pending START command, return in-progress command state
    if (camera.status === CameraStatus.CONNECTING && pendingAction !== 'STOP') {
      return {
        camera,
        commandAccepted: true,
        stateConfirmedByDevice: false,
        message: 'Camera start command is already in progress. Awaiting Android device capture confirmation.'
      };
    }

    const commandId = `cmd_${crypto.randomBytes(12).toString('hex')}`;
    const now = new Date();
    const isAlreadyActiveOrConnecting =
      camera.status === CameraStatus.ONLINE ||
      camera.status === CameraStatus.STREAMING ||
      camera.status === CameraStatus.CONNECTING;

    // Record pending START command in metadata; preserve ONLINE/STREAMING if already active (superseding STOP)
    const updatedMeta = {
      ...existingMeta,
      pendingCommand: {
        action: 'START',
        commandId,
        requestedAt: now.toISOString(),
        requestedBy: userId
      }
    };

    const updated = await prisma.cameraInstance.update({
      where: { id: cameraId },
      data: {
        ...(isAlreadyActiveOrConnecting ? {} : { status: CameraStatus.CONNECTING, startedAt: now }),
        metadata: updatedMeta
      }
    });

    await this.recordAuditEvent({
      cameraInstanceId: cameraId,
      userId,
      eventType: CameraAuditEventType.CAMERA_STARTED,
      action: 'START_CAMERA_REQUESTED',
      result: 'SUCCESS',
      ipAddress: context?.ip,
      userAgent: context?.userAgent,
      metadata: { pendingAction: 'START', commandId }
    });

    return {
      camera: updated,
      commandAccepted: true,
      stateConfirmedByDevice: false,
      message: 'Camera start command accepted. Awaiting Android device capture confirmation.'
    };
  }

  /**
   * Requests camera streaming shutdown.
   * Records requested stop intent without falsely claiming OFFLINE or prematurely terminating
   * active sessions before the Android device confirms shutdown in Phase 20.4.
   */
  public static async requestStopCamera(
    userId: string,
    cameraId: string,
    context?: { ip?: string; userAgent?: string }
  ): Promise<{
    camera: CameraInstance;
    commandAccepted: boolean;
    stateConfirmedByDevice: boolean;
    message: string;
  }> {
    const camera = await prisma.cameraInstance.findUnique({
      where: { id: cameraId }
    });

    if (!camera || camera.userId !== userId) {
      throw new NotFoundError('Camera instance not found');
    }

    if (camera.status === CameraStatus.OFFLINE) {
      return {
        camera,
        commandAccepted: true,
        stateConfirmedByDevice: true,
        message: 'Camera is already offline.'
      };
    }

    const existingMeta = (camera.metadata as Record<string, any>) || {};

    // Check if stop command is already pending confirmation
    if (existingMeta.pendingCommand?.action === 'STOP') {
      return {
        camera,
        commandAccepted: true,
        stateConfirmedByDevice: false,
        message: 'Camera stop command is already pending confirmation from Android device.'
      };
    }

    // Record pending stop command in metadata WITHOUT changing status to OFFLINE
    // and WITHOUT terminating active sessions until device lifecycle confirms in Phase 20.4
    const commandId = `cmd_${crypto.randomBytes(12).toString('hex')}`;
    const updatedMeta = {
      ...existingMeta,
      pendingCommand: {
        action: 'STOP',
        commandId,
        requestedAt: new Date().toISOString(),
        requestedBy: userId
      }
    };

    const updated = await prisma.cameraInstance.update({
      where: { id: cameraId },
      data: {
        metadata: updatedMeta
      }
    });

    await this.recordAuditEvent({
      cameraInstanceId: cameraId,
      userId,
      eventType: CameraAuditEventType.CAMERA_STOPPED,
      action: 'STOP_CAMERA_REQUESTED',
      result: 'SUCCESS',
      ipAddress: context?.ip,
      userAgent: context?.userAgent,
      metadata: { pendingAction: 'STOP', commandId }
    });

    return {
      camera: updated,
      commandAccepted: true,
      stateConfirmedByDevice: false,
      message: 'Camera stop command accepted. Awaiting Android device confirmation.'
    };
  }

  /**
   * Retrieves latest persisted status for a CameraInstance.
   */
  public static async getCameraStatus(
    userId: string,
    cameraId: string
  ): Promise<{
    cameraId: string;
    status: CameraStatus;
    lastSeenAt: Date | null;
    startedAt: Date | null;
    stoppedAt: Date | null;
    hasActiveSessions: boolean;
    activeViewerCount: number;
    isHeartbeatStale: boolean;
    heartbeatTimeoutMs: number;
    pendingCommand: Record<string, any> | null;
    lastCommandResolution: Record<string, any> | null;
    updatedAt: Date;
  }> {
    const camera = await prisma.cameraInstance.findUnique({
      where: { id: cameraId }
    });

    if (!camera || camera.userId !== userId) {
      throw new NotFoundError('Camera instance not found');
    }

    const now = new Date();
    const activeViewerCount = await prisma.cameraStreamSession.count({
      where: {
        cameraInstanceId: cameraId,
        status: CameraStreamSessionStatus.ACTIVE,
        expiresAt: { gt: now }
      }
    });

    const metadata = (camera.metadata as Record<string, any>) || {};
    const heartbeatTimeoutMs = config.CAMERA_HEARTBEAT_TIMEOUT_MS;
    const isActiveState =
      camera.status === CameraStatus.ONLINE ||
      camera.status === CameraStatus.STREAMING ||
      camera.status === CameraStatus.RECONNECTING;
    const referenceHeartbeatAt = camera.lastSeenAt || camera.updatedAt;
    const isHeartbeatStale =
      isActiveState && now.getTime() - referenceHeartbeatAt.getTime() > heartbeatTimeoutMs;

    return {
      cameraId: camera.id,
      status: camera.status,
      lastSeenAt: camera.lastSeenAt,
      startedAt: camera.startedAt,
      stoppedAt: camera.stoppedAt,
      hasActiveSessions: activeViewerCount > 0,
      activeViewerCount,
      isHeartbeatStale,
      heartbeatTimeoutMs,
      pendingCommand: metadata.pendingCommand || null,
      lastCommandResolution: metadata.lastCommandResolution || null,
      updatedAt: camera.updatedAt
    };
  }

  /**
   * Unregisters / removes a CameraInstance.
   * Preserves Device and Storage ServerInstance. Audit trail survives via SetNull.
   */
  public static async unregisterCamera(
    userId: string,
    cameraId: string,
    context?: { ip?: string; userAgent?: string }
  ): Promise<{ success: boolean; unlinkedCameraId: string; message: string }> {
    const camera = await prisma.cameraInstance.findUnique({
      where: { id: cameraId }
    });

    if (!camera || camera.userId !== userId) {
      throw new NotFoundError('Camera instance not found');
    }

    // Atomic transaction: commit audit event and remove CameraInstance
    await prisma.$transaction(async (tx) => {
      await this.recordAuditEventWithTx(tx, {
        cameraInstanceId: cameraId,
        userId,
        eventType: CameraAuditEventType.CAMERA_UNLINKED,
        action: 'UNREGISTER_CAMERA',
        result: 'SUCCESS',
        ipAddress: context?.ip,
        userAgent: context?.userAgent,
        metadata: {
          unlinkedCameraId: cameraId,
          cameraName: camera.cameraName,
          deviceId: camera.deviceId
        }
      });

      await tx.cameraInstance.delete({
        where: { id: cameraId }
      });
    });

    return {
      success: true,
      unlinkedCameraId: cameraId,
      message: 'Camera instance successfully unregistered.'
    };
  }

  /**
   * Viewing Authorization Foundation: Issues an ephemeral, short-lived Camera Viewing Token (CVT).
   * Validates viewer permissions, checks active camera streaming entitlements,
   * creates session tracking record with token hash and persisted 15-minute expiresAt,
   * commits critical audit event transactionally, and returns scoped credential.
   */
  public static async createViewingToken(
    userId: string,
    cameraId: string,
    context?: { ip?: string; userAgent?: string }
  ): Promise<ViewingTokenResult> {
    const camera = await prisma.cameraInstance.findUnique({
      where: { id: cameraId }
    });

    if (!camera || camera.userId !== userId) {
      await this.recordAuditEvent({
        cameraInstanceId: cameraId,
        userId,
        eventType: CameraAuditEventType.VIEWING_ACCESS_DENIED,
        action: 'REQUEST_VIEW_TOKEN',
        result: 'DENIED',
        ipAddress: context?.ip,
        userAgent: context?.userAgent,
        metadata: { reason: 'camera_not_found_or_unowned' }
      });
      throw new NotFoundError('Camera instance not found');
    }

    // Verify streaming entitlement
    const entitlements = await EntitlementService.resolveUserEntitlements(userId);
    const hasStreaming = entitlements.camera?.liveStreamingEnabled ?? entitlements.cameraStreaming ?? false;
    if (!hasStreaming) {
      await this.recordAuditEvent({
        cameraInstanceId: cameraId,
        userId,
        eventType: CameraAuditEventType.VIEWING_ACCESS_DENIED,
        action: 'REQUEST_VIEW_TOKEN',
        result: 'DENIED',
        ipAddress: context?.ip,
        userAgent: context?.userAgent,
        metadata: { reason: 'streaming_not_entitled' }
      });
      throw new ForbiddenError(
        'Live camera streaming requires an active Camera or Unified Pro subscription.',
        'CAMERA_STREAMING_NOT_ENTITLED'
      );
    }

    // Cryptographically secure ephemeral raw viewing token (15-minute TTL)
    const rawToken = `cvt_${crypto.randomBytes(32).toString('hex')}`;
    const tokenHash = hashSessionToken(rawToken);
    const ttlSeconds = 900; // 15 minutes
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    // Atomically create session tracking record with persisted expiresAt AND audit event
    const session = await prisma.$transaction(async (tx) => {
      const s = await tx.cameraStreamSession.create({
        data: {
          cameraInstanceId: cameraId,
          viewerUserId: userId,
          sessionTokenHash: tokenHash,
          status: CameraStreamSessionStatus.INITIATED,
          transportType: CameraTransportType.P2P,
          protocol: 'WEBRTC',
          startedAt: new Date(),
          expiresAt
        }
      });

      await this.recordAuditEventWithTx(tx, {
        cameraInstanceId: cameraId,
        userId,
        eventType: CameraAuditEventType.VIEWING_SESSION_REQUESTED,
        action: 'REQUEST_VIEW_TOKEN',
        result: 'SUCCESS',
        ipAddress: context?.ip,
        userAgent: context?.userAgent,
        metadata: { sessionId: s.id, transportType: 'P2P' }
      });

      return s;
    });

    return {
      viewingToken: rawToken,
      tokenType: 'Bearer',
      expiresIn: ttlSeconds,
      expiresAt: expiresAt.toISOString(),
      sessionId: session.id,
      cameraId: camera.id,
      transportType: CameraTransportType.P2P,
      signalingPath: config.CAMERA_SIGNALING_PATH
    };
  }

  /**
   * Internal validation service for future WebRTC signaling integration (Phase 20.5).
   * Validates token format, SHA-256 hash match, session status, authoritative expiration,
   * camera association, user ownership, and active streaming entitlement.
   *
   * Invariants:
   * 1. Never extends token lifetime upon validation or client retries.
   * 2. Rejects expired, ended, revoked, and mismatched sessions.
   * 3. Never logs or exposes raw token string.
   */
  public static async validateViewingToken(
    rawToken: string,
    options?: {
      expectedCameraId?: string;
      expectedUserId?: string;
    }
  ): Promise<ValidateViewingTokenResult> {
    if (!rawToken || typeof rawToken !== 'string' || !rawToken.startsWith('cvt_')) {
      return { valid: false, reason: 'TOKEN_INVALID' };
    }

    const tokenHash = hashSessionToken(rawToken);

    const session = await prisma.cameraStreamSession.findFirst({
      where: { sessionTokenHash: tokenHash },
      include: { cameraInstance: true }
    });

    if (!session) {
      return { valid: false, reason: 'SESSION_INVALID' };
    }

    // Check status: reject ended, failed, or revoked sessions
    if (session.status === CameraStreamSessionStatus.REVOKED) {
      return { valid: false, reason: 'SESSION_REVOKED', session };
    }

    if (
      session.status === CameraStreamSessionStatus.ENDED ||
      session.status === CameraStreamSessionStatus.FAILED
    ) {
      return { valid: false, reason: 'SESSION_ENDED', session };
    }

    if (session.status === CameraStreamSessionStatus.TIMED_OUT) {
      return { valid: false, reason: 'TOKEN_EXPIRED', session };
    }

    // Fail-Closed Expiration Enforcement:
    // Reject any session where expiresAt is null or missing (legacy or unpersisted sessions)
    if (!session.expiresAt) {
      return { valid: false, reason: 'TOKEN_EXPIRY_MISSING', session };
    }

    // Authoritative expiration check (strictly 15-minute TTL boundary)
    const now = new Date();
    if (session.expiresAt <= now) {
      // Transition session to TIMED_OUT if not already finalized
      try {
        await prisma.cameraStreamSession.update({
          where: { id: session.id },
          data: {
            status: CameraStreamSessionStatus.TIMED_OUT,
            endedAt: now,
            terminationReason: 'TOKEN_EXPIRED'
          }
        });
      } catch {
        // Non-blocking status sync
      }

      return { valid: false, reason: 'TOKEN_EXPIRED', session };
    }

    // Verify associated camera exists
    if (!session.cameraInstance) {
      return { valid: false, reason: 'CAMERA_NOT_FOUND', session };
    }

    // Verify expected camera matches if supplied
    if (options?.expectedCameraId && session.cameraInstanceId !== options.expectedCameraId) {
      return { valid: false, reason: 'CAMERA_MISMATCH', session };
    }

    // Verify expected user matches if supplied
    if (options?.expectedUserId && session.viewerUserId !== options.expectedUserId) {
      return { valid: false, reason: 'UNAUTHORIZED_VIEWER', session };
    }

    // Authorize viewer streaming entitlement
    const entitlements = await EntitlementService.resolveUserEntitlements(session.viewerUserId);
    const hasStreaming = entitlements.camera?.liveStreamingEnabled ?? entitlements.cameraStreaming ?? false;
    if (!hasStreaming) {
      return { valid: false, reason: 'STREAMING_NOT_ENTITLED', session };
    }

    return {
      valid: true,
      session,
      camera: session.cameraInstance,
      userId: session.viewerUserId,
      expiresAt: session.expiresAt
    };
  }

  /**
   * Explicitly revokes an active viewing session and its associated viewing token.
   * Transitions session status to REVOKED and transactionally commits an audit event.
   */
  public static async revokeViewingSession(
    userId: string,
    sessionId: string,
    reason = 'REVOKED_BY_USER',
    context?: { ip?: string; userAgent?: string; expectedCameraId?: string }
  ): Promise<{ success: boolean; sessionId: string }> {
    const session = await prisma.cameraStreamSession.findUnique({
      where: { id: sessionId },
      include: { cameraInstance: true }
    });

    if (
      !session ||
      (session.viewerUserId !== userId && session.cameraInstance?.userId !== userId) ||
      (context?.expectedCameraId && session.cameraInstanceId !== context.expectedCameraId)
    ) {
      throw new NotFoundError('Stream session not found');
    }

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.cameraStreamSession.update({
        where: { id: sessionId },
        data: {
          status: CameraStreamSessionStatus.REVOKED,
          endedAt: now,
          terminationReason: reason
        }
      });

      await CameraLifecycleService.reconcileCameraStreamingStateWithTx(tx, session.cameraInstanceId, now);

      await this.recordAuditEventWithTx(tx, {
        cameraInstanceId: session.cameraInstanceId,
        userId,
        eventType: CameraAuditEventType.VIEWING_SESSION_ENDED,
        action: 'REVOKE_VIEWING_TOKEN',
        result: 'SUCCESS',
        ipAddress: context?.ip,
        userAgent: context?.userAgent,
        metadata: { sessionId, reason }
      });
    });

    try {
      const { defaultCameraSignalingService } = await import('./camera_signaling_service.js');
      defaultCameraSignalingService.notifySessionRevoked(sessionId, reason);
    } catch {
      // Best-effort live socket notification; DB revocation is already committed authoritatively
    }

    return { success: true, sessionId };
  }

  /**
   * Retrieves usage tracking records for the authenticated account.
   */
  public static async getUsageRecords(
    userId: string,
    query: GetUsageQuery
  ): Promise<{
    usageRecords: any[];
    totalCount: number;
    page: number;
    limit: number;
  }> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 50));
    const skip = (page - 1) * limit;

    const whereClause: any = { userId };

    if (query.cameraId) {
      // Validate camera ownership
      const camera = await prisma.cameraInstance.findUnique({
        where: { id: query.cameraId }
      });
      if (!camera || camera.userId !== userId) {
        throw new NotFoundError('Camera instance not found');
      }
      whereClause.cameraInstanceId = query.cameraId;
    }

    if (query.category) {
      whereClause.category = query.category;
    }

    if (query.from || query.to) {
      whereClause.periodStart = {};
      if (query.from) {
        whereClause.periodStart.gte = new Date(query.from);
      }
      if (query.to) {
        whereClause.periodStart.lte = new Date(query.to);
      }
    }

    const [records, totalCount] = await Promise.all([
      prisma.cameraUsageRecord.findMany({
        where: whereClause,
        orderBy: { periodStart: 'desc' },
        skip,
        take: limit
      }),
      prisma.cameraUsageRecord.count({
        where: whereClause
      })
    ]);

    // Format BigInt values for JSON serialization
    const formattedRecords = records.map((r) => ({
      ...r,
      quantity: r.quantity.toString()
    }));

    return {
      usageRecords: formattedRecords,
      totalCount,
      page,
      limit
    };
  }
}
