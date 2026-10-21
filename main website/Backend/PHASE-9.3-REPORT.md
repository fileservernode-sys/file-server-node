# ZDEXCLOUD: PHASE 9.3 REPORT
## CUSTOMER ACTIVITY API IMPLEMENTATION

**Date:** 2026-10-11  
**Target Subsystem:** `main website/Backend/`  
**Execution Mode:** Focused implementation (Strictly non-executing — no tests, builds, migrations, or Prisma client generation executed)  
**Final Source-Level Implementation Status:** `IMPLEMENTED`

---

## 1. Endpoint and Route Registration

- **HTTP Method & Path:** `GET /api/v1/account/activity`
- **Route Module:** `main website/Backend/src/routes/activity.ts` (`activityRoutes`)
- **Router Registration:** Registered inside `apiV1Routes` in `main website/Backend/src/routes/index.ts`, which is mounted under prefix `/api/v1` in `main website/Backend/src/app.ts`.
- **Rate Limiting:** Configured with `customerStandardRateLimitConfig` (`60 requests / minute`) from `main website/Backend/src/middleware/rate_limit_presets.ts`.
- **Cache Control:** Responses set `Cache-Control: private, no-store, max-age=0` to prevent shared proxy caching of authenticated customer activity.

---

## 2. Request Parameters and Response Contract

### 2.1 Query Parameters
| Parameter | Type | Required | Constraints & Behavior |
| :--- | :--- | :--- | :--- |
| `cursor` | `string` | Optional | Opaque `base64url`-encoded JSON cursor `{"t":"<ISO-8601>","i":"<id>"}` returned as `pagination.nextCursor` from the previous page. Validated via `decodeActivityCursor`. |
| `limit` | `number` | Optional | Bounded page size. Default: `20`, Minimum: `1`, Maximum: `100`. Out-of-range or non-integer values throw `400 ValidationError`. |
| `category` | `string` | Optional | Restricted to valid customer-visible taxonomy categories (`ACCOUNT_SECURITY`, `SERVERS_DEVICES`, `FILE_ACCESS`, `BILLING_INVOICES`, `NOTIFICATIONS`). Invalid categories throw `400 ValidationError`. |
| `eventType` | `string` | Optional | Restricted to valid customer-visible `CustomerActivityEventType` identifiers in `CUSTOMER_ACTIVITY_TAXONOMY`. Unknown or internal-only event types throw `400 ValidationError`. |
| `from` (or `startDate`) | `string` | Optional | Lower bound on `occurredAt` (`>= from`). Must be a valid ISO-8601 date or timestamp string. |
| `to` (or `endDate`) | `string` | Optional | Upper bound on `occurredAt` (`<= to`). Must be a valid ISO-8601 date or timestamp string. If `from > to`, throws `400 ValidationError`. |

