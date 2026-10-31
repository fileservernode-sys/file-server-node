# ZdexCloud Phase 8.4 Batch E.3: Invoice Notification Outbox & Webhook Inbox Schema Authoring Report

**Repository Root:** `D:\YOUM PATEL\Desktop\Projects\File Server Project\`  
**Target Subsystem:** `main website/Backend/`  
**Canonical Domain:** `https://zdexcloud.com`  
**Execution Mode:** Schema Authoring Only, Strictly Non-Executing  
**Date of Completion:** October 10, 2026  
**Final Status Verdict:** **`SCHEMA AUTHORING COMPLETE WITH DOCUMENTED LIMITATIONS`**

---

## 1. Executive Summary & Verdict

In strict accordance with Phase 8.4 Batch E.3 requirements, the database schema foundation for the ZdexCloud transactional invoice notification outbox and provider email webhook staging inbox has been authored in the backend codebase.

All changes are strictly additive and non-destructive:
- `prisma/schema.prisma` has been updated with two new enums (`InvoiceNotificationOutboxStatus`, `EmailWebhookInboxStatus`), two new models (`InvoiceNotificationOutbox`, `EmailWebhookInbox`), and reciprocal inverse relations on `User` and `BillingInvoice`.
- Exactly one new standard MySQL migration has been authored: `prisma/migrations/20261010160000_add_invoice_notification_outbox_and_webhook_inbox/migration.sql`.
- A dedicated static test specification file has been authored: `tests/invoice_notification_outbox_schema.test.ts`.
- **Zero test runners, zero compilers, zero builds, zero database connections, zero Prisma client generation commands, and zero external network calls were executed.**

**Verdict:** **`SCHEMA AUTHORING COMPLETE WITH DOCUMENTED LIMITATIONS`**

---

## 2. Files Created and Modified

| File Path | Type | Nature of Change |
| :--- | :--- | :--- |
| [`main website/Backend/prisma/schema.prisma`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/prisma/schema.prisma) | Modified | Added `InvoiceNotificationOutboxStatus`, `EmailWebhookInboxStatus`, `InvoiceNotificationOutbox`, `EmailWebhookInbox`, and inverse relation fields on `User` and `BillingInvoice`. |
| [`main website/Backend/prisma/migrations/20261010160000_add_invoice_notification_outbox_and_webhook_inbox/migration.sql`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/prisma/migrations/20261010160000_add_invoice_notification_outbox_and_webhook_inbox/migration.sql) | Created | New standalone SQL migration file defining DDL for both tables, indexes, unique constraints, and foreign key rules. |
| [`main website/Backend/tests/invoice_notification_outbox_schema.test.ts`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/tests/invoice_notification_outbox_schema.test.ts) | Created | Static test specifications validating model representations, relation constraints, BigInt representations, and documented limitations. |

---

## 3. Authored Prisma Models and Enums

### 3.1 Enums Authored

1. **`InvoiceNotificationOutboxStatus`**:
   - `PENDING`: Outbox row created, awaiting background worker claim.
   - `SHADOW_PENDING`: Created during dual-write legacy dispatch mode (legacy direct send owns execution).
   - `CLAIMED`: Worker acquired active lease with fencing lock.
   - `DISPATCHED`: Email transport completed and acknowledged by provider (HTTP 200/201).
   - `DELIVERED`: Terminal delivery confirmed by matching provider webhook.
   - `RETRYABLE_FAILURE`: Transient network or rendering error; scheduled for automated retry.
   - `AMBIGUOUS_OUTCOME`: Uncertain transport state (e.g. timeout during HTTP request); quarantined from automated retries.
   - `PERMANENT_FAILURE`: Hard bounce, invalid recipient, or unrecoverable error.
   - `EXHAUSTED`: Maximum retry attempts (3) exceeded without success.
   - `HISTORICAL_UNTRACKED`: Pre-existing historical invoice backfilled with automated dispatch suppressed.
2. **`EmailWebhookInboxStatus`**:
   - `RECEIVED`: Staged raw payload received and authenticated; awaiting asynchronous reconciliation.
   - `PROCESSING`: Worker leased inbox row for correlation.
   - `PROCESSED`: Successfully matched and reconciled against outbox/email tracking record.
   - `DUPLICATE`: Replay delivery recognized via composite fingerprint.
   - `UNMATCHED`: Webhook does not match any known local message or invoice.
   - `UNMATCHED_NO_IDENTIFIER`: Webhook lacks `message-id` or required routing identifier.
   - `FAILED`: Internal error encountered during webhook processing.

