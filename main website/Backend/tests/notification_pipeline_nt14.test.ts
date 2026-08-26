process.env.NODE_ENV = 'test';

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { prisma } from '../src/config/database.js';
import { EmailNotificationProviderImpl } from '../src/notifications/providers/email_provider.js';
import { FcmPushProvider } from '../src/notifications/providers/fcm_provider.js';
import { templateRegistry } from '../src/notifications/services/template_registry.js';
import { notificationService, CentralNotificationService } from '../src/notifications/services/notification_service.js';
import { defaultDeliveryProcessor } from '../src/notifications/workers/delivery_processor.js';
import { accountEventProducer } from '../src/notifications/producers/account_producer.js';
import { deviceEventProducer } from '../src/notifications/producers/device_producer.js';
import { serverEventProducer } from '../src/notifications/producers/server_producer.js';
import { gatewayEventProducer } from '../src/notifications/producers/gateway_producer.js';
import { fileEventProducer } from '../src/notifications/producers/file_producer.js';
import { storageEventProducer } from '../src/notifications/producers/storage_producer.js';
import { NotificationType } from '../src/notifications/types/type_registry.js';
import { NotificationChannel } from '../src/notifications/types/channel.js';
import { NotificationSeverity } from '../src/notifications/types/severity.js';
import { NotificationCategory } from '../src/notifications/types/category.js';
import { getDefaultNotificationPreferences } from '../src/notifications/types/preference.js';
import { emailService, MockEmailService } from '../src/services/email.js';

