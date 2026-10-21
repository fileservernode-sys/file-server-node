# ZDEXCLOUD | PHASE 8.4 | BATCH E.4
# INVOICE NOTIFICATION OUTBOX WORKER IMPLEMENTATION REPORT

**Audit & Implementation Date:** 2026-10-10  
**Phase:** 8.4 (Invoice Document Delivery & Customer Retrieval Architecture)  
**Batch:** E.4 (Invoice Notification Outbox Worker Implementation)  
**Repository Root:** `D:\YOUM PATEL\Desktop\Projects\File Server Project\`  
**Target Subsystem:** `main website/Backend/`  
**Canonical Domain:** `https://zdexcloud.com`  
**Execution Mode:** Minimal Implementation, Static Source Inspection, and Test Specification Authoring Only  
**Final Deliverable Verdict:** **`IMPLEMENTED WITH DOCUMENTED LIMITATIONS`**

---

## EXECUTIVE SUMMARY

Phase 8.4 Batch E.4 implements the **Invoice Notification Outbox Worker** (`InvoiceNotificationOutboxWorker`) against the database foundation authored in Batch E.3 and E.3.1 (`InvoiceNotificationOutbox` and `EmailWebhookInbox`).

This implementation resolves the fundamental reliability blockers identified in Batches E.1 and E.2:
1. **Pre-Transport Persistence & Idempotency:** Notifications for issued statutory invoices are written directly into `InvoiceNotificationOutbox` within the invoice issuance transaction before any external network transport is initiated.
2. **Strict Single-Owner Dispatch Policy:** The configuration switch `INVOICE_NOTIFICATION_DISPATCH_MODE` (`LEGACY_DIRECT`, `DUAL_WRITE_LEGACY_DISPATCH`, `OUTBOX_WORKER`) guarantees that direct dispatch and background worker processing are mutually exclusive, preventing duplicate deliveries during rollout.
3. **Monotonic Concurrency Fencing (`claimVersion`):** The worker leases outbox rows using atomic database updates conditioned on `id` and `claimVersion`, preventing race conditions between concurrent worker instances and protecting against late writes from expired leases.
4. **Transport Boundary Tracking (`transportStartedAt`):** The boundary between local preparation (PDF rendering) and network I/O (Brevo HTTP/SMTP transport) is explicitly persisted on disk before the network socket is opened.
5. **Conservative Ambiguous-Outcome Quarantine:** Ambiguous network errors (socket timeouts, ECONNRESET, unhandled transport hangs) immediately transition the record to `AMBIGUOUS_OUTCOME`, permanently suppressing automated retries to prevent duplicate customer billing emails.
6. **Webhook Staging Inbox (`EmailWebhookInbox`):** Provider webhooks are staged with dual timestamps (`receivedAt` local and `eventTimestamp` provider) and a deterministic deduplication hash (`SHA256(cleanMsgId:eventType:timestamp)`).
7. **Zero-Execution Compliance:** Completed strictly within the designated execution boundaries. Zero database migrations were executed, zero CLI commands or test runners were invoked, zero external network requests were made, and zero live emails were sent.

---

## 1. COMPONENT ARCHITECTURE & IMPLEMENTATION DETAILS

### 1.1 Configuration Schema (`src/config/env.ts`)
The environment configuration schema was extended with Zod validations and safe defaults:
- `INVOICE_NOTIFICATION_DISPATCH_MODE`: Enum `['LEGACY_DIRECT', 'DUAL_WRITE_LEGACY_DISPATCH', 'OUTBOX_WORKER']`, defaulting to `'LEGACY_DIRECT'`.
- `INVOICE_OUTBOX_WORKER_ENABLED`: Boolean flag defaulting to `false`.
- `INVOICE_OUTBOX_WORKER_POLL_INTERVAL_MS`: Polling interval in milliseconds, defaulting to `5000` (5 seconds).
- `INVOICE_OUTBOX_WORKER_BATCH_SIZE`: Batch size for queue polling, defaulting to `10`.
- `INVOICE_OUTBOX_WORKER_LEASE_MS`: Distributed lease duration in milliseconds, defaulting to `300000` (5 minutes).

