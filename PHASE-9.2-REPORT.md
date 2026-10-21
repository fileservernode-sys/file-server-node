# ZDEXCLOUD: PHASE 9.2 REPORT
## BACKEND CUSTOMER ACTIVITY EVENT RECORDING

**Date:** 2026-10-11  
**Target Subsystem:** `main website/Backend/`  
**Execution Mode:** Focused implementation (Strictly non-executing — no tests, builds, migrations, or Prisma client generation executed)  
**Final Readiness Verdict:** `IMPLEMENTED`

---

## 1. Storage Model & Schema / Migration Details

### 1.1 Dedicated Persistence Model (`CustomerActivityEvent`)
To preserve strict separation between internal security/compliance forensic logs (`AuditEvent`), actionable alert inbox messages (`NotificationRecord`), and the customer-facing chronological activity feed, Phase 9.2 introduces a dedicated `CustomerActivityEvent` model in `main website/Backend/prisma/schema.prisma`:

- **Table Name:** `CustomerActivityEvent`
- **Primary Key:** `id String @id @default(uuid())`
- **User Ownership:** `userId String` with foreign key relation to `User(id)` (`onDelete: Cascade`) and reverse relation `customerActivityEvents CustomerActivityEvent[]` on `User`.
- **Taxonomy Classification Fields:**
  - `eventType String` (validated against `CUSTOMER_ACTIVITY_TAXONOMY`, e.g., `AUTH.SIGN_IN_SUCCEEDED`, `BILLING.INVOICE_DOWNLOADED`)
  - `category String` (`AUTH`, `ACCOUNT`, `SECURITY`, `DEVICE`, `SERVER`, `FILE`, `BILLING`, `NOTIFICATION`)
  - `severity String` (`INFO`, `WARNING`, `CRITICAL`)
- **Customer-Facing Copy:**
  - `title String` (taxonomy `customerTitle`)
  - `description String @db.Text` (interpolated from `customerDescriptionTemplate` with safe fallbacks)
- **Optional Related Entity References (Loose Scalar References):**
  - `deviceId String?`
  - `serverId String?`
  - `invoiceId String?`
  - `subscriptionId String?`
  - `paymentId String?`
  - `receiptId String?`
  *(Stored as nullable scalar columns without cascading foreign keys so historical activity entries survive after a device or server is unlinked/deleted.)*
- **Sanitized Metadata:** `metadata Json?` (whitelisted per-event keys only)
- **Idempotency & Timestamps:**
  - `idempotencyKey String? @unique`
  - `occurredAt DateTime @default(now())`
  - `createdAt DateTime @default(now())`
- **Composite Indexes for Phase 9.3 Cursor/Page Queries:**
  - `@@index([userId, occurredAt(sort: Desc)], map: "customer_activity_user_time_idx")`
  - `@@index([userId, category, occurredAt(sort: Desc)], map: "customer_activity_user_cat_time_idx")`
  - `@@index([userId, eventType, occurredAt(sort: Desc)], map: "customer_activity_user_type_time_idx")`
  - `@@index([deviceId], map: "customer_activity_device_idx")`
  - `@@index([serverId], map: "customer_activity_server_idx")`
  - `@@index([invoiceId], map: "customer_activity_invoice_idx")`
  - `@@index([subscriptionId], map: "customer_activity_subscription_idx")`

### 1.2 Unapplied SQL Migration
Created `main website/Backend/prisma/migrations/20261011104000_add_customer_activity_event/migration.sql` defining `CREATE TABLE CustomerActivityEvent`, its unique index on `idempotencyKey`, all composite and entity indexes, and the `CustomerActivityEvent_userId_fkey` foreign key constraint.

**Pending Operational Step:** Per execution constraints, neither `npx prisma migrate deploy` nor `npx prisma generate` was executed during this session. Both commands remain pending execution in the target environment before runtime activation.

---

## 2. Central Activity Recording Service Design

Implemented `main website/Backend/src/services/activity/customer_activity_service.ts` (`CustomerActivityService`), which uses `customer_activity_taxonomy.ts` as its single source of truth:

