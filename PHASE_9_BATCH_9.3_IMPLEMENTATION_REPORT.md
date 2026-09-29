# ZDEXCLOUD — PHASE 9 — BATCH 9.3 IMPLEMENTATION REPORT
## ADMIN PAYMENT & REFUND OPERATIONS

**Execution Timestamp:** 2026-09-29T20:05:00Z  
**Branch / Repository:** `fileservernode-sys/file-server-node` (`main`)  
**Phase Identifier:** `Phase 9 — Batch 9.3`  
**Operational Status:** COMPLETED (Hard-Stopped)  
**Test Execution Policy:** Strictly Deferred (`Tests Executed: NONE`)  
**Build Status:** Clean TypeScript Compilation (`Exit Code: 0`)

---

## 1. EXECUTIVE SUMMARY

Phase 9 — Batch 9.3 delivers the **Admin Payment & Refund Operations** control-plane subsystem for ZdexCloud. Building directly on Batch 9.1 (Foundation & Audit) and Batch 9.2 (Subscription Lifecycle), this batch implements a complete administrative transaction ledger for payments and refunds, real-time payment provider (Razorpay) diagnostic sync, and safe administrative refund execution with integer minor unit math, concurrency balance guards, idempotency keys, and tamper-evident SHA-256 chained audit logging.

All operations strictly reuse the existing `BillingRefundService` and `RazorpayClient` without creating duplicate engines or altering customer-facing checkout flows.

---

## 2. EXISTING PAYMENT ARCHITECTURE

The ZdexCloud payment pipeline operates as follows:
- When subscriptions renew or customers purchase upgrades, transactions are recorded as `BillingPayment` records.
- Each payment stores monetary values in **integer minor units** (`amountMinorUnits`), currency code (`INR`, `USD`), payment status (`PENDING`, `SUCCESS`, `FAILED`, `REFUNDED`), and provider transaction references (`providerPaymentId`, `providerSubscriptionId`).
- Payments are linked to `BillingReceipt` records (sequential invoice numbering), `BillingPaymentTax` (jurisdiction, tax basis points, inclusive/exclusive taxes), and `BillingPaymentProcessingFee` (gateway fees and net settlement amounts).

---

## 3. EXISTING REFUND ARCHITECTURE

Refunds are modeled through `BillingRefund` and managed by `BillingRefundService`:
- Each refund record tracks `amountMinorUnits`, `currency`, `reason` (`RefundReason`), `status` (`REQUESTED`, `PROCESSING`, `PROCESSED`, `FAILED`), and upstream references (`providerRefundId`).
- `BillingRefundService.validateRefundEligibility` verifies whether a payment is refundable, calculates cumulative refunded amounts across non-failed records, verifies remaining balance, and enforces commercial policy.
- `BillingRefundService.requestRefund` manages transactional allocation, invokes `RazorpayClient.createRefund`, records audit logs, and coordinates downstream events.

---

## 4. PAYMENT MODEL INVENTORY

From `prisma/schema.prisma`:
- **`BillingPayment`**:
  - `id`: String (UUID PK)
  - `userId`: String (Customer FK)
  - `subscriptionId`: String (Subscription FK, optional)
  - `provider`: PaymentProvider (`RAZORPAY`)
  - `environment`: PaymentEnvironment (`TEST` | `LIVE`)
  - `providerPaymentId`: String (External transaction ID)
  - `providerSubscriptionId`: String (External subscription reference)
  - `amountMinorUnits`: Int (Monetary value in cents / paise)
  - `currency`: CurrencyCode (`INR`, `USD`)
  - `status`: PaymentStatus (`PENDING`, `SUCCESS`, `FAILED`, `REFUNDED`)
  - `chargedAt`: DateTime
  - `createdAt`, `updatedAt`: DateTime
  - Relations: `user`, `subscription`, `receipt`, `tax`, `processingFee`, `refunds`, `reconciliationRecords`

---

## 5. REFUND MODEL INVENTORY

