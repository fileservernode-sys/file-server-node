/**
 * NOTE: These tests are NOT EXECUTED as per policy.
 *
 * RemoteNode — Track 4 — Batch NT-1.9: Notification Preferences Expansion
 * Unit & Integration Specification Test Suite for Phase 11.5
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getDefaultNotificationPreferences,
  normalizeNotificationPreferences,
  UserNotificationPreferences
} from '../src/notifications/types/preference.js';
import { NotificationCategory, ALL_NOTIFICATION_CATEGORIES } from '../src/notifications/types/category.js';
import { NotificationChannel, ALL_NOTIFICATION_CHANNELS } from '../src/notifications/types/channel.js';
import { NotificationType } from '../src/notifications/types/type_registry.js';
import { ChannelRouter } from '../src/notifications/services/channel_router.js';
import { NotificationEvent } from '../src/notifications/types/event.js';
import { NotificationSeverity } from '../src/notifications/types/severity.js';

describe('Phase 11.5: Notification Preferences Expansion Specifications (NOT EXECUTED)', () => {

  const testUserId = 'usr_pref_test_123';
  const router = new ChannelRouter();

  it('1. getDefaultNotificationPreferences supplies all 6 categories and documented channel defaults', () => {
    const prefs = getDefaultNotificationPreferences(testUserId);
    assert.equal(prefs.userId, testUserId);
    assert.equal(prefs.globalPushEnabled, true);
    assert.equal(prefs.globalEmailEnabled, true);

    for (const cat of ALL_NOTIFICATION_CATEGORIES) {
      assert.ok(prefs.categories[cat], `Missing category default: ${cat}`);
      assert.equal(prefs.categories[cat].enabled, true);
      assert.equal(prefs.categories[cat].channels[NotificationChannel.IN_APP], true);
      assert.equal(prefs.categories[cat].channels[NotificationChannel.PUSH], true);
    }

    // Specific category email defaults
    assert.equal(prefs.categories[NotificationCategory.ACCOUNT_SECURITY].channels[NotificationChannel.EMAIL], true);
    assert.equal(prefs.categories[NotificationCategory.BILLING].channels[NotificationChannel.EMAIL], true);
    assert.equal(prefs.categories[NotificationCategory.DEVICE_SERVER].channels[NotificationChannel.EMAIL], true);
    assert.equal(prefs.categories[NotificationCategory.STORAGE].channels[NotificationChannel.EMAIL], true);
    assert.equal(prefs.categories[NotificationCategory.FILE_OPERATIONS].channels[NotificationChannel.EMAIL], false);
    assert.equal(prefs.categories[NotificationCategory.SYSTEM].channels[NotificationChannel.EMAIL], false);
  });

  it('2. normalizeNotificationPreferences enriches older records missing BILLING or channel keys', () => {
    const legacyRecord: Partial<UserNotificationPreferences> = {
      globalPushEnabled: false,
      categories: {
        [NotificationCategory.ACCOUNT_SECURITY]: {
          enabled: true,
          channels: {
            [NotificationChannel.IN_APP]: true,
            [NotificationChannel.PUSH]: false,
            [NotificationChannel.EMAIL]: true
          }
        },
        [NotificationCategory.DEVICE_SERVER]: {
          enabled: false,
          channels: {
            [NotificationChannel.IN_APP]: true,
            [NotificationChannel.PUSH]: false,
            [NotificationChannel.EMAIL]: false
          }
        }
      } as any
    };

    const normalized = normalizeNotificationPreferences(testUserId, legacyRecord);

    // Preserved existing values
    assert.equal(normalized.globalPushEnabled, false);
    assert.equal(normalized.categories[NotificationCategory.DEVICE_SERVER].enabled, false);

    // Enriched missing BILLING category with documented defaults
    assert.ok(normalized.categories[NotificationCategory.BILLING]);
    assert.equal(normalized.categories[NotificationCategory.BILLING].enabled, true);
    assert.equal(normalized.categories[NotificationCategory.BILLING].channels[NotificationChannel.EMAIL], true);
    assert.equal(normalized.categories[NotificationCategory.BILLING].channels[NotificationChannel.IN_APP], true);
  });

  it('3. normalizeNotificationPreferences enforces mandatory security policy invariants', () => {
    // Attempt to disable ACCOUNT_SECURITY or its mandatory channels
    const hostileInput: Partial<UserNotificationPreferences> = {
      categories: {
        [NotificationCategory.ACCOUNT_SECURITY]: {
          enabled: false,
          channels: {
            [NotificationChannel.IN_APP]: false,
            [NotificationChannel.PUSH]: false,
            [NotificationChannel.EMAIL]: false
          }
        }
      } as any
    };

    const normalized = normalizeNotificationPreferences(testUserId, hostileInput);

    // Security invariant must prevail
    assert.equal(normalized.categories[NotificationCategory.ACCOUNT_SECURITY].enabled, true);
    assert.equal(normalized.categories[NotificationCategory.ACCOUNT_SECURITY].channels[NotificationChannel.IN_APP], true);
    assert.equal(normalized.categories[NotificationCategory.ACCOUNT_SECURITY].channels[NotificationChannel.EMAIL], true);
    // Push remains toggleable
    assert.equal(normalized.categories[NotificationCategory.ACCOUNT_SECURITY].channels[NotificationChannel.PUSH], false);
  });

  it('4. ChannelRouter enforces mandatory delivery for security-critical events (SIGN_IN, SECURITY_EVENT)', () => {
    // User attempted to disable email globally and all categories
    const disabledPrefs: UserNotificationPreferences = {
      userId: testUserId,
      globalPushEnabled: false,
      globalEmailEnabled: false,
      categories: {
        [NotificationCategory.ACCOUNT_SECURITY]: {
          enabled: false,
          channels: {
            [NotificationChannel.IN_APP]: false,
            [NotificationChannel.PUSH]: false,
            [NotificationChannel.EMAIL]: false
          }
        }
      } as any,
      updatedAt: new Date()
    };

    const signInEvent: NotificationEvent = {
      eventId: 'evt_sec_1',
      userId: testUserId,
      eventType: NotificationType.SIGN_IN,
      category: NotificationCategory.ACCOUNT_SECURITY,
      severity: NotificationSeverity.SECURITY,
      metadata: { ipAddress: '192.168.1.1' },
      idempotencyKey: 'idemp_sec_1',
      occurredAt: new Date(),
      source: 'test'
    };

    const decision = router.evaluateRouting(signInEvent, disabledPrefs, []);

    // Mandatory channels bypass user preference suppression
    assert.ok(decision.allowedChannels.includes(NotificationChannel.IN_APP));
    assert.ok(decision.allowedChannels.includes(NotificationChannel.EMAIL));
    assert.equal(decision.securityBypassTriggered, true);
  });

  it('5. ChannelRouter respects user disablement for ordinary categories (BILLING, STORAGE, DEVICE_SERVER)', () => {
    const prefs = getDefaultNotificationPreferences(testUserId);
    // Disable BILLING category
    prefs.categories[NotificationCategory.BILLING].enabled = false;

    const billingEvent: NotificationEvent = {
      eventId: 'evt_bill_1',
      userId: testUserId,
      eventType: NotificationType.PAYMENT_SUCCEEDED,
      category: NotificationCategory.BILLING,
      severity: NotificationSeverity.SUCCESS,
      metadata: { amount: 500 },
      idempotencyKey: 'idemp_bill_1',
      occurredAt: new Date(),
      source: 'test'
    };

    const decision = router.evaluateRouting(billingEvent, prefs, [{ deviceId: 'dev_1', pushToken: 'token_1' }]);

    // Outbound channels suppressed, in-app history preserved
    assert.ok(decision.allowedChannels.includes(NotificationChannel.IN_APP));
    assert.equal(decision.allowedChannels.includes(NotificationChannel.PUSH), false);
    assert.equal(decision.allowedChannels.includes(NotificationChannel.EMAIL), false);
    assert.equal(decision.securityBypassTriggered, false);
    assert.equal(decision.suppressionReason, 'Category BILLING disabled by user preferences');
  });

  it('6. ChannelRouter respects individual channel toggles (Push and Email) for enabled categories', () => {
    const prefs = getDefaultNotificationPreferences(testUserId);
    // Enable STORAGE category but turn off Push channel
    prefs.categories[NotificationCategory.STORAGE].channels[NotificationChannel.PUSH] = false;
    prefs.categories[NotificationCategory.STORAGE].channels[NotificationChannel.EMAIL] = true;

    const storageEvent: NotificationEvent = {
      eventId: 'evt_stor_1',
      userId: testUserId,
      eventType: NotificationType.STORAGE_WARNING,
      category: NotificationCategory.STORAGE,
      severity: NotificationSeverity.WARNING,
      metadata: { freeBytes: 1000 },
      idempotencyKey: 'idemp_stor_1',
      occurredAt: new Date(),
      source: 'test'
    };

    const decision = router.evaluateRouting(storageEvent, prefs, [{ deviceId: 'dev_1', pushToken: 'token_1' }]);

    assert.ok(decision.allowedChannels.includes(NotificationChannel.IN_APP));
    assert.ok(decision.allowedChannels.includes(NotificationChannel.EMAIL));
    assert.equal(decision.allowedChannels.includes(NotificationChannel.PUSH), false);
    assert.equal(decision.targetDevices.length, 0);
  });

  it('7. ChannelRouter preserves deduplication guard for INVOICE_ISSUED (EMAIL filtered from central dispatch)', () => {
    const prefs = getDefaultNotificationPreferences(testUserId);

    const invoiceEvent: NotificationEvent = {
      eventId: 'evt_inv_1',
      userId: testUserId,
      eventType: NotificationType.INVOICE_ISSUED,
      category: NotificationCategory.BILLING,
      severity: NotificationSeverity.SUCCESS,
      metadata: { invoiceId: 'inv_101' },
      idempotencyKey: 'idemp_inv_1',
      occurredAt: new Date(),
      source: 'test'
    };

    const decision = router.evaluateRouting(invoiceEvent, prefs, [{ deviceId: 'dev_1', pushToken: 'token_1' }]);

    // IN_APP and PUSH are allowed, EMAIL is suppressed to prevent duplication with dedicated invoice outbox worker
    assert.ok(decision.allowedChannels.includes(NotificationChannel.IN_APP));
    assert.ok(decision.allowedChannels.includes(NotificationChannel.PUSH));
    assert.equal(decision.allowedChannels.includes(NotificationChannel.EMAIL), false);
  });

  it('8. ChannelRouter preserves IN_APP history when all outbound channels are globally disabled', () => {
    const prefs = getDefaultNotificationPreferences(testUserId);
    prefs.globalPushEnabled = false;
    prefs.globalEmailEnabled = false;

    const serverEvent: NotificationEvent = {
      eventId: 'evt_srv_1',
      userId: testUserId,
      eventType: NotificationType.SERVER_STARTED,
      category: NotificationCategory.DEVICE_SERVER,
      severity: NotificationSeverity.INFO,
      metadata: { serverId: 'srv_1' },
      idempotencyKey: 'idemp_srv_1',
      occurredAt: new Date(),
      source: 'test'
    };

    const decision = router.evaluateRouting(serverEvent, prefs, [{ deviceId: 'dev_1', pushToken: 'token_1' }]);

    // Only IN_APP is allowed for history feed
    assert.deepEqual(decision.allowedChannels, [NotificationChannel.IN_APP]);
    assert.equal(decision.targetDevices.length, 0);
  });
});
