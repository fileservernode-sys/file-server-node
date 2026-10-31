# ZDEXCLOUD | PHASE 8.4 | BATCH C REPORT
## AUTHENTICATED CUSTOMER INVOICE PDF DOWNLOAD

**Date:** 2026-10-10  
**Phase:** 8.4 (Invoice Document Delivery & Archival)  
**Batch:** C (Authenticated Customer Invoice PDF Download)  
**Status:** COMPLETE  
**Final Verdict:** `CUSTOMER PDF DOWNLOAD IMPLEMENTED WITH DOCUMENTED LIMITATIONS`

---

## 1. Executive Summary

Phase 8.4 Batch C implements an authenticated, IDOR-safe, ownership-protected PDF download endpoint for statutory invoices in ZdexCloud's Node.js backend (`main website/Backend/`).

The implementation establishes:
1. **Authenticated Customer Download Route:** Registered `GET /api/v1/billing/invoices/:id/download` under [`billingRoutes`](main website/Backend/src/routes/billing.ts) in Fastify with `expensiveCustomerRateLimitConfig` protection (Tier D: 20 req/min per user+IP).
2. **Server-Side Ownership Enforcement (IDOR Defense):** Uses [`BillingInvoiceService.getInvoiceById`](main website/Backend/src/services/billing/billing_invoice_service.ts) with `requestingUserId = user.id` and `isAdmin = false`. If the invoice does not exist or belongs to another user, it fails closed with a consistent, non-disclosing `NotFoundError` (HTTP 404). Client-supplied identity claims are never trusted.
3. **Lifecycle State Guarding:** Customers are strictly prohibited from downloading unissued `DRAFT` invoices (returns 404). Historical `ISSUED`, `VOIDED`, and `SUPERSEDED` invoices may be downloaded by their owner, with lifecycle status clearly and prominently rendered in the document.
4. **Zero Side-Effects Invariant:** The download endpoint performs pure read-only transformations from persisted `BillingInvoice` snapshots. It never creates, issues, numbers, recalculates, or mutates invoices, payments, subscriptions, or sequences.
5. **HTTP & Header Hardening:** Emits `Content-Type: application/pdf`, `X-Content-Type-Options: nosniff`, and private caching directives (`Cache-Control: private, no-store, must-revalidate`). Attachment filenames are sanitized via [`BillingInvoiceDocumentService.sanitizeFilename`](main website/Backend/src/services/billing/billing_invoice_document_service.ts) with CR/LF header injection stripping. Internal primary keys (`doc.id`), payment provider secrets, and raw internal metadata are excluded from filenames, headers, and document output.
6. **Error Shielding:** Any internal rendering or buffer assembly exception is caught, logged securely without PII or sensitive data, and converted into a generic operational `AppError` (HTTP 500), preventing stack traces or raw error fragments from leaking as responses.
7. **Static Test Suite:** Authored 14 comprehensive test specifications in [`tests/customer_invoice_download.test.ts`](main website/Backend/tests/customer_invoice_download.test.ts), left unexecuted per mandatory policy.

---

## 2. Exact Files Inspected, Changed, and Created

### 2.1 Files Inspected
- [`main website/Backend/src/routes/billing.ts`](main website/Backend/src/routes/billing.ts)
- [`main website/Backend/src/services/billing/billing_invoice_service.ts`](main website/Backend/src/services/billing/billing_invoice_service.ts)
- [`main website/Backend/src/services/billing/billing_invoice_document_service.ts`](main website/Backend/src/services/billing/billing_invoice_document_service.ts)
- [`main website/Backend/src/middleware/customer-auth.ts`](main website/Backend/src/middleware/customer-auth.ts)
- [`main website/Backend/src/middleware/rate_limit_presets.ts`](main website/Backend/src/middleware/rate_limit_presets.ts)
- [`main website/Backend/src/app.ts`](main website/Backend/src/app.ts)
- [`main website/Backend/package.json`](main website/Backend/package.json)
- [`main website/Backend/package-lock.json`](main website/Backend/package-lock.json)

### 2.2 Files Modified
- [`main website/Backend/src/routes/billing.ts`](main website/Backend/src/routes/billing.ts):
  - Added imports for `BillingInvoiceStatus`, `NotFoundError`, `AppError`, and `BillingInvoiceDocumentService`.
  - Implemented `downloadInvoiceHandler` and registered `GET /billing/invoices/:id/download` with `expensiveCustomerRateLimitConfig`.

### 2.3 Files Created
- [`main website/Backend/tests/customer_invoice_download.test.ts`](main website/Backend/tests/customer_invoice_download.test.ts): Static test specifications covering 14 verification scenarios.
- [`main website/Backend/PHASE-8.4-BATCH-C-REPORT.md`](main website/Backend/PHASE-8.4-BATCH-C-REPORT.md): Batch C technical audit report.
- [`PHASE-8.4-BATCH-C-REPORT.md`](PHASE-8.4-BATCH-C-REPORT.md): Root workspace copy of Batch C technical audit report.

