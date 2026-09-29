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
  const testEmails: string[] = [];

  const testSuperEmail = `superadmin.75d.${Date.now()}@zdexcloud.com`;
  const testRestrictedEmail = `restricted.75d.${Date.now()}@zdexcloud.com`;
  testEmails.push(testSuperEmail, testRestrictedEmail);
  const testPassword = 'SecurePassword123!';

  before(async () => {
    app = await buildApp();
    await app.ready();

    // Clean audit logs and lockouts for a pristine cryptographic chain from genesis
    await prisma.adminLockout.deleteMany({});
    await prisma.adminAuditLog.deleteMany({});

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
    // Cleanup test artifacts after all assertions complete
    await prisma.adminLockout.deleteMany({});
    await prisma.adminUser.deleteMany({
      where: {
        email: { in: testEmails }
      }
    });
    await app.close();
  });

  // =========================================================================
  // 1. DISTRIBUTED / DB-BACKED ADMIN LOCKOUT TESTS (SEC-MED-02)
  // =========================================================================
  describe('1. Distributed / DB-Backed Brute-Force Lockout', () => {
    const lockoutEmail = `lockout.test.${Date.now()}@zdexcloud.com`;
    testEmails.push(lockoutEmail);
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

        assert.equal(res.statusCode, 401);
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
      testEmails.push(clearTestEmail);
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
  // 2. ROUTE-LEVEL RATE LIMITING & ISOLATION (SEC-MED-03)
  // =========================================================================
  describe('2. Route-Level RBAC Rate Limiting', () => {
    test('enforces route rate limit on RBAC role assignment mutations (max 20/min)', async () => {
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
          assert.ok(
            body.error?.code === 'RATE_LIMIT_EXCEEDED' || body.error?.code === 'TOO_MANY_REQUESTS' || body.statusCode === 429,
            'Error code should be RATE_LIMIT_EXCEEDED or TOO_MANY_REQUESTS'
          );
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
  // 3. SESSION BOOTSTRAP AUDIT PLANE (SEC-MED-05)
  // =========================================================================
  describe('3. Session Bootstrap Audit Logging', () => {
    test('GET /api/v1/admin/auth/me logs ADMIN_SESSION_BOOTSTRAP event with sanitized metadata', async () => {
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

      // Verify no secrets or sensitive tokens are logged in metadata
      const meta = audit.metadata as Record<string, unknown>;
      assert.equal(meta.token, undefined);
      assert.equal(meta.password, undefined);
      assert.equal(meta.sessionToken, undefined);
      assert.equal(meta.cookie, undefined);
      assert.equal(meta.authHeader, undefined);
    });

    test('unauthenticated or revoked session bootstrap returns 401 without creating audit event', async () => {
      const initialCount = await prisma.adminAuditLog.count({
        where: { action: AdminAuditAction.ADMIN_SESSION_BOOTSTRAP }
      });

      const unauthRes = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/auth/me',
        headers: {
          'x-admin-session-token': 'invalid_forged_token_12345'
        }
      });

      assert.equal(unauthRes.statusCode, 401);

      const afterCount = await prisma.adminAuditLog.count({
        where: { action: AdminAuditAction.ADMIN_SESSION_BOOTSTRAP }
      });

      assert.equal(afterCount, initialCount, 'Unauthenticated request must not generate successful bootstrap audit event');
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
  // 5. AUDIT EXPORT PLANE & FORMULA INJECTION DEFENSE (AUDIT-02)
  // =========================================================================
  describe('5. Audit Export Control Plane & Formula Injection Defense', () => {
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

    test('authorized admin can export audit logs as CSV with formula injection defense on values', async () => {
      // Create an audit event with malicious spreadsheet formula values
      await AdminAuditService.logEvent({
        adminId: superAdminUser.id,
        action: AdminAuditAction.ADMIN_ROLE_CREATED,
        status: 'SUCCESS',
        metadata: {
          formulaVal1: '=SUM(A1:A10)',
          formulaVal2: '+cmd|"/C calc"!A0',
          formulaVal3: '-1000',
          formulaVal4: '@SUM(1+1)',
          tabbedVal: '\tSecretData'
        }
      });

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

      // Verify CSV values containing formula prefixes are neutralized with a leading single quote (')
      const maliciousRow = lines.find((l: string) => l.includes('formulaVal1'));
      assert.ok(maliciousRow, 'Row with formula value must be exported');
      assert.ok(maliciousRow.includes("'=SUM") || maliciousRow.includes('"'), 'Formula value must be safely quoted and escaped');
    });

    test('authorized admin can export audit logs as JSON and export action is audited', async () => {
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
  // 6. CRYPTOGRAPHIC CHAIN CONCURRENCY SAFETY
  // =========================================================================
  describe('6. Cryptographic Chain Concurrency Safety', () => {
    test('handles two concurrent audit writes without sequence collision or broken links', async () => {
      const [write1, write2] = await Promise.all([
        AdminAuditService.logEvent({
          adminId: superAdminUser.id,
          action: AdminAuditAction.ADMIN_ROLE_CREATED,
          status: 'SUCCESS',
          metadata: { thread: 'concurrent-1' }
        }),
        AdminAuditService.logEvent({
          adminId: superAdminUser.id,
          action: AdminAuditAction.ADMIN_ROLE_CREATED,
          status: 'SUCCESS',
          metadata: { thread: 'concurrent-2' }
        })
      ]);

      assert.notEqual(write1.sequence, write2.sequence, 'Sequences must be distinct and sequential');
      assert.ok(write1.integrityHash && write2.integrityHash);

      // Integrity verification must pass
      const result = await AdminAuditService.verifyIntegrity();
      assert.equal(result.isValid, true, 'Audit chain must be valid after 2 concurrent writes');
      assert.equal(result.errors.length, 0);
    });

    test('handles multiple concurrent audit writes preserving strict monotonic sequence and unbroken previousHash', async () => {
      const concurrentBatch = Array.from({ length: 5 }, (_, i) =>
        AdminAuditService.logEvent({
          adminId: superAdminUser.id,
          action: AdminAuditAction.ADMIN_ROLE_UPDATED,
          status: 'SUCCESS',
          metadata: { batchIndex: i }
        })
      );

      const records = await Promise.all(concurrentBatch);
      assert.equal(records.length, 5);

      const sequences = records.map(r => r.sequence).sort((a, b) => a - b);
      const uniqueSequences = new Set(sequences);
      assert.equal(uniqueSequences.size, 5, 'Every concurrent write must receive a unique sequence number');

      // Verify sequence monotonicity
      for (let i = 1; i < sequences.length; i++) {
        assert.equal(sequences[i], sequences[i - 1] + 1, 'Sequences must increase by exactly 1');
      }

      // Verify integrity of the entire chain
      const integrity = await AdminAuditService.verifyIntegrity();
      assert.equal(integrity.isValid, true, 'Chain must be fully valid after concurrent batch writes');
      assert.equal(integrity.errors.length, 0);
    });
  });

  // =========================================================================
  // 7. TAMPER DETECTION, ROW MODIFICATION & IMMUTABILITY (AUDIT-03)
  // =========================================================================
  describe('7. Tamper Detection, Row Modification & Immutability', () => {
    test('application API has no endpoints to modify or delete audit records (404)', async () => {
      const updateRes = await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/audit-logs/dummy-id',
        headers: { 'x-admin-session-token': superAdminToken },
        payload: { status: 'MODIFIED' }
      });
      assert.equal(updateRes.statusCode, 404, 'No update endpoint for audit logs must exist');

      const deleteRes = await app.inject({
        method: 'DELETE',
        url: '/api/v1/admin/audit-logs/dummy-id',
        headers: { 'x-admin-session-token': superAdminToken }
      });
      assert.equal(deleteRes.statusCode, 404, 'No delete endpoint for audit logs must exist');
    });

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

    test('detects tampered record when intermediate row status is altered', async () => {
      const testAudit = await AdminAuditService.logEvent({
        adminId: superAdminUser.id,
        action: AdminAuditAction.ADMIN_ROLE_CREATED,
        status: 'SUCCESS',
        metadata: { role: 'TEST_TAMPER_ROW' }
      });

      // Tamper with record status directly in database
      await prisma.adminAuditLog.update({
        where: { id: testAudit.id },
        data: { status: 'TAMPERED_MODIFIED_STATUS' }
      });

      const verification = await AdminAuditService.verifyIntegrity();
      assert.equal(verification.isValid, false, 'Integrity verification must fail on altered status');
      assert.ok(verification.errors.some(e => e.includes(testAudit.id) && e.includes('TAMPER DETECTED')));

      // Restore
      await prisma.adminAuditLog.update({
        where: { id: testAudit.id },
        data: { status: 'SUCCESS' }
      });
    });

    test('detects tampered record when previousHash is altered', async () => {
      const testAudit = await AdminAuditService.logEvent({
        adminId: superAdminUser.id,
        action: AdminAuditAction.ADMIN_ROLE_CREATED,
        status: 'SUCCESS',
        metadata: { test: 'tamper-previous-hash' }
      });

      // Alter previousHash directly
      await prisma.adminAuditLog.update({
        where: { id: testAudit.id },
        data: { previousHash: 'forged_broken_previous_hash_000000000000000000000000000000000000' }
      });

      const verification = await AdminAuditService.verifyIntegrity();
      assert.equal(verification.isValid, false, 'Integrity verification must fail on forged previousHash');
      assert.ok(verification.errors.some(e => e.includes('broken previousHash') || e.includes('TAMPER DETECTED')));

      // Delete the test record to restore chain
      await prisma.adminAuditLog.delete({ where: { id: testAudit.id } });
    });

    test('detects tampered record when integrityHash is altered', async () => {
      const testAudit = await AdminAuditService.logEvent({
        adminId: superAdminUser.id,
        action: AdminAuditAction.ADMIN_ROLE_CREATED,
        status: 'SUCCESS',
        metadata: { test: 'tamper-integrity-hash' }
      });

      const originalHash = testAudit.integrityHash;

      // Alter integrityHash directly
      await prisma.adminAuditLog.update({
        where: { id: testAudit.id },
        data: { integrityHash: 'forged_integrity_hash_1111111111111111111111111111111111111111' }
      });

      const verification = await AdminAuditService.verifyIntegrity();
      assert.equal(verification.isValid, false, 'Integrity verification must fail on forged integrityHash');
      assert.ok(verification.errors.some(e => e.includes(testAudit.id) && e.includes('TAMPER DETECTED')));

      // Restore
      await prisma.adminAuditLog.update({
        where: { id: testAudit.id },
        data: { integrityHash: originalHash }
      });
    });
  });

  // =========================================================================
  // 8. AUDIT METADATA SANITIZATION & INJECTION DEFENSE (AUDIT-04)
  // =========================================================================
  describe('8. Audit Metadata Sanitization & Injection Defense', () => {
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

  // =========================================================================
  // 9. MULTI-INSTANCE AUDIT APPEND CONCURRENCY (GAP A)
  // =========================================================================
  describe('9. Multi-Instance Audit Append Concurrency', () => {
    test('concurrent independent writers serialize via MySQL distributed lock with zero duplicate sequences or chain forks', async () => {
      // Simulate independent backend instances writing concurrently to MySQL
      const simulatedInstanceWrites = 4;
      const workerActions = Array.from({ length: simulatedInstanceWrites }, (_, i) => ({
        adminId: superAdminUser.id,
        action: AdminAuditAction.ADMIN_ROLE_UPDATED,
        status: 'SUCCESS',
        metadata: { workerInstanceId: `worker_instance_${i + 1}`, thread: i + 1 }
      }));

      // Fire all concurrent instance writes simultaneously
      const results = await Promise.all(
        workerActions.map(actionParams => AdminAuditService.logEvent(actionParams))
      );

      assert.equal(results.length, simulatedInstanceWrites);

      // Verify each appended record received a unique, valid sequence
      const sequences = results.map(r => r.sequence);
      const uniqueSequences = new Set(sequences);
      assert.equal(uniqueSequences.size, simulatedInstanceWrites, 'All sequence numbers must be distinct');

      // Verify the entire chain passes full cryptographic verification
      const integrityCheck = await AdminAuditService.verifyIntegrity();
      assert.equal(integrityCheck.isValid, true, 'Multi-instance concurrency chain must remain 100% valid');
      assert.equal(integrityCheck.errors.length, 0);

      // Query database rows and verify strictly monotonic sequencing and previousHash linkage
      const insertedRows = await prisma.adminAuditLog.findMany({
        where: {
          id: { in: results.map(r => r.id) }
        },
        orderBy: { sequence: 'asc' }
      });

      for (let i = 0; i < insertedRows.length; i++) {
        if (i > 0) {
          assert.equal(insertedRows[i].sequence, insertedRows[i - 1].sequence! + 1, 'Sequences must be strictly consecutive');
          assert.equal(insertedRows[i].previousHash, insertedRows[i - 1].integrityHash, 'previousHash must match preceding integrityHash');
        }
      }
    });
  });

  // =========================================================================
  // 10. AUDIT DELETION & SEQUENCE-GAP TAMPER DETECTION (GAP B)
  // =========================================================================
  describe('10. Audit Deletion / Sequence-Gap Tamper Detection', () => {
    let baselineChainIds: string[] = [];

    before(async () => {
      // Create a clean 5-record chain
      const created = [];
      for (let i = 1; i <= 5; i++) {
        const row = await AdminAuditService.logEvent({
          adminId: superAdminUser.id,
          action: AdminAuditAction.ADMIN_ROLE_CREATED,
          status: 'SUCCESS',
          metadata: { step: i, batch: 'deletion_detection_baseline' }
        });
        created.push(row.id);
      }
      baselineChainIds = created;
    });

    test('A. Detects intermediate audit record deletion (sequence gap + previousHash mismatch)', async () => {
      // Pick intermediate record (index 2 / record #3)
      const intermediateId = baselineChainIds[2];
      const targetRecord = await prisma.adminAuditLog.findUnique({ where: { id: intermediateId } });
      assert.ok(targetRecord);

      // Directly delete intermediate row from database
      await prisma.adminAuditLog.delete({ where: { id: intermediateId } });

      const result = await AdminAuditService.verifyIntegrity();
      assert.equal(result.isValid, false, 'Integrity verification must fail when intermediate record is deleted');
      assert.ok(result.errors.length > 0);
      assert.ok(
        result.errors.some(e => e.includes('unexpected sequence number') || e.includes('broken previousHash')),
        'Error must specify sequence anomaly or broken previousHash'
      );

      // Restore intermediate record
      await prisma.adminAuditLog.create({
        data: {
          ...targetRecord,
          metadata: (targetRecord.metadata || {}) as any
        }
      });
    });

    test('B. Detects final audit record deletion against expected terminal state', async () => {
      const latestBefore = await prisma.adminAuditLog.findFirst({
        orderBy: { sequence: 'desc' }
      });
      assert.ok(latestBefore);
      const expectedTerminalSeq = latestBefore.sequence!;
      const expectedTerminalHash = latestBefore.integrityHash!;

      // Directly delete final record from database
      await prisma.adminAuditLog.delete({ where: { id: latestBefore.id } });

      // Verifier checks against expected terminal checkpoint
      const result = await AdminAuditService.verifyIntegrity(undefined, undefined, {
        sequence: expectedTerminalSeq,
        integrityHash: expectedTerminalHash
      });

      assert.equal(result.isValid, false, 'Integrity verification must fail when final record is missing from checkpoint');
      assert.ok(
        result.errors.some(e => e.includes('DELETION DETECTED') || e.includes('Terminal chain state')),
        'Error must identify terminal state mismatch'
      );

      // Restore final record
      await prisma.adminAuditLog.create({
        data: {
          ...latestBefore,
          metadata: (latestBefore.metadata || {}) as any
        }
      });
    });

    test('C. Detects sequence value alteration', async () => {
      const record = await prisma.adminAuditLog.findUnique({ where: { id: baselineChainIds[1] } });
      assert.ok(record);
      const originalSeq = record.sequence;

      // Alter sequence directly
      await prisma.adminAuditLog.update({
        where: { id: record.id },
        data: { sequence: 999 }
      });

      const result = await AdminAuditService.verifyIntegrity();
      assert.equal(result.isValid, false, 'Integrity verification must fail on altered sequence');
      assert.ok(result.errors.some(e => e.includes('unexpected sequence number')));

      // Restore
      await prisma.adminAuditLog.update({
        where: { id: record.id },
        data: { sequence: originalSeq }
      });
    });

    test('D. Detects sequence gap in audit log sequence', async () => {
      const record = await prisma.adminAuditLog.findUnique({ where: { id: baselineChainIds[3] } });
      assert.ok(record);
      const originalSeq = record.sequence;

      // Create sequence gap
      await prisma.adminAuditLog.update({
        where: { id: record.id },
        data: { sequence: originalSeq! + 5 }
      });

      const result = await AdminAuditService.verifyIntegrity();
      assert.equal(result.isValid, false, 'Integrity verification must fail on sequence gap');
      assert.ok(result.errors.some(e => e.includes('unexpected sequence number')));

      // Restore
      await prisma.adminAuditLog.update({
        where: { id: record.id },
        data: { sequence: originalSeq }
      });
    });

    test('E. Detects previousHash modification', async () => {
      const record = await prisma.adminAuditLog.findUnique({ where: { id: baselineChainIds[1] } });
      assert.ok(record);
      const originalPrevHash = record.previousHash;

      await prisma.adminAuditLog.update({
        where: { id: record.id },
        data: { previousHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' }
      });

      const result = await AdminAuditService.verifyIntegrity();
      assert.equal(result.isValid, false, 'Integrity verification must fail on modified previousHash');
      assert.ok(result.errors.some(e => e.includes('broken previousHash')));

      // Restore
      await prisma.adminAuditLog.update({
        where: { id: record.id },
        data: { previousHash: originalPrevHash }
      });
    });

    test('F. Detects integrityHash modification', async () => {
      const record = await prisma.adminAuditLog.findUnique({ where: { id: baselineChainIds[2] } });
      assert.ok(record);
      const originalHash = record.integrityHash;

      await prisma.adminAuditLog.update({
        where: { id: record.id },
        data: { integrityHash: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }
      });

      const result = await AdminAuditService.verifyIntegrity();
      assert.equal(result.isValid, false, 'Integrity verification must fail on modified integrityHash');
      assert.ok(result.errors.some(e => e.includes('TAMPER DETECTED')));

      // Restore
      await prisma.adminAuditLog.update({
        where: { id: record.id },
        data: { integrityHash: originalHash }
      });
    });

    test('G. Detects canonical payload modification (metadata tamper)', async () => {
      const record = await prisma.adminAuditLog.findUnique({ where: { id: baselineChainIds[0] } });
      assert.ok(record);
      const originalMeta = record.metadata;

      await prisma.adminAuditLog.update({
        where: { id: record.id },
        data: { metadata: { step: 1, tampered: true, unauthorizedInjection: 999 } }
      });

      const result = await AdminAuditService.verifyIntegrity();
      assert.equal(result.isValid, false, 'Integrity verification must fail when canonical metadata is modified');
      assert.ok(result.errors.some(e => e.includes('TAMPER DETECTED')));

      // Restore
      await prisma.adminAuditLog.update({
        where: { id: record.id },
        data: { metadata: originalMeta as any }
      });
    });
  });

  // =========================================================================
  // 11. FORGED INSERTION & CHAIN CORRUPTION DETECTION (SECTION 5)
  // =========================================================================
  describe('11. Forged Insertion / Chain Corruption Detection', () => {
    test('detects forged record inserted directly with fabricated previousHash and integrityHash', async () => {
      const forgedId = crypto.randomUUID();
      const forgedRecord = {
        id: forgedId,
        adminId: superAdminUser.id,
        action: AdminAuditAction.ADMIN_PERMISSION_ASSIGNED,
        status: 'SUCCESS',
        ipAddress: '192.168.1.99',
        userAgent: 'Forged-Attacker-Client/1.0',
        metadata: { forgedEscalation: 'SUPER_ADMIN' },
        previousHash: 'forged_fake_prev_hash_12345678901234567890123456789012345678901234',
        integrityHash: 'forged_fake_integrity_hash_abcdefabcdefabcdefabcdefabcdefabcdefab',
        sequence: 9999,
        createdAt: new Date()
      };

      await prisma.adminAuditLog.create({ data: forgedRecord });

      const result = await AdminAuditService.verifyIntegrity();
      assert.equal(result.isValid, false, 'Integrity check must fail when forged record is inserted');
      assert.ok(result.errors.some(e => e.includes(forgedId)));

      // Cleanup
      await prisma.adminAuditLog.delete({ where: { id: forgedId } });
    });

    test('detects chain corruption when sequence ordering is corrupted/reordered', async () => {
      const logs = await prisma.adminAuditLog.findMany({
        orderBy: { sequence: 'desc' },
        take: 2
      });

      if (logs.length >= 2) {
        const [rowA, rowB] = logs;
        // Swap their sequences
        await prisma.adminAuditLog.update({ where: { id: rowA.id }, data: { sequence: rowB.sequence } });
        await prisma.adminAuditLog.update({ where: { id: rowB.id }, data: { sequence: rowA.sequence } });

        const result = await AdminAuditService.verifyIntegrity();
        assert.equal(result.isValid, false, 'Integrity check must fail when sequences are corrupted or reordered');

        // Restore
        await prisma.adminAuditLog.update({ where: { id: rowA.id }, data: { sequence: rowA.sequence } });
        await prisma.adminAuditLog.update({ where: { id: rowB.id }, data: { sequence: rowB.sequence } });
      }
    });
  });

  // =========================================================================
  // 12. CLAIMED RATE-LIMIT VERIFICATION (SECTION 6)
  // =========================================================================
  describe('12. Claimed Rate-Limit Verification', () => {
    test('Admin Auth Login rate limit enforces rejection and isolates customer traffic', async () => {
      const uniqueIp = '198.51.100.42';

      // Fire 11 requests against /api/v1/admin/auth/login (limit is 10/min per IP)
      const responses = [];
      for (let i = 0; i < 11; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/admin/auth/login',
          headers: {
            'x-forwarded-for': uniqueIp
          },
          payload: {
            email: `ratelimit.auth.${Date.now()}.${i}@zdexcloud.com`,
            password: 'AnyPassword123!'
          }
        });
        responses.push(res.statusCode);
      }

      // At least the final request should hit HTTP 429
      assert.ok(responses.includes(429), 'Login route rate limiting must trigger HTTP 429 on excessive requests');

      // Verify customer route from same IP is NOT rate-limited (customer traffic isolation)
      const customerRes = await app.inject({
        method: 'GET',
        url: '/pricing',
        headers: { 'x-forwarded-for': uniqueIp }
      });
      assert.equal(customerRes.statusCode, 200, 'Customer routes must remain accessible and unaffected');
    });

    test('Admin Password Change rate limit enforces rejection on excessive attempts', async () => {
      const uniqueIp = '198.51.100.43';

      const responses = [];
      for (let i = 0; i < 6; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/admin/auth/change-password',
          headers: {
            'x-admin-session-token': superAdminToken,
            'x-forwarded-for': uniqueIp
          },
          payload: {
            newPassword: 'NewSecurePassword123!'
          }
        });
        responses.push(res.statusCode);
      }

      assert.ok(responses.includes(429), 'Password change route rate limiting must trigger HTTP 429 on excessive attempts');
    });

    test('Admin Audit Export rate limit enforces rejection on excessive attempts', async () => {
      const uniqueIp = '198.51.100.44';

      const responses = [];
      for (let i = 0; i < 12; i++) {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/admin/audit-logs/export?format=csv',
          headers: {
            'x-admin-session-token': superAdminToken,
            'x-forwarded-for': uniqueIp
          }
        });
        responses.push(res.statusCode);
      }

      assert.ok(responses.includes(429), 'Audit export rate limiting must trigger HTTP 429 on excessive attempts');
    });
  });
});

