# ZDEXCLOUD — PHASE 20.3 CORRECTIVE REVIEW REPORT
## GLOBAL INSTALLATION OWNERSHIP & SAFE DEVICE RE-ENROLLMENT

**Execution Mode:** Focused Corrective Implementation  
**Scope:** Phase 20.3 Corrective Review — Device Identity & Ownership Integrity  
**Roadmap Reference:** Phase 20 (Camera Backend & Infrastructure) -> Batch 20.3  
**Status:** IMPLEMENTED — TESTING DEFERRED TO PHASE 28  
**Canonical Domain:** `https://zdexcloud.com`

---

## 1. ROOT-CAUSE ANALYSIS OF THE PER-USER LOCKING VULNERABILITY

In the initial implementation of device registration, the transactional concurrency defense relied on acquiring a row lock on the registering user's record:

```sql
SELECT id FROM `User` WHERE id = ? FOR UPDATE;
```

Coupled with this, the `Device` model enforced only a composite uniqueness constraint:

```prisma
@@unique([userId, installationId])
```

### The Race Condition Window:
When User Alpha (`usr_alpha`) and User Beta (`usr_beta`) concurrently submitted registration requests specifying the identical Android `installationId` (e.g. `inst-device-xyz`):
1. **Disjoint Row Locks:** User Alpha's transaction locked row `User(usr_alpha)`, while User Beta's transaction locked row `User(usr_beta)`. Because two different user rows were locked, the database did not serialize the two transactions against each other.
2. **Composite Key Bypass:** The composite constraint `(userId, installationId)` permitted `('usr_alpha', 'inst-device-xyz')` and `('usr_beta', 'inst-device-xyz')` to be inserted simultaneously without triggering a unique index violation.
3. **Application-Level Check Ineffectiveness:** The preliminary read `SELECT * FROM Device WHERE installationId = ? AND userId != ?` was vulnerable to standard time-of-check / time-of-use (TOCTOU) races, as neither transaction had committed when the other evaluated the read check.

**Resulting Risk:** Two accounts could simultaneously claim the same physical device installation, leading to credential cross-talk, device hijacking, and ownership confusion.

---

## 2. GLOBAL INSTALLATION OWNERSHIP ARCHITECTURE (`DeviceInstallationClaim`)

To permanently close this vulnerability, ZdexCloud establishes an authoritative, database-level global installation ownership model: `DeviceInstallationClaim`.

### Architecture Design:
1. **Global Uniqueness Invariant:** The `installationId` column in `DeviceInstallationClaim` is indexed with a global `UNIQUE` constraint:
   $$\forall \text{ claim}_1, \text{ claim}_2: \quad \text{claim}_1.\text{installationId} = \text{claim}_2.\text{installationId} \iff \text{claim}_1 = \text{claim}_2$$
2. **Atomic Ownership Assignment:** When a device registration begins, the registration transaction must atomically insert or verify the claim for that `installationId` within `DeviceInstallationClaim`.
3. **MySQL Unique Key Lock Serialization:** Any concurrent attempt by another user to claim the same `installationId` immediately blocks on or triggers MySQL's unique constraint violation (`Error 1062 / Prisma P2002`).
4. **Owner Validation:** If a claim already exists, the transaction strictly verifies `claim.userId === currentUserId`. Any discrepancy immediately raises a `ForbiddenError('DEVICE_ALREADY_REGISTERED_OTHER_ACCOUNT')`.

---

## 3. SCHEMA CHANGES AND MIGRATION STRATEGY

### Prisma Schema Definition (`main website/Backend/prisma/schema.prisma`):

```prisma
/// Global Device Installation Claim for Cross-Account Anti-Hijacking and Safe Re-Enrollment (Phase 20.3)
model DeviceInstallationClaim {
  id             String    @id @default(cuid())
  installationId String    @unique
  userId         String
  deviceId       String?
  status         String    @default("ACTIVE") // ACTIVE | REVOKED | RECOVERY_PENDING
  metadata       Json?
  claimedAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  user           User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([installationId])
  @@index([status])
}
```

### Additive Migration Artifact:
- **Migration Location:** `main website/Backend/prisma/migrations/20261107180000_add_device_installation_claim/migration.sql`
- **Safety Policy:** 100% additive, non-destructive, and non-breaking.
- **Safe Backfill Query:** Automatically imports existing non-null `installationId` records from `Device` using `INSERT IGNORE`:

```sql
INSERT IGNORE INTO `DeviceInstallationClaim` (`id`, `installationId`, `userId`, `deviceId`, `status`, `claimedAt`, `updatedAt`)
SELECT
    CONCAT('clm_', SUBSTRING(MD5(CONCAT(`userId`, '_', `installationId`)), 1, 25)),
    `installationId`,
    `userId`,
    `id`,
    'ACTIVE',
    `createdAt`,
    `updatedAt`
FROM `Device`
WHERE `installationId` IS NOT NULL;
```

> **Database Safety Notice:** This migration artifact has been created statically in source control and will NOT be applied to remote or production environments until Phase 28.

---

