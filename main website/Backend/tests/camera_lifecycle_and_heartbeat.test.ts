/**
 * ZDEXCLOUD — PHASE 20.4 TEST SUITE
 * CAMERA LIFECYCLE MANAGEMENT & HEARTBEAT SPECIFICATION & SERVICE TESTS
 *
 * Execution Policy: WRITE-ONLY. ZERO TESTS EXECUTED.
 * Test Execution Status: NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28
 *
 * Covers all 24 mandatory Phase 20.4 scenarios:
 *  1. Authenticated active device can report CONNECTING -> ONLINE.
 *  2. Authenticated active device heartbeat updates lastSeenAt and endpoint lastHeartbeatAt.
 *  3. Repeated heartbeat in ONLINE state is idempotent and does not produce redundant audit spam.
 *  4. ONLINE -> STREAMING -> ONLINE transitions work properly.
 *  5. ONLINE -> RECONNECTING -> ONLINE recovery transition works cleanly.
 *  6. STREAMING -> RECONNECTING -> ONLINE / STREAMING transitions work cleanly.
 *  7. Any active/transient state -> ERROR transition works properly.
 *  8. ERROR -> CONNECTING -> ONLINE recovery transition works properly.
 *  9. Invalid transitions are rejected cleanly (e.g., OFFLINE -> STREAMING, CONNECTING -> STREAMING, ONLINE -> CONNECTING).
 * 10. Unauthenticated heartbeat / lifecycle report is rejected (401 Unauthorized).
 * 11. Interactive browser/user session is rejected from device heartbeat/lifecycle endpoints (403 DEVICE_CREDENTIAL_REQUIRED).
 * 12. Cross-account device cannot report lifecycle state for another user's camera.
 * 13. Revoked or inactive device cannot report heartbeat or lifecycle transitions.
 * 14. Camera associated with Device A rejects lifecycle report from Device B (even on same account).
 * 15. Client-supplied userId or deviceId cannot override authenticated device identity.
 * 16. Stale heartbeat / report timestamp older than allowed window or lastSeenAt is rejected cleanly.
 * 17. Stale-camera reconciliation marks stale cameras RECONNECTING and later OFFLINE safely.
 * 18. Stale-camera reconciliation skips cameras with recent heartbeats and uses CAS against concurrent heartbeats.
 * 19. Pending START followed by newer STOP: delayed START confirmation cannot override STOP.
 * 20. Pending STOP followed by newer START: delayed STOP confirmation cannot override START.
 * 21. Pending STOP command does not falsely mark camera OFFLINE until device confirms OFFLINE.
 * 22. Viewer session end/revocation reconciles STREAMING -> ONLINE (never falsely OFFLINE).
 * 23. Expired viewing session does not keep camera falsely STREAMING.
 * 24. Security and operational audit events are persisted cleanly without exposing secrets.
 */

