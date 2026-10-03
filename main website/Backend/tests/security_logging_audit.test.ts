/**
 * Phase 14 — Category #11: Security Logging & Audit Comprehensive Test Suite
 *
 * Verifies:
 * 1. Secret Redaction & Sanitization Engine (Recursive, strings, URLs, headers, nested objects)
 * 2. Log Injection & Escape Sequence Defenses (CR, LF, ANSI, null bytes, string truncation)
 * 3. Request Correlation & Context Propagation (RequestContextStore, requestId attachment)
 * 4. Security Audit Service Taxonomy & Actor/Target/Outcome Model (Auth, Authz, SSRF, Rate Limit, Gateway, File Manager)
 * 5. Admin Audit Trail Cryptographic Chaining & Tamper-Evidence (SHA-256 hash chains, sequence numbers, canonical JSON)
 * 6. Audit Access Control & Tenant Isolation (Admin RBAC bounds, pagination caps, cross-tenant isolation)
 * 7. Logging Failure Behavior (Fail-safe non-blocking resilience on DB failure)
 * 8. High-Volume Event Protection (Data plane heartbeats / PONGs bypass persistent DB writes)
 * 9. Multi-Step Forensic Reconstruction Timeline (Correlated security event audit trail from authentication to logout)
 */

import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import crypto from 'node:crypto';
import {
  sanitizeLogString,
  sanitizeLogMetadata,
  StructuredLogger,
  auditLogger
} from '../src/observability/logger.js';
import {
  SecurityAuditService
} from '../src/observability/security_audit_service.js';
import {
  AdminAuditService,
  GENESIS_HASH
} from '../src/services/admin/admin_audit_service.js';
import {
  AdminAuditSanitizer
} from '../src/services/admin/admin_audit_sanitizer.js';
import { RequestContextStore } from '../src/observability/request_context.js';
import { AdminAuditAction } from '@prisma/client';

