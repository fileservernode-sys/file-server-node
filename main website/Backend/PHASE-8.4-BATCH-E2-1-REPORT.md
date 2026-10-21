# ZDEXCLOUD PHASE 8.4 BATCH E.2.1: OUTBOX DESIGN HARDENING, ROLLOUT SAFETY AND WEBHOOK CONTRACT VERIFICATION AUDIT

- **Audited Repository Root:** `D:\YOUM PATEL\Desktop\Projects\File Server Project\`
- **Target Component:** `main website/Backend/`
- **Canonical Website:** `https://zdexcloud.com`
- **Execution Date:** 2026-10-10
- **Mode:** Strict Read-Only Design Correction & Architectural Verification (Zero code modifications, zero database execution, zero dependency mutations, zero tests executed, zero external network dispatches)

---

## 1. Executive Summary & Audit Decision

Phase 8.4 Batch E.2 established the architectural rationale for introducing a Transactional Outbox (`InvoiceNotificationOutbox`) and a Staging Inbox (`EmailWebhookInbox`). However, subsequent critical review of the E.2 specification revealed several operational and conceptual vulnerabilities that required hardening before implementation could be approved:
1. **Unsafe Blind Retry on Ambiguous Timeouts:** The E.2 report proposed an automated 15-minute timer after an ambiguous network timeout (`ETIMEDOUT`), after which the worker would automatically retry sending the email. In external email networks, the absence of an incoming webhook does **not** prove non-delivery. Blind automated retries after timeouts guarantee duplicate customer emails whenever webhook traffic is delayed or unconfigured.
2. **Dual-Dispatch Rollout Danger:** The E.2 rollout plan suggested a "dual-write" intermediate stage where both outbox rows and legacy direct dispatches were initiated, creating an acute risk of concurrent workers or overlapping deployments issuing double notifications for the same invoice.
3. **Overly Aggressive Foreign Key Cascades:** E.2 proposed `ON DELETE CASCADE` from `BillingInvoice` and `User` to `InvoiceNotificationOutbox`. If a user account or an unlinked record were deleted, statutory tax notification audit trails would be silently wiped out, violating statutory record-keeping invariants.
4. **Under-Specified Fencing & Worker Recovery:** While E.2 introduced basic leased claims, it lacked monotonically increasing fencing tokens to prevent a slow worker—resuming after a garbage collection pause or network delay—from overwriting a lease already reclaimed by another worker.
5. **Historical Backfill Ambiguity:** E.2 proposed that historical invoices without email tracking rows older than 30 days be marked `EXHAUSTED`, while newer ones be marked `PENDING` for automated dispatch. This risked sending unexpected emails for older transactions whose emails had already been delivered before tracking was implemented.

### Architectural Decision
This Batch E.2.1 specification provides a corrected, hardened, single-owner-safe architecture:
- Replaces the unsafe 15-minute blind retry with a **Stateful Ambiguous Outcome Quarantine** requiring explicit webhook matching or operator-audited reconciliation.
- Mandates a **Strict Single-Dispatch-Owner Rollout** with a feature flag gate that guarantees zero overlapping dispatches during deployment.
- Replaces destructive foreign key cascades with **`ON DELETE RESTRICT`** on invoices and soft-retention/anonymization rules.
- Adds **Monotonic Fencing Tokens (`claimVersion`)** to the worker lease model.
- Establishes a **Conservative Historical Quarantine** (`HISTORICAL_UNTRACKED`) for pre-existing invoices.

**Final Audit Verdict:**
```
READY FOR IMPLEMENTATION DESIGN REVIEW
```

---

## 2. Source-Grounded Corrections to E.2

A rigorous re-inspection of the current source checkout identified specific design oversights in the E.2 proposal that are corrected in this specification:

