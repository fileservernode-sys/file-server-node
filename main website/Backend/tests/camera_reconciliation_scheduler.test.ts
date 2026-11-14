/**
 * ZDEXCLOUD — PHASE 20.4.1 CORRECTIVE TEST SUITE
 * PERIODIC CAMERA LIFECYCLE RECONCILIATION SCHEDULER & MULTI-INSTANCE SAFETY
 *
 * Execution Policy: WRITE-ONLY. ZERO TESTS EXECUTED.
 * Test Execution Status: NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28
 *
 * Covers all 9 mandatory Phase 20.4.1 scenarios:
 *  1. Scheduler invokes reconciliation at the configured interval (non-blocking startup).
 *  2. Overlapping cycles are prevented within the same worker.
 *  3. A failed cycle does not crash the API server or halt subsequent ticks.
 *  4. Scheduler shutdown prevents future invocations and drains in-flight work.
 *  5. Multiple backend instances cannot perform unsafe duplicate scheduled work.
 *  6. A fresh heartbeat is not overwritten by a concurrent reconciliation cycle.
 *  7. Existing stale-camera transitions remain correctly invoked through the worker.
 *  8. Scheduler configuration validation handles invalid values.
 *  9. Reconciliation failure is logged without exposing credentials or sensitive data.
 */

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'mysql://test:test@localhost:3306/zdexcloud_test';

import { describe, it, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  CameraStatus,
  CameraEndpointStatus,
  CameraStreamSessionStatus
} from '@prisma/client';

import { prisma } from '../src/config/database.js';
import { validateEnvironment } from '../src/config/env_validator.js';
import { appLogger } from '../src/observability/logger.js';
import { CameraLifecycleService } from '../src/services/camera_lifecycle_service.js';
import {
  CameraReconciliationWorker,
  validateCameraReconciliationWorkerConfig,
  sanitizeWorkerErrorMessage
} from '../src/services/camera_reconciliation_worker.js';

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
  }
}

