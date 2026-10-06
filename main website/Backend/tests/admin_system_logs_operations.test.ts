import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { AdminSystemLogsService } from '../src/routes/admin/operations/system/logs/service.js';

describe('Phase 17 Batch 17.5 — Admin System Logs & Diagnostics Control Plane', () => {
  let app: FastifyInstance;

  before(async () => {
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  // =========================================================================
  // SUITE 1: SYSTEM LOGS & DIAGNOSTICS SERVICE — UNIT & COMPUTATION LOGIC
  // =========================================================================
  describe('Suite 1: AdminSystemLogsService Contract & Metrics Verification', () => {
    test('1.1: AdminSystemLogsService.getLogsMetrics returns complete metrics payload', async () => {
      const metrics = await AdminSystemLogsService.getLogsMetrics();

      assert.ok(metrics, 'Metrics payload must exist');
      assert.strictEqual(typeof metrics.totalErrors24h, 'number');
      assert.strictEqual(typeof metrics.totalErrors7d, 'number');
      assert.strictEqual(typeof metrics.criticalErrors24h, 'number');
      assert.strictEqual(typeof metrics.openIncidentsCount, 'number');
      assert.strictEqual(typeof metrics.acknowledgedIncidentsCount, 'number');
      assert.strictEqual(typeof metrics.gatewayDisconnects24h, 'number');
      assert.strictEqual(typeof metrics.operationalEvents24h, 'number');
      assert.ok(Array.isArray(metrics.topComponents), 'topComponents must be an array');
      assert.ok(Array.isArray(metrics.topErrorCodes), 'topErrorCodes must be an array');

      for (const item of metrics.topComponents) {
        assert.ok(typeof item.component === 'string');
        assert.strictEqual(typeof item.count, 'number');
      }
    });

    test('1.2: AdminSystemLogsService.listErrors handles query filters and pagination', async () => {
      const result = await AdminSystemLogsService.listErrors({
        page: 1,
        pageSize: 10,
        sortBy: 'occurredAt',
        sortOrder: 'desc'
      });

      assert.ok(result, 'Result payload must exist');
      assert.ok(Array.isArray(result.items), 'items must be an array');
      assert.ok(result.pagination, 'pagination metadata must exist');
      assert.strictEqual(typeof result.pagination.total, 'number');
      assert.strictEqual(result.pagination.page, 1);
      assert.strictEqual(result.pagination.pageSize, 10);
      assert.strictEqual(typeof result.pagination.totalPages, 'number');
    });

    test('1.3: AdminSystemLogsService.listEvents handles query filters and pagination', async () => {
      const result = await AdminSystemLogsService.listEvents({
        page: 1,
        pageSize: 10,
        sortBy: 'createdAt',
        sortOrder: 'desc'
      });

      assert.ok(result, 'Result payload must exist');
      assert.ok(Array.isArray(result.items), 'items must be an array');
      assert.ok(result.pagination, 'pagination metadata must exist');
      assert.strictEqual(typeof result.pagination.total, 'number');
      assert.strictEqual(result.pagination.page, 1);
      assert.strictEqual(result.pagination.pageSize, 10);
    });

    test('1.4: AdminSystemLogsService.getGatewayDiagnostics returns gateway health metrics', async () => {
      const result = await AdminSystemLogsService.getGatewayDiagnostics({
        page: 1,
        pageSize: 10,
        sortBy: 'createdAt',
        sortOrder: 'desc'
      });

      assert.ok(result, 'Diagnostics payload must exist');
      assert.ok(Array.isArray(result.items), 'items must be an array');
      assert.ok(result.pagination, 'pagination metadata must exist');
      assert.strictEqual(typeof result.pagination.total, 'number');
      assert.strictEqual(result.pagination.page, 1);
    });

    test('1.5: AdminSystemLogsService.listIncidents returns incident listing', async () => {
      const result = await AdminSystemLogsService.listIncidents({
        page: 1,
        pageSize: 10,
        sortBy: 'lastSeenAt',
        sortOrder: 'desc'
      });

      assert.ok(result, 'Incidents payload must exist');
      assert.ok(Array.isArray(result.items), 'items must be an array');
      assert.ok(result.pagination, 'pagination metadata must exist');
      assert.strictEqual(typeof result.pagination.total, 'number');
      assert.strictEqual(result.pagination.page, 1);
    });
  });

  // =========================================================================
  // SUITE 2: SANITIZATION & ZERO SECRET LEAKAGE INVARIANTS
  // =========================================================================
  describe('Suite 2: Log & Stack Trace Sanitization Engine', () => {
    test('2.1: Sanitizes database URLs with credentials in stack traces', () => {
      const rawTrace = 'Error: Connection lost at mysql://root:SuperSecretP@ssword123!@db-cluster.internal:3306/zdexcloud';
      const sanitized = AdminSystemLogsService.sanitizeString(rawTrace);

      assert.ok(!sanitized.includes('SuperSecretP@ssword123!'));
      assert.ok(sanitized.includes('mysql://[REDACTED]@db-cluster.internal:3306/zdexcloud'));
    });

    test('2.2: Sanitizes Bearer authorization tokens in error messages', () => {
      const rawMessage = 'Failed to authenticate user with Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      const sanitized = AdminSystemLogsService.sanitizeString(rawMessage);

      assert.ok(!sanitized.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'));
      assert.ok(sanitized.includes('Bearer [REDACTED_TOKEN]'));
    });

    test('2.3: Sanitizes password and OTP fields in JSON string payloads', () => {
      const rawJson = '{"email":"admin@zdexcloud.com","password":"MySecretPassword","otp":"839201","pin":"1234"}';
      const sanitized = AdminSystemLogsService.sanitizeString(rawJson);

      assert.ok(!sanitized.includes('MySecretPassword'));
      assert.ok(!sanitized.includes('839201'));
      assert.ok(sanitized.includes('"password": "[REDACTED]"') || sanitized.includes('"password":"[REDACTED]"'));
    });

    test('2.4: Sanitizes FCM push tokens and API secret keys', () => {
      const rawPayload = 'FCM Notification error for token fcm_token_xyz987654321 with apiKey: key_live_998877665544332211';
      const sanitized = AdminSystemLogsService.sanitizeString(rawPayload);

      assert.ok(!sanitized.includes('fcm_token_xyz987654321'));
      assert.ok(!sanitized.includes('key_live_998877665544332211'));
    });
  });

  // =========================================================================
  // SUITE 3: HTTP ROUTE SECURITY & RBAC ENFORCEMENT
  // =========================================================================
  describe('Suite 3: Route Security & RBAC Enforcement', () => {
    test('3.1: GET /api/v1/admin/operations/system/logs/metrics rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/system/logs/metrics'
      });

      assert.strictEqual(res.statusCode, 401);
      const json = JSON.parse(res.body);
      assert.strictEqual(json.success, false);
    });

    test('3.2: GET /api/v1/admin/operations/system/logs/errors rejects invalid token with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/system/logs/errors',
        headers: {
          authorization: 'Bearer invalid-token-for-testing'
        }
      });

      assert.strictEqual(res.statusCode, 401);
      const json = JSON.parse(res.body);
      assert.strictEqual(json.success, false);
    });

    test('3.3: GET /api/v1/admin/operations/system/logs/events rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/system/logs/events'
      });

      assert.strictEqual(res.statusCode, 401);
    });

    test('3.4: GET /api/v1/admin/operations/system/logs/gateway rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/system/logs/gateway'
      });

      assert.strictEqual(res.statusCode, 401);
    });

    test('3.5: GET /api/v1/admin/operations/system/logs/incidents rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/system/logs/incidents'
      });

      assert.strictEqual(res.statusCode, 401);
    });

    test('3.6: POST /api/v1/admin/operations/system/logs/export rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/operations/system/logs/export',
        payload: {
          format: 'json',
          category: 'errors'
        }
      });

      assert.strictEqual(res.statusCode, 401);
    });

    test('3.7: Canonical alias GET /api/v1/admin/system/logs/metrics rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/system/logs/metrics'
      });

      assert.strictEqual(res.statusCode, 401);
    });
  });
});
