# ZDEXCLOUD — PHASE 20.3 FINAL SECURITY CORRECTION
## MYSQL MIGRATION RECOVERABILITY & MANDATORY OTP CONFIRMATION VERIFICATION REPORT

**Date:** 2026-11-12  
**Batch:** Phase 20.3 — Final Security Correction  
**Execution Status:** Implementation Complete (Static Inspection Only)  
**Test Execution Status:** NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28  
**Remote Database Status:** ZERO MUTATIONS — Migration NOT applied to local, staging, or production MySQL  

---

## 1. Executive Summary

This final corrective batch resolves the remaining MySQL migration recoverability hazards and enforces mandatory, operation-bound Email OTP two-factor confirmation for revoked device re-enrollment:

1. **MySQL Implicit-Commit Safe & Fail-Closed Migration (`20261107180000_add_device_installation_claim`)**:
   - Executes a preflight duplicate detection check **before** any DDL statements run.
   - Moves foreign key constraint definition inline inside `CREATE TABLE IF NOT EXISTS` to survive MySQL DDL implicit commits on retry without `ERROR 1050` or `ERROR 1826`.
   - Performs an idempotent clean slate reset (`DELETE FROM DeviceInstallationClaim`) prior to backfill and uses a fail-closed `INSERT INTO ... SELECT` (without `IGNORE`) to strictly preserve legacy `NULL` installation IDs and abort on cross-account duplicates.
2. **Mandatory Operation-Bound Email OTP Confirmation**:
   - Removes password-only fallback from `POST /api/v1/devices/re-enroll` (`reEnrollSchema` and `CameraDeviceIdentityService.reEnrollRevokedDevice`).
   - Introduces an isolated, user-bound, installation-bound OTP namespace (`devreenroll:<userId>:<salt>:<hmac>`) in `src/utils/crypto.ts` and `src/utils/otp.ts`, preventing cross-validation with `LOGIN_2FA`, `REGISTRATION_VERIFICATION`, `PASSWORD_RESET`, or `PASSWORD_CHANGE` OTPs.
   - Atomically consumes both the OTP (`count === 1` check) and the recovery challenge (under `FOR UPDATE` claim row locking) inside `prisma.$transaction()` alongside credential rotation and `OFFLINE` state preservation.

---

## 2. MySQL Migration Execution-Order Analysis

Inspected files:
- `main website/Backend/prisma/migrations/20261107180000_add_device_installation_claim/migration.sql`
- `main website/Backend/prisma/schema.prisma` (`DeviceInstallationClaim`, lines 579–593)

### Actual Execution Order in `migration.sql`

1. **Step 1 — Preflight Conflict Detection (Pre-DDL DML Select)**:
   - Runs a scalar `SELECT CASE WHEN (...) > 0 THEN (SELECT 'MIGRATION_ABORTED_...' UNION ALL SELECT CONCAT(...)) ELSE 'PREFLIGHT_OK_NO_DUPLICATE_INSTALLATION_IDS' END AS preflight_status` query evaluating `Device` rows where `installationId IS NOT NULL` grouped by `installationId` with `HAVING COUNT(DISTINCT userId) > 1`.
   - Because this runs **before** `CREATE TABLE`, any existing cross-account duplicates force MySQL to raise `ERROR 1242 (Subquery returns more than 1 row)` prior to any schema modification.
2. **Step 2 — Idempotent Table, Index & Foreign Key Creation**:
   - `CREATE TABLE IF NOT EXISTS DeviceInstallationClaim (...)` defines:
     - Primary Key (`id`)
     - Global unique constraint: `UNIQUE INDEX DeviceInstallationClaim_installationId_key(installationId)`
     - Secondary query indexes: `INDEX DeviceInstallationClaim_userId_idx(userId)`, `INDEX DeviceInstallationClaim_status_idx(status)`
     - Inline Foreign Key: `CONSTRAINT DeviceInstallationClaim_userId_fkey FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE ON UPDATE CASCADE`
   - Inspected `schema.prisma`: `DeviceInstallationClaim` has `installationId String @unique`, `@@index([userId])`, and `@@index([status])`. No redundant ordinary index exists on `installationId`.