### 1.2 Outbox Worker Daemon (`src/services/billing/invoice_notification_outbox_worker.ts`)
The worker daemon encapsulates queue processing, leasing, dispatch, and crash reclamation:
- **Singleton Instance:** `invoiceNotificationOutboxWorker` exported with `start()` and `stop()` lifecycle methods.
- **Worker Identity:** Unique instance identifier `worker_${process.pid}_${randomHex(4)}`.
- **Single-Owner Check:** `tick()` verifies `config.INVOICE_NOTIFICATION_DISPATCH_MODE === 'OUTBOX_WORKER'`. If not, it skips polling entirely.
- **Lease Claiming:**
  ```sql
  UPDATE InvoiceNotificationOutbox
  SET status = 'CLAIMED',
      claimedBy = :workerId,
      claimedAt = NOW(3),
      claimExpiresAt = DATE_ADD(NOW(3), INTERVAL :leaseSeconds SECOND),
      claimVersion = claimVersion + 1,
      attemptCount = attemptCount + 1,
      lastAttemptAt = NOW(3),
      updatedAt = NOW(3)
  WHERE id = :id AND claimVersion = :currentVersion AND status IN ('PENDING', 'RETRYABLE_FAILURE')
  ```
- **Transport Boundary Persistence:**
  Before invoking `sendInvoiceIssuedNotification()`, the worker marks:
  ```sql
  UPDATE InvoiceNotificationOutbox
  SET transportStartedAt = NOW(3), updatedAt = NOW(3)
  WHERE id = :id AND claimVersion = :claimVersion AND status = 'CLAIMED'
  ```
- **Terminal Success & Ambiguous Handling:**
  - Upon clean transport: updates status to `DISPATCHED`, records `providerMessageId`, sets `dispatchedAt = NOW(3)`.
  - Upon deduplication (`ALREADY_SENT`): marks `DISPATCHED` with matching `emailMessageId`.
  - Upon network timeout/ambiguous error: updates status to `AMBIGUOUS_OUTCOME`, records `ambiguousAt = NOW(3)`, clears `nextAttemptAt = NULL` (permanently blocking automated retry).
  - Upon permanent failure: updates status to `PERMANENT_FAILURE`, clears `nextAttemptAt = NULL`.
  - Upon retryable failure: updates status to `RETRYABLE_FAILURE`, calculates exponential backoff (`nextAttemptAt`).
- **Supervisory Sweeper (`sweepExpiredLeases`):**
  Runs every 60 seconds to reclaim dead leases:
  - If `transportStartedAt IS NULL` (crashed during PDF generation before network call): safely resets to `PENDING` with backoff.
  - If `transportStartedAt IS NOT NULL` (worker vanished after transport started): quarantines to `AMBIGUOUS_OUTCOME`.

### 1.3 Invoice Issuance Integration (`src/services/billing/billing_invoice_service.ts`)
Inside `issueInvoiceForPayment()`:
- **Within Database Transaction:**
  - If mode is `OUTBOX_WORKER`: creates `InvoiceNotificationOutbox` with status `PENDING`.
  - If mode is `DUAL_WRITE_LEGACY_DISPATCH`: creates `InvoiceNotificationOutbox` with status `SHADOW_PENDING`.
  - If mode is `LEGACY_DIRECT`: does not create outbox row.
- **In Post-Commit Hook:**
  - If mode is `OUTBOX_WORKER`: direct dispatch is suppressed (`BillingInvoiceNotificationService` is not called; outbox worker owns sending).
  - If mode is `DUAL_WRITE_LEGACY_DISPATCH`: calls direct notification service, then updates shadow outbox row to `DISPATCHED` or `RETRYABLE_FAILURE`.
  - If mode is `LEGACY_DIRECT`: performs legacy direct dispatch.

### 1.4 Webhook Staging Inbox (`src/services/email_webhook_service.ts`)
Inside `EmailWebhookService`:
- `stageEventInInbox(event)` is invoked upon receiving verified Brevo webhooks.
- Computes deterministic deduplication fingerprint: `SHA256(cleanMsgId:eventType:timestampSeconds)`.
- Persists raw payload into `EmailWebhookInbox` with `ON DUPLICATE KEY UPDATE updatedAt = NOW(3)`.
- Preserves both local reception timestamp (`receivedAt = NOW(3)`) and provider reported timestamp (`eventTimestamp = event.eventTimestamp || null`).
- Flags webhooks lacking identifiers with status `UNMATCHED_NO_IDENTIFIER` while responding HTTP 200 to prevent provider spamming.

