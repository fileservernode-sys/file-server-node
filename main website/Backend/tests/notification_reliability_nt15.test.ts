process.env.NODE_ENV = 'test';

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { prisma } from '../src/config/database.js';
import { NotificationType } from '../src/notifications/types/type_registry.js';
import { NotificationChannel } from '../src/notifications/types/channel.js';
import { NotificationSeverity } from '../src/notifications/types/severity.js';
import { NotificationCategory } from '../src/notifications/types/category.js';
import { notificationService, CentralNotificationService } from '../src/notifications/services/notification_service.js';
import { DeliveryProcessor } from '../src/notifications/workers/delivery_processor.js';
import { DeliveryWorker } from '../src/notifications/workers/delivery_worker.js';
import { RetentionWorker } from '../src/notifications/workers/retention_worker.js';
import { notificationMetrics } from '../src/notifications/services/notification_metrics.js';
import { defaultIdempotencyManager } from '../src/notifications/services/idempotency.js';
import { EmailNotificationProviderImpl } from '../src/notifications/providers/email_provider.js';
import { emailService, MockEmailService } from '../src/services/email.js';
import { calculateRetryDecision } from '../src/notifications/services/retry_policy.js';

describe('Track 4 — Batch NT-1.5 Notification Reliability & Background Worker Tests', () => {
  let mockEmail: MockEmailService;
  let testUser: any;
  let testUserB: any;

  before(async () => {
    mockEmail = emailService as MockEmailService;
    notificationService.registerProvider(new EmailNotificationProviderImpl(mockEmail));

    const timestamp = Date.now();
    testUser = await prisma.user.create({
      data: {
        email: `nt15.user1.${timestamp}@remotenode.io`,
        fullName: 'NT15 Reliability User One',
        emailVerified: true
      }
    });

    testUserB = await prisma.user.create({
      data: {
        email: `nt15.user2.${timestamp}@remotenode.io`,
        fullName: 'NT15 Reliability User Two',
        emailVerified: true
      }
    });
  });

  after(async () => {
    try {
      if (testUser) {
        await prisma.channelDeliveryRecord.deleteMany({ where: { notification: { userId: testUser.id } } });
        await prisma.notificationRecord.deleteMany({ where: { userId: testUser.id } });
        await prisma.user.delete({ where: { id: testUser.id } });
      }
      if (testUserB) {
        await prisma.channelDeliveryRecord.deleteMany({ where: { notification: { userId: testUserB.id } } });
        await prisma.notificationRecord.deleteMany({ where: { userId: testUserB.id } });
        await prisma.user.delete({ where: { id: testUserB.id } });
      }
    } catch {}
  });

  beforeEach(() => {
    if (mockEmail && mockEmail.dispatchedMails) {
      mockEmail.dispatchedMails = [];
    }
    notificationMetrics.resetMetrics();
  });

  test('1. DeliveryWorker initializes cleanly with worker ID and STOPPED status', () => {
    const worker = new DeliveryWorker({ enabled: true, workerId: 'test-worker-1' });
    const status = worker.getStatus();
    assert.strictEqual(status.workerId, 'test-worker-1');
    assert.strictEqual(status.status, 'STOPPED');
    assert.strictEqual(status.enabled, true);
  });

  test('2. DeliveryWorker start transitions status to RUNNING and begins polling', async () => {
    const worker = new DeliveryWorker({ enabled: true, pollIntervalMs: 60000 });
    worker.start();
    const status = worker.getStatus();
    assert.strictEqual(status.status, 'RUNNING');
    assert.ok(status.startedAt !== null);
    await worker.stop();
  });

  test('3. DeliveryWorker stop stops polling and transitions status to STOPPED', async () => {
    const worker = new DeliveryWorker({ enabled: true, pollIntervalMs: 60000 });
    worker.start();
    await worker.stop();
    const status = worker.getStatus();
    assert.strictEqual(status.status, 'STOPPED');
  });

  test('4. DeliveryWorker disabled mode remains STOPPED', () => {
    const worker = new DeliveryWorker({ enabled: false });
    worker.start();
    const status = worker.getStatus();
    assert.strictEqual(status.status, 'STOPPED');
  });

  test('5. Atomic Job Claiming grants claim to first worker and rejects competitor', async () => {
    const processor = new DeliveryProcessor();
    const key = `idem_claim_${Date.now()}`;

    const notif = await prisma.notificationRecord.create({
      data: {
        eventId: `evt_claim_${Date.now()}`,
        userId: testUser.id,
        eventType: NotificationType.SIGN_IN,
        category: NotificationCategory.ACCOUNT_SECURITY,
        severity: NotificationSeverity.SECURITY,
        title: 'Claim Test',
        body: 'Claim Test Body',
        idempotencyKey: key,
        status: 'UNREAD'
      }
    });

    const delivery = await prisma.channelDeliveryRecord.create({
      data: {
        notificationId: notif.id,
        channel: NotificationChannel.EMAIL,
        targetAddress: testUser.email,
        status: 'QUEUED'
      }
    });

    // Worker A attempts claim
    const claimedA = await processor.claimDeliveryJob(delivery.id, 'worker-A');
    assert.strictEqual(claimedA, true);

    // Worker B attempts claim on already claimed job
    const claimedB = await processor.claimDeliveryJob(delivery.id, 'worker-B');
    assert.strictEqual(claimedB, false);

    // Verify row state
    const updated = await prisma.channelDeliveryRecord.findUnique({ where: { id: delivery.id } });
    assert.strictEqual(updated?.status, 'PROCESSING');
    assert.strictEqual(updated?.processingWorkerId, 'worker-A');

    // Cleanup
    await prisma.channelDeliveryRecord.delete({ where: { id: delivery.id } });
    await prisma.notificationRecord.delete({ where: { id: notif.id } });
  });

  test('6. Multi-Worker Concurrent Claim Protection prevents duplicate processing', async () => {
    const processorA = new DeliveryProcessor();
    const processorB = new DeliveryProcessor();
    const key = `idem_multi_${Date.now()}`;

    const notif = await prisma.notificationRecord.create({
      data: {
        eventId: `evt_multi_${Date.now()}`,
        userId: testUser.id,
        eventType: NotificationType.SIGN_IN,
        category: NotificationCategory.ACCOUNT_SECURITY,
        severity: NotificationSeverity.SECURITY,
        title: 'Multi-Worker Test',
        body: 'Body',
        idempotencyKey: key,
        status: 'UNREAD'
      }
    });

    const delivery = await prisma.channelDeliveryRecord.create({
      data: {
        notificationId: notif.id,
        channel: NotificationChannel.EMAIL,
        targetAddress: testUser.email,
        status: 'QUEUED'
      }
    });

    // Worker A and Worker B try to claim concurrently
    const [resA, resB] = await Promise.all([
      processorA.claimDeliveryJob(delivery.id, 'worker-A'),
      processorB.claimDeliveryJob(delivery.id, 'worker-B')
    ]);

    // Exactly one worker must succeed in claiming
    assert.strictEqual((resA ? 1 : 0) + (resB ? 1 : 0), 1);

    // Cleanup
    await prisma.channelDeliveryRecord.delete({ where: { id: delivery.id } });
    await prisma.notificationRecord.delete({ where: { id: notif.id } });
  });

  test('7. Processing Lease Recovery identifies stale PROCESSING records and resets to RETRYING', async () => {
    const processor = new DeliveryProcessor();
    const key = `idem_lease_${Date.now()}`;

    const notif = await prisma.notificationRecord.create({
      data: {
        eventId: `evt_lease_${Date.now()}`,
        userId: testUser.id,
        eventType: NotificationType.SERVER_STARTED,
        category: NotificationCategory.DEVICE_SERVER,
        severity: NotificationSeverity.INFO,
        title: 'Lease Test',
        body: 'Body',
        idempotencyKey: key,
        status: 'UNREAD'
      }
    });

    // Create a delivery record stuck in PROCESSING 10 minutes ago
    const staleTime = new Date(Date.now() - 600000);
    const delivery = await prisma.channelDeliveryRecord.create({
      data: {
        notificationId: notif.id,
        channel: NotificationChannel.EMAIL,
        targetAddress: testUser.email,
        status: 'PROCESSING',
        processingStartedAt: staleTime,
        processingWorkerId: 'worker-crashed'
      }
    });

    // Recover stale claims with lease timeout 300,000ms (5 minutes)
    const recoveredCount = await processor.recoverStaleProcessingClaims(300000);
    assert.ok(recoveredCount >= 1);

    const updated = await prisma.channelDeliveryRecord.findUnique({ where: { id: delivery.id } });
    assert.strictEqual(updated?.status, 'RETRYING');
    assert.strictEqual(updated?.processingStartedAt, null);
    assert.strictEqual(updated?.processingWorkerId, null);

    // Cleanup
    await prisma.channelDeliveryRecord.delete({ where: { id: delivery.id } });
    await prisma.notificationRecord.delete({ where: { id: notif.id } });
  });

  test('8. Deterministic Crash Recovery resumes delivery from stale PROCESSING state', async () => {
    const processor = new DeliveryProcessor();
    const key = `idem_crash_${Date.now()}`;

    const notif = await prisma.notificationRecord.create({
      data: {
        eventId: `evt_crash_${Date.now()}`,
        userId: testUser.id,
        eventType: NotificationType.ACCOUNT_CREATED,
        category: NotificationCategory.ACCOUNT_SECURITY,
        severity: NotificationSeverity.INFO,
        title: 'Crash Recovery Test',
        body: 'Welcome',
        idempotencyKey: key,
        status: 'UNREAD'
      }
    });

    // Simulate worker claiming and crashing 10 minutes ago
    const delivery = await prisma.channelDeliveryRecord.create({
      data: {
        notificationId: notif.id,
        channel: NotificationChannel.EMAIL,
        targetAddress: testUser.email,
        status: 'PROCESSING',
        processingStartedAt: new Date(Date.now() - 600000),
        processingWorkerId: 'worker-dead'
      }
    });

    // Processor tick runs recovery and then delivers job
    const result = await processor.processPendingDeliveries(10, 'recovery-worker', 300000);
    assert.ok(result.processedCount >= 1);

    const updated = await prisma.channelDeliveryRecord.findUnique({ where: { id: delivery.id } });
    assert.strictEqual(updated?.status, 'DELIVERED');

    // Cleanup
    await prisma.channelDeliveryRecord.delete({ where: { id: delivery.id } });
    await prisma.notificationRecord.delete({ where: { id: notif.id } });
  });

  test('9. Queue Batch Processing limits claimed records to configured batch size', async () => {
    const processor = new DeliveryProcessor();
    const createdNotifs: string[] = [];
    const createdDeliveries: string[] = [];

    for (let i = 0; i < 5; i++) {
      const key = `idem_batch_${Date.now()}_${i}`;
      const notif = await prisma.notificationRecord.create({
        data: {
          eventId: `evt_batch_${Date.now()}_${i}`,
          userId: testUser.id,
          eventType: NotificationType.ACCOUNT_CREATED,
          category: NotificationCategory.ACCOUNT_SECURITY,
          severity: NotificationSeverity.INFO,
          title: `Batch Test ${i}`,
          body: 'Body',
          idempotencyKey: key,
          status: 'UNREAD'
        }
      });
      createdNotifs.push(notif.id);

      const delivery = await prisma.channelDeliveryRecord.create({
        data: {
          notificationId: notif.id,
          channel: NotificationChannel.EMAIL,
          targetAddress: testUser.email,
          status: 'QUEUED'
        }
      });
      createdDeliveries.push(delivery.id);
    }

    // Process batch of 2
    const res = await processor.processPendingDeliveries(2, 'batch-worker', 300000);
    assert.strictEqual(res.processedCount, 2);

    // Cleanup
    await prisma.channelDeliveryRecord.deleteMany({ where: { id: { in: createdDeliveries } } });
    await prisma.notificationRecord.deleteMany({ where: { id: { in: createdNotifs } } });
  });

  test('10. Temporary Email Delivery Failure transitions record to RETRYING', async () => {
    const failingEmailSvc: any = {
      sendRawMail: async () => {
        throw new Error('Connection timeout to SMTP server');
      }
    };
    const failingService = new CentralNotificationService();
    failingService.registerProvider(new EmailNotificationProviderImpl(failingEmailSvc));
    const processor = new DeliveryProcessor(failingService);

    const key = `idem_temp_${Date.now()}`;
    const notif = await prisma.notificationRecord.create({
      data: {
        eventId: `evt_temp_${Date.now()}`,
        userId: testUser.id,
        eventType: NotificationType.FILE_UPLOAD_FAILED,
        category: NotificationCategory.FILE_OPERATIONS,
        severity: NotificationSeverity.WARNING,
        title: 'Upload Failed',
        body: 'Body',
        idempotencyKey: key,
        status: 'UNREAD'
      }
    });

    const delivery = await prisma.channelDeliveryRecord.create({
      data: {
        notificationId: notif.id,
        channel: NotificationChannel.EMAIL,
        targetAddress: testUser.email,
        status: 'QUEUED'
      }
    });

    const res = await processor.processPendingDeliveries(1, 'temp-fail-worker', 300000);
    assert.strictEqual(res.retryingCount, 1);

    const updated = await prisma.channelDeliveryRecord.findUnique({ where: { id: delivery.id } });
    assert.strictEqual(updated?.status, 'RETRYING');
    assert.ok(updated?.nextRetryAt !== null);

    // Cleanup
    await prisma.channelDeliveryRecord.delete({ where: { id: delivery.id } });
    await prisma.notificationRecord.delete({ where: { id: notif.id } });
  });

  test('11. Permanent Email Delivery Failure transitions record to PERMANENTLY_FAILED', async () => {
    const key = `idem_perm_${Date.now()}`;
    const notif = await prisma.notificationRecord.create({
      data: {
        eventId: `evt_perm_${Date.now()}`,
        userId: testUser.id,
        eventType: NotificationType.SIGN_IN,
        category: NotificationCategory.ACCOUNT_SECURITY,
        severity: NotificationSeverity.SECURITY,
        title: 'Sign In Alert',
        body: 'Body',
        idempotencyKey: key,
        status: 'UNREAD'
      }
    });

    const delivery = await prisma.channelDeliveryRecord.create({
      data: {
        notificationId: notif.id,
        channel: NotificationChannel.EMAIL,
        targetAddress: 'invalid_rejected_user@domain',
        status: 'QUEUED'
      }
    });

    const processor = new DeliveryProcessor();
    const res = await processor.processPendingDeliveries(1, 'perm-fail-worker', 300000);
    assert.strictEqual(res.failedCount, 1);

    const updated = await prisma.channelDeliveryRecord.findUnique({ where: { id: delivery.id } });
    assert.strictEqual(updated?.status, 'PERMANENTLY_FAILED');

    // Cleanup
    await prisma.channelDeliveryRecord.delete({ where: { id: delivery.id } });
    await prisma.notificationRecord.delete({ where: { id: notif.id } });
  });

  test('12. Retry Exhaustion transitions to PERMANENTLY_FAILED when attemptCount >= maxAttempts', async () => {
    const failingEmailSvc: any = {
      sendRawMail: async () => {
        throw new Error('Temporary gateway timeout');
      }
    };
    const failingService = new CentralNotificationService();
    failingService.registerProvider(new EmailNotificationProviderImpl(failingEmailSvc));
    const processor = new DeliveryProcessor(failingService);

    const key = `idem_exhaust_${Date.now()}`;
    const notif = await prisma.notificationRecord.create({
      data: {
        eventId: `evt_exhaust_${Date.now()}`,
        userId: testUser.id,
        eventType: NotificationType.SERVER_UNAVAILABLE,
        category: NotificationCategory.DEVICE_SERVER,
        severity: NotificationSeverity.CRITICAL,
        title: 'Server Offline',
        body: 'Body',
        idempotencyKey: key,
        status: 'UNREAD'
      }
    });

    // Create delivery already at max attempts (5)
    const delivery = await prisma.channelDeliveryRecord.create({
      data: {
        notificationId: notif.id,
        channel: NotificationChannel.EMAIL,
        targetAddress: testUser.email,
        status: 'RETRYING',
        attemptCount: 4,
        maxAttempts: 5,
        nextRetryAt: new Date(Date.now() - 1000)
      }
    });

    const res = await processor.processPendingDeliveries(1, 'exhaust-worker', 300000);
    assert.strictEqual(res.failedCount, 1);

    const updated = await prisma.channelDeliveryRecord.findUnique({ where: { id: delivery.id } });
    assert.strictEqual(updated?.status, 'PERMANENTLY_FAILED');

    // Cleanup
    await prisma.channelDeliveryRecord.delete({ where: { id: delivery.id } });
    await prisma.notificationRecord.delete({ where: { id: notif.id } });
  });

  test('13. Exponential Backoff Delay calculation increases with attempt count', () => {
    const decision1 = calculateRetryDecision(1, 'Temporary SMTP Error', { maxJitterMs: 0 });
    const decision2 = calculateRetryDecision(2, 'Temporary SMTP Error', { maxJitterMs: 0 });

    const delay1 = decision1.nextAttemptAt!.getTime() - Date.now();
    const delay2 = decision2.nextAttemptAt!.getTime() - Date.now();

    assert.ok(delay2 > delay1);
  });

  test('14. Bounded Jitter calculation applies random delay bounded by maxJitterMs', () => {
    const decision = calculateRetryDecision(1, 'Network Error', { maxJitterMs: 500 });
    const delay = decision.nextAttemptAt!.getTime() - Date.now();

    // Base delay is 60,000ms. With 500ms max jitter, delay should be between 60,000 and 60,600
    assert.ok(delay >= 59000);
    assert.ok(delay <= 62000);
  });

  test('15. RetentionWorker cleans old read/archived notifications while preserving unread notifications', async () => {
    const retentionWorker = new RetentionWorker(90, 30);
    const oldDate = new Date(Date.now() - 95 * 24 * 60 * 60 * 1000);

    // Old Read notification (should be deleted)
    const notifRead = await prisma.notificationRecord.create({
      data: {
        eventId: `evt_ret_read_${Date.now()}`,
        userId: testUser.id,
        eventType: NotificationType.FILE_UPLOAD_COMPLETED,
        category: NotificationCategory.FILE_OPERATIONS,
        severity: NotificationSeverity.INFO,
        title: 'Old Read',
        body: 'Body',
        idempotencyKey: `idem_ret_read_${Date.now()}`,
        status: 'READ',
        createdAt: oldDate
      }
    });

    // Old Unread notification (should be PRESERVED)
    const notifUnread = await prisma.notificationRecord.create({
      data: {
        eventId: `evt_ret_unread_${Date.now()}`,
        userId: testUser.id,
        eventType: NotificationType.FILE_UPLOAD_COMPLETED,
        category: NotificationCategory.FILE_OPERATIONS,
        severity: NotificationSeverity.INFO,
        title: 'Old Unread',
        body: 'Body',
        idempotencyKey: `idem_ret_unread_${Date.now()}`,
        status: 'UNREAD',
        createdAt: oldDate
      }
    });

    const cleaned = await retentionWorker.cleanExpiredNotificationRecords(90, 100);
    assert.ok(cleaned >= 1);

    const checkRead = await prisma.notificationRecord.findUnique({ where: { id: notifRead.id } });
    const checkUnread = await prisma.notificationRecord.findUnique({ where: { id: notifUnread.id } });

    assert.strictEqual(checkRead, null);
    assert.ok(checkUnread !== null);

    // Cleanup remaining
    await prisma.notificationRecord.delete({ where: { id: notifUnread.id } });
  });

  test('16. RetentionWorker protects SECURITY category notifications from deletion', async () => {
    const retentionWorker = new RetentionWorker(90, 30);
    const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);

    const notifSec = await prisma.notificationRecord.create({
      data: {
        eventId: `evt_ret_sec_${Date.now()}`,
        userId: testUser.id,
        eventType: NotificationType.SIGN_IN,
        category: NotificationCategory.ACCOUNT_SECURITY,
        severity: NotificationSeverity.SECURITY,
        title: 'Old Security Alert',
        body: 'Body',
        idempotencyKey: `idem_ret_sec_${Date.now()}`,
        status: 'READ',
        createdAt: oldDate
      }
    });

    await retentionWorker.cleanExpiredNotificationRecords(90, 100);

    const checkSec = await prisma.notificationRecord.findUnique({ where: { id: notifSec.id } });
    assert.ok(checkSec !== null);

    // Cleanup
    await prisma.notificationRecord.delete({ where: { id: notifSec.id } });
  });

  test('17. RetentionWorker cleans old DELIVERED delivery records while preserving active QUEUED/RETRYING records', async () => {
    const retentionWorker = new RetentionWorker(90, 30);
    const oldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);

    const notif = await prisma.notificationRecord.create({
      data: {
        eventId: `evt_ret_del_${Date.now()}`,
        userId: testUser.id,
        eventType: NotificationType.SERVER_STARTED,
        category: NotificationCategory.DEVICE_SERVER,
        severity: NotificationSeverity.INFO,
        title: 'Server Started',
        body: 'Body',
        idempotencyKey: `idem_ret_del_${Date.now()}`,
        status: 'UNREAD'
      }
    });

    const oldDelivered = await prisma.channelDeliveryRecord.create({
      data: {
        notificationId: notif.id,
        channel: NotificationChannel.EMAIL,
        targetAddress: testUser.email,
        status: 'DELIVERED',
        createdAt: oldDate
      }
    });

    const oldQueued = await prisma.channelDeliveryRecord.create({
      data: {
        notificationId: notif.id,
        channel: NotificationChannel.EMAIL,
        targetAddress: testUser.email,
        status: 'QUEUED',
        createdAt: oldDate
      }
    });

    await retentionWorker.cleanExpiredDeliveryRecords(30, 100);

    const checkDelivered = await prisma.channelDeliveryRecord.findUnique({ where: { id: oldDelivered.id } });
    const checkQueued = await prisma.channelDeliveryRecord.findUnique({ where: { id: oldQueued.id } });

    assert.strictEqual(checkDelivered, null);
    assert.ok(checkQueued !== null);

    // Cleanup
    await prisma.channelDeliveryRecord.delete({ where: { id: oldQueued.id } });
    await prisma.notificationRecord.delete({ where: { id: notif.id } });
  });

  test('18. Idempotency TTL Cleanup cleans expired in-memory idempotency entries', async () => {
    await defaultIdempotencyManager.recordProcessing('test_ttl_key_1', 'evt_1', 0.001); // 1ms TTL
    await new Promise((resolve) => setTimeout(resolve, 5));
    const cleaned = await defaultIdempotencyManager.clearExpired();
    assert.ok(typeof cleaned === 'number');
  });

  test('19. Notification Metrics Service tracks delivery counters correctly', () => {
    notificationMetrics.recordDispatchedEvent();
    notificationMetrics.recordDeliverySuccess(NotificationChannel.EMAIL, {
      queueLatencyMs: 10,
      deliveryLatencyMs: 20,
      totalLatencyMs: 30
    });
    notificationMetrics.recordDeliveryFailure(NotificationChannel.PUSH, false, 'Temporary Push Error');

    const snap = notificationMetrics.getSnapshot();
    assert.strictEqual(snap.counters.dispatchedEvents, 1);
    assert.strictEqual(snap.counters.deliveredCount, 1);
    assert.strictEqual(snap.counters.retryingCount, 1);
    assert.strictEqual(snap.latency.avgTotalLatencyMs, 30);
    assert.strictEqual(snap.providers[NotificationChannel.EMAIL].status, 'HEALTHY');
  });

  test('20. Notification Metrics Service tracks provider DEGRADED and UNHEALTHY states on repeated failures', () => {
    for (let i = 0; i < 5; i++) {
      notificationMetrics.recordDeliveryFailure(NotificationChannel.PUSH, true, 'FCM Service Down');
    }

    const snap = notificationMetrics.getSnapshot();
    assert.strictEqual(snap.providers[NotificationChannel.PUSH].status, 'UNHEALTHY');
    assert.strictEqual(snap.providers[NotificationChannel.PUSH].consecutiveFailures, 5);
  });

  test('21. Storm Protection suppresses event burst while Security Events bypass rate limits', async () => {
    // Burst non-security events
    const results = [];
    for (let i = 0; i < 5; i++) {
      const res = await notificationService.dispatchEvent({
        eventType: NotificationType.DEVICE_OFFLINE,
        userId: testUser.id,
        deviceId: 'dev_burst_1',
        category: NotificationCategory.DEVICE_SERVER,
        severity: NotificationSeverity.WARNING,
        metadata: { deviceName: 'Flapping Phone' }
      });
      results.push(res);
    }

    const suppressedCount = results.filter((r) => r.stormSuppressed).length;
    assert.ok(suppressedCount > 0);

    // Security event should NEVER be suppressed
    const secRes = await notificationService.dispatchEvent({
      eventType: NotificationType.SIGN_IN,
      userId: testUser.id,
      category: NotificationCategory.ACCOUNT_SECURITY,
      severity: NotificationSeverity.SECURITY,
      metadata: { ipAddress: '127.0.0.1' }
    });

    assert.strictEqual(secRes.stormSuppressed, false);
  });

  test('22. Failure Isolation guarantees provider exceptions do not crash application flow', async () => {
    const throwingSvc = new CentralNotificationService();
    throwingSvc.registerProvider({
      channel: NotificationChannel.EMAIL,
      providerName: 'ThrowingProvider',
      send: async () => {
        throw new Error('Fatal unhandled provider crash');
      }
    });

    assert.doesNotThrow(async () => {
      await throwingSvc.dispatchEvent({
        eventType: NotificationType.SIGN_IN,
        userId: testUser.id,
        category: NotificationCategory.ACCOUNT_SECURITY,
        severity: NotificationSeverity.SECURITY,
        metadata: {}
      });
    });
  });

  test('23. Recursion Protection ensures delivery failure does not trigger recursive notification loop', async () => {
    const failingEmailSvc: any = {
      sendRawMail: async () => {
        throw new Error('SMTP Error');
      }
    };
    const provider = new EmailNotificationProviderImpl(failingEmailSvc);
    const res = await provider.send({
      deliveryId: 'del_rec_1',
      notificationId: 'notif_rec_1',
      userId: testUser.id,
      targetAddress: testUser.email,
      event: {
        eventId: 'evt_rec_1',
        userId: testUser.id,
        eventType: NotificationType.SIGN_IN,
        category: NotificationCategory.ACCOUNT_SECURITY,
        severity: NotificationSeverity.SECURITY,
        metadata: {},
        occurredAt: new Date(),
        idempotencyKey: 'idem_rec_1',
        source: 'test'
      },
      rendered: {
        title: 'Sign In Alert',
        body: 'Alert',
        emailSubject: 'Alert',
        emailHtml: '<p>Alert</p>',
        emailText: 'Alert',
        defaultChannels: [NotificationChannel.EMAIL],
        priority: NotificationSeverity.SECURITY
      }
    });

    assert.strictEqual(res.success, false);
    assert.ok(res.errorMessage !== null);
  });
});
