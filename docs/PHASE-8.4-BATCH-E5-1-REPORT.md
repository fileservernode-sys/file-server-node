# ZDEXCLOUD | PHASE 8.4 | BATCH E.5.1 REPORT
# RESEND SAFETY, WEBHOOK EVIDENCE AND CONCURRENCY HARDENING

**Repository Root:** `D:\YOUM PATEL\Desktop\Projects\File Server Project\`  
**Target Subsystem:** `main website/Backend/`  
**Canonical Domain:** `https://zdexcloud.com`  
**Execution Mode:** Focused source audit and minimal corrective implementation. Strictly non-executing.  
**Completion Date:** 2026-10-10  
**Final Batch Verdict:** `CORRECTIONS COMPLETE WITH DOCUMENTED LIMITATIONS`

---

## 1. EXECUTIVE SUMMARY & VERDICT

Phase 8.4 Batch E.5.1 conducted a rigorous, evidence-grounded source inspection and hardening of the Phase 8.4 Batch E.5 implementation across resend safety, webhook provider semantics, force-mark boundaries, and inbox worker concurrency.

### Confirmed Findings & Hardening Corrections Summary:
1. **Resend Authorization & Ambiguity History Preservation**:
   - *Confirmed Risk:* Previously, `authorizeResend` cleared `transportStartedAt = NULL` and set `status = 'PENDING'` without preserving that the prior attempt had begun transport, leaving no durable record of the uncertain provider attempt at the column level. Furthermore, the update query used unconditional `WHERE id = ?`, allowing race conditions if status changed during inspection.
   - *Hardening Implemented:*
     - Archived previous attempt details into `metadata.priorAttempts` (recording `attemptNumber`, `status: priorStatus`, `transportStartedAt`, `dispatchedAt`, `providerMessageId`, `ambiguousReason`, `failureReason`, `authorizedBy`, and `authorizedAt`).
     - Preserved prior `providerMessageId` in `metadata.previousProviderMessageIds`, ensuring delayed webhooks from the original ambiguous attempt remain correlatable.
     - Enforced atomic optimistic fencing on the mutation: `WHERE id = ? AND status = :priorStatus AND claimVersion = :expectedVersion`. If another worker or operator modified the record concurrently, the update rejects with `409 Conflict`.
     - In `InvoiceNotificationOutboxWorker`, upon dispatch of an authorized resend, the authorization is atomically consumed (`resendAuthorized = false`), `emailMessageId` is linked, and historical provider message IDs are durably retained.
2. **`FORCE_MARK_DISPATCHED` Safety & Failure Protection**:
   - *Confirmed Risk:* Previously, `forceMarkDispatched` accepted records in `PERMANENT_FAILURE` and `EXHAUSTED`, allowing operators to wipe verified terminal provider rejections (hard bounce, blocked, spam) into `DISPATCHED` with a free-text reason.
   - *Hardening Implemented:*
     - Explicitly **rejected** transitions from `PERMANENT_FAILURE` (`409 Conflict: Use AUTHORIZE_RESEND if re-sending to a corrected address`).
     - Explicitly **rejected** transitions from `EXHAUSTED` (`409 Conflict: Use AUTHORIZE_RESEND to queue a new dispatch attempt`).
     - Added strict format validation for `input.providerMessageId` (`/^[a-zA-Z0-9<>\-_@.]+$/`).
     - Archived previous ambiguity and failure reasons into `metadata.forceMarkDispatchedHistory`.
     - Enforced atomic conditional mutation: `WHERE id = ? AND status = :priorStatus`.
