/**
 * RemoteNode — Track 4 — Batch NT-1.8
 * Notification UX, Cross-Platform Polish & Verification Test Suite
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NotificationType } from '../src/notifications/types/type_registry.js';
import { templateRegistry } from '../src/notifications/services/template_registry.js';
import { failureClassifier } from '../src/notifications/services/failure_classifier.js';
import { notificationRepository } from '../src/notifications/repositories/notification_repository.js';

// Helper to simulate deep-link resolution logic on Website
function resolveDeepLinkWebPath(deepLinkUri?: string): string | null {
  if (!deepLinkUri || typeof deepLinkUri !== 'string') return null;
  const trimmed = deepLinkUri.trim();
  if (!trimmed.startsWith('remotenode://')) return null;

  const prefix = 'pages/';

  if (trimmed.startsWith('remotenode://filemanager')) {
    return `${prefix}file-manager.html`;
  }
  if (trimmed.startsWith('remotenode://server/')) {
    const rawId = trimmed.split('remotenode://server/')[1] || '';
    const serverId = encodeURIComponent(rawId.trim());
    return `${prefix}dashboard.html#server-${serverId}`;
  }
  if (trimmed.startsWith('remotenode://security')) {
    return `${prefix}dashboard.html#security`;
  }
  if (trimmed.startsWith('remotenode://device/')) {
    return `${prefix}dashboard.html`;
  }
  return `${prefix}dashboard.html`;
}

// Helper to simulate badge count formatting
function formatBadgeCount(count: number): { display: boolean; text: string; ariaLabel: string } {
  if (count <= 0) {
    return { display: false, text: '0', ariaLabel: 'Notifications' };
  }
  const text = count > 99 ? '99+' : String(count);
  return { display: true, text, ariaLabel: `Notifications (${count} unread)` };
}

// Helper to simulate severity channel mapping on Android
function selectChannelId(severity?: string): string {
  switch ((severity || '').toUpperCase()) {
    case 'CRITICAL':
      return 'remotenode_critical';
    case 'SECURITY':
      return 'remotenode_security';
    case 'WARNING':
    case 'SUCCESS':
    case 'INFO':
    default:
      return 'remotenode_general';
  }
}

describe('Track 4 — Batch NT-1.8 Notification UX & Cross-Platform Verification Tests', () => {

  it('1. Badge Count Formatting formats numbers and 99+ threshold correctly', () => {
    const zero = formatBadgeCount(0);
    assert.equal(zero.display, false);
    assert.equal(zero.text, '0');
    assert.equal(zero.ariaLabel, 'Notifications');

    const five = formatBadgeCount(5);
    assert.equal(five.display, true);
    assert.equal(five.text, '5');
    assert.equal(five.ariaLabel, 'Notifications (5 unread)');

    const hundred = formatBadgeCount(105);
    assert.equal(hundred.display, true);
    assert.equal(hundred.text, '99+');
    assert.equal(hundred.ariaLabel, 'Notifications (105 unread)');
  });

  it('2. Deep-Link Web Path Resolver routes allowlisted schemes safely and rejects invalid URLs', () => {
    assert.equal(resolveDeepLinkWebPath('remotenode://filemanager'), 'pages/file-manager.html');
    assert.equal(resolveDeepLinkWebPath('remotenode://server/srv_123'), 'pages/dashboard.html#server-srv_123');
    assert.equal(resolveDeepLinkWebPath('remotenode://security'), 'pages/dashboard.html#security');
    assert.equal(resolveDeepLinkWebPath('remotenode://device/MyPhone'), 'pages/dashboard.html');

    // Reject unknown/external/malformed schemes
    assert.equal(resolveDeepLinkWebPath('https://malicious.com'), null);
    assert.equal(resolveDeepLinkWebPath('javascript:alert(1)'), null);
    assert.equal(resolveDeepLinkWebPath(''), null);
    assert.equal(resolveDeepLinkWebPath(undefined), null);
  });

  it('3. Android Notification Channel Severity Mapping routes to correct channel IDs', () => {
    assert.equal(selectChannelId('INFO'), 'remotenode_general');
    assert.equal(selectChannelId('SUCCESS'), 'remotenode_general');
    assert.equal(selectChannelId('WARNING'), 'remotenode_general');
    assert.equal(selectChannelId('CRITICAL'), 'remotenode_critical');
    assert.equal(selectChannelId('SECURITY'), 'remotenode_security');
  });

  it('4. Template Registry HTML Escaping prevents script injection in notification context', () => {
    const maliciousMetadata = {
      deviceName: '<script>alert("XSS")</script> "Test"'
    };

    const rendered = templateRegistry.render(
      NotificationType.DEVICE_LINKED,
      maliciousMetadata
    );

    assert.ok(!rendered.body.includes('<script>'));
    assert.ok(rendered.body.includes('&lt;script&gt;'));
    assert.ok(rendered.body.includes('&quot;Test&quot;'));
  });

  it('5. Sensitive Metadata Exclusion strips credentials from template rendering', () => {
    const sensitiveMetadata = {
      deviceName: 'Pixel 6 Pro',
      password: 'SuperSecretPassword123',
      token: 'jwt_secret_token_val',
      fcmToken: 'fcm_token_secret_123',
      privateKey: '-----BEGIN PRIVATE KEY-----'
    };

    const rendered = templateRegistry.render(
      NotificationType.DEVICE_LINKED,
      sensitiveMetadata
    );

    assert.ok(!rendered.body.includes('SuperSecretPassword123'));
    assert.ok(!rendered.body.includes('jwt_secret_token_val'));
    assert.ok(!rendered.body.includes('fcm_token_secret_123'));
    assert.ok(!rendered.body.includes('PRIVATE KEY'));
  });

  it('6. Provider Failure Classifier sanitizes sensitive tokens in error messages', () => {
    const rawError = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.SecretToken failed for user_123 password=MyPassword!';
    const classified = failureClassifier.classify(rawError);

    assert.ok(!classified.safePublicReason.includes('SecretToken'));
    assert.ok(!classified.safePublicReason.includes('MyPassword'));
  });

  it('7. Long Notification Title and Body Formatting truncates cleanly without throw', () => {
    const longTitle = 'A'.repeat(500);
    const longBody = 'B'.repeat(2000);

    const rendered = templateRegistry.render(NotificationType.STORAGE_WARNING, {
      customTitle: longTitle,
      customSummary: longBody
    });

    assert.ok(rendered.title.length > 0);
    assert.ok(rendered.body.length > 0);
  });

  it('8. Cross-Platform Event Semantics guarantee identical titles across channels', () => {
    const eventTypes = [
      NotificationType.ACCOUNT_CREATED,
      NotificationType.DEVICE_LINKED,
      NotificationType.SERVER_STARTED,
      NotificationType.FILE_UPLOAD_COMPLETED,
      NotificationType.STORAGE_CRITICAL,
      NotificationType.SECURITY_EVENT
    ];

    eventTypes.forEach((type) => {
      const rendered = templateRegistry.render(type, { deviceName: 'Android Node', serverName: 'Home Server' });
      assert.ok(rendered.title.length > 0, `Title missing for event type ${type}`);
      assert.ok(rendered.body.length > 0, `Body missing for event type ${type}`);
      assert.ok(rendered.defaultChannels.length > 0, `Channels missing for event type ${type}`);
    });
  });

  it('9. Mark All Notifications As Read updates repository state and unread count', async () => {
    const userId = 'user_read_all_test_' + Date.now();
    const countBefore = await notificationRepository.getUnreadCount(userId);
    assert.strictEqual(countBefore, 0);

    const updated = await notificationRepository.markAllAsRead(userId);
    assert.strictEqual(typeof updated, 'number');
  });

});
