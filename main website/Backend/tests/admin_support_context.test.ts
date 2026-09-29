import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { FastifyInstance } from 'fastify';
import {
  AdminStatus,
  SupportCaseStatus,
  SupportCasePriority,
  SupportCaseCategory,
  AdminAuditAction,
  DeviceStatus,
  ServerInstanceStatus
} from '@prisma/client';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';
import {
  hashPassword,
  generateSessionToken,
  hashSessionToken
} from '../src/utils/crypto.js';
import { seedAdminRbac } from '../src/services/admin/admin_rbac_seed.js';

describe('Admin Support Customer Lookup & Diagnostics Inspector (Phase 10 — Batch 10.2)', () => {
  let app: FastifyInstance;

  // SuperAdmin user
  const superAdminEmail = `superadmin.diag.${Date.now()}@zdexcloud.internal`;
  let superAdminUser: any;
  let superAdminToken = '';

  // Support Agent user (with SUPPORT role)
  const supportEmail = `support.agent.diag.${Date.now()}@zdexcloud.internal`;
  let supportUser: any;
  let supportToken = '';

  // Unassigned Admin user (no roles)
  const unassignedEmail = `unassigned.diag.${Date.now()}@zdexcloud.internal`;
  let unassignedUser: any;
  let unassignedToken = '';

  // Test Customer
  const customerEmail = `customer.diag.${Date.now()}@zdexcloud.test`;
  let testCustomer: any;
  let testDevice: any;
  let testServer: any;
  let testCase: any;

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
        name: 'Super Admin Diag',
        status: AdminStatus.ACTIVE,
        isSuperAdmin: true
      }
    });
    superAdminToken = generateSessionToken();
    await prisma.adminSession.create({
      data: {
        adminId: superAdminUser.id,
        sessionTokenHash: hashSessionToken(superAdminToken),
        expiresAt: new Date(Date.now() + 3600000)
      }
    });

    // 3. Create Support Agent with SUPPORT role
    const supportRole = await prisma.adminRole.findUnique({ where: { slug: 'SUPPORT' } });
    supportUser = await prisma.adminUser.create({
      data: {
        email: supportEmail,
        passwordHash: hashPassword('SupportPass123!'),
        name: 'Support Agent Diag',
        status: AdminStatus.ACTIVE,
        isSuperAdmin: false
      }
    });
    if (supportRole) {
      await prisma.adminUserRole.create({
        data: {
          adminId: supportUser.id,
          roleId: supportRole.id
        }
      });
    }
    supportToken = generateSessionToken();
    await prisma.adminSession.create({
      data: {
        adminId: supportUser.id,
        sessionTokenHash: hashSessionToken(supportToken),
        expiresAt: new Date(Date.now() + 3600000)
      }
    });

    // 4. Create Unassigned Admin
    unassignedUser = await prisma.adminUser.create({
      data: {
        email: unassignedEmail,
        passwordHash: hashPassword('UnassignedPass123!'),
        name: 'Unassigned Admin Diag',
        status: AdminStatus.ACTIVE,
        isSuperAdmin: false
      }
    });
    unassignedToken = generateSessionToken();
    await prisma.adminSession.create({
      data: {
        adminId: unassignedUser.id,
        sessionTokenHash: hashSessionToken(unassignedToken),
        expiresAt: new Date(Date.now() + 3600000)
      }
    });

    // 5. Create Test Customer with Device, Server, and Support Case
    testCustomer = await prisma.user.create({
      data: {
        email: customerEmail,
        passwordHash: 'secret_hash_not_to_leak',
        fullName: 'Diagnostic Test User',
        emailVerified: true
      }
    });

    testDevice = await prisma.device.create({
      data: {
        userId: testCustomer.id,
        installationId: 'secret_installation_uuid_device',
        deviceName: 'Pixel 8 Pro Tester',
        platform: 'android',
        osVersion: 'Android 14',
        appVersion: '2.4.0',
        status: DeviceStatus.ONLINE,
        lastSeenAt: new Date()
      }
    });

    testServer = await prisma.serverInstance.create({
      data: {
        deviceId: testDevice.id,
        serverName: 'Primary Node Daemon',
        status: ServerInstanceStatus.RUNNING,
        adminPasswordHash: 'secret_server_daemon_password_hash',
        startedAt: new Date(),
        lastHeartbeatAt: new Date()
      }
    });

    testCase = await prisma.supportCase.create({
      data: {
        userId: testCustomer.id,
        caseNumber: `CS-DIAG-${Date.now().toString().slice(-4)}`,
        subject: 'Diagnostic Investigation Case',
        description: 'Testing bounded support diagnostic context aggregation.',
        category: SupportCaseCategory.GENERAL,
        priority: SupportCasePriority.NORMAL,
        status: SupportCaseStatus.OPEN
      }
    });
  });

  after(async () => {
    // Clean up test data
    if (testCase) await prisma.supportCase.deleteMany({ where: { userId: testCustomer.id } });
    if (testServer && testDevice) await prisma.serverInstance.deleteMany({ where: { deviceId: testDevice.id } });
    if (testDevice) await prisma.device.deleteMany({ where: { userId: testCustomer.id } });
    if (testCustomer) await prisma.user.deleteMany({ where: { id: testCustomer.id } });

    if (superAdminUser) {
      await prisma.adminSession.deleteMany({ where: { adminId: superAdminUser.id } });
      await prisma.adminAuditLog.deleteMany({ where: { adminId: superAdminUser.id } });
      await prisma.adminUser.delete({ where: { id: superAdminUser.id } });
    }
    if (supportUser) {
      await prisma.adminSession.deleteMany({ where: { adminId: supportUser.id } });
      await prisma.adminUserRole.deleteMany({ where: { adminId: supportUser.id } });
      await prisma.adminAuditLog.deleteMany({ where: { adminId: supportUser.id } });
      await prisma.adminUser.delete({ where: { id: supportUser.id } });
    }
    if (unassignedUser) {
      await prisma.adminSession.deleteMany({ where: { adminId: unassignedUser.id } });
      await prisma.adminAuditLog.deleteMany({ where: { adminId: unassignedUser.id } });
      await prisma.adminUser.delete({ where: { id: unassignedUser.id } });
    }

    await app.close();
  });

  // --- 1. Customer Directory & Lookup Endpoints ---
  describe('Customer Directory Lookup (GET /api/v1/admin/operations/support/customers)', () => {
    test('Should return 401 when unauthenticated', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/support/customers'
      });
      assert.strictEqual(res.statusCode, 401);
    });

    test('Should return 403 when admin lacks support.read permission', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/support/customers',
        headers: {
          authorization: `Bearer ${unassignedToken}`
        }
      });
      assert.strictEqual(res.statusCode, 403);
    });

    test('Should return 200 and paginated list for Support Agent', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/support/customers?page=1&pageSize=10',
        headers: {
          authorization: `Bearer ${supportToken}`
        }
      });
      assert.strictEqual(res.statusCode, 200);
      const json = res.json();
      assert.strictEqual(json.success, true);
      assert.ok(Array.isArray(json.data.items));
      assert.ok(json.data.total >= 1);
    });

    test('Should filter customers by search query and record audit log', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/operations/support/customers?search=${encodeURIComponent(customerEmail)}`,
        headers: {
          authorization: `Bearer ${supportToken}`
        }
      });
      assert.strictEqual(res.statusCode, 200);
      const json = res.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.data.items.length, 1);
      assert.strictEqual(json.data.items[0].email, customerEmail);
      assert.strictEqual(json.data.items[0].deviceCount, 1);
      assert.strictEqual(json.data.items[0].serverCount, 1);

      // Verify audit log
      const audit = await prisma.adminAuditLog.findFirst({
        where: {
          adminId: supportUser.id,
          action: AdminAuditAction.ADMIN_SUPPORT_CUSTOMER_SEARCHED
        }
      });
      assert.ok(audit, 'ADMIN_SUPPORT_CUSTOMER_SEARCHED audit log must exist');
    });
  });

  // --- 2. Customer Diagnostic Context Aggregator ---
  describe('Customer Diagnostic Context (GET /api/v1/admin/operations/support/customers/:userId/context)', () => {
    test('Should return 401 when unauthenticated', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/operations/support/customers/${testCustomer.id}/context`
      });
      assert.strictEqual(res.statusCode, 401);
    });

    test('Should return 403 when admin lacks support.read permission', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/operations/support/customers/${testCustomer.id}/context`,
        headers: {
          authorization: `Bearer ${unassignedToken}`
        }
      });
      assert.strictEqual(res.statusCode, 403);
    });

    test('Should return 404 if customer does not exist', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/support/customers/cuid_non_existent_123456/context',
        headers: {
          authorization: `Bearer ${supportToken}`
        }
      });
      assert.strictEqual(res.statusCode, 404);
    });

    test('Should return 200 with bounded diagnostic projections and record audit log', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/operations/support/customers/${testCustomer.id}/context`,
        headers: {
          authorization: `Bearer ${supportToken}`
        }
      });
      assert.strictEqual(res.statusCode, 200);
      const json = res.json();
      assert.strictEqual(json.success, true);
      const ctx = json.data;

      // 1. User Identity checks
      assert.strictEqual(ctx.user.id, testCustomer.id);
      assert.strictEqual(ctx.user.email, customerEmail);
      assert.strictEqual(ctx.user.fullName, 'Diagnostic Test User');
      assert.strictEqual(ctx.user.passwordHash, undefined, 'passwordHash must never be exposed');
      assert.strictEqual(ctx.user.otps, undefined, 'otps must never be exposed');
      assert.strictEqual(ctx.user.sessions, undefined, 'sessions must never be exposed');

      // 2. Hardware / Device checks
      assert.strictEqual(ctx.devices.length, 1);
      assert.strictEqual(ctx.devices[0].id, testDevice.id);
      assert.strictEqual(ctx.devices[0].deviceName, 'Pixel 8 Pro Tester');
      assert.strictEqual(ctx.devices[0].installationId, undefined, 'installationId must never be exposed');

      // 3. Server Instance checks
      assert.strictEqual(ctx.servers.length, 1);
      assert.strictEqual(ctx.servers[0].id, testServer.id);
      assert.strictEqual(ctx.servers[0].serverName, 'Primary Node Daemon');
      assert.strictEqual(ctx.servers[0].adminPasswordHash, undefined, 'adminPasswordHash must never be exposed');

      // 4. Support Case summary checks
      assert.ok(ctx.supportCases);
      assert.ok(ctx.supportCases.totalCases >= 1);
      assert.ok(ctx.supportCases.recentCases.length >= 1);
      assert.strictEqual(ctx.supportCases.recentCases[0].subject, 'Diagnostic Investigation Case');

      // 5. Zero File Data checks
      assert.strictEqual((ctx as any).files, undefined, 'Customer files must never be aggregated or exposed');
      assert.strictEqual((ctx as any).directoryTree, undefined, 'Customer directories must never be aggregated');

      // 6. Verify audit log
      const audit = await prisma.adminAuditLog.findFirst({
        where: {
          adminId: supportUser.id,
          action: AdminAuditAction.ADMIN_SUPPORT_CUSTOMER_CONTEXT_VIEWED
        }
      });
      assert.ok(audit, 'ADMIN_SUPPORT_CUSTOMER_CONTEXT_VIEWED audit log must exist');
    });
  });
});