3. **Provider Event Semantics (`opened` & `clicked` vs Delivery Confirmation)**:
   - *Confirmed Risk:* Previously, `classifyWebhookEventCategory` grouped `opened`, `clicked`, and `proxy_open` under `isDelivery: true`, advancing outbox records to `DELIVERED` and clearing `AMBIGUOUS_OUTCOME` on engagement events alone.
   - *Hardening Implemented:*
     - Separated event categories cleanly: `isDeliveryConfirmation` applies strictly to `delivered` (MTA acceptance).
     - Events `opened`, `unique_opened`, `clicked`, `proxy_open`, and `unique_proxy_open` are categorized exclusively as `isEngagement`.
     - Engagement events record telemetry in `metadata.engagement` (`openedAt`, `openCount`, `clickedAt`, `lastClickedUrl`, etc.) and update `EmailMessage.metadata`, but **never advance delivery status to `DELIVERED`** and **never clear `AMBIGUOUS_OUTCOME`**.
4. **Conflicting Delivery & Bounce Evidence Handling**:
   - *Confirmed Risk:* Previously, if a terminal bounce arrived for an already `DELIVERED` record, or a delivery arrived for a `PERMANENT_FAILURE` record, the conflicting event was silently acknowledged without updating outbox metadata.
   - *Hardening Implemented:*
     - Outbox `DELIVERED` status is preserved against late bounces (monotonicity guard).
     - However, the contradictory evidence is **never silently discarded**: it is durably appended to `metadata.conflictingEvents` with `hasConflictingEvidence: true`, triggering operator triage visibility while acknowledging the inbox record.
5. **Inbox Worker Concurrency & Stale-Worker Fencing**:
   - *Confirmed Risk:* `EmailWebhookInbox` lacks explicit `claimedBy` and `claimVersion` columns. Previously, completion updates used `WHERE id = ?`, meaning a stale worker whose lease expired could overwrite an inbox row claimed by a newer worker.
   - *Hardening Implemented:*
     - Implemented optimistic fencing using the existing `processingAttempts` column:
       `WHERE id = ? AND status = 'PROCESSING' AND processingAttempts = :claimedAttempts`.
     - Wrapped outbox state transitions and inbox completion inside atomic database transactions (`prisma.$transaction`).
     - If the inbox optimistic fence matches 0 rows, the transaction aborts and rolls back, preventing stale workers from committing contradictory transitions.
6. **Payload Sanitization & Correlation Audit**:
   - Verified that normalized `providerMessageId` is extracted into a dedicated indexed column before payload sanitization.
   - Verified that `rawPayload` in `EmailWebhookInbox` is omitted by default from administrative list endpoints and recursively redacted via `sanitizeJsonPayload` on detail endpoints.

**Final Verdict:** **`CORRECTIONS COMPLETE WITH DOCUMENTED LIMITATIONS`**

---

## 2. EXACT SOURCE FILES CHANGED AND PURPOSE

| File Path | Action | Purpose |
| :--- | :--- | :--- |
| `src/routes/admin/operations/billing/notifications_service.ts` | **MODIFIED** | Hardened `forceMarkDispatched` (rejected `PERMANENT_FAILURE`/`EXHAUSTED`, added regex check) and `authorizeResend` (archived `priorAttempts` & `previousProviderMessageIds`, enforced `WHERE id = ? AND status = ? AND claimVersion = ?` optimistic fencing). |
| `src/services/billing/email_webhook_reconciliation_worker.ts` | **MODIFIED** | Enforced strict provider semantics (engagement != delivery), atomic transactions (`prisma.$transaction`), inbox optimistic fencing (`processingAttempts`), and conflicting evidence preservation (`hasConflictingEvidence`). |
| `src/services/billing/invoice_notification_outbox_worker.ts` | **MODIFIED** | Hardened `handleTransportSuccess` to consume resend authorization (`resendAuthorized = false`), preserve `previousProviderMessageIds`, and link `emailMessageId`. |
| `tests/email_webhook_reconciliation_worker.test.ts` | **MODIFIED** | Updated all 20 static test specifications to verify the hardened resend safety, engagement separation, conflicting evidence, and concurrency invariants. (Marked **NOT EXECUTED**). |

---