### 2.2 Response Contract (`200 OK`)
Wrapped in the standard ZdexCloud `createSuccessResponse` envelope:
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "act_8c91a4...",
        "eventType": "BILLING.INVOICE_DOWNLOADED",
        "category": "BILLING_INVOICES",
        "severity": "INFO",
        "title": "Tax Invoice Downloaded",
        "description": "Downloaded PDF for Tax Invoice ZDX-IN-2026-000042.",
        "occurredAt": "2026-10-11T10:15:30.000Z",
        "entities": {
          "invoiceId": "inv_01...",
          "paymentId": "pay_01..."
        },
        "metadata": {
          "invoiceNumber": "ZDX-IN-2026-000042"
        }
      }
    ],
    "pagination": {
      "limit": 20,
      "hasMore": false,
      "nextCursor": null
    },
    "filters": {
      "category": null,
      "eventType": null,
      "from": null,
      "to": null
    }
  }
}
```

### 2.3 Error Responses
Standard `createErrorResponse` format via `globalErrorHandler`:
- `401 UNAUTHORIZED`: Missing, expired, or invalid session token, or conflicting Bearer + Cookie credentials.
- `403 FORBIDDEN`: Device runtime token (`dst_...`) attempting to access interactive customer endpoints.
- `400 VALIDATION_ERROR`: Malformed `cursor`, invalid `limit` (`< 1` or `> 100`), invalid/internal `category` or `eventType`, conflicting `category` + `eventType`, malformed ISO-8601 dates, or `from > to`.

---

## 3. Authentication, Ownership, and Privacy Controls

1. **Authoritative Server-Side Session Identity:**
   - `activityRoutes` resolves the authenticated customer exclusively via `await getAuthUser(request)` from `src/middleware/customer-auth.ts`.
   - Any caller-supplied `userId` query parameter is ignored; `user.id` from the verified session is the sole ownership authority passed into `CustomerActivityService.listUserActivity`.
2. **Mandatory Database Query Scoping:**
   - Every query in `CustomerActivityService.listUserActivity` enforces `where: { userId: authenticatedUserId }` and restricts `eventType` to customer-visible taxonomy values.
3. **Explicit Allowlist Response Serializer (`serializeCustomerActivityEvent`):**
   - Implemented in `src/services/activity/customer_activity_service.ts`.
   - Returns only the 9 allowlisted properties (`id`, `eventType`, `category`, `severity`, `title`, `description`, `occurredAt`, `entities`, `metadata`).
   - Strictly omits `userId`, `idempotencyKey`, `createdAt`, and raw database fields.
   - Re-executes `sanitizeCustomerActivityMetadata(eventType, row.metadata)`, `maskIpAddressForCustomerDisplay`, and `summarizeUserAgentForCustomerDisplay` on read as defense-in-depth so secrets, tokens, full IP addresses, raw user-agent strings, S3 storage keys, and internal provider IDs (`providerPaymentId`, `providerSubscriptionId`, `razorpaySignature`, etc.) can never leak.
4. **Historical Preservation of Deleted Entities:**
   - Entity references (`deviceId`, `serverId`, `invoiceId`, `subscriptionId`, `paymentId`, `receiptId`) are stored and serialized as nullable scalar identifiers filtered by `spec.entityReferences`, so historical events remain intact even after a linked device or server is deleted.

---

## 4. Pagination and Filtering Behavior

- **Deterministic Chronological Ordering:**
  - Queries order by `[{ occurredAt: 'desc' }, { id: 'desc' }]`, backed by the composite indexes defined on `CustomerActivityEvent` (`customer_activity_user_time_idx`, `customer_activity_user_cat_time_idx`, `customer_activity_user_type_time_idx`).
- **Lookahead Cursor Pagination (`limit + 1`):**
  - Fetches `take: limit + 1` rows to determine `hasMore` in a single indexed query without an extra `COUNT(*)` scan.
  - When `cursor` is provided, applies the keyset predicate:
    ```ts
    OR: [
      { occurredAt: { lt: decodedCursor.occurredAt } },
      { occurredAt: decodedCursor.occurredAt, id: { lt: decodedCursor.id } }
    ]
    ```
- **Empty State Handling:**
  - Returns `items: []`, `pagination: { limit, hasMore: false, nextCursor: null }` when no matching events exist.

---

## 5. Files Created or Modified

### Created
1. `main website/Backend/src/routes/activity.ts`
2. `main website/Backend/tests/customer_activity_api.test.ts` (`NOT EXECUTED`)
3. `PHASE-9.3-REPORT.md`

### Modified
1. `main website/Backend/src/services/activity/customer_activity_service.ts`
2. `main website/Backend/src/routes/index.ts`
3. `main website/Backend/tests/customer_activity_service.test.ts` (`NOT EXECUTED`)

---

## 6. Test Specifications Added (`NOT EXECUTED`)

Authored `main website/Backend/tests/customer_activity_api.test.ts` (`NOT EXECUTED`) covering:
1. Unauthenticated requests (`UnauthorizedError` when `authenticatedUserId` is missing).
2. Strict customer ownership isolation (`where.userId === authenticatedUserId`, ignoring spoofed `userId` parameters, and filtering out any mismatched rows).
3. Cursor pagination, deterministic `[{ occurredAt: 'desc' }, { id: 'desc' }]` ordering, `hasMore` / `nextCursor` calculation, and `limit` bounds validation (`1..100`).
4. Valid and invalid `category` and `eventType` filters, including rejection of internal-only audit event types and contradictory `category` + `eventType` combinations.
5. Empty activity history response structure.
6. Response-field allowlisting and sensitive metadata exclusion (`userId`, `idempotencyKey`, `createdAt`, `providerPaymentId`, `razorpaySignature`, `passwordHash`, `s3Key`, plus IP masking and User-Agent summarization on read).
7. Malformed cursor and invalid/inverted date-range inputs (`from > to`).
8. Preservation of historical activity records and scalar entity IDs after related devices or servers are deleted.

---

## 7. Known Prerequisites and Limitations

1. **Unapplied Phase 9.2 Database Migration:**
   - The SQL migration `main website/Backend/prisma/migrations/20261011104000_add_customer_activity_event/migration.sql` remains unapplied per the non-executing policy (`npx prisma migrate deploy` has not been run).
2. **Pending Prisma Client Generation:**
   - `npx prisma generate` has not been executed since `model CustomerActivityEvent` was added to `schema.prisma`. Until Prisma Client is regenerated and the migration is applied, `CustomerActivityService.getDelegate()` safely guards against a missing `prisma.customerActivityEvent` delegate at runtime.
3. **Taxonomy Recording Coverage:**
   - Out of the `CustomerActivityEventType` definitions in `customer_activity_taxonomy.ts`, the 35 active Phase 9.2 producer events are emitted by backend routes/services today; remaining taxonomy entries (`AUTH.OTP_VERIFIED`, `DEVICE.CONNECTED`, `DEVICE.DISCONNECTED`, `SERVER.ENDPOINT_ASSIGNED`, `SERVER.REMOTE_TUNNEL_CONNECTED`, `SERVER.REMOTE_TUNNEL_FAILED`, `BILLING.SUBSCRIPTION_UPGRADE_REQUESTED`, `BILLING.SUBSCRIPTION_CANCELLATION_UNDONE`, `BILLING.SUBSCRIPTION_CANCELLED`, `NOTIFICATION.SECURITY_ALERT_SENT`, `NOTIFICATION.INVOICE_EMAIL_SENT`, `NOTIFICATION.STORAGE_ALERT_SENT`) are valid filter values and will return matching rows only when emitted.
4. **No Runtime Execution Claimed:**
   - Per strict instructions, no test runners, builds, or database operations were executed during this phase.

---

## 8. Final Source-Level Implementation Status

**`IMPLEMENTED`**
