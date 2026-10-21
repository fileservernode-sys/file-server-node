# ZDEXCLOUD | PHASE 8.4 | BATCH B.1 REPORT
## PDF FOUNDATION CORRECTIONS & CUSTOMER-DOCUMENT SAFETY AUDIT

**Date:** 2026-10-10  
**Phase:** 8.4 (Invoice Document Delivery & Archival)  
**Batch:** B.1 (PDF Foundation Corrections & Customer-Document Safety Audit)  
**Status:** COMPLETE  
**Final Verdict:** `PDF FOUNDATION READY FOR CUSTOMER-DOWNLOAD IMPLEMENTATION WITH DOCUMENTED LIMITATIONS`

---

## 1. Executive Summary

Phase 8.4 Batch B.1 performs a rigorous source audit and targeted remediation of the Batch B PDF foundation in ZdexCloud's Node.js backend (`main website/Backend/`).

The audit addressed seven critical areas:
1. **Lockfile & Dependency Verification:** Evaluated manifest declarations (`package.json`) against `package-lock.json`. Confirmed that while dependencies are declared, lockfile synchronization is an unresolved prerequisite due to strict prohibitions against executing package manager commands during audit cycles.
2. **Unicode & Font Licensing Audit:** Scanned the repository for TrueType/OpenType font assets. Established that no repository-controlled fonts supporting the Indian Rupee symbol (`₹`) are bundled. The PDF renderer was corrected to explicitly fall back to standard pure ASCII currency codes (`INR `) without inventing font provenance or claiming unsupported Type 1 glyph capabilities.
3. **Removal of Unsupported Statutory Claims:** Eliminated unverified claims that template generation establishes legal or statutory tax compliance under Rule 46 of the CGST Rules. Reframed the system's role to strictly rendering persisted snapshot data consistent with the configured tax model, pending authorized human and tax adviser review.
4. **Correction of Superseded Invoice Handling:** Prevented internal database primary keys (`supersededByInvoiceId`) from being exposed as customer-facing invoice numbers. Implemented neutral status banners and bounded text truncation for `SUPERSEDED` and `VOIDED` documents.
5. **Customer Privacy & Metadata Leak Prevention:** Removed internal database IDs (`doc.id`) from customer-facing HTML and PDF footers, ensuring strict suppression of internal secrets and provider identifiers.
6. **Performance Claim Reconciliation:** Reconciled unmeasured memory, speed, and determinism claims into realistic structural descriptions and unmeasured estimates, documenting operational boundaries on Render's 512 MB container.
7. **Static Test Suite Alignment:** Authored 10 exhaustive static test specifications in [`tests/invoice_document_template_foundation.test.ts`](tests/invoice_document_template_foundation.test.ts), left unexecuted in compliance with operational policy.

---

## 2. Exact Files Inspected and Changed

### 2.1 Files Inspected
- [`main website/Backend/package.json`](package.json)
- [`main website/Backend/package-lock.json`](package-lock.json)
- [`main website/Backend/prisma/schema.prisma`](prisma/schema.prisma)
- Full workspace font assets scan (`*.ttf`, `*.otf`, `*.woff`, `*.woff2`)
- [`main website/Backend/src/services/billing/billing_invoice_document_service.ts`](src/services/billing/billing_invoice_document_service.ts)
- [`main website/Backend/tests/invoice_document_template_foundation.test.ts`](tests/invoice_document_template_foundation.test.ts)

### 2.2 Files Modified
- [`main website/Backend/src/services/billing/billing_invoice_document_service.ts`](src/services/billing/billing_invoice_document_service.ts):
  - Corrected docstrings and log messages to remove unsupported statutory compliance and performance claims.
  - Standardized `formatAmountAscii` to pure ASCII prefixes (`INR `, `USD `, `EUR `, `GBP `).
  - Clarified `computeDocumentByteHash` as an archival/transmission integrity checksum, not a digital signature or statutory certification.
  - Updated HTML and PDF watermark banners to render neutral `SUPERSEDED` presentation without exposing `supersededByInvoiceId` or internal database IDs.
  - Added bounded length truncation (`sanitizeText`) in PDF coordinate layout to prevent bounding box overflow.
  - Removed internal database ID (`doc.id`) from customer-facing HTML and PDF footers.
  - Replaced Rule 46 compliance claims with neutral statements reflecting persisted billing snapshot data.
- [`main website/Backend/tests/invoice_document_template_foundation.test.ts`](tests/invoice_document_template_foundation.test.ts):
  - Updated test specifications to cover all 10 mandated Batch B.1 audit scenarios.

---

## 3. Dependency and Lockfile Findings

