# ZDEXCLOUD | PHASE 8.4 | BATCH E.4.1
# OUTBOX DISPATCH OWNERSHIP, CLAIM SAFETY AND RECOVERY AUDIT REPORT

**Audit Date:** 2026-10-10  
**Phase:** 8.4 (Invoice Document Delivery & Customer Retrieval Architecture)  
**Batch:** E.4.1 (Outbox Dispatch Ownership, Claim Safety and Recovery Audit)  
**Repository Root:** `D:\YOUM PATEL\Desktop\Projects\File Server Project\`  
**Target Subsystem:** `main website/Backend/`  
**Canonical Domain:** `https://zdexcloud.com`  
**Execution Mode:** Static Source Audit and Minimal Corrective Implementation Only  
**Final Deliverable Verdict:** **`CORRECTIONS COMPLETE WITH DOCUMENTED LIMITATIONS`**

---

## 1. EXECUTIVE SUMMARY & VERDICT

Phase 8.4 Batch E.4.1 performed a comprehensive, repository-grounded audit of the Phase 8.4 Batch E.4 Outbox Worker implementation across concurrency, crashes, configuration transitions, shadow-mode states, and uncertain provider outcomes.

The audit verified five concrete implementation defects in the E.4 deliverables and implemented minimal, surgical corrections:
1. **Premature Attempt Exhaustion Bug Fixed:** `handleTransportFailure` evaluated `attemptCount + 1` against `maxAttempts` despite `attemptCount` having already been atomically incremented during the claim phase. This caused retryable failures to be marked `EXHAUSTED` after only 2 attempts instead of 3.
2. **Missing Lease Worker Ownership Check Added:** Post-claim state updates conditioned on `id` and `claimVersion`, but omitted `claimedBy = :workerId`. Defense-in-depth ownership verification was added to all post-claim updates (`transportStartedAt`, `handleTransportSuccess`, `handleAlreadySent`, `handleTransportFailure`).
3. **In-Flight Mode Change Abort Guard Added:** In `claimAndDispatchRecord`, the worker now re-verifies operational state and dispatch mode (`isStarted` and `INVOICE_NOTIFICATION_DISPATCH_MODE === 'OUTBOX_WORKER'`) immediately prior to setting the transport boundary, preventing late network dispatches if a worker was stopped during a batch.
4. **Shadow Mode & Recovery Ambiguity Bleed Fixed:** 
   - `BillingInvoiceService` previously wrote `RETRYABLE_FAILURE` on failed shadow sends; ambiguous network errors (`ETIMEDOUT`, 502/504) are now quarantined as `AMBIGUOUS_OUTCOME` to prevent the outbox worker from blindly re-sending if promoted to Mode 3.
   - `BillingInvoiceRecoveryService.retryDeferredInvoiceNotifications()` previously bypassed outbox dispatch and retried ambiguous timeouts; it now strictly suppresses direct recovery when `OUTBOX_WORKER` is active, checks for existing non-dispatchable outbox records, and halts auto-retries on ambiguous failures.
5. **Webhook Ingestion Staging Collision Fixed:** `EmailWebhookInbox` deduplication previously hashed missing IDs and timestamps to a static `'noid:eventType:none'`, causing distinct un-identified webhooks to collide and drop payloads via MySQL `ON DUPLICATE KEY UPDATE`. Events lacking reliable provider identity now receive unique staging IDs, preserving every distinct payload for operator audit.
6. **PDF Dependency Ground Truth Verified:** Corrected the contradictory E.4 report claim regarding `pdfkit`. The actual source in `BillingInvoiceDocumentService` implements a **pure in-memory Node.js vector PDF builder (`buildPurePdfBuffer`)** with zero runtime dependency on `pdfkit`.

---

## 2. EXACT FILES INSPECTED, AUDITED, AND CHANGED