From `prisma/schema.prisma`:
- **`BillingRefund`**:
  - `id`: String (UUID PK)
  - `userId`: String (Customer FK)
  - `subscriptionId`: String (Optional)
  - `paymentId`: String (BillingPayment FK)
  - `provider`: PaymentProvider (`RAZORPAY`)
  - `environment`: PaymentEnvironment (`TEST` | `LIVE`)
  - `providerRefundId`: String (External refund reference)
  - `providerPaymentId`: String (External payment reference)
  - `amountMinorUnits`: Int
  - `currency`: CurrencyCode
  - `reason`: RefundReason (`ADMIN_APPROVED_EXCEPTION`, `DUPLICATE_PAYMENT`, `ERRONEOUS_PAYMENT`, `TECHNICAL_SERVICE_FAILURE`, `ANNUAL_WITHIN_REFUND_WINDOW`, `OTHER_APPROVED`)
  - `reasonDetails`: String (Optional text)
  - `status`: RefundStatus (`REQUESTED`, `PROCESSING`, `PROCESSED`, `FAILED`)
  - `idempotencyKey`: String (Unique constraint)
  - `requestedBy`: String (Admin ID or customer ID)
  - `requestedAt`, `providerRequestedAt`, `providerProcessedAt`: DateTime
  - `failureCode`, `failureReason`: String (Optional)

---

## 6. PAYMENT STATE MACHINE

```
+---------------------------------------------------------------------------------------------------+
| State      | Semantics                        | Provider Mapping     | Allowed Admin Actions      |
+------------+----------------------------------+----------------------+----------------------------+
| PENDING    | Awaiting authorization/capture   | created/authorized   | Inspect, Sync Provider     |
| SUCCESS    | Fully captured and settled       | captured             | Inspect, Sync, Refund      |
| FAILED     | Declined or payment error        | failed               | Inspect, Sync Provider     |
| REFUNDED   | Fully refunded to original card  | refunded             | Inspect, Sync Provider     |
+---------------------------------------------------------------------------------------------------+
```

---

## 7. REFUND STATE MACHINE

```
+---------------------------------------------------------------------------------------------------+
| State        | Local Semantics                  | Upstream Status      | Trigger Event            |
+--------------+----------------------------------+----------------------+--------------------------+
| REQUESTED    | Refund request initiated         | N/A                  | Admin / User request     |
| PROCESSING   | Sent to provider, awaiting webhook| pending/processing  | Razorpay API response    |
| PROCESSED    | Settled and returned to customer | processed            | refund.processed webhook |
| FAILED       | Rejected by provider/bank        | failed               | refund.failed webhook    |
+---------------------------------------------------------------------------------------------------+
```

---

## 8. ADMIN PAYMENT APIS

### 8.1 List Payments
- **Endpoint**: `GET /api/v1/admin/operations/billing/payments`
- **Permission**: `billing.read`
- **Query Filters**: `page`, `pageSize`, `search`, `status`, `currency`, `userId`, `subscriptionId`, `providerPaymentId`, `startDate`, `endDate`
- **Response**: Paginated summary with tax, fee, and refund totals.

### 8.2 Get Payment Detail
- **Endpoint**: `GET /api/v1/admin/operations/billing/payments/:id`
- **Permission**: `billing.read`
- **Response**: Full transaction detail including receipt items, tax breakdown, gateway processing fees, net settlement, refund history, and reconciliation run links.

### 8.3 Provider Payment Inspection
- **Endpoint**: `GET /api/v1/admin/operations/billing/payments/:id/provider-sync`
- **Permission**: `billing.read`
- **Response**: Read-only comparison of local database records against live Razorpay payment data with sanitized metadata and explicit mismatch diagnostics.

---

## 9. ADMIN REFUND APIS

### 9.1 List Refunds
- **Endpoint**: `GET /api/v1/admin/operations/billing/refunds`
- **Permission**: `billing.read`
- **Query Filters**: `page`, `pageSize`, `search`, `status`, `reason`, `userId`, `paymentId`, `providerRefundId`, `startDate`, `endDate`
- **Response**: Paginated summary of customer refund records.

### 9.2 Get Refund Detail
- **Endpoint**: `GET /api/v1/admin/operations/billing/refunds/:id`
- **Permission**: `billing.read`
- **Response**: Full refund details with linked payment, subscription tier, and reconciliation linkage.

### 9.3 Provider Refund Inspection
- **Endpoint**: `GET /api/v1/admin/operations/billing/refunds/:id/provider-sync`
- **Permission**: `billing.read`
- **Response**: Live Razorpay refund status comparison with mismatch diagnostics and sanitized payload.