## 3. CONCRETE FINDINGS CONFIRMED FROM SOURCE INSPECTION

1. **`EmailWebhookInbox` Lacks Monotonic Versioning Column in Schema**:
   - Inspection of `prisma/schema.prisma` (lines 2101–2132) confirmed that `EmailWebhookInbox` has `id`, `status`, and `processingAttempts`, but **no `claimVersion` or `claimedBy` column**.
   - *Resolution:* Leveraged `processingAttempts` as a monotonic attempt token. When claiming a row (`UPDATE ... SET status = 'PROCESSING', processingAttempts = processingAttempts + 1`), the incremented count is retained. All completion queries enforce `WHERE id = ? AND status = 'PROCESSING' AND processingAttempts = ?`. If a lease sweeper reset the row and another worker claimed it, `processingAttempts` increments again, invalidating the stale worker's completion update.
2. **`PERMANENT_FAILURE` Was Previously Reversible Without Evidence**:
   - In Batch E.5, `forceMarkDispatched` allowed an operator to transition an outbox record from `PERMANENT_FAILURE` to `DISPATCHED` simply by supplying an arbitrary string. If an email address was invalid or hard-bounced, marking it `DISPATCHED` was contradictory and masked deliverability degradation.
   - *Resolution:* Prohibited transitions from `PERMANENT_FAILURE` and `EXHAUSTED`.
3. **Engagement Events Are Not Authoritative Delivery Confirmations**:
   - In transactional email delivery, an `opened` event can be triggered by automated security scanners, anti-spam heuristics, or image pre-fetching. An `opened` event without an underlying `delivered` event does not prove MTA acceptance.
   - *Resolution:* Only `delivered` transitions outbox status to `DELIVERED`. Engagement events record telemetry in metadata only.
4. **Resend Authorization Erased Prior Provider Message IDs**:
   - In Batch E.5, authorizing a resend cleared `transportStartedAt = NULL`. When the outbox worker subsequently dispatched the resend, `providerMessageId` was overwritten with the new message ID. If a webhook arrived later for the original ambiguous attempt, it failed correlation.
   - *Resolution:* Archived prior message IDs into `metadata.previousProviderMessageIds`, and updated the reconciler to search both current and historical provider message IDs.

---

## 4. CORRECTED RESEND AUTHORIZATION & FORCE-MARK SEMANTICS

### 4.1 `AUTHORIZE_RESEND` State Machine

```
   [ Prior Outbox Record ]
   (AMBIGUOUS_OUTCOME / PERMANENT_FAILURE / EXHAUSTED / RETRYABLE_FAILURE)
              │
              ▼
   Operator calls POST .../authorize-resend with explicit reason
              │
              ├── 1. Read existing outbox state & claimVersion
              ├── 2. Validate prior status is not PENDING, CLAIMED, or DELIVERED
              ├── 3. Build metadata:
              │      - Archive prior attempt in metadata.priorAttempts
              │      - Append prior providerMessageId to metadata.previousProviderMessageIds
              │      - Record operator attribution (operatorId, email, reason, timestamp)
              │
              └── 4. Atomic Fenced Mutation:
                     UPDATE InvoiceNotificationOutbox
                     SET status = 'PENDING',
                         resendAuthorized = true,
                         resendAuthorizedBy = :adminId,
                         resendAuthorizedAt = NOW(3),
                         resendAuthorizationCount = resendAuthorizationCount + 1,
                         resendReason = :reason,
                         attemptCount = :newAttemptCount,
                         nextAttemptAt = NOW(3),
                         claimedBy = NULL,
                         claimedAt = NULL,
                         claimExpiresAt = NULL,
                         transportStartedAt = NULL,
                         claimVersion = claimVersion + 1,
                         metadata = :updatedMeta,
                         updatedAt = NOW(3)
                     WHERE id = :id AND status = :priorStatus AND claimVersion = :currentClaimVersion
```

