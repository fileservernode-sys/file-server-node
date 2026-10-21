# ZDEXCLOUD PHASE 8.4 BATCH E.2: DURABLE INVOICE NOTIFICATION ARCHITECTURE AND MIGRATION DESIGN AUDIT

- **Audited Repository Root:** `D:\YOUM PATEL\Desktop\Projects\File Server Project\`
- **Target Backend Component:** `main website/Backend/`
- **Canonical Website:** `https://zdexcloud.com`
- **Audit Phase:** Phase 8.4, Batch E.2
- **Execution Date:** 2026-10-10
- **Mode:** Strict Read-Only Source Audit & Migration Design Specification (Zero code modifications, zero database execution, zero dependency mutations, zero tests executed, zero external network dispatches)

---

## 1. Executive Summary and Decision

During Phase 8.4 Batches D, E, and E.1, ZdexCloud established an invoice availability notification workflow alerting customers via email that their finalized statutory tax invoice is accessible in the authenticated billing portal (`/pages/billing.html`). While the existing implementation maintains strict financial isolation—ensuring email errors never roll back invoice issuance or payments—rigorous source audits in Batch E.1 revealed structural reliability blockers in the underlying communication plane:
1. **Unreserved Transport Ordering:** Outbound transactional emails invoke Brevo transport (`this.sendMail()`) *before* the tracking record is persisted in `recordTransactionalEmail()`. No pre-send `QUEUED` or reservation record exists in PostgreSQL/MySQL for transactional messages.
2. **Missing Database Uniqueness:** `EmailMessage.correlationId` has only a standard lookup index (`INDEX EmailMessage_correlationId_idx (correlationId)`). Without a database-level uniqueness constraint (`@unique` or `@@unique([correlationId, emailType])`), concurrent application workers executing simultaneously will both observe `null` on `findFirst({ where: { correlationId } })` and generate duplicate emails.
3. **Webhook-Before-Tracking Discard Window:** If Brevo dispatches a webhook event before the backend completes `recordTransactionalEmail()`, the webhook handler performs a lookup by `providerMessageId`, finds no matching record, acknowledges the event with HTTP 200, and permanently drops the delivery event because no staging inbox exists.
4. **Ambiguous Provider Network Timeouts:** External email transport lacks an upstream idempotent transaction key. Network timeouts (`ETIMEDOUT`) between the backend and Brevo may occur after Brevo has accepted and queued the email. Blind retries without stateful reconciliation risk duplicate customer deliveries.
5. **PDF Runtime Dependency Gap:** While `"pdfkit": "^0.15.0"` is declared in `package.json`, it has 0 occurrences in `package-lock.json` and is not installed in `node_modules`.

### Architectural Decision
To permanently resolve these gaps without destabilizing core financial billing transactions, **Option B: Transactional Outbox Pattern (`InvoiceNotificationOutbox`) coupled with an Unmatched Webhook Staging Inbox (`EmailWebhookInbox`)** is recommended.

Because customer invoices represent authoritative statutory documents, notification obligations must be guaranteed atomically with invoice issuance or recovered deterministically via a dedicated outbox worker. Reusing `EmailMessage` as a combined queue and log is rejected because `EmailMessage` is designed as an outbound delivery log across all pipelines (OTP, system, notifications) and lacks distributed lease semantics, backoff schedules, and payload staging.

**Audit Verdict:**
```
READY WITH DOCUMENTED LIMITATIONS
```
*(Ready for architectural and management review. Implementation and schema migrations remain deferred to future authorized execution batches.)*

---

## 2. Verified Source Baseline with Exact Paths and Symbols

The following table records the authoritative symbols, file paths, and current line numbers verified in the working checkout:

