import http from 'node:http';
import crypto from 'node:crypto';
import type { Socket } from 'node:net';
import { WebSocketServer, WebSocket, RawData } from 'ws';
import { FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  CameraAuditEventType,
  CameraStatus,
  CameraStreamSessionStatus
} from '@prisma/client';
import { prisma } from '../config/database.js';
import {
  config,
  isCameraSignalingStrictTlsEnv,
  resolveCameraSignalingRequireTls
} from '../config/env.js';
import { appLogger, sanitizeLogString } from '../observability/logger.js';
import { BoundedLatencyRecorder, LatencySummary } from '../observability/metrics.js';
import { errorIngestionService } from './error_ingestion_service.js';
import { CameraService } from './camera_service.js';
import { CameraLifecycleService } from './camera_lifecycle_service.js';
import { EntitlementService } from './billing/entitlement_service.js';
import {
  AppError,
  ForbiddenError,
  UnauthorizedError
} from '../errors/app-error.js';

export const CAMERA_SIGNALING_PROTOCOL_VERSION = '1.0' as const;
export const CAMERA_SIGNALING_SDP_MAX_BYTES = 32768;
export const CAMERA_SIGNALING_ICE_MAX_BYTES = 4096;

export type SignalingParticipantRole = 'CAMERA' | 'VIEWER';

const FORBIDDEN_MEDIA_PAYLOAD_KEYS = new Set([
  'dataBase64',
  'binaryPayload',
  'chunk',
  'chunkIndex',
  'totalChunks',
  'fileData',
  'filePath',
  'mediaFrame',
  'videoFrame',
  'audioFrame'
]);

const BaseEnvelopeSchema = z.object({
  version: z.string(),
  type: z.string().min(1).max(64)
}).passthrough();

const SignalingAuthSchema = z.object({
  version: z.literal(CAMERA_SIGNALING_PROTOCOL_VERSION),
  type: z.literal('SIGNALING_AUTH'),
  role: z.enum(['CAMERA', 'VIEWER']),
  cameraId: z.string().trim().min(1).max(128),
  deviceId: z.string().trim().min(1).max(128).optional(),
  sessionId: z.string().trim().min(1).max(128).optional(),
  credential: z.string().trim().min(1).max(4096).optional(),
  viewingToken: z.string().trim().min(1).max(4096).optional()
});

const PingPongSchema = z.object({
  version: z.literal(CAMERA_SIGNALING_PROTOCOL_VERSION),
  type: z.enum(['PING', 'PONG']),
  cameraId: z.string().trim().min(1).max(128).optional(),
  sessionId: z.string().trim().min(1).max(128).optional(),
  timestamp: z.string().max(64).optional()
});

const SessionInitiateSchema = z.object({
  version: z.literal(CAMERA_SIGNALING_PROTOCOL_VERSION),
  type: z.literal('SESSION_INITIATE'),
  cameraId: z.string().trim().min(1).max(128),
  sessionId: z.string().trim().min(1).max(128),
  requestId: z.string().trim().min(1).max(128).optional()
});

const WebRtcOfferSchema = z.object({
  version: z.literal(CAMERA_SIGNALING_PROTOCOL_VERSION),
  type: z.literal('WEBRTC_OFFER'),
  cameraId: z.string().trim().min(1).max(128),
  sessionId: z.string().trim().min(1).max(128),
  sdpType: z.literal('offer'),
  sdp: z.string().min(1).max(CAMERA_SIGNALING_SDP_MAX_BYTES),
  renegotiation: z.boolean().optional(),
  requestId: z.string().trim().min(1).max(128).optional()
});

const WebRtcAnswerSchema = z.object({
  version: z.literal(CAMERA_SIGNALING_PROTOCOL_VERSION),
  type: z.literal('WEBRTC_ANSWER'),
  cameraId: z.string().trim().min(1).max(128),
  sessionId: z.string().trim().min(1).max(128),
  sdpType: z.literal('answer'),
  sdp: z.string().min(1).max(CAMERA_SIGNALING_SDP_MAX_BYTES),
  requestId: z.string().trim().min(1).max(128).optional()
});

const IceCandidateSchema = z.object({
  version: z.literal(CAMERA_SIGNALING_PROTOCOL_VERSION),
  type: z.literal('ICE_CANDIDATE'),
  cameraId: z.string().trim().min(1).max(128),
  sessionId: z.string().trim().min(1).max(128),
  candidate: z.string().max(CAMERA_SIGNALING_ICE_MAX_BYTES),
  sdpMid: z.string().max(128).nullable().optional(),
  sdpMLineIndex: z.number().int().min(0).max(64).nullable().optional(),
  usernameFragment: z.string().max(256).nullable().optional()
});

const SessionRestartSchema = z.object({
  version: z.literal(CAMERA_SIGNALING_PROTOCOL_VERSION),
  type: z.literal('SESSION_RESTART'),
  cameraId: z.string().trim().min(1).max(128),
  sessionId: z.string().trim().min(1).max(128),
  reason: z.string().max(256).optional()
});

const NegotiationFailedSchema = z.object({
  version: z.literal(CAMERA_SIGNALING_PROTOCOL_VERSION),
  type: z.literal('NEGOTIATION_FAILED'),
  cameraId: z.string().trim().min(1).max(128),
  sessionId: z.string().trim().min(1).max(128),
  errorCode: z.string().max(64).optional(),
  reason: z.string().max(256).optional()
});

const SessionTerminateSchema = z.object({
  version: z.literal(CAMERA_SIGNALING_PROTOCOL_VERSION),
  type: z.literal('SESSION_TERMINATE'),
  cameraId: z.string().trim().min(1).max(128),
  sessionId: z.string().trim().min(1).max(128),
  reason: z.string().max(256).optional()
});

export interface CameraSignalingServiceConfig {
  path: string;
  maxPayloadBytes: number;
  authTimeoutMs: number;
  rateLimitPerMin: number;
  maxViewersPerCamera: number;
  reaperIntervalMs: number;
}

interface PendingSocketState {
  connectionId: string;
  socket: WebSocket;
  remoteIp: string;
  userAgent: string | null;
  upgradeAuthHeader: string | null;
  upgradeDeviceCredHeader: string | null;
  upgradeViewingTokenHeader: string | null;
  upgradeDeviceIdHeader: string | null;
  connectedAt: Date;
  authTimer: NodeJS.Timeout | null;
  isClosed: boolean;
}

interface AuthenticatedCameraConnection {
  role: 'CAMERA';
  connectionId: string;
  socket: WebSocket;
  userId: string;
  cameraId: string;
  deviceId: string;
  installationId: string | null;
  epoch: number;
  remoteIp: string;
  userAgent: string | null;
  connectedAt: Date;
  lastHeartbeatAt: Date;
  rateWindowStartMs: number;
  rateMessageCount: number;
  isEvicted: boolean;
  isClosed: boolean;
}

interface AuthenticatedViewerConnection {
  role: 'VIEWER';
  connectionId: string;
  socket: WebSocket;
  userId: string;
  cameraId: string;
  sessionId: string;
  expiresAt: Date;
  epoch: number;
  remoteIp: string;
  userAgent: string | null;
  connectedAt: Date;
  lastHeartbeatAt: Date;
  rateWindowStartMs: number;
  rateMessageCount: number;
  isEvicted: boolean;
  isClosed: boolean;
}

type AuthenticatedSignalingConnection = AuthenticatedCameraConnection | AuthenticatedViewerConnection;

interface SessionNegotiationState {
  cameraId: string;
  userId: string;
  lastOfferByRole: SignalingParticipantRole | null;
  offerCount: number;
  answerCount: number;
  iceCandidateCount: number;
  updatedAt: Date;
}

export type SignalingAuthRejectionCategory =
  | 'TLS_REQUIRED'
  | 'ORIGIN_NOT_ALLOWED'
  | 'ORIGIN_REQUIRED'
  | 'AUTH_TIMEOUT'
  | 'INVALID_CREDENTIALS'
  | 'VIEWER_CAPACITY_EXCEEDED'
  | 'SESSION_REVOKED'
  | 'SESSION_EXPIRED'
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED';

export interface CameraSignalingMetrics {
  scope: 'LOCAL_PROCESS';
  listening: boolean;
  startedAt: string | null;
  uptimeSeconds: number;
  path: string;
  connectedCameras: number;
  activeViewerSockets: number;
  pendingUnauthenticatedSockets: number;
  trackedNegotiatingSessions: number;
  rejectedAuthAttempts: number;
  authRejectionsByCategory: Record<SignalingAuthRejectionCategory, number>;
  rejectedMessages: number;
  evictedConnections: number;
  negotiation: {
    offersRelayed: number;
    answersRelayed: number;
    iceCandidatesRelayed: number;
    sessionInitiatesRelayed: number;
    sessionRestartsRelayed: number;
    negotiationFailuresReported: number;
    negotiationErrors: number;
    staleRejections: number;
    rateLimitedMessages: number;
    payloadLimitRejections: number;
  };
  terminations: {
    cameraEvictions: number;
    viewerEvictions: number;
    revocationsTriggered: number;
    expiredCleanups: number;
    clientTerminations: number;
  };
  latencies: {
    authHandshake: LatencySummary;
    signalingHeartbeat: LatencySummary;
  };
}

export interface CameraSignalingPublicState {
  cameraId: string;
  signalingPath: string;
  protocolVersion: string;
  cameraConnected: boolean;
  connectedAt: string | null;
  lastHeartbeatAt: string | null;
  activeViewerConnections: number;
  maxViewersPerCamera: number;
}

const VALID_ACTIVE_VIEWING_STATUSES = new Set<CameraStreamSessionStatus>([
  CameraStreamSessionStatus.INITIATED,
  CameraStreamSessionStatus.NEGOTIATING,
  CameraStreamSessionStatus.ACTIVE
]);

const TERMINAL_SESSION_STATUSES = new Set<CameraStreamSessionStatus>([
  CameraStreamSessionStatus.ENDED,
  CameraStreamSessionStatus.FAILED,
  CameraStreamSessionStatus.TIMED_OUT,
  CameraStreamSessionStatus.REVOKED
]);

const CONNECTABLE_CAMERA_STATUSES = new Set<CameraStatus>([
  CameraStatus.ONLINE,
  CameraStatus.STREAMING,
  CameraStatus.CONNECTING,
  CameraStatus.RECONNECTING
]);

function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/';
}

/**
 * Isolated WebSocket Signaling Service for ZdexCloud Camera (Phase 20.5).
 *
 * Security & Architecture Invariants:
 * - Mounted exclusively on `/ws/camera-signaling` using `noServer: true`, isolated from Storage `GatewayService`.
 * - Coordinates WebRTC session setup (offer/answer/ICE/termination) without relaying audio/video media frames.
 * - Reuses existing Camera/Device authentication (`CameraLifecycleService`) and viewing token validation (`CameraService`).
 * - Supports multiple concurrent authenticated viewer sessions per camera (isolated by `sessionId`).
 * - Prevents stale evicted socket re-use via monotonic connection epochs.
 * - Never persists or logs raw SDP payloads, ICE candidate strings, credentials, or viewing tokens.
 */