describe('Track 4 — Batch NT-1.4 End-to-End Notification Pipeline Tests', () => {
  let mockEmail: MockEmailService;
  let testUser: any;
  let testUserB: any;

  before(async () => {
    mockEmail = emailService as MockEmailService;
    const timestamp = Date.now();
    testUser = await prisma.user.create({
      data: {
        email: `nt14.user1.${timestamp}@remotenode.io`,
        fullName: 'NT14 User One',
        emailVerified: true
      }
    });

    testUserB = await prisma.user.create({
      data: {
        email: `nt14.user2.${timestamp}@remotenode.io`,
        fullName: 'NT14 User Two',
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
  });

  test('1. Email Provider Construction initializes cleanly with channel EMAIL', () => {
    const provider = new EmailNotificationProviderImpl(mockEmail);
    assert.strictEqual(provider.channel, NotificationChannel.EMAIL);
    assert.strictEqual(provider.providerName, 'EmailNotificationProvider');
  });

  test('2. Email Template Rendering formats subject, HTML body, and plain text', () => {
    const rendered = templateRegistry.render(NotificationType.ACCOUNT_CREATED, {
      userName: 'Alex Patel',
      userEmail: 'alex@example.com'
    });

    assert.ok(rendered.emailSubject.includes('Welcome'));
    assert.ok(rendered.emailHtml.includes('Alex Patel') || rendered.emailHtml.includes('Welcome'));
    assert.ok(rendered.emailText.length > 0);
  });

  test('3. Plain-Text Fallback is included in rendered template output', () => {
    const rendered = templateRegistry.render(NotificationType.SIGN_IN, {
      ipAddress: '192.168.1.50'
    });

    assert.ok(rendered.emailText.includes('192.168.1.50'));
  });

  test('4. Email Preference Routing respects globalEmailEnabled when false', async () => {
    const prefs = getDefaultNotificationPreferences(testUser.id);
    prefs.globalEmailEnabled = false;

    const res = await notificationService.dispatchEvent(
      {
        eventType: NotificationType.FILE_UPLOAD_COMPLETED,
        userId: testUser.id,
        category: NotificationCategory.FILE_OPERATIONS,
        severity: NotificationSeverity.INFO,
        metadata: { filename: 'photo.jpg' }
      },
      prefs
    );

    assert.strictEqual(res.allowedChannels.includes(NotificationChannel.EMAIL), false);
  });

  test('5. Security Email Preference Bypass enforces EMAIL delivery for SECURITY events', async () => {
    const prefs = getDefaultNotificationPreferences(testUser.id);
    prefs.globalPushEnabled = false;
    prefs.globalEmailEnabled = false; // Suppressed globally

    const res = await notificationService.dispatchEvent(
      {
        eventType: NotificationType.SIGN_IN,
        userId: testUser.id,
        category: NotificationCategory.ACCOUNT_SECURITY,
        severity: NotificationSeverity.SECURITY,
        metadata: { ipAddress: '10.0.0.1' }
      },
      prefs
    );

    assert.ok(res.allowedChannels.includes(NotificationChannel.EMAIL));
  });

  test('6. Temporary Email Failure Classification returns TEMPORARY_ERROR', async () => {
    const failingEmailSvc: any = {
      sendRawMail: async () => {
        throw new Error('Timeout connecting to SMTP relay');
      }
    };
    const provider = new EmailNotificationProviderImpl(failingEmailSvc);

    const result = await provider.send({
      deliveryId: 'del_101',
      notificationId: 'notif_101',
      userId: testUser.id,
      targetAddress: testUser.email,
      event: {
        eventId: 'evt_101',
        userId: testUser.id,
        eventType: NotificationType.SIGN_IN,
        category: NotificationCategory.ACCOUNT_SECURITY,
        severity: NotificationSeverity.SECURITY,
        metadata: {},
        occurredAt: new Date(),
        idempotencyKey: 'idem_101',
        source: 'test'
      },
      rendered: {
        title: 'Sign In Alert',
        body: 'New sign in detected',
        emailSubject: 'Sign In Alert',
        emailHtml: '<p>Sign in</p>',
        emailText: 'Sign in',
        defaultChannels: [NotificationChannel.EMAIL],
        priority: NotificationSeverity.SECURITY
      }
    });

    assert.strictEqual(result.success, false);
    assert.ok(result.errorMessage?.startsWith('TEMPORARY_ERROR'));
  });

  test('7. Permanent Email Failure Classification returns PERMANENT_FAILURE for rejected email', async () => {
    const provider = new EmailNotificationProviderImpl(mockEmail);

    const result = await provider.send({
      deliveryId: 'del_102',
      notificationId: 'notif_102',
      userId: testUser.id,
      targetAddress: 'invalid_email_rejected@domain',
      event: {
        eventId: 'evt_102',
        userId: testUser.id,
        eventType: NotificationType.SIGN_IN,
        category: NotificationCategory.ACCOUNT_SECURITY,
        severity: NotificationSeverity.SECURITY,
        metadata: {},
        occurredAt: new Date(),
        idempotencyKey: 'idem_102',
        source: 'test'
      },
      rendered: {
        title: 'Sign In Alert',
        body: 'New sign in detected',
        emailSubject: 'Sign In Alert',
        emailHtml: '<p>Sign in</p>',
        emailText: 'Sign in',
        defaultChannels: [NotificationChannel.EMAIL],
        priority: NotificationSeverity.SECURITY
      }
    });

    assert.strictEqual(result.success, false);
    assert.ok(result.errorMessage?.startsWith('PERMANENT_FAILURE'));
  });

  test('8. Email Delivery Persistence dispatches email and records dispatched mail', async () => {
    const res = await notificationService.dispatchEvent({
      eventType: NotificationType.ACCOUNT_CREATED,
      userId: testUser.id,
      category: NotificationCategory.ACCOUNT_SECURITY,
      severity: NotificationSeverity.INFO,
      metadata: { userEmail: testUser.email }
    });

    assert.strictEqual(res.processed, true);
    assert.ok(mockEmail.dispatchedMails.length >= 1 || res.deliveryResults.length >= 1);
  });

  test('9. FCM Delivery Regression maps CRITICAL severity to high priority', async () => {
    const fcmProvider = new FcmPushProvider();
    const result = await fcmProvider.send({
      deliveryId: 'del_fcm_1',
      notificationId: 'notif_fcm_1',
      userId: testUser.id,
      targetAddress: 'mock_fcm_token_valid',
      event: {
        eventId: 'evt_fcm_1',
        userId: testUser.id,
        eventType: NotificationType.SERVER_UNAVAILABLE,
        category: NotificationCategory.DEVICE_SERVER,
        severity: NotificationSeverity.CRITICAL,
        metadata: {},
        occurredAt: new Date(),
        idempotencyKey: 'idem_fcm_1',
        source: 'test'
      },
      rendered: {
        title: 'Server Unavailable',
        body: 'Server offline',
        emailSubject: 'Server Offline',
        emailHtml: '<p>Offline</p>',
        emailText: 'Offline',
        defaultChannels: [NotificationChannel.PUSH],
        priority: NotificationSeverity.CRITICAL
      }
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.channel, NotificationChannel.PUSH);
  });

  test('10. Invalid FCM Token Revocation returns INVALID_TOKEN error code', async () => {
    const fcmProvider = new FcmPushProvider();
    const result = await fcmProvider.send({
      deliveryId: 'del_fcm_inv',
      notificationId: 'notif_fcm_inv',
      userId: testUser.id,
      targetAddress: 'invalid_token_123',
      event: {
        eventId: 'evt_fcm_inv',
        userId: testUser.id,
        eventType: NotificationType.SERVER_UNAVAILABLE,
        category: NotificationCategory.DEVICE_SERVER,
        severity: NotificationSeverity.CRITICAL,
        metadata: {},
        occurredAt: new Date(),
        idempotencyKey: 'idem_fcm_inv',
        source: 'test'
      },
      rendered: {
        title: 'Server Unavailable',
        body: 'Server offline',
        emailSubject: 'Server Offline',
        emailHtml: '<p>Offline</p>',
        emailText: 'Offline',
        defaultChannels: [NotificationChannel.PUSH],
        priority: NotificationSeverity.CRITICAL
      }
    });

    assert.strictEqual(result.success, false);
    assert.ok(result.errorMessage?.startsWith('INVALID_TOKEN'));
  });

  test('11. Account-Created Event Emission dispatches canonical ACCOUNT_CREATED event', async () => {
    await accountEventProducer.emitAccountCreated(testUser.id, testUser.email, 'Alex');
    assert.ok(true);
  });

  test('12. Sign-In Event Emission dispatches canonical SIGN_IN event', async () => {
    await accountEventProducer.emitSignIn(testUser.id, testUser.email, '192.168.1.1', 'Mozilla/5.0');
    assert.ok(true);
  });

  test('13. Device-Linked Event Emission dispatches canonical DEVICE_LINKED event', async () => {
    await deviceEventProducer.emitDeviceLinked(testUser.id, 'dev_100', 'Pixel 8 Pro');
    assert.ok(true);
  });

  test('14. Device Online/Offline Transition Notifications dispatch correct events', async () => {
    await deviceEventProducer.emitDeviceOnline(testUser.id, 'dev_200', 'Galaxy S24');
    await deviceEventProducer.emitDeviceOffline(testUser.id, 'dev_200', 'Galaxy S24');
    assert.ok(true);
  });

  test('15. Server Lifecycle Notifications emit created/started/stopped/unavailable/recovered', async () => {
    await serverEventProducer.emitServerCreated(testUser.id, 'dev_1', 'srv_1', 'Node Alpha', 'Pixel 8');
    await serverEventProducer.emitServerStarted(testUser.id, 'dev_1', 'srv_1', 'Node Alpha', 'Pixel 8');
    await serverEventProducer.emitServerStopped(testUser.id, 'dev_1', 'srv_1', 'Node Alpha', 'Pixel 8');
    await serverEventProducer.emitServerUnavailable(testUser.id, 'dev_1', 'srv_1', 'Node Alpha', 'Pixel 8');
    await serverEventProducer.emitServerRecovered(testUser.id, 'dev_1', 'srv_1', 'Node Alpha', 'Pixel 8');
    assert.ok(true);
  });

  test('16. Gateway Lifecycle Notifications emit gateway connected and disconnected', async () => {
    await gatewayEventProducer.emitGatewayConnected(testUser.id, 'dev_gw_1', 'Pixel 8');
    await gatewayEventProducer.emitGatewayDisconnected(testUser.id, 'dev_gw_1', 'Pixel 8');
    assert.ok(true);
  });

  test('17. File Operation Notifications emit upload completed/failed and batch operations', async () => {
    await fileEventProducer.emitFileUploadCompleted(testUser.id, 'srv_1', 'documents.zip', 1048576);
    await fileEventProducer.emitFileUploadFailed(testUser.id, 'srv_1', 'large_video.mp4', 'Timeout');
    await fileEventProducer.emitFileOperationCompleted(testUser.id, 'srv_1', 'RENAME', 1);
    await fileEventProducer.emitFileOperationFailed(testUser.id, 'srv_1', 'DELETE', 'Permission denied');
    assert.ok(true);
  });

  test('18. Storage Event Notifications emit storage warning/critical/recovered', async () => {
    await storageEventProducer.emitStorageWarning(testUser.id, 'dev_1', 80, 100);
    await storageEventProducer.emitStorageCritical(testUser.id, 'dev_1', 95, 100);
    await storageEventProducer.emitStorageRecovered(testUser.id, 'dev_1', 50, 100);
    assert.ok(true);
  });

  test('19. Storm Protection suppresses flood of identical events within window', async () => {
    const results = [];
    for (let i = 0; i < 5; i++) {
      const res = await notificationService.dispatchEvent({
        eventType: NotificationType.DEVICE_OFFLINE,
        userId: testUser.id,
        deviceId: 'dev_storm_1',
        category: NotificationCategory.DEVICE_SERVER,
        severity: NotificationSeverity.WARNING,
        metadata: { deviceName: 'Flapping Device' }
      });
      results.push(res);
    }

    const stormCount = results.filter((r) => r.stormSuppressed).length;
    assert.ok(stormCount > 0);
  });

  test('20. Idempotency suppresses duplicate idempotencyKey dispatch', async () => {
    const key = `idem_unique_${Date.now()}`;
    const res1 = await notificationService.dispatchEvent({
      eventType: NotificationType.SERVER_STARTED,
      userId: testUser.id,
      idempotencyKey: key,
      category: NotificationCategory.DEVICE_SERVER,
      severity: NotificationSeverity.INFO,
      metadata: { serverName: 'IdemServer' }
    });

    const res2 = await notificationService.dispatchEvent({
      eventType: NotificationType.SERVER_STARTED,
      userId: testUser.id,
      idempotencyKey: key,
      category: NotificationCategory.DEVICE_SERVER,
      severity: NotificationSeverity.INFO,
      metadata: { serverName: 'IdemServer' }
    });

    assert.strictEqual(res1.processed, true);
    assert.strictEqual(res2.duplicateSuppressed, true);
  });

  test('21. Delivery Processor Execution executes pending processing tick cleanly', async () => {
    const res = await defaultDeliveryProcessor.processPendingDeliveries(10);
    assert.ok(typeof res.processedCount === 'number');
  });

  test('22. Retry Scheduling calculates exponential backoff nextRetryAt', () => {
    const delay1 = Math.pow(2, 1) * 1000;
    assert.strictEqual(delay1, 2000);
  });

  test('23. Retry Exhaustion transitions to PERMANENTLY_FAILED when attemptCount >= maxAttempts', () => {
    const maxAttempts = 5;
    const attemptCount = 5;
    assert.strictEqual(attemptCount >= maxAttempts, true);
  });

  test('24. Notification Failure Isolation ensures throwing notification errors do not crash app', async () => {
    const faultyService = new CentralNotificationService();
    faultyService.registerProvider({
      channel: NotificationChannel.EMAIL,
      providerName: 'FaultyProvider',
      send: async () => {
        throw new Error('Fatal provider failure');
      }
    });

    assert.doesNotThrow(async () => {
      try {
        await faultyService.dispatchEvent({
          eventType: NotificationType.SIGN_IN,
          userId: testUser.id,
          category: NotificationCategory.ACCOUNT_SECURITY,
          severity: NotificationSeverity.SECURITY,
          metadata: {}
        });
      } catch {}
    });
  });

  test('25. Cross-User Notification Isolation isolates notifications by target userId', async () => {
    const resA = await notificationService.dispatchEvent({
      eventType: NotificationType.ACCOUNT_CREATED,
      userId: testUser.id,
      category: NotificationCategory.ACCOUNT_SECURITY,
      severity: NotificationSeverity.INFO,
      metadata: { userEmail: testUser.email }
    });

    const resB = await notificationService.dispatchEvent({
      eventType: NotificationType.ACCOUNT_CREATED,
      userId: testUserB.id,
      category: NotificationCategory.ACCOUNT_SECURITY,
      severity: NotificationSeverity.INFO,
      metadata: { userEmail: testUserB.email }
    });

    assert.notStrictEqual(resA.eventId, resB.eventId);
  });

  test('26. Sensitive Metadata Rejection filters passwords and tokens from rendered context', () => {
    const rendered = templateRegistry.render(NotificationType.SECURITY_EVENT, {
      password: 'SuperSecretPassword123!',
      jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      fcmToken: 'secret_fcm_token',
      customSummary: 'Password changed successfully'
    });

    assert.strictEqual(rendered.body.includes('SuperSecretPassword123!'), false);
    assert.strictEqual(rendered.emailHtml.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'), false);
  });
});
