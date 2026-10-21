// NOTE: These tests are NOT EXECUTED as per policy.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CustomerActivityService,
  summarizeUserAgentForCustomerDisplay
} from '../src/services/activity/customer_activity_service.js';
import {
  CustomerActivityCategory,
  CustomerActivityEventType,
  INTERNAL_ONLY_AUDIT_EVENT_TYPES
} from '../src/services/activity/customer_activity_taxonomy.js';
import { AuditEventType } from '@prisma/client';
import { ValidationError } from '../src/errors/app-error.js';

describe('Phase 9.2 — CustomerActivityService Backend Event Recording', () => {
  const mockDb: any = {
    customerActivityEvent: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn()
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.customerActivityEvent.findUnique.mockResolvedValue(null);
    mockDb.customerActivityEvent.findFirst.mockResolvedValue(null);
    mockDb.customerActivityEvent.create.mockImplementation(async ({ data }: any) => ({
      id: 'act_test_001',
      createdAt: new Date('2026-10-11T10:00:00.000Z'),
      ...data
    }));
  });

  describe('1. Recording Customer-Visible Events Across All Taxonomy Categories', () => {
    it('records AUTH.SIGN_IN_SUCCEEDED with masked IP and summarized userAgent', async () => {
      const res = await CustomerActivityService.recordEvent(
        {
          userId: 'user_123',
          eventType: CustomerActivityEventType.AUTH_SIGN_IN_SUCCEEDED,
          ipAddress: '203.0.113.45',
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0.0.0 Safari/537.36',
          metadata: {
            authMethod: 'PASSWORD'
          }
        },
        { db: mockDb }
      );

      expect(res.recorded).toBe(true);
      expect(res.event?.userId).toBe('user_123');
      expect(res.event?.eventType).toBe('AUTH.SIGN_IN_SUCCEEDED');
      expect(res.event?.category).toBe(CustomerActivityCategory.ACCOUNT_SECURITY);
      expect(res.event?.severity).toBe('INFO');
      expect(res.event?.title).toBe('Signed In to Account');
      expect((res.event?.metadata as any).maskedIp).toBe('203.0.113.xxx');
      expect((res.event?.metadata as any).userAgentSummary).toBe('Chrome on Windows');
      expect((res.event?.metadata as any).authMethod).toBe('PASSWORD');
    });

    it('records ACCOUNT.CREATED and ACCOUNT.EMAIL_VERIFIED', async () => {
      const created = await CustomerActivityService.recordEvent(
        {
          userId: 'user_123',
          eventType: CustomerActivityEventType.ACCOUNT_CREATED,
          idempotencyKey: 'account_created_user_123',
          metadata: { email: 'alice@example.com' }
        },
        { db: mockDb }
      );

      expect(created.recorded).toBe(true);
      expect(created.event?.category).toBe(CustomerActivityCategory.ACCOUNT_SECURITY);
      expect(created.event?.title).toBe('Account Created');
      expect((created.event?.metadata as any).email).toBe('alice@example.com');

      const verified = await CustomerActivityService.recordEvent(
        {
          userId: 'user_123',
          eventType: CustomerActivityEventType.ACCOUNT_EMAIL_VERIFIED,
          idempotencyKey: 'account_email_verified_user_123',
          metadata: { email: 'alice@example.com' }
        },
        { db: mockDb }
      );

      expect(verified.recorded).toBe(true);
      expect(verified.event?.category).toBe(CustomerActivityCategory.ACCOUNT_SECURITY);
      expect(verified.event?.title).toBe('Email Address Verified');
    });

    it('records SECURITY.PASSWORD_RESET_COMPLETED with WARNING severity', async () => {
      const pwdReset = await CustomerActivityService.recordEvent(
        {
          userId: 'user_123',
          eventType: CustomerActivityEventType.SECURITY_PASSWORD_RESET_COMPLETED,
          ipAddress: '198.51.100.77',
          metadata: { revokedSessions: true }
        },
        { db: mockDb }
      );

      expect(pwdReset.recorded).toBe(true);
      expect(pwdReset.event?.category).toBe(CustomerActivityCategory.ACCOUNT_SECURITY);
      expect(pwdReset.event?.severity).toBe('WARNING');
      expect((pwdReset.event?.metadata as any).maskedIp).toBe('198.51.100.xxx');
    });

    it('records DEVICE.LINKED and SERVER.STARTED with interpolated customer-safe descriptions', async () => {
      const deviceLinked = await CustomerActivityService.recordEvent(
        {
          userId: 'user_123',
          eventType: CustomerActivityEventType.DEVICE_LINKED,
          deviceId: 'dev_01',
          metadata: {
            deviceName: 'Home NAS Box',
            deviceType: 'LINUX_DESKTOP'
          }
        },
        { db: mockDb }
      );

      expect(deviceLinked.recorded).toBe(true);
      expect(deviceLinked.event?.category).toBe(CustomerActivityCategory.SERVERS_DEVICES);
      expect(deviceLinked.event?.deviceId).toBe('dev_01');
      expect(deviceLinked.event?.description).toContain('Home NAS Box');

      const serverStarted = await CustomerActivityService.recordEvent(
        {
          userId: 'user_123',
          eventType: CustomerActivityEventType.SERVER_STARTED,
          serverId: 'srv_01',
          deviceId: 'dev_01',
          previousState: 'OFFLINE',
          nextState: 'ONLINE',
          metadata: {
            serverName: 'Media Vault',
            deviceName: 'Home NAS Box'
          }
        },
        { db: mockDb }
      );

      expect(serverStarted.recorded).toBe(true);
      expect(serverStarted.event?.category).toBe(CustomerActivityCategory.SERVERS_DEVICES);
      expect(serverStarted.event?.serverId).toBe('srv_01');
      expect(serverStarted.event?.description).toContain('Media Vault');
    });

    it('records FILE.UPLOADED with safe file metadata', async () => {
      const fileUploaded = await CustomerActivityService.recordEvent(
        {
          userId: 'user_123',
          eventType: CustomerActivityEventType.FILE_UPLOADED,
          serverId: 'srv_01',
          metadata: {
            serverName: 'Media Vault',
            fileName: 'quarterly-report.pdf',
            targetDirectory: '/documents',
            fileSizeBytes: 524288
          }
        },
        { db: mockDb }
      );

      expect(fileUploaded.recorded).toBe(true);
      expect(fileUploaded.event?.category).toBe(CustomerActivityCategory.FILE_ACCESS);
      expect(fileUploaded.event?.description).toContain('quarterly-report.pdf');
      expect((fileUploaded.event?.metadata as any).fileSizeBytes).toBe(524288);
    });

    it('records BILLING.INVOICE_ISSUED with invoice linkage and formattedAmount', async () => {
      const invIssued = await CustomerActivityService.recordEvent(
        {
          userId: 'user_123',
          eventType: CustomerActivityEventType.INVOICE_ISSUED,
          invoiceId: 'inv_001',
          paymentId: 'pay_001',
          subscriptionId: 'sub_001',
          idempotencyKey: 'invoice_issued_inv_001',
          metadata: {
            invoiceNumber: 'ZDX-IN-2026-000042',
            currency: 'INR',
            totalMinorUnits: 49900
          }
        },
        { db: mockDb }
      );

      expect(invIssued.recorded).toBe(true);
      expect(invIssued.event?.category).toBe(CustomerActivityCategory.BILLING_INVOICES);
      expect(invIssued.event?.invoiceId).toBe('inv_001');
      expect(invIssued.event?.description).toContain('ZDX-IN-2026-000042');
      expect((invIssued.event?.metadata as any).formattedAmount).toBe('INR 499.00');
    });

    it('records NOTIFICATION.PREFERENCES_UPDATED', async () => {
      const prefUpdated = await CustomerActivityService.recordEvent(
        {
          userId: 'user_123',
          eventType: CustomerActivityEventType.NOTIFICATION_PREFERENCES_UPDATED,
          metadata: {
            globalPushEnabled: true,
            globalEmailEnabled: true
          }
        },
        { db: mockDb }
      );

      expect(prefUpdated.recorded).toBe(true);
      expect(prefUpdated.event?.category).toBe(CustomerActivityCategory.NOTIFICATIONS);
      expect((prefUpdated.event?.metadata as any).globalEmailEnabled).toBe(true);
    });
  });

  describe('2. Rejecting or Ignoring Internal-Only / Non-Customer-Visible Events', () => {
    it('rejects unknown or internal-only event types in recordEvent when throwOnError is true', async () => {
      for (const internalType of INTERNAL_ONLY_AUDIT_EVENT_TYPES) {
        await expect(
          CustomerActivityService.recordEvent(
            {
              userId: 'user_123',
              eventType: internalType
            },
            { db: mockDb, throwOnError: true }
          )
        ).rejects.toThrow(ValidationError);
      }
      expect(mockDb.customerActivityEvent.create).not.toHaveBeenCalled();
    });

    it('returns recorded: false without writing to DB in recordFromAuditEvent for internal-only AuditEventTypes', async () => {
      const internalAuditEvents: string[] = [
        AuditEventType.OTP_SENT,
        AuditEventType.SUBSCRIPTION_UPGRADE_RECONCILIATION_MISMATCHED,
        AuditEventType.REFUND_REQUIRES_REVIEW
      ];

      for (const auditType of internalAuditEvents) {
        const res = await CustomerActivityService.recordFromAuditEvent(
          {
            userId: 'user_123',
            auditEventType: auditType
          },
          { db: mockDb, throwOnError: true }
        );
        expect(res.recorded).toBe(false);
        expect(res.reason).toBe('UNKNOWN_OR_INTERNAL_EVENT_TYPE');
      }
      expect(mockDb.customerActivityEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('3. Metadata Sanitization & Sensitive Field Stripping', () => {
    it('strips all forbidden internal/secret keys and unwhitelisted keys before persistence', async () => {
      const res = await CustomerActivityService.recordEvent(
        {
          userId: 'user_123',
          eventType: CustomerActivityEventType.PAYMENT_SUCCEEDED,
          paymentId: 'pay_001',
          metadata: {
            planCode: 'PRO_MONTHLY',
            planName: 'Pro Monthly',
            currency: 'USD',
            amountMinorUnits: 999,
            passwordHash: '$2b$12$secret',
            rawToken: 'tok_secret_123',
            refreshToken: 'ref_secret_456',
            providerPaymentId: 'pay_RzpInternal999',
            providerSubscriptionId: 'sub_RzpInternal888',
            providerEventId: 'evt_RzpInternal777',
            razorpaySignature: 'hmac_sha256_sig',
            webhookSecret: 'whsec_12345',
            s3Key: 'invoices/2026/secret-key.pdf',
            storageKey: 'local/path/invoice.pdf',
            adminNotes: 'Internal ops note',
            stackTrace: 'Error at line 42',
            arbitraryUnwhitelistedField: 'should_be_dropped'
          }
        },
        { db: mockDb }
      );

      const savedMeta = res.event?.metadata as Record<string, unknown>;
      expect(savedMeta.planCode).toBe('PRO_MONTHLY');
      expect(savedMeta.planName).toBe('Pro Monthly');
      expect(savedMeta.currency).toBe('USD');
      expect(savedMeta.amountMinorUnits).toBe(999);
      expect(savedMeta.formattedAmount).toBe('USD 9.99');

      expect(savedMeta).not.toHaveProperty('passwordHash');
      expect(savedMeta).not.toHaveProperty('rawToken');
      expect(savedMeta).not.toHaveProperty('refreshToken');
      expect(savedMeta).not.toHaveProperty('providerPaymentId');
      expect(savedMeta).not.toHaveProperty('providerSubscriptionId');
      expect(savedMeta).not.toHaveProperty('providerEventId');
      expect(savedMeta).not.toHaveProperty('razorpaySignature');
      expect(savedMeta).not.toHaveProperty('webhookSecret');
      expect(savedMeta).not.toHaveProperty('s3Key');
      expect(savedMeta).not.toHaveProperty('storageKey');
      expect(savedMeta).not.toHaveProperty('adminNotes');
      expect(savedMeta).not.toHaveProperty('stackTrace');
      expect(savedMeta).not.toHaveProperty('arbitraryUnwhitelistedField');
    });

    it('summarizes User-Agent strings safely', () => {
      expect(summarizeUserAgentForCustomerDisplay('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Version/17.0 Safari/605.1.15')).toBe(
        'Safari on macOS'
      );
      expect(summarizeUserAgentForCustomerDisplay('Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0')).toBe(
        'Firefox on Linux'
      );
      expect(summarizeUserAgentForCustomerDisplay('curl/8.4.0')).toBe('CLI Client');
    });
  });

  describe('4. Enforcing User Ownership & userId Association', () => {
    it('rejects activity recording when userId is empty or missing', async () => {
      await expect(
        CustomerActivityService.recordEvent(
          {
            userId: '',
            eventType: CustomerActivityEventType.AUTH_SIGN_OUT
          },
          { db: mockDb, throwOnError: true }
        )
      ).rejects.toThrow(ValidationError);

      expect(mockDb.customerActivityEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('5. Idempotency, State-Transition Deduplication & Cooldown Suppression', () => {
    it('returns existing record without creating a duplicate when idempotencyKey already exists', async () => {
      const existingRecord = {
        id: 'act_existing_999',
        userId: 'user_123',
        eventType: CustomerActivityEventType.SUBSCRIPTION_ACTIVATED,
        idempotencyKey: 'sub_activated_sub_001'
      };
      mockDb.customerActivityEvent.findUnique.mockResolvedValueOnce(existingRecord);

      const result = await CustomerActivityService.recordEvent(
        {
          userId: 'user_123',
          eventType: CustomerActivityEventType.SUBSCRIPTION_ACTIVATED,
          subscriptionId: 'sub_001',
          idempotencyKey: 'sub_activated_sub_001',
          metadata: { planName: 'Pro Monthly' }
        },
        { db: mockDb }
      );

      expect(result.recorded).toBe(false);
      expect(result.deduplicated).toBe(true);
      expect(result.event).toBe(existingRecord);
      expect(mockDb.customerActivityEvent.create).not.toHaveBeenCalled();
    });

    it('recovers gracefully on concurrent P2002 unique constraint conflict for idempotencyKey', async () => {
      const raceWinner = {
        id: 'act_race_winner',
        userId: 'user_123',
        eventType: CustomerActivityEventType.INVOICE_ISSUED,
        idempotencyKey: 'invoice_issued_inv_001'
      };

      mockDb.customerActivityEvent.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(raceWinner);

      const p2002Error = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      mockDb.customerActivityEvent.create.mockRejectedValueOnce(p2002Error);

      const result = await CustomerActivityService.recordEvent(
        {
          userId: 'user_123',
          eventType: CustomerActivityEventType.INVOICE_ISSUED,
          invoiceId: 'inv_001',
          idempotencyKey: 'invoice_issued_inv_001',
          metadata: { invoiceNumber: 'ZDX-IN-2026-000001' }
        },
        { db: mockDb, throwOnError: true }
      );

      expect(result.recorded).toBe(false);
      expect(result.deduplicated).toBe(true);
      expect(result.event).toBe(raceWinner);
    });

    it('suppresses state-transition events when previousState equals nextState (heartbeat noise guard)', async () => {
      const result = await CustomerActivityService.recordEvent(
        {
          userId: 'user_123',
          eventType: CustomerActivityEventType.SERVER_STARTED,
          serverId: 'srv_01',
          previousState: 'ONLINE',
          nextState: 'ONLINE',
          metadata: { serverName: 'Prod Storage' }
        },
        { db: mockDb }
      );

      expect(result.recorded).toBe(false);
      expect(result.reason).toBe('NO_STATE_TRANSITION');
      expect(mockDb.customerActivityEvent.create).not.toHaveBeenCalled();
    });

    it('suppresses repeated events within taxonomy cooldownSeconds window for the same entity', async () => {
      const recentEvent = {
        id: 'act_recent_srv_start',
        userId: 'user_123',
        eventType: CustomerActivityEventType.SERVER_STARTED,
        serverId: 'srv_01',
        occurredAt: new Date()
      };
      mockDb.customerActivityEvent.findFirst.mockResolvedValueOnce(recentEvent);

      const result = await CustomerActivityService.recordEvent(
        {
          userId: 'user_123',
          eventType: CustomerActivityEventType.SERVER_STARTED,
          serverId: 'srv_01',
          previousState: 'OFFLINE',
          nextState: 'ONLINE',
          metadata: { serverName: 'Prod Storage' }
        },
        { db: mockDb }
      );

      expect(result.recorded).toBe(false);
      expect(result.reason).toBe('COOLDOWN_WINDOW_ACTIVE');
      expect(result.event).toBe(recentEvent);
      expect(mockDb.customerActivityEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('6. Non-Blocking Error Handling Policy', () => {
    it('does not throw when database write fails and throwOnError is false (default)', async () => {
      mockDb.customerActivityEvent.create.mockRejectedValueOnce(new Error('DB connection timeout'));

      const result = await CustomerActivityService.recordEventSafe(
        {
          userId: 'user_123',
          eventType: CustomerActivityEventType.AUTH_SIGN_OUT
        },
        { db: mockDb }
      );

      expect(result.recorded).toBe(false);
      expect(result.reason).toBe('PERSISTENCE_ERROR');
    });

    it('propagates error when throwOnError is explicitly set to true', async () => {
      mockDb.customerActivityEvent.create.mockRejectedValueOnce(new Error('DB connection timeout'));

      await expect(
        CustomerActivityService.recordEvent(
          {
            userId: 'user_123',
            eventType: CustomerActivityEventType.AUTH_SIGN_OUT
          },
          { db: mockDb, throwOnError: true }
        )
      ).rejects.toThrow('DB connection timeout');
    });
  });

  describe('7. Phase 9.5 — Privacy, Value-Level Secret Stripping, XSS Sanitization & IP Masking Hardening', () => {
    it('strips allowlisted metadata keys when their values contain embedded JWTs, hashes, provider secrets, stack traces, or host paths', async () => {
      const res = await CustomerActivityService.recordEvent(
        {
          userId: 'user_123',
          eventType: CustomerActivityEventType.PAYMENT_FAILED,
          subscriptionId: 'sub_001',
          paymentId: 'pay_internal_uuid',
          metadata: {
            planCode: 'PRO_MONTHLY',
            planName: 'Pro Monthly',
            currency: 'INR',
            amountMinorUnits: 49900,
            // Maliciously or accidentally stuffed diagnostic/secret string inside an allowlisted key:
            reasonSummary:
              'PrismaClientKnownRequestError: Invalid `prisma.payment.update()` invocation at /var/app/src/billing.ts:142:19'
          }
        },
        { db: mockDb }
      );

      expect(res.recorded).toBe(true);
      const savedMeta = res.event?.metadata as Record<string, unknown>;
      expect(savedMeta.planCode).toBe('PRO_MONTHLY');
      expect(savedMeta.planName).toBe('Pro Monthly');
      // Diagnostic stack trace / Prisma error value must be rejected and omitted
      expect(savedMeta).not.toHaveProperty('reasonSummary');
    });

    it('rejects embedded JWTs, bcrypt hashes, webhook secrets, and Windows/Linux filesystem paths inside metadata values', async () => {
      const jwtAttempt = await CustomerActivityService.recordEvent(
        {
          userId: 'user_123',
          eventType: CustomerActivityEventType.AUTH_SIGN_IN_FAILED,
          metadata: {
            reasonSummary: 'Token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzEyMyJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c rejected'
          }
        },
        { db: mockDb }
      );
      expect((jwtAttempt.event?.metadata as any).reasonSummary).toBeUndefined();

      const pathAttempt = await CustomerActivityService.recordEvent(
        {
          userId: 'user_123',
          eventType: CustomerActivityEventType.FILE_UPLOADED,
          serverId: 'srv_01',
          metadata: {
            fileName: 'report.pdf',
            targetDirectory: 'C:\\Users\\Administrator\\secrets\\vault',
            sizeBytes: Number.NaN,
            fileSizeBytes: Number.POSITIVE_INFINITY
          }
        },
        { db: mockDb }
      );
      const savedFileMeta = pathAttempt.event?.metadata as Record<string, unknown>;
      expect(savedFileMeta.fileName).toBe('report.pdf');
      // Windows host path and non-finite numbers must be dropped
      expect(savedFileMeta).not.toHaveProperty('targetDirectory');
      expect(savedFileMeta).not.toHaveProperty('sizeBytes');
      expect(savedFileMeta).not.toHaveProperty('fileSizeBytes');
    });

    it('sanitizes HTML/script payloads and dangerous URL schemes from titles, descriptions, and metadata on write', async () => {
      const res = await CustomerActivityService.recordEvent(
        {
          userId: 'user_123',
          eventType: CustomerActivityEventType.SERVER_RENAMED,
          serverId: 'srv_01',
          deviceId: 'dev_01',
          // Disallowed entity reference for SERVER_RENAMED + malformed ID with script tags:
          invoiceId: '<script>alert(1)</script>',
          titleOverride: '<img src=x onerror=alert(1)>File Server Renamed',
          descriptionOverride: 'Renamed server to <script>evil()</script> javascript:alert(document.cookie) from 192.0.2.88',
          metadata: {
            previousName: '<b>OldNode</b>',
            newName: '<script>alert("xss")</script> SafeNode',
            deviceName: 'Pixel 8'
          }
        },
        { db: mockDb }
      );

      expect(res.recorded).toBe(true);
      expect(res.event?.title).toBe('File Server Renamed');
      expect(res.event?.title).not.toContain('<img');
      expect(res.event?.description).not.toContain('<script>');
      expect(res.event?.description).not.toContain('javascript:');
      // Raw IPv4 inside description text is automatically masked
      expect(res.event?.description).toContain('192.0.2.xxx');
      expect(res.event?.description).not.toContain('192.0.2.88');
      // Disallowed/malformed entity reference is null
      expect(res.event?.invoiceId).toBeNull();

      const savedMeta = res.event?.metadata as Record<string, unknown>;
      expect(savedMeta.previousName).toBe('OldNode');
      expect(savedMeta.newName).toBe('alert("xss") SafeNode');
    });

    it('masks X-Forwarded-For chains, IPv4-mapped IPv6 addresses, IPv4 with port, and IPv6 addresses without leaking full IPs', async () => {
      const xffRes = await CustomerActivityService.recordEvent(
        {
          userId: 'user_123',
          eventType: CustomerActivityEventType.AUTH_SIGN_OUT,
          ipAddress: '203.0.113.195, 70.41.3.18, 150.172.238.178'
        },
        { db: mockDb }
      );
      expect((xffRes.event?.metadata as any).maskedIp).toBe('203.0.113.xxx');

      const mappedV6Res = await CustomerActivityService.recordEvent(
        {
          userId: 'user_123',
          eventType: CustomerActivityEventType.AUTH_SIGN_OUT,
          ipAddress: '::ffff:198.51.100.24:54321'
        },
        { db: mockDb }
      );
      expect((mappedV6Res.event?.metadata as any).maskedIp).toBe('198.51.100.xxx');

      const v6Res = await CustomerActivityService.recordEvent(
        {
          userId: 'user_123',
          eventType: CustomerActivityEventType.AUTH_SIGN_OUT,
          ipAddress: '2001:0db8:85a3:0000:0000:8a2e:0370:7334'
        },
        { db: mockDb }
      );
      expect((v6Res.event?.metadata as any).maskedIp).toBe('2001:0db8:85a3:****');
    });
  });
});
