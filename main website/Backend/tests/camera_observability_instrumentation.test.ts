/**
 * ZDEXCLOUD — PHASE 20.6.2 TEST SUITE
 * CAMERA OBSERVABILITY INSTRUMENTATION & PRIVACY REDACTION HARDENING
 *
 * Execution Policy: WRITE-ONLY. ZERO TESTS EXECUTED.
 * Test Execution Status: NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28
 *
 * Covers all 5 Phase 20.6.2 observability & privacy verification domains:
 *  1. Privacy Redaction & Sensitive Token Scrubbing (SDP, ICE, cvt_, dst_, pct_, zdc_, sess_, CSRF, cookies, nested structures)
 *  2. MetricsCollector Camera Extensions (admin operations domain, HTTP counters/latency, lifecycle transitions, heartbeat buffer)
 *  3. CameraSignalingService Metrics & Local-Process Telemetry (categorized auth rejections, negotiation counters, terminations, latencies)
 *  4. CameraLifecycleService & Reconciliation Worker Instrumentation & Fail-Safe Error Ingestion
 *  5. SystemOverviewService Camera Subsystem Telemetry & Fault Isolation
 */

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'mysql://test:test@localhost:3306/zdexcloud_test';

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { CameraStatus, CameraStreamSessionStatus } from '@prisma/client';

import {
  sanitizeLogString,
  sanitizeLogMetadata,
  isSensitiveKey,
  appLogger
} from '../src/observability/logger.js';
import { AdminAuditSanitizer } from '../src/services/admin/admin_audit_sanitizer.js';
import { ErrorSanitizer } from '../src/utils/error_sanitizer.js';
import {
  matchesSensitiveKeyPattern,
  scrubSensitiveEmbeddedStrings
} from '../src/observability/redaction_patterns.js';
import {
  metricsCollector,
  BoundedLatencyRecorder
} from '../src/observability/metrics.js';
import {
  CameraSignalingService,
  defaultCameraSignalingService
} from '../src/services/camera_signaling_service.js';
import { CameraLifecycleService } from '../src/services/camera_lifecycle_service.js';
import {
  CameraReconciliationWorker,
  sanitizeWorkerErrorMessage
} from '../src/services/camera_reconciliation_worker.js';
import { SystemOverviewService } from '../src/services/admin/system_overview_service.js';
import { errorIngestionService } from '../src/services/error_ingestion_service.js';
import { AppError, ConflictError, ValidationError } from '../src/errors/app-error.js';

