# ZDEXCLOUD — PHASE 20.2 CORRECTIVE REVIEW REPORT
## VIEWING TOKEN EXPIRY, STOP REQUEST ACCURACY & SECURITY AUDIT RELIABILITY

**Project:** ZdexCloud Personal Cloud Platform  
**Phase:** 20.2 — Camera Backend API Foundation (Corrective Review)  
**Execution Mode:** Focused Corrective Implementation  
**Date:** November 7, 2026  
**Final Status:** COMPLETE  
**Production / Remote Database Changes:** ZERO (0 modifications, zero DDL executed on remote MySQL)  
**Live External Calls:** ZERO (0 calls)  
**Dependencies Added:** ZERO (0 packages installed)  
**Tests Executed:** ZERO (0 test runners executed; all test scenarios strictly marked `NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28`)

---

## 1. EXACT FILES MODIFIED AND CREATED

### Files Created:
1. `main website/Backend/prisma/migrations/20261107160000_add_camera_stream_session_expires_at_and_revocation/migration.sql`
   - Additive, non-destructive MySQL DDL introducing `expiresAt` column to `CameraStreamSession`, performance lookup indexes on `expiresAt` and `sessionTokenHash`, and extending `CameraStreamSessionStatus` enum with `REVOKED`.
2. `docs/PHASE_20_2_CORRECTIVE_REVIEW_REPORT.md`
   - This comprehensive corrective review report.

### Files Modified:
1. `main website/Backend/prisma/schema.prisma`
   - Extended `enum CameraStreamSessionStatus` with `REVOKED`.
   - Added `expiresAt DateTime?` to `model CameraStreamSession`.
   - Added `@@index([expiresAt])` and `@@index([sessionTokenHash])` to `model CameraStreamSession`.
2. `main website/Backend/src/errors/app-error.ts`
   - Added `SecurityAuditPersistenceError` (HTTP 500, code `SECURITY_AUDIT_PERSISTENCE_FAILED`).
3. `main website/Backend/src/services/camera_service.ts`
   - Implemented `classifyAuditEvent()` separating events into `CRITICAL` vs `OPERATIONAL`.
   - Implemented transactional audit recording `recordAuditEventWithTx(tx, params)` for atomic security writes.
   - Implemented reliable retry loop (3 attempts with exponential backoff) and non-silent failure throwing `SecurityAuditPersistenceError` in `recordAuditEvent()`.
   - Implemented persisted 15-minute `expiresAt` tracking and transactional session creation in `createViewingToken()`.
   - Implemented internal validation service `validateViewingToken(rawToken, options)` enforcing authoritative expiration, status validation (`REVOKED`, `ENDED`, `FAILED`, `TIMED_OUT`), and entitlement verification without extending token lifetimes.
   - Implemented session revocation service `revokeViewingSession()`.
   - Corrected `requestStopCamera()` to record pending intent in `metadata.pendingCommand` without falsely claiming `OFFLINE` or terminating active sessions.
   - Corrected `requestStartCamera()` to record pending intent in `metadata.pendingCommand` and accurately distinguish in-progress vs confirmed states.
   - Updated `getCameraStatus()` to expose `pendingCommand`.
4. `main website/Backend/tests/camera_api_foundation.test.ts`
   - Expanded from 16 to 21 specification test scenarios covering exact 15-minute token expiry boundaries, session status rejections, token hash rejections, stop request state retention, active session preservation, and audit reliability.
   - All scenarios strictly marked `NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28`.

---

## 2. HOW TOKEN EXPIRATION IS ENFORCED

Token expiration is now enforced through authoritative database persistence and a multi-stage validation pipeline:

### 2.1 Persisted Expiration at Issuance
When `CameraService.createViewingToken()` is called:
- An ephemeral token is minted: `cvt_${crypto.randomBytes(32).toString('hex')}`.
- A fixed 15-minute TTL (`ttlSeconds = 900`) is established.
- The authoritative expiration timestamp is computed: `expiresAt = new Date(Date.now() + 900 * 1000)`.
- Inside an atomic database transaction (`prisma.$transaction`), `CameraStreamSession` is created with both `sessionTokenHash` (SHA-256) and the persisted `expiresAt` timestamp.
- The critical audit event `VIEWING_SESSION_REQUESTED` is committed within the same transaction.

