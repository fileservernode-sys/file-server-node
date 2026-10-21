# ZDEXCLOUD: PHASE 9.1 COMPLETION REPORT
## CUSTOMER ACTIVITY EVENT TAXONOMY

**Repository Root:** `D:\YOUM PATEL\Desktop\Projects\File Server Project\`  
**Target Subsystem:** `main website/Backend/`  
**Canonical Domain:** `https://zdexcloud.com`  
**Phase Status:** `COMPLETE`  

---

## 1. Executive Summary

Phase 9.1 establishes the authoritative, implementation-ready taxonomy of customer-visible activity events for ZdexCloud (`https://zdexcloud.com`). Through static inspection of `prisma/schema.prisma`, authentication routes (`src/routes/auth.ts`), device and server lifecycle routes (`src/routes/device.ts`, `src/routes/server.ts`, `src/routes/connection.ts`), file-manager routes (`src/routes/file-manager.ts`), billing and invoice services (`src/routes/billing.ts`, `src/services/billing/*`), and notification producers (`src/notifications/*`), we have:

1. Defined **5 canonical customer-facing activity categories** (`ACCOUNT_SECURITY`, `SERVERS_DEVICES`, `FILE_ACCESS`, `BILLING_INVOICES`, `NOTIFICATIONS`).
2. Defined **48 strongly typed `CustomerActivityEventType` specifications** in `src/services/activity/customer_activity_taxonomy.ts` with customer-facing titles, description templates, triggering actions, authoritative source services, entity reference flags, safe metadata allowlists, and deduplication policies.
3. Audited and classified **all 78 existing `AuditEventType` enum values** (plus route-level string-cast audit types such as `BILLING_INVOICE_DOWNLOAD_REQUESTED`) into `CUSTOMER_VISIBLE_DIRECT`, `CUSTOMER_VISIBLE_DISCRIMINATED`, or `INTERNAL_ONLY`.
4. Formulated a concrete **Phase 9.2 Data Model & Recording Architecture Recommendation**, privacy/redaction invariants, and noise-suppression rules.

---

## 2. Existing Infrastructure Inspection Findings

### 2.1 Existing Persistence Models (`prisma/schema.prisma`)
| Model | Primary Purpose | Suitability for Customer Activity Feed |
| :--- | :--- | :--- |
| `AuditEvent` (`lines 631–645`) | Shared security, billing, and operational event log (`id`, `userId`, `deviceId`, `eventType`, `metadata`, `createdAt`). | **Partial (Requires Curated Projection or Dedicated Table):** Contains ~40 customer-relevant events alongside ~38 strictly internal reconciliation, tax engine, processing fee, and background token refresh events. Overloads `SERVER_CREATED`, `SERVER_STOPPED`, and `BILLING_STATE_UPDATED` via `metadata.action`. |
| `NotificationRecord` (`lines 652–685`) | Customer-facing notification inbox & multi-channel dispatch state (`id`, `eventId`, `userId`, `deviceId`, `serverId`, `eventType`, `category`, `severity`, `title`, `body`, `metadata`, `occurredAt`, `idempotencyKey`). | **Complementary:** Captures high-salience alerts (`SIGN_IN`, `DEVICE_LINKED`, `SERVER_UNAVAILABLE`, `STORAGE_WARNING`), but does not record routine user mutations (invoice downloads, server renames, file uploads/deletions, preference updates, sign-outs). |
| `AdminAuditLog` (`lines 928–964`) | Tamper-evident hash-chained operator audit trail (`prevHash`, `entryHash`, `adminId`, `action`). | **Strictly Internal:** Operator-only governance log; must never be exposed to customers. |
| `SystemErrorLog` (`lines 756–786`) | Backend/Android exception & stack-trace telemetry. | **Strictly Internal:** Operational telemetry; must never be exposed to customers. |
| `InvoiceNotificationOutbox` & `EmailMessage` | Transactional email dispatch & Brevo webhook reconciliation state. | **Internal Transport State:** Only high-level milestone (`NOTIFICATION.INVOICE_EMAIL_SENT`) is customer-relevant; raw webhook retries and provider IDs are internal. |

### 2.2 Confirmed Existing vs. Missing Event Recording Across Backend Routes
- **Account & Security (`src/routes/auth.ts`):**
  - *Already Recorded:* `EMAIL_VERIFIED` (on OTP verification), `LOGIN_ATTEMPT_FAILED` (on invalid password), `PASSWORD_RESET_REQUESTED`, `PASSWORD_RESET_SUCCESS`, `DEVICE_CREDENTIAL_REVOKED`, plus `accountEventProducer.emitAccountCreated` and `accountEventProducer.emitSignIn`.
  - *Exists in Route but Not Yet Audited (Phase 9.2 Target):* `POST /api/v1/auth/logout` deletes `UserSession` and clears the session cookie without recording a logout activity event.
  - *Proposed Future Capability:* Standalone authenticated password change endpoint (currently all password changes flow through the 6-digit OTP `POST /api/v1/auth/reset-password` endpoint).
- **Servers & Devices (`src/routes/device.ts`, `src/routes/server.ts`, `src/routes/connection.ts`, `src/services/endpoint.ts`):**
  - *Already Recorded:* `DEVICE_REGISTERED`, `SERVER_CREATED` (and `metadata.action = 'SERVER_RENAMED'` in `PATCH /api/v1/servers/:serverId`), `SERVER_STOPPED` (and `metadata.action = 'SERVER_DELETED'` in `DELETE /api/v1/devices/:deviceId`), `SERVER_ENDPOINT_ALLOCATED`, `REMOTE_CONNECTION_DISCONNECTED`.
  - *High-Frequency Noise Properly Excluded:* `POST /api/v1/devices/:deviceId/heartbeat` and `POST /api/v1/connections/:connectionId/heartbeat` update timestamps without writing `AuditEvent` rows. `POST /api/v1/devices/:deviceId/session/refresh` writes `DEVICE_SESSION_REFRESHED`, which is classified `INTERNAL_ONLY`.
