# ZDEXCLOUD — PHASE 20.3 MIGRATION SAFETY FINAL PATCH
## NON-DESTRUCTIVE RETRIES & REMOVAL OF DESTRUCTIVE CLAIM RESET REPORT

**Date:** 2026-11-12  
**Batch:** Phase 20.3 — Migration Safety Final Patch  
**Execution Mode:** Focused Migration Correction (Static Inspection Only)  
**Test Execution Status:** NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28  
**Database Status:** ZERO MUTATIONS — No local, staging, remote, or production migration execution  

---

## 1. Problem Resolved

The previous draft of `main website/Backend/prisma/migrations/20261107180000_add_device_installation_claim/migration.sql` included `DELETE FROM DeviceInstallationClaim;` prior to backfill. Because MySQL commits DDL statements (`CREATE TABLE IF NOT EXISTS`) implicitly and cannot roll back an entire multi-statement migration script across statements, executing a blanket `DELETE` on retry could permanently destroy legitimate installation ownership claims created either during partial migration runs or by post-DDL application traffic (including `REVOKED` or `RECOVERY_PENDING` security states).

Blanket deletion has been completely removed and replaced with a strictly non-destructive, fail-closed, 4-step migration strategy.

---

## 2. Corrected Migration Strategy

Inspected and updated file:
- `main website/Backend/prisma/migrations/20261107180000_add_device_installation_claim/migration.sql`

### Execution Order & Mechanism

1. **Step 1 — Preflight Duplicate Detection (Before DDL)**:
   - Evaluates `Device` rows (`WHERE installationId IS NOT NULL`) for any `installationId` appearing more than once (`HAVING COUNT(*) > 1`).
   - If duplicates exist, the scalar `CASE` branch evaluates a multi-row `UNION ALL` diagnostic query, causing MySQL to abort with `ERROR 1242 (Subquery returns more than 1 row)` **before** `CREATE TABLE` runs.
2. **Step 2 — Idempotent Table, Unique Index & Inline Foreign Key Creation**:
   - `CREATE TABLE IF NOT EXISTS DeviceInstallationClaim (...)` declares the primary key, global `UNIQUE INDEX DeviceInstallationClaim_installationId_key(installationId)` (no redundant ordinary index), secondary indexes (`userId`, `status`), and inline `CONSTRAINT DeviceInstallationClaim_userId_fkey`.
   - Survives MySQL DDL implicit commits on retry without `ERROR 1050` (table already exists) or `ERROR 1826` (duplicate foreign key constraint name).
3. **Step 3 — Existing-Claim Consistency Verification (Before Backfill)**:
   - Joins already-present `DeviceInstallationClaim` rows (`c`) against `Device` (`d`) on `c.installationId = d.installationId` (`WHERE d.installationId IS NOT NULL`).
   - Aborts immediately with `ERROR 1242` and diagnostic row identifiers if **any** existing claim disagrees with its source `Device` record on:
     - Owner (`c.userId <> d.userId`)
     - Device association (`c.deviceId IS NULL OR c.deviceId <> d.id`)
   - Never overwrites existing claims or automatically transfers ownership.
4. **Step 4 — Non-Destructive, Fail-Closed Authoritative Backfill**:
   - Inserts **only missing claims** using `LEFT JOIN DeviceInstallationClaim AS c ON c.installationId = d.installationId WHERE d.installationId IS NOT NULL AND c.id IS NULL`.
   - Preserves all existing valid `DeviceInstallationClaim` rows untouched (retaining `ACTIVE`, `REVOKED`, `RECOVERY_PENDING` status, timestamps, and metadata).
   - Deliberately avoids `INSERT IGNORE`, `ON DUPLICATE KEY UPDATE`, and `DELETE FROM DeviceInstallationClaim`.
   - Excludes legacy `Device` rows where `installationId IS NULL`.

---

## 3. MySQL / InnoDB Retry Safety & Conflict Handling

