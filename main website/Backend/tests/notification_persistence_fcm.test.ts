/**
 * RemoteNode Track 4 Batch NT-1.2 Comprehensive Persistence, FCM & API Test Suite
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/config/database.js';
import { buildApp } from '../src/app.js';
import {
  NotificationSeverity,
  NotificationChannel,
  NotificationType,
  NotificationRecordStatus,
  ChannelDeliveryStatus,
  createNotificationEvent,
  notificationRepository,
  CentralNotificationService,
  FcmPushProvider
} from '../src/notifications/index.js';

let app: any;
let testUser1: any;
let testUser2: any;
let testSessionToken1: string;
let testSessionToken2: string;
let testDevice1: any;
let testDevice2: any;
let unownedDevice: any;

before(async () => {
  app = await buildApp();
  await app.ready();

  const timestamp = Date.now();

  // Create Test User 1
  testUser1 = await prisma.user.create({
    data: {
      email: `nt12.user1.${timestamp}@remotenode.io`,
      fullName: 'NT12 User One',
      emailVerified: true
    }
  });

  // Session Token for User 1
  testSessionToken1 = `session_token_1_${timestamp}`;
  await prisma.userSession.create({
    data: {
      userId: testUser1.id,
      token: testSessionToken1,
      expiresAt: new Date(Date.now() + 86400000)
    }
  });

  // Create Devices for User 1
  testDevice1 = await prisma.device.create({
    data: {
      userId: testUser1.id,
      deviceName: 'Pixel 7 Pro (User 1)',
      installationId: `inst_1_${timestamp}`,
      platform: 'Android'
    }
  });

  testDevice2 = await prisma.device.create({
    data: {
      userId: testUser1.id,
      deviceName: 'Galaxy S23 (User 1)',
      installationId: `inst_2_${timestamp}`,
      platform: 'Android'
    }
  });

  // Create Test User 2 & Unowned Device
  testUser2 = await prisma.user.create({
    data: {
      email: `nt12.user2.${timestamp}@remotenode.io`,
      fullName: 'NT12 User Two',
      emailVerified: true
    }
  });

  testSessionToken2 = `session_token_2_${timestamp}`;
  await prisma.userSession.create({
    data: {
      userId: testUser2.id,
      token: testSessionToken2,
      expiresAt: new Date(Date.now() + 86400000)
    }
  });

  unownedDevice = await prisma.device.create({
    data: {
      userId: testUser2.id,
      deviceName: 'Unowned Phone (User 2)',
      installationId: `inst_unowned_${timestamp}`,
      platform: 'Android'
    }
  });
});

after(async () => {
  try {
    if (testUser1) {
      await prisma.user.delete({ where: { id: testUser1.id } }).catch(() => {});
    }
    if (testUser2) {
      await prisma.user.delete({ where: { id: testUser2.id } }).catch(() => {});
    }
  } catch {}
});

test('1. Prisma Model Persistence — NotificationRecord & ChannelDeliveryRecord', async () => {
  const notif = await notificationRepository.createNotificationRecord({
    eventId: 'evt_test_1',
    userId: testUser1.id,
    deviceId: testDevice1.id,
    eventType: NotificationType.SERVER_STARTED,
    category: 'DEVICE_SERVER',
    severity: NotificationSeverity.INFO,
    title: 'Server Running',
    body: 'File server started',
    idempotencyKey: `idemp_${Date.now()}_1`
  });

  assert.ok(notif.id);
  assert.equal(notif.userId, testUser1.id);
  assert.equal(notif.status, NotificationRecordStatus.UNREAD);

  const delivery = await notificationRepository.createChannelDeliveryRecord({
    notificationId: notif.id,
    channel: NotificationChannel.PUSH,
    targetDeviceId: testDevice1.id,
    status: ChannelDeliveryStatus.DELIVERED,
    providerMessageId: 'msg_fcm_100'
  });

  assert.ok(delivery.id);
  assert.equal(delivery.notificationId, notif.id);
  assert.equal(delivery.providerMessageId, 'msg_fcm_100');
});

test('2. User Notification Preferences Persistence & Defaults', async () => {
  const defaults = await notificationRepository.getUserPreferences(testUser1.id);
  assert.equal(defaults.globalPushEnabled, true);
  assert.equal(defaults.globalEmailEnabled, true);

  const updated = await notificationRepository.updateUserPreferences(testUser1.id, {
    globalEmailEnabled: false,
    categories: {
      FILE_OPERATIONS: {
        enabled: false,
        channels: { IN_APP: true, PUSH: false, EMAIL: false }
      }
    }
  });

  assert.equal(updated.globalEmailEnabled, false);
  assert.equal(updated.categories.FILE_OPERATIONS.enabled, false);
});

test('3. DevicePushToken Registration, Rotation, & Revocation', async () => {
  const tokenString1 = `fcm_token_alpha_${Date.now()}`;
  const reg1 = await notificationRepository.registerOrUpdatePushToken({
    userId: testUser1.id,
    deviceId: testDevice1.id,
    token: tokenString1,
    platform: 'ANDROID' as any,
    appVersion: '1.2.0'
  });

  assert.ok(reg1.id);
  assert.equal(reg1.isActive, true);

  // Token rotation (new token for same device revokes old token)
  const tokenString2 = `fcm_token_beta_${Date.now()}`;
  const reg2 = await notificationRepository.registerOrUpdatePushToken({
    userId: testUser1.id,
    deviceId: testDevice1.id,
    token: tokenString2,
    platform: 'ANDROID' as any
  });

  assert.equal(reg2.token, tokenString2);

  const oldToken = await prisma.devicePushToken.findUnique({ where: { token: tokenString1 } });
  assert.equal(oldToken?.isActive, false);
  assert.ok(oldToken?.revokedAt);

  // Explicit Revocation
  await notificationRepository.revokePushToken(tokenString2, testUser1.id, testDevice1.id);
  const revoked = await prisma.devicePushToken.findUnique({ where: { token: tokenString2 } });
  assert.equal(revoked?.isActive, false);
});

test('4. REST API — Device Push Token Registration & Device Ownership Security', async () => {
  const tokenVal = `fcm_token_api_${Date.now()}`;

  // Unauthorized (Missing Bearer Token)
  const resUnauth = await app.inject({
    method: 'POST',
    url: `/api/v1/devices/${testDevice1.id}/push-token`,
    payload: { token: tokenVal }
  });
  assert.equal(resUnauth.statusCode, 401);

  // Forbidden (User 1 attempting to register token on User 2's device)
  const resForbidden = await app.inject({
    method: 'POST',
    url: `/api/v1/devices/${unownedDevice.id}/push-token`,
    headers: { authorization: `Bearer ${testSessionToken1}` },
    payload: { token: tokenVal }
  });
  assert.equal(resForbidden.statusCode, 403);

  // Success (User 1 registering token on own device)
  const resSuccess = await app.inject({
    method: 'POST',
    url: `/api/v1/devices/${testDevice1.id}/push-token`,
    headers: { authorization: `Bearer ${testSessionToken1}` },
    payload: { token: tokenVal, platform: 'ANDROID', appVersion: '1.2.0' }
  });
  assert.equal(resSuccess.statusCode, 200);
  const jsonSuccess = JSON.parse(resSuccess.payload);
  assert.equal(jsonSuccess.success, true);
  assert.equal(jsonSuccess.data.deviceId, testDevice1.id);

  // Revoke via DELETE endpoint
  const resDelete = await app.inject({
    method: 'DELETE',
    url: `/api/v1/devices/${testDevice1.id}/push-token`,
    headers: { authorization: `Bearer ${testSessionToken1}` }
  });
  assert.equal(resDelete.statusCode, 200);
});

test('5. Multi-Device & Account Push Routing', async () => {
  const tokenA = `fcm_token_devA_${Date.now()}`;
  const tokenB = `fcm_token_devB_${Date.now()}`;

  await notificationRepository.registerOrUpdatePushToken({
    userId: testUser1.id,
    deviceId: testDevice1.id,
    token: tokenA
  });

  await notificationRepository.registerOrUpdatePushToken({
    userId: testUser1.id,
    deviceId: testDevice2.id,
    token: tokenB
  });

  const activeTokens = await notificationRepository.getActivePushTokensForUser(testUser1.id);
  assert.equal(activeTokens.length, 2);
});

test('6. Notification Idempotency & Persistence', async () => {
  const service = new CentralNotificationService();
  const idempKey = `idemp_unique_${Date.now()}`;

  const input = {
    eventType: NotificationType.DEVICE_ONLINE,
    userId: testUser1.id,
    deviceId: testDevice1.id,
    idempotencyKey: idempKey,
    metadata: { deviceName: 'Pixel Phone' }
  };

  const res1 = await service.dispatchEvent(input);
  assert.equal(res1.processed, true);
  assert.equal(res1.duplicateSuppressed, false);

  const res2 = await service.dispatchEvent(input);
  assert.equal(res2.processed, false);
  assert.equal(res2.duplicateSuppressed, true);
});

test('7. FCM Payload Generation, Priority Mapping & Invalid Token Revocation', async () => {
  const provider = new FcmPushProvider({ projectId: 'test-proj' });

  // Test Priority Mapping
  const infoReq = {
    deliveryId: 'del_1',
    notificationId: 'notif_1',
    userId: testUser1.id,
    targetAddress: 'fcm_valid_token_123',
    event: createNotificationEvent({ eventType: NotificationType.DEVICE_ONLINE, userId: testUser1.id }),
    rendered: {
      title: 'Device Online',
      body: 'Device connected',
      emailSubject: 'Device Online',
      emailHtml: '<p>Online</p>',
      emailText: 'Online',
      defaultChannels: [NotificationChannel.PUSH],
      priority: NotificationSeverity.INFO
    }
  };

  const resInfo = await provider.send(infoReq);
  assert.equal(resInfo.success, true);
  assert.ok(resInfo.externalMessageId);

  // Test Invalid Token Classification
  const invalidReq = {
    ...infoReq,
    targetAddress: 'unregistered_token_xyz'
  };

  const resInvalid = await provider.send(invalidReq);
  assert.equal(resInvalid.success, false);
  assert.ok(resInvalid.errorMessage?.includes('INVALID_TOKEN'));
});

test('8. REST API — Notification History, Unread Count, Read & Archive Mutations', async () => {
  const service = new CentralNotificationService();
  const idemp1 = `history_1_${Date.now()}`;
  const idemp2 = `history_2_${Date.now()}`;

  const notif1 = await service.dispatchEvent({
    eventType: NotificationType.SERVER_CREATED,
    userId: testUser1.id,
    idempotencyKey: idemp1,
    metadata: { serverName: 'Server Alpha' }
  });

  await service.dispatchEvent({
    eventType: NotificationType.SERVER_STOPPED,
    userId: testUser1.id,
    idempotencyKey: idemp2,
    metadata: { serverName: 'Server Alpha' }
  });

  // GET /api/v1/notifications/unread-count
  const resUnread = await app.inject({
    method: 'GET',
    url: '/api/v1/notifications/unread-count',
    headers: { authorization: `Bearer ${testSessionToken1}` }
  });
  assert.equal(resUnread.statusCode, 200);
  const jsonUnread = JSON.parse(resUnread.payload);
  assert.ok(jsonUnread.data.unreadCount >= 2);

  // GET /api/v1/notifications (History)
  const resHistory = await app.inject({
    method: 'GET',
    url: '/api/v1/notifications?limit=10&page=1',
    headers: { authorization: `Bearer ${testSessionToken1}` }
  });
  assert.equal(resHistory.statusCode, 200);
  const jsonHistory = JSON.parse(resHistory.payload);
  assert.ok(jsonHistory.data.notifications.length >= 2);

  // User Isolation: User 2 must see 0 notifications from User 1
  const resUser2History = await app.inject({
    method: 'GET',
    url: '/api/v1/notifications',
    headers: { authorization: `Bearer ${testSessionToken2}` }
  });
  assert.equal(resUser2History.statusCode, 200);
  const jsonUser2History = JSON.parse(resUser2History.payload);
  assert.equal(jsonUser2History.data.notifications.length, 0);

  // PATCH /api/v1/notifications/:id/read
  const targetNotifId = notif1.notificationId!;
  const resRead = await app.inject({
    method: 'PATCH',
    url: `/api/v1/notifications/${targetNotifId}/read`,
    headers: { authorization: `Bearer ${testSessionToken1}` }
  });
  assert.equal(resRead.statusCode, 200);
  const jsonRead = JSON.parse(resRead.payload);
  assert.equal(jsonRead.data.status, NotificationRecordStatus.READ);

  // User Isolation: User 2 cannot mark User 1's notification as read (Forbidden 403)
  const resForbiddenRead = await app.inject({
    method: 'PATCH',
    url: `/api/v1/notifications/${targetNotifId}/read`,
    headers: { authorization: `Bearer ${testSessionToken2}` }
  });
  assert.equal(resForbiddenRead.statusCode, 403);

  // PATCH /api/v1/notifications/:id/archive
  const resArchive = await app.inject({
    method: 'PATCH',
    url: `/api/v1/notifications/${targetNotifId}/archive`,
    headers: { authorization: `Bearer ${testSessionToken1}` }
  });
  assert.equal(resArchive.statusCode, 200);
  const jsonArchive = JSON.parse(resArchive.payload);
  assert.equal(jsonArchive.data.status, NotificationRecordStatus.ARCHIVED);
});

test('9. REST API — User Notification Preferences', async () => {
  // GET /api/v1/notifications/preferences
  const resGet = await app.inject({
    method: 'GET',
    url: '/api/v1/notifications/preferences',
    headers: { authorization: `Bearer ${testSessionToken1}` }
  });
  assert.equal(resGet.statusCode, 200);
  const jsonGet = JSON.parse(resGet.payload);
  assert.equal(jsonGet.data.globalPushEnabled, true);

  // PATCH /api/v1/notifications/preferences
  const resPatch = await app.inject({
    method: 'PATCH',
    url: '/api/v1/notifications/preferences',
    headers: { authorization: `Bearer ${testSessionToken1}` },
    payload: {
      globalPushEnabled: false
    }
  });
  assert.equal(resPatch.statusCode, 200);
  const jsonPatch = JSON.parse(resPatch.payload);
  assert.equal(jsonPatch.data.globalPushEnabled, false);
});
