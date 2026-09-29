import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { FastifyInstance } from 'fastify';
import { AdminStatus, AdminAuditAction, DeviceStatus, ConnectionStatus, ServerInstanceStatus } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';
import {
  hashPassword,
  generateSessionToken,
  hashSessionToken
} from '../src/utils/crypto.js';
import { seedAdminRbac } from '../src/services/admin/admin_rbac_seed.js';

describe('Admin Device Operations Management (Phase 8.4)', () => {
  let app: FastifyInstance;

  // SuperAdmin user
  const superAdminEmail = `superadmin.devops.${Date.now()}@zdexcloud.internal`;
  let superAdminUser: any;
  let superAdminToken = '';

  // Standard Admin user (with ADMIN role - has devices.read and devices.disconnect)
  const standardAdminEmail = `admin.devops.${Date.now()}@zdexcloud.internal`;
  let standardAdminUser: any;
  let standardAdminToken = '';

  // Support Agent user (with SUPPORT role — has devices.read, lacks devices.disconnect)
  const supportEmail = `support.devops.${Date.now()}@zdexcloud.internal`;
  let supportUser: any;
  let supportToken = '';

  // Unassigned Admin user (no roles)
  const unassignedEmail = `unassigned.devops.${Date.now()}@zdexcloud.internal`;
  let unassignedUser: any;
  let unassignedToken = '';

  // Test Customer Accounts & Devices
  let customerUserA: any;
  let customerUserB: any;
  let deviceA1Online: any;
  let deviceA2Online: any;
  let deviceB1Offline: any;

  before(async () => {
    app = await buildApp();
    await app.ready();

    // 1. Seed RBAC
    await seedAdminRbac();

    // 2. Create SuperAdmin
    superAdminUser = await prisma.adminUser.create({
      data: {
        email: superAdminEmail,
        passwordHash: hashPassword('SuperAdminPass123!'),
        name: 'Super Admin DeviceOps',
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

    // 3. Create Standard Admin (ADMIN role has devices.read and devices.disconnect)
    standardAdminUser = await prisma.adminUser.create({
      data: {
        email: standardAdminEmail,
        passwordHash: hashPassword('StandardAdminPass123!'),
        name: 'Standard Admin DeviceOps',
        status: AdminStatus.ACTIVE,
        isSuperAdmin: false
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
    const adminRole = await prisma.adminRole.findUnique({ where: { slug: 'ADMIN' } });
    if (adminRole) {
      await prisma.adminUserRole.create({
        data: { adminId: standardAdminUser.id, roleId: adminRole.id }
      });
    }

    // 4. Create Support Agent (SUPPORT role has devices.read, lacks devices.disconnect)
    supportUser = await prisma.adminUser.create({
      data: {
        email: supportEmail,
        passwordHash: hashPassword('SupportPass123!'),
        name: 'Support Agent DeviceOps',
        status: AdminStatus.ACTIVE,
        isSuperAdmin: false
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
    const supportRole = await prisma.adminRole.findUnique({ where: { slug: 'SUPPORT' } });
    if (supportRole) {
      await prisma.adminUserRole.create({
        data: { adminId: supportUser.id, roleId: supportRole.id }
      });
    }

    // 5. Create Unassigned Admin
    unassignedUser = await prisma.adminUser.create({
      data: {
        email: unassignedEmail,
        passwordHash: hashPassword('UnassignedPass123!'),
        name: 'Unassigned Admin DeviceOps',
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

    // 6. Create Customer Accounts
    customerUserA = await prisma.user.create({
      data: {
        email: `custA.devops.${Date.now()}@example.com`,
        passwordHash: hashPassword('CustomerPass123!'),
        fullName: 'Customer DeviceOps Alpha',
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    customerUserB = await prisma.user.create({
      data: {
        email: `custB.devops.${Date.now()}@example.com`,
        passwordHash: hashPassword('CustomerPass123!'),
        fullName: 'Customer DeviceOps Beta',
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    // 7. Create Customer Devices
    // Device A1: Online with active connection and running server
    deviceA1Online = await prisma.device.create({
      data: {
        userId: customerUserA.id,
        installationId: `inst-a1-${Date.now()}`,
        deviceName: 'Pixel 8 Pro Alpha',
        platform: 'Android',
        osVersion: '14.0',
        appVersion: '2.1.0',
        status: DeviceStatus.ONLINE,
        lastSeenAt: new Date()
      }
    });

    await prisma.deviceConnection.create({
      data: {
        deviceId: deviceA1Online.id,
        connectionToken: 'secret-token-a1-1234567890',
        remoteEndpoint: 'pixel8-alpha.zdex.cloud',
        status: ConnectionStatus.CONNECTED,
        connectedAt: new Date()
      }
    });

    const serverInstanceA1 = await prisma.serverInstance.create({
      data: {
        deviceId: deviceA1Online.id,
        serverName: 'Pixel Media Server',
        adminUsername: 'admin_pixel',
        adminPasswordHash: hashPassword('SecretServerPasswordHash!'),
        status: ServerInstanceStatus.RUNNING,
        startedAt: new Date()
      }
    });

    await prisma.serverEndpoint.create({
      data: {
        serverInstanceId: serverInstanceA1.id,
        hostname: `pixel8-alpha-${Date.now()}.zdex.cloud`,
        status: 'ACTIVE'
      }
    });

    // Device A2: Online second device belonging to User A
    deviceA2Online = await prisma.device.create({
      data: {
        userId: customerUserA.id,
        installationId: `inst-a2-${Date.now()}`,
        deviceName: 'Galaxy Tab S9 Alpha',
        platform: 'Android',
        osVersion: '13.0',
        appVersion: '2.0.5',
        status: DeviceStatus.ONLINE,
        lastSeenAt: new Date()
      }
    });

    await prisma.deviceConnection.create({
      data: {
        deviceId: deviceA2Online.id,
        connectionToken: 'secret-token-a2-9876543210',
        remoteEndpoint: 'tab9-alpha.zdex.cloud',
        status: ConnectionStatus.CONNECTED,
        connectedAt: new Date()
      }
    });

    // Device B1: Offline device belonging to User B
    deviceB1Offline = await prisma.device.create({
      data: {
        userId: customerUserB.id,
        installationId: `inst-b1-${Date.now()}`,
        deviceName: 'OnePlus 12 Beta',
        platform: 'Android',
        osVersion: '14.0',
        appVersion: '2.1.0',
        status: DeviceStatus.OFFLINE,
        lastSeenAt: new Date(Date.now() - 3600000)
      }
    });
  });

  after(async () => {
    // Cleanup
    if (deviceA1Online) {
      await prisma.serverEndpoint.deleteMany({ where: { serverInstance: { deviceId: deviceA1Online.id } } }).catch(() => {});
      await prisma.serverInstance.deleteMany({ where: { deviceId: deviceA1Online.id } }).catch(() => {});
      await prisma.deviceConnection.deleteMany({ where: { deviceId: deviceA1Online.id } }).catch(() => {});
      await prisma.device.delete({ where: { id: deviceA1Online.id } }).catch(() => {});
    }
    if (deviceA2Online) {
      await prisma.deviceConnection.deleteMany({ where: { deviceId: deviceA2Online.id } }).catch(() => {});
      await prisma.device.delete({ where: { id: deviceA2Online.id } }).catch(() => {});
    }
    if (deviceB1Offline) {
      await prisma.deviceConnection.deleteMany({ where: { deviceId: deviceB1Offline.id } }).catch(() => {});
      await prisma.device.delete({ where: { id: deviceB1Offline.id } }).catch(() => {});
    }
    if (customerUserA) await prisma.user.delete({ where: { id: customerUserA.id } }).catch(() => {});
    if (customerUserB) await prisma.user.delete({ where: { id: customerUserB.id } }).catch(() => {});
    if (superAdminUser) await prisma.adminUser.delete({ where: { id: superAdminUser.id } }).catch(() => {});
    if (standardAdminUser) await prisma.adminUser.delete({ where: { id: standardAdminUser.id } }).catch(() => {});
    if (supportUser) await prisma.adminUser.delete({ where: { id: supportUser.id } }).catch(() => {});
    if (unassignedUser) await prisma.adminUser.delete({ where: { id: unassignedUser.id } }).catch(() => {});
    await app.close();
  });

  // =========================================================================
  // SUITE 1: AUTHENTICATION & AUTHORIZATION GATES
  // =========================================================================
  describe('Suite 1: Authentication & Authorization Gates', () => {
    test('1.1: Reject unauthenticated requests to device list (401)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/devices'
      });
      assert.strictEqual(res.statusCode, 401);
    });

    test('1.2: Reject unauthenticated requests to device detail (401)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/operations/devices/${deviceA1Online.id}`
      });
      assert.strictEqual(res.statusCode, 401);
    });

    test('1.3: Reject unauthenticated requests to device disconnect (401)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/operations/devices/${deviceA1Online.id}/disconnect`,
        payload: { reason: 'Test unauthorized' }
      });
      assert.strictEqual(res.statusCode, 401);
    });

    test('1.4: Reject unassigned admin without devices.read from listing devices (403)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/devices',
        cookies: { admin_session: unassignedToken }
      });
      assert.strictEqual(res.statusCode, 403);
    });

    test('1.5: Support agent with devices.read can list devices (200)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/devices',
        cookies: { admin_session: supportToken }
      });
      assert.strictEqual(res.statusCode, 200);
      const json = res.json();
      assert.strictEqual(json.success, true);
    });

    test('1.6: Support agent without devices.disconnect is rejected from disconnect (403)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/operations/devices/${deviceA1Online.id}/disconnect`,
        cookies: { admin_session: supportToken },
        payload: { reason: 'Support disconnect attempt' }
      });
      assert.strictEqual(res.statusCode, 403);
    });

    test('1.7: Standard admin with devices.disconnect can proceed', async () => {
      // Validated in Suite 5
    });
  });

  // =========================================================================
  // SUITE 2: DEVICE LISTING & SAFE PAGINATION
  // =========================================================================
  describe('Suite 2: Device Listing & Safe Pagination', () => {
    test('2.1: Default pagination returns valid envelope and bounds', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/devices',
        cookies: { admin_session: superAdminToken }
      });
      assert.strictEqual(res.statusCode, 200);
      const json = res.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(typeof json.data.total, 'number');
      assert.strictEqual(json.data.page, 1);
      assert.strictEqual(json.data.pageSize, 25);
      assert.strictEqual(Array.isArray(json.data.items), true);
    });

    test('2.2: Filter devices by status=ONLINE', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/devices?status=ONLINE',
        cookies: { admin_session: superAdminToken }
      });
      assert.strictEqual(res.statusCode, 200);
      const json = res.json();
      assert.strictEqual(json.success, true);
      json.data.items.forEach((item: any) => {
        assert.strictEqual(item.status, 'ONLINE');
      });
    });

    test('2.3: Filter devices by userId', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/operations/devices?userId=${customerUserA.id}`,
        cookies: { admin_session: superAdminToken }
      });
      assert.strictEqual(res.statusCode, 200);
      const json = res.json();
      assert.strictEqual(json.success, true);
      json.data.items.forEach((item: any) => {
        assert.strictEqual(item.userId, customerUserA.id);
      });
    });

    test('2.4: Search devices by deviceName', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/devices?search=Pixel+8+Pro',
        cookies: { admin_session: superAdminToken }
      });
      assert.strictEqual(res.statusCode, 200);
      const json = res.json();
      assert.strictEqual(json.success, true);
      assert.ok(json.data.items.some((i: any) => i.id === deviceA1Online.id));
    });

    test('2.5: Enforce maximum page size limit (100)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/devices?pageSize=500',
        cookies: { admin_session: superAdminToken }
      });
      assert.strictEqual(res.statusCode, 400);
    });
  });

  // =========================================================================
  // SUITE 3: DEVICE OPERATIONAL DETAIL & PROJECTION PRIVACY
  // =========================================================================
  describe('Suite 3: Device Operational Detail Projection', () => {
    test('3.1: Retrieves comprehensive device operational metadata', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/operations/devices/${deviceA1Online.id}`,
        cookies: { admin_session: superAdminToken }
      });
      assert.strictEqual(res.statusCode, 200);
      const json = res.json();
      assert.strictEqual(json.success, true);
      const dev = json.data.device;
      assert.strictEqual(dev.id, deviceA1Online.id);
      assert.strictEqual(dev.userId, customerUserA.id);
      assert.strictEqual(dev.user.email, customerUserA.email);
      assert.strictEqual(dev.deviceName, 'Pixel 8 Pro Alpha');
      assert.strictEqual(dev.platform, 'Android');
      assert.strictEqual(dev.status, 'ONLINE');
      assert.strictEqual(Array.isArray(dev.servers), true);
      assert.strictEqual(dev.servers.length, 1);
      assert.strictEqual(dev.servers[0].serverName, 'Pixel Media Server');
      assert.strictEqual(dev.servers[0].status, 'RUNNING');
      assert.strictEqual(dev.servers[0].endpoints.length, 1);
      assert.ok(dev.activeConnection !== null);
      assert.strictEqual(dev.activeConnection.status, 'CONNECTED');
    });

    test('3.2: Never exposes server instance passwords or connection tokens', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/operations/devices/${deviceA1Online.id}`,
        cookies: { admin_session: superAdminToken }
      });
      assert.strictEqual(res.statusCode, 200);
      const rawText = res.body;
      assert.strictEqual(rawText.includes('adminPasswordHash'), false);
      assert.strictEqual(rawText.includes('SecretServerPasswordHash'), false);
      assert.strictEqual(rawText.includes('connectionToken'), false);
      assert.strictEqual(rawText.includes('secret-token-a1'), false);
    });
  });

  // =========================================================================
  // SUITE 4: MULTI-DEVICE ISOLATION
  // =========================================================================
  describe('Suite 4: Multi-Device Isolation Invariants', () => {
    test('4.1: Disconnecting Device A1 leaves Device A2 for the same user strictly ONLINE', async () => {
      // Disconnect Device A1
      const disconnectRes = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/operations/devices/${deviceA1Online.id}/disconnect`,
        cookies: { admin_session: standardAdminToken },
        payload: { reason: 'Multi-device isolation verification' }
      });
      assert.strictEqual(disconnectRes.statusCode, 200);

      // Verify Device A1 state is now OFFLINE
      const devA1 = await prisma.device.findUnique({ where: { id: deviceA1Online.id } });
      assert.strictEqual(devA1?.status, 'OFFLINE');

      // Verify Device A2 (same user) remains ONLINE and active
      const devA2 = await prisma.device.findUnique({ where: { id: deviceA2Online.id } });
      assert.strictEqual(devA2?.status, 'ONLINE');

      const connA2 = await prisma.deviceConnection.findFirst({
        where: { deviceId: deviceA2Online.id }
      });
      assert.strictEqual(connA2?.status, 'CONNECTED');
    });
  });

  // =========================================================================
  // SUITE 5: DEVICE DISCONNECTION & AUDIT INTEGRITY
  // =========================================================================
  describe('Suite 5: Device Disconnection & Audit Integrity', () => {
    test('5.1: Device disconnection marks active connections DISCONNECTED and records audit event', async () => {
      // Verify audit event exists with SHA-256 chained hash
      const auditRecord = await prisma.adminAuditLog.findFirst({
        where: {
          action: AdminAuditAction.ADMIN_STATUS_UPDATED,
          adminId: standardAdminUser.id
        },
        orderBy: { createdAt: 'desc' }
      });

      assert.ok(auditRecord !== null);
      assert.strictEqual(auditRecord.action, AdminAuditAction.ADMIN_STATUS_UPDATED);
      assert.strictEqual(auditRecord.adminId, standardAdminUser.id);
      assert.strictEqual(typeof auditRecord.integrityHash, 'string');
      assert.strictEqual(auditRecord.integrityHash?.length, 64);
    });

    test('5.2: Disconnected device has all active connections marked DISCONNECTED', async () => {
      const activeConnections = await prisma.deviceConnection.findMany({
        where: {
          deviceId: deviceA1Online.id,
          status: 'CONNECTED'
        }
      });
      assert.strictEqual(activeConnections.length, 0);

      const disconnConnections = await prisma.deviceConnection.findMany({
        where: {
          deviceId: deviceA1Online.id,
          status: 'DISCONNECTED'
        }
      });
      assert.ok(disconnConnections.length >= 1);
    });
  });

  // =========================================================================
  // SUITE 6: STATE VALIDATION & CONFLICT HANDLING
  // =========================================================================
  describe('Suite 6: State Validation & Conflict Handling', () => {
    test('6.1: Reject disconnecting an already offline device (409 Conflict)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/operations/devices/${deviceB1Offline.id}/disconnect`,
        cookies: { admin_session: superAdminToken },
        payload: { reason: 'Attempt offline disconnect' }
      });
      assert.strictEqual(res.statusCode, 409);
      const json = res.json();
      assert.strictEqual(json.success, false);
      assert.ok(json.error.message.includes('already offline'));
    });
  });

  // =========================================================================
  // SUITE 7: ERROR HANDLING & VALIDATION DEFENSES
  // =========================================================================
  describe('Suite 7: Error Handling & Validation Defenses', () => {
    test('7.1: Return 404 for unknown deviceId', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/devices/cuidnonexistentdevice0001',
        cookies: { admin_session: superAdminToken }
      });
      assert.strictEqual(res.statusCode, 404);
    });

    test('7.2: Return 400 for invalid deviceId format', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/devices/invalid--id--$$$',
        cookies: { admin_session: superAdminToken }
      });
      assert.strictEqual(res.statusCode, 400);
    });

    test('7.3: Return 400 for invalid sort parameter', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/devices?sortBy=nonexistentColumn',
        cookies: { admin_session: superAdminToken }
      });
      assert.strictEqual(res.statusCode, 400);
    });
  });
});
