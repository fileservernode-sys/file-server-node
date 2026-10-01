# ZdexCloud Admin Email Operations API Specification

---

## 1. Overview & Architecture

The **Email Operations API** provides the administrative control plane with comprehensive, secure, read-only telemetry for outbound email tracking, delivery verification, failure classification, retry monitoring, daily analytics, and retention inspection.

### Core Invariants:
1. **Authoritative Source of Truth**: `EmailMessage` represents message-level delivery state. `EmailDeliveryAttempt` logs individual send/retry attempts and does not inflate message volume.
2. **Delivery Semantics**: `SENT != DELIVERED`. A message is `SENT` upon successful upstream handover (Brevo API / SMTP relay), and transitions to `DELIVERED` only upon verified provider delivery synchronization.
3. **Privacy & Security**: Zero customer email bodies, HTML, passwords, session tokens, or OTP codes are stored or returned. All responses pass through recursive redaction.
4. **Strictly Read-Only**: No mutation endpoints (delete, purge, retry, resend, replay) are permitted.

---

## 2. Authentication & Authorization

All endpoints require:
- **Authentication**: Valid Admin session token passed via `x-admin-session-token` header.
- **RBAC Permission**: `emails.read` permission.

---

## 3. Endpoints

### 3.1 List Outbound Emails
`GET /api/v1/admin/emails`

Retrieves a paginated list of outbound email records with allowlisted filtering and deterministic sorting.

#### Query Parameters:
| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `page` | `number` | `1` | Page number (min: 1) |
| `limit` / `pageSize` | `number` | `20` | Items per page (min: 1, max: 100) |
| `sortBy` | `string` | `createdAt` | Sort field (`createdAt`, `queuedAt`, `sentAt`, `deliveredAt`, `failedAt`, `status`, `emailType`, `recipientEmail`, `provider`) |
| `sortOrder` | `string` | `desc` | Sort direction (`asc`, `desc`) |
| `status` | `EmailMessageStatus` | - | Filter by status (`QUEUED`, `SENT`, `DELIVERED`, `DEFERRED`, `RETRYING`, `BOUNCED`, `BLOCKED`, `SPAM`, `FAILED`, `PERMANENTLY_FAILED`) |
| `sourcePipeline` | `EmailSourcePipeline`| - | Filter by pipeline (`OTP`, `NOTIFICATION`, `SYSTEM`, `TRANSACTIONAL`) |
| `transport` | `EmailTransport` | - | Filter by transport (`BREVO_API`, `SMTP_RELAY`, `MOCK`) |
| `provider` | `string` | - | Filter by provider (`BREVO`, etc.) |
| `emailType` | `string` | - | Filter by email type |
| `templateId` | `string` | - | Filter by template identifier |
| `recipientEmail` | `string` | - | Filter by recipient email address |
| `userId` | `string` | - | Filter by recipient user account ID |
| `providerMessageId`| `string` | - | Filter by provider message ID |
| `requestId` | `string` | - | Filter by request correlation ID |
| `correlationId` | `string` | - | Filter by idempotency/event correlation ID |
| `startDate` | `string` | - | Inclusive start date (ISO-8601 or YYYY-MM-DD) |
| `endDate` | `string` | - | Exclusive / End-of-day end date (ISO-8601 or YYYY-MM-DD, max 366-day span) |
| `search` | `string` | - | Free-text search across allowlisted fields (`recipientEmail`, `subject`, `providerMessageId`, `emailType`, `templateId`, `requestId`, `correlationId`, `userId`) |

#### Success Response (200 OK):
```json
{
  "success": true,
  "data": {
    "emails": [
      {
        "id": "cm1abc...",
        "userId": "usr_123",
        "emailType": "REGISTRATION_OTP",
        "templateId": "EMAIL_VERIFICATION",
        "recipientEmail": "user@example.com",
        "recipientName": null,
        "senderEmail": "noreply@zdexcloud.com",
        "senderName": "ZdexCloud",
        "subject": "[ZdexCloud] Verify Your Email Address",
        "sourcePipeline": "OTP",
        "status": "DELIVERED",
        "provider": "BREVO",
        "transport": "BREVO_API",
        "providerMessageId": "12345678-abcd",
        "providerResponseCode": "200",
        "failureCode": null,
        "failureReason": null,
        "attemptCount": 1,
        "maxAttempts": 1,
        "queuedAt": null,
        "sentAt": "2026-10-01T10:00:00.000Z",
        "deliveredAt": "2026-10-01T10:00:02.000Z",
        "failedAt": null,
        "lastAttemptAt": "2026-10-01T10:00:00.000Z",
        "nextRetryAt": null,
        "requestId": "req_123",
        "correlationId": null,
        "deviceId": null,
        "serverId": null,
        "createdAt": "2026-10-01T10:00:00.000Z",
        "updatedAt": "2026-10-01T10:00:02.000Z"
      }
    ],
    "items": [...],
    "pagination": {
      "page": 1,
      "limit": 20,
      "pageSize": 20,
      "total": 142,
      "totalPages": 8,
      "hasNext": true,
      "hasPrevious": false
    }
  }
}
```

---

### 3.2 Get Email Detail
`GET /api/v1/admin/emails/:emailId`

Retrieves single email record audit detail including sanitized metadata, delivery attempts, and provider timestamps.

