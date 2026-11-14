import crypto from 'node:crypto';
import { FastifyRequest } from 'fastify';
import {
  CameraInstance,
  CameraStatus,
  CameraEndpointStatus,
  CameraStreamSessionStatus,
  CameraAuditEventType,
  DeviceStatus,
  UserStatus
} from '@prisma/client';
import { prisma } from '../config/database.js';
import { config } from '../config/env.js';
import {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError
} from '../errors/app-error.js';
import { hashSessionToken } from '../utils/crypto.js';
import { resolveCustomerSession } from '../middleware/customer-auth.js';
import { CameraService } from './camera_service.js';
import { appLogger } from '../observability/logger.js';
import {
  metricsCollector,
  type CameraTransitionFailureCategory
} from '../observability/metrics.js';
import { errorIngestionService } from './error_ingestion_service.js';

export interface AuthenticatedDeviceContext {
  deviceId: string;
  userId: string;
  installationId: string | null;
  credentialId: string;
  authMethod: 'DEVICE_CREDENTIAL' | 'DEVICE_RUNTIME_SESSION';
}

export interface PendingCameraCommand {
  commandId?: string;
  action: 'START' | 'STOP';
  requestedAt: string;
  requestedBy: string;
}

export interface RecordCameraHeartbeatInput {
  cameraId: string;
  authDevice: AuthenticatedDeviceContext;
  status?: CameraStatus;
  reportedAt?: string;
  confirmedCommand?: 'START' | 'STOP';
  commandId?: string;
  commandRequestedAt?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  endpointStatus?: CameraEndpointStatus;
  errorCode?: string;
  errorMessage?: string;
  now?: Date;
}

export interface ReportCameraLifecycleInput {
  cameraId: string;
  authDevice: AuthenticatedDeviceContext;
  status: CameraStatus;
  reason?: string;
  errorCode?: string;
  errorMessage?: string;
  confirmedCommand?: 'START' | 'STOP';
  commandId?: string;
  commandRequestedAt?: string;
  reportedAt?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  now?: Date;
}

export interface CameraLifecycleTransitionResult {
  camera: CameraInstance;
  previousStatus: CameraStatus;
  currentStatus: CameraStatus;
  transitioned: boolean;
  idempotent: boolean;
  activeViewerCount: number;
  pendingCommand: PendingCameraCommand | null;
  lastCommandResolution: Record<string, any> | null;
}

export interface ReconcileStaleCamerasOptions {
  now?: Date;
  heartbeatTimeoutMs?: number;
  connectingTimeoutMs?: number;
  reconnectGraceMs?: number;
  batchSize?: number;
}

export interface ReconcileStaleCamerasResult {
  evaluatedAt: string;
  expiredSessionsTimedOut: number;
  streamingReconciledToOnline: number;
  camerasEvaluated: number;
  transitionedToReconnecting: number;
  transitionedToOffline: number;
  skippedConcurrentOrFresh: number;
  errors: Array<{ cameraId: string; message: string }>;
}

/**
 * Permitted CameraInstance lifecycle state transitions (Phase 20.4).
 * Enforces explicit device capture states and recovery paths while rejecting
 * invalid jumps (e.g., OFFLINE -> STREAMING, OFFLINE -> RECONNECTING,
 * CONNECTING -> STREAMING, ERROR -> STREAMING, ONLINE -> CONNECTING).
 */
export const PERMITTED_CAMERA_TRANSITIONS: Record<CameraStatus, ReadonlySet<CameraStatus>> = {
  [CameraStatus.OFFLINE]: new Set([
    CameraStatus.OFFLINE,
    CameraStatus.CONNECTING,
    CameraStatus.ONLINE,
    CameraStatus.ERROR
  ]),
  [CameraStatus.CONNECTING]: new Set([
    CameraStatus.CONNECTING,
    CameraStatus.ONLINE,
    CameraStatus.RECONNECTING,
    CameraStatus.OFFLINE,
    CameraStatus.ERROR
  ]),
  [CameraStatus.ONLINE]: new Set([
    CameraStatus.ONLINE,
    CameraStatus.STREAMING,
    CameraStatus.RECONNECTING,
    CameraStatus.OFFLINE,
    CameraStatus.ERROR
  ]),
  [CameraStatus.STREAMING]: new Set([
    CameraStatus.STREAMING,
    CameraStatus.ONLINE,
    CameraStatus.RECONNECTING,
    CameraStatus.OFFLINE,
    CameraStatus.ERROR
  ]),
  [CameraStatus.RECONNECTING]: new Set([
    CameraStatus.RECONNECTING,
    CameraStatus.ONLINE,
    CameraStatus.STREAMING,
    CameraStatus.OFFLINE,
    CameraStatus.ERROR
  ]),
  [CameraStatus.ERROR]: new Set([
    CameraStatus.ERROR,
    CameraStatus.CONNECTING,
    CameraStatus.ONLINE,
    CameraStatus.OFFLINE
  ])
};

export function isValidLifecycleTransition(from: CameraStatus, to: CameraStatus): boolean {
  const allowed = PERMITTED_CAMERA_TRANSITIONS[from];
  return Boolean(allowed && allowed.has(to));
}

export function assertValidLifecycleTransition(from: CameraStatus, to: CameraStatus): void {
  if (!isValidLifecycleTransition(from, to)) {
    throw new ValidationError(
      `Invalid camera lifecycle transition from ${from} to ${to}.`,
      'INVALID_LIFECYCLE_TRANSITION'
    );
  }
}

function parseOptionalIsoTimestamp(value?: string | null, fieldName = 'timestamp'): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`Invalid ${fieldName} format`, 'INVALID_TIMESTAMP');
  }
  return parsed;
}

/**
 * CameraLifecycleService (Phase 20.4)
 * Centralized, concurrency-safe lifecycle state machine, authenticated device heartbeat manager,
 * stale heartbeat reconciliation engine, start/stop confirmation resolver,
 * and CameraInstance <-> CameraStreamSession consistency coordinator.
 */
export class CameraLifecycleService {

  /**
   * Authenticates an incoming HTTP request strictly as a registered physical Android Device.
   *
   * Security invariants:
   * - Browser viewers (cookie auth or interactive user Bearer sessions) are ALWAYS rejected.
   * - Client-supplied userId/deviceId in body/headers cannot override credential ownership.
   * - Enforces DeviceAuthCredential non-revocation, non-expiration, active user, and DeviceInstallationClaim status.
   */
  public static async authenticateDeviceRequest(
    request: FastifyRequest,
    options?: { expectedDeviceId?: string }
  ): Promise<AuthenticatedDeviceContext> {
    const authHeader = request.headers.authorization;
    const xDeviceCredHeader = request.headers['x-device-credential'];

    let bearerToken: string | null = null;
    if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const raw = authHeader.substring(7).trim();
      if (raw.length > 0) bearerToken = raw;
    }

    let headerCredToken: string | null = null;
    if (xDeviceCredHeader && typeof xDeviceCredHeader === 'string' && xDeviceCredHeader.trim().length > 0) {
      headerCredToken = xDeviceCredHeader.trim();
    }