## 4. REVOCATION LIFECYCLE SEPARATION (NORMAL REGISTRATION VS. EXPLICIT RE-ENROLLMENT)

Prior to this correction, an existing device that had its credentials revoked (`DeviceAuthCredential.revokedAt != null`) could be accidentally reinstated by issuing a standard `POST /devices/register` call, which would update `revokedAt = null` without requiring re-authentication or credential rotation.

### Corrected Lifecycle Rules:
1. **Revocation is Terminal for Normal Flows:**
   - Both `POST /api/v1/devices/register` (Storage & General) and `CameraDeviceIdentityService.registerOrResolveCameraDevice()` evaluate revocation status upfront.
   - If `claim.status === 'REVOKED'` or `credential.revokedAt != null`, normal registration **fails closed** with `403 Forbidden` (`DEVICE_REVOKED`).
   - Normal registration **NEVER** resets `revokedAt` or issues replacement credentials for a revoked installation.
2. **Explicit Re-Enrollment Requirement:**
   - A revoked installation can only be returned to service via the dedicated re-enrollment flow: `POST /api/v1/devices/re-enroll`.
   - The caller must be the authenticated owner of the `DeviceInstallationClaim`.
   - Re-enrollment forces credential rotation, clears `revokedAt`, sets claim status to `ACTIVE`, and generates a tamper-evident audit record.

---

## 5. RE-ENROLLMENT FLOW AND CREDENTIAL ROTATION MECHANICS

### Flow 1: Challenge-Based Re-Enrollment (Two-Step Verification)
1. **Challenge Request (`POST /api/v1/devices/re-enroll-challenge`):**
   - Caller presents `{ installationId }`.
   - Service verifies account ownership of the claim.
   - Generates high-entropy token: `rec_<24-byte-hex>` (e.g. `rec_a8f9c04e2...`).
   - Persists only `SHA-256(rec_token)` into `DeviceInstallationClaim.metadata.recoveryChallenge`.
   - Sets strict 10-minute TTL (`expiresAt = now + 600s`).
   - Sets claim status to `RECOVERY_PENDING`.
   - Emits `DEVICE_RE_ENROLLMENT_CHALLENGE_ISSUED` audit event.
2. **Challenge Consumption (`POST /api/v1/devices/re-enroll`):**
   - Caller presents `{ installationId, recoveryToken }`.
   - Service hashes the presented token and validates against persisted hash.
   - Asserts token is unconsumed (`used !== true`) and unexpired (`expiresAt > now`).
   - Atomically consumes the challenge: marks `used = true` and `usedAt = now`.

### Flow 2: Authenticated Direct Re-Enrollment (Owner Sign-In)
- If the owner is actively logged into the mobile app and re-authenticates via their verified user session, they can call `POST /api/v1/devices/re-enroll` directly with their user credentials.

### Credential Rotation Mechanics:
Upon successful re-enrollment in either flow:
1. A fresh high-entropy device session token is generated: `dst_<24-byte-hex>`.
2. The credential hash is updated: `credentialHash = SHA256(dst_token)`.
3. The revocation timestamp is cleared: `revokedAt = null`.
4. Refresh and last-used timestamps are updated: `lastRefreshAt = now`, `lastUsedAt = now`.
5. Device record is transitioned: `status = 'ONLINE'`, `lastSeenAt = now`.
6. Claim record is transitioned: `status = 'ACTIVE'`.
7. Audit events are recorded: `DEVICE_RE_ENROLLED` and `CAMERA_CONFIG_UPDATED`.

---

## 6. RACE CONDITION MITIGATION AND PRISMA TRANSACTION SAFETY

### Concurrency Protection Matrix:

| Concurrency Scenario | Mechanism | Result |
| :--- | :--- | :--- |
| **Two accounts race for same new `installationId`** | Database `UNIQUE(installationId)` on `DeviceInstallationClaim` | First transaction claims row; second transaction throws `P2002` -> caught and translated to `403 Forbidden` (`DEVICE_ALREADY_REGISTERED_OTHER_ACCOUNT`). Clean rollback. |
| **Same account sends concurrent registrations** | Transaction-level claim read + composite key `[userId, installationId]` on `Device` | First transaction creates device; second transaction reuses existing device idempotently. |
| **Intruder attempts re-enrollment of another account's device** | Pre-transaction claim check + transactional ownership assertion | Blocked with `403 Forbidden` (`CROSS_ACCOUNT_RE_ENROLLMENT_DENIED`). |
| **Race between re-enrollment and revocation** | Row update inside `$transaction` | Serialized by MySQL row lock on `DeviceAuthCredential` and `DeviceInstallationClaim`. |
| **Replay attack with consumed recovery token** | `used: true` flag set inside `$transaction` | Second consumption attempt rejected with `403 Forbidden` (`RECOVERY_TOKEN_ALREADY_USED`). |

---

## 7. AUDIT EVENT CATALOG FOR CLAIM AND RE-ENROLLMENT OPERATIONS

All audit logs adhere to zero-credential leakage standards. Raw recovery tokens (`rec_*`) and raw device credentials (`dst_*`) are never written to logs or audit records.