1. **`CustomerActivityService.recordEvent(input, options)`**:
   - Validates `userId` and verifies `eventType` via `isCustomerVisibleActivityType(input.eventType)`. Rejects unknown or internal-only event types with `ValidationError`.
   - Applies state-transition deduplication (`dedupeStrategy === 'STATE_TRANSITION'`): suppresses recording when `previousState === nextState` (e.g., `ONLINE -> ONLINE` heartbeat checks).
   - Masks raw IPv4/IPv6 addresses via `maskIpAddressForCustomerDisplay` (`192.168.1.42` -> `192.168.1.xxx`) and summarizes raw `User-Agent` strings into concise client labels (`Chrome on Windows`, `Safari on macOS`, etc.) via `summarizeUserAgentForCustomerDisplay`.
   - Formats minor currency units (`amountMinorUnits` + `currency` -> `formattedAmount`) when not already pre-formatted.
   - Sanitizes metadata via `sanitizeCustomerActivityMetadata(eventType, candidateMetadata)` so only keys listed in the event's `allowedMetadataKeys` are persisted and all `FORBIDDEN_ACTIVITY_METADATA_KEYS` are stripped.
   - Renders the customer-safe description from `definition.customerDescriptionTemplate` with graceful fallback copy when optional placeholders are absent.
   - Enforces idempotency lookup, cooldown window deduplication, and `P2002` unique-constraint race recovery.
2. **`CustomerActivityService.recordEventSafe(input, options)`**:
   - Convenience wrapper that forces `throwOnError: false` so activity recording never aborts primary business flows.
3. **`CustomerActivityService.recordFromAuditEvent(params, options)`**:
   - Maps an internal `AuditEventType` to its customer-visible `CustomerActivityEventType` via `AUDIT_EVENT_TO_CUSTOMER_ACTIVITY_MAP`. Returns `null` without database writes for internal-only `AuditEventType` values.

---

## 3. Wired Event Producers by Category

All 35 customer-visible event types across all 8 taxonomy categories are wired to authoritative backend producers:

| Category | Event Types Wired | Producer File(s) |
| :--- | :--- | :--- |
| **`AUTH`** | `AUTH.SIGN_IN_SUCCEEDED`, `AUTH.SIGN_IN_FAILED`, `AUTH.SIGN_OUT` | `src/routes/auth.ts` |
| **`ACCOUNT`** | `ACCOUNT.CREATED`, `ACCOUNT.EMAIL_VERIFIED` | `src/routes/auth.ts` |
| **`SECURITY`** | `SECURITY.PASSWORD_RESET_REQUESTED`, `SECURITY.PASSWORD_RESET_COMPLETED`, `SECURITY.DEVICE_CREDENTIALS_REVOKED` | `src/routes/auth.ts`, `src/routes/device.ts` |
| **`DEVICE`** | `DEVICE.LINKED`, `DEVICE.UNLINKED` | `src/routes/device.ts` |
| **`SERVER`** | `SERVER.CREATED`, `SERVER.STARTED`, `SERVER.STOPPED`, `SERVER.RENAMED`, `SERVER.REMOTE_TUNNEL_DISCONNECTED` | `src/routes/device.ts`, `src/routes/server.ts`, `src/routes/connection.ts` |
| **`FILE`** | `FILE.UPLOADED`, `FILE.DOWNLOADED`, `FILE.DELETED`, `FILE.FOLDER_CREATED`, `FILE.RENAMED`, `FILE.SERVER_LOGIN_SUCCEEDED`, `FILE.SERVER_LOGIN_FAILED` | `src/routes/file-manager.ts` |
| **`BILLING`** | `BILLING.COUNTRY_CONFIRMED`, `BILLING.PROFILE_UPDATED`, `BILLING.SUBSCRIPTION_CHECKOUT_STARTED`, `BILLING.SUBSCRIPTION_ACTIVATED`, `BILLING.SUBSCRIPTION_RENEWED`, `BILLING.PAYMENT_SUCCEEDED`, `BILLING.PAYMENT_FAILED`, `BILLING.SUBSCRIPTION_PAYMENT_PAST_DUE`, `BILLING.SUBSCRIPTION_GRACE_PERIOD_STARTED`, `BILLING.SUBSCRIPTION_GRACE_PERIOD_RECOVERED`, `BILLING.SUBSCRIPTION_UPGRADED`, `BILLING.SUBSCRIPTION_DOWNGRADE_SCHEDULED`, `BILLING.SUBSCRIPTION_DOWNGRADE_CANCELLED`, `BILLING.SUBSCRIPTION_DOWNGRADE_EFFECTIVE`, `BILLING.SUBSCRIPTION_CANCELLATION_REQUESTED`, `BILLING.SUBSCRIPTION_EXPIRED`, `BILLING.PAYMENT_REFUNDED`, `BILLING.INVOICE_ISSUED`, `BILLING.INVOICE_DOWNLOADED`, `BILLING.RECEIPT_ISSUED`, `BILLING.RECEIPT_DOWNLOADED` | `src/routes/billing.ts`, `billing_country_service.ts`, `billing_profile_service.ts`, `billing_invoice_service.ts`, `billing_receipt_service.ts`, `billing_refund_service.ts`, `billing_state_service.ts`, `dunning_service.ts`, `razorpay_checkout_service.ts`, `razorpay_webhook_service.ts` |
| **`NOTIFICATION`** | `NOTIFICATION.PREFERENCES_UPDATED` | `src/notifications/routes/preference_routes.ts` |

