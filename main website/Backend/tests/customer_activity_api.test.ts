// NOTE: These tests are NOT EXECUTED as per policy.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CustomerActivityService,
  decodeActivityCursor,
  encodeActivityCursor,
  serializeCustomerActivityEvent
} from '../src/services/activity/customer_activity_service.js';
import {
  CustomerActivityCategory,
  CustomerActivityEventType,
  INTERNAL_ONLY_AUDIT_EVENT_TYPES
} from '../src/services/activity/customer_activity_taxonomy.js';
import { AppError, UnauthorizedError, ValidationError } from '../src/errors/app-error.js';

describe('Phase 9.3 & 9.5 — Customer Activity History API & Privacy/Security Filtering (GET /api/v1/account/activity)', () => {
  const mockDb: any = {
    customerActivityEvent: {
      findMany: vi.fn()
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.customerActivityEvent.findMany.mockResolvedValue([]);
  });

  describe('1. Unauthenticated Requests', () => {
    it('rejects requests when authenticatedUserId is missing or empty with UnauthorizedError', async () => {
      await expect(
        CustomerActivityService.listUserActivity('', {}, { db: mockDb })
      ).rejects.toThrow(UnauthorizedError);

      await expect(
        CustomerActivityService.listUserActivity('   ', {}, { db: mockDb })
      ).rejects.toThrow(UnauthorizedError);

      expect(mockDb.customerActivityEvent.findMany).not.toHaveBeenCalled();
    });
  });

  describe('2. Strict Customer Ownership Isolation', () => {
    it('scopes every database query strictly to authenticatedUserId and never exposes another customer’s events', async () => {
      mockDb.customerActivityEvent.findMany.mockResolvedValueOnce([
        {
          id: 'act_user_a_1',
          userId: 'user_alice',
          eventType: CustomerActivityEventType.AUTH_SIGN_IN_SUCCEEDED,
          category: CustomerActivityCategory.ACCOUNT_SECURITY,
          severity: 'INFO',
          title: 'Signed In to Account',
          description: 'Signed in to your ZdexCloud account from Chrome on Windows (203.0.113.xxx).',
          occurredAt: new Date('2026-10-11T11:00:00.000Z'),
          createdAt: new Date('2026-10-11T11:00:00.000Z'),
          metadata: { maskedIp: '203.0.113.xxx', userAgentSummary: 'Chrome on Windows' }
        },
        // Defensive check: even if a mocked/faulty adapter returned a mismatched userId row, it is filtered out
        {
          id: 'act_user_b_leak',
          userId: 'user_bob',
          eventType: CustomerActivityEventType.AUTH_SIGN_IN_SUCCEEDED,
          category: CustomerActivityCategory.ACCOUNT_SECURITY,
          severity: 'INFO',
          title: 'Signed In to Account',
          description: 'Bob sign in',
          occurredAt: new Date('2026-10-11T10:59:00.000Z'),
          createdAt: new Date('2026-10-11T10:59:00.000Z'),
          metadata: {}
        }
      ]);

      const result = await CustomerActivityService.listUserActivity(
        'user_alice',
        // Attempting to pass a spoofed userId in params has no effect
        { limit: 20, ...({ userId: 'user_bob' } as any) },
        { db: mockDb }
      );

      expect(mockDb.customerActivityEvent.findMany).toHaveBeenCalledTimes(1);
      const queryArgs = mockDb.customerActivityEvent.findMany.mock.calls[0][0];
      expect(queryArgs.where.userId).toBe('user_alice');

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('act_user_a_1');
    });
  });

  describe('3. Cursor Pagination & Deterministic Ordering', () => {
    it('orders newest first with deterministic (occurredAt DESC, id DESC) tie-breaker and computes nextCursor when hasMore is true', async () => {
      const t1 = new Date('2026-10-11T12:00:00.000Z');
      const t2 = new Date('2026-10-11T12:00:00.000Z'); // Identical timestamp tie
      const t3 = new Date('2026-10-11T11:30:00.000Z');

      mockDb.customerActivityEvent.findMany.mockResolvedValueOnce([
        {
          id: 'act_003',
          userId: 'user_alice',
          eventType: CustomerActivityEventType.FILE_UPLOADED,
          category: CustomerActivityCategory.FILE_ACCESS,
          severity: 'INFO',
          title: 'File Uploaded',
          description: 'Uploaded "slides.pdf" to "/docs" on server "Home Server".',
          serverId: 'srv_1',
          occurredAt: t1,
          metadata: { fileName: 'slides.pdf', targetDirectory: '/docs', serverName: 'Home Server' }
        },
        {
          id: 'act_002',
          userId: 'user_alice',
          eventType: CustomerActivityEventType.FOLDER_CREATED,
          category: CustomerActivityCategory.FILE_ACCESS,
          severity: 'INFO',
          title: 'Folder Created',
          description: 'Created folder "docs" in "/" on server "Home Server".',
          serverId: 'srv_1',
          occurredAt: t2,
          metadata: { folderName: 'docs', parentDirectory: '/', serverName: 'Home Server' }
        },
        {
          id: 'act_001',
          userId: 'user_alice',
          eventType: CustomerActivityEventType.SERVER_STARTED,
          category: CustomerActivityCategory.SERVERS_DEVICES,
          severity: 'INFO',
          title: 'File Server Started',
          description: 'File server "Home Server" is now online.',
          serverId: 'srv_1',
          occurredAt: t3,
          metadata: { serverName: 'Home Server' }
        }
      ]);

      const page1 = await CustomerActivityService.listUserActivity(
        'user_alice',
        { limit: 2 },
        { db: mockDb }
      );

      const queryArgs = mockDb.customerActivityEvent.findMany.mock.calls[0][0];
      expect(queryArgs.orderBy).toEqual([{ occurredAt: 'desc' }, { id: 'desc' }]);
      expect(queryArgs.take).toBe(3); // limit + 1

      expect(page1.items).toHaveLength(2);
      expect(page1.items[0].id).toBe('act_003');
      expect(page1.items[1].id).toBe('act_002');
      expect(page1.pagination.limit).toBe(2);
      expect(page1.pagination.hasMore).toBe(true);
      expect(page1.pagination.nextCursor).toBeTruthy();

      // Use nextCursor to fetch page 2
      mockDb.customerActivityEvent.findMany.mockResolvedValueOnce([
        {
          id: 'act_001',
          userId: 'user_alice',
          eventType: CustomerActivityEventType.SERVER_STARTED,
          category: CustomerActivityCategory.SERVERS_DEVICES,
          severity: 'INFO',
          title: 'File Server Started',
          description: 'File server "Home Server" is now online.',
          serverId: 'srv_1',
          occurredAt: t3,
          metadata: { serverName: 'Home Server' }
        }
      ]);

      const page2 = await CustomerActivityService.listUserActivity(
        'user_alice',
        { limit: 2, cursor: page1.pagination.nextCursor },
        { db: mockDb }
      );

      const page2Query = mockDb.customerActivityEvent.findMany.mock.calls[1][0];
      expect(page2Query.where.AND).toEqual([
        {
          OR: [
            { occurredAt: { lt: t2 } },
            { occurredAt: t2, id: { lt: 'act_002' } }
          ]
        }
      ]);
      expect(page2.items).toHaveLength(1);
      expect(page2.items[0].id).toBe('act_001');
      expect(page2.pagination.hasMore).toBe(false);
      expect(page2.pagination.nextCursor).toBeNull();
    });

    it('rejects out-of-bounds limit values (< 1 or > 100)', async () => {
      await expect(
        CustomerActivityService.listUserActivity('user_alice', { limit: 0 }, { db: mockDb })
      ).rejects.toThrow(ValidationError);

      await expect(
        CustomerActivityService.listUserActivity('user_alice', { limit: 101 }, { db: mockDb })
      ).rejects.toThrow(ValidationError);

      await expect(
        CustomerActivityService.listUserActivity('user_alice', { limit: 'abc' }, { db: mockDb })
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('4. Valid and Invalid Filters', () => {
    it('applies valid category, eventType, and date-range filters to the database query', async () => {
      await CustomerActivityService.listUserActivity(
        'user_alice',
        {
          category: CustomerActivityCategory.BILLING_INVOICES,
          eventType: CustomerActivityEventType.INVOICE_DOWNLOADED,
          from: '2026-10-01T00:00:00.000Z',
          to: '2026-10-11T23:59:59.999Z'
        },
        { db: mockDb }
      );

      const queryArgs = mockDb.customerActivityEvent.findMany.mock.calls[0][0];
      expect(queryArgs.where.userId).toBe('user_alice');
      expect(queryArgs.where.category).toBe('BILLING_INVOICES');
      expect(queryArgs.where.eventType).toBe('BILLING.INVOICE_DOWNLOADED');
      expect(queryArgs.where.occurredAt).toEqual({
        gte: new Date('2026-10-01T00:00:00.000Z'),
        lte: new Date('2026-10-11T23:59:59.999Z')
      });
    });

    it('rejects invalid or internal-only category and eventType filters with ValidationError', async () => {
      await expect(
        CustomerActivityService.listUserActivity(
          'user_alice',
          { category: 'INTERNAL_ADMIN_LOGS' },
          { db: mockDb }
        )
      ).rejects.toThrow(ValidationError);

      for (const internalType of INTERNAL_ONLY_AUDIT_EVENT_TYPES) {
        await expect(
          CustomerActivityService.listUserActivity(
            'user_alice',
            { eventType: internalType },
            { db: mockDb }
          )
        ).rejects.toThrow(ValidationError);
      }

      // Contradictory category + eventType
      await expect(
        CustomerActivityService.listUserActivity(
          'user_alice',
          {
            category: CustomerActivityCategory.FILE_ACCESS,
            eventType: CustomerActivityEventType.INVOICE_ISSUED
          },
          { db: mockDb }
        )
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('5. Empty Activity History', () => {
    it('returns an empty items array and null nextCursor when customer has no recorded activity', async () => {
      mockDb.customerActivityEvent.findMany.mockResolvedValueOnce([]);

      const result = await CustomerActivityService.listUserActivity('user_new', {}, { db: mockDb });

      expect(result.items).toEqual([]);
      expect(result.pagination).toEqual({
        limit: 20,
        hasMore: false,
        nextCursor: null
      });
    });
  });

  describe('6. Response-Field Allowlisting & Sensitive Metadata Exclusion', () => {
    it('strips internal database columns and forbidden metadata keys on serialization', () => {
      const rawDatabaseRow = {
        id: 'act_sec_01',
        userId: 'user_alice',
        eventType: CustomerActivityEventType.PAYMENT_SUCCEEDED,
        category: CustomerActivityCategory.BILLING_INVOICES,
        severity: 'INFO',
        title: 'Payment Succeeded',
        description: 'Payment of USD 9.99 for Pro Monthly succeeded.',
        subscriptionId: 'sub_01',
        paymentId: 'pay_01',
        deviceId: 'unexpected_device_id_not_in_spec',
        idempotencyKey: 'payment_succeeded_pay_01',
        occurredAt: new Date('2026-10-11T09:00:00.000Z'),
        createdAt: new Date('2026-10-11T09:00:01.000Z'),
        metadata: {
          planCode: 'PRO_MONTHLY',
          planName: 'Pro Monthly',
          amountMinorUnits: 999,
          currency: 'USD',
          formattedAmount: '$9.99',
          // Sensitive / internal fields that must never be returned:
          providerPaymentId: 'pay_RzpSecret999',
          providerSubscriptionId: 'sub_RzpSecret888',
          razorpaySignature: 'sig_hmac_secret',
          passwordHash: '$2b$12$hash',
          tokenHash: 'sha256_token',
          s3Key: 'invoices/private/key.pdf',
          unwhitelistedField: 'drop_me'
        }
      };

      const serialized = serializeCustomerActivityEvent(rawDatabaseRow);

      expect(serialized).not.toBeNull();
      expect(Object.keys(serialized!).sort()).toEqual(
        ['category', 'description', 'entities', 'eventType', 'id', 'metadata', 'occurredAt', 'severity', 'title'].sort()
      );

      // Internal row properties must not be present
      expect(serialized).not.toHaveProperty('userId');
      expect(serialized).not.toHaveProperty('idempotencyKey');
      expect(serialized).not.toHaveProperty('createdAt');

      // Only taxonomy-allowed entity references for PAYMENT_SUCCEEDED (subscriptionId, paymentId)
      expect(serialized?.entities).toEqual({
        subscriptionId: 'sub_01',
        paymentId: 'pay_01'
      });

      // Sensitive metadata stripped
      expect(serialized?.metadata).toEqual({
        planCode: 'PRO_MONTHLY',
        planName: 'Pro Monthly',
        amountMinorUnits: 999,
        currency: 'USD',
        formattedAmount: '$9.99'
      });
    });

    it('masks raw IP addresses and summarizes raw User-Agent strings if present in stored metadata', () => {
      const rawRow = {
        id: 'act_auth_01',
        userId: 'user_alice',
        eventType: CustomerActivityEventType.AUTH_SIGN_IN_SUCCEEDED,
        category: CustomerActivityCategory.ACCOUNT_SECURITY,
        severity: 'INFO',
        title: 'Signed In to Account',
        description: 'Signed in to your ZdexCloud account.',
        occurredAt: new Date('2026-10-11T09:00:00.000Z'),
        metadata: {
          maskedIp: '198.51.100.42',
          userAgentSummary: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129.0.0.0 Safari/537.36'
        }
      };

      const serialized = serializeCustomerActivityEvent(rawRow);
      expect(serialized?.metadata.maskedIp).toBe('198.51.100.xxx');
      expect(serialized?.metadata.userAgentSummary).toBe('Chrome on Windows');
    });
  });

  describe('7. Malformed Cursor or Date Input', () => {
    it('rejects malformed or tampered cursors with ValidationError', () => {
      expect(() => decodeActivityCursor('')).toThrow(ValidationError);
      expect(() => decodeActivityCursor('not-valid-base64-json!!!')).toThrow(ValidationError);
      expect(() =>
        decodeActivityCursor(Buffer.from(JSON.stringify({ t: 'not-a-date', i: 'id_1' })).toString('base64url'))
      ).toThrow(ValidationError);
      expect(() =>
        decodeActivityCursor(Buffer.from(JSON.stringify({ t: '2026-10-11T00:00:00.000Z' })).toString('base64url'))
      ).toThrow(ValidationError);

      const validCursor = encodeActivityCursor(new Date('2026-10-11T10:00:00.000Z'), 'act_123');
      const decoded = decodeActivityCursor(validCursor);
      expect(decoded.id).toBe('act_123');
      expect(decoded.occurredAt.toISOString()).toBe('2026-10-11T10:00:00.000Z');
    });

    it('rejects invalid date formats or inverted date ranges (from > to) with ValidationError', async () => {
      await expect(
        CustomerActivityService.listUserActivity('user_alice', { from: 'not-a-date' }, { db: mockDb })
      ).rejects.toThrow(ValidationError);

      await expect(
        CustomerActivityService.listUserActivity('user_alice', { to: '11/10/2026' }, { db: mockDb })
      ).rejects.toThrow(ValidationError);

      await expect(
        CustomerActivityService.listUserActivity(
          'user_alice',
          {
            from: '2026-10-12T00:00:00.000Z',
            to: '2026-10-10T00:00:00.000Z'
          },
          { db: mockDb }
        )
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('8. Deleted Related Entities', () => {
    it('preserves historical activity events and scalar entity references after a device or server is deleted', async () => {
      mockDb.customerActivityEvent.findMany.mockResolvedValueOnce([
        {
          id: 'act_deleted_dev_01',
          userId: 'user_alice',
          eventType: CustomerActivityEventType.DEVICE_UNLINKED,
          category: CustomerActivityCategory.SERVERS_DEVICES,
          severity: 'WARNING',
          title: 'Device Unlinked',
          description: 'Device "Old Pixel 7" was unlinked and removed from your account.',
          deviceId: 'deleted_device_uuid_99',
          serverId: 'deleted_server_uuid_88',
          occurredAt: new Date('2026-10-10T08:00:00.000Z'),
          metadata: {
            deviceName: 'Old Pixel 7',
            serverName: 'Pixel Storage'
          }
        }
      ]);

      const result = await CustomerActivityService.listUserActivity('user_alice', {}, { db: mockDb });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('act_deleted_dev_01');
      expect(result.items[0].entities).toEqual({
        deviceId: 'deleted_device_uuid_99',
        serverId: 'deleted_server_uuid_88'
      });
      expect(result.items[0].metadata).toEqual({
        deviceName: 'Old Pixel 7',
        serverName: 'Pixel Storage'
      });
    });
  });

  describe('9. Phase 9.5 — Privacy, Security Filtering & Defense-in-Depth Hardening', () => {
    it('drops rows where userId is null, undefined, empty, or belongs to another customer', async () => {
      mockDb.customerActivityEvent.findMany.mockResolvedValueOnce([
        {
          id: 'act_missing_owner_1',
          userId: null,
          eventType: CustomerActivityEventType.AUTH_SIGN_IN_SUCCEEDED,
          category: CustomerActivityCategory.ACCOUNT_SECURITY,
          severity: 'INFO',
          title: 'Signed In to Account',
          description: 'Null owner row',
          occurredAt: new Date('2026-10-11T12:00:00.000Z'),
          metadata: {}
        },
        {
          id: 'act_missing_owner_2',
          userId: '   ',
          eventType: CustomerActivityEventType.AUTH_SIGN_IN_SUCCEEDED,
          category: CustomerActivityCategory.ACCOUNT_SECURITY,
          severity: 'INFO',
          title: 'Signed In to Account',
          description: 'Blank owner row',
          occurredAt: new Date('2026-10-11T11:59:00.000Z'),
          metadata: {}
        },
        {
          id: 'act_valid_owner',
          userId: 'user_alice',
          eventType: CustomerActivityEventType.AUTH_SIGN_IN_SUCCEEDED,
          category: CustomerActivityCategory.ACCOUNT_SECURITY,
          severity: 'INFO',
          title: 'Signed In to Account',
          description: 'Valid owner row',
          occurredAt: new Date('2026-10-11T11:58:00.000Z'),
          metadata: { maskedIp: '203.0.113.xxx' }
        }
      ]);

      const result = await CustomerActivityService.listUserActivity('user_alice', {}, { db: mockDb });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('act_valid_owner');
    });

    it('sanitizes stored HTML/script payloads, embedded secrets, stack traces, and raw IPs on read serialization', () => {
      const poisonedRow = {
        id: 'act_poisoned_01',
        userId: 'user_alice',
        eventType: CustomerActivityEventType.FILE_UPLOADED,
        category: CustomerActivityCategory.FILE_ACCESS,
        severity: 'INFO',
        title: '<script>alert("xss")</script>File Uploaded',
        description:
          'Uploaded "<img src=x onerror=alert(1)>budget.xlsx" from 198.51.100.99 with javascript:void(0)',
        serverId: 'srv_valid_01',
        deviceId: '../invalid/path/traversal',
        occurredAt: new Date('2026-10-11T10:00:00.000Z'),
        metadata: {
          fileName: '<b>budget.xlsx</b>',
          serverName: 'Finance Vault',
          targetDirectory: '/var/lib/postgresql/data/pg_hba.conf',
          sizeBytes: 2048,
          fileSizeBytes: Number.NaN
        }
      };

      const serialized = serializeCustomerActivityEvent(poisonedRow);
      expect(serialized).not.toBeNull();
      expect(serialized?.title).toBe('alert("xss")File Uploaded');
      expect(serialized?.title).not.toContain('<script>');
      expect(serialized?.description).not.toContain('<img');
      expect(serialized?.description).not.toContain('javascript:');
      expect(serialized?.description).toContain('198.51.100.xxx');
      expect(serialized?.description).not.toContain('198.51.100.99');

      // Valid serverId kept, path-traversal deviceId stripped
      expect(serialized?.entities).toEqual({
        serverId: 'srv_valid_01'
      });

      // HTML stripped from fileName; Unix system path targetDirectory and NaN fileSizeBytes omitted
      expect(serialized?.metadata).toEqual({
        fileName: 'budget.xlsx',
        serverName: 'Finance Vault',
        sizeBytes: 2048
      });
    });

    it('falls back to safe taxonomy title and description if stored text contains stack traces, SQL, or secrets', () => {
      const leakedDiagnosticRow = {
        id: 'act_diag_01',
        userId: 'user_alice',
        eventType: CustomerActivityEventType.PAYMENT_FAILED,
        category: CustomerActivityCategory.BILLING_INVOICES,
        severity: 'WARNING',
        title: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
        description:
          'Error: SELECT * FROM "BillingPayment" WHERE secret = rzp_live_SecretKey123 at Object.charge (/app/src/billing.ts:55:12)',
        occurredAt: new Date('2026-10-11T10:00:00.000Z'),
        metadata: {
          planName: 'Pro Monthly',
          reasonSummary: 'whsec_superSecretWebhookKey123456'
        }
      };

      const serialized = serializeCustomerActivityEvent(leakedDiagnosticRow);
      expect(serialized).not.toBeNull();
      expect(serialized?.title).toBe('Payment Failed');
      expect(serialized?.description).toBe(
        'A subscription payment attempt for Pro Monthly could not be completed.'
      );
      expect(serialized?.metadata).toEqual({
        planName: 'Pro Monthly'
      });
    });

    it('rejects cursors containing HTML, whitespace, or path traversal in the cursor id', () => {
      const xssCursor = Buffer.from(
        JSON.stringify({ t: '2026-10-11T10:00:00.000Z', i: '<script>alert(1)</script>' })
      ).toString('base64url');
      expect(() => decodeActivityCursor(xssCursor)).toThrow(ValidationError);

      const traversalCursor = Buffer.from(
        JSON.stringify({ t: '2026-10-11T10:00:00.000Z', i: '../../etc/passwd' })
      ).toString('base64url');
      expect(() => decodeActivityCursor(traversalCursor)).toThrow(ValidationError);
    });

    it('wraps unexpected database errors in a generic AppError without leaking internal Prisma/SQL details', async () => {
      mockDb.customerActivityEvent.findMany.mockRejectedValueOnce(
        new Error(
          'PrismaClientKnownRequestError: Invalid `prisma.customerActivityEvent.findMany()` invocation: Connection pool timed out on host 10.0.4.22:5432'
        )
      );

      let caughtError: any = null;
      try {
        await CustomerActivityService.listUserActivity('user_alice', {}, { db: mockDb });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(AppError);
      expect(caughtError.statusCode).toBe(500);
      expect(caughtError.message).toBe('Unable to retrieve account activity at this time.');
      expect(caughtError.message).not.toContain('PrismaClient');
      expect(caughtError.message).not.toContain('10.0.4.22');
    });
  });
});
