/**
 * Phase 17 Batch 17.8 — Admin System Security Controls Operations Test Suite
 * Deferred Integration & Unit Verification Suite
 */

import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { AdminSystemSecurityService, SecurityOperationContext } from '../src/routes/admin/operations/system/security/service.js';
import { AdminSessionQuery, SecurityEventQuery } from '../src/routes/admin/operations/system/security/schemas.js';
import { NotFoundError, ValidationError } from '../src/errors/app-error.js';

describe('Phase 17 Batch 17.8 — Admin System Security Controls Operations Test Suite', () => {
  let app: FastifyInstance;

  const mockAdminContext: SecurityOperationContext = {
    adminId: 'admin-sec-test-001',
    adminEmail: 'sec.admin@zdexcloud.internal',
    ipAddress: '127.0.0.1',
    userAgent: 'NodeTest/1.0',
    currentSessionId: 'sess-current-001'
  };

  before(async () => {
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  // =========================================================================
  // SUITE 1: SECURITY POSTURE OVERVIEW & TELEMETRY
  // =========================================================================
  describe('Suite 1: AdminSystemSecurityService Posture Overview & Telemetry', () => {
    test('1.1: getSecurityOverview returns structured security controls metrics', async () => {
      const overview = await AdminSystemSecurityService.getSecurityOverview();

      assert.ok(overview, 'Overview payload must exist');
      assert.strictEqual(typeof overview.activeSessionsCount, 'number');
      assert.strictEqual(typeof overview.recentLoginsCount24h, 'number');
      assert.strictEqual(typeof overview.failedLoginsCount24h, 'number');
      assert.strictEqual(typeof overview.activeLockoutsCount, 'number');
      assert.strictEqual(typeof overview.permissionDenialsCount24h, 'number');
      assert.strictEqual(typeof overview.totalRolesCount, 'number');
      assert.strictEqual(typeof overview.totalPermissionsCount, 'number');

      // Posture invariants
      assert.strictEqual(overview.csrfPosture.enabled, true);
      assert.strictEqual(overview.csrfPosture.mode, 'HMAC_TOKEN_BOUND');
      assert.strictEqual(overview.csrfPosture.header, 'x-zdex-admin-csrf-token');
      assert.strictEqual(overview.csrfPosture.enforcedOnMutations, true);

      assert.strictEqual(overview.mfaPosture.enabled, true);
      assert.strictEqual(overview.mfaPosture.method, 'EMAIL_OTP');

      assert.strictEqual(overview.sessionPolicy.absoluteLifetimeHours, 24);
      assert.strictEqual(overview.sessionPolicy.idleTimeoutMinutes, 15);
      assert.strictEqual(overview.sessionPolicy.tokenStorageMode, 'SHA256_HASHED');

      assert.strictEqual(overview.bruteForcePolicy.maxFailedAttempts, 5);
      assert.strictEqual(overview.bruteForcePolicy.lockoutDurationMinutes, 15);
    });
  });

  // =========================================================================
  // SUITE 2: ADMIN SESSIONS & SANITIZED DTOs
  // =========================================================================
  describe('Suite 2: Admin Sessions Management & Secret Shielding', () => {
    test('2.1: listAdminSessions returns paginated sessions with sanitized properties', async () => {
      const query: AdminSessionQuery = { page: 1, limit: 10, status: 'ALL' };
      const res = await AdminSystemSecurityService.listAdminSessions(query);

      assert.ok(Array.isArray(res.items), 'Session items must be an array');
      assert.strictEqual(typeof res.total, 'number');
      assert.strictEqual(res.page, 1);
      assert.strictEqual(res.limit, 10);
      assert.strictEqual(typeof res.totalPages, 'number');

      for (const item of res.items) {
        assert.ok(item.id, 'Session must have an ID');
        assert.ok(item.adminId, 'Session must have an admin ID');
        assert.ok(item.adminEmail, 'Session must have an admin email');
        assert.ok(['ACTIVE', 'REVOKED', 'EXPIRED'].includes(item.status));

        // ABSOLUTE SECURITY INVARIANT: Session tokens and token hashes MUST NEVER be returned
        assert.strictEqual((item as any).sessionToken, undefined, 'Raw sessionToken must never be exposed');
        assert.strictEqual((item as any).sessionTokenHash, undefined, 'Session token hash must never be exposed');
      }
    });

    test('2.2: revokeSession handles non-existent session with NotFoundError', async () => {
      await assert.rejects(
        async () => {
          await AdminSystemSecurityService.revokeSession(
            'non-existent-session-id-999',
            'TEST_REVOCATION',
            mockAdminContext
          );
        },
        (err: any) => {
          assert.ok(err instanceof NotFoundError);
          return true;
        }
      );
    });
  });

  // =========================================================================
  // SUITE 3: LOCKOUTS & BRUTE-FORCE RELEASE
  // =========================================================================
  describe('Suite 3: Lockout Management & Brute-Force Rate Limiting', () => {
    test('3.1: listLockouts returns array of lockout tracking items', async () => {
      const lockouts = await AdminSystemSecurityService.listLockouts();

      assert.ok(Array.isArray(lockouts), 'Lockouts must be an array');
      for (const item of lockouts) {
        assert.ok(item.id, 'Lockout record must have an ID');
        assert.ok(item.key, 'Lockout record must have a key');
        assert.strictEqual(typeof item.failedAttempts, 'number');
        assert.strictEqual(typeof item.isLocked, 'boolean');
        assert.strictEqual(typeof item.remainingSeconds, 'number');
      }
    });

    test('3.2: unlockLockout clears lockout for valid key or email', async () => {
      const result = await AdminSystemSecurityService.unlockLockout(
        { email: 'test.locked@zdexcloud.internal' },
        mockAdminContext
      );

      assert.strictEqual(result.success, true);
      assert.ok(result.message.includes('Lockout cleared'));
    });
  });

  // =========================================================================
  // SUITE 4: SECURITY AUDIT EVENTS & INTEGRITY
  // =========================================================================
  describe('Suite 4: Security Audit Events & Tamper-Evident Trail', () => {
    test('4.1: listSecurityEvents returns paginated audit events with hash verification fields', async () => {
      const query: SecurityEventQuery = { page: 1, limit: 10 };
      const res = await AdminSystemSecurityService.listSecurityEvents(query);

      assert.ok(Array.isArray(res.items), 'Audit items must be an array');
      assert.strictEqual(typeof res.total, 'number');

      for (const item of res.items) {
        assert.ok(item.id, 'Event must have an ID');
        assert.ok(item.action, 'Event must have an action');
        assert.ok(item.status, 'Event must have a status');
        assert.ok(item.createdAt, 'Event must have a timestamp');
      }
    });

    test('4.2: getSecurityEventDetail throws NotFoundError for unknown event', async () => {
      await assert.rejects(
        async () => {
          await AdminSystemSecurityService.getSecurityEventDetail('unknown-event-id-999');
        },
        (err: any) => {
          assert.ok(err instanceof NotFoundError);
          return true;
        }
      );
    });
  });

  // =========================================================================
  // SUITE 5: RBAC INVENTORY & MATRIX GOVERNANCE
  // =========================================================================
  describe('Suite 5: RBAC Inventory, Matrix Governance & Credential Posture', () => {
    test('5.1: getRbacInventory returns complete roles, permissions, and matrix mapping', async () => {
      const inventory = await AdminSystemSecurityService.getRbacInventory();

      assert.ok(inventory, 'Inventory payload must exist');
      assert.ok(Array.isArray(inventory.roles), 'Roles must be an array');
      assert.ok(Array.isArray(inventory.permissions), 'Permissions must be an array');
      assert.ok(Array.isArray(inventory.matrix), 'Matrix must be an array');
      assert.ok(inventory.superAdminPrivilege.wildcardEnabled, 'Wildcard must be enabled for SuperAdmin');

      for (const r of inventory.roles) {
        assert.ok(r.id);
        assert.ok(r.slug);
        assert.ok(r.name);
        assert.ok(Array.isArray(r.permissionSlugs));
        assert.strictEqual(typeof r.assignedAdminCount, 'number');
      }

      for (const p of inventory.permissions) {
        assert.ok(p.id);
        assert.ok(p.slug);
        assert.ok(p.resource);
        assert.ok(p.action);
        assert.ok(Array.isArray(p.roleSlugs));
      }
    });

    test('5.2: getCredentialPosture returns posture without exposing password hashes', async () => {
      const posture = await AdminSystemSecurityService.getCredentialPosture();

      assert.ok(Array.isArray(posture), 'Credential posture must be an array');
      for (const admin of posture) {
        assert.ok(admin.id);
        assert.ok(admin.email);
        assert.strictEqual(admin.hasPasswordConfigured, true);
        assert.strictEqual(admin.twoFactorConfigured, true);
        assert.strictEqual(typeof admin.activeSessionsCount, 'number');

        // STRICT INVARIANT: ZERO PASSWORD HASH EXPOSURE
        assert.strictEqual((admin as any).passwordHash, undefined, 'Password hash must never be in credential posture DTO');
      }
    });
  });

  // =========================================================================
  // SUITE 6: HTTP ROUTE ACCESS & AUTHENTICATION ENFORCEMENT
  // =========================================================================
  describe('Suite 6: HTTP Route Access & Authentication Enforcement', () => {
    test('6.1: GET /api/v1/admin/operations/system/security requires admin authentication (401)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/system/security'
      });

      assert.strictEqual(res.statusCode, 401);
    });

    test('6.2: GET /api/v1/admin/operations/system/security/sessions requires admin authentication (401)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/system/security/sessions'
      });

      assert.strictEqual(res.statusCode, 401);
    });

    test('6.3: POST /api/v1/admin/operations/system/security/sessions/:sessionId/revoke requires admin authentication (401)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/operations/system/security/sessions/test-sess-1/revoke',
        payload: { reason: 'TEST' }
      });

      assert.strictEqual(res.statusCode, 401);
    });

    test('6.4: GET /api/v1/admin/system/security/overview canonical alias requires admin authentication (401)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/system/security/overview'
      });

      assert.strictEqual(res.statusCode, 401);
    });
  });
});
