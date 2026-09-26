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
import { AdminAuthService } from '../src/services/admin/admin_auth_service.js';
import { AdminRbacService } from '../src/services/admin/admin_rbac_service.js';
import { seedAdminRbac } from '../src/services/admin/admin_rbac_seed.js';

describe('Admin Role-Based Access Control (Phase 7.3 RBAC)', () => {
  let app: FastifyInstance;

  // SuperAdmin user
  const superAdminEmail = `superadmin.rbac.${Date.now()}@zdexcloud.internal`;
  let superAdminUser: any;
  let superAdminToken = '';

  // Standard Admin user (with ADMIN role)
  const standardAdminEmail = `admin.rbac.${Date.now()}@zdexcloud.internal`;
  let standardAdminUser: any;
  let standardAdminToken = '';

  // Support Agent user (with SUPPORT role)
  const supportEmail = `support.rbac.${Date.now()}@zdexcloud.internal`;
  let supportUser: any;
  let supportToken = '';

  // Unassigned Admin user (no roles)
  const unassignedEmail = `unassigned.rbac.${Date.now()}@zdexcloud.internal`;
  let unassignedUser: any;
  let unassignedToken = '';

  // Customer user
  const customerEmail = `customer.rbac.${Date.now()}@zdexcloud.com`;
  let customerUser: any;
  let customerToken = '';

  before(async () => {
    app = await buildApp();
    await app.ready();

    // 1. Seed RBAC System Roles & Permissions
    await seedAdminRbac();

    // 2. Create SuperAdmin
    superAdminUser = await prisma.adminUser.create({
      data: {
        email: superAdminEmail,
        passwordHash: hashPassword('SuperAdminPass123!'),
        name: 'Super Admin RBAC',
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

    // 3. Create Standard Admin
    standardAdminUser = await prisma.adminUser.create({
      data: {
        email: standardAdminEmail,
        passwordHash: hashPassword('StandardAdminPass123!'),
        name: 'Standard Admin RBAC',
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
    // Assign ADMIN role
    const adminRole = await prisma.adminRole.findUnique({ where: { slug: 'ADMIN' } });
    if (adminRole) {
      await prisma.adminUserRole.create({
        data: { adminId: standardAdminUser.id, roleId: adminRole.id }
      });
    }

    // 4. Create Support Agent
    supportUser = await prisma.adminUser.create({
      data: {
        email: supportEmail,
        passwordHash: hashPassword('SupportPass123!'),
        name: 'Support Agent RBAC',
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
    // Assign SUPPORT role
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
        name: 'Unassigned Admin RBAC',
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

    // 6. Create Customer User & Session
    customerUser = await prisma.user.create({
      data: {
        email: customerEmail,
        passwordHash: hashPassword('CustomerPass123!'),
        fullName: 'Customer RBAC Test',
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
        where: { email: { contains: 'rbac.' } }
      });
      await prisma.user.deleteMany({
        where: { email: { contains: 'rbac.' } }
      });
    } catch {
      // Ignore cleanup on remote db
    }
    await app.close();
  });

  // 1. Seed Idempotency
  test('1. seedAdminRbac runs idempotently and populates system roles and permissions', async () => {
    const res = await seedAdminRbac();
    assert.strictEqual(typeof res.rolesCreated, 'number');
    assert.strictEqual(typeof res.permissionsCreated, 'number');

    const roles = await prisma.adminRole.findMany();
    const slugs = roles.map(r => r.slug);
    assert.ok(slugs.includes('SUPER_ADMIN'));
    assert.ok(slugs.includes('ADMIN'));
    assert.ok(slugs.includes('SUPPORT'));
    assert.ok(slugs.includes('OPERATIONS'));
  });

  // 2. Permission Resolution
  test('2. Permission Resolution: Admin with role resolves expected permissions, unassigned gets none', async () => {
    const adminPerms = await AdminRbacService.resolveAdminPermissions(standardAdminUser.id);
    assert.ok(adminPerms.includes('users.read'));
    assert.ok(adminPerms.includes('billing.refund'));
    assert.ok(adminPerms.includes('admin_roles.read'));

    const supportPerms = await AdminRbacService.resolveAdminPermissions(supportUser.id);
    assert.ok(supportPerms.includes('support.read'));
    assert.ok(supportPerms.includes('users.read'));
    assert.strictEqual(supportPerms.includes('billing.refund'), false);
    assert.strictEqual(supportPerms.includes('admin_roles.write'), false);

    const unassignedPerms = await AdminRbacService.resolveAdminPermissions(unassignedUser.id);
    assert.strictEqual(unassignedPerms.length, 0);
  });

  // 3. SuperAdmin Bypass
  test('3. SuperAdmin receives full wildcard authorization (*)', async () => {
    const superPerms = await AdminRbacService.resolveAdminPermissions(superAdminUser.id);
    assert.ok(superPerms.includes('*'));

    const hasAny = await AdminRbacService.hasPermission(superAdminUser, 'completely.arbitrary.permission');
    assert.strictEqual(hasAny, true);
  });

  // 4. Combined Roles
  test('4. Combining multiple roles aggregates permissions without duplicates', async () => {
    const multiUser = await prisma.adminUser.create({
      data: {
        email: `multi.rbac.${Date.now()}@zdexcloud.internal`,
        passwordHash: hashPassword('MultiPass123!'),
        name: 'Multi Role Admin',
        status: AdminStatus.ACTIVE
      }
    });

    const supportRole = await prisma.adminRole.findUnique({ where: { slug: 'SUPPORT' } });
    const opsRole = await prisma.adminRole.findUnique({ where: { slug: 'OPERATIONS' } });

    await prisma.adminUserRole.createMany({
      data: [
        { adminId: multiUser.id, roleId: supportRole!.id },
        { adminId: multiUser.id, roleId: opsRole!.id }
      ]
    });

    const perms = await AdminRbacService.resolveAdminPermissions(multiUser.id);
    // Support perms
    assert.ok(perms.includes('support.read'));
    // Operations perms
    assert.ok(perms.includes('gateway.read'));
    assert.ok(perms.includes('errors.read'));

    await prisma.adminUser.delete({ where: { id: multiUser.id } });
  });

  // 5. Authentication Boundary (401)
  test('5. Missing or invalid admin session returns 401 Unauthorized', async () => {
    // No token
    const res1 = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/rbac/roles'
    });
    assert.strictEqual(res1.statusCode, 401);

    // Bogus token
    const res2 = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/rbac/roles',
      headers: { 'x-admin-session-token': 'invalid_token_999' }
    });
    assert.strictEqual(res2.statusCode, 401);
  });

  // 6. Authorization Boundary (403 vs 200)
  test('6. Authenticated admin with permission gets 200; lacking permission gets 403 Forbidden', async () => {
    // Standard admin has admin_roles.read -> 200
    const resAllowed = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/rbac/roles',
      headers: { 'x-admin-session-token': standardAdminToken }
    });
    assert.strictEqual(resAllowed.statusCode, 200);
    const bodyAllowed = JSON.parse(resAllowed.payload);
    assert.strictEqual(bodyAllowed.success, true);
    assert.ok(bodyAllowed.data.roles.length > 0);

    // Support agent lacks admin_roles.read -> 403
    const resForbidden = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/rbac/roles',
      headers: { 'x-admin-session-token': supportToken }
    });
    assert.strictEqual(resForbidden.statusCode, 403);
    const bodyForbidden = JSON.parse(resForbidden.payload);
    assert.strictEqual(bodyForbidden.success, false);
    assert.strictEqual(bodyForbidden.error.code, 'FORBIDDEN');
    assert.ok(bodyForbidden.error.message.includes('missing required permission'));
  });

  // 7. GET /api/v1/admin/auth/me returns enriched roles and permissions
  test('7. GET /api/v1/admin/auth/me returns roles and permissions list', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/auth/me',
      headers: { 'x-admin-session-token': standardAdminToken }
    });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.data.admin.roles));
    assert.ok(body.data.admin.roles.includes('ADMIN'));
    assert.ok(Array.isArray(body.data.admin.permissions));
    assert.ok(body.data.admin.permissions.includes('users.read'));
  });

  // 8. Cross-Plane Isolation
  test('8. Customer token against RBAC endpoint returns 401 Unauthorized', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/rbac/roles',
      headers: { 'x-admin-session-token': customerToken }
    });
    assert.strictEqual(res.statusCode, 401);
  });

  // 9. Anti-Escalation: Non-SuperAdmin cannot assign SUPER_ADMIN role
  test('9. Anti-Escalation: Standard Admin cannot assign SUPER_ADMIN role to anyone', async () => {
    // Give standard admin admin_roles.write permission by role
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/rbac/admins/${unassignedUser.id}/roles`,
      headers: { 'x-admin-session-token': standardAdminToken },
      payload: { roleSlug: 'SUPER_ADMIN' }
    });

    assert.strictEqual(res.statusCode, 403);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.error.code, 'FORBIDDEN');
    assert.ok(body.error.message.includes('Only Super Administrators can assign the SUPER_ADMIN role') || body.error.message.includes('missing required permission'));
  });

  // 10. Anti-Escalation: Non-SuperAdmin cannot modify own roles (self-escalation)
  test('10. Anti-Escalation: Non-SuperAdmin cannot modify their own assigned roles', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/rbac/admins/${standardAdminUser.id}/roles`,
      headers: { 'x-admin-session-token': standardAdminToken },
      payload: { roleSlug: 'SUPPORT' }
    });

    assert.strictEqual(res.statusCode, 403);
  });

  // 11. SuperAdmin can assign and remove roles
  test('11. SuperAdmin can assign and remove roles on other admin users', async () => {
    // Assign SUPPORT role to unassignedUser
    const assignRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/rbac/admins/${unassignedUser.id}/roles`,
      headers: { 'x-admin-session-token': superAdminToken },
      payload: { roleSlug: 'SUPPORT' }
    });
    assert.strictEqual(assignRes.statusCode, 200);

    // Verify unassignedUser now has SUPPORT permissions
    const permsAfter = await AdminRbacService.resolveAdminPermissions(unassignedUser.id);
    assert.ok(permsAfter.includes('support.read'));

    // Remove SUPPORT role
    const removeRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/rbac/admins/${unassignedUser.id}/roles/SUPPORT`,
      headers: { 'x-admin-session-token': superAdminToken }
    });
    assert.strictEqual(removeRes.statusCode, 200);

    const permsCleared = await AdminRbacService.resolveAdminPermissions(unassignedUser.id);
    assert.strictEqual(permsCleared.length, 0);
  });

  // 12. Disabled Admin cannot access even if SuperAdmin
  test('12. Disabled SuperAdmin is rejected by authentication/authorization middleware', async () => {
    const disabledSuper = await prisma.adminUser.create({
      data: {
        email: `disabled.super.${Date.now()}@zdexcloud.internal`,
        passwordHash: hashPassword('DisabledSuperPass123!'),
        name: 'Disabled Super',
        status: AdminStatus.DISABLED,
        isSuperAdmin: true
      }
    });
    const disabledSuperToken = generateSessionToken();
    await prisma.adminSession.create({
      data: {
        adminId: disabledSuper.id,
        sessionTokenHash: hashSessionToken(disabledSuperToken),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/rbac/roles',
      headers: { 'x-admin-session-token': disabledSuperToken }
    });
    assert.strictEqual(res.statusCode, 401);

    await prisma.adminUser.delete({ where: { id: disabledSuper.id } });
  });

  // 13. Audit Event Verification
  test('13. RBAC operations and denials generate audit log entries with zero secrets', async () => {
    const auditLogs = await prisma.adminAuditLog.findMany({
      where: {
        action: {
          in: [
            AdminAuditAction.ADMIN_ROLE_ASSIGNED,
            AdminAuditAction.ADMIN_ROLE_REMOVED,
            AdminAuditAction.ADMIN_AUTHZ_DENIED
          ]
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    assert.ok(auditLogs.length > 0);

    for (const log of auditLogs) {
      const jsonStr = JSON.stringify(log.metadata || {});
      assert.strictEqual(jsonStr.includes('password'), false);
      assert.strictEqual(jsonStr.includes('sessionToken'), false);
      assert.strictEqual(jsonStr.includes('otp'), false);
    }
  });
});