    // Fail closed if dual conflicting headers were sent
    if (bearerToken && headerCredToken && bearerToken !== headerCredToken) {
      throw new UnauthorizedError('Conflicting device authentication headers supplied', 'CONFLICTING_CREDENTIALS');
    }

    const rawToken = bearerToken || headerCredToken;

    // Reject requests relying on browser cookies without an explicit device credential
    if (!rawToken) {
      const hasSessionCookie = Boolean(
        request.cookies &&
        (request.cookies['__Host-zdex_session'] ||
          request.cookies['zdex_session'] ||
          (request.cookies as Record<string, string | undefined>)['__Host_zdex_session'])
      );
      if (hasSessionCookie) {
        throw new ForbiddenError(
          'Browser viewer sessions cannot report or control device camera lifecycle state.',
          'DEVICE_CREDENTIAL_REQUIRED'
        );
      }
      throw new UnauthorizedError('Device authentication credential is required', 'DEVICE_CREDENTIAL_REQUIRED');
    }

    const tokenHash = hashSessionToken(rawToken);
    const now = new Date();

    // Path 1: Direct persistent DeviceAuthCredential (dst_<hex>)
    const directCred = await prisma.deviceAuthCredential.findUnique({
      where: { credentialHash: tokenHash },
      include: {
        device: {
          include: {
            user: true
          }
        }
      }
    });

    if (directCred) {
      if (directCred.revokedAt) {
        await CameraService.recordAuditEvent({
          userId: directCred.userId,
          actorType: 'DEVICE',
          eventType: CameraAuditEventType.VIEWING_ACCESS_DENIED,
          action: 'REVOKED_DEVICE_CREDENTIAL_REJECTED',
          result: 'DENIED',
          metadata: {
            deviceId: directCred.deviceId,
            reason: 'credential_revoked'
          }
        });
        throw new UnauthorizedError('Device credential has been revoked.', 'CREDENTIAL_REVOKED');
      }

      if (directCred.expiresAt && directCred.expiresAt <= now) {
        throw new UnauthorizedError('Device credential has expired.', 'CREDENTIAL_EXPIRED');
      }

      if (!directCred.device || directCred.device.userId !== directCred.userId) {
        throw new ForbiddenError('Device credential ownership mismatch.', 'DEVICE_OWNERSHIP_MISMATCH');
      }

      if (directCred.device.user.status !== UserStatus.ACTIVE) {
        throw new ForbiddenError('User account is not active.', 'USER_NOT_ACTIVE');
      }

      if (options?.expectedDeviceId && options.expectedDeviceId !== directCred.deviceId) {
        await CameraService.recordAuditEvent({
          userId: directCred.userId,
          actorType: 'DEVICE',
          eventType: CameraAuditEventType.VIEWING_ACCESS_DENIED,
          action: 'DEVICE_ID_MISMATCH_REJECTED',
          result: 'DENIED',
          metadata: {
            authenticatedDeviceId: directCred.deviceId,
            claimedDeviceId: options.expectedDeviceId
          }
        });
        throw new ForbiddenError('Device credential does not match requested deviceId.', 'DEVICE_MISMATCH');
      }

      if (directCred.device.installationId) {
        const claim = await prisma.deviceInstallationClaim.findUnique({
          where: { installationId: directCred.device.installationId }
        });
        if (claim && (claim.userId !== directCred.userId || claim.status === 'REVOKED')) {
          await CameraService.recordAuditEvent({
            userId: directCred.userId,
            actorType: 'DEVICE',
            eventType: CameraAuditEventType.VIEWING_ACCESS_DENIED,
            action: 'REVOKED_INSTALLATION_CLAIM_REJECTED',
            result: 'DENIED',
            metadata: {
              deviceId: directCred.deviceId,
              claimStatus: claim.status
            }
          });
          throw new ForbiddenError(
            'This device installation is revoked or owned by another account.',
            'DEVICE_REVOKED'
          );
        }
      }

      return {
        deviceId: directCred.deviceId,
        userId: directCred.userId,
        installationId: directCred.device.installationId,
        credentialId: directCred.id,
        authMethod: 'DEVICE_CREDENTIAL'
      };
    }

    // Path 2: Scoped runtime session issued by POST /devices/:deviceId/session/refresh (dst_<deviceId>_<hex>)
    const resolved = await resolveCustomerSession(rawToken);
    if (!resolved) {
      throw new UnauthorizedError('Invalid or expired device authentication credential', 'INVALID_DEVICE_CREDENTIAL');
    }

    if (!resolved.deviceScope || resolved.deviceScope.scope !== 'SERVER_RUNTIME' || !resolved.deviceScope.deviceId) {
      throw new ForbiddenError(
        'Interactive user sessions cannot report device camera lifecycle state. Use device credentials.',
        'DEVICE_CREDENTIAL_REQUIRED'
      );
    }

    const scopedDeviceId = resolved.deviceScope.deviceId;
    if (options?.expectedDeviceId && options.expectedDeviceId !== scopedDeviceId) {
      throw new ForbiddenError('Device runtime token is not authorized for the requested deviceId.', 'DEVICE_MISMATCH');
    }

    const credForDevice = await prisma.deviceAuthCredential.findUnique({
      where: { deviceId: scopedDeviceId },
      include: { device: true }
    });

    if (!credForDevice || !credForDevice.device || credForDevice.userId !== resolved.user.id || credForDevice.device.userId !== resolved.user.id) {
      throw new ForbiddenError('Device runtime authorization invalid or mismatched.', 'DEVICE_OWNERSHIP_MISMATCH');
    }

    if (credForDevice.revokedAt) {
      await CameraService.recordAuditEvent({
        userId: resolved.user.id,
        actorType: 'DEVICE',
        eventType: CameraAuditEventType.VIEWING_ACCESS_DENIED,
        action: 'REVOKED_DEVICE_RUNTIME_SESSION_REJECTED',
        result: 'DENIED',
        metadata: {
          deviceId: scopedDeviceId,
          reason: 'credential_revoked'
        }
      });
      throw new UnauthorizedError('Device credential has been revoked.', 'CREDENTIAL_REVOKED');
    }

    if (credForDevice.expiresAt && credForDevice.expiresAt <= now) {
      throw new UnauthorizedError('Device credential has expired.', 'CREDENTIAL_EXPIRED');
    }

    if (credForDevice.device.installationId) {
      const claim = await prisma.deviceInstallationClaim.findUnique({
        where: { installationId: credForDevice.device.installationId }
      });
      if (claim && (claim.userId !== resolved.user.id || claim.status === 'REVOKED')) {
        throw new ForbiddenError(
          'This device installation has been revoked or belongs to another account.',
          'DEVICE_REVOKED'
        );
      }
    }

