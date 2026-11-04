# ZDEXCLOUD PHASE 15.3: BILLING <-> NOTIFICATIONS INTEGRATION REPORT

**Project:** ZdexCloud Personal File Server Platform  
**Phase:** 15.3 - Cross-System Integration & Security Hardening (Billing <-> Notifications)  
**Status:** PASS  
**Date:** October 22, 2026  
**Canonical Domain:** `https://zdexcloud.com`  
**Target Scope:** Authoritative billing pipeline, centralized notification engine, outbox workers, email webhooks, and customer-facing templates  

---

## 1. EXECUTIVE SUMMARY

The Phase 15.3 cross-system integration audit between ZdexCloud's authoritative billing engine and its centralized notification system has completed with a status of **PASS**.

The architectural review confirmed that:
1. **Invoice Email Pipeline Authority:** The dedicated `InvoiceNotificationOutbox` and `InvoiceNotificationOutboxWorker` retain sole, uncompromised authority over customer invoice email delivery. The central `ChannelRouter` explicitly filters out and suppresses `NotificationChannel.EMAIL` for `INVOICE_ISSUED`, guaranteeing zero duplicate invoice emails across the platform.
2. **Crash Resilience and Fencing:** The invoice outbox worker utilizes atomic database transactions with monotonic `claimVersion` fencing. Unambiguous delivery outcomes update state reliably, while ambiguous network timeouts (HTTP 502, 504, socket dropouts) are safely quarantined as `AMBIGUOUS_OUTCOME` to prevent duplicate customer charges or re-dispatches.
3. **Webhook Monotonicity & Timing-Safe Verification:** Provider webhook ingress (`EmailWebhookService`) verifies delivery webhook signatures using `crypto.timingSafeEqual`, stages payloads in `EmailWebhookInbox`, and applies state transitions strictly adhering to forward-only monotonic precedence (`DELIVERED` cannot be regressed by out-of-order `OPENED` or `CLICKED` events).
4. **Tenant Isolation and Privacy Safeguards:** Customer notification APIs enforce strict session authentication and tenant boundary checks. Sensitive payment card numbers (PAN), CVVs, bank tokens, and national tax identifiers are strictly omitted from notification event payloads and audit metadata.
5. **Defect Remediation:** An audit of `src/notifications/services/template_registry.ts` revealed legacy em dash characters in notification subjects and body templates. These were cleanly replaced with ASCII hyphens (` - `) in accordance with the project zero em dash standard.

---

## 2. FILES AND SERVICES INSPECTED

The following authoritative backend services, workers, database models, and route definitions were audited in detail:

### A. Authoritative Billing & Invoice Pipeline
- `main website/Backend/src/services/billing_invoice_service.ts` (Invoice issuance, outbox staging, dispatch mode controls)
- `main website/Backend/src/workers/invoice_notification_outbox_worker.ts` (Outbox worker, claim fencing, ambiguous outcome quarantine)
- `main website/Backend/src/services/billing_invoice_notification_service.ts` (Authoritative PDF generation, email composition, and SMTP/provider dispatch)
- `main website/Backend/src/services/billing_invoice_recovery_service.ts` (Reconciliation, orphan detection, idempotency guard)

### B. Centralized Notification Architecture
- `main website/Backend/src/notifications/services/channel_router.ts` (Multi-channel routing, category preference evaluation, security override, and channel suppression)
- `main website/Backend/src/notifications/services/central_notification_service.ts` (Central event dispatch orchestrator, outbox management)
- `main website/Backend/src/notifications/services/template_registry.ts` (Notification templates, subject lines, HTML and plaintext content)
- `main website/Backend/src/notifications/services/idempotency_manager.ts` (Deduplication keys, TTL caching, atomic reservation)
- `main website/Backend/src/notifications/services/notification_preference_service.ts` (Customer opt-out settings and security non-suppressible categories)

### C. Webhook Ingress & Admin Reconciliation
- `main website/Backend/src/services/email_webhook_service.ts` (Webhook staging, timing-safe authentication, status monotonicity)
- `main website/Backend/src/routes/email_webhook_routes.ts` (Provider webhook intake endpoints)
- `main website/Backend/src/routes/admin/operations/billing/notifications_routes.ts` (Admin outbox inspection, dead-letter redrive, reconciliation)
- `main website/Backend/src/notifications/routes/notification_routes.ts` (Customer notification inbox, read/unread status, preference endpoints)