### 9.4 Execute Refund
- **Endpoints**:
  - `POST /api/v1/admin/operations/billing/payments/:id/refund`
  - `POST /api/v1/admin/operations/billing/refunds` (with `paymentId` in request body)
- **Permission**: `billing.refund`
- **Request Body**:
  ```json
  {
    "amountMinorUnits": 50000,
    "reason": "ADMIN_APPROVED_EXCEPTION",
    "reasonDetails": "Support ticket escalation #8921",
    "idempotencyKey": "ref_idem_c8a9128d-192a",
    "terminateSubscription": false
  }
  ```
- **Response**: `{ success: true, refund: AdminRefundDetail, payment: { id, amountMinorUnits, cumulativeRefundedMinorUnits, remainingRefundableMinorUnits, status }, idempotent?: boolean }`

---

## 10. PROVIDER INTEGRATION

- Reuses existing `RazorpayClient` transport located at `Backend/src/services/billing/providers/razorpay/razorpay_client.ts`.
- Uses `client.fetchPayment(providerPaymentId)` for read-only payment inspection.
- Uses `client.fetchRefund(providerRefundId)` for read-only refund inspection.
- Uses `client.createRefund(providerPaymentId, params)` for external transaction dispatch.
- **Zero Duplicate HTTP Clients**: All external traffic flows through the canonical provider client.

---

## 11. FULL REFUND BEHAVIOR

- When `amountMinorUnits` is omitted or equals the remaining refundable balance:
  1. The remaining refundable balance is refunded in full.
  2. If the cumulative refunded amount reaches the total payment amount, the `BillingPayment.status` transitions to `REFUNDED`.
  3. If `terminateSubscription` is `true`, the linked subscription is marked `EXPIRED` and the user's billing state reverts to `FREE`.

---

## 12. PARTIAL REFUND BEHAVIOR

- An administrator can specify any integer amount `0 < amountMinorUnits <= remainingRefundableAmount`.
- The remaining refundable balance is recalculated dynamically:
  $$\text{Remaining} = \text{Payment Amount} - \sum \text{Active Refunds}$$
- Successive partial refunds are tracked independently, each receiving an individual `BillingRefund` record and provider refund reference.

---

## 13. REFUND ELIGIBILITY

Enforced via `BillingRefundService.validateRefundEligibility`:
1. Payment must exist and have status `SUCCESS` or `REFUNDED` (with remaining balance).
2. Payment must possess a valid `providerPaymentId`.
3. Requested refund amount must be an integer $> 0$.
4. Requested refund amount must not exceed remaining refundable balance.
5. Administrators with `isAdmin: true` can issue refunds under `ADMIN_APPROVED_EXCEPTION` regardless of subscription interval cooling windows.

---

## 14. IDEMPOTENCY

1. `AdminExecuteRefundSchema` accepts an optional `idempotencyKey` (defaults to a generated UUID if omitted).
2. If a request with an existing `idempotencyKey` is received:
   - If the previous refund is `REQUESTED`, `PROCESSING`, or `PROCESSED`, the existing record is returned with `idempotent: true` without invoking Razorpay a second time.
3. Razorpay's `X-Refund-Idempotency` header is forwarded with the unique idempotency key to prevent double charging upstream.

---

## 15. CONCURRENCY PROTECTION

To prevent race conditions where concurrent operators attempt to refund more than the original payment:
1. `BillingRefundService.requestRefund` evaluates the refundable balance inside a Prisma database transaction (`prisma.$transaction`).
2. The transaction re-queries and sums all non-failed refunds for the payment row.
3. If $\text{currentTotal} + \text{requestedAmount} > \text{payment.amountMinorUnits}$, the transaction immediately aborts with `ConflictError('REFUND_AMOUNT_EXCEEDS_REFUNDABLE')`.

---

## 16. RBAC MATRIX