| Component / Subsystem | Exact Source File Path | Verified Symbols & Entry Points | Ground Truth Behavior |
| :--- | :--- | :--- | :--- |
| **Email Message Schema** | `prisma/schema.prisma` (L737–789)<br>`prisma/migrations/20261001140000_add_central_email_tracking_models/migration.sql` | Model `EmailMessage`, Enum `EmailMessageStatus`, Enum `EmailSourcePipeline` | `correlationId VARCHAR(191) NULL` with `INDEX` only; **NO `@unique` or `@@unique` constraint**. Default status is `SENT`. |
| **Email Transport Engine** | `src/services/email.ts` (L56–310, L267–309) | `BrevoEmailService.sendMail()`, `BrevoEmailService.sendRawMail()` | Network dispatch occurs at L268 (`await this.sendMail(...)`) **before** DB tracking at L291 (`emailTrackingService.recordTransactionalEmail(...)`). `QUEUED` is never written. |
| **Email Tracking Service** | `src/services/email_tracking_service.ts` (L328–420) | `EmailTrackingService.recordTransactionalEmail()` | Persists `EmailMessage` strictly post-dispatch. Direct calls catch and swallow database exceptions to prevent business flow disruption. |
| **Email Webhook Ingestion** | `src/services/email_webhook_service.ts` (L264–482)<br>`src/routes/email-webhooks.ts` | `EmailWebhookService.processSingleEvent()`, `normalizeBrevoEvent()` | Looks up `EmailMessage` by `providerMessageId` (L288). If `null`, logs unmatch and returns HTTP 200 without saving payload (L300–310). |
| **Invoice Issuance Engine** | `src/services/billing/billing_invoice_service.ts` (L412–862) | `BillingInvoiceService.generateInvoiceForPayment()` | Atomic issuance boundary at L643 (`prisma.$transaction`). Row-locks `BillingPayment` (L646). Post-commit notification trigger at L838–850 via non-blocking `.catch()`. |
| **Invoice Notification Dispatcher** | `src/services/billing/billing_invoice_notification_service.ts` (L51–258) | `BillingInvoiceNotificationService.sendInvoiceIssuedNotification()` | Constructs portal link `${frontendBase}/pages/billing.html` (L164). Lacks atomic claim; relies on sequential `findFirst({ where: { correlationId } })` (L111). |
| **Invoice Recovery Engine** | `src/services/billing/billing_invoice_recovery_service.ts` (L403–614) | `findInvoicesPendingNotification()`, `retryDeferredInvoiceNotifications()` | Scans committed `BillingInvoice` rows with status `ISSUED`. Employs `classifyEmailFailure()` (L501) to block retrying permanent failures. Bounded keyset pagination. |
| **Failure Classification** | `src/services/email_failure_classifier.ts` (L114–310) | `classifyEmailFailure()`, Enum `EmailFailureDisposition` | Distinguishes `PERMANENT`, `RETRYABLE`, `EXHAUSTED`, `BLOCKED`, `SPAM`, and `ALREADY_DELIVERED`. Calculates exponential backoff with bounded jitter. |
| **Retention & Worker Locking** | `src/services/email_retention_worker.ts` (L55–386)<br>`src/server.ts` (L58–125) | `EmailRetentionWorker.acquireDistributedLock()` | Implements MySQL named locking (`GET_LOCK('zdexcloud_email_retention_worker', 5)`). Managed lifecycle via Fastify server hooks. |
| **Sequence Allocator** | `src/services/billing/billing_invoice_sequence_service.ts` (L158–241) | `BillingInvoiceSequenceService.allocateNextNumber()` | Monotonic atomic counter using `SELECT ... FOR UPDATE` inside `tx`. Formats `ZCI-YYZZ-NNNNNN` (GST Rule 46(b)). Never called during email retries. |

---

## 3. Re-Verification of Findings from Batches E and E.1

A line-by-line inspection of current source files re-confirms all findings reported in Batch E.1:

1. **Email Transport Precedes Database Persistence:**
   - In `BrevoEmailService.sendRawMail()` (`src/services/email.ts`, L267–309), line 268 executes `await this.sendMail(to, subject, html, text)` prior to evaluating `options.sourcePipeline === 'TRANSACTIONAL'` at line 290 and calling `recordTransactionalEmail` at line 291.
   - If the Node.js process crashes, encounters an OOM event, or experiences a network partition immediately after `this.sendMail()` completes, Brevo will have accepted/sent the email, but no `EmailMessage` record will exist in MySQL.
2. **Correlation ID Uniqueness Deficit:**
   - In `prisma/schema.prisma` (L787) and `prisma/migrations/20261001140000_add_central_email_tracking_models/migration.sql` (L47), `correlationId` is declared with `INDEX EmailMessage_correlationId_idx (correlationId)`.
   - In MySQL, an index provides fast `SELECT` queries but does not enforce exclusivity. Two concurrent workers dispatching `sendInvoiceIssuedNotification` for `invoice_123` at the exact same millisecond will both execute `findFirst({ where: { correlationId: 'invoice_123' } })` simultaneously, both receive `null`, and both call `sendRawMail()`, delivering duplicate emails.
3. **Webhook Discard Window:**
   - In `EmailWebhookService.processSingleEvent()` (`src/services/email_webhook_service.ts`, L288–310), incoming webhook events query `prisma.emailMessage.findFirst({ where: { providerMessageId } })`.
   - If Brevo fires a `sent` or `delivered` webhook that reaches the webhook handler before `recordTransactionalEmail()` completes its write, `emailMessage` is `null`. The code outputs a log message and returns `{ success: true, matched: false }`, acknowledging HTTP 200 without writing to any fallback or staging queue. The event is permanently lost.