---

## 4. Sanitization & Privacy Controls

1. **Strict Whitelist + Blacklist Enforcement:** Every candidate metadata payload passes through `sanitizeCustomerActivityMetadata(eventType, candidateMetadata)`. Any key not explicitly listed in `definition.allowedMetadataKeys` or present in `FORBIDDEN_ACTIVITY_METADATA_KEYS` (`passwordHash`, `rawToken`, `refreshToken`, `otpHash`, `signature`, `razorpaySignature`, `webhookSecret`, `providerPaymentId`, `providerSubscriptionId`, `providerPlanId`, `providerEventId`, `providerRefundId`, `s3Key`, `storageKey`, `adminNotes`, `stackTrace`, etc.) is stripped before persistence.
2. **IP Address Masking:** Raw client IP addresses are never stored on `CustomerActivityEvent`. Only the masked form (`192.168.1.xxx` or `2001:0db8:85a3:xxxx:xxxx:xxxx:xxxx:xxxx`) is placed in `metadata.maskedIp` when `maskedIp` is in the event's `allowedMetadataKeys`.
3. **User-Agent Summarization:** Raw `User-Agent` headers are summarized into clean `<Browser> on <OS>` strings (`Chrome on Windows`, `Safari on macOS`) before being placed in `metadata.userAgentSummary`.
4. **Anti-Enumeration & Anti-Noise Guarantees:**
   - Failed sign-in attempts (`AUTH.SIGN_IN_FAILED`) are recorded **only** when the email resolves to an existing `User` record (`if (user)`), preventing unauthenticated activity table flooding.
   - File downloads (`FILE.DOWNLOADED`) are recorded **only** on explicit attachment downloads (`!rangeHeader && isDownloadAttachment`), preventing HTTP range/streaming chunk requests from spamming customer activity.

---

## 5. Idempotency & Duplicate-Prevention Rules

1. **Cross-Path Deterministic Idempotency Keys (`@unique idempotencyKey`):**
   - `ACCOUNT.CREATED`: `account_created_${user.id}`
   - `ACCOUNT.EMAIL_VERIFIED`: `account_email_verified_${user.id}`
   - `BILLING.SUBSCRIPTION_CHECKOUT_STARTED`: `checkout_started_${subscription.id}`
   - `BILLING.SUBSCRIPTION_ACTIVATED`: `sub_activated_${subscription.id}` *(shared between synchronous `verifyCheckoutPayment` and asynchronous `subscription.activated` webhook so only one activation event is ever recorded)*
   - `BILLING.PAYMENT_SUCCEEDED`: `payment_succeeded_${payment.id}` *(shared between checkout verification and webhook processing)*
   - `BILLING.INVOICE_ISSUED`: `invoice_issued_${invoice.id}`
   - `BILLING.RECEIPT_ISSUED`: `receipt_issued_${receipt.id}`
   - `BILLING.PAYMENT_REFUNDED`: `payment_refunded_${refundRecord.id}` *(shared between `BillingRefundService` and `RazorpayWebhookService`)*
   - `BILLING.SUBSCRIPTION_EXPIRED`: `sub_expired_${subscription.id}` *(shared between `BillingStateService`, `DunningService`, and `RazorpayWebhookService`)*
   - `BILLING.SUBSCRIPTION_PAYMENT_PAST_DUE`: `past_due_${subscription.id}_${gracePeriodStartedAt.toISOString()}`
   - `BILLING.SUBSCRIPTION_GRACE_PERIOD_STARTED`: `grace_started_${subscription.id}_${gracePeriodStartedAt.toISOString()}`