- **File Access & Management (`src/routes/file-manager.ts`):**
  - *Already Recorded:* `FILE_MANAGER_LOGIN_SUCCESS` and `FILE_MANAGER_LOGIN_FAILED` on `POST /api/v1/file-manager/:serverId/auth/login`.
  - *Exists in Route but Not Yet Audited (Phase 9.2 Target):*
    - `POST /api/v1/file-manager/:serverId/upload` (`FILE.UPLOADED`)
    - `GET /api/v1/file-manager/:serverId/download` with `?download=true` (`FILE.DOWNLOADED`)
    - `DELETE /api/v1/file-manager/:serverId/files` (`FILE.DELETED`)
    - `POST /api/v1/file-manager/:serverId/rename` (`FILE.RENAMED`)
    - `POST /api/v1/file-manager/:serverId/folders` (`FILE.FOLDER_CREATED`)
  - *High-Frequency Read Operations Excluded:* `GET /access`, `GET /storage`, `GET /files/recent`, `GET /files` (directory browsing), and HTTP 206 byte-range media streaming requests are excluded from activity recording to prevent database bloat and UI noise.
- **Billing & Invoices (`src/routes/billing.ts`, `src/services/billing/*`):**
  - *Already Recorded:* `CHECKOUT_SESSION_CREATED`, `PAYMENT_VERIFIED`, `PAYMENT_VERIFICATION_FAILED`, `WEBHOOK_PAYMENT_CAPTURED`, `WEBHOOK_PAYMENT_FAILED`, `SUBSCRIPTION_ACTIVATED`, `SUBSCRIPTION_RENEWED`, `SUBSCRIPTION_PAST_DUE`, `SUBSCRIPTION_GRACE_PERIOD_STARTED`, `SUBSCRIPTION_GRACE_PERIOD_RECOVERED`, `SUBSCRIPTION_CANCELLATION_REQUESTED`, `SUBSCRIPTION_CANCELLATION_REVERSED`, `SUBSCRIPTION_CANCELLED`, `SUBSCRIPTION_EXPIRED`, `SUBSCRIPTION_UPGRADE_REQUESTED`, `SUBSCRIPTION_UPGRADED`, `SUBSCRIPTION_DOWNGRADE_SCHEDULED`, `SUBSCRIPTION_DOWNGRADE_CANCELLED`, `SUBSCRIPTION_DOWNGRADE_EFFECTIVE`, `REFUND_PROCESSED`, `SUBSCRIPTION_REFUNDED`, `BILLING_RECEIPT_ISSUED`, `BILLING_RECEIPT_DOWNLOAD_REQUESTED`, `BILLING_INVOICE_DOWNLOAD_REQUESTED`, and `BILLING_STATE_UPDATED` (`STATUTORY_INVOICE_ISSUED`, `UPDATE_BILLING_PROFILE`, `CONFIRM_BILLING_COUNTRY`).
- **Notifications (`src/notifications/*`):**
  - *Already Recorded:* `NotificationRecord` persists security alerts, device/server alerts, and storage alerts; `InvoiceNotificationOutbox` persists `INVOICE_ISSUED` email notifications.
  - *Exists in Route but Not Yet Audited (Phase 9.2 Target):* `PATCH /api/v1/notifications/preferences` (`NOTIFICATION.PREFERENCES_UPDATED`).

---

## 3. Authoritative Customer Activity Event Taxonomy

### 3.1 Category 1: Account & Security (`ACCOUNT_SECURITY`)