---

## 3. CONFIRMED PRE-IMPLEMENTATION FINDINGS

| Subsystem Component | Audited Finding | Architectural Invariant | Status |
| :--- | :--- | :--- | :--- |
| **ChannelRouter** | Evaluates channels for `INVOICE_ISSUED` and executes: `effectiveChannels = allowedChannels.filter(ch => ch !== NotificationChannel.EMAIL)` | Central notification service NEVER emits email for invoice issuance | Verified |
| **BillingInvoiceService** | Enqueues invoice outbox row inside DB transaction during issuance; conditionally executes post-commit dispatch only if `dispatchMode !== 'OUTBOX_WORKER'` | Default production deployment defers to outbox worker; no duplicate dispatches | Verified |
| **InvoiceNotificationOutboxWorker** | Fences outbox row claims via `claimVersion: { increment: 1 }` and `workerId`. Quarantines network timeouts to `AMBIGUOUS_OUTCOME` | Prevents race conditions between concurrent worker instances and prevents duplicate invoice delivery | Verified |
| **BillingInvoiceRecoveryService** | Rejects direct automatic dispatch when `dispatchMode === 'OUTBOX_WORKER'`; queries existing outbox records before enqueueing | Guarantees recovery sweeps never redispatch active or quarantined outbox entries | Verified |
| **EmailWebhookService** | Staged in `EmailWebhookInbox`; verifies provider signatures with `crypto.timingSafeEqual`; enforces `STATUS_PRECEDENCE` | Prevents timing attacks, spoofed callbacks, and out-of-order state regression | Verified |
| **Data Privacy** | Notification metadata sanitizers strip `cardNumber`, `cvv`, `pan`, `taxId`, and secret credentials | Prevents inadvertent PII/PCI disclosure in notification channels or logs | Verified |

---

## 4. ACTUAL BILLING EVENT TO NOTIFICATION FLOW

The audit traced every primary billing lifecycle event to confirm its exact delivery mechanisms and channels:

### 1. Invoice Issued (`INVOICE_ISSUED`)
- **Authoritative Producer:** `BillingInvoiceService.issueInvoice()`
- **Pipeline:**
  1. Transactionally persists invoice record in `Invoice` table.
  2. Transactionally stages dispatch record in `InvoiceNotificationOutbox` with status `PENDING`.
  3. `InvoiceNotificationOutboxWorker` claims record using atomic `claimVersion` fencing.
  4. Generates signed invoice PDF via `BillingInvoiceNotificationService` and dispatches email directly to customer through verified SMTP/SES provider.
  5. Post-issuance, emits in-app notification via `billingEventProducer.emitInvoiceIssued()`.
  6. `ChannelRouter` suppresses `EMAIL` channel (`NotificationType.INVOICE_ISSUED`), routing ONLY to `IN_APP` and `PUSH` (if device tokens exist).
- **Result:** Customer receives exactly one official invoice email with PDF attachment, plus a persistent dashboard notification linking to `pages/invoices.html`.

### 2. Subscription Renewal Succeeded (`SUBSCRIPTION_RENEWAL_SUCCESS`)
- **Authoritative Producer:** `SubscriptionEngine` / `BillingTransactionService`
- **Channels:** `IN_APP`, `PUSH`, `EMAIL`
- **Behavior:** Dispatches in-app confirmation and transaction summary email. Links customer to `pages/subscription.html`.

### 3. Subscription Payment Failed (`SUBSCRIPTION_PAYMENT_FAILED`)
- **Authoritative Producer:** `BillingPaymentProcessor` / Webhook Handler
- **Channels:** `IN_APP`, `PUSH`, `EMAIL`
- **Behavior:** High-severity operational alert. Notifies customer of grace period activation (5 days remaining) without disabling immediate server access. Provides direct deep link to `pages/billing.html` to update payment method.