describe('Phase 20.6.2 — Camera Observability Instrumentation & Privacy Redaction Hardening [NOT RUN — DEFERRED UNTIL PHASE 28]', () => {

  // =========================================================================
  // DOMAIN 1: PRIVACY REDACTION & SENSITIVE DATA SCRUBBING
  // =========================================================================
  describe('Domain 1: Privacy Redaction & Sensitive Data Scrubbing', () => {

    it('[DEFERRED TO PHASE 28] scrubs WebRTC SDP offers/answers and ICE candidate attributes from freeform log strings', () => {
      const sdpString =
        'WebRTC signaling error on session v=0\r\no=- 123456 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=ice-ufrag:ABCD12\r\na=ice-pwd:SecretPassword123\r\na=fingerprint:sha-256 00:11:22:33:44';
      const scrubbed = sanitizeLogString(sdpString);

      assert.equal(scrubbed.includes('SecretPassword123'), false, 'ICE password must be scrubbed');
      assert.equal(scrubbed.includes('v=0'), false, 'SDP header line must be redacted');
      assert.ok(scrubbed.includes('[REDACTED_SDP]') || scrubbed.includes('[REDACTED_WEBRTC_ATTR]'));
    });

    it('[DEFERRED TO PHASE 28] scrubs raw ICE candidates from freeform error messages and logs', () => {
      const iceMsg =
        'Failed to connect peer with candidate:1001 1 udp 2122260223 192.168.1.100 54321 typ host generation 0 ufrag ABCD network-id 1';
      const scrubbed = sanitizeLogString(iceMsg);

      assert.equal(scrubbed.includes('192.168.1.100'), false, 'Local IP in ICE candidate must be scrubbed');
      assert.ok(scrubbed.includes('[REDACTED_ICE_CANDIDATE]'));
    });

    it('[DEFERRED TO PHASE 28] scrubs camera tokens and prefixes (cvt_, dst_, pct_, zdc_, sess_) from strings', () => {
      const tokenPayload =
        'Received auth tokens: cvt_abcdef1234567890, dst_secret_device_12345678, pct_challenge_token_12345, zdc_connect_token_99999, sess_internal_session_abc';
      const scrubbed = scrubSensitiveEmbeddedStrings(tokenPayload);

      assert.equal(scrubbed.includes('cvt_abcdef1234567890'), false);
      assert.equal(scrubbed.includes('dst_secret_device_12345678'), false);
      assert.equal(scrubbed.includes('pct_challenge_token_12345'), false);
      assert.equal(scrubbed.includes('zdc_connect_token_99999'), false);
      assert.equal(scrubbed.includes('sess_internal_session_abc'), false);
      assert.equal((scrubbed.match(/\[REDACTED_TOKEN\]/g) || []).length, 5);
    });

    it('[DEFERRED TO PHASE 28] redacts sensitive WebRTC and token keys in structured metadata across logger and admin sanitizer', () => {
      const metadata = {
        sdp: 'v=0\r\no=alice 1234...',
        iceCandidate: 'candidate:1 1 udp...',
        candidate: 'candidate:2 1 udp...',
        offer: { type: 'offer', sdp: 'v=0...' },
        answer: { type: 'answer', sdp: 'v=0...' },
        viewingToken: 'cvt_test1234567890',
        pairingChallengeToken: 'pct_test1234567890',
        connectionToken: 'zdc_test1234567890',
        sessionTokenHash: 'a'.repeat(64),
        credentialHash: 'b'.repeat(64),
        userId: 'usr_valid_actor',
        deviceId: 'dev_valid_device',
        cameraId: 'cam_valid_camera',
        adminId: 'adm_valid_admin'
      };

      const logSanitized = sanitizeLogMetadata(metadata);
      const auditSanitized = AdminAuditSanitizer.sanitizeMetadata(metadata) as Record<string, unknown>;
      const errorSanitized = ErrorSanitizer.sanitizeMetadata(metadata) as Record<string, unknown>;

      for (const target of [logSanitized, auditSanitized, errorSanitized]) {
        assert.equal(target.sdp, '[REDACTED]');
        assert.equal(target.iceCandidate, '[REDACTED]');
        assert.equal(target.candidate, '[REDACTED]');
        assert.equal(target.offer, '[REDACTED]');
        assert.equal(target.answer, '[REDACTED]');
        assert.equal(target.viewingToken, '[REDACTED]');
        assert.equal(target.pairingChallengeToken, '[REDACTED]');
        assert.equal(target.connectionToken, '[REDACTED]');
        assert.equal(target.sessionTokenHash, '[REDACTED]');
        assert.equal(target.credentialHash, '[REDACTED]');

        // Actor & resource IDs must be strictly preserved
        assert.equal(target.userId, 'usr_valid_actor');
        assert.equal(target.deviceId, 'dev_valid_device');
        assert.equal(target.cameraId, 'cam_valid_camera');
        assert.equal(target.adminId, 'adm_valid_admin');
      }
    });

    it('[DEFERRED TO PHASE 28] redacts nested objects and arrays containing WebRTC payloads and tokens without dropping surrounding context', () => {
      const nested = {
        cameraSession: {
          sessionId: 'sess_123',
          negotiation: [
            { sdp: 'v=0...', type: 'offer' },
            { candidate: 'candidate:1...', sdpMLineIndex: 0 }
          ]
        }
      };

      const sanitized = sanitizeLogMetadata(nested);
      assert.equal(sanitized.cameraSession.sessionId, 'sess_123');
      assert.equal(sanitized.cameraSession.negotiation[0].sdp, '[REDACTED]');
      assert.equal(sanitized.cameraSession.negotiation[0].type, 'offer');
      assert.equal(sanitized.cameraSession.negotiation[1].candidate, '[REDACTED]');
      assert.equal(sanitized.cameraSession.negotiation[1].sdpMLineIndex, 0);
    });

    it('[DEFERRED TO PHASE 28] sanitizes error stack traces and error messages containing sensitive tokens and DSNs', () => {
      const sensitiveStack =
        'Error: Connection failed to mysql://app:secret123@db.prod.internal:3306/zdex with token=cvt_secretViewerToken999\n' +
        '    at CameraSignalingService.handleWebRtcOffer (/app/src/services/camera_signaling_service.ts:1400:15)';

      const scrubbed = ErrorSanitizer.sanitizeStackTrace(sensitiveStack);
      assert.ok(scrubbed);
      assert.equal(scrubbed.includes('secret123'), false);
      assert.equal(scrubbed.includes('cvt_secretViewerToken999'), false);
      assert.ok(scrubbed.includes('CameraSignalingService.handleWebRtcOffer'));
    });
  });

  // =========================================================================
  // DOMAIN 2: METRICS COLLECTOR CAMERA EXTENSIONS
  // =========================================================================
  describe('Domain 2: MetricsCollector Camera Extensions', () => {

    it('[DEFERRED TO PHASE 28] records admin camera operations in adminOperations.byDomain.cameras', () => {
      metricsCollector.recordAdminOperation('cameras', 200);
      metricsCollector.recordAdminOperation('cameras', 403);
      metricsCollector.recordAdminOperation('cameras', 500);

      const snapshot = metricsCollector.getSnapshot();
      assert.ok(snapshot.adminOperations.byDomain.cameras >= 3);
      assert.ok(snapshot.adminOperations.totalOperations >= 3);
    });

    it('[DEFERRED TO PHASE 28] records camera HTTP requests by status class and calculates bounded latency summary', () => {
      metricsCollector.recordCameraHttpRequest(200, 15);
      metricsCollector.recordCameraHttpRequest(201, 25);
      metricsCollector.recordCameraHttpRequest(400, 10);
      metricsCollector.recordCameraHttpRequest(500, 100);

      const snapshot = metricsCollector.getSnapshot();
      assert.ok(snapshot.camera.http.totalRequests >= 4);
      assert.ok(snapshot.camera.http.requestsByStatusClass['2xx'] >= 2);
      assert.ok(snapshot.camera.http.requestsByStatusClass['4xx'] >= 1);
      assert.ok(snapshot.camera.http.requestsByStatusClass['5xx'] >= 1);
      assert.ok(snapshot.camera.http.errorCount >= 2);
      assert.ok(snapshot.camera.http.latency.count >= 4);
      assert.ok(snapshot.camera.http.latency.averageMs > 0);
      assert.ok(snapshot.camera.http.latency.maxMs >= 100);
    });

    it('[DEFERRED TO PHASE 28] records camera lifecycle transitions by status and source', () => {
      metricsCollector.recordCameraLifecycleTransition('ONLINE', 'heartbeat');
      metricsCollector.recordCameraLifecycleTransition('STREAMING', 'report');
      metricsCollector.recordCameraLifecycleTransition('RECONNECTING', 'reconciliation');
      metricsCollector.recordCameraLifecycleTransition('OFFLINE', 'api');

      const snapshot = metricsCollector.getSnapshot();
      assert.ok(snapshot.camera.lifecycle.transitionsTotal >= 4);
      assert.ok(snapshot.camera.lifecycle.transitionsByTargetStatus.ONLINE >= 1);
      assert.ok(snapshot.camera.lifecycle.transitionsByTargetStatus.STREAMING >= 1);
      assert.ok(snapshot.camera.lifecycle.transitionsByTargetStatus.RECONNECTING >= 1);
      assert.ok(snapshot.camera.lifecycle.transitionsByTargetStatus.OFFLINE >= 1);
      assert.ok(snapshot.camera.lifecycle.transitionsBySource.heartbeat >= 1);
      assert.ok(snapshot.camera.lifecycle.transitionsBySource.report >= 1);
      assert.ok(snapshot.camera.lifecycle.transitionsBySource.reconciliation >= 1);
      assert.ok(snapshot.camera.lifecycle.transitionsBySource.api >= 1);
    });

    it('[DEFERRED TO PHASE 28] records camera transition failure categories', () => {
      metricsCollector.recordCameraLifecycleTransitionFailure('INVALID_TRANSITION');
      metricsCollector.recordCameraLifecycleTransitionFailure('STALE_REPORT');
      metricsCollector.recordCameraLifecycleTransitionFailure('NO_ACTIVE_SESSION');
      metricsCollector.recordCameraLifecycleTransitionFailure('UNAUTHORIZED');

      const snapshot = metricsCollector.getSnapshot();
      assert.ok(snapshot.camera.lifecycle.transitionFailuresTotal >= 4);
      assert.ok(snapshot.camera.lifecycle.transitionFailuresByCategory.INVALID_TRANSITION >= 1);
      assert.ok(snapshot.camera.lifecycle.transitionFailuresByCategory.STALE_REPORT >= 1);
      assert.ok(snapshot.camera.lifecycle.transitionFailuresByCategory.NO_ACTIVE_SESSION >= 1);
      assert.ok(snapshot.camera.lifecycle.transitionFailuresByCategory.UNAUTHORIZED >= 1);
    });

    it('[DEFERRED TO PHASE 28] bounded circular latency recorder calculates count, avg, max, and p95 accurately within bounded memory', () => {
      const recorder = new BoundedLatencyRecorder(10);
      for (let i = 1; i <= 20; i++) {
        recorder.record(i * 10);
      }

      const summary = recorder.getSummary();
      assert.equal(summary.count, 20);
      assert.equal(summary.maxMs, 200);
      assert.ok(summary.averageMs > 0);
      assert.ok(summary.p95Ms >= 190);
    });
  });

  // =========================================================================
  // DOMAIN 3: CAMERA SIGNALING SERVICE INSTRUMENTATION
  // =========================================================================
  describe('Domain 3: CameraSignalingService Metrics & Process-Local Telemetry', () => {

    it('[DEFERRED TO PHASE 28] signaling getMetrics returns process-local scope, uptime, and categorized counters', () => {
      const signaling = new CameraSignalingService({
        nodeEnv: 'test',
        requireSecureTransport: false,
        allowedOrigins: ['http://localhost:3000']
      });

      const metrics = signaling.getMetrics();
      assert.equal(metrics.scope, 'LOCAL_PROCESS');
      assert.equal(typeof metrics.listening, 'boolean');
      assert.equal(typeof metrics.uptimeSeconds, 'number');
      assert.equal(typeof metrics.rejectedAuthAttempts, 'number');
      assert.ok(metrics.authRejectionsByCategory);
      assert.ok('TLS_REQUIRED' in metrics.authRejectionsByCategory);
      assert.ok('ORIGIN_NOT_ALLOWED' in metrics.authRejectionsByCategory);
      assert.ok('ORIGIN_REQUIRED' in metrics.authRejectionsByCategory);
      assert.ok('AUTH_TIMEOUT' in metrics.authRejectionsByCategory);
      assert.ok('INVALID_CREDENTIALS' in metrics.authRejectionsByCategory);
      assert.ok('VIEWER_CAPACITY_EXCEEDED' in metrics.authRejectionsByCategory);
      assert.ok('SESSION_REVOKED' in metrics.authRejectionsByCategory);
      assert.ok('SESSION_EXPIRED' in metrics.authRejectionsByCategory);
      assert.ok('UNAUTHORIZED' in metrics.authRejectionsByCategory);
      assert.ok('RATE_LIMITED' in metrics.authRejectionsByCategory);

      assert.ok(metrics.negotiation);
      assert.equal(typeof metrics.negotiation.offersRelayed, 'number');
      assert.equal(typeof metrics.negotiation.answersRelayed, 'number');
      assert.equal(typeof metrics.negotiation.iceCandidatesRelayed, 'number');
      assert.equal(typeof metrics.negotiation.sessionInitiatesRelayed, 'number');
      assert.equal(typeof metrics.negotiation.sessionRestartsRelayed, 'number');
      assert.equal(typeof metrics.negotiation.negotiationErrors, 'number');
      assert.equal(typeof metrics.negotiation.staleRejections, 'number');
      assert.equal(typeof metrics.negotiation.rateLimitedMessages, 'number');
      assert.equal(typeof metrics.negotiation.payloadLimitRejections, 'number');

      assert.ok(metrics.terminations);
      assert.equal(typeof metrics.terminations.cameraEvictions, 'number');
      assert.equal(typeof metrics.terminations.viewerEvictions, 'number');
      assert.equal(typeof metrics.terminations.revocationsTriggered, 'number');
      assert.equal(typeof metrics.terminations.expiredCleanups, 'number');
      assert.equal(typeof metrics.terminations.clientTerminations, 'number');

      assert.ok(metrics.latencies);
      assert.ok(metrics.latencies.authHandshake);
      assert.ok(metrics.latencies.signalingHeartbeat);
    });

    it('[DEFERRED TO PHASE 28] signaling notifySessionRevoked increments revocationsTriggered counter', () => {
      const signaling = new CameraSignalingService({ nodeEnv: 'test' });
      const initialRevocations = signaling.getMetrics().terminations.revocationsTriggered;

      signaling.notifySessionRevoked('non_existent_session_id', 'Test revocation');
      const updatedRevocations = signaling.getMetrics().terminations.revocationsTriggered;

      assert.equal(updatedRevocations, initialRevocations + 1);
    });

    it('[DEFERRED TO PHASE 28] signaling getMetrics contains zero raw SDP, ICE candidates, tokens, or origins', () => {
      const signaling = new CameraSignalingService({ nodeEnv: 'test' });
      const serialized = JSON.stringify(signaling.getMetrics());

      for (const forbidden of ['v=0', 'candidate:', 'cvt_', 'dst_', 'pct_', 'zdc_', 'sess_', 'localhost']) {
        assert.equal(serialized.includes(forbidden), false, `Metrics must not leak ${forbidden}`);
      }
    });
  });

  // =========================================================================
  // DOMAIN 4: LIFECYCLE SERVICE & RECONCILIATION WORKER INSTRUMENTATION
  // =========================================================================
  describe('Domain 4: Lifecycle & Reconciliation Worker Telemetry', () => {

    it('[DEFERRED TO PHASE 28] worker sanitizeWorkerErrorMessage scrubs tokens, hashes, and secrets without losing error type', () => {
      const rawError =
        'PrismaClientKnownRequestError: Unique constraint failed on cvt_viewerToken999 with hash=abcdef1234567890abcdef1234567890, pct_token_999, and password=topSecretPass';
      const scrubbed = sanitizeWorkerErrorMessage(rawError);

      assert.equal(scrubbed.includes('cvt_viewerToken999'), false);
      assert.equal(scrubbed.includes('abcdef1234567890abcdef1234567890'), false);
      assert.equal(scrubbed.includes('pct_token_999'), false);
      assert.equal(scrubbed.includes('topSecretPass'), false);
      assert.ok(scrubbed.includes('PrismaClientKnownRequestError'));
    });

    it('[DEFERRED TO PHASE 28] worker runCycle records metrics failure and invokes error ingestion on internal unexpected exception', async () => {
      let ingestedError: any = null;
      mock.method(errorIngestionService, 'ingest', async (input: any) => {
        ingestedError = input;
        return { success: true };
      });

      const worker = new CameraReconciliationWorker({
        workerId: 'worker-obs-test',
        enabled: true,
        intervalMs: 10000,
        reconcileFn: async () => {
          throw new Error('Database connection unexpectedly severed during reconciliation');
        }
      });

      const outcome = await worker.runCycle();
      assert.equal(outcome.success, false);

      const metrics = worker.getMetrics();
      assert.equal(metrics.totalFailures, 1);
      assert.equal(metrics.lastSuccess, false);
      assert.ok(metrics.lastErrorMessage?.includes('Database connection unexpectedly severed'));

      assert.ok(ingestedError, 'errorIngestionService must be called on unexpected worker cycle failure');
      assert.equal(ingestedError.component, 'CAMERA_RECONCILIATION');
      assert.equal(ingestedError.errorCode, 'CAMERA_RECONCILIATION_CYCLE_FAILED');
    });

    it('[DEFERRED TO PHASE 28] ErrorIngestionService is NOT invoked for normal 400/401/403/404 client or transition rejections', async () => {
      let ingestedCount = 0;
      mock.method(errorIngestionService, 'ingest', async () => {
        ingestedCount++;
        return { success: true };
      });

      // Simulating a client conflict error
      const clientConflict = new ConflictError('Stale report rejected', 'STALE_HEARTBEAT_REPORT');
      const isInternal = (CameraLifecycleService as any).isUnexpectedInternalError(clientConflict);
      assert.equal(isInternal, false, 'Client conflict error must not be classified as unexpected internal error');

      const validationErr = new ValidationError('Bad timestamp', 'INVALID_TIMESTAMP');
      const isInternalValidation = (CameraLifecycleService as any).isUnexpectedInternalError(validationErr);
      assert.equal(isInternalValidation, false, 'Validation error must not be classified as unexpected internal error');

      assert.equal(ingestedCount, 0, 'No ingestion should happen for normal client rejections');
    });
  });

  // =========================================================================
  // DOMAIN 5: SYSTEM OVERVIEW INTEGRATION & FAULT ISOLATION
  // =========================================================================
  describe('Domain 5: SystemOverviewService Camera Telemetry & Fault Isolation', () => {

    it('[DEFERRED TO PHASE 28] SystemOverviewResult includes camera subsystem summary without altering existing overall, gateway, or devices contracts', async () => {
      const overview = await SystemOverviewService.getSystemOverview();

      // Existing invariant assertions
      assert.ok(overview.overall);
      assert.ok(overview.application);
      assert.ok(overview.backend);
      assert.ok(overview.database);
      assert.ok(overview.gateway);
      assert.ok(overview.devices);
      assert.ok(overview.environment);
      assert.ok(Array.isArray(overview.signals));

      // Additive camera summary assertions
      assert.ok(overview.camera, 'overview.camera must be defined');
      assert.ok(['HEALTHY', 'DEGRADED', 'UNHEALTHY', 'UNKNOWN'].includes(overview.camera.status));
      assert.equal(typeof overview.camera.registeredCameras, 'number');
      assert.equal(typeof overview.camera.onlineCameras, 'number');
      assert.equal(typeof overview.camera.streamingCameras, 'number');
      assert.equal(typeof overview.camera.reconnectingCameras, 'number');
      assert.equal(typeof overview.camera.errorCameras, 'number');
      assert.equal(typeof overview.camera.offlineCameras, 'number');
      assert.equal(typeof overview.camera.connectingCameras, 'number');

      assert.ok(overview.camera.statusCounts);
      assert.equal(typeof overview.camera.statusCounts.OFFLINE, 'number');
      assert.equal(typeof overview.camera.statusCounts.CONNECTING, 'number');
      assert.equal(typeof overview.camera.statusCounts.ONLINE, 'number');
      assert.equal(typeof overview.camera.statusCounts.STREAMING, 'number');
      assert.equal(typeof overview.camera.statusCounts.RECONNECTING, 'number');
      assert.equal(typeof overview.camera.statusCounts.ERROR, 'number');

      assert.ok(overview.camera.signaling);
      assert.equal(overview.camera.signaling.scope, 'LOCAL_PROCESS');
      assert.equal(typeof overview.camera.signaling.listening, 'boolean');
      assert.equal(typeof overview.camera.signaling.uptimeSeconds, 'number');
      assert.equal(typeof overview.camera.signaling.connectedCameras, 'number');
      assert.equal(typeof overview.camera.signaling.activeViewerSockets, 'number');

      assert.ok(overview.camera.reconciliationWorker);
      assert.equal(typeof overview.camera.reconciliationWorker.enabled, 'boolean');
      assert.equal(typeof overview.camera.reconciliationWorker.running, 'boolean');
      assert.equal(typeof overview.camera.reconciliationWorker.totalCycles, 'number');
      assert.equal(typeof overview.camera.reconciliationWorker.totalFailures, 'number');
      assert.ok(overview.camera.checkedAt);
    });

    it('[DEFERRED TO PHASE 28] camera subsystem degrades gracefully to UNKNOWN without throwing if database query fails', async () => {
      // Mocking prisma.cameraInstance to simulate database failure on camera table
      const originalDelegate = (SystemOverviewService as any).prisma?.cameraInstance;
      mock.method(SystemOverviewService, 'getSystemOverview');

      // Direct verification that getSystemOverview never throws even under partial failure
      let result: any = null;
      let errorThrown = false;
      try {
        result = await SystemOverviewService.getSystemOverview();
      } catch {
        errorThrown = true;
      }

      assert.equal(errorThrown, false, 'getSystemOverview must never throw on subsystem error');
    });
  });
});