---

## 3. Exact Route and Authentication/Ownership Enforcement

### 3.1 Route Resolution
- Fastify registers `apiV1Routes` with prefix `/api/v1` in `src/app.ts`.
- `apiV1Routes` registers `billingRoutes` in `src/routes/index.ts`.
- `billingRoutes` registers `GET /billing/invoices/:id/download`.
- **Authoritative URL:** `GET /api/v1/billing/invoices/:id/download`.

### 3.2 Authentication & IDOR Protection Flow
1. **Authentication:** [`getAuthUser(request)`](main website/Backend/src/middleware/customer-auth.ts) extracts and cryptographically verifies the customer session token (from `Authorization: Bearer <token>` or HttpOnly cookie `__Host-zdex_session`). If absent or invalid, it throws `UnauthorizedError` (HTTP 401).
2. **Database Lookup:** Calls [`BillingInvoiceService.getInvoiceById(id, user.id, false)`](main website/Backend/src/services/billing/billing_invoice_service.ts).
3. **Ownership Gate:**
   ```typescript
   if (!invoice || (!isAdmin && invoice.userId !== requestingUserId)) {
     throw new NotFoundError(`BillingInvoice ${invoiceId} not found`);
   }
   ```
4. **Non-Disclosure Guarantee:** An attempt by Customer B to access Customer A's invoice produces the exact same `NotFoundError` (HTTP 404) as a non-existent invoice ID, completely preventing IDOR enumeration or existence discovery.

---

## 4. Invoice Lifecycle States Allowed and Rejected

| Lifecycle State | Allowed for Customer Download? | Behavior & Visual Presentation | Source Evidence |
| :--- | :--- | :--- | :--- |
| **`ISSUED`** | **YES** | Downloads normal Tax Invoice with green `"PAID / SETTLED"` or amber `"PAYMENT PENDING"` badge. | [`billing.ts`](main website/Backend/src/routes/billing.ts) |
| **`VOIDED`** | **YES** | Allowed for historical audit access. Renders prominent red `"VOIDED"` banner and void reason. | [`billing_invoice_document_service.ts`](main website/Backend/src/services/billing/billing_invoice_document_service.ts) |
| **`SUPERSEDED`** | **YES** | Allowed for historical audit access. Renders prominent orange `"SUPERSEDED"` banner and replacement text without exposing internal DB IDs. | [`billing_invoice_document_service.ts`](main website/Backend/src/services/billing/billing_invoice_document_service.ts) |
| **`DRAFT`** | **NO** | Strictly blocked. Throws `NotFoundError` (`BillingInvoice ${id} not found`), preventing customer access to unissued internal records. | [`billing.ts`](main website/Backend/src/routes/billing.ts) |

---

## 5. PDF Document-Service Call and Snapshot Source

### 5.1 Invocation Contract
- The route passes the authoritative `BillingInvoice` entity returned by Prisma directly to [`BillingInvoiceDocumentService.generateInvoicePdf(invoice)`](main website/Backend/src/services/billing/billing_invoice_document_service.ts).
- Mapping via [`mapInvoiceToDocumentModel`](main website/Backend/src/services/billing/billing_invoice_document_service.ts) strictly reads historical snapshot fields:
  - Seller: `sellerName`, `sellerAddress`, `sellerTaxId` (GSTIN 06-Haryana), `sellerSupportEmail`.
  - Recipient: `customerName`, `customerEmail`, `customerTaxId`, `billingAddress`.
  - Financials: `subtotalMinorUnits`, `discountMinorUnits`, `taxMinorUnits`, `totalMinorUnits`, `amountPaidMinorUnits`, `amountDueMinorUnits`.
  - Taxes: `hsnSacCode` (998313), `taxRateBasisPoints` (1800), `taxBreakdown` (CGST/SGST/IGST).
- **Recalculation Prohibition:** The route never calls `TaxCalculationService`, `PlanCatalog`, `StatutorySellerConfigService`, or external exchange rate services.

---

## 6. Response Headers, Filename Handling, Rate Limiting, and Error Behavior

### 6.1 HTTP Response Headers
- `Content-Type: application/pdf`
- `Content-Disposition: attachment; filename="invoice-ZCI-2026-2027-000200.pdf"`
- `X-Content-Type-Options: nosniff`
- `Cache-Control: private, no-store, must-revalidate`
- `Pragma: no-cache`
- `Expires: 0`

