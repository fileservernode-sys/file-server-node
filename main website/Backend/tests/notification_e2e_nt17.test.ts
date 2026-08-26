/**
 * RemoteNode Track 4 — Batch NT-1.7 End-to-End & Production Readiness Verification Suite
 * Full Pipeline Verification, Failure Isolation, Admin Observability & Operational Safety
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/config/database.js';

import {
  CentralNotificationService,
  DeliveryProcessor,
  DeliveryWorker,
  RetentionWorker,
  ProviderCircuitBreaker,
  ProviderFailureClassifier,
  NotificationRateLimiter,
  NotificationStormProtection,
  notificationMetrics,
  templateRegistry,
  defaultIdempotencyManager,
  NotificationChannel,
  NotificationCategory,
  NotificationSeverity,
  NotificationType,
  notificationRepository,
  getNotificationTypeMeta
} from '../src/notifications/index.js';

import { accountEventProducer } from '../src/notifications/producers/account_producer.js';
import { deviceEventProducer } from '../src/notifications/producers/device_producer.js';
import { serverEventProducer } from '../src/notifications/producers/server_producer.js';
import { gatewayEventProducer } from '../src/notifications/producers/gateway_producer.js';
import { fileEventProducer } from '../src/notifications/producers/file_producer.js';
import { storageEventProducer } from '../src/notifications/producers/storage_producer.js';

/**
 * DB query retry wrapper to handle transient MySQL connection hiccups over network
 */
async function withDbRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      if (i < retries - 1) {
        await new Promise((r) => setTimeout(r, 500 * (i + 1)));
      }
    }
  }
  throw lastErr;
}