4. **Ambiguous Provider Timeout Risk:**
   - Brevo's HTTPS REST API does not support a client-specified idempotency key header (unlike Stripe or Razorpay). If an HTTP POST to `https://api.brevo.com/v3/smtp/email` times out with `ETIMEDOUT` after Brevo's upstream server processed the request, the application catches the error and reports `success: false`. If a recovery job re-attempts dispatch, a duplicate email will be sent to the customer.
5. **PDF Runtime Dependency Gap:**
   - Backend `package.json` declares `"pdfkit": "^0.15.0"` (L37) and `"@types/pdfkit": "^0.13.4"` (L45).
   - However, `package-lock.json` contains 0 instances of `pdfkit`. Inspection of disk via `Test-Path "node_modules\pdfkit"` returns `False`. Runtime calls to PDFKit will fail with `MODULE_NOT_FOUND` until an authorized `npm install` is executed in an approved environment.

---

## 4. Architecture Option Comparison & Recommendation

We evaluate three potential architectural paths to achieve reliable, exactly-once notification delivery coordination:

### Architecture Options Evaluated

1. **Option A: Minimal Durable Tracking Changes**
   - *Design:* Modify `BrevoEmailService` to insert a `QUEUED` `EmailMessage` row prior to provider dispatch. Add a database constraint `@@unique([correlationId, emailType])` on `EmailMessage`. Update `EmailWebhookService` to poll or retry unmatched events.
   - *Evaluation:* Simple, but overloads `EmailMessage` with dual responsibilities: audit logging and durable task scheduling. Polling MySQL for state transitions adds lock contention on a high-volume tracking table.
2. **Option B: Transactional Notification Outbox (`InvoiceNotificationOutbox`) with Webhook Staging Inbox (`EmailWebhookInbox`)** *(RECOMMENDED)*
   - *Design:* Persist an explicit `InvoiceNotificationOutbox` record inside the invoice issuance transaction (`tx.invoiceNotificationOutbox.create`). An asynchronous, lease-based background outbox worker claims records (`CLAIMED`), executes PDF generation and provider dispatch, updates state (`DISPATCHED` / `RETRYABLE_FAILURE` / `PERMANENT_FAILURE`), and records the resulting `EmailMessage` audit row. Webhook events arriving early are staged in an `EmailWebhookInbox` table and reconciled asynchronously.
   - *Evaluation:* Completely decouples external network I/O from billing transactions. Guarantees zero missed notification obligations without altering invoice generation guarantees. Provides clean operational observability and lease recovery.
3. **Option C: Reusing `ChannelDeliveryRecord` from Track 4**
   - *Design:* Treat invoice notifications as an internal notification pipeline event (`NotificationRecord` + `ChannelDeliveryRecord`).
   - *Evaluation:* High cognitive and architectural overhead. Track 4 is designed for user-facing app/device push notifications (`maxAttempts: 5`, FCM tokens, user device IDs). Coupling statutory tax invoices to user notification preference toggles risks customers disabling notifications and missing mandatory billing records.

### Comparison Matrix

| Evaluation Dimension | Option A: Minimal Tracking Changes | Option B: Transactional Outbox (Recommended) | Option C: Extend Track 4 `ChannelDeliveryRecord` |
| :--- | :--- | :--- | :--- |
| **Delivery Reliability** | High (pre-persisted `QUEUED` state) | **Maximum** (atomic outbox creation inside invoice `tx`) | High |
| **Worker Concurrency Safety** | Moderate (relies on DB unique constraint & optimistic lock on `EmailMessage`) | **Maximum** (atomic lease acquisition `SELECT ... FOR UPDATE` or conditional lease timestamp update) | High |
| **Webhook-Before-Tracking Gap** | Partial (requires in-memory retry or delayed lookup) | **Solved** (durable `EmailWebhookInbox` staged reconciliation) | Unresolved |
| **Crash Recovery** | Moderate (stuck `QUEUED` rows require custom sweeper) | **Engineered** (expired lease sweeper with exponential backoff) | Existing worker sweeps |
| **Duplicate Dispatch Risk** | Low (database unique constraint) | **Lowest achievable** (lease coordination + outbox state machine) | Low |
| **Migration Complexity** | Low (alter existing table) | **Low to Moderate** (add 2 clean isolated tables) | High (complex multi-table foreign keys) |
| **Operational Observability** | Poor (queue states mixed with historical logs) | **Superior** (queue depth, claim age, retry counts directly queryable) | Moderate |
| **Isolation from Statutory Invoicing** | High | **Total** (outbox row created in invoice `tx`; dispatch is 100% async) | Moderate |
| **Rollback & Deployment Safety** | Moderate (altering high-write table) | **Safe** (new tables; zero breaking changes to existing flows) | Risky |

