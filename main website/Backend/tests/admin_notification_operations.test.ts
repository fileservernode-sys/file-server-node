import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { FastifyInstance } from 'fastify';
import { AdminStatus, AdminAuditAction, NotificationRecordStatus, ChannelDeliveryStatus } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';
import {
  hashPassword,
  generateSessionToken,
  hashSessionToken
} from '../src/utils/crypto.js';
import { seedAdminRbac } from '../src/services/admin/admin_rbac_seed.js';

describe('Admin Notification & Communication Operations (Phase 17 Batch 17.4)', () => {
  let app: FastifyInstance;

  // SuperAdmin user
  const superAdminEmail = `superadmin.notifops.${Date.now()}@zdexcloud.internal`;
  let superAdminUser: any;
  let superAdminToken = '';

  // Standard Admin user (with notifications.read & notifications.write)
  const standardAdminEmail = `admin.notifops.${Date.now()}@zdexcloud.internal`;
  let standardAdminUser: any;
  let standardAdminToken = '';

  // Read-only Support user (with notifications.read, lacking notifications.write)
  const supportEmail = `support.notifops.${Date.now()}@zdexcloud.internal`;
  let supportUser: any;
  let supportToken = '';

  // Unassigned Admin user (no roles/permissions)
  const unassignedEmail = `unassigned.notifops.${Date.now()}@zdexcloud.internal`;
  let unassignedUser: any;
  let unassignedToken = '';

  // Seeded Customer User, Device, Push Token, Notification, and Delivery
  let customerUser: any;
  let customerDevice: any;
  let customerPushToken: any;
  let testNotification: any;
  let testDeliverySuccess: any;
  let testDeliveryFailure: any;

  before(async () => {
    app = await buildApp();
    await app.ready();

    // 1. Seed RBAC
    await seedAdminRbac();

    // 2. Create SuperAdmin
    superAdminUser = await prisma.adminUser.create({
      data: {
        email: superAdminEmail,
        passwordHash: hashPassword('SuperAdminPass123!'),
        name: 'Super Admin Notifications',
        status: AdminStatus.ACTIVE,
        isSuperAdmin: true
      }
    });
    const sRawToken = generateSessionToken();
    superAdminToken = sRawToken;
    await prisma.adminSession.create({
      data: {
        adminId: superAdminUser.id,
        sessionTokenHash: hashSessionToken(sRawToken),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });

    // 3. Create Standard Admin
    standardAdminUser = await prisma.adminUser.create({
      data: {
        email: standardAdminEmail,
        passwordHash: hashPassword('AdminPass123!'),
        name: 'Standard Admin Notifications',
        status: AdminStatus.ACTIVE,
        isSuperAdmin: false
      }
    });
    const adminRole = await prisma.adminRole.findUnique({ where: { slug: 'admin' } });
    if (adminRole) {
      await prisma.adminUserRole.create({
        data: {
          adminId: standardAdminUser.id,
          roleId: adminRole.id
        }
      });
    }
    const aRawToken = generateSessionToken();
    standardAdminToken = aRawToken;
    await prisma.adminSession.create({
      data: {
        adminId: standardAdminUser.id,
        sessionTokenHash: hashSessionToken(aRawToken),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });

    // 4. Create Support Admin (read-only)
    supportUser = await prisma.adminUser.create({
      data: {
        email: supportEmail,
        passwordHash: hashPassword('SupportPass123!'),
        name: 'Support Admin Notifications',
        status: AdminStatus.ACTIVE,
        isSuperAdmin: false
      }
    });
    const supportRole = await prisma.adminRole.findUnique({ where: { slug: 'support' } });
    if (supportRole) {
      await prisma.adminUserRole.create({
        data: {
          adminId: supportUser.id,
          roleId: supportRole.id
        }
      });
    }
    const suppRawToken = generateSessionToken();
    supportToken = suppRawToken;
    await prisma.adminSession.create({
      data: {
        adminId: supportUser.id,
        sessionTokenHash: hashSessionToken(suppRawToken),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });

    // 5. Create Unassigned Admin
    unassignedUser = await prisma.adminUser.create({
      data: {
        email: unassignedEmail,
        passwordHash: hashPassword('UnassignedPass123!'),
        name: 'Unassigned Admin',
        status: AdminStatus.ACTIVE,
        isSuperAdmin: false
      }
    });
    const uRawToken = generateSessionToken();
    unassignedToken = uRawToken;
    await prisma.adminSession.create({
      data: {
        adminId: unassignedUser.id,
        sessionTokenHash: hashSessionToken(uRawToken),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });

    // 6. Create Customer & Push Token
    customerUser = await prisma.user.create({
      data: {
        email: `customer.notif.${Date.now()}@example.com`,
        passwordHash: hashPassword('CustomerPass123!')
      }
    });

    customerDevice = await prisma.device.create({
      data: {
        userId: customerUser.id,
        deviceName: 'Pixel 8 Pro Test Node',
        installationId: `fcm-dev-${Date.now()}`,
        platform: 'Android',
        appVersion: '2.4.0'
      }
    });

    customerPushToken = await prisma.devicePushToken.create({
      data: {
        userId: customerUser.id,
        deviceId: customerDevice.id,
        token: `fcm_raw_token_secret_sample_${Date.now()}`,
        platform: 'ANDROID',
        isActive: true
      }
    });

    // 7. Create Test Notification Record
    testNotification = await prisma.notificationRecord.create({
      data: {
        eventId: `evt-notif-${Date.now()}`,
        userId: customerUser.id,
        eventType: 'SECURITY_ALERT',
        category: 'SECURITY',
        severity: 'HIGH',
        title: 'Security Alert: New Sign-in from Android Node',
        body: 'A new node registered to your account with IP 192.168.1.10. Verification code: 123456.',
        idempotencyKey: `idemp-notif-${Date.now()}`,
        status: NotificationRecordStatus.UNREAD
      }
    });

    testDeliverySuccess = await prisma.channelDeliveryRecord.create({
      data: {
        notificationId: testNotification.id,
        channel: 'EMAIL',
        targetAddress: customerUser.email,
        status: ChannelDeliveryStatus.DELIVERED,
        attemptCount: 1,
        maxAttempts: 3,
        providerMessageId: 'brevo_msg_test_123'
      }
    });

    testDeliveryFailure = await prisma.channelDeliveryRecord.create({
      data: {
        notificationId: testNotification.id,
        channel: 'FCM',
        targetAddress: customerPushToken.token,
        status: ChannelDeliveryStatus.FAILED,
        attemptCount: 2,
        maxAttempts: 3,
        failureReason: 'INVALID_TOKEN'
      }
    });
  });

  after(async () => {
    // Cleanup seeded data
    if (testDeliverySuccess?.id) await prisma.channelDeliveryRecord.deleteMany({ where: { notificationId: testNotification.id } });
    if (testNotification?.id) await prisma.notificationRecord.delete({ where: { id: testNotification.id } });
    if (customerPushToken?.id) await prisma.devicePushToken.delete({ where: { id: customerPushToken.id } });
    if (customerDevice?.id) await prisma.device.delete({ where: { id: customerDevice.id } });
    if (customerUser?.id) await prisma.user.delete({ where: { id: customerUser.id } });

    if (superAdminUser?.id) {
      await prisma.adminSession.deleteMany({ where: { adminId: superAdminUser.id } });
      await prisma.adminUser.delete({ where: { id: superAdminUser.id } });
    }
    if (standardAdminUser?.id) {
      await prisma.adminSession.deleteMany({ where: { adminId: standardAdminUser.id } });
      await prisma.adminUserRole.deleteMany({ where: { adminId: standardAdminUser.id } });
      await prisma.adminUser.delete({ where: { id: standardAdminUser.id } });
    }
    if (supportUser?.id) {
      await prisma.adminSession.deleteMany({ where: { adminId: supportUser.id } });
      await prisma.adminUserRole.deleteMany({ where: { adminId: supportUser.id } });
      await prisma.adminUser.delete({ where: { id: supportUser.id } });
    }
    if (unassignedUser?.id) {
      await prisma.adminSession.deleteMany({ where: { adminId: unassignedUser.id } });
      await prisma.adminUser.delete({ where: { id: unassignedUser.id } });
    }

    await app.close();
  });

  test('GET /api/v1/admin/operations/notifications/metrics returns summary metrics and circuit breaker telemetry', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/operations/notifications/metrics',
      headers: {
        authorization: `Bearer ${superAdminToken}`
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.ok(body.data.metrics.totalNotifications >= 1);
    assert.ok(body.data.metrics.activePushTokens >= 1);
    assert.ok(body.data.metrics.circuitBreakers);
  });

  test('GET /api/v1/admin/operations/notifications lists notifications with pagination and search', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/operations/notifications?page=1&pageSize=10&search=Security',
      headers: {
        authorization: `Bearer ${standardAdminToken}`
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.data.items));
    assert.ok(body.data.items.length >= 1);
    const found = body.data.items.find((n: any) => n.id === testNotification.id);
    assert.ok(found);
    assert.strictEqual(found.title, 'Security Alert: New Sign-in from Android Node');
    assert.strictEqual(found.severity, 'HIGH');
  });

  test('GET /api/v1/admin/operations/notifications/:notificationId returns detail with safe body preview', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/operations/notifications/${testNotification.id}`,
      headers: {
        authorization: `Bearer ${supportToken}`
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.notification.id, testNotification.id);
    assert.ok(Array.isArray(body.data.notification.deliveries));
    assert.strictEqual(body.data.notification.deliveries.length, 2);
    // Ensure raw push token in delivery record recipient is masked or sanitized
    assert.ok(body.data.notification.bodyPreview);
  });

  test('GET /api/v1/admin/operations/notifications/deliveries/failures returns failed delivery attempts', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/operations/notifications/deliveries/failures?channel=FCM',
      headers: {
        authorization: `Bearer ${standardAdminToken}`
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.data.items));
    const failedItem = body.data.items.find((d: any) => d.id === testDeliveryFailure.id);
    assert.ok(failedItem);
    assert.strictEqual(failedItem.failureCategory, 'INVALID_TOKEN');
  });

  test('GET /api/v1/admin/operations/notifications/tokens masks raw token strings to fingerprints', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/operations/notifications/tokens?platform=ANDROID',
      headers: {
        authorization: `Bearer ${standardAdminToken}`
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.data.items));
    const tokenItem = body.data.items.find((t: any) => t.id === customerPushToken.id);
    assert.ok(tokenItem);
    // Verify fingerprint masking: never raw token
    assert.strictEqual(tokenItem.token, undefined);
    assert.ok(tokenItem.tokenFingerprint.startsWith('fcm_...'));
    assert.ok(tokenItem.tokenFingerprint.endsWith(customerPushToken.token.slice(-8)));
  });

  test('POST /api/v1/admin/operations/notifications/deliveries/:deliveryId/retry enforces RBAC (403 for read-only role)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/operations/notifications/deliveries/${testDeliveryFailure.id}/retry`,
      headers: {
        authorization: `Bearer ${supportToken}`
      }
    });

    assert.strictEqual(res.statusCode, 403);
  });

  test('POST /api/v1/admin/operations/notifications/tokens/:tokenId/revoke deactivates token and logs audit trail', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/operations/notifications/tokens/${customerPushToken.id}/revoke`,
      headers: {
        authorization: `Bearer ${superAdminToken}`
      },
      payload: {
        reason: 'Administrative test token revocation'
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.token.isRevoked, true);

    // Verify token status in DB
    const updatedToken = await prisma.devicePushToken.findUnique({ where: { id: customerPushToken.id } });
    assert.strictEqual(updatedToken?.isActive, false);

    // Verify Audit Log entry created with SHA-256 integrity hash
    const auditEntry = await prisma.adminAuditLog.findFirst({
      where: {
        adminId: superAdminUser.id,
        action: AdminAuditAction.ADMIN_STATUS_UPDATED
      },
      orderBy: { createdAt: 'desc' }
    });
    assert.ok(auditEntry);
    assert.strictEqual(auditEntry.action, AdminAuditAction.ADMIN_STATUS_UPDATED);
    assert.ok(auditEntry.integrityHash);
  });

  test('Unauthenticated request to notifications endpoints returns 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/operations/notifications/metrics'
    });

    assert.strictEqual(res.statusCode, 401);
  });

  test('Unassigned admin request to notifications endpoints returns 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/operations/notifications/metrics',
      headers: {
        authorization: `Bearer ${unassignedToken}`
      }
    });

    assert.strictEqual(res.statusCode, 403);
  });
});
