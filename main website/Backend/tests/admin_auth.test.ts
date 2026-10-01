import assert from 'node:assert';
import { test, describe, before, after, beforeEach } from 'node:test';
import { FastifyInstance } from 'fastify';
import { AdminStatus, AdminAuditAction, AdminOtpPurpose } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';
import {
  hashPassword,
  verifyPassword,
  generateSessionToken,
  hashSessionToken,
  hashOtp
} from '../src/utils/crypto.js';
import {
  AdminAuthService,
  ADMIN_IDLE_TIMEOUT_MS,
  clearFailedAttempts
} from '../src/services/admin/admin_auth_service.js';
import { bootstrapSuperAdmin } from '../src/services/admin/admin_bootstrap.js';

describe('Admin Authentication & Session Foundation (Phase 7.2)', () => {
  let app: FastifyInstance;
  const adminEmail = `admin.test.${Date.now()}@zdexcloud.internal`;
  const adminPassword = 'AdminStrongPassword2026!';
  let adminUser: any;
  let activeSessionToken = '';
  let customerUser: any;
  let customerToken = '';

  before(async () => {
    app = await buildApp();
    await app.ready();

    // 1. Create a test Admin User
    adminUser = await prisma.adminUser.create({
      data: {
        email: adminEmail,
        passwordHash: hashPassword(adminPassword),
        name: 'Test Administrator',
        status: AdminStatus.ACTIVE,
        isSuperAdmin: true
      }
    });

    // 2. Create a test Customer User & Session to verify Cross-Plane Isolation
    const customerEmail = `customer.test.${Date.now()}@zdexcloud.com`;
    customerUser = await prisma.user.create({
      data: {
        email: customerEmail,
        passwordHash: hashPassword('CustomerPass123!'),
        fullName: 'Test Customer',
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    customerToken = generateSessionToken();
    await prisma.userSession.create({
      data: {
        userId: customerUser.id,
        tokenHash: hashSessionToken(customerToken),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });
  });

  after(async () => {
    try {
      await prisma.adminUser.deleteMany({
        where: { email: { contains: 'admin.test.' } }
      });
      await prisma.user.deleteMany({
        where: { email: { contains: 'customer.test.' } }
      });
    } catch {
      // Ignore cleanup errors on remote DB
    }
    await app.close();
  });

  beforeEach(() => {
    clearFailedAttempts('127.0.0.1', adminEmail);
  });

  // A. Admin creation / bootstrap
  test('A. bootstrapSuperAdmin idempotently provisions SuperAdmin without duplicate errors', async () => {
    const bootstrapEmail = `bootstrap.${Date.now()}@zdexcloud.internal`;
    const res1 = await bootstrapSuperAdmin({
      email: bootstrapEmail,
      password: 'BootstrapPassword123!',
      name: 'Bootstrap Admin'
    });
    assert.strictEqual(res1.created, true);
    assert.ok(res1.adminId);

    // Second call should skip without error
    const res2 = await bootstrapSuperAdmin({
      email: bootstrapEmail,
      password: 'BootstrapPassword123!',
      name: 'Bootstrap Admin'
    });
    assert.strictEqual(res2.created, false);
    assert.strictEqual(res2.message.includes('already exists'), true);

    // Cleanup
    await prisma.adminUser.delete({ where: { email: bootstrapEmail } });
  });

  // B & U. Valid Admin authentication & OTP / second-factor flow
  test('B & U. Full 2FA Login Flow: Credential check -> Challenge Token -> OTP verification -> Session Creation', async () => {
    // Step 1: Login with credentials
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/auth/login',
      payload: {
        email: adminEmail,
        password: adminPassword
      }
    });

    assert.strictEqual(loginRes.statusCode, 200);
    const loginBody = JSON.parse(loginRes.payload);
    assert.strictEqual(loginBody.success, true);
    assert.strictEqual(loginBody.data.requiresOtp, true);
    assert.ok(loginBody.data.challengeToken);

    // Fetch the generated OTP from DB
    const otpRecord = await prisma.adminEmailOtp.findFirst({
      where: { adminId: adminUser.id, isUsed: false },
      orderBy: { createdAt: 'desc' }
    });
    assert.ok(otpRecord);

    // Set known OTP hash for testing
    const testOtpCode = '654321';
    await prisma.adminEmailOtp.update({
      where: { id: otpRecord.id },
      data: { otpHash: hashOtp(testOtpCode) }
    });

    // Step 2: Verify OTP
    const verifyRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/auth/verify-otp',
      payload: {
        challengeToken: loginBody.data.challengeToken,
        otp: testOtpCode
      }
    });

    assert.strictEqual(verifyRes.statusCode, 200);
    const verifyBody = JSON.parse(verifyRes.payload);
    assert.strictEqual(verifyBody.success, true);
    assert.ok(verifyBody.data.sessionToken);
    assert.strictEqual(verifyBody.data.admin.email, adminEmail);
    assert.strictEqual(verifyBody.data.admin.isSuperAdmin, true);

    activeSessionToken = verifyBody.data.sessionToken;

    // Verify session token is hashed in database (not stored raw)
    const storedSession = await prisma.adminSession.findUnique({
      where: { sessionTokenHash: hashSessionToken(activeSessionToken) }
    });
    assert.ok(storedSession);
    assert.strictEqual(storedSession.adminId, adminUser.id);
  });

  // Direct login with OTP in single request
  test('B2. Direct Login with pre-supplied OTP succeeds in single request', async () => {
    // Create an active OTP record
    const directOtp = '112233';
    await prisma.adminEmailOtp.create({
      data: {
        adminId: adminUser.id,
        email: adminEmail,
        otpHash: hashOtp(directOtp),
        purpose: AdminOtpPurpose.ADMIN_LOGIN_2FA,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000)
      }
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/auth/login',
      payload: {
        email: adminEmail,
        password: adminPassword,
        otp: directOtp
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, true);
    assert.ok(body.data.sessionToken);
  });

  // C. Invalid email
  test('C. Invalid email returns 401 and does not disclose existence', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/auth/login',
      payload: {
        email: 'nonexistent.admin@zdexcloud.internal',
        password: 'SomePassword123!'
      }
    });

    assert.strictEqual(res.statusCode, 401);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.message, 'Invalid email or password');
  });

  // D. Invalid password
  test('D. Invalid password returns 401 with sanitized message', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/auth/login',
      payload: {
        email: adminEmail,
        password: 'WrongPassword999!'
      }
    });

    assert.strictEqual(res.statusCode, 401);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.message, 'Invalid email or password');
  });

  // E. Disabled Admin
  test('E. Disabled Admin login is rejected with 401', async () => {
    const disabledEmail = `disabled.admin.${Date.now()}@zdexcloud.internal`;
    const disabledAdmin = await prisma.adminUser.create({
      data: {
        email: disabledEmail,
        passwordHash: hashPassword('DisabledPass123!'),
        name: 'Disabled Admin',
        status: AdminStatus.DISABLED
      }
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/auth/login',
      payload: {
        email: disabledEmail,
        password: 'DisabledPass123!'
      }
    });

    assert.strictEqual(res.statusCode, 401);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.message, 'Admin account is disabled');

    await prisma.adminUser.delete({ where: { id: disabledAdmin.id } });
  });

  // F. Missing authentication
  test('F. GET /api/v1/admin/auth/me without token returns 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/auth/me'
    });

    assert.strictEqual(res.statusCode, 401);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.message.includes('Missing admin session token'), true);
  });

  // G. Invalid Admin token
  test('G. GET /api/v1/admin/auth/me with invalid token returns 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/auth/me',
      headers: {
        'x-admin-session-token': 'completely_bogus_token_123456789'
      }
    });

    assert.strictEqual(res.statusCode, 401);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, false);
  });

  // J, K, R, S. Valid Admin session on /admin/auth/me & Sanitization
  test('J, K, R, S. GET /api/v1/admin/auth/me resolves identity and NEVER returns passwordHash or token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/auth/me',
      headers: {
        'x-admin-session-token': activeSessionToken
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.admin.email, adminEmail);
    assert.strictEqual(body.data.admin.name, 'Test Administrator');
    assert.strictEqual(body.data.admin.status, 'ACTIVE');

    // Sanitization invariants
    assert.strictEqual(body.data.admin.passwordHash, undefined);
    assert.strictEqual(body.data.admin.sessionToken, undefined);
    assert.strictEqual(body.data.admin.sessionTokenHash, undefined);
  });

  // Bearer token support for admin
  test('J2. GET /api/v1/admin/auth/me also supports Authorization: Bearer <adminToken>', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/auth/me',
      headers: {
        authorization: `Bearer ${activeSessionToken}`
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.admin.email, adminEmail);
  });

  // H & Q. Expired Admin session & Absolute Expiration
  test('H & Q. Expired Admin session (absolute expiration) returns 401', async () => {
    // Manually expire session
    await prisma.adminSession.update({
      where: { sessionTokenHash: hashSessionToken(activeSessionToken) },
      data: { expiresAt: new Date(Date.now() - 10000) }
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/auth/me',
      headers: {
        'x-admin-session-token': activeSessionToken
      }
    });

    assert.strictEqual(res.statusCode, 401);
  });

  // P. Session Idle Timeout (15 minutes)
  test('P. Session idle timeout (> 15 minutes inactive) returns 401', async () => {
    // Create a new active session
    const idleToken = generateSessionToken();
    await prisma.adminSession.create({
      data: {
        adminId: adminUser.id,
        sessionTokenHash: hashSessionToken(idleToken),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        lastActivityAt: new Date(Date.now() - (ADMIN_IDLE_TIMEOUT_MS + 5000)) // 15 min 5 sec ago
      }
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/auth/me',
      headers: {
        'x-admin-session-token': idleToken
      }
    });

    assert.strictEqual(res.statusCode, 401);
  });

  // L, M, I, X. Logout & Session Revocation
  test('L, M, I, X. POST /api/v1/admin/auth/logout revokes session immediately and is idempotent', async () => {
    // Create fresh session
    const logoutToken = generateSessionToken();
    await prisma.adminSession.create({
      data: {
        adminId: adminUser.id,
        sessionTokenHash: hashSessionToken(logoutToken),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        lastActivityAt: new Date()
      }
    });

    // First logout
    const logoutRes1 = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/auth/logout',
      headers: {
        'x-admin-session-token': logoutToken
      }
    });
    assert.strictEqual(logoutRes1.statusCode, 200);

    // Verify session revoked in DB
    const sessionInDb = await prisma.adminSession.findUnique({
      where: { sessionTokenHash: hashSessionToken(logoutToken) }
    });
    assert.ok(sessionInDb?.revokedAt);

    // Subsequent access with revoked token must fail
    const meRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/auth/me',
      headers: {
        'x-admin-session-token': logoutToken
      }
    });
    assert.strictEqual(meRes.statusCode, 401);

    // Repeated logout should be safe and return 200
    const logoutRes2 = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/auth/logout',
      headers: {
        'x-admin-session-token': logoutToken
      }
    });
    assert.strictEqual(logoutRes2.statusCode, 200);
  });

  // N. Customer token against Admin endpoint
  test('N. Customer session token against Admin endpoint returns 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/auth/me',
      headers: {
        'x-admin-session-token': customerToken
      }
    });

    assert.strictEqual(res.statusCode, 401);
  });

  // O. Admin token against customer endpoint
  test('O. Admin session token against Customer endpoint (/api/v1/auth/me) is rejected', async () => {
    // Create valid admin token
    const testAdminToken = generateSessionToken();
    await prisma.adminSession.create({
      data: {
        adminId: adminUser.id,
        sessionTokenHash: hashSessionToken(testAdminToken),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        lastActivityAt: new Date()
      }
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: {
        authorization: `Bearer ${testAdminToken}`
      }
    });

    assert.strictEqual(res.statusCode, 401);
  });

  // Y. Disabled Admin invalidates active session access
  test('Y. Disabling an Admin user immediately blocks subsequent requests with active session', async () => {
    const tempEmail = `temp.admin.${Date.now()}@zdexcloud.internal`;
    const tempAdmin = await prisma.adminUser.create({
      data: {
        email: tempEmail,
        passwordHash: hashPassword('TempPass123!'),
        name: 'Temp Admin',
        status: AdminStatus.ACTIVE
      }
    });

    const tempToken = generateSessionToken();
    await prisma.adminSession.create({
      data: {
        adminId: tempAdmin.id,
        sessionTokenHash: hashSessionToken(tempToken),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        lastActivityAt: new Date()
      }
    });

    // Verify session works initially
    const res1 = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/auth/me',
      headers: { 'x-admin-session-token': tempToken }
    });
    assert.strictEqual(res1.statusCode, 200);

    // Disable the admin user in DB
    await prisma.adminUser.update({
      where: { id: tempAdmin.id },
      data: { status: AdminStatus.DISABLED }
    });

    // Subsequent request must be rejected
    const res2 = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/auth/me',
      headers: { 'x-admin-session-token': tempToken }
    });
    assert.strictEqual(res2.statusCode, 401);

    await prisma.adminUser.delete({ where: { id: tempAdmin.id } });
  });

  // V. Rate limiting & Brute Force Lockout
  test('V. 5 consecutive failed login attempts locks out client IP / account', async () => {
    const bruteForceEmail = `brute.admin.${Date.now()}@zdexcloud.internal`;
    await prisma.adminUser.create({
      data: {
        email: bruteForceEmail,
        passwordHash: hashPassword('RealPassword123!'),
        name: 'Brute Test Admin',
        status: AdminStatus.ACTIVE
      }
    });

    // 5 failed attempts
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/auth/login',
        payload: { email: bruteForceEmail, password: 'WrongPassword' }
      });
      assert.strictEqual(res.statusCode, 401);
    }

    // 6th attempt should be locked out with 429
    const lockedRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/auth/login',
      payload: { email: bruteForceEmail, password: 'RealPassword123!' }
    });
    assert.strictEqual(lockedRes.statusCode, 429);
    const body = JSON.parse(lockedRes.payload);
    assert.strictEqual(body.error.code, 'RATE_LIMIT_EXCEEDED');

    await prisma.adminUser.delete({ where: { email: bruteForceEmail } });
  });

  // W & T. Audit Event Generation & Password Protection
  test('W & T. Admin Audit events are recorded in admin_audit_logs with zero password leakage', async () => {
    const auditLogs = await prisma.adminAuditLog.findMany({
      where: { adminId: adminUser.id },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    assert.ok(auditLogs.length > 0);
    const actions = auditLogs.map(l => l.action);
    assert.ok(actions.includes(AdminAuditAction.ADMIN_LOGIN_SUCCESS) || actions.includes(AdminAuditAction.ADMIN_OTP_SENT));

    // Verify metadata does not contain passwords or raw tokens
    for (const log of auditLogs) {
      const metadataStr = JSON.stringify(log.metadata || {});
      assert.strictEqual(metadataStr.includes(adminPassword), false);
      assert.strictEqual(metadataStr.includes('passwordHash'), false);
    }
  });
});