| Component | Manifest State | Lockfile State | Audit Finding |
| :--- | :--- | :--- | :--- |
| **`pdfkit`** | Declared (`^0.15.0`) | **Absent** | Lockfile desynchronization present |
| **`@types/pdfkit`** | Declared (`^0.13.4`) | **Absent** | Lockfile desynchronization present |

### 3.1 Audit Assessment
- **Status:** Unresolved prerequisite.
- **Root Cause:** In accordance with mandatory execution restrictions, package manager commands (`npm install`, `npm update`) are strictly prohibited during audit and specification batches.
- **Risk Assessment:** Hand-editing `package-lock.json` would violate repository supply-chain integrity standards by inventing cryptographic hashes and transitive dependency trees.
- **Resolution Plan:** Formal synchronization (`npm install` or `npm update --package-lock-only`) must occur in an approved build or staging deployment environment prior to production container deployment.

---

## 4. Font Source, Licensing Evidence, and Currency Symbols

### 4.1 Repository Font Inventory
A comprehensive recursive scan of the workspace revealed:
- **Backend Workspace (`main website/Backend/`):** Contains only internal Prisma Studio web assets (`.woff`, `.woff2`) within `node_modules/prisma/build/public/assets`. No TrueType (`.ttf`) or OpenType (`.otf`) fonts exist in the backend codebase.
- **Mobile Workspace (`Android app/`):** Contains only icon fonts (`MaterialIcons-Regular.otf`, `CupertinoIcons.ttf`).

### 4.2 Unicode Support and Currency Fallback
- **PDF Rendering:** PDFKit's standard Type 1 Helvetica font uses standard WinAnsi / StandardEncoding which does NOT include the Unicode Indian Rupee glyph (`₹`, U+20B9, introduced in Unicode 6.0).
  - Any attempt to emit `₹` directly in Type 1 fonts causes character dropping, `?` substitution, or stream corruption.
  - **Remediation:** The PDF engine explicitly falls back to the ISO currency code prefix `"INR "` (e.g., `INR 1000.00`). No unsupported claim of PDF `₹` support is made.
- **HTML Rendering:** Modern browsers natively render `₹` using system font fallbacks (`Segoe UI`, `Roboto`, `Helvetica Neue`). The HTML template continues to use `₹` safely.
- **Prerequisite for Future Consideration:** If vector PDF documents require the visual `₹` symbol, a licensed open-source font (such as Google Noto Sans or Roboto under SIL Open Font License) must be formally approved, added to `Backend/assets/fonts/`, and registered with PDFKit.

---

## 5. Superseded-Invoice Reference Handling

### 5.1 Schema and Data Path Analysis
- In [`prisma/schema.prisma`](prisma/schema.prisma), `BillingInvoice` possesses:
  ```prisma
  supersededByInvoiceId  String?
  correctionReason       String?
  ```
- `supersededByInvoiceId` stores the internal database primary key (e.g. CUID or UUID) of the replacement invoice.
- The schema defines no self-referencing Prisma relation to join and resolve the replacement invoice's human-facing `invoiceNumber`.
- `BillingInvoiceDocumentService` operates strictly as a read-only renderer receiving only the original invoice snapshot; it does not and must not query the database.

### 5.2 Remediation
1. **Zero Internal ID Leakage:** `doc.supersededByInvoiceId` is completely excluded from customer-facing HTML and PDF output.
2. **Neutral Status Banner:**
   - HTML:
     ```html
     <div class="watermark-banner watermark-superseded">
       <span class="watermark-title">SUPERSEDED</span>
       <span class="watermark-sub">This invoice has been superseded by a replacement invoice.</span>
     </div>
     ```
   - PDF:
     ```
     SUPERSEDED: Superseded by replacement document
     ```
3. **Safe Text Bounding:** If `correctionReason` or `voidReason` is provided, it is sanitized, HTML-escaped, and strictly bounded (HTML: 200 chars; PDF: 60 chars) to prevent bounding box overflow or text collision.

---

## 6. Snapshot and Hash-Boundary Verification

| Verification Dimension | Implementation Invariant | Audit Status |
| :--- | :--- | :--- |
| **Financial & Tax Source** | Values sourced exclusively from persisted `BillingInvoice` snapshot fields (`subtotalMinorUnits`, `taxMinorUnits`, `taxBreakdown`). | **VERIFIED** |
| **Zero Recalculation** | No calls to `TaxCalculationService`, `PlanCatalog`, or live pricing configs. | **VERIFIED** |
| **Zero Side-Effects** | No sequence allocation, database queries, payment mutations, or recovery service calls. | **VERIFIED** |
| **Content Hash Integrity** | `BillingInvoice.contentHash` remains untouched (32-field database record hash). | **VERIFIED** |
| **Byte Hash Decoupling** | `computeDocumentByteHash` computes a separate SHA-256 over raw PDF bytes; explicitly documented as an archival checksum, NOT a digital signature or statutory certification. | **VERIFIED** |
| **Internal Metadata Privacy** | Provider payment IDs (`razorpay_payment_id`, `order_id`, `paymentSnapshot`) and internal DB ID (`doc.id`) are excluded from customer documents. | **VERIFIED** |

