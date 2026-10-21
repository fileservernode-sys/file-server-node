// NOTE: These tests are NOT EXECUTED as per policy.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fs from 'node:fs';
import path from 'node:path';
import {
  CustomerActivityCategory,
  CustomerActivityEventType,
  CUSTOMER_ACTIVITY_TAXONOMY,
  maskIpAddressForCustomerDisplay,
  summarizeUserAgentForCustomerDisplay,
  sanitizeCustomerActivityMetadata,
  isProhibitedActivityMetadataKey
} from '../src/services/activity/customer_activity_taxonomy.js';
import {
  CustomerActivityService,
  serializeCustomerActivityEvent,
  resolveCustomerActivitySeverity
} from '../src/services/activity/customer_activity_service.js';
import { accountEventProducer } from '../src/notifications/producers/account_producer.js';
import { activityRoutes } from '../src/routes/activity.js';
import { globalErrorHandler } from '../src/middleware/error-handler.js';
import { CUSTOMER_SESSION_COOKIE_NAME } from '../src/config/cookie.js';
import { hashSessionToken } from '../src/utils/crypto.js';

// Hoisted mocks for database and notifications
const { mockPrisma, mockNotificationService } = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn()
    },
    userSession: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn()
    },
    customerActivityEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn()
    },
    auditEvent: {
      create: vi.fn()
    }
  },
  mockNotificationService: {
    dispatchEvent: vi.fn()
  }
}));

vi.mock('../src/config/database.js', () => ({
  prisma: mockPrisma
}));

vi.mock('../src/notifications/services/notification_service.js', () => ({
  notificationService: mockNotificationService
}));

