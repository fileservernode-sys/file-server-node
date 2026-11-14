/**
 * ZDEXCLOUD — PHASE 20.6.3 TEST SUITE
 * CAMERA ADMIN RBAC & READ-ONLY ADMINISTRATION APIS
 *
 * Execution Policy: WRITE-ONLY. ZERO TESTS EXECUTED.
 * Test Execution Status: NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28
 *
 * Covers all 5 Phase 20.6.3 verification domains:
 *  1. Admin Authentication & Session Guards (unauthenticated, invalid token, inactive admin, expired session)
 *  2. RBAC Permission Enforcement & Least-Privilege Role Matrix (SUPER_ADMIN, ADMIN, SUPPORT, OPERATIONS, no-role)
 *  3. Endpoint Contract & Validation Rules (/metrics, /cameras, /:cameraId, /sessions, /audit-events, /usage, pagination, filters, 404s)
 *  4. Data Sanitization & Secret Exclusion (no tokens, hashes, SDP, ICE, connectionToken, sessionTokenHash, sanitized metadata)
 *  5. Read-Only Invariance & Audit Safety (zero database mutations, rejection audit logging)
 */

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'mysql://test:test@localhost:3306/zdexcloud_test';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import {
  AdminStatus,
  AdminAuditAction,
  CameraStatus,
  CameraStreamSessionStatus,
  CameraSubscriptionStatus,
  CameraAuditActorType,
  CameraAuditResult
} from '@prisma/client';

import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';
import {
  hashPassword,
  generateSessionToken,
  hashSessionToken
} from '../src/utils/crypto.js';
import {
  seedAdminRbac,
  SYSTEM_PERMISSIONS,
  SYSTEM_ROLES
} from '../src/services/admin/admin_rbac_seed.js';
import { AdminCameraService } from '../src/routes/admin/operations/cameras/service.js';