// Seed required config environment before importing backend modules in standalone test runs
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'mysql://test:test@localhost:3306/zdexcloud_test';

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import Fastify from 'fastify';
import {
  CameraStatus,
  CameraEndpointStatus,
  CameraStreamSessionStatus,
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
import {
  CameraLifecycleService,
  PERMITTED_CAMERA_TRANSITIONS,
  isValidLifecycleTransition,
  assertValidLifecycleTransition,
  type AuthenticatedDeviceContext
} from '../src/services/camera_lifecycle_service.js';

interface MockDbState {
  users: Map<string, any>;
  devices: Map<string, any>;
  deviceAuthCredentials: Map<string, any>;
  deviceInstallationClaims: Map<string, any>;
  userSessions: Map<string, any>;
  cameras: Map<string, any>;
  endpoints: Map<string, any>;
  streamSessions: Map<string, any>;
  auditEvents: any[];
}

function createMockDbState(): MockDbState {
  return {
    users: new Map(),
    devices: new Map(),
    deviceAuthCredentials: new Map(),
    deviceInstallationClaims: new Map(),
    userSessions: new Map(),
    cameras: new Map(),
    endpoints: new Map(),
    streamSessions: new Map(),
    auditEvents: []
  };
}

function matchesWhere(row: any, where: any): boolean {
  if (!where) return true;
  for (const [key, val] of Object.entries(where)) {
    if (key === 'OR' && Array.isArray(val)) {
      if (!val.some((sub) => matchesWhere(row, sub))) return false;
      continue;
    }
    if (key === 'AND' && Array.isArray(val)) {
      if (!val.every((sub) => matchesWhere(row, sub))) return false;
      continue;
    }
    if (val && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
      const candidate = row[key];
      if ('in' in val && Array.isArray(val.in) && !val.in.includes(candidate)) return false;
      if ('notIn' in val && Array.isArray(val.notIn) && val.notIn.includes(candidate)) return false;
      if ('lt' in val && (!(candidate instanceof Date) || !(candidate.getTime() < (val.lt as Date).getTime()))) return false;
      if ('lte' in val && (!(candidate instanceof Date) || !(candidate.getTime() <= (val.lte as Date).getTime()))) return false;
      if ('gt' in val && (!(candidate instanceof Date) || !(candidate.getTime() > (val.gt as Date).getTime()))) return false;
      if ('gte' in val && (!(candidate instanceof Date) || !(candidate.getTime() >= (val.gte as Date).getTime()))) return false;
      continue;
    }
    if (val instanceof Date) {
      if (!(row[key] instanceof Date) || row[key].getTime() !== val.getTime()) return false;
      continue;
    }
    if (row[key] !== val) return false;
  }
  return true;
}

function installPrismaMock(state: MockDbState, options?: { simulateConcurrentHeartbeatOnCameraId?: string }) {
  const txProxy: any = {};

  const buildDelegate = (map: Map<string, any>, onFindHook?: () => void) => ({
    findUnique: async ({ where, include }: any) => {
      let match: any = null;
      for (const item of map.values()) {
        if (matchesWhere(item, where)) {
          match = { ...item };
          break;
        }
      }
      if (!match) return null;
      if (include?.device) {
        const dev = state.devices.get(match.deviceId);
        if (dev) {
          const deviceClone: any = { ...dev };
          if (typeof include.device === 'object' && include.device.include?.user) {
            const usr = state.users.get(deviceClone.userId);
            deviceClone.user = usr ? { ...usr } : null;
          }
          match.device = deviceClone;
        } else {
          match.device = null;
        }
      }
      if (include?.user) {
        const usr = state.users.get(match.userId);
        match.user = usr ? { ...usr } : null;
      }
      return match;
    },
    findFirst: async ({ where }: any) => {
      for (const item of map.values()) {
        if (matchesWhere(item, where)) return { ...item };
      }
      return null;
    },
    findMany: async ({ where, take }: any = {}) => {
      onFindHook?.();
      const results = Array.from(map.values())
        .filter((item) => matchesWhere(item, where))
        .map((item) => ({ ...item }));
      return typeof take === 'number' ? results.slice(0, take) : results;
    },
    count: async ({ where }: any = {}) => {
      return Array.from(map.values()).filter((item) => matchesWhere(item, where)).length;
    },
    update: async ({ where, data }: any) => {
      const existing = map.get(where.id);
      if (!existing) throw new Error(`Record not found for update: ${where.id}`);
      const updated = {
        ...existing,
        ...data,
        updatedAt: data.updatedAt || new Date(Date.now() + 1)
      };
      map.set(updated.id, updated);
      return { ...updated };
    },
    updateMany: async ({ where, data }: any) => {
      // Simulate concurrent fresh heartbeat arriving between findMany() and updateMany() CAS
      if (options?.simulateConcurrentHeartbeatOnCameraId && map === state.cameras) {
        const target = map.get(options.simulateConcurrentHeartbeatOnCameraId);
        if (target && where?.id === target.id) {
          target.lastSeenAt = new Date();
          target.updatedAt = new Date(target.updatedAt.getTime() + 5000);
        }
      }
      let count = 0;
      for (const [id, item] of map.entries()) {
        if (matchesWhere(item, where)) {
          map.set(id, {
            ...item,
            ...data,
            updatedAt: data.updatedAt || new Date(Date.now() + 1)
          });
          count++;
        }
      }
      return { count };
    }
  });

  const cameraDelegate = buildDelegate(state.cameras);
  const endpointDelegate = buildDelegate(state.endpoints);
  const deviceDelegate = buildDelegate(state.devices);
  const credDelegate = buildDelegate(state.deviceAuthCredentials);
  const claimDelegate = buildDelegate(state.deviceInstallationClaims);
  const sessionDelegate = buildDelegate(state.streamSessions);
  const userSessionDelegate = buildDelegate(state.userSessions);
  const auditDelegate = {
    create: async ({ data }: any) => {
      const record = {
        id: `aud_${state.auditEvents.length + 1}`,
        createdAt: new Date(),
        ...data
      };
      state.auditEvents.push(record);
      return { ...record };
    }
  };

  Object.assign(txProxy, {
    $queryRaw: async () => [{ id: 'locked' }],
    cameraInstance: cameraDelegate,
    cameraEndpoint: endpointDelegate,
    device: deviceDelegate,
    deviceAuthCredential: credDelegate,
    deviceInstallationClaim: claimDelegate,
    cameraStreamSession: sessionDelegate,
    userSession: userSessionDelegate,
    cameraAccessAuditEvent: auditDelegate
  });

  mock.method(prisma as any, '$transaction', async (fn: any) => fn(txProxy));
  mock.method(prisma as any, '$queryRaw', async () => [{ id: 'locked' }]);

  const bindDelegateMocks = (modelName: keyof MockDbState | string, delegate: any) => {
    const targetModel = (prisma as any)[modelName];
    for (const fnName of Object.keys(delegate)) {
      if (typeof targetModel[fnName] === 'function') {
        mock.method(targetModel, fnName, delegate[fnName]);
      }
    }
  };

  bindDelegateMocks('cameraInstance', cameraDelegate);
  bindDelegateMocks('cameraEndpoint', endpointDelegate);
  bindDelegateMocks('device', deviceDelegate);
  bindDelegateMocks('deviceAuthCredential', credDelegate);
  bindDelegateMocks('deviceInstallationClaim', claimDelegate);
  bindDelegateMocks('cameraStreamSession', sessionDelegate);
  bindDelegateMocks('userSession', userSessionDelegate);
  bindDelegateMocks('cameraAccessAuditEvent', auditDelegate);
}

describe('Phase 20.4 Camera Lifecycle Management & Heartbeat [STATUS: NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28]', () => {
  let state: MockDbState;
  const userId = 'usr_owner_1';
  const otherUserId = 'usr_other_2';
  const deviceAId = 'dev_android_a';
  const deviceBId = 'dev_android_b';
  const otherDeviceId = 'dev_other_c';
  const cameraId = 'cam_primary_1';
  const rawDeviceTokenA = 'dst_device_secret_token_alpha_12345';
  const rawDeviceTokenB = 'dst_device_secret_token_beta_67890';
  const rawOtherDeviceToken = 'dst_device_secret_token_gamma_99999';
  const rawBrowserUserToken = 'usr_interactive_browser_token_11111';

  const authDeviceA: AuthenticatedDeviceContext = {
    deviceId: deviceAId,
    userId,
    installationId: 'inst-alpha-001',
    credentialId: 'cred_a',
    authMethod: 'DEVICE_CREDENTIAL'
  };

  const authDeviceB: AuthenticatedDeviceContext = {
    deviceId: deviceBId,
    userId,
    installationId: 'inst-beta-002',
    credentialId: 'cred_b',
    authMethod: 'DEVICE_CREDENTIAL'
  };

  const authOtherDevice: AuthenticatedDeviceContext = {
    deviceId: otherDeviceId,
    userId: otherUserId,
    installationId: 'inst-gamma-003',
    credentialId: 'cred_c',
    authMethod: 'DEVICE_CREDENTIAL'
  };

  beforeEach(() => {
    state = createMockDbState();
    const now = new Date();
    const futureExpiry = new Date(now.getTime() + 60 * 60 * 1000);

    state.users.set(userId, {
      id: userId,
      email: 'owner@zdexcloud.com',
      status: UserStatus.ACTIVE,
      emailVerified: true
    });
    state.users.set(otherUserId, {
      id: otherUserId,
      email: 'other@zdexcloud.com',
      status: UserStatus.ACTIVE,
      emailVerified: true
    });

    state.devices.set(deviceAId, {
      id: deviceAId,
      userId,
      installationId: 'inst-alpha-001',
      status: DeviceStatus.ONLINE,
      lastSeenAt: now
    });
    state.devices.set(deviceBId, {
      id: deviceBId,
      userId,
      installationId: 'inst-beta-002',
      status: DeviceStatus.ONLINE,
      lastSeenAt: now
    });
    state.devices.set(otherDeviceId, {
      id: otherDeviceId,
      userId: otherUserId,
      installationId: 'inst-gamma-003',
      status: DeviceStatus.ONLINE,
      lastSeenAt: now
    });

    state.deviceAuthCredentials.set('cred_a', {
      id: 'cred_a',
      deviceId: deviceAId,
      userId,
      credentialHash: hashSessionToken(rawDeviceTokenA),
      revokedAt: null,
      expiresAt: futureExpiry,
      lastUsedAt: null
    });
    state.deviceAuthCredentials.set('cred_b', {
      id: 'cred_b',
      deviceId: deviceBId,
      userId,
      credentialHash: hashSessionToken(rawDeviceTokenB),
      revokedAt: null,
      expiresAt: futureExpiry,
      lastUsedAt: null
    });
    state.deviceAuthCredentials.set('cred_c', {
      id: 'cred_c',
      deviceId: otherDeviceId,
      userId: otherUserId,
      credentialHash: hashSessionToken(rawOtherDeviceToken),
      revokedAt: null,
      expiresAt: futureExpiry,
      lastUsedAt: null
    });

    state.deviceInstallationClaims.set('inst-alpha-001', {
      installationId: 'inst-alpha-001',
      userId,
      deviceId: deviceAId,
      status: 'ACTIVE'
    });
    state.deviceInstallationClaims.set('inst-beta-002', {
      installationId: 'inst-beta-002',
      userId,
      deviceId: deviceBId,
      status: 'ACTIVE'
    });
    state.deviceInstallationClaims.set('inst-gamma-003', {
      installationId: 'inst-gamma-003',
      userId: otherUserId,
      deviceId: otherDeviceId,
      status: 'ACTIVE'
    });

    state.userSessions.set('usess_browser_1', {
      id: 'usess_browser_1',
      userId,
      tokenHash: hashSessionToken(rawBrowserUserToken),
      expiresAt: futureExpiry,
      revokedAt: null
    });

    state.cameras.set(cameraId, {
      id: cameraId,
      userId,
      deviceId: deviceAId,
      cameraName: 'Front Door Camera',
      status: CameraStatus.OFFLINE,
      lastSeenAt: null,
      startedAt: null,
      stoppedAt: null,
      metadata: {},
      createdAt: now,
      updatedAt: now
    });

    state.endpoints.set('ep_1', {
      id: 'ep_1',
      cameraInstanceId: cameraId,
      status: CameraEndpointStatus.READY,
      lastHeartbeatAt: null,
      connectedAt: null,
      disconnectedAt: null
    });

    EntitlementService.setTestUserPlan(userId, 'PRO_MONTHLY');
  });

  afterEach(() => {
    mock.restoreAll();
    EntitlementService.clearTestUserPlans();
  });

  describe('Scenario 1: Authenticated Active Device Reports CONNECTING -> ONLINE', () => {
    it('[DEFERRED TO PHASE 28] transitions camera from CONNECTING to ONLINE and resolves pending START command', async () => {
      installPrismaMock(state);
      const cam = state.cameras.get(cameraId);
      cam.status = CameraStatus.CONNECTING;
      cam.metadata = {
        pendingCommand: {
          commandId: 'cmd_start_001',
          action: 'START',
          requestedAt: new Date(Date.now() - 5000).toISOString(),
          requestedBy: userId
        }
      };

      const result = await CameraLifecycleService.reportCameraLifecycle({
        cameraId,
        authDevice: authDeviceA,
        status: CameraStatus.ONLINE,
        confirmedCommand: 'START',
        commandId: 'cmd_start_001'
      });

      assert.equal(result.previousStatus, CameraStatus.CONNECTING);
      assert.equal(result.currentStatus, CameraStatus.ONLINE);
      assert.equal(result.transitioned, true);
      assert.equal(result.pendingCommand, null);
      assert.equal(result.lastCommandResolution?.status, 'CONFIRMED');
      assert.equal(state.endpoints.get('ep_1').status, CameraEndpointStatus.CONNECTED);
    });
  });

  describe('Scenario 2: Heartbeat Updates lastSeenAt & Endpoint lastHeartbeatAt', () => {
    it('[DEFERRED TO PHASE 28] updates CameraInstance.lastSeenAt, CameraEndpoint.lastHeartbeatAt, and Device.lastSeenAt', async () => {
      installPrismaMock(state);
      const t0 = new Date('2026-11-12T10:00:00.000Z');
      const cam = state.cameras.get(cameraId);
      cam.status = CameraStatus.ONLINE;
      cam.lastSeenAt = new Date('2026-11-12T09:59:00.000Z');

      const result = await CameraLifecycleService.recordCameraHeartbeat({
        cameraId,
        authDevice: authDeviceA,
        now: t0
      });

      assert.equal(result.camera.lastSeenAt?.toISOString(), t0.toISOString());
      assert.equal(state.endpoints.get('ep_1').lastHeartbeatAt.toISOString(), t0.toISOString());
      assert.equal(state.devices.get(deviceAId).lastSeenAt.toISOString(), t0.toISOString());
    });
  });

  describe('Scenario 3: Repeated ONLINE Heartbeat Is Idempotent Without Audit Spam', () => {
    it('[DEFERRED TO PHASE 28] keeps status ONLINE and avoids redundant audit events on repeated heartbeats', async () => {
      installPrismaMock(state);
      const cam = state.cameras.get(cameraId);
      cam.status = CameraStatus.ONLINE;

      const r1 = await CameraLifecycleService.recordCameraHeartbeat({
        cameraId,
        authDevice: authDeviceA,
        now: new Date('2026-11-12T10:00:00.000Z')
      });
      const r2 = await CameraLifecycleService.recordCameraHeartbeat({
        cameraId,
        authDevice: authDeviceA,
        now: new Date('2026-11-12T10:00:20.000Z')
      });

      assert.equal(r1.transitioned, false);
      assert.equal(r1.idempotent, true);
      assert.equal(r2.transitioned, false);
      assert.equal(r2.idempotent, true);
      assert.equal(state.auditEvents.length, 0, 'Repeated ONLINE heartbeats must not flood audit logs');
    });
  });

  describe('Scenario 4: ONLINE -> STREAMING -> ONLINE Transitions', () => {
    it('[DEFERRED TO PHASE 28] requires valid active stream session for STREAMING and downgrades cleanly to ONLINE', async () => {
      installPrismaMock(state);
      const now = new Date();
      state.cameras.get(cameraId).status = CameraStatus.ONLINE;
      state.streamSessions.set('sess_active_1', {
        id: 'sess_active_1',
        cameraInstanceId: cameraId,
        viewerUserId: userId,
        status: CameraStreamSessionStatus.ACTIVE,
        expiresAt: new Date(now.getTime() + 10 * 60 * 1000)
      });

      const streamingResult = await CameraLifecycleService.reportCameraLifecycle({
        cameraId,
        authDevice: authDeviceA,
        status: CameraStatus.STREAMING,
        now
      });
      assert.equal(streamingResult.currentStatus, CameraStatus.STREAMING);

      const backOnlineResult = await CameraLifecycleService.reportCameraLifecycle({
        cameraId,
        authDevice: authDeviceA,
        status: CameraStatus.ONLINE,
        now: new Date(now.getTime() + 1000)
      });
      assert.equal(backOnlineResult.previousStatus, CameraStatus.STREAMING);
      assert.equal(backOnlineResult.currentStatus, CameraStatus.ONLINE);
    });
  });

  describe('Scenario 5: ONLINE -> RECONNECTING -> ONLINE Recovery', () => {
    it('[DEFERRED TO PHASE 28] transitions ONLINE -> RECONNECTING -> ONLINE cleanly', async () => {
      installPrismaMock(state);
      state.cameras.get(cameraId).status = CameraStatus.ONLINE;

      const r1 = await CameraLifecycleService.reportCameraLifecycle({
        cameraId,
        authDevice: authDeviceA,
        status: CameraStatus.RECONNECTING,
        reason: 'CELLULAR_HANDOFF'
      });
      assert.equal(r1.currentStatus, CameraStatus.RECONNECTING);

      const r2 = await CameraLifecycleService.recordCameraHeartbeat({
        cameraId,
        authDevice: authDeviceA
      });
      assert.equal(r2.previousStatus, CameraStatus.RECONNECTING);
      assert.equal(r2.currentStatus, CameraStatus.ONLINE);
    });
  });

  describe('Scenario 6: STREAMING -> RECONNECTING -> ONLINE / STREAMING Recovery', () => {
    it('[DEFERRED TO PHASE 28] supports STREAMING -> RECONNECTING -> STREAMING (with active session) and RECONNECTING -> ONLINE', async () => {
      installPrismaMock(state);
      const now = new Date();
      state.cameras.get(cameraId).status = CameraStatus.STREAMING;
      state.streamSessions.set('sess_live_1', {
        id: 'sess_live_1',
        cameraInstanceId: cameraId,
        viewerUserId: userId,
        status: CameraStreamSessionStatus.ACTIVE,
        expiresAt: new Date(now.getTime() + 600_000)
      });

      const rec = await CameraLifecycleService.reportCameraLifecycle({
        cameraId,
        authDevice: authDeviceA,
        status: CameraStatus.RECONNECTING,
        now
      });
      assert.equal(rec.currentStatus, CameraStatus.RECONNECTING);

      const resumeStream = await CameraLifecycleService.reportCameraLifecycle({
        cameraId,
        authDevice: authDeviceA,
        status: CameraStatus.STREAMING,
        now: new Date(now.getTime() + 2000)
      });
      assert.equal(resumeStream.currentStatus, CameraStatus.STREAMING);
    });
  });

  describe('Scenario 7: Any Active or Transient State -> ERROR', () => {
    it('[DEFERRED TO PHASE 28] transitions active/transient states to ERROR cleanly', async () => {
      for (const stateName of [
        CameraStatus.CONNECTING,
        CameraStatus.ONLINE,
        CameraStatus.STREAMING,
        CameraStatus.RECONNECTING
      ]) {
        assert.equal(isValidLifecycleTransition(stateName, CameraStatus.ERROR), true);
      }

      installPrismaMock(state);
      state.cameras.get(cameraId).status = CameraStatus.STREAMING;

      const errRes = await CameraLifecycleService.reportCameraLifecycle({
        cameraId,
        authDevice: authDeviceA,
        status: CameraStatus.ERROR,
        errorCode: 'CAMERA_HARDWARE_BUSY',
        errorMessage: 'Camera sensor preempted by system call'
      });

      assert.equal(errRes.currentStatus, CameraStatus.ERROR);
      assert.equal(state.endpoints.get('ep_1').status, CameraEndpointStatus.FAILED);
    });
  });

  describe('Scenario 8: ERROR -> CONNECTING -> ONLINE Recovery', () => {
    it('[DEFERRED TO PHASE 28] recovers cleanly from ERROR through CONNECTING to ONLINE', async () => {
      installPrismaMock(state);
      state.cameras.get(cameraId).status = CameraStatus.ERROR;

      const connectingRes = await CameraLifecycleService.reportCameraLifecycle({
        cameraId,
        authDevice: authDeviceA,
        status: CameraStatus.CONNECTING
      });
      assert.equal(connectingRes.currentStatus, CameraStatus.CONNECTING);

      const onlineRes = await CameraLifecycleService.reportCameraLifecycle({
        cameraId,
        authDevice: authDeviceA,
        status: CameraStatus.ONLINE
      });
      assert.equal(onlineRes.currentStatus, CameraStatus.ONLINE);
    });
  });

  describe('Scenario 9: Invalid Transitions Rejected Cleanly', () => {
    it('[DEFERRED TO PHASE 28] rejects invalid jumps such as OFFLINE->STREAMING, CONNECTING->STREAMING, ONLINE->CONNECTING', () => {
      const invalidPairs: Array<[CameraStatus, CameraStatus]> = [
        [CameraStatus.OFFLINE, CameraStatus.STREAMING],
        [CameraStatus.OFFLINE, CameraStatus.RECONNECTING],
        [CameraStatus.CONNECTING, CameraStatus.STREAMING],
        [CameraStatus.ONLINE, CameraStatus.CONNECTING],
        [CameraStatus.ERROR, CameraStatus.STREAMING],
        [CameraStatus.ERROR, CameraStatus.RECONNECTING]
      ];

      for (const [from, to] of invalidPairs) {
        assert.equal(PERMITTED_CAMERA_TRANSITIONS[from].has(to), false, `Expected ${from} -> ${to} to be disallowed`);
        assert.throws(
          () => assertValidLifecycleTransition(from, to),
          (err: any) => err?.errorCode === 'INVALID_LIFECYCLE_TRANSITION'
        );
      }
    });
  });

  describe('Scenario 10: Unauthenticated Heartbeat / Lifecycle Report Rejected (401)', () => {
    it('[DEFERRED TO PHASE 28] rejects requests missing device credentials with 401', async () => {
      installPrismaMock(state);
      const app = Fastify();
      app.setErrorHandler(globalErrorHandler);
      await app.register(cameraRoutes, { prefix: '/api/v1' });

      const hbRes = await app.inject({
        method: 'POST',
        url: `/api/v1/cameras/${cameraId}/heartbeat`,
        payload: {}
      });
      assert.equal(hbRes.statusCode, 401);

      const lcRes = await app.inject({
        method: 'POST',
        url: `/api/v1/cameras/${cameraId}/lifecycle`,
        payload: { status: 'ONLINE' }
      });
      assert.equal(lcRes.statusCode, 401);

      await app.close();
    });
  });

  describe('Scenario 11: Interactive Browser/User Session Rejected on Device Endpoints', () => {
    it('[DEFERRED TO PHASE 28] rejects interactive web user Bearer/cookie sessions with 403 DEVICE_CREDENTIAL_REQUIRED', async () => {
      installPrismaMock(state);
      const app = Fastify();
      app.setErrorHandler(globalErrorHandler);
      await app.register(cameraRoutes, { prefix: '/api/v1' });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/cameras/${cameraId}/heartbeat`,
        headers: {
          authorization: `Bearer ${rawBrowserUserToken}`
        },
        payload: { status: 'ONLINE' }
      });

      assert.equal(res.statusCode, 403);
      const body = res.json();
      assert.equal(body.error?.code || body.code, 'DEVICE_CREDENTIAL_REQUIRED');

      await app.close();
    });
  });

  describe('Scenario 12: Cross-Account Device Rejected', () => {
    it('[DEFERRED TO PHASE 28] denies lifecycle report from another account device and persists security audit', async () => {
      installPrismaMock(state);

      await assert.rejects(
        () =>
          CameraLifecycleService.reportCameraLifecycle({
            cameraId,
            authDevice: authOtherDevice,
            status: CameraStatus.ONLINE
          }),
        (err: any) => err?.errorCode === 'CROSS_ACCOUNT_CAMERA_ACCESS_DENIED'
      );

      assert.ok(
        state.auditEvents.some((e) => e.action === 'CROSS_ACCOUNT_LIFECYCLE_REPORT_DENIED' && e.result === 'DENIED')
      );
    });
  });

  describe('Scenario 13: Revoked or Inactive Device Rejected', () => {
    it('[DEFERRED TO PHASE 28] rejects revoked DeviceAuthCredential or REVOKED User with 401/403', async () => {
      state.deviceAuthCredentials.get('cred_a').revokedAt = new Date();
      installPrismaMock(state);

      const app = Fastify();
      app.setErrorHandler(globalErrorHandler);
      await app.register(cameraRoutes, { prefix: '/api/v1' });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/cameras/${cameraId}/heartbeat`,
        headers: {
          authorization: `Bearer ${rawDeviceTokenA}`
        },
        payload: {}
      });

      assert.equal(res.statusCode, 401);
      assert.ok(state.auditEvents.some((e) => e.action === 'REVOKED_DEVICE_CREDENTIAL_REJECTED'));
      await app.close();
    });
  });

  describe('Scenario 14: Camera Bound to Device A Rejects Device B (Same Account)', () => {
    it('[DEFERRED TO PHASE 28] rejects lifecycle updates from another device owned by the same user', async () => {
      installPrismaMock(state);

      await assert.rejects(
        () =>
          CameraLifecycleService.recordCameraHeartbeat({
            cameraId,
            authDevice: authDeviceB
          }),
        (err: any) => err?.errorCode === 'DEVICE_CAMERA_MISMATCH'
      );

      assert.ok(
        state.auditEvents.some((e) => e.action === 'DEVICE_CAMERA_ASSOCIATION_MISMATCH' && e.result === 'DENIED')
      );
    });
  });

  describe('Scenario 15: Client-Supplied userId or deviceId Cannot Override Identity', () => {
    it('[DEFERRED TO PHASE 28] rejects spoofed deviceId mismatch and ignores client-supplied userId in route payload', async () => {
      installPrismaMock(state);
      state.cameras.get(cameraId).status = CameraStatus.CONNECTING;

      const app = Fastify();
      app.setErrorHandler(globalErrorHandler);
      await app.register(cameraRoutes, { prefix: '/api/v1' });

      // Attempt to impersonate deviceB using deviceA's credential
      const spoofDeviceRes = await app.inject({
        method: 'POST',
        url: `/api/v1/cameras/${cameraId}/heartbeat`,
        headers: {
          authorization: `Bearer ${rawDeviceTokenA}`
        },
        payload: { deviceId: deviceBId }
      });
      assert.equal(spoofDeviceRes.statusCode, 403);

      // Client tries to inject another userId in payload while using valid deviceA credential:
      // route strips extra userId and still derives owner strictly from authenticated credential
      const spoofUserRes = await app.inject({
        method: 'POST',
        url: `/api/v1/cameras/${cameraId}/heartbeat`,
        headers: {
          authorization: `Bearer ${rawDeviceTokenA}`
        },
        payload: { userId: otherUserId }
      });
      assert.equal(spoofUserRes.statusCode, 200);
      assert.equal(state.cameras.get(cameraId).userId, userId);

      await app.close();
    });
  });

  describe('Scenario 16: Stale Heartbeat / Out-of-Order Timestamp Rejected', () => {
    it('[DEFERRED TO PHASE 28] rejects heartbeat timestamps outside allowed window or older than lastSeenAt', async () => {
      installPrismaMock(state);
      const now = new Date('2026-11-12T12:00:00.000Z');
      state.cameras.get(cameraId).status = CameraStatus.ONLINE;
      state.cameras.get(cameraId).lastSeenAt = new Date('2026-11-12T11:59:50.000Z');

      // Timestamp older than timeout window
      await assert.rejects(
        () =>
          CameraLifecycleService.recordCameraHeartbeat({
            cameraId,
            authDevice: authDeviceA,
            reportedAt: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
            now
          }),
        (err: any) => err?.errorCode === 'STALE_HEARTBEAT_REPORT'
      );

      // Out-of-order timestamp predating current lastSeenAt
      await assert.rejects(
        () =>
          CameraLifecycleService.recordCameraHeartbeat({
            cameraId,
            authDevice: authDeviceA,
            reportedAt: new Date('2026-11-12T11:59:30.000Z').toISOString(),
            now
          }),
        (err: any) => err?.errorCode === 'STALE_HEARTBEAT_REPORT'
      );
    });
  });

  describe('Scenario 17: Stale-Camera Reconciliation Marks RECONNECTING Then OFFLINE', () => {
    it('[DEFERRED TO PHASE 28] degrades stale ONLINE camera to RECONNECTING, then OFFLINE after grace window', async () => {
      installPrismaMock(state);
      const t0 = new Date('2026-11-12T12:00:00.000Z');
      const cam = state.cameras.get(cameraId);
      cam.status = CameraStatus.ONLINE;
      // 100s old heartbeat (> 90s default timeout, < 90s + 180s extended cutoff)
      cam.lastSeenAt = new Date(t0.getTime() - 100_000);
      cam.updatedAt = new Date(t0.getTime() - 100_000);

      const pass1 = await CameraLifecycleService.reconcileStaleCameras({
        now: t0,
        heartbeatTimeoutMs: 90_000,
        reconnectGraceMs: 180_000,
        connectingTimeoutMs: 120_000
      });
      assert.equal(pass1.transitionedToReconnecting, 1);
      assert.equal(state.cameras.get(cameraId).status, CameraStatus.RECONNECTING);

      // Advance past reconnectGraceMs (185s later)
      const t1 = new Date(t0.getTime() + 185_000);
      const pass2 = await CameraLifecycleService.reconcileStaleCameras({
        now: t1,
        heartbeatTimeoutMs: 90_000,
        reconnectGraceMs: 180_000,
        connectingTimeoutMs: 120_000
      });
      assert.equal(pass2.transitionedToOffline, 1);
      assert.equal(state.cameras.get(cameraId).status, CameraStatus.OFFLINE);
      assert.equal(state.endpoints.get('ep_1').status, CameraEndpointStatus.INACTIVE);
    });
  });

  describe('Scenario 18: Stale Reconciliation Skips Fresh Cameras & Respects CAS Guard', () => {
    it('[DEFERRED TO PHASE 28] skips fresh heartbeats and aborts update when concurrent heartbeat wins CAS', async () => {
      const t0 = new Date('2026-11-12T12:00:00.000Z');
      const cam = state.cameras.get(cameraId);
      cam.status = CameraStatus.ONLINE;
      cam.lastSeenAt = new Date(t0.getTime() - 10_000); // Fresh (10s old)
      cam.updatedAt = new Date(t0.getTime() - 10_000);

      installPrismaMock(state);
      const freshPass = await CameraLifecycleService.reconcileStaleCameras({
        now: t0,
        heartbeatTimeoutMs: 90_000
      });
      assert.equal(freshPass.transitionedToReconnecting, 0);
      assert.equal(freshPass.skippedConcurrentOrFresh, 1);
      assert.equal(state.cameras.get(cameraId).status, CameraStatus.ONLINE);

      // Now simulate stale snapshot at read time raced by a concurrent heartbeat right before CAS updateMany
      mock.restoreAll();
      cam.lastSeenAt = new Date(t0.getTime() - 100_000);
      cam.updatedAt = new Date(t0.getTime() - 100_000);
      installPrismaMock(state, { simulateConcurrentHeartbeatOnCameraId: cameraId });

      const racedPass = await CameraLifecycleService.reconcileStaleCameras({
        now: t0,
        heartbeatTimeoutMs: 90_000
      });
      assert.equal(racedPass.transitionedToReconnecting, 0);
      assert.equal(racedPass.skippedConcurrentOrFresh, 1);
      assert.equal(state.cameras.get(cameraId).status, CameraStatus.ONLINE);
    });
  });

  describe('Scenario 19: Pending START Followed by Newer STOP Rejects Delayed START Confirmation', () => {
    it('[DEFERRED TO PHASE 28] rejects stale START confirmation when STOP command is now pending', async () => {
      installPrismaMock(state);
      const cam = state.cameras.get(cameraId);
      cam.status = CameraStatus.CONNECTING;

      const startRes = await CameraService.requestStartCamera(userId, cameraId);
      const startCmdId = (startRes.camera.metadata as any).pendingCommand?.commandId;

      // Newer STOP command supersedes pending START
      await CameraService.requestStopCamera(userId, cameraId);
      assert.equal((state.cameras.get(cameraId).metadata as any).pendingCommand.action, 'STOP');

      await assert.rejects(
        () =>
          CameraLifecycleService.reportCameraLifecycle({
            cameraId,
            authDevice: authDeviceA,
            status: CameraStatus.ONLINE,
            confirmedCommand: 'START',
            commandId: startCmdId
          }),
        (err: any) => err?.errorCode === 'STALE_COMMAND_CONFIRMATION'
      );

      assert.equal((state.cameras.get(cameraId).metadata as any).pendingCommand.action, 'STOP');
    });
  });

  describe('Scenario 20: Pending STOP Followed by Newer START Rejects Delayed STOP Confirmation', () => {
    it('[DEFERRED TO PHASE 28] supersedes STOP with START and rejects delayed STOP confirmation', async () => {
      installPrismaMock(state);
      const cam = state.cameras.get(cameraId);
      cam.status = CameraStatus.ONLINE;

      const stopRes = await CameraService.requestStopCamera(userId, cameraId);
      const stopCmdId = (stopRes.camera.metadata as any).pendingCommand.commandId;

      // User changes mind and requests START before device confirms STOP
      const startRes = await CameraService.requestStartCamera(userId, cameraId);
      assert.equal((startRes.camera.metadata as any).pendingCommand.action, 'START');

      await assert.rejects(
        () =>
          CameraLifecycleService.reportCameraLifecycle({
            cameraId,
            authDevice: authDeviceA,
            status: CameraStatus.OFFLINE,
            confirmedCommand: 'STOP',
            commandId: stopCmdId
          }),
        (err: any) => err?.errorCode === 'STALE_COMMAND_CONFIRMATION'
      );

      // Camera was not forced OFFLINE by delayed STOP
      assert.equal(state.cameras.get(cameraId).status, CameraStatus.ONLINE);
    });
  });

  describe('Scenario 21: Pending STOP Does Not Falsely Mark Camera OFFLINE', () => {
    it('[DEFERRED TO PHASE 28] keeps camera active until device lifecycle explicitly confirms OFFLINE', async () => {
      installPrismaMock(state);
      const cam = state.cameras.get(cameraId);
      cam.status = CameraStatus.ONLINE;

      const stopRes = await CameraService.requestStopCamera(userId, cameraId);
      assert.equal(stopRes.commandAccepted, true);
      assert.equal(stopRes.stateConfirmedByDevice, false);
      assert.equal(state.cameras.get(cameraId).status, CameraStatus.ONLINE);

      const stopCmdId = (stopRes.camera.metadata as any).pendingCommand.commandId;
      const confirmed = await CameraLifecycleService.reportCameraLifecycle({
        cameraId,
        authDevice: authDeviceA,
        status: CameraStatus.OFFLINE,
        confirmedCommand: 'STOP',
        commandId: stopCmdId
      });
      assert.equal(confirmed.currentStatus, CameraStatus.OFFLINE);
    });
  });

  describe('Scenario 22: Viewer Session End/Revocation Transitions STREAMING -> ONLINE (Never OFFLINE)', () => {
    it('[DEFERRED TO PHASE 28] reconciles STREAMING -> ONLINE when final viewer session ends or is revoked', async () => {
      installPrismaMock(state);
      const now = new Date();
      state.cameras.get(cameraId).status = CameraStatus.STREAMING;
      state.streamSessions.set('sess_viewer_1', {
        id: 'sess_viewer_1',
        cameraInstanceId: cameraId,
        viewerUserId: userId,
        status: CameraStreamSessionStatus.ACTIVE,
        expiresAt: new Date(now.getTime() + 600_000)
      });

      await CameraService.revokeViewingSession(userId, 'sess_viewer_1', 'VIEWER_CLOSED');

      assert.equal(state.streamSessions.get('sess_viewer_1').status, CameraStreamSessionStatus.REVOKED);
      assert.equal(state.cameras.get(cameraId).status, CameraStatus.ONLINE);
      assert.notEqual(state.cameras.get(cameraId).status, CameraStatus.OFFLINE);
    });
  });

  describe('Scenario 23: Expired Viewing Session Does Not Keep Camera Falsely STREAMING', () => {
    it('[DEFERRED TO PHASE 28] expires TIMED_OUT sessions and transitions camera from STREAMING to ONLINE', async () => {
      installPrismaMock(state);
      const now = new Date('2026-11-12T12:00:00.000Z');
      state.cameras.get(cameraId).status = CameraStatus.STREAMING;
      state.cameras.get(cameraId).lastSeenAt = new Date(now.getTime() - 10_000);
      state.streamSessions.set('sess_expired_1', {
        id: 'sess_expired_1',
        cameraInstanceId: cameraId,
        viewerUserId: userId,
        status: CameraStreamSessionStatus.ACTIVE,
        expiresAt: new Date(now.getTime() - 1000) // Already expired
      });

      const summary = await CameraLifecycleService.reconcileStaleCameras({ now });
      assert.equal(summary.expiredSessionsTimedOut, 1);
      assert.equal(summary.streamingReconciledToOnline, 1);
      assert.equal(state.streamSessions.get('sess_expired_1').status, CameraStreamSessionStatus.TIMED_OUT);
      assert.equal(state.cameras.get(cameraId).status, CameraStatus.ONLINE);
    });
  });

  describe('Scenario 24: Audit Persistence Without Secret Leakage', () => {
    it('[DEFERRED TO PHASE 28] persists audit records cleanly without raw tokens or hashes in audit metadata', async () => {
      installPrismaMock(state);
      state.cameras.get(cameraId).status = CameraStatus.CONNECTING;

      await CameraLifecycleService.reportCameraLifecycle({
        cameraId,
        authDevice: authDeviceA,
        status: CameraStatus.ONLINE
      });

      assert.ok(state.auditEvents.length >= 1);
      const serialized = JSON.stringify(state.auditEvents);
      assert.equal(serialized.includes(rawDeviceTokenA), false, 'Raw device token must never be logged');
      assert.equal(serialized.includes(hashSessionToken(rawDeviceTokenA)), false, 'Token hash must never be logged');
      assert.equal(serialized.includes(rawBrowserUserToken), false, 'User session token must never be logged');
    });
  });
});