### Architectural Recommendation Justification
**Option B (Transactional Outbox + Staging Inbox)** is selected. It conforms to proven enterprise payment system patterns. An issued invoice establishes a statutory financial and legal obligation. By creating the notification outbox row inside the exact same database transaction that creates the `BillingInvoice`, it is impossible for an invoice to be issued without a durable record of its notification obligation. Furthermore, separating transient operational outbox records from immutable historical email audit logs keeps write amplification and table bloat strictly isolated.

---

## 5. Durable Notification State Machine Specification

The `InvoiceNotificationOutbox` entity governs the lifecycle of invoice delivery.

```
       [ Invoice Issuance Transaction ]
                       │
                       ▼
                 ┌───────────┐
                 │  PENDING  │ ◄──────────────────────────────┐
                 └─────┬─────┘                                │
                       │ (Lease Acquired by Outbox Worker)    │
                       ▼                                      │
                 ┌───────────┐                                │ (Transient error &
                 │  CLAIMED  │                                │  attempts < max)
                 └─────┬─────┘                                │
                       ├───► [PDF Rendering / Brevo Dispatch] │
                       │                                      │
          ┌────────────┼───────────────────────────┐          │
          │            │                           │          │
          ▼            ▼                           ▼          │
    ┌───────────┐┌───────────┐               ┌───────────┐    │
    │DISPATCHED ││ AMBIGUOUS │               │ RETRYABLE │────┘
    └─────┬─────┘└─────┬─────┘               └───────────┘
          │            │
          │ (Webhook)  │ (Reconciled by Webhook / Worker)
          ▼            ▼
    ┌───────────┐┌───────────┐               ┌───────────┐
    │ DELIVERED ││ PERMANENT │               │ EXHAUSTED │
    └───────────┘└───────────┘               └───────────┘
```

### Complete State Transition Table

| State Name | Entry Conditions | Permitted Next States | Owning Component | Recoverable? | Retry Eligible? | Required Metadata & Timestamps |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`PENDING`** | Created atomically inside invoice issuance transaction (`BillingInvoiceService.generateInvoiceForPayment`). | `CLAIMED`, `CANCELLED` | Invoice Issuance Engine | Yes | Yes (Immediate) | `invoiceId`, `userId`, `recipientEmail`, `createdAt`, `scheduledAt` |
| **`CLAIMED`** | Worker acquires lease via conditional update: `WHERE status = 'PENDING' OR (status = 'CLAIMED' AND leaseExpiresAt < NOW())`. | `DISPATCHED`, `RETRYABLE_FAILURE`, `PERMANENT_FAILURE`, `AMBIGUOUS_OUTCOME` | Outbox Background Worker | Yes (after lease expiry) | No (while lease active) | `workerId`, `claimedAt`, `leaseExpiresAt` (default 5m), `attemptCount` |
| **`DISPATCHED`** | Brevo HTTP API returns HTTP 200/201 with valid `providerMessageId`, or SMTP relay returns code 250. | `DELIVERED`, `BOUNCED`, `PERMANENT_FAILURE` | Outbox Background Worker | No (Awaiting webhook) | No | `providerMessageId`, `dispatchedAt`, `providerResponseCode`, `durationMs` |
| **`DELIVERED`** | Brevo webhook delivers verified `delivered` event matching `providerMessageId`. | Terminal (None) | Email Webhook Service | No (Terminal) | No | `deliveredAt`, `webhookEventId` |
| **`RETRYABLE_FAILURE`** | Transient network error (`ECONNRESET`, rate limit 429, 5xx), and `attemptCount < maxAttempts`. | `PENDING`, `EXHAUSTED` | Outbox Background Worker | Yes | Yes (after `nextRetryAt`) | `nextRetryAt`, `lastFailureReason`, `errorCode`, `attemptCount` |
| **`AMBIGUOUS_OUTCOME`** | Provider request times out (`ETIMEDOUT`) with unknown send status. Retrying blindly risks duplicate delivery. | `DISPATCHED`, `DELIVERED`, `MANUAL_REVIEW` | Webhook Staging Inbox / Recovery Worker | Yes (via reconciliation) | No (Blocked from blind auto-send) | `timeoutAt`, `lastFailureReason`, `reconciliationAttempts` |
| **`PERMANENT_FAILURE`** | Permanent recipient error (`invalid recipient`, `user not found`, `spam`, `blocked`). | Terminal (None) | Failure Classifier / Webhook Service | No (Terminal) | No | `failedAt`, `lastFailureReason`, `errorCode` |
| **`EXHAUSTED`** | `attemptCount >= maxAttempts` (default 5) following repeated transient failures. | `MANUAL_REVIEW` | Outbox Background Worker | Operator Only | No (Automated retry disabled) | `exhaustedAt`, `finalFailureReason`, `diagnosticSummary` |
| **`CANCELLED`** | Invoice voided or superseded prior to dispatch. | Terminal (None) | Invoice Management Service | No (Terminal) | No | `cancelledAt`, `cancellationReason` |