describe('ZDEXCLOUD PHASE 10.5: SECURITY ACTIVITY AND ACCOUNT SECURITY HISTORY', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // 1. TAXONOMY SPECIFICATION & SECURITY EVENTS
  // ===========================================================================
  describe('1. Security Event Taxonomy & Allowlists', () => {
    const requiredSecurityEventTypes = [
      CustomerActivityEventType.SECURITY_PASSWORD_CHANGED,
      CustomerActivityEventType.SECURITY_PASSWORD_RESET_COMPLETED,
      CustomerActivityEventType.SECURITY_PASSWORD_RESET_REQUESTED,
      CustomerActivityEventType.AUTH_SIGN_IN_SUCCEEDED,
      CustomerActivityEventType.AUTH_SIGN_IN_FAILED,
      CustomerActivityEventType.AUTH_SIGN_OUT,
      CustomerActivityEventType.SECURITY_DEVICE_CREDENTIALS_REVOKED
    ];

    it('should have all 7 required security events registered under ACCOUNT_SECURITY category', () => {
      for (const eventType of requiredSecurityEventTypes) {
        const spec = CUSTOMER_ACTIVITY_TAXONOMY[eventType];
        expect(spec).toBeDefined();
        expect(spec.eventType).toBe(eventType);
        expect(spec.category).toBe(CustomerActivityCategory.ACCOUNT_SECURITY);
        expect(spec.title).toBeTruthy();
        expect(spec.descriptionTemplate).toBeTruthy();
      }
    });

    it('should assign appropriate customer severity levels to security events', () => {
      expect(resolveCustomerActivitySeverity(CustomerActivityEventType.SECURITY_PASSWORD_CHANGED)).toBe('WARNING');
      expect(resolveCustomerActivitySeverity(CustomerActivityEventType.SECURITY_PASSWORD_RESET_COMPLETED)).toBe('WARNING');
      expect(resolveCustomerActivitySeverity(CustomerActivityEventType.SECURITY_PASSWORD_RESET_REQUESTED)).toBe('WARNING');
      expect(resolveCustomerActivitySeverity(CustomerActivityEventType.SECURITY_DEVICE_CREDENTIALS_REVOKED)).toBe('WARNING');
      expect(resolveCustomerActivitySeverity(CustomerActivityEventType.AUTH_SIGN_IN_FAILED)).toBe('WARNING');
      expect(resolveCustomerActivitySeverity(CustomerActivityEventType.AUTH_SIGN_IN_SUCCEEDED)).toBe('INFO');
      expect(resolveCustomerActivitySeverity(CustomerActivityEventType.AUTH_SIGN_OUT)).toBe('INFO');
    });

    it('should allow reasonLabel in metadata for AUTH_SIGN_IN_FAILED and SECURITY_DEVICE_CREDENTIALS_REVOKED', () => {
      const failedSpec = CUSTOMER_ACTIVITY_TAXONOMY[CustomerActivityEventType.AUTH_SIGN_IN_FAILED];
      expect(failedSpec.allowedMetadataKeys).toContain('reasonLabel');

      const revokeSpec = CUSTOMER_ACTIVITY_TAXONOMY[CustomerActivityEventType.SECURITY_DEVICE_CREDENTIALS_REVOKED];
      expect(revokeSpec.allowedMetadataKeys).toContain('reasonLabel');
    });
  });

  // ===========================================================================
  // 2. DATA MINIMIZATION, SANITIZATION & SECRET EXCLUSION
  // ===========================================================================
  describe('2. Data Minimization, IP Masking, and Prohibited Key Stripping', () => {
    it('should strip secret and credential keys matching prohibited substrings', () => {
      expect(isProhibitedActivityMetadataKey('password')).toBe(true);
      expect(isProhibitedActivityMetadataKey('passwordHash')).toBe(true);
      expect(isProhibitedActivityMetadataKey('otp')).toBe(true);
      expect(isProhibitedActivityMetadataKey('csrfToken')).toBe(true);
      expect(isProhibitedActivityMetadataKey('sessionToken')).toBe(true);
      expect(isProhibitedActivityMetadataKey('secretKey')).toBe(true);
      expect(isProhibitedActivityMetadataKey('rawHeaders')).toBe(true);

      // Safe keys should not be prohibited
      expect(isProhibitedActivityMetadataKey('sessionsInvalidated')).toBe(false);
      expect(isProhibitedActivityMetadataKey('reasonLabel')).toBe(false);
    });

    it('should mask IPv4 and IPv6 addresses for customer activity display', () => {
      expect(maskIpAddressForCustomerDisplay('192.168.1.105')).toBe('192.168.1.xxx');
      expect(maskIpAddressForCustomerDisplay('10.0.0.1')).toBe('10.0.0.xxx');
      expect(maskIpAddressForCustomerDisplay('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe('2001:db8:85a3:****');
      expect(maskIpAddressForCustomerDisplay('')).toBe('masked');
      expect(maskIpAddressForCustomerDisplay(null as any)).toBe('masked');
    });

    it('should summarize raw User-Agent headers into concise labels', () => {
      const chromeUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      const safariUa = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
      const androidUa = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

      expect(summarizeUserAgentForCustomerDisplay(chromeUa)).toContain('Chrome');
      expect(summarizeUserAgentForCustomerDisplay(safariUa)).toContain('Safari');
      expect(summarizeUserAgentForCustomerDisplay(androidUa)).toContain('Android');
      expect(summarizeUserAgentForCustomerDisplay(undefined)).toBe('Web Browser');
    });

    it('should sanitize metadata on event recording, removing non-allowlisted and secret keys', () => {
      const sanitized = sanitizeCustomerActivityMetadata(
        CustomerActivityEventType.SECURITY_PASSWORD_CHANGED,
        {
          sessionsInvalidated: true,
          revokedSessions: 3,
          newPassword: 'SuperSecretPassword123!', // Prohibited
          passwordHash: '$scrypt$ln=16384,r=8,p=1$...', // Prohibited
          csrfToken: 'csrf-token-12345', // Prohibited
          unknownKey: 'some value' // Not in allowlist
        }
      );

      expect(sanitized).toEqual({
        sessionsInvalidated: true,
        revokedSessions: 3
      });
      expect((sanitized as any).newPassword).toBeUndefined();
      expect((sanitized as any).passwordHash).toBeUndefined();
      expect((sanitized as any).csrfToken).toBeUndefined();
      expect((sanitized as any).unknownKey).toBeUndefined();
    });

    it('should re-sanitize metadata and omit internal columns in serializeCustomerActivityEvent', () => {
      const row = {
        id: 'evt_1234567890123456',
        userId: 'usr_secret_id',
        eventType: CustomerActivityEventType.SECURITY_PASSWORD_RESET_COMPLETED,
        title: 'Password Reset Completed',
        description: 'Your account password was reset and all active sessions were invalidated.',
        severity: 'WARNING',
        occurredAt: new Date('2026-10-15T10:00:00Z'),
        createdAt: new Date('2026-10-15T10:00:01Z'),
        idempotencyKey: 'idemp_key_123',
        metadata: {
          sessionsInvalidated: true,
          rawIp: '192.168.1.50', // Prohibited key
          maskedIp: '192.168.1.50' // Should be masked on serialize
        }
      };

      const serialized = serializeCustomerActivityEvent(row);
      expect(serialized).not.toBeNull();
      expect(serialized!.id).toBe('evt_1234567890123456');
      expect(serialized!.eventType).toBe(CustomerActivityEventType.SECURITY_PASSWORD_RESET_COMPLETED);
      expect(serialized!.category).toBe(CustomerActivityCategory.ACCOUNT_SECURITY);
      expect(serialized!.occurredAt).toBe('2026-10-15T10:00:00.000Z');

      // Internal fields must never be exposed
      expect((serialized as any).userId).toBeUndefined();
      expect((serialized as any).idempotencyKey).toBeUndefined();
      expect((serialized as any).createdAt).toBeUndefined();
    });
  });

  // ===========================================================================
  // 3. NON-BLOCKING FAILURE ISOLATION
  // ===========================================================================
  describe('3. Failure Isolation and Business Continuity', () => {
    it('recordEventSafe should never throw or reject when database fails', async () => {
      mockPrisma.customerActivityEvent.create.mockRejectedValueOnce(new Error('DB connection reset'));

      const result = await CustomerActivityService.recordEventSafe({
        userId: 'usr_test_123',
        eventType: CustomerActivityEventType.SECURITY_PASSWORD_CHANGED,
        metadata: { sessionsInvalidated: true }
      });

      expect(result.recorded).toBe(false);
      expect(result.reason).toBe('PERSISTENCE_ERROR');
    });

    it('emitSecurityEvent should catch errors and never reject caller', async () => {
      mockNotificationService.dispatchEvent.mockRejectedValueOnce(new Error('Notification service down'));

      // Must resolve without throwing
      await expect(
        accountEventProducer.emitSecurityEvent('usr_123', 'Password changed successfully')
      ).resolves.toBeUndefined();
    });
  });

  // ===========================================================================
  // 4. API ROUTE GET /api/v1/account/activity?category=ACCOUNT_SECURITY
  // ===========================================================================
  describe('4. GET /api/v1/account/activity Route Integration', () => {
    let app: any;

    beforeEach(async () => {
      app = Fastify();
      await app.register(fastifyCookie);
      app.setErrorHandler(globalErrorHandler);
      await app.register(activityRoutes, { prefix: '/api/v1' });
      await app.ready();
    });

    it('should reject unauthenticated requests with 401', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/account/activity?category=ACCOUNT_SECURITY'
      });

      expect(response.statusCode).toBe(401);
      const json = JSON.parse(response.payload);
      expect(json.success).toBe(false);
    });

    it('should ignore any caller-supplied userId in query and derive user from session', async () => {
      const token = 'valid_session_token_12345678901234567890';
      const tokenHash = hashSessionToken(token);
      const authenticatedUserId = 'usr_owner_456';

      mockPrisma.userSession.findUnique.mockResolvedValueOnce({
        tokenHash,
        userId: authenticatedUserId,
        expiresAt: new Date(Date.now() + 3600000),
        user: {
          id: authenticatedUserId,
          email: 'owner@example.com',
          status: 'ACTIVE'
        }
      });

      mockPrisma.customerActivityEvent.findMany.mockResolvedValueOnce([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/account/activity?userId=usr_attacker_999&category=ACCOUNT_SECURITY',
        cookies: {
          [CUSTOMER_SESSION_COOKIE_NAME]: token
        }
      });

      expect(response.statusCode).toBe(200);
      const json = JSON.parse(response.payload);
      expect(json.success).toBe(true);

      // Verify Prisma was called strictly with the session's authenticatedUserId
      expect(mockPrisma.customerActivityEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: authenticatedUserId,
            category: CustomerActivityCategory.ACCOUNT_SECURITY
          })
        })
      );
    });

    it('should reject invalid non-taxonomy category parameters with 400', async () => {
      const token = 'valid_session_token_12345678901234567890';
      const tokenHash = hashSessionToken(token);

      mockPrisma.userSession.findUnique.mockResolvedValueOnce({
        tokenHash,
        userId: 'usr_123',
        expiresAt: new Date(Date.now() + 3600000),
        user: { id: 'usr_123', email: 'user@example.com', status: 'ACTIVE' }
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/account/activity?category=INVALID_INJECTED_CATEGORY',
        cookies: {
          [CUSTOMER_SESSION_COOKIE_NAME]: token
        }
      });

      expect(response.statusCode).toBe(400);
      const json = JSON.parse(response.payload);
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return security events with cache-busting headers', async () => {
      const token = 'valid_session_token_12345678901234567890';
      const tokenHash = hashSessionToken(token);

      mockPrisma.userSession.findUnique.mockResolvedValueOnce({
        tokenHash,
        userId: 'usr_123',
        expiresAt: new Date(Date.now() + 3600000),
        user: { id: 'usr_123', email: 'user@example.com', status: 'ACTIVE' }
      });

      mockPrisma.customerActivityEvent.findMany.mockResolvedValueOnce([
        {
          id: 'evt_sec_001',
          userId: 'usr_123',
          eventType: CustomerActivityEventType.SECURITY_PASSWORD_CHANGED,
          title: 'Password Changed',
          description: 'Your account password was updated from account settings and all active sessions were invalidated.',
          severity: 'WARNING',
          occurredAt: new Date('2026-10-15T09:30:00Z'),
          createdAt: new Date('2026-10-15T09:30:01Z'),
          idempotencyKey: 'idemp_sec_001',
          metadata: { sessionsInvalidated: true }
        }
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/account/activity?category=ACCOUNT_SECURITY&limit=5',
        cookies: {
          [CUSTOMER_SESSION_COOKIE_NAME]: token
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toContain('no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');

      const json = JSON.parse(response.payload);
      expect(json.success).toBe(true);
      expect(json.data.items).toHaveLength(1);
      expect(json.data.items[0].id).toBe('evt_sec_001');
      expect(json.data.items[0].occurredAt).toBe('2026-10-15T09:30:00.000Z');
      expect(json.data.items[0].category).toBe(CustomerActivityCategory.ACCOUNT_SECURITY);
      expect(json.data.items[0].severity).toBe('WARNING');
    });
  });

  // ===========================================================================
  // 5. FRONTEND INTEGRATION: SETTINGS AND ACTIVITY PAGES
  // ===========================================================================
  describe('5. Frontend Integration in settings.html and activity.html', () => {
    it('settings.html should have Recent Security Activity heading and category-filtered link', () => {
      const settingsPath = path.resolve(__dirname, '../../Frontend/pages/settings.html');
      expect(fs.existsSync(settingsPath)).toBe(true);

      const html = fs.readFileSync(settingsPath, 'utf8');

      // Check header and links
      expect(html).toContain('Recent Security Activity');
      expect(html).toContain('href="activity.html?category=ACCOUNT_SECURITY"');
      expect(html).toContain('Explore All Security Activity');

      // Check loadRecentActivityPreview implementation
      expect(html).toContain("apiFetch('/account/activity?category=ACCOUNT_SECURITY&limit=5'");
      expect(html).toContain('item.occurredAt || item.createdAt');
      expect(html).toContain('settings-pill--warning');
      expect(html).toContain('settings-pill--danger');
      expect(html).toContain('No security events recorded yet');
    });

    it('activity.html should parse category from URL query parameters on load', () => {
      const activityPath = path.resolve(__dirname, '../../Frontend/pages/activity.html');
      expect(fs.existsSync(activityPath)).toBe(true);

      const html = fs.readFileSync(activityPath, 'utf8');

      expect(html).toContain("data-category=\"ACCOUNT_SECURITY\"");
      expect(html).toContain("urlParams.get('category')");
      expect(html).toContain("selectCategory(initialCategory)");
      expect(html).toContain("url.searchParams.set('category', currentCategory)");
    });
  });
});