- If 0 rows affected: Throws `409 Conflict` (state concurrently modified).
- When the outbox worker dispatches the pending row:
  - Invokes `BillingInvoiceNotificationService.sendInvoiceIssuedNotification(invoice, { forceResend: true })`.
  - Upon positive acceptance: transitions to `DISPATCHED`, sets `resendAuthorized = false` (consumed), preserves `previousProviderMessageIds`, and links `emailMessageId`.

### 4.2 `FORCE_MARK_DISPATCHED` Semantics

```
   [ Outbox Record ]
   (AMBIGUOUS_OUTCOME / CLAIMED / HISTORICAL_UNTRACKED / RETRYABLE_FAILURE)
              │
              ▼
   Operator calls POST .../force-mark-dispatched with explicit reason
              │
              ├── Reject if DELIVERED (409 Conflict)
              ├── Reject if PENDING (409 Conflict)
              ├── Reject if PERMANENT_FAILURE (409 Conflict: Use AUTHORIZE_RESEND)
              ├── Reject if EXHAUSTED (409 Conflict: Use AUTHORIZE_RESEND)
              ├── Validate input.providerMessageId format regex
              │
              └── Atomic Mutation:
                     UPDATE InvoiceNotificationOutbox
                     SET status = 'DISPATCHED',
                         dispatchedAt = COALESCE(dispatchedAt, NOW(3)),
                         providerMessageId = :effectiveId,
                         ambiguousAt = NULL,
                         ambiguousReason = NULL,
                         failureCode = NULL,
                         failureReason = NULL,
                         metadata = :updatedMeta,
                         updatedAt = NOW(3)
                     WHERE id = :id AND status = :priorStatus
```

- Marks status as `DISPATCHED`, **never as `DELIVERED`**.

---

## 5. VERIFIED PROVIDER-EVENT TRANSITION POLICY

### 5.1 Event Classification Map

| Brevo Event String | Classification Category | State Transition Impact |
| :--- | :--- | :--- |
| `delivered` | **`isDeliveryConfirmation`** | Advances `DISPATCHED` or `AMBIGUOUS_OUTCOME` to **`DELIVERED`**. Clears ambiguity safely. Idempotent on `DELIVERED`. Flags conflict on `PERMANENT_FAILURE`. |
| `opened`, `unique_opened` | **`isEngagement`** | Records `openedAt`, `openCount` in `metadata`. **No status transition.** Does not clear ambiguity. |
| `clicked` | **`isEngagement`** | Records `clickedAt`, `clickCount`, `lastClickedUrl` in `metadata`. **No status transition.** |
| `proxy_open`, `unique_proxy_open` | **`isEngagement`** | Records proxy engagement in `metadata`. **No status transition.** |
| `hard_bounce`, `invalid_email`, `blocked`, `spam`, `unsubscribed` | **`isTerminalFailure`** | Advances `DISPATCHED` or `AMBIGUOUS_OUTCOME` to **`PERMANENT_FAILURE`**. Flags conflict if already `DELIVERED` (does not regress). |
| `deferred`, `soft_bounce` | **`isTransientOrInformational`** | Records `lastProviderWebhookEvent` in `metadata`. **No status transition.** |
| `request`, `sent` | **`isTransientOrInformational`** | Acknowledged in inbox; recorded in `metadata`. **No status transition.** |

### 5.2 Conflicting Evidence Policy
When an incoming event contradicts existing authoritative delivery evidence:
1. **Bounce on DELIVERED**:
   - `status` remains `DELIVERED` (monotonic delivery precedence).
   - Contradictory bounce event details are appended to `metadata.conflictingEvents`.
   - `metadata.hasConflictingEvidence = true` is set.
   - Inbox record marked `PROCESSED` with diagnostic note for operator review.
2. **Delivery on PERMANENT_FAILURE**:
   - `status` remains `PERMANENT_FAILURE` (terminal failure was recorded).
   - Late delivery confirmation is appended to `metadata.conflictingEvents`.
   - `metadata.hasConflictingEvidence = true` is set.
   - Inbox record marked `PROCESSED` with diagnostic note for operator review.