| Event Type Identifier | Customer-Facing Title | Description Template | Triggering Business Action | Source Service / Route | Capability Status | Allowed Safe Metadata | Deduplication / Noise Policy |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `ACCOUNT.CREATED` | Account Created | `Your ZdexCloud account ({email}) was created.` | Customer completes initial registration and verification. | `src/routes/auth.ts` (`POST /auth/register`, `POST /auth/verify-otp`) | `CONFIRMED_RECORDED` | `email` | `IDEMPOTENT_BY_ENTITY` (once per user) |
| `ACCOUNT.EMAIL_VERIFIED` | Email Address Verified | `Your email address was verified and your account was activated.` | Customer verifies 6-digit registration OTP code. | `src/routes/auth.ts` (`POST /auth/verify-otp`, `POST /auth/verify-email`) | `CONFIRMED_RECORDED` | `email`, `maskedIp`, `userAgentSummary` | `NONE` |
| `AUTH.SIGN_IN_SUCCEEDED` | Signed In to Account | `Signed in to your ZdexCloud account from {userAgentSummary} ({maskedIp}).` | Customer completes password + 2FA email OTP sign-in. | `src/routes/auth.ts` (`POST /auth/verify-otp`) & `account_producer.ts` | `CONFIRMED_RECORDED` | `maskedIp`, `userAgentSummary`, `authMethod` | `NONE` (every interactive sign-in recorded) |
| `AUTH.SIGN_IN_FAILED` | Failed Sign-In Attempt | `An unsuccessful sign-in attempt was detected on your account.` | Invalid password submitted for an existing account. | `src/routes/auth.ts` (`POST /auth/login`) | `CONFIRMED_RECORDED` | `maskedIp`, `userAgentSummary`, `reasonSummary` | `COOLDOWN_WINDOW` (60s window to prevent brute-force feed spam) |
| `AUTH.SIGN_OUT` | Signed Out of Account | `Signed out of your ZdexCloud session.` | Customer logs out via `POST /api/v1/auth/logout`. | `src/routes/auth.ts` (`POST /auth/logout`) | `CONFIRMED_NEEDS_RECORDING` | `maskedIp`, `userAgentSummary` | `NONE` |
| `AUTH.OTP_VERIFIED` | Verification Code Confirmed | `A 6-digit email verification code was confirmed ({purposeLabel}).` | Customer validates a 6-digit email OTP. | `src/utils/otp.ts` & `src/routes/auth.ts` | `CONFIRMED_RECORDED` | `purposeLabel` | `COOLDOWN_WINDOW` (10s window) |
| `SECURITY.PASSWORD_RESET_REQUESTED` | Password Reset Requested | `A password reset verification code was requested for your account.` | Customer initiates forgot-password flow. | `src/routes/auth.ts` (`POST /auth/forgot-password`) | `CONFIRMED_RECORDED` | `maskedIp`, `userAgentSummary` | `COOLDOWN_WINDOW` (60s window) |
| `SECURITY.PASSWORD_RESET_COMPLETED` | Password Reset Completed | `Your account password was reset and all active sessions were invalidated.` | Customer completes password reset with OTP and new password. | `src/routes/auth.ts` (`POST /auth/reset-password`) | `CONFIRMED_RECORDED` | `maskedIp`, `userAgentSummary`, `sessionsInvalidated` | `NONE` |
| `SECURITY.PASSWORD_CHANGED` | Password Changed | `Your account password was updated from account settings.` | Authenticated password change from settings. | Proposed authenticated password change endpoint | `PROPOSED_FUTURE` | `maskedIp`, `userAgentSummary` | `NONE` |
| `SECURITY.DEVICE_CREDENTIALS_REVOKED` | Device Authorization Revoked | `Persistent server authorization credential was revoked ({reasonLabel}).` | Customer revokes device credential or resets password. | `src/routes/device.ts` (`POST /devices/:deviceId/credentials/revoke`) & `auth.ts` | `CONFIRMED_RECORDED` | `deviceName`, `reasonLabel`, `revokedAt` | `NONE` (refs `deviceId`) |

### 3.2 Category 2: Servers & Devices (`SERVERS_DEVICES`)

| Event Type Identifier | Customer-Facing Title | Description Template | Triggering Business Action | Source Service / Route | Capability Status | Allowed Safe Metadata | Deduplication / Noise Policy |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `DEVICE.LINKED` | Android Device Linked | `Device "{deviceName}" ({platform}) was registered to your account.` | Android app registers a new device installation. | `src/routes/device.ts` (`POST /devices/register`) | `CONFIRMED_RECORDED` | `deviceName`, `platform`, `osVersion`, `appVersion` | `IDEMPOTENT_BY_ENTITY` (initial registration only; refs `deviceId`) |
| `DEVICE.UNLINKED` | Server & Device Removed | `Device "{deviceName}" and its personal file server were removed from your account.` | Customer deletes a device/server node. | `src/routes/device.ts` (`DELETE /devices/:deviceId`, `DELETE /servers/:deviceId`) | `CONFIRMED_RECORDED` | `deviceName`, `serverName`, `hostname` | `NONE` (discriminated via `SERVER_STOPPED` + `action: 'SERVER_DELETED'`) |
| `DEVICE.CONNECTED` | Device Online | `Device "{deviceName}" connected to ZdexCloud.` | Device transitions to `ONLINE`. | `src/services/connection_state_machine.ts` & `device_producer.ts` | `CONFIRMED_RECORDED` | `deviceName`, `platform` | `COOLDOWN_WINDOW` (300s debounce; heartbeats excluded) |
| `DEVICE.DISCONNECTED` | Device Offline | `Device "{deviceName}" disconnected from ZdexCloud.` | Device transitions to `OFFLINE`. | `src/services/connection_state_machine.ts` & `device_producer.ts` | `CONFIRMED_RECORDED` | `deviceName`, `reasonSummary` | `COOLDOWN_WINDOW` (300s debounce) |
| `SERVER.CREATED` | Personal File Server Created | `File server "{serverName}" was initialized on device "{deviceName}".` | `ServerInstance` is created for a device. | `src/routes/device.ts` & `src/routes/server.ts` (`POST /servers`) | `CONFIRMED_RECORDED` | `serverName`, `deviceName` | `IDEMPOTENT_BY_ENTITY` (refs `deviceId`, `serverId`) |
| `SERVER.RENAMED` | File Server Renamed | `File server was renamed from "{previousName}" to "{newName}".` | Customer renames server via `PATCH /api/v1/servers/:serverId`. | `src/routes/server.ts` (`PATCH /servers/:serverId`) | `CONFIRMED_RECORDED` | `previousName`, `newName`, `deviceName` | `NONE` (discriminated via `SERVER_CREATED` + `action: 'SERVER_RENAMED'`) |
| `SERVER.STARTED` | File Server Started | `File server "{serverName}" started and is ready for remote connections.` | `ServerInstance` transitions to `RUNNING`. | `src/routes/connection.ts` & `connection_state_machine.ts` | `CONFIRMED_RECORDED` | `serverName`, `deviceName`, `hostname` | `STATE_TRANSITION_ONLY` (120s cooldown; heartbeats excluded) |
| `SERVER.STOPPED` | File Server Stopped | `File server "{serverName}" was stopped.` | Customer stops server via `POST /servers/:serverId/stop` or `/devices/:deviceId/server/stop`. | `src/routes/server.ts` & `src/routes/device.ts` | `CONFIRMED_RECORDED` | `serverName`, `deviceName`, `stoppedAt` | `STATE_TRANSITION_ONLY` |
| `SERVER.ENDPOINT_ASSIGNED` | Public Subdomain Assigned | `Subdomain "{hostname}" was allocated to your file server.` | `EndpointService.reserveEndpoint` allocates a `zdexcloud.com` subdomain. | `src/services/endpoint.ts` | `CONFIRMED_RECORDED` | `hostname`, `publicUrl`, `serverName` | `IDEMPOTENT_BY_ENTITY` (initial allocation only) |
| `SERVER.REMOTE_TUNNEL_CONNECTED` | Remote Access Tunnel Connected | `Remote access tunnel established for "{deviceName}" ({remoteEndpoint}).` | Gateway WebSocket tunnel transitions to `CONNECTED`. | `src/gateway/gateway_service.ts` & `connection_state_machine.ts` | `CONFIRMED_RECORDED` | `deviceName`, `remoteEndpoint`, `region` | `COOLDOWN_WINDOW` (300s debounce) |
| `SERVER.REMOTE_TUNNEL_DISCONNECTED` | Remote Access Tunnel Disconnected | `Remote access tunnel closed for "{deviceName}".` | Explicit or transport tunnel disconnect. | `src/routes/connection.ts` (`POST /connections/:connectionId/disconnect`) | `CONFIRMED_RECORDED` | `deviceName`, `remoteEndpoint` | `COOLDOWN_WINDOW` (300s debounce) |
| `SERVER.REMOTE_TUNNEL_FAILED` | Remote Access Connection Failed | `Remote tunnel connection failed for "{deviceName}".` | `DeviceConnection` transitions to `FAILED`. | `src/services/connection_state_machine.ts` | `CONFIRMED_RECORDED` | `deviceName`, `reasonSummary` | `COOLDOWN_WINDOW` (300s debounce) |