### 4. Subscription Cancellation Scheduled (`SUBSCRIPTION_CANCELLED`)
- **Authoritative Producer:** `SubscriptionEngine.scheduleCancellation()`
- **Channels:** `IN_APP`, `EMAIL`
- **Behavior:** Confirms cancellation will take effect at the end of the current billing cycle. Explicitly reminds customer of hardware storage guarantee: personal files and Android node servers remain safe.

### 5. Subscription Expired & Account Reverted (`SUBSCRIPTION_EXPIRED`)
- **Authoritative Producer:** `SubscriptionEngine.expireSubscription()`
- **Channels:** `IN_APP`, `PUSH`, `EMAIL`
- **Behavior:** Explains account transition to Free tier (1 server limit). Reassures customer that existing phone-hosted files are not deleted.

### 6. Billing Refund Processed (`BILLING_REFUND_PROCESSED`)
- **Authoritative Producer:** `BillingTransactionService.processRefund()`
- **Channels:** `IN_APP`, `EMAIL`
- **Behavior:** Informs customer of refund amount and expected bank settlement timelines.

---

## 5. INVOICE OUTBOX AUTHORITY & DUPLICATE PREVENTION FINDINGS

The audit confirmed three concentric layers of defense preventing duplicate customer communications:

1. **Routing Suppression:**
   `ChannelRouter.evaluateRouting()` contains explicit logic:
   ```typescript
   if (event.eventType === NotificationType.INVOICE_ISSUED) {
     effectiveChannels = allowedChannels.filter((ch) => ch !== NotificationChannel.EMAIL);
   }
   ```
   Even if customer preferences request email for all events, the central notification engine cannot emit invoice emails.

2. **Idempotency Key Reservation:**
   When `InvoiceNotificationOutboxWorker` notifies the central service for in-app alert delivery, it passes an authoritative idempotency key:
   ```typescript
   idempotencyKey: `notif_inv_issued_${invoice.id}`
   ```
   Any duplicate outbox scan or retried message produces a duplicate key collision in `NotificationRecord`, preventing multiple in-app alert entries.

3. **Atomic Claim Fencing:**
   Workers claim pending outbox jobs by executing:
   ```sql
   UPDATE InvoiceNotificationOutbox
   SET status = 'PROCESSING',
       claimVersion = claimVersion + 1,
       lockedBy = :workerId,
       lockedAt = NOW()
   WHERE id = :id AND claimVersion = :expectedVersion AND status = 'PENDING'
   ```
   This prevents concurrent worker pods from double-processing the same outbox item.

---

## 6. RETRY, AMBIGUOUS OUTCOME, WEBHOOK, AND RECOVERY FINDINGS

### A. Ambiguous Outcome Quarantine
When an outbox worker dispatches an email via external transport, network faults may occur after the provider has accepted the payload but before an HTTP response returns.
- If an ambiguous error occurs (socket timeout, connection reset, 502/504 Bad Gateway), the worker categorizes the outcome as `AMBIGUOUS_OUTCOME`.
- The record is marked `status = 'AMBIGUOUS_OUTCOME'` and quarantined.
- Neither the worker nor the automated `BillingInvoiceRecoveryService` will automatically re-transmit a quarantined record. This prevents double-sending customer invoices.
- Admin intervention is required via `/api/admin/operations/billing/notifications/outbox/:id/retry` with manual operator verification.

### B. Email Provider Webhook Ingress
Provider callbacks (SendGrid, SES, Mailgun) are ingested via `POST /api/webhooks/email`:
1. **Timing-Safe Authentication:** Provider signature verification computes the HMAC and verifies it using `crypto.timingSafeEqual` to eliminate timing side-channel attacks.
2. **Staged Inbox:** Raw webhook payloads are stored in `EmailWebhookInbox` prior to processing.
3. **Monotonic Status Transitions:** Event status updates follow strict precedence rules:
   `PENDING (10) -> SENT (20) -> DELIVERED (30) -> OPENED (40) -> CLICKED (50)`
   Terminal failure states (`BOUNCED`, `COMPLAINED`) immediately halt further automated communication and flag customer preferences. A delayed `OPENED` webhook cannot revert an existing `BOUNCED` or `DELIVERED` status.

---

## 7. AUTHENTICATION, TENANT ISOLATION, PRIVACY, AND RBAC FINDINGS