| Operation | Permission Required | Roles Authorized |
| :--- | :--- | :--- |
| Inspect Payments | `billing.read` | SUPER_ADMIN, BILLING_ADMIN, AUDITOR |
| Inspect Refunds | `billing.read` | SUPER_ADMIN, BILLING_ADMIN, AUDITOR |
| Check Provider Sync | `billing.read` | SUPER_ADMIN, BILLING_ADMIN |
| Execute Payment Refund | `billing.refund` | SUPER_ADMIN, BILLING_ADMIN |
| Cancel Subscription | `billing.write` | SUPER_ADMIN, BILLING_ADMIN |
| Reconciliation Actions | `billing.reconcile` | SUPER_ADMIN, BILLING_ADMIN |

---

## 17. OBJECT AUTHORIZATION

- Payments and refunds are verified by primary key lookup.
- If the payment or refund does not exist, a `NotFoundError (404)` is returned.
- Target user ownership is verified and linked to the refund audit record.
- Destination payment routing is immutable: refunds can only be sent back to the original funding instrument on Razorpay.

---

## 18. AUDIT EVENTS

All refund mutations are executed via `executeAdminOperation`:
- **Action**: `AdminAuditAction.ADMIN_STATUS_UPDATED`
- **Target**: `billing_payment` / `<paymentId>`
- **Metadata Logged**:
  ```json
  {
    "paymentId": "pay_uuid",
    "userId": "user_uuid",
    "userEmail": "customer@example.com",
    "amountMinorUnits": 50000,
    "currency": "INR",
    "reason": "ADMIN_APPROVED_EXCEPTION",
    "reasonDetails": "Customer support escalation",
    "idempotencyKey": "ref_idem_12345",
    "terminateSubscription": false
  }
  ```
- **Integrity**: Appended to the immutable SHA-256 cryptographic chain. Fails closed if the audit ledger cannot persist.

---

## 19. SECRET PROTECTION

- **Zero Secret Exposure**: Provider API keys, webhook signing secrets, database credentials, card numbers, and CVVs are strictly sanitized.
- `inspectProviderPayment` and `inspectProviderRefund` scrub raw responses and return only safe diagnostics (e.g. card network, last 4 digits, bank name, payment method).

---

## 20. WEBHOOK INTEGRATION

- Upstream Razorpay webhooks (`refund.created`, `refund.processed`, `refund.failed`) continue to be received by `Backend/src/routes/billing/webhooks/razorpay.ts`.
- When Razorpay emits `refund.processed`, the existing webhook handler transitions `BillingRefund.status` from `PROCESSING` to `PROCESSED`.
- If the payment is now fully refunded, the webhook handler updates `BillingPayment.status` to `REFUNDED`.

---

## 21. UI CHANGES

In [`Frontend/admin/js/admin-shell.js`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Frontend/admin/js/admin-shell.js):
1. **Navigation**: Added `Payments & Transactions` (`#payments`) and `Refunds & Returns` (`#refunds`) to the `Commercial & Billing` group.
2. **Payments View**:
   - Filter bar with search, status dropdown, and currency filter.
   - Transaction table with customer email, amount, status badge, refund badge, and provider reference.
   - Detail drawer with Payment Overview, Financial Breakdown (taxes, fees, net settlement), Razorpay Provider Sync card, and attached Refund History.
   - Refund Action Modal displaying total amount, available balance, amount input, reason selector, and warning notices.
3. **Refunds View**:
   - Filter bar with search, status dropdown, and reason filter.
   - Table with refund ID, customer email, amount, reason, status, requested by/at, and provider refund reference.
   - Detail drawer with Refund Overview, Associated Payment Record, and Razorpay Provider Sync card.

---

## 22. OBSERVABILITY

- All billing operations log structured request events including `requestId`, `adminId`, `durationMs`, and HTTP status.
- Provider synchronization discrepancies are logged as structured warnings for triage.
- Audit records provide granular traceability for every financial mutation.

---

## 23. ERROR HANDLING

| Error Scenario | HTTP Status | Error Code | Mitigation |
| :--- | :--- | :--- | :--- |
| Payment not found | 404 | `NOT_FOUND` | Safe error message |
| Refund exceeds remaining balance | 409 | `REFUND_AMOUNT_EXCEEDS_REFUNDABLE` | Aborts transaction with conflict detail |
| Invalid refund amount $\le 0$ | 400 | `VALIDATION_ERROR` | Rejected by Zod schema |
| Missing `billing.refund` permission | 403 | `FORBIDDEN` | Blocked by `requireOperationPermission` |
| Upstream Razorpay API timeout | 502/504 | `PROVIDER_TIMEOUT` | Safely caught; error reported without corrupting state |