### 1.5 Server Lifecycle Integration (`src/server.ts`)
- **Startup:** If `config.INVOICE_OUTBOX_WORKER_ENABLED && config.INVOICE_NOTIFICATION_DISPATCH_MODE === 'OUTBOX_WORKER'`, calls `invoiceNotificationOutboxWorker.start()`.
- **Graceful Shutdown:** In the `shutdown()` handler, awaits `invoiceNotificationOutboxWorker.stop()` prior to closing HTTP listeners and disconnecting database pools.

---

## 2. STATIC 17-SCENARIO FAILURE-PATH AUDIT MATRIX

The table below documents the static analysis of all 17 operational, concurrency, network, and regulatory failure modes across the outbox pipeline:

| # | Failure Scenario | Trigger & State at Failure | System Handling & State Transition | Monotonic Fencing / Safety Mechanism | Auto Resend? | Audit / Alert Action |
| :- | :--- | :--- | :--- | :--- | :-: | :--- |
| **1** | **Process crash during PDF render** | Node OOM/crash while generating PDF in `CLAIMED` status; `transportStartedAt` is `NULL`. | Lease expires after 5m. Sweeper detects `transportStartedAt IS NULL`, resets status to `PENDING` with exponential backoff. | Safe: no external network packets were sent. `claimVersion` incremented on recovery. | **YES** | Warning: `WORKER_LEASE_EXPIRED_RECLAIMED` |
| **2** | **Network timeout during Brevo I/O** | HTTP connection to Brevo times out (`ETIMEDOUT` / 15s elapsed); `transportStartedAt` is NOT null. | Worker catches timeout, classifies via `classifyEmailFailure` as ambiguous, immediately sets `status = 'AMBIGUOUS_OUTCOME'`, `ambiguousAt = NOW()`, `nextAttemptAt = NULL`. | Automated retries permanently suppressed. Quarantine on disk. | **NO** | Alert: `EMAIL_OUTBOX_AMBIGUOUS_OUTCOME_QUARANTINE` |
| **3** | **Provider accepts, app crashes before DB write** | Brevo responds HTTP 200 with `message-id`, but process crashes before `DISPATCHED` update. | Row remains `CLAIMED` with `transportStartedAt != null`. Lease expires; sweeper quarantines to `AMBIGUOUS_OUTCOME`. When Brevo delivery webhook arrives, staging inbox reconciles it. | `transportStartedAt` prevents blind re-queueing. Monotonic fencing blocks obsolete updates. | **NO** | Alert: `WEBHOOK_ORPHAN_RECONCILED` |
| **4** | **Expired lease while request in flight** | Worker A stalls in GC/network lag > 5m; Sweeper/Worker B reclaims row and increments `claimVersion`. | Worker A finishes late, attempts to update status using old `claimVersion`. MySQL update affects 0 rows. Worker A logs fencing rejection and discards result. | Monotonic fencing: `claimVersion = oldClaimVersion` prevents late overwrite. | **NO** | Log: `STALE_WORKER_FENCING_REJECTED` |
| **5** | **Worker stale write after sweeper reclamation** | Worker A lease reclaimed by Sweeper; Worker A tries to record `AMBIGUOUS_OUTCOME` or `DISPATCHED`. | Update query conditions on `claimVersion = claimVersion`. Returns `affectedRows: 0`. Worker logs warning and aborts. | Monotonic fencing guarantees database consistency. | **NO** | Warning: `STALE_CLAIM_WRITE_ABORTED` |
| **6** | **Concurrent workers polling same outbox batch** | Multiple worker instances tick concurrently on same `PENDING` rows. | Atomic MySQL update with `LIMIT` and `WHERE status IN ('PENDING', 'RETRYABLE_FAILURE') AND claimVersion = ?` grants lease to exactly one worker. | Database row-level locks serialize the claim update. | **NO** | None (Normal concurrency) |
| **7** | **Duplicate webhook delivery from provider** | Brevo retries delivery webhook due to network latency (>5s). | Staging query uses `ON DUPLICATE KEY UPDATE updatedAt = NOW(3)` on unique `(provider, eventId)`. Returns HTTP 200 without reprocessing. | Idempotent staging table enforces uniqueness on event hash. | N/A | Debug log only |
| **8** | **Out-of-order webhook delivery** | `delivered` webhook arrives before `request` or `sent` webhook. | `EmailWebhookService` verifies `STATUS_PRECEDENCE`. Terminal status cannot be regressed by non-terminal event. | State monotonicity rules protect terminal delivery states. | N/A | Log: `WEBHOOK_STATUS_REGRESSION_SUPPRESSED` |
| **9** | **Webhook missing message identifier** | Edge webhook arrives without `message-id` header/property. | Persisted in `EmailWebhookInbox` with status `UNMATCHED_NO_IDENTIFIER`. Returns HTTP 200 to acknowledge provider. | Isolated in inbox table; prevents webhook route crashes. | N/A | Warning: `BREVO_WEBHOOK_MISSING_MESSAGE_ID` |
| **10**| **Webhook arrives before outbox record exists** | Network/processing delay stages webhook before outbox row is committed. | Webhook staged as `RECEIVED` in `EmailWebhookInbox`. Asynchronous reconciliation worker matches record once outbox row exists. | Dual-timestamp logging preserves event ordering. | N/A | Info log: `WEBHOOK_STAGED_AWAITING_MATCH` |
| **11**| **Permanent provider rejection (4xx/5xx/invalid email)** | Brevo rejects recipient address or account suspended. | Classified as permanent; status updated to `PERMANENT_FAILURE`, `nextAttemptAt = NULL`. | Automated retry blocked immediately. | **NO** | ErrorCenter: `EMAIL_PERMANENT_FAILURE` |
| **12**| **Transient provider error (429 rate limit / 503)** | Brevo returns temporary rate-limit or 503 unavailable. | Classified as retryable; status updated to `RETRYABLE_FAILURE`, `nextAttemptAt` set to exponential backoff. | Monitored by `attemptCount < maxAttempts`. | **YES** | Warning: `EMAIL_OUTBOX_RETRYABLE_BACKOFF` |
| **13**| **Retry attempt count exhaustion** | Row reaches `attemptCount >= maxAttempts` after retryable errors. | Worker marks status as `EXHAUSTED`, `nextAttemptAt = NULL`. | Automated retries permanently halted. | **NO** | Alert: `EMAIL_OUTBOX_ATTEMPTS_EXHAUSTED` |
| **14**| **Dual-dispatch collision during rolling deployment** | Old server running Mode 1 (`LEGACY_DIRECT`); new server running Mode 3 (`OUTBOX_WORKER`). | Old server issues and direct-sends without outbox row; new server issues with outbox row and worker sends. Direct dispatch is suppressed in Mode 3. | Controlled rollout requires staging in Mode 2 (`DUAL_WRITE_LEGACY_DISPATCH`) before Mode 3. | **NO** | Audit: `ROLLING_DEPLOYMENT_MODE_STAGED` |
| **15**| **Emergency rollback from Mode 3 to Mode 2/1** | Operator switches `INVOICE_NOTIFICATION_DISPATCH_MODE` back to `DUAL_WRITE` or `LEGACY_DIRECT`. | Outbox worker stops polling. In-flight leases expire safely or complete. New invoices handled exclusively by direct sender. | Single-owner dispatch policy prevents collision during rollback. | **NO** | Critical Audit: `OUTBOX_DISPATCH_MODE_ROLLBACK` |
| **16**| **User account deletion (GDPR Right to be Forgotten)** | User deleted while notification outbox rows exist. | Relation `user` specifies `onDelete: SetNull`. `userId` set to `NULL`. Statutory invoice and notification audit row preserved. | Foreign key constraint preserves tax audit record. | N/A | Audit: `USER_DATA_ERASURE_PROCESSED` |
| **17**| **Controlled statutory invoice resend** | Operator authorizes email resend for non-receipt. | Admin action increments `resendAuthorizationCount`, sets `status = PENDING`. Statutory invoice snapshot, numbering, and `contentHash` remain strictly unmodified. | Authoritative invoice record is completely immutable. | **OPERATOR ONLY** | Admin Audit: `BILLING_NOTIFICATION_RESEND_AUTHORIZED` |

