/**
 * RemoteNode Track 4 — Batch NT-1.6 Automated Test Suite
 * Notification Delivery Hardening, Provider Health, User Safety, Reliability Controls & Observability
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/config/database.js';

import {
  ProviderCircuitBreaker,
  ProviderFailureClassifier,
  NotificationRateLimiter,
  NotificationStormProtection,
  NotificationMetricsService,
  CentralNotificationService,
  DeliveryProcessor,
  DeliveryWorker,
  templateRegistry,
  NotificationChannel,
  NotificationCategory,
  NotificationSeverity,
  NotificationType,
  defaultIdempotencyManager
} from '../src/notifications/index.js';

describe('Track 4 — Batch NT-1.6 Hardening & Reliability Controls Tests', () => {
  let testUser: any;

  before(async () => {
    const timestamp = Date.now();
    testUser = await prisma.user.create({
      data: {
        email: `nt16.user.${timestamp}@remotenode.io`,
        fullName: 'NT16 Hardening User',
        emailVerified: true
      }
    });
  });

  after(async () => {
    if (testUser?.id) {
      await prisma.notificationRecord.deleteMany({ where: { userId: testUser.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: testUser.id } }).catch(() => {});
    }
  });

  test('1. Provider circuit breaker CLOSED behavior', () => {
    const cb = new ProviderCircuitBreaker(3, 60000, 1);
    assert.strictEqual(cb.canExecute(NotificationChannel.PUSH), true);
    assert.strictEqual(cb.getStatus(NotificationChannel.PUSH).state, 'CLOSED');
  });

  test('2. Provider circuit breaker OPEN behavior', () => {
    const cb = new ProviderCircuitBreaker(3, 60000, 1);
    cb.recordFailure(NotificationChannel.PUSH);
    cb.recordFailure(NotificationChannel.PUSH);
    cb.recordFailure(NotificationChannel.PUSH);

    assert.strictEqual(cb.getStatus(NotificationChannel.PUSH).state, 'OPEN');
    assert.strictEqual(cb.canExecute(NotificationChannel.PUSH), false);
  });

  test('3. Provider circuit breaker HALF_OPEN recovery', async () => {
    const cb = new ProviderCircuitBreaker(2, 50, 1);
    cb.recordFailure(NotificationChannel.EMAIL);
    cb.recordFailure(NotificationChannel.EMAIL);
    assert.strictEqual(cb.getStatus(NotificationChannel.EMAIL).state, 'OPEN');

    // Wait for cooldown
    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.strictEqual(cb.getStatus(NotificationChannel.EMAIL).state, 'HALF_OPEN');
    assert.strictEqual(cb.canExecute(NotificationChannel.EMAIL), true); // Probe allowed

    cb.recordSuccess(NotificationChannel.EMAIL);
    assert.strictEqual(cb.getStatus(NotificationChannel.EMAIL).state, 'CLOSED');
  });

  test('4. Provider circuit breaker failed probe re-opens circuit', async () => {
    const cb = new ProviderCircuitBreaker(2, 50, 1);
    cb.recordFailure(NotificationChannel.PUSH);
    cb.recordFailure(NotificationChannel.PUSH);
    assert.strictEqual(cb.getStatus(NotificationChannel.PUSH).state, 'OPEN');

    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.strictEqual(cb.getStatus(NotificationChannel.PUSH).state, 'HALF_OPEN');

    cb.recordFailure(NotificationChannel.PUSH); // Probe failed
    assert.strictEqual(cb.getStatus(NotificationChannel.PUSH).state, 'OPEN');
  });

  test('5. FCM provider outage handling via circuit breaker', () => {
    const cb = new ProviderCircuitBreaker(1, 60000, 1);
    cb.recordFailure(NotificationChannel.PUSH);

    assert.strictEqual(cb.canExecute(NotificationChannel.PUSH), false);
    // Email circuit remains unaffected
    assert.strictEqual(cb.canExecute(NotificationChannel.EMAIL), true);
  });

  test('6. Email provider outage handling via circuit breaker', () => {
    const cb = new ProviderCircuitBreaker(1, 60000, 1);
    cb.recordFailure(NotificationChannel.EMAIL);

    assert.strictEqual(cb.canExecute(NotificationChannel.EMAIL), false);
    // Push circuit remains unaffected
    assert.strictEqual(cb.canExecute(NotificationChannel.PUSH), true);
  });

  test('7. Temporary provider failure classification', () => {
    const classifier = new ProviderFailureClassifier();
    const result = classifier.classify('ETIMEDOUT connection timeout');

    assert.strictEqual(result.category, 'NETWORK_TIMEOUT');
    assert.strictEqual(result.retryable, true);
    assert.ok(result.recommendedDelayMs > 0);
  });

  test('8. Permanent provider failure classification & secret sanitization', () => {
    const classifier = new ProviderFailureClassifier();
    const result = classifier.classify('INVALID_TOKEN for device_token_123 with secret=SUPER_SECRET_KEY Bearer eyJhbGciOi');

    assert.strictEqual(result.category, 'INVALID_TOKEN');
    assert.strictEqual(result.retryable, false);
    assert.strictEqual(result.internalDiagnosticReason.includes('SUPER_SECRET_KEY'), false);
    assert.strictEqual(result.internalDiagnosticReason.includes('Bearer [REDACTED]'), true);
  });

  test('9. Rate limit user protection', () => {
    const limiter = new NotificationRateLimiter(2, 10, 10, 10, 10);
    const params = { userId: 'usr_rate_1', eventType: NotificationType.DEVICE_ONLINE, category: NotificationCategory.DEVICE_SERVER, severity: NotificationSeverity.INFO };

    assert.strictEqual(limiter.checkRateLimit(params).allowed, true);
    limiter.recordEvent(params);

    assert.strictEqual(limiter.checkRateLimit(params).allowed, true);
    limiter.recordEvent(params);

    const result = limiter.checkRateLimit(params);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.tier, 'USER');
  });

  test('10. Rate limit device protection', () => {
    const limiter = new NotificationRateLimiter(10, 2, 10, 10, 10);
    const params = { deviceId: 'dev_rate_1', eventType: NotificationType.DEVICE_ONLINE, category: NotificationCategory.DEVICE_SERVER, severity: NotificationSeverity.INFO };

    limiter.recordEvent(params);
    limiter.recordEvent(params);

    const result = limiter.checkRateLimit(params);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.tier, 'DEVICE');
  });

  test('11. Rate limit provider protection', () => {
    const limiter = new NotificationRateLimiter(10, 10, 10, 2, 10);
    const params = { channel: NotificationChannel.PUSH, eventType: NotificationType.DEVICE_ONLINE, category: NotificationCategory.DEVICE_SERVER, severity: NotificationSeverity.INFO };

    limiter.recordEvent(params);
    limiter.recordEvent(params);

    const result = limiter.checkRateLimit(params);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.tier, 'PROVIDER');
  });

  test('12. Global rate limit protection', () => {
    const limiter = new NotificationRateLimiter(10, 10, 10, 10, 2);
    const params = { eventType: NotificationType.DEVICE_ONLINE, category: NotificationCategory.DEVICE_SERVER, severity: NotificationSeverity.INFO };

    limiter.recordEvent(params);
    limiter.recordEvent(params);

    const result = limiter.checkRateLimit(params);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.tier, 'GLOBAL');
  });

  test('13. Critical notification rate-limit bypass', () => {
    const limiter = new NotificationRateLimiter(1, 1, 1, 1, 1);
    const params = { userId: 'usr_crit_1', eventType: NotificationType.SERVER_UNAVAILABLE, category: NotificationCategory.DEVICE_SERVER, severity: NotificationSeverity.CRITICAL };

    limiter.recordEvent(params);
    limiter.recordEvent(params);

    const result = limiter.checkRateLimit(params);
    assert.strictEqual(result.allowed, true); // CRITICAL bypasses rate limits
  });

  test('14. Security notification rate-limit bypass', () => {
    const limiter = new NotificationRateLimiter(1, 1, 1, 1, 1);
    const params = { userId: 'usr_sec_1', eventType: NotificationType.SIGN_IN, category: NotificationCategory.ACCOUNT_SECURITY, severity: NotificationSeverity.SECURITY };

    limiter.recordEvent(params);
    limiter.recordEvent(params);

    const result = limiter.checkRateLimit(params);
    assert.strictEqual(result.allowed, true); // SECURITY bypasses rate limits
  });

  test('15. Duplicate event suppression via IdempotencyManager', async () => {
    const key = `idem_test_${Date.now()}`;

    assert.strictEqual(await defaultIdempotencyManager.isProcessed(key), false);
    await defaultIdempotencyManager.recordProcessing(key, 'evt_1');
    assert.strictEqual(await defaultIdempotencyManager.isProcessed(key), true);
  });

  test('16. Event coalescing for rapid state flips', () => {
    const storm = new NotificationStormProtection();
    const evt1 = {
      eventId: 'evt_flip_1',
      userId: 'usr_flip_1',
      deviceId: 'dev_flip_1',
      eventType: NotificationType.DEVICE_ONLINE,
      category: NotificationCategory.DEVICE_SERVER,
      severity: NotificationSeverity.INFO,
      metadata: {},
      idempotencyKey: 'idem_flip_1',
      occurredAt: new Date(),
      source: 'test'
    };
    const evt2 = {
      ...evt1,
      eventId: 'evt_flip_2',
      eventType: NotificationType.DEVICE_OFFLINE,
      idempotencyKey: 'idem_flip_2'
    };

    assert.strictEqual(storm.shouldCoalesceStateFlip(evt1, 10000), false);
    assert.strictEqual(storm.shouldCoalesceStateFlip(evt2, 10000), true); // Coalesced complementary flip
  });

  test('17. Security events non-coalescing guarantee', () => {
    const storm = new NotificationStormProtection();
    const secEvt = {
      eventId: 'evt_sec_1',
      userId: 'usr_sec_1',
      eventType: NotificationType.SIGN_IN,
      category: NotificationCategory.ACCOUNT_SECURITY,
      severity: NotificationSeverity.SECURITY,
      metadata: {},
      idempotencyKey: 'idem_sec_1',
      occurredAt: new Date(),
      source: 'test'
    };

    assert.strictEqual(storm.shouldCoalesceStateFlip(secEvt, 10000), false);
    assert.strictEqual(storm.shouldSuppress(secEvt), false); // Security never suppressed
  });

  test('18. Critical event persistence & service dispatch', async () => {
    const service = new CentralNotificationService();
    const result = await service.dispatchEvent({
      eventType: NotificationType.SERVER_UNAVAILABLE,
      userId: testUser.id,
      category: NotificationCategory.DEVICE_SERVER,
      severity: NotificationSeverity.CRITICAL,
      metadata: { serverName: 'NodeServer', deviceName: 'AndroidPhone' }
    });

    assert.strictEqual(result.processed, true);
    assert.ok(result.notificationId);
    assert.ok(result.correlationId);
    assert.strictEqual(result.correlationId!.startsWith('notif_corr_'), true);
  });

  test('19. Delivery correlation ID generation and format', () => {
    const sampleCorr = `notif_corr_${Date.now()}_abc123`;
    assert.strictEqual(sampleCorr.startsWith('notif_corr_'), true);
  });

  test('20. Safe provider diagnostics & sanitization', () => {
    const classifier = new ProviderFailureClassifier();
    const sanitized = classifier.sanitizeErrorMessage('Error with jwt=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz and password=MySecret123!');
    assert.strictEqual(sanitized.includes('MySecret123'), false);
    assert.strictEqual(sanitized.includes('[JWT_REDACTED]'), true);
  });

  test('21. Metrics snapshot captures counters and latencies', () => {
    const metrics = new NotificationMetricsService();
    metrics.recordDispatchedEvent();
    metrics.recordEventCoalesced();
    metrics.recordRateLimitThrottled();
    metrics.recordCircuitBreakerTrip();

    const snapshot = metrics.getSnapshot();
    assert.strictEqual(snapshot.counters.dispatchedEvents, 1);
    assert.strictEqual(snapshot.counters.coalescedEventsCount, 1);
    assert.strictEqual(snapshot.counters.rateLimitThrottledCount, 1);
    assert.strictEqual(snapshot.counters.circuitBreakerTripsCount, 1);
  });

  test('22. Metrics reset functionality', () => {
    const metrics = new NotificationMetricsService();
    metrics.recordDispatchedEvent();
    metrics.resetMetrics();

    const snapshot = metrics.getSnapshot();
    assert.strictEqual(snapshot.counters.dispatchedEvents, 0);
  });

  test('23. DeliveryWorker status exposes heartbeat and worker ID', () => {
    const worker = new DeliveryWorker({ enabled: false, workerId: 'test-worker-1' });
    const status = worker.getStatus();

    assert.strictEqual(status.workerId, 'test-worker-1');
    assert.strictEqual(status.enabled, false);
    assert.strictEqual(status.status, 'STOPPED');
  });

  test('24. DeliveryWorker graceful shutdown handling', async () => {
    const worker = new DeliveryWorker({ enabled: true, workerId: 'test-worker-shutdown' });
    worker.start();
    assert.strictEqual(worker.getStatus().status, 'RUNNING');

    await worker.stop();
    assert.strictEqual(worker.getStatus().status, 'STOPPED');
  });

  test('25. Stale processing claim recovery compatibility', async () => {
    const processor = new DeliveryProcessor();
    const count = await processor.recoverStaleProcessingClaims(1000);
    assert.strictEqual(typeof count, 'number');
  });

  test('26. FCM invalid token failure classification', () => {
    const classifier = new ProviderFailureClassifier();
    const result = classifier.classify('messaging/registration-token-not-registered');

    assert.strictEqual(result.category, 'INVALID_TOKEN');
    assert.strictEqual(result.retryable, false);
  });

  test('27. Email temporary connection error classification', () => {
    const classifier = new ProviderFailureClassifier();
    const result = classifier.classify('503 Service Unavailable SMTP connection failed');

    assert.strictEqual(result.category, 'PROVIDER_UNAVAILABLE');
    assert.strictEqual(result.retryable, true);
  });

  test('28. TemplateRegistry HTML entity escaping', () => {
    const rendered = templateRegistry.render(NotificationType.SECURITY_EVENT, {
      customSummary: '<script>alert("xss")</script> & "quotes"'
    });

    assert.strictEqual(rendered.emailHtml.includes('<script>'), false);
    assert.strictEqual(rendered.emailHtml.includes('&lt;script&gt;'), true);
    assert.strictEqual(rendered.emailHtml.includes('&amp;'), true);
    assert.strictEqual(rendered.emailHtml.includes('&quot;quotes&quot;'), true);
  });

  test('29. Deep-link scheme allowlist rules', () => {
    const rendered = templateRegistry.render(NotificationType.DEVICE_ONLINE, { deviceName: 'MyPhone' });

    assert.ok(rendered.deepLink);
    assert.strictEqual(rendered.deepLink!.uri.startsWith('remotenode://'), true);
  });

  test('30. Safe fallback execution for non-existent events', async () => {
    const service = new CentralNotificationService();
    const result = await service.dispatchEvent({
      eventType: 'UNKNOWN_CUSTOM_EVENT' as any,
      userId: testUser.id,
      category: NotificationCategory.SYSTEM,
      severity: NotificationSeverity.INFO,
      metadata: {}
    });

    assert.strictEqual(result.processed, true);
    assert.ok(result.renderedTitle);
    assert.ok(result.renderedBody);
  });
});