3. **Step 3 — Idempotent Clean Slate Reset**:
   - `DELETE FROM DeviceInstallationClaim;` clears any partial rows left behind if a previous migration attempt was interrupted mid-backfill.
4. **Step 4 — Fail-Closed Authoritative Backfill**:
   - `INSERT INTO DeviceInstallationClaim (...) SELECT ... FROM Device WHERE installationId IS NOT NULL;`
   - Omits `INSERT IGNORE`, ensuring no silent owner selection occurs if duplicate non-null `installationId` values appear concurrently between Step 1 and Step 4 (`ERROR 1062 ER_DUP_ENTRY`).
   - Legacy `Device` rows with `installationId IS NULL` are excluded from backfill and remain unmodified.

---

## 3. Duplicate Detection & Migration Recovery Strategy

- **Detection Before Schema Changes**: Step 1 identifies any `installationId` shared across distinct `userId` values (`COUNT(DISTINCT userId) > 1`) before DDL runs.
- **No Silent Mutations**: The migration never deletes, merges, or automatically picks a winning account for conflicting `Device` records.
- **Documented Manual Reconciliation & Retry Procedure** (embedded in `migration.sql` header comments):
  1. Run the documented `SELECT installationId, COUNT(DISTINCT userId), GROUP_CONCAT(userId), GROUP_CONCAT(id) FROM Device WHERE installationId IS NOT NULL GROUP BY installationId HAVING userCount > 1;` diagnostic query.
  2. Inspect audit logs, `lastSeenAt`, and account activity to establish physical device ownership.
  3. With customer authorization, update the stale/conflicting record's `installationId` (e.g., `UPDATE Device SET installationId = CONCAT('inst-reconciled-', id) WHERE id = '<stale_device_id>';`).
  4. Re-run `prisma migrate deploy` (safe due to Steps 1–4 idempotency).

---

## 4. Partial DDL Failure Handling (MySQL Implicit Commits)

MySQL does not support transactional rollback of DDL statements (`CREATE TABLE`, `ALTER TABLE`). Once `CREATE TABLE` executes, MySQL issues an implicit commit.

In standard Prisma migrations where `CREATE TABLE` is followed by a separate `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY`, if a downstream `INSERT` backfill fails:
- The table already exists in MySQL, causing retry crashes with `ERROR 1050 (Table 'DeviceInstallationClaim' already exists)` or `ERROR 1826 (Duplicate foreign key constraint name)` if `IF NOT EXISTS` is added to the table alone.

**Resolution Applied**:
- `CREATE TABLE IF NOT EXISTS` encapsulates the columns, primary key, unique index, secondary indexes, **and** inline `CONSTRAINT DeviceInstallationClaim_userId_fkey` in a single idempotent DDL statement.
- Paired with `DELETE FROM DeviceInstallationClaim;` before `INSERT INTO ... SELECT`, an aborted migration after DDL implicit commit recovers cleanly on retry without manual table drops or unsafe schema edits.

---

## 5. Mandatory OTP Confirmation Behavior

Inspected files:
- `main website/Backend/src/routes/device.ts`
- `main website/Backend/src/services/camera_device_identity_service.ts`

1. **Challenge Creation (`POST /api/v1/devices/re-enroll-challenge`)**:
   - Validates `reEnrollChallengeSchema` (`installationId`, `password`).
   - Verifies account ownership (`DeviceInstallationClaim` and defense-in-depth `Device` check) and password via timing-safe `verifyPassword()`.
   - Dispatches an operation-bound 6-digit email OTP via `issueDeviceReEnrollmentOtp(user.id, user.email, validInstallationId)` (respecting `RESEND_COOLDOWN_ACTIVE` if recently sent).
   - Generates a high-entropy single-use recovery token (`rec_<48 hex chars>`), stores only its SHA-256 hash (`hashSessionToken`) inside claim metadata with a 600-second TTL, sets claim status to `RECOVERY_PENDING`, and emits `DEVICE_RE_ENROLLMENT_CHALLENGE_ISSUED`.
