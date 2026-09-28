import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { AdminStatus, AdminAuditAction } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';
import { hashPassword } from '../src/utils/crypto.js';
import { AdminLockoutService } from '../src/services/admin/admin_lockout_service.js';
import { AdminAuditService, GENESIS_HASH } from '../src/services/admin/admin_audit_service.js';
import { AdminAuditSanitizer } from '../src/services/admin/admin_audit_sanitizer.js';
import { seedAdminRbac } from '../src/services/admin/admin_rbac_seed.js';

describe('Admin Rate Limiting & Audit Control Plane (Phase 7.5-D)', () => {
  let app: FastifyInstance;
  let superAdminUser: any;
  let superAdminToken: string;
  let restrictedAdminUser: any;
  let restrictedAdminToken: string;

  const testSuperEmail = `superadmin.75d.${Date.now()}@zdexcloud.com`;
  const testRestrictedEmail = `restricted.75d.${Date.now()}@zdexcloud.com`;
  const testPassword = 'SecurePassword123!';

  before(async () => {
    app = await buildApp();
    await app.ready();

    // Ensure RBAC permissions & roles are seeded
    await seedAdminRbac();

    // Create test SuperAdmin
    superAdminUser = await prisma.adminUser.create({
      data: {
        email: testSuperEmail,
        passwordHash: hashPassword(testPassword),
        name: 'Super Admin 7.5-D',
        status: AdminStatus.ACTIVE,
        isSuperAdmin: true
      }
    });

    // Create session for SuperAdmin
    const rawSuperToken = crypto.randomBytes(32).toString('hex');
    const superTokenHash = crypto.createHash('sha256').update(rawSuperToken).digest('hex');
    await prisma.adminSession.create({
      data: {
        adminId: superAdminUser.id,
        sessionTokenHash: superTokenHash,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });
    superAdminToken = rawSuperToken;

    // Create test Restricted Admin (no audit.read or audit.export permissions)
    restrictedAdminUser = await prisma.adminUser.create({
      data: {
        email: testRestrictedEmail,
        passwordHash: hashPassword(testPassword),
        name: 'Restricted Admin 7.5-D',
        status: AdminStatus.ACTIVE,
        isSuperAdmin: false
      }
    });

    const rawRestrictedToken = crypto.randomBytes(32).toString('hex');
    const restrictedTokenHash = crypto.createHash('sha256').update(rawRestrictedToken).digest('hex');
    await prisma.adminSession.create({
      data: {
        adminId: restrictedAdminUser.id,
        sessionTokenHash: restrictedTokenHash,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });
    restrictedAdminToken = rawRestrictedToken;
  });

  after(async () => {
    // Cleanup test artifacts
    await prisma.adminLockout.deleteMany({});
    await prisma.adminUser.deleteMany({
      where: {
        email: { in: [testSuperEmail, testRestrictedEmail] }
      }
    });
    await app.close();
  });

  // =========================================================================
  // 1. DISTRIBUTED / DB-BACKED ADMIN LOCKOUT TESTS (SEC-MED-02)
  // =========================================================================
  describe('1. Distributed / DB-Backed Brute-Force Lockout', () => {
    const lockoutEmail = `lockout.test.${Date.now()}@zdexcloud.com`;
    const clientIp = '192.168.1.50';

    before(async () => {
      await prisma.adminUser.create({
        data: {
          email: lockoutEmail,
          passwordHash: hashPassword(testPassword),
          name: 'Lockout Test Admin',
          status: AdminStatus.ACTIVE,
          isSuperAdmin: false
        }
      });
    });

    after(async () => {
      await prisma.adminUser.deleteMany({ where: { email: lockoutEmail } });
      await prisma.adminLockout.deleteMany({ where: { key: `${clientIp}_${lockoutEmail}` } });
    });

    test('increments failure counter in admin_lockouts table upon incorrect password', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/auth/login',
        headers: { 'x-forwarded-for': clientIp },
        payload: {
          email: lockoutEmail,
          password: 'WrongPassword123'
        }
      });

      assert.equal(res.statusCode, 401);

      const record = await prisma.adminLockout.findUnique({
        where: { key: `${clientIp}_${lockoutEmail}` }
      });

      assert.ok(record, 'Lockout record must be persisted in database');
      assert.equal(record.failedAttempts, 1);
      assert.equal(record.lockedUntil, null);
    });

    test('triggers 429 lockout after reaching failure threshold (5 attempts)', async () => {
      // Execute 4 more failures to reach threshold of 5
      for (let i = 2; i <= 5; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/admin/auth/login',
          headers: { 'x-forwarded-for': clientIp },
          payload: {
            email: lockoutEmail,
            password: 'WrongPassword123'
          }
        });

        if (i < 5) {
          assert.equal(res.statusCode, 401);
        } else {
          // 5th failure should trigger lockout
          assert.equal(res.statusCode, 401);
        }
      }

      // Check DB record is locked
      const lockRecord = await prisma.adminLockout.findUnique({
        where: { key: `${clientIp}_${lockoutEmail}` }
      });
      assert.ok(lockRecord?.lockedUntil, 'lockedUntil timestamp must be set');
      assert.ok(lockRecord.lockedUntil.getTime() > Date.now());

      // Subsequent attempt must be rejected with 429 RATE_LIMIT_EXCEEDED
      const lockedRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/auth/login',
        headers: { 'x-forwarded-for': clientIp },
        payload: {
          email: lockoutEmail,
          password: testPassword // Even correct password must be rejected during lockout
        }
      });

      assert.equal(lockedRes.statusCode, 429);
      const body = JSON.parse(lockedRes.body);
      assert.equal(body.error.code, 'RATE_LIMIT_EXCEEDED');
      assert.match(body.error.message, /Administrative access locked/);
    });

    test('successful authentication clears lockout record', async () => {
      const clearTestEmail = `clear.test.${Date.now()}@zdexcloud.com`;
      const testIp = '192.168.1.55';

      await prisma.adminUser.create({
        data: {
          email: clearTestEmail,
          passwordHash: hashPassword(testPassword),
          name: 'Clear Test Admin',
          status: AdminStatus.ACTIVE,
          isSuperAdmin: false
        }
      });

      // Record 2 failed attempts
      await AdminLockoutService.recordFailure(testIp, clearTestEmail);
      await AdminLockoutService.recordFailure(testIp, clearTestEmail);

      let record = await prisma.adminLockout.findUnique({
        where: { key: `${testIp}_${clearTestEmail}` }
      });
      assert.equal(record?.failedAttempts, 2);

      // Login attempt with correct password returns 2FA challenge and clears lockout
      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/auth/login',
        headers: { 'x-forwarded-for': testIp },
        payload: {
          email: clearTestEmail,
          password: testPassword
        }
      });

      assert.equal(loginRes.statusCode, 200);

      // Verify lockout record is removed
      record = await prisma.adminLockout.findUnique({
        where: { key: `${testIp}_${clearTestEmail}` }
      });
      assert.equal(record, null, 'Lockout record must be deleted upon login initiation');

      await prisma.adminUser.deleteMany({ where: { email: clearTestEmail } });
    });

    test('applies lockout uniformly to non-existent emails (anti-enumeration)', async () => {
      const nonExistentEmail = `ghost.${Date.now()}@zdexcloud.com`;
      const ghostIp = '192.168.1.99';

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/auth/login',
        headers: { 'x-forwarded-for': ghostIp },
        payload: {
          email: nonExistentEmail,
          password: 'RandomPassword123!'
        }
      });

      assert.equal(res.statusCode, 401);

      const record = await prisma.adminLockout.findUnique({
        where: { key: `${ghostIp}_${nonExistentEmail}` }
      });
      assert.ok(record, 'Lockout must track non-existent emails to mitigate timing and brute-force attacks');
      assert.equal(record.failedAttempts, 1);

      await prisma.adminLockout.deleteMany({ where: { key: `${ghostIp}_${nonExistentEmail}` } });
    });
  });

  // =========================================================================
  // 2. ROUTE-LEVEL RBAC RATE LIMITING TESTS (SEC-MED-03)
  // =========================================================================
  describe('2. Route-Level RBAC Rate Limiting', () => {
    test('enforces route rate limit on RBAC role assignment mutations (max 20/min)', async () => {
      // Execute 20 rapid role assignment requests with invalid data to trigger rate limit
      let hitRateLimit = false;

      for (let i = 0; i < 25; i++) {
        const res = await app.inject({
          method: 'POST',
          url: `/api/v1/admin/rbac/admins/${restrictedAdminUser.id}/roles`,
          headers: {
            'x-admin-session-token': superAdminToken,
            'x-forwarded-for': '10.0.0.1'
          },
          payload: {
            roleSlug: 'INVALID_ROLE'
          }
        });

        if (res.statusCode === 429) {
          hitRateLimit = true;
          const body = JSON.parse(res.body);
          assert.equal(body.error.code, 'TOO_MANY_REQUESTS');
          break;
        }
      }

      assert.ok(hitRateLimit, 'Route rate limiter must trigger 429 on excessive RBAC mutations');
    });

    test('customer endpoints are isolated and unaffected by Admin rate limiting', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/health'
      });

      assert.equal(res.statusCode, 200);
    });
  });

  // =========================================================================
  // 3. SESSION BOOTSTRAP AUDIT LOGGING TESTS (SEC-MED-05)
  // =========================================================================
  describe('3. Session Bootstrap Audit Logging', () => {
    test('GET /api/v1/admin/auth/me logs ADMIN_SESSION_BOOTSTRAP event', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/auth/me',
        headers: {
          'x-admin-session-token': superAdminToken
        }
      });

      assert.equal(res.statusCode, 200);

      // Verify audit record was created
      const audit = await prisma.adminAuditLog.findFirst({
        where: {
          adminId: superAdminUser.id,
          action: AdminAuditAction.ADMIN_SESSION_BOOTSTRAP
        },
        orderBy: { createdAt: 'desc' }
      });

      assert.ok(audit, 'ADMIN_SESSION_BOOTSTRAP event must be recorded in audit log');
      assert.equal(audit.status, 'SUCCESS');
      assert.ok(audit.integrityHash, 'Must have integrity hash');
    });
  });

  // =========================================================================
  // 4. AUDIT QUERY CONTROL PLANE TESTS (AUDIT-01)
  // =========================================================================
  describe('4. Audit Query Control Plane', () => {
    test('unauthenticated request receives 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/audit-logs'
      });

      assert.equal(res.statusCode, 401);
    });

    test('unauthorized admin without audit.read permission receives 403', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/audit-logs',
        headers: {
          'x-admin-session-token': restrictedAdminToken
        }
      });

      assert.equal(res.statusCode, 403);
    });

    test('authorized admin can query audit logs with pagination and filters', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/audit-logs?adminId=${superAdminUser.id}&limit=10`,
        headers: {
          'x-admin-session-token': superAdminToken
        }
      });

      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.success, true);
      assert.ok(Array.isArray(body.data.data));
      assert.ok(body.data.pagination.total >= 1);
      assert.equal(body.data.pagination.limit, 10);
      assert.equal(body.data.pagination.page, 1);

      // Verify each record contains required sanitized fields
      const record = body.data.data[0];
      assert.ok(record.id);
      assert.ok(record.action);
      assert.ok(record.createdAt);
      assert.ok(record.integrityHash);
    });
  });

  // =========================================================================
  // 5. AUDIT EXPORT TESTS (AUDIT-02)
  // =========================================================================
  describe('5. Audit Export Control Plane', () => {
    test('unauthorized admin receives 403 on export', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/audit-logs/export',
        headers: {
          'x-admin-session-token': restrictedAdminToken
        }
      });

      assert.equal(res.statusCode, 403);
    });

    test('authorized admin can export audit logs as CSV with sanitized headers', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/audit-logs/export?adminId=${superAdminUser.id}&format=csv`,
        headers: {
          'x-admin-session-token': superAdminToken
        }
      });

      assert.equal(res.statusCode, 200);
      assert.match(String(res.headers['content-type'] || ''), /text\/csv/);
      assert.match(String(res.headers['content-disposition'] || ''), /attachment; filename="zdex-admin-audit-logs-/);

      // Verify CSV header line
      const lines = res.body.split('\r\n');
      assert.equal(lines[0], '"ID","Sequence","Timestamp","Admin ID","Admin Email","Action","Status","IP Address","User Agent","Metadata","Integrity Hash"');
      assert.ok(lines.length >= 2, 'CSV must have at least one data row');
    });

    test('authorized admin can export audit logs as JSON', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/audit-logs/export?adminId=${superAdminUser.id}&format=json`,
        headers: {
          'x-admin-session-token': superAdminToken
        }
      });

      assert.equal(res.statusCode, 200);
      assert.match(String(res.headers['content-type'] || ''), /application\/json/);
      const parsed = JSON.parse(res.body);
      assert.ok(Array.isArray(parsed));
      assert.ok(parsed.length >= 1);
    });
  });

  // =========================================================================
  // 6. TAMPER-RESISTANT CRYPTOGRAPHIC INTEGRITY TESTS (AUDIT-03)
  // =========================================================================
  describe('6. Cryptographic Integrity Chaining & Tamper Detection', () => {
    test('unaltered audit chain passes cryptographic integrity verification', async () => {
      const result = await AdminAuditService.verifyIntegrity(superAdminUser.id);
      assert.equal(result.isValid, true);
      assert.ok(result.verifiedRecords > 0);
      assert.equal(result.errors.length, 0);
    });

    test('POST /api/v1/admin/audit-logs/verify-integrity returns verification report', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/audit-logs/verify-integrity',
        headers: {
          'x-admin-session-token': superAdminToken
        }
      });

      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.success, true);
      assert.equal(body.data.isValid, true);
    });

    test('detects tampered record in audit chain when database row is altered', async () => {
      // 1. Create a dummy audit event
      const testAudit = await AdminAuditService.logEvent({
        adminId: superAdminUser.id,
        action: AdminAuditAction.ADMIN_ROLE_CREATED,
        status: 'SUCCESS',
        metadata: { role: 'TEST_TAMPER_ROLE' }
      });

      // 2. Tamper with the record directly in the database (simulating malicious DB modification)
      await prisma.adminAuditLog.update({
        where: { id: testAudit.id },
        data: {
          status: 'TAMPERED_MODIFIED_STATUS'
        }
      });

      // 3. Verify integrity - must detect hash mismatch!
      const verification = await AdminAuditService.verifyIntegrity();
      assert.equal(verification.isValid, false, 'Integrity verification must fail on tampered record');
      assert.ok(verification.errors.some(e => e.includes(testAudit.id) && e.includes('TAMPER DETECTED')));

      // Restore/delete the tampered record
      await prisma.adminAuditLog.delete({ where: { id: testAudit.id } });
    });
  });

  // =========================================================================
  // 7. AUDIT METADATA SANITIZATION TESTS (AUDIT-04)
  // =========================================================================
  describe('7. Audit Metadata Sanitization & Injection Defense', () => {
    test('redacts sensitive keys from metadata (passwords, tokens, secrets, cookies)', () => {
      const dirty = {
        email: 'admin@zdexcloud.com',
        password: 'SuperSecretPassword!',
        sessionToken: 'raw_session_token_123',
        apiKeySecret: 'secret_key_456',
        authHeader: 'Bearer token_789',
        otpCode: '123456',
        normalField: 'safe_value'
      };

      const sanitized = AdminAuditSanitizer.sanitizeMetadata(dirty) as Record<string, unknown>;
      assert.equal(sanitized.email, 'admin@zdexcloud.com');
      assert.equal(sanitized.password, '[REDACTED]');
      assert.equal(sanitized.sessionToken, '[REDACTED]');
      assert.equal(sanitized.apiKeySecret, '[REDACTED]');
      assert.equal(sanitized.authHeader, '[REDACTED]');
      assert.equal(sanitized.otpCode, '[REDACTED]');
      assert.equal(sanitized.normalField, 'safe_value');
    });

    test('strips CR/LF characters to prevent log injection', () => {
      const injected = 'AdminAction\r\nFakeLogEntry: SUCCESS\nAnotherLine\tTabbed';
      const clean = AdminAuditSanitizer.sanitizeString(injected);
      assert.equal(clean.includes('\r'), false);
      assert.equal(clean.includes('\n'), false);
      assert.equal(clean, 'AdminAction  FakeLogEntry: SUCCESS AnotherLine Tabbed');
    });
  });
});