    return {
      deviceId: scopedDeviceId,
      userId: resolved.user.id,
      installationId: credForDevice.device.installationId,
      credentialId: credForDevice.id,
      authMethod: 'DEVICE_RUNTIME_SESSION'
    };
  }

  /**
   * Verifies that the authenticated device owns and is explicitly bound to target CameraInstance.
   * Rejects cross-account or device-mismatch reports with critical security audit persistence.
   */
  private static async assertAuthorizedCameraDevice(
    camera: CameraInstance | null,
    cameraId: string,
    authDevice: AuthenticatedDeviceContext,
    context?: { ipAddress?: string | null; userAgent?: string | null }
  ): Promise<CameraInstance> {
    if (!camera) {
      throw new NotFoundError('Camera instance not found');
    }

    if (camera.userId !== authDevice.userId) {
      await CameraService.recordAuditEvent({
        cameraInstanceId: cameraId,
        userId: authDevice.userId,
        actorType: 'DEVICE',
        eventType: CameraAuditEventType.VIEWING_ACCESS_DENIED,
        action: 'CROSS_ACCOUNT_DEVICE_REPORT_REJECTED',
        result: 'DENIED',
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        metadata: {
          authenticatedDeviceId: authDevice.deviceId,
          reason: 'cross_account_camera_ownership_mismatch'
        }
      });
      throw new ForbiddenError(
        'Authenticated device does not belong to the owner of this camera.',
        'CROSS_ACCOUNT_CAMERA_ACCESS_DENIED'
      );
    }

    if (!camera.deviceId || camera.deviceId !== authDevice.deviceId) {
      await CameraService.recordAuditEvent({
        cameraInstanceId: cameraId,
        userId: authDevice.userId,
        actorType: 'DEVICE',
        eventType: CameraAuditEventType.VIEWING_ACCESS_DENIED,
        action: 'DEVICE_CAMERA_ASSOCIATION_MISMATCH',
        result: 'DENIED',
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        metadata: {
          authenticatedDeviceId: authDevice.deviceId,
          cameraDeviceId: camera.deviceId || null,
          reason: 'device_not_linked_to_camera'
        }
      });
      throw new ForbiddenError(
        'Authenticated device is not associated with this camera instance.',
        'DEVICE_CAMERA_MISMATCH'
      );
    }

    return camera;
  }

  /**
   * Validates start/stop command confirmations against pendingCommand ordering and timestamps.
   * Prevents delayed START confirmations from overriding newer STOP commands, and vice versa.
   */
  private static evaluateCommandResolution(params: {
    existingMeta: Record<string, any>;
    targetStatus: CameraStatus;
    confirmedCommand?: 'START' | 'STOP';
    commandId?: string;
    commandRequestedAt?: Date | null;
    authDeviceId: string;
    now: Date;
  }): {
    updatedMeta: Record<string, any>;
    commandResolved: 'START' | 'STOP' | null;
  } {
    const existingMeta = { ...(params.existingMeta || {}) };
    const pending: PendingCameraCommand | undefined = existingMeta.pendingCommand;

    if (!pending) {
      return { updatedMeta: existingMeta, commandResolved: null };
    }

    // Validate commandId / commandRequestedAt whenever supplied, even if confirmedCommand is omitted
    if (params.commandId && pending.commandId && params.commandId !== pending.commandId) {
      throw new ConflictError(
        'Command confirmation ID does not match active pending command.',
        'STALE_COMMAND_CONFIRMATION'
      );
    }

    if (
      params.commandRequestedAt &&
      pending.requestedAt &&
      params.commandRequestedAt.getTime() < new Date(pending.requestedAt).getTime()
    ) {
      throw new ConflictError(
        'Delayed command confirmation predates the current pending command.',
        'STALE_COMMAND_CONFIRMATION'
      );
    }

    // 1. Explicit command confirmation validation
    if (params.confirmedCommand) {
      if (params.confirmedCommand !== pending.action) {
        throw new ConflictError(
          `Stale ${params.confirmedCommand} confirmation cannot override newer pending ${pending.action} command.`,
          'STALE_COMMAND_CONFIRMATION'
        );
      }

      delete existingMeta.pendingCommand;
      existingMeta.lastCommandResolution = {
        ...pending,
        status: 'CONFIRMED',
        resolvedAt: params.now.toISOString(),
        resolvedByDeviceId: params.authDeviceId,
        resultingStatus: params.targetStatus
      };
      return { updatedMeta: existingMeta, commandResolved: pending.action };
    }

    // 2. Implicit resolution / conflict protection when confirmedCommand is omitted
    if (pending.action === 'START') {
      // Transition to ONLINE or STREAMING fulfills a pending START command
      if (params.targetStatus === CameraStatus.ONLINE || params.targetStatus === CameraStatus.STREAMING) {
        delete existingMeta.pendingCommand;
        existingMeta.lastCommandResolution = {
          ...pending,
          status: 'CONFIRMED',
          resolvedAt: params.now.toISOString(),
          resolvedByDeviceId: params.authDeviceId,
          resultingStatus: params.targetStatus
        };
        return { updatedMeta: existingMeta, commandResolved: 'START' };
      }

      // Transition to ERROR marks pending START command as failed rather than silently dropping it
      if (params.targetStatus === CameraStatus.ERROR) {
        delete existingMeta.pendingCommand;
        existingMeta.lastCommandResolution = {
          ...pending,
          status: 'FAILED',
          resolvedAt: params.now.toISOString(),
          resolvedByDeviceId: params.authDeviceId,
          resultingStatus: params.targetStatus
        };
        return { updatedMeta: existingMeta, commandResolved: null };
      }
    } else if (pending.action === 'STOP') {
      // Only a transition to OFFLINE fulfills a pending STOP command.
      // Plain ONLINE/STREAMING heartbeats preserve pendingCommand=STOP so the device still receives stop intent.
      if (params.targetStatus === CameraStatus.OFFLINE) {
        delete existingMeta.pendingCommand;
        existingMeta.lastCommandResolution = {
          ...pending,
          status: 'CONFIRMED',
          resolvedAt: params.now.toISOString(),
          resolvedByDeviceId: params.authDeviceId,
          resultingStatus: CameraStatus.OFFLINE
        };
        return { updatedMeta: existingMeta, commandResolved: 'STOP' };
      }
    }

    return { updatedMeta: existingMeta, commandResolved: null };
  }

  /**
   * Reconciles expired CameraStreamSession rows and ensures CameraInstance.status = STREAMING
   * reflects only active, non-expired stream sessions.
   *
   * Never marks a physical camera OFFLINE merely because viewer sessions ended or expired.
   */
  public static async reconcileCameraStreamingStateWithTx(
    tx: any,
    cameraId: string,
    now: Date = new Date()
  ): Promise<{
    expiredSessionsTimedOut: number;
    activeViewerCount: number;
    reconciledToOnline: boolean;
  }> {
    // 1. Transition expired initiating/negotiating/active sessions to TIMED_OUT
    const expiredResult = await tx.cameraStreamSession.updateMany({
      where: {
        cameraInstanceId: cameraId,
        status: {
          in: [
            CameraStreamSessionStatus.INITIATED,
            CameraStreamSessionStatus.NEGOTIATING,
            CameraStreamSessionStatus.ACTIVE
          ]
        },
        expiresAt: { lte: now }
      },
      data: {
        status: CameraStreamSessionStatus.TIMED_OUT,
        endedAt: now,
        terminationReason: 'TOKEN_EXPIRED'
      }
    });

    // 2. Count genuinely active, non-expired viewer sessions
    const activeViewerCount = await tx.cameraStreamSession.count({
      where: {
        cameraInstanceId: cameraId,
        status: CameraStreamSessionStatus.ACTIVE,
        expiresAt: { gt: now }
      }
    });

    // 3. Reconcile STREAMING -> ONLINE if zero valid active sessions remain
    let reconciledToOnline = false;
    if (activeViewerCount === 0) {
      const updatedCam = await tx.cameraInstance.updateMany({
        where: {
          id: cameraId,
          status: CameraStatus.STREAMING
        },
        data: {
          status: CameraStatus.ONLINE
        }
      });

      if (updatedCam.count === 1) {
        reconciledToOnline = true;
        await CameraService.recordAuditEventWithTx(tx, {
          cameraInstanceId: cameraId,
          actorType: 'SYSTEM',
          eventType: CameraAuditEventType.VIEWING_SESSION_ENDED,
          action: 'STREAMING_RECONCILED_TO_ONLINE',
          result: 'SUCCESS',
          metadata: {
            previousStatus: CameraStatus.STREAMING,
            newStatus: CameraStatus.ONLINE,
            reason: 'no_active_viewer_sessions'
          }
        });
      }
    }

    return {
      expiredSessionsTimedOut: expiredResult.count,
      activeViewerCount,
      reconciledToOnline
    };
  }

  /**
   * Public transactional wrapper for reconciling a single camera's STREAMING state vs stream sessions.
   */
  public static async reconcileCameraStreamingState(
    cameraId: string,
    now: Date = new Date()
  ): Promise<{
    expiredSessionsTimedOut: number;
    activeViewerCount: number;
    reconciledToOnline: boolean;
  }> {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM CameraInstance WHERE id = ${cameraId} FOR UPDATE`;
      return this.reconcileCameraStreamingStateWithTx(tx, cameraId, now);
    });
  }

  /**
   * Ends an individual viewer stream session (e.g., browser viewer disconnect)
   * without marking the physical CameraInstance OFFLINE.
   * If this was the final active viewer session and the camera is STREAMING,
   * cleanly transitions CameraInstance from STREAMING to ONLINE.
   */
  public static async onViewerSessionEnded(
    sessionId: string,
    reason = 'VIEWER_DISCONNECTED',
    now: Date = new Date()
  ): Promise<{
    sessionId: string;
    cameraId: string;
    activeViewerCount: number;
    reconciledToOnline: boolean;
  }> {
    return prisma.$transaction(async (tx) => {
      const session = await tx.cameraStreamSession.findUnique({
        where: { id: sessionId }
      });

      if (!session) {
        throw new NotFoundError('Stream session not found');
      }

      await tx.$queryRaw`SELECT id FROM CameraInstance WHERE id = ${session.cameraInstanceId} FOR UPDATE`;

      await tx.cameraStreamSession.updateMany({
        where: {
          id: sessionId,
          status: {
            in: [
              CameraStreamSessionStatus.INITIATED,
              CameraStreamSessionStatus.NEGOTIATING,
              CameraStreamSessionStatus.ACTIVE
            ]
          }
        },
        data: {
          status: CameraStreamSessionStatus.ENDED,
          endedAt: now,
          terminationReason: reason
        }
      });

      await CameraService.recordAuditEventWithTx(tx, {
        cameraInstanceId: session.cameraInstanceId,
        userId: session.viewerUserId,
        actorType: 'USER',
        eventType: CameraAuditEventType.VIEWING_SESSION_ENDED,
        action: 'VIEWER_SESSION_ENDED',
        result: 'SUCCESS',
        metadata: { sessionId, reason }
      });

      const reconciled = await this.reconcileCameraStreamingStateWithTx(
        tx,
        session.cameraInstanceId,
        now
      );

      return {
        sessionId,
        cameraId: session.cameraInstanceId,
        activeViewerCount: reconciled.activeViewerCount,
        reconciledToOnline: reconciled.reconciledToOnline
      };
    });
  }

  /**
   * Processes an authenticated device heartbeat for a CameraInstance.
   *
   * Invariants:
   * - Validates device credential ownership, camera-to-device association, and non-revocation.
   * - Rejects stale reportedAt timestamps.
   * - Makes repeated identical heartbeats idempotent without duplicating audit events.
   * - Updates CameraInstance.lastSeenAt, active CameraEndpoint.lastHeartbeatAt, and Device.lastSeenAt.
   */
  public static async recordCameraHeartbeat(
    input: RecordCameraHeartbeatInput
  ): Promise<CameraLifecycleTransitionResult> {
    const startedAtMs = Date.now();
    const now = input.now || new Date();
    const timeoutMs = config.CAMERA_HEARTBEAT_TIMEOUT_MS;

    try {
      const reportedAtDate = parseOptionalIsoTimestamp(input.reportedAt, 'reportedAt');
      const commandRequestedAtDate = parseOptionalIsoTimestamp(input.commandRequestedAt, 'commandRequestedAt');

      // Reject explicitly stale heartbeat reports before modifying state
      if (reportedAtDate) {
        if (now.getTime() - reportedAtDate.getTime() > timeoutMs) {
          throw new ConflictError(
            'Heartbeat report timestamp exceeds allowed liveness window and is rejected as stale.',
            'STALE_HEARTBEAT_REPORT'
          );
        }
        // Guard against unreasonable future clock skew (> 5 minutes ahead)
        if (reportedAtDate.getTime() - now.getTime() > 5 * 60 * 1000) {
          throw new ValidationError('Heartbeat timestamp is unreasonably far in the future.', 'INVALID_TIMESTAMP');
        }
      }

      // Pre-check ownership & association so unauthorized device reports always commit critical security audit even outside tx
      const preCheckCamera = await prisma.cameraInstance.findUnique({
        where: { id: input.cameraId }
      });
      await this.assertAuthorizedCameraDevice(preCheckCamera, input.cameraId, input.authDevice, {
        ipAddress: input.ipAddress,
        userAgent: input.userAgent
      });

      const result = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM CameraInstance WHERE id = ${input.cameraId} FOR UPDATE`;

        const camera = await tx.cameraInstance.findUnique({
          where: { id: input.cameraId }
        });
        await this.assertAuthorizedCameraDevice(camera, input.cameraId, input.authDevice, {
          ipAddress: input.ipAddress,
          userAgent: input.userAgent
        });

        const lockedCamera = camera!;

        // Reject out-of-order delayed heartbeat older than last recorded stop or lastSeenAt
        if (reportedAtDate) {
          if (lockedCamera.stoppedAt && reportedAtDate.getTime() < lockedCamera.stoppedAt.getTime()) {
            throw new ConflictError(
              'Delayed heartbeat predates camera stop timestamp and cannot reactivate camera.',
              'STALE_HEARTBEAT_REPORT'
            );
          }
          if (lockedCamera.lastSeenAt && reportedAtDate.getTime() < lockedCamera.lastSeenAt.getTime()) {
            throw new ConflictError(
              'Out-of-order heartbeat predates latest recorded heartbeat.',
              'STALE_HEARTBEAT_REPORT'
            );
          }
        }

        // First expire any timed-out stream sessions and get live active session count
        const sessionCheck = await this.reconcileCameraStreamingStateWithTx(tx, lockedCamera.id, now);

        // Determine target status for heartbeat
        let targetStatus: CameraStatus;
        if (input.status) {
          targetStatus = input.status;
          assertValidLifecycleTransition(lockedCamera.status, targetStatus);
        } else if (lockedCamera.status === CameraStatus.STREAMING) {
          targetStatus = sessionCheck.activeViewerCount > 0 ? CameraStatus.STREAMING : CameraStatus.ONLINE;
        } else {
          // Heartbeat from CONNECTING, RECONNECTING, OFFLINE, ERROR, or ONLINE establishes/maintains ONLINE
          targetStatus = CameraStatus.ONLINE;
          assertValidLifecycleTransition(lockedCamera.status, targetStatus);
        }

        if (targetStatus === CameraStatus.STREAMING && sessionCheck.activeViewerCount === 0) {
          throw new ConflictError(
            'Cannot mark camera STREAMING without an active non-expired stream session.',
            'NO_ACTIVE_STREAM_SESSION'
          );
        }

        const existingMeta = (lockedCamera.metadata as Record<string, any>) || {};
        delete existingMeta.staleReason;
        if (targetStatus === CameraStatus.ONLINE || targetStatus === CameraStatus.STREAMING) {
          delete existingMeta.reconnectingSince;
        }
        if (input.errorCode || input.errorMessage) {
          existingMeta.lastError = {
            code: input.errorCode || 'CAMERA_ERROR',
            message: input.errorMessage || 'Device reported camera error',
            reportedAt: now.toISOString()
          };
        } else if (targetStatus === CameraStatus.ONLINE) {
          delete existingMeta.lastError;
        }

        const { updatedMeta, commandResolved } = this.evaluateCommandResolution({
          existingMeta,
          targetStatus,
          confirmedCommand: input.confirmedCommand,
          commandId: input.commandId,
          commandRequestedAt: commandRequestedAtDate,
          authDeviceId: input.authDevice.deviceId,
          now
        });

        const previousStatus = lockedCamera.status;
        const transitioned = previousStatus !== targetStatus;

        const updateData: any = {
          lastSeenAt: now,
          status: targetStatus,
          metadata: updatedMeta
        };

        if (targetStatus === CameraStatus.OFFLINE) {
          updateData.stoppedAt = now;
        } else if (
          (targetStatus === CameraStatus.ONLINE || targetStatus === CameraStatus.CONNECTING) &&
          (previousStatus === CameraStatus.OFFLINE || previousStatus === CameraStatus.ERROR || !lockedCamera.startedAt)
        ) {
          updateData.startedAt = lockedCamera.startedAt || now;
        }

        const updatedCamera = await tx.cameraInstance.update({
          where: { id: lockedCamera.id },
          data: updateData
        });

        // Synchronize active endpoint heartbeat timestamp
        await tx.cameraEndpoint.updateMany({
          where: {
            cameraInstanceId: lockedCamera.id,
            status: { in: [CameraEndpointStatus.READY, CameraEndpointStatus.CONNECTED] }
          },
          data: {
            lastHeartbeatAt: now,
            ...(targetStatus === CameraStatus.OFFLINE
              ? { status: CameraEndpointStatus.INACTIVE, disconnectedAt: now }
              : {})
          }
        });

        // Update device & credential liveness atomically
        await tx.device.update({
          where: { id: input.authDevice.deviceId },
          data: { status: DeviceStatus.ONLINE, lastSeenAt: now }
        });
        await tx.deviceAuthCredential.update({
          where: { id: input.authDevice.credentialId },
          data: { lastUsedAt: now }
        });

        // Emit audit event ONLY when status transitions or a pending command resolves (zero noisy duplicates on repeated heartbeats)
        if (transitioned || commandResolved) {
          const eventType =
            targetStatus === CameraStatus.OFFLINE || targetStatus === CameraStatus.RECONNECTING || targetStatus === CameraStatus.ERROR
              ? CameraAuditEventType.CAMERA_STOPPED
              : CameraAuditEventType.CAMERA_STARTED;

          const action =
            commandResolved === 'START'
              ? 'START_COMMAND_CONFIRMED'
              : commandResolved === 'STOP'
              ? 'STOP_COMMAND_CONFIRMED'
              : previousStatus === CameraStatus.RECONNECTING && targetStatus === CameraStatus.ONLINE
              ? 'CAMERA_RECONNECTED'
              : 'CAMERA_LIFECYCLE_TRANSITION';

          await CameraService.recordAuditEventWithTx(tx, {
            cameraInstanceId: lockedCamera.id,
            userId: input.authDevice.userId,
            actorType: 'DEVICE',
            eventType,
            action,
            result: targetStatus === CameraStatus.ERROR ? 'FAILED' : 'SUCCESS',
            ipAddress: input.ipAddress,
            userAgent: input.userAgent,
            metadata: {
              deviceId: input.authDevice.deviceId,
              previousStatus,
              newStatus: targetStatus,
              ...(commandResolved ? { confirmedCommand: commandResolved } : {})
            }
          });
        }

        return {
          camera: updatedCamera,
          previousStatus,
          currentStatus: targetStatus,
          transitioned,
          idempotent: !transitioned && !commandResolved,
          activeViewerCount: sessionCheck.activeViewerCount,
          pendingCommand: updatedMeta.pendingCommand || null,
          lastCommandResolution: updatedMeta.lastCommandResolution || null
        };
      }, { maxWait: 10000, timeout: 20000 });

      this.recordMetricsSafe(() => {
        metricsCollector.recordCameraHeartbeatLatency(
          Date.now() - startedAtMs,
          result.idempotent ? 'idempotent' : 'processed'
        );
        if (result.transitioned) {
          metricsCollector.recordCameraLifecycleTransition(result.currentStatus, 'heartbeat');
        }
      });

      return result;
    } catch (err) {
      this.recordMetricsSafe(() => {
        metricsCollector.recordCameraHeartbeatLatency(Date.now() - startedAtMs, 'rejected');
        metricsCollector.recordCameraLifecycleTransitionFailure(this.classifyFailureCategory(err));
      });
      if (this.isUnexpectedInternalError(err)) {
        this.reportInternalLifecycleError('recordCameraHeartbeat', err, {
          cameraId: input.cameraId,
          userId: input.authDevice?.userId,
          deviceId: input.authDevice?.deviceId
        });
      }
      // Persist critical failure audit for rejected stale/conflict device attempts where appropriate
      if (err instanceof AppError && (err.errorCode === 'STALE_COMMAND_CONFIRMATION' || err.errorCode === 'STALE_HEARTBEAT_REPORT')) {
        await CameraService.recordAuditEvent({
          cameraInstanceId: input.cameraId,
          userId: input.authDevice.userId,
          actorType: 'DEVICE',
          eventType: CameraAuditEventType.VIEWING_ACCESS_DENIED,
          action: err.errorCode,
          result: 'DENIED',
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          metadata: {
            deviceId: input.authDevice.deviceId,
            errorMessage: err.message
          }
        });
      }
      throw err;
    }
  }

  /**
   * Processes an explicit trusted lifecycle transition report from an authenticated Android Device.
   */
  public static async reportCameraLifecycle(
    input: ReportCameraLifecycleInput
  ): Promise<CameraLifecycleTransitionResult> {
    const now = input.now || new Date();
    const timeoutMs = config.CAMERA_HEARTBEAT_TIMEOUT_MS;

    try {
      const reportedAtDate = parseOptionalIsoTimestamp(input.reportedAt, 'reportedAt');
      const commandRequestedAtDate = parseOptionalIsoTimestamp(input.commandRequestedAt, 'commandRequestedAt');

      if (reportedAtDate && now.getTime() - reportedAtDate.getTime() > timeoutMs) {
        await CameraService.recordAuditEvent({
          cameraInstanceId: input.cameraId,
          userId: input.authDevice.userId,
          actorType: 'DEVICE',
          eventType: CameraAuditEventType.VIEWING_ACCESS_DENIED,
          action: 'STALE_LIFECYCLE_REPORT_REJECTED',
          result: 'DENIED',
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          metadata: {
            deviceId: input.authDevice.deviceId,
            reportedStatus: input.status
          }
        });
        throw new ConflictError('Stale lifecycle report timestamp rejected.', 'STALE_HEARTBEAT_REPORT');
      }

      const preCheckCamera = await prisma.cameraInstance.findUnique({
        where: { id: input.cameraId }
      });
      await this.assertAuthorizedCameraDevice(preCheckCamera, input.cameraId, input.authDevice, {
        ipAddress: input.ipAddress,
        userAgent: input.userAgent
      });

      const result = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM CameraInstance WHERE id = ${input.cameraId} FOR UPDATE`;

        const camera = await tx.cameraInstance.findUnique({
          where: { id: input.cameraId }
        });
        await this.assertAuthorizedCameraDevice(camera, input.cameraId, input.authDevice, {
          ipAddress: input.ipAddress,
          userAgent: input.userAgent
        });

        const lockedCamera = camera!;
        const previousStatus = lockedCamera.status;
        const targetStatus = input.status;

        assertValidLifecycleTransition(previousStatus, targetStatus);

        const existingMeta = (lockedCamera.metadata as Record<string, any>) || {};
        const pending: PendingCameraCommand | undefined = existingMeta.pendingCommand;

        // Protect newer START command against delayed STOP/OFFLINE reports when timestamps prove staleness
        if (
          pending?.action === 'START' &&
          targetStatus === CameraStatus.OFFLINE &&
          reportedAtDate &&
          reportedAtDate.getTime() < new Date(pending.requestedAt).getTime()
        ) {
          throw new ConflictError(
            'Delayed OFFLINE report predates newer START command.',
            'STALE_COMMAND_CONFIRMATION'
          );
        }

        // First expire timed-out stream sessions and verify active streaming eligibility
        const sessionCheck = await this.reconcileCameraStreamingStateWithTx(tx, lockedCamera.id, now);
        if (targetStatus === CameraStatus.STREAMING && sessionCheck.activeViewerCount === 0) {
          throw new ConflictError(
            'Camera cannot enter STREAMING state without at least one active non-expired CameraStreamSession.',
            'NO_ACTIVE_STREAM_SESSION'
          );
        }

        const { updatedMeta, commandResolved } = this.evaluateCommandResolution({
          existingMeta,
          targetStatus,
          confirmedCommand: input.confirmedCommand,
          commandId: input.commandId,
          commandRequestedAt: commandRequestedAtDate,
          authDeviceId: input.authDevice.deviceId,
          now
        });

        if (targetStatus === CameraStatus.RECONNECTING) {
          updatedMeta.reconnectingSince = updatedMeta.reconnectingSince || now.toISOString();
        } else {
          delete updatedMeta.reconnectingSince;
          delete updatedMeta.staleReason;
        }

        if (targetStatus === CameraStatus.ERROR) {
          updatedMeta.lastError = {
            code: input.errorCode || 'CAMERA_HARDWARE_ERROR',
            message: input.errorMessage || input.reason || 'Camera device entered ERROR state',
            reportedAt: now.toISOString()
          };
        } else if (targetStatus === CameraStatus.ONLINE || targetStatus === CameraStatus.STREAMING) {
          delete updatedMeta.lastError;
        }

        const transitioned = previousStatus !== targetStatus;
        const updateData: any = {
          status: targetStatus,
          lastSeenAt: now,
          metadata: updatedMeta
        };

        if (targetStatus === CameraStatus.OFFLINE) {
          updateData.stoppedAt = now;
        } else if (targetStatus === CameraStatus.CONNECTING || targetStatus === CameraStatus.ONLINE) {
          if (previousStatus === CameraStatus.OFFLINE || previousStatus === CameraStatus.ERROR || !lockedCamera.startedAt) {
            updateData.startedAt = now;
          }
        }

        const updatedCamera = await tx.cameraInstance.update({
          where: { id: lockedCamera.id },
          data: updateData
        });

        // Update CameraEndpoint state cleanly alongside camera lifecycle
        if (targetStatus === CameraStatus.ONLINE || targetStatus === CameraStatus.STREAMING) {
          await tx.cameraEndpoint.updateMany({
            where: { cameraInstanceId: lockedCamera.id },
            data: {
              status: CameraEndpointStatus.CONNECTED,
              lastHeartbeatAt: now,
              connectedAt: now
            }
          });
        } else if (targetStatus === CameraStatus.OFFLINE) {
          await tx.cameraEndpoint.updateMany({
            where: {
              cameraInstanceId: lockedCamera.id,
              status: { in: [CameraEndpointStatus.READY, CameraEndpointStatus.CONNECTED] }
            },
            data: {
              status: CameraEndpointStatus.INACTIVE,
              disconnectedAt: now
            }
          });
        } else if (targetStatus === CameraStatus.ERROR) {
          await tx.cameraEndpoint.updateMany({
            where: { cameraInstanceId: lockedCamera.id },
            data: {
              status: CameraEndpointStatus.FAILED,
              disconnectedAt: now
            }
          });
        }

        await tx.device.update({
          where: { id: input.authDevice.deviceId },
          data: { status: DeviceStatus.ONLINE, lastSeenAt: now }
        });
        await tx.deviceAuthCredential.update({
          where: { id: input.authDevice.credentialId },
          data: { lastUsedAt: now }
        });

        if (transitioned || commandResolved || targetStatus === CameraStatus.ERROR) {
          const eventType =
            targetStatus === CameraStatus.OFFLINE ||
            targetStatus === CameraStatus.RECONNECTING ||
            targetStatus === CameraStatus.ERROR
              ? CameraAuditEventType.CAMERA_STOPPED
              : CameraAuditEventType.CAMERA_STARTED;

          const action =
            targetStatus === CameraStatus.ERROR
              ? 'CAMERA_ERROR_REPORTED'
              : commandResolved === 'START'
              ? 'START_COMMAND_CONFIRMED'
              : commandResolved === 'STOP'
              ? 'STOP_COMMAND_CONFIRMED'
              : previousStatus === CameraStatus.RECONNECTING && targetStatus === CameraStatus.ONLINE
              ? 'CAMERA_RECONNECTED'
              : 'CAMERA_LIFECYCLE_TRANSITION';

          await CameraService.recordAuditEventWithTx(tx, {
            cameraInstanceId: lockedCamera.id,
            userId: input.authDevice.userId,
            actorType: 'DEVICE',
            eventType,
            action,
            result: targetStatus === CameraStatus.ERROR ? 'FAILED' : 'SUCCESS',
            ipAddress: input.ipAddress,
            userAgent: input.userAgent,
            metadata: {
              deviceId: input.authDevice.deviceId,
              previousStatus,
              newStatus: targetStatus,
              ...(input.reason ? { reason: input.reason } : {}),
              ...(input.errorCode ? { errorCode: input.errorCode } : {}),
              ...(commandResolved ? { confirmedCommand: commandResolved } : {})
            }
          });
        }

        return {
          camera: updatedCamera,
          previousStatus,
          currentStatus: targetStatus,
          transitioned,
          idempotent: !transitioned && !commandResolved,
          activeViewerCount: sessionCheck.activeViewerCount,
          pendingCommand: updatedMeta.pendingCommand || null,
          lastCommandResolution: updatedMeta.lastCommandResolution || null
        };
      }, { maxWait: 10000, timeout: 20000 });

      if (result.transitioned) {
        this.recordMetricsSafe(() => {
          metricsCollector.recordCameraLifecycleTransition(result.currentStatus, 'report');
        });
      }

      return result;
    } catch (err) {
      this.recordMetricsSafe(() => {
        metricsCollector.recordCameraLifecycleTransitionFailure(this.classifyFailureCategory(err));
      });
      if (this.isUnexpectedInternalError(err)) {
        this.reportInternalLifecycleError('reportCameraLifecycle', err, {
          cameraId: input.cameraId,
          userId: input.authDevice?.userId,
          deviceId: input.authDevice?.deviceId,
          metadata: { targetStatus: input.status }
        });
      }
      if (
        err instanceof AppError &&
        (err.errorCode === 'INVALID_LIFECYCLE_TRANSITION' ||
          err.errorCode === 'STALE_COMMAND_CONFIRMATION' ||
          err.errorCode === 'NO_ACTIVE_STREAM_SESSION')
      ) {
        await CameraService.recordAuditEvent({
          cameraInstanceId: input.cameraId,
          userId: input.authDevice.userId,
          actorType: 'DEVICE',
          eventType: CameraAuditEventType.VIEWING_ACCESS_DENIED,
          action: err.errorCode,
          result: 'DENIED',
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          metadata: {
            deviceId: input.authDevice.deviceId,
            attemptedStatus: input.status,
            errorMessage: err.message
          }
        });
      }
      throw err;
    }
  }

  /**
   * Safe Service Boundary for Scheduled Stale-Heartbeat & Session Reconciliation (Phase 20.4).
   * Designed to be invoked periodically by an external scheduler/worker in production without
   * spawning extra daemons in this batch.
   *
   * Properties:
   * - Idempotent: cameras already in the target state are untouched (zero redundant writes).
   * - Concurrency-safe: conditional updateMany checks exact (id, status, updatedAt) and cutoff so a
   *   concurrent fresh heartbeat is NEVER overwritten by stale reconciliation.
   * - Fault-isolated: per-camera try/catch ensures one camera's error never aborts others.
   * - Reconciles expired CameraStreamSessions so expired sessions never keep a camera STREAMING.
   */
  public static async reconcileStaleCameras(
    options?: ReconcileStaleCamerasOptions
  ): Promise<ReconcileStaleCamerasResult> {
    const now = options?.now || new Date();
    const heartbeatTimeoutMs = options?.heartbeatTimeoutMs ?? config.CAMERA_HEARTBEAT_TIMEOUT_MS;
    const connectingTimeoutMs = options?.connectingTimeoutMs ?? config.CAMERA_CONNECTING_TIMEOUT_MS;
    const reconnectGraceMs = options?.reconnectGraceMs ?? config.CAMERA_RECONNECT_GRACE_MS;
    const batchSize = options?.batchSize ?? config.CAMERA_RECONCILIATION_BATCH_SIZE;

    const heartbeatCutoff = new Date(now.getTime() - heartbeatTimeoutMs);
    const offlineCutoff = new Date(now.getTime() - (heartbeatTimeoutMs + reconnectGraceMs));
    const connectingCutoff = new Date(now.getTime() - connectingTimeoutMs);
    const reconnectCutoff = new Date(now.getTime() - reconnectGraceMs);

    const summary: ReconcileStaleCamerasResult = {
      evaluatedAt: now.toISOString(),
      expiredSessionsTimedOut: 0,
      streamingReconciledToOnline: 0,
      camerasEvaluated: 0,
      transitionedToReconnecting: 0,
      transitionedToOffline: 0,
      skippedConcurrentOrFresh: 0,
      errors: []
    };

    // 1. Reconcile expired stream sessions globally (independent of physical camera heartbeats)
    try {
      const expiredSessions = await prisma.cameraStreamSession.updateMany({
        where: {
          status: {
            in: [
              CameraStreamSessionStatus.INITIATED,
              CameraStreamSessionStatus.NEGOTIATING,
              CameraStreamSessionStatus.ACTIVE
            ]
          },
          expiresAt: { lte: now }
        },
        data: {
          status: CameraStreamSessionStatus.TIMED_OUT,
          endedAt: now,
          terminationReason: 'TOKEN_EXPIRED'
        }
      });
      summary.expiredSessionsTimedOut = expiredSessions.count;
    } catch (err: any) {
      summary.errors.push({ cameraId: 'STREAM_SESSIONS', message: err?.message || 'Session expiration failed' });
      this.reportInternalLifecycleError('reconcileStaleCameras.expireStreamSessions', err);
    }

    // 2. Ensure STREAMING cameras with zero valid ACTIVE sessions downgrade cleanly to ONLINE (not OFFLINE)
    try {
      const streamingCameras = await prisma.cameraInstance.findMany({
        where: { status: CameraStatus.STREAMING },
        take: batchSize
      });

      for (const cam of streamingCameras) {
        try {
          const res = await this.reconcileCameraStreamingState(cam.id, now);
          if (res.reconciledToOnline) {
            summary.streamingReconciledToOnline++;
            this.recordMetricsSafe(() => {
              metricsCollector.recordCameraLifecycleTransition(CameraStatus.ONLINE, 'reconciliation');
            });
          }
        } catch (err: any) {
          summary.errors.push({ cameraId: cam.id, message: err?.message || 'Streaming state reconciliation failed' });
          this.recordMetricsSafe(() => {
            metricsCollector.recordCameraLifecycleTransitionFailure('INTERNAL_ERROR');
          });
          this.reportInternalLifecycleError('reconcileStaleCameras.reconcileStreamingState', err, {
            cameraId: cam.id,
            userId: cam.userId
          });
        }
      }
    } catch (err: any) {
      summary.errors.push({ cameraId: 'STREAMING_CAMERAS', message: err?.message || 'Streaming scan failed' });
      this.reportInternalLifecycleError('reconcileStaleCameras.scanStreamingCameras', err);
    }

    // 3. Evaluate candidate active/transient cameras for stale heartbeats
    const candidates = await prisma.cameraInstance.findMany({
      where: {
        status: {
          in: [
            CameraStatus.CONNECTING,
            CameraStatus.ONLINE,
            CameraStatus.STREAMING,
            CameraStatus.RECONNECTING
          ]
        }
      },
      orderBy: { lastSeenAt: 'asc' },
      take: batchSize
    });

    for (const camera of candidates) {
      summary.camerasEvaluated++;

      try {
        const meta = (camera.metadata as Record<string, any>) || {};
        const pending: PendingCameraCommand | undefined = meta.pendingCommand;
        let nextStatus: CameraStatus | null = null;
        let staleReason = 'HEARTBEAT_TIMEOUT';

        if (camera.status === CameraStatus.ONLINE || camera.status === CameraStatus.STREAMING) {
          const referenceTime = camera.lastSeenAt || camera.updatedAt;
          if (referenceTime < offlineCutoff) {
            nextStatus = CameraStatus.OFFLINE;
            staleReason = 'EXTENDED_HEARTBEAT_TIMEOUT';
          } else if (referenceTime < heartbeatCutoff) {
            nextStatus = CameraStatus.RECONNECTING;
            staleReason = 'HEARTBEAT_TIMEOUT';
          }
        } else if (camera.status === CameraStatus.RECONNECTING) {
          const reconnectAnchor = meta.reconnectingSince
            ? new Date(meta.reconnectingSince)
            : camera.lastSeenAt || camera.updatedAt;
          if (reconnectAnchor < reconnectCutoff) {
            nextStatus = CameraStatus.OFFLINE;
            staleReason = 'RECONNECT_GRACE_EXPIRED';
          }
        } else if (camera.status === CameraStatus.CONNECTING) {
          const connectAnchor = pending?.requestedAt
            ? new Date(pending.requestedAt)
            : camera.startedAt || camera.updatedAt;
          const heartbeatIsStale = !camera.lastSeenAt || camera.lastSeenAt < heartbeatCutoff;
          if (connectAnchor < connectingCutoff && heartbeatIsStale) {
            nextStatus = CameraStatus.OFFLINE;
            staleReason = 'CONNECTING_TIMEOUT';
          }
        }

        if (!nextStatus) {
          summary.skippedConcurrentOrFresh++;
          continue;
        }

        const updatedMeta: Record<string, any> = {
          ...meta,
          staleReason
        };

        if (nextStatus === CameraStatus.RECONNECTING) {
          updatedMeta.reconnectingSince = meta.reconnectingSince || now.toISOString();
        } else if (nextStatus === CameraStatus.OFFLINE) {
          delete updatedMeta.reconnectingSince;
          if (pending?.action === 'START') {
            delete updatedMeta.pendingCommand;
            updatedMeta.lastCommandResolution = {
              ...pending,
              status: 'TIMED_OUT',
              resolvedAt: now.toISOString(),
              resultingStatus: CameraStatus.OFFLINE
            };
          }
        }

        // Optimistic Compare-And-Set guard prevents overwriting any concurrent newer heartbeat across all states
        const casWhere: any = {
          id: camera.id,
          status: camera.status,
          updatedAt: camera.updatedAt,
          OR: [
            { lastSeenAt: null },
            { lastSeenAt: { lt: heartbeatCutoff } }
          ]
        };

        const updateResult = await prisma.cameraInstance.updateMany({
          where: casWhere,
          data: {
            status: nextStatus,
            ...(nextStatus === CameraStatus.OFFLINE ? { stoppedAt: now } : {}),
            metadata: updatedMeta
          }
        });

        if (updateResult.count === 0) {
          summary.skippedConcurrentOrFresh++;
          continue;
        }

        if (nextStatus === CameraStatus.OFFLINE) {
          summary.transitionedToOffline++;
          await prisma.cameraEndpoint.updateMany({
            where: {
              cameraInstanceId: camera.id,
              status: { in: [CameraEndpointStatus.READY, CameraEndpointStatus.CONNECTED] }
            },
            data: {
              status: CameraEndpointStatus.INACTIVE,
              disconnectedAt: now
            }
          });
        } else {
          summary.transitionedToReconnecting++;
        }

        this.recordMetricsSafe(() => {
          metricsCollector.recordCameraLifecycleTransition(nextStatus, 'reconciliation');
        });

        await CameraService.recordAuditEvent({
          cameraInstanceId: camera.id,
          userId: camera.userId,
          actorType: 'SYSTEM',
          eventType: CameraAuditEventType.CAMERA_STOPPED,
          action: 'STALE_HEARTBEAT_DETECTED',
          result: 'SUCCESS',
          metadata: {
            previousStatus: camera.status,
            newStatus: nextStatus,
            staleReason,
            lastSeenAt: camera.lastSeenAt ? camera.lastSeenAt.toISOString() : null
          }
        });
      } catch (err: any) {
        summary.errors.push({
          cameraId: camera.id,
          message: err?.message || 'Camera reconciliation error'
        });
        this.recordMetricsSafe(() => {
          metricsCollector.recordCameraLifecycleTransitionFailure('INTERNAL_ERROR');
        });
        this.reportInternalLifecycleError('reconcileStaleCameras.reconcileSingleCamera', err, {
          cameraId: camera.id,
          userId: camera.userId
        });
        appLogger.warn('Per-camera stale reconciliation failed cleanly', {
          operation: 'CAMERA_STALE_RECONCILIATION',
          cameraId: camera.id,
          error: err?.message || 'Unknown error'
        });
      }
    }

    return summary;
  }

  private static classifyFailureCategory(err: unknown): CameraTransitionFailureCategory {
    if (err instanceof AppError) {
      switch (err.errorCode) {
        case 'INVALID_LIFECYCLE_TRANSITION':
          return 'INVALID_TRANSITION';
        case 'STALE_HEARTBEAT_REPORT':
        case 'STALE_COMMAND_CONFIRMATION':
        case 'STALE_LIFECYCLE_REPORT_REJECTED':
          return 'STALE_REPORT';
        case 'NO_ACTIVE_STREAM_SESSION':
          return 'NO_ACTIVE_SESSION';
        default:
          if (err.statusCode === 401 || err.statusCode === 403) {
            return 'UNAUTHORIZED';
          }
          if (err.statusCode < 500) {
            return 'VALIDATION_ERROR';
          }
          return 'INTERNAL_ERROR';
      }
    }
    return 'INTERNAL_ERROR';
  }

  private static isUnexpectedInternalError(err: unknown): boolean {
    return !(err instanceof AppError) || err.statusCode >= 500;
  }

  private static recordMetricsSafe(fn: () => void): void {
    try {
      fn();
    } catch {
      // Never allow observability metrics to disrupt camera lifecycle operations
    }
  }

  private static reportInternalLifecycleError(
    operation: string,
    error: unknown,
    context?: {
      cameraId?: string;
      userId?: string;
      deviceId?: string;
      metadata?: Record<string, any>;
    }
  ): void {
    try {
      void errorIngestionService
        .ingest({
          error,
          component: 'CAMERA_LIFECYCLE',
          severity: 'ERROR',
          errorCode: 'CAMERA_LIFECYCLE_INTERNAL_ERROR',
          userId: context?.userId,
          deviceId: context?.deviceId,
          metadata: {
            operation,
            cameraId: context?.cameraId,
            ...(context?.metadata || {})
          }
        })
        .catch(() => {});
    } catch {
      // Fail-safe: error ingestion failures must never abort lifecycle work
    }
  }
}
