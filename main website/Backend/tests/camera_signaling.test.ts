/**
 * ZDEXCLOUD — PHASE 20.5 TEST SUITE
 * CAMERA SIGNALING, SESSION NEGOTIATION & ICE EXCHANGE SPECIFICATION TESTS
 *
 * Execution Policy: WRITE-ONLY. ZERO TESTS EXECUTED.
 * Test Execution Status: NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28
 *
 * Covers all 22 Phase 20.5 security, protocol, isolation, lifecycle, and operational scenarios.
 */

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'mysql://test:test@localhost:3306/zdexcloud_test';

import http from 'node:http';
import crypto from 'node:crypto';
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import Fastify from 'fastify';
import {
  CameraStatus,
  CameraStreamSessionStatus,
  CameraTransportType,
  CameraAuditEventType,
  DeviceStatus,
  UserStatus
} from '@prisma/client';

import { prisma } from '../src/config/database.js';
import { globalErrorHandler } from '../src/middleware/error-handler.js';
import { cameraRoutes } from '../src/routes/camera.js';
import { hashSessionToken } from '../src/utils/crypto.js';
import { EntitlementService } from '../src/services/billing/entitlement_service.js';
import { CameraService } from '../src/services/camera_service.js';
import { GatewayService } from '../src/gateway/gateway_service.js';
import {
  CameraSignalingService,
  CAMERA_SIGNALING_PROTOCOL_VERSION,
  CAMERA_SIGNALING_SDP_MAX_BYTES,
  CAMERA_SIGNALING_ICE_MAX_BYTES
} from '../src/services/camera_signaling_service.js';
import {
  normalizeExactOrigin,
  isTrustedProxyIp
} from '../src/utils/ws_upgrade_security.js';
import { validateEnvironment } from '../src/config/env_validator.js';
import {
  envSchema,
  isCameraSignalingStrictTlsEnv,
  resolveCameraSignalingRequireTls
} from '../src/config/env.js';

interface MockDbState {
  users: Map<string, any>;
  devices: Map<string, any>;
  deviceAuthCredentials: Map<string, any>;
  deviceInstallationClaims: Map<string, any>;
  cameras: Map<string, any>;
  streamSessions: Map<string, any>;
  auditEvents: any[];
  failAuditCreate: boolean;
}

function createInitialMockDb(): MockDbState {
  return {
    users: new Map(),
    devices: new Map(),
    deviceAuthCredentials: new Map(),
    deviceInstallationClaims: new Map(),
    cameras: new Map(),
    streamSessions: new Map(),
    auditEvents: [],
    failAuditCreate: false
  };
}

function createWsClient(url: string, headers: Record<string, string> = {}): {
  ws: WebSocket;
  messages: any[];
  closed: Promise<{ code: number; reason: string }>;
  open: Promise<void>;
  nextMessage: (predicate?: (msg: any) => boolean, timeoutMs?: number) => Promise<any>;
} {
  const ws = new WebSocket(url, { headers });
  const messages: any[] = [];
  const waiters: Array<{ predicate?: (m: any) => boolean; resolve: (m: any) => void; reject: (e: Error) => void }> = [];

  const open = new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', (err) => reject(err));
  });

  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
  });

  ws.on('message', (raw) => {
    const parsed = JSON.parse(raw.toString('utf8'));
    messages.push(parsed);
    const idx = waiters.findIndex((w) => !w.predicate || w.predicate(parsed));
    if (idx !== -1) {
      const [matched] = waiters.splice(idx, 1);
      matched.resolve(parsed);
    }
  });

  const nextMessage = (predicate?: (msg: any) => boolean, timeoutMs = 2000): Promise<any> => {
    const existing = messages.find((m) => !predicate || predicate(m));
    if (existing) {
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Timed out waiting for WebSocket signaling message'));
      }, timeoutMs);
      waiters.push({
        predicate,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        }
      });
    });
  };

  return { ws, messages, closed, open, nextMessage };
}

