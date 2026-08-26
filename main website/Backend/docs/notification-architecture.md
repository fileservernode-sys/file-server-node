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
