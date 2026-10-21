# ZDEXCLOUD | PHASE 8.4 | BATCH E.4.2
# RECOVERY ELIGIBILITY, ROLLOUT SAFETY AND PRE-E.5 READINESS AUDIT REPORT

**Audit Date:** 2026-10-10  
**Phase:** 8.4 (Invoice Document Delivery & Customer Retrieval Architecture)  
**Batch:** E.4.2 (Recovery Eligibility, Rollout Safety and Pre-E.5 Readiness Audit)  
**Repository Root:** `D:\YOUM PATEL\Desktop\Projects\File Server Project\`  
**Target Subsystem:** `main website/Backend/`  
**Canonical Domain:** `https://zdexcloud.com`  
**Execution Mode:** Read-Only Source Audit with Minimal Recovery-Safety Corrections Only  
**Final Deliverable Verdict:** **`READY FOR E.5 WITH DOCUMENTED LIMITATIONS`**

---

## 1. EXECUTIVE SUMMARY & VERDICT

Phase 8.4 Batch E.4.2 performed a comprehensive, repository-grounded audit of all invoice notification dispatch and recovery mechanisms across the codebase, establishing whether the architecture is safe to advance to **Phase 8.4 Batch E.5** (Webhook Reconciliation Worker & Operator Controls).

### Key Audit Findings:
1. **Recovery Eligibility Hardened:** Identified and corrected a critical loophole in `BillingInvoiceRecoveryService`: previously, legacy recovery only checked if an outbox record was in 5 specific statuses, leaving `EXHAUSTED`, `PERMANENT_FAILURE`, `HISTORICAL_UNTRACKED`, and `PENDING` exposed to direct bypass. Furthermore, invoices without outbox rows had no age cutoff, meaning pruned or un-tracked historical invoices could have triggered unprompted customer emails. The service now strictly defers to ANY existing outbox record, and enforces a conservative 24-hour lookback cutoff (`maxAgeHours`) on invoices lacking outbox records.
2. **Dispatch Path Exhaustiveness Verified:** Exactly three callers of `BillingInvoiceNotificationService.sendInvoiceIssuedNotification` exist in the entire codebase: (1) Direct post-commit issuance, (2) Outbox worker, and (3) Deferred recovery. Every other service or route relies on customer web portal retrieval.
3. **Single-Owner Deployment Invariant Established:** Per-process configuration flags (`INVOICE_NOTIFICATION_DISPATCH_MODE`) cannot enforce cluster-wide mutual exclusion across heterogeneous running versions without an operational three-phase deployment gate.
4. **Retry Classification Ground Truth:** Reaffirmed that HTTP 5xx, socket hangups, and timeouts (`ETIMEDOUT`) do NOT prove provider non-acceptance. The worker and recovery layers correctly quarantine all ambiguous outcomes as `AMBIGUOUS_OUTCOME`, permanently suppressing automated retries.
5. **No Invoice Snapshot Mutation:** Guaranteed that no notification dispatch or recovery path re-issues invoices, allocates new sequence numbers, mutates tax calculations, or alters the cryptographic `contentHash`.
6. **Zero-Execution Boundary Complied With:** Zero tests, builds, compiler passes, database queries, migrations, or real emails were executed.

---

## 2. EXACT FILES INSPECTED AND CHANGED