---

## 7. Corrections to Statutory and Performance Claims

### 7.1 Statutory Claims Corrections
- **Previous Claim:** "Full Indian GST statutory compliance under Rule 46 of the CGST Rules 2017."
- **Audit Correction:** Removed all claims that document generation establishes legal or tax compliance.
- **Accurate Characterization:** The service formats persisted statutory fields (supplier GSTIN, recipient details, SAC 998313, intra/inter-state tax breakdown) in source-level consistency with the configured tax model. Actual legal compliance remains unverified until reviewed and approved by an authorized human or qualified tax adviser.

### 7.2 Performance Claims Corrections
- **Previous Claims:** "Max Memory Allocation: < 20 MB", "Execution Speed: < 25 ms", "Guaranteed safety for all Render concurrency levels".
- **Audit Correction:** Labeled all numerical values as unmeasured estimates.
- **Accurate Characterization:** In-memory PDF streaming allocates memory proportional to document content. Under high request concurrency on Render's 512 MB RAM container, unthrottled concurrent PDF generation could create memory pressure. Concurrency throttling or rate limiting must be maintained at the HTTP layer.

---

## 8. Static Test Specification Inventory

The test specification file [`tests/invoice_document_template_foundation.test.ts`](tests/invoice_document_template_foundation.test.ts) covers 10 targeted specification suites:

1. **Dependency & Lockfile Status:** Verifies `pdfkit` declaration in `package.json` while documenting lockfile sync as an explicit prerequisite.
2. **Unicode & ASCII Fallback:** Asserts that PDF text uses ASCII `"INR "` prefixes and that `₹` is not emitted into Type 1 fonts.
3. **Removal of Statutory Claims:** Verifies that templates and notes do not claim legal certification under Rule 46.
4. **Neutral Superseded Rendering:** Asserts that `SUPERSEDED` documents never expose `supersededByInvoiceId` or internal database IDs.
5. **Snapshot-Only Financials:** Asserts that tax splits and amounts match persisted snapshots without live recalculation.
6. **Zero Side-Effects:** Asserts that document mapping and rendering do not mutate sequence counters or database records.
7. **Hash Boundary Separation:** Asserts that `computeDocumentByteHash` does not alter `invoice.contentHash`.
8. **Exclusion of Internal Data:** Asserts that provider IDs, gateway secrets, and `doc.id` are absent from rendered output.
9. **Escaping & Bounded Text:** Asserts that malicious XSS scripts are escaped and overly long text is bounded.
10. **Safe Filename Generation:** Asserts that directory traversal characters and forbidden symbols are sanitized.

*Notice: All tests begin with `// NOTE: These tests are NOT EXECUTED as per policy.` and were left unexecuted.*

---

## 9. Remaining Prerequisites Before Customer Downloads (Batch C)

Before implementing customer download routes (`GET /billing/invoices/:id/download`):
1. **Lockfile Synchronization:** Run `npm install` or `npm update --package-lock-only` in an authorized build environment to update `package-lock.json`.
2. **Statutory Configuration Approval:** Formal sign-off on seller GSTIN, registered address, SAC code (998313), and invoice wording by an authorized human tax representative.
3. **Font Decision:** Determine whether to bundle an open-source TrueType font for visual `₹` glyph support in PDF or continue with standard ASCII `INR ` formatting.
4. **Route Guarding:** Implement ownership validation (`req.user.id === invoice.userId` or admin role check) in Batch C.

---

## 10. Explicit Confirmation of Operational Constraints

I explicitly confirm that throughout this batch:
- **NO** tests or test runners were executed.
- **NO** builds, compiler checks, or type checks were run.
- **NO** packages were installed, and no package manager commands (`npm install`, etc.) were executed.
- **NO** database connections, queries, or mutations were made.
- **NO** migrations or backfills were run.
- **NO** Razorpay or external financial APIs were called.
- **NO** emails were dispatched.
- **NO** real customer invoices were generated or issued.

---

## 11. Final Verdict

```
================================================================================
FINAL VERDICT:
PDF FOUNDATION READY FOR CUSTOMER-DOWNLOAD IMPLEMENTATION WITH DOCUMENTED LIMITATIONS
================================================================================
```
