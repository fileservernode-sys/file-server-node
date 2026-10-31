# ZDEXCLOUD | PHASE 8.4 | BATCH E
# INVOICE NOTIFICATION IDEMPOTENCY, RECOVERY & DELIVERY RELIABILITY AUDIT & HARDENING REPORT

**Audit Date:** 2026-10-10  
**Phase:** 8.4 (Invoice Document Delivery & Customer Retrieval Architecture)  
**Batch:** E (Invoice Notification Idempotency, Recovery & Delivery Reliability)  
**Repository:** `D:\YOUM PATEL\Desktop\Projects\File Server Project\`  
**Backend:** `main website/Backend/`  
**Canonical Domain:** `https://zdexcloud.com`  
**Verdict:** **`INVOICE NOTIFICATION RELIABILITY HARDENED WITH DOCUMENTED LIMITATIONS`**

---

## EXECUTIVE SUMMARY

Phase 8.4 Batch E performed a deep source audit of ZdexCloud's invoice-issued notification pipeline, examining failure modes across concurrent dispatches, ambiguous transport results, post-commit process crashes, un-notified invoice recovery, and webhook race conditions.

Key findings and hardening actions:
1. **Schema Constraints on `correlationId`:** Confirmed that `EmailMessage.correlationId` in `prisma/schema.prisma` is **indexed** (`@@index([correlationId])`) but has **no `@unique` or `@@unique` constraint**. Application-level `findFirst()` serializes sequential retries and deduplicates recovery runs, but cannot guarantee atomic exclusion for concurrent workers racing within the exact same millisecond window without a database-level uniqueness constraint or outbox table.
2. **Post-Commit Crash Recovery Gap Closed:** Discovered that the existing `BillingInvoiceRecoveryService` previously queried only uninvoiced payments (`invoice: null`). Invoices committed immediately before a worker crash were previously invisible to recovery. Batch E introduced [`retryDeferredInvoiceNotifications()`](file:///D:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/src/services/billing/billing_invoice_recovery_service.ts) and [`findInvoicesPendingNotification()`](file:///D:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/src/services/billing/billing_invoice_recovery_service.ts), allowing recovery of missed notifications for persisted invoices without allocating new numbers, without recalculating taxes, and without mutating payment or subscription state.
3. **Delivery State Machine & In-Progress Detection:** Hardened [`BillingInvoiceNotificationService`](file:///D:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/src/services/billing/billing_invoice_notification_service.ts) to inspect both `SENT` and `DELIVERED` states, and added in-progress claim detection (`QUEUED` within a 5-minute lease window).
4. **Canonical Frontend Page Path Correction:** Verified actual physical frontend files and canonical `<link rel="canonical">` declarations on disk. Updated portal navigation from generic `/billing` to the verified canonical path `/pages/billing.html`.
5. **Webhook Monotonicity & Ambiguous Outcomes:** Audited Brevo webhook race conditions against `EmailWebhookService.STATUS_PRECEDENCE`. Established that transport timeouts cannot be treated as confirmed provider rejections.
6. **Static Test Specifications:** Authored 14 comprehensive static test specifications in [`tests/invoice_notification_reliability.test.ts`](file:///D:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/tests/invoice_notification_reliability.test.ts). Tests remain unexecuted.

---

## 1. EXACT FILES AUDITED, CHANGED, AND CREATED

### Files Audited:
- `prisma/schema.prisma` (Models: `EmailMessage`, `EmailDeliveryAttempt`, `NotificationRecord`, `ChannelDeliveryRecord`, `BillingInvoice`, `BillingPayment`; Enums: `EmailMessageStatus`, `EmailSourcePipeline`, `EmailTransport`, `ChannelDeliveryStatus`)
- `src/services/billing/billing_invoice_notification_service.ts` (Notification dispatch, deduplication, template parameters)
- `src/services/billing/billing_invoice_service.ts` (Post-commit notification invocation, race condition serialization)
- `src/services/billing/billing_invoice_recovery_service.ts` (Deferred payment and invoice recovery logic)
- `src/services/email.ts` (`BrevoEmailService`, `MockEmailService`, `sendRawMail`)
- `src/services/email_tracking_service.ts` (`recordTransactionalEmail`, `recordNotificationEmail`)
- `src/services/email_webhook_service.ts` (`STATUS_PRECEDENCE`, event normalization, monotonicity guards)
- `src/notifications/workers/delivery_processor.ts` (Track 4 delivery worker claim logic)
- `src/notifications/workers/delivery_worker.ts` (Track 4 background polling worker)
- `src/app.ts` (Fastify static file routing and clean slug resolution)
- `Frontend/pages/billing.html` and `Frontend/pages/transactions.html` (Physical frontend landing pages and canonical URLs)

### Files Modified:
- [`src/services/billing/billing_invoice_notification_service.ts`](file:///D:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/src/services/billing/billing_invoice_notification_service.ts): Hardened deduplication check to recognize `DELIVERED` status and active in-progress claims (`QUEUED` < 5 min); updated portal URL to canonical path `/pages/billing.html`; documented schema concurrency limitations.
- [`src/services/billing/billing_invoice_recovery_service.ts`](file:///D:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/src/services/billing/billing_invoice_recovery_service.ts): Added `findInvoicesPendingNotification()` and `retryDeferredInvoiceNotifications()` with bounded keyset cursor pagination, strict lifecycle filters (`ISSUED` only), and zero sequence reallocation.

### Files Created:
- [`tests/invoice_notification_reliability.test.ts`](file:///D:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/tests/invoice_notification_reliability.test.ts): 14 static test specifications for notification reliability, recovery, and schema limits.
- `PHASE-8.4-BATCH-E-REPORT.md` (Artifact directory, Backend root, Workspace root).

---

## 2. BATCH E.1 AUDIT FINDINGS: ANSWERS TO MANDATORY QUESTIONS

### Q1: Is `correlationId` unique in the actual database schema or merely indexed?
**Answer: MERELY INDEXED.**  
In `prisma/schema.prisma` lines 767 and 787:
```prisma
model EmailMessage {
  ...
  correlationId String?
  ...
  @@index([correlationId])
}
```
There is **no `@unique` or `@@unique` constraint** on `correlationId`, nor on `(correlationId, emailType)`. PostgreSQL generates a non-unique B-tree index. Two concurrent workers inserting `correlationId: "invoice_123"` will both succeed at the database level.

### Q2: Is a delivery record persisted before or after transport invocation?
**Answer: AFTER TRANSPORT INVOCATION.**  
In `BrevoEmailService.sendRawMail()`:
1. `const dispatchResult = await this.sendMail(to, subject, html, text);` (transport called over network)
2. `await emailTrackingService.recordTransactionalEmail(...);` (database record created)  
If a crash or unhandled process death occurs during or immediately after step 1, **no `EmailMessage` row exists in the database**.

### Q3: How are `SENT`, `FAILED`, and in-progress states represented?
**Answer:**  
In `EmailMessageStatus`:
- `SENT`: `status = SENT`, `sentAt = new Date()`, `attempts` record created with `status = SENT`.
- `FAILED`: `status = FAILED`, `failedAt = new Date()`, `failureReason` and `failureCode` populated.
- `In-progress`: **Not natively represented during direct transactional `sendRawMail()`.** The `QUEUED` enum value exists in `EmailMessageStatus`, but `sendRawMail()` does not pre-insert a `QUEUED` row prior to invoking SMTP/API. In Batch E, `BillingInvoiceNotificationService` now detects existing `QUEUED` records as in-progress claims if created within a 5-minute lease window.

### Q4: Can concurrent application instances reserve the same notification?
**Answer: NO ENFORCEABLE ATOMIC RESERVATION EXISTS IN THE SCHEMA.**  
Because `EmailMessage` lacks a unique constraint on `correlationId` and has no `processingWorkerId` or lease columns, an application-level `findFirst()` executed concurrently by two workers before either writes will return `null` for both, resulting in duplicate dispatches. An enforceable atomic reservation requires a database migration.

### Q5: Can failed notifications be retried without reissuing the invoice?
**Answer: YES.**  
The statutory invoice is committed in `BillingInvoice` independently of the notification. Re-running notification dispatch using the invoice snapshot dispatches the email without reallocating sequence numbers, without recalculating tax, and without touching payment state. Batch E introduces [`retryDeferredInvoiceNotifications()`](file:///D:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/src/services/billing/billing_invoice_recovery_service.ts) to perform this exact operation.

### Q6: Can an invoice committed immediately before a process crash be discovered later for notification recovery?
**Answer: PREVIOUSLY NO; NOW YES via Batch E.**  
Previously, `BillingInvoiceRecoveryService` only queried `billingPayment.findMany({ where: { invoice: null } })`. Because the payment already had an invoice, it was completely ignored by recovery. Batch E introduced `findInvoicesPendingNotification()`, which queries committed `BillingInvoice` records where `status = ISSUED` and verifies whether an `EmailMessage` exists for each.

### Q7: Can the existing worker safely process invoice notifications without adding a new queue?
**Answer: NO.**  
The existing `DeliveryWorker` and `DeliveryProcessor` in `src/notifications/workers/` are tightly coupled to `ChannelDeliveryRecord` and `NotificationRecord` (Track 4 notification system). They do not poll `EmailMessage` with `sourcePipeline: TRANSACTIONAL` and do not process `BillingInvoice` entities. Processing transactional email retries via that worker would require modifying Track 4 architecture or adding a dedicated transactional outbox.

### Q8: Can delivery webhooks race with application-side status updates?
**Answer: YES.**  
If Brevo delivers a message and sends an inbound webhook before the application finishes executing `recordTransactionalEmail()`, the webhook handler (`EmailWebhookService.processSingleEvent()`) queries `EmailMessage` by `providerMessageId`, finds nothing, and logs an unmatched event. If `recordTransactionalEmail()` later inserts with `status: SENT`, the `DELIVERED` status from the webhook is dropped. Furthermore, `STATUS_PRECEDENCE` in `EmailWebhookService` prevents regression once a status is terminal, but only if the row exists when the webhook arrives.

---

## 3. CONCURRENCY & AMBIGUOUS-TRANSPORT FAILURE ANALYSIS

```mermaid
sequenceDiagram
    autonumber
    participant App as Backend Service
    participant DB as PostgreSQL (Prisma)
    participant Brevo as Brevo API / SMTP
    participant Webhook as Brevo Webhook

    Note over App,Brevo: Failure Mode 1: Ambiguous Transport Timeout
    App->>Brevo: POST /v3/smtp/email (Timeout 10s)
    Note right of Brevo: Provider accepts & delivers email
    Brevo--xApp: Network Drop / Socket Timeout (ETIMEDOUT)
    App->>DB: recordTransactionalEmail(status: FAILED, failureReason: "Timeout")
    Note over App,DB: Application believes dispatch failed, but recipient received email!

    Note over App,Webhook: Failure Mode 2: Webhook Race Condition
    Webhook->>App: POST /api/v1/webhooks/brevo (event: "delivered")
    App->>DB: findFirst(providerMessageId) -> NULL (not saved yet!)
    App-->>Webhook: 200 OK (unmatched event acknowledged)
    App->>DB: recordTransactionalEmail(status: SENT)
    Note over DB: EmailMessage remains SENT forever; DELIVERED was lost in race!
```

### Risk Assessment:
- **No Exactly-Once Email Delivery:** Because network partitions between application and email provider can drop responses after provider acceptance, retrying an ambiguous timeout carries an inherent risk of duplicate email delivery.
- **Deduplication Boundary:** Deduplication via `findFirst({ where: { correlationId } })` provides strong protection against sequential duplicate events (replayed webhooks, manual retries, recovery ticks). It does **not** protect against simultaneous multi-worker race conditions without a database unique constraint.

---

## 4. SOURCE-LEVEL HARDENING IMPLEMENTED IN BATCH E

### 1. Hardened Deduplication in `BillingInvoiceNotificationService`
- **Recognizes `DELIVERED`:** Previously checked only `status: SENT`. Now checks `status: { in: [SENT, DELIVERED] }`. If a webhook has already marked the delivery as completed, duplicate dispatch is suppressed.
- **In-Progress Claim Detection:** Checks if an existing `EmailMessage` is in `QUEUED` status created within the active lease window (5 minutes). If so, returns `{ sent: false, skipped: true, reason: 'IN_PROGRESS' }`.
- **Monotonicity & Webhook Preservation:** Code comments and checks document that application updates must never overwrite a terminal webhook status (`DELIVERED`, `BOUNCED`, `PERMANENTLY_FAILED`).

### 2. Canonical Frontend Portal Path
- **Audit Result:** Verified `Frontend/pages/billing.html` and `Frontend/pages/transactions.html` physical paths and their `<link rel="canonical">` tags.
- **Correction:** Changed portal URL from `${frontendBase}/billing` to the verified canonical path `${frontendBase}/pages/billing.html`.

### 3. Notification Recovery in `BillingInvoiceRecoveryService`
- **Discovery Method:** `findInvoicesPendingNotification()` discovers persisted invoices with `status: BillingInvoiceStatus.ISSUED` in bounded batches (default 50, max 200) with deterministic ordering (`orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]`).
- **Recovery Engine:** `retryDeferredInvoiceNotifications()` traverses invoices using keyset cursors. For each invoice:
  * Skips if non-`ISSUED` (`DRAFT`, `VOIDED`, `SUPERSEDED`).
  * Skips if already `SENT` or `DELIVERED` in `EmailMessage`.
  * Skips if in-progress (`QUEUED` < 5 min).
  * Dispatches notification if missing, failed, or stale claim.
  * Never allocates sequence numbers, never recalculates tax, never alters snapshots, and never mutates payments or subscriptions.

---

## 5. STATIC TEST SPECIFICATIONS INVENTORY

Authored in `main website/Backend/tests/invoice_notification_reliability.test.ts`:

| # | Test Scenario / Specification | Guarded Architectural Invariant |
| :---: | :--- | :--- |
| **1** | Concurrent attempts to notify same invoice document schema limitation | Proves `correlationId` is indexed but lacks `@unique` constraint. |
| **2** | Existing SENT or DELIVERED notification suppresses duplicate dispatch | Validates idempotency against both initial sent and webhook-confirmed states. |
| **3** | Retryable failure retried without issuing another invoice | Guarantees recovery reuses existing invoice and sequence number. |
| **4** | Ambiguous transport outcomes not misrepresented | Confirms timeouts are recorded as unconfirmed transport errors. |
| **5** | Process crash after commit recoverable via notification recovery | Verifies `retryDeferredInvoiceNotifications()` discovers committed invoices. |
| **6** | Recovery processes persisted invoices without new number allocation | Ensures statutory sequence counter is not incremented during notification retry. |
| **7** | Recovery skips ineligible states (DRAFT, VOIDED, SUPERSEDED) | Guarantees invalid documents never trigger customer notifications. |
| **8** | Delivery webhook status not overwritten by late application response | Enforces `STATUS_PRECEDENCE` monotonicity. |
| **9** | Duplicate recovery runs respect idempotency mechanism | Verifies second recovery tick does not re-send emails. |
| **10** | Batch size and ordering bounded and deterministic | Verifies clamping to max 200 and keyset cursor ordering. |
| **11** | Notification failures do not mutate invoice, payment, or subscription | Confirms complete isolation between email transport and financial state. |
| **12** | No PDF attachment, public link, or auth token in notification payload | Enforces data minimization and canonical portal link. |
| **13** | Recovery and dispatch failures logged without sensitive data | Verifies privacy sanitization in operational logging. |
| **14** | Unresolved schema-level concurrency requirement documented | Formally specifies the prerequisite database migration for multi-worker safety. |

*Explicit Notice:* All tests remain **unexecuted** in strict compliance with mandatory restrictions.

---

## 6. PREREQUISITES FOR FULL MULTI-WORKER DURABILITY

To achieve true distributed concurrency safety and exactly-once reservation in a multi-instance production deployment, the following changes are required in a future phase:

1. **Database Schema Migration:**
   ```prisma
   // In prisma/schema.prisma:
   model EmailMessage {
     ...
     correlationId String?
     ...
     @@unique([correlationId, emailType], map: "email_message_correlation_type_uniq")
   }
   ```
   *Impact:* An atomic database uniqueness constraint will cause racing concurrent workers to fail with a `P2002` unique constraint violation on `create()`, ensuring only the winning transaction dispatches.
2. **Transactional Outbox Table:**
   Alternatively, introduce an `InvoiceNotificationOutbox` table written inside the invoice issuance transaction, polled by a dedicated worker using `SELECT ... FOR UPDATE SKIP LOCKED`.
3. **Lockfile & PDF Kit Mismatch:**
   As documented in Phase 8.4 Batch B.1, `pdfkit` is installed and locked in `package-lock.json` but omitted from `package.json` dependencies. Reconciling `package.json` with `npm install --package-lock-only` remains a deployment prerequisite prior to production release.

---

## VERDICT & CONCLUSION

```
================================================================================
FINAL VERDICT: INVOICE NOTIFICATION RELIABILITY HARDENED WITH DOCUMENTED LIMITATIONS
================================================================================
```

The ZdexCloud invoice notification pipeline has been hardened within existing architectural boundaries. Missed notifications from post-commit process crashes are now recoverable without invoice re-issuance, in-progress claims and webhook-delivered states are recognized, and canonical portal links are verified. Documented limitations regarding database-level `correlationId` uniqueness and ambiguous transport timeouts are formally specified and tracked for future migration.