### Files Changed:
1. [`src/services/billing/invoice_notification_outbox_worker.ts`](file:///D:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/src/services/billing/invoice_notification_outbox_worker.ts):
   - Added pre-transport mode/started check in `claimAndDispatchRecord`.
   - Added `AND claimedBy = ?` with `this.workerId` to `transportBoundaryRes`, `handleTransportSuccess`, `handleAlreadySent`, and `handleTransportFailure`.
   - Corrected attempt count logic in `handleTransportFailure` (removed redundant `+ 1`).
   - Expanded ambiguous error classification to cover HTTP 502/504 and gateway timeout responses.
2. [`src/services/billing/billing_invoice_service.ts`](file:///D:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/src/services/billing/billing_invoice_service.ts):
   - In `DUAL_WRITE_LEGACY_DISPATCH` post-send handler, ambiguous direct dispatch failures are saved as `AMBIGUOUS_OUTCOME` rather than `RETRYABLE_FAILURE`.
3. [`src/services/billing/billing_invoice_recovery_service.ts`](file:///D:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/src/services/billing/billing_invoice_recovery_service.ts):
   - Added `config` import from `../../config/env.js`.
   - In `retryDeferredInvoiceNotifications`, permanently suppressed automatic retries of ambiguous transport timeouts.
   - Added mode guard suppressing direct recovery dispatch when `INVOICE_NOTIFICATION_DISPATCH_MODE === 'OUTBOX_WORKER'`.
   - Added guard skipping direct recovery if an outbox record exists in `['CLAIMED', 'DISPATCHED', 'DELIVERED', 'AMBIGUOUS_OUTCOME', 'SHADOW_PENDING']`.
4. [`src/services/email_webhook_service.ts`](file:///D:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/src/services/email_webhook_service.ts):
   - In `stageEventInInbox`, differentiated true provider retry deduplication (`cleanMsgId` + `eventTimestamp` present) from un-identified events, ensuring unique staging IDs prevent silent dropping of distinct payloads.
5. [`tests/invoice_notification_outbox_worker.test.ts`](file:///D:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/tests/invoice_notification_outbox_worker.test.ts):
   - Updated static test specifications with 15 comprehensive specifications covering concurrency, fencing, return contracts, boundary guards, recovery suppression, shadow isolation, and parameterized SQL.

### Files Inspected (Read-Only):
- `src/services/billing/billing_invoice_notification_service.ts`
- `src/services/billing/billing_invoice_document_service.ts`
- `src/services/email.ts`
- `src/services/email_tracking_service.ts`
- `src/services/email_failure_classifier.ts`
- `src/config/env.ts`
- `src/server.ts`
- `prisma/schema.prisma`
- `prisma/migrations/20261010160000_add_invoice_notification_outbox_and_webhook_inbox/migration.sql`

---

## 3. ACTUAL DISPATCH-OWNERSHIP GUARANTEES AND UNRESOLVED MULTI-INSTANCE LIMITATIONS

### What the Code Guarantees (Within a Single Process & Aligned Instances):
1. **Intra-Process Mode Isolation:** If an instance runs `OUTBOX_WORKER`, direct dispatch inside `issueInvoiceForPayment()` and `retryDeferredInvoiceNotifications()` is strictly bypassed.
2. **Shadow Row Exemption:** Outbox worker polling queries filter strictly on `status IN ('PENDING', 'RETRYABLE_FAILURE')`. Shadow rows in `SHADOW_PENDING` can never be claimed or dispatched by the background worker.
3. **Database Uniqueness Invariant:** `InvoiceNotificationOutbox` enforces `@@unique([invoiceId, notificationType])`. At most one outbox pipeline record exists per statutory invoice.

### What the Code CANNOT Guarantee (Multi-Instance Concurrency Limitation):
**Finding:** A per-process configuration environment variable (`INVOICE_NOTIFICATION_DISPATCH_MODE`) **cannot enforce distributed single-owner dispatch across heterogeneous instances**.
- If Instance A runs `LEGACY_DIRECT` and Instance B runs `OUTBOX_WORKER` simultaneously during an uncoordinated rolling release:
  - If an invoice is issued on Instance A, Instance A sends an email directly. No outbox row is created. Instance B's worker does not know about it. (No dual send).
  - If an invoice is issued on Instance B, Instance B creates a `PENDING` outbox row, and Instance B's worker dispatches it. Instance A does not send directly for that invoice. (No dual send).
  - **However**, if a legacy recovery script or operator endpoint is triggered on Instance A, Instance A queries `BillingInvoice` without checking outbox mode, finds no `EmailMessage` row, and may issue a duplicate direct send while Instance B's worker is processing.

### Required Operational Rollout Guard:
To guarantee zero duplicate invoice emails across deployments, operations must enforce a **strict three-phase deployment gate**:
- **Phase 1 (Dual Write Warmup):** Deploy code across 100% of instances with `INVOICE_NOTIFICATION_DISPATCH_MODE='DUAL_WRITE_LEGACY_DISPATCH'` and `INVOICE_OUTBOX_WORKER_ENABLED=false`. All instances create `SHADOW_PENDING` rows; direct dispatch sends.
- **Phase 2 (Shadow Verification):** Verify shadow outbox rows are successfully updated to `DISPATCHED` post-send. Ensure all instances are identical.
- **Phase 3 (Outbox Cutover):** Promote configuration to `INVOICE_NOTIFICATION_DISPATCH_MODE='OUTBOX_WORKER'` and `INVOICE_OUTBOX_WORKER_ENABLED=true` on worker instances.

---

## 4. ACTUAL CLAIM SQL BEHAVIOR, TRANSACTION BOUNDARIES, FENCING, AND DRIVER RETURN HANDLING

### Atomic Claim Acquisition:
Claiming is executed via an atomic conditional `UPDATE` query:
```sql
UPDATE `InvoiceNotificationOutbox`
SET `status` = 'CLAIMED',
    `claimedBy` = :workerId,
    `claimedAt` = :now,
    `claimExpiresAt` = :leaseExpires,
    `claimVersion` = `claimVersion` + 1,
    `attemptCount` = `attemptCount` + 1,
    `updatedAt` = NOW(3)
WHERE `id` = :recordId
  AND `claimVersion` = :expectedVersion
  AND `status` IN ('PENDING', 'RETRYABLE_FAILURE')
```
- **Driver Return Handling:** In Prisma Client with MySQL, `prisma.$executeRawUnsafe` returns the driver's affected row count (`number`).
- **Concurrency Serialization:** If multiple workers poll the same candidate ID, exactly one worker succeeds (`claimRes === 1`). Competing workers receive `claimRes === 0` and abort immediately without incrementing `attemptCount` or triggering errors.
- **Transaction Boundaries:** Claim acquisition is a single atomic statement. Network transport (Brevo HTTP/SMTP API) is executed **completely outside of any database transaction**.

### Post-Claim Monotonic Fencing:
Every subsequent state mutation conditions on:
`WHERE id = ? AND claimVersion = ? AND claimedBy = ? AND status = 'CLAIMED'`
- If a worker's lease expired while waiting on a network call and the sweeper reclaimed the row (`claimVersion` incremented, `claimedBy` nullified), the late worker's completion update affects `0` rows.
- The late worker detects `updateRes === 0`, logs `OUTBOX_DISPATCH_FENCING_REJECTED`, and cannot corrupt the database state.

---

## 5. TRANSPORT BOUNDARY AND AMBIGUOUS OUTCOME BEHAVIOR

### Order of Operations:
1. **Atomic Claim:** Status `CLAIMED`, lease granted, `claimVersion` advanced.
2. **Invoice Model Loading:** `findUnique` loads invoice snapshot and verifies `ISSUED` status.
3. **Pre-Transport Guard:** Re-verifies worker is running and mode is `OUTBOX_WORKER`.
4. **Transport Boundary Commitment:** Persists `transportStartedAt = NOW(3)` in MySQL:
   `WHERE id = ? AND claimVersion = ? AND claimedBy = ? AND status = 'CLAIMED'`.
   If affected rows is `0`, worker aborts immediately. External transport is never contacted.
5. **External Transport Execution:** Calls `BillingInvoiceNotificationService.sendInvoiceIssuedNotification` outside DB transaction.
6. **Post-Transport Fenced Finalization:**
   - Provider HTTP 200/201: Finalized as `DISPATCHED` with `providerMessageId`.
   - Network Timeout / Socket Hangup / HTTP 502/504: Quarantined as `AMBIGUOUS_OUTCOME`.
   - Permanent Rejection (4xx / Invalid Recipient): Marked `PERMANENT_FAILURE`.
   - Retryable Transient Error: Scheduled for retry with exponential backoff (`nextAttemptAt`).

### Ambiguous Quarantine & Lease Recovery:
- **No Automated Retry on Ambiguous Timeout:** Automated retries for `AMBIGUOUS_OUTCOME` are permanently disabled (`nextAttemptAt = NULL`).
- **Sweeper Differentiation:**
  - If `transportStartedAt IS NULL`: The crash occurred prior to network I/O. The sweeper safely resets status to `PENDING` with exponential backoff.
  - If `transportStartedAt IS NOT NULL`: The crash occurred after network I/O started. Outcome is unknown. The sweeper transitions status to `AMBIGUOUS_OUTCOME`.

---

## 6. SHADOW-MODE AND ROLLBACK FINDINGS

1. **Shadow Row Quarantine:** In `DUAL_WRITE_LEGACY_DISPATCH`, if direct dispatch encounters an ambiguous error (`ETIMEDOUT`, 502/504), `BillingInvoiceService` now sets `status = AMBIGUOUS_OUTCOME` instead of `RETRYABLE_FAILURE`. This prevents the outbox worker from blindly retrying an uncertain legacy send if the cluster is later promoted to Mode 3.
2. **Rollback Behavior:**
   - If `INVOICE_NOTIFICATION_DISPATCH_MODE` is rolled back from `OUTBOX_WORKER` to `DUAL_WRITE` or `LEGACY_DIRECT`, worker daemon `tick()` halts queue processing immediately.
   - Any rows remaining in `PENDING` remain dormant in `InvoiceNotificationOutbox`. Legacy direct dispatch handles newly issued invoices without double-sending.

---

## 7. WEBHOOK IDENTITY AND DUPLICATE-EVENT LIMITATIONS

### Webhook Identity Findings:
- Brevo does **not** provide a universally unique GUID in all webhook bodies.
- A composite fingerprint based solely on `cleanMsgId:eventType:timestamp` is **not a globally unique provider event ID**.
- When timestamps are omitted, or when multiple events arrive in the same second, hashing `'none'` caused distinct payloads to collide on `@@unique([provider, eventId])`. Under `ON DUPLICATE KEY UPDATE`, the second payload was lost.

### Corrected Behavior in Batch E.4.1:
- If `cleanMsgId` AND `eventTimestamp` are present, the deterministic fingerprint is used to deduplicate true transport retries of the identical event.
- If `cleanMsgId` is missing OR `eventTimestamp` is missing, the service generates a distinct staging event ID (`unidentified_${eventType}_${recipient}_${timestamp}_${entropy}`).
- **Every distinct payload is staged durably in `EmailWebhookInbox` without data loss.**
- Missing timestamps remain `null` in the database; provider timestamps are never invented.

---

## 8. ACTUAL PDF GENERATION DEPENDENCY PATH

### Verification Finding:
- **Prior Claim in E.4 Report:** Claimed PDF generation would throw `MODULE_NOT_FOUND` because `pdfkit` was missing from `node_modules`.
- **Actual Codebase Ground Truth:** Inspection of `BillingInvoiceDocumentService.ts` confirms that `pdfkit` is **not imported and not used**.
- The service implements a **pure in-memory Node.js vector PDF builder (`buildPurePdfBuffer`)** producing ISO 32000-1 (PDF 1.4) compliant buffers using native Node.js buffers and standard Type 1 PostScript font metrics.
- PDF generation executes with zero native OS dependencies and zero uninstalled package dependencies.

---

## 9. STATIC TEST SPECIFICATIONS SUMMARY

The static test specifications in `tests/invoice_notification_outbox_worker.test.ts` were expanded to verify:
1. Configuration flags and enum defaults.
2. Single-owner dispatch suppression across service, worker, and recovery.
3. Monotonic fencing (`claimVersion`) concurrency serialization.
4. Affected rows return contract (`claimRes === 0` abort).
5. Stale completion rejection via `claimVersion` and `claimedBy` conditions.
6. Zero affected rows at transport boundary aborting prior to transport.
7. Pre-transport crash recovery (`transportStartedAt IS NULL` -> `PENDING`).
8. Post-transport crash quarantine (`transportStartedAt IS NOT NULL` -> `AMBIGUOUS_OUTCOME`).
9. Late write rejection logging for webhook reconciliation.
10. Sweeper fence increment nullifying `claimedBy`.
11. Exclusion of `SHADOW_PENDING` from worker polling.
12. Mid-tick dispatch abort on configuration mode changes.
13. Accurate attempt count evaluation without premature double increments.
14. Preservation of distinct webhook events without silent collision.
15. Parameterized SQL queries preventing untrusted string interpolation.

---

## 10. EXPLICIT EXECUTION BOUNDARY CONFIRMATION

In strict compliance with all operational rules and prompt instructions:
- **Zero test runners, test frameworks, or compilation commands were executed.**
- **Zero Prisma CLI commands (`prisma generate`, `prisma migrate`) were executed.**
- **Zero database connections were opened; zero SQL statements were executed against any database.**
- **Zero dependencies were installed, removed, or updated.**
- **Zero network requests or emails were sent; Brevo API was not contacted.**

---

## 11. MINIMUM NEXT STEP REQUIRED BEFORE BATCH E.5

Before authoring Phase 8.4 Batch E.5 (Webhook Reconciliation Worker & Operator Controls):
1. **Operational Alignment:** Formally document the three-phase deployment gate protocol (`DUAL_WRITE` -> verify -> `OUTBOX_WORKER`) in operations runbooks.
2. **Schema Migration Prerequisite:** In an authorized environment with database connectivity, execute `npx prisma migrate deploy` to create `InvoiceNotificationOutbox` and `EmailWebhookInbox` tables in the target database.
3. **Prisma Client Generation:** Run `npx prisma generate` to generate strongly-typed TypeScript models for the newly authored tables.

---

### Final Audit Verdict:
# **`CORRECTIONS COMPLETE WITH DOCUMENTED LIMITATIONS`**
*(Awaiting operator review and authorization before proceeding to Batch E.5.)*
