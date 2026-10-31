# ZDEXCLOUD PHASE 12.4: LEGAL AND TRUST CONTENT IMPLEMENTATION REPORT

**Execution Status**: COMPLETE (Static Source Verified)  
**Phase**: 12.4 (Legal and Trust Content Implementation)  
**Repository Scope**: `main website/Frontend/`  
**Execution Timestamp**: 2026-10-21  

---

## 1. Final Implementation Status

Phase 12.4 updates the legal, privacy, security, and trust disclosures of the ZdexCloud platform to align strictly with the actual software architecture and documented product behavior. All modifications were completed directly in the authoritative website documents using static source inspection, without introducing external dependencies, test runners, or builds.

### Summary of Completed Objectives
* **Direct Architecture Alignment**: Explicitly established that the user's Android phone is the physical storage host and that ZdexCloud operates a control plane and secure relay gateway without persistent cloud file storage.
* **Ephemeral Relay Transparency**: Clarified that file metadata and file contents traverse relay gateway memory buffers in flight and are not written to disk or retained on central servers.
* **Transport Encryption vs. E2EE**: Clarified that TLS 1.3 protects transport across hops (browser to gateway, and gateway to phone), but does not constitute zero-knowledge end-to-end encryption (E2EE) due to in-memory relay multiplexing.
* **Third-Party Disclosures**: Accurately disclosed verified third-party technical integrations (Razorpay, Brevo, StackMail SMTP, Google Firebase Cloud Messaging, Cloudflare) and confirmed the absence of advertising trackers or data-broker sales.
* **Commercial & Refund Policies**: Documented the final-payment policy (no customer refunds or prorated credits), self-service subscription cancellation (effective at period end), and server node quotas (1 on Free, up to 5 on Pro).
* **Account & Data Deletion Workflows**: Clearly separated account deletion (requested via `support@zdexcloud.com`) from device unlinking (self-service in dashboard), and explicitly affirmed that neither operation deletes files from the physical Android phone.
* **Punctuation & Accessibility**: Maintained semantic heading hierarchy, WCAG 2.2 AA readability, and strictly enforced zero em dashes (`--` or hyphen used instead) across all modified customer-facing copy.

---

## 2. Exact Files Changed

| File Path | Description of Changes |
| :--- | :--- |
| `main website/Frontend/pages/privacy.html` | Updated metadata, account data disclosures, authentication and session controls, ephemeral relay buffering, notification preferences, Razorpay billing disclosures, trust model, third-party services, retention policies, account deletion procedures, and Q&A blocks. Replaced all em dashes with hyphens. |
| `main website/Frontend/pages/terms.html` | Updated metadata, architectural boundaries, host hardware stewardship, battery optimization disclosures, mandatory 3-2-1 backup requirements, credential decoupling, subscription quotas, Razorpay billing terms, final-payment policy, cancellation rules, account deletion procedures, and vulnerability reporting. Replaced all em dashes with hyphens. |

---

## 3. Legal and Trust Pages Discovered

Through recursive inspection of `main website/Frontend/`, the authoritative legal and trust surfaces were identified:

1. **Privacy Policy**: `main website/Frontend/pages/privacy.html`
   * Primary legal document governing personal data, platform metadata, ephemeral relay handling, device identifiers, and data subject rights.
2. **Terms of Service**: `main website/Frontend/pages/terms.html`
   * Primary contract governing account creation, on-device physical storage custody, acceptable use, backup responsibilities, commercial plans, and liability disclaimers.
3. **Security and Trust Surface**:
   * Confirmed that no standalone `security.html` or `trust.html` document exists in the repository.
   * Trust and security disclosures are integrated directly into `pages/privacy.html` (Sections 4, 6, 12, 16), `pages/terms.html` (Sections 2, 5, 6, 7, 11), `pages/documentation.html` (Section 6), and `pages/contact.html`.
4. **Commercial Disclosures Surface**:
   * Commercial and subscription disclosures reside across `pages/pricing.html`, `pages/checkout.html`, `pages/subscription.html`, and `pages/invoices.html`.

---

## 4. Detailed Changes Made