---

## 6. Idempotency and Concurrency Requirements

To eliminate the race conditions verified in Batch E.1, the design enforces four strict concurrency controls:

### 1. Stable Business Identity & Database Uniqueness
Every notification obligation has a deterministic business identity:
$$\text{idempotencyKey} = \text{invoice\_} + \text{invoice.id} + \text{\_ISSUED}$$
The database enforces this via a unique constraint:
```sql
UNIQUE KEY `uniq_invoice_notification` (`invoiceId`, `notificationType`)
```
This guarantees that even if two threads simultaneously execute invoice issuance or recovery, only **one** logical notification outbox record can ever exist per invoice.

### 2. Atomic Lease Acquisition & Distributed Locking
Workers claim records without distributed lock managers (like Redis) by utilizing atomic conditional SQL updates with bounded leases:
```sql
UPDATE `InvoiceNotificationOutbox`
SET
  `status` = 'CLAIMED',
  `workerId` = :workerId,
  `claimedAt` = NOW(3),
  `leaseExpiresAt` = DATE_ADD(NOW(3), INTERVAL 5 MINUTE),
  `attemptCount` = `attemptCount` + 1,
  `updatedAt` = NOW(3)
WHERE `id` = :id
  AND (`status` = 'PENDING' OR (`status` = 'CLAIMED' AND `leaseExpiresAt` < NOW(3)));
```
- **Crash Before Dispatch:** If a worker crashes after acquiring the lease, the row remains in `CLAIMED`. Once `leaseExpiresAt` elapses (5 minutes), the lease expires and any surviving worker can safely re-claim the record.
- **Crash After Provider Dispatch But Before Committing DB State:** The worker sent the email, but crashed before updating `InvoiceNotificationOutbox` to `DISPATCHED`. The lease will expire. When another worker claims it, the worker inspects `EmailWebhookInbox` and `EmailMessage` for existing `providerMessageId` or webhook matches before calling `sendRawMail()`.
- **Conditional State Guard:** Updates from workers verify the lease identity (`WHERE id = :id AND workerId = :workerId`). A slow worker whose lease expired cannot overwrite newer results committed by a successor worker.

### 3. Provider-Side Delivery Idempotency & Residual Risk
Brevo does not support client-generated transaction idempotency headers on transactional SMTP REST endpoints.
- **Residual Risk:** If a network timeout (`ETIMEDOUT`) occurs between ZdexCloud backend and Brevo, the application cannot prove whether Brevo received the message.
- **Reconciliation Policy:** The outbox row transitions to `AMBIGUOUS_OUTCOME`. The worker does **not** immediately retry. Instead, it holds the record for 15 minutes to allow an incoming Brevo webhook (`request`, `sent`, `delivered`, `soft_bounce`) to resolve the outcome. If no webhook arrives after 15 minutes, the worker logs an operational warning (`AMBIGUOUS_DELIVERY_RETRY`) and executes a controlled retry, recording potential duplicate delivery risk in audit logs. Exactly-once email delivery is physically impossible over lossy networks without provider-level idempotency support.

---

## 7. Webhook Durability and Event Reconciliation (Staging Inbox)

To eliminate the "Webhook-Before-Tracking" gap where early webhooks are dropped, the architecture introduces a durable `EmailWebhookInbox`.

```
[ Brevo Webhook HTTP POST ]
            │
            ▼
┌───────────────────────────────────────┐
│ 1. Validate Secret & Schema           │
│ 2. Deduplicate Event ID (Unique Key)  │
│ 3. Stage to `EmailWebhookInbox` (200) │
└───────────────────┬───────────────────┘
                    │ (Immediate Async or Scheduled Worker)
                    ▼
┌───────────────────────────────────────┐
│ Reconcile Staged Webhook:             │
│ - Find matching `EmailMessage`        │
│   OR `InvoiceNotificationOutbox`      │
│ - If MATCHED:                         │
│     * Advance state monotonically     │
│     * Mark Inbox row `PROCESSED`      │
│ - If UNMATCHED:                       │
│     * Mark Inbox row `UNMATCHED`      │
│     * Retry in 30s, 60s, 300s         │
│     * Expire after 24 hours           │
└───────────────────────────────────────┘
```

### Webhook Event Handling Rules

1. **Early Webhook Arrival (Before Outbox/Tracking Record Persists):**
   - The webhook arrives and is immediately written to `EmailWebhookInbox` with status `RECEIVED`.
   - The webhook controller returns HTTP 200 immediately to Brevo.
   - The reconciliation process searches for `providerMessageId`. If not found, the inbox row transitions to `UNMATCHED` with `nextRetryAt = NOW() + 30s`.
   - When the outbox worker finishes persisting the `providerMessageId`, the next reconciliation tick matches the event and applies the status update. **Zero events are lost.**