---

## 6. INBOX CONCURRENCY, LEASE & FENCING BEHAVIOR

### 6.1 Concurrency Coordination
- **Claim Transition:**
  ```sql
  UPDATE `EmailWebhookInbox`
  SET `status` = 'PROCESSING',
      `processingAttempts` = `processingAttempts` + 1,
      `updatedAt` = NOW(3)
  WHERE `id` = :id AND `status` IN ('RECEIVED', 'UNMATCHED')
  ```
  Returns affected row count. If 0, another worker claimed the record; skipped immediately.
- **Optimistic Fencing at Completion:**
  When a worker completes reconciliation, the update enforces:
  ```sql
  UPDATE `EmailWebhookInbox`
  SET `status` = 'PROCESSED',
      `matchedOutboxId` = :outboxId,
      `matchedEmailMessageId` = :emailId,
      `reconciledAt` = NOW(3),
      `updatedAt` = NOW(3)
  WHERE `id` = :id AND `status` = 'PROCESSING' AND `processingAttempts` = :claimedAttempts
  ```
- **Transaction Boundary:**
  The `InvoiceNotificationOutbox` update and `EmailWebhookInbox` update are wrapped inside `prisma.$transaction(async (tx) => { ... })`. If the inbox update matches 0 rows (lease expired and reclaimed), the transaction throws `STALE_WORKER_FENCING_REJECTED`, causing an immediate database rollback.

---

## 7. PAYLOAD STORAGE, REDACTION & IDENTIFIER PRESERVATION

### 7.1 Webhook Ingestion & Persistence Path
1. `EmailWebhookService.stageEventInInbox`:
   - Extracts `cleanMessageId` from `message-id`, `message_id`, or `id`.
   - Extracts `eventType`, `recipientEmail`, and normalized `eventTimestamp`.
   - Persists these in **dedicated indexed columns**: `providerMessageId`, `eventType`, `recipientEmail`, `eventTimestamp`.
   - Strips sensitive auth secrets from `rawPayload` using `sanitizeJsonPayload` before inserting into `EmailWebhookInbox.rawPayload`.
2. `AdminInvoiceNotificationService.listWebhookInbox`:
   - SQL query explicitly **omits `rawPayload`** from the `SELECT` projection.
   - Prevents leaking customer payload contents or large JSON blobs in paginated admin table views.
3. `AdminInvoiceNotificationService.getWebhookInboxDetail`:
   - Retrieves `rawPayload` for a single ID and passes it through `sanitizeJsonPayload` before serialization.
   - Recursively redacts passwords, tokens, API keys, cookies, and secrets.

---

## 8. STATIC TEST SPECIFICATIONS UPDATED

The test specifications in `tests/email_webhook_reconciliation_worker.test.ts` were updated to assert the hardened invariants.  
**STATUS: STATIC SPECIFICATION ONLY — STRICTLY NOT EXECUTED.**