#### Success Response (200 OK):
```json
{
  "success": true,
  "data": {
    "email": {
      "id": "cm1abc...",
      "userId": "usr_123",
      "emailType": "REGISTRATION_OTP",
      "templateId": "EMAIL_VERIFICATION",
      "recipientEmail": "user@example.com",
      "subject": "[ZdexCloud] Verify Your Email Address",
      "sourcePipeline": "OTP",
      "status": "DELIVERED",
      "provider": "BREVO",
      "transport": "BREVO_API",
      "providerMessageId": "12345678-abcd",
      "providerResponse": {
        "messageId": "12345678-abcd"
      },
      "metadata": {
        "lastProviderEvent": "delivered",
        "lastProviderEventAt": "2026-10-01T10:00:02.000Z",
        "processedEvents": [
          { "eventId": "12345678-abcd_delivered_1759312802000", "event": "delivered", "at": "2026-10-01T10:00:02.000Z" }
        ]
      },
      "attempts": [
        {
          "id": "att_1",
          "emailMessageId": "cm1abc...",
          "attemptNumber": 1,
          "transport": "BREVO_API",
          "status": "SENT",
          "providerMessageId": "12345678-abcd",
          "providerResponseCode": "200",
          "providerResponse": { "messageId": "12345678-abcd" },
          "failureReason": null,
          "durationMs": 142,
          "attemptedAt": "2026-10-01T10:00:00.000Z"
        }
      ],
      "createdAt": "2026-10-01T10:00:00.000Z",
      "updatedAt": "2026-10-01T10:00:02.000Z"
    }
  }
}
```

---

### 3.3 Get Email Delivery Attempts
`GET /api/v1/admin/emails/:emailId/attempts`

Retrieves the individual delivery attempts for a given email message.

#### Success Response (200 OK):
```json
{
  "success": true,
  "data": {
    "emailId": "cm1abc...",
    "attempts": [
      {
        "id": "att_1",
        "emailMessageId": "cm1abc...",
        "attemptNumber": 1,
        "transport": "BREVO_API",
        "status": "SENT",
        "providerMessageId": "12345678-abcd",
        "providerResponseCode": "200",
        "providerResponse": { "messageId": "12345678-abcd" },
        "failureReason": null,
        "durationMs": 142,
        "attemptedAt": "2026-10-01T10:00:00.000Z"
      }
    ]
  }
}
```

---

### 3.4 Get User Outbound Email History
`GET /api/v1/admin/users/:userId/emails`
`GET /api/v1/admin/operations/users/:userId/emails` (Operational alias)

Retrieves chronological email history strictly scoped to `EmailMessage.userId === :userId`.

#### Success Response (200 OK):
```json
{
  "success": true,
  "data": {
    "userId": "usr_123",
    "userEmail": "user@example.com",
    "userName": "John Doe",
    "emails": [...],
    "items": [...],
    "pagination": {
      "page": 1,
      "limit": 20,
      "pageSize": 20,
      "total": 14,
      "totalPages": 1,
      "hasNext": false,
      "hasPrevious": false
    }
  }
}
```

---

### 3.5 Get Email Analytics & Metrics
`GET /api/v1/admin/emails/analytics`

Retrieves aggregated KPIs, delivery confirmation rates, status distribution, provider usage, top email types, daily time-series trends, and retention window metadata across a bounded window (max 366 days).

#### Query Parameters:
| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `startDate` | `string` | 30 days ago | Inclusive start date (ISO-8601 or YYYY-MM-DD) |
| `endDate` | `string` | Now | End date (ISO-8601 or YYYY-MM-DD) |

#### Success Response (200 OK):
```json
{
  "success": true,
  "data": {
    "timeRange": {
      "startDate": "2026-09-01",
      "endDate": "2026-10-01",
      "daysCount": 31
    },
    "kpis": {
      "totalEmails": 1520,
      "totalAttempts": 1548,
      "queuedCount": 2,
      "sentCount": 18,
      "deliveredCount": 1480,
      "deferredCount": 5,
      "retryingCount": 3,
      "failedCount": 12,
      "permanentlyFailedCount": 5,
      "bouncedCount": 10,
      "softBouncedCount": 4,
      "hardBouncedCount": 6,
      "blockedCount": 3,
      "spamCount": 2,
      "terminalCount": 1500,
      "deliveryConfirmationRatePercent": 98.67,
      "overallDeliveryRatePercent": 98.67,
      "deliveryRatePercent": 98.67
    },
    "statusDistribution": { ... },
    "pipelineDistribution": { ... },
    "transportDistribution": { ... },
    "providerDistribution": { ... },
    "topEmailTypes": [
      { "emailType": "REGISTRATION_OTP", "count": 820 },
      { "emailType": "PASSWORD_RESET_OTP", "count": 410 },
      { "emailType": "NOTIFICATION", "count": 290 }
    ],
    "dailyTrends": [ ... ],
    "retentionInfo": {
      "configuredRetentionDays": 90,
      "oldestRetainedRecordAt": "2026-07-03T10:00:00.000Z",
      "isPartialData": false
    }
  }
}
```

---

### 3.6 Get Retention Worker Telemetry
`GET /api/v1/admin/emails/retention`

Read-only operational status of the background email retention cleanup worker.

#### Success Response (200 OK):
```json
{
  "success": true,
  "data": {
    "retention": {
      "enabled": true,
      "configuredRetentionDays": 90,
      "cleanupBatchSize": 100,
      "cleanupIntervalMinutes": 1440,
      "dryRun": false,
      "lastRunAt": "2026-10-01T02:00:00.000Z",
      "lastSuccessfulRunAt": "2026-10-01T02:00:05.000Z",
      "lastRunDurationMs": 5210,
      "lastRunDeletedCount": 42,
      "totalRuns": 12,
      "totalDeletedRecords": 580,
      "eligibleRecordCount": 0,
      "oldestRetainedRecordAt": "2026-07-03T10:00:00.000Z"
    }
  }
}
```