export class CameraSignalingService {
  private readonly cfg: CameraSignalingServiceConfig;
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private upgradeHandler: ((req: http.IncomingMessage, socket: Socket, head: Buffer) => void) | null = null;
  private reaperTimer: NodeJS.Timeout | null = null;
  private stopPromise: Promise<void> | null = null;
  private isShuttingDown = false;
  private readonly allowedOriginsSet: Set<string>;

  private pendingSockets = new Map<string, PendingSocketState>();
  private socketToAuthConn = new Map<WebSocket, AuthenticatedSignalingConnection>();
  private cameraConnections = new Map<string, AuthenticatedCameraConnection>(); // cameraId -> live camera socket
  private viewerConnections = new Map<string, AuthenticatedViewerConnection>(); // sessionId -> live viewer socket
  private cameraViewerSlots = new Map<string, Map<string, Set<string>>>(); // cameraId -> (sessionId -> Set<connectionId>)
  private socketSlotReservation = new Map<string, { cameraId: string; sessionId: string }>(); // connectionId -> slot ref
  private cameraEpochMap = new Map<string, number>(); // cameraId -> monotonic camera epoch
  private viewerEpochMap = new Map<string, number>(); // sessionId -> monotonic viewer epoch
  private sessionNegotiationState = new Map<string, SessionNegotiationState>(); // sessionId -> state

  private startedAt: Date | null = null;

  private rejectedAuthAttempts = 0;
  private authRejectionsByCategory: Record<SignalingAuthRejectionCategory, number> = {
    TLS_REQUIRED: 0,
    ORIGIN_NOT_ALLOWED: 0,
    ORIGIN_REQUIRED: 0,
    AUTH_TIMEOUT: 0,
    INVALID_CREDENTIALS: 0,
    VIEWER_CAPACITY_EXCEEDED: 0,
    SESSION_REVOKED: 0,
    SESSION_EXPIRED: 0,
    UNAUTHORIZED: 0,
    RATE_LIMITED: 0
  };
  private rejectedMessages = 0;
  private evictedConnections = 0;

  private offersRelayed = 0;
  private answersRelayed = 0;
  private iceCandidatesRelayed = 0;
  private sessionInitiatesRelayed = 0;
  private sessionRestartsRelayed = 0;
  private negotiationFailuresReported = 0;
  private negotiationErrors = 0;
  private staleRejections = 0;
  private rateLimitedMessages = 0;
  private payloadLimitRejections = 0;

  private cameraEvictions = 0;
  private viewerEvictions = 0;
  private revocationsTriggered = 0;
  private expiredCleanups = 0;
  private clientTerminations = 0;

  private authHandshakeLatency = new BoundedLatencyRecorder(256);
  private signalingHeartbeatLatency = new BoundedLatencyRecorder(256);

  constructor(overrides: Partial<CameraSignalingServiceConfig> = {}) {
    const resolvedEnv = overrides.nodeEnv ?? config.NODE_ENV ?? 'development';
    const isStrictTlsEnv = isCameraSignalingStrictTlsEnv(resolvedEnv);
    const defaultRequireTls = resolveCameraSignalingRequireTls(
      resolvedEnv,
      config.CAMERA_SIGNALING_REQUIRE_TLS
    );

    this.allowedOriginsSet = buildAllowedBrowserOrigins({
      explicitOrigins: overrides.allowedOrigins ?? (config.CAMERA_SIGNALING_ALLOWED_ORIGINS || undefined),
      corsOrigins: config.CORS_ORIGIN,
      frontendUrl: config.FRONTEND_URL
    });

    this.cfg = {
      path: normalizePath(overrides.path ?? config.CAMERA_SIGNALING_PATH ?? '/ws/camera-signaling'),
      maxPayloadBytes: overrides.maxPayloadBytes ?? config.CAMERA_SIGNALING_MAX_PAYLOAD_BYTES ?? 65536,
      authTimeoutMs: overrides.authTimeoutMs ?? config.CAMERA_SIGNALING_AUTH_TIMEOUT_MS ?? 10000,
      rateLimitPerMin: overrides.rateLimitPerMin ?? config.CAMERA_SIGNALING_RATE_LIMIT_PER_MIN ?? 240,
      maxViewersPerCamera: overrides.maxViewersPerCamera ?? config.CAMERA_SIGNALING_MAX_VIEWERS_PER_CAMERA ?? 5,
      reaperIntervalMs: overrides.reaperIntervalMs ?? config.CAMERA_SIGNALING_REAPER_INTERVAL_MS ?? 30000,
      allowedOrigins: Array.from(this.allowedOriginsSet),
      requireSecureTransport: isStrictTlsEnv
        ? true
        : (overrides.requireSecureTransport ?? defaultRequireTls),
      trustProxy: overrides.trustProxy ?? config.TRUST_PROXY ?? 'loopback,linklocal,uniquelocal',
      nodeEnv: resolvedEnv
    };
  }

  public getPath(): string {
    return this.cfg.path;
  }

