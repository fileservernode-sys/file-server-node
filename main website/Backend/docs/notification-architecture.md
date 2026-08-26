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
- **Notification Record (`NotificationRecord`)**: User-facing message stored in the database / notification center. States: `UNREAD`, `READ`, `ARCHIVED`.
- **Channel Delivery (`ChannelDeliveryRecord`)**: Transport layer attempt for a specific channel (`IN_APP`, `PUSH`, `EMAIL`). States: `QUEUED`, `PROCESSING`, `DELIVERED`, `FAILED`, `RETRYING`, `PERMANENTLY_FAILED`.

### 4. Security Notification Policy
Security-critical events (`EMAIL_VERIFICATION`, `SIGN_IN`, `SECURITY_EVENT`, `DEVICE_LINKED`) enforce mandatory delivery across Email, Push, and In-App channels. They bypass user preference opt-outs to maintain account safety.

### 5. Multi-Device Routing Engine
RemoteNode supports multiple Android devices per account.
Routing targets:
- `Account`: Broadcast to all registered devices.
- `Device`: Targeted to a specific `deviceId`.
- `Server`: Targeted to the device hosting the specific `serverId`.

### 6. Idempotency & Storm Protection
- **Idempotency Key**: Generated from `eventType:userId:deviceId:serverId:timestamp`. Prevents duplicate processing during backend worker restarts or API retries.
- **Storm Protection**: Debounces rapid repeated notifications (e.g. server rapid online/offline toggling) within a configurable cooldown window.

### 7. Retry Architecture & Error Classification
- **Temporary Failure**: Network timeouts, provider rate-limiting. Retried with exponential backoff.
- **Permanent Failure**: Invalid email, unregistered push token. Instantly marked `PERMANENTLY_FAILED` without retries.

### 8. Template Engine & Deep-Linking
Templates are defined centrally in `TemplateRegistry`. Context parameters (`userName`, `deviceName`, `serverName`, `fileCount`, etc.) are interpolated safely. Standard deep links follow safe logical schemes (e.g. `remotenode://server/{id}`, `remotenode://filemanager`).