| E.2 Proposal Item | Verified Source Ground Truth | Architectural Vulnerability in E.2 | Corrected Specification in E.2.1 |
| :--- | :--- | :--- | :--- |
| **Ambiguous Timeout Handling** | Brevo REST API lacks transaction idempotency headers. Timeouts (`ETIMEDOUT`) leave remote dispatch state unknown. | E.2 proposed waiting 15 minutes, then automatically retrying dispatch. If Brevo accepted the mail, a duplicate is guaranteed. | **Eliminated blind retry.** Ambiguous outcomes enter `AMBIGUOUS_OUTCOME`. Worker reconciles only against verified provider evidence. Unresolved cases require operator triage with mandatory audit logging. |
| **Deployment & Rollout Sequence** | `BillingInvoiceService` currently calls `BillingInvoiceNotificationService.sendInvoiceIssuedNotification` asynchronously post-commit. | E.2 described a "dual-write" stage where outbox rows are written while legacy direct dispatches still run. In a multi-instance or rolling rollout, both paths could fire. | **Strict Single-Owner Cutover.** Feature flag `INVOICE_NOTIFICATION_DISPATCH_MODE` with mutual exclusion (`LEGACY_DIRECT` vs `OUTBOX_WORKER`). Exactly one dispatcher is active at any time. |
| **Worker Lease & Fencing** | Node.js asynchronous event loops can stall on heavy CPU tasks, GC pauses, or slow HTTP requests. | E.2 relied only on `workerId` and `leaseExpiresAt`. If Worker A's lease expires while waiting on HTTP response, Worker B claims it. When Worker A finishes, it could overwrite Worker B's state. | **Monotonic Claim Token (`claimVersion`).** Database updates require `WHERE id = :id AND claimVersion = :currentClaimVersion`. Stale workers receive 0 affected rows and fail safely. |
| **Foreign Key & Deletion Policies** | Statutory invoices are permanent. `BillingInvoice` uses `ON DELETE RESTRICT` to `User` and `BillingPayment`. | E.2 proposed `ON DELETE CASCADE` from `BillingInvoice` and `User` to `InvoiceNotificationOutbox`, risking silent loss of notification audit history. | **Statutory Retention Invariant.** `InvoiceNotificationOutbox` uses `ON DELETE RESTRICT` from `BillingInvoice`. User relationships use `ON DELETE SET NULL` with retained snapshot email. |
| **Historical Invoices Backfill** | Many historical invoices in the database exist without corresponding `EmailMessage` records from prior development phases. | E.2 proposed marking invoices < 30 days old as `PENDING` to "allow delivery recovery". This would trigger spammy email bursts to customers for past purchases. | **Conservative Quarantine.** Existing uninvoiced historical records transition to `HISTORICAL_UNTRACKED`. Automated send is permanently suppressed; manual resend requires explicit admin action. |

---

## 3. Verified Facts vs. Unverified Provider Assumptions

To maintain engineering integrity, we explicitly distinguish facts verified directly from codebase source code and official Brevo documentation from unverified assumptions:

### Verified Facts
1. **No Client-Side Idempotency Keys:** Brevo's transactional email API (`POST https://api.brevo.com/v3/smtp/email`) accepts JSON bodies containing `sender`, `to`, `subject`, `htmlContent`, `textContent`, and optional `tags`/`headers`. It does **not** accept an `Idempotency-Key` or `X-Idempotency-Key` HTTP header. Every successful HTTP POST generates a new unique Brevo message ID.
2. **Provider Message ID Format:** In HTTP 200/201 responses, Brevo returns `{"messageId": "<xxxxxxxx.xxxxxxx@smtp-relay.mailin.fr>"}`. In webhook payloads, this same identifier is sent in the `message-id` field (with or without surrounding angle brackets `< >`).
3. **Webhook Authentication:** Brevo does **not** generate HMAC cryptographic signatures (e.g., `X-Hub-Signature`). Instead, Brevo secures webhooks via:
   - Shared secret in custom headers (`X-Brevo-Webhook-Secret` or `X-Webhook-Secret`).
   - Bearer token in the `Authorization: Bearer <token>` header.
   - Basic HTTP authentication (`https://user:pass@domain.com/webhook`).