  public attachToHttpServer(httpServer: http.Server): void {
    if (this.wss || this.upgradeHandler) return;

    this.httpServer = httpServer;
    this.isShuttingDown = false;
    this.stopPromise = null;
    this.startedAt = new Date();

    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: this.cfg.maxPayloadBytes
    });

    this.wss.on('connection', (socket: WebSocket, req: http.IncomingMessage) => {
      this.handleNewSocket(socket, req);
    });

    const allowHttpOrigins = this.cfg.nodeEnv === 'development' || this.cfg.nodeEnv === 'test';

    this.upgradeHandler = (req: http.IncomingMessage, socket: Socket, head: Buffer) => {
      const reqPath = this.extractNormalizedPath(req.url);
      if (reqPath !== this.cfg.path) {
        scheduleUnhandledUpgradeRejection(req, socket);
        return;
      }

      // Claim ownership of this signaling upgrade synchronously
      markUpgradeHandled(req);

      if (this.cfg.requireSecureTransport && !isSecureUpgradeRequest(req, this.cfg.trustProxy)) {
        this.recordAuthRejection('TLS_REQUIRED');
        rejectUpgradeHandshake(
          socket,
          403,
          'Forbidden',
          'TLS_REQUIRED',
          'Secure WebSocket transport (wss://) is required.'
        );
        return;
      }

      const rawOrigin = req.headers.origin;
      if (rawOrigin !== undefined) {
        const originCheck = isExactBrowserOriginAllowed(rawOrigin, this.allowedOriginsSet, {
          allowHttpInCurrentEnv: allowHttpOrigins
        });
        if (!originCheck.allowed || !originCheck.normalizedOrigin) {
          this.recordAuthRejection('ORIGIN_NOT_ALLOWED');
          rejectUpgradeHandshake(
            socket,
            403,
            'Forbidden',
            'ORIGIN_NOT_ALLOWED',
            'WebSocket origin is not permitted.'
          );
          return;
        }
        (req as any).__validatedSignalingOrigin = originCheck.normalizedOrigin;
      } else {
        // Missing Origin: permit only non-browser native clients (reject explicit browser/viewer hints)
        const hasBrowserHint =
          Boolean(req.headers['sec-fetch-site']) ||
          Boolean(req.headers['sec-fetch-mode']) ||
          Boolean(req.headers['sec-fetch-dest']) ||
          Boolean(req.headers.cookie) ||
          this.extractQueryRole(req.url) === 'viewer';

        if (hasBrowserHint) {
          this.recordAuthRejection('ORIGIN_REQUIRED');
          rejectUpgradeHandshake(
            socket,
            403,
            'Forbidden',
            'ORIGIN_REQUIRED',
            'Browser WebSocket connections require a trusted Origin header.'
          );
          return;
        }
        (req as any).__validatedSignalingOrigin = null;
      }

      this.wss?.handleUpgrade(req, socket, head, (ws) => {
        this.wss?.emit('connection', ws, req);
      });
    };

    httpServer.on('upgrade', this.upgradeHandler);

    this.reaperTimer = setInterval(() => {
      void this.runReaperCycle();
    }, this.cfg.reaperIntervalMs);
    this.reaperTimer.unref?.();

    appLogger.info('Camera signaling WebSocket attached to HTTP server', {
      operation: 'CAMERA_SIGNALING_STARTED',
      metadata: {
        component: 'camera-signaling',
        path: this.cfg.path,
        maxPayloadBytes: this.cfg.maxPayloadBytes,
        maxViewersPerCamera: this.cfg.maxViewersPerCamera,
        requireSecureTransport: this.cfg.requireSecureTransport,
        allowedOriginsCount: this.allowedOriginsSet.size
      }
    });
  }

  public async stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    if (!this.wss && !this.upgradeHandler) return;

    this.isShuttingDown = true;

    if (this.reaperTimer) {
      clearInterval(this.reaperTimer);
      this.reaperTimer = null;
    }

    if (this.httpServer && this.upgradeHandler) {
      this.httpServer.off('upgrade', this.upgradeHandler);
      this.upgradeHandler = null;
    }

    for (const pending of Array.from(this.pendingSockets.values())) {
      if (pending.authTimer) {
        clearTimeout(pending.authTimer);
        pending.authTimer = null;
      }
      pending.isClosed = true;
      this.releaseViewerSlot(pending.connectionId);
      try {
        pending.socket.close(1001, 'Server shutting down');
      } catch {}
    }
    this.pendingSockets.clear();

    for (const camConn of Array.from(this.cameraConnections.values())) {
      camConn.isClosed = true;
      camConn.isEvicted = true;
      this.sendJsonSafe(camConn.socket, {
        version: CAMERA_SIGNALING_PROTOCOL_VERSION,
        type: 'SIGNALING_DISCONNECTED',
        reason: 'Server shutting down'
      });
      try {
        camConn.socket.close(1001, 'Server shutting down');
      } catch {}
    }
    this.cameraConnections.clear();

    for (const viewerConn of Array.from(this.viewerConnections.values())) {
      viewerConn.isClosed = true;
      viewerConn.isEvicted = true;
      this.releaseViewerSlot(viewerConn.connectionId);
      this.sendJsonSafe(viewerConn.socket, {
        version: CAMERA_SIGNALING_PROTOCOL_VERSION,
        type: 'SIGNALING_DISCONNECTED',
        reason: 'Server shutting down'
      });
      try {
        viewerConn.socket.close(1001, 'Server shutting down');
      } catch {}
    }
    this.viewerConnections.clear();

    this.cameraViewerSlots.clear();
    this.socketSlotReservation.clear();
    this.socketToAuthConn.clear();
    this.sessionNegotiationState.clear();

    this.stopPromise = new Promise<void>((resolve) => {
      const serverToClose = this.wss;
      this.wss = null;
      this.httpServer = null;
      if (!serverToClose) {
        this.stopPromise = null;
        resolve();
        return;
      }
      serverToClose.close(() => {
        this.stopPromise = null;
        this.startedAt = null;
        appLogger.info('Camera signaling WebSocket stopped cleanly', {
          operation: 'CAMERA_SIGNALING_STOPPED',
          metadata: { component: 'camera-signaling' }
        });
        resolve();
      });
    });

    return this.stopPromise;
  }

  public getMetrics(): CameraSignalingMetrics {
    const listening = Boolean(this.wss && !this.isShuttingDown);
    const uptimeSeconds =
      listening && this.startedAt
        ? Math.max(0, Math.floor((Date.now() - this.startedAt.getTime()) / 1000))
        : 0;

    return {
      scope: 'LOCAL_PROCESS',
      listening,
      startedAt: this.startedAt ? this.startedAt.toISOString() : null,
      uptimeSeconds,
      path: this.cfg.path,
      connectedCameras: this.cameraConnections.size,
      activeViewerSockets: this.viewerConnections.size,
      pendingUnauthenticatedSockets: this.pendingSockets.size,
      trackedNegotiatingSessions: this.sessionNegotiationState.size,
      rejectedAuthAttempts: this.rejectedAuthAttempts,
      authRejectionsByCategory: { ...this.authRejectionsByCategory },
      rejectedMessages: this.rejectedMessages,
      evictedConnections: this.evictedConnections,
      negotiation: {
        offersRelayed: this.offersRelayed,
        answersRelayed: this.answersRelayed,
        iceCandidatesRelayed: this.iceCandidatesRelayed,
        sessionInitiatesRelayed: this.sessionInitiatesRelayed,
        sessionRestartsRelayed: this.sessionRestartsRelayed,
        negotiationFailuresReported: this.negotiationFailuresReported,
        negotiationErrors: this.negotiationErrors,
        staleRejections: this.staleRejections,
        rateLimitedMessages: this.rateLimitedMessages,
        payloadLimitRejections: this.payloadLimitRejections
      },
      terminations: {
        cameraEvictions: this.cameraEvictions,
        viewerEvictions: this.viewerEvictions,
        revocationsTriggered: this.revocationsTriggered,
        expiredCleanups: this.expiredCleanups,
        clientTerminations: this.clientTerminations
      },
      latencies: {
        authHandshake: this.authHandshakeLatency.getSummary(),
        signalingHeartbeat: this.signalingHeartbeatLatency.getSummary()
      }
    };
  }

  public getCameraSignalingState(cameraId: string): CameraSignalingPublicState {
    const camConn = this.cameraConnections.get(cameraId);
    const activeViewers = this.countLiveViewersForCamera(cameraId);
    return {
      cameraId,
      signalingPath: this.cfg.path,
      protocolVersion: CAMERA_SIGNALING_PROTOCOL_VERSION,
      cameraConnected: Boolean(camConn && !camConn.isClosed && !camConn.isEvicted),
      connectedAt: camConn ? camConn.connectedAt.toISOString() : null,
      lastHeartbeatAt: camConn ? camConn.lastHeartbeatAt.toISOString() : null,
      activeViewerConnections: activeViewers,
      maxViewersPerCamera: this.cfg.maxViewersPerCamera
    };
  }

  /**
   * Immediately severs an active viewer signaling connection when its viewing session is revoked via REST.
   * Preserves the physical Camera signaling connection and other concurrent viewers untouched.
   */
  public notifySessionRevoked(sessionId: string, reason = 'Viewing session revoked'): void {
    this.revocationsTriggered++;
    const viewerConn = this.viewerConnections.get(sessionId);
    const negState = this.sessionNegotiationState.get(sessionId);
    const cameraId = viewerConn?.cameraId || negState?.cameraId;

    this.sessionNegotiationState.delete(sessionId);

    if (cameraId) {
      const camConn = this.cameraConnections.get(cameraId);
      if (camConn && !camConn.isClosed && !camConn.isEvicted) {
        this.sendJsonSafe(camConn.socket, {
          version: CAMERA_SIGNALING_PROTOCOL_VERSION,
          type: 'SESSION_TERMINATE',
          cameraId,
          sessionId,
          revoked: true,
          reason
        });
      }
    }

    if (viewerConn) {
      viewerConn.isClosed = true;
      viewerConn.isEvicted = true;
      this.viewerConnections.delete(sessionId);
      this.socketToAuthConn.delete(viewerConn.socket);
      this.releaseViewerSlot(viewerConn.connectionId);
      this.sendJsonSafe(viewerConn.socket, {
        version: CAMERA_SIGNALING_PROTOCOL_VERSION,
        type: 'SESSION_TERMINATE',
        cameraId: viewerConn.cameraId,
        sessionId,
        revoked: true,
        reason
      });
      try {
        viewerConn.socket.close(4403, 'Viewing session revoked');
      } catch {}
    }

    // Also sever any in-flight pending reservation holding this revoked sessionId
    for (const [connId, slotRef] of Array.from(this.socketSlotReservation.entries())) {
      if (slotRef.sessionId === sessionId) {
        this.releaseViewerSlot(connId);
        const pending = this.pendingSockets.get(connId);
        if (pending && !pending.isClosed) {
          pending.isClosed = true;
          try {
            pending.socket.close(4403, 'Viewing session revoked');
          } catch {}
        }
      }
    }
  }

  private extractNormalizedPath(rawUrl?: string): string {
    if (!rawUrl) return '/';
    try {
      return normalizePath(new URL(rawUrl, 'http://localhost').pathname);
    } catch {
      return normalizePath(rawUrl.split('?')[0]);
    }
  }

  private extractQueryRole(rawUrl?: string): string | null {
    if (!rawUrl) return null;
    try {
      const role = new URL(rawUrl, 'http://localhost').searchParams.get('role');
      return role ? role.trim().toLowerCase() : null;
    } catch {
      return null;
    }
  }

  private handleNewSocket(socket: WebSocket, req: http.IncomingMessage): void {
    const connectionId = `csig_${crypto.randomBytes(10).toString('hex')}`;
    const remoteIp = sanitizeLogString(req.socket.remoteAddress || '127.0.0.1', 64) || '127.0.0.1';
    const userAgent =
      typeof req.headers['user-agent'] === 'string'
        ? sanitizeLogString(req.headers['user-agent'], 256)
        : null;
    const validatedOrigin: string | null = (req as any).__validatedSignalingOrigin ?? null;

    const pending: PendingSocketState = {
      connectionId,
      socket,
      remoteIp,
      userAgent,
      hasValidBrowserOrigin: Boolean(validatedOrigin),
      origin: validatedOrigin,
      upgradeAuthHeader: typeof req.headers.authorization === 'string' ? req.headers.authorization : null,
      upgradeDeviceCredHeader:
        typeof req.headers['x-device-credential'] === 'string' ? req.headers['x-device-credential'] : null,
      upgradeViewingTokenHeader:
        typeof req.headers['x-viewing-token'] === 'string' ? req.headers['x-viewing-token'] : null,
      upgradeDeviceIdHeader: typeof req.headers['x-device-id'] === 'string' ? req.headers['x-device-id'] : null,
      connectedAt: new Date(),
      authTimer: null,
      isClosed: false
    };

    pending.authTimer = setTimeout(() => {
      if (pending.isClosed || !this.pendingSockets.has(connectionId)) return;
      this.pendingSockets.delete(connectionId);
      pending.isClosed = true;
      this.recordAuthRejection('AUTH_TIMEOUT');
      this.sendErrorSafe(socket, 'AUTH_TIMEOUT', 'Signaling authentication timeout elapsed.');
      try {
        socket.close(4401, 'Authentication timeout');
      } catch {}
    }, this.cfg.authTimeoutMs);
    pending.authTimer.unref?.();

    this.pendingSockets.set(connectionId, pending);

    socket.on('message', (data: RawData, isBinary: boolean) => {
      void this.handleRawMessage(pending, data, isBinary);
    });

    socket.on('close', () => {
      this.handleSocketClosed(pending);
    });

    socket.on('error', (err: any) => {
      if (
        err?.code === 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH' ||
        String(err?.message || '').toLowerCase().includes('max payload')
      ) {
        this.recordRejectedMessage('payload_limit');
      }
      this.handleSocketClosed(pending);
    });
  }

  private async handleRawMessage(
    pending: PendingSocketState,
    data: RawData,
    isBinary: boolean
  ): Promise<void> {
    try {
      if (this.isShuttingDown) {
        this.sendErrorSafe(pending.socket, 'SERVER_SHUTTING_DOWN', 'Camera signaling server is shutting down.');
        return;
      }

      if (isBinary) {
        this.recordRejectedMessage('other');
        this.sendErrorSafe(
          pending.socket,
          'BINARY_FRAMES_NOT_SUPPORTED',
          'Binary WebSocket media frames are not permitted on camera signaling channel.'
        );
        try {
          pending.socket.close(1003, 'Binary frames not supported');
        } catch {}
        return;
      }

      const rawBytes = Buffer.isBuffer(data)
        ? data
        : Array.isArray(data)
          ? Buffer.concat(data)
          : Buffer.from(data as ArrayBuffer);

      if (rawBytes.byteLength > this.cfg.maxPayloadBytes) {
        this.recordRejectedMessage('payload_limit');
        this.sendErrorSafe(pending.socket, 'PAYLOAD_TOO_LARGE', 'Signaling payload exceeds maximum permitted size.');
        try {
          pending.socket.close(1009, 'Payload too large');
        } catch {}
        return;
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(rawBytes.toString('utf8'));
      } catch {
        this.recordRejectedMessage('other');
        this.sendErrorSafe(pending.socket, 'INVALID_JSON', 'Signaling frame must be valid JSON.');
        return;
      }

      if (!parsedJson || typeof parsedJson !== 'object' || Array.isArray(parsedJson)) {
        this.recordRejectedMessage('other');
        this.sendErrorSafe(pending.socket, 'INVALID_SIGNALING_PAYLOAD', 'Signaling payload must be a JSON object.');
        return;
      }

      for (const key of Object.keys(parsedJson as Record<string, unknown>)) {
        if (FORBIDDEN_MEDIA_PAYLOAD_KEYS.has(key)) {
          this.recordRejectedMessage('other');
          this.sendErrorSafe(
            pending.socket,
            'MEDIA_PAYLOAD_FORBIDDEN',
            'Media or file-transfer fields are not permitted on camera signaling channel.'
          );
          return;
        }
      }

      const envelopeResult = BaseEnvelopeSchema.safeParse(parsedJson);
      if (!envelopeResult.success) {
        this.recordRejectedMessage('other');
        this.sendErrorSafe(
          pending.socket,
          'INVALID_SIGNALING_PAYLOAD',
          'Signaling message requires version and type fields.'
        );
        return;
      }

      if (envelopeResult.data.version !== CAMERA_SIGNALING_PROTOCOL_VERSION) {
        this.recordRejectedMessage('other');
        this.sendErrorSafe(
          pending.socket,
          'PROTOCOL_VERSION_UNSUPPORTED',
          `Unsupported signaling protocol version. Expected '${CAMERA_SIGNALING_PROTOCOL_VERSION}'.`
        );
        return;
      }

      const authConn = this.socketToAuthConn.get(pending.socket);
      if (!authConn) {
        if (envelopeResult.data.type !== 'SIGNALING_AUTH') {
          this.recordAuthRejection('UNAUTHORIZED');
          this.sendErrorSafe(
            pending.socket,
            'AUTHENTICATION_REQUIRED',
            'First signaling message must authenticate using SIGNALING_AUTH.'
          );
          try {
            pending.socket.close(4401, 'Authentication required');
          } catch {}
          return;
        }

        await this.authenticateSocket(pending, parsedJson);
        return;
      }

      await this.handleAuthenticatedMessage(authConn, parsedJson, envelopeResult.data.type);
    } catch (error: any) {
      this.recordRejectedMessage('negotiation');
      appLogger.warn('Unexpected error processing camera signaling message', {
        operation: 'CAMERA_SIGNALING_MESSAGE_PROCESSING',
        connectionId: pending.connectionId,
        errorCode: 'SIGNALING_INTERNAL_ERROR',
        metadata: { component: 'camera-signaling' },
        error
      });
      this.reportInternalSignalingError('handleRawMessage', error, {
        connectionId: pending.connectionId
      });
      this.sendErrorSafe(pending.socket, 'SIGNALING_INTERNAL_ERROR', 'Failed to process signaling message safely.');
    }
  }

  private async authenticateSocket(pending: PendingSocketState, rawPayload: unknown): Promise<void> {
    const parsedAuth = SignalingAuthSchema.safeParse(rawPayload);
    if (!parsedAuth.success) {
      this.recordAuthRejection('INVALID_CREDENTIALS');
      this.sendErrorSafe(pending.socket, 'INVALID_AUTH_PAYLOAD', 'Malformed SIGNALING_AUTH payload.');
      await this.recordCriticalAuthAuditSafe(null, null, 'UNKNOWN', 'INVALID_AUTH_PAYLOAD', pending);
      try {
        pending.socket.close(4400, 'Invalid SIGNALING_AUTH payload');
      } catch {}
      return;
    }

    const authMsg = parsedAuth.data;
    if (pending.authTimer) {
      clearTimeout(pending.authTimer);
      pending.authTimer = null;
    }
    this.pendingSockets.delete(pending.connectionId);

    if (authMsg.role === 'CAMERA') {
      await this.authenticateCameraSocket(pending, authMsg);
    } else {
      await this.authenticateViewerSocket(pending, authMsg);
    }
  }

  private async authenticateCameraSocket(
    pending: PendingSocketState,
    authMsg: z.infer<typeof SignalingAuthSchema>
  ): Promise<void> {
    try {
      // Combine credential sources deterministically; fail closed on conflict.
      const headerBearer =
        pending.upgradeAuthHeader?.startsWith('Bearer ')
          ? pending.upgradeAuthHeader.substring(7).trim()
          : null;
      const headerDeviceCred = pending.upgradeDeviceCredHeader?.trim() || null;

      if (authMsg.credential && headerBearer && authMsg.credential !== headerBearer) {
        throw new UnauthorizedError('Conflicting camera credentials supplied.', 'CONFLICTING_CREDENTIALS');
      }
      if (authMsg.credential && headerDeviceCred && authMsg.credential !== headerDeviceCred) {
        throw new UnauthorizedError('Conflicting camera credentials supplied.', 'CONFLICTING_CREDENTIALS');
      }

      const effectiveBearer = authMsg.credential || headerBearer || undefined;
      const effectiveDeviceId = authMsg.deviceId || pending.upgradeDeviceIdHeader || undefined;
      if (authMsg.deviceId && pending.upgradeDeviceIdHeader && authMsg.deviceId !== pending.upgradeDeviceIdHeader) {
        throw new ForbiddenError('Conflicting deviceId header and payload supplied.', 'DEVICE_MISMATCH');
      }

      const syntheticReq = {
        headers: {
          ...(effectiveBearer ? { authorization: `Bearer ${effectiveBearer}` } : {}),
          ...(headerDeviceCred && !effectiveBearer ? { 'x-device-credential': headerDeviceCred } : {}),
          ...(effectiveDeviceId ? { 'x-device-id': effectiveDeviceId } : {})
        },
        cookies: {},
        ip: pending.remoteIp
      } as unknown as FastifyRequest;

      const authDevice = await CameraLifecycleService.authenticateDeviceRequest(syntheticReq, {
        expectedDeviceId: effectiveDeviceId
      });

      const camera = await prisma.cameraInstance.findUnique({
        where: { id: authMsg.cameraId }
      });

      if (!camera) {
        throw new ForbiddenError('Camera instance not found or inaccessible.', 'CAMERA_NOT_FOUND');
      }

      if (camera.userId !== authDevice.userId || !camera.deviceId || camera.deviceId !== authDevice.deviceId) {
        throw new ForbiddenError(
          'Authenticated device is not authorized to signal for this camera.',
          'CAMERA_OWNERSHIP_DENIED'
        );
      }

      await CameraService.recordAuditEvent({
        cameraInstanceId: camera.id,
        userId: authDevice.userId,
        actorType: 'DEVICE',
        eventType: CameraAuditEventType.SIGNALING_AUTHENTICATED,
        action: 'CAMERA_SIGNALING_CONNECTED',
        result: 'SUCCESS',
        ipAddress: pending.remoteIp,
        userAgent: pending.userAgent,
        metadata: {
          role: 'CAMERA',
          deviceId: authDevice.deviceId,
          connectionId: pending.connectionId
        }
      });

      const nextEpoch = (this.cameraEpochMap.get(camera.id) ?? 0) + 1;
      this.cameraEpochMap.set(camera.id, nextEpoch);

      const previousCamConn = this.cameraConnections.get(camera.id);
      if (previousCamConn && previousCamConn.socket !== pending.socket) {
        this.evictConnection(previousCamConn, 'Newer camera signaling connection established');
      }

      const now = new Date();
      const camConn: AuthenticatedCameraConnection = {
        role: 'CAMERA',
        connectionId: pending.connectionId,
        socket: pending.socket,
        userId: authDevice.userId,
        cameraId: camera.id,
        deviceId: authDevice.deviceId,
        installationId: authDevice.installationId,
        epoch: nextEpoch,
        remoteIp: pending.remoteIp,
        userAgent: pending.userAgent,
        connectedAt: now,
        lastHeartbeatAt: now,
        rateWindowStartMs: now.getTime(),
        rateMessageCount: 0,
        isEvicted: false,
        isClosed: false
      };

      this.cameraConnections.set(camera.id, camConn);
      this.socketToAuthConn.set(pending.socket, camConn);

      this.sendJsonSafe(pending.socket, {
        version: CAMERA_SIGNALING_PROTOCOL_VERSION,
        type: 'SIGNALING_AUTH_OK',
        role: 'CAMERA',
        cameraId: camera.id,
        deviceId: authDevice.deviceId,
        connectionId: pending.connectionId,
        epoch: nextEpoch,
        activeViewers: this.countLiveViewersForCamera(camera.id)
      });
      this.authHandshakeLatency.record(Date.now() - pending.connectedAt.getTime());
    } catch (error: any) {
      const code = error instanceof AppError ? error.code : 'SIGNALING_AUTH_FAILED';
      const message = error instanceof AppError ? error.message : 'Camera signaling authentication failed.';
      this.recordAuthRejection(this.classifyAuthRejectionCode(code, error?.statusCode));
      if (!(error instanceof AppError) || error.statusCode >= 500) {
        this.reportInternalSignalingError('authenticateCameraSocket', error, {
          connectionId: pending.connectionId,
          cameraId: authMsg.cameraId
        });
      }

      try {
        const existingCam = await prisma.cameraInstance
          .findUnique({ where: { id: authMsg.cameraId }, select: { id: true } })
          .catch(() => null);
        await CameraService.recordAuditEvent({
          cameraInstanceId: existingCam?.id ?? null,
          userId: null,
          actorType: 'DEVICE',
          eventType: CameraAuditEventType.SIGNALING_AUTH_FAILED,
          action: 'CAMERA_SIGNALING_AUTH_FAILED',
          result: 'DENIED',
          ipAddress: pending.remoteIp,
          userAgent: pending.userAgent,
          metadata: { role: 'CAMERA', reasonCode: code, claimedCameraId: authMsg.cameraId }
        });
      } catch {
        // Critical audit persistence failed: fail closed unconditionally
        this.sendErrorSafe(pending.socket, 'AUDIT_PERSISTENCE_FAILED', 'Signaling denied: security audit failed.');
        try {
          pending.socket.close(4500, 'Security audit failure');
        } catch {}
        return;
      }

      this.sendErrorSafe(pending.socket, code, message);
      try {
        pending.socket.close(error?.statusCode === 403 ? 4403 : 4401, code);
      } catch {}
    }
  }

  private async authenticateViewerSocket(
    pending: PendingSocketState,
    authMsg: z.infer<typeof SignalingAuthSchema>
  ): Promise<void> {
    try {
      if (!pending.hasValidBrowserOrigin) {
        throw new ForbiddenError(
          'Browser viewer signaling requires a valid trusted Origin header.',
          'ORIGIN_REQUIRED'
        );
      }

      const headerBearer =
        pending.upgradeAuthHeader?.startsWith('Bearer ')
          ? pending.upgradeAuthHeader.substring(7).trim()
          : null;
      const headerViewingToken = pending.upgradeViewingTokenHeader?.trim() || null;

      if (authMsg.viewingToken && headerViewingToken && authMsg.viewingToken !== headerViewingToken) {
        throw new UnauthorizedError('Conflicting viewing tokens supplied.', 'CONFLICTING_CREDENTIALS');
      }
      if (authMsg.viewingToken && headerBearer && authMsg.viewingToken !== headerBearer) {
        throw new UnauthorizedError('Conflicting viewing tokens supplied.', 'CONFLICTING_CREDENTIALS');
      }

      const rawToken = authMsg.viewingToken || headerViewingToken || headerBearer;
      if (!rawToken) {
        throw new UnauthorizedError('Viewing token is required for viewer signaling.', 'VIEWING_TOKEN_REQUIRED');
      }

      const validation = await CameraService.validateViewingToken(rawToken, {
        expectedCameraId: authMsg.cameraId
      });

      if (!validation.valid || !validation.session || !validation.camera || !validation.expiresAt) {
        const failReason = validation.reason || 'TOKEN_INVALID';
        throw new ForbiddenError(`Viewing token rejected (${failReason}).`, failReason);
      }

      if (authMsg.sessionId && authMsg.sessionId !== validation.session.id) {
        throw new ForbiddenError(
          'Provided sessionId does not match the authenticated viewing token.',
          'SESSION_MISMATCH'
        );
      }

      if (pending.isClosed || pending.socket.readyState !== WebSocket.OPEN || this.isShuttingDown) {
        return;
      }

      // Atomically reserve viewer capacity before awaiting audit persistence (eliminates TOCTOU race).
      const reservation = this.tryAcquireViewerSlot(
        validation.camera.id,
        validation.session.id,
        pending.connectionId
      );
      if (!reservation.acquired) {
        await CameraService.recordAuditEvent({
          cameraInstanceId: validation.camera.id,
          userId: validation.userId,
          actorType: 'VIEWER',
          eventType: CameraAuditEventType.VIEWING_ACCESS_DENIED,
          action: 'VIEWER_CAPACITY_EXCEEDED',
          result: 'DENIED',
          ipAddress: pending.remoteIp,
          userAgent: pending.userAgent,
          metadata: {
            sessionId: validation.session.id,
            activeViewers: reservation.currentCount,
            maxViewersPerCamera: this.cfg.maxViewersPerCamera
          }
        });
        throw new ForbiddenError(
          'Maximum concurrent viewers reached for this camera.',
          'VIEWER_CAPACITY_EXCEEDED'
        );
      }

      await CameraService.recordAuditEvent({
        cameraInstanceId: validation.camera.id,
        userId: validation.userId,
        actorType: 'VIEWER',
        eventType: CameraAuditEventType.SIGNALING_AUTHENTICATED,
        action: 'VIEWER_SIGNALING_CONNECTED',
        result: 'SUCCESS',
        ipAddress: pending.remoteIp,
        userAgent: pending.userAgent,
        metadata: {
          role: 'VIEWER',
          sessionId: validation.session.id,
          connectionId: pending.connectionId
        }
      });

      // Verify socket remained open and reservation was not revoked during async audit write
      if (pending.isClosed || pending.socket.readyState !== WebSocket.OPEN || this.isShuttingDown) {
        this.releaseViewerSlot(pending.connectionId);
        return;
      }
      if (!this.socketSlotReservation.has(pending.connectionId)) {
        throw new ForbiddenError('Viewing session has been revoked.', 'SESSION_REVOKED');
      }

      const sessionId: string = validation.session.id;
      const nextEpoch = (this.viewerEpochMap.get(sessionId) ?? 0) + 1;
      this.viewerEpochMap.set(sessionId, nextEpoch);

      const previousViewerConn = this.viewerConnections.get(sessionId);
      if (previousViewerConn && previousViewerConn.socket !== pending.socket) {
        this.evictConnection(previousViewerConn, 'Newer viewer signaling connection established for session');
      }

      const now = new Date();
      const viewerConn: AuthenticatedViewerConnection = {
        role: 'VIEWER',
        connectionId: pending.connectionId,
        socket: pending.socket,
        userId: validation.userId!,
        cameraId: validation.camera.id,
        sessionId,
        expiresAt: validation.expiresAt,
        epoch: nextEpoch,
        remoteIp: pending.remoteIp,
        userAgent: pending.userAgent,
        connectedAt: now,
        lastHeartbeatAt: now,
        rateWindowStartMs: now.getTime(),
        rateMessageCount: 0,
        isEvicted: false,
        isClosed: false
      };

      this.viewerConnections.set(sessionId, viewerConn);
      this.socketToAuthConn.set(pending.socket, viewerConn);

      if (!this.sessionNegotiationState.has(sessionId)) {
        this.sessionNegotiationState.set(sessionId, {
          cameraId: validation.camera.id,
          userId: validation.userId!,
          lastOfferByRole: null,
          offerCount: 0,
          answerCount: 0,
          iceCandidateCount: 0,
          updatedAt: now
        });
      }

      const camConn = this.cameraConnections.get(validation.camera.id);
      const cameraConnected = Boolean(camConn && !camConn.isClosed && !camConn.isEvicted);

      this.sendJsonSafe(pending.socket, {
        version: CAMERA_SIGNALING_PROTOCOL_VERSION,
        type: 'SIGNALING_AUTH_OK',
        role: 'VIEWER',
        cameraId: validation.camera.id,
        sessionId,
        connectionId: pending.connectionId,
        epoch: nextEpoch,
        expiresAt: validation.expiresAt.toISOString(),
        cameraConnected
      });
      this.authHandshakeLatency.record(Date.now() - pending.connectedAt.getTime());
    } catch (error: any) {
      this.releaseViewerSlot(pending.connectionId);
      const code = error instanceof AppError ? error.code : 'SIGNALING_AUTH_FAILED';
      const message = error instanceof AppError ? error.message : 'Viewer signaling authentication failed.';
      this.recordAuthRejection(this.classifyAuthRejectionCode(code, error?.statusCode));
      if (!(error instanceof AppError) || error.statusCode >= 500) {
        this.reportInternalSignalingError('authenticateViewerSocket', error, {
          connectionId: pending.connectionId,
          cameraId: authMsg.cameraId
        });
      }

      try {
        const existingCam = await prisma.cameraInstance
          .findUnique({ where: { id: authMsg.cameraId }, select: { id: true } })
          .catch(() => null);
        await CameraService.recordAuditEvent({
          cameraInstanceId: existingCam?.id ?? null,
          userId: null,
          actorType: 'VIEWER',
          eventType: CameraAuditEventType.SIGNALING_AUTH_FAILED,
          action: 'VIEWER_SIGNALING_AUTH_FAILED',
          result: 'DENIED',
          ipAddress: pending.remoteIp,
          userAgent: pending.userAgent,
          metadata: { role: 'VIEWER', reasonCode: code, claimedCameraId: authMsg.cameraId }
        });
      } catch {
        this.sendErrorSafe(pending.socket, 'AUDIT_PERSISTENCE_FAILED', 'Signaling denied: security audit failed.');
        try {
          pending.socket.close(4500, 'Security audit failure');
        } catch {}
        return;
      }

      this.sendErrorSafe(pending.socket, code, message);
      try {
        pending.socket.close(error?.statusCode === 403 ? 4403 : 4401, code);
      } catch {}
    }
  }

  private async handleAuthenticatedMessage(
    conn: AuthenticatedSignalingConnection,
    rawPayload: unknown,
    messageType: string
  ): Promise<void> {
    if (!this.isConnectionAuthoritative(conn)) {
      this.recordRejectedMessage('stale');
      this.sendErrorSafe(
        conn.socket,
        'STALE_SIGNALING_CONNECTION',
        'Signaling connection has been superseded or closed.'
      );
      try {
        conn.socket.close(4409, 'Connection superseded');
      } catch {}
      return;
    }

    if (!this.consumeRateLimit(conn)) {
      this.recordRejectedMessage('rate_limit');
      this.sendErrorSafe(conn.socket, 'SIGNALING_RATE_LIMITED', 'Signaling message rate limit exceeded.');
      return;
    }

    if (messageType === 'SIGNALING_AUTH') {
      this.recordRejectedMessage('other');
      this.sendErrorSafe(conn.socket, 'ALREADY_AUTHENTICATED', 'Connection is already authenticated.');
      return;
    }

    if (messageType === 'PING' || messageType === 'PONG') {
      const hbStartMs = Date.now();
      const pingResult = PingPongSchema.safeParse(rawPayload);
      if (!pingResult.success) {
        this.recordRejectedMessage('other');
        this.sendErrorSafe(conn.socket, 'INVALID_SIGNALING_PAYLOAD', 'Malformed PING/PONG payload.');
        return;
      }
      if (pingResult.data.cameraId && pingResult.data.cameraId !== conn.cameraId) {
        this.recordRejectedMessage('other');
        this.sendErrorSafe(conn.socket, 'CAMERA_MISMATCH', 'cameraId does not match authenticated connection.');
        return;
      }
      conn.lastHeartbeatAt = new Date();
      if (messageType === 'PING') {
        this.sendJsonSafe(conn.socket, {
          version: CAMERA_SIGNALING_PROTOCOL_VERSION,
          type: 'PONG',
          cameraId: conn.cameraId,
          ...(conn.role === 'VIEWER' ? { sessionId: conn.sessionId } : {}),
          serverTime: conn.lastHeartbeatAt.toISOString()
        });
      }
      this.signalingHeartbeatLatency.record(Date.now() - hbStartMs);
      return;
    }

    switch (messageType) {
      case 'SESSION_INITIATE':
        await this.handleSessionInitiate(conn, rawPayload);
        return;
      case 'WEBRTC_OFFER':
        await this.handleWebRtcOffer(conn, rawPayload);
        return;
      case 'WEBRTC_ANSWER':
        await this.handleWebRtcAnswer(conn, rawPayload);
        return;
      case 'ICE_CANDIDATE':
        await this.handleIceCandidate(conn, rawPayload);
        return;
      case 'SESSION_RESTART':
        await this.handleSessionRestart(conn, rawPayload);
        return;
      case 'NEGOTIATION_FAILED':
        await this.handleNegotiationFailed(conn, rawPayload);
        return;
      case 'SESSION_TERMINATE':
        await this.handleSessionTerminate(conn, rawPayload);
        return;
      default:
        this.recordRejectedMessage('other');
        this.sendErrorSafe(
          conn.socket,
          'UNSUPPORTED_MESSAGE_TYPE',
          `Unsupported signaling message type '${sanitizeLogString(messageType, 64) || 'UNKNOWN'}'.`
        );
    }
  }

  private async validateSessionContextForMessage(
    conn: AuthenticatedSignalingConnection,
    cameraId: string,
    sessionId: string
  ): Promise<{ ok: true; session: any; camera: any } | { ok: false }> {
    if (cameraId !== conn.cameraId) {
      this.recordRejectedMessage('negotiation');
      this.sendErrorSafe(conn.socket, 'CAMERA_MISMATCH', 'Cross-camera signaling is not permitted.');
      return { ok: false };
    }

    if (conn.role === 'VIEWER' && sessionId !== conn.sessionId) {
      this.recordRejectedMessage('negotiation');
      this.sendErrorSafe(
        conn.socket,
        'VIEWER_SESSION_MISMATCH',
        'Viewer connection may only signal for its own authenticated sessionId.'
      );
      return { ok: false };
    }

    const now = new Date();
    const session = await prisma.cameraStreamSession.findUnique({
      where: { id: sessionId },
      include: { cameraInstance: true }
    });

    if (!session || !session.cameraInstance) {
      this.recordRejectedMessage('negotiation');
      this.sendErrorSafe(conn.socket, 'SESSION_NOT_FOUND', 'Viewing session does not exist.');
      if (conn.role === 'VIEWER') {
        this.closeViewerOnTerminalSession(conn, 'SESSION_NOT_FOUND');
      }
      return { ok: false };
    }

    if (
      session.cameraInstanceId !== conn.cameraId ||
      session.viewerUserId !== conn.userId ||
      session.cameraInstance.userId !== conn.userId
    ) {
      this.recordRejectedMessage('negotiation');
      await CameraService.recordAuditEvent({
        cameraInstanceId: conn.cameraId,
        userId: conn.userId,
        actorType: conn.role,
        eventType: CameraAuditEventType.VIEWING_ACCESS_DENIED,
        action: 'CROSS_ACCOUNT_OR_SESSION_MISMATCH',
        result: 'DENIED',
        ipAddress: conn.remoteIp,
        userAgent: conn.userAgent,
        metadata: { sessionId, role: conn.role }
      });
      this.sendErrorSafe(conn.socket, 'SESSION_OWNERSHIP_DENIED', 'Session ownership mismatch.');
      return { ok: false };
    }

    if (conn.role === 'CAMERA' && (!session.cameraInstance.deviceId || session.cameraInstance.deviceId !== conn.deviceId)) {
      this.recordRejectedMessage('negotiation');
      this.sendErrorSafe(conn.socket, 'DEVICE_CAMERA_MISMATCH', 'Camera is no longer linked to this device.');
      this.evictConnection(conn, 'Device camera link revoked');
      return { ok: false };
    }

    if (TERMINAL_SESSION_STATUSES.has(session.status)) {
      this.recordRejectedMessage('stale');
      this.sendErrorSafe(
        conn.socket,
        `SESSION_${session.status}`,
        `Viewing session is no longer active (${session.status}).`
      );
      if (conn.role === 'VIEWER') {
        this.closeViewerOnTerminalSession(conn, `SESSION_${session.status}`);
      }
      return { ok: false };
    }

    if (!session.expiresAt || session.expiresAt <= now) {
      await this.expireTimedOutSession(session.id, session.cameraInstanceId, session.viewerUserId, now);
      this.recordRejectedMessage('stale');
      this.sendErrorSafe(conn.socket, 'SESSION_EXPIRED', 'Viewing session token has expired.');
      if (conn.role === 'VIEWER') {
        this.closeViewerOnTerminalSession(conn, 'SESSION_EXPIRED');
      }
      return { ok: false };
    }

    // Re-evaluate viewer streaming entitlement fail-closed on active negotiation
    if (conn.role === 'VIEWER') {
      const entitlements = await EntitlementService.resolveUserEntitlements(conn.userId);
      if (!entitlements.cameraStreaming) {
        this.recordRejectedMessage('negotiation');
        this.sendErrorSafe(
          conn.socket,
          'STREAMING_NOT_ENTITLED',
          'Live camera streaming entitlement is inactive or expired.'
        );
        this.closeViewerOnTerminalSession(conn, 'STREAMING_NOT_ENTITLED');
        return { ok: false };
      }
    }

    return { ok: true, session, camera: session.cameraInstance };
  }

  private async handleSessionInitiate(conn: AuthenticatedSignalingConnection, rawPayload: unknown): Promise<void> {
    if (conn.role !== 'VIEWER') {
      this.recordRejectedMessage('negotiation');
      this.sendErrorSafe(conn.socket, 'FORBIDDEN_SIGNALING_ROLE', 'Only VIEWER may send SESSION_INITIATE.');
      return;
    }

    const parsed = SessionInitiateSchema.safeParse(rawPayload);
    if (!parsed.success) {
      this.recordRejectedMessage('negotiation');
      this.sendErrorSafe(conn.socket, 'INVALID_SIGNALING_PAYLOAD', 'Invalid SESSION_INITIATE payload.');
      return;
    }

    const msg = parsed.data;
    const valid = await this.validateSessionContextForMessage(conn, msg.cameraId, msg.sessionId);
    if (!valid.ok) return;

    if (!CONNECTABLE_CAMERA_STATUSES.has(valid.camera.status)) {
      this.recordRejectedMessage('negotiation');
      this.sendErrorSafe(
        conn.socket,
        'CAMERA_NOT_AVAILABLE',
        `Camera is in ${valid.camera.status} state and cannot accept signaling initiation.`
      );
      return;
    }

    const targetCamera = this.cameraConnections.get(msg.cameraId);
    if (!targetCamera || targetCamera.isClosed || targetCamera.isEvicted || targetCamera.userId !== conn.userId) {
      this.recordRejectedMessage('negotiation');
      this.sendErrorSafe(
        conn.socket,
        'CAMERA_SIGNALING_OFFLINE',
        'Camera device is not currently connected to signaling.'
      );
      return;
    }

    await this.markSessionNegotiating(valid.session);

    this.ensureSessionState(msg.sessionId, msg.cameraId, conn.userId);
    this.sendJsonSafe(targetCamera.socket, {
      version: CAMERA_SIGNALING_PROTOCOL_VERSION,
      type: 'SESSION_INITIATE',
      cameraId: msg.cameraId,
      sessionId: msg.sessionId,
      ...(msg.requestId ? { requestId: msg.requestId } : {}),
      expiresAt: valid.session.expiresAt.toISOString(),
      requestedAt: new Date().toISOString()
    });
    this.sessionInitiatesRelayed++;
  }

  private async handleWebRtcOffer(conn: AuthenticatedSignalingConnection, rawPayload: unknown): Promise<void> {
    const parsed = WebRtcOfferSchema.safeParse(rawPayload);
    if (!parsed.success) {
      this.recordRejectedMessage('negotiation');
      this.sendErrorSafe(
        conn.socket,
        'INVALID_SDP_OFFER',
        'WEBRTC_OFFER requires sdpType="offer" and valid bounded SDP payload.'
      );
      return;
    }

    const msg = parsed.data;
    const valid = await this.validateSessionContextForMessage(conn, msg.cameraId, msg.sessionId);
    if (!valid.ok) return;

    const peer = this.resolvePeerConnection(conn, msg.cameraId, msg.sessionId);
    if (!peer) {
      this.recordRejectedMessage('negotiation');
      this.sendErrorSafe(conn.socket, 'PEER_UNAVAILABLE', 'Target peer is not connected to signaling.');
      return;
    }

    await this.markSessionNegotiating(valid.session);

    const state = this.ensureSessionState(msg.sessionId, msg.cameraId, conn.userId);
    state.lastOfferByRole = conn.role;
    state.offerCount += 1;
    state.updatedAt = new Date();

    this.sendJsonSafe(peer.socket, {
      version: CAMERA_SIGNALING_PROTOCOL_VERSION,
      type: 'WEBRTC_OFFER',
      cameraId: msg.cameraId,
      sessionId: msg.sessionId,
      sdpType: 'offer',
      sdp: msg.sdp,
      ...(msg.renegotiation !== undefined ? { renegotiation: msg.renegotiation } : {}),
      ...(msg.requestId ? { requestId: msg.requestId } : {}),
      fromRole: conn.role
    });
    this.offersRelayed++;
  }

  private async handleWebRtcAnswer(conn: AuthenticatedSignalingConnection, rawPayload: unknown): Promise<void> {
    const parsed = WebRtcAnswerSchema.safeParse(rawPayload);
    if (!parsed.success) {
      this.recordRejectedMessage('negotiation');
      this.sendErrorSafe(
        conn.socket,
        'INVALID_SDP_ANSWER',
        'WEBRTC_ANSWER requires sdpType="answer" and valid bounded SDP payload.'
      );
      return;
    }

    const msg = parsed.data;
    const valid = await this.validateSessionContextForMessage(conn, msg.cameraId, msg.sessionId);
    if (!valid.ok) return;

    const state = this.sessionNegotiationState.get(msg.sessionId);
    if (!state?.lastOfferByRole) {
      this.recordRejectedMessage('stale');
      this.sendErrorSafe(
        conn.socket,
        'MISSING_ACTIVE_OFFER',
        'Cannot exchange WEBRTC_ANSWER without a prior WEBRTC_OFFER in this session.'
      );
      return;
    }

    if (state.lastOfferByRole === conn.role) {
      this.recordRejectedMessage('stale');
      this.sendErrorSafe(
        conn.socket,
        'INVALID_SIGNALING_STATE',
        'Participant cannot submit WEBRTC_ANSWER to its own WEBRTC_OFFER.'
      );
      return;
    }

    const peer = this.resolvePeerConnection(conn, msg.cameraId, msg.sessionId);
    if (!peer) {
      this.recordRejectedMessage('negotiation');
      this.sendErrorSafe(conn.socket, 'PEER_UNAVAILABLE', 'Target peer is not connected to signaling.');
      return;
    }

    await this.markSessionNegotiating(valid.session);

    state.lastOfferByRole = null;
    state.answerCount += 1;
    state.updatedAt = new Date();

    this.sendJsonSafe(peer.socket, {
      version: CAMERA_SIGNALING_PROTOCOL_VERSION,
      type: 'WEBRTC_ANSWER',
      cameraId: msg.cameraId,
      sessionId: msg.sessionId,
      sdpType: 'answer',
      sdp: msg.sdp,
      ...(msg.requestId ? { requestId: msg.requestId } : {}),
      fromRole: conn.role
    });
    this.answersRelayed++;
  }

  private async handleIceCandidate(conn: AuthenticatedSignalingConnection, rawPayload: unknown): Promise<void> {
    const parsed = IceCandidateSchema.safeParse(rawPayload);
    if (!parsed.success) {
      this.recordRejectedMessage('negotiation');
      this.sendErrorSafe(
        conn.socket,
        'INVALID_ICE_CANDIDATE',
        'Invalid ICE_CANDIDATE payload or candidate exceeds maximum permitted length.'
      );
      return;
    }

    const msg = parsed.data;
    if (msg.candidate.length === 0 && msg.sdpMid === undefined && msg.sdpMLineIndex === undefined) {
      this.recordRejectedMessage('negotiation');
      this.sendErrorSafe(
        conn.socket,
        'INVALID_ICE_CANDIDATE',
        'ICE_CANDIDATE must provide candidate string or m-line end-of-candidates descriptor.'
      );
      return;
    }

    const valid = await this.validateSessionContextForMessage(conn, msg.cameraId, msg.sessionId);
    if (!valid.ok) return;

    const peer = this.resolvePeerConnection(conn, msg.cameraId, msg.sessionId);
    if (!peer) {
      this.recordRejectedMessage('negotiation');
      this.sendErrorSafe(conn.socket, 'PEER_UNAVAILABLE', 'Target peer is not connected to signaling.');
      return;
    }

    await this.markSessionNegotiating(valid.session);

    const state = this.ensureSessionState(msg.sessionId, msg.cameraId, conn.userId);
    state.iceCandidateCount += 1;
    state.updatedAt = new Date();

    this.sendJsonSafe(peer.socket, {
      version: CAMERA_SIGNALING_PROTOCOL_VERSION,
      type: 'ICE_CANDIDATE',
      cameraId: msg.cameraId,
      sessionId: msg.sessionId,
      candidate: msg.candidate,
      ...(msg.sdpMid !== undefined ? { sdpMid: msg.sdpMid } : {}),
      ...(msg.sdpMLineIndex !== undefined ? { sdpMLineIndex: msg.sdpMLineIndex } : {}),
      ...(msg.usernameFragment !== undefined ? { usernameFragment: msg.usernameFragment } : {}),
      fromRole: conn.role
    });
    this.iceCandidatesRelayed++;
  }

  private async handleSessionRestart(conn: AuthenticatedSignalingConnection, rawPayload: unknown): Promise<void> {
    const parsed = SessionRestartSchema.safeParse(rawPayload);
    if (!parsed.success) {
      this.recordRejectedMessage('negotiation');
      this.sendErrorSafe(conn.socket, 'INVALID_SIGNALING_PAYLOAD', 'Invalid SESSION_RESTART payload.');
      return;
    }

    const msg = parsed.data;
    const valid = await this.validateSessionContextForMessage(conn, msg.cameraId, msg.sessionId);
    if (!valid.ok) return;

    const peer = this.resolvePeerConnection(conn, msg.cameraId, msg.sessionId);
    if (!peer) {
      this.recordRejectedMessage('negotiation');
      this.sendErrorSafe(conn.socket, 'PEER_UNAVAILABLE', 'Target peer is not connected to signaling.');
      return;
    }

    await this.markSessionNegotiating(valid.session);
    const state = this.ensureSessionState(msg.sessionId, msg.cameraId, conn.userId);
    state.lastOfferByRole = null;
    state.updatedAt = new Date();

    this.sendJsonSafe(peer.socket, {
      version: CAMERA_SIGNALING_PROTOCOL_VERSION,
      type: 'SESSION_RESTART',
      cameraId: msg.cameraId,
      sessionId: msg.sessionId,
      reason: sanitizeLogString(msg.reason || 'ICE restart requested', 128),
      fromRole: conn.role
    });
    this.sessionRestartsRelayed++;
  }

  private async handleNegotiationFailed(conn: AuthenticatedSignalingConnection, rawPayload: unknown): Promise<void> {
    const parsed = NegotiationFailedSchema.safeParse(rawPayload);
    if (!parsed.success) {
      this.recordRejectedMessage('negotiation');
      this.sendErrorSafe(conn.socket, 'INVALID_SIGNALING_PAYLOAD', 'Invalid NEGOTIATION_FAILED payload.');
      return;
    }

    const msg = parsed.data;
    const valid = await this.validateSessionContextForMessage(conn, msg.cameraId, msg.sessionId);
    if (!valid.ok) return;

    const now = new Date();
    const safeReason = sanitizeLogString(msg.reason || msg.errorCode || 'negotiation_failed', 128) || 'negotiation_failed';

    await this.finalizeSessionAndReconcile(
      msg.sessionId,
      msg.cameraId,
      conn.userId,
      conn.role,
      CameraStreamSessionStatus.FAILED,
      safeReason,
      now,
      conn
    );
    this.negotiationFailuresReported++;

    const peer = this.resolvePeerConnection(conn, msg.cameraId, msg.sessionId);
    if (peer) {
      this.sendJsonSafe(peer.socket, {
        version: CAMERA_SIGNALING_PROTOCOL_VERSION,
        type: 'NEGOTIATION_FAILED',
        cameraId: msg.cameraId,
        sessionId: msg.sessionId,
        ...(msg.errorCode ? { errorCode: msg.errorCode } : {}),
        reason: safeReason,
        fromRole: conn.role
      });
    }

    this.detachViewerSessionOnly(msg.sessionId, 'NEGOTIATION_FAILED');
  }

  private async handleSessionTerminate(conn: AuthenticatedSignalingConnection, rawPayload: unknown): Promise<void> {
    const parsed = SessionTerminateSchema.safeParse(rawPayload);
    if (!parsed.success) {
      this.recordRejectedMessage('negotiation');
      this.sendErrorSafe(conn.socket, 'INVALID_SIGNALING_PAYLOAD', 'Invalid SESSION_TERMINATE payload.');
      return;
    }

    const msg = parsed.data;
    const valid = await this.validateSessionContextForMessage(conn, msg.cameraId, msg.sessionId);
    if (!valid.ok) return;

    const now = new Date();
    const safeReason =
      sanitizeLogString(msg.reason || `Terminated by ${conn.role.toLowerCase()}`, 128) || 'session_terminated';

    await this.finalizeSessionAndReconcile(
      msg.sessionId,
      msg.cameraId,
      conn.userId,
      conn.role,
      CameraStreamSessionStatus.ENDED,
      safeReason,
      now,
      conn
    );
    this.clientTerminations++;

    const peer = this.resolvePeerConnection(conn, msg.cameraId, msg.sessionId);
    if (peer) {
      this.sendJsonSafe(peer.socket, {
        version: CAMERA_SIGNALING_PROTOCOL_VERSION,
        type: 'SESSION_TERMINATE',
        cameraId: msg.cameraId,
        sessionId: msg.sessionId,
        reason: safeReason,
        fromRole: conn.role
      });
    }

    // Disconnect only the terminated viewer session socket; keep physical camera signaling alive.
    this.detachViewerSessionOnly(msg.sessionId, 'SESSION_TERMINATED');
  }

  private async markSessionNegotiating(session: {
    id: string;
    status: CameraStreamSessionStatus;
  }): Promise<void> {
    if (session.status !== CameraStreamSessionStatus.INITIATED) {
      return;
    }

    // Conditional update prevents racing against concurrent ENDED/REVOKED/TIMED_OUT transitions.
    // Intentionally does NOT promote CameraInstance to STREAMING until media path / device report confirms.
    await prisma.cameraStreamSession.updateMany({
      where: {
        id: session.id,
        status: CameraStreamSessionStatus.INITIATED
      },
      data: {
        status: CameraStreamSessionStatus.NEGOTIATING
      }
    });
  }

  private async finalizeSessionAndReconcile(
    sessionId: string,
    cameraId: string,
    userId: string,
    actorRole: SignalingParticipantRole | 'SYSTEM',
    targetStatus: CameraStreamSessionStatus,
    reason: string,
    now: Date,
    conn?: AuthenticatedSignalingConnection
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM CameraStreamSession WHERE id = ${sessionId} FOR UPDATE`;

      const lockedSession = await tx.cameraStreamSession.findUnique({
        where: { id: sessionId }
      });

      if (lockedSession && !TERMINAL_SESSION_STATUSES.has(lockedSession.status)) {
        await tx.cameraStreamSession.update({
          where: { id: sessionId },
          data: {
            status: targetStatus,
            endedAt: now,
            terminationReason: reason
          }
        });
      }

      // Safely downgrade CameraInstance from STREAMING -> ONLINE only when zero active sessions remain.
      // Never marks physical CameraInstance OFFLINE because a viewer session ended.
      await CameraLifecycleService.reconcileCameraStreamingStateWithTx(tx, cameraId, now);

      await CameraService.recordAuditEventWithTx(tx, {
        cameraInstanceId: cameraId,
        userId,
        actorType: actorRole,
        eventType: CameraAuditEventType.VIEWING_SESSION_ENDED,
        action: `SIGNALING_${targetStatus}`,
        result: targetStatus === CameraStreamSessionStatus.FAILED ? 'FAILED' : 'SUCCESS',
        ipAddress: conn?.remoteIp ?? null,
        userAgent: conn?.userAgent ?? null,
        metadata: {
          sessionId,
          terminationStatus: targetStatus,
          reason
        }
      });
    });

    this.sessionNegotiationState.delete(sessionId);
  }

  private async expireTimedOutSession(
    sessionId: string,
    cameraId: string,
    userId: string,
    now: Date
  ): Promise<void> {
    this.expiredCleanups++;
    await this.finalizeSessionAndReconcile(
      sessionId,
      cameraId,
      userId,
      'SYSTEM',
      CameraStreamSessionStatus.TIMED_OUT,
      'Viewing session expired during signaling',
      now
    );
  }

  private resolvePeerConnection(
    sender: AuthenticatedSignalingConnection,
    cameraId: string,
    sessionId: string
  ): AuthenticatedSignalingConnection | null {
    if (sender.role === 'VIEWER') {
      const camConn = this.cameraConnections.get(cameraId);
      if (!camConn || camConn.isClosed || camConn.isEvicted || camConn.userId !== sender.userId) {
        return null;
      }
      return camConn;
    }

    const viewerConn = this.viewerConnections.get(sessionId);
    if (
      !viewerConn ||
      viewerConn.isClosed ||
      viewerConn.isEvicted ||
      viewerConn.cameraId !== cameraId ||
      viewerConn.userId !== sender.userId
    ) {
      return null;
    }
    return viewerConn;
  }

  private handleSocketClosed(pending: PendingSocketState): void {
    pending.isClosed = true;
    if (pending.authTimer) {
      clearTimeout(pending.authTimer);
      pending.authTimer = null;
    }
    this.pendingSockets.delete(pending.connectionId);
    // Idempotently release ONLY this connection's own slot reservation (never affects replacement connections)
    this.releaseViewerSlot(pending.connectionId);

    const authConn = this.socketToAuthConn.get(pending.socket);
    if (!authConn) return;

    this.socketToAuthConn.delete(pending.socket);
    authConn.isClosed = true;
    this.releaseViewerSlot(authConn.connectionId);

    // Epoch guard: if this socket was already evicted/superseded by a newer reconnect,
    // do not delete the newer connection entry or notify peers of a stale close.
    if (authConn.isEvicted || !this.isConnectionAuthoritative(authConn)) {
      return;
    }

    if (authConn.role === 'CAMERA') {
      const current = this.cameraConnections.get(authConn.cameraId);
      if (current && current.epoch === authConn.epoch) {
        this.cameraConnections.delete(authConn.cameraId);
        // Notify connected viewers for this camera of temporary camera signaling loss;
        // do NOT overwrite physical CameraInstance status to OFFLINE on socket blip alone.
        for (const viewerConn of this.viewerConnections.values()) {
          if (viewerConn.cameraId === authConn.cameraId && !viewerConn.isClosed && !viewerConn.isEvicted) {
            this.sendJsonSafe(viewerConn.socket, {
              version: CAMERA_SIGNALING_PROTOCOL_VERSION,
              type: 'PEER_DISCONNECTED',
              role: 'CAMERA',
              cameraId: authConn.cameraId,
              sessionId: viewerConn.sessionId,
              temporary: true,
              reason: 'Camera signaling connection closed'
            });
          }
        }
      }
      return;
    }

    const currentViewer = this.viewerConnections.get(authConn.sessionId);
    if (currentViewer && currentViewer.epoch === authConn.epoch) {
      this.viewerConnections.delete(authConn.sessionId);
      // Temporary viewer disconnect notifies camera for that sessionId only;
      // never marks physical CameraInstance OFFLINE and never affects other viewers.
      const camConn = this.cameraConnections.get(authConn.cameraId);
      if (camConn && !camConn.isClosed && !camConn.isEvicted) {
        this.sendJsonSafe(camConn.socket, {
          version: CAMERA_SIGNALING_PROTOCOL_VERSION,
          type: 'PEER_DISCONNECTED',
          role: 'VIEWER',
          cameraId: authConn.cameraId,
          sessionId: authConn.sessionId,
          temporary: true,
          reason: 'Viewer signaling connection closed'
        });
      }
    }
  }

  private evictConnection(conn: AuthenticatedSignalingConnection, reason: string): void {
    conn.isEvicted = true;
    conn.isClosed = true;
    this.evictedConnections++;
    if (conn.role === 'CAMERA') {
      this.cameraEvictions++;
    } else {
      this.viewerEvictions++;
    }
    this.socketToAuthConn.delete(conn.socket);
    this.releaseViewerSlot(conn.connectionId);

    this.sendJsonSafe(conn.socket, {
      version: CAMERA_SIGNALING_PROTOCOL_VERSION,
      type: 'SIGNALING_DISCONNECTED',
      code: 'SESSION_SUPERSEDED',
      cameraId: conn.cameraId,
      ...(conn.role === 'VIEWER' ? { sessionId: conn.sessionId } : {}),
      reason
    });
    try {
      conn.socket.close(4409, 'Connection superseded');
    } catch {}
  }

  private detachViewerSessionOnly(sessionId: string, closeReason: string): void {
    const viewerConn = this.viewerConnections.get(sessionId);
    this.sessionNegotiationState.delete(sessionId);
    if (!viewerConn) return;

    viewerConn.isClosed = true;
    viewerConn.isEvicted = true;
    this.viewerConnections.delete(sessionId);
    this.socketToAuthConn.delete(viewerConn.socket);
    this.releaseViewerSlot(viewerConn.connectionId);
    try {
      viewerConn.socket.close(1000, closeReason);
    } catch {}
  }

  private closeViewerOnTerminalSession(viewerConn: AuthenticatedViewerConnection, reason: string): void {
    viewerConn.isClosed = true;
    viewerConn.isEvicted = true;
    if (this.viewerConnections.get(viewerConn.sessionId)?.epoch === viewerConn.epoch) {
      this.viewerConnections.delete(viewerConn.sessionId);
    }
    this.socketToAuthConn.delete(viewerConn.socket);
    this.sessionNegotiationState.delete(viewerConn.sessionId);
    this.releaseViewerSlot(viewerConn.connectionId);
    try {
      viewerConn.socket.close(4403, reason);
    } catch {}
  }

  /**
   * Synchronously acquires or shares a per-camera viewer slot keyed by sessionId.
   * Prevents concurrent handshake TOCTOU races without double-counting reconnections.
   */
  private tryAcquireViewerSlot(
    cameraId: string,
    sessionId: string,
    connectionId: string
  ): { acquired: boolean; currentCount: number } {
    let camSlots = this.cameraViewerSlots.get(cameraId);
    if (!camSlots) {
      camSlots = new Map<string, Set<string>>();
      this.cameraViewerSlots.set(cameraId, camSlots);
    }

    const existingHolders = camSlots.get(sessionId);
    if (existingHolders) {
      existingHolders.add(connectionId);
      this.socketSlotReservation.set(connectionId, { cameraId, sessionId });
      return { acquired: true, currentCount: camSlots.size };
    }

    if (camSlots.size >= this.cfg.maxViewersPerCamera) {
      return { acquired: false, currentCount: camSlots.size };
    }

    camSlots.set(sessionId, new Set([connectionId]));
    this.socketSlotReservation.set(connectionId, { cameraId, sessionId });
    return { acquired: true, currentCount: camSlots.size };
  }

  /**
   * Idempotently releases the specific connection's slot reservation.
   * Frees the session slot on that camera only when zero connections hold it.
   */
  private releaseViewerSlot(connectionId: string): void {
    const slotRef = this.socketSlotReservation.get(connectionId);
    if (!slotRef) return;

    this.socketSlotReservation.delete(connectionId);
    const camSlots = this.cameraViewerSlots.get(slotRef.cameraId);
    if (!camSlots) return;

    const holders = camSlots.get(slotRef.sessionId);
    if (holders) {
      holders.delete(connectionId);
      if (holders.size === 0) {
        camSlots.delete(slotRef.sessionId);
      }
    }

    if (camSlots.size === 0) {
      this.cameraViewerSlots.delete(slotRef.cameraId);
    }
  }

  public getCameraReservedSlotCount(cameraId: string): number {
    return this.cameraViewerSlots.get(cameraId)?.size ?? 0;
  }

  private isConnectionAuthoritative(conn: AuthenticatedSignalingConnection): boolean {
    if (conn.isClosed || conn.isEvicted) return false;
    if (conn.role === 'CAMERA') {
      return this.cameraEpochMap.get(conn.cameraId) === conn.epoch;
    }
    return this.viewerEpochMap.get(conn.sessionId) === conn.epoch;
  }

  private consumeRateLimit(conn: AuthenticatedSignalingConnection): boolean {
    const nowMs = Date.now();
    if (nowMs - conn.rateWindowStartMs >= 60000) {
      conn.rateWindowStartMs = nowMs;
      conn.rateMessageCount = 0;
    }
    conn.rateMessageCount += 1;
    return conn.rateMessageCount <= this.cfg.rateLimitPerMin;
  }

  private countLiveViewersForCamera(cameraId: string): number {
    let count = 0;
    for (const viewerConn of this.viewerConnections.values()) {
      if (viewerConn.cameraId === cameraId && !viewerConn.isClosed && !viewerConn.isEvicted) {
        count += 1;
      }
    }
    return count;
  }

  private ensureSessionState(sessionId: string, cameraId: string, userId: string): SessionNegotiationState {
    let existing = this.sessionNegotiationState.get(sessionId);
    if (!existing) {
      existing = {
        cameraId,
        userId,
        lastOfferByRole: null,
        offerCount: 0,
        answerCount: 0,
        iceCandidateCount: 0,
        updatedAt: new Date()
      };
      this.sessionNegotiationState.set(sessionId, existing);
    }
    return existing;
  }

  private async runReaperCycle(): Promise<void> {
    if (this.isShuttingDown) return;
    const now = new Date();

    for (const viewerConn of Array.from(this.viewerConnections.values())) {
      if (viewerConn.isClosed || viewerConn.isEvicted) continue;

      if (viewerConn.expiresAt <= now) {
        try {
          await this.expireTimedOutSession(viewerConn.sessionId, viewerConn.cameraId, viewerConn.userId, now);
        } catch (err: any) {
          appLogger.warn('Failed to expire timed-out viewer signaling session', {
            operation: 'CAMERA_SIGNALING_SESSION_EXPIRE',
            cameraId: viewerConn.cameraId,
            metadata: { component: 'camera-signaling', sessionId: viewerConn.sessionId },
            error: err
          });
          this.reportInternalSignalingError('runReaperCycle.expireTimedOutSession', err, {
            cameraId: viewerConn.cameraId,
            sessionId: viewerConn.sessionId
          });
        }

        const camConn = this.cameraConnections.get(viewerConn.cameraId);
        if (camConn && !camConn.isClosed && !camConn.isEvicted) {
          this.sendJsonSafe(camConn.socket, {
            version: CAMERA_SIGNALING_PROTOCOL_VERSION,
            type: 'SESSION_TERMINATE',
            cameraId: viewerConn.cameraId,
            sessionId: viewerConn.sessionId,
            reason: 'Viewing session expired'
          });
        }

        this.sendErrorSafe(viewerConn.socket, 'SESSION_EXPIRED', 'Viewing session has expired.');
        this.closeViewerOnTerminalSession(viewerConn, 'SESSION_EXPIRED');
      }
    }
  }

  private async recordCriticalAuthAuditSafe(
    cameraId: string | null,
    userId: string | null,
    actorType: string,
    reasonCode: string,
    pending: PendingSocketState
  ): Promise<void> {
    try {
      await CameraService.recordAuditEvent({
        cameraInstanceId: cameraId,
        userId,
        actorType,
        eventType: CameraAuditEventType.SIGNALING_AUTH_FAILED,
        action: 'SIGNALING_AUTH_REJECTED',
        result: 'DENIED',
        ipAddress: pending.remoteIp,
        userAgent: pending.userAgent,
        metadata: { reasonCode }
      });
    } catch {
      // Fail-closed: caller already denies & closes socket
    }
  }

  private sendErrorSafe(socket: WebSocket, code: string, message: string): void {
    this.sendJsonSafe(socket, {
      version: CAMERA_SIGNALING_PROTOCOL_VERSION,
      type: 'SIGNALING_ERROR',
      code,
      message
    });
  }

  private recordAuthRejection(category: SignalingAuthRejectionCategory): void {
    this.rejectedAuthAttempts++;
    this.authRejectionsByCategory[category]++;
  }

  private classifyAuthRejectionCode(
    code: string,
    statusCode?: number
  ): SignalingAuthRejectionCategory {
    if (statusCode === 429) return 'RATE_LIMITED';
    switch (code) {
      case 'TLS_REQUIRED':
        return 'TLS_REQUIRED';
      case 'ORIGIN_NOT_ALLOWED':
        return 'ORIGIN_NOT_ALLOWED';
      case 'ORIGIN_REQUIRED':
        return 'ORIGIN_REQUIRED';
      case 'AUTH_TIMEOUT':
        return 'AUTH_TIMEOUT';
      case 'VIEWER_CAPACITY_EXCEEDED':
        return 'VIEWER_CAPACITY_EXCEEDED';
      case 'SESSION_REVOKED':
      case 'REVOKED':
        return 'SESSION_REVOKED';
      case 'SESSION_EXPIRED':
      case 'TOKEN_EXPIRED':
      case 'EXPIRED':
        return 'SESSION_EXPIRED';
      case 'SIGNALING_RATE_LIMITED':
      case 'RATE_LIMITED':
        return 'RATE_LIMITED';
      case 'INVALID_AUTH_PAYLOAD':
      case 'CONFLICTING_CREDENTIALS':
      case 'VIEWING_TOKEN_REQUIRED':
      case 'TOKEN_INVALID':
      case 'SESSION_INVALID':
      case 'TOKEN_EXPIRY_MISSING':
      case 'DEVICE_CREDENTIAL_INVALID':
      case 'INVALID_DEVICE_CREDENTIAL':
      case 'UNAUTHORIZED_DEVICE':
        return 'INVALID_CREDENTIALS';
      default:
        return 'UNAUTHORIZED';
    }
  }

  private recordRejectedMessage(
    kind: 'negotiation' | 'stale' | 'rate_limit' | 'payload_limit' | 'other' = 'other'
  ): void {
    this.rejectedMessages++;
    if (kind === 'negotiation') {
      this.negotiationErrors++;
    } else if (kind === 'stale') {
      this.staleRejections++;
      this.negotiationErrors++;
    } else if (kind === 'rate_limit') {
      this.rateLimitedMessages++;
    } else if (kind === 'payload_limit') {
      this.payloadLimitRejections++;
    }
  }

  private reportInternalSignalingError(
    operation: string,
    error: unknown,
    context: { connectionId?: string; cameraId?: string; sessionId?: string }
  ): void {
    try {
      void errorIngestionService
        .ingest({
          error,
          component: 'CAMERA_SIGNALING',
          severity: 'ERROR',
          errorCode: 'CAMERA_SIGNALING_INTERNAL_ERROR',
          connectionId: context.connectionId,
          sessionId: context.sessionId,
          metadata: {
            operation,
            cameraId: context.cameraId,
            connectionId: context.connectionId
          }
        })
        .catch(() => {});
    } catch {
      // Fail-safe: observability ingestion must never disrupt signaling operations
    }
  }

  private sendJsonSafe(socket: WebSocket, payload: Record<string, any>): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify(payload));
    } catch {
      // Socket send error handled on close/error listener
    }
  }
}

export const defaultCameraSignalingService = new CameraSignalingService();