### 3.3 Category 3: File Access & Management (`FILE_ACCESS`)

| Event Type Identifier | Customer-Facing Title | Description Template | Triggering Business Action | Source Service / Route | Capability Status | Allowed Safe Metadata | Deduplication / Noise Policy |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `FILE.SERVER_LOGIN_SUCCEEDED` | File Manager Session Authenticated | `Authenticated into file server "{serverName}" on "{deviceName}".` | Customer logs into Android file server via `POST /file-manager/:serverId/auth/login`. | `src/routes/file-manager.ts` | `CONFIRMED_RECORDED` | `serverName`, `deviceName`, `maskedIp` | `NONE` |
| `FILE.SERVER_LOGIN_FAILED` | Failed File Manager Login Attempt | `Failed login attempt on file server "{serverName}" ("{deviceName}").` | Invalid credentials submitted to Android file server login. | `src/routes/file-manager.ts` | `CONFIRMED_RECORDED` | `serverName`, `deviceName`, `maskedIp` | `COOLDOWN_WINDOW` (60s window) |
| `FILE.UPLOADED` | File Uploaded | `Uploaded "{fileName}" to "{serverName}".` | Customer uploads a file via `POST /file-manager/:serverId/upload`. | `src/routes/file-manager.ts` | `CONFIRMED_NEEDS_RECORDING` | `fileName`, `targetDirectory`, `sizeBytes`, `serverName`, `deviceName` | `NONE` (once per completed file, never per chunk) |
| `FILE.DOWNLOADED` | File Downloaded | `Downloaded "{fileName}" from "{serverName}".` | Customer downloads a file attachment (`?download=true`) via `GET /file-manager/:serverId/download`. | `src/routes/file-manager.ts` | `CONFIRMED_NEEDS_RECORDING` | `fileName`, `sizeBytes`, `serverName`, `deviceName` | `COOLDOWN_WINDOW` (30s; inline media previews & HTTP 206 byte-range chunks excluded) |
| `FILE.DELETED` | File or Folder Deleted | `Deleted "{itemName}" on "{serverName}".` | Customer deletes a file/folder via `DELETE /file-manager/:serverId/files`. | `src/routes/file-manager.ts` | `CONFIRMED_NEEDS_RECORDING` | `itemName`, `parentDirectory`, `serverName`, `deviceName` | `NONE` |
| `FILE.RENAMED` | File or Folder Renamed | `Renamed "{oldName}" to "{newName}" on "{serverName}".` | Customer renames a file/folder via `POST /file-manager/:serverId/rename`. | `src/routes/file-manager.ts` | `CONFIRMED_NEEDS_RECORDING` | `oldName`, `newName`, `serverName`, `deviceName` | `NONE` |
| `FILE.FOLDER_CREATED` | Folder Created | `Created folder "{folderName}" on "{serverName}".` | Customer creates a folder via `POST /file-manager/:serverId/folders`. | `src/routes/file-manager.ts` | `CONFIRMED_NEEDS_RECORDING` | `folderName`, `parentDirectory`, `serverName`, `deviceName` | `NONE` |

### 3.4 Category 4: Billing & Invoices (`BILLING_INVOICES`)