2. **Recovery Confirmation (`POST /api/v1/devices/re-enroll`)**:
   - Enforces `reEnrollSchema`: `installationId`, `recoveryToken`, and mandatory `otp: z.string().regex(/^\d{6}$/)`. Password-only confirmation is rejected at Zod validation **and** inside `CameraDeviceIdentityService.reEnrollRevokedDevice()`.
   - Rejects malformed, mismatched, expired (`expiresAt <= now`), or consumed (`used === true`) recovery tokens.
   - Pre-verifies the 6-digit OTP via `verifyDeviceReEnrollmentOtp(user.id, user.email, validInstallationId, input.otp.trim(), { consume: false })`.
   - Rejects invalid (`INVALID_OTP`), expired (`EXPIRED_OTP`), missing/consumed (`NO_ACTIVE_OTP`), or brute-force locked (`TOO_MANY_ATTEMPTS`) OTPs before executing state mutations.

---

## 6. OTP Namespace & Expiration Verification

Inspected files:
- `main website/Backend/src/utils/crypto.ts`
- `main website/Backend/src/utils/otp.ts`

To guarantee strict namespace separation without altering database schema enums (`OtpPurpose`), device re-enrollment OTPs follow the established operation-binding pattern:

- **Namespace Format**: `devreenroll:<userId>:<salt>:<hmac>` where HMAC-SHA256 covers `DEVICE_RE_ENROLL:${cleanUserId}:${cleanInstallationId}:${cleanOtp}`.
- **Cross-Validation Prevention**:
  - `verifyOtpCode()` in `crypto.ts` explicitly rejects both `pwdchg:` and `devreenroll:` prefixed hashes.
  - `issueEmailOtp()` and `verifyEmailOtp()` in `otp.ts` explicitly exclude records starting with `pwdchg:` and `devreenroll:`.
  - Consequently, standard `LOGIN_2FA`, `REGISTRATION_VERIFICATION`, `PASSWORD_RESET`, and `PASSWORD_CHANGE` OTPs cannot verify device re-enrollment, and device re-enrollment OTPs for one account or `installationId` cannot verify another account or `installationId`.
- **Expiration & Attempt Lockout**:
  - Uses `config.EMAIL_VERIFICATION_OTP_EXPIRY_SECONDS` for TTL.
  - Fail-closed expiry boundary (`if (record.expiresAt <= new Date())`) marks the record `used: true` and returns `EXPIRED_OTP`.
  - Enforces `config.OTP_MAX_ATTEMPTS` brute-force lockout (`TOO_MANY_ATTEMPTS`).

---

## 7. Recovery Transaction & Audit Guarantees

Inside `CameraDeviceIdentityService.reEnrollRevokedDevice()`, `prisma.$transaction()` provides atomic rollback across all state changes:

1. **Atomic OTP Consumption**: `tx.emailOtp.updateMany({ where: { id: otpResult.otpRecordId, userId: user.id, used: false }, data: { used: true } })` verifies `consumedOtp.count === 1`, throwing `UnauthorizedError(..., 'NO_ACTIVE_OTP')` on concurrent race consumption.
2. **Row-Locked Recovery Challenge Consumption**: Executes `SELECT id FROM DeviceInstallationClaim WHERE id = ... FOR UPDATE`, re-verifies `challengeHash`, `used !== true`, and `expiresAt > new Date()`, and sets `used: true` + `usedAt` alongside `claim.status = 'ACTIVE'`.
3. **Device State Integrity (`OFFLINE`)**: Sets `Device.status = 'OFFLINE'` and explicitly preserves existing `Device.lastSeenAt` (or `null` if newly created) — never marking the node `ONLINE` or fabricating a live heartbeat.
4. **Credential Rotation**: Upserts `DeviceAuthCredential` with a fresh SHA-256 hashed `dst_<hex>` token (`revokedAt = null`). Old revoked credentials remain permanently invalidated.
5. **Audit & Secret Redaction**:
   - Emits `DEVICE_RE_ENROLLED` (and `DEVICE_RE_ENROLLMENT_CHALLENGE_ISSUED` on challenge creation) and failure audit events (`RE_ENROLLMENT_FAILED`, `CROSS_ACCOUNT_RE_ENROLLMENT_DENIED`) with masked installation ID prefixes (`<8 chars>...`).
   - Emits **no** `CAMERA_CONFIG_UPDATED` events during device re-enrollment.
   - Never logs or persists raw passwords, OTP codes, recovery tokens, or device session tokens.