4. **Local Webhook Route Behavior:** In `src/routes/email-webhooks.ts` (L35–55), the ZdexCloud backend checks `x-brevo-webhook-secret`, `x-webhook-secret`, `x-secret-token`, and `authorization: Bearer <token>`, executing timing-safe verification via `crypto.timingSafeEqual`.
5. **No Built-in Transactional Outbox:** Current ZdexCloud transactional email sending in `src/services/email.ts` (L268–291) executes network transport directly before calling `emailTrackingService.recordTransactionalEmail()`.

### Unverified Assumptions (Requiring Operational Verification Prior to Production)
1. **Webhook Delivery Guarantees:** While Brevo retries failed webhook deliveries (HTTP 5xx or connection drops) with exponential backoff for up to 24 hours, the exact retry intervals and backoff ceiling are proprietary to Brevo and may vary.
2. **Webhook Event Ordering:** Brevo webhooks are delivered asynchronously per event. A `delivered` event may occasionally arrive before a delayed `sent` event due to internal queuing across distributed edge regions.
3. **Account-Level Webhook Filtering:** Whether the configured Brevo webhook URL receives events for *all* platform emails (OTPs, notifications, and billing) or can be isolated per tag depends on account-level settings in the Brevo dashboard.

---

## 4. Hardened Worker Lifecycle & Lease Fencing Model

### Monotonic Fencing Token Pattern
To prevent distributed race conditions when requests exceed lease durations or workers stall, every outbox row includes an integer `claimVersion`.

```sql
ALTER TABLE `InvoiceNotificationOutbox`
  ADD COLUMN `claimVersion` INT NOT NULL DEFAULT 0,
  ADD COLUMN `workerId` VARCHAR(128) NULL,
  ADD COLUMN `leaseExpiresAt` DATETIME(3) NULL;
```

### Complete Worker Lifecycle

```
[ Worker Poll Tick ]
        │
        ▼
1. Acquire Lease via Atomic Conditional Update:
   UPDATE InvoiceNotificationOutbox
   SET status = 'CLAIMED',
       workerId = :workerId,
       claimVersion = claimVersion + 1,
       claimedAt = NOW(3),
       leaseExpiresAt = DATE_ADD(NOW(3), INTERVAL 5 MINUTE),
       attemptCount = attemptCount + 1
   WHERE (status = 'PENDING' AND scheduledAt <= NOW(3))
      OR (status = 'CLAIMED' AND leaseExpiresAt < NOW(3))
      OR (status = 'RETRYABLE_FAILURE' AND nextRetryAt <= NOW(3))
   LIMIT :batchSize;
        │
        ├─────────────────────────────────────────┐
        ▼ (Lease Acquired: Token = N)             ▼ (Zero rows affected)
2. Render PDF & Verify Pre-Dispatch              [ Sleep until next tick ]
   - Verify `BillingInvoice` is ISSUED.
   - Generate PDF via `BillingInvoiceDocumentService`.
   - If rendering fails:
     UPDATE ... SET status = 'RETRYABLE_FAILURE',
                    lastFailureReason = :renderErr
     WHERE id = :id AND claimVersion = N;
        │
        ▼ (PDF Render Valid)
3. Execute Brevo Transport:
   - Call `emailService.sendRawMail(...)`.
        │
        ├──────────────────────────────────────────────────────────┐
        ▼ (HTTP 200 with MessageId)                                ▼ (Network Timeout: ETIMEDOUT)
4. Persist Terminal Success:                             5. Transition to Ambiguous Quarantine:
   UPDATE InvoiceNotificationOutbox                         UPDATE InvoiceNotificationOutbox
   SET status = 'DISPATCHED',                               SET status = 'AMBIGUOUS_OUTCOME',
       providerMessageId = :providerMessageId,                  lastFailureReason = :timeoutErr,
       dispatchedAt = NOW(3),                                   leaseExpiresAt = NULL
       leaseExpiresAt = NULL                                WHERE id = :id AND claimVersion = N;
   WHERE id = :id AND claimVersion = N;                     (Auto-retry is BLOCKED)
```