### 4.1. Privacy Policy (`pages/privacy.html`)
* **Account Registration & Authentication Data**: Disclosed collection of email address (primary identifier), optional full name, one-way cryptographically hashed passwords (plaintext never stored), and timestamps.
* **Authentication, Sessions & Security Auditing**: Disclosed 6-digit OTP verification codes (10-minute / 600-second expiration, 5-attempt limit), strict 24-hour absolute session expiration (no sliding extension), credential decoupling between web account and on-device server credentials, and security audit logging (IP address, user-agent, event type, timestamp).
* **Device & Server Registration**: Disclosed installation UUID (generated by `net.remotenode.fileserver`), hardware model, Android OS version, app version, user-assigned server name, operational state, and heartbeat pings.
* **Ephemeral In-Flight Relay Buffering**: Explained that file directory listings and file payloads traverse in-memory buffers in transit and are not written to disk or indexed. Clarified that TLS 1.3 transport security is not zero-knowledge end-to-end encryption.
* **Storage Custody**: Affirmed that files remain physically on the user's Android phone flash storage or microSD card, and that phone server execution is independent of web session state.
* **Notification Preferences & Delivery**: Disclosed customer preference storage, in-app notification records, Google Firebase Cloud Messaging push tokens, and Brevo/SMTP transactional email dispatch.
* **Billing & Payment Processing**: Added dedicated Section 10 disclosing Razorpay Software Private Limited (PCI-DSS Level 1 compliant), stored transaction IDs and invoice records, and explicit confirmation that ZdexCloud does not collect or store raw payment card numbers or banking credentials.
* **Security Safeguards & Trust Model**: Detailed plain-language security model, outbound tunneling without open inbound ports, operational device dependencies, and a responsible security disclosure route.
* **Third-Party Providers**: Enumerated Razorpay, Brevo, StackMail SMTP, Google FCM, and Cloudflare. Reaffirmed zero data sales and zero advertising cookies.
* **Retention & Deletion**: Mapped retention schedules (active account duration, 10-minute OTPs, 24-hour session tokens, ephemeral RAM buffers, statutory tax invoice retention) and established the email verification procedure for account deletion (`support@zdexcloud.com`).

### 4.2. Terms of Service (`pages/terms.html`)
* **Host Hardware Stewardship**: Outlined user responsibility for phone power, thermal management, Wi-Fi/cellular allowances, and Android OEM background battery optimization settings ("Unrestricted" configuration).
* **Mandatory 3-2-1 Backup Obligation**: Reinforced that ZdexCloud is not a backup utility and holds zero copies of files, making independent 3-2-1 backups (3 copies, 2 media, 1 offsite) a mandatory user responsibility.
* **Authentication & Credential Decoupling**: Documented separation between ZdexCloud platform credentials and on-device phone server credentials, alongside the strict 24-hour session lifetime.
* **Commercial Terms, Cancellation & Non-Refundability**: Documented Free (1 server node), Pro Monthly (₹49/month, up to 5 nodes), and Pro Yearly (₹500/year, up to 5 nodes). Documented that payments are processed by Razorpay and that all payments are final and non-refundable. Clarified that cancellation takes effect at the conclusion of the prepaid period.
* **Account Deletion vs. Device Unlinking**: Corrected the inaccurate claim of an automatic self-service account deletion control in the dashboard by documenting the verified email request procedure (`support@zdexcloud.com`), while retaining self-service device unlinking in the dashboard.
* **Security Vulnerability Reporting**: Added explicit instructions for security researchers and customers to report vulnerabilities to `support@zdexcloud.com`.

---

## 5. Repository Evidence Supporting Claims

| Claim / Disclosure | Verified Source Evidence | Location in Codebase |
| :--- | :--- | :--- |
| Physical on-device storage | Android foreground file server exposes local storage; no cloud bucket ingestion | `android/app/src/main/`, `main website/Backend/src/routes/device.ts` |
| Ephemeral relay buffering | Gateway proxies packets in memory via WebSocket without disk persistence | `main website/Backend/src/services/` |
| Transport TLS 1.3 (not E2EE) | Reverse proxy and gateway WebSocket endpoints terminate TLS 1.3 | Gateway configuration, `.env.render.example` |
| Strict 24-hour web sessions | Hard cutoff session validation without sliding window extension | `main website/Backend/src/routes/auth.ts`, `docs/session-policy.md` |
| OTP 10-minute expiration & 5 attempts | `EMAIL_VERIFICATION_OTP_EXPIRY_SECONDS=600`, `OTP_MAX_ATTEMPTS=5` | `main website/Backend/src/config/env.ts`, `auth.ts` |
| Razorpay payment gateway | Razorpay API integration, webhook verification, checkout session endpoints | `main website/Backend/src/routes/billing.ts`, `config/razorpay.ts` |
| Final payment / no refunds | API explicitly rejects customer refunds: "All customer payments are final" | `main website/Backend/src/routes/billing.ts:433-445` |
| Subscription cancellation at period end | `cancelAtPeriodEnd: true`, Pro active until period end, cancel undo supported | `main website/Backend/src/routes/billing.ts:337-380` |
| Server node limits (1 vs. 5) | Plan tier quotas enforced on device registration | `main website/Backend/src/routes/device.ts`, database schema |
| Device unlinking cascade | Deletes endpoints, server instances, and connection records; leaves phone files intact | `main website/Backend/src/routes/device.ts:875-1005` |
| Absence of self-service account deletion | No automated `user.delete` endpoint; settings UI lacks delete button | `main website/Backend/src/routes/auth.ts`, `pages/settings.html` |
| Transactional email dispatch | Brevo REST API / SMTP relay (StackMail) dispatching OTPs and invoices | `main website/Backend/src/services/email.ts` |
| Android push notifications | Google Firebase Cloud Messaging (FCM) relaying server status alerts | `main website/Backend/src/notifications/providers/` |