### 2.2 Authoritative Validation via Internal Service
The new method `CameraService.validateViewingToken(rawToken, options)` validates viewing credentials for future signaling integration (Phase 20.5) through the following enforcement gates:
1. **Format Validation:** Rejects any token not starting with `cvt_` or lacking sufficient entropy.
2. **Cryptographic Lookup:** Computes `hashSessionToken(rawToken)` and queries `CameraStreamSession` via the newly indexed `sessionTokenHash` column.
3. **Session Status Gate:**
   - Rejects `REVOKED` sessions (`reason: 'SESSION_REVOKED'`).
   - Rejects `ENDED` or `FAILED` sessions (`reason: 'SESSION_ENDED'`).
   - Rejects already timed-out sessions (`reason: 'TOKEN_EXPIRED'`).
4. **Authoritative Expiration Check:**
   - Evaluates `if (session.expiresAt && session.expiresAt <= new Date())`.
   - If expired, automatically transitions session status to `TIMED_OUT` (setting `terminationReason: 'TOKEN_EXPIRED'`) and returns `{ valid: false, reason: 'TOKEN_EXPIRED' }`.
5. **Immutable Lifetime Invariant:**
   - Under no circumstances does validation or client retry recompute, refresh, or extend `expiresAt`. The expiration boundary remains strictly fixed to the original issuance timestamp.
6. **Entitlement Gate:**
   - Authoritatively checks that `entitlements.cameraStreaming === true` for `session.viewerUserId`.
7. **Privacy Invariant:**
   - Raw tokens are never logged, stored in error strings, or persisted to database fields.

---

## 3. ADDITIVE MIGRATION REQUIREMENT & ARTIFACT

### 3.1 Migration Assessment
An additive migration was strictly required because:
1. `CameraStreamSession` lacked an `expiresAt` column to persist authoritative token lifetimes.
2. High-performance lookups by `sessionTokenHash` and `expiresAt` required database indexes.
3. Explicit session revocation required adding `REVOKED` to the `CameraStreamSessionStatus` enum.

### 3.2 Authored Migration Artifact
**File:** `main website/Backend/prisma/migrations/20261107160000_add_camera_stream_session_expires_at_and_revocation/migration.sql`

```sql
-- =============================================================================
-- PHASE 20.2: CORRECTIVE ADDITIVE MIGRATION
-- Migration: 20261107160000_add_camera_stream_session_expires_at_and_revocation
-- Scope: Additive schema enhancement for CameraStreamSession
--   1. Add persisted expiresAt field for authoritative viewing token expiration.
--   2. Add sessionTokenHash and expiresAt lookup indexes.
--   3. Extend CameraStreamSessionStatus enum with REVOKED state.
--
-- Safety: 100% additive, non-destructive, non-breaking.
-- DO NOT APPLY TO REMOTE OR PRODUCTION DATABASE.
-- =============================================================================

-- 1. Add expiresAt column to CameraStreamSession
ALTER TABLE `CameraStreamSession` ADD COLUMN `expiresAt` DATETIME(3) NULL;

-- 2. Add performance index on expiresAt for TTL filtering and validation
CREATE INDEX `CameraStreamSession_expiresAt_idx` ON `CameraStreamSession`(`expiresAt`);

-- 3. Add performance index on sessionTokenHash for fast token lookups
CREATE INDEX `CameraStreamSession_sessionTokenHash_idx` ON `CameraStreamSession`(`sessionTokenHash`);

-- 4. Extend status enum to include REVOKED state
ALTER TABLE `CameraStreamSession` MODIFY COLUMN `status` ENUM('INITIATED', 'NEGOTIATING', 'ACTIVE', 'ENDED', 'FAILED', 'TIMED_OUT', 'REVOKED') NOT NULL DEFAULT 'INITIATED';
```

> **Isolation Confirmation:** In accordance with the project safety policy, this migration has **NOT** been applied to the remote MySQL database (`remotenode-3530333528a3`). Zero remote DDL statements were executed.

---

## 4. CORRECTED START/STOP SEMANTICS

The previous implementation suffered from an inconsistency: `POST /api/v1/cameras/:cameraId/stop` immediately transitioned `CameraInstance.status` to `OFFLINE` and closed all active sessions in the database, while simultaneously returning `stateConfirmedByDevice: false`.

This inconsistency has been resolved across both endpoints:

### 4.1 Corrected Stop Semantics (`requestStopCamera`)
1. **No False State Transitions:**
   - If the camera is `STREAMING`, `ONLINE`, or `CONNECTING`, the status is **NOT** changed to `OFFLINE`.
   - `stoppedAt` is **NOT** populated.
2. **Pending Command Coordination:**
   - The user's stop intent is recorded in `metadata.pendingCommand`:
     ```json
     {
       "action": "STOP",
       "requestedAt": "2026-11-07T13:15:00.000Z",
       "requestedBy": "usr_abc123"
     }
     ```
   - If a stop command is already pending confirmation, the service returns `{ commandAccepted: true, stateConfirmedByDevice: false, message: 'Camera stop command is already pending confirmation from Android device.' }` without re-triggering mutations.