describe('Phase 20.6.3 — Camera Admin RBAC & Read-Only Administration APIs [NOT RUN — DEFERRED UNTIL PHASE 28]', () => {
  let app: FastifyInstance;

  // Test admin identities
  const superAdminEmail = `superadmin.camops.${Date.now()}@zdexcloud.internal`;
  let superAdminUser: any;
  let superAdminToken = '';

  const standardAdminEmail = `admin.camops.${Date.now()}@zdexcloud.internal`;
  let standardAdminUser: any;
  let standardAdminToken = '';

  const supportEmail = `support.camops.${Date.now()}@zdexcloud.internal`;
  let supportUser: any;
  let supportToken = '';

  const operationsEmail = `ops.camops.${Date.now()}@zdexcloud.internal`;
  let operationsUser: any;
  let operationsToken = '';

  const unassignedEmail = `unassigned.camops.${Date.now()}@zdexcloud.internal`;
  let unassignedUser: any;
  let unassignedToken = '';

  const suspendedEmail = `suspended.camops.${Date.now()}@zdexcloud.internal`;
  let suspendedUser: any;
  let suspendedToken = '';

  // Test fixture data
  let customerUser: any;
  let viewerUser: any;
  let edgeDevice: any;
  let testCamera: any;
  let secondCamera: any;
  let testEndpoint: any;
  let testSession: any;
  let testAuditEvent: any;
  let testSubscription: any;
  let testUsageRecord: any;

  before(async () => {
    app = await buildApp();
    await app.ready();

    // 1. Seed RBAC permissions and roles
    await seedAdminRbac();

    // 2. Fetch role entities
    const adminRole = await prisma.adminRole.findUniqueOrThrow({ where: { slug: 'ADMIN' } });
    const supportRole = await prisma.adminRole.findUniqueOrThrow({ where: { slug: 'SUPPORT' } });
    const opsRole = await prisma.adminRole.findUniqueOrThrow({ where: { slug: 'OPERATIONS' } });

    // 3. Create SuperAdmin
    superAdminUser = await prisma.adminUser.create({
      data: {
        email: superAdminEmail,
        passwordHash: hashPassword('SuperAdminSecret123!'),
        name: 'Super Admin CamOps',
        status: AdminStatus.ACTIVE,
        isSuperAdmin: true
      }
    });
    superAdminToken = generateSessionToken();
    await prisma.adminSession.create({
      data: {
        adminId: superAdminUser.id,
        sessionTokenHash: hashSessionToken(superAdminToken),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });

    // 4. Create Standard Admin (ADMIN role)
    standardAdminUser = await prisma.adminUser.create({
      data: {
        email: standardAdminEmail,
        passwordHash: hashPassword('AdminSecret123!'),
        name: 'Standard Admin CamOps',
        status: AdminStatus.ACTIVE,
        isSuperAdmin: false,
        userRoles: {
          create: { roleId: adminRole.id }
        }
      }
    });
    standardAdminToken = generateSessionToken();
    await prisma.adminSession.create({
      data: {
        adminId: standardAdminUser.id,
        sessionTokenHash: hashSessionToken(standardAdminToken),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });

    // 5. Create Support Agent (SUPPORT role)
    supportUser = await prisma.adminUser.create({
      data: {
        email: supportEmail,
        passwordHash: hashPassword('SupportSecret123!'),
        name: 'Support Agent CamOps',
        status: AdminStatus.ACTIVE,
        isSuperAdmin: false,
        userRoles: {
          create: { roleId: supportRole.id }
        }
      }
    });
    supportToken = generateSessionToken();
    await prisma.adminSession.create({
      data: {
        adminId: supportUser.id,
        sessionTokenHash: hashSessionToken(supportToken),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });

    // 6. Create Operations Engineer (OPERATIONS role)
    operationsUser = await prisma.adminUser.create({
      data: {
        email: operationsEmail,
        passwordHash: hashPassword('OpsSecret123!'),
        name: 'Ops Engineer CamOps',
        status: AdminStatus.ACTIVE,
        isSuperAdmin: false,
        userRoles: {
          create: { roleId: opsRole.id }
        }
      }
    });
    operationsToken = generateSessionToken();
    await prisma.adminSession.create({
      data: {
        adminId: operationsUser.id,
        sessionTokenHash: hashSessionToken(operationsToken),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });

    // 7. Create Unassigned Admin (no roles)
    unassignedUser = await prisma.adminUser.create({
      data: {
        email: unassignedEmail,
        passwordHash: hashPassword('UnassignedSecret123!'),
        name: 'Unassigned Admin',
        status: AdminStatus.ACTIVE,
        isSuperAdmin: false
      }
    });
    unassignedToken = generateSessionToken();
    await prisma.adminSession.create({
      data: {
        adminId: unassignedUser.id,
        sessionTokenHash: hashSessionToken(unassignedToken),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });

    // 8. Create Suspended Admin
    suspendedUser = await prisma.adminUser.create({
      data: {
        email: suspendedEmail,
        passwordHash: hashPassword('SuspendedSecret123!'),
        name: 'Suspended Admin',
        status: AdminStatus.SUSPENDED,
        isSuperAdmin: false
      }
    });
    suspendedToken = generateSessionToken();
    await prisma.adminSession.create({
      data: {
        adminId: suspendedUser.id,
        sessionTokenHash: hashSessionToken(suspendedToken),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });

    // 9. Fixture Customer & Device
    customerUser = await prisma.user.create({
      data: {
        email: `customer.camops.${Date.now()}@zdexcloud.test`,
        passwordHash: hashPassword('CustomerPass123!'),
        name: 'Test Customer CamOps'
      }
    });

    viewerUser = await prisma.user.create({
      data: {
        email: `viewer.camops.${Date.now()}@zdexcloud.test`,
        passwordHash: hashPassword('ViewerPass123!'),
        name: 'Test Viewer CamOps'
      }
    });

    edgeDevice = await prisma.device.create({
      data: {
        userId: customerUser.id,
        deviceName: 'Pixel 8 Cam Edge',
        deviceModel: 'Pixel 8',
        installationId: `inst-${Date.now()}`,
        status: 'ONLINE'
      }
    });

    // 10. Fixture Cameras
    testCamera = await prisma.cameraInstance.create({
      data: {
        userId: customerUser.id,
        deviceId: edgeDevice.id,
        cameraName: 'Front Porch Camera',
        serialNumber: `SN-FPC-${Date.now()}`,
        model: 'PixelCam Pro',
        firmwareVersion: 'v2.4.1',
        status: CameraStatus.ONLINE,
        lastSeenAt: new Date(),
        metadata: {
          resolution: '1080p',
          fps: 30,
          internalTokenTest: 'cvt_secret_token_12345',
          signalingDebug: 'sdp: v=0\r\no=alice...'
        }
      }
    });

    secondCamera = await prisma.cameraInstance.create({
      data: {
        userId: customerUser.id,
        deviceId: edgeDevice.id,
        cameraName: 'Backyard Camera',
        serialNumber: `SN-BYC-${Date.now()}`,
        status: CameraStatus.OFFLINE
      }
    });

    testEndpoint = await prisma.cameraEndpoint.create({
      data: {
        cameraId: testCamera.id,
        endpointType: 'WEBRTC',
        signalingUrl: 'wss://signaling.zdexcloud.internal/ws/v1/camera/signaling',
        connectionToken: 'zdc_secret_connection_token_99999',
        tokenHash: 'hashed_token_value_abc123',
        isActive: true
      }
    });

    testSubscription = await prisma.cameraSubscription.create({
      data: {
        cameraId: testCamera.id,
        userId: customerUser.id,
        tier: 'PRO_CLOUD',
        status: CameraSubscriptionStatus.ACTIVE,
        maxResolution: '1080p',
        maxFps: 30,
        cloudRecordingEnabled: true,
        aiDetectionEnabled: false
      }
    });

    testSession = await prisma.cameraStreamSession.create({
      data: {
        cameraId: testCamera.id,
        viewerUserId: viewerUser.id,
        sessionTokenHash: 'hash_of_viewing_token_xyz890',
        status: CameraStreamSessionStatus.ACTIVE,
        startedAt: new Date(),
        bytesTransferred: BigInt(10485760), // 10MB
        durationSeconds: 120
      }
    });

    testAuditEvent = await prisma.cameraAccessAuditEvent.create({
      data: {
        cameraId: testCamera.id,
        userId: viewerUser.id,
        actorType: CameraAuditActorType.USER,
        eventType: 'VIEWER_SESSION_STARTED',
        action: 'STREAM_VIEW',
        result: CameraAuditResult.SUCCESS,
        metadata: {
          clientIp: '192.168.1.50',
          viewingToken: 'cvt_secret_viewing_token_456'
        }
      }
    });

    testUsageRecord = await prisma.cameraUsageRecord.create({
      data: {
        cameraId: testCamera.id,
        userId: customerUser.id,
        category: 'STREAMING_SECONDS',
        quantity: BigInt(7200),
        unit: 'seconds',
        periodStart: new Date(Date.now() - 86400000),
        periodEnd: new Date()
      }
    });
  });

  after(async () => {
    // Cleanup fixtures safely
    if (app) {
      await app.close();
    }
  });

  // =========================================================================
  // DOMAIN 1: ADMIN AUTHENTICATION & SESSION GUARDS
  // =========================================================================
  describe('Domain 1: Admin Authentication & Session Guards', () => {

    it('[DEFERRED TO PHASE 28] rejects unauthenticated requests with 401 across all camera admin endpoints', async () => {
      const endpoints = [
        '/api/v1/admin/cameras/metrics',
        '/api/v1/admin/cameras',
        `/api/v1/admin/cameras/${testCamera.id}`,
        `/api/v1/admin/cameras/${testCamera.id}/sessions`,
        `/api/v1/admin/cameras/${testCamera.id}/audit-events`,
        `/api/v1/admin/cameras/${testCamera.id}/usage`
      ];

      for (const endpoint of endpoints) {
        const res = await app.inject({
          method: 'GET',
          url: endpoint
        });
        assert.equal(res.statusCode, 401, `Endpoint ${endpoint} must require admin authentication`);
        const json = res.json();
        assert.equal(json.success, false);
      }
    });

    it('[DEFERRED TO PHASE 28] rejects invalid or forged session tokens with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/cameras',
        headers: {
          authorization: 'Bearer forged_session_token_12345'
        }
      });
      assert.equal(res.statusCode, 401);
      assert.equal(res.json().success, false);
    });

    it('[DEFERRED TO PHASE 28] rejects expired admin sessions with 401', async () => {
      const expiredToken = generateSessionToken();
      await prisma.adminSession.create({
        data: {
          adminId: standardAdminUser.id,
          sessionTokenHash: hashSessionToken(expiredToken),
          expiresAt: new Date(Date.now() - 3600000) // 1 hour ago
        }
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/cameras',
        headers: {
          authorization: `Bearer ${expiredToken}`
        }
      });
      assert.equal(res.statusCode, 401);
    });

    it('[DEFERRED TO PHASE 28] rejects suspended or inactive admin accounts with 403', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/cameras',
        headers: {
          authorization: `Bearer ${suspendedToken}`
        }
      });
      assert.equal(res.statusCode, 403);
      assert.match(res.json().error.message, /Account is not active/i);
    });
  });

  // =========================================================================
  // DOMAIN 2: RBAC PERMISSION ENFORCEMENT & LEAST-PRIVILEGE ROLE MATRIX
  // =========================================================================
  describe('Domain 2: RBAC Permission Enforcement & Least-Privilege Role Matrix', () => {

    it('[DEFERRED TO PHASE 28] verifies system seed contains all 4 camera admin permissions', () => {
      const permSlugs = SYSTEM_PERMISSIONS.map(p => p.slug);
      assert.ok(permSlugs.includes('cameras.view'));
      assert.ok(permSlugs.includes('cameras.sessions.view'));
      assert.ok(permSlugs.includes('cameras.audit.view'));
      assert.ok(permSlugs.includes('cameras.usage.view'));
    });

    it('[DEFERRED TO PHASE 28] SUPER_ADMIN has full access to all 6 camera administration endpoints', async () => {
      const endpoints = [
        '/api/v1/admin/cameras/metrics',
        '/api/v1/admin/cameras',
        `/api/v1/admin/cameras/${testCamera.id}`,
        `/api/v1/admin/cameras/${testCamera.id}/sessions`,
        `/api/v1/admin/cameras/${testCamera.id}/audit-events`,
        `/api/v1/admin/cameras/${testCamera.id}/usage`
      ];

      for (const endpoint of endpoints) {
        const res = await app.inject({
          method: 'GET',
          url: endpoint,
          headers: { authorization: `Bearer ${superAdminToken}` }
        });
        assert.equal(res.statusCode, 200, `SUPER_ADMIN must access ${endpoint}`);
        assert.equal(res.json().success, true);
      }
    });

    it('[DEFERRED TO PHASE 28] ADMIN role has full read access to all 6 camera administration endpoints', async () => {
      const endpoints = [
        '/api/v1/admin/cameras/metrics',
        '/api/v1/admin/cameras',
        `/api/v1/admin/cameras/${testCamera.id}`,
        `/api/v1/admin/cameras/${testCamera.id}/sessions`,
        `/api/v1/admin/cameras/${testCamera.id}/audit-events`,
        `/api/v1/admin/cameras/${testCamera.id}/usage`
      ];

      for (const endpoint of endpoints) {
        const res = await app.inject({
          method: 'GET',
          url: endpoint,
          headers: { authorization: `Bearer ${standardAdminToken}` }
        });
        assert.equal(res.statusCode, 200, `ADMIN must access ${endpoint}`);
        assert.equal(res.json().success, true);
      }
    });

    it('[DEFERRED TO PHASE 28] SUPPORT role can access cameras and usage, but is FORBIDDEN from sessions and audit trails', async () => {
      // Allowed: cameras.view
      const resMetrics = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/cameras/metrics',
        headers: { authorization: `Bearer ${supportToken}` }
      });
      assert.equal(resMetrics.statusCode, 200);

      const resList = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/cameras',
        headers: { authorization: `Bearer ${supportToken}` }
      });
      assert.equal(resList.statusCode, 200);

      const resDetail = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/cameras/${testCamera.id}`,
        headers: { authorization: `Bearer ${supportToken}` }
      });
      assert.equal(resDetail.statusCode, 200);

      // Allowed: cameras.usage.view
      const resUsage = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/cameras/${testCamera.id}/usage`,
        headers: { authorization: `Bearer ${supportToken}` }
      });
      assert.equal(resUsage.statusCode, 200);

      // Denied: cameras.sessions.view
      const resSessions = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/cameras/${testCamera.id}/sessions`,
        headers: { authorization: `Bearer ${supportToken}` }
      });
      assert.equal(resSessions.statusCode, 403, 'SUPPORT must be forbidden from camera stream sessions');
      assert.equal(resSessions.json().error.code, 'FORBIDDEN');

      // Denied: cameras.audit.view
      const resAudit = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/cameras/${testCamera.id}/audit-events`,
        headers: { authorization: `Bearer ${supportToken}` }
      });
      assert.equal(resAudit.statusCode, 403, 'SUPPORT must be forbidden from camera access audit events');
      assert.equal(resAudit.json().error.code, 'FORBIDDEN');
    });

    it('[DEFERRED TO PHASE 28] OPERATIONS role can access cameras, sessions, and audit trails, but is FORBIDDEN from usage records', async () => {
      // Allowed: cameras.view
      const resList = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/cameras',
        headers: { authorization: `Bearer ${operationsToken}` }
      });
      assert.equal(resList.statusCode, 200);

      // Allowed: cameras.sessions.view
      const resSessions = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/cameras/${testCamera.id}/sessions`,
        headers: { authorization: `Bearer ${operationsToken}` }
      });
      assert.equal(resSessions.statusCode, 200);

      // Allowed: cameras.audit.view
      const resAudit = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/cameras/${testCamera.id}/audit-events`,
        headers: { authorization: `Bearer ${operationsToken}` }
      });
      assert.equal(resAudit.statusCode, 200);

      // Denied: cameras.usage.view
      const resUsage = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/cameras/${testCamera.id}/usage`,
        headers: { authorization: `Bearer ${operationsToken}` }
      });
      assert.equal(resUsage.statusCode, 403, 'OPERATIONS must be forbidden from commercial usage records');
      assert.equal(resUsage.json().error.code, 'FORBIDDEN');
    });

    it('[DEFERRED TO PHASE 28] Admin with no assigned roles is rejected with 403 across all endpoints', async () => {
      const endpoints = [
        '/api/v1/admin/cameras/metrics',
        '/api/v1/admin/cameras',
        `/api/v1/admin/cameras/${testCamera.id}`,
        `/api/v1/admin/cameras/${testCamera.id}/sessions`,
        `/api/v1/admin/cameras/${testCamera.id}/audit-events`,
        `/api/v1/admin/cameras/${testCamera.id}/usage`
      ];

      for (const endpoint of endpoints) {
        const res = await app.inject({
          method: 'GET',
          url: endpoint,
          headers: { authorization: `Bearer ${unassignedToken}` }
        });
        assert.equal(res.statusCode, 403, `Unassigned admin must be rejected for ${endpoint}`);
      }
    });

    it('[DEFERRED TO PHASE 28] RBAC rejection generates an ADMIN_AUTHZ_DENIED audit log entry', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/cameras/${testCamera.id}/sessions`,
        headers: { authorization: `Bearer ${supportToken}` }
      });
      assert.equal(res.statusCode, 403);

      const deniedAudit = await prisma.adminAuditLog.findFirst({
        where: {
          adminId: supportUser.id,
          action: AdminAuditAction.ADMIN_AUTHZ_DENIED
        },
        orderBy: { createdAt: 'desc' }
      });
      assert.ok(deniedAudit, 'Denial audit event must be persisted');
      assert.equal((deniedAudit?.details as any)?.requiredPermission, 'cameras.sessions.view');
    });
  });

  // =========================================================================
  // DOMAIN 3: ENDPOINT CONTRACT, VALIDATION, PAGINATION & FILTERING
  // =========================================================================
  describe('Domain 3: Endpoint Contract, Validation, Pagination & Filtering', () => {

    it('[DEFERRED TO PHASE 28] GET /metrics returns aggregated status counts and process telemetry', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/cameras/metrics',
        headers: { authorization: `Bearer ${superAdminToken}` }
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.success, true);
      assert.ok(body.data.byStatus);
      assert.ok(typeof body.data.byStatus.ONLINE === 'number');
      assert.ok(typeof body.data.byStatus.OFFLINE === 'number');
      assert.ok(body.data.signaling);
      assert.ok(body.data.worker);
      assert.ok(body.data.timestamp);
    });

    it('[DEFERRED TO PHASE 28] GET /cameras paginates and filters by status, user, and search query', async () => {
      // 1. Filter by status
      const resOnline = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/cameras?status=ONLINE',
        headers: { authorization: `Bearer ${superAdminToken}` }
      });
      assert.equal(resOnline.statusCode, 200);
      const onlineBody = resOnline.json();
      assert.ok(onlineBody.items.every((c: any) => c.status === 'ONLINE'));

      // 2. Search by name
      const resSearch = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/cameras?search=Front+Porch',
        headers: { authorization: `Bearer ${superAdminToken}` }
      });
      assert.equal(resSearch.statusCode, 200);
      assert.ok(resSearch.json().items.some((c: any) => c.cameraName === 'Front Porch Camera'));

      // 3. Pagination bounds
      const resPaged = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/cameras?page=1&pageSize=1',
        headers: { authorization: `Bearer ${superAdminToken}` }
      });
      assert.equal(resPaged.statusCode, 200);
      assert.equal(resPaged.json().items.length, 1);
      assert.equal(resPaged.json().pagination.pageSize, 1);
      assert.ok(resPaged.json().pagination.total >= 2);
    });

    it('[DEFERRED TO PHASE 28] GET /cameras rejects invalid filter values and enforces max page size', async () => {
      // Invalid status enum
      const resInvalidStatus = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/cameras?status=INVALID_STATUS_VALUE',
        headers: { authorization: `Bearer ${superAdminToken}` }
      });
      assert.equal(resInvalidStatus.statusCode, 400);

      // Page size exceeding 100
      const resExcessiveSize = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/cameras?pageSize=500',
        headers: { authorization: `Bearer ${superAdminToken}` }
      });
      assert.equal(resExcessiveSize.statusCode, 400);
    });

    it('[DEFERRED TO PHASE 28] GET /:cameraId returns detail with user, device, subscription, and session count', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/cameras/${testCamera.id}`,
        headers: { authorization: `Bearer ${superAdminToken}` }
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.success, true);
      assert.equal(body.data.id, testCamera.id);
      assert.equal(body.data.cameraName, 'Front Porch Camera');
      assert.ok(body.data.user);
      assert.equal(body.data.user.email, customerUser.email);
      assert.ok(body.data.device);
      assert.equal(body.data.device.deviceName, 'Pixel 8 Cam Edge');
      assert.ok(body.data.subscription);
      assert.equal(body.data.subscription.tier, 'PRO_CLOUD');
      assert.ok(body.data.sessionCounts);
    });

    it('[DEFERRED TO PHASE 28] GET /:cameraId returns 404 for non-existent camera ID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/cameras/non-existent-camera-id-99999',
        headers: { authorization: `Bearer ${superAdminToken}` }
      });
      assert.equal(res.statusCode, 404);
      assert.equal(res.json().error.code, 'NOT_FOUND');
    });

    it('[DEFERRED TO PHASE 28] GET /:cameraId/sessions lists stream sessions and returns 404 for missing camera', async () => {
      // Valid camera sessions
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/cameras/${testCamera.id}/sessions`,
        headers: { authorization: `Bearer ${superAdminToken}` }
      });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.success, true);
      assert.ok(Array.isArray(body.items));
      assert.equal(body.items[0].id, testSession.id);
      assert.equal(typeof body.items[0].bytesTransferred, 'number');

      // Missing camera
      const resMissing = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/cameras/non-existent-camera-id-99999/sessions',
        headers: { authorization: `Bearer ${superAdminToken}` }
      });
      assert.equal(resMissing.statusCode, 404);
    });

    it('[DEFERRED TO PHASE 28] GET /:cameraId/audit-events lists access audit events and returns 404 for missing camera', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/cameras/${testCamera.id}/audit-events`,
        headers: { authorization: `Bearer ${superAdminToken}` }
      });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.success, true);
      assert.ok(Array.isArray(body.items));
      assert.equal(body.items[0].id, testAuditEvent.id);
      assert.equal(body.items[0].eventType, 'VIEWER_SESSION_STARTED');

      // Missing camera
      const resMissing = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/cameras/non-existent-camera-id-99999/audit-events',
        headers: { authorization: `Bearer ${superAdminToken}` }
      });
      assert.equal(resMissing.statusCode, 404);
    });

    it('[DEFERRED TO PHASE 28] GET /:cameraId/usage lists usage records and returns aggregated summary', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/cameras/${testCamera.id}/usage`,
        headers: { authorization: `Bearer ${superAdminToken}` }
      });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.success, true);
      assert.ok(Array.isArray(body.items));
      assert.equal(body.items[0].category, 'STREAMING_SECONDS');
      assert.equal(typeof body.items[0].quantity, 'number');
      assert.ok(body.summary);
      assert.equal(typeof body.summary.STREAMING_SECONDS, 'number');
      assert.equal(body.summary.STREAMING_SECONDS, 7200);

      // Missing camera
      const resMissing = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/cameras/non-existent-camera-id-99999/usage',
        headers: { authorization: `Bearer ${superAdminToken}` }
      });
      assert.equal(resMissing.statusCode, 404);
    });
  });

  // =========================================================================
  // DOMAIN 4: DATA SANITIZATION & SECRET EXCLUSION
  // =========================================================================
  describe('Domain 4: Data Sanitization & Secret Exclusion', () => {

    it('[DEFERRED TO PHASE 28] camera detail endpoints never expose connection tokens, hashes, or signaling URLs', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/cameras/${testCamera.id}`,
        headers: { authorization: `Bearer ${superAdminToken}` }
      });
      const rawText = res.body;

      // Ensure secret fields and values are nowhere in the serialized JSON
      assert.equal(rawText.includes('zdc_secret_connection_token_99999'), false, 'Raw connection token must not be serialized');
      assert.equal(rawText.includes('hashed_token_value_abc123'), false, 'Token hash must not be serialized');
      assert.equal(rawText.includes('signalingUrl'), false, 'Signaling URL must not be serialized');
      assert.equal(rawText.includes('connectionToken'), false, 'connectionToken key must not be present');
      assert.equal(rawText.includes('tokenHash'), false, 'tokenHash key must not be present');
    });

    it('[DEFERRED TO PHASE 28] stream sessions endpoint never exposes sessionTokenHash, SDP, or ICE candidates', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/cameras/${testCamera.id}/sessions`,
        headers: { authorization: `Bearer ${superAdminToken}` }
      });
      const rawText = res.body;

      assert.equal(rawText.includes('hash_of_viewing_token_xyz890'), false, 'Session token hash must never be serialized');
      assert.equal(rawText.includes('sessionTokenHash'), false, 'sessionTokenHash key must not be present');
      assert.equal(rawText.includes('sdp'), false);
      assert.equal(rawText.includes('iceCandidate'), false);
    });

    it('[DEFERRED TO PHASE 28] camera metadata and audit event metadata are scrubbed of token prefixes and sensitive keys', async () => {
      // 1. Check camera detail metadata
      const resCam = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/cameras/${testCamera.id}`,
        headers: { authorization: `Bearer ${superAdminToken}` }
      });
      const camBody = resCam.json();
      assert.equal(camBody.data.metadata.internalTokenTest, '[REDACTED_TOKEN]');
      assert.ok(
        camBody.data.metadata.signalingDebug === '[REDACTED_SDP]' ||
        camBody.data.metadata.signalingDebug === '[REDACTED]'
      );

      // 2. Check audit events metadata
      const resAudit = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/cameras/${testCamera.id}/audit-events`,
        headers: { authorization: `Bearer ${superAdminToken}` }
      });
      const auditBody = resAudit.json();
      assert.equal(auditBody.items[0].metadata.viewingToken, '[REDACTED_TOKEN]');
      assert.equal(auditBody.items[0].metadata.clientIp, '192.168.1.50');
    });

    it('[DEFERRED TO PHASE 28] BigInt database fields are converted to numbers without serialization errors', async () => {
      const resSession = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/cameras/${testCamera.id}/sessions`,
        headers: { authorization: `Bearer ${superAdminToken}` }
      });
      const session = resSession.json().items[0];
      assert.equal(typeof session.bytesTransferred, 'number');
      assert.equal(session.bytesTransferred, 10485760);

      const resUsage = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/cameras/${testCamera.id}/usage`,
        headers: { authorization: `Bearer ${superAdminToken}` }
      });
      const usage = resUsage.json().items[0];
      assert.equal(typeof usage.quantity, 'number');
      assert.equal(usage.quantity, 7200);
    });
  });

  // =========================================================================
  // DOMAIN 5: READ-ONLY INVARIANCE & AUDIT SAFETY
  // =========================================================================
  describe('Domain 5: Read-Only Invariance & Audit Safety', () => {

    it('[DEFERRED TO PHASE 28] verifies that camera administration contains zero state-mutating HTTP methods', async () => {
      const mutateMethods: ('POST' | 'PUT' | 'PATCH' | 'DELETE')[] = ['POST', 'PUT', 'PATCH', 'DELETE'];
      const endpoints = [
        '/api/v1/admin/cameras',
        `/api/v1/admin/cameras/${testCamera.id}`,
        `/api/v1/admin/cameras/${testCamera.id}/sessions`,
        `/api/v1/admin/cameras/${testCamera.id}/audit-events`,
        `/api/v1/admin/cameras/${testCamera.id}/usage`
      ];

      for (const endpoint of endpoints) {
        for (const method of mutateMethods) {
          const res = await app.inject({
            method,
            url: endpoint,
            headers: { authorization: `Bearer ${superAdminToken}` }
          });
          // Non-existent route handler must return 404 (Route not found)
          assert.equal(res.statusCode, 404, `Mutating method ${method} on ${endpoint} must not exist`);
        }
      }
    });

    it('[DEFERRED TO PHASE 28] executing read queries produces zero database mutations in camera records', async () => {
      const camBefore = await prisma.cameraInstance.findUniqueOrThrow({ where: { id: testCamera.id } });

      await app.inject({
        method: 'GET',
        url: `/api/v1/admin/cameras/${testCamera.id}`,
        headers: { authorization: `Bearer ${superAdminToken}` }
      });

      const camAfter = await prisma.cameraInstance.findUniqueOrThrow({ where: { id: testCamera.id } });
      assert.equal(camBefore.updatedAt.getTime(), camAfter.updatedAt.getTime(), 'Read query must not mutate updatedAt');
      assert.equal(camBefore.status, camAfter.status, 'Read query must not mutate camera status');
    });
  });
});