---

### 3.2 Models Authored

```prisma
model InvoiceNotificationOutbox {
  id                       String                          @id @default(cuid())
  invoiceId                String
  userId                   String?
  notificationType         String                          @default("INVOICE_ISSUED")

  // Immutable dispatch intent snapshot
  recipientEmail           String
  recipientName            String?
  documentTitle            String                          @default("Tax Invoice")
  invoiceNumber            String
  currency                 CurrencyCode
  totalMinorUnits          Int

  // Execution lifecycle state
  status                   InvoiceNotificationOutboxStatus @default(PENDING)
  attemptCount             Int                             @default(0)
  maxAttempts              Int                             @default(3)
  lastAttemptAt            DateTime?
  nextAttemptAt            DateTime?

  // Concurrency fencing & distributed worker lease
  claimedBy                String?
  claimedAt                DateTime?
  claimExpiresAt           DateTime?
  claimVersion             BigInt                          @default(0)

  // Durable Transport-Boundary Evidence Marker
  transportStartedAt       DateTime?

  // Dispatch & provider reconciliation evidence
  provider                 String                          @default("BREVO")
  providerMessageId        String?
  emailMessageId           String?
  dispatchedAt             DateTime?
  deliveredAt              DateTime?
  failedAt                 DateTime?

  // Failure diagnostics & quarantine details
  failureCode              String?
  failureReason            String?                         @db.Text
  ambiguousAt              DateTime?
  ambiguousReason          String?                         @db.Text

  // Operator governance & resend audit
  resendAuthorized         Boolean                         @default(false)
  resendAuthorizedBy       String?
  resendAuthorizedAt       DateTime?
  resendAuthorizationCount  Int                             @default(0)
  resendReason             String?                         @db.Text

  metadata                 Json?
  createdAt                DateTime                        @default(now())
  updatedAt                DateTime                        @updatedAt

  invoice                  BillingInvoice                  @relation(fields: [invoiceId], references: [id], onDelete: Restrict)
  user                     User?                           @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@unique([invoiceId, notificationType], map: "invoice_notification_outbox_inv_type_uniq")
  @@index([status, nextAttemptAt, createdAt], map: "invoice_notification_outbox_poll_idx")
  @@index([status, claimExpiresAt], map: "invoice_notification_outbox_lease_idx")
  @@index([providerMessageId], map: "invoice_notification_outbox_provider_msg_idx")
  @@index([userId, createdAt], map: "invoice_notification_outbox_user_idx")
  @@index([invoiceNumber], map: "invoice_notification_outbox_num_idx")
}

model EmailWebhookInbox {
  id                      String                  @id @default(cuid())
  provider                String                  @default("BREVO")
  eventId                 String
  eventType               String
  providerMessageId       String?
  recipientEmail          String?
  eventTimestamp          DateTime
  status                  EmailWebhookInboxStatus @default(RECEIVED)

  matchedEmailMessageId   String?
  matchedOutboxId         String?
  reconciledAt            DateTime?
  processingAttempts      Int                     @default(0)
  lastError               String?                 @db.Text

  rawPayload              Json
  createdAt               DateTime                @default(now())
  updatedAt               DateTime                @updatedAt

  @@unique([provider, eventId], map: "email_webhook_inbox_provider_event_uniq")
  @@index([providerMessageId, eventType], map: "email_webhook_inbox_prov_msg_idx")
  @@index([status, createdAt], map: "email_webhook_inbox_status_poll_idx")
}
```

---

## 4. Relations, Constraints, and Deletion Semantics

1. **`BillingInvoice` Relation (`onDelete: Restrict`):**
   - **Reasoning:** In compliance with statutory accounting rules, an issued statutory tax invoice must never be deleted if notification dispatch records exist.
   - **Inverse Relation:** Added `notifications InvoiceNotificationOutbox[]` to `BillingInvoice`.
2. **`User` Relation (`onDelete: SetNull`):**
   - **Reasoning:** Under privacy laws (GDPR/DPDP), user accounts may be erased/anonymized. Notification audit records must be preserved for statutory tax proof, with `userId` transitioning to `NULL`.
   - **Inverse Relation:** Added `invoiceNotifications InvoiceNotificationOutbox[]` to `User`.
