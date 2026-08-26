/**
 * RemoteNode Notification System Architecture Test Suite
 * Track 4 — Batch NT-1.1 Verification
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NotificationCategory,
  NotificationSeverity,
  NotificationChannel,
  NotificationType,
  NotificationState,
  DeliveryStatus,
  createNotificationEvent,
  validateAndSanitizeMetadata,
  getDefaultNotificationPreferences,
  templateRegistry,
  InMemoryIdempotencyManager,
  NotificationStormProtection,
  ChannelRouter,
  CentralNotificationService,
  calculateRetryDecision,
  DeliveryFailureCategory
} from '../src/notifications/index.js';

test('1. Notification Event Construction & Metadata Sanitization', () => {
  const rawMetadata = {
    userName: 'John Doe',
    deviceName: 'Pixel 7',
    password: 'SuperSecretPassword123!',
    token: 'jwt.token.string',
    jwt: 'bearer_token_xyz',
    privateKey: '-----BEGIN PRIVATE KEY-----',
    fileCount: 5,
    customSummary: 'Uploaded files successfully'
  };

  const sanitized = validateAndSanitizeMetadata(rawMetadata);
  assert.equal(sanitized.userName, 'John Doe');
  assert.equal(sanitized.deviceName, 'Pixel 7');
  assert.equal(sanitized.fileCount, 5);
  assert.equal(sanitized.customSummary, 'Uploaded files successfully');

  // Verify sensitive keys stripped
  assert.equal((sanitized as any).password, undefined);
  assert.equal((sanitized as any).token, undefined);
  assert.equal((sanitized as any).jwt, undefined);
  assert.equal((sanitized as any).privateKey, undefined);

  const event = createNotificationEvent({
    eventType: NotificationType.FILE_UPLOAD_COMPLETED,
    userId: 'usr_1001',
    deviceId: 'dev_2002',
    metadata: rawMetadata
  });

  assert.equal(event.userId, 'usr_1001');
  assert.equal(event.deviceId, 'dev_2002');
  assert.equal(event.category, NotificationCategory.FILE_OPERATIONS);
  assert.equal(event.severity, NotificationSeverity.SUCCESS);
  assert.ok(event.idempotencyKey.includes('FILE_UPLOAD_COMPLETED:usr_1001'));
  assert.equal((event.metadata as any).password, undefined);
});

test('2. Unknown Notification Type Strict Validation', () => {
  assert.throws(() => {
    createNotificationEvent({
      eventType: 'UNKNOWN_INVALID_TYPE' as any,
      userId: 'usr_1001'
    });
  }, /Unknown or unregistered notification type/);
});

test('3. Deterministic Channel Routing & Preference Evaluation', () => {
  const router = new ChannelRouter();
  const prefs = getDefaultNotificationPreferences('usr_1001');

  // Standard File Operations Event
  const fileEvent = createNotificationEvent({
    eventType: NotificationType.FILE_UPLOAD_COMPLETED,
    userId: 'usr_1001',
    metadata: { fileCount: 2 }
  });

  const routing1 = router.evaluateRouting(fileEvent, prefs);
  assert.equal(routing1.securityBypassTriggered, false);
  assert.deepEqual(routing1.allowedChannels, [NotificationChannel.IN_APP, NotificationChannel.PUSH]);

  // Disable FILE_OPERATIONS category
  prefs.categories[NotificationCategory.FILE_OPERATIONS].enabled = false;
  const routing2 = router.evaluateRouting(fileEvent, prefs);
  assert.equal(routing2.securityBypassTriggered, false);
  assert.deepEqual(routing2.allowedChannels, [NotificationChannel.IN_APP]);
  assert.ok(routing2.suppressionReason?.includes('Category FILE_OPERATIONS disabled'));
});

test('4. Security Policy Exception Rule (Bypass Opt-Out)', () => {
  const router = new ChannelRouter();
  const prefs = getDefaultNotificationPreferences('usr_1001');

  // Disable all push and email globally
  prefs.globalEmailEnabled = false;
  prefs.globalPushEnabled = false;
  prefs.categories[NotificationCategory.ACCOUNT_SECURITY].enabled = false;

  const securityEvent = createNotificationEvent({
    eventType: NotificationType.SIGN_IN,
    userId: 'usr_1001',
    metadata: { ipAddress: '192.168.1.1' }
  });

  const routing = router.evaluateRouting(securityEvent, prefs);
  assert.equal(routing.securityBypassTriggered, true);
  // Security critical events force delivery through all channels
  assert.deepEqual(routing.allowedChannels, [
    NotificationChannel.IN_APP,
    NotificationChannel.PUSH,
    NotificationChannel.EMAIL
  ]);
});

test('5. Multi-Device Routing Engine', () => {
  const router = new ChannelRouter();
  const userDevices = [
    { deviceId: 'dev_1', deviceName: 'Phone A' },
    { deviceId: 'dev_2', deviceName: 'Phone B' }
  ];

  // Specific device targeted event
  const targetedEvent = createNotificationEvent({
    eventType: NotificationType.SERVER_STOPPED,
    userId: 'usr_1001',
    deviceId: 'dev_2'
  });

  const targets = router.resolveTargetDevices(targetedEvent, userDevices);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].deviceId, 'dev_2');

  // Broadcast account event
  const accountEvent = createNotificationEvent({
    eventType: NotificationType.ACCOUNT_CREATED,
    userId: 'usr_1001'
  });

  const allTargets = router.resolveTargetDevices(accountEvent, userDevices);
  assert.equal(allTargets.length, 2);
});

test('6. Idempotency Manager & Duplicate Prevention', async () => {
  const idempotency = new InMemoryIdempotencyManager(300);
  const key = 'SERVER_OFFLINE:usr_1:dev_1:srv_1:123456';

  assert.equal(await idempotency.isProcessed(key), false);
  await idempotency.recordProcessing(key, 'evt_99');
  assert.equal(await idempotency.isProcessed(key), true);
});

test('7. Storm Protection & Cooldown Engine', () => {
  const storm = new NotificationStormProtection(60); // 60s cooldown

  const event1 = createNotificationEvent({
    eventType: NotificationType.DEVICE_OFFLINE,
    userId: 'usr_1001',
    deviceId: 'dev_100'
  });

  const event2 = createNotificationEvent({
    eventType: NotificationType.DEVICE_OFFLINE,
    userId: 'usr_1001',
    deviceId: 'dev_100'
  });

  assert.equal(storm.shouldSuppress(event1), false);
  // Rapid second event for same entity within cooldown window suppressed
  assert.equal(storm.shouldSuppress(event2), true);
});

test('8. Central Notification Service Ingestion & Delivery Separation', async () => {
  const service = new CentralNotificationService();

  const result = await service.dispatchEvent({
    eventType: NotificationType.SERVER_CREATED,
    userId: 'usr_500',
    deviceId: 'dev_500',
    serverId: 'srv_500',
    metadata: {
      serverName: 'My Android File Server',
      deviceName: 'Samsung S21'
    }
  });

  assert.equal(result.processed, true);
  assert.equal(result.duplicateSuppressed, false);
  assert.equal(result.stormSuppressed, false);
  assert.ok(result.notificationId);
  assert.equal(result.renderedTitle, 'File Server Created');
  assert.ok(result.renderedBody?.includes('My Android File Server'));

  // Verify in-app record status starts as UNREAD
  const record = await service.getNotification(result.notificationId!);
  assert.ok(record);
  assert.equal(record?.state, NotificationState.UNREAD);

  // Mark as read
  const marked = await service.markAsRead(result.notificationId!, 'usr_500');
  assert.equal(marked, true);
  const updatedRecord = await service.getNotification(result.notificationId!);
  assert.equal(updatedRecord?.state, NotificationState.READ);
});

test('9. Retry Policy & Failure Classification', () => {
  // Temporary network error
  const tempDecision = calculateRetryDecision(1, 'ECONNRESET network timeout');
  assert.equal(tempDecision.failureCategory, DeliveryFailureCategory.TEMPORARY);
  assert.equal(tempDecision.shouldRetry, true);
  assert.equal(tempDecision.nextStatus, DeliveryStatus.RETRYING);
  assert.ok(tempDecision.nextAttemptAt);

  // Permanent recipient invalid error
  const permDecision = calculateRetryDecision(1, 'Invalid recipient email address');
  assert.equal(permDecision.failureCategory, DeliveryFailureCategory.PERMANENT);
  assert.equal(permDecision.shouldRetry, false);
  assert.equal(permDecision.nextStatus, DeliveryStatus.PERMANENTLY_FAILED);
});

test('10. Template Registry Engine', () => {
  const rendered = templateRegistry.render(NotificationType.STORAGE_WARNING, {
    deviceName: 'Pixel 8',
    storageUsedPercent: 88
  });

  assert.equal(rendered.title, 'Storage Space Low');
  assert.ok(rendered.body.includes('Pixel 8'));
  assert.ok(rendered.body.includes('88%'));
  assert.equal(rendered.priority, NotificationSeverity.WARNING);
  assert.ok(rendered.deepLink);
  assert.equal(rendered.deepLink?.targetType, 'device');
});
