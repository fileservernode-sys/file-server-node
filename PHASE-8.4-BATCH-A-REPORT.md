# ZDEXCLOUD | PHASE 8.4 | BATCH A
## INVOICE DOCUMENT DELIVERY ARCHITECTURE AUDIT & IMPLEMENTATION PLAN

**Workspace:** `D:\YOUM PATEL\Desktop\Projects\File Server Project\main website\Backend\`  
**Execution Mode:** Read-only source audit, dependency discovery, risk analysis, and implementation planning only.  
**Operational Status:** Zero tests executed, zero builds/type-checks run, zero database queries/mutations, zero migrations, zero backfills, and zero financial/email operations.

---

## 1. EXACT FILES INSPECTED

### Core Invoicing & Billing Files
- `main website/Backend/src/services/billing/billing_invoice_service.ts`
- `main website/Backend/src/services/billing/billing_invoice_sequence_service.ts`
- `main website/Backend/src/services/billing/billing_invoice_recovery_service.ts`
- `main website/Backend/src/services/billing/billing_receipt_service.ts`
- `main website/Backend/src/services/billing/tax_calculation_service.ts`
- `main website/Backend/src/services/billing/statutory_seller_config_service.ts`
- `main website/Backend/src/routes/billing.ts`
- `main website/Backend/src/routes/admin/operations/billing/index.ts`
- `main website/Backend/src/routes/admin/operations/billing/service.ts`

### Data Schema & Environment
- `main website/Backend/prisma/schema.prisma`
- `main website/Backend/package.json`
- `main website/Backend/src/config/env.ts`
- `main website/Backend/src/utils/security.ts`

### Email, Notification & Queue Infrastructure
- `main website/Backend/src/services/email.ts`
- `main website/Backend/src/services/email_tracking_service.ts`
- `main website/Backend/src/notifications/workers/delivery_processor.ts`
- `main website/Backend/src/notifications/services/channel_router.ts`
- `main website/Backend/src/notifications/repositories/notification_repository.ts`
- `main website/Backend/src/routes/admin/operations/system/jobs/service.ts`

### Customer Authorization & Security
- `main website/Backend/src/middleware/customer-auth.js` / `.ts`
- `main website/Backend/src/middleware/rate_limit_presets.ts`
- `main website/Backend/src/routes/file-manager.ts`

---

## 2. EXISTING CAPABILITIES CONFIRMED BY SOURCE

1. **Authoritative Statutory Invoice Persistence**:
   - `BillingInvoice` table persists 32+ canonical snapshot fields including sequential financial-year numbering (`ZCI/2026-2027/000001`), tax breakdown (CGST/SGST/IGST/SAC 998313), seller snapshot, and customer snapshot.
   - Enforces unique one-to-one constraint on `paymentId` (`billing_invoice_payment_uniq`).
2. **Customer Invoice Retrieval Endpoints**:
   - `GET /api/v1/billing/invoices`: Paginated invoice listing for authenticated customer.
   - `GET /api/v1/billing/invoices/:id`: Single invoice lookup with strict IDOR ownership check (`invoice.userId !== requestingUserId` throws 404 `NotFoundError` to prevent user enumeration).
   - `GET /api/v1/billing/payments/:id/invoice`: Invoice lookup by associated payment ID.
   - All customer routes pass through `BillingInvoiceService.sanitizeCustomerInvoiceView`, omitting raw webhook signatures, internal provider IDs, and metadata.
3. **Receipt HTML Template & Download Pattern**:
   - `BillingReceiptService.renderReceiptHtml` generates clean, responsive, print-optimized HTML (`@media print`) with embedded inline SVG vectors (ZdexCloud brand mark, payment badges) without external CDN requests.
   - `GET /api/v1/billing/receipts/:id/html` and `GET /api/v1/billing/receipts/:id/download` serve HTML with `Content-Disposition: attachment; filename="receipt-....html"`.
4. **Persistent Notification & Retry Pipeline**:
   - `ChannelDeliveryRecord` and `DeliveryProcessor` provide persistent delivery queuing, atomic row claiming (`status: 'PROCESSING'`), stale lease recovery, exponential backoff retries, and circuit breakers.
   - `ChannelRouter` provides security override (`typeMeta.isSecurityCritical`) allowing mandatory transactional billing/statutory documents to bypass marketing opt-out suppression.
5. **Transactional Email Infrastructure**:
   - `BrevoEmailService` implements dual transport: primary direct HTTPS REST API (Port 443, Render cloud firewall proof) with secondary Brevo SMTP Relay (Nodemailer Port 587) and `MockEmailService` fallback.
   - Central audit logging via `emailTrackingService` and `EmailMessage` Prisma entity.
6. **Cryptographic Tamper-Evidence**:
   - `BillingInvoiceService.computeInvoiceContentHash` computes deterministic SHA-256 hash over canonicalized JSON-serialized statutory fields with recursive key sorting.

---

## 3. CAPABILITIES THAT DO NOT YET EXIST OR COULD NOT BE CONFIRMED

1. **No PDF Generation Dependency Installed**:
   - Inspection of `package.json` confirms that NO PDF generation library is installed (neither `pdfkit`, `puppeteer`, `playwright`, nor `html-pdf`).
2. **No Invoice Document Download Endpoints**:
   - Unlike receipts (`/billing/receipts/:id/download`), there are currently NO download or HTML document endpoints for invoices (`/billing/invoices/:id/download` or `/billing/invoices/:id/html` do not exist).
3. **No Email Attachment Support in Current Email Service**:
   - `BrevoEmailService.sendMail` currently sends JSON payloads (`{ sender, to, subject, htmlContent, textContent }`) and Nodemailer parameters (`{ from, to, subject, text, html }`). It does NOT support sending binary file attachments (e.g. PDF attachments).
4. **No Server-Side Object Storage (S3 / R2) SDK**:
   - `@aws-sdk/client-s3` or Cloudflare R2 client is not installed. All file serving in the project is handled either in-memory/streamed or via gateway WebSockets to connected user devices.
5. **No Credit Note Engine**:
   - While `BillingInvoiceType.CREDIT_NOTE` is defined in Prisma enums, there is no credit note issuance service, sequence allocator, or document template for exceptional chargebacks or reversals.

---

## 4. DEPENDENCY AND DEPLOYMENT FINDINGS

- **Runtime & Deployment**: The backend is hosted on **Render** (Node.js runtime on Linux).
- **Installed Packages**: `fastify ^4.26.1`, `@prisma/client ^5.10.2`, `zod ^3.22.4`, `nodemailer ^9.0.5`, `pino ^8.19.0`, `@fastify/rate-limit ^9.1.0`, `@fastify/helmet ^11.1.1`.
- **System Resource Constraints**:
  - Render standard / free service tiers operate with 512MB RAM and containerized ephemeral filesystems.
  - Ephemeral disk storage means any files written to local disk are wiped on container restart, redeploy, or scaling.
- **Firewall & Network Rules**:
  - Render restricts outbound SMTP ports (Port 25 blocked, Port 587 sometimes throttled), which is why `BrevoEmailService` prioritizes HTTPS REST API over port 443.

---

## 5. INVOICE LIFECYCLE, HASH, AND DOCUMENT-INTEGRITY FINDINGS

### Status Lifecycle vs. Settlement Status
- **`BillingInvoiceStatus`**: Lifecycle state of the statutory tax document:
  - `ISSUED`: Active, immutable, valid statutory tax document.
  - `VOIDED`: Cancelled document (requires `voidedAt` and `voidReason`).
  - `SUPERSEDED`: Replaced by a corrective invoice (requires `supersededByInvoiceId`).
  - `DRAFT`: Reserved for unissued draft states (not used in current auto-issuance).
- **`BillingInvoiceSettlementStatus`**: Financial ledger state:
  - `SETTLED`: Fully reconciled against captured payment.
  - `PENDING`: Unsettled.
  - `CREDITED`: Adjusted via credit note.

### Content Hash Scope vs. Rendered Document Bytes
- **Current Canonical Hash Scope**:
  - The SHA-256 `contentHash` computed by `BillingInvoiceService` covers **32 structured database snapshot fields** (customer profile, seller profile, statutory numbers, line items, monetary amounts, tax breakup).
  - It intentionally omits mutable operational fields (`settlementStatus`, `status`).
  - **CRITICAL DISTINCTION**: The `contentHash` represents the **canonical structured database record**, NOT the rendered HTML or PDF binary bytes!
- **Document Rendering Determinism**:
  - Generating document output (HTML or PDF) from an immutable `BillingInvoice` snapshot is deterministic provided that:
    1. Only stored snapshot fields are rendered.
    2. Zero external network resources (external images, CDN fonts) are loaded during rendering.
    3. No dynamic generation timestamps (`new Date()`) or nonces are injected into the visual content.
    4. Slashes in `invoiceNumber` (e.g. `ZCI/2026-2027/000001`) are sanitized safely for downloads.

---

## 6. PDF ARCHITECTURE RECOMMENDATION & EVIDENCE

### Comparison of PDF Generation Options

| Evaluation Factor | Option A: Puppeteer / Headless Chromium | Option B: PDFKit (Pure Node.js) | Option C: Pure HTML/CSS Print Template |
| :--- | :--- | :--- | :--- |
| **Installed Today?** | No | No | **Yes (0 new dependencies)** |
| **Native OS Libraries** | Requires 300MB+ Chromium + `libnss3`, `libatk`, `libcups2` etc. Frequently breaks on PaaS. | **Zero native dependencies**. Pure JS/Node.js. | **Zero native dependencies**. Pure string rendering. |
| **RAM Footprint** | **150MB–350MB+** per page spike. High risk of OOM kills on 512MB Render containers. | **< 20MB** memory usage. Extremely lightweight. | **< 2MB** memory usage. Near-instantaneous. |
| **Unicode & Currency** | Full browser font rendering. | Fully supported via embedded TrueType font (e.g. Noto Sans for `₹`). | Fully supported via browser font rendering. |
| **Security Risks** | SSRF, Local file access (`file://`), HTML injection / script execution. | **Immune** to HTML/JS injection or browser SSRF. | **Immune** (escaped HTML output, no browser execution on server). |
| **Email Attachment Support** | Generates PDF buffer directly. | Generates PDF buffer directly. | Requires browser on client; cannot attach as PDF to email directly. |

