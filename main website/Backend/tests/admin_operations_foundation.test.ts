import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { FastifyInstance } from 'fastify';
import { AdminStatus, AdminAuditAction } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';
import {
  hashPassword,
  generateSessionToken,
  hashSessionToken
} from '../src/utils/crypto.js';
import { seedAdminRbac, SYSTEM_PERMISSIONS } from '../src/services/admin/admin_rbac_seed.js';
import { AdminRbacService } from '../src/services/admin/admin_rbac_service.js';
import {
  uuidSchema,
  cuidSchema,
  paginationQuerySchema,
  createPaginatedResponse,
  assertAdminCanOperateOnResource,
  executeAdminOperation
} from '../src/routes/admin/operations/index.js';

describe('Admin Operations Architecture & Middleware Foundation (Phase 8.2)', () => {
  let app: FastifyInstance;

  // SuperAdmin user
  const superAdminEmail = `superadmin.ops.${Date.now()}@zdexcloud.internal`;
  let superAdminUser: any;
  let superAdminToken = '';

  // Standard Admin user (with ADMIN role)
  const standardAdminEmail = `admin.ops.${Date.now()}@zdexcloud.internal`;
  let standardAdminUser: any;
  let standardAdminToken = '';

  // Operations Engineer (with OPERATIONS role)
  const opsEngineerEmail = `ops.ops.${Date.now()}@zdexcloud.internal`;
  let opsEngineerUser: any;
  let opsEngineerToken = '';

  // Support Agent user (with SUPPORT role)
  const supportEmail = `support.ops.${Date.now()}@zdexcloud.internal`;
  let supportUser: any;
  let supportToken = '';

  // Unassigned Admin user (no roles)
  const unassignedEmail = `unassigned.ops.${Date.now()}@zdexcloud.internal`;
  let unassignedUser: any;
  let unassignedToken = '';

  // Customer user
  const customerEmail = `customer.ops.${Date.now()}@zdexcloud.com`;
  let customerUser: any;
  let customerToken = '';

  before(async () => {
    app = await buildApp();
    await app.ready();

    // 1. Seed RBAC System Roles & Permissions (including Phase 8.2 permissions)
    await seedAdminRbac();

    // 2. Create SuperAdmin
    superAdminUser = await prisma.adminUser.create({
      data: {
        email: superAdminEmail,
        passwordHash: hashPassword('SuperAdminPass123!'),
        name: 'Super Admin Ops',
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

    // 3. Create Standard Admin (ADMIN role)
    standardAdminUser = await prisma.adminUser.create({
      data: {
        email: standardAdminEmail,
        passwordHash: hashPassword('StandardAdminPass123!'),
        name: 'Standard Admin Ops',
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

    // 4. Create Operations Engineer (OPERATIONS role)
    opsEngineerUser = await prisma.adminUser.create({
      data: {
        email: opsEngineerEmail,
        passwordHash: hashPassword('OpsEngineerPass123!'),
        name: 'Operations Engineer',
        status: AdminStatus.ACTIVE,
        isSuperAdmin: false
      }
    });
    opsEngineerToken = generateSessionToken();
    await prisma.adminSession.create({
      data: {
        adminId: opsEngineerUser.id,
        sessionTokenHash: hashSessionToken(opsEngineerToken),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });
    const opsRole = await prisma.adminRole.findUnique({ where: { slug: 'OPERATIONS' } });
    if (opsRole) {
      await prisma.adminUserRole.create({
        data: { adminId: opsEngineerUser.id, roleId: opsRole.id }
      });
    }

    // 5. Create Support Agent (SUPPORT role)
    supportUser = await prisma.adminUser.create({
      data: {
        email: supportEmail,
        passwordHash: hashPassword('SupportPass123!'),
        name: 'Support Agent Ops',
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

    // 6. Create Unassigned Admin
    unassignedUser = await prisma.adminUser.create({
      data: {
        email: unassignedEmail,
        passwordHash: hashPassword('UnassignedPass123!'),
        name: 'Unassigned Admin Ops',
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

    // 7. Create Customer User & Session
    customerUser = await prisma.user.create({
      data: {
        email: customerEmail,
        passwordHash: hashPassword('CustomerPass123!'),
        fullName: 'Customer Ops Test',
        status: 'ACTIVE',
        emailVerified: true
      }
    });
    customerToken = generateSessionToken();
    await prisma.userSession.create({
      data: {
        userId: customerUser.id,
        token: customerToken,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });
  });

  after(async () => {
    try {
      await prisma.adminUser.deleteMany({
        where: { email: { contains: 'ops.' } }
      });
      await prisma.user.deleteMany({
        where: { email: { contains: 'ops.' } }
      });
    } catch {
      // Ignore cleanup on remote db
    }
    await app.close();
  });

  // =========================================================================
  // SUITE 1 — OPERATIONS ROUTER & NAMESPACE
  // =========================================================================
  describe('Suite 1 — Operations Router & Namespace Registration', () => {
    test('1.1 GET /api/v1/admin/operations/health returns 200 for authorized admin', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/health',
        headers: { 'x-admin-session-token': superAdminToken }
      });

      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.payload);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.status, 'ok');
      assert.strictEqual(body.data.service, 'admin-operations');
      assert.strictEqual(body.data.version, '8.2');
      assert.ok(body.data.timestamp);
    });

    test('1.2 Foundation health endpoint exposes zero secrets, DB credentials, or PII', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/health',
        headers: { 'x-admin-session-token': superAdminToken }
      });

      const payload = res.payload;
      assert.strictEqual(payload.includes('password'), false);
      assert.strictEqual(payload.includes('secret'), false);
      assert.strictEqual(payload.includes('DATABASE_URL'), false);
      assert.strictEqual(payload.includes('connectionToken'), false);
    });
  });

  // =========================================================================
  // SUITE 2 — AUTHENTICATION & CROSS-PLANE ISOLATION
  // =========================================================================
  describe('Suite 2 — Authentication & Cross-Plane Isolation', () => {
    test('2.1 Unauthenticated request returns 401 Unauthorized', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/health'
      });
      assert.strictEqual(res.statusCode, 401);
    });

    test('2.2 Invalid admin token returns 401 Unauthorized', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/health',
        headers: { 'x-admin-session-token': 'invalid_session_token_xyz' }
      });
      assert.strictEqual(res.statusCode, 401);
    });

    test('2.3 Customer UserSession token against Operations endpoint is rejected with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/health',
        headers: { 'x-admin-session-token': customerToken }
      });
      assert.strictEqual(res.statusCode, 401);
    });

    test('2.4 Customer Bearer Authorization header against Operations endpoint is rejected with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/health',
        headers: { authorization: `Bearer ${customerToken}` }
      });
      assert.strictEqual(res.statusCode, 401);
    });
  });

  // =========================================================================
  // SUITE 3 — PERMISSION MIDDLEWARE & PHASE 8 RBAC
  // =========================================================================
  describe('Suite 3 — Permission Middleware & Phase 8 RBAC', () => {
    test('3.1 All four Phase 8.2 permissions exist in system permission definitions', () => {
      const slugs = SYSTEM_PERMISSIONS.map(p => p.slug);
      assert.ok(slugs.includes('users.suspend'));
      assert.ok(slugs.includes('devices.disconnect'));
      assert.ok(slugs.includes('servers.power'));
      assert.ok(slugs.includes('gateway.drain'));
    });

    test('3.2 Unassigned Admin lacking system.read permission receives 403 Forbidden', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/health',
        headers: { 'x-admin-session-token': unassignedToken }
      });
      assert.strictEqual(res.statusCode, 403);
      const body = JSON.parse(res.payload);
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error.code, 'FORBIDDEN');
    });

    test('3.3 Standard Admin with ADMIN role resolves users.suspend, devices.disconnect, servers.power, gateway.drain', async () => {
      const perms = await AdminRbacService.resolveAdminPermissions(standardAdminUser.id);
      assert.ok(perms.includes('users.suspend'));
      assert.ok(perms.includes('devices.disconnect'));
      assert.ok(perms.includes('servers.power'));
      assert.ok(perms.includes('gateway.drain'));
    });

    test('3.4 Operations Engineer has devices.disconnect, servers.power, gateway.drain but NOT users.suspend', async () => {
      const perms = await AdminRbacService.resolveAdminPermissions(opsEngineerUser.id);
      assert.ok(perms.includes('devices.disconnect'));
      assert.ok(perms.includes('servers.power'));
      assert.ok(perms.includes('gateway.drain'));
      assert.strictEqual(perms.includes('users.suspend'), false);
    });

    test('3.5 Support Agent does NOT possess any Phase 8.2 operational mutation permissions', async () => {
      const perms = await AdminRbacService.resolveAdminPermissions(supportUser.id);
      assert.strictEqual(perms.includes('users.suspend'), false);
      assert.strictEqual(perms.includes('devices.disconnect'), false);
      assert.strictEqual(perms.includes('servers.power'), false);
      assert.strictEqual(perms.includes('gateway.drain'), false);
    });

    test('3.6 SuperAdmin has wildcard permission (*) and satisfies all Phase 8.2 permissions', async () => {
      const hasSuspend = await AdminRbacService.hasPermission(superAdminUser, 'users.suspend');
      const hasDisconnect = await AdminRbacService.hasPermission(superAdminUser, 'devices.disconnect');
      const hasPower = await AdminRbacService.hasPermission(superAdminUser, 'servers.power');
      const hasDrain = await AdminRbacService.hasPermission(superAdminUser, 'gateway.drain');

      assert.strictEqual(hasSuspend, true);
      assert.strictEqual(hasDisconnect, true);
      assert.strictEqual(hasPower, true);
      assert.strictEqual(hasDrain, true);
    });
  });

  // =========================================================================
  // SUITE 4 — REQUEST VALIDATION FOUNDATION
  // =========================================================================
  describe('Suite 4 — Request Validation Foundation', () => {
    test('4.1 uuidSchema validates UUIDv4 and rejects malformed values', () => {
      const valid = '123e4567-e89b-12d3-a456-426614174000';
      const parsed = uuidSchema.safeParse(valid);
      assert.strictEqual(parsed.success, true);

      const invalid = 'not-a-uuid-123';
      const parsedInvalid = uuidSchema.safeParse(invalid);
      assert.strictEqual(parsedInvalid.success, false);
    });

    test('4.2 cuidSchema validates CUID formats and rejects malformed values', () => {
      const valid = 'clh81x8c9000008l07b6h5e0g';
      const parsed = cuidSchema.safeParse(valid);
      assert.strictEqual(parsed.success, true);

      const invalid = 'c'; // too short
      const parsedInvalid = cuidSchema.safeParse(invalid);
      assert.strictEqual(parsedInvalid.success, false);
    });

    test('4.3 paginationQuerySchema applies safe defaults and clamps/rejects out-of-range values', () => {
      // Default values
      const emptyParse = paginationQuerySchema.safeParse({});
      assert.strictEqual(emptyParse.success, true);
      if (emptyParse.success) {
        assert.strictEqual(emptyParse.data.page, 1);
        assert.strictEqual(emptyParse.data.pageSize, 25);
        assert.strictEqual(emptyParse.data.sortOrder, 'desc');
      }

      // Rejects negative/zero page
      const badPage = paginationQuerySchema.safeParse({ page: 0 });
      assert.strictEqual(badPage.success, false);

      // Rejects pageSize > 100
      const badPageSize = paginationQuerySchema.safeParse({ pageSize: 500 });
      assert.strictEqual(badPageSize.success, false);
    });

    test('4.4 createPaginatedResponse calculates totalPages and metadata deterministically', () => {
      const items = [{ id: '1' }, { id: '2' }];
      const paginated = createPaginatedResponse(items, 55, 2, 25);

      assert.strictEqual(paginated.items.length, 2);
      assert.strictEqual(paginated.pagination.page, 2);
      assert.strictEqual(paginated.pagination.pageSize, 25);
      assert.strictEqual(paginated.pagination.total, 55);
      assert.strictEqual(paginated.pagination.totalPages, 3);
    });
  });

  // =========================================================================
  // SUITE 5 — OBJECT-LEVEL AUTHORIZATION & CONTEXT
  // =========================================================================
  describe('Suite 5 — Object-Level Authorization & Context', () => {
    test('5.1 assertAdminCanOperateOnResource allows SuperAdmin unconditionally', async () => {
      const allowed = await assertAdminCanOperateOnResource({
        resourceType: 'device',
        resourceId: 'dev-12345',
        operation: 'disconnect',
        context: {
          adminId: superAdminUser.id,
          adminEmail: superAdminUser.email,
          adminName: superAdminUser.name,
          isSuperAdmin: true,
          status: AdminStatus.ACTIVE,
          sessionId: 'test-session',
          roles: ['SUPER_ADMIN'],
          permissions: ['*'],
          requestId: 'test-req',
          clientIp: '127.0.0.1',
          userAgent: 'test'
        }
      });
      assert.strictEqual(allowed, true);
    });

    test('5.2 assertAdminCanOperateOnResource rejects empty resource ID', async () => {
      await assert.rejects(async () => {
        await assertAdminCanOperateOnResource({
          resourceType: 'server',
          resourceId: '   ',
          operation: 'power',
          context: {
            adminId: standardAdminUser.id,
            adminEmail: standardAdminUser.email,
            adminName: standardAdminUser.name,
            isSuperAdmin: false,
            status: AdminStatus.ACTIVE,
            sessionId: 'test-session',
            roles: ['ADMIN'],
            permissions: ['servers.power'],
            requestId: 'test-req',
            clientIp: '127.0.0.1',
            userAgent: 'test'
          }
        });
      }, /Target server resource ID cannot be empty/);
    });
  });

  // =========================================================================
  // SUITE 6 — TRANSACTION & AUDIT OPERATION EXECUTOR
  // =========================================================================
  describe('Suite 6 — Transaction & Fail-Closed Audit Execution', () => {
    test('6.1 executeAdminOperation executes mutation and logs SHA-256 chained audit event', async () => {
      let executedInTx = false;

      const result = await executeAdminOperation({
        operationName: 'foundation_test_mutation',
        targetResourceType: 'system',
        targetResourceId: 'sys-001',
        context: {
          adminId: superAdminUser.id,
          adminEmail: superAdminUser.email,
          adminName: superAdminUser.name,
          isSuperAdmin: true,
          status: AdminStatus.ACTIVE,
          sessionId: 'session-tx',
          roles: ['SUPER_ADMIN'],
          permissions: ['*'],
          requestId: 'req-tx-1',
          clientIp: '127.0.0.1',
          userAgent: 'node-test'
        },
        action: AdminAuditAction.ADMIN_STATUS_UPDATED,
        metadata: { configKey: 'test_key', configValue: 'test_val' },
        execute: async (tx) => {
          executedInTx = true;
          return { mutated: true };
        }
      });

      assert.strictEqual(executedInTx, true);
      assert.strictEqual(result.mutated, true);

      // Verify audit record was created with sequence and integrityHash
      const latestLog = await prisma.adminAuditLog.findFirst({
        where: { adminId: superAdminUser.id, action: AdminAuditAction.ADMIN_STATUS_UPDATED },
        orderBy: { createdAt: 'desc' }
      });

      assert.ok(latestLog);
      assert.ok(latestLog.integrityHash);
      assert.ok(latestLog.sequence);
    });

    test('6.2 executeAdminOperation records FAILED audit status when mutation throws error', async () => {
      await assert.rejects(async () => {
        await executeAdminOperation({
          operationName: 'failing_mutation',
          targetResourceType: 'system',
          targetResourceId: 'sys-err',
          context: {
            adminId: superAdminUser.id,
            adminEmail: superAdminUser.email,
            adminName: superAdminUser.name,
            isSuperAdmin: true,
            status: AdminStatus.ACTIVE,
            sessionId: 'session-tx-err',
            roles: ['SUPER_ADMIN'],
            permissions: ['*'],
            requestId: 'req-tx-err',
            clientIp: '127.0.0.1',
            userAgent: 'node-test'
          },
          action: AdminAuditAction.ADMIN_STATUS_UPDATED,
          execute: async () => {
            throw new Error('Simulated domain mutation error');
          }
        });
      }, /Simulated domain mutation error/);

      const failedLog = await prisma.adminAuditLog.findFirst({
        where: { adminId: superAdminUser.id, status: 'FAILED' },
        orderBy: { createdAt: 'desc' }
      });

      assert.ok(failedLog);
    });
  });
});