3. **Notification-Intent Uniqueness (`@@unique([invoiceId, notificationType])`):**
   - Enforces exactly one active notification pipeline lifecycle per invoice per purpose (`INVOICE_ISSUED`, `INVOICE_RESEND_CORRECTED`).
4. **Monotonic Fencing Counter (`claimVersion` as `BigInt`):**
   - Stored as `BIGINT` in MySQL (`BigInt` in Prisma), guaranteeing mathematical safety against 32-bit integer overflow under high-frequency polling.
5. **Worker Polling and Index Alignment:**
   - Worker polling: `@@index([status, nextAttemptAt, createdAt])`.
   - Lease expiry sweeper: `@@index([status, claimExpiresAt])`.
   - Webhook message-id lookup: `@@index([providerMessageId])` and `@@index([providerMessageId, eventType])`.

---

## 5. Durable Transport-Boundary Evidence Marker (`transportStartedAt`)

### 5.1 Field Definition
- Added `transportStartedAt DateTime?` (`DATETIME(3) NULL` in MySQL DDL).
- Default: `NULL`.

### 5.2 Future Runtime Contract & Safety Rules
The future outbox worker implementation must adhere to the following contract:
1. **Pre-Transport Commitment:** The worker MUST durably persist `transportStartedAt = NOW(3)` in the database **prior** to opening a network socket or invoking the Brevo API / SMTP client.
2. **Safe Pre-Transport Sweeper Recovery:**
   - If a worker lease expires (`claimExpiresAt < NOW()`) and `transportStartedAt IS NULL`, the system has positive proof that external provider I/O was never initiated (e.g., worker crashed during pure vector PDF buffer generation or claim acquisition).
   - In this state, the supervisory sweeper is permitted to reset the record to `PENDING` for safe automatic retry.
3. **Mandatory Ambiguous Outcome Quarantine:**
   - If a worker lease expires and `transportStartedAt IS NOT NULL`, the system cannot prove that Brevo did not receive the packet.
   - The supervisory sweeper MUST transition the record to `AMBIGUOUS_OUTCOME`. Automated retries are permanently forbidden until matching webhook evidence arrives or an operator signs an administrative resolution.
4. **Batch E.3 Limitation:**
   - *This safety behavior is a schema foundation only in Batch E.3.* Application services and worker daemons have not been modified to set this field in this batch.

---

## 6. Documented Attempt-History Limitation

- **Scope:** The `InvoiceNotificationOutbox` model records aggregate attempt counters (`attemptCount`, `maxAttempts`) and the most recent failure diagnostics (`lastAttemptAt`, `failureCode`, `failureReason`).
- **Limitation:** The model does **NOT** constitute a complete per-attempt historical ledger. It tracks the latest operational attempt state only.
- **Future Design Decision:** If granular per-attempt tracking is required (matching `EmailDeliveryAttempt` on `EmailMessage`), a dedicated child model (`InvoiceNotificationOutboxAttempt`) must be formally designed and evaluated in a separate schema batch.

---

## 7. Webhook Fingerprint Limitations & Ingestion Rules

- **Composite Fingerprint:** $\text{SHA256}(\text{cleanMessageId} + \text{":"} + \text{event} + \text{":"} + \text{normalizedTimestampSeconds})$.
- **Scope & Limitations:**
  - This value is a **deterministic deduplication fingerprint**, NOT a provider-guaranteed globally unique event GUID.
  - The future ingestion worker must handle:
    1. Webhooks omitting `message-id` (staged as `UNMATCHED_NO_IDENTIFIER`).
    2. Missing or imprecise timestamps.
    3. Replayed webhook packets from Brevo (recognized by `ON DUPLICATE KEY UPDATE`).
    4. Out-of-order webhook delivery (governed by state monotonicity `STATUS_PRECEDENCE`).

---

## 8. Migration Design & Compatibility

### 8.1 Migration Specifications
- **Directory:** `prisma/migrations/20261010160000_add_invoice_notification_outbox_and_webhook_inbox/`
- **File:** `migration.sql`
- **Compatibility:** MySQL 8.0 / MariaDB compliant DDL with standard `VARCHAR(191)`, `DATETIME(3)`, `BIGINT`, `JSON`, and `ENUM` definitions.
- **Foreign Keys:**
  - `CONSTRAINT InvoiceNotificationOutbox_invoiceId_fkey FOREIGN KEY (invoiceId) REFERENCES BillingInvoice(id) ON DELETE RESTRICT ON UPDATE CASCADE`
  - `CONSTRAINT InvoiceNotificationOutbox_userId_fkey FOREIGN KEY (userId) REFERENCES User(id) ON DELETE SET NULL ON UPDATE CASCADE`