describe('Phase 20.5 — Camera Signaling, Session Negotiation & ICE Exchange', () => {
  let db: MockDbState;
  let originalPrisma: Record<string, any>;
  let originalEntitlement: any;
  let server: http.Server;
  let signalingService: CameraSignalingService;
  let baseWsUrl: string;
  let openClients: WebSocket[];

  const userA = { id: 'user_a', status: UserStatus.ACTIVE };
  const userB = { id: 'user_b', status: UserStatus.ACTIVE };

  const deviceA = { id: 'dev_a', userId: 'user_a', installationId: 'inst_a_123456', status: DeviceStatus.ONLINE };
  const deviceA2 = { id: 'dev_a2', userId: 'user_a', installationId: 'inst_a2_123456', status: DeviceStatus.ONLINE };
  const deviceB = { id: 'dev_b', userId: 'user_b', installationId: 'inst_b_123456', status: DeviceStatus.ONLINE };

  const rawCredA = 'dst_test_cred_a';
  const rawCredA2 = 'dst_test_cred_a2';
  const rawCredB = 'dst_test_cred_b';

  const cameraA1 = {
    id: 'cam_a1',
    userId: 'user_a',
    deviceId: 'dev_a',
    status: CameraStatus.ONLINE,
    lastSeenAt: new Date(),
    stoppedAt: null,
    metadata: {}
  };
  const cameraA2 = {
    id: 'cam_a2',
    userId: 'user_a',
    deviceId: 'dev_a2',
    status: CameraStatus.ONLINE,
    lastSeenAt: new Date(),
    stoppedAt: null,
    metadata: {}
  };
  const cameraB1 = {
    id: 'cam_b1',
    userId: 'user_b',
    deviceId: 'dev_b',
    status: CameraStatus.ONLINE,
    lastSeenAt: new Date(),
    stoppedAt: null,
    metadata: {}
  };

  const rawViewTokenA1 = 'cvt_view_token_a1_s1';
  const rawViewTokenA1S2 = 'cvt_view_token_a1_s2';
  const rawViewTokenA2 = 'cvt_view_token_a2_s3';

  beforeEach(async () => {
    db = createInitialMockDb();
    openClients = [];

    db.users.set(userA.id, userA);
    db.users.set(userB.id, userB);

    db.devices.set(deviceA.id, deviceA);
    db.devices.set(deviceA2.id, deviceA2);
    db.devices.set(deviceB.id, deviceB);

    db.deviceInstallationClaims.set('inst_a_123456', {
      installationId: 'inst_a_123456',
      userId: 'user_a',
      deviceId: 'dev_a',
      status: 'ACTIVE'
    });
    db.deviceInstallationClaims.set('inst_a2_123456', {
      installationId: 'inst_a2_123456',
      userId: 'user_a',
      deviceId: 'dev_a2',
      status: 'ACTIVE'
    });
    db.deviceInstallationClaims.set('inst_b_123456', {
      installationId: 'inst_b_123456',
      userId: 'user_b',
      deviceId: 'dev_b',
      status: 'ACTIVE'
    });

    db.deviceAuthCredentials.set(hashSessionToken(rawCredA), {
      id: 'cred_a',
      deviceId: 'dev_a',
      userId: 'user_a',
      credentialHash: hashSessionToken(rawCredA),
      revokedAt: null,
      expiresAt: null,
      device: { ...deviceA, user: userA }
    });
    db.deviceAuthCredentials.set(hashSessionToken(rawCredA2), {
      id: 'cred_a2',
      deviceId: 'dev_a2',
      userId: 'user_a',
      credentialHash: hashSessionToken(rawCredA2),
      revokedAt: null,
      expiresAt: null,
      device: { ...deviceA2, user: userA }
    });
    db.deviceAuthCredentials.set(hashSessionToken(rawCredB), {
      id: 'cred_b',
      deviceId: 'dev_b',
      userId: 'user_b',
      credentialHash: hashSessionToken(rawCredB),
      revokedAt: null,
      expiresAt: null,
      device: { ...deviceB, user: userB }
    });

    db.cameras.set(cameraA1.id, { ...cameraA1 });
    db.cameras.set(cameraA2.id, { ...cameraA2 });
    db.cameras.set(cameraB1.id, { ...cameraB1 });

    const futureExpiry = new Date(Date.now() + 15 * 60 * 1000);
    db.streamSessions.set('sess_a1_1', {
      id: 'sess_a1_1',
      cameraInstanceId: 'cam_a1',
      viewerUserId: 'user_a',
      sessionTokenHash: hashSessionToken(rawViewTokenA1),
      status: CameraStreamSessionStatus.INITIATED,
      transportType: CameraTransportType.P2P,
      protocol: 'WEBRTC',
      startedAt: new Date(),
      expiresAt: futureExpiry,
      endedAt: null,
      terminationReason: null
    });
    db.streamSessions.set('sess_a1_2', {
      id: 'sess_a1_2',
      cameraInstanceId: 'cam_a1',
      viewerUserId: 'user_a',
      sessionTokenHash: hashSessionToken(rawViewTokenA1S2),
      status: CameraStreamSessionStatus.INITIATED,
      transportType: CameraTransportType.P2P,
      protocol: 'WEBRTC',
      startedAt: new Date(),
      expiresAt: futureExpiry,
      endedAt: null,
      terminationReason: null
    });
    db.streamSessions.set('sess_a2_3', {
      id: 'sess_a2_3',
      cameraInstanceId: 'cam_a2',
      viewerUserId: 'user_a',
      sessionTokenHash: hashSessionToken(rawViewTokenA2),
      status: CameraStreamSessionStatus.INITIATED,
      transportType: CameraTransportType.P2P,
      protocol: 'WEBRTC',
      startedAt: new Date(),
      expiresAt: futureExpiry,
      endedAt: null,
      terminationReason: null
    });

    // Save originals and attach in-memory Prisma mock
    originalPrisma = {
      $transaction: prisma.$transaction,
      $queryRaw: (prisma as any).$queryRaw,
      deviceAuthCredential: prisma.deviceAuthCredential,
      deviceInstallationClaim: prisma.deviceInstallationClaim,
      cameraInstance: prisma.cameraInstance,
      cameraStreamSession: prisma.cameraStreamSession,
      cameraAccessAuditEvent: prisma.cameraAccessAuditEvent
    };
    originalEntitlement = EntitlementService.resolveUserEntitlements;

    (EntitlementService as any).resolveUserEntitlements = async () => ({
      cameraStreaming: true,
      cameraRecording: false
    });

    const txClient: any = {
      $queryRaw: async () => [],
      cameraInstance: {
        findUnique: async ({ where }: any) => db.cameras.get(where.id) || null,
        update: async ({ where, data }: any) => {
          const cur = db.cameras.get(where.id);
          if (!cur) return null;
          const next = { ...cur, ...data };
          db.cameras.set(where.id, next);
          return next;
        }
      },
      cameraStreamSession: {
        findUnique: async ({ where, include }: any) => {
          let row: any = null;
          if (where.id) row = db.streamSessions.get(where.id) || null;
          if (where.sessionTokenHash) {
            row = Array.from(db.streamSessions.values()).find((s) => s.sessionTokenHash === where.sessionTokenHash) || null;
          }
          if (!row) return null;
          if (include?.cameraInstance) {
            return { ...row, cameraInstance: db.cameras.get(row.cameraInstanceId) || null };
          }
          return { ...row };
        },
        update: async ({ where, data }: any) => {
          const cur = db.streamSessions.get(where.id);
          if (!cur) return null;
          const next = { ...cur, ...data };
          db.streamSessions.set(where.id, next);
          return next;
        },
        updateMany: async ({ where, data }: any) => {
          let count = 0;
          for (const [id, sess] of db.streamSessions.entries()) {
            const matchId = !where.id || sess.id === where.id;
            const matchCamera = !where.cameraInstanceId || sess.cameraInstanceId === where.cameraInstanceId;
            const matchStatus = !where.status || (where.status.in ? where.status.in.includes(sess.status) : sess.status === where.status);
            const matchLte = !where.expiresAt?.lte || (sess.expiresAt && sess.expiresAt <= where.expiresAt.lte);
            if (matchId && matchCamera && matchStatus && matchLte) {
              db.streamSessions.set(id, { ...sess, ...data });
              count++;
            }
          }
          return { count };
        },
        count: async ({ where }: any) => {
          let count = 0;
          for (const sess of db.streamSessions.values()) {
            const matchCam = !where.cameraInstanceId || sess.cameraInstanceId === where.cameraInstanceId;
            const matchStatus = !where.status?.in || where.status.in.includes(sess.status);
            const matchExp = !where.expiresAt?.gt || (sess.expiresAt && sess.expiresAt > where.expiresAt.gt);
            if (matchCam && matchStatus && matchExp) count++;
          }
          return count;
        }
      },
      cameraAccessAuditEvent: {
        create: async ({ data }: any) => {
          if (db.failAuditCreate) {
            throw new Error('Simulated DB audit write failure');
          }
          const rec = { id: `audit_${db.auditEvents.length + 1}`, createdAt: new Date(), ...data };
          db.auditEvents.push(rec);
          return rec;
        }
      }
    };

    (prisma as any).$transaction = async (fn: any) => fn(txClient);
    (prisma as any).deviceAuthCredential = {
      findUnique: async ({ where }: any) => db.deviceAuthCredentials.get(where.credentialHash) || null
    };
    (prisma as any).deviceInstallationClaim = {
      findUnique: async ({ where }: any) => db.deviceInstallationClaims.get(where.installationId) || null
    };
    (prisma as any).cameraInstance = txClient.cameraInstance;
    (prisma as any).cameraStreamSession = txClient.cameraStreamSession;
    (prisma as any).cameraAccessAuditEvent = txClient.cameraAccessAuditEvent;

    server = http.createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    signalingService = new CameraSignalingService({
      path: '/ws/camera-signaling',
      authTimeoutMs: 500,
      rateLimitPerMin: 30,
      maxViewersPerCamera: 2,
      reaperIntervalMs: 50,
      requireSecureTransport: false,
      allowedOrigins: ['https://app.zdexcloud.com', 'http://localhost:3000'],
      nodeEnv: 'test'
    });
    signalingService.attachToHttpServer(server);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    baseWsUrl = `ws://127.0.0.1:${addr.port}/ws/camera-signaling`;
  });

  afterEach(async () => {
    for (const sock of openClients) {
      try {
        sock.terminate();
      } catch {}
    }
    await signalingService.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));

    (prisma as any).$transaction = originalPrisma.$transaction;
    (prisma as any).deviceAuthCredential = originalPrisma.deviceAuthCredential;
    (prisma as any).deviceInstallationClaim = originalPrisma.deviceInstallationClaim;
    (prisma as any).cameraInstance = originalPrisma.cameraInstance;
    (prisma as any).cameraStreamSession = originalPrisma.cameraStreamSession;
    (prisma as any).cameraAccessAuditEvent = originalPrisma.cameraAccessAuditEvent;
    EntitlementService.resolveUserEntitlements = originalEntitlement;
  });

  async function connectAndAuthCamera(cameraId = 'cam_a1', credential = rawCredA, deviceId = 'dev_a') {
    const client = createWsClient(baseWsUrl);
    openClients.push(client.ws);
    await client.open;
    client.ws.send(
      JSON.stringify({
        version: CAMERA_SIGNALING_PROTOCOL_VERSION,
        type: 'SIGNALING_AUTH',
        role: 'CAMERA',
        cameraId,
        deviceId,
        credential
      })
    );
    const ack = await client.nextMessage((m) => m.type === 'SIGNALING_AUTH_OK' || m.type === 'SIGNALING_ERROR');
    return { client, ack };
  }

  async function connectAndAuthViewer(
    cameraId = 'cam_a1',
    viewingToken = rawViewTokenA1,
    sessionId = 'sess_a1_1',
    origin = 'http://localhost:3000'
  ) {
    const client = createWsClient(baseWsUrl, origin ? { origin } : {});
    openClients.push(client.ws);
    await client.open;
    client.ws.send(
      JSON.stringify({
        version: CAMERA_SIGNALING_PROTOCOL_VERSION,
        type: 'SIGNALING_AUTH',
        role: 'VIEWER',
        cameraId,
        sessionId,
        viewingToken
      })
    );
    const ack = await client.nextMessage((m) => m.type === 'SIGNALING_AUTH_OK' || m.type === 'SIGNALING_ERROR');
    return { client, ack };
  }

  it('1. Coexists in isolation with Storage GatewayService without upgrade collision', async () => {
    const sharedServer = http.createServer((_req, res) => res.end('ok'));
    const gateway = new GatewayService(
      { NODE_ENV: 'test', GATEWAY_MAX_CONNECTIONS: 10 },
      { findConnection: async () => null, markConnected: async () => {}, markDisconnected: async () => {} }
    );
    const camSig = new CameraSignalingService({ path: '/ws/camera-signaling' });

    gateway.attachToHttpServer(sharedServer);
    camSig.attachToHttpServer(sharedServer);
    await new Promise<void>((resolve) => sharedServer.listen(0, '127.0.0.1', resolve));
    const port = (sharedServer.address() as { port: number }).port;

    const camSock = createWsClient(`ws://127.0.0.1:${port}/ws/camera-signaling`);
    await camSock.open;
    camSock.ws.send(JSON.stringify({ version: '1.0', type: 'PING' }));
    const sigErr = await camSock.nextMessage();
    assert.equal(sigErr.code, 'AUTHENTICATION_REQUIRED');

    camSock.ws.close();
    await camSig.stop();
    await gateway.stop();
    await new Promise<void>((resolve) => sharedServer.close(() => resolve()));
  });

  it('2. Authenticates Camera via DeviceAuthCredential and audits SIGNALING_AUTHENTICATED', async () => {
    const { ack } = await connectAndAuthCamera();
    assert.equal(ack.type, 'SIGNALING_AUTH_OK');
    assert.equal(ack.role, 'CAMERA');
    assert.equal(ack.cameraId, 'cam_a1');
    assert.ok(
      db.auditEvents.some(
        (e) => e.eventType === CameraAuditEventType.SIGNALING_AUTHENTICATED && e.cameraInstanceId === 'cam_a1'
      )
    );
  });

  it('3. Authenticates Viewer via ephemeral ViewingToken + active entitlement', async () => {
    await connectAndAuthCamera();
    const { ack } = await connectAndAuthViewer();
    assert.equal(ack.type, 'SIGNALING_AUTH_OK');
    assert.equal(ack.role, 'VIEWER');
    assert.equal(ack.sessionId, 'sess_a1_1');
    assert.equal(ack.cameraConnected, true);
  });

  it('4. Rejects unauthenticated pre-auth signaling messages and closes 4401', async () => {
    const c = createWsClient(baseWsUrl);
    openClients.push(c.ws);
    await c.open;
    c.ws.send(
      JSON.stringify({
        version: '1.0',
        type: 'WEBRTC_OFFER',
        cameraId: 'cam_a1',
        sessionId: 'sess_a1_1',
        sdpType: 'offer',
        sdp: 'v=0'
      })
    );
    const err = await c.nextMessage();
    assert.equal(err.code, 'AUTHENTICATION_REQUIRED');
    const closeInfo = await c.closed;
    assert.equal(closeInfo.code, 4401);
  });

  it('5. Times out unauthenticated sockets cleanly after authTimeoutMs', async () => {
    const c = createWsClient(baseWsUrl);
    openClients.push(c.ws);
    await c.open;
    const msg = await c.nextMessage();
    assert.equal(msg.code, 'AUTH_TIMEOUT');
    const closeInfo = await c.closed;
    assert.equal(closeInfo.code, 4401);
  });

  it('6. Rejects revoked device credential and revoked installation claims with SIGNALING_AUTH_FAILED', async () => {
    const cred = db.deviceAuthCredentials.get(hashSessionToken(rawCredA));
    cred.revokedAt = new Date();
    const res1 = await connectAndAuthCamera('cam_a1', rawCredA, 'dev_a');
    assert.equal(res1.ack.type, 'SIGNALING_ERROR');
    assert.equal(res1.ack.code, 'CREDENTIAL_REVOKED');

    cred.revokedAt = null;
    db.deviceInstallationClaims.get('inst_a_123456').status = 'REVOKED';
    const res2 = await connectAndAuthCamera('cam_a1', rawCredA, 'dev_a');
    assert.equal(res2.ack.code, 'DEVICE_REVOKED');
    assert.ok(db.auditEvents.some((e) => e.eventType === CameraAuditEventType.SIGNALING_AUTH_FAILED));
  });

  it('7. Prevents cross-account Camera and device mismatch signaling', async () => {
    const res = await connectAndAuthCamera('cam_a1', rawCredB, 'dev_b');
    assert.equal(res.ack.type, 'SIGNALING_ERROR');
    assert.equal(res.ack.code, 'CAMERA_OWNERSHIP_DENIED');

    const resSameUserWrongDev = await connectAndAuthCamera('cam_a1', rawCredA2, 'dev_a2');
    assert.equal(resSameUserWrongDev.ack.code, 'CAMERA_OWNERSHIP_DENIED');
  });

  it('8. Prevents cross-camera and cross-session pivoting by Viewer after auth', async () => {
    await connectAndAuthCamera();
    const { client: viewer } = await connectAndAuthViewer('cam_a1', rawViewTokenA1, 'sess_a1_1');

    viewer.ws.send(
      JSON.stringify({
        version: '1.0',
        type: 'SESSION_INITIATE',
        cameraId: 'cam_a2',
        sessionId: 'sess_a1_1'
      })
    );
    const err1 = await viewer.nextMessage((m) => m.type === 'SIGNALING_ERROR');
    assert.equal(err1.code, 'CAMERA_MISMATCH');

    viewer.ws.send(
      JSON.stringify({
        version: '1.0',
        type: 'SESSION_INITIATE',
        cameraId: 'cam_a1',
        sessionId: 'sess_a1_2'
      })
    );
    const err2 = await viewer.nextMessage((m) => m.code === 'VIEWER_SESSION_MISMATCH');
    assert.equal(err2.code, 'VIEWER_SESSION_MISMATCH');
  });

  it('9. Rejects expired, revoked, or unentitled viewing tokens fail-closed', async () => {
    db.streamSessions.get('sess_a1_1').expiresAt = new Date(Date.now() - 1000);
    const expired = await connectAndAuthViewer('cam_a1', rawViewTokenA1, 'sess_a1_1');
    assert.equal(expired.ack.code, 'TOKEN_EXPIRED');

    db.streamSessions.get('sess_a1_1').expiresAt = new Date(Date.now() + 60000);
    db.streamSessions.get('sess_a1_1').status = CameraStreamSessionStatus.REVOKED;
    const revoked = await connectAndAuthViewer('cam_a1', rawViewTokenA1, 'sess_a1_1');
    assert.equal(revoked.ack.code, 'SESSION_REVOKED');

    db.streamSessions.get('sess_a1_1').status = CameraStreamSessionStatus.INITIATED;
    EntitlementService.resolveUserEntitlements = async () => ({
      cameraStreaming: false,
      cameraRecording: false
    } as any);
    const unentitled = await connectAndAuthViewer('cam_a1', rawViewTokenA1, 'sess_a1_1');
    assert.equal(unentitled.ack.code, 'STREAMING_NOT_ENTITLED');
  });

  it('10. Coordinates SESSION_INITIATE -> OFFER -> ANSWER -> ICE -> RESTART without auto-setting STREAMING', async () => {
    const { client: camera } = await connectAndAuthCamera();
    const { client: viewer } = await connectAndAuthViewer();

    viewer.ws.send(JSON.stringify({ version: '1.0', type: 'SESSION_INITIATE', cameraId: 'cam_a1', sessionId: 'sess_a1_1' }));
    const camInit = await camera.nextMessage((m) => m.type === 'SESSION_INITIATE');
    assert.equal(camInit.sessionId, 'sess_a1_1');
    assert.equal(db.streamSessions.get('sess_a1_1').status, CameraStreamSessionStatus.NEGOTIATING);
    assert.equal(db.cameras.get('cam_a1').status, CameraStatus.ONLINE);

    camera.ws.send(
      JSON.stringify({
        version: '1.0',
        type: 'WEBRTC_OFFER',
        cameraId: 'cam_a1',
        sessionId: 'sess_a1_1',
        sdpType: 'offer',
        sdp: 'v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\n'
      })
    );
    const viewerOffer = await viewer.nextMessage((m) => m.type === 'WEBRTC_OFFER');
    assert.equal(viewerOffer.sdpType, 'offer');

    viewer.ws.send(
      JSON.stringify({
        version: '1.0',
        type: 'WEBRTC_ANSWER',
        cameraId: 'cam_a1',
        sessionId: 'sess_a1_1',
        sdpType: 'answer',
        sdp: 'v=0\r\no=- 456 2 IN IP4 127.0.0.1\r\n'
      })
    );
    const camAnswer = await camera.nextMessage((m) => m.type === 'WEBRTC_ANSWER');
    assert.equal(camAnswer.sdpType, 'answer');

    viewer.ws.send(
      JSON.stringify({
        version: '1.0',
        type: 'ICE_CANDIDATE',
        cameraId: 'cam_a1',
        sessionId: 'sess_a1_1',
        candidate: 'candidate:1 1 UDP 2122252543 192.0.2.1 54400 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0
      })
    );
    const camIce = await camera.nextMessage((m) => m.type === 'ICE_CANDIDATE');
    assert.ok(camIce.candidate.includes('typ host'));

    viewer.ws.send(
      JSON.stringify({
        version: '1.0',
        type: 'SESSION_RESTART',
        cameraId: 'cam_a1',
        sessionId: 'sess_a1_1',
        reason: 'network_switch'
      })
    );
    const camRestart = await camera.nextMessage((m) => m.type === 'SESSION_RESTART');
    assert.equal(camRestart.reason, 'network_switch');
    assert.equal(db.cameras.get('cam_a1').status, CameraStatus.ONLINE);
  });

  it('11. Enforces role & offer/answer sequencing rules', async () => {
    const { client: camera } = await connectAndAuthCamera();
    const { client: viewer } = await connectAndAuthViewer();

    camera.ws.send(JSON.stringify({ version: '1.0', type: 'SESSION_INITIATE', cameraId: 'cam_a1', sessionId: 'sess_a1_1' }));
    const errRole = await camera.nextMessage((m) => m.type === 'SIGNALING_ERROR');
    assert.equal(errRole.code, 'FORBIDDEN_SIGNALING_ROLE');

    viewer.ws.send(
      JSON.stringify({ version: '1.0', type: 'WEBRTC_ANSWER', cameraId: 'cam_a1', sessionId: 'sess_a1_1', sdpType: 'answer', sdp: 'v=0' })
    );
    const errNoOffer = await viewer.nextMessage((m) => m.type === 'SIGNALING_ERROR');
    assert.equal(errNoOffer.code, 'MISSING_ACTIVE_OFFER');

    camera.ws.send(
      JSON.stringify({ version: '1.0', type: 'WEBRTC_OFFER', cameraId: 'cam_a1', sessionId: 'sess_a1_1', sdpType: 'offer', sdp: 'v=0' })
    );
    await viewer.nextMessage((m) => m.type === 'WEBRTC_OFFER');

    camera.ws.send(
      JSON.stringify({ version: '1.0', type: 'WEBRTC_ANSWER', cameraId: 'cam_a1', sessionId: 'sess_a1_1', sdpType: 'answer', sdp: 'v=0' })
    );
    const errSelfAnswer = await camera.nextMessage((m) => m.type === 'SIGNALING_ERROR');
    assert.equal(errSelfAnswer.code, 'INVALID_SIGNALING_STATE');
  });

  it('12. Rejects unsupported versions, media keys, oversized SDP/ICE, and binary frames', async () => {
    const { client: viewer } = await connectAndAuthViewer();

    viewer.ws.send(JSON.stringify({ version: '2.0', type: 'PING' }));
    const errVer = await viewer.nextMessage((m) => m.code === 'PROTOCOL_VERSION_UNSUPPORTED');
    assert.equal(errVer.code, 'PROTOCOL_VERSION_UNSUPPORTED');

    viewer.ws.send(JSON.stringify({ version: '1.0', type: 'PING', dataBase64: 'AAAA' }));
    const errMedia = await viewer.nextMessage((m) => m.code === 'MEDIA_PAYLOAD_FORBIDDEN');
    assert.equal(errMedia.code, 'MEDIA_PAYLOAD_FORBIDDEN');

    viewer.ws.send(
      JSON.stringify({
        version: '1.0',
        type: 'WEBRTC_OFFER',
        cameraId: 'cam_a1',
        sessionId: 'sess_a1_1',
        sdpType: 'offer',
        sdp: 'x'.repeat(CAMERA_SIGNALING_SDP_MAX_BYTES + 1)
      })
    );
    const errSdp = await viewer.nextMessage((m) => m.code === 'INVALID_SDP_OFFER');
    assert.equal(errSdp.code, 'INVALID_SDP_OFFER');

    viewer.ws.send(
      JSON.stringify({
        version: '1.0',
        type: 'ICE_CANDIDATE',
        cameraId: 'cam_a1',
        sessionId: 'sess_a1_1',
        candidate: 'y'.repeat(CAMERA_SIGNALING_ICE_MAX_BYTES + 1)
      })
    );
    const errIce = await viewer.nextMessage((m) => m.code === 'INVALID_ICE_CANDIDATE');
    assert.equal(errIce.code, 'INVALID_ICE_CANDIDATE');

    viewer.ws.send(Buffer.from([0xde, 0xad, 0xbe, 0xef]), { binary: true });
    const errBin = await viewer.nextMessage((m) => m.code === 'BINARY_FRAMES_NOT_SUPPORTED');
    assert.equal(errBin.code, 'BINARY_FRAMES_NOT_SUPPORTED');
  });

  it('13. Isolates multiple concurrent viewers on the same camera and enforces viewer cap', async () => {
    const { client: camera } = await connectAndAuthCamera('cam_a1', rawCredA, 'dev_a');
    const { client: v1 } = await connectAndAuthViewer('cam_a1', rawViewTokenA1, 'sess_a1_1');
    const { client: v2 } = await connectAndAuthViewer('cam_a1', rawViewTokenA1S2, 'sess_a1_2');

    camera.ws.send(
      JSON.stringify({ version: '1.0', type: 'WEBRTC_OFFER', cameraId: 'cam_a1', sessionId: 'sess_a1_2', sdpType: 'offer', sdp: 'v=0-s2' })
    );
    const v2Offer = await v2.nextMessage((m) => m.type === 'WEBRTC_OFFER');
    assert.equal(v2Offer.sessionId, 'sess_a1_2');
    assert.equal(v1.messages.some((m) => m.type === 'WEBRTC_OFFER'), false);

    // 3rd viewer exceeds configured maxViewersPerCamera=2
    const rawViewToken3 = 'cvt_view_token_a1_s3_cap';
    db.streamSessions.set('sess_a1_cap', {
      id: 'sess_a1_cap',
      cameraInstanceId: 'cam_a1',
      viewerUserId: 'user_a',
      sessionTokenHash: hashSessionToken(rawViewToken3),
      status: CameraStreamSessionStatus.INITIATED,
      transportType: CameraTransportType.P2P,
      protocol: 'WEBRTC',
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 60000),
      endedAt: null,
      terminationReason: null
    });
    const capRes = await connectAndAuthViewer('cam_a1', rawViewToken3, 'sess_a1_cap');
    assert.equal(capRes.ack.code, 'VIEWER_CAPACITY_EXCEEDED');
  });

  it('14. Isolates multiple cameras owned by the same user account', async () => {
    await connectAndAuthCamera('cam_a1', rawCredA, 'dev_a');
    const { client: cam2 } = await connectAndAuthCamera('cam_a2', rawCredA2, 'dev_a2');
    const { client: v1 } = await connectAndAuthViewer('cam_a1', rawViewTokenA1, 'sess_a1_1');

    v1.ws.send(JSON.stringify({ version: '1.0', type: 'SESSION_INITIATE', cameraId: 'cam_a1', sessionId: 'sess_a1_1' }));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(cam2.messages.some((m) => m.type === 'SESSION_INITIATE'), false);
  });

  it('15. Reconnect evicts stale socket via monotonic epoch and blocks delayed stale frames', async () => {
    const { client: oldCam } = await connectAndAuthCamera();
    const { client: newCam, ack: newAck } = await connectAndAuthCamera();
    assert.equal(newAck.type, 'SIGNALING_AUTH_OK');
    assert.equal(newAck.epoch, 2);

    const evictedNotice = await oldCam.nextMessage((m) => m.type === 'SIGNALING_DISCONNECTED');
    assert.equal(evictedNotice.code, 'SESSION_SUPERSEDED');
    await oldCam.closed;

    assert.equal(signalingService.getCameraSignalingState('cam_a1').cameraConnected, true);
    newCam.ws.send(JSON.stringify({ version: '1.0', type: 'PING' }));
    const pong = await newCam.nextMessage((m) => m.type === 'PONG');
    assert.equal(pong.type, 'PONG');
  });

  it('16. Temporary viewer disconnect notifies camera without marking physical Camera OFFLINE', async () => {
    const { client: camera } = await connectAndAuthCamera();
    const { client: viewer } = await connectAndAuthViewer();

    viewer.ws.close();
    const notice = await camera.nextMessage((m) => m.type === 'PEER_DISCONNECTED');
    assert.equal(notice.role, 'VIEWER');
    assert.equal(notice.sessionId, 'sess_a1_1');
    assert.equal(notice.temporary, true);
    assert.equal(db.cameras.get('cam_a1').status, CameraStatus.ONLINE);
  });

  it('17. SESSION_TERMINATE and NEGOTIATION_FAILED finalize session, reconcile STREAMING->ONLINE, keep camera connected', async () => {
    db.cameras.get('cam_a1').status = CameraStatus.STREAMING;
    const { client: camera } = await connectAndAuthCamera();
    const { client: viewer } = await connectAndAuthViewer();

    viewer.ws.send(
      JSON.stringify({ version: '1.0', type: 'SESSION_TERMINATE', cameraId: 'cam_a1', sessionId: 'sess_a1_1', reason: 'user_closed' })
    );
    const camTerm = await camera.nextMessage((m) => m.type === 'SESSION_TERMINATE');
    assert.equal(camTerm.sessionId, 'sess_a1_1');
    assert.equal(db.streamSessions.get('sess_a1_1').status, CameraStreamSessionStatus.ENDED);
    assert.equal(db.cameras.get('cam_a1').status, CameraStatus.ONLINE);
    assert.ok(db.auditEvents.some((e) => e.eventType === CameraAuditEventType.VIEWING_SESSION_ENDED));
    await viewer.closed;

    // Second viewer failing negotiation marks FAILED safely
    const { client: viewer2 } = await connectAndAuthViewer('cam_a1', rawViewTokenA1S2, 'sess_a1_2');
    viewer2.ws.send(
      JSON.stringify({ version: '1.0', type: 'NEGOTIATION_FAILED', cameraId: 'cam_a1', sessionId: 'sess_a1_2', errorCode: 'ICE_FAILED' })
    );
    await camera.nextMessage((m) => m.type === 'NEGOTIATION_FAILED');
    assert.equal(db.streamSessions.get('sess_a1_2').status, CameraStreamSessionStatus.FAILED);
  });

  it('18. REST revokeViewingSession severs live viewer socket immediately and notifies camera', async () => {
    const { client: camera } = await connectAndAuthCamera();
    const { client: viewer } = await connectAndAuthViewer();

    signalingService.notifySessionRevoked('sess_a1_1', 'REVOKED_VIA_API');
    const vTerm = await viewer.nextMessage((m) => m.type === 'SESSION_TERMINATE');
    assert.equal(vTerm.revoked, true);
    const cTerm = await camera.nextMessage((m) => m.type === 'SESSION_TERMINATE');
    assert.equal(cTerm.revoked, true);
    const closeInfo = await viewer.closed;
    assert.equal(closeInfo.code, 4403);
  });

  it('19. Periodic reaper times out expired live viewer sessions and downgrades STREAMING -> ONLINE', async () => {
    db.cameras.get('cam_a1').status = CameraStatus.STREAMING;
    const { client: camera } = await connectAndAuthCamera();
    const soonExpiring = 'cvt_view_token_soon_exp';
    db.streamSessions.set('sess_exp', {
      id: 'sess_exp',
      cameraInstanceId: 'cam_a1',
      viewerUserId: 'user_a',
      sessionTokenHash: hashSessionToken(soonExpiring),
      status: CameraStreamSessionStatus.NEGOTIATING,
      transportType: CameraTransportType.P2P,
      protocol: 'WEBRTC',
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 80),
      endedAt: null,
      terminationReason: null
    });

    const { client: viewer } = await connectAndAuthViewer('cam_a1', soonExpiring, 'sess_exp');
    const expMsg = await viewer.nextMessage((m) => m.code === 'SESSION_EXPIRED');
    assert.equal(expMsg.code, 'SESSION_EXPIRED');
    const camNotice = await camera.nextMessage((m) => m.type === 'SESSION_TERMINATE' && m.sessionId === 'sess_exp');
    assert.equal(camNotice.sessionId, 'sess_exp');
    assert.equal(db.streamSessions.get('sess_exp').status, CameraStreamSessionStatus.TIMED_OUT);
    assert.equal(db.cameras.get('cam_a1').status, CameraStatus.ONLINE);
  });

  it('20. Throttles burst signaling traffic with SIGNALING_RATE_LIMITED', async () => {
    const { client: viewer } = await connectAndAuthViewer();
    for (let i = 0; i < 31; i++) {
      viewer.ws.send(JSON.stringify({ version: '1.0', type: 'PING' }));
    }
    const rateErr = await viewer.nextMessage((m) => m.code === 'SIGNALING_RATE_LIMITED');
    assert.equal(rateErr.code, 'SIGNALING_RATE_LIMITED');
  });

  it('21. Fails closed when critical SIGNALING_AUTH_FAILED audit persistence fails', async () => {
    db.failAuditCreate = true;
    const { ack } = await connectAndAuthCamera('cam_a1', rawCredB, 'dev_b');
    assert.equal(ack.code, 'AUDIT_PERSISTENCE_FAILED');
  });

  it('22. Never leaks raw SDP, ICE candidates, tokens, or credentials in audits or REST state', async () => {
    await connectAndAuthCamera();
    const { client: viewer } = await connectAndAuthViewer();

    const sdpSecret = 'v=0\r\no=- 99999 2 IN IP4 198.51.100.42\r\na=fingerprint:sha-256 SECRET_SDP_FINGERPRINT';
    viewer.ws.send(JSON.stringify({ version: '1.0', type: 'SESSION_INITIATE', cameraId: 'cam_a1', sessionId: 'sess_a1_1' }));
    viewer.ws.send(
      JSON.stringify({
        version: '1.0',
        type: 'WEBRTC_OFFER',
        cameraId: 'cam_a1',
        sessionId: 'sess_a1_1',
        sdpType: 'offer',
        sdp: sdpSecret
      })
    );
    await new Promise((r) => setTimeout(r, 40));

    const serializedAudits = JSON.stringify(db.auditEvents);
    assert.equal(serializedAudits.includes(rawCredA), false);
    assert.equal(serializedAudits.includes(rawViewTokenA1), false);
    assert.equal(serializedAudits.includes('SECRET_SDP_FINGERPRINT'), false);

    // Check REST /cameras/:cameraId/signaling returns non-secret metadata only
    const app = Fastify();
    app.setErrorHandler(globalErrorHandler);
    const { CustomerAuthService } = await import('../src/services/customer-auth-service.js');
    const origResolve = CustomerAuthService.resolveSession;
    (CustomerAuthService as any).resolveSession = async () => ({ user: userA, session: { id: 'cs_1' } });
    await app.register(cameraRoutes, { prefix: '/api/v1' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/cameras/cam_a1/signaling',
      headers: { cookie: 'zdex_session=mock' }
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.data.signaling.cameraId, 'cam_a1');
    assert.equal(body.data.signaling.signalingPath, '/ws/camera-signaling');

    CustomerAuthService.resolveSession = origResolve;
    await app.close();
  });

  // =========================================================================
  // PHASE 20.5.1 — CORRECTIVE SECURITY, CONCURRENCY & GATEWAY ISOLATION TESTS
  // Test Execution Status: NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28
  // =========================================================================

  it('23. Origin: accepts trusted normalized browser Origin and rejects untrusted/suffix/wildcard Origins', async () => {
    const trusted = await connectAndAuthViewer('cam_a1', rawViewTokenA1, 'sess_a1_1', 'https://app.zdexcloud.com');
    assert.equal(trusted.ack.type, 'SIGNALING_AUTH_OK');
    trusted.client.ws.close();

    const evilOrigins = [
      'https://evil.example.com',
      'https://zdexcloud.com.evil.com',
      'https://evilapp.zdexcloud.com',
      'https://app.zdexcloud.com/extra-path',
      'https://user@app.zdexcloud.com',
      'https://*.zdexcloud.com',
      'null',
      'not-a-valid-url',
      'file://localhost'
    ];

    for (const badOrigin of evilOrigins) {
      const rejectionStatus = await new Promise<number>((resolve, reject) => {
        const sock = new WebSocket(baseWsUrl, { headers: { origin: badOrigin } });
        sock.once('unexpected-response', (_req, res) => {
          resolve(res.statusCode || 0);
          sock.terminate();
        });
        sock.once('open', () => reject(new Error(`Untrusted origin unexpectedly accepted: ${badOrigin}`)));
        sock.once('error', () => {
          // Unexpected-response fires before error on HTTP rejection
        });
      });
      assert.equal(rejectionStatus, 403);
    }

    assert.equal(normalizeExactOrigin('https://app.zdexcloud.com/'), null);
    assert.equal(normalizeExactOrigin('https://*.zdexcloud.com'), null);
    assert.equal(normalizeExactOrigin(''), null);
    assert.equal(normalizeExactOrigin('https://app.zdexcloud.com'), 'https://app.zdexcloud.com');
  });

  it('24. Origin: rejects missing browser Origin on handshake (browser headers) and at VIEWER auth without breaking native Android Camera', async () => {
    // A. Missing Origin with ?role=viewer or Cookie/Sec-Fetch browser hints is rejected at handshake (403)
    const handshakeStatus = await new Promise<number>((resolve) => {
      const sock = new WebSocket(`${baseWsUrl}?role=viewer`, {
        headers: { 'sec-fetch-mode': 'websocket' }
      });
      sock.once('unexpected-response', (_req, res) => {
        resolve(res.statusCode || 0);
        sock.terminate();
      });
    });
    assert.equal(handshakeStatus, 403);

    // B. Client connecting cleanly without Origin cannot spoof VIEWER role
    const viewerAttempt = createWsClient(baseWsUrl);
    openClients.push(viewerAttempt.ws);
    await viewerAttempt.open;
    viewerAttempt.ws.send(
      JSON.stringify({
        version: '1.0',
        type: 'SIGNALING_AUTH',
        role: 'VIEWER',
        cameraId: 'cam_a1',
        sessionId: 'sess_a1_1',
        viewingToken: rawViewTokenA1
      })
    );
    const viewerErr = await viewerAttempt.nextMessage((m) => m.type === 'SIGNALING_ERROR');
    assert.equal(viewerErr.code, 'ORIGIN_REQUIRED');

    // C. Native Android Camera without Origin succeeds with valid DeviceAuthCredential
    const nativeCam = await connectAndAuthCamera('cam_a1', rawCredA, 'dev_a');
    assert.equal(nativeCam.ack.type, 'SIGNALING_AUTH_OK');
    // Still rejects invalid credential without Origin (no auth weakening)
    const badCam = await connectAndAuthCamera('cam_a1', 'dst_invalid_cred', 'dev_a');
    assert.equal(badCam.ack.type, 'SIGNALING_ERROR');
  });

  it('25. Transport: enforces wss:// behind trusted proxies ONLY and blocks spoofed X-Forwarded-Proto from untrusted IPs', async () => {
    const tlsHttpServer = http.createServer((_req, res) => res.end('ok'));

    // Case 1: Client IP 127.0.0.1 is NOT trusted when trustProxy = '10.0.0.1'
    const strictUntrustedProxySvc = new CameraSignalingService({
      path: '/ws/camera-signaling',
      requireSecureTransport: true,
      trustProxy: '10.0.0.1',
      allowedOrigins: ['https://app.zdexcloud.com'],
      nodeEnv: 'production'
    });
    strictUntrustedProxySvc.attachToHttpServer(tlsHttpServer);
    await new Promise<void>((resolve) => tlsHttpServer.listen(0, '127.0.0.1', resolve));
    const port1 = (tlsHttpServer.address() as { port: number }).port;

    const spoofStatus = await new Promise<number>((resolve) => {
      const sock = new WebSocket(`ws://127.0.0.1:${port1}/ws/camera-signaling`, {
        headers: { origin: 'https://app.zdexcloud.com', 'x-forwarded-proto': 'https' }
      });
      sock.once('unexpected-response', (_req, res) => {
        resolve(res.statusCode || 0);
        sock.terminate();
      });
    });
    assert.equal(spoofStatus, 403);
    await strictUntrustedProxySvc.stop();

    // Case 2: Trusted proxy ('loopback') with X-Forwarded-Proto: https succeeds; mixed 'http, https' rejected
    const trustedProxySvc = new CameraSignalingService({
      path: '/ws/camera-signaling',
      requireSecureTransport: true,
      trustProxy: 'loopback',
      allowedOrigins: ['https://app.zdexcloud.com'],
      nodeEnv: 'production'
    });
    trustedProxySvc.attachToHttpServer(tlsHttpServer);

    const mixedProtoStatus = await new Promise<number>((resolve) => {
      const sock = new WebSocket(`ws://127.0.0.1:${port1}/ws/camera-signaling`, {
        headers: { origin: 'https://app.zdexcloud.com', 'x-forwarded-proto': 'http, https' }
      });
      sock.once('unexpected-response', (_req, res) => {
        resolve(res.statusCode || 0);
        sock.terminate();
      });
    });
    assert.equal(mixedProtoStatus, 403);

    const trustedWs = createWsClient(`ws://127.0.0.1:${port1}/ws/camera-signaling`, {
      origin: 'https://app.zdexcloud.com',
      'x-forwarded-proto': 'https'
    });
    await trustedWs.open;
    trustedWs.ws.close();

    assert.equal(isTrustedProxyIp('::ffff:127.0.0.1', 'loopback'), true);
    assert.equal(isTrustedProxyIp('203.0.113.10', 'loopback,uniquelocal'), false);

    // Production env validator blocks insecure CAMERA_SIGNALING_REQUIRE_TLS=false or wildcard signaling origins
    const prodBad = validateEnvironment({
      NODE_ENV: 'production',
      DATABASE_URL: 'mysql://u:p@db:3306/app',
      CAMERA_SIGNALING_REQUIRE_TLS: false,
      CAMERA_SIGNALING_ALLOWED_ORIGINS: 'https://*.zdexcloud.com'
    });
    assert.equal(prodBad.valid, false);

    await trustedProxySvc.stop();
    await new Promise<void>((resolve) => tlsHttpServer.close(() => resolve()));
  });

  it('26. Viewer Concurrency: concurrent simultaneous handshakes cannot race past maxViewersPerCamera', async () => {
    const rawToken3 = 'cvt_race_token_3';
    const rawToken4 = 'cvt_race_token_4';
    for (const [sid, tok] of [
      ['sess_race_3', rawToken3],
      ['sess_race_4', rawToken4]
    ] as const) {
      db.streamSessions.set(sid, {
        id: sid,
        cameraInstanceId: 'cam_a1',
        viewerUserId: 'user_a',
        sessionTokenHash: hashSessionToken(tok),
        status: CameraStreamSessionStatus.INITIATED,
        transportType: CameraTransportType.P2P,
        protocol: 'WEBRTC',
        startedAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
        endedAt: null,
        terminationReason: null
      });
    }

    // Introduce artificial async delay in validateViewingToken + audit create to maximize TOCTOU race overlap
    const origAuditCreate = (prisma as any).cameraAccessAuditEvent.create;
    (prisma as any).cameraAccessAuditEvent.create = async (args: any) => {
      await new Promise((r) => setTimeout(r, 25));
      return origAuditCreate(args);
    };

    const attempts = await Promise.all([
      connectAndAuthViewer('cam_a1', rawViewTokenA1, 'sess_a1_1'),
      connectAndAuthViewer('cam_a1', rawViewTokenA1S2, 'sess_a1_2'),
      connectAndAuthViewer('cam_a1', rawToken3, 'sess_race_3'),
      connectAndAuthViewer('cam_a1', rawToken4, 'sess_race_4')
    ]);

    const accepted = attempts.filter((r) => r.ack.type === 'SIGNALING_AUTH_OK');
    const rejected = attempts.filter((r) => r.ack.type === 'SIGNALING_ERROR' && r.ack.code === 'VIEWER_CAPACITY_EXCEEDED');
    assert.equal(accepted.length, 2);
    assert.equal(rejected.length, 2);
    assert.equal(signalingService.getCameraReservedSlotCount('cam_a1'), 2);
    assert.equal(signalingService.getCameraSignalingState('cam_a1').activeViewerConnections, 2);
  });

  it('27. Viewer Concurrency: failed auth, failed handshake, unauthenticated sockets, and socket close manage reservations cleanly', async () => {
    // A. Unauthenticated socket does NOT count toward viewer capacity
    const pendingSock = createWsClient(baseWsUrl, { origin: 'http://localhost:3000' });
    openClients.push(pendingSock.ws);
    await pendingSock.open;
    assert.equal(signalingService.getCameraReservedSlotCount('cam_a1'), 0);

    // B. Failed auth releases reservation cleanly (does not exhaust limit across repeated failed attempts)
    const badAuth = await connectAndAuthViewer('cam_a1', 'cvt_nonexistent_token', 'sess_missing');
    assert.equal(badAuth.ack.type, 'SIGNALING_ERROR');
    assert.equal(signalingService.getCameraReservedSlotCount('cam_a1'), 0);

    // C. Fill capacity (2) on cam_a1, close one socket, verify slot frees for next session; cam_a2 remains independent
    const v1 = await connectAndAuthViewer('cam_a1', rawViewTokenA1, 'sess_a1_1');
    const v2 = await connectAndAuthViewer('cam_a1', rawViewTokenA1S2, 'sess_a1_2');
    const cam2Viewer = await connectAndAuthViewer('cam_a2', rawViewTokenA2, 'sess_a2_3');
    assert.equal(v1.ack.type, 'SIGNALING_AUTH_OK');
    assert.equal(v2.ack.type, 'SIGNALING_AUTH_OK');
    assert.equal(cam2Viewer.ack.type, 'SIGNALING_AUTH_OK');
    assert.equal(signalingService.getCameraReservedSlotCount('cam_a1'), 2);
    assert.equal(signalingService.getCameraReservedSlotCount('cam_a2'), 1);

    v1.client.ws.close();
    await v1.client.closed;
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(signalingService.getCameraReservedSlotCount('cam_a1'), 1);

    // Reconnection of already-active sessionId does NOT double-count, and old socket cleanup preserves replacement slot
    const v2Reconnect = await connectAndAuthViewer('cam_a1', rawViewTokenA1S2, 'sess_a1_2');
    assert.equal(v2Reconnect.ack.type, 'SIGNALING_AUTH_OK');
    await v2.client.closed;
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(signalingService.getCameraReservedSlotCount('cam_a1'), 1);
    assert.equal(signalingService.getCameraSignalingState('cam_a1').activeViewerConnections, 1);
  });

  it('28. Gateway Isolation: unknown paths rejected 404, independent stop/restart, zero duplicate listeners', async () => {
    const sharedServer = http.createServer((_req, res) => res.end('ok'));
    const gateway = new GatewayService(
      { NODE_ENV: 'test', GATEWAY_MAX_CONNECTIONS: 10 },
      { findConnection: async () => null, markConnected: async () => {}, markDisconnected: async () => {} }
    );
    const camSig = new CameraSignalingService({
      path: '/ws/camera-signaling',
      requireSecureTransport: false,
      allowedOrigins: ['http://localhost:3000'],
      nodeEnv: 'test'
    });

    gateway.attachToHttpServer(sharedServer);
    camSig.attachToHttpServer(sharedServer);
    // Repeated attach does not duplicate listeners
    gateway.attachToHttpServer(sharedServer);
    camSig.attachToHttpServer(sharedServer);
    assert.equal(sharedServer.listenerCount('upgrade'), 2);

    await new Promise<void>((resolve) => sharedServer.listen(0, '127.0.0.1', resolve));
    const port = (sharedServer.address() as { port: number }).port;

    // Unknown path rejected with 404
    const unknownStatus = await new Promise<number>((resolve) => {
      const sock = new WebSocket(`ws://127.0.0.1:${port}/unknown/ws`);
      sock.once('unexpected-response', (_req, res) => {
        resolve(res.statusCode || 0);
        sock.terminate();
      });
    });
    assert.equal(unknownStatus, 404);

    // Storage root & /tunnel both greet HELLO
    const storageSock = createWsClient(`ws://127.0.0.1:${port}/tunnel`);
    await storageSock.open;
    const helloMsg = await storageSock.nextMessage((m) => m.type === 'HELLO');
    assert.equal(helloMsg.type, 'HELLO');
    storageSock.ws.close();

    // Stop Camera Signaling -> shared HTTP server stays open and Storage Gateway still serves HELLO
    await camSig.stop();
    assert.equal(sharedServer.listening, true);
    assert.equal(sharedServer.listenerCount('upgrade'), 1);

    const storageAfterCamStop = createWsClient(`ws://127.0.0.1:${port}/`);
    await storageAfterCamStop.open;
    const hello2 = await storageAfterCamStop.nextMessage((m) => m.type === 'HELLO');
    assert.equal(hello2.type, 'HELLO');
    storageAfterCamStop.ws.close();

    // Stopped /ws/camera-signaling is NOT intercepted by Storage Gateway (returns 404)
    const stoppedCamStatus = await new Promise<number>((resolve) => {
      const sock = new WebSocket(`ws://127.0.0.1:${port}/ws/camera-signaling`);
      sock.once('unexpected-response', (_req, res) => {
        resolve(res.statusCode || 0);
        sock.terminate();
      });
    });
    assert.equal(stoppedCamStatus, 404);

    // Re-attach Camera Signaling, stop Storage Gateway -> shared HTTP server stays open and Camera Signaling stays operational
    camSig.attachToHttpServer(sharedServer);
    assert.equal(sharedServer.listenerCount('upgrade'), 2);
    await gateway.stop();
    assert.equal(sharedServer.listening, true);
    assert.equal(sharedServer.listenerCount('upgrade'), 1);

    const camAfterGwStop = createWsClient(`ws://127.0.0.1:${port}/ws/camera-signaling`, {
      origin: 'http://localhost:3000'
    });
    await camAfterGwStop.open;
    camAfterGwStop.ws.send(JSON.stringify({ version: '1.0', type: 'PING' }));
    const pingErr = await camAfterGwStop.nextMessage((m) => m.code === 'AUTHENTICATION_REQUIRED');
    assert.equal(pingErr.code, 'AUTHENTICATION_REQUIRED');
    camAfterGwStop.ws.close();

    await camSig.stop();
    assert.equal(sharedServer.listenerCount('upgrade'), 0);
    assert.equal(sharedServer.listening, true);
    await new Promise<void>((resolve) => sharedServer.close(() => resolve()));
  });

  it('29. Epoch & Revocation Isolation: stale viewer close preserves replacement slot and revoking session 1 preserves session 2', async () => {
    const { client: camera } = await connectAndAuthCamera('cam_a1', rawCredA, 'dev_a');
    const { client: oldViewer } = await connectAndAuthViewer('cam_a1', rawViewTokenA1, 'sess_a1_1');
    const { client: v2 } = await connectAndAuthViewer('cam_a1', rawViewTokenA1S2, 'sess_a1_2');
    const { client: replacementViewer, ack: repAck } = await connectAndAuthViewer('cam_a1', rawViewTokenA1, 'sess_a1_1');
    assert.equal(repAck.epoch, 2);

    await oldViewer.closed;
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(signalingService.getCameraReservedSlotCount('cam_a1'), 2);

    // Revoke sess_a1_1 ONLY -> sess_a1_2 and camera remain active
    signalingService.notifySessionRevoked('sess_a1_1', 'REVOKED_TARGET');
    await replacementViewer.closed;
    assert.equal(signalingService.getCameraReservedSlotCount('cam_a1'), 1);
    assert.equal(signalingService.getCameraSignalingState('cam_a1').cameraConnected, true);

    v2.ws.send(JSON.stringify({ version: '1.0', type: 'PING' }));
    const v2Pong = await v2.nextMessage((m) => m.type === 'PONG');
    assert.equal(v2Pong.sessionId, 'sess_a1_2');
    camera.ws.close();
  });

  it('30. Phase 20.5.1.1: enforces CAMERA_SIGNALING_REQUIRE_TLS in staging and production while preserving dev/test behavior', async () => {
    const prevCsrfSecret = process.env.ZDEX_CSRF_SECRET;
    process.env.ZDEX_CSRF_SECRET = 'super_secure_production_csrf_hmac_secret_32_bytes_long';

    try {
      const baseProdOverrides = {
        DATABASE_URL: 'mysql://prod_user:prod_pass@db.production.internal:3306/zdexcloud_prod',
        CORS_ORIGIN: 'https://zdexcloud.com,https://app.zdexcloud.com',
        API_BASE_URL: 'https://api.zdexcloud.com/api/v1',
        REMOTENODE_BASE_DOMAIN: 'zdexcloud.com',
        REMOTENODE_GATEWAY_DOMAIN: 'gateway.zdexcloud.com',
        TRUST_PROXY: 'loopback,linklocal,uniquelocal',
        LOG_LEVEL: 'info' as const
      };

      // 1. Production rejects CAMERA_SIGNALING_REQUIRE_TLS=false (both validateEnvironment and envSchema)
      const prodValidatorFalse = validateEnvironment({
        ...baseProdOverrides,
        NODE_ENV: 'production',
        CAMERA_SIGNALING_REQUIRE_TLS: false
      });
      assert.equal(prodValidatorFalse.valid, false);
      assert.ok(
        prodValidatorFalse.errors.some((e) =>
          e.includes('Disabling CAMERA_SIGNALING_REQUIRE_TLS in production is forbidden')
        )
      );

      const prodSchemaFalse = envSchema.safeParse({
        NODE_ENV: 'production',
        DATABASE_URL: baseProdOverrides.DATABASE_URL,
        CAMERA_SIGNALING_REQUIRE_TLS: 'false'
      });
      assert.equal(prodSchemaFalse.success, false);

      // 2. Staging rejects CAMERA_SIGNALING_REQUIRE_TLS=false (both validateEnvironment and envSchema)
      const stagingValidatorFalse = validateEnvironment({
        ...baseProdOverrides,
        NODE_ENV: 'staging',
        CAMERA_SIGNALING_REQUIRE_TLS: false
      });
      assert.equal(stagingValidatorFalse.valid, false);
      assert.ok(
        stagingValidatorFalse.errors.some((e) =>
          e.includes('Disabling CAMERA_SIGNALING_REQUIRE_TLS in staging is forbidden')
        )
      );

      const stagingStringFalse = validateEnvironment({
        ...baseProdOverrides,
        NODE_ENV: 'staging',
        CAMERA_SIGNALING_REQUIRE_TLS: 'false'
      });
      assert.equal(stagingStringFalse.valid, false);

      const stagingSchemaFalse = envSchema.safeParse({
        NODE_ENV: 'staging',
        DATABASE_URL: baseProdOverrides.DATABASE_URL,
        CAMERA_SIGNALING_REQUIRE_TLS: 'false'
      });
      assert.equal(stagingSchemaFalse.success, false);

      // 3. Production and staging default to TLS required when CAMERA_SIGNALING_REQUIRE_TLS is omitted
      const prodValidatorDefault = validateEnvironment({
        ...baseProdOverrides,
        NODE_ENV: 'production',
        CAMERA_SIGNALING_REQUIRE_TLS: undefined
      });
      assert.equal(prodValidatorDefault.valid, true);

      const stagingValidatorDefault = validateEnvironment({
        ...baseProdOverrides,
        NODE_ENV: 'staging',
        CAMERA_SIGNALING_REQUIRE_TLS: undefined
      });
      assert.equal(stagingValidatorDefault.valid, true);

      const prodSchemaDefault = envSchema.safeParse({
        NODE_ENV: 'production',
        DATABASE_URL: baseProdOverrides.DATABASE_URL
      });
      assert.equal(prodSchemaDefault.success, true);

      const stagingSchemaDefault = envSchema.safeParse({
        NODE_ENV: 'staging',
        DATABASE_URL: baseProdOverrides.DATABASE_URL
      });
      assert.equal(stagingSchemaDefault.success, true);

      assert.equal(isCameraSignalingStrictTlsEnv('production'), true);
      assert.equal(isCameraSignalingStrictTlsEnv('staging'), true);
      assert.equal(isCameraSignalingStrictTlsEnv('development'), false);
      assert.equal(isCameraSignalingStrictTlsEnv('test'), false);

      assert.equal(resolveCameraSignalingRequireTls('production', undefined), true);
      assert.equal(resolveCameraSignalingRequireTls('staging', undefined), true);
      assert.equal(resolveCameraSignalingRequireTls('staging', false), true);

      // 4. Development and test retain existing defaults and allow explicit false
      assert.equal(resolveCameraSignalingRequireTls('development', undefined), false);
      assert.equal(resolveCameraSignalingRequireTls('test', undefined), false);
      assert.equal(resolveCameraSignalingRequireTls('development', false), false);
      assert.equal(resolveCameraSignalingRequireTls('test', false), false);

      for (const devEnv of ['development', 'test'] as const) {
        const devDefault = validateEnvironment({
          NODE_ENV: devEnv,
          DATABASE_URL: 'mysql://dev:dev@localhost:3306/zdexcloud_dev',
          CAMERA_SIGNALING_REQUIRE_TLS: undefined
        });
        assert.equal(devDefault.valid, true);

        const devFalse = validateEnvironment({
          NODE_ENV: devEnv,
          DATABASE_URL: 'mysql://dev:dev@localhost:3306/zdexcloud_dev',
          CAMERA_SIGNALING_REQUIRE_TLS: false
        });
        assert.equal(devFalse.valid, true);

        const devSchemaFalse = envSchema.safeParse({
          NODE_ENV: devEnv,
          DATABASE_URL: 'mysql://dev:dev@localhost:3306/zdexcloud_dev',
          CAMERA_SIGNALING_REQUIRE_TLS: 'false'
        });
        assert.equal(devSchemaFalse.success, true);
      }

      // 5. Explicit true remains accepted in all supported environments
      for (const envName of ['production', 'staging', 'development', 'test'] as const) {
        const explicitTrueValidation = validateEnvironment({
          ...baseProdOverrides,
          NODE_ENV: envName,
          CAMERA_SIGNALING_REQUIRE_TLS: true
        });
        assert.equal(explicitTrueValidation.valid, true);

        const explicitTrueSchema = envSchema.safeParse({
          NODE_ENV: envName,
          DATABASE_URL: baseProdOverrides.DATABASE_URL,
          CAMERA_SIGNALING_REQUIRE_TLS: 'true'
        });
        assert.equal(explicitTrueSchema.success, true);
        assert.equal(resolveCameraSignalingRequireTls(envName, true), true);
      }

      // 6. Runtime TLS enforcement in staging agrees with startup validation (and dev HTTP origin remains usable)
      const stagingServer = http.createServer((_req, res) => res.end('ok'));
      const stagingSvc = new CameraSignalingService({
        path: '/ws/camera-signaling',
        trustProxy: 'loopback',
        allowedOrigins: ['https://staging.zdexcloud.com'],
        nodeEnv: 'staging'
      });
      stagingSvc.attachToHttpServer(stagingServer);
      await new Promise<void>((resolve) => stagingServer.listen(0, '127.0.0.1', resolve));
      const stagingPort = (stagingServer.address() as { port: number }).port;

      const plaintextStagingStatus = await new Promise<number>((resolve) => {
        const sock = new WebSocket(`ws://127.0.0.1:${stagingPort}/ws/camera-signaling`, {
          headers: { origin: 'https://staging.zdexcloud.com' }
        });
        sock.once('unexpected-response', (_req, res) => {
          resolve(res.statusCode || 0);
          sock.terminate();
        });
      });
      assert.equal(plaintextStagingStatus, 403);

      const proxiedTlsStagingClient = createWsClient(`ws://127.0.0.1:${stagingPort}/ws/camera-signaling`, {
        origin: 'https://staging.zdexcloud.com',
        'x-forwarded-proto': 'https'
      });
      await proxiedTlsStagingClient.open;
      proxiedTlsStagingClient.ws.close();

      await stagingSvc.stop();
      await new Promise<void>((resolve) => stagingServer.close(() => resolve()));

      // Runtime staging refuses to weaken TLS even if requireSecureTransport: false is supplied
      const stagingStrictServer = http.createServer((_req, res) => res.end('ok'));
      const stagingStrictSvc = new CameraSignalingService({
        path: '/ws/camera-signaling',
        requireSecureTransport: false,
        allowedOrigins: ['https://staging.zdexcloud.com'],
        nodeEnv: 'staging'
      });
      stagingStrictSvc.attachToHttpServer(stagingStrictServer);
      await new Promise<void>((resolve) => stagingStrictServer.listen(0, '127.0.0.1', resolve));
      const stagingStrictPort = (stagingStrictServer.address() as { port: number }).port;

      const forcedPlaintextStagingStatus = await new Promise<number>((resolve) => {
        const sock = new WebSocket(`ws://127.0.0.1:${stagingStrictPort}/ws/camera-signaling`, {
          headers: { origin: 'https://staging.zdexcloud.com' }
        });
        sock.once('unexpected-response', (_req, res) => {
          resolve(res.statusCode || 0);
          sock.terminate();
        });
      });
      assert.equal(forcedPlaintextStagingStatus, 403);

      await stagingStrictSvc.stop();
      await new Promise<void>((resolve) => stagingStrictServer.close(() => resolve()));

      // Local development keeps http://localhost:3000 over ws:// usable when TLS is not required
      const devServer = http.createServer((_req, res) => res.end('ok'));
      const devSvc = new CameraSignalingService({
        path: '/ws/camera-signaling',
        requireSecureTransport: resolveCameraSignalingRequireTls('development', undefined),
        allowedOrigins: ['http://localhost:3000'],
        nodeEnv: 'development'
      });
      devSvc.attachToHttpServer(devServer);
      await new Promise<void>((resolve) => devServer.listen(0, '127.0.0.1', resolve));
      const devPort = (devServer.address() as { port: number }).port;

      const devClient = createWsClient(`ws://127.0.0.1:${devPort}/ws/camera-signaling`, {
        origin: 'http://localhost:3000'
      });
      await devClient.open;
      devClient.ws.close();

      await devSvc.stop();
      await new Promise<void>((resolve) => devServer.close(() => resolve()));
    } finally {
      if (prevCsrfSecret === undefined) {
        delete process.env.ZDEX_CSRF_SECRET;
      } else {
        process.env.ZDEX_CSRF_SECRET = prevCsrfSecret;
      }
    }
  });
});