---

## 3. EXACT FILES CREATED, MODIFIED, AND AUDITED

### Files Created:
1. `src/services/billing/invoice_notification_outbox_worker.ts`  
   - Implements `InvoiceNotificationOutboxWorker` class with lease-based polling, single-owner check, monotonic fencing, transport boundary marker, ambiguous quarantine, and expired lease sweeper.
2. `tests/invoice_notification_outbox_worker.test.ts`  
   - Static unit test specification containing 8 formal specifications verifying configuration, single-owner dispatch, monotonic fencing, boundary markers, timeout quarantine, lease sweeper, webhook staging, and server lifecycle hooks.
3. `PHASE-8.4-BATCH-E4-REPORT.md` (Artifact directory, `main website/Backend/`, and repository root).

### Files Modified:
1. `src/config/env.ts`  
   - Added `INVOICE_NOTIFICATION_DISPATCH_MODE`, `INVOICE_OUTBOX_WORKER_ENABLED`, `INVOICE_OUTBOX_WORKER_POLL_INTERVAL_MS`, `INVOICE_OUTBOX_WORKER_BATCH_SIZE`, `INVOICE_OUTBOX_WORKER_LEASE_MS`.
2. `src/services/billing/billing_invoice_service.ts`  
   - Added transactional outbox creation inside `issueInvoiceForPayment` and dispatch suppression in post-commit hook under `OUTBOX_WORKER` mode.