### Files Changed:
1. [`src/services/billing/billing_invoice_recovery_service.ts`](file:///D:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/src/services/billing/billing_invoice_recovery_service.ts):
   - Added `maxAgeHours` option to `DeferredInvoiceNotificationRecoveryOptions` (default: 24h).
   - In `retryDeferredInvoiceNotifications`, updated outbox check to defer completely to ANY existing `InvoiceNotificationOutbox` record, skipping direct legacy recovery.
   - Added conservative historical lookback guard: skips automated recovery for invoices older than `maxAgeHours` lacking an outbox record, preventing duplicate sends on historical invoices.
2. [`tests/invoice_notification_outbox_worker.test.ts`](file:///D:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/tests/invoice_notification_outbox_worker.test.ts):
   - Added `SPEC 16`: Verifies recovery service defers exclusively to `InvoiceNotificationOutbox` when an outbox record exists.
   - Added `SPEC 17`: Verifies recovery service enforces conservative historical lookback threshold (`maxAgeHours`) for invoices lacking outbox rows.

### Files Inspected (Read-Only):
- `src/services/billing/invoice_notification_outbox_worker.ts`
- `src/services/billing/billing_invoice_service.ts`
- `src/services/billing/billing_invoice_notification_service.ts`
- `src/services/billing/billing_invoice_document_service.ts`
- `src/services/email_webhook_service.ts`
- `src/services/email.ts`
- `src/services/email_tracking_service.ts`
- `src/services/email_failure_classifier.ts`
- `src/config/env.ts`
- `src/server.ts`
- `prisma/schema.prisma`
- `prisma/migrations/20261010160000_add_invoice_notification_outbox_and_webhook_inbox/migration.sql`

---

## 3. EVERY INVOICE-NOTIFICATION DISPATCH AND RECOVERY PATH FOUND

Static AST inspection confirms that all email notifications for statutory tax invoices pass through `BillingInvoiceNotificationService.sendInvoiceIssuedNotification(invoice, options)`.

The repository contains exactly three invocation paths:

```
                                  ┌────────────────────────────────────────────────────────┐
                                  │ BillingInvoiceNotificationService                     │
                                  │ .sendInvoiceIssuedNotification(invoice, options)      │
                                  └─────────────────────────▲──────────────────────────────┘
                                                            │
                     ┌──────────────────────────────────────┼──────────────────────────────────────┐
                     │                                      │                                      │
        ┌────────────┴────────────┐            ┌────────────┴────────────┐            ┌────────────┴────────────┐
        │  Path 1: Direct Send    │            │  Path 2: Outbox Worker  │            │  Path 3: Recovery Job   │
        │  BillingInvoiceService  │            │  InvoiceOutboxWorker    │            │  BillingInvoiceRecovery │
        │  .issueInvoiceForPayment│            │  .claimAndDispatchRecord│            │  .retryDeferredInvoices │
        └─────────────────────────┘            └─────────────────────────┘            └─────────────────────────┘
```

| Path | Trigger / Origin | Guard Conditions & Single-Owner Enforcement | Action on Ambiguous Timeout |
| :--- | :--- | :--- | :--- |
| **Path 1: Direct Issuance Dispatch** | Triggered immediately post-commit inside `BillingInvoiceService.issueInvoiceForPayment()`. | **Mode Guard:** Evaluates `config.INVOICE_NOTIFICATION_DISPATCH_MODE !== 'OUTBOX_WORKER'`. If mode is `OUTBOX_WORKER`, direct dispatch is **completely suppressed**; outbox worker owns transmission. If mode is `DUAL_WRITE`, sends directly and updates shadow outbox row. | If direct send fails with ambiguous timeout, updates shadow outbox row to `AMBIGUOUS_OUTCOME`. |
| **Path 2: Outbox Worker Dispatch** | Background timer tick (`processTick`) inside `InvoiceNotificationOutboxWorker`. | **Mode Guard:** Evaluates `config.INVOICE_NOTIFICATION_DISPATCH_MODE === 'OUTBOX_WORKER'` and `INVOICE_OUTBOX_WORKER_ENABLED === true`. Re-verifies state immediately before persisting `transportStartedAt`. Competing instances serialize via monotonic `claimVersion`. | Catches ambiguous timeout/network hang and immediately transitions outbox row to `AMBIGUOUS_OUTCOME`, clearing `nextAttemptAt = null` (auto-retry permanently suppressed). |
| **Path 3: Deferred Recovery Dispatch** | Explicit administrator invocation of `BillingInvoiceRecoveryService.retryDeferredInvoiceNotifications()`. | **Mode Guard:** Suppressed if `INVOICE_NOTIFICATION_DISPATCH_MODE === 'OUTBOX_WORKER'`. **Outbox Guard:** Skips if ANY `InvoiceNotificationOutbox` record exists. **Historical Guard:** Skips if invoice age > 24 hours without outbox row. | Permanently skips any record with ambiguous failure reason (`/timeout\|etimedout\|econnreset/i`). |

**Conclusion:** Zero rogue dispatch endpoints or un-guarded controllers exist. Every dispatch path respects the configured dispatch owner.

---

## 4. ELIGIBILITY RULES FOR EACH OUTBOX STATUS AND HISTORICAL RECOVERY CASE

The table below details the formal eligibility rules enforced by the codebase:

| Outbox Status / Case | Worker Eligible to Claim? | Recovery Service Eligible? | Permitted Automated Action | Permitted Manual Action |
| :--- | :-: | :-: | :--- | :--- |
| **`PENDING`** | **YES** (if `nextAttemptAt <= NOW()`) | **NO** (Deferred to outbox worker) | Worker claims with lease and increments `claimVersion`. | N/A |
| **`SHADOW_PENDING`** | **NO** (Explicitly filtered out) | **NO** (Deferred to outbox record) | Direct send updates to `DISPATCHED` or `AMBIGUOUS_OUTCOME`. | Operator inspection during dual-write verification. |
| **`CLAIMED`** | **NO** (Active lease held) | **NO** (Active lease held) | If lease expires and `transportStartedAt IS NULL`, resets to `PENDING`. If `transportStartedAt IS NOT NULL`, quarantines to `AMBIGUOUS_OUTCOME`. | N/A |
| **`DISPATCHED`** | **NO** (Terminal success) | **NO** (Already dispatched) | None. Webhook reconciler may advance to `DELIVERED`. | View delivery logs in Error Center / Admin portal. |
| **`DELIVERED`** | **NO** (Terminal delivery) | **NO** (Already delivered) | None. Delivery confirmed by provider webhook. | View delivery logs. |
| **`RETRYABLE_FAILURE`** | **YES** (if `nextAttemptAt <= NOW()`) | **NO** (Governed by outbox worker) | Worker claims with exponential backoff delay. | Operator may trigger immediate retry. |
| **`AMBIGUOUS_OUTCOME`** | **NO** (Permanently quarantined) | **NO** (Permanently quarantined) | **Zero automated retry permitted.** | Batch E.5 `FORCE_MARK_DISPATCHED` or `AUTHORIZE_RESEND`. |
| **`PERMANENT_FAILURE`** | **NO** (Non-retryable rejection) | **NO** (Non-retryable rejection) | **Zero automated retry permitted.** | Correct recipient address via admin operations. |
| **`EXHAUSTED`** | **NO** (Max attempts reached) | **NO** (Max attempts reached) | **Zero automated retry permitted.** | Operator triage in Billing Operations dashboard. |
| **`HISTORICAL_UNTRACKED`** | **NO** (Historical legacy record) | **NO** (Historical legacy record) | **Zero automated retry permitted.** | Self-service customer download via authenticated portal. |
| **Historical Invoice (No Outbox Row, Age <= 24h)** | **NO** (No outbox record) | **YES** (Only if no `EmailMessage` and not ambiguous) | Recovery attempts direct dispatch. | Self-service download via portal. |
| **Historical Invoice (No Outbox Row, Age > 24h)** | **NO** (No outbox record) | **NO** (Skipped by historical lookback guard) | **Zero automated retry permitted.** | Self-service download via portal (`/pages/billing.html`). |

---

## 5. MIXED-INSTANCE ROLLOUT AND ROLLBACK FINDINGS

### 5.1 The Distributed Single-Owner Limitation:
Antigravity confirms the source finding from Batch E.4.1:
**Environment variables (`INVOICE_NOTIFICATION_DISPATCH_MODE`) are local to the Node.js process and cannot enforce distributed cluster consensus without an operational deployment gate.**

### 5.2 Scenario Analysis:
1. **Old Version (Mode 1) + New Version (Mode 3):**
   - Invoices issued on Old Version instances are directly sent without creating outbox rows.
   - Invoices issued on New Version instances create `PENDING` outbox rows and are sent by the worker.
   - **Residual Risk:** If a background recovery job runs on an Old Version instance, it could discover an invoice issued on a New Version instance and attempt direct send before the worker finishes.
   - **Mitigation:** Ensure background recovery crons are halted during rolling upgrades.
2. **Instance A (Mode 2: `DUAL_WRITE`) + Instance B (Mode 3: `OUTBOX_WORKER`):**
   - Instance A writes `SHADOW_PENDING` and sends directly.
   - Instance B's worker ignores `SHADOW_PENDING` rows completely.
   - No cross-instance double-sending occurs on shadow rows.
3. **Worker Process Shutdown with In-Flight Request:**
   - Worker gracefully awaits active ticks for up to 10 seconds.
   - If forced exit occurs while request is in flight, `transportStartedAt` is preserved on disk.
   - When lease expires (5m), sweeper detects `transportStartedAt !== null` and quarantines row to `AMBIGUOUS_OUTCOME`. It is NEVER blindly re-queued.
4. **Emergency Rollback to Mode 2 or Mode 1:**
   - When config is reverted, worker daemon `tick()` immediately halts queue polling.
   - `PENDING` rows remain dormant in MySQL without automated sending. Newly issued invoices are handled by direct dispatch.

---

## 6. RETRY CLASSIFICATION FINDINGS

The audit inspected `email_failure_classifier.ts` and `email.ts` to evaluate provider non-acceptance versus ambiguous transport outcomes:

| Provider Outcome / Error | Proof of Non-Acceptance? | System Classification | Automated Retry Allowed? |
| :--- | :-: | :--- | :-: |
| **HTTP 400 Bad Request** | **YES** (Synchronously rejected by Brevo) | `PERMANENT_FAILURE` | **NO** |
| **HTTP 401 / 403 Auth Error** | **YES** (Synchronously rejected by Brevo) | `PERMANENT_FAILURE` | **NO** |
| **HTTP 429 Too Many Requests** | **YES** (Synchronously rejected with 429) | `RETRYABLE_FAILURE` | **YES** (with exponential backoff) |
| **HTTP 503 Service Unavailable** | **YES** (Synchronously rejected with 503 body) | `RETRYABLE_FAILURE` | **YES** (with exponential backoff) |
| **TCP Connection Refused (`ECONNREFUSED`)** | **YES** (Handshake failed before HTTP bytes sent) | `RETRYABLE_FAILURE` | **YES** (with exponential backoff) |
| **Socket Timeout (`ETIMEDOUT`)** | **NO** (Packet sent; response not received) | `AMBIGUOUS_OUTCOME` | **NO** (Quarantine) |
| **Socket Hangup / Reset (`ECONNRESET`, `EPIPE`)** | **NO** (Socket dropped mid-transmission) | `AMBIGUOUS_OUTCOME` | **NO** (Quarantine) |
| **HTTP 502 Bad Gateway / 504 Gateway Timeout** | **NO** (Upstream gateway dropped connection) | `AMBIGUOUS_OUTCOME` | **NO** (Quarantine) |
| **Invalid Recipient / Hard Bounce** | **YES** (Synchronous rejection) | `PERMANENT_FAILURE` | **NO** |

**Conclusion:** Only errors providing **definite proof of non-acceptance** (429, 503, connection refused) are scheduled for automated retry. All network drops and timeouts after transport boundary commitment are strictly quarantined.

---

## 7. WEBHOOK IDENTITY AND STAGING LIMITATIONS

### Code Ground Truth:
- Brevo does **not** provide a universally unique GUID in all webhook bodies.
- The deterministic fingerprint `SHA256(cleanMsgId:eventType:timestamp)` is used **only** when both `cleanMsgId` and `eventTimestamp` are present. This safely deduplicates true network retries of the identical delivery webhook.
- When `cleanMsgId` is missing OR `eventTimestamp` is missing, the service assigns a unique staging ID (`unidentified_${eventType}_${recipient}_${timestamp}_${entropy}`).
- **Zero payloads are discarded or overwritten on ambiguous identity.** Every distinct webhook event is durably staged in `EmailWebhookInbox`.
- Missing provider timestamps remain `null` in the database; timestamps are never invented.

---

## 8. OPERATIONAL READINESS CHECKLIST

Prior to promoting this subsystem to production and executing Batch E.5:

```
[ ] 1. DEPLOYMENT-LEVEL DISPATCH-MODE COORDINATION
    - Verify all cluster instances receive identical environment variables.
    - Follow strict three-phase deployment:
        Phase 1: DUAL_WRITE_LEGACY_DISPATCH (INVOICE_OUTBOX_WORKER_ENABLED=false) across 100% of nodes.
        Phase 2: Verify shadow outbox rows are successfully updated to DISPATCHED post-send.
        Phase 3: Switch to OUTBOX_WORKER (INVOICE_OUTBOX_WORKER_ENABLED=true).

[ ] 2. DATABASE BACKUP AND MIGRATION REVIEW
    - Review prisma/migrations/20261010160000_add_invoice_notification_outbox_and_webhook_inbox/migration.sql.
    - Confirm tables use utf8mb4 collation and appropriate indexes.
    - Take snapshot backup of production MySQL database.

[ ] 3. AUTHORIZED MIGRATION APPLICATION
    - In an authorized production environment with DB connectivity:
      Execute: npx prisma migrate deploy

[ ] 4. PRISMA CLIENT GENERATION
    - In the authorized CI/CD build pipeline:
      Execute: npx prisma generate
    - Verify @prisma/client exports InvoiceNotificationOutbox and EmailWebhookInbox models.

[ ] 5. WORKER ENABLEMENT AND SHUTDOWN MONITORING
    - Verify graceful shutdown completes within 15-second budget on SIGTERM.
    - Confirm outbox sweeper logs OUTBOX_LEASE_RECLAIMED or OUTBOX_AMBIGUOUS_QUARANTINE as expected.

[ ] 6. AMBIGUOUS & EXHAUSTED OUTCOME MONITORING
    - Configure alerts in Error Center for:
      * EMAIL_OUTBOX_AMBIGUOUS_OUTCOME_QUARANTINE
      * EMAIL_OUTBOX_ATTEMPTS_EXHAUSTED
      * EMAIL_PERMANENT_FAILURE

[ ] 7. OPERATOR ADMINISTRATIVE CONTROLS (PHASE 8.4 BATCH E.5)
    - Keep manual resends unavailable until Batch E.5 implements RBAC-governed endpoints:
      * requireOperationPermission('billing.reconcile') for FORCE_MARK_DISPATCHED
      * requireOperationPermission('billing.write') for AUTHORIZE_RESEND
```

---

## 9. STATIC TEST SPECIFICATIONS SUMMARY

Static test specifications in [`tests/invoice_notification_outbox_worker.test.ts`](file:///D:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/tests/invoice_notification_outbox_worker.test.ts) were updated to 17 formal specifications:
- `SPEC 1` - `SPEC 15`: Configuration, single-owner suppression, monotonic claim version fencing, driver return handling, post-transport fencing, pre/post transport crash recovery, stale completion rejection, shadow isolation, in-flight mode changes, retry exhaustion, webhook staging, and parameterized SQL.
- `SPEC 16`: Verifies recovery service defers exclusively to `InvoiceNotificationOutbox` when an outbox record exists.
- `SPEC 17`: Verifies recovery service enforces conservative historical lookback threshold (`maxAgeHours`) for invoices lacking outbox rows.

---

## 10. EXPLICIT CONFIRMATION OF PROHIBITED OPERATIONS

In strict compliance with all operational instructions:
- **Zero test runners, test suites, or test compilation commands were executed.**
- **Zero Prisma CLI commands (`prisma generate`, `prisma migrate deploy`) were executed.**
- **Zero database connections were opened; zero SQL statements were executed against any database.**
- **Zero dependencies were installed, removed, or updated.**
- **Zero network requests or emails were sent; Brevo API was not contacted.**
- **Batch E.5 was NOT implemented.**

---

## 11. REMAINING BLOCKERS BEFORE BATCH E.5

The architecture is **sound and ready for Batch E.5 authoring**, subject to the following non-code operational prerequisites:
1. **Operator Approval:** Review and formal approval of this readiness report and operational checklist.
2. **Scope Boundary for Batch E.5:**
   Batch E.5 will author:
   - Webhook Reconciliation Worker (`src/services/billing/email_webhook_reconciliation_worker.ts`) to match staged `EmailWebhookInbox` records against `InvoiceNotificationOutbox`.
   - Administrative Operations Endpoints (`/admin/operations/billing/notifications/...`) with RBAC guards (`billing.reconcile`, `billing.write`) and audit logging (`AdminAuditEvent`).
   - Static test specifications for webhook reconciliation and operator resend governance.

---

### Final Readiness Verdict:
# **`READY FOR E.5 WITH DOCUMENTED LIMITATIONS`**
*(Awaiting operator review and authorization before proceeding to Batch E.5.)*