function createSharedMockCameraDb(options?: { simulateConcurrentHeartbeatOnCameraId?: string }) {
  const cameras = new Map<string, any>();
  const endpoints = new Map<string, any>();
  const streamSessions = new Map<string, any>();
  const auditEvents: any[] = [];

  const matchesWhere = (row: any, where: any): boolean => {
    if (!where) return true;
    for (const [key, val] of Object.entries(where)) {
      if (key === 'OR' && Array.isArray(val)) {
        if (!val.some((sub) => matchesWhere(row, sub))) return false;
        continue;
      }
      if (val && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
        const candidate = row[key];
        if ('in' in val && Array.isArray(val.in) && !val.in.includes(candidate)) return false;
        if ('lt' in val && (!(candidate instanceof Date) || !(candidate.getTime() < (val.lt as Date).getTime()))) return false;
        if ('lte' in val && (!(candidate instanceof Date) || !(candidate.getTime() <= (val.lte as Date).getTime()))) return false;
        if ('gt' in val && (!(candidate instanceof Date) || !(candidate.getTime() > (val.gt as Date).getTime()))) return false;
        continue;
      }
      if (val instanceof Date) {
        if (!(row[key] instanceof Date) || row[key].getTime() !== val.getTime()) return false;
        continue;
      }
      if (row[key] !== val) return false;
    }
    return true;
  };

  const makeDelegate = (map: Map<string, any>, isCamera = false) => ({
    findUnique: async ({ where }: any) => {
      for (const item of map.values()) {
        if (matchesWhere(item, where)) return { ...item };
      }
      return null;
    },
    findMany: async ({ where, take }: any = {}) => {
      const list = Array.from(map.values())
        .filter((item) => matchesWhere(item, where))
        .map((item) => ({ ...item }));
      return typeof take === 'number' ? list.slice(0, take) : list;
    },
    count: async ({ where }: any = {}) =>
      Array.from(map.values()).filter((item) => matchesWhere(item, where)).length,
    update: async ({ where, data }: any) => {
      const existing = map.get(where.id);
      if (!existing) throw new Error(`Not found: ${where.id}`);
      const updated = {
        ...existing,
        ...data,
        updatedAt: data.updatedAt || new Date(existing.updatedAt.getTime() + 1)
      };
      map.set(updated.id, updated);
      return { ...updated };
    },
    updateMany: async ({ where, data }: any) => {
      if (isCamera && options?.simulateConcurrentHeartbeatOnCameraId) {
        const target = map.get(options.simulateConcurrentHeartbeatOnCameraId);
        if (target && where?.id === target.id) {
          target.lastSeenAt = new Date();
          target.updatedAt = new Date(target.updatedAt.getTime() + 5000);
        }
      }
      let count = 0;
      for (const [id, item] of map.entries()) {
        if (matchesWhere(item, where)) {
          map.set(id, {
            ...item,
            ...data,
            updatedAt: data.updatedAt || new Date(item.updatedAt.getTime() + 1)
          });
          count++;
        }
      }
      return { count };
    }
  });

  const cameraDelegate = makeDelegate(cameras, true);
  const endpointDelegate = makeDelegate(endpoints);
  const sessionDelegate = makeDelegate(streamSessions);
  const auditDelegate = {
    create: async ({ data }: any) => {
      const row = { id: `aud_${auditEvents.length + 1}`, createdAt: new Date(), ...data };
      auditEvents.push(row);
      return row;
    }
  };

  const txProxy = {
    $queryRaw: async () => [{ id: 'locked' }],
    cameraInstance: cameraDelegate,
    cameraEndpoint: endpointDelegate,
    cameraStreamSession: sessionDelegate,
    cameraAccessAuditEvent: auditDelegate
  };

  mock.method(prisma as any, '$transaction', async (fn: any) => fn(txProxy));
  mock.method(prisma as any, '$queryRaw', async () => [{ id: 'locked' }]);

  for (const [model, delegate] of [
    ['cameraInstance', cameraDelegate],
    ['cameraEndpoint', endpointDelegate],
    ['cameraStreamSession', sessionDelegate],
    ['cameraAccessAuditEvent', auditDelegate]
  ] as const) {
    const target = (prisma as any)[model];
    for (const key of Object.keys(delegate)) {
      if (typeof target[key] === 'function') {
        mock.method(target, key, (delegate as any)[key]);
      }
    }
  }

  return { cameras, endpoints, streamSessions, auditEvents };
}