### Strategic Recommendation for Phase 8.4:
1. **Primary PDF Engine**: **PDFKit** (`pdfkit` + `@types/pdfkit`).
   - *Rationale*: Render containers have strict memory ceilings (512MB RAM). Chromium-based engines are prohibited due to memory crashes, buildpack failures, and SSRF attack vectors. PDFKit is pure JavaScript, consumes negligible RAM, streams directly into memory buffers, and is deterministic.
2. **Companion In-Browser HTML View**: Implement `renderInvoiceHtml` matching `renderReceiptHtml` conventions.
   - *Rationale*: Allows instant customer preview in the browser with print-to-PDF capability, zero download latency, and complete brand fidelity.

---

## 7. CUSTOMER DOWNLOAD SECURITY CONTRACT

### Secure Endpoint Specification:
- **Route**: `GET /api/v1/billing/invoices/:id/download` (and `GET /api/v1/billing/invoices/:id/html` for in-browser viewing).
- **Authentication**: `adminAuthenticate` or `customerAuthenticate` (via `getAuthUser(request)`).
- **Ownership Verification (IDOR Protection)**:
  - Must call `BillingInvoiceService.getInvoiceById(id, user.id, isAdmin)`.
  - If `invoice.userId !== user.id` and user is not admin: returns 404 `NotFoundError` (never 403) to prevent invoice existence enumeration.