1. **Customer Endpoint Isolation:**
   - All customer notification endpoints (`/api/notifications/*`) require valid JWT bearer tokens verified by `getAuthUser()`.
   - Notification retrieval and mutation queries enforce tenant scoping (`where: { userId: authUser.id }`). IDOR access attempts return HTTP 403 / 404.
2. **Administrator Role-Based Access Control (RBAC):**
   - Admin outbox inspection requires `billing.read`.
   - Admin reconciliation queries require `billing.reconcile`.
   - Manual outbox redrive and override operations require `billing.write` and produce structured entries in `AuditEvent`.
3. **Data Privacy and Secret Sanitization:**
   - Notification payloads, error traces, and webhook logs are scrubbed before persistence.
   - Keys matching `cvv`, `pan`, `cardNumber`, `accountNumber`, `taxId`, `secret`, and `apiKey` are excluded from all notification metadata.

---

## 8. FILES MODIFIED AND EXACT REASON

| File Path | Description of Modification | Rationale |
| :--- | :--- | :--- |
| `main website/Backend/src/notifications/services/template_registry.ts` | Replaced 7 occurrences of em dash (`U+2014`) in email subjects and titles with ASCII hyphens (` - `) | Enforces the ZdexCloud global standard of zero em-dash characters in customer-facing communication and codebases. |

---

## 9. FOCUSED VERIFICATION AND UNTESTED AREAS

### Executed Verification Checks:
1. **TypeScript Typecheck:**
   `npx tsc --noEmit` (executed in `main website/Backend`)
   *Result:* Exit Code 0 (clean compilation, zero type errors).
2. **Static Architectural Audit:**
   `node scratch/verify_phase_15_3.cjs`
   *Result:*
   - [PASS] ChannelRouter suppresses EMAIL channel for INVOICE_ISSUED
   - [PASS] BillingInvoiceService suppresses direct post-commit dispatch under OUTBOX_WORKER
   - [PASS] InvoiceNotificationOutboxWorker enforces monotonic claim fencing & quarantine
   - [PASS] BillingInvoiceRecoveryService defers to existing outbox records & skips ambiguous failures
   - [PASS] EmailWebhookService enforces timing-safe secret check and monotonic status updates
   - [PASS] Safe notification metadata strictly omits CVV, PAN, Card, and Tax ID keys
   - [PASS] Notification API routes enforce authentication and strict tenant ownership
   - [PASS] Admin notification operations enforce billing.read, billing.reconcile, billing.write
   - [PASS] Zero em-dash characters in template_registry.ts and core notification files

### Explicitly Untested Areas:
- Live external SMTP / SES transport connections (requires live third-party email service credentials).
- Live email client rendering (Outlook, Gmail, Apple Mail responsive rendering).
- Full regression test runner execution (vitest, playwright, and backend integration suites reserved for Phase 18).

---

## 10. REMAINING LIMITATIONS AND RISKS

1. **Email Provider Webhook Delivery Latency:** Webhooks from external email providers may experience network delays. The monotonic state machine prevents out-of-order corruption, but real-time dashboard webhook indicators may reflect slight provider lag.
2. **Admin Redrive Responsibility:** In the event of an ambiguous delivery outcome (`AMBIGUOUS_OUTCOME`), administrators must verify delivery status in the provider's external console before triggering a manual redrive via admin operations to avoid duplicate customer receipt.

---

## 11. EXPLICIT CONFIRMATION: FULL TEST SUITE NOT RUN

In strict accordance with project rules, testing constraints, and roadmap protocols:
> **Explicit Confirmation:** The full end-to-end integration and automated regression test suite was NOT executed during Phase 15.3. Full comprehensive test suite execution remains strictly reserved for **Phase 18**. Only focused static analysis, TypeScript typechecking, and targeted architectural verification checks were conducted.

---

## 12. RECOMMENDATION FOR PHASE 15.4

Phase 15.3 (Billing <-> Notifications Integration) is complete and verified.

**Recommended Next Step:**
Proceed to **ZDEXCLOUD PHASE 15.4: SECURITY <-> ACTIVITY INTEGRATION**.
Phase 15.4 will audit and integrate security event producers (login anomalies, credential changes, session revocations, token rotations) with the audit event log and activity dashboard, verifying complete audit logging, privacy compliance, and customer security notifications.