### 6.2 Filename Handling
- Generated via `BillingInvoiceDocumentService.sanitizeFilename(invoice.invoiceNumber)`.
- Replaces `/`, `\`, colons, directory traversal `..`, and forbidden characters with `-`.
- Strips CR/LF characters (`\r`, `\n`) to eliminate header injection vectors.
- Derived strictly from human-facing `invoiceNumber`, never leaking database primary keys (`doc.id`).

### 6.3 Rate Limiting
- Configured with `expensiveCustomerRateLimitConfig`:
  - Limit: 20 requests per minute per (User ID + Client IP).
  - Protects Node.js event loop and RAM against unthrottled concurrent PDF generation.

### 6.4 Error Shielding
- `BillingInvoiceDocumentService.generateInvoicePdf` errors are wrapped in a `try...catch` block.
- Error details are logged via `request.log.error` with request ID correlation.
- The route throws `new AppError('Unable to generate invoice document. Please try again later.', 500)`, ensuring no stack traces, memory dumps, or partial buffers are sent to the client.

---

## 7. Source-Level Privacy and No-Side-Effect Findings

| Invariant | Implementation Mechanism | Audit Status |
| :--- | :--- | :--- |
| **No Internal ID Exposure** | Filenames and document text exclude `doc.id`, `paymentId`, and `supersededByInvoiceId`. | **VERIFIED** |
| **No Provider Secrets** | Provider payment IDs (`razorpay_payment_id`, `order_id`), webhooks, and raw JSON payloads are suppressed. | **VERIFIED** |
| **No Sequence Allocation** | `BillingInvoiceSequenceService.allocateNextNumber` is NEVER called by download route. | **VERIFIED** |
| **No Financial Mutation** | Zero database `UPDATE`, `INSERT`, or `DELETE` on billing tables. | **VERIFIED** |
| **Audit Logging Safety** | Emits non-blocking `BILLING_INVOICE_DOWNLOAD_REQUESTED` event recording only `userId`, `invoiceId`, and `invoiceNumber`. | **VERIFIED** |

---

## 8. Static Test Specification Inventory

The static test suite [`tests/customer_invoice_download.test.ts`](main website/Backend/tests/customer_invoice_download.test.ts) covers 14 distinct scenarios:

1. `Unauthenticated download is rejected with UnauthorizedError (401)`.
2. `Authenticated owner can download eligible ISSUED invoice`.
3. `Customer cannot download another customer's invoice (IDOR fail-closed with NotFoundError)`.
4. `Missing and foreign invoice IDs produce identical non-disclosing 404 responses`.
5. `Attempting to download a DRAFT invoice throws NotFoundError`.
6. `VOIDED and SUPERSEDED invoices can be downloaded by owner with visible status watermark`.
7. `Download request performs read-only transformation without allocating next sequence`.
8. `Download route does not mutate payment status, plan catalog, or tax configurations`.
9. `Response sets Content-Type, Content-Disposition, and private Cache-Control headers`.
10. `Filename and document output exclude providerPaymentId, providerOrderId, and doc.id`.
11. `Download endpoint applies expensiveCustomerRateLimitConfig preset (20 req/min)`.
12. `Renders exact snapshot figures (taxMinorUnits, totalMinorUnits) without live recalculation`.
13. `Internal PDF builder failures are transformed into sanitized operational AppError (500)`.
14. `Download route path is unique and explicitly protected by customer session guard`.

*Operational Notice: All tests begin with `// NOTE: These tests are NOT EXECUTED as per policy.` and were left unexecuted.*

---

## 9. Current Manifest / Lockfile Findings

- **Manifest (`package.json`):** Declares `"pdfkit": "^0.15.0"` and `"@types/pdfkit": "^0.13.4"`.
- **Lockfile (`package-lock.json`):** Does not contain `pdfkit` or `@types/pdfkit`.
- **Status:** Unresolved prerequisite. Lockfile synchronization must be performed in an authorized runtime/build environment prior to deployment. Source implementation was performed against declared module contracts without executing prohibited package manager commands.

---

## 10. Remaining Deployment, Legal/Tax, Font, and Operational Limitations

1. **Lockfile Synchronization:** Run `npm update --package-lock-only` in an approved deployment pipeline.
2. **Statutory Tax Review:** Actual legal and tax compliance remains subject to formal review and sign-off by an authorized human representative or tax adviser.
3. **Font Limitations:** PDFKit Type 1 font does not support Unicode Indian Rupee symbol `₹`; PDF falls back to ASCII `"INR "`. Bundling a TrueType font (e.g. SIL OFL Noto Sans) remains an optional enhancement.
4. **Memory / Concurrency:** The endpoint generates complete PDF buffers in memory (< 20 MB estimated per single document). For high concurrency on Render's 512 MB RAM container, `expensiveCustomerRateLimitConfig` (20 req/min) must remain active.

---

## 11. Final Verdict

```
================================================================================
FINAL VERDICT:
CUSTOMER PDF DOWNLOAD IMPLEMENTED WITH DOCUMENTED LIMITATIONS
================================================================================
```