---

## 6. Claims Deliberately Removed or Qualified

1. **Removed Claim: Self-Service Account Deletion in Dashboard**:
   * *Previous text*: "You may terminate your account at any time through the web account dashboard."
   * *Correction*: Replaced with the actual procedure: account deletion is requested via email to `support@zdexcloud.com` from the registered account email, while device unlinking is self-service in the dashboard.
2. **Qualified Claim: Transport Encryption vs. End-to-End Encryption**:
   * *Qualification*: Explicitly stated that while connections use TLS 1.3, relay infrastructure processes packets in memory to bridge sessions, which differs from zero-knowledge end-to-end encryption.
3. **Qualified Claim: Cloud Storage vs. Remote Access**:
   * *Qualification*: Clarified that ZdexCloud is a remote connectivity and control plane service, not a cloud backup, RAID, or disaster recovery provider.
4. **Removed Unsupported Absolute Claims**:
   * Avoided claims of third-party security audits, ISO/SOC2 compliance, perpetual 100% uptime, zero-knowledge architecture, or automated file recovery.
5. **Punctuation Compliance**:
   * Removed all em dashes from page headers, meta tags, and body prose in `pages/privacy.html` and `pages/terms.html`.

---

## 7. Missing Legal or Product-Owner Decisions

The following items cannot be resolved solely from source code evidence and should be reviewed by legal counsel and the product owner:

1. **Formal Entity & Geographic Jurisdiction**: The repository specifies no physical company address, country of registration, or governing law jurisdiction. Terms currently refer to "applicable law".
2. **Automated Account Deletion Interface**: A self-service account deletion button in `settings.html` connected to an automated backend deletion endpoint is not yet implemented. Product ownership must decide whether to build automated account self-deletion or maintain the support-request workflow.
3. **Statutory Tax Invoice Retention Timeline**: The exact statutory retention duration for tax invoices (e.g., 7 or 8 years depending on jurisdiction) should be confirmed by a tax advisor.
4. **Formal Data Processing Agreements (DPAs)**: Formal DPAs with sub-processors (Razorpay, Brevo, Google, Cloudflare) should be maintained offline by the operating entity.

---

## 8. Static Verification Performed

* **HTML Structure & Integrity**: Verified that `pages/privacy.html` and `pages/terms.html` preserve valid semantic markup, responsive grid structures, header and mobile drawer navigation, and footer links.
* **Punctuation Audit**: Verified using regular expression searches (`\u2014`) that exactly 0 em dashes exist in either modified file.
* **Git Status & Diff Inspection**: Verified via `git diff --stat` that only `pages/privacy.html` and `pages/terms.html` were modified in this phase.
* **Cross-Page Link Consistency**: Verified that all canonical URLs, internal navigation links, and footer references point correctly to `pages/privacy.html` and `pages/terms.html`.

---

## 9. Explicit Confirmations

* **No Automated Test Suites Run**: Test runners (e.g. Jest, Vitest, Flutter test) were not executed.
* **No Application Builds Performed**: Build compilation commands (`npm run build`, `flutter build`) were not executed.
* **No Database Migrations or Mutations**: Database state was neither altered nor migrated.
* **No Live Production API Requests**: No payment, email, or gateway endpoints were called.
* **No Legal Certification Claimed**: This update represents technical source alignment and does not constitute formal legal advice.

---

## 10. Known Limitations & Prerequisites for Phase 12.5

* Phase 12.4 changes are confined strictly to customer-facing legal and trust copy.
* Backend authentication and onboarding copy remains scheduled for optimization in Phase 12.5 (`pages/login.html`, `pages/get-started.html`, `pages/verify-otp.html`, `pages/forgot-password.html`).
* Technical SEO metadata standardization and structured data refinements remain scheduled for Phase 13.