- **No Shared Multi-Statement Transaction Assumption**: MySQL implicitly commits Step 2 DDL (`CREATE TABLE IF NOT EXISTS`), while Step 4 (`INSERT INTO ... SELECT`) runs as an atomic single-statement InnoDB transaction.
- **Interrupted Backfill Recovery**:
  - If Step 4 fails atomically due to `ERROR 1062 (ER_DUP_ENTRY)` (e.g., if duplicate `installationId` rows appeared between Step 1 and Step 4), InnoDB rolls back the failed `INSERT` statement while keeping any pre-existing valid `DeviceInstallationClaim` rows intact.
  - If a migration run is interrupted after Step 2 or with partial commits, re-running executes Step 1 (`Device` uniqueness preflight), Step 2 (idempotent `IF NOT EXISTS`), Step 3 (existing-claim agreement check), and Step 4 (inserts only remaining rows with `c.id IS NULL`) without deleting valid ownership data.
- **Why Blanket Deletion & Automatic Ownership Reassignment Are Prohibited**:
  - Deleting claims on retry could erase `REVOKED` security blocks or active claims created after partial DDL, enabling unauthorized device re-registration.
  - Automatic ownership selection or transfer violates fail-closed multi-tenant isolation. All historical `Device` duplicates (Procedure A) and claim-to-device mismatches (Procedure B) require manual audit-log inspection and customer-authorized SQL reconciliation before retry.

---

## 4. Deferred Tests Created / Updated (`NOT RUN`)

Updated file:
- `main website/Backend/tests/camera_device_registration_and_identity.test.ts`

Updated Scenario 2 to reflect non-destructive `LEFT JOIN` retry behavior and added all 7 patch specification tests under `Phase 20.3 Migration Safety Final Patch: Non-Destructive Retries [STATUS: NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28]`:

1. **Patch Test 1**: Retry preserves existing valid claims (including `REVOKED` status and metadata). — **STATUS: NOT RUN**
2. **Patch Test 2**: Existing claims with conflicting owners cause migration failure (`userId` mismatch). — **STATUS: NOT RUN**
3. **Patch Test 3**: Existing claims with conflicting device associations cause migration failure (`deviceId` mismatch or `NULL`). — **STATUS: NOT RUN**
4. **Patch Test 4**: Missing claims are safely backfilled (`LEFT JOIN ... WHERE c.id IS NULL`). — **STATUS: NOT RUN**
5. **Patch Test 5**: Duplicate historical `Device` installation IDs still fail before DDL. — **STATUS: NOT RUN**
6. **Patch Test 6**: Legacy `null` installation IDs remain supported. — **STATUS: NOT RUN**
7. **Patch Test 7**: Failed backfill can be retried without deleting valid claims. — **STATUS: NOT RUN**

---

## 5. Static Inspection Performed

Inspected files:
- `main website/Backend/prisma/migrations/20261107180000_add_device_installation_claim/migration.sql` (lines 1–137)
- `main website/Backend/prisma/schema.prisma` (`Device` lines 617–645; `DeviceInstallationClaim` lines 579–593)
- `main website/Backend/src/routes/device.ts` (lines 125–310)
- `main website/Backend/src/services/camera_device_identity_service.ts` (lines 250–510)
- `main website/Backend/tests/camera_device_registration_and_identity.test.ts` (lines 336–775)

Verified SQL compatibility with MySQL 5.7/8.0 `ONLY_FULL_GROUP_BY` mode (all non-aggregated columns in Step 1 belong to `GROUP BY installationId`, and Step 3 error output performs no mixed aggregation).

---

## 6. Remaining Limitations

1. **MySQL-Specific Preflight Syntax**: Step 1 and Step 3 use scalar `CASE` subqueries intentionally triggering `ERROR 1242` on conflict, targeted at MySQL (`provider = "mysql"`).
2. **Race Window Between Steps**: Without an external table write lock during maintenance, live writes occurring in the millisecond gap between Step 1/Step 3 and Step 4 rely on Step 4's `UNIQUE INDEX` (`ERROR 1062`) to fail closed.
3. **Deferred Execution**: Runtime MySQL execution of both migration SQL and `camera_device_registration_and_identity.test.ts` remains deferred until Phase 28 consolidated testing.

---

## 7. Compliance Confirmation

- **Zero Test Execution**: Confirmed. No test runners, test scripts, or test compilation commands were run.
- **Zero Database Mutations**: Confirmed. No migrations, DDL, or DML were executed against local, staging, remote, or production databases.
- **Zero Deployments**: Confirmed. No builds, service restarts, or deployments were performed.
- **Strict Scope**: Phase 20.3 only. Phase 20.4, Phase 20.5, Android, and Storage codebases remain untouched.