### Addressing Distributed Boundary Realities
- **The Limit of Database Fencing:** Fencing tokens protect database integrity by ensuring a late worker cannot overwrite the database if its lease expired. However, **database fencing cannot undo a network packet already received by Brevo**. If Worker A's HTTP request reaches Brevo, but Worker A stalls before updating MySQL, Worker B's lease acquisition might attempt a duplicate send.
- **Worker Mitigation:** Before Worker B initiates external network dispatch on an expired lease, it executes a fast check against `EmailWebhookInbox` and `EmailMessage` to verify if a webhook or tracking record already appeared for this invoice during the lease interval.

---

## 5. Revised Ambiguous-Outcome Policy & Proof of Delivery

The E.2 rule of automatically retrying after 15 minutes is **unsafe and eliminated**. In its place, ZdexCloud enforces an evidence-based quarantine policy:

### Evidence Hierarchy for Provider Reconciliation
A notification in `AMBIGUOUS_OUTCOME` may only transition based on concrete evidence:

1. **Proof of Provider Acceptance (Transition to `DISPATCHED`):**
   - An incoming Brevo webhook event (`request`, `sent`, `delivered`, `opened`, `soft_bounce`) matches the recipient email, template, and timestamp window ($\pm 10$ minutes) of the ambiguous dispatch.
   - An explicit administrative sync query to Brevo's transactional API (`GET /smtp/emails?email=...&startDate=...`) returns a record matching the subject and dispatch time.
2. **Proof of Non-Acceptance (Transition to `PENDING`):**
   - The transport layer returned an immediate TCP rejection (`ECONNREFUSED`, `ENOTFOUND`, `DNS_RESOLUTION_FAILED`) where the HTTP connection was never established.
3. **Absence of Evidence (Quarantine):**
   - An unresolved timeout where no webhook arrives and no API record is returned remains in `AMBIGUOUS_OUTCOME`.
   - **Automated retries are permanently forbidden for ambiguous outcomes.**
   - After a minimum quarantine period of **2 hours** (allowing for upstream Brevo webhook delivery lag), the record is flagged for operator triage.

### Operator Resolution Protocol
An administrative operator inspecting an `AMBIGUOUS_OUTCOME` notification in the Admin Billing Operations dashboard has two permitted actions:
1. **Force Mark Sent (`FORCE_MARK_DISPATCHED`):** If the customer confirmed receipt or Brevo logs show delivery, the operator enters the Brevo message ID, advancing the state to `DISPATCHED` with complete administrative audit logging (`ADMIN_ACTION_EXECUTED`).
2. **Authorize Controlled Resend (`AUTHORIZE_RESEND`):** If the customer confirms non-receipt and Brevo logs confirm no email was sent, the operator authorizes a resend. The system increments `resendAuthorizationCount` and moves the record to `PENDING`.

---

## 6. Webhook Identity, Persistence, and Reconciliation Design

### Brevo Webhook Payload Structure
Based on verified Brevo documentation and existing route handling in `src/services/email_webhook_service.ts`:
```json
{
  "event": "delivered",
  "email": "customer@example.com",
  "message-id": "<20261010120000.1234567@smtp-relay.brevo.com>",
  "date": "2026-10-10 15:30:00",
  "ts": 1760100600,
  "ts_event": 1760100600,
  "subject": "[ZdexCloud] Tax Invoice Issued — ZCI-2627-000001",
  "tag": "BILLING_INVOICE_ISSUED"
}
```

### Deterministic Event Deduplication
1. **Message Identifier Extraction:** The `message-id` field is normalized by stripping surrounding whitespace and angle brackets (`<` and `>`), resulting in `cleanMessageId`.
2. **Event Timestamp Normalization:** The timestamp is parsed from `ts_event` (seconds), `ts` (seconds), or `date` (ISO string).
3. **Deterministic Event Fingerprint:** Because Brevo does not provide a globally unique event GUID in every webhook type, the unique event fingerprint is computed as:
   $$\text{eventFingerprint} = \text{SHA256}(\text{cleanMessageId} + \text{":"} + \text{event} + \text{":"} + \text{normalizedTimestampSeconds})$$
