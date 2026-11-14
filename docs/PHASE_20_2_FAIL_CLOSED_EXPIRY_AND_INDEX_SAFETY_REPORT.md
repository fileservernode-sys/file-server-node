# ZDEXCLOUD — PHASE 20.2 FINAL CORRECTION REPORT
## FAIL-CLOSED VIEWING TOKEN EXPIRY & MIGRATION INDEX SAFETY

**Project:** ZdexCloud Personal Cloud Platform  
**Phase:** 20.2 — Camera Backend API Foundation (Final Correction)  
**Execution Mode:** Focused Corrective Implementation  
**Date:** November 7, 2026  
**Final Status:** COMPLETE  
**Production / Remote Database Changes:** ZERO (0 modifications, zero DDL executed on remote MySQL)  
**Live External Calls:** ZERO (0 calls)  
**Dependencies Added:** ZERO (0 packages installed)  
**Tests Executed:** ZERO (0 test runners executed; all test scenarios strictly marked `NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28`)

---

## 1. EXACT FILES CHANGED

1. `main website/Backend/src/services/camera_service.ts`
   - Added `'TOKEN_EXPIRY_MISSING'` to `ValidateViewingTokenResult`.
   - Updated `validateViewingToken()` with an explicit fail-closed guard rejecting any session where `expiresAt` is null or missing before checking timestamps.
2. `main website/Backend/prisma/migrations/20261107160000_add_camera_stream_session_expires_at_and_revocation/migration.sql`
   - Added formal index safety audit comments documenting that `CameraStreamSession_sessionTokenHash_idx` is the single, non-duplicate lookup index and that no prior unique or non-unique index existed in `20261107140000`.
3. `main website/Backend/tests/camera_api_foundation.test.ts`
   - Updated Scenario 17 to cover fail-closed null expiration rejection (`TOKEN_EXPIRY_MISSING`), boundary rejection, past-boundary rejection, before-boundary acceptance, and immutable lifetime on retry.
   - Added Scenario 22 verifying migration index safety and non-duplication of `sessionTokenHash` and `expiresAt` indexes.
   - All tests marked `NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28`.
4. `docs/PHASE_20_2_FAIL_CLOSED_EXPIRY_AND_INDEX_SAFETY_REPORT.md`
   - This documentation report.

---

## 2. HOW NULL EXPIRATION IS REJECTED (FAIL-CLOSED)

In `CameraService.validateViewingToken()`, an explicit fail-closed guard was added immediately before timestamp evaluation:

```typescript
// Fail-Closed Expiration Enforcement:
// Reject any session where expiresAt is null or missing (legacy or unpersisted sessions)
if (!session.expiresAt) {
  return { valid: false, reason: 'TOKEN_EXPIRY_MISSING', session };
}

// Authoritative expiration check (strictly 15-minute TTL boundary)
const now = new Date();
if (session.expiresAt <= now) {
  try {
    await prisma.cameraStreamSession.update({
      where: { id: session.id },
      data: {
        status: CameraStreamSessionStatus.TIMED_OUT,
        endedAt: now,
        terminationReason: 'TOKEN_EXPIRED'
      }
    });
  } catch {
    // Non-blocking status sync
  }

  return { valid: false, reason: 'TOKEN_EXPIRED', session };
}
```

### Safety Guarantees:
- **Zero Legacy Bypass:** Legacy sessions created prior to Phase 20.2 or sessions where `expiresAt` was unpersisted can never be used as valid viewing credentials; they fail closed with `TOKEN_EXPIRY_MISSING`.
- **Strict 15-Minute Boundary:** Sessions at or past `expiresAt` fail with `TOKEN_EXPIRED` and auto-transition to `TIMED_OUT`.
- **Immutable Lifetime:** Retrying validation never recomputes, extends, or alters `expiresAt`.

---

## 3. MIGRATION INDEX SAFETY & DUPLICATION AUDIT

### Audit Findings:
1. **Migration History Inspection:**
   - In `20261107140000_add_camera_database_foundation/migration.sql`, `CameraStreamSession` was created with `sessionTokenHash VARCHAR(191) NULL`.
   - The indexes defined were:
     - `CameraStreamSession_cameraInstanceId_idx`
     - `CameraStreamSession_viewerUserId_idx`
     - `CameraStreamSession_status_idx`
     - `CameraStreamSession_startedAt_idx`
   - **`sessionTokenHash` had NO index in `20261107140000` (neither unique nor non-unique).**
2. **Schema Inspection:**
   - In `prisma/schema.prisma`, `sessionTokenHash String?` does NOT have `@unique`.
3. **Index Safety Action:**
   - Migration `20261107160000_add_camera_stream_session_expires_at_and_revocation/migration.sql` creates:
     `CREATE INDEX CameraStreamSession_sessionTokenHash_idx ON CameraStreamSession(sessionTokenHash);`
   - This creates the **single, non-unique lookup index** required for fast cryptographic hash lookups.
   - **No duplicate index exists:** Unlike `AdminSession` (which historically had both a `@unique` key and an `@@index` on `sessionTokenHash`), `CameraStreamSession` has exactly ONE index on `sessionTokenHash`.
   - `CameraStreamSession_expiresAt_idx` was preserved for TTL filtering.
   - All changes remain strictly additive, non-destructive, and unapplied to remote databases.

---

## 4. TESTS WRITTEN (ALL MARKED DEFERRED TO PHASE 28)

**File:** `tests/camera_api_foundation.test.ts` (registered in `tsconfig.test.json`).

Added and updated scenarios:
1. **Scenario 17: Fail-Closed Token Expiration & Boundary Enforcement**
   - Rejection of session with `expiresAt: null` (`TOKEN_EXPIRY_MISSING`).
   - Rejection of expired session (`expiresAt <= serverTimePastExpiry` -> `TOKEN_EXPIRED`).
   - Rejection of session exactly at the expiration boundary (`expiresAt <= serverTimeAtBoundary`).
   - Acceptance of valid session before expiration (`now < expiresAt`).
   - Confirmation that validation never extends expiration timestamp on client retries.
2. **Scenario 22: Migration Index Safety & Non-Duplication**
   - Verification that `sessionTokenHash` has exactly one index (`CameraStreamSession_sessionTokenHash_idx`) and zero duplicate unique keys.
   - Verification that `expiresAt` has exactly one index (`CameraStreamSession_expiresAt_idx`).

All scenarios are explicitly annotated:  
`NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28`.

---

## 5. CONFIRMATION OF RESTRICTIONS

- **Zero Test Execution:** Confirmed. No test runners (`npm test`, `node --test`, Vitest, Jest) or test compilation tasks were executed.
- **Zero Remote Database Changes:** Confirmed. Zero DDL and zero queries were executed on remote production MySQL (`remotenode-3530333528a3`).
- **Zero Deployments:** Confirmed. No services, containers, or builds were deployed or restarted.
- **Scope Preservation:** Confirmed. Scope remained strictly confined to Phase 20.2 final corrections.

---

**Report Authored By:** Antigravity AI  
**Review Status:** Complete and Awaiting User Review