| Event Type Identifier | Customer-Facing Title | Description Template | Triggering Business Action | Source Service / Route | Capability Status | Allowed Safe Metadata | Deduplication / Noise Policy |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `BILLING.PROFILE_UPDATED` | Billing Profile Updated | `Updated billing address and tax profile ({country}).` | Customer updates billing profile via `PUT /api/v1/billing/profile`. | `src/services/billing/billing_profile_service.ts` | `CONFIRMED_RECORDED` | `country`, `state`, `currency`, `hasTaxId`, `hasCompanyName` | `NONE` (discriminated via `BILLING_STATE_UPDATED` + `action: 'UPDATE_BILLING_PROFILE'`) |
| `BILLING.COUNTRY_CONFIRMED` | Billing Region Confirmed | `Confirmed billing country ({billingCountry}) and currency ({currency}).` | Customer confirms billing country via `PUT /api/v1/billing/country`. | `src/services/billing/billing_state_service.ts` | `CONFIRMED_RECORDED` | `billingCountry`, `currency` | `NONE` (discriminated via `BILLING_STATE_UPDATED` + `action: 'CONFIRM_BILLING_COUNTRY'`) |
| `BILLING.SUBSCRIPTION_CHECKOUT_STARTED` | Subscription Checkout Started | `Initialized checkout session for {planName} ({currency}).` | Customer starts Razorpay subscription checkout. | `src/services/billing/providers/razorpay/razorpay_checkout_service.ts` | `CONFIRMED_RECORDED` | `planCode`, `planName`, `currency`, `formattedAmount` | `COOLDOWN_WINDOW` (300s) |
| `BILLING.SUBSCRIPTION_ACTIVATED` | Subscription Activated | `Your {planName} subscription is now active.` | Subscription activates after verified payment/webhook. | `razorpay_checkout_service.ts` & `razorpay_webhook_service.ts` | `CONFIRMED_RECORDED` | `planCode`, `planName`, `billingInterval`, `currency`, `amountMinorUnits`, `currentPeriodEnd` | `IDEMPOTENT_BY_ENTITY` (`subscriptionId`) |
| `BILLING.SUBSCRIPTION_RENEWED` | Subscription Renewed | `Your {planName} subscription was renewed for the next billing period.` | Recurring subscription charge succeeds. | `razorpay_webhook_service.ts` | `CONFIRMED_RECORDED` | `planCode`, `planName`, `currency`, `amountMinorUnits`, `currentPeriodEnd` | `IDEMPOTENT_BY_ENTITY` (`paymentId`) |
| `BILLING.SUBSCRIPTION_UPGRADE_REQUESTED` | Plan Upgrade Initiated | `Requested upgrade from {sourcePlan} to {targetPlan}.` | Customer initiates upgrade via `POST /billing/subscription/upgrade`. | `billing_state_service.ts` | `CONFIRMED_RECORDED` | `sourcePlan`, `targetPlan`, `creditMinorUnits`, `netAmountMinorUnits`, `currency` | `NONE` |
| `BILLING.SUBSCRIPTION_UPGRADED` | Subscription Upgraded | `Your subscription was upgraded to {targetPlan}.` | Upgrade completes and entitlements update. | `billing_state_service.ts` & `razorpay_webhook_service.ts` | `CONFIRMED_RECORDED` | `sourcePlan`, `targetPlan`, `currency`, `netAmountMinorUnits` | `IDEMPOTENT_BY_ENTITY` (`planChangeId`) |
| `BILLING.SUBSCRIPTION_DOWNGRADE_SCHEDULED` | Plan Downgrade Scheduled | `Scheduled plan change to {targetPlan} effective at the end of your current billing period.` | Customer schedules downgrade via `POST /billing/subscription/downgrade`. | `billing_state_service.ts` | `CONFIRMED_RECORDED` | `sourcePlan`, `targetPlan`, `effectiveAt` | `NONE` |
| `BILLING.SUBSCRIPTION_DOWNGRADE_CANCELLED` | Scheduled Downgrade Cancelled | `Cancelled scheduled plan downgrade; your {currentPlan} plan will continue.` | Customer cancels pending downgrade via `POST /billing/subscription/downgrade/cancel`. | `billing_state_service.ts` | `CONFIRMED_RECORDED` | `currentPlan` | `NONE` |
| `BILLING.SUBSCRIPTION_DOWNGRADE_EFFECTIVE` | Plan Downgrade Effective | `Your subscription plan changed to {targetPlan} for the new billing cycle.` | Scheduled downgrade takes effect at renewal. | `billing_state_service.ts` & `razorpay_webhook_service.ts` | `CONFIRMED_RECORDED` | `sourcePlan`, `targetPlan`, `currency` | `IDEMPOTENT_BY_ENTITY` (`planChangeId`) |
| `BILLING.SUBSCRIPTION_CANCELLATION_REQUESTED` | Subscription Cancellation Scheduled | `Scheduled cancellation for your {planName} subscription at period end.` | Customer requests cancellation via `POST /billing/subscription/cancel`. | `billing_state_service.ts` | `CONFIRMED_RECORDED` | `planCode`, `planName`, `currentPeriodEnd`, `cancelAtPeriodEnd` | `NONE` |
| `BILLING.SUBSCRIPTION_CANCELLATION_UNDONE` | Subscription Cancellation Reversed | `Resumed auto-renewal for your {planName} subscription.` | Customer reverses scheduled cancellation via `POST /billing/subscription/cancel/undo`. | `billing_state_service.ts` | `CONFIRMED_RECORDED` | `planCode`, `planName`, `currentPeriodEnd` | `NONE` |
| `BILLING.SUBSCRIPTION_CANCELLED` | Subscription Cancelled | `Your {planName} subscription has ended.` | Subscription transitions to final `CANCELLED` state. | `razorpay_webhook_service.ts` & `billing_state_service.ts` | `CONFIRMED_RECORDED` | `planCode`, `planName`, `cancelledAt` | `IDEMPOTENT_BY_ENTITY` (`subscriptionId`) |
| `BILLING.SUBSCRIPTION_PAYMENT_PAST_DUE` | Subscription Payment Past Due | `Renewal payment for {planName} is past due. Please review your payment method.` | Subscription enters `PAST_DUE`. | `dunning_service.ts` & `razorpay_webhook_service.ts` | `CONFIRMED_RECORDED` | `planCode`, `planName`, `gracePeriodEndsAt` | `STATE_TRANSITION_ONLY` |
| `BILLING.SUBSCRIPTION_GRACE_PERIOD_STARTED` | Billing Grace Period Started | `A billing grace period is active for your {planName} subscription while payment retry is pending.` | Subscription enters `GRACE_PERIOD`. | `dunning_service.ts` | `CONFIRMED_RECORDED` | `planCode`, `planName`, `gracePeriodEndsAt` | `STATE_TRANSITION_ONLY` |
| `BILLING.SUBSCRIPTION_GRACE_PERIOD_RECOVERED` | Subscription Payment Recovered | `Your {planName} subscription payment succeeded and full active status was restored.` | Payment succeeds during `PAST_DUE`/`GRACE_PERIOD`. | `dunning_service.ts` & `razorpay_webhook_service.ts` | `CONFIRMED_RECORDED` | `planCode`, `planName`, `currentPeriodEnd` | `STATE_TRANSITION_ONLY` |
| `BILLING.SUBSCRIPTION_EXPIRED` | Subscription Expired | `Your {planName} subscription expired and your account returned to the Free tier.` | Subscription transitions to `EXPIRED`. | `dunning_service.ts` & `billing_state_service.ts` | `CONFIRMED_RECORDED` | `planCode`, `planName`, `expiredAt` | `IDEMPOTENT_BY_ENTITY` |
| `BILLING.PAYMENT_SUCCEEDED` | Payment Succeeded | `Payment of {formattedAmount} for {planName} was processed successfully.` | Payment verified via checkout or `subscription.charged` webhook. | `razorpay_checkout_service.ts` & `razorpay_webhook_service.ts` | `CONFIRMED_RECORDED` | `amountMinorUnits`, `currency`, `formattedAmount`, `planCode`, `planName` | `IDEMPOTENT_BY_ENTITY` (`paymentId` deduplicates `PAYMENT_VERIFIED` + `WEBHOOK_PAYMENT_CAPTURED`) |
| `BILLING.PAYMENT_FAILED` | Payment Failed | `A subscription payment attempt for {planName} could not be completed.` | Payment attempt fails (`WEBHOOK_PAYMENT_FAILED` / `PAYMENT_VERIFICATION_FAILED`). | `razorpay_webhook_service.ts` & `razorpay_checkout_service.ts` | `CONFIRMED_RECORDED` | `amountMinorUnits`, `currency`, `planCode`, `planName`, `reasonSummary` | `COOLDOWN_WINDOW` (300s) |
| `BILLING.PAYMENT_REFUNDED` | Payment Refunded | `A refund of {formattedAmount} was processed for your account.` | Refund reaches `PROCESSED` status. | `billing_refund_service.ts` & `razorpay_webhook_service.ts` | `CONFIRMED_RECORDED` | `amountMinorUnits`, `currency`, `formattedAmount`, `refundId` | `IDEMPOTENT_BY_ENTITY` (`refundId`) |
| `BILLING.INVOICE_ISSUED` | Tax Invoice Issued | `Tax Invoice {invoiceNumber} ({formattedAmount}) was issued for your payment.` | `BillingInvoiceService.generateInvoiceForPayment` issues an invoice. | `src/services/billing/billing_invoice_service.ts` | `CONFIRMED_RECORDED` | `invoiceNumber`, `totalMinorUnits`, `currency`, `formattedAmount`, `planName` | `IDEMPOTENT_BY_ENTITY` (`invoiceId`; discriminated via `BILLING_STATE_UPDATED` + `action: 'STATUTORY_INVOICE_ISSUED'`) |
| `BILLING.INVOICE_DOWNLOADED` | Tax Invoice Downloaded | `Downloaded PDF for Tax Invoice {invoiceNumber}.` | Customer downloads invoice PDF via `GET /billing/invoices/:id/download` or `/payments/:id/invoice/download`. | `src/routes/billing.ts` | `CONFIRMED_RECORDED` | `invoiceNumber` | `COOLDOWN_WINDOW` (60s; refs `invoiceId`, `paymentId`) |
| `BILLING.RECEIPT_ISSUED` | Payment Receipt Issued | `Payment receipt {receiptNumber} was generated.` | `BillingReceiptService.generateReceiptForPayment` issues a receipt. | `src/services/billing/billing_receipt_service.ts` | `CONFIRMED_RECORDED` | `receiptNumber`, `totalMinorUnits`, `currency`, `planName` | `IDEMPOTENT_BY_ENTITY` (`receiptId`) |
| `BILLING.RECEIPT_DOWNLOADED` | Payment Receipt Downloaded | `Downloaded payment receipt {receiptNumber}.` | Customer downloads receipt via `GET /billing/receipts/:id/download`. | `src/routes/billing.ts` | `CONFIRMED_RECORDED` | `receiptNumber` | `COOLDOWN_WINDOW` (60s; refs `receiptId`, `paymentId`) |