- **Read-Only Invariant**:
  - The download handler must ONLY read existing `BillingInvoice` records. Under no circumstances may a download request trigger implicit invoice generation or sequence allocation. Missing invoices return 404.
- **Filename Sanitization**:
  - Raw invoice numbers contain slashes: `ZCI/2026-2027/000001`.
  - The download header must sanitize slashes:
    ```typescript
    const safeFilename = `invoice-${invoice.invoiceNumber.replace(/[\/\\]/g, '-')}.pdf`;
    reply.header('Content-Disposition', `attachment; filename="${safeFilename}"`);
    ```
- **Security Headers**:
  - `Content-Type: application/pdf`
  - `Cache-Control: private, no-cache, no-store, must-revalidate`
  - `Pragma: no-cache`
  - `Expires: 0`
- **Streaming vs. Ephemeral Storage**:
  - **Direct On-The-Fly Streaming**: Because PDFKit generates a 1-page PDF in < 40ms, PDF buffers must be generated and streamed directly in the HTTP response.
  - *Zero Disk/S3 Footprint*: Eliminates complex cloud bucket configuration, expired URL generation, file retention purges, and unauthorized S3 access risks.
- **Voided & Superseded Documents**:
  - `VOIDED` invoices MUST render with a prominent diagonal watermark: `"VOID / CANCELLED - NOT A VALID TAX INVOICE"` along with `voidReason`.
  - `SUPERSEDED` invoices MUST render with: `"SUPERSEDED BY INVOICE #${supersededByInvoiceId}"`.