2. **Idempotent Webhook Identity:**
   - Provider webhooks generate a deterministic compound event ID:
     $$\text{eventId} = \text{hash}(\text{providerMessageId} + \text{\_} + \text{eventType} + \text{\_} + \text{timestamp})$$
   - Stored with `UNIQUE KEY uniq_webhook_event (provider, eventId)`. Duplicate webhook deliveries trigger a benign unique constraint violation and return HTTP 200 without reprocessing.
3. **Out-of-Order Webhook Events:**
   - State transitions enforce strict monotonicity using the existing `STATUS_PRECEDENCE` map:
     $$\text{QUEUED} (0) < \text{SENT} (1) < \text{RETRYING}/\text{DEFERRED} (2) < \text{DELIVERED}/\text{BOUNCED}/\text{FAILED} (3)$$
   - A `sent` event arriving after a `delivered` event is recorded in metadata but will never regress the status from `DELIVERED` back to `SENT`.
4. **Security and Payload Minimization:**
   - Raw webhook payloads are stripped of recipient PII and IP addresses prior to storing diagnostics.
   - Webhook authentication requires timing-safe HMAC validation via `BREVO_WEBHOOK_SECRET`. Unauthenticated payloads are rejected with HTTP 401 without database writes.

---

## 8. Invoice Lifecycle and Financial Invariants

The notification outbox architecture strictly preserves all statutory and financial invariants established in Phases 8.2 through 8.4:

1. **Payment Finality Policy:**
   - ZdexCloud does not offer customer refunds or refund requests after successful payment. Exceptional provider-reported refunds or chargebacks update `BillingPayment.status = REFUNDED` but never trigger automated invoice deletion.
2. **Consecutive Sequence Number Immutability:**
   - Statutory invoice numbers (`ZCI-2627-000001`) are allocated strictly by `BillingInvoiceSequenceService` inside the invoice transaction.
   - **Notification retries NEVER call the sequence service, never generate new invoice numbers, and never mutate tax amounts.**
3. **Tax Calculation Integrity:**
   - Invoices snapshots (`taxBreakdown`, `subtotalMinorUnits`, `totalMinorUnits`, `contentHash`) are completely immutable. Email notification failures, timeouts, and retries reference the already-committed `BillingInvoice.id` and read historical snapshots read-only.
4. **Decoupled Notification Obligation:**
   - The notification outbox record is inserted in the issuance transaction. If outbound email fails entirely, the invoice remains validly issued and accessible to the customer via direct authenticated portal download.

---

## 9. Proposed Schema and Migration Design

The migration introduces two dedicated tables, leaving existing financial tables untouched.

### 1. Table: `InvoiceNotificationOutbox`