---

## 24. SECURITY FINDINGS

- **No IDOR**: Operations verify database entities and user ownership before executing mutations.
- **No Arbitrary Payout Destinations**: Refunds are strictly tied to the original transaction ID.
- **XSS Prevention**: All frontend rendered strings pass through `AdminShell._escape()`.

---

## 25. PERFORMANCE CONSIDERATIONS

- Queries use indexed columns (`userId`, `status`, `currency`, `chargedAt`, `requestedAt`).
- Bounded pagination defaults to 20 items (max 100).
- External Razorpay API calls are on-demand only (inspection drawers or explicit refund actions) and never run inside table list queries.

---

## 26. FILES CREATED

- None (All changes extended existing modular architecture cleanly).

---

## 27. FILES MODIFIED

| File Path | Description of Modifications |
| :--- | :--- |
| `Backend/src/routes/admin/operations/billing/types.ts` | Added DTOs for `AdminProviderPaymentInspectionResult`, `AdminProviderRefundInspectionResult`, `AdminExecuteRefundBody`, and `AdminExecuteRefundResult`. |
| `Backend/src/routes/admin/operations/billing/schemas.ts` | Added `AdminExecuteRefundSchema` and exported `AdminExecuteRefundInput`. |
| `Backend/src/routes/admin/operations/billing/service.ts` | Implemented `inspectProviderPayment`, `inspectProviderRefund`, and `executePaymentRefund`. |
| `Backend/src/routes/admin/operations/billing/index.ts` | Registered endpoints for payment sync, refund execution, and refund sync with RBAC guards. |
| `Backend/tests/admin_billing_operations.test.ts` | Expanded deferred test suite with validation and service contract tests for Batch 9.3. |
| `Frontend/admin/js/admin-shell.js` | Added Payments and Refunds navigation items, data tables, drawers, provider sync actions, and refund modal. |

---

## 28. STATIC VALIDATION

Executed static build verification via `npm run build`:
```
> remote-node-backend@1.0.0 build
> prisma generate && tsc -p tsconfig.json && node -e "const fs = require('fs'); if (fs.existsSync('src/gateway/web')) fs.cpSync('src/gateway/web', 'dist/gateway/web', {recursive: true, force: true});"

Prisma schema loaded from prisma\schema.prisma
✔ Generated Prisma Client (v5.22.0) to .\node_modules\@prisma\client in 2.19s

Process finished with exit code 0.
```
- **Static TypeScript Errors:** 0
- **Syntax / Build Failures:** 0

---

## 29. TESTS CREATED / UPDATED

Updated [`Backend/tests/admin_billing_operations.test.ts`](file:///d:/YOUM%20PATEL/Desktop/Projects/File%20Server%20Project/main%20website/Backend/tests/admin_billing_operations.test.ts):
- Added schema tests for `AdminExecuteRefundSchema` (validating reasons, details, idempotency keys, and rejecting zero/negative amounts).
- Added method interface assertions for `inspectProviderPayment`, `inspectProviderRefund`, and `executePaymentRefund`.

---

## 30. EXPLICIT NO-TEST-EXECUTION STATEMENT

**Tests created/updated but NOT EXECUTED. Test execution is deferred to the final verification phase.**  
**Tests Executed: NONE.**

---

## 31. CUSTOMER BILLING PRESERVATION

- Customer checkout, webhook processing, payment verification, and customer self-service refund requests remain completely intact and functional.
- Zero modifications to customer billing state machine or payment controllers.

---

## 32. SCOPE COMPLIANCE

- No reconciliation engine implemented (Deferred to Batch 9.4).
- No settlement matching implemented (Deferred to Batch 9.4).
- No revenue analytics implemented.
- No secondary Razorpay client created.
- No customer file contents accessed.

---

## 33. REMAINING PHASE 9 WORK

- **Batch 9.4**: Billing Reconciliation Engine, Provider Discrepancy Resolution & Settlement Matching.
- **Batch 9.5**: Expanded Billing Control Plane UI & Operational Billing Console Integration.

---

## 34. FINAL STATUS

**PHASE 9 — BATCH 9.3 COMPLETED & HARD STOPPED**
