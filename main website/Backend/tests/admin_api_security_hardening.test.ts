import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';
import { AdminStatus, AdminOtpPurpose } from '@prisma/client';
import { hashPassword, hashOtp, hashSessionToken, generateSessionToken } from '../src/utils/crypto.js';
import { AdminAuthService } from '../src/services/admin/admin_auth_service.js';
import { seedAdminRbac } from '../src/services/admin/admin_rbac_seed.js';

describe('Admin API & Authorization Hardening (Phase 7.5-B)', () => {
  let app: FastifyInstance;

  const superAdminEmail = 'superadmin-hardening@zdexcloud.test';
  const standardAdminEmail = 'admin-hardening@zdexcloud.test';
  const targetAdminEmail = 'target-hardening@zdexcloud.test';
  const testPassword = 'Password123!Secure';
  const newPassword = 'NewPassword456!Secure';

  let superAdminId: string;
  let standardAdminId: string;
  let targetAdminId: string;

  let superAdminToken: string;
  let standardAdminToken: string;

  before(async () => {
    app = await buildApp();
    await app.ready();

    // Ensure RBAC catalog is seeded
    await seedAdminRbac();

    // Clean test accounts
    await prisma.adminUser.deleteMany({
      where: {
        email: {
          in: [superAdminEmail, standardAdminEmail, targetAdminEmail]
        }
      }
    });

    const pwdHash = hashPassword(testPassword);

    // 1. Create SuperAdmin
    const superAdmin = await prisma.adminUser.create({
      data: {
        email: superAdminEmail,
        passwordHash: pwdHash,
        name: 'Super Administrator',
        status: AdminStatus.ACTIVE,
        isSuperAdmin: true
      }
    });
    superAdminId = superAdmin.id;

    // 2. Create Standard Admin
    const standardAdmin = await prisma.adminUser.create({
      data: {
        email: standardAdminEmail,
        passwordHash: pwdHash,
        name: 'Standard Admin',
        status: AdminStatus.ACTIVE,
        isSuperAdmin: false
      }
    });
    standardAdminId = standardAdmin.id;

    // Assign ADMIN role to Standard Admin
    const adminRole = await prisma.adminRole.findUnique({ where: { slug: 'ADMIN' } });
    if (adminRole) {
      await prisma.adminUserRole.create({
        data: {
          adminId: standardAdmin.id,
          roleId: adminRole.id
        }
      });
    }

    // 3. Create Target Admin (for status/password tests)
    const targetAdmin = await prisma.adminUser.create({
      data: {
        email: targetAdminEmail,
        passwordHash: pwdHash,
        name: 'Target Admin',
        status: AdminStatus.ACTIVE,
        isSuperAdmin: false
      }
    });
    targetAdminId = targetAdmin.id;

    // Generate initial session tokens
    superAdminToken = generateSessionToken();
    await prisma.adminSession.create({
      data: {
        adminId: superAdminId,
        sessionTokenHash: hashSessionToken(superAdminToken),
        expiresAt: new Date(Date.now() + 86400000),
        lastActivityAt: new Date()
      }
    });

    standardAdminToken = generateSessionToken();
    await prisma.adminSession.create({
      data: {
        adminId: standardAdminId,
        sessionTokenHash: hashSessionToken(standardAdminToken),
        expiresAt: new Date(Date.now() + 86400000),
        lastActivityAt: new Date()
      }
    });
  });

  after(async () => {
    await prisma.adminUser.deleteMany({
      where: {
        email: {
          in: [superAdminEmail, standardAdminEmail, targetAdminEmail]
        }
      }
    });
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // 1. DUAL-HEADER TOKEN EXTRACTION & CONFLICT REJECTION
  // ---------------------------------------------------------------------------
  describe('1. Standardized Dual-Header Extraction', () => {
    test('1.1 Accepts canonical x-admin-session-token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/auth/me',
        headers: {
          'x-admin-session-token': superAdminToken
        }
      });

      assert.equal(res.statusCode, 200);
      const json = JSON.parse(res.body);
      assert.equal(json.data.admin.email, superAdminEmail);
    });

    test('1.2 Accepts compatibility Authorization: Bearer <token>', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/auth/me',
        headers: {
          authorization: `Bearer ${superAdminToken}`
        }
      });

      assert.equal(res.statusCode, 200);
      const json = JSON.parse(res.body);
      assert.equal(json.data.admin.email, superAdminEmail);
    });

    test('1.3 Accepts both headers when tokens are identical', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/auth/me',
        headers: {
          'x-admin-session-token': superAdminToken,
          authorization: `Bearer ${superAdminToken}`
        }
      });

      assert.equal(res.statusCode, 200);
      const json = JSON.parse(res.body);
      assert.equal(json.data.admin.email, superAdminEmail);
    });

    test('1.4 Fails closed (401) when headers contain conflicting tokens', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/auth/me',
        headers: {
          'x-admin-session-token': superAdminToken,
          authorization: `Bearer ${standardAdminToken}`
        }
      });

      assert.equal(res.statusCode, 401);
      const json = JSON.parse(res.body);
      assert.equal(json.error.code, 'UNAUTHORIZED');
      assert.match(json.error.message, /conflicting/i);
    });

    test('1.5 Rejects customer session token supplied to admin endpoint', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/auth/me',
        headers: {
          'x-admin-session-token': 'non-existent-or-customer-uuid-token'
        }
      });

      assert.equal(res.statusCode, 401);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. BULK SESSION REVOCATION ON PASSWORD CHANGE
  // ---------------------------------------------------------------------------
  describe('2. Password Mutation Session Revocation', () => {
    let sessionTokenA: string;
    let sessionTokenB: string;

    before(async () => {
      // Create two active sessions for targetAdmin
      sessionTokenA = generateSessionToken();
      sessionTokenB = generateSessionToken();

      await prisma.adminSession.createMany({
        data: [
          {
            adminId: targetAdminId,
            sessionTokenHash: hashSessionToken(sessionTokenA),
            expiresAt: new Date(Date.now() + 86400000),
            lastActivityAt: new Date()
          },
          {
            adminId: targetAdminId,
            sessionTokenHash: hashSessionToken(sessionTokenB),
            expiresAt: new Date(Date.now() + 86400000),
            lastActivityAt: new Date()
          }
        ]
      });
    });

    test('2.1 Both sessions initially authenticate successfully', async () => {
      const resA = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/auth/me',
        headers: { 'x-admin-session-token': sessionTokenA }
      });
      assert.equal(resA.statusCode, 200);

      const resB = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/auth/me',
        headers: { 'x-admin-session-token': sessionTokenB }
      });
      assert.equal(resB.statusCode, 200);
    });

    test('2.2 Changing password invalidates all existing sessions for that admin', async () => {
      // Change password using sessionTokenA
      const changeRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/auth/change-password',
        headers: { 'x-admin-session-token': sessionTokenA },
        payload: {
          newPassword: newPassword
        }
      });

      assert.equal(changeRes.statusCode, 200);

      // Verify sessionTokenA is now rejected
      const verifyA = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/auth/me',
        headers: { 'x-admin-session-token': sessionTokenA }
      });
      assert.equal(verifyA.statusCode, 401);

      // Verify sessionTokenB is also rejected
      const verifyB = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/auth/me',
        headers: { 'x-admin-session-token': sessionTokenB }
      });
      assert.equal(verifyB.statusCode, 401);

      // Verify other admin sessions (superAdminToken) remain valid (Isolation check)
      const verifySuper = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/auth/me',
        headers: { 'x-admin-session-token': superAdminToken }
      });
      assert.equal(verifySuper.statusCode, 200);
    });

    test('2.3 Login with old password fails, login with new password succeeds', async () => {
      // Attempt login with old password
      const oldLoginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/auth/login',
        payload: {
          email: targetAdminEmail,
          password: testPassword
        }
      });
      assert.equal(oldLoginRes.statusCode, 401);

      // Login with new password
      const newLoginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/auth/login',
        payload: {
          email: targetAdminEmail,
          password: newPassword
        }
      });
      assert.equal(newLoginRes.statusCode, 200);
      const json = JSON.parse(newLoginRes.body);
      assert.equal(json.data.requiresOtp, true);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. BULK SESSION REVOCATION ON ADMIN STATUS DISABLE & RE-ENABLE
  // ---------------------------------------------------------------------------
  describe('3. Admin Status Mutation Session Revocation', () => {
    let sessionTokenC: string;

    before(async () => {
      sessionTokenC = generateSessionToken();
      await prisma.adminSession.create({
        data: {
          adminId: targetAdminId,
          sessionTokenHash: hashSessionToken(sessionTokenC),
          expiresAt: new Date(Date.now() + 86400000),
          lastActivityAt: new Date()
        }
      });
    });

    test('3.1 Disabling admin account revokes all active sessions immediately', async () => {
      // SuperAdmin disables targetAdmin
      const disableRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/auth/admins/${targetAdminId}/status`,
        headers: { 'x-admin-session-token': superAdminToken },
        payload: { status: 'DISABLED' }
      });

      assert.equal(disableRes.statusCode, 200);

      // Verify sessionTokenC is immediately rejected
      const verifyRes = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/auth/me',
        headers: { 'x-admin-session-token': sessionTokenC }
      });
      assert.equal(verifyRes.statusCode, 401);
    });

    test('3.2 Disabled admin cannot log in', async () => {
      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/auth/login',
        payload: {
          email: targetAdminEmail,
          password: newPassword
        }
      });

      assert.equal(loginRes.statusCode, 401);
      const json = JSON.parse(loginRes.body);
      assert.match(json.error.message, /disabled/i);
    });

    test('3.3 Re-enabling admin does NOT resurrect previously revoked sessions', async () => {
      // SuperAdmin re-enables targetAdmin
      const enableRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/auth/admins/${targetAdminId}/status`,
        headers: { 'x-admin-session-token': superAdminToken },
        payload: { status: 'ACTIVE' }
      });

      assert.equal(enableRes.statusCode, 200);

      // Old session remains dead
      const oldSessionCheck = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/auth/me',
        headers: { 'x-admin-session-token': sessionTokenC }
      });
      assert.equal(oldSessionCheck.statusCode, 401);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. HARDENED RBAC PARAMETER VALIDATIONS & ANTI-ESCALATION
  // ---------------------------------------------------------------------------
  describe('4. Hardened RBAC Parameter Validations', () => {
    test('4.1 Rejects empty / whitespace role assignment body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/rbac/admins/${targetAdminId}/roles`,
        headers: { 'x-admin-session-token': superAdminToken },
        payload: { roleSlug: '   ' }
      });

      assert.equal(res.statusCode, 400);
      const json = JSON.parse(res.body);
      assert.equal(json.error.code, 'VALIDATION_ERROR');
    });

    test('4.2 Rejects unexpected extra properties in role assignment body (strict schema)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/rbac/admins/${targetAdminId}/roles`,
        headers: { 'x-admin-session-token': superAdminToken },
        payload: { roleSlug: 'ADMIN', maliciousField: true }
      });

      assert.equal(res.statusCode, 400);
      const json = JSON.parse(res.body);
      assert.equal(json.error.code, 'VALIDATION_ERROR');
    });

    test('4.3 Rejects malformed role slug with invalid characters', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/rbac/admins/${targetAdminId}/roles`,
        headers: { 'x-admin-session-token': superAdminToken },
        payload: { roleSlug: 'ADMIN<script>alert(1)</script>' }
      });

      assert.equal(res.statusCode, 400);
    });

    test('4.4 Anti-Escalation: Standard Admin cannot assign SUPER_ADMIN role', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/rbac/admins/${targetAdminId}/roles`,
        headers: { 'x-admin-session-token': standardAdminToken },
        payload: { roleSlug: 'SUPER_ADMIN' }
      });

      assert.equal(res.statusCode, 403);
      const json = JSON.parse(res.body);
      assert.equal(json.error.code, 'FORBIDDEN');
    });

    test('4.5 Anti-Escalation: Standard Admin cannot modify their own roles', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/rbac/admins/${standardAdminId}/roles`,
        headers: { 'x-admin-session-token': standardAdminToken },
        payload: { roleSlug: 'OPERATIONS' }
      });

      assert.equal(res.statusCode, 403);
    });
  });
});