### 3.5 Category 5: Notifications (`NOTIFICATIONS`)

| Event Type Identifier | Customer-Facing Title | Description Template | Triggering Business Action | Source Service / Route | Capability Status | Allowed Safe Metadata | Deduplication / Noise Policy |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `NOTIFICATION.SECURITY_ALERT_SENT` | Security Alert Dispatched | `Security notification "{notificationTitle}" was sent to your account.` | `NotificationService` dispatches an `ACCOUNT_SECURITY` alert. | `src/notifications/services/notification_service.ts` | `CONFIRMED_RECORDED` | `notificationTitle`, `notificationType`, `channels` | `IDEMPOTENT_BY_ENTITY` (once per `NotificationRecord`, never per retry) |
| `NOTIFICATION.INVOICE_EMAIL_SENT` | Invoice Notification Email Sent | `Tax Invoice {invoiceNumber} notification email was sent to {recipientEmail}.` | Outbox worker or notification service dispatches invoice email. | `invoice_notification_outbox_worker.ts` & `billing_invoice_notification_service.ts` | `CONFIRMED_RECORDED` | `invoiceNumber`, `recipientEmail`, `documentTitle` | `IDEMPOTENT_BY_ENTITY` (`invoiceId`) |
| `NOTIFICATION.STORAGE_ALERT_SENT` | Device Storage Capacity Alert | `Storage capacity alert ({severity}) triggered for device "{deviceName}".` | Storage warning/critical/recovered notification is created. | `src/notifications/services/notification_service.ts` | `CONFIRMED_RECORDED` | `deviceName`, `severity`, `notificationTitle` | `COOLDOWN_WINDOW` (3600s) |
| `NOTIFICATION.PREFERENCES_UPDATED` | Notification Preferences Updated | `Updated your email and push notification delivery preferences.` | Customer updates notification preferences via `PATCH /api/v1/notifications/preferences`. | `src/notifications/routes/preference_routes.ts` | `CONFIRMED_NEEDS_RECORDING` | `globalPushEnabled`, `globalEmailEnabled` | `NONE` |

