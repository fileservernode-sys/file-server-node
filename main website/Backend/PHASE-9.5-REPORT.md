# ZDEXCLOUD PHASE 9.5 REPORT: CUSTOMER ACTIVITY PRIVACY AND SECURITY FILTERING

**Phase:** 9.5 — Customer Activity Privacy and Security Filtering (Final Phase of Customer Activity Logs)  
**Status:** Completed  
**Execution Mode:** Focused implementation (non-executing)

---

## 1. Executive Summary

Phase 9.5 completes the ZdexCloud Customer Activity Logs feature (Phases 9.1–9.5) by implementing defense-in-depth privacy, data minimization, input validation, and XSS/DOM security hardening across the activity taxonomy, backend recording and query service, Fastify API endpoint, customer-facing Activity page, and unit test specifications.

---

## 2. Privacy & Security Gaps Identified and Fixed

### 2.1 Taxonomy & Metadata Sanitization (`main website/Backend/src/services/activity/customer_activity_taxonomy.ts`)
1. **Expanded Prohibited Metadata Key Substrings (`PROHIBITED_ACTIVITY_METADATA_SUBSTRINGS`):**
   - Expanded from 23 to 47 prohibited key substrings, adding `session`, `sessionid`, `apikey`, `api_key`, `bearer`, `jwt`, `refresh`, `stack`, `prisma`, `sql`, `webhook`, `storagekey`, `storage_key`, `s3key`, `filepath`, `internalnote`, `adminnote`, `razorpay`, `providerpaymentid`, `providersubscriptionid`, `providerplanid`, `providerrefundid`, `providereventid`, and `refundid`.
   - Removed `refundId` from `PAYMENT_REFUNDED.allowedMetadataKeys` so internal/provider refund identifiers are never exposed in customer metadata, replacing it with customer-safe `planCode` and `planName`.
   - Aligned `allowedMetadataKeys` across producer and test call sites (`fileSizeBytes` on `FILE_UPLOADED`/`FILE_DOWNLOADED`, `parentDirectory` on `FILE_RENAMED`, `revokedSessions` on `SECURITY_PASSWORD_RESET_COMPLETED`, and `deviceType` on `DEVICE_LINKED`).
2. **Value-Level Secret, Diagnostic & Path Filtering (`containsSensitiveOrDiagnosticActivityValue` & `sanitizeCustomerActivityMetadata`):**
   - Added `containsSensitiveOrDiagnosticActivityValue(value)` inside `customer_activity_taxonomy.ts` to inspect string values even when passed under an allowlisted metadata key. Any metadata value containing embedded JWTs (`eyJ...`), `Bearer`/`Basic` tokens, bcrypt/argon2 password hashes (`$2b$...`, `$argon2...`), provider keys/secrets/IDs (`rzp_...`, `whsec_...`, `sk_...`, `pay_...`, `sub_...`, `rfnd_...`), stack traces (`at ... (file:line:col)`), Prisma/SQL error text (`PrismaClient...Error`, `SELECT ... FROM`, `INSERT INTO`), or internal host filesystem/storage paths (`C:\...`, `/var/...`, `/etc/...`, `/usr/...`, `s3://...`, `file://...`) is automatically rejected and omitted.
   - Added `cleanMetadataStringValue` to strip control characters (`\u0000`–`\u001F`, `\u007F`), HTML/script tags (`<...>`), and dangerous URL protocols (`javascript:`, `vbscript:`, `data:`), and bound string length to 255 characters.
   - Added `Number.isFinite(value)` validation so `NaN` and `±Infinity` numeric values are rejected.
   - Enforced automatic `maskIpAddressForCustomerDisplay` on `maskedIp` and automatic browser/OS summarization on `userAgentSummary` directly inside `sanitizeCustomerActivityMetadata`.
3. **Hardened IP Masking (`maskIpAddressForCustomerDisplay`):**
   - Extracts the first client IP from comma-separated `X-Forwarded-For` proxy chains (`"203.0.113.195, 70.41.3.18"` -> `"203.0.113.xxx"`).
   - Strips `::ffff:` IPv4-mapped IPv6 prefixes and `:port` suffixes before IPv4 octet validation (`"::ffff:198.51.100.24:54321"` -> `"198.51.100.xxx"`).
   - Validates IPv4 octets (`0..255`) and IPv6 hex segments, masking IPv6 to `h1:h2:h3:****` and returning `'masked'` or `'unknown'` for malformed inputs so an unmasked IP is never returned.

### 2.2 Backend Recording, Allowlist Serializer & Query Hardening (`main website/Backend/src/services/activity/customer_activity_service.ts`)
1. **Customer-Facing Title & Description Sanitization (`sanitizeCustomerFacingActivityText`):**
   - Added `sanitizeCustomerFacingActivityText(rawText, fallbackText, maxLength)` and applied it on both write (`recordEvent` and `renderCustomerActivityDescription`) and read (`serializeCustomerActivityEvent`).
   - Falls back to the safe taxonomy title/description if a custom override or stored row contains embedded secrets, tokens, SQL/Prisma errors, or stack traces.
   - Strips HTML/script tags (`<script>`, `<img onerror=...>`), control characters, and `javascript:`/`data:`/`vbscript:` schemes, and masks any raw IPv4 address accidentally interpolated into description text.
2. **Entity Reference Allowlisting & Scalar ID Validation (`sanitizeEntityReferenceId`):**
   - Added `sanitizeEntityReferenceId(rawId)` enforcing `1..128` characters matching `/^[A-Za-z0-9_.:-]+$/` with no `..` path traversal, whitespace, or HTML tags.
   - Enforced both per-event `definition.entityReferences` allowlisting and `sanitizeEntityReferenceId` during `recordEvent` (write path) as well as `serializeCustomerActivityEvent` (read path).
