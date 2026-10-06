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

describe('Admin Server Operations Management (Phase 8.5)', () => {
  let app: FastifyInstance;

  // SuperAdmin user
  const superAdminEmail = `superadmin.srvops.${Date.now()}@zdexcloud.internal`;
  let superAdminUser: any;
  let superAdminToken = '';

  // Standard Admin user (with ADMIN role — has servers.read and servers.power)
  const standardAdminEmail = `admin.srvops.${Date.now()}@zdexcloud.internal`;
  let standardAdminUser: any;
  let standardAdminToken = '';

  // Support Agent user (with SUPPORT role — has servers.read, lacks servers.power)
  const supportEmail = `support.srvops.${Date.now()}@zdexcloud.internal`;
  let supportUser: any;
  let supportToken = '';

  // Unassigned Admin user (no roles)
  const unassignedEmail = `unassigned.srvops.${Date.now()}@zdexcloud.internal`;
  let unassignedUser: any;
  let unassignedToken = '';

  // Test Customer Accounts & Multi-Server Setup
  let customerUserA: any;
  let customerUserB: any;

  let deviceA1: any;
  let deviceA2: any;
  let deviceB1: any;

  let serverA1Running: any;
  let serverA2Stopped: any;
  let serverB1Stopped: any;

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
        name: 'Super Admin ServerOps',
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

    // 3. Create Standard Admin (ADMIN role has servers.read and servers.power)
    standardAdminUser = await prisma.adminUser.create({
      data: {
        email: standardAdminEmail,
        passwordHash: hashPassword('StandardAdminPass123!'),
        name: 'Standard Admin ServerOps',
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

    // 4. Create Support Agent (SUPPORT role has servers.read, lacks servers.power)
    supportUser = await prisma.adminUser.create({
      data: {
        email: supportEmail,
        passwordHash: hashPassword('SupportPass123!'),
        name: 'Support Agent ServerOps',
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
        name: 'Unassigned Admin ServerOps',
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
        email: `custA.srvops.${Date.now()}@example.com`,
        passwordHash: hashPassword('CustomerPass123!'),
        fullName: 'Customer ServerOps Alpha',
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    customerUserB = await prisma.user.create({
      data: {
        email: `custB.srvops.${Date.now()}@example.com`,
        passwordHash: hashPassword('CustomerPass123!'),
        fullName: 'Customer ServerOps Beta',
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    // 7. Create Customer Devices & Servers (Multi-server topology for User A)
    // Device A1 -> Server A1 (RUNNING)
    deviceA1 = await prisma.device.create({
      data: {
        userId: customerUserA.id,
        installationId: `inst-sa1-${Date.now()}`,
        deviceName: 'Alpha Server Phone',
        platform: 'Android',
        status: DeviceStatus.ONLINE,
        lastSeenAt: new Date()
      }
    });

    serverA1Running = await prisma.serverInstance.create({
      data: {
        deviceId: deviceA1.id,
        serverName: 'Alpha Primary Storage',
        adminUsername: 'admin_alpha1',
        adminPasswordHash: hashPassword('SecretServerPassword123!'),
        status: ServerInstanceStatus.RUNNING,
        startedAt: new Date(),
        lastHeartbeatAt: new Date()
      }
    });

    await prisma.serverEndpoint.create({
      data: {
        serverInstanceId: serverA1Running.id,
        hostname: `alpha1-${Date.now()}.zdex.cloud`,
        status: 'ACTIVE'
      }
    });

    await prisma.deviceConnection.create({
      data: {
        deviceId: deviceA1.id,
        connectionToken: 'secret-token-srv-a1',
        remoteEndpoint: 'alpha1.zdex.cloud',
        status: ConnectionStatus.CONNECTED,
        connectedAt: new Date()
      }
    });

    // Device A2 -> Server A2 (STOPPED)
    deviceA2 = await prisma.device.create({
      data: {
        userId: customerUserA.id,
        installationId: `inst-sa2-${Date.now()}`,
        deviceName: 'Alpha Backup Phone',
        platform: 'Android',
        status: DeviceStatus.OFFLINE,
        lastSeenAt: new Date(Date.now() - 3600000)
      }
    });

    serverA2Stopped = await prisma.serverInstance.create({
      data: {
        deviceId: deviceA2.id,
        serverName: 'Alpha Backup Storage',
        adminUsername: 'admin_alpha2',
        adminPasswordHash: hashPassword('SecretServerPassword456!'),
        status: ServerInstanceStatus.STOPPED
      }
    });

    // Device B1 -> Server B1 (STOPPED)
    deviceB1 = await prisma.device.create({
      data: {
        userId: customerUserB.id,
        installationId: `inst-sb1-${Date.now()}`,
        deviceName: 'Beta Server Node',
        platform: 'Android',
        status: DeviceStatus.OFFLINE
      }
    });

    serverB1Stopped = await prisma.serverInstance.create({
      data: {
        deviceId: deviceB1.id,
        serverName: 'Beta Media Storage',
        adminUsername: 'admin_beta',
        adminPasswordHash: hashPassword('SecretServerPassword789!'),
        status: ServerInstanceStatus.STOPPED
      }
    });
  });

  after(async () => {
    // Cleanup
    if (serverA1Running) {
      await prisma.serverEndpoint.deleteMany({ where: { serverInstanceId: serverA1Running.id } }).catch(() => {});
      await prisma.deviceConnection.deleteMany({ where: { deviceId: deviceA1.id } }).catch(() => {});
      await prisma.serverInstance.delete({ where: { id: serverA1Running.id } }).catch(() => {});
      await prisma.device.delete({ where: { id: deviceA1.id } }).catch(() => {});
    }
    if (serverA2Stopped) {
      await prisma.serverInstance.delete({ where: { id: serverA2Stopped.id } }).catch(() => {});
      await prisma.device.delete({ where: { id: deviceA2.id } }).catch(() => {});
    }
    if (serverB1Stopped) {
      await prisma.serverInstance.delete({ where: { id: serverB1Stopped.id } }).catch(() => {});
      await prisma.device.delete({ where: { id: deviceB1.id } }).catch(() => {});
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
    test('1.1: Reject unauthenticated requests to server list (401)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/servers'
      });
      assert.strictEqual(res.statusCode, 401);
    });

    test('1.2: Reject unauthenticated requests to server detail (401)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/operations/servers/${serverA1Running.id}`
      });
      assert.strictEqual(res.statusCode, 401);
    });

    test('1.3: Reject unauthenticated requests to server power operations (401)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/operations/servers/${serverA1Running.id}/stop`,
        payload: { reason: 'Unauthorized stop attempt' }
      });
      assert.strictEqual(res.statusCode, 401);
    });

    test('1.4: Reject unassigned admin without servers.read from listing servers (403)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/servers',
        cookies: { admin_session: unassignedToken }
      });
      assert.strictEqual(res.statusCode, 403);
    });

    test('1.5: Support agent with servers.read can list servers (200)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/servers',
        cookies: { admin_session: supportToken }
      });
      assert.strictEqual(res.statusCode, 200);
      const json = res.json();
      assert.strictEqual(json.success, true);
    });

    test('1.6: Support agent without servers.power is rejected from start/stop/restart (403)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/operations/servers/${serverA2Stopped.id}/start`,
        cookies: { admin_session: supportToken },
        payload: { reason: 'Support power attempt' }
      });
      assert.strictEqual(res.statusCode, 403);
    });
  });

  // =========================================================================
  // SUITE 2: SERVER LISTING & SAFE PAGINATION
  // =========================================================================
  describe('Suite 2: Server Listing & Safe Pagination', () => {
    test('2.1: Default pagination returns valid envelope and bounds', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/servers',
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

    test('2.2: Filter servers by status=RUNNING', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/servers?status=RUNNING',
        cookies: { admin_session: superAdminToken }
      });
      assert.strictEqual(res.statusCode, 200);
      const json = res.json();
      assert.strictEqual(json.success, true);
      json.data.items.forEach((item: any) => {
        assert.strictEqual(item.status, 'RUNNING');
      });
    });

    test('2.3: Filter servers by userId', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/operations/servers?userId=${customerUserA.id}`,
        cookies: { admin_session: superAdminToken }
      });
      assert.strictEqual(res.statusCode, 200);
      const json = res.json();
      assert.strictEqual(json.success, true);
      json.data.items.forEach((item: any) => {
        assert.strictEqual(item.userId, customerUserA.id);
      });
    });

    test('2.4: Search servers by serverName', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/servers?search=Alpha+Primary',
        cookies: { admin_session: superAdminToken }
      });
      assert.strictEqual(res.statusCode, 200);
      const json = res.json();
      assert.strictEqual(json.success, true);
      assert.ok(json.data.items.some((i: any) => i.id === serverA1Running.id));
    });

    test('2.5: Enforce maximum page size limit (100)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/servers?pageSize=500',
        cookies: { admin_session: superAdminToken }
      });
      assert.strictEqual(res.statusCode, 400);
    });
  });

  // =========================================================================
  // SUITE 3: SERVER OPERATIONAL DETAIL & PROJECTION PRIVACY
  // =========================================================================
  describe('Suite 3: Server Operational Detail Projection', () => {
    test('3.1: Retrieves comprehensive server operational metadata', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/operations/servers/${serverA1Running.id}`,
        cookies: { admin_session: superAdminToken }
      });
      assert.strictEqual(res.statusCode, 200);
      const json = res.json();
      assert.strictEqual(json.success, true);
      const srv = json.data.server;
      assert.strictEqual(srv.id, serverA1Running.id);
      assert.strictEqual(srv.serverName, 'Alpha Primary Storage');
      assert.strictEqual(srv.adminUsername, 'admin_alpha1');
      assert.strictEqual(srv.status, 'RUNNING');
      assert.strictEqual(srv.deviceId, deviceA1.id);
      assert.strictEqual(srv.device.deviceName, 'Alpha Server Phone');
      assert.strictEqual(srv.userId, customerUserA.id);
      assert.strictEqual(srv.user.email, customerUserA.email);
      assert.strictEqual(Array.isArray(srv.endpoints), true);
      assert.strictEqual(srv.endpoints.length, 1);
    });

    test('3.2: Never exposes adminPasswordHash or raw connection tokens', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/operations/servers/${serverA1Running.id}`,
        cookies: { admin_session: superAdminToken }
      });
      assert.strictEqual(res.statusCode, 200);
      const rawText = res.body;
      assert.strictEqual(rawText.includes('adminPasswordHash'), false);
      assert.strictEqual(rawText.includes('SecretServerPassword123'), false);
      assert.strictEqual(rawText.includes('connectionToken'), false);
      assert.strictEqual(rawText.includes('secret-token-srv-a1'), false);
    });
  });

  // =========================================================================
  // SUITE 4: MULTI-SERVER ISOLATION
  // =========================================================================
  describe('Suite 4: Multi-Server Isolation Invariants', () => {
    test('4.1: Starting Server A2 leaves Server A1 and Server B1 status undisturbed', async () => {
      // Start Server A2
      const startRes = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/operations/servers/${serverA2Stopped.id}/start`,
        cookies: { admin_session: standardAdminToken },
        payload: { reason: 'Multi-server isolation start verification' }
      });
      assert.strictEqual(startRes.statusCode, 200);

      // Verify Server A2 state changed
      const srvA2 = await prisma.serverInstance.findUnique({ where: { id: serverA2Stopped.id } });
      assert.ok(srvA2?.status === 'STARTING' || srvA2?.status === 'RUNNING');

      // Verify Server A1 remains RUNNING
      const srvA1 = await prisma.serverInstance.findUnique({ where: { id: serverA1Running.id } });
      assert.strictEqual(srvA1?.status, 'RUNNING');

      // Verify Server B1 remains STOPPED
      const srvB1 = await prisma.serverInstance.findUnique({ where: { id: serverB1Stopped.id } });
      assert.strictEqual(srvB1?.status, 'STOPPED');
    });
  });

  // =========================================================================
  // SUITE 5: POWER OPERATIONS (START, STOP, RESTART) & AUDIT INTEGRITY
  // =========================================================================
  describe('Suite 5: Power Operations & Audit Integrity', () => {
    test('5.1: Stop active Server A1 transitions state to STOPPED and logs SHA-256 audit', async () => {
      const stopRes = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/operations/servers/${serverA1Running.id}/stop`,
        cookies: { admin_session: standardAdminToken },
        payload: { reason: 'Administrative maintenance shutdown' }
      });
      assert.strictEqual(stopRes.statusCode, 200);

      // Verify Server A1 is STOPPED
      const srvA1 = await prisma.serverInstance.findUnique({ where: { id: serverA1Running.id } });
      assert.strictEqual(srvA1?.status, 'STOPPED');

      // Verify audit record exists with SHA-256 integrity hash
      const auditLog = await prisma.adminAuditLog.findFirst({
        where: {
          action: AdminAuditAction.ADMIN_STATUS_UPDATED,
          adminId: standardAdminUser.id
        },
        orderBy: { createdAt: 'desc' }
      });
      assert.ok(auditLog !== null);
      assert.strictEqual(typeof auditLog.integrityHash, 'string');
      assert.strictEqual(auditLog.integrityHash?.length, 64);
    });

    test('5.2: Restart stopped Server A1 returns 409 Conflict', async () => {
      const restartRes = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/operations/servers/${serverA1Running.id}/restart`,
        cookies: { admin_session: standardAdminToken },
        payload: { reason: 'Invalid restart on stopped server' }
      });
      assert.strictEqual(restartRes.statusCode, 409);
      const json = restartRes.json();
      assert.strictEqual(json.success, false);
      assert.ok(json.error.message.includes('stopped server'));
    });

    test('5.3: Start stopped Server A1 transitions state and allows subsequent restart', async () => {
      // Start Server A1
      const startRes = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/operations/servers/${serverA1Running.id}/start`,
        cookies: { admin_session: standardAdminToken },
        payload: { reason: 'Re-starting Server A1' }
      });
      assert.strictEqual(startRes.statusCode, 200);

      // Restart Server A1
      const restartRes = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/operations/servers/${serverA1Running.id}/restart`,
        cookies: { admin_session: standardAdminToken },
        payload: { reason: 'Administrative restart verification' }
      });
      assert.strictEqual(restartRes.statusCode, 200);

      const srvA1 = await prisma.serverInstance.findUnique({ where: { id: serverA1Running.id } });
      assert.strictEqual(srvA1?.status, 'STARTING');
    });
  });

  // =========================================================================
  // SUITE 6: STATE VALIDATION & CONFLICT DEFENSES
  // =========================================================================
  describe('Suite 6: State Validation & Conflict Defenses', () => {
    test('6.1: Stopping an already stopped server returns 409 Conflict', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/operations/servers/${serverB1Stopped.id}/stop`,
        cookies: { admin_session: superAdminToken },
        payload: { reason: 'Attempt duplicate stop' }
      });
      assert.strictEqual(res.statusCode, 409);
      const json = res.json();
      assert.strictEqual(json.success, false);
      assert.ok(json.error.message.includes('already stopped'));
    });
  });

  // =========================================================================
  // SUITE 7: ERROR HANDLING & PARAMETER DEFENSES
  // =========================================================================
  describe('Suite 7: Error Handling & Parameter Defenses', () => {
    test('7.1: Return 404 for unknown serverId', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/servers/cuidnonexistentserver001',
        cookies: { admin_session: superAdminToken }
      });
      assert.strictEqual(res.statusCode, 404);
    });

    test('7.2: Return 400 for malformed serverId format', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/servers/invalid-id-$$$!',
        cookies: { admin_session: superAdminToken }
      });
      assert.strictEqual(res.statusCode, 400);
    });

    test('7.3: Return 400 for invalid query sort field', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/servers?sortBy=nonexistentColumn',
        cookies: { admin_session: superAdminToken }
      });
      assert.strictEqual(res.statusCode, 400);
    });
  });

  // =========================================================================
  // SUITE 8: PHASE 17 BATCH 17.3 CANONICAL ROUTES & METRICS
  // =========================================================================
  describe('Suite 8: Phase 17 Batch 17.3 Canonical Routes & Metrics', () => {
    test('8.1: GET /api/v1/admin/servers/metrics returns aggregated metrics', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/servers/metrics',
        cookies: { admin_session: superAdminToken }
      });
      assert.strictEqual(res.statusCode, 200);
      const json = res.json();
      assert.strictEqual(json.success, true);
      assert.ok(json.data.metrics);
      assert.ok(typeof json.data.metrics.totalServers === 'number');
      assert.ok(typeof json.data.metrics.runningServers === 'number');
      assert.ok(typeof json.data.metrics.stoppedServers === 'number');
      assert.ok(typeof json.data.metrics.startingServers === 'number');
      assert.ok(typeof json.data.metrics.errorServers === 'number');
    });

    test('8.2: GET /api/v1/admin/operations/servers/metrics returns aggregated metrics', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/servers/metrics',
        cookies: { admin_session: superAdminToken }
      });
      assert.strictEqual(res.statusCode, 200);
      const json = res.json();
      assert.strictEqual(json.success, true);
      assert.ok(json.data.metrics);
    });

    test('8.3: GET /api/v1/admin/servers lists servers via canonical route', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/servers?page=1&pageSize=10',
        cookies: { admin_session: superAdminToken }
      });
      assert.strictEqual(res.statusCode, 200);
      const json = res.json();
      assert.strictEqual(json.success, true);
      assert.ok(Array.isArray(json.data.items));
    });
  });
});