describe('Phase 20.4.1 Camera Reconciliation Scheduler [STATUS: NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28]', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  describe('Scenario 1: Scheduler Invokes Reconciliation at Configured Interval', () => {
    it('[DEFERRED TO PHASE 28] starts non-blockingly and invokes reconcile at initial delay + configured interval', async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });

      let calls = 0;
      const worker = new CameraReconciliationWorker({
        workerId: 'cam-sched-test-1',
        enabled: true,
        intervalMs: 15000,
        initialDelayMs: 5000,
        runOnStartup: true,
        maxJitterMs: 0,
        batchSize: 50,
        reconcileFn: async (opts) => {
          calls++;
          assert.equal(opts?.batchSize, 50);
          return {
            evaluatedAt: new Date().toISOString(),
            expiredSessionsTimedOut: 0,
            streamingReconciledToOnline: 0,
            camerasEvaluated: 0,
            transitionedToReconnecting: 0,
            transitionedToOffline: 0,
            skippedConcurrentOrFresh: 0,
            errors: []
          };
        }
      });

      worker.start();
      // Must NOT block HTTP startup or invoke synchronously inside start()
      assert.equal(calls, 0);
      assert.equal(worker.isRunning(), true);

      // Initial startup delay (5000ms)
      t.mock.timers.tick(5000);
      await flushMicrotasks();
      assert.equal(calls, 1);

      // Configured recurring interval (15000ms)
      t.mock.timers.tick(15000);
      await flushMicrotasks();
      assert.equal(calls, 2);

      t.mock.timers.tick(15000);
      await flushMicrotasks();
      assert.equal(calls, 3);

      await worker.stop();
    });
  });

  describe('Scenario 2: Overlapping Cycles Are Prevented', () => {
    it('[DEFERRED TO PHASE 28] skips concurrent runCycle invocations while an execution is still active', async () => {
      let releaseCycle!: () => void;
      const blocker = new Promise<void>((resolve) => {
        releaseCycle = resolve;
      });
      let invocations = 0;

      const worker = new CameraReconciliationWorker({
        workerId: 'cam-overlap-test',
        enabled: true,
        intervalMs: 10000,
        batchSize: 10,
        reconcileFn: async () => {
          invocations++;
          await blocker;
          return {
            evaluatedAt: new Date().toISOString(),
            expiredSessionsTimedOut: 0,
            streamingReconciledToOnline: 0,
            camerasEvaluated: 1,
            transitionedToReconnecting: 1,
            transitionedToOffline: 0,
            skippedConcurrentOrFresh: 0,
            errors: []
          };
        }
      });

      const firstPromise = worker.runCycle();
      const overlappingOutcome = await worker.runCycle();

      assert.equal(overlappingOutcome.skipped, true);
      assert.equal(overlappingOutcome.success, true);
      assert.equal(invocations, 1);

      releaseCycle();
      const firstOutcome = await firstPromise;
      assert.equal(firstOutcome.skipped, false);
      assert.equal(firstOutcome.success, true);
      assert.equal(worker.getMetrics().totalSkippedOverlap, 1);
    });
  });

  describe('Scenario 3: Failed Cycle Does Not Crash Server or Halt Future Runs', () => {
    it('[DEFERRED TO PHASE 28] isolates reconciliation failures and continues subsequent scheduled ticks', async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });

      let attempt = 0;
      const worker = new CameraReconciliationWorker({
        workerId: 'cam-failure-isolation',
        enabled: true,
        intervalMs: 10000,
        initialDelayMs: 0,
        runOnStartup: true,
        maxJitterMs: 0,
        reconcileFn: async () => {
          attempt++;
          if (attempt === 1) {
            throw new Error('Transient MySQL connection timeout');
          }
          return {
            evaluatedAt: new Date().toISOString(),
            expiredSessionsTimedOut: 0,
            streamingReconciledToOnline: 0,
            camerasEvaluated: 2,
            transitionedToReconnecting: 1,
            transitionedToOffline: 0,
            skippedConcurrentOrFresh: 1,
            errors: []
          };
        }
      });

      worker.start();
      t.mock.timers.tick(0);
      await flushMicrotasks();

      const metricsAfterFailure = worker.getMetrics();
      assert.equal(metricsAfterFailure.totalRuns, 1);
      assert.equal(metricsAfterFailure.totalFailures, 1);
      assert.equal(metricsAfterFailure.lastSuccess, false);
      assert.equal(worker.isRunning(), true);

      // Next scheduled tick recovers cleanly
      t.mock.timers.tick(10000);
      await flushMicrotasks();

      const metricsAfterRecovery = worker.getMetrics();
      assert.equal(metricsAfterRecovery.totalRuns, 2);
      assert.equal(metricsAfterRecovery.totalFailures, 1);
      assert.equal(metricsAfterRecovery.lastSuccess, true);

      await worker.stop();
    });
  });

  describe('Scenario 4: Scheduler Shutdown Prevents Future Invocations', () => {
    it('[DEFERRED TO PHASE 28] cancels timers immediately and awaits in-flight cycle during graceful stop', async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });

      let runs = 0;
      const worker = new CameraReconciliationWorker({
        workerId: 'cam-shutdown-test',
        enabled: true,
        intervalMs: 10000,
        initialDelayMs: 1000,
        runOnStartup: true,
        maxJitterMs: 0,
        reconcileFn: async () => {
          runs++;
          return {
            evaluatedAt: new Date().toISOString(),
            expiredSessionsTimedOut: 0,
            streamingReconciledToOnline: 0,
            camerasEvaluated: 0,
            transitionedToReconnecting: 0,
            transitionedToOffline: 0,
            skippedConcurrentOrFresh: 0,
            errors: []
          };
        }
      });

      worker.start();
      t.mock.timers.tick(1000);
      await flushMicrotasks();
      assert.equal(runs, 1);

      await worker.stop();
      assert.equal(worker.isRunning(), false);

      // Advance well past multiple intervals after shutdown -> zero new invocations
      t.mock.timers.tick(60000);
      await flushMicrotasks();
      assert.equal(runs, 1);
    });
  });

  describe('Scenario 5: Multiple Backend Instances Cannot Perform Unsafe Duplicate Scheduled Work', () => {
    it('[DEFERRED TO PHASE 28] enforces single-winner DB CAS when two worker instances run concurrently', async () => {
      const db = createSharedMockCameraDb();
      const staleTime = new Date(Date.now() - 120_000);

      db.cameras.set('cam_multi_1', {
        id: 'cam_multi_1',
        userId: 'usr_1',
        deviceId: 'dev_1',
        status: CameraStatus.ONLINE,
        lastSeenAt: staleTime,
        startedAt: staleTime,
        stoppedAt: null,
        metadata: {},
        updatedAt: staleTime
      });
      db.endpoints.set('ep_multi_1', {
        id: 'ep_multi_1',
        cameraInstanceId: 'cam_multi_1',
        status: CameraEndpointStatus.CONNECTED,
        lastHeartbeatAt: staleTime,
        disconnectedAt: null,
        updatedAt: staleTime
      });

      const workerReplicaA = new CameraReconciliationWorker({
        workerId: 'replica-a',
        enabled: true,
        intervalMs: 30000
      });
      const workerReplicaB = new CameraReconciliationWorker({
        workerId: 'replica-b',
        enabled: true,
        intervalMs: 30000
      });

      const [outcomeA, outcomeB] = await Promise.all([
        workerReplicaA.runCycle(),
        workerReplicaB.runCycle()
      ]);

      const totalReconnecting =
        (outcomeA.result?.transitionedToReconnecting ?? 0) +
        (outcomeB.result?.transitionedToReconnecting ?? 0);
      const totalSkipped =
        (outcomeA.result?.skippedConcurrentOrFresh ?? 0) +
        (outcomeB.result?.skippedConcurrentOrFresh ?? 0);

      // Exactly one replica wins CAS transition + audit event; the losing replica skips cleanly
      assert.equal(totalReconnecting, 1);
      assert.equal(totalSkipped, 1);
      assert.equal(db.cameras.get('cam_multi_1').status, CameraStatus.RECONNECTING);
      assert.equal(db.auditEvents.length, 1);
    });
  });

  describe('Scenario 6: Fresh Heartbeat Not Overwritten by Concurrent Reconciliation Cycle', () => {
    it('[DEFERRED TO PHASE 28] aborts stale transition when a concurrent fresh heartbeat updates lastSeenAt', async () => {
      const db = createSharedMockCameraDb({
        simulateConcurrentHeartbeatOnCameraId: 'cam_race_1'
      });
      const oldTime = new Date(Date.now() - 110_000);

      db.cameras.set('cam_race_1', {
        id: 'cam_race_1',
        userId: 'usr_1',
        deviceId: 'dev_1',
        status: CameraStatus.ONLINE,
        lastSeenAt: oldTime,
        startedAt: oldTime,
        stoppedAt: null,
        metadata: {},
        updatedAt: oldTime
      });

      const worker = new CameraReconciliationWorker({
        workerId: 'cam-cas-race-worker',
        enabled: true,
        intervalMs: 30000
      });

      const outcome = await worker.runCycle();
      assert.equal(outcome.success, true);
      assert.equal(outcome.result?.transitionedToReconnecting, 0);
      assert.equal(outcome.result?.skippedConcurrentOrFresh, 1);
      assert.equal(db.cameras.get('cam_race_1').status, CameraStatus.ONLINE);
    });
  });

  describe('Scenario 7: Stale-Camera Transitions Remain Correctly Invoked Through Worker', () => {
    it('[DEFERRED TO PHASE 28] transitions stale ONLINE camera and expires stale viewer session without marking healthy camera OFFLINE', async () => {
      const db = createSharedMockCameraDb();
      const now = new Date();
      const staleHb = new Date(now.getTime() - 110_000);
      const freshHb = new Date(now.getTime() - 5_000);

      db.cameras.set('cam_stale_online', {
        id: 'cam_stale_online',
        userId: 'usr_1',
        deviceId: 'dev_1',
        status: CameraStatus.ONLINE,
        lastSeenAt: staleHb,
        startedAt: staleHb,
        stoppedAt: null,
        metadata: {},
        updatedAt: staleHb
      });
      db.cameras.set('cam_streaming_expired_sess', {
        id: 'cam_streaming_expired_sess',
        userId: 'usr_1',
        deviceId: 'dev_2',
        status: CameraStatus.STREAMING,
        lastSeenAt: freshHb,
        startedAt: freshHb,
        stoppedAt: null,
        metadata: {},
        updatedAt: freshHb
      });
      db.streamSessions.set('sess_exp_1', {
        id: 'sess_exp_1',
        cameraInstanceId: 'cam_streaming_expired_sess',
        status: CameraStreamSessionStatus.ACTIVE,
        expiresAt: new Date(now.getTime() - 1000),
        updatedAt: freshHb
      });

      const worker = new CameraReconciliationWorker({
        workerId: 'cam-transitions-worker',
        enabled: true,
        intervalMs: 30000,
        heartbeatTimeoutMs: 90000,
        reconnectGraceMs: 180000,
        connectingTimeoutMs: 120000,
        reconcileFn: (opts) => CameraLifecycleService.reconcileStaleCameras({ ...opts, now })
      });

      const outcome = await worker.runCycle();
      assert.equal(outcome.success, true);
      assert.equal(outcome.result?.expiredSessionsTimedOut, 1);
      assert.equal(outcome.result?.streamingReconciledToOnline, 1);
      assert.equal(outcome.result?.transitionedToReconnecting, 1);

      assert.equal(db.cameras.get('cam_stale_online').status, CameraStatus.RECONNECTING);
      assert.equal(db.cameras.get('cam_streaming_expired_sess').status, CameraStatus.ONLINE);
    });
  });

  describe('Scenario 8: Scheduler Configuration Validation Rejects Invalid Values', () => {
    it('[DEFERRED TO PHASE 28] rejects invalid intervals, batch sizes, delays, and boolean flags', () => {
      assert.throws(
        () =>
          validateCameraReconciliationWorkerConfig({
            enabled: true,
            intervalMs: 1000, // Below 5000ms floor
            initialDelayMs: 5000,
            runOnStartup: true,
            batchSize: 100
          }),
        (err: any) => err?.errorCode === 'VALIDATION_ERROR'
      );

      assert.throws(
        () =>
          validateCameraReconciliationWorkerConfig({
            enabled: true,
            intervalMs: Number.NaN,
            initialDelayMs: 5000,
            runOnStartup: true,
            batchSize: 100
          }),
        (err: any) => err?.errorCode === 'VALIDATION_ERROR'
      );

      assert.throws(
        () =>
          validateCameraReconciliationWorkerConfig({
            enabled: true,
            intervalMs: 30000,
            initialDelayMs: -1,
            runOnStartup: true,
            batchSize: 0
          }),
        (err: any) => err?.errorCode === 'VALIDATION_ERROR'
      );

      const envCheck = validateEnvironment({
        CAMERA_RECONCILIATION_INTERVAL_MS: -500,
        CAMERA_RECONCILIATION_BATCH_SIZE: 0
      });
      assert.equal(envCheck.valid, false);
      assert.ok(envCheck.errors.some((e) => e.includes('CAMERA_RECONCILIATION_INTERVAL_MS')));
      assert.ok(envCheck.errors.some((e) => e.includes('CAMERA_RECONCILIATION_BATCH_SIZE')));
    });
  });

  describe('Scenario 9: Reconciliation Failure Logged Without Exposing Credentials or Secrets', () => {
    it('[DEFERRED TO PHASE 28] redacts DSNs, Bearer tokens, device tokens, OTPs, and hashes from logs and metrics', async () => {
      const capturedErrors: any[] = [];
      mock.method(appLogger, 'error', (message: string, errObj?: unknown, context?: any) => {
        capturedErrors.push({ message, errObj, context });
      });

      const sensitiveError =
        'Failure on mysql://admin:SecretPass123@db.internal:3306/prod with Bearer eyJhbGciOi.payloadSig.sig, token=dst_secretDeviceToken999, otp=482910, hash=' +
        'a'.repeat(64);

      const scrubbedDirect = sanitizeWorkerErrorMessage(sensitiveError);
      assert.equal(scrubbedDirect.includes('SecretPass123'), false);
      assert.equal(scrubbedDirect.includes('dst_secretDeviceToken999'), false);
      assert.equal(scrubbedDirect.includes('482910'), false);
      assert.equal(scrubbedDirect.includes('a'.repeat(64)), false);

      const worker = new CameraReconciliationWorker({
        workerId: 'cam-sanitize-test',
        enabled: true,
        intervalMs: 30000,
        reconcileFn: async () => {
          throw new Error(sensitiveError);
        }
      });

      const outcome = await worker.runCycle();
      assert.equal(outcome.success, false);

      const serializedMetrics = JSON.stringify(worker.getMetrics());
      const serializedLogs = JSON.stringify(capturedErrors);

      for (const forbidden of ['SecretPass123', 'eyJhbGciOi', 'dst_secretDeviceToken999', '482910', 'a'.repeat(64)]) {
        assert.equal(serializedMetrics.includes(forbidden), false);
        assert.equal(serializedLogs.includes(forbidden), false);
      }
      assert.ok(capturedErrors.length >= 1);
    });
  });

  describe('Phase 20.4.1.1 Shutdown & Prisma Disconnect Safety [NOT RUN — DEFERRED UNTIL PHASE 28]', () => {
    it('[DEFERRED TO PHASE 28] waits cleanly when active cycle finishes within shutdown window before disconnecting Prisma', async () => {
      const order: string[] = [];
      let releaseCycle!: () => void;
      const blocker = new Promise<void>((resolve) => {
        releaseCycle = resolve;
      });

      const worker = new CameraReconciliationWorker({
        workerId: 'cam-shutdown-within-window',
        enabled: true,
        intervalMs: 30000,
        reconcileFn: async () => {
          order.push('reconcile_start');
          await blocker;
          order.push('reconcile_finish');
          return {
            evaluatedAt: new Date().toISOString(),
            expiredSessionsTimedOut: 0,
            streamingReconciledToOnline: 0,
            camerasEvaluated: 1,
            transitionedToReconnecting: 0,
            transitionedToOffline: 0,
            skippedConcurrentOrFresh: 1,
            errors: []
          };
        }
      });

      const cyclePromise = worker.runCycle();
      await flushMicrotasks();
      assert.equal(worker.isExecuting(), true);

      const stopPromise = worker.stop();
      await flushMicrotasks();

      // Prisma must remain connected until reconciliation stops
      assert.deepEqual(order, ['reconcile_start']);

      releaseCycle();
      await cyclePromise;
      const stopRes = await stopPromise;
      order.push('stop_resolved');

      assert.equal(worker.isExecuting(), false);
      assert.equal(stopRes.waitedForCycle, true);
      assert.equal(stopRes.timedOut, false);
      assert.equal(stopRes.cycleStillActive, false);

      // Server shutdown proceeds to Prisma disconnect only after worker.stop() resolves
      await prisma.$disconnect();
      order.push('prisma_disconnect');

      assert.deepEqual(order, [
        'reconcile_start',
        'reconcile_finish',
        'stop_resolved',
        'prisma_disconnect'
      ]);
    });

    it('[DEFERRED TO PHASE 28] does NOT exit prematurely when cycle exceeds 10s, warns loudly, and holds Prisma disconnect until finish', async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const warnings: any[] = [];
      mock.method(appLogger, 'warn', (msg: string, ctx?: any) => {
        warnings.push({ msg, ctx });
      });

      let releaseSlowCycle!: () => void;
      const slowCycleGate = new Promise<void>((resolve) => {
        releaseSlowCycle = resolve;
      });
      let prismaDisconnected = false;

      const worker = new CameraReconciliationWorker({
        workerId: 'cam-shutdown-exceeds-10s',
        enabled: true,
        intervalMs: 30000,
        initialDelayMs: 0,
        runOnStartup: true,
        maxJitterMs: 0,
        reconcileFn: async () => {
          await slowCycleGate;
          return {
            evaluatedAt: new Date().toISOString(),
            expiredSessionsTimedOut: 0,
            streamingReconciledToOnline: 0,
            camerasEvaluated: 0,
            transitionedToReconnecting: 0,
            transitionedToOffline: 0,
            skippedConcurrentOrFresh: 0,
            errors: []
          };
        }
      });

      worker.start();
      t.mock.timers.tick(0);
      await flushMicrotasks();
      assert.equal(worker.isExecuting(), true);

      let stopSettled = false;
      const shutdownSequence = (async () => {
        const res = await worker.stop();
        stopSettled = true;
        if (!worker.isExecuting()) {
          prismaDisconnected = true;
        }
        return res;
      })();

      // Advance past the former 10,000ms timeout while DB reconciliation is still active
      t.mock.timers.tick(10500);
      await flushMicrotasks();

      assert.equal(stopSettled, false, 'Default shutdown must wait instead of silently timing out at 10s');
      assert.equal(worker.isExecuting(), true);
      assert.equal(prismaDisconnected, false, 'Prisma must NOT disconnect while cycle is still running');
      assert.ok(
        warnings.some((w) => w.ctx?.operation === 'CAMERA_RECONCILIATION_WORKER_STOP_WAITING'),
        'Slow shutdown past 10s must emit explicit warning'
      );

      // Finish slow DB operation cleanly at ~12.5s
      t.mock.timers.tick(2000);
      releaseSlowCycle();
      const stopOutcome = await shutdownSequence;

      assert.equal(stopSettled, true);
      assert.equal(stopOutcome.waitedForCycle, true);
      assert.equal(stopOutcome.timedOut, false);
      assert.equal(worker.isExecuting(), false);
      assert.equal(prismaDisconnected, true, 'Prisma disconnect occurs strictly after reconciliation finishes');
    });

    it('[DEFERRED TO PHASE 28] explicit finite shutdown timeout throws loudly instead of silently returning before Prisma disconnect', async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });

      let releaseStuckCycle!: () => void;
      const stuckGate = new Promise<void>((resolve) => {
        releaseStuckCycle = resolve;
      });
      let disconnectCalled = false;

      const worker = new CameraReconciliationWorker({
        workerId: 'cam-explicit-timeout-fail',
        enabled: true,
        intervalMs: 30000,
        reconcileFn: async () => {
          await stuckGate;
          return {
            evaluatedAt: new Date().toISOString(),
            expiredSessionsTimedOut: 0,
            streamingReconciledToOnline: 0,
            camerasEvaluated: 0,
            transitionedToReconnecting: 0,
            transitionedToOffline: 0,
            skippedConcurrentOrFresh: 0,
            errors: []
          };
        }
      });

      const cyclePromise = worker.runCycle();
      await flushMicrotasks();

      const guardedDisconnect = async () => {
        await worker.stop({ timeoutMs: 10000 });
        if (!worker.isExecuting()) {
          disconnectCalled = true;
        }
      };

      const assertionPromise = assert.rejects(
        () => guardedDisconnect(),
        (err: any) => err?.code === 'CAMERA_RECONCILIATION_SHUTDOWN_TIMEOUT'
      );

      t.mock.timers.tick(10000);
      await assertionPromise;
      assert.equal(disconnectCalled, false, 'Prisma disconnect must never execute after a shutdown timeout');

      releaseStuckCycle();
      await cyclePromise;
    });

    it('[DEFERRED TO PHASE 28] prevents any subsequent cycle from starting after shutdown begins', async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      let invocations = 0;

      const worker = new CameraReconciliationWorker({
        workerId: 'cam-no-cycles-after-stop',
        enabled: true,
        intervalMs: 10000,
        initialDelayMs: 5000,
        runOnStartup: true,
        maxJitterMs: 0,
        reconcileFn: async () => {
          invocations++;
          return {
            evaluatedAt: new Date().toISOString(),
            expiredSessionsTimedOut: 0,
            streamingReconciledToOnline: 0,
            camerasEvaluated: 0,
            transitionedToReconnecting: 0,
            transitionedToOffline: 0,
            skippedConcurrentOrFresh: 0,
            errors: []
          };
        }
      });

      worker.start();
      await worker.stop();
      assert.equal(worker.isShutdownRequested(), true);

      // Pending initial timer cleared -> advancing timers must not run any cycle
      t.mock.timers.tick(60000);
      await flushMicrotasks();

      // Explicit manual runCycle() and start() after shutdown must also refuse to run
      const manualAfterStop = await worker.runCycle();
      worker.start();
      t.mock.timers.tick(30000);
      await flushMicrotasks();

      assert.equal(manualAfterStop.skipped, true);
      assert.equal(manualAfterStop.skippedReason, 'Worker shutdown in progress');
      assert.equal(invocations, 0);
    });

    it('[DEFERRED TO PHASE 28] repeated concurrent and sequential stop() calls are safe and idempotent', async () => {
      let releaseCycle!: () => void;
      const blocker = new Promise<void>((resolve) => {
        releaseCycle = resolve;
      });

      const worker = new CameraReconciliationWorker({
        workerId: 'cam-idempotent-stop',
        enabled: true,
        intervalMs: 30000,
        reconcileFn: async () => {
          await blocker;
          return {
            evaluatedAt: new Date().toISOString(),
            expiredSessionsTimedOut: 0,
            streamingReconciledToOnline: 0,
            camerasEvaluated: 0,
            transitionedToReconnecting: 0,
            transitionedToOffline: 0,
            skippedConcurrentOrFresh: 0,
            errors: []
          };
        }
      });

      const cyclePromise = worker.runCycle();
      await flushMicrotasks();

      // Two concurrent stop() calls share the same shutdown barrier
      const p1 = worker.stop();
      const p2 = worker.stop();

      releaseCycle();
      await cyclePromise;
      const [r1, r2] = await Promise.all([p1, p2]);

      assert.equal(r1.waitedForCycle, true);
      assert.equal(r2.waitedForCycle, true);
      assert.equal(r1.timedOut, false);

      // Third sequential stop() call after already stopped is an idempotent no-op
      const r3 = await worker.stop();
      assert.equal(r3.alreadyStopped, true);
      assert.equal(r3.waitedForCycle, false);
      assert.equal(r3.cycleStillActive, false);
    });
  });
});
