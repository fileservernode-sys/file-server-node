# RemoteNode Notification System Architecture

This document specifies the technical architecture for the RemoteNode Central Notification & Communication System (Track 4).

## Core Architectural Principle

```
ONE REMOTENODE EVENT
        ↓
CENTRAL NOTIFICATION ENGINE
        ↓
PREFERENCE / ROUTING ENGINE
        ↓
CHANNEL DELIVERY
     /         \
   PUSH       EMAIL
    ↓           ↓
ANDROID APP   USER EMAIL
```

Features and event producers MUST NOT directly send emails or push notifications. All events flow through the `CentralNotificationService`.

## Domain Models & Authoritative Registries

The notification module is located at `main website/Backend/src/notifications/`.

### 1. Notification Categories (`NotificationCategory`)
- `ACCOUNT_SECURITY`: Registration, verification, login, password changes, security alerts.
- `DEVICE_SERVER`: Device linking, connect/disconnect, server create/start/stop, gateway events.
- `FILE_OPERATIONS`: Uploads, downloads, renames, batch operations.
- `STORAGE`: Storage capacity warnings, critical space alerts, recovery.
- `SYSTEM`: Scheduled maintenance, outages, product announcements.

### 2. Severity & Priority (`NotificationSeverity`)
- `INFO`: Standard updates. Normal push priority, low email urgency. Suppressible.
- `SUCCESS`: Operational completions. Normal push priority, standard email urgency. Suppressible.
- `WARNING`: Low space, server stop. Normal push priority, standard email urgency. Suppressible.
- `CRITICAL`: Outage, server unreachable, storage critical. High push priority, immediate email. Mandatory.
- `SECURITY`: Login from new IP, password change, verification. High push priority, immediate email. Security Policy Bypass.

### 3. Notification vs. Delivery Distinction
- **Notification Record (`NotificationRecord`)**: User-facing message stored in MySQL database / notification center. States: `UNREAD`, `READ`, `ARCHIVED`.
- **Channel Delivery (`ChannelDeliveryRecord`)**: Transport layer attempt for a specific channel (`IN_APP`, `PUSH`, `EMAIL`). States: `QUEUED`, `PROCESSING`, `DELIVERED`, `FAILED`, `RETRYING`, `PERMANENTLY_FAILED`.

### 4. Database Persistence Entities (Track 4 Batch NT-1.2)
- `NotificationRecord`: Persisted in MySQL with unique `idempotencyKey`, relation to `User` and `Device`.
- `ChannelDeliveryRecord`: Persisted delivery attempts linked to `NotificationRecord`.
- `UserNotificationPreferences`: Persisted global and category preferences linked to `User`.
- `DevicePushToken`: Active FCM tokens linked to `User` and `Device`.

### 5. Production FCM Push Provider (`FcmPushProvider`)
- Implements `PushNotificationProvider`.
- Environment credentials: `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`.
- FCM Priority Mapping: `INFO`/`SUCCESS`/`WARNING` $\rightarrow$ `normal`, `CRITICAL`/`SECURITY` $\rightarrow$ `high`.
- Failure Handling: Invalid/unregistered tokens trigger token revocation + `PERMANENTLY_FAILED` status; network timeouts trigger `RETRYING` state.

### 6. Authenticated REST APIs
- **Push Tokens**:
  - `POST /api/v1/devices/:deviceId/push-token` — Register FCM token (enforces `user.id === device.userId`).
  - `PATCH /api/v1/devices/:deviceId/push-token` — Update token.
  - `DELETE /api/v1/devices/:deviceId/push-token` — Revoke token.
- **Preferences**:
  - `GET /api/v1/notifications/preferences` — Get preferences.
  - `PATCH /api/v1/notifications/preferences` — Update preferences.
- **Notification History**:
  - `GET /api/v1/notifications` — List notifications (paginated `page`, `limit`).
  - `GET /api/v1/notifications/unread-count` — Count unread notifications.
  - `PATCH /api/v1/notifications/:notificationId/read` — Mark notification read (user ownership enforced).
  - `PATCH /api/v1/notifications/:notificationId/archive` — Mark notification archived (user ownership enforced).

### 7. End-to-End Notification Pipeline & Production Email Delivery (Batch NT-1.4)
- **Production Email Provider (`EmailNotificationProvider`)**:
  - Implements `EmailNotificationProvider` (`channel = NotificationChannel.EMAIL`).
  - Translates `ProviderDeliveryRequest` into HTML and plain-text emails, leveraging existing `EmailService` (`src/services/email.ts`).
  - Resolves target recipient emails securely via Prisma when not explicitly specified in the request.
  - Classifies delivery errors into `PERMANENT_FAILURE` (e.g. invalid recipient address) vs `TEMPORARY_ERROR` (e.g. SMTP/HTTP connection timeouts).
- **Canonical Event Producers (`src/notifications/producers/`)**:
  - `AccountEventProducer`: `ACCOUNT_CREATED`, `SIGN_IN`, `SECURITY_EVENT`.
  - `DeviceEventProducer`: `DEVICE_LINKED`, `DEVICE_ONLINE`, `DEVICE_OFFLINE`.
  - `ServerEventProducer`: `SERVER_CREATED`, `SERVER_STARTED`, `SERVER_STOPPED`, `SERVER_UNAVAILABLE`, `SERVER_RECOVERED`.
  - `GatewayEventProducer`: `GATEWAY_CONNECTED`, `GATEWAY_DISCONNECTED`.
  - `FileEventProducer`: `FILE_UPLOAD_COMPLETED`, `FILE_UPLOAD_FAILED`, `FILE_OPERATION_COMPLETED`, `FILE_OPERATION_FAILED`.
  - `StorageEventProducer`: `STORAGE_WARNING`, `STORAGE_CRITICAL`, `STORAGE_RECOVERED`.
- **Non-Blocking Execution Guarantee**:
  - Triggers inside feature routes (`auth.ts`, `device.ts`, `gateway_service.ts`, `file-manager.ts`) execute asynchronously with explicit `.catch()` handlers so notification pipeline failures never crash core application workflows.
- **Sensitive Metadata Rejection**:
  - `TemplateRegistry.render()` automatically redacts sensitive keys (`password`, `token`, `jwt`, `fcmtoken`, `privatekey`, `secret`, `authorization`, `otp`) before interpolating metadata into template output.
- **Delivery Worker Processor (`DeliveryProcessor`)**:
  - Worker process (`src/notifications/workers/delivery_processor.ts`) periodically claims `QUEUED` / `RETRYING` delivery records with `nextRetryAt <= now`.
  - Dispatches payloads via registered channel providers with exponential backoff retry scheduling.