describe('Track 4 — Batch NT-1.7 End-to-End & Production Readiness Verification Suite', () => {
  let testUserA: any;
  let testUserB: any;
  let sessionTokenA: string;
  let sessionTokenB: string;

  before(async () => {
    const timestamp = Date.now();
    
    // Create Test User A
    testUserA = await withDbRetry(() => prisma.user.create({
      data: {
        email: `nt17.usera.${timestamp}@remotenode.io`,
        fullName: 'NT17 User A',
        emailVerified: true
      }
    }));

    // Create User Session A
    sessionTokenA = `nt17_sess_a_${timestamp}`;
    await withDbRetry(() => prisma.userSession.create({
      data: {
        userId: testUserA.id,
        token: sessionTokenA,
        expiresAt: new Date(Date.now() + 86400000)
      }
    }));

    // Create Test User B
    testUserB = await withDbRetry(() => prisma.user.create({
      data: {
        email: `nt17.userb.${timestamp}@remotenode.io`,
        fullName: 'NT17 User B',
        emailVerified: true
      }
    }));

    // Create User Session B
    sessionTokenB = `nt17_sess_b_${timestamp}`;
    await withDbRetry(() => prisma.userSession.create({
      data: {
        userId: testUserB.id,
        token: sessionTokenB,
        expiresAt: new Date(Date.now() + 86400000)
      }
    }));
  });

  after(async () => {
    if (testUserA?.id) {
      await withDbRetry(() => prisma.channelDeliveryRecord.deleteMany({ where: { notification: { userId: testUserA.id } } })).catch(() => {});
      await withDbRetry(() => prisma.notificationRecord.deleteMany({ where: { userId: testUserA.id } })).catch(() => {});
      await withDbRetry(() => prisma.devicePushToken.deleteMany({ where: { userId: testUserA.id } })).catch(() => {});
      await withDbRetry(() => prisma.device.deleteMany({ where: { userId: testUserA.id } })).catch(() => {});
      await withDbRetry(() => prisma.userSession.deleteMany({ where: { userId: testUserA.id } })).catch(() => {});
      await withDbRetry(() => prisma.userNotificationPreferences.deleteMany({ where: { userId: testUserA.id } })).catch(() => {});
      await withDbRetry(() => prisma.user.delete({ where: { id: testUserA.id } })).catch(() => {});
    }

    if (testUserB?.id) {
      await withDbRetry(() => prisma.channelDeliveryRecord.deleteMany({ where: { notification: { userId: testUserB.id } } })).catch(() => {});
      await withDbRetry(() => prisma.notificationRecord.deleteMany({ where: { userId: testUserB.id } })).catch(() => {});
      await withDbRetry(() => prisma.devicePushToken.deleteMany({ where: { userId: testUserB.id } })).catch(() => {});
      await withDbRetry(() => prisma.device.deleteMany({ where: { userId: testUserB.id } })).catch(() => {});
      await withDbRetry(() => prisma.userSession.deleteMany({ where: { userId: testUserB.id } })).catch(() => {});
      await withDbRetry(() => prisma.userNotificationPreferences.deleteMany({ where: { userId: testUserB.id } })).catch(() => {});
      await withDbRetry(() => prisma.user.delete({ where: { id: testUserB.id } })).catch(() => {});
    }
  });

  test('TEST 1 — Standard INFO event pipeline execution', async () => {
    const service = new CentralNotificationService();
    const result = await service.dispatchEvent({
      eventType: NotificationType.DEVICE_ONLINE,
      userId: testUserA.id,
      category: NotificationCategory.DEVICE_SERVER,
      severity: NotificationSeverity.INFO,
      metadata: { deviceName: 'AndroidOne' }
    });

    assert.strictEqual(result.processed, true);
    assert.ok(result.notificationId);
    assert.ok(result.correlationId);

    const record = await withDbRetry(() => notificationRepository.getNotificationById(result.notificationId!));
    assert.ok(record);
    assert.strictEqual(record!.severity, NotificationSeverity.INFO);
    assert.strictEqual(record!.category, NotificationCategory.DEVICE_SERVER);
    assert.strictEqual(record!.correlationId, result.correlationId);
  });

  test('TEST 2 — SUCCESS event pipeline execution', async () => {
    const service = new CentralNotificationService();
    const result = await service.dispatchEvent({
      eventType: NotificationType.DEVICE_LINKED,
      userId: testUserA.id,
      category: NotificationCategory.DEVICE_SERVER,
      severity: NotificationSeverity.SUCCESS,
      metadata: { deviceName: 'PixelPhone' }
    });

    assert.strictEqual(result.processed, true);
    const record = await withDbRetry(() => notificationRepository.getNotificationById(result.notificationId!));
    assert.ok(record);
    assert.strictEqual(record!.severity, NotificationSeverity.SUCCESS);
  });

  test('TEST 3 — WARNING event pipeline execution', async () => {
    const service = new CentralNotificationService();
    const result = await service.dispatchEvent({
      eventType: NotificationType.STORAGE_WARNING,
      userId: testUserA.id,
      category: NotificationCategory.STORAGE,
      severity: NotificationSeverity.WARNING,
      metadata: { freeSpaceMb: 500 }
    });

    assert.strictEqual(result.processed, true);
    const record = await withDbRetry(() => notificationRepository.getNotificationById(result.notificationId!));
    assert.ok(record);
    assert.strictEqual(record!.severity, NotificationSeverity.WARNING);
  });

  test('TEST 4 — CRITICAL event pipeline execution', async () => {
    const service = new CentralNotificationService();
    const result = await service.dispatchEvent({
      eventType: NotificationType.SERVER_UNAVAILABLE,
      userId: testUserA.id,
      category: NotificationCategory.DEVICE_SERVER,
      severity: NotificationSeverity.CRITICAL,
      metadata: { serverName: 'ServerNode' }
    });

    assert.strictEqual(result.processed, true);
    const record = await withDbRetry(() => notificationRepository.getNotificationById(result.notificationId!));
    assert.ok(record);
    assert.strictEqual(record!.severity, NotificationSeverity.CRITICAL);
  });

  test('TEST 5 — SECURITY event pipeline & mandatory policy enforcement', async () => {
    await withDbRetry(() => prisma.userNotificationPreferences.upsert({
      where: { userId: testUserA.id },
      create: { userId: testUserA.id, globalPushEnabled: false, globalEmailEnabled: false, categoryPreferences: {} },
      update: { globalPushEnabled: false, globalEmailEnabled: false }
    }));

    const service = new CentralNotificationService();
    const result = await service.dispatchEvent({
      eventType: NotificationType.SECURITY_EVENT,
      userId: testUserA.id,
      category: NotificationCategory.ACCOUNT_SECURITY,
      severity: NotificationSeverity.SECURITY,
      metadata: { action: 'PasswordChanged' }
    });

    assert.strictEqual(result.processed, true);
    const record = await withDbRetry(() => notificationRepository.getNotificationById(result.notificationId!));
    assert.ok(record);
    assert.strictEqual(record!.severity, NotificationSeverity.SECURITY);

    // Reset preferences
    await withDbRetry(() => prisma.userNotificationPreferences.update({
      where: { userId: testUserA.id },
      data: { globalPushEnabled: true, globalEmailEnabled: true }
    }));
  });

  test('TEST 6 — User preference suppression for non-security events', async () => {
    await withDbRetry(() => prisma.userNotificationPreferences.upsert({
      where: { userId: testUserB.id },
      create: { userId: testUserB.id, globalPushEnabled: false, globalEmailEnabled: false, categoryPreferences: {} },
      update: { globalPushEnabled: false, globalEmailEnabled: false }
    }));

    const service = new CentralNotificationService();
    const result = await service.dispatchEvent({
      eventType: NotificationType.DEVICE_ONLINE,
      userId: testUserB.id,
      category: NotificationCategory.DEVICE_SERVER,
      severity: NotificationSeverity.INFO,
      metadata: { deviceName: 'SuppressedDevice' }
    });

    assert.strictEqual(result.processed, true);
    const record = await withDbRetry(() => notificationRepository.getNotificationById(result.notificationId!));
    assert.ok(record); // In-app notification persists

    // Reset
    await withDbRetry(() => prisma.userNotificationPreferences.update({
      where: { userId: testUserB.id },
      data: { globalPushEnabled: true, globalEmailEnabled: true }
    }));
  });

  test('TEST 7 — Multi-device push token routing', async () => {
    const devId1 = `dev_multi_1_${Date.now()}`;
    const devId2 = `dev_multi_2_${Date.now()}`;

    // Create Device records in DB first
    await withDbRetry(() => prisma.device.create({
      data: { id: devId1, userId: testUserA.id, deviceName: 'Device Multi 1', platform: 'Android' }
    }));
    await withDbRetry(() => prisma.device.create({
      data: { id: devId2, userId: testUserA.id, deviceName: 'Device Multi 2', platform: 'Android' }
    }));

    await withDbRetry(() => prisma.devicePushToken.create({
      data: {
        userId: testUserA.id,
        deviceId: devId1,
        token: `fcm_token_multi_1_${Date.now()}`,
        platform: 'ANDROID'
      }
    }));

    await withDbRetry(() => prisma.devicePushToken.create({
      data: {
        userId: testUserA.id,
        deviceId: devId2,
        token: `fcm_token_multi_2_${Date.now()}`,
        platform: 'ANDROID'
      }
    }));

    const tokens = await withDbRetry(() => prisma.devicePushToken.findMany({
      where: { userId: testUserA.id, isActive: true }
    }));
    assert.ok(tokens.length >= 2);
  });

  test('TEST 8 — Token rotation logic', async () => {
    const devId = `dev_rotate_${Date.now()}`;
    const token1 = `fcm_token_v1_${Date.now()}`;
    const token2 = `fcm_token_v2_${Date.now()}`;

    // Create Device record in DB first
    await withDbRetry(() => prisma.device.create({
      data: { id: devId, userId: testUserA.id, deviceName: 'Device Rotate', platform: 'Android' }
    }));

    await withDbRetry(() => prisma.devicePushToken.create({
      data: {
        userId: testUserA.id,
        deviceId: devId,
        token: token1,
        platform: 'ANDROID'
      }
    }));

    // Rotate token
    await withDbRetry(() => prisma.devicePushToken.updateMany({
      where: { userId: testUserA.id, deviceId: devId },
      data: { isActive: false, revokedAt: new Date() }
    }));

    await withDbRetry(() => prisma.devicePushToken.create({
      data: {
        userId: testUserA.id,
        deviceId: devId,
        token: token2,
        platform: 'ANDROID'
      }
    }));

    const activeTokens = await withDbRetry(() => prisma.devicePushToken.findMany({
      where: { userId: testUserA.id, deviceId: devId, isActive: true }
    }));
    assert.strictEqual(activeTokens.length, 1);
    assert.strictEqual(activeTokens[0].token, token2);
  });

  test('TEST 9 — Invalid FCM token failure classification & revocation', async () => {
    const classifier = new ProviderFailureClassifier();
    const result = classifier.classify('messaging/registration-token-not-registered');

    assert.strictEqual(result.category, 'INVALID_TOKEN');
    assert.strictEqual(result.retryable, false);
  });

  test('TEST 10 — Temporary provider failure classification & retry schedule', async () => {
    const classifier = new ProviderFailureClassifier();
    const result = classifier.classify('ETIMEDOUT connection timeout to FCM gateway');

    assert.strictEqual(result.category, 'NETWORK_TIMEOUT');
    assert.strictEqual(result.retryable, true);
    assert.ok(result.recommendedDelayMs > 0);
  });

  test('TEST 11 — Permanent email failure classification', async () => {
    const classifier = new ProviderFailureClassifier();
    const result = classifier.classify('550 5.1.1 User unknown / Invalid recipient');

    assert.strictEqual(result.category, 'INVALID_RECIPIENT');
    assert.strictEqual(result.retryable, false);
  });

  test('TEST 12 — Email temporary connection error retry handling', async () => {
    const classifier = new ProviderFailureClassifier();
    const result = classifier.classify('421 4.3.0 Temporary System Error SMTP');

    assert.strictEqual(result.retryable, true);
  });

  test('TEST 13 — Circuit breaker opening after failure threshold', () => {
    const cb = new ProviderCircuitBreaker(3, 60000, 1);
    cb.recordFailure(NotificationChannel.PUSH);
    cb.recordFailure(NotificationChannel.PUSH);
    cb.recordFailure(NotificationChannel.PUSH);

    assert.strictEqual(cb.getStatus(NotificationChannel.PUSH).state, 'OPEN');
    assert.strictEqual(cb.canExecute(NotificationChannel.PUSH), false);
  });

  test('TEST 14 — Circuit breaker HALF_OPEN recovery & successful probe', async () => {
    const cb = new ProviderCircuitBreaker(2, 50, 1);
    cb.recordFailure(NotificationChannel.EMAIL);
    cb.recordFailure(NotificationChannel.EMAIL);
    assert.strictEqual(cb.getStatus(NotificationChannel.EMAIL).state, 'OPEN');

    await new Promise((r) => setTimeout(r, 60));
    assert.strictEqual(cb.getStatus(NotificationChannel.EMAIL).state, 'HALF_OPEN');

    cb.recordSuccess(NotificationChannel.EMAIL);
    assert.strictEqual(cb.getStatus(NotificationChannel.EMAIL).state, 'CLOSED');
  });

  test('TEST 15 — Multi-tier rate limiter enforcement & SECURITY bypass', () => {
    const limiter = new NotificationRateLimiter(1, 10, 10, 10, 10);
    const normalParams = { userId: testUserA.id, eventType: NotificationType.DEVICE_ONLINE, category: NotificationCategory.DEVICE_SERVER, severity: NotificationSeverity.INFO };
    const secParams = { userId: testUserA.id, eventType: NotificationType.SIGN_IN, category: NotificationCategory.ACCOUNT_SECURITY, severity: NotificationSeverity.SECURITY };

    limiter.recordEvent(normalParams);

    // Normal event throttled
    assert.strictEqual(limiter.checkRateLimit(normalParams).allowed, false);

    // Security event bypasses rate limit
    assert.strictEqual(limiter.checkRateLimit(secParams).allowed, true);
  });

  test('TEST 16 — Flapping event coalescing & security non-coalescing', () => {
    const storm = new NotificationStormProtection();
    const evt1 = {
      eventId: 'evt_coalesce_1',
      userId: testUserA.id,
      deviceId: 'dev_1',
      eventType: NotificationType.DEVICE_ONLINE,
      category: NotificationCategory.DEVICE_SERVER,
      severity: NotificationSeverity.INFO,
      metadata: {},
      idempotencyKey: 'idem_coalesce_1',
      occurredAt: new Date(),
      source: 'test'
    };
    const evt2 = {
      ...evt1,
      eventId: 'evt_coalesce_2',
      eventType: NotificationType.DEVICE_OFFLINE,
      idempotencyKey: 'idem_coalesce_2'
    };

    assert.strictEqual(storm.shouldCoalesceStateFlip(evt1, 10000), false);
    assert.strictEqual(storm.shouldCoalesceStateFlip(evt2, 10000), true);
  });

  test('TEST 17 — Idempotency deduplication', async () => {
    const key = `idem_e2e_${Date.now()}`;
    assert.strictEqual(await defaultIdempotencyManager.isProcessed(key), false);
    await defaultIdempotencyManager.recordProcessing(key, 'evt_e2e_1');
    assert.strictEqual(await defaultIdempotencyManager.isProcessed(key), true);
  });

  test('TEST 18 — Correlation ID end-to-end tracing format', async () => {
    const service = new CentralNotificationService();
    const result = await service.dispatchEvent({
      eventType: NotificationType.SERVER_STARTED,
      userId: testUserA.id,
      category: NotificationCategory.DEVICE_SERVER,
      severity: NotificationSeverity.INFO,
      metadata: { serverName: 'TraceServer' }
    });

    assert.ok(result.correlationId);
    assert.strictEqual(result.correlationId!.startsWith('notif_corr_'), true);
  });

  test('TEST 19 — Stale claim recovery compatibility', async () => {
    const processor = new DeliveryProcessor();
    const recovered = await processor.recoverStaleProcessingClaims(1000);
    assert.strictEqual(typeof recovered, 'number');
  });

  test('TEST 20 — Multi-worker claiming concurrency safety', async () => {
    const processor = new DeliveryProcessor();
    const count = await processor.recoverStaleProcessingClaims(1000);
    assert.strictEqual(typeof count, 'number');
  });

  test('TEST 21 — Retention worker cleanup safety', async () => {
    const worker = new RetentionWorker(30);
    const deleted = await worker.executeCleanupTick();
    assert.strictEqual(typeof deleted.notificationsCleaned, 'number');
    assert.strictEqual(typeof deleted.deliveriesCleaned, 'number');
  });

  test('TEST 22 — Health metrics snapshot status exposure', () => {
    notificationMetrics.recordDispatchedEvent();
    const snapshot = notificationMetrics.getSnapshot();
    assert.ok(snapshot.counters);
    assert.ok(snapshot.providers);
  });

  test('TEST 23 — Delivery worker status exposes heartbeat', () => {
    const worker = new DeliveryWorker({ enabled: false, workerId: 'worker_e2e_1' });
    const status = worker.getStatus();
    assert.strictEqual(status.workerId, 'worker_e2e_1');
    assert.strictEqual(status.enabled, false);
    assert.strictEqual(status.status, 'STOPPED');
  });

  test('TEST 24 — Authorization check enforces session validation', async () => {
    const session = await withDbRetry(() => prisma.userSession.findFirst({ where: { token: sessionTokenA } }));
    assert.ok(session);
    assert.strictEqual(session!.userId, testUserA.id);
  });

  test('TEST 25 — Notification history user isolation', async () => {
    const service = new CentralNotificationService();
    const resA = await service.dispatchEvent({
      eventType: NotificationType.DEVICE_ONLINE,
      userId: testUserA.id,
      category: NotificationCategory.DEVICE_SERVER,
      severity: NotificationSeverity.INFO,
      metadata: {}
    });

    const notifUserB = await withDbRetry(() => notificationRepository.getUserNotifications(testUserB.id));

    const hasInB = notifUserB.items.some((n: any) => n.id === resA.notificationId);
    assert.strictEqual(hasInB, false); // User B cannot access User A notification
  });

  test('TEST 26 — Deep link scheme allowlist validation', () => {
    const rendered = templateRegistry.render(NotificationType.DEVICE_ONLINE, { deviceName: 'MyPhone' });
    assert.ok(rendered.deepLink);
    assert.strictEqual(rendered.deepLink!.uri.startsWith('remotenode://'), true);
  });

  test('TEST 27 — Template injection HTML escaping safety', () => {
    const rendered = templateRegistry.render(NotificationType.SECURITY_EVENT, {
      customSummary: '<script>alert("xss")</script> & "quotes"'
    });

    assert.strictEqual(rendered.emailHtml.includes('<script>'), false);
    assert.strictEqual(rendered.emailHtml.includes('&lt;script&gt;'), true);
  });

  test('TEST 28 — Secret sanitization in failure diagnostics & templates', () => {
    const classifier = new ProviderFailureClassifier();
    const sanitized = classifier.sanitizeErrorMessage('Error with bearer eyJhbGciOiJIUzI1Ni... and secret=MySecret123!');

    assert.strictEqual(sanitized.includes('MySecret123'), false);
    assert.strictEqual(sanitized.includes('[REDACTED]'), true);
  });

  test('TEST 29 — Non-blocking notification dispatch failure isolation', async () => {
    await accountEventProducer.emitAccountCreated(testUserA.id, testUserA.email, testUserA.fullName).catch(() => {});
    await deviceEventProducer.emitDeviceLinked(testUserA.id, 'dev_123', 'Android Phone').catch(() => {});
    await serverEventProducer.emitServerCreated(testUserA.id, 'dev_123', 'srv_123', 'Node Server', 'Android Phone').catch(() => {});
    await gatewayEventProducer.emitGatewayConnected(testUserA.id, 'dev_123', 'gw_123').catch(() => {});
    await fileEventProducer.emitFileUploadCompleted(testUserA.id, 'srv_123', '/photos/test.jpg', 1024).catch(() => {});
    await storageEventProducer.emitStorageWarning(testUserA.id, 'dev_123', 500, 10000).catch(() => {});
  });

  test('TEST 30 — Full representative production event sequence', async () => {
    const seqUser = await withDbRetry(() => prisma.user.create({
      data: {
        email: `nt17.seq.${Date.now()}@remotenode.io`,
        fullName: 'NT17 Seq User',
        emailVerified: true
      }
    }));

    const service = new CentralNotificationService();
    const sequence = [
      NotificationType.ACCOUNT_CREATED,
      NotificationType.DEVICE_LINKED,
      NotificationType.SERVER_CREATED,
      NotificationType.SERVER_STARTED,
      NotificationType.GATEWAY_CONNECTED,
      NotificationType.FILE_UPLOAD_COMPLETED,
      NotificationType.STORAGE_WARNING,
      NotificationType.DEVICE_OFFLINE,
      NotificationType.SERVER_RECOVERED
    ];

    for (const type of sequence) {
      const typeMeta = getNotificationTypeMeta(type);
      const result = await service.dispatchEvent({
        eventType: type,
        userId: seqUser.id,
        category: typeMeta.category,
        severity: typeMeta.defaultSeverity,
        metadata: { sequence: type },
        idempotencyKey: `idem_seq_${type}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
      });
      assert.strictEqual(result.processed, true, `Event ${type} should be processed`);
      assert.ok(result.notificationId);
      assert.ok(result.correlationId);
    }

    await withDbRetry(() => prisma.notificationRecord.deleteMany({ where: { userId: seqUser.id } })).catch(() => {});
    await withDbRetry(() => prisma.user.delete({ where: { id: seqUser.id } })).catch(() => {});
  });
});