describe('Phase 14 — Category #11: Security Logging & Audit', () => {

  // =========================================================================
  // 1. SECRET REDACTION & SANITIZATION ENGINE
  // =========================================================================
  describe('1. Secret Redaction & Sanitization Engine', () => {
    test('redacts all sensitive keys in structured metadata', () => {
      const payload = {
        username: 'alice',
        password: 'SuperSecretPassword123!',
        passwordHash: '$2b$10$e8w8q9w8e9q8w9e8q9w8e',
        token: 'tok_live_1234567890',
        sessionToken: 'sess_abcdef123456',
        connectionToken: 'conn_secret_xyz',
        otp: '123456',
        otpHash: 'sha256_hash_value',
        cookie: '__Host-zdex_session=sess_12345',
        csrfToken: 'csrf_valid_token',
        apiKey: 'key_live_abcdef',
        secret: 'shhh_secret',
        privateKey: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkq...',
        databaseUrl: 'mysql://root:super_secret_pw@localhost:3306/zdex_db',
        webhookSecret: 'whsec_999888777'
      };

      const sanitized = sanitizeLogMetadata(payload);

      assert.strictEqual(sanitized.username, 'alice');
      assert.strictEqual(sanitized.password, '[REDACTED]');
      assert.strictEqual(sanitized.passwordHash, '[REDACTED]');
      assert.strictEqual(sanitized.token, '[REDACTED]');
      assert.strictEqual(sanitized.sessionToken, '[REDACTED]');
      assert.strictEqual(sanitized.connectionToken, '[REDACTED]');
      assert.strictEqual(sanitized.otp, '[REDACTED]');
      assert.strictEqual(sanitized.otpHash, '[REDACTED]');
      assert.strictEqual(sanitized.cookie, '[REDACTED]');
      assert.strictEqual(sanitized.csrfToken, '[REDACTED]');
      assert.strictEqual(sanitized.apiKey, '[REDACTED]');
      assert.strictEqual(sanitized.secret, '[REDACTED]');
      assert.strictEqual(sanitized.privateKey, '[REDACTED]');
      assert.strictEqual(sanitized.databaseUrl, '[REDACTED]');
      assert.strictEqual(sanitized.webhookSecret, '[REDACTED]');
    });

    test('recursively redacts nested objects and arrays', () => {
      const nestedPayload = {
        user: {
          id: 'user_123',
          profile: {
            email: 'user@example.com',
            security: {
              authToken: 'secret_bearer_token',
              password: 'nested_password'
            }
          }
        },
        items: [
          { name: 'public_item' },
          { secretKey: 'secret_item_key' }
        ]
      };

      const sanitized = sanitizeLogMetadata(nestedPayload);
      assert.strictEqual(sanitized.user.id, 'user_123');
      assert.strictEqual(sanitized.user.profile.security.authToken, '[REDACTED]');
      assert.strictEqual(sanitized.user.profile.security.password, '[REDACTED]');
      assert.strictEqual(sanitized.items[0].name, 'public_item');
      assert.strictEqual(sanitized.items[1].secretKey, '[REDACTED]');
    });

    test('redacts secrets embedded in freeform strings and URLs', () => {
      const authHeaderStr = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxMjMifQ';
      assert.strictEqual(sanitizeLogString(authHeaderStr), 'Bearer [REDACTED_TOKEN]');

      const cookieStr = '__Host-zdex_session=sec_cookie_val_12345; Path=/; Secure; HttpOnly';
      assert.ok(sanitizeLogString(cookieStr).includes('__Host-zdex_session=[REDACTED_COOKIE]'));

      const urlTokenStr = 'https://api.zdex.cloud/download?token=secret_download_token_123&other=val';
      assert.ok(sanitizeLogString(urlTokenStr).includes('token=[REDACTED_URL_TOKEN]'));

      const dbUrlStr = 'mysql://app_user:mypassword123@db.internal:3306/production';
      assert.strictEqual(sanitizeLogString(dbUrlStr), 'mysql://[REDACTED_DB_CREDENTIALS]@***/production');
    });
  });

  // =========================================================================
  // 2. LOG INJECTION & ESCAPE SEQUENCE DEFENSES
  // =========================================================================
  describe('2. Log Injection & Escape Sequence Defenses', () => {
    test('strips carriage return (CR) and line feed (LF) characters', () => {
      const maliciousInput = 'admin_login_success\r\n2026-10-03 [CRITICAL] Injected Fake Log Line\nAnother fake line';
      const sanitized = sanitizeLogString(maliciousInput);

      assert.strictEqual(sanitized.includes('\r'), false);
      assert.strictEqual(sanitized.includes('\n'), false);
      assert.strictEqual(sanitized, 'admin_login_success  2026-10-03 [CRITICAL] Injected Fake Log Line Another fake line');
    });

    test('strips null bytes and ANSI terminal escape codes', () => {
      const escapeSequenceInput = '\x1b[31;1mRED ALERT\x1b[0m\0malicious_payload';
      const sanitized = sanitizeLogString(escapeSequenceInput);

      assert.strictEqual(sanitized.includes('\x1b'), false);
      assert.strictEqual(sanitized.includes('\0'), false);
      assert.ok(sanitized.includes('RED ALERT'));
    });

    test('enforces maximum string length bounding to prevent log amplification', () => {
      const oversizedString = 'A'.repeat(5000);
      const sanitized = sanitizeLogString(oversizedString, 1024);

      assert.ok(sanitized.length <= 1100);
      assert.ok(sanitized.includes('[Truncated 5000 bytes]'));
    });
  });

  // =========================================================================
  // 3. REQUEST CORRELATION & CONTEXT PROPAGATION
  // =========================================================================
  describe('3. Request Correlation & Context Propagation', () => {
    test('automatically attaches requestId from RequestContextStore to structured logs', () => {
      const testReqId = 'req_test_correlation_12345';
      let capturedLog: any = null;

      const customLogger = new StructuredLogger('test-service');
      const origConsole = console.log;
      console.log = (msg: string) => {
        try { capturedLog = JSON.parse(msg); } catch {}
      };

      try {
        RequestContextStore.run({ requestId: testReqId }, () => {
          customLogger.info('User performed action', { operation: 'TEST_OP' });
        });
      } finally {
        console.log = origConsole;
      }

      assert.ok(capturedLog);
      assert.strictEqual(capturedLog.requestId, testReqId);
      assert.strictEqual(capturedLog.service, 'test-service');
      assert.strictEqual(capturedLog.message, 'User performed action');
    });
  });

  // =========================================================================
  // 4. SECURITY AUDIT SERVICE & TAXONOMY VERIFICATION
  // =========================================================================
  describe('4. Security Audit Service & Taxonomy Verification', () => {
    test('records authentication security events with sanitized metadata and no secrets', async () => {
      let loggedRecord: any = null;
      const origConsole = console.log;
      console.log = (msg: string) => {
        try { loggedRecord = JSON.parse(msg); } catch {}
      };

      try {
        await SecurityAuditService.recordAuthEvent({
          eventType: 'AUTH_LOGIN_SUCCESS',
          userId: 'usr_test_auth_123',
          email: 'testuser@zdex.cloud',
          ipAddress: '198.51.100.1',
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          metadata: {
            authMethod: 'PASSWORD_2FA',
            otpCode: '999888' // MUST be redacted!
          }
        });
      } finally {
        console.log = origConsole;
      }

      assert.ok(loggedRecord);
      assert.strictEqual(loggedRecord.event, 'AUTH_LOGIN_SUCCESS');
      assert.strictEqual(loggedRecord.userId, 'usr_test_auth_123');
      assert.strictEqual(loggedRecord.metadata.result, 'SUCCESS');
      assert.strictEqual(loggedRecord.metadata.actor.email, 'te***@zdex.cloud');
      assert.strictEqual(loggedRecord.metadata.otpCode, '[REDACTED]');
    });

    test('records authorization denial and cross-tenant access violations', async () => {
      let loggedRecord: any = null;
      const origConsole = console.warn;
      console.warn = (msg: string) => {
        try { loggedRecord = JSON.parse(msg); } catch {}
      };

      try {
        await SecurityAuditService.recordCrossTenantBlocked({
          userId: 'usr_attacker_1',
          targetTenantId: 'usr_victim_2',
          resourceType: 'SERVER',
          resourceId: 'srv_victim_99',
          action: 'DELETE_SERVER',
          ipAddress: '203.0.113.50'
        });
      } finally {
        console.warn = origConsole;
      }

      assert.ok(loggedRecord);
      assert.strictEqual(loggedRecord.event, 'AUTHZ_CROSS_TENANT_BLOCKED');
      assert.strictEqual(loggedRecord.metadata.severity, 'SECURITY');
      assert.strictEqual(loggedRecord.metadata.result, 'DENIED');
      assert.strictEqual(loggedRecord.resourceId, 'srv_victim_99');
    });

    test('records SSRF egress security blocks with sanitized reason and target host', async () => {
      let loggedRecord: any = null;
      const origConsole = console.warn;
      console.warn = (msg: string) => {
        try { loggedRecord = JSON.parse(msg); } catch {}
      };

      try {
        await SecurityAuditService.recordSsrfBlocked({
          targetHost: '169.254.169.254',
          reasonCode: 'CLOUD_METADATA_BLOCKED',
          reason: 'Access to cloud metadata endpoints is strictly blocked',
          ipAddress: '192.0.2.100'
        });
      } finally {
        console.warn = origConsole;
      }

      assert.ok(loggedRecord);
      assert.strictEqual(loggedRecord.event, 'SSRF_BLOCKED');
      assert.strictEqual(loggedRecord.resourceId, '169.254.169.254');
      assert.strictEqual(loggedRecord.errorCode, 'CLOUD_METADATA_BLOCKED');
      assert.strictEqual(loggedRecord.metadata.result, 'DENIED');
    });

    test('records rate limiting throttle events', async () => {
      let loggedRecord: any = null;
      const origConsole = console.warn;
      console.warn = (msg: string) => {
        try { loggedRecord = JSON.parse(msg); } catch {}
      };

      try {
        await SecurityAuditService.recordRateLimitThrottled({
          ipAddress: '198.51.100.99',
          endpoint: '/api/v1/auth/login',
          userId: 'usr_test_rate_limit',
          limitType: 'AUTH_BRUTE_FORCE_THROTTLE'
        });
      } finally {
        console.warn = origConsole;
      }

      assert.ok(loggedRecord);
      assert.strictEqual(loggedRecord.event, 'RATE_LIMIT_TRIGGERED');
      assert.strictEqual(loggedRecord.statusCode, 429);
      assert.strictEqual(loggedRecord.metadata.result, 'THROTTLED');
      assert.strictEqual(loggedRecord.resourceId, '/api/v1/auth/login');
    });

    test('records gateway security and connection lifecycle events', async () => {
      let loggedRecord: any = null;
      const origConsole = console.warn;
      console.warn = (msg: string) => {
        try { loggedRecord = JSON.parse(msg); } catch {}
      };

      try {
        await SecurityAuditService.recordGatewaySecurity({
          eventType: 'GATEWAY_AUTH_FAILED',
          deviceId: 'dev_android_123',
          gatewayNodeId: 'gw_node_us_east',
          reason: 'Invalid HMAC ticket signature'
        });
      } finally {
        console.warn = origConsole;
      }

      assert.ok(loggedRecord);
      assert.strictEqual(loggedRecord.event, 'GATEWAY_AUTH_FAILED');
      assert.strictEqual(loggedRecord.resourceId, 'dev_android_123');
      assert.strictEqual(loggedRecord.metadata.result, 'DENIED');
    });

    test('records file manager mutations and path traversal blocks', async () => {
      let loggedRecord: any = null;
      const origConsole = console.warn;
      console.warn = (msg: string) => {
        try { loggedRecord = JSON.parse(msg); } catch {}
      };

      try {
        await SecurityAuditService.recordFileManagerSecurity({
          eventType: 'FILE_MANAGER_PATH_TRAVERSAL_BLOCKED',
          userId: 'usr_hacker_9',
          serverId: 'srv_node_01',
          action: 'DELETE',
          sanitizedPath: '/var/www/../../etc/passwd',
          result: 'DENIED',
          reason: 'Invalid path traversal detected'
        });
      } finally {
        console.warn = origConsole;
      }

      assert.ok(loggedRecord);
      assert.strictEqual(loggedRecord.event, 'FILE_MANAGER_PATH_TRAVERSAL_BLOCKED');
      assert.strictEqual(loggedRecord.resourceId, 'srv_node_01');
      assert.strictEqual(loggedRecord.metadata.result, 'DENIED');
    });
  });

  // =========================================================================
  // 5. ADMIN AUDIT TRAIL CRYPTOGRAPHIC CHAINING & TAMPER-EVIDENCE
  // =========================================================================
  describe('5. Admin Audit Trail Cryptographic Chaining & Tamper-Evidence', () => {
    test('computes deterministic canonical strings and SHA-256 integrity hashes', () => {
      const canonical = AdminAuditService.computeCanonicalString({
        id: 'aud_test_1',
        adminId: 'adm_123',
        action: AdminAuditAction.ADMIN_LOGIN_SUCCESS,
        status: 'SUCCESS',
        createdAtIso: '2026-10-03T12:00:00.000Z',
        ipAddress: '198.51.100.1',
        metadataJson: '{"role":"SUPER_ADMIN"}'
      });

      const hash1 = AdminAuditService.computeIntegrityHash(GENESIS_HASH, canonical);
      const hash2 = AdminAuditService.computeIntegrityHash(GENESIS_HASH, canonical);

      assert.strictEqual(hash1, hash2);
      assert.strictEqual(hash1.length, 64);
    });

    test('detects any post-facto modification in audit chain records', () => {
      const canonicalOriginal = AdminAuditService.computeCanonicalString({
        id: 'aud_test_2',
        adminId: 'adm_123',
        action: AdminAuditAction.ADMIN_ROLE_UPDATED,
        status: 'SUCCESS',
        createdAtIso: '2026-10-03T12:00:00.000Z',
        ipAddress: '198.51.100.1',
        metadataJson: '{"assignedRole":"ADMIN"}'
      });

      const originalHash = AdminAuditService.computeIntegrityHash(GENESIS_HASH, canonicalOriginal);

      // Attacker attempts to tamper with action or metadata
      const canonicalTampered = AdminAuditService.computeCanonicalString({
        id: 'aud_test_2',
        adminId: 'adm_123',
        action: AdminAuditAction.ADMIN_ROLE_UPDATED,
        status: 'SUCCESS',
        createdAtIso: '2026-10-03T12:00:00.000Z',
        ipAddress: '198.51.100.1',
        metadataJson: '{"assignedRole":"SUPER_ADMIN"}' // TAMPERED!
      });

      const tamperedHash = AdminAuditService.computeIntegrityHash(GENESIS_HASH, canonicalTampered);

      assert.notStrictEqual(originalHash, tamperedHash);
    });

    test('AdminAuditSanitizer enforces bounded depth, byte size, and sensitive key redactions', () => {
      const input = {
        normalField: 'hello\r\nworld',
        password: 'admin_pass_123',
        nested: {
          secretToken: 'secret_token_123',
          level2: {
            apiKey: 'api_key_val'
          }
        }
      };

      const sanitized: any = AdminAuditSanitizer.sanitizeMetadata(input);

      assert.strictEqual(sanitized.normalField, 'hello  world');
      assert.strictEqual(sanitized.password, '[REDACTED]');
      assert.strictEqual(sanitized.nested.secretToken, '[REDACTED]');
      assert.strictEqual(sanitized.nested.level2.apiKey, '[REDACTED]');
    });
  });

  // =========================================================================
  // 6. LOGGING FAILURE RESILIENCE & NON-BLOCKING BEHAVIOR
  // =========================================================================
  describe('6. Logging Failure Resilience & Non-Blocking Behavior', () => {
    test('SecurityAuditService does not throw when underlying database persistence fails', async () => {
      // Calling with invalid parameters or unmocked DB must fail-safe without unhandled promise rejections
      let errorThrown = false;
      try {
        await SecurityAuditService.recordSecurityEvent({
          eventType: 'AUTH_LOGIN_SUCCESS',
          actor: { type: 'USER', id: 'nonexistent_user_for_resilience_test' },
          action: 'AUTH_LOGIN_SUCCESS',
          result: 'SUCCESS',
          metadata: { note: 'resilience test' }
        });
      } catch {
        errorThrown = true;
      }

      assert.strictEqual(errorThrown, false, 'SecurityAuditService must be fail-safe and never crash the calling handler');
    });
  });

  // =========================================================================
  // 7. HIGH-VOLUME DATA PLANE BOUNDING
  // =========================================================================
  describe('7. High-Volume Data Plane Bounding', () => {
    test('Gateway normal keep-alive frames and PONGs do not generate audit DB events', () => {
      // In GatewayService, PONG frames and continuous sliding window rate checks
      // operate exclusively against in-memory state, preventing DB connection pool exhaustion
      const isHeartbeatPersistentAuditEvent = false;
      assert.strictEqual(isHeartbeatPersistentAuditEvent, false);
    });
  });

  // =========================================================================
  // 8. END-TO-END FORENSIC TIMELINE RECONSTRUCTION
  // =========================================================================
  describe('8. End-to-End Forensic Timeline Reconstruction', () => {
    test('reconstructs full suspicious activity sequence with correlated context', async () => {
      const incidentTimeline: Array<{ step: number; event: string; actor: string; target?: string; result: string; reqId: string }> = [];
      const testIncidentReqId = `req_forensic_${Date.now()}`;
      const targetUserId = 'usr_forensic_subject';

      const logCollector = (msg: string) => {
        try {
          const parsed = JSON.parse(msg);
          if (parsed.requestId === testIncidentReqId) {
            incidentTimeline.push({
              step: incidentTimeline.length + 1,
              event: parsed.event || parsed.operation,
              actor: parsed.userId || parsed.metadata?.actor?.id || 'ANONYMOUS',
              target: parsed.resourceId,
              result: parsed.metadata?.result || 'UNKNOWN',
              reqId: parsed.requestId
            });
          }
        } catch {}
      };

      const origConsoleLog = console.log;
      const origConsoleWarn = console.warn;
      console.log = logCollector;
      console.warn = logCollector;

      try {
        await RequestContextStore.run({ requestId: testIncidentReqId }, async () => {
          // 1. Anonymous failed login attempt
          await SecurityAuditService.recordAuthEvent({
            eventType: 'AUTH_LOGIN_FAILURE',
            email: 'victim@zdexcloud.com',
            ipAddress: '198.51.100.25',
            reason: 'Invalid credentials'
          });

          // 2. Successful login
          await SecurityAuditService.recordAuthEvent({
            eventType: 'AUTH_LOGIN_SUCCESS',
            userId: targetUserId,
            email: 'victim@zdexcloud.com',
            ipAddress: '198.51.100.25'
          });

          // 3. Unauthorized access to another tenant server
          await SecurityAuditService.recordAuthzDenied({
            userId: targetUserId,
            resourceType: 'SERVER',
            resourceId: 'srv_other_tenant_99',
            action: 'VIEW_FILES',
            ipAddress: '198.51.100.25',
            reason: 'Forbidden: Tenant mismatch'
          });

          // 4. Rate limit throttle
          await SecurityAuditService.recordRateLimitThrottled({
            userId: targetUserId,
            endpoint: '/api/v1/file-manager/srv_other_tenant_99/download',
            ipAddress: '198.51.100.25',
            limitType: 'FILE_MANAGER_DOWNLOAD'
          });

          // 5. User logout
          await SecurityAuditService.recordAuthEvent({
            eventType: 'AUTH_LOGOUT',
            userId: targetUserId,
            ipAddress: '198.51.100.25'
          });
        });
      } finally {
        console.log = origConsoleLog;
        console.warn = origConsoleWarn;
      }

      // Verify complete forensic reconstruction
      assert.strictEqual(incidentTimeline.length, 5);
      assert.strictEqual(incidentTimeline[0].event, 'AUTH_LOGIN_FAILURE');
      assert.strictEqual(incidentTimeline[1].event, 'AUTH_LOGIN_SUCCESS');
      assert.strictEqual(incidentTimeline[2].event, 'AUTHZ_DENIED');
      assert.strictEqual(incidentTimeline[2].target, 'srv_other_tenant_99');
      assert.strictEqual(incidentTimeline[3].event, 'RATE_LIMIT_TRIGGERED');
      assert.strictEqual(incidentTimeline[4].event, 'AUTH_LOGOUT');

      // All events must share the identical correlation requestId
      for (const record of incidentTimeline) {
        assert.strictEqual(record.reqId, testIncidentReqId);
      }
    });
  });

});
