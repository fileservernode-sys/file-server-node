import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';
import { metricsCollector } from '../src/observability/metrics.js';
import { sanitizeLogMetadata, appLogger } from '../src/observability/logger.js';
import { validateEnvironment } from '../src/config/env_validator.js';
import { StateReconciliationService } from '../src/observability/state_reconciliation.js';

describe('Phase 9 — Production Readiness, Observability & Operational Resilience', () => {
  let app: FastifyInstance;

  before(async () => {
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  // =========================================================================
  // SUITE 1: HEALTH, LIVENESS & READINESS PROBES
  // =========================================================================
  describe('Suite 1: Health, Liveness & Readiness Endpoints', () => {
    test('1.1: Root /health returns 200 OK with process liveness and uptime', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/health'
      });
      assert.strictEqual(res.statusCode, 200);
      const json = JSON.parse(res.body);
      assert.strictEqual(json.status, 'ok');
      assert.strictEqual(typeof json.uptime, 'number');
      assert.ok(json.timestamp);
    });

    test('1.2: Root /health/live returns 200 OK for Kubernetes/Cloud liveness', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/health/live'
      });
      assert.strictEqual(res.statusCode, 200);
      const json = JSON.parse(res.body);
      assert.strictEqual(json.status, 'live');
    });

    test('1.3: Root /health/ready returns 200 OK when database is connected', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/health/ready'
      });
      assert.strictEqual(res.statusCode, 200);
      const json = JSON.parse(res.body);
      assert.strictEqual(json.status, 'ready');
      assert.strictEqual(json.database, 'connected');
    });

    test('1.4: API v1 /api/v1/health/live and /api/v1/health/ready behave consistently', async () => {
      const liveRes = await app.inject({
        method: 'GET',
        url: '/api/v1/health/live'
      });
      assert.strictEqual(liveRes.statusCode, 200);
      const liveData = JSON.parse(liveRes.body);
      assert.strictEqual(liveData.success, true);
      assert.strictEqual(liveData.data.status, 'live');

      const readyRes = await app.inject({
        method: 'GET',
        url: '/api/v1/health/ready'
      });
      assert.strictEqual(readyRes.statusCode, 200);
      const readyData = JSON.parse(readyRes.body);
      assert.strictEqual(readyData.success, true);
      assert.strictEqual(readyData.data.status, 'ready');
    });

    test('1.5: Database health probe /api/v1/health/db verifies SQL connectivity', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/health/db'
      });
      assert.strictEqual(res.statusCode, 200);
      const json = JSON.parse(res.body);
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.data.database, 'connected');
    });
  });

  // =========================================================================
  // SUITE 2: REQUEST CORRELATION & TRACEABILITY
  // =========================================================================
  describe('Suite 2: Request Correlation & Propagation', () => {
    test('2.1: Automatically generates and returns x-request-id when none provided', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/health'
      });
      assert.strictEqual(res.statusCode, 200);
      const reqId = res.headers['x-request-id'];
      assert.ok(reqId, 'x-request-id response header must be present');
      assert.strictEqual(typeof reqId, 'string');
      assert.ok(String(reqId).length > 8);
    });

    test('2.2: Preserves and propagates inbound valid x-request-id header', async () => {
      const customTraceId = 'trace-corr-test-1234567890';
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/health',
        headers: { 'x-request-id': customTraceId }
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.headers['x-request-id'], customTraceId);
    });
  });

  // =========================================================================
  // SUITE 3: STRUCTURED LOGGING & SECRET SANITIZATION
  // =========================================================================
  describe('Suite 3: Secret and PII Sanitization in Logging', () => {
    test('3.1: Redacts sensitive password, tokens, OTPs, and payloads in log metadata', () => {
      const dangerousMetadata = {
        email: 'alice@example.com',
        password: 'SuperSecretPassword123!',
        passwordHash: '$2b$10$abcdef123456',
        sessionToken: 'tok_live_123456789',
        otp: '123456',
        dataBase64: 'SGVsbG8gV29ybGQgRmlsZSBEYXRh',
        fileContent: 'raw binary bytes here',
        connectionString: 'mysql://root:secretpass@127.0.0.1:3306/zdex'
      };

      const sanitized = sanitizeLogMetadata(dangerousMetadata);

      assert.strictEqual(sanitized.password, '[REDACTED]');
      assert.strictEqual(sanitized.passwordHash, '[REDACTED]');
      assert.strictEqual(sanitized.sessionToken, '[REDACTED]');
      assert.strictEqual(sanitized.otp, '[REDACTED]');
      assert.strictEqual(sanitized.dataBase64, '[REDACTED]');
      assert.strictEqual(sanitized.fileContent, '[REDACTED]');
      assert.strictEqual(sanitized.email, 'alice@example.com');
      assert.ok(!sanitized.connectionString.includes('secretpass'));
    });
  });

  // =========================================================================
  // SUITE 4: OPERATIONAL METRICS & CARDINALITY CONTROL
  // =========================================================================
  describe('Suite 4: Centralized Metrics & Cardinality Invariants', () => {
    test('4.1: Aggregates HTTP, Auth, and Admin Operation metrics into safe snapshot', () => {
      metricsCollector.recordHttpRequest('GET', 200, 15);
      metricsCollector.recordHttpRequest('POST', 400, 25);
      metricsCollector.recordAdminAuth('login_success');
      metricsCollector.recordAdminOperation('users', 200);
      metricsCollector.recordAdminOperation('devices', 403);
      metricsCollector.recordGatewayConnection();

      const snapshot = metricsCollector.getSnapshot();

      assert.ok(snapshot.http.totalRequests >= 2);
      assert.ok(snapshot.auth.adminLoginSuccess >= 1);
      assert.ok(snapshot.adminOperations.totalOperations >= 2);
      assert.strictEqual(typeof snapshot.http.averageLatencyMs, 'number');
      assert.strictEqual(typeof snapshot.database.isAvailable, 'boolean');

      // Verify zero high-cardinality unbounded keys leaked in metric structure
      const keys = Object.keys(snapshot.http.requestsByMethod);
      for (const k of keys) {
        assert.ok(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].includes(k));
      }
    });
  });

  // =========================================================================
  // SUITE 5: CONFIGURATION & ENVIRONMENT VALIDATION
  // =========================================================================
  describe('Suite 5: Startup Configuration Validation', () => {
    test('5.1: Validates current runtime configuration and produces summary', () => {
      const validation = validateEnvironment();
      assert.strictEqual(typeof validation.valid, 'boolean');
      assert.strictEqual(validation.requiredVarsPresent, true);
      assert.strictEqual(typeof validation.configSummary.nodeEnv, 'string');
      assert.strictEqual(typeof validation.configSummary.port, 'number');
      assert.strictEqual(typeof validation.configSummary.emailProviderConfigured, 'boolean');
    });
  });

  // =========================================================================
  // SUITE 6: STATE RECONCILIATION DIAGNOSTICS
  // =========================================================================
  describe('Suite 6: State Reconciliation & Drift Diagnostics', () => {
    test('6.1: Non-destructively audits state between DB, Gateway, and Devices', async () => {
      const report = await StateReconciliationService.auditState();
      assert.strictEqual(typeof report.isConsistent, 'boolean');
      assert.strictEqual(typeof report.discrepancies.orphanedConnections, 'number');
      assert.strictEqual(typeof report.discrepancies.staleOnlineDevices, 'number');
      assert.strictEqual(typeof report.summary.dbTotalDevices, 'number');
      assert.strictEqual(typeof report.summary.dbRunningServers, 'number');
      assert.ok(Array.isArray(report.discrepancies.details));
    });
  });
});