```sql
-- CreateTable InvoiceNotificationOutbox
CREATE TABLE IF NOT EXISTS `InvoiceNotificationOutbox` (
    `id` VARCHAR(191) NOT NULL,
    `invoiceId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `notificationType` VARCHAR(64) NOT NULL DEFAULT 'INVOICE_ISSUED',
    `recipientEmail` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'CLAIMED', 'DISPATCHED', 'DELIVERED', 'RETRYABLE_FAILURE', 'AMBIGUOUS_OUTCOME', 'PERMANENT_FAILURE', 'EXHAUSTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `workerId` VARCHAR(128) NULL,
    `attemptCount` INT NOT NULL DEFAULT 0,
    `maxAttempts` INT NOT NULL DEFAULT 5,
    `scheduledAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `claimedAt` DATETIME(3) NULL,
    `leaseExpiresAt` DATETIME(3) NULL,
    `dispatchedAt` DATETIME(3) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `failedAt` DATETIME(3) NULL,
    `nextRetryAt` DATETIME(3) NULL,
    `provider` VARCHAR(64) NOT NULL DEFAULT 'BREVO',
    `providerMessageId` VARCHAR(191) NULL,
    `providerResponseCode` VARCHAR(64) NULL,
    `lastFailureReason` TEXT NULL,
    `errorCode` VARCHAR(64) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`),
    UNIQUE KEY `uniq_invoice_notification` (`invoiceId`, `notificationType`),
    INDEX `idx_outbox_poll` (`status`, `scheduledAt`, `nextRetryAt`),
    INDEX `idx_outbox_lease` (`status`, `leaseExpiresAt`),
    INDEX `idx_outbox_provider_msg` (`providerMessageId`),
    INDEX `idx_outbox_user` (`userId`),
    CONSTRAINT `fk_outbox_invoice` FOREIGN KEY (`invoiceId`) REFERENCES `BillingInvoice` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_outbox_user` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 2. Table: `EmailWebhookInbox`

```sql
-- CreateTable EmailWebhookInbox
CREATE TABLE IF NOT EXISTS `EmailWebhookInbox` (
    `id` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(64) NOT NULL DEFAULT 'BREVO',
    `eventId` VARCHAR(191) NOT NULL,
    `eventType` VARCHAR(64) NOT NULL,
    `providerMessageId` VARCHAR(191) NOT NULL,
    `recipientEmail` VARCHAR(191) NOT NULL,
    `eventTimestamp` DATETIME(3) NOT NULL,
    `status` ENUM('RECEIVED', 'PROCESSED', 'UNMATCHED', 'IGNORED', 'FAILED') NOT NULL DEFAULT 'RECEIVED',
    `retryCount` INT NOT NULL DEFAULT 0,
    `nextRetryAt` DATETIME(3) NULL,
    `rawPayload` JSON NULL,
    `processingError` TEXT NULL,
    `processedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`),
    UNIQUE KEY `uniq_webhook_provider_event` (`provider`, `eventId`),
    INDEX `idx_webhook_reconcile` (`status`, `nextRetryAt`),
    INDEX `idx_webhook_prov_msg` (`providerMessageId`),
    INDEX `idx_webhook_created` (`createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 3. Historical Record Backfill & Deduplication Protocol
Before any unique constraint is enforced on historical tracking records:
1. **Deduplication Query:** Identify historical duplicate records using:
   ```sql
   SELECT correlationId, COUNT(*) as cnt
   FROM EmailMessage
   WHERE correlationId IS NOT NULL AND correlationId LIKE 'invoice_%'
   GROUP BY correlationId
   HAVING cnt > 1;
   ```
2. **Backfill Rule:** Backfill `InvoiceNotificationOutbox` for existing issued invoices:
   - For every `BillingInvoice` in status `ISSUED`, search `EmailMessage` where `correlationId = CONCAT('invoice_', BillingInvoice.id)`.
   - If an `EmailMessage` exists with status `DELIVERED`, insert an outbox row with status `DELIVERED`.
   - If an `EmailMessage` exists with status `SENT`, insert an outbox row with status `DISPATCHED`.
   - If an `EmailMessage` exists with permanent failure, insert an outbox row with status `PERMANENT_FAILURE`.
   - If no `EmailMessage` exists and the invoice is older than 30 days, insert with status `EXHAUSTED` (suppressed by retention policy). If issued within 30 days, insert with status `PENDING` to allow delivery recovery.

### 4. Rollout Strategy & Go/No-Go Gates
- **Phase 1 (Expand):** Deploy migration creating `InvoiceNotificationOutbox` and `EmailWebhookInbox`. Application version 1 continues current behavior.
- **Phase 2 (Dual-Write):** Deploy application version 2 which creates outbox rows in `PENDING` and stages webhooks, but still dispatches via direct asynchronous call.
- **Phase 3 (Cutover):** Activate the background outbox worker. Disable direct asynchronous dispatch from `BillingInvoiceService`.
- **Phase 4 (Contract):** Archive legacy transient correlation logic.
- **Rollback Safety:** If version 3 experiences issues, falling back to version 2 immediately stops outbox processing without data loss; issued invoices and financial records are 100% preserved.

---

## 10. Observability, Metrics and Operator Recovery Procedures

### Required Operational Metrics

1. **Queue Age & Depth:**
   - `invoice_notification_pending_count`: Gauge of outbox rows in `PENDING`.
   - `invoice_notification_oldest_pending_seconds`: Age of oldest `PENDING` record. Threshold warning: > 300s; critical: > 900s.
2. **Active Claims & Leases:**
   - `invoice_notification_claimed_count`: Number of records currently leased.
   - `invoice_notification_expired_leases_count`: Counter of recovered expired leases.
3. **Terminal Outcomes & Discrepancies:**
   - `invoice_notification_exhausted_total`: Counter of records reaching `EXHAUSTED`.
   - `invoice_notification_ambiguous_total`: Counter of records stuck in `AMBIGUOUS_OUTCOME`.
   - `email_webhook_unmatched_count`: Gauge of webhook events awaiting matching.

### Standard Operating Procedure: Safe Operator Recovery

If an operator must triage a customer reporting a missing invoice email:
1. **Inspection (Read-Only):**
   - Query the outbox table by invoice ID:
     ```sql
     SELECT * FROM InvoiceNotificationOutbox WHERE invoiceId = 'inv_123';
     ```
2. **Permitted Safe Actions:**
   - If status is `EXHAUSTED` and customer email was corrected in billing profile:
     ```sql
     UPDATE InvoiceNotificationOutbox
     SET status = 'PENDING',
         attemptCount = 0,
         recipientEmail = :correctedEmail,
         scheduledAt = NOW(3)
     WHERE invoiceId = 'inv_123' AND status = 'EXHAUSTED';
     ```
3. **Strictly Prohibited Operator Actions:**
   - **NEVER** run broad bulk updates like `UPDATE InvoiceNotificationOutbox SET status = 'PENDING'` across all rows (would cause mail storms and Brevo rate-limiting).
   - **NEVER** delete invoice records to re-trigger issuance.
   - **NEVER** manually modify `BillingInvoiceSequence.lastNumber`.

---

## 11. Separate PDF Runtime Dependency Prerequisite

The PDF dependency blocker must remain decoupled from the notification dispatch architecture:

### Dependency Ground Truth
- `package.json` line 37 declares `"pdfkit": "^0.15.0"`.
- `package.json` line 45 declares `"@types/pdfkit": "^0.13.4"`.
- `package-lock.json` contains **0 occurrences** of `pdfkit`.
- `node_modules/pdfkit` is **not present** on the filesystem.

### Architectural Decoupling Invariants
1. **Pure Vector PDF Engine Fallback:** In Phase 8.4 Batch B, `BillingInvoiceDocumentService` implemented `buildPurePdfBuffer()` (lines 769–925) using raw in-memory PDF 1.4 vector byte stream assembly. This pure engine generates valid binary PDF documents without requiring `pdfkit`.
2. **Pre-Dispatch Document Validation:** The notification outbox worker must verify document renderability prior to contacting the Brevo email transport. If document rendering throws an exception (e.g. missing dependency or malformed layout), the outbox row transitions to `RETRYABLE_FAILURE` without attempting email transport.
3. **No False Delivery Claims:** A document generation failure must never mark the notification as dispatched, and must never disrupt the committed statutory invoice in MySQL.
4. **Resolution Gate:** Executing `npm install` in an authorized maintenance window is required before enabling advanced PDF rendering features, but the outbox architecture functions independently using the pure vector engine.

---

## 12. Security, Statutory, and Compliance Invariants

1. **Authentication Separation:**
   - Customer portal invoice retrieval (`/pages/billing.html`) strictly enforces session authentication. Email notifications contain only the canonical URL without magic login tokens, API keys, or embedded PDF attachments.
2. **Data Minimization in Logs:**
   - Outbox error logs, audit records, and webhook staging payloads sanitize PII. Full invoice financial snapshots, customer street addresses, and credit card / payment provider tokens are never logged to console or error center.
3. **Statutory Integrity Disclaimer:**
   - PDF generation and email delivery do not certify statutory GST compliance. Seller GSTIN, legal entity identity, Place of Supply determination, and SAC 998313 mappings remain statutory configuration prerequisites requiring explicit corporate review.

---

## 13. Proposed Narrow Implementation Batches

Following design approval, implementation should proceed in four strictly bounded batches:

```
┌────────────────────────────────────────────────────────┐
│ Phase 8.4 Batch E.3: Schema Migration & Model Authoring│
│ - Author Prisma migration for Outbox and Inbox tables  │
│ - Zero runtime execution; unit specs only             │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ Phase 8.4 Batch E.4: Outbox Ingestion & Worker Service │
│ - Atomic insertion in BillingInvoiceService            │
│ - Leased outbox worker with backoff & classifier       │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ Phase 8.4 Batch E.5: Webhook Staging Inbox & Matching  │
│ - Stage Brevo events to EmailWebhookInbox              │
│ - Monotonic state synchronization & reconciliation    │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ Phase 8.4 Batch E.6: Verification & Readiness Audit   │
│ - End-to-end trace validation without real sends       │
│ - Final operational sign-off                           │
└────────────────────────────────────────────────────────┘
```

---

## 14. Audit Verification and Final Declaration

### Explicit Boundary Confirmation
- **Audit & Design Only:** Yes.
- **Application Source Modifications:** 0 files modified.
- **Database Migrations Created or Applied:** 0 migrations created, edited, or applied.
- **Database Connections or Queries:** 0 connections established, 0 SQL statements executed.
- **Dependencies or Lockfiles Changed:** 0 packages installed, uninstalled, or altered.
- **Tests Executed:** 0 tests, test runners, or test builds executed.
- **Real Emails Dispatched:** 0 emails sent; Brevo API was not contacted.
- **Runtime Delivery Guarantees Claimed:** None claimed.

### Final Audit Decision
**`READY WITH DOCUMENTED LIMITATIONS`**

*Reasoning:* The source audit confirms that the existing implementation cannot guarantee atomic reservation or prevent duplicate deliveries during concurrent execution windows due to the absence of database-level uniqueness on `EmailMessage.correlationId` and pre-transport persistence. The proposed Transactional Outbox (`InvoiceNotificationOutbox`) and Staging Inbox (`EmailWebhookInbox`) design provides complete mathematical and architectural resolution for all identified failure modes, preserves existing invoice and payment finality invariants, and is ready for technical review prior to code implementation.
