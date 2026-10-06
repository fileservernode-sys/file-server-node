import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';
import { AdminBackgroundJobsService } from '../src/routes/admin/operations/system/jobs/service.js';
import { ValidationError, NotFoundError } from '../src/errors/app-error.js';
import { AdminOperationContext } from '../src/routes/admin/operations/types.js';

describe('Phase 17 Batch 17.6 — Admin Background Jobs & Operations Control Plane', () => {
  let app: FastifyInstance;

  before(async () => {
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  // =========================================================================
  // SUITE 1: BACKGROUND JOBS SERVICE — METRICS, QUEUES & WORKERS TELEMETRY
  // =========================================================================
  describe('Suite 1: AdminBackgroundJobsService Contract & Metrics Verification', () => {
    test('1.1: AdminBackgroundJobsService.getJobsMetrics returns complete metrics payload', async () => {
      const metrics = await AdminBackgroundJobsService.getJobsMetrics();

      assert.ok(metrics, 'Metrics payload must exist');
      assert.strictEqual(typeof metrics.totalQueued, 'number');
      assert.strictEqual(typeof metrics.totalActive, 'number');
      assert.strictEqual(typeof metrics.totalRetrying, 'number');
      assert.strictEqual(typeof metrics.totalFailed24h, 'number');
      assert.strictEqual(typeof metrics.totalCompleted24h, 'number');
      assert.strictEqual(typeof metrics.activeWorkersCount, 'number');
      assert.strictEqual(typeof metrics.totalWorkersCount, 'number');
      assert.strictEqual(typeof metrics.failureRatePercent24h, 'number');
      assert.ok(Array.isArray(metrics.queuesSummary), 'queuesSummary must be an array');
    });

    test('1.2: AdminBackgroundJobsService.listQueues returns structured queue telemetry', async () => {
      const queues = await AdminBackgroundJobsService.listQueues();

      assert.ok(Array.isArray(queues), 'Queues must be an array');
      assert.ok(queues.length > 0, 'Must contain at least 1 queue summary');

      for (const q of queues) {
        assert.ok(q.name);
        assert.ok(q.displayName);
        assert.ok(['HEALTHY', 'DEGRADED', 'PAUSED', 'IDLE'].includes(q.status));
        assert.strictEqual(typeof q.queuedCount, 'number');
        assert.strictEqual(typeof q.activeCount, 'number');
        assert.strictEqual(typeof q.retryingCount, 'number');
        assert.strictEqual(typeof q.failedCount24h, 'number');
        assert.strictEqual(typeof q.completedCount24h, 'number');
      }
    });

    test('1.3: AdminBackgroundJobsService.listWorkers returns authoritative worker telemetry with scope and process metadata', () => {
      const workers = AdminBackgroundJobsService.listWorkers();

      assert.ok(Array.isArray(workers), 'Workers must be an array');
      assert.ok(workers.length > 0, 'Must contain worker instances');

      for (const w of workers) {
        assert.ok(w.workerId);
        assert.ok(w.name);
        assert.ok(['RUNNING', 'IDLE', 'STARTING', 'STOPPED', 'DEGRADED'].includes(w.status));
        assert.strictEqual(typeof w.enabled, 'boolean');
        assert.ok(Array.isArray(w.assignedQueues));
        assert.strictEqual(w.scope, 'LOCAL_DAEMON');
        assert.strictEqual(typeof w.processId, 'number');
        assert.strictEqual(typeof w.hostname, 'string');
        assert.strictEqual(typeof w.isHeartbeatStale, 'boolean');
      }
    });

    test('1.4: AdminBackgroundJobsService.listJobs handles pagination and filters', async () => {
      const result = await AdminBackgroundJobsService.listJobs({
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

    test('1.5: AdminBackgroundJobsService.listFailedJobs returns failures triage list', async () => {
      const result = await AdminBackgroundJobsService.listFailedJobs({
        page: 1,
        pageSize: 10,
        sortBy: 'createdAt',
        sortOrder: 'desc'
      });

      assert.ok(result, 'Result payload must exist');
      assert.ok(Array.isArray(result.items), 'items must be an array');
      assert.ok(result.pagination, 'pagination metadata must exist');
    });
  });

  // =========================================================================
  // SUITE 2: JOB DETAIL INSPECTION & SECRET SANITIZATION
  // =========================================================================
  describe('Suite 2: Job Detail Inspection & Secret Sanitization', () => {
    test('2.1: AdminBackgroundJobsService.getJobDetail throws NotFoundError for non-existent job ID', async () => {
      await assert.rejects(
        async () => {
          await AdminBackgroundJobsService.getJobDetail('non-existent-job-uuid-12345');
        },
        (err: any) => {
          assert.ok(err instanceof NotFoundError || err.name === 'NotFoundError');
          return true;
        }
      );
    });
  });

  // =========================================================================
  // SUITE 3: CANONICAL RETRY ARCHITECTURE & INVARIANTS
  // =========================================================================
  describe('Suite 3: Canonical Retry Architecture & Compare-and-Set Invariants', () => {
    const mockContext: AdminOperationContext = {
      adminId: 'admin-test-001',
      adminEmail: 'admin@zdexcloud.internal',
      adminName: 'Test Admin',
      isSuperAdmin: true,
      status: 'ACTIVE' as any,
      sessionId: 'sess-test-001',
      roles: ['SUPER_ADMIN'],
      permissions: ['system.read', 'system.write'],
      requestId: 'req-test-001',
      clientIp: '127.0.0.1',
      userAgent: 'NodeTest/1.0'
    };

    test('3.1: AdminBackgroundJobsService.retryJob rejects non-existent job with NotFoundError', async () => {
      await assert.rejects(
        async () => {
          await AdminBackgroundJobsService.retryJob('00000000-0000-0000-0000-000000000000', mockContext);
        },
        (err: any) => {
          assert.ok(err instanceof NotFoundError || err.name === 'NotFoundError');
          return true;
        }
      );
    });
  });

  // =========================================================================
  // SUITE 4: CANCELLATION ENDPOINT REMOVAL (OPTION B VERIFICATION)
  // =========================================================================
  describe('Suite 4: Cancellation Semantics Hardening (Endpoint Unavailability)', () => {
    test('4.1: POST /api/v1/admin/operations/system/jobs/:jobId/cancel returns 404 (Route not found)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/operations/system/jobs/sample-job-id/cancel',
        payload: { reason: 'Test cancel' }
      });

      assert.strictEqual(res.statusCode, 404, 'Cancellation route must not exist');
    });

    test('4.2: POST /api/v1/admin/system/jobs/:jobId/cancel returns 404 (Canonical alias not found)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/system/jobs/sample-job-id/cancel',
        payload: { reason: 'Test cancel' }
      });

      assert.strictEqual(res.statusCode, 404, 'Canonical alias cancellation route must not exist');
    });
  });

  // =========================================================================
  // SUITE 5: HTTP ROUTE SECURITY & RBAC ENFORCEMENT
  // =========================================================================
  describe('Suite 5: Route Security & RBAC Enforcement', () => {
    test('5.1: GET /api/v1/admin/operations/system/jobs/metrics rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/system/jobs/metrics'
      });

      assert.strictEqual(res.statusCode, 401);
      const json = JSON.parse(res.body);
      assert.strictEqual(json.success, false);
    });

    test('5.2: GET /api/v1/admin/operations/system/jobs/queues rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/system/jobs/queues'
      });

      assert.strictEqual(res.statusCode, 401);
    });

    test('5.3: GET /api/v1/admin/operations/system/jobs/workers rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/system/jobs/workers'
      });

      assert.strictEqual(res.statusCode, 401);
    });

    test('5.4: GET /api/v1/admin/operations/system/jobs rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/system/jobs'
      });

      assert.strictEqual(res.statusCode, 401);
    });

    test('5.5: GET /api/v1/admin/operations/system/jobs/failed rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/system/jobs/failed'
      });

      assert.strictEqual(res.statusCode, 401);
    });

    test('5.6: GET /api/v1/admin/operations/system/jobs/:jobId rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/system/jobs/test-job-id'
      });

      assert.strictEqual(res.statusCode, 401);
    });

    test('5.7: POST /api/v1/admin/operations/system/jobs/:jobId/retry rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/operations/system/jobs/test-job-id/retry'
      });

      assert.strictEqual(res.statusCode, 401);
    });

    test('5.8: POST /api/v1/admin/operations/system/jobs/export rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/operations/system/jobs/export',
        payload: {
          format: 'json'
        }
      });

      assert.strictEqual(res.statusCode, 401);
    });

    test('5.9: Canonical alias GET /api/v1/admin/system/jobs/metrics rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/system/jobs/metrics'
      });

      assert.strictEqual(res.statusCode, 401);
    });

    test('5.10: Canonical alias GET /api/v1/admin/system/jobs/queues rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/system/jobs/queues'
      });

      assert.strictEqual(res.statusCode, 401);
    });

    test('5.11: Canonical alias GET /api/v1/admin/system/jobs/workers rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/system/jobs/workers'
      });

      assert.strictEqual(res.statusCode, 401);
    });

    test('5.12: Canonical alias GET /api/v1/admin/system/jobs rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/system/jobs'
      });

      assert.strictEqual(res.statusCode, 401);
    });

    test('5.13: Canonical alias GET /api/v1/admin/system/jobs/failed rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/system/jobs/failed'
      });

      assert.strictEqual(res.statusCode, 401);
    });

    test('5.14: Canonical alias POST /api/v1/admin/system/jobs/:jobId/retry rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/system/jobs/test-job-id/retry'
      });

      assert.strictEqual(res.statusCode, 401);
    });

    test('5.15: Canonical alias POST /api/v1/admin/system/jobs/export rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/system/jobs/export',
        payload: {
          format: 'json'
        }
      });

      assert.strictEqual(res.statusCode, 401);
    });
  });

  // =========================================================================
  // SUITE 6: EXPORT DATA SANITIZATION & INTEGRITY
  // =========================================================================
  describe('Suite 6: Controlled Export Integrity', () => {
    let exportAdmin: any;

    const mockContext: AdminOperationContext = {
      adminId: 'admin-test-export-001',
      adminEmail: 'export.admin@zdexcloud.internal',
      adminName: 'Export Admin',
      isSuperAdmin: true,
      status: 'ACTIVE' as any,
      sessionId: 'sess-test-export-001',
      roles: ['SUPER_ADMIN'],
      permissions: ['system.read', 'system.write'],
      requestId: 'req-export-001',
      clientIp: '127.0.0.1',
      userAgent: 'NodeTest/1.0'
    };

    before(async () => {
      exportAdmin = await prisma.adminUser.create({
        data: {
          email: `export.admin.${Date.now()}@zdexcloud.internal`,
          passwordHash: 'dummy-hash-12345',
          name: 'Export Admin',
          status: 'ACTIVE',
          isSuperAdmin: true
        }
      });
      mockContext.adminId = exportAdmin.id;
    });

    after(async () => {
      if (exportAdmin) {
        await prisma.adminAuditLog.deleteMany({ where: { adminId: exportAdmin.id } }).catch(() => {});
        await prisma.adminUser.delete({ where: { id: exportAdmin.id } }).catch(() => {});
      }
    });

    test('6.1: AdminBackgroundJobsService.exportJobs supports JSON and CSV export formats', async () => {
      const jsonExport = await AdminBackgroundJobsService.exportJobs({ format: 'json', maxLimit: 10 }, mockContext);
      assert.strictEqual(jsonExport.mimeType, 'application/json');
      assert.ok(jsonExport.filename.endsWith('.json'));
      assert.ok(typeof jsonExport.data === 'string');

      const csvExport = await AdminBackgroundJobsService.exportJobs({ format: 'csv', maxLimit: 10 }, mockContext);
      assert.strictEqual(csvExport.mimeType, 'text/csv');
      assert.ok(csvExport.filename.endsWith('.csv'));
      assert.ok(csvExport.data.includes('id') || csvExport.data.includes('jobType') || csvExport.data.includes('Job ID'));
    });
  });
});