4. **Immediate Ingestion Contract:**
   - In `email-webhooks.ts`, when a webhook arrives, the payload is inserted into `EmailWebhookInbox`:
     ```sql
     INSERT INTO `EmailWebhookInbox` (`id`, `provider`, `eventId`, `eventType`, `providerMessageId`, `recipientEmail`, `eventTimestamp`, `status`, `rawPayload`)
     VALUES (UUID(), 'BREVO', :eventFingerprint, :event, :cleanMessageId, :email, :timestamp, 'RECEIVED', :payload)
     ON DUPLICATE KEY UPDATE `updatedAt` = NOW(3);
     ```
   - Only **after** the row is committed to MySQL does the endpoint return HTTP 200 to Brevo.
   - If the database write fails, the route returns HTTP 500, forcing Brevo to re-try delivery according to its exponential backoff schedule.

---

## 7. Single-Dispatch-Owner Rollout and Rollback Plan

To prevent duplicate deliveries during rolling production deployments, the system enforces a strict single-owner cutover.

### Dispatch Mode Flag: `INVOICE_NOTIFICATION_DISPATCH_MODE`
Configuration supports three mutually exclusive operational modes:
- **`LEGACY_DIRECT` (Default prior to cutover):** `BillingInvoiceService` calls `BillingInvoiceNotificationService` asynchronously post-commit. The Outbox Worker is disabled.
- **`DUAL_WRITE_LEGACY_DISPATCH` (Warm-up Phase):** `BillingInvoiceService` creates the `InvoiceNotificationOutbox` row in `PENDING` inside the invoice transaction, but legacy direct dispatch still performs the send. The outbox row is updated post-send. The Outbox Worker remains disabled.
- **`OUTBOX_WORKER` (Authoritative Cutover):** `BillingInvoiceService` only inserts the `PENDING` outbox row. Direct asynchronous dispatch is skipped. The background Outbox Worker is enabled and processes all dispatches.

### Rollout Gate Checklist

```
Step 1: Database Migration
- Deploy tables `InvoiceNotificationOutbox` and `EmailWebhookInbox`.
- Verify database constraints and indexes.
- Status: Mode = LEGACY_DIRECT.

Step 2: Dual-Write Shadow Mode
- Deploy code with Mode = DUAL_WRITE_LEGACY_DISPATCH.
- Invoices atomically create outbox rows.
- Existing direct dispatcher handles emails and marks outbox rows DISPATCHED.
- Verify outbox state accuracy against Brevo logs for 24 hours.

Step 3: Cutover Gate (Single Owner)
- Stop direct dispatch: Update configuration to Mode = OUTBOX_WORKER.
- Start Outbox Worker service.
- Verify queue processing latency and zero duplicate reports.

Step 4: Rollback Procedure (If Needed)
- If Outbox Worker encounters an issue, immediately switch configuration back to Mode = DUAL_WRITE_LEGACY_DISPATCH or LEGACY_DIRECT.
- The worker gracefully shuts down via Fastify lifecycle hooks.
- Existing queued rows in PENDING are preserved safely in MySQL without data loss.
```

---

## 8. Conservative Historical Backfill and Quarantine Plan

For existing historical invoices in the database, automated blind email dispatch is strictly prohibited. The backfill categorizes historical records into explicit audit states:

