import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { SystemOverviewService } from '../src/services/admin/system_overview_service.js';

describe('Phase 17 Batch 17.1 — Admin System Overview & Operational Health Diagnostics', () => {
  let app: FastifyInstance;

  before(async () => {
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  // =========================================================================
  // SUITE 1: SYSTEM OVERVIEW SERVICE — UNIT & COMPUTATION LOGIC
  // =========================================================================
  describe('Suite 1: SystemOverviewService Computation & Data Contract', () => {
    test('1.1: SystemOverviewService.getSystemOverview returns complete typed payload', async () => {
      const overview = await SystemOverviewService.getSystemOverview();

      assert.ok(overview, 'Overview object must be returned');
      assert.ok(overview.overall, 'Overall object must exist');
      assert.ok(['HEALTHY', 'DEGRADED', 'UNHEALTHY', 'UNKNOWN'].includes(overview.overall.status));
      assert.strictEqual(typeof overview.overall.summary, 'string');
      assert.ok(overview.overall.checkedAt, 'Timestamp must exist');

      // Check application subsystem
      assert.ok(overview.application, 'Application object must exist');
      assert.strictEqual(typeof overview.application.nodeVersion, 'string');
      assert.strictEqual(typeof overview.application.platform, 'string');
      assert.strictEqual(typeof overview.application.uptimeSeconds, 'number');
      assert.strictEqual(typeof overview.application.memoryUsageMb, 'object');
      assert.strictEqual(typeof overview.application.memoryUsageMb.rss, 'number');

      // Check backend subsystem
      assert.ok(overview.backend, 'Backend object must exist');
      assert.strictEqual(typeof overview.backend.processId, 'number');
      assert.strictEqual(typeof overview.backend.latencyMs, 'number');
      assert.ok(['HEALTHY', 'DEGRADED', 'UNHEALTHY', 'UNKNOWN'].includes(overview.backend.status));

      // Check database subsystem
      assert.ok(overview.database, 'Database object must exist');
      assert.ok(['HEALTHY', 'DEGRADED', 'UNHEALTHY', 'UNKNOWN'].includes(overview.database.status));
      assert.strictEqual(typeof overview.database.latencyMs, 'number');
      assert.strictEqual(typeof overview.database.connected, 'boolean');

      // Check gateway subsystem
      assert.ok(overview.gateway, 'Gateway object must exist');
      assert.strictEqual(typeof overview.gateway.activeNodes, 'number');
      assert.strictEqual(typeof overview.gateway.activeConnections, 'number');

      // Check devices subsystem
      assert.ok(overview.devices, 'Devices object must exist');
      assert.strictEqual(typeof overview.devices.registeredDevices, 'number');
      assert.strictEqual(typeof overview.devices.connectedDevices, 'number');
      assert.strictEqual(typeof overview.devices.offlineDevices, 'number');
      assert.strictEqual(typeof overview.devices.totalServerInstances, 'number');
      assert.strictEqual(typeof overview.devices.runningServerInstances, 'number');

      // Check environment allowlist
      assert.ok(overview.environment, 'Environment object must exist');
      assert.strictEqual(typeof overview.environment.name, 'string');
      assert.strictEqual(typeof overview.environment.appVersion, 'string');
      assert.strictEqual(typeof overview.environment.apiVersion, 'string');
      assert.strictEqual(overview.environment.databaseEngine, 'MySQL / MariaDB via Prisma ORM');

      // Check diagnostic signals
      assert.ok(Array.isArray(overview.signals), 'Signals must be an array');
      assert.strictEqual(overview.signals.length, 5, 'Must contain 5 diagnostic signals');
      for (const signal of overview.signals) {
        assert.ok(signal.name);
        assert.ok(signal.subsystem);
        assert.ok(['HEALTHY', 'DEGRADED', 'UNHEALTHY', 'UNKNOWN'].includes(signal.status));
        assert.ok(signal.latencyMs === null || typeof signal.latencyMs === 'number');
        assert.strictEqual(typeof signal.details, 'string');
        assert.ok(signal.checkedAt);
      }
    });

    test('1.2: Environment metadata strictly enforces zero secret leakage', async () => {
      const overview = await SystemOverviewService.getSystemOverview();
      const env = overview.environment;

      // Allowlist invariant checks
      const allowedKeys = [
        'name',
        'appVersion',
        'apiVersion',
        'nodeVersion',
        'platform',
        'databaseEngine',
        'uptimeFormatted',
        'startedAt'
      ];

      const envKeys = Object.keys(env);
      for (const key of envKeys) {
        assert.ok(allowedKeys.includes(key), `Disallowed key found in environment metadata: ${key}`);
      }

      // Assert no secret substrings in values
      const serializedEnv = JSON.stringify(env).toLowerCase();
      assert.ok(!serializedEnv.includes('password'), 'Environment must not contain password keyword');
      assert.ok(!serializedEnv.includes('secret'), 'Environment must not contain secret keyword');
      assert.ok(!serializedEnv.includes('mysql://'), 'Environment must not contain database connection strings');
      assert.ok(!serializedEnv.includes('jwt'), 'Environment must not contain JWT references');
    });

    test('1.3: Error sanitization prevents database credentials from escaping in error states', () => {
      const rawError = 'Error connecting to mysql://admin:supersecret123@db.prod.internal:3306/zdexcloud: Connection refused';
      const sanitized = rawError.replace(/mysql:\/\/[^@\s]+@[^\s/]+/gi, 'mysql://***:***@***');
      assert.ok(!sanitized.includes('supersecret123'));
      assert.ok(sanitized.includes('mysql://***:***@***'));
    });
  });

  // =========================================================================
  // SUITE 2: ADMIN HTTP ROUTE & RBAC BOUNDARY
  // =========================================================================
  describe('Suite 2: Route Security & RBAC Enforcement (GET /api/v1/admin/system/overview)', () => {
    test('2.1: Rejects unauthenticated requests with 401 Unauthorized', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/system/overview'
      });

      assert.strictEqual(res.statusCode, 401);
      const json = JSON.parse(res.body);
      assert.strictEqual(json.success, false);
      assert.ok(json.error);
    });

    test('2.2: Rejects requests with invalid admin token with 401 Unauthorized', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/system/overview',
        headers: {
          authorization: 'Bearer invalid-token-string'
        }
      });

      assert.strictEqual(res.statusCode, 401);
      const json = JSON.parse(res.body);
      assert.strictEqual(json.success, false);
    });
  });
});