- **Safety:** Strictly additive. Zero tables or columns dropped. Zero modifications to existing tables.

### 8.2 Schema Drift Detection Protocol
In accordance with repository change control rules:
- This migration has **not** been applied to any database in this batch.
- During a future authorized migration review, schema drift will be evaluated by running standard Prisma migrate verification in an isolated staging environment against a shadow database, ensuring zero diff against `schema.prisma`.

---

## 9. Static Test Specifications Authored

Authored test file: [`tests/invoice_notification_outbox_schema.test.ts`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/tests/invoice_notification_outbox_schema.test.ts)

Contains 9 static specification tests:
1. `SPEC 1`: Required models and enum members are represented in Prisma schema.
2. `SPEC 2`: Invoice and User relations enforce intended deletion semantics (`RESTRICT` and `SET NULL`).
3. `SPEC 3`: Unique notification-intent constraint is present on outbox.
4. `SPEC 4`: Webhook provider/event deduplication constraint and required indexes are present.
5. `SPEC 5`: `claimVersion` uses a database-compatible monotonic integer representation (`BigInt`).
6. `SPEC 6`: Transport-boundary field (`transportStartedAt`) exists and documents its runtime contract.
7. `SPEC 7`: Design explicitly rejects webhook fingerprint as a globally unique provider event ID.
8. `SPEC 8`: Design explicitly documents attempt-history limitation (aggregate-only counters).
9. `SPEC 9`: Migration SQL file is non-destructive, additive, and uses compatible MySQL DDL.

*(Per mandatory instructions, this test file was NOT executed.)*

---

## 10. Explicit Execution Restriction Confirmation

In strict compliance with all operational constraints:
- **Test suites / runners executed:** Exactly 0.
- **TypeScript compilation or builds executed:** Exactly 0.
- **Prisma generation (`prisma generate`) run:** Exactly 0.
- **Prisma migration commands run:** Exactly 0 (`prisma migrate dev/deploy` prohibited).
- **Database connections opened:** Exactly 0.
- **SQL executed against any database:** Exactly 0.
- **External network calls made:** Exactly 0; Brevo API was not called.
- **Emails sent:** Exactly 0.
- **Application service files, routes, or workers edited:** Exactly 0.

---

## 11. Deviations from Batch E.2.2 Specification

- **Deviation:** Added `transportStartedAt DateTime?` to `InvoiceNotificationOutbox`.
- **Justification & Evidence:** Required by Batch E.3 Prompt Section 3.2 to provide durable transport-boundary evidence distinguishing safe pre-transport retries from uncertain transport states.
- **Deviation:** Added reciprocal inverse relation fields `invoiceNotifications InvoiceNotificationOutbox[]` on `User` and `notifications InvoiceNotificationOutbox[]` on `BillingInvoice`.
- **Justification & Evidence:** Required by Prisma schema compiler rules for relation fields.

---

## 12. Remaining Prerequisites Before Future Implementation Batches

1. **Batch E.4 (Outbox Ingestion & Worker Implementation):**
   - Wire transactional creation of `InvoiceNotificationOutbox` inside `BillingInvoiceService.issueInvoiceForPayment()`.
   - Implement the `InvoiceNotificationOutboxWorker` background daemon with monotonic fencing, lease expiration sweeping, and pre-transport setting of `transportStartedAt`.
   - Implement configuration flag `INVOICE_NOTIFICATION_DISPATCH_MODE` (`LEGACY_DIRECT`, `DUAL_WRITE_LEGACY_DISPATCH`, `OUTBOX_WORKER`).
2. **Batch E.5 (Webhook Ingestion & Asynchronous Reconciliation):**
   - Update `/api/v1/webhooks/email/brevo` route to persist raw events immediately to `EmailWebhookInbox`.
   - Implement background reconciliation worker correlating inbox rows to outbox/tracking records.
3. **Database Migration Execution Gate:**
   - An authorized operations pipeline must execute `npx prisma migrate deploy` in staging and production when deployment is scheduled.

---

**BATCH COMPLETE: Awaiting operator review of Batch E.3 before proceeding to Batch E.4.**