---

## 4. Internal-Only Events Excluded from Customer Display

The following **36 existing `AuditEventType` values** (plus internal worker/telemetry events) are explicitly classified as `INTERNAL_ONLY` in `src/services/activity/customer_activity_taxonomy.ts` and **MUST NEVER** appear in the customer activity feed:

1. **Authentication & Session Internals:**
   - `OTP_SENT` (internal SMTP dispatch trace; redundant with sign-in and password reset events)
   - `DEVICE_CREDENTIAL_CREATED` (internal token provisioning during device registration)
   - `DEVICE_SESSION_REFRESHED` (high-frequency unattended background token rotation on Android)
   - `DEVICE_SESSION_REFRESH_FAILED` (internal background token validation trace)
2. **Gateway & Endpoint Internals:**
   - `ENDPOINT_ASSIGNED` (internal binding step superseded by `SERVER_ENDPOINT_ALLOCATED`)
   - `REMOTE_CONNECTION_CREATED` (pre-handshake `CONNECTING` intent generated on every reconnect attempt)
   - Periodic device/connection heartbeats (`POST /devices/:deviceId/heartbeat`, `POST /connections/:connectionId/heartbeat`), WebSocket ping/pong frames, and `StateReconciliationService` sweeps
3. **File Manager Read/Streaming Internals:**
   - Directory listings (`GET /file-manager/:serverId/files`), recent-file queries (`GET /files/recent`), storage capacity polls (`GET /storage`), health probes (`GET /access`), and HTTP 206 byte-range media streaming chunks
4. **Notification & Push Transport Internals:**
   - `PUSH_TOKEN_REGISTERED`, `PUSH_TOKEN_UPDATED`, `PUSH_TOKEN_REVOKED` (internal FCM token lifecycle)
   - `NOTIFICATION_CREATED`, `NOTIFICATION_DELIVERY_FAILED` (internal worker delivery traces)
   - `InvoiceNotificationOutbox` lease claims (`PROCESSING`), retryable failure backoffs (`RETRYABLE_FAILURE`), shadow-mode rows (`SHADOW_*`), and raw `EmailWebhookInbox` events (`delivered`, `opened`, `clicked`, `soft_bounce`, `hard_bounce`)
5. **Financial Reconciliation, Tax Engine & Fee Accounting Internals:**
   - `SUBSCRIPTION_CREATED` (internal pre-checkout contract row)
   - `SUBSCRIPTION_UPGRADE_RECONCILIATION_MATCHED`, `SUBSCRIPTION_UPGRADE_RECONCILIATION_MISMATCHED`
   - `SUBSCRIPTION_DOWNGRADE_REQUESTED`, `SUBSCRIPTION_DOWNGRADE_MISMATCHED`
   - `REFUND_REQUESTED`, `REFUND_PROVIDER_REQUESTED`, `REFUND_FAILED`, `REFUND_REQUIRES_REVIEW`, `REFUND_DUPLICATE_REQUEST`
   - `BILLING_RECEIPT_GENERATION_FAILED`
   - `TAX_CALCULATED`, `TAX_CALCULATION_FAILED`, `TAX_CONFIGURATION_MISSING`
   - `PROCESSING_FEE_RECORDED`, `PROCESSING_FEE_PENDING`, `PROCESSING_FEE_RECONCILIATION_REQUIRED`
   - `BILLING_RECONCILIATION_RUN_STARTED`, `BILLING_RECONCILIATION_RUN_COMPLETED`, `BILLING_RECONCILIATION_RUN_FAILED`, `BILLING_RECONCILIATION_DISCREPANCY_DETECTED`, `BILLING_RECONCILIATION_DISCREPANCY_RESOLVED`, `BILLING_RECONCILIATION_AUTO_HEALED`
   - `BILLING_SETTLEMENT_IMPORTED`, `BILLING_SETTLEMENT_RECONCILED`, `BILLING_SETTLEMENT_MISMATCH_DETECTED`

---

## 5. Privacy & Security Rules

1. **Zero Secret or Credential Leakage:**
   - `sanitizeCustomerActivityMetadata()` enforces both a per-event allowlist (`allowedMetadataKeys`) and a global substring blocklist (`PROHIBITED_ACTIVITY_METADATA_SUBSTRINGS`) that strips any key containing `password`, `passwordHash`, `adminPassword`, `otp`, `otpCode`, `token`, `tokenHash`, `credential`, `credentialHash`, `secret`, `privateKey`, `signature`, `authorization`, `cookie`, `csrf`, `dataBase64`, `rawPayload`, `rawBody`, `stackTrace`, `webhookSecret`, `keySecret`, `fcmToken`, or `connectionToken`.
