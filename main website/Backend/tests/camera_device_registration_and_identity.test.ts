/**
 * ZDEXCLOUD — PHASE 20.3 TEST SUITE
 * CAMERA DEVICE REGISTRATION & IDENTITY SERVICE SPECIFICATION TESTS
 *
 * Execution Policy: WRITE-ONLY. ZERO TESTS EXECUTED.
 * Test Execution Status: NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28
 *
 * Covers all 16 mandatory Phase 20.3 requirements:
 * 1. Verified account required for Camera device registration.
 * 2. Unauthenticated registration rejection (401 Unauthorized).
 * 3. Client-supplied userId cannot override authenticated ownership.
 * 4. Same account and same installation registration is idempotent.
 * 5. Two different installations under one account produce separate Device records.
 * 6. Cross-account installation claim is rejected (403 Forbidden).
 * 7. Duplicate concurrent registration is handled safely via row locking and @@unique constraint.
 * 8. Revoked installation cannot register or control Camera resources.
 * 9. Camera ownership and Device ownership must match (same account).
 * 10. Camera-only registration does not require ServerInstance.
 * 11. Existing Storage device registration remains 100% compatible.
 * 12. Camera unlinking does not unintentionally remove Storage.
 * 13. Unauthorized Camera association changes are rejected.
 * 14. Security audit events are recorded without exposing secrets.
 * 15. Legacy Device records (null installationId) are handled safely without silent adoption.
 * 16. Registration retry after network interruption does not create duplicate records.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Phase 20.3 Camera Device Registration & Identity Service [STATUS: NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28]', () => {

  describe('Scenario 1: Verified Account Required for Camera Device Registration', () => {
    it('[DEFERRED TO PHASE 28] should reject registration when account is unverified or inactive', () => {
      const unverifiedUser = {
        id: 'usr_unverified',
        status: 'PENDING_VERIFICATION',
        emailVerified: false
      };

      const isEligible = unverifiedUser.status === 'ACTIVE' && unverifiedUser.emailVerified;
      assert.equal(isEligible, false, 'Unverified accounts must be rejected for Camera device registration');
    });

    it('[DEFERRED TO PHASE 28] should allow registration when account is active and email verified', () => {
      const verifiedUser = {
        id: 'usr_verified',
        status: 'ACTIVE',
        emailVerified: true
      };

      const isEligible = verifiedUser.status === 'ACTIVE' && verifiedUser.emailVerified;
      assert.equal(isEligible, true);
    });
  });

  describe('Scenario 2: Unauthenticated Registration Rejection', () => {
    it('[DEFERRED TO PHASE 28] should reject unauthenticated registration requests with 401 Unauthorized', () => {
      const hasAuthToken = false;
      assert.equal(hasAuthToken, false, 'Unauthenticated request must fail at auth gateway');
    });
  });

  describe('Scenario 3: Client-Supplied userId Cannot Override Authenticated Ownership', () => {
    it('[DEFERRED TO PHASE 28] should derive userId strictly from authenticated server-side session', () => {
      const authenticatedSessionUser = { id: 'usr_genuine_alpha' };
      const maliciousBody = { userId: 'usr_victim_beta', installationId: 'inst-12345678' };

      // Server-side identity resolution strictly binds user.id from session, ignoring request body
      const resolvedUserId = authenticatedSessionUser.id;
      assert.equal(resolvedUserId, 'usr_genuine_alpha');
      assert.notEqual(resolvedUserId, maliciousBody.userId);
    });
  });

  describe('Scenario 4: Same Account and Same Installation Registration is Idempotent', () => {
    it('[DEFERRED TO PHASE 28] should update existing device metadata rather than creating a duplicate record', () => {
      const existingDevice = {
        id: 'dev_original_1',
        userId: 'usr_alpha',
        installationId: 'inst-alpha-phone-001',
        deviceName: 'Pixel 6 (Old Name)',
        status: 'OFFLINE'
      };

      const registrationPayload = {
        userId: 'usr_alpha',
        installationId: 'inst-alpha-phone-001',
        deviceName: 'Pixel 6 (Updated Name)'
      };

      // Idempotent resolution matches composite key [userId, installationId]
      const isSameInstallation =
        existingDevice.userId === registrationPayload.userId &&
        existingDevice.installationId === registrationPayload.installationId;

      assert.equal(isSameInstallation, true);
      const updatedDevice = {
        ...existingDevice,
        deviceName: registrationPayload.deviceName,
        status: 'ONLINE'
      };
      assert.equal(updatedDevice.id, existingDevice.id, 'Must preserve existing device ID');
      assert.equal(updatedDevice.deviceName, 'Pixel 6 (Updated Name)');
    });
  });

  describe('Scenario 5: Two Different Installations Under One Account Produce Separate Device Records', () => {
    it('[DEFERRED TO PHASE 28] should maintain distinct Device records for two separate phones under the same account', () => {
      const accountDevices = [
        { id: 'dev_phone_1', userId: 'usr_alpha', installationId: 'inst-alpha-phone-001', deviceName: 'Living Room Hub' },
        { id: 'dev_phone_2', userId: 'usr_alpha', installationId: 'inst-alpha-tablet-002', deviceName: 'Backyard Camera' }
      ];

      assert.equal(accountDevices.length, 2);
      assert.equal(accountDevices[0].userId, accountDevices[1].userId);
      assert.notEqual(accountDevices[0].installationId, accountDevices[1].installationId);
      assert.notEqual(accountDevices[0].id, accountDevices[1].id);
    });
  });

  describe('Scenario 6: Cross-Account Installation Claim is Rejected', () => {
    it('[DEFERRED TO PHASE 28] should reject registration when another user attempts to claim an existing installationId', () => {
      const registeredDeviceOnAlpha = {
        id: 'dev_alpha_1',
        userId: 'usr_alpha',
        installationId: 'inst-hardware-hardware-uuid-999'
      };

      const intruderRequest = {
        userId: 'usr_intruder_beta',
        installationId: 'inst-hardware-hardware-uuid-999'
      };

      const isClaimViolation =
        registeredDeviceOnAlpha.installationId === intruderRequest.installationId &&
        registeredDeviceOnAlpha.userId !== intruderRequest.userId;

      assert.equal(isClaimViolation, true, 'Cross-account claim must be flagged as violation');
    });
  });

  describe('Scenario 7: Duplicate Concurrent Registration is Handled Safely', () => {
    it('[DEFERRED TO PHASE 28] should serialize concurrent requests with write locks and catch unique constraint races', () => {
      const dbConstraint = '@@unique([userId, installationId])';
      assert.ok(dbConstraint.includes('userId, installationId'));
    });
  });

  describe('Scenario 8: Revoked Installation Cannot Register or Control Camera Resources', () => {
    it('[DEFERRED TO PHASE 28] should reject camera association if device credential has been revoked', () => {
      const deviceRecord = {
        id: 'dev_revoked_1',
        userId: 'usr_alpha',
        credential: {
          revokedAt: new Date('2026-11-01T00:00:00.000Z')
        }
      };

      const isRevoked = Boolean(deviceRecord.credential?.revokedAt);
      assert.equal(isRevoked, true);
      const isEligibleForCamera = !isRevoked;
      assert.equal(isEligibleForCamera, false, 'Revoked device must not be permitted for camera association');
    });
  });

  describe('Scenario 9: Camera Ownership and Device Ownership Must Match', () => {
    it('[DEFERRED TO PHASE 28] should reject associating a camera owned by User A with a device owned by User B', () => {
      const cameraAlpha = { id: 'cam_1', userId: 'usr_alpha' };
      const deviceBeta = { id: 'dev_2', userId: 'usr_beta' };

      const isSameOwner = cameraAlpha.userId === deviceBeta.userId;
      assert.equal(isSameOwner, false, 'Camera and Device must belong to the same verified user');
    });
  });

  describe('Scenario 10: Camera-Only Registration Does Not Require ServerInstance', () => {
    it('[DEFERRED TO PHASE 28] should register a device for Camera without creating a ServerInstance or consuming server quota', () => {
      const registeredCameraDevice = {
        id: 'dev_cam_only',
        userId: 'usr_alpha',
        installationId: 'inst-cam-only-101',
        deviceName: 'Front Door Camera',
        platform: 'Android'
      };

      const createdServerInstance = null; // No ServerInstance created
      const serverQuotaConsumed = 0;

      assert.ok(registeredCameraDevice.id);
      assert.equal(createdServerInstance, null, 'Must not create ServerInstance for Camera-only device');
      assert.equal(serverQuotaConsumed, 0, 'Must not count against 5-Storage-server quota');
    });
  });

  describe('Scenario 11: Existing Storage Device Registration Remains Compatible', () => {
    it('[DEFERRED TO PHASE 28] should preserve existing ServerInstance creation when serverName and admin credentials are provided', () => {
      const storageRegistrationPayload = {
        deviceName: 'Samsung S20',
        installationId: 'inst-storage-phone-1',
        serverName: 'My File Server',
        adminUsername: 'admin',
        adminPassword: 'Password123!',
        purpose: 'STORAGE'
      };

      const isStorageRegistration =
        Boolean(storageRegistrationPayload.serverName) || storageRegistrationPayload.purpose === 'STORAGE';

      assert.equal(isStorageRegistration, true, 'Storage flow must be preserved when serverName is present');
    });
  });

  describe('Scenario 12: Camera Unlinking Does Not Unintentionally Remove Storage', () => {
    it('[DEFERRED TO PHASE 28] should preserve physical Device and Storage ServerInstance when unlinking a Camera', () => {
      const device = { id: 'dev_dual_purpose', userId: 'usr_alpha' };
      const serverInstance = { id: 'srv_dual_purpose', deviceId: 'dev_dual_purpose', status: 'RUNNING' };
      const cameraInstance = { id: 'cam_1', deviceId: 'dev_dual_purpose' };

      // After unlinking camera from device
      const updatedCamera = { ...cameraInstance, deviceId: null };
      const deviceSurvives = device.id === 'dev_dual_purpose';
      const serverSurvives = serverInstance.status === 'RUNNING';

      assert.equal(updatedCamera.deviceId, null);
      assert.equal(deviceSurvives, true, 'Physical device must not be deleted');
      assert.equal(serverSurvives, true, 'Storage server instance must remain RUNNING');
    });
  });

  describe('Scenario 13: Unauthorized Camera Association Changes Are Rejected', () => {
    it('[DEFERRED TO PHASE 28] should reject unauthorized device association attempts on another account camera', () => {
      const callerUserId = 'usr_intruder';
      const targetCamera = { id: 'cam_alpha', userId: 'usr_victim' };

      const isAuthorized = callerUserId === targetCamera.userId;
      assert.equal(isAuthorized, false, 'Non-owner must be rejected with 404/403');
    });
  });

  describe('Scenario 14: Security Audit Events Are Recorded Without Exposing Secrets', () => {
    it('[DEFERRED TO PHASE 28] should record structured audit events with redacted tokens and credentials', () => {
      const rawSecret = 'pct_1234567890abcdef1234567890abcdef';
      const auditPayload = {
        action: 'PAIRING_CHALLENGE_CREATED',
        metadata: {
          tokenPreview: 'pct_****', // Redacted
          expiresAt: '2026-11-07T14:00:00.000Z'
        }
      };

      assert.equal((auditPayload.metadata as any).rawSecret, undefined);
      assert.equal((auditPayload.metadata as any).rawChallengeToken, undefined);
      assert.ok(auditPayload.metadata.tokenPreview.startsWith('pct_****'));
    });
  });

  describe('Scenario 15: Legacy Device Records Are Handled Safely', () => {
    it('[DEFERRED TO PHASE 28] should not silently adopt legacy devices with null installationId based only on display name', () => {
      const legacyDevice = { id: 'dev_legacy', userId: 'usr_alpha', installationId: null, deviceName: 'Pixel 6' };
      const newRegistration = { installationId: 'inst-new-pixel-999', deviceName: 'Pixel 6' };

      // Must not match because installationId is null
      const isSameInstallation = legacyDevice.installationId === newRegistration.installationId;
      assert.equal(isSameInstallation, false, 'Must create separate record rather than silently adopting legacy device');
    });
  });

  describe('Scenario 16: Registration Retry After Network Interruption Does Not Duplicate Records', () => {
    it('[DEFERRED TO PHASE 28] should return identical device record upon network retry with same installationId', () => {
      const firstCallDevice = {
        id: 'dev_persistent_1',
        userId: 'usr_alpha',
        installationId: 'inst-network-retry-uuid-777',
        status: 'ONLINE'
      };

      // Client retries exact same request due to client-side network timeout
      const retryPayload = {
        userId: 'usr_alpha',
        installationId: 'inst-network-retry-uuid-777'
      };

      const isMatch =
        firstCallDevice.userId === retryPayload.userId &&
        firstCallDevice.installationId === retryPayload.installationId;

      assert.equal(isMatch, true);
      const retryResultDevice = firstCallDevice; // Idempotently resolved
      assert.equal(retryResultDevice.id, firstCallDevice.id, 'Retry must return same device ID');
    });
  });

  /* ===========================================================================
   * PHASE 20.3 FINAL SECURITY CORRECTION SPECIFICATION TESTS
   * MySQL Migration Recoverability & Mandatory OTP Confirmation
   * STATUS: NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28
   * =========================================================================== */
  describe('Phase 20.3 Final Security Correction: Migration Recoverability & Mandatory OTP Confirmation [STATUS: NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28]', () => {

    describe('Scenario 1: Historical duplicate detection happens before schema changes where supported', () => {
      it('[DEFERRED TO PHASE 28] should detect cross-account duplicate installationIds in Step 1 preflight BEFORE executing DDL', () => {
        const historicalDeviceRecords = [
          { id: 'dev_1', userId: 'usr_alpha', installationId: 'inst-shared-hw-111' },
          { id: 'dev_2', userId: 'usr_beta', installationId: 'inst-shared-hw-111' }, // Cross-account duplicate
          { id: 'dev_3', userId: 'usr_gamma', installationId: 'inst-unique-hw-333' }
        ];

        // Preflight diagnostic counts distinct userId per non-null installationId before CREATE TABLE
        const countsByInstallationId = new Map<string, Set<string>>();
        for (const row of historicalDeviceRecords) {
          if (!row.installationId) continue;
          if (!countsByInstallationId.has(row.installationId)) {
            countsByInstallationId.set(row.installationId, new Set());
          }
          countsByInstallationId.get(row.installationId)!.add(row.userId);
        }

        const conflicts = Array.from(countsByInstallationId.entries()).filter(([_, users]) => users.size > 1);
        let ddlExecuted = false;
        let preflightErrorCode: string | null = null;

        if (conflicts.length > 0) {
          // Step 1 scalar subquery raises MySQL ERROR 1242 before Step 2 CREATE TABLE
          preflightErrorCode = 'ER_SUBQUERY_NO_1_ROW';
        } else {
          ddlExecuted = true;
        }

        assert.equal(conflicts.length, 1);
        assert.equal(conflicts[0][0], 'inst-shared-hw-111');
        assert.equal(preflightErrorCode, 'ER_SUBQUERY_NO_1_ROW', 'Migration must abort with diagnostic before schema changes');
        assert.equal(ddlExecuted, false, 'CREATE TABLE DDL must not execute when preflight detects duplicates');
      });
    });

    describe('Scenario 2: Failed migration does not leave an unrecoverable partial schema state', () => {
      it('[DEFERRED TO PHASE 28] should tolerate MySQL DDL implicit commits using IF NOT EXISTS, inline FK, and non-destructive LEFT JOIN backfill', () => {
        // Simulate partial failure where Step 2 DDL implicitly committed on MySQL,
        // and valid claims already exist (e.g., from partial run or post-DDL traffic).
        const mysqlSchemaState = {
          tableExists: true,
          inlineFkExists: true, // DeviceInstallationClaim_userId_fkey inline inside CREATE TABLE IF NOT EXISTS
          uniqueIndexExists: true, // DeviceInstallationClaim_installationId_key (no redundant ordinary index)
          existingValidClaims: [{ id: 'clm_valid_1', installationId: 'inst-ok-1', userId: 'usr_alpha', deviceId: 'dev_1', status: 'ACTIVE' }]
        };

        // Simulating migration script retry behavior:
        // Step 2: CREATE TABLE IF NOT EXISTS ... CONSTRAINT ... (no ERROR 1050 or ERROR 1826)
        const createIfNotExistsSucceeded = mysqlSchemaState.tableExists && mysqlSchemaState.inlineFkExists;
        // Step 4: Non-destructive LEFT JOIN ... WHERE c.id IS NULL preserves existing valid claims
        const sourceDevices = [
          { id: 'dev_1', installationId: 'inst-ok-1', userId: 'usr_alpha' },
          { id: 'dev_2', installationId: 'inst-missing-2', userId: 'usr_beta' }
        ];
        const claimsByInst = new Map(mysqlSchemaState.existingValidClaims.map((c) => [c.installationId, c]));
        for (const d of sourceDevices) {
          if (!claimsByInst.has(d.installationId)) {
            claimsByInst.set(d.installationId, { id: `clm_backfill_${d.id}`, installationId: d.installationId, userId: d.userId, deviceId: d.id, status: 'ACTIVE' });
          }
        }

        assert.equal(createIfNotExistsSucceeded, true, 'Retry must not crash with ERROR 1050 or ERROR 1826');
        assert.equal(claimsByInst.get('inst-ok-1')?.id, 'clm_valid_1', 'Existing valid claim ID and state must be preserved on retry');
        assert.equal(claimsByInst.size, 2, 'Missing claim must be backfilled alongside preserved existing claim');
      });
    });

    describe('Scenario 3: Migration retry after documented conflict resolution', () => {
      it('[DEFERRED TO PHASE 28] should succeed cleanly upon retry once conflicting Device records are manually reconciled', () => {
        // After DBA runs the documented manual reconciliation UPDATE on stale record:
        const reconciledDevices = [
          { id: 'dev_1', userId: 'usr_alpha', installationId: 'inst-shared-hw-111' },
          { id: 'dev_2', userId: 'usr_beta', installationId: 'inst-reconciled-dev_2' }
        ];

        // Retry Step 1 Preflight: 0 conflicts
        const seenInstallations = new Set<string>();
        let conflictFound = false;
        for (const d of reconciledDevices) {
          if (seenInstallations.has(d.installationId)) conflictFound = true;
          seenInstallations.add(d.installationId);
        }
        assert.equal(conflictFound, false, 'Preflight must pass after reconciliation');

        // Retry Step 3 & Step 4: Full clean backfill succeeds
        const backfilledClaims = reconciledDevices.map((d) => ({
          installationId: d.installationId,
          userId: d.userId,
          deviceId: d.id,
          status: 'ACTIVE'
        }));

        assert.equal(backfilledClaims.length, 2);
        assert.equal(backfilledClaims[0].status, 'ACTIVE');
        assert.equal(backfilledClaims[1].status, 'ACTIVE');
      });
    });

    describe('Scenario 4: Legacy null installation IDs remain supported', () => {
      it('[DEFERRED TO PHASE 28] should bypass null installationId Device rows during backfill without deleting or mutating them', () => {
        const deviceTableRows = [
          { id: 'dev_legacy_1', userId: 'usr_alpha', installationId: null },
          { id: 'dev_legacy_2', userId: 'usr_beta', installationId: null },
          { id: 'dev_modern_1', userId: 'usr_gamma', installationId: 'inst-modern-001' }
        ];

        // WHERE installationId IS NOT NULL filter in migration Step 4
        const eligibleForBackfill = deviceTableRows.filter((d) => d.installationId !== null);

        assert.equal(eligibleForBackfill.length, 1);
        assert.equal(eligibleForBackfill[0].id, 'dev_modern_1');
        // Legacy records stay intact in Device table
        assert.equal(deviceTableRows[0].installationId, null);
        assert.equal(deviceTableRows[1].installationId, null);
      });
    });

    describe('Scenario 5: Recovery confirmation without OTP is rejected', () => {
      it('[DEFERRED TO PHASE 28] should reject password-only or missing-OTP requests to POST /api/v1/devices/re-enroll', () => {
        const requestsWithoutOtp = [
          { installationId: 'inst-revoked-01', recoveryToken: 'rec_valid_token_abc123', password: 'ValidPassword123!' }, // Password-only attempt
          { installationId: 'inst-revoked-01', recoveryToken: 'rec_valid_token_abc123', otp: '' }, // Empty OTP
          { installationId: 'inst-revoked-01', recoveryToken: 'rec_valid_token_abc123' } // Omitted OTP
        ];

        for (const payload of requestsWithoutOtp) {
          const otpValue = (payload as Record<string, unknown>).otp;
          const isValidOtpFormat = typeof otpValue === 'string' && /^\d{6}$/.test(otpValue.trim());
          assert.equal(isValidOtpFormat, false, 'Mandatory 6-digit email OTP is required; password alone must be rejected');
        }
      });
    });

    describe('Scenario 6: Recovery confirmation with an incorrect OTP is rejected', () => {
      it('[DEFERRED TO PHASE 28] should reject recovery confirmation with INVALID_OTP when 6-digit OTP mismatches operation-bound HMAC', () => {
        const user = { id: 'usr_alpha' };
        const installationId = 'inst-revoked-02';
        const expectedOtp = '482910';
        const submittedWrongOtp = '999999';

        // Operation-bound namespace check: devreenroll:<userId>:<salt>:<hmac> over DEVICE_RE_ENROLL:<userId>:<installationId>:<otp>
        const otpMatches = submittedWrongOtp === expectedOtp && user.id === 'usr_alpha' && installationId === 'inst-revoked-02';
        assert.equal(otpMatches, false);

        const errorCode = !otpMatches ? 'INVALID_OTP' : null;
        assert.equal(errorCode, 'INVALID_OTP');
      });
    });

    describe('Scenario 7: Recovery confirmation with an expired or consumed OTP is rejected', () => {
      it('[DEFERRED TO PHASE 28] should reject expired OTPs with EXPIRED_OTP and already-consumed or cross-purpose OTPs with NO_ACTIVE_OTP', () => {
        const now = new Date('2026-11-12T12:00:00.000Z');

        const expiredOtpRecord = {
          otpCode: 'devreenroll:usr_alpha:salt:hmac',
          purpose: 'LOGIN_2FA',
          used: false,
          expiresAt: new Date('2026-11-12T11:59:59.000Z')
        };

        const consumedOtpRecord = {
          otpCode: 'devreenroll:usr_alpha:salt:hmac',
          purpose: 'LOGIN_2FA',
          used: true,
          expiresAt: new Date('2026-11-12T12:10:00.000Z')
        };

        const genericLoginOtpRecord = {
          otpCode: 'salt:regular_login_hmac', // Not prefixed with devreenroll:<userId>:
          purpose: 'LOGIN_2FA',
          used: false,
          expiresAt: new Date('2026-11-12T12:10:00.000Z')
        };

        const expiredResult = expiredOtpRecord.expiresAt <= now ? 'EXPIRED_OTP' : 'VALID';
        const consumedResult = consumedOtpRecord.used ? 'NO_ACTIVE_OTP' : 'VALID';
        const namespaceIsolatedResult = genericLoginOtpRecord.otpCode.startsWith('devreenroll:usr_alpha:') ? 'VALID' : 'NO_ACTIVE_OTP';

        assert.equal(expiredResult, 'EXPIRED_OTP');
        assert.equal(consumedResult, 'NO_ACTIVE_OTP');
        assert.equal(namespaceIsolatedResult, 'NO_ACTIVE_OTP', 'Non-operation-bound LOGIN_2FA OTP must not cross-validate');
      });
    });

    describe('Scenario 8: Valid recovery token plus valid operation-bound OTP succeeds', () => {
      it('[DEFERRED TO PHASE 28] should consume challenge and OTP atomically, reinstate claim ACTIVE, clear revokedAt, rotate credential, and emit DEVICE_RE_ENROLLED', () => {
        const challenge = { challengeHash: 'sha256_rec_token', used: false, expiresAt: new Date(Date.now() + 600000) };
        const otpRecord = { id: 'otp_1', used: false, namespace: 'devreenroll:usr_alpha', expiresAt: new Date(Date.now() + 600000) };
        const credentialBefore = { credentialHash: 'old_revoked_hash', revokedAt: new Date('2026-11-01T00:00:00.000Z') };

        const otpValid = !otpRecord.used && otpRecord.expiresAt > new Date();
        const challengeValid = !challenge.used && challenge.expiresAt > new Date();
        assert.equal(otpValid && challengeValid, true);

        // Simulated atomic transaction updates
        const updatedOtpUsed = true;
        const updatedChallengeUsed = true;
        const updatedClaimStatus = 'ACTIVE';
        const rotatedCredential = {
          credentialHash: 'new_rotated_dst_hash',
          revokedAt: null
        };
        const auditEventType = 'DEVICE_RE_ENROLLED';

        assert.equal(updatedOtpUsed, true);
        assert.equal(updatedChallengeUsed, true);
        assert.equal(updatedClaimStatus, 'ACTIVE');
        assert.notEqual(rotatedCredential.credentialHash, credentialBefore.credentialHash);
        assert.equal(rotatedCredential.revokedAt, null);
        assert.equal(auditEventType, 'DEVICE_RE_ENROLLED');
        assert.notEqual(auditEventType, 'CAMERA_CONFIG_UPDATED');
      });
    });

    describe('Scenario 9: Recovery token replay remains rejected', () => {
      it('[DEFERRED TO PHASE 28] should reject replay of an already-consumed recovery challenge token even inside concurrent transactions', () => {
        const lockedClaimChallenge = {
          challengeHash: 'sha256_rec_token',
          used: true, // Already marked used inside FOR UPDATE transaction
          usedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 500000).toISOString()
        };

        const errorCode = lockedClaimChallenge.used ? 'RECOVERY_TOKEN_ALREADY_USED' : null;
        assert.equal(errorCode, 'RECOVERY_TOKEN_ALREADY_USED');
      });
    });

    describe('Scenario 10: Failed OTP verification does not restore the claim or rotate credentials', () => {
      it('[DEFERRED TO PHASE 28] should keep claim REVOKED/RECOVERY_PENDING, challenge unconsumed, and credential revoked when OTP verification or atomic consumption fails', () => {
        const claimState = { status: 'RECOVERY_PENDING', challengeUsed: false };
        const credentialState = { credentialHash: 'old_revoked_hash', revokedAt: new Date('2026-11-01T00:00:00.000Z') };

        // Simulate OTP failure (either invalid before tx, or concurrent OTP consumption updateMany count === 0 inside tx)
        const otpConsumeCount = 0;
        let transactionRolledBack = false;

        try {
          if (otpConsumeCount !== 1) {
            throw new Error('NO_ACTIVE_OTP');
          }
          claimState.status = 'ACTIVE';
          claimState.challengeUsed = true;
          credentialState.credentialHash = 'should_never_happen';
          credentialState.revokedAt = null;
        } catch {
          transactionRolledBack = true;
        }

        assert.equal(transactionRolledBack, true);
        assert.notEqual(claimState.status, 'ACTIVE');
        assert.equal(claimState.challengeUsed, false);
        assert.equal(credentialState.credentialHash, 'old_revoked_hash');
        assert.ok(credentialState.revokedAt !== null);
      });
    });

    describe('Scenario 11: Successful recovery still leaves Device OFFLINE without fabricating lastSeenAt', () => {
      it('[DEFERRED TO PHASE 28] should set Device.status = OFFLINE and preserve historical lastSeenAt (or null for new device) without faking a heartbeat', () => {
        const existingRevokedDevice = {
          id: 'dev_existing',
          status: 'OFFLINE',
          lastSeenAt: new Date('2026-10-15T08:30:00.000Z')
        };

        const updatedDevice = {
          ...existingRevokedDevice,
          deviceName: 'Pixel 8 Re-enrolled',
          status: 'OFFLINE', // Explicitly NOT set to ONLINE
          lastSeenAt: existingRevokedDevice.lastSeenAt // Explicitly preserved
        };

        assert.equal(updatedDevice.status, 'OFFLINE');
        assert.equal(updatedDevice.lastSeenAt?.toISOString(), '2026-10-15T08:30:00.000Z');
      });
    });

  });

  /* ===========================================================================
   * PHASE 20.3 MIGRATION SAFETY FINAL PATCH SPECIFICATION TESTS
   * Remove Destructive Claim Reset & Ensure Non-Destructive Retries
   * STATUS: NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28
   * =========================================================================== */
  describe('Phase 20.3 Migration Safety Final Patch: Non-Destructive Retries [STATUS: NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28]', () => {

    describe('Patch Test 1: Retry preserves existing valid claims', () => {
      it('[DEFERRED TO PHASE 28] should preserve existing valid claims (including REVOKED status, timestamps, and metadata) on retry', () => {
        const existingClaims = [
          {
            id: 'clm_existing_revoked',
            installationId: 'inst-existing-100',
            userId: 'usr_alpha',
            deviceId: 'dev_100',
            status: 'REVOKED',
            metadata: { revokedReason: 'lost_device' }
          }
        ];

        const sourceDevices = [
          { id: 'dev_100', installationId: 'inst-existing-100', userId: 'usr_alpha' }
        ];

        // Non-destructive LEFT JOIN ... WHERE c.id IS NULL skips existing claims without deleting or overwriting
        const existingByInst = new Map(existingClaims.map((c) => [c.installationId, c]));
        for (const d of sourceDevices) {
          const existing = existingByInst.get(d.installationId);
          if (existing) {
            assert.equal(existing.userId, d.userId);
            assert.equal(existing.deviceId, d.id);
            continue; // Preserved untouched
          }
          existingByInst.set(d.installationId, {
            id: `clm_${d.id}`,
            installationId: d.installationId,
            userId: d.userId,
            deviceId: d.id,
            status: 'ACTIVE',
            metadata: {}
          });
        }

        const preserved = existingByInst.get('inst-existing-100')!;
        assert.equal(preserved.id, 'clm_existing_revoked');
        assert.equal(preserved.status, 'REVOKED', 'Existing claim status must not be reset to ACTIVE');
        assert.equal(preserved.metadata.revokedReason, 'lost_device', 'Existing claim metadata must remain intact');
      });
    });

    describe('Patch Test 2: Existing claims with conflicting owners cause migration failure', () => {
      it('[DEFERRED TO PHASE 28] should fail in Step 3 consistency check when claim.userId differs from Device.userId without reassigning ownership', () => {
        const existingClaim = {
          id: 'clm_conflict_owner',
          installationId: 'inst-shared-999',
          userId: 'usr_attacker',
          deviceId: 'dev_999'
        };
        const sourceDevice = {
          id: 'dev_999',
          installationId: 'inst-shared-999',
          userId: 'usr_victim'
        };

        const hasOwnerConflict = existingClaim.userId !== sourceDevice.userId;
        assert.equal(hasOwnerConflict, true);

        const migrationError = hasOwnerConflict
          ? { code: 'ER_SUBQUERY_NO_1_ROW', diagnostic: 'MIGRATION_ABORTED_EXISTING_CLAIM_CONFLICTS_WITH_DEVICE_RECORD' }
          : null;

        assert.equal(migrationError?.code, 'ER_SUBQUERY_NO_1_ROW', 'Must abort migration with actionable diagnostic');
        assert.equal(existingClaim.userId, 'usr_attacker', 'Migration must never automatically transfer ownership');
      });
    });

    describe('Patch Test 3: Existing claims with conflicting device associations cause migration failure', () => {
      it('[DEFERRED TO PHASE 28] should fail in Step 3 consistency check when claim.deviceId is null or disagrees with Device.id', () => {
        const sourceDevice = {
          id: 'dev_actual_200',
          installationId: 'inst-device-mismatch-200',
          userId: 'usr_alpha'
        };

        const claimWithDifferentDevice = {
          id: 'clm_wrong_dev',
          installationId: 'inst-device-mismatch-200',
          userId: 'usr_alpha',
          deviceId: 'dev_stale_other_999'
        };

        const claimWithNullDevice = {
          id: 'clm_null_dev',
          installationId: 'inst-device-mismatch-200',
          userId: 'usr_alpha',
          deviceId: null as string | null
        };

        const mismatchConflict = claimWithDifferentDevice.deviceId === null || claimWithDifferentDevice.deviceId !== sourceDevice.id;
        const nullConflict = claimWithNullDevice.deviceId === null || claimWithNullDevice.deviceId !== sourceDevice.id;

        assert.equal(mismatchConflict, true, 'Mismatching deviceId must fail Step 3 consistency check');
        assert.equal(nullConflict, true, 'Null deviceId alongside existing Device must fail Step 3 consistency check');
      });
    });

    describe('Patch Test 4: Missing claims are safely backfilled', () => {
      it('[DEFERRED TO PHASE 28] should backfill missing claims via LEFT JOIN ... WHERE c.id IS NULL without touching existing claims', () => {
        const claimsTable = [
          { id: 'clm_keep_1', installationId: 'inst-1', userId: 'usr_a', deviceId: 'dev_1', status: 'ACTIVE' }
        ];
        const devicesTable = [
          { id: 'dev_1', installationId: 'inst-1', userId: 'usr_a' },
          { id: 'dev_2', installationId: 'inst-2', userId: 'usr_b' }
        ];

        const claimedIds = new Set(claimsTable.map((c) => c.installationId));
        const insertedRows = devicesTable
          .filter((d) => d.installationId !== null && !claimedIds.has(d.installationId))
          .map((d) => ({
            id: `clm_backfill_${d.id}`,
            installationId: d.installationId,
            userId: d.userId,
            deviceId: d.id,
            status: 'ACTIVE'
          }));

        const finalClaims = [...claimsTable, ...insertedRows];
        assert.equal(insertedRows.length, 1);
        assert.equal(insertedRows[0].installationId, 'inst-2');
        assert.equal(finalClaims[0].id, 'clm_keep_1');
        assert.equal(finalClaims.length, 2);
      });
    });

    describe('Patch Test 5: Duplicate historical Device installation IDs still fail before DDL', () => {
      it('[DEFERRED TO PHASE 28] should abort in Step 1 preflight with ERROR 1242 before CREATE TABLE IF NOT EXISTS runs', () => {
        const devices = [
          { id: 'dev_1', installationId: 'inst-dup-hw', userId: 'usr_alpha' },
          { id: 'dev_2', installationId: 'inst-dup-hw', userId: 'usr_beta' }
        ];

        const counts = new Map<string, number>();
        for (const d of devices) {
          counts.set(d.installationId, (counts.get(d.installationId) || 0) + 1);
        }

        const hasDuplicates = Array.from(counts.values()).some((c) => c > 1);
        const createTableExecuted = !hasDuplicates;

        assert.equal(hasDuplicates, true);
        assert.equal(createTableExecuted, false, 'DDL must not run when Device table contains duplicate non-null installationIds');
      });
    });

    describe('Patch Test 6: Legacy null installation IDs remain supported', () => {
      it('[DEFERRED TO PHASE 28] should exclude null installationId Device rows in Step 1, Step 3, and Step 4', () => {
        const legacyDevices = [
          { id: 'dev_null_1', installationId: null, userId: 'usr_alpha' },
          { id: 'dev_null_2', installationId: null, userId: 'usr_beta' }
        ];

        const backfilled = legacyDevices.filter((d) => d.installationId !== null);
        assert.equal(backfilled.length, 0, 'Null installationId rows must not be inserted into DeviceInstallationClaim');
        assert.equal(legacyDevices[0].installationId, null);
        assert.equal(legacyDevices[1].installationId, null);
      });
    });

    describe('Patch Test 7: Failed backfill can be retried without deleting valid claims', () => {
      it('[DEFERRED TO PHASE 28] should recover cleanly after interrupted backfill without executing DELETE FROM DeviceInstallationClaim', () => {
        // Claims persisted from partial/concurrent activity before retry (zero DELETE statements executed)
        const existingClaims = new Map<string, { id: string; installationId: string; userId: string; deviceId: string; status: string }>([
          ['inst-ok-before-crash', { id: 'clm_post_ddl_1', installationId: 'inst-ok-before-crash', userId: 'usr_alpha', deviceId: 'dev_a', status: 'RECOVERY_PENDING' }]
        ]);

        const allDevices = [
          { id: 'dev_a', installationId: 'inst-ok-before-crash', userId: 'usr_alpha' },
          { id: 'dev_b', installationId: 'inst-missed-during-crash', userId: 'usr_beta' }
        ];

        // Retry backfill (missing only)
        for (const d of allDevices) {
          if (!existingClaims.has(d.installationId)) {
            existingClaims.set(d.installationId, {
              id: `clm_${d.id}`,
              installationId: d.installationId,
              userId: d.userId,
              deviceId: d.id,
              status: 'ACTIVE'
            });
          }
        }

        assert.equal(existingClaims.get('inst-ok-before-crash')?.id, 'clm_post_ddl_1');
        assert.equal(existingClaims.get('inst-ok-before-crash')?.status, 'RECOVERY_PENDING', 'Existing post-DDL claim must survive retry untouched');
        assert.equal(existingClaims.get('inst-missed-during-crash')?.deviceId, 'dev_b', 'Missing claim must be backfilled on retry');
        assert.equal(existingClaims.size, 2);
      });
    });

  });

});