3. **Strict Row-Level Ownership Assertion (`listUserActivity`):**
   - Hardened the post-query row ownership check from `if (row?.userId && row.userId !== userId) continue;` (which previously failed to skip a row if `row.userId` was `null`, `undefined`, or blank) to:
     ```ts
     if (!row || typeof row.userId !== 'string' || row.userId.trim() !== userId) {
       continue;
     }
     ```
4. **Pagination Cursor & Date Filter Hardening (`decodeActivityCursor`, `parseDateFilterParam`):**
   - Validated cursor `id` with `sanitizeEntityReferenceId` (rejecting XSS, whitespace, or path traversal payloads inside base64url cursor tokens) and bounded cursor `occurredAt` years (`2000..2100`).
5. **Sanitized Database Error Handling (`listUserActivity`):**
   - Wrapped `delegate.findMany` in `try / catch` inside `listUserActivity` so unexpected Prisma/database failures throw a sanitized `AppError('Unable to retrieve account activity at this time.', 500, 'ACTIVITY_QUERY_FAILED')` without leaking internal Prisma/SQL error messages or host details.

### 2.3 API Route Hardening (`main website/Backend/src/routes/activity.ts`)
- Added `extractScalarQueryString` and `extractScalarLimitParam` to reject array/object query parameter pollution before calling `CustomerActivityService.listUserActivity`.
- Added strict anti-caching and MIME-sniffing response headers:
  - `Cache-Control: private, no-store, no-cache, must-revalidate, max-age=0`
  - `Pragma: no-cache`
  - `Expires: 0`
  - `X-Content-Type-Options: nosniff`

### 2.4 Frontend Rendering & Link/Error Hardening (`main website/Frontend/pages/activity.html`)
- **DOM-Based Rendering (`buildActivityItemElement`):** Replaced string HTML concatenation (`buildActivityItemHtml` + `insertAdjacentHTML`) with DOM element creation (`document.createElement`) and `.textContent` assignment for all untrusted or dynamic fields (`title`, `description`, `timestamp`, category badge, severity badge, and contextual metadata pills).
- **Removed Internal UUIDs from DOM:** Removed `data-event-id` from `<li class="activity-event-card">` so internal database UUIDs are never exposed in DOM attributes or tooltips (deduplication remains in-memory via `seenEventIds`).
- **Same-Origin Relative Link Allowlist (`resolveSafeActivityDestination`):** Validated any activity link destination against `ALLOWED_ACTIVITY_DESTINATIONS` (`invoices.html`, `servers.html`, `subscription.html`, `transactions.html`, `billing.html`, `notifications.html`), rejecting external URLs, `//`, `:`, `\`, `..`, `javascript:`, `data:`, and `vbscript:`.
- **Client-Side IP Masking & Error Message Filtering (`maskIpClientSide`, `getSafeCustomerErrorMessage`):** Added defense-in-depth client-side IP masking and filtered HTTP 5xx or diagnostic error messages so internal server/database details are never shown to customers.

---

## 3. Files Created or Modified

| File Path | Action | Summary of Changes |
| :--- | :--- | :--- |
| `main website/Backend/src/services/activity/customer_activity_taxonomy.ts` | Modified | Expanded `PROHIBITED_ACTIVITY_METADATA_SUBSTRINGS` (47 substrings), hardened `maskIpAddressForCustomerDisplay`, added `containsSensitiveOrDiagnosticActivityValue` and value-level sanitization in `sanitizeCustomerActivityMetadata`, and removed `refundId` from `PAYMENT_REFUNDED.allowedMetadataKeys`. |
| `main website/Backend/src/services/activity/customer_activity_service.ts` | Modified | Added `sanitizeCustomerFacingActivityText` and `sanitizeEntityReferenceId`, enforced entity allowlisting on write and read, hardened `decodeActivityCursor`, hardened row ownership guard in `listUserActivity`, and wrapped `delegate.findMany` with sanitized `AppError` handling. |
| `main website/Backend/src/routes/activity.ts` | Modified | Added scalar query parameter validation (`extractScalarQueryString`, `extractScalarLimitParam`) and strict `Cache-Control`, `Pragma`, `Expires`, and `X-Content-Type-Options` headers. |
| `main website/Frontend/pages/activity.html` | Modified | Replaced HTML string concatenation with `buildActivityItemElement` (`document.createElement` + `.textContent`), removed `data-event-id` from DOM, added `resolveSafeActivityDestination`, `maskIpClientSide`, and `getSafeCustomerErrorMessage`. |
| `main website/Backend/tests/customer_activity_service.test.ts` | Modified | Added Phase 9.5 privacy & security test suite covering value-level secret/diagnostic rejection, XSS/HTML sanitization on write, entity reference validation, and IPv4/IPv6/`X-Forwarded-For`/`::ffff:` masking. |
| `main website/Backend/tests/customer_activity_api.test.ts` | Modified | Added Phase 9.5 read-path test suite covering null/blank/cross-customer `userId` row filtering, stored HTML/secret/stack-trace sanitization on read, cursor ID injection rejection, and sanitized DB error responses. |
| `PHASE-9.5-REPORT.md` | Created | Phase 9.5 completion report. |

---

## 4. Residual Risks & Operational Notes

- **Non-Executing Mode Compliance:** All implementation and test specification updates were written directly to source files without executing test runners, builds, Prisma client generation, or migrations.
- **End-to-End Phase 9 Completion:** With Phase 9.1 (Taxonomy), Phase 9.2 (Backend Recording), Phase 9.3 (Activity API), Phase 9.4 (Activity UI), and Phase 9.5 (Privacy & Security Filtering) complete, the Customer Activity Logs feature is fully implemented and hardened.