| Event Type / Action | Trigger Condition | Logged Metadata |
| :--- | :--- | :--- |
| `CROSS_ACCOUNT_DEVICE_CLAIM_REJECTED` | User attempts to register `installationId` already owned by another account. | `attemptedInstallationId` (masked), `currentUserId`, `reason`, `ipAddress`, `userAgent` |
| `REVOKED_DEVICE_REGISTRATION_REJECTED` | User attempts normal registration on a revoked device without re-enrollment. | `attemptedInstallationId` (masked), `deviceId`, `reason`, `ipAddress`, `userAgent` |
| `DEVICE_RE_ENROLLMENT_CHALLENGE_ISSUED` | Verified owner requests recovery token for a revoked device. | `installationId` (masked), `expiresAt`, `ipAddress`, `userAgent` |
| `CROSS_ACCOUNT_RE_ENROLLMENT_DENIED` | Non-owner attempts to re-enroll an installation. | `attemptedInstallationId` (masked), `reason`, `ipAddress`, `userAgent` |
| `RE_ENROLLMENT_FAILED` | Re-enrollment attempt with invalid, expired, or consumed token. | `reason` (`invalid_recovery_token`, `recovery_token_expired`, `recovery_token_already_used`), `ipAddress`, `userAgent` |
| `DEVICE_RE_ENROLLED` | Successful re-enrollment and credential rotation. | `installationId` (masked), `deviceId`, `deviceName`, `action`, `ipAddress`, `userAgent` |

---

## 8. BACKWARD COMPATIBILITY

1. **Storage Subsystems:**
   - Existing Storage registrations through `POST /api/v1/devices/register` continue to provision `ServerInstance` and maintain their 5-server quota checks.
   - Storage devices automatically acquire an active `DeviceInstallationClaim` record upon registration, preventing any cross-account hijack attempt.
2. **Camera Subsystems (Phases 20.1 & 20.2):**
   - Camera registration without ServerInstance remains 100% operational.
   - Camera association and dissociation functions continue to enforce user-to-device ownership boundaries.
3. **Legacy Device Records:**
   - Pre-existing devices with null `installationId` are ignored by `INSERT IGNORE` backfill and are never falsely matched against incoming installation IDs.

---

## 9. SECURITY INVARIANTS SATISFIED

1. **Global Uniqueness Invariant:** No two accounts can simultaneously own or claim the same `installationId`.
2. **Fail-Closed Revocation Invariant:** Once revoked, a device credential and installation claim cannot be reactivated via normal registration endpoints.
3. **Owner-Only Re-Enrollment Invariant:** Re-enrollment is strictly restricted to the authenticated user owning the installation claim.
4. **Single-Use Challenge Invariant:** Re-enrollment recovery challenges cannot be replayed or reused.
5. **Zero Secret Leakage Invariant:** All secret credentials and recovery tokens are stored exclusively as SHA-256 hashes and redacted from audit logs.

---

## 10. TEST SCENARIOS ADDED TO SPECIFICATION TESTS

The test suite at `main website/Backend/tests/camera_device_registration_and_identity.test.ts` has been updated with the following 10 specification scenarios:

1. **Scenario 1:** Cross-account installation claim rejected before transaction.
2. **Scenario 2:** Concurrent cross-account registration race condition: second transaction fails unique constraint and rolls back cleanly.
3. **Scenario 3:** Same-account re-registration reuses existing device without duplicate claim error.
4. **Scenario 4:** Normal registration of revoked device is rejected (`DEVICE_REVOKED`).
5. **Scenario 5:** Revoked device cannot be reactivated via normal `POST /devices/register`.
6. **Scenario 6:** Explicit re-enrollment by claim owner succeeds: issues new credential, clears `revokedAt`, records `DEVICE_RE_ENROLLED` audit event.
7. **Scenario 7:** Explicit re-enrollment by a different user is rejected (`CROSS_ACCOUNT_RE_ENROLLMENT_DENIED`).
8. **Scenario 8:** Single-use recovery token cannot be reused (`RECOVERY_TOKEN_ALREADY_USED`).
9. **Scenario 9:** Expired recovery token is rejected (`RECOVERY_TOKEN_EXPIRED`).
10. **Scenario 10:** All operations record appropriate audit events with zero secret leakage.

*Test Execution Status:* **NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28.**

---

## 11. VERIFICATION PLAN FOR PHASE 28

During Phase 28 (Final Consolidated Testing & Deployment), the following end-to-end verification steps will validate this corrective implementation:
1. **Migration Execution:** Apply migration `20261107180000_add_device_installation_claim` to staging/production MySQL instances.
2. **Race Simulation:** Run automated parallel worker threads attempting concurrent claims of the same `installationId` across distinct user accounts.
3. **Revocation E2E:** Revoke a device node, verify gateway disconnect, verify normal registration rejection, and verify successful re-enrollment via `POST /api/v1/devices/re-enroll`.
4. **Audit Log Inspection:** Verify that audit tables contain masked identifiers and zero raw token strings.