- **Audit Event**:
  - Successful download requests record an operational audit log:
    `eventType: 'BILLING_INVOICE_DOWNLOAD_REQUESTED'`.

---

## 8. EMAIL DELIVERY AND RETRY ASSESSMENT

### Email Delivery Pattern: Secure Link vs. Attached Document
1. **Standard Pattern (Recommended)**: Deliver an **Invoice-Ready Transactional Email** containing a secure deep-link to the customer's authenticated billing portal (`https://zdexcloud.com/billing` or direct download link).
   - *Advantages*:
     - Zero attachment deliverability penalties (emails with attachments trigger spam filters 3x more often).
     - Fully supported by existing `BrevoEmailService` REST API without dependency modifications.
     - Enforces re-authentication before downloading sensitive statutory tax documents.
2. **Enhanced Pattern (Attachment Support)**:
   - To support raw PDF attachments, `BrevoEmailService` must be updated to accept `attachments?: Array<{ filename: string; content: Buffer | string; contentType: string }>`.
   - Brevo REST API requires `attachment: [{ name, content: base64String }]`.
   - SMTP Relay requires `attachments: [{ filename, content: buffer }]`.

### Queue, Retries & Idempotency:
- **Prerequisite Gate**: Email dispatch is triggered ONLY AFTER `BillingInvoiceService.generateInvoiceForPayment` successfully commits. If invoice generation fails or is deferred, NO email is queued.
- **Decoupled Delivery**: Email queuing uses `ChannelDeliveryRecord` and `emailTrackingService`.
- **Worker Retries Do Not Re-Issue**: If email dispatch encounters a network blip or provider timeout, `DeliveryProcessor` retries the email delivery job with exponential backoff. The invoice ID remains unchanged and is never re-allocated.
- **Authoritative Recipient**: Recipient email is strictly pulled from `payment.user.email` (never client-supplied request parameters).
- **Statutory Delivery Override**: Invoicing notifications are classified as `isSecurityCritical: true` in `ChannelRouter` so that marketing email opt-outs cannot suppress mandatory statutory billing notices.

---

## 9. PRESERVING NO-CUSTOMER-REFUND POLICY & CREDIT NOTE LIMITATIONS

1. **Strict Final-Payment Policy**:
   - Customer payments are final. No refund request buttons, links, or routes are introduced in customer-facing views or email templates.
2. **Accounting for Exceptional Provider Reversals**:
   - When Razorpay reports an exceptional chargeback, dispute, or provider-initiated refund:
     - The event is logged in `BillingRefund` with `reason: ADMIN_APPROVED_EXCEPTION`.
     - The issued `BillingInvoice` is NOT deleted or rewritten.
3. **Statutory Credit Note Requirement (Future Rule 54 Compliance)**:
   - Under GST Rule 54, an exceptional reversal against an issued tax invoice requires issuing a **Credit Note** (`BillingInvoiceType.CREDIT_NOTE`), linked to the original invoice via `originalInvoiceId`.
   - Credit notes must be numbered consecutively under a dedicated sequence prefix (`ZCN/YYYY-YYYY/000001`).
   - Implementation of credit note generation is documented as a post-Phase 8.4 requirement.

---

## 10. ORDERED IMPLEMENTATION BATCHES FOR PHASE 8.4

```mermaid
flowchart TD
    B["Batch B: PDF Engine & Invoice Template Foundation<br/>(Install PDFKit, author deterministic template, Unicode support)"] --> C["Batch C: Authenticated Customer Download Endpoints<br/>(GET /invoices/:id/download, IDOR checks, filename sanitization)"]
    C --> D["Batch D: Transactional Email Delivery & Notifications<br/>(Invoice-ready notification, secure link/attachment dispatch)"]
    D --> E["Batch E: Delivery Resilience, Observability & Admin Controls<br/>(Retry worker, rate limits, audit logging, admin controls)"]
    E --> F["Batch F: Final Source Audit & Verification Closure<br/>(Full regression review, static test authoring, final closure)"]
```

### Batch B: PDF Engine & Invoice Template Foundation
- **Scope**: Install `pdfkit` and `@types/pdfkit`. Author pure Node.js deterministic PDF invoice generator (`BillingInvoiceDocumentService`) and companion HTML template.
- **Dependencies**: None.
- **Acceptance Criteria**: Formats 32 statutory snapshot fields, embeds SVG brand mark, supports rupee symbol `₹` via embedded font, handles `VOIDED` watermarks, zero external network calls.