- `SPEC 1`: Authorizing a resend preserves the original ambiguous attempt history, `transportStartedAt`, and prior message IDs in `metadata`.
- `SPEC 2`: An ambiguous resend requires explicit operator authorization and rejects PENDING, CLAIMED, or DELIVERED state races.
- `SPEC 3`: A resend authorization cannot be consumed twice concurrently due to optimistic fencing (`status = ? AND claimVersion = ?`).
- `SPEC 4`: Recovery cannot bypass resend authorization because recovery defers to outbox rows.
- `SPEC 5`: `FORCE_MARK_DISPATCHED` updates status to `DISPATCHED`, never to `DELIVERED`, and validates providerMessageId format.
- `SPEC 6`: `PERMANENT_FAILURE` and `EXHAUSTED` cannot be force-marked as DISPATCHED without verified evidence (rejected with 409 Conflict).
- `SPEC 7`: `opened` and `clicked` are categorized as engagement and record metadata telemetry without advancing status to `DELIVERED`.
- `SPEC 8`: Conflicting delivery and bounce events are preserved in `metadata.conflictingEvents` with `hasConflictingEvidence = true`.
- `SPEC 9`: A stale inbox worker cannot overwrite a newer worker completion due to attempt-counter optimistic fencing.
- `SPEC 10`: Lease reclamation is conditional and concurrency-safe (`status = 'PROCESSING' AND updatedAt <= :cutoff`).
- `SPEC 11`: Outbox updates and inbox completion execute inside an atomic database transaction (`prisma.$transaction`).
- `SPEC 12`: Payload sanitization preserves required matching identifiers without exposing sensitive data.
- `SPEC 13`: Unsupported or incomplete webhook events remain available for safe investigation (`UNMATCHED_NO_IDENTIFIER` / `UNMATCHED`).
- `SPEC 14`: Reconciliation never sends an email or changes immutable invoice data.
- `SPEC 15`: Existing RBAC (`billing.read`, `billing.reconcile`, `billing.write`), CSRF defense, and fail-closed audit trails remain strictly enforced.
- `SPEC 16`: Outbox worker consumes resend authorization upon dispatch, resets `resendAuthorized = false`, and links `emailMessageId`.
- `SPEC 17`: Historical provider message IDs allow delayed webhooks from previous ambiguous attempts to correlate successfully.
- `SPEC 18`: Repeated reconciliation is idempotent without repeating side effects.
- `SPEC 19`: Worker disablement and shutdown prevent new processing.
- `SPEC 20`: Missing providerMessageId does not cause payload loss.

---

## 9. REMAINING SCHEMA, MIGRATION & OPERATIONAL LIMITATIONS

1. **`EmailWebhookInbox` Dedicated Version Column Recommendation**:
   - The current optimistic fencing uses `processingAttempts` as a de facto version counter. While mathematically sound within `Int` limits, adding an explicit `claimVersion BigInt @default(0)` and `claimedBy String?` to `EmailWebhookInbox` in a future migration would align the model with `InvoiceNotificationOutbox`.
2. **Provider Webhook Timestamp Absence**:
   - When Brevo delivers a webhook payload lacking `ts_event`, `ts_epoch`, or `date`, `eventTimestamp` is stored as `null`. In this scenario, the local `receivedAt` timestamp is used for monotonicity comparison.
3. **Unapplied Migration Dependency (`20261010160000`)**:
   - The authored schema and migration remain unapplied in the database per non-executing authoring rules.
4. **Three-Phase Rollout Requirement**:
   - Cluster transition to `OUTBOX_WORKER` must proceed through the documented 3-phase rollout policy across all nodes before enabling worker daemons.

---

## 10. CONFIRMATION OF PROHIBITED OPERATIONS NOT PERFORMED

- [x] **Zero test runners or test suites executed** (`npm test`, `jest`, `node --test` were NOT run).
- [x] **Zero test compilation or test execution performed**.
- [x] **Zero Prisma CLI commands executed** (`npx prisma generate`, `migrate deploy`, `db push` were NOT run).
- [x] **Zero database migrations applied or modified in live database**.
- [x] **Zero database queries executed against live DB**.
- [x] **Zero dependencies installed, removed, or updated**.
- [x] **Zero real emails sent or Brevo API endpoints contacted**.
- [x] **Zero external network requests made**.
- [x] **Zero production environment variables altered**.
- [x] **Workers left disabled by default (`false`) across all configurations**.

---

## 11. FINAL BATCH VERDICT

### **`CORRECTIONS COMPLETE WITH DOCUMENTED LIMITATIONS`**

All six confirmed vulnerability areas have been hardened with minimal, surgical code changes. The system enforces strict provider semantics, fail-closed audit trails, optimistic concurrency fencing, and immutable statutory invoice protections.