2. **State-Transition Deduplication (`STATE_TRANSITION`):**
   - `SERVER.STARTED` in `connection.ts` passes `previousState: existingServer.state, nextState: 'ONLINE'`. `CustomerActivityService` suppresses the event if `previousState === 'ONLINE'` or if a `SERVER.STARTED` event was already recorded for the same `serverId` within the 60-second cooldown window.

---

## 6. Error-Handling Policy

- By default (`throwOnError: false` and `CustomerActivityService.recordEventSafe`), any validation or database error inside `CustomerActivityService` is caught and logged via `appLogger.warn('[CustomerActivityService] Failed to record customer activity event (non-blocking)', ...)` and returns `null`.
- Primary customer actions (login, registration, device linking, file upload/download, checkout verification, invoice/receipt issuance, and webhook processing) **never fail** if activity event persistence encounters an error.
- Callers or unit tests that require strict failure propagation can pass `{ throwOnError: true }`.

---

## 7. Files Created or Modified

### Created
1. `main website/Backend/prisma/migrations/20261011104000_add_customer_activity_event/migration.sql`
2. `main website/Backend/src/services/activity/customer_activity_service.ts`
3. `main website/Backend/tests/customer_activity_service.test.ts` (`NOT EXECUTED`)
4. `PHASE-9.2-REPORT.md`

### Modified
1. `main website/Backend/prisma/schema.prisma`
2. `main website/Backend/src/routes/auth.ts`
3. `main website/Backend/src/routes/device.ts`
4. `main website/Backend/src/routes/server.ts`
5. `main website/Backend/src/routes/connection.ts`
6. `main website/Backend/src/routes/file-manager.ts`
7. `main website/Backend/src/notifications/routes/preference_routes.ts`
8. `main website/Backend/src/routes/billing.ts`
9. `main website/Backend/src/services/billing/billing_country_service.ts`
10. `main website/Backend/src/services/billing/billing_profile_service.ts`
11. `main website/Backend/src/services/billing/billing_invoice_service.ts`
12. `main website/Backend/src/services/billing/billing_receipt_service.ts`
13. `main website/Backend/src/services/billing/billing_refund_service.ts`
14. `main website/Backend/src/services/billing/billing_state_service.ts`
15. `main website/Backend/src/services/billing/dunning_service.ts`
16. `main website/Backend/src/services/billing/providers/razorpay/razorpay_checkout_service.ts`
17. `main website/Backend/src/services/billing/providers/razorpay/razorpay_webhook_service.ts`

---

## 8. Static Test Specifications Added (`NOT EXECUTED`)

Authored `main website/Backend/tests/customer_activity_service.test.ts` (`NOT EXECUTED`) covering:
1. Recording customer-visible events across all 8 taxonomy categories (`AUTH`, `ACCOUNT`, `SECURITY`, `DEVICE`, `SERVER`, `FILE`, `BILLING`, `NOTIFICATION`).
2. Rejecting unknown/internal event identifiers in `recordEvent` and ignoring internal `AuditEventType` values in `recordFromAuditEvent`.
3. Stripping forbidden keys (`passwordHash`, `rawToken`, `providerPaymentId`, `razorpaySignature`, `s3Key`, `adminNotes`, `stackTrace`, etc.) and unwhitelisted keys, plus IP masking and User-Agent summarization.
4. Enforcing mandatory `userId` association.
5. Idempotency via `idempotencyKey`, `P2002` race recovery, `STATE_TRANSITION` deduplication, and `cooldownSeconds` suppression.
6. Non-blocking error handling when `throwOnError: false` vs explicit error propagation when `throwOnError: true`.

---

## 9. Final Readiness Verdict

**`IMPLEMENTED`**