2. **IP Address Masking:**
   - Full client IP addresses are retained only in internal security logs (`AdminAuditLog` / internal `AuditEvent`). Customer-facing activity metadata and descriptions must use `maskIpAddressForCustomerDisplay()` (e.g., `203.0.113.42` -> `203.0.113.xxx`, `2001:db8:85a3::8a2e:370:7334` -> `2001:db8:85a3:****`).
3. **File Path & Content Privacy:**
   - File contents (`dataBase64`), binary buffers, and internal host filesystem paths are never stored in activity records. Only sanitized base filenames (`fileName`, `itemName`, `folderName`, truncated to <= 255 characters) and relative server directory paths are allowed.
4. **Strict Tenant Isolation (IDOR Prevention):**
   - Every customer activity query in Phase 9.3 must scope `WHERE userId = authenticatedUser.id` derived strictly from the verified session token—never from client-supplied query or path parameters.

---

## 6. Phase 9.2 Data Model & Recording Architecture Recommendation

### 6.1 Evaluation of Storage Options
- **Option A — Query `AuditEvent` Directly at Read Time:**
  - *Drawbacks:* `AuditEvent` lacks `category`, `serverId`, `invoiceId`, `subscriptionId`, `title`, `description`, and `idempotencyKey`. Furthermore, `AuditEvent` currently has single-column indexes (`@@index([userId])`, `@@index([eventType])`, `@@index([createdAt])`) rather than a composite `[userId, createdAt DESC]` index, and mixes noisy internal reconciliation/token events with customer events. Additionally, `AuditEvent.deviceId` has an active foreign key to `Device(id)`, which forces `deviceId` to be set to `null` when a device is deleted (`src/routes/device.ts` line 913).
- **Option B — Dedicated `CustomerActivityEvent` Model + Dual-Write / Backfill Projection (Recommended for Phase 9.2):**
  - Introduce a purpose-built `CustomerActivityEvent` model in `prisma/schema.prisma` while keeping `AuditEvent` intact for internal security and financial compliance auditing:
    - `id`: `String @id @default(uuid())`
    - `userId`: `String` (indexed with `ON DELETE CASCADE` to `User`)
    - `category`: `String` (`CustomerActivityCategory`)
    - `eventType`: `String` (`CustomerActivityEventType`)
    - `title`: `String` (`@db.VarChar(160)`)
    - `description`: `String` (`@db.VarChar(500)`)
    - `deviceId`: `String?` (stored as an un-constrained reference or `ON DELETE SET NULL` alongside `metadata.deviceName` snapshot so deleted devices remain identifiable in historical activity)
    - `serverId`: `String?`
    - `invoiceId`: `String?`
    - `subscriptionId`: `String?`
    - `paymentId`: `String?`
    - `receiptId`: `String?`
    - `metadata`: `Json?` (strictly sanitized via `sanitizeCustomerActivityMetadata`)
    - `idempotencyKey`: `String? @unique` (prevents duplicate activity entries on retries or checkout/webhook overlap)
    - `occurredAt`: `DateTime @default(now())`
    - `createdAt`: `DateTime @default(now())`
  - **Required Composite Indexes for Phase 9.2 / 9.3 Pagination & Filtering:**
    - `@@index([userId, occurredAt(sort: Desc)])` — primary customer feed timeline query
    - `@@index([userId, category, occurredAt(sort: Desc)])` — category-filtered feed query
    - `@@index([userId, eventType, occurredAt(sort: Desc)])` — event-type filtering and cooldown deduplication lookup
  - **Historical Continuity:** In Phase 9.2/9.3, existing customer-visible `AuditEvent` rows can either be projected on-the-fly using `resolveAuditEventToCustomerActivity()` or backfilled into `CustomerActivityEvent` so existing customers immediately see their historical account, server, and invoice activity.

---

## 7. Files Created or Modified in Phase 9.1

1. **Created:** `main website/Backend/src/services/activity/customer_activity_taxonomy.ts`
   - Authoritative TypeScript module exporting `CustomerActivityCategory`, `CustomerActivityEventType`, `CUSTOMER_ACTIVITY_TAXONOMY`, `INTERNAL_ONLY_AUDIT_EVENT_TYPES`, `EXISTING_AUDIT_EVENT_CLASSIFICATION`, `sanitizeCustomerActivityMetadata`, `maskIpAddressForCustomerDisplay`, and `resolveAuditEventToCustomerActivity`.
2. **Created:** `main website/Backend/tests/customer_activity_taxonomy.test.ts`
   - Static unit test specifications (marked **NOT EXECUTED** per policy) covering all 5 categories, 48 event definitions, internal audit event exclusion, discriminated audit event resolution, metadata secret stripping, and IP masking.
3. **Created:** `PHASE-9.1-REPORT.md` (persisted to artifact directory, `main website/Backend/PHASE-9.1-REPORT.md`, and repository root `PHASE-9.1-REPORT.md`).

---

## 8. Non-Execution & Scope Compliance Attestation

- **Tests Executed:** `NONE` (Static test specifications authored only; marked `// NOTE: These tests are NOT EXECUTED as per policy.`).
- **Database Migrations Created or Applied:** `NONE`.
- **Prisma Client Generation / Builds Executed:** `NONE`.
- **Phase Boundary:** Strictly limited to Phase 9.1. Phase 9.2 backend event recording, Phase 9.3 Activity API, and Phase 9.4 Activity UI have not been started.