### Batch C: Authenticated Customer Download Endpoints
- **Scope**: Register `GET /billing/invoices/:id/download` and `GET /billing/invoices/:id/html` in `src/routes/billing.ts`.
- **Dependencies**: Batch B.
- **Acceptance Criteria**: Strict IDOR check (returns 404 for unauthorized users), filename sanitization, security headers (`Cache-Control: private, no-store`), read-only invariant (zero implicit issuance).

### Batch D: Transactional Email Delivery & Notifications
- **Scope**: Create invoice-ready email template in `src/services/email_templates.ts`. Wire automatic invoice notification trigger into checkout and webhook completion handlers.
- **Dependencies**: Batch B, Batch C.
- **Acceptance Criteria**: Email dispatched only after invoice commits, uses authoritative account email, includes secure portal link, overrides marketing opt-outs via `isSecurityCritical: true`.

### Batch E: Delivery Resilience, Observability & Admin Controls
- **Scope**: Implement attachment support in `BrevoEmailService`, integrate with `DeliveryProcessor` retry queue, add rate-limiting presets, and add admin re-send operational endpoint (`POST /admin/operations/billing/invoices/:id/resend-email`).
- **Dependencies**: Batch D.
- **Acceptance Criteria**: Retries do not duplicate invoices, admin endpoint guarded by `billing.write`, audit trail recorded in `AdminAuditService`.

### Batch F: Final Source Audit & Verification Closure
- **Scope**: Comprehensive source audit of all Phase 8.4 deliverables, static test suite execution verification, and final report generation.
- **Dependencies**: Batches B through E.
- **Acceptance Criteria**: Zero regressions, all core invariants verified, test specifications marked NOT EXECUTED.

---

## 11. STATIC TEST SPECIFICATIONS SUMMARY

Authored test specification file:
`main website/Backend/tests/invoice_document_delivery_architecture.test.ts`

**Covered Test Specifications:**
1. Persisted invoice snapshot immutability during document rendering (zero recalculation drift).
2. Unicode, Indian rupee (`₹`), and statutory SAC code rendering.
3. Strict ownership enforcement and IDOR prevention (404 for non-owners).
4. Filename slash sanitization (`ZCI-2026-2027-000042.pdf`) and cache-control headers.
5. Read-only download invariant (zero implicit invoice issuance on read routes).
6. Watermarking and cancellation text for `VOIDED` and `SUPERSEDED` invoices.
7. Email delivery idempotency and retry isolation (retries do not mutate invoice records).
8. Data sanitization: omission of provider payment IDs, secrets, and raw webhook metadata.
9. Strict preservation of the no-customer-refund policy.

**Operational Notice:**
All tests are preceded by `// NOTE: These tests are NOT EXECUTED as per policy.` and remained completely unexecuted.

---

## 12. CONFIRMATION OF OPERATIONAL CONSTRAINTS

- **Zero Test Executions**: No test runners (`npm test`, `node --test`) or test builds were run.
- **Zero Builds or Type Checks**: No application builds or compiler type checks were run.
- **Zero Database Operations**: No database queries, connections, or mutations were performed.
- **Zero Migrations or Backfills**: No database schema changes were applied.
- **Zero External Operations**: No Razorpay API calls, payments, captures, refunds, or emails were initiated.
- **Zero Package Installations**: No dependencies were installed or modified in Batch A.

---

## 13. REMAINING DECISIONS REQUIRING HUMAN / TAX-ADVISER APPROVAL

1. **PDF Generator Dependency Approval**:
   - Human approval to install `pdfkit` (`^0.15.0`) and `@types/pdfkit` in Batch B.
2. **Email Delivery Format Choice**:
   - Business decision on whether to send:
     - (A) Transactional email with secure portal download link (Recommended - higher deliverability).
     - (B) Direct PDF attachment via Brevo API / SMTP (requires base64 encoding).
3. **Statutory Watermark Text Approval**:
   - Legal/tax confirmation of exact statutory watermark wording for voided invoices (`"VOID / CANCELLED - NOT A VALID TAX INVOICE"`).

---

## 14. FINAL VERDICT

**READY FOR PHASE 8.4 IMPLEMENTATION WITH DOCUMENTED PREREQUISITES**

The repository source audit is complete. Existing capabilities in database snapshotting, IDOR route protection, receipt templating, and notification queuing provide a solid, secure foundation for Phase 8.4 invoice document delivery. Execution has ceased in accordance with all operational constraints.
