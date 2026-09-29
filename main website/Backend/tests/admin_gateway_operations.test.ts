import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { FastifyInstance } from 'fastify';
import { AdminStatus, AdminAuditAction, GatewayStatus, ConnectionStatus, DeviceStatus } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';
import {
  hashPassword,
  generateSessionToken,
  hashSessionToken
} from '../src/utils/crypto.js';
import { seedAdminRbac } from '../src/services/admin/admin_rbac_seed.js';

describe('Admin Gateway Operations & Telemetry (Phase 8.6)', () => {
  let app: FastifyInstance;

  // SuperAdmin user
  const superAdminEmail = `superadmin.gwops.${Date.now()}@zdexcloud.internal`;
  let superAdminUser: any;
  let superAdminToken = '';

  // Standard Admin user (with ADMIN role - has gateway.read, gateway.write, gateway.drain)
  const standardAdminEmail = `admin.gwops.${Date.now()}@zdexcloud.internal`;
  let standardAdminUser: any;
  let standardAdminToken = '';

  // Support Agent user (with SUPPORT role - lacks gateway.read, gateway.write, gateway.drain)
  const supportEmail = `support.gwops.${Date.now()}@zdexcloud.internal`;
  let supportUser: any;
  let supportToken = '';

  // Unassigned Admin user (no roles)
  const unassignedEmail = `unassigned.gwops.${Date.now()}@zdexcloud.internal`;
  let unassignedUser: any;
  let unassignedToken = '';

  // Test Customer Accounts, Devices & Gateway Nodes
  let customerUser: any;
  let testDeviceA: any;
  let testDeviceB: any;
  let gatewayNodeA: any;
  let gatewayNodeB: any;
  let connectionA: any;
  let connectionB: any;

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
        name: 'Super Admin GatewayOps',
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

    // 3. Create Standard Admin (ADMIN role has gateway.read, gateway.write, gateway.drain)
    standardAdminUser = await prisma.adminUser.create({
      data: {
        email: standardAdminEmail,
        passwordHash: hashPassword('StandardAdminPass123!'),
        name: 'Standard Admin GatewayOps',
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

    // 4. Create Support Agent (SUPPORT role lacks gateway permissions)
    supportUser = await prisma.adminUser.create({
      data: {
        email: supportEmail,
        passwordHash: hashPassword('SupportPass123!'),
        name: 'Support Agent GatewayOps',
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
        name: 'Unassigned Admin GatewayOps',
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

    // 6. Create Customer & Devices
    customerUser = await prisma.user.create({
      data: {
        email: `cust.gwops.${Date.now()}@example.com`,
        passwordHash: hashPassword('CustomerPass123!'),
        fullName: 'Customer GatewayOps',
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    testDeviceA = await prisma.device.create({
      data: {
        userId: customerUser.id,
        installationId: `inst-gwa-${Date.now()}`,
        deviceName: 'Gateway Test Device Alpha',
        platform: 'Android',
        status: DeviceStatus.ONLINE,
        lastSeenAt: new Date()
      }
    });

    testDeviceB = await prisma.device.create({
      data: {
        userId: customerUser.id,
        installationId: `inst-gwb-${Date.now()}`,
        deviceName: 'Gateway Test Device Beta',
        platform: 'Android',
        status: DeviceStatus.ONLINE,
        lastSeenAt: new Date()
      }
    });

    // 7. Create Gateway Nodes (Node A and Node B for multi-node testing)
    gatewayNodeA = await prisma.gatewayNode.create({
      data: {
        hostname: `gw-node-a-${Date.now()}.zdex.cloud`,
        region: 'us-east-1',
        status: GatewayStatus.ACTIVE,
        lastHeartbeatAt: new Date()
      }
    });

    gatewayNodeB = await prisma.gatewayNode.create({
      data: {
        hostname: `gw-node-b-${Date.now()}.zdex.cloud`,
        region: 'eu-west-1',
        status: GatewayStatus.ACTIVE,
        lastHeartbeatAt: new Date()
      }
    });

    // 8. Create Device Connections on Nodes
    connectionA = await prisma.deviceConnection.create({
      data: {
        deviceId: testDeviceA.id,
        gatewayNodeId: gatewayNodeA.id,
        connectionToken: 'secret-token-gw-a-12345',
        remoteEndpoint: 'alpha.node.zdex.cloud',
        status: ConnectionStatus.CONNECTED,
        connectedAt: new Date()
      }
    });

    connectionB = await prisma.deviceConnection.create({
      data: {
        deviceId: testDeviceB.id,
        gatewayNodeId: gatewayNodeB.id,
        connectionToken: 'secret-token-gw-b-67890',
        remoteEndpoint: 'beta.node.zdex.cloud',
        status: ConnectionStatus.CONNECTED,
        connectedAt: new Date()
      }
    });
  });

  after(async () => {
    // Cleanup
    if (connectionA) await prisma.deviceConnection.delete({ where: { id: connectionA.id } }).catch(() => {});
    if (connectionB) await prisma.deviceConnection.delete({ where: { id: connectionB.id } }).catch(() => {});
    if (testDeviceA) await prisma.device.delete({ where: { id: testDeviceA.id } }).catch(() => {});
    if (testDeviceB) await prisma.device.delete({ where: { id: testDeviceB.id } }).catch(() => {});
    if (gatewayNodeA) await prisma.gatewayNode.delete({ where: { id: gatewayNodeA.id } }).catch(() => {});
    if (gatewayNodeB) await prisma.gatewayNode.delete({ where: { id: gatewayNodeB.id } }).catch(() => {});
    if (customerUser) await prisma.user.delete({ where: { id: customerUser.id } }).catch(() => {});
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
    test('1.1: Reject unauthenticated requests across gateway endpoints (401)', async () => {
      const resNodes = await app.inject({ method: 'GET', url: '/api/v1/admin/operations/gateway/nodes' });
      assert.strictEqual(resNodes.statusCode, 401);

      const resDetail = await app.inject({ method: 'GET', url: `/api/v1/admin/operations/gateway/nodes/${gatewayNodeA.id}` });
      assert.strictEqual(resDetail.statusCode, 401);

      const resConns = await app.inject({ method: 'GET', url: '/api/v1/admin/operations/gateway/connections' });
      assert.strictEqual(resConns.statusCode, 401);

      const resTelemetry = await app.inject({ method: 'GET', url: '/api/v1/admin/operations/gateway/telemetry' });
      assert.strictEqual(resTelemetry.statusCode, 401);

      const resDiag = await app.inject({ method: 'GET', url: '/api/v1/admin/operations/gateway/diagnostics' });
      assert.strictEqual(resDiag.statusCode, 401);

      const resDrain = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/operations/gateway/nodes/${gatewayNodeA.id}/drain`,
        payload: { reason: 'Unauthorized drain' }
      });
      assert.strictEqual(resDrain.statusCode, 401);
    });

    test('1.2: Reject support agent without gateway.read from viewing nodes (403)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/gateway/nodes',
        cookies: { admin_session: supportToken }
      });
      assert.strictEqual(res.statusCode, 403);
    });

    test('1.3: Reject support agent without gateway.read from viewing telemetry (403)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/gateway/telemetry',
        cookies: { admin_session: supportToken }
      });
      assert.strictEqual(res.statusCode, 403);
    });

    test('1.4: Standard admin with gateway.read can view nodes and telemetry (200)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/gateway/nodes',
        cookies: { admin_session: standardAdminToken }
      });
      assert.strictEqual(res.statusCode, 200);
      const json = res.json();
      assert.strictEqual(json.success, true);
    });
  });

  // =========================================================================
  // SUITE 2: GATEWAY NODE LISTING & SAFE PAGINATION
  // =========================================================================
  describe('Suite 2: Gateway Node Listing & Safe Pagination', () => {
    test('2.1: Default pagination returns valid envelope and bounds', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/gateway/nodes',
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

    test('2.2: Filter gateway nodes by status=ACTIVE', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/gateway/nodes?status=ACTIVE',
        cookies: { admin_session: superAdminToken }
      });
      assert.strictEqual(res.statusCode, 200);
      const json = res.json();
      assert.strictEqual(json.success, true);
      json.data.items.forEach((item: any) => {
        assert.strictEqual(item.status, 'ACTIVE');
      });
    });

    test('2.3: Search gateway nodes by hostname', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/operations/gateway/nodes?search=${gatewayNodeA.hostname.slice(0, 8)}`,
        cookies: { admin_session: superAdminToken }
      });
      assert.strictEqual(res.statusCode, 200);
      const json = res.json();
      assert.strictEqual(json.success, true);
      assert.ok(json.data.items.some((n: any) => n.id === gatewayNodeA.id));
    });

    test('2.4: Enforce max page size (100)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/gateway/nodes?pageSize=500',
        cookies: { admin_session: superAdminToken }
      });
      assert.strictEqual(res.statusCode, 400);
    });
  });

  // =========================================================================
  // SUITE 3: GATEWAY NODE DETAIL & PRIVACY
  // =========================================================================
  describe('Suite 3: Gateway Node Detail & Safe Projections', () => {
    test('3.1: Retrieves comprehensive gateway node metadata', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/operations/gateway/nodes/${gatewayNodeA.id}`,
        cookies: { admin_session: superAdminToken }
      });
      assert.strictEqual(res.statusCode, 200);
      const json = res.json();
      assert.strictEqual(json.success, true);
      const node = json.data.node;
      assert.strictEqual(node.id, gatewayNodeA.id);
      assert.strictEqual(node.hostname, gatewayNodeA.hostname);
      assert.strictEqual(node.region, 'us-east-1');
      assert.strictEqual(node.status, 'ACTIVE');
      assert.strictEqual(Array.isArray(node.activeConnections), true);
      assert.ok(node.activeConnectionCount >= 1);
      assert.strictEqual(typeof node.health.isHealthy, 'boolean');
    });

    test('3.2: Never exposes connection tokens or customer secrets', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/operations/gateway/nodes/${gatewayNodeA.id}`,
        cookies: { admin_session: superAdminToken }
      });
      assert.strictEqual(res.statusCode, 200);
      const rawText = res.body;
      assert.strictEqual(rawText.includes('connectionToken'), false);
      assert.strictEqual(rawText.includes('secret-token-gw-a'), false);
    });
  });

  // =========================================================================
  // SUITE 4: ACTIVE CONNECTION TELEMETRY
  // =========================================================================
  describe('Suite 4: Active Connection Telemetry', () => {
    test('4.1: Lists connection records with safe pagination', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/gateway/connections',
        cookies: { admin_session: superAdminToken }
      });
      assert.strictEqual(res.statusCode, 200);
      const json = res.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(typeof json.data.total, 'number');
      assert.strictEqual(Array.isArray(json.data.items), true);
    });

    test('4.2: Filter connections by gatewayNodeId', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/operations/gateway/connections?gatewayNodeId=${gatewayNodeA.id}`,
        cookies: { admin_session: superAdminToken }
      });
      assert.strictEqual(res.statusCode, 200);
      const json = res.json();
      assert.strictEqual(json.success, true);
      json.data.items.forEach((c: any) => {
        assert.strictEqual(c.gatewayNodeId, gatewayNodeA.id);
      });
    });
  });

  // =========================================================================
  // SUITE 5: AGGREGATED TELEMETRY & DIAGNOSTICS
  // =========================================================================
  describe('Suite 5: Aggregated Telemetry & Diagnostics', () => {
    test('5.1: Aggregated telemetry returns database totals and runtime metrics', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/gateway/telemetry',
        cookies: { admin_session: superAdminToken }
      });
      assert.strictEqual(res.statusCode, 200);
      const json = res.json();
      assert.strictEqual(json.success, true);
      const t = json.data.telemetry;
      assert.strictEqual(typeof t.totalGatewayNodes, 'number');
      assert.strictEqual(typeof t.activeGatewayNodes, 'number');
      assert.strictEqual(typeof t.totalActiveConnections, 'number');
      assert.strictEqual(typeof t.runtimeTelemetry.uptimeSeconds, 'number');
    });

    test('5.2: Diagnostics returns safe infrastructure summary without secrets', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/gateway/diagnostics',
        cookies: { admin_session: superAdminToken }
      });
      assert.strictEqual(res.statusCode, 200);
      const json = res.json();
      assert.strictEqual(json.success, true);
      const diag = json.data.diagnostics;
      assert.strictEqual(typeof diag.gatewayProcessStatus, 'string');
      assert.strictEqual(typeof diag.controlPlaneConnected, 'boolean');
      assert.strictEqual(typeof diag.connectionStateDistribution, 'object');
      assert.strictEqual(Array.isArray(diag.nodeHealthBreakdown), true);
    });
  });

  // =========================================================================
  // SUITE 6: GATEWAY NODE DRAIN & MULTI-NODE ISOLATION
  // =========================================================================
  describe('Suite 6: Gateway Node Drain & Multi-Node Isolation', () => {
    test('6.1: Draining Node A sets status to MAINTENANCE and disconnects connections on Node A', async () => {
      const drainRes = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/operations/gateway/nodes/${gatewayNodeA.id}/drain`,
        cookies: { admin_session: standardAdminToken },
        payload: { reason: 'Scheduled cluster node maintenance' }
      });
      assert.strictEqual(drainRes.statusCode, 200);
      const json = drainRes.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.data.node.status, 'MAINTENANCE');

      // Verify Node A in DB is MAINTENANCE
      const dbNodeA = await prisma.gatewayNode.findUnique({ where: { id: gatewayNodeA.id } });
      assert.strictEqual(dbNodeA?.status, GatewayStatus.MAINTENANCE);

      // Verify Connection on Node A marked DISCONNECTED
      const dbConnA = await prisma.deviceConnection.findUnique({ where: { id: connectionA.id } });
      assert.strictEqual(dbConnA?.status, ConnectionStatus.DISCONNECTED);

      // Verify Node B is STILL ACTIVE and UNTOUCHED (Multi-Node Isolation)
      const dbNodeB = await prisma.gatewayNode.findUnique({ where: { id: gatewayNodeB.id } });
      assert.strictEqual(dbNodeB?.status, GatewayStatus.ACTIVE);

      const dbConnB = await prisma.deviceConnection.findUnique({ where: { id: connectionB.id } });
      assert.strictEqual(dbConnB?.status, ConnectionStatus.CONNECTED);
    });

    test('6.2: Duplicate drain on already maintenance node returns 409 Conflict', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/operations/gateway/nodes/${gatewayNodeA.id}/drain`,
        cookies: { admin_session: standardAdminToken },
        payload: { reason: 'Duplicate drain attempt' }
      });
      assert.strictEqual(res.statusCode, 409);
      const json = res.json();
      assert.strictEqual(json.success, false);
      assert.ok(json.error.message.includes('maintenance'));
    });

    test('6.3: Audit event recorded for node drain with SHA-256 integrity hash', async () => {
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
  });

  // =========================================================================
  // SUITE 7: GATEWAY NODE RESTORE
  // =========================================================================
  describe('Suite 7: Gateway Node Restore', () => {
    test('7.1: Restoring drained Node A returns status to ACTIVE', async () => {
      const restoreRes = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/operations/gateway/nodes/${gatewayNodeA.id}/restore`,
        cookies: { admin_session: standardAdminToken },
        payload: { reason: 'Maintenance completed' }
      });
      assert.strictEqual(restoreRes.statusCode, 200);
      const json = restoreRes.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.data.node.status, 'ACTIVE');

      const dbNodeA = await prisma.gatewayNode.findUnique({ where: { id: gatewayNodeA.id } });
      assert.strictEqual(dbNodeA?.status, GatewayStatus.ACTIVE);
    });

    test('7.2: Restoring an already active node returns 409 Conflict', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/operations/gateway/nodes/${gatewayNodeA.id}/restore`,
        cookies: { admin_session: standardAdminToken },
        payload: { reason: 'Duplicate restore attempt' }
      });
      assert.strictEqual(res.statusCode, 409);
      const json = res.json();
      assert.strictEqual(json.success, false);
      assert.ok(json.error.message.includes('already active'));
    });
  });

  // =========================================================================
  // SUITE 8: ERROR HANDLING & PARAMETER DEFENSES
  // =========================================================================
  describe('Suite 8: Error Handling & Parameter Defenses', () => {
    test('8.1: Return 404 for unknown gatewayNodeId', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/gateway/nodes/cuidnonexistentnode0001',
        cookies: { admin_session: superAdminToken }
      });
      assert.strictEqual(res.statusCode, 404);
    });

    test('8.2: Return 400 for malformed gatewayNodeId format', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/gateway/nodes/invalid-id-$$$!',
        cookies: { admin_session: superAdminToken }
      });
      assert.strictEqual(res.statusCode, 400);
    });

    test('8.3: Return 400 for invalid sort field', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/gateway/nodes?sortBy=invalidColumn',
        cookies: { admin_session: superAdminToken }
      });
      assert.strictEqual(res.statusCode, 400);
    });
  });
});