| Historical Invoice State | Matching Tracking Evidence | Backfill Action | Assigned Outbox Status | Operator Policy |
| :--- | :--- | :--- | :--- | :--- |
| **Delivered** | `EmailMessage` exists with status `DELIVERED`. | Backfill matching outbox row. | `DELIVERED` | Audit complete. No send permitted. |
| **Dispatched** | `EmailMessage` exists with status `SENT` and valid `providerMessageId`. | Backfill matching outbox row. | `DISPATCHED` | Awaiting webhook or audit. |
| **Known Permanent Failure** | `EmailMessage` exists with permanent error (`invalid recipient`, `bounced`). | Backfill matching outbox row with error diagnostics. | `PERMANENT_FAILURE` | Correct recipient in profile before resend. |
| **Known Retryable Failure** | `EmailMessage` exists with transient failure and attempts < 5. | If invoice issued < 7 days ago, backfill to `PENDING`. If > 7 days, backfill to `EXHAUSTED`. | `PENDING` or `EXHAUSTED` | Controlled recovery within 7-day freshness window. |
| **Untracked Historical** | `BillingInvoice` exists in `ISSUED` status, but **no** `EmailMessage` record is found. | Backfill outbox row into conservative quarantine. | **`HISTORICAL_UNTRACKED`** | **Automated send is permanently blocked.** Customers access invoices via portal download. Operator may authorize single resend on demand. |
| **Duplicate Tracking Rows** | Multiple historical `EmailMessage` records share the same invoice correlation ID. | Link the earliest successful dispatch; flag duplicate occurrence. | `DISPATCHED` (with warning flag) | Audit discrepancy logged in Admin Error Center. |

---

## 9. Foreign Keys, Retention, and Auditability Design

### Foreign Key Constraints
Statutory financial evidence must be immune to accidental deletion:
```sql
-- Invoice Relationship: RESTRICT prevents deleting an issued invoice that has notification history
CONSTRAINT `fk_outbox_invoice`
  FOREIGN KEY (`invoiceId`)
  REFERENCES `BillingInvoice` (`id`)
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

-- User Relationship: SET NULL retains notification history even if user account is pruned/anonymized
CONSTRAINT `fk_outbox_user`
  FOREIGN KEY (`userId`)
  REFERENCES `User` (`id`)
  ON DELETE SET NULL
  ON UPDATE CASCADE;
```

### Data Minimization & Retention Alignment
- In alignment with `EmailRetentionWorker` (`src/services/email_retention_worker.ts`), terminal outbox records are retained for a minimum of **90 days** (configurable via `EMAIL_TRACKING_RETENTION_DAYS`).
- Outbox metadata stores operational diagnostics (`invoiceNumber`, `totalMinorUnits`, `providerMessageId`), but **never stores customer billing addresses, PAN/GSTIN identifiers, or payment provider secrets**.

---

## 10. Outbox to EmailMessage State Mapping

To preserve compatibility with existing Admin Email and Webhook views, `InvoiceNotificationOutbox` acts as the scheduling authority, while `EmailMessage` acts as the communication audit log.

| Outbox State (`InvoiceNotificationOutbox`) | EmailMessage Status (`EmailMessage`) | Meaning & Operational Scope |
| :--- | :--- | :--- |
| **`PENDING`** | *(No record or `QUEUED`)* | Notification obligation established in database. Awaiting worker claim. |
| **`CLAIMED`** | *(No record or `QUEUED`)* | Worker actively rendering PDF and executing Brevo transport. |
| **`DISPATCHED`** | `SENT` | Brevo accepted the message with HTTP 200/201. Transport complete. |
| **`DELIVERED`** | `DELIVERED` | Brevo webhook confirmed final inbox delivery. Terminal success. |
| **`RETRYABLE_FAILURE`** | `RETRYING` | Transient failure; backoff timer active. |
| **`AMBIGUOUS_OUTCOME`** | `DEFERRED` | Provider network timeout. Quarantined awaiting provider evidence. |
| **`PERMANENT_FAILURE`** | `FAILED` / `BOUNCED` / `BLOCKED` | Hard bounce, invalid recipient, or spam complaint. Terminal failure. |
| **`EXHAUSTED`** | `PERMANENTLY_FAILED` | Max retry attempts reached without delivery. Operator triage required. |
| **`HISTORICAL_UNTRACKED`** | *(None)* | Pre-existing legacy invoice without historical tracking. Auto-send suppressed. |