3. **Accurate Response Contract:**
   ```json
   {
     "commandAccepted": true,
     "stateConfirmedByDevice": false,
     "message": "Camera stop command accepted. Awaiting Android device confirmation."
   }
   ```
   Only when the physical Android device establishes connection and confirms shutdown via Phase 20.4 lifecycle service will the camera status officially transition to `OFFLINE` and populate `stoppedAt`.

### 4.2 Corrected Start Semantics (`requestStartCamera`)
- If camera is already `ONLINE` or `STREAMING`: returns `{ commandAccepted: true, stateConfirmedByDevice: true }`.
- If camera is `CONNECTING`: returns `{ commandAccepted: true, stateConfirmedByDevice: false, message: 'Camera start command is already in progress. Awaiting Android device capture confirmation.' }`.
- If camera is `OFFLINE`: transitions status to `CONNECTING`, sets `metadata.pendingCommand = { action: 'START' }`, and returns `{ commandAccepted: true, stateConfirmedByDevice: false }`.

### 4.3 Status API Exposure (`getCameraStatus`)
`GET /api/v1/cameras/:cameraId/status` now includes `pendingCommand`, allowing frontend and control plane clients to inspect whether a command is currently awaiting device confirmation.

---

## 5. ACTIVE SESSION HANDLING

Under the corrected architecture:
- When `POST /api/v1/cameras/:cameraId/stop` is accepted, **active `CameraStreamSession` records are NO LONGER prematurely terminated**.
- Sessions remain in `ACTIVE` or `INITIATED` status in the database.
- Rationale: The Android device is still actively transmitting video frames until it receives and acknowledges the stop signal. Prematurely ending sessions on the control plane breaks active viewing feeds and invalidates bandwidth/duration accounting before the actual stream terminates.
- Sessions will transition to `ENDED` only when:
  1. The viewer disconnects or closes the WebRTC peer connection (Phase 20.5).
  2. The Android camera client confirms shutdown in Phase 20.4/Phase 21.
  3. The session exceeds its authoritative 15-minute `expiresAt` boundary (auto-transitioned to `TIMED_OUT`).
  4. The owner explicitly calls `revokeViewingSession()`.

---

## 6. CRITICAL SECURITY AUDIT RELIABILITY APPROACH

### 6.1 Event Classification
Audit events are now explicitly classified by severity via `classifyAuditEvent()`:

| Severity | Event Types | Failure Handling Policy |
|---|---|---|
| **CRITICAL** | `VIEWING_ACCESS_DENIED`<br>`VIEWING_SESSION_REQUESTED`<br>`CAMERA_UNLINKED`<br>`BANDWIDTH_QUOTA_EXCEEDED`<br>`STORAGE_QUOTA_EXCEEDED`<br>Any event where `result === 'DENIED'` or `result === 'FAILED'` | **Zero Silent Failure:** Must be written transactionally with business mutation OR retried up to 3 times with exponential backoff. If persistence fails, logs fatal alert and throws `SecurityAuditPersistenceError`. |
| **OPERATIONAL** | `CAMERA_CONFIG_UPDATED`<br>`CAMERA_STARTED`<br>`CAMERA_STOPPED`<br>`CAMERA_REGISTERED` (success)<br>`STREAM_ESTABLISHED`<br>`STREAM_TERMINATED`<br>`STREAM_FAILED` | **Best-Effort:** Asynchronous write; failure logs a warning without blocking or aborting the operational request. |

### 6.2 Transactional Security Writes (`recordAuditEventWithTx`)
For operations that perform state mutations (e.g. issuing a viewing token via `createViewingToken`, unregistering a camera via `unregisterCamera`, or registering a camera via `registerCamera`), the audit event is written directly to the database transaction (`tx.cameraAccessAuditEvent.create(...)`). If the audit write fails, the entire transaction rolls back, guaranteeing that no token or state mutation can exist without its audit trail.

### 6.3 Reliable Retry & Non-Silent Failure (`recordAuditEvent`)
For non-transactional critical events (such as `VIEWING_ACCESS_DENIED` on unowned cameras or unauthorized device pairing attempts):
1. Written first to `auditLogger.log()` to ensure persistent disk-level capture.
2. Attempts database write with up to 3 retries with exponential backoff (`50ms`, `150ms`, `300ms`).
3. If all database retries fail, logs a `fatal` severity alert and throws `SecurityAuditPersistenceError`.
4. **The security record is never silently erased.**

### 6.4 Zero Secret Leakage Invariant
All audit metadata is passed through `sanitizeLogMetadata()`. Raw tokens, token hashes, passwords, cookies, authorization headers, SDP offer/answer strings, and ICE candidate credentials are strictly excluded.

