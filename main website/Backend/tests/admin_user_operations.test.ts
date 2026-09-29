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
import { seedAdminRbac } from '../src/services/admin/admin_rbac_seed.js';

describe('Admin User Operations Management (Phase 8.3)', () => {
  let app: FastifyInstance;

  // SuperAdmin user
  const superAdminEmail = `superadmin.userops.${Date.now()}@zdexcloud.internal`;
  let superAdminUser: any;
  let superAdminToken = '';

  // Standard Admin user (with ADMIN role)
  const standardAdminEmail = `admin.userops.${Date.now()}@zdexcloud.internal`;
  let standardAdminUser: any;
  let standardAdminToken = '';

  // Support Agent user (with SUPPORT role — has users.read, lacks users.suspend)
  const supportEmail = `support.userops.${Date.now()}@zdexcloud.internal`;
  let supportUser: any;
  let supportToken = '';

  // Unassigned Admin user (no roles)
  const unassignedEmail = `unassigned.userops.${Date.now()}@zdexcloud.internal`;
  let unassignedUser: any;
  let unassignedToken = '';

  // Test Customer Accounts
  let activeCustomer: any;
  let activeCustomerToken = '';
  let suspendedCustomer: any;
  let pendingCustomer: any;

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
        name: 'Super Admin UserOps',
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

    // 3. Create Standard Admin (ADMIN role has users.read and users.suspend)
    standardAdminUser = await prisma.adminUser.create({
      data: {
        email: standardAdminEmail,
        passwordHash: hashPassword('StandardAdminPass123!'),
        name: 'Standard Admin UserOps',
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

    // 4. Create Support Agent (SUPPORT role has users.read, lacks users.suspend)
    supportUser = await prisma.adminUser.create({
      data: {
        email: supportEmail,
        passwordHash: hashPassword('SupportPass123!'),
        name: 'Support Agent UserOps',
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
        name: 'Unassigned Admin UserOps',
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

    // 6. Create Active Customer Account with a Session and Device
    activeCustomer = await prisma.user.create({
      data: {
        email: `active.userops.${Date.now()}@zdexcloud.com`,
        passwordHash: hashPassword('ActiveCustomerPass123!'),
        fullName: 'Active Customer Ops',
        status: 'ACTIVE',
        emailVerified: true
      }
    });
    activeCustomerToken = generateSessionToken();
    await prisma.userSession.create({
      data: {
        userId: activeCustomer.id,
        token: activeCustomerToken,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });
    await prisma.device.create({
      data: {
        userId: activeCustomer.id,
        deviceName: 'Pixel 8 Pro Test',
        platform: 'Android',
        status: 'ONLINE'
      }
    });

    // 7. Create Suspended Customer Account
    suspendedCustomer = await prisma.user.create({
      data: {
        email: `suspended.userops.${Date.now()}@zdexcloud.com`,
        passwordHash: hashPassword('SuspendedPass123!'),
        fullName: 'Suspended Customer Ops',
        status: 'SUSPENDED',
        emailVerified: true
      }
    });

    // 8. Create Pending Verification Customer Account
    pendingCustomer = await prisma.user.create({
      data: {
        email: `pending.userops.${Date.now()}@zdexcloud.com`,
        passwordHash: hashPassword('PendingPass123!'),
        fullName: 'Pending Customer Ops',
        status: 'PENDING_VERIFICATION',
        emailVerified: false
      }
    });
  });

  after(async () => {
    try {
      await prisma.adminUser.deleteMany({
        where: { email: { contains: 'userops.' } }
      });
      await prisma.user.deleteMany({
        where: { email: { contains: 'userops.' } }
      });
    } catch {
      // Ignore cleanup error on remote db
    }
    await app.close();
  });

  // =========================================================================
  // SUITE 1 — AUTHENTICATION & CROSS-PLANE ISOLATION
  // =========================================================================
  describe('Suite 1 — Authentication & Cross-Plane Isolation', () => {
    test('1.1 Unauthenticated request to /api/v1/admin/operations/users returns 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/users'
      });
      assert.strictEqual(res.statusCode, 401);
    });

    test('1.2 Customer UserSession token against admin user operations returns 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/users',
        headers: { 'x-admin-session-token': activeCustomerToken }
      });
      assert.strictEqual(res.statusCode, 401);
    });

    test('1.3 Customer Bearer Authorization header against admin user operations returns 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/users',
        headers: { authorization: `Bearer ${activeCustomerToken}` }
      });
      assert.strictEqual(res.statusCode, 401);
    });
  });

  // =========================================================================
  // SUITE 2 — AUTHORIZATION & RBAC
  // =========================================================================
  describe('Suite 2 — Authorization & RBAC', () => {
    test('2.1 Unassigned admin lacking users.read receives 403 Forbidden', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/users',
        headers: { 'x-admin-session-token': unassignedToken }
      });
      assert.strictEqual(res.statusCode, 403);
      const body = JSON.parse(res.payload);
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error.code, 'FORBIDDEN');
    });

    test('2.2 Support Agent with users.read can list users (200 OK)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/users',
        headers: { 'x-admin-session-token': supportToken }
      });
      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.payload);
      assert.strictEqual(body.success, true);
      assert.ok(Array.isArray(body.data.items));
    });

    test('2.3 Support Agent lacking users.suspend receives 403 Forbidden on suspend', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/operations/users/${activeCustomer.id}/suspend`,
        headers: { 'x-admin-session-token': supportToken },
        payload: { reason: 'Test unauthorized suspension' }
      });
      assert.strictEqual(res.statusCode, 403);
      const body = JSON.parse(res.payload);
      assert.strictEqual(body.error.code, 'FORBIDDEN');
    });

    test('2.4 Support Agent lacking users.suspend receives 403 Forbidden on restore', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/operations/users/${suspendedCustomer.id}/restore`,
        headers: { 'x-admin-session-token': supportToken },
        payload: { reason: 'Test unauthorized restoration' }
      });
      assert.strictEqual(res.statusCode, 403);
      const body = JSON.parse(res.payload);
      assert.strictEqual(body.error.code, 'FORBIDDEN');
    });
  });

  // =========================================================================
  // SUITE 3 — USER LISTING, SEARCH & PAGINATION
  // =========================================================================
  describe('Suite 3 — User Listing, Search & Pagination', () => {
    test('3.1 GET /api/v1/admin/operations/users returns paginated list with safe structure', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/users?page=1&pageSize=10',
        headers: { 'x-admin-session-token': standardAdminToken }
      });
      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.payload);
      assert.strictEqual(body.success, true);
      assert.ok(Array.isArray(body.data.items));
      assert.ok(body.data.pagination);
      assert.strictEqual(body.data.pagination.page, 1);
      assert.strictEqual(body.data.pagination.pageSize, 10);
      assert.ok(typeof body.data.pagination.total === 'number');
    });

    test('3.2 Listing supports search query filtering by email', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/operations/users?search=${encodeURIComponent(activeCustomer.email)}`,
        headers: { 'x-admin-session-token': standardAdminToken }
      });
      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.payload);
      assert.strictEqual(body.data.items.length, 1);
      assert.strictEqual(body.data.items[0].email, activeCustomer.email);
    });

    test('3.3 Listing supports status filtering', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/users?status=SUSPENDED',
        headers: { 'x-admin-session-token': standardAdminToken }
      });
      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.payload);
      for (const item of body.data.items) {
        assert.strictEqual(item.status, 'SUSPENDED');
      }
    });

    test('3.4 Listing response contains ZERO passwords, tokens, or private secrets', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/users',
        headers: { 'x-admin-session-token': standardAdminToken }
      });
      const rawPayload = res.payload;
      assert.strictEqual(rawPayload.includes('passwordHash'), false);
      assert.strictEqual(rawPayload.includes('password'), false);
      assert.strictEqual(rawPayload.includes('token'), false);
      assert.strictEqual(rawPayload.includes('otp'), false);
    });
  });

  // =========================================================================
  // SUITE 4 — USER DETAIL INSPECTION
  // =========================================================================
  describe('Suite 4 — User Detail Inspection', () => {
    test('4.1 GET /api/v1/admin/operations/users/:userId returns allowlisted operational detail', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/operations/users/${activeCustomer.id}`,
        headers: { 'x-admin-session-token': standardAdminToken }
      });
      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.payload);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.user.id, activeCustomer.id);
      assert.strictEqual(body.data.user.email, activeCustomer.email);
      assert.strictEqual(body.data.user.status, 'ACTIVE');
      assert.strictEqual(body.data.user.emailVerified, true);
      assert.ok(Array.isArray(body.data.user.devices));
      assert.strictEqual(body.data.user.deviceCount, 1);
    });

    test('4.2 Non-existent userId returns 404 Not Found', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/users/non_existent_cuid_12345',
        headers: { 'x-admin-session-token': standardAdminToken }
      });
      assert.strictEqual(res.statusCode, 404);
      const body = JSON.parse(res.payload);
      assert.strictEqual(body.error.code, 'NOT_FOUND');
    });

    test('4.3 Detail response contains ZERO password hashes or auth tokens', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/operations/users/${activeCustomer.id}`,
        headers: { 'x-admin-session-token': standardAdminToken }
      });
      const rawPayload = res.payload;
      assert.strictEqual(rawPayload.includes('passwordHash'), false);
      assert.strictEqual(rawPayload.includes('token'), false);
      assert.strictEqual(rawPayload.includes('otpCode'), false);
    });
  });

  // =========================================================================
  // SUITE 5 — USER SUSPENSION & STATE TRANSITION
  // =========================================================================
  describe('Suite 5 — User Suspension & State Transition', () => {
    test('5.1 ACTIVE user is suspended successfully and customer sessions are revoked', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/operations/users/${activeCustomer.id}/suspend`,
        headers: { 'x-admin-session-token': standardAdminToken },
        payload: { reason: 'Security policy violation' }
      });
      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.payload);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.user.status, 'SUSPENDED');
      assert.strictEqual(body.data.user.previousStatus, 'ACTIVE');

      // Verify sessions were revoked
      const sessions = await prisma.userSession.findMany({
        where: { userId: activeCustomer.id }
      });
      assert.strictEqual(sessions.length, 0);

      // Verify audit log record exists
      const auditLog = await prisma.adminAuditLog.findFirst({
        where: {
          action: AdminAuditAction.ADMIN_STATUS_UPDATED,
          adminId: standardAdminUser.id
        },
        orderBy: { createdAt: 'desc' }
      });
      assert.ok(auditLog);
      assert.ok(auditLog.integrityHash);
    });

    test('5.2 Attempting to suspend an already suspended user returns 409 Conflict', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/operations/users/${activeCustomer.id}/suspend`,
        headers: { 'x-admin-session-token': standardAdminToken },
        payload: { reason: 'Duplicate suspension attempt' }
      });
      assert.strictEqual(res.statusCode, 409);
      const body = JSON.parse(res.payload);
      assert.strictEqual(body.error.code, 'CONFLICT');
    });

    test('5.3 Attempting to suspend a pending verification account returns 409 Conflict', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/operations/users/${pendingCustomer.id}/suspend`,
        headers: { 'x-admin-session-token': standardAdminToken },
        payload: { reason: 'Invalid state transition' }
      });
      assert.strictEqual(res.statusCode, 409);
    });
  });

  // =========================================================================
  // SUITE 6 — USER RESTORATION & STATE TRANSITION
  // =========================================================================
  describe('Suite 6 — User Restoration & State Transition', () => {
    test('6.1 SUSPENDED user is restored successfully to ACTIVE status', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/operations/users/${activeCustomer.id}/restore`,
        headers: { 'x-admin-session-token': standardAdminToken },
        payload: { reason: 'Verification complete, restoring account' }
      });
      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.payload);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.user.status, 'ACTIVE');
      assert.strictEqual(body.data.user.previousStatus, 'SUSPENDED');

      // Verify audit log record exists
      const auditLog = await prisma.adminAuditLog.findFirst({
        where: {
          action: AdminAuditAction.ADMIN_STATUS_UPDATED,
          adminId: standardAdminUser.id
        },
        orderBy: { createdAt: 'desc' }
      });
      assert.ok(auditLog);
      assert.ok(auditLog.integrityHash);
    });

    test('6.2 Attempting to restore an already active user returns 409 Conflict', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/operations/users/${activeCustomer.id}/restore`,
        headers: { 'x-admin-session-token': standardAdminToken },
        payload: { reason: 'Duplicate restoration attempt' }
      });
      assert.strictEqual(res.statusCode, 409);
      const body = JSON.parse(res.payload);
      assert.strictEqual(body.error.code, 'CONFLICT');
    });

    test('6.3 Attempting to restore a pending verification account returns 409 Conflict', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/operations/users/${pendingCustomer.id}/restore`,
        headers: { 'x-admin-session-token': standardAdminToken },
        payload: { reason: 'Invalid state transition' }
      });
      assert.strictEqual(res.statusCode, 409);
    });
  });

  // =========================================================================
  // SUITE 7 — INPUT VALIDATION & ERROR CONTRACT
  // =========================================================================
  describe('Suite 7 — Input Validation & Error Contract', () => {
    test('7.1 Empty userId parameter returns 400 Validation Error', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/users/%20',
        headers: { 'x-admin-session-token': standardAdminToken }
      });
      assert.strictEqual(res.statusCode, 400);
      const body = JSON.parse(res.payload);
      assert.strictEqual(body.error.code, 'VALIDATION_ERROR');
    });

    test('7.2 Oversized suspension reason returns 400 Validation Error', async () => {
      const longReason = 'A'.repeat(300);
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/operations/users/${activeCustomer.id}/suspend`,
        headers: { 'x-admin-session-token': standardAdminToken },
        payload: { reason: longReason }
      });
      assert.strictEqual(res.statusCode, 400);
      const body = JSON.parse(res.payload);
      assert.strictEqual(body.error.code, 'VALIDATION_ERROR');
    });

    test('7.3 SuperAdmin can execute suspension and restoration with full authorization', async () => {
      // SuperAdmin suspends
      const suspendRes = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/operations/users/${activeCustomer.id}/suspend`,
        headers: { 'x-admin-session-token': superAdminToken },
        payload: { reason: 'SuperAdmin test suspension' }
      });
      assert.strictEqual(suspendRes.statusCode, 200);

      // SuperAdmin restores
      const restoreRes = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/operations/users/${activeCustomer.id}/restore`,
        headers: { 'x-admin-session-token': superAdminToken },
        payload: { reason: 'SuperAdmin test restoration' }
      });
      assert.strictEqual(restoreRes.statusCode, 200);
    });
  });
});