---

## 11. Verified PDF Execution Path Findings

Inspection of `BillingInvoiceDocumentService` (`src/services/billing/billing_invoice_document_service.ts`) establishes the following technical facts:

1. **Pure Vector PDF Engine is Fully Reachable:**
   - Lines 732–763 define `generateInvoicePdf(input)`.
   - Line 739 directly calls `this.buildPurePdfBuffer(doc)`.
   - Lines 769–925 implement `buildPurePdfBuffer()` using pure Node.js in-memory byte assembly (ISO 32000-1 / PDF 1.4 vector streams).
   - **Conclusion:** The pure PDF generator is **not** an unreachable stub or fallback; it is currently the **primary active PDF rendering implementation** in the service.
2. **`pdfkit` is Not Used in the Active Rendering Path:**
   - Although declared in `package.json`, `pdfkit` is not imported or called anywhere in `BillingInvoiceDocumentService.ts`.
   - The absence of `pdfkit` in `node_modules` does **not** block invoice PDF generation or portal downloads via `/billing/invoices/:id/download`.
3. **Document Failure Isolation:**
   - If an error occurs in `generateInvoicePdf()`, it throws an `AppError(500)`.
   - In the outbox worker, catching this error transitions the outbox row to `RETRYABLE_FAILURE` without attempting email transport, cleanly preserving the issued invoice snapshot.

---

## 12. Proposed Implementation Batches & Acceptance Criteria

Upon technical review and approval of this specification, implementation should proceed in three focused batches:

```
┌────────────────────────────────────────────────────────┐
│ Phase 8.4 Batch E.3: Schema Migration & Model Authoring│
│ - Author Prisma migration for Outbox and Inbox tables  │
│ - Add claimVersion, indexes, and restricted FKs        │
│ - Author unexecuted static unit tests                  │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ Phase 8.4 Batch E.4: Outbox Ingestion & Worker Service │
│ - Add atomic outbox create in BillingInvoiceService    │
│ - Implement leased worker with claimVersion fencing    │
│ - Integrate single-owner mode configuration flag       │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│ Phase 8.4 Batch E.5: Webhook Ingestion & Reconciliation│
│ - Implement EmailWebhookInbox immediate persistence    │
│ - Implement asynchronous reconciliation worker         │
│ - Implement ambiguous outcome quarantine triage        │
└────────────────────────────────────────────────────────┘
```

---

## 13. Unresolved External Legal, Provider, and Operational Prerequisites

1. **Brevo Account-Level Webhook Configuration:**
   - An administrator must configure the Brevo webhook endpoint (`https://api.zdexcloud.com/api/v1/webhooks/email/brevo`) in the Brevo dashboard with the shared secret matching `BREVO_WEBHOOK_SECRET`.
2. **Statutory Tax Seller Approval:**
   - Statutory invoice generation requires approved seller GSTIN, legal name, and state code in `StatutorySellerConfigService`.
3. **Dependency Cleanup:**
   - An authorized build phase should execute `npm install` to update `package-lock.json` and install declared dependencies cleanly.

---

## 14. Explicit Execution Boundary Confirmation

In strict compliance with all operational rules and execution constraints:
- **Audit & Design Only:** Fully respected.
- **Application Source Code Modified:** Exactly 0 files modified.
- **Database Migrations Created or Executed:** Exactly 0 migrations created or applied.
- **Database Connections or Queries:** Exactly 0 database connections or queries executed.
- **Dependencies Installed or Changed:** Exactly 0 packages installed or lockfiles modified.
- **Tests Executed:** Exactly 0 tests, test runners, or builds executed.
- **External Network Dispatches:** Exactly 0 real emails sent; Brevo API was not called.
- **Runtime Delivery Guarantees Claimed:** None claimed. Exactly-once email delivery is acknowledged as physically impossible over lossy external networks without provider idempotency support.

### Final Audit Decision
**`READY FOR IMPLEMENTATION DESIGN REVIEW`**