---

## 7. TESTS WRITTEN (ALL MARKED NOT RUN)

**File:** `main website/Backend/tests/camera_api_foundation.test.ts`  
**Registration:** Registered in `tsconfig.test.json`.  
**Execution Policy:** Strictly write-only. ZERO tests executed.

The test suite contains 21 specification scenarios:
1. Scenario 1: Camera Route Registration & API Versioning (`/api/v1/cameras`).
2. Scenario 2: Authentication Requirements for Private Endpoints (401 on missing auth).
3. Scenario 3: Camera Registration Input Validation (rejecting invalid resolution/fps).
4. Scenario 4: Camera Listing & Account Scoping (strictly partitioned by `userId`).
5. Scenario 5: Camera Detail Authorization & Closed 404 Failure (anti-enumeration).
6. Scenario 6: Configuration Validation & Protected Field Rejection (mass-assignment defense).
7. **Scenario 7: Stop Request Semantics vs Confirmed OFFLINE State** (verifying `status` remains `STREAMING` and `pendingCommand: { action: 'STOP' }` is set).
8. Scenario 8: Camera Status Retrieval, Active Viewer Count, and Pending Command Reporting.
9. Scenario 9: Camera Unregister & Audit Retention Behavior (`Device` and `ServerInstance` preserved).
10. **Scenario 10: Viewing Authorization & Persisted Expiration** (ephemeral CVT with 15m TTL & `expiresAt` in DB).
11. Scenario 11: Cross-Account Access Denial (unauthorized viewer rejection).
12. Scenario 12: Device Ownership Validation (rejecting unowned `deviceId`).
13. Scenario 13: Camera Subscription Ownership & Quota Enforcement (`maxCameras` limit).
14. Scenario 14: Usage Retrieval & Account Filtering (`CameraUsageRecord` queries).
15. Scenario 15: Secret & Sensitive Field Leakage Prevention (zero tokens in detail responses).
16. **Scenario 16: Security Audit Classification & Reliability** (verifying `CRITICAL` vs `OPERATIONAL`).
17. **Scenario 17: Token Expiry at and after the 15-Minute Boundary** (verifying exact 15-minute boundary rejection and invariant that retries never extend lifetime).
18. **Scenario 18: Rejection of Ended, Failed, and Revoked Sessions** (validation service gates).
19. **Scenario 19: Rejection of Invalid Token Hashes & Malformed Tokens**.
20. **Scenario 20: Active Session Preservation when Stop Request is Pending Device Confirmation** (verifying active sessions are NOT prematurely ended).
21. **Scenario 21: Start/Stop Response Consistency** (both returning `commandAccepted: true, stateConfirmedByDevice: false`).

---

## 8. STATIC VERIFICATION PERFORMED

1. **Prisma Schema Consistency:** Verified that `model CameraStreamSession` in `schema.prisma` includes `expiresAt DateTime?` and indexes `@@index([expiresAt])` and `@@index([sessionTokenHash])`, and `enum CameraStreamSessionStatus` includes `REVOKED`.
2. **Migration SQL Syntax:** Verified that `migration.sql` uses valid MySQL DDL (`ALTER TABLE`, `ADD COLUMN`, `CREATE INDEX`, `MODIFY COLUMN`) with exact casing matching existing tables.
3. **TypeScript Typings & Imports:** Verified that `SecurityAuditPersistenceError` is exported from `src/errors/app-error.ts` and imported cleanly in `src/services/camera_service.ts`.
4. **Validation Service Interface:** Verified that `ValidateViewingTokenResult` and `validateViewingToken` provide structured, strongly typed results without requiring Phase 20.5 signaling.
5. **Route Integration:** Verified that `src/routes/camera.ts` routes and handlers align with the updated `CameraService` methods.

---

## 9. CONFIRMATION OF RESTRICTIONS

- **Zero Remote Database Changes:** Confirmed. No migrations, DDL statements, or data queries were executed on remote MySQL (`remotenode-3530333528a3` on `mysql.gb.stackcp.com`).
- **Zero Deployments:** Confirmed. No production builds, deployments, or service restarts were triggered.
- **Zero Test Runners Executed:** Confirmed. In strict compliance with instructions, no test runners (`npm test`, `node --test`, Vitest, Jest) or test compilation tasks were executed.
- **Scope Preservation:** Confirmed. Work was strictly confined to Phase 20.2 corrective implementation. No Phase 20.3, Phase 20.4, or Phase 20.5 implementations were started.

---

**Report Authored By:** Antigravity AI  
**Review Status:** Complete and Awaiting User Review