---

## 8. Tests Created / Updated (NOT RUN)

Updated file:
- `main website/Backend/tests/camera_device_registration_and_identity.test.ts`

All 11 Phase 20.3 Final Security Correction scenarios were added/updated under `Phase 20.3 Final Security Correction: Migration Recoverability & Mandatory OTP Confirmation [STATUS: NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28]`:

1. **Scenario 1**: Historical duplicate detection happens before schema changes where supported. — **STATUS: NOT RUN**
2. **Scenario 2**: Failed migration does not leave an unrecoverable partial schema state. — **STATUS: NOT RUN**
3. **Scenario 3**: Migration retry after documented conflict resolution. — **STATUS: NOT RUN**
4. **Scenario 4**: Legacy null installation IDs remain supported. — **STATUS: NOT RUN**
5. **Scenario 5**: Recovery confirmation without OTP is rejected. — **STATUS: NOT RUN**
6. **Scenario 6**: Recovery confirmation with an incorrect OTP is rejected. — **STATUS: NOT RUN**
7. **Scenario 7**: Recovery confirmation with an expired or consumed OTP is rejected. — **STATUS: NOT RUN**
8. **Scenario 8**: Valid recovery token plus valid operation-bound OTP succeeds. — **STATUS: NOT RUN**
9. **Scenario 9**: Recovery token replay remains rejected. — **STATUS: NOT RUN**
10. **Scenario 10**: Failed OTP verification does not restore the claim or rotate credentials. — **STATUS: NOT RUN**
11. **Scenario 11**: Successful recovery still leaves Device OFFLINE without fabricating lastSeenAt. — **STATUS: NOT RUN**

---

## 9. Static Inspection Performed

Direct source inspection completed across:
- `main website/Backend/prisma/schema.prisma` (lines 579–593)
- `main website/Backend/prisma/migrations/20261107180000_add_device_installation_claim/migration.sql` (lines 1–94)
- `main website/Backend/src/utils/crypto.ts` (lines 50–219)
- `main website/Backend/src/utils/otp.ts` (lines 1–524)
- `main website/Backend/src/routes/device.ts` (lines 35–55, 1245–1320)
- `main website/Backend/src/services/camera_device_identity_service.ts` (lines 1–75, 930–1393)
- `main website/Backend/tests/camera_device_registration_and_identity.test.ts` (lines 1–570)

Also fixed a trailing syntax brace (`});`) at the end of `camera_device_registration_and_identity.test.ts` and removed the stale optional `password` argument/comment from `/devices/re-enroll` in `src/routes/device.ts`.

---

## 10. Remaining Limitations

1. **SQLite/Shadow Database Compatibility Note**: Step 1 preflight uses a MySQL-specific multi-row scalar subquery trick (`ERROR 1242`) and Step 2 uses MySQL `CREATE TABLE IF NOT EXISTS ... CONSTRAINT`. This migration is targeted strictly at MySQL (matching `datasource db { provider = "mysql" }`).
2. **Deferred Runtime Execution**: Specification tests in `camera_device_registration_and_identity.test.ts` use deterministic state-assertion harnesses; full end-to-end HTTP + Prisma + MySQL integration execution is intentionally deferred until Phase 28.
3. **Pre-Verification Retry Side Effect**: `verifyDeviceReEnrollmentOtp` increments `attempts` (and may trip `TOO_MANY_ATTEMPTS`) before entering `prisma.$transaction()`, which is intentional security behavior for brute-force protection.

---

## 11. Compliance Confirmation

- **Zero Test Execution**: Confirmed. No test runners (`node --test`, `npm test`, `vitest`, `jest`), TypeScript test compilations, or scripts were executed.
- **Zero Remote Database Mutations**: Confirmed. No migrations, DDL, or DML were run against any local, staging, remote, or production database.
- **Zero Deployments / Restarts**: Confirmed. No builds, PM2 restarts, or service deployments were performed.
- **Scope Strictness**: Phase 20.3 only. Phase 20.4 (Lifecycle), Phase 20.5 (Signaling), Android Capture, and Storage subsystems were untouched.