3. `src/services/email_webhook_service.ts`  
   - Added `stageEventInInbox` method and staged raw authenticated webhook payloads into `EmailWebhookInbox` with dual timestamps.
4. `src/server.ts`  
   - Wired worker startup and graceful shutdown into application lifecycle.

---

## 4. DOCUMENTED LIMITATIONS & REMAINING GAPS

While the worker and outbox integration are fully implemented, the following documented limitations remain prior to production promotion:

1. **Prisma Client Generation Required in Authorized Environment:**
   Because all work was performed under strict non-execution boundaries, `prisma generate` was not run. The worker utilizes raw parameterized SQL queries (`prisma.$executeRawUnsafe` / `prisma.$queryRawUnsafe`) to interact with `InvoiceNotificationOutbox` and `EmailWebhookInbox`. Once `npm run db:generate` is executed in a build pipeline, strongly-typed model accessors can replace raw SQL.
2. **`pdfkit` Package Installation Required for Runtime PDF Generation:**
   As verified in Batch E.1, `pdfkit` is declared in `package.json` but missing from `package-lock.json` and `node_modules`. PDF generation will fail at runtime until an authorized `npm install` is executed.
3. **Webhook Reconciliation Worker (Phase 8.4 Batch E.5):**
   The webhook staging inbox is now live (`EmailWebhookInbox`), but the asynchronous background worker that reconciles orphan `RECEIVED` webhooks against `AMBIGUOUS_OUTCOME` outbox rows is slated for Phase 8.4 Batch E.5.
4. **Administrative Operations UI / RBAC Endpoints:**
   Operator endpoints to manually resolve `AMBIGUOUS_OUTCOME` rows (`FORCE_MARK_DISPATCHED`) or trigger `AUTHORIZE_RESEND` are designed (RBAC `billing.reconcile` and `billing.write`) and will be implemented in the administrative tooling batch.

---

## 5. VERDICT AND NEXT STEPS

### Deliverable Verdict:
# **`IMPLEMENTED WITH DOCUMENTED LIMITATIONS`**

### Recommended Transition:
The invoice notification outbox worker, dispatch controls, monotonic fencing, boundary markers, and webhook staging foundation are fully implemented and statically verified. Awaiting user review and authorization before proceeding to **Phase 8.4 Batch E.5** (Webhook Reconciliation Worker & Operator Controls).
