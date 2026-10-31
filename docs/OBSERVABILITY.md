# ZDEXCLOUD — OBSERVABILITY & METRICS SPECIFICATION
**Phase 9 Operational Telemetry & Alerting Standards**

---

## 1. Observability Pillars

```text
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  STRUCTURED  │     │ OPERATIONAL  │     │   HEALTH &   │     │  IMMUTABLE   │
│     LOGS     │     │   METRICS    │     │  READINESS   │     │    AUDIT     │
├──────────────┤     ├──────────────┤     ├──────────────┤     ├──────────────┤
│ JSON events  │     │ Latency,     │     │ /health      │     │ SHA-256      │
│ with request │     │ counters,    │     │ /health/live │     │ cryptographic│
│ correlation  │     │ distributions│     │ /health/ready│     │ chained trail│
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
```

---

## 2. Standard Structured Log Format

All backend operational components emit structured JSON events:

```json
{
  "timestamp": "2026-09-29T18:40:00.000Z",
  "level": "info",
  "service": "zdex-control-plane",
  "environment": "production",
  "requestId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "operation": "ADMIN_USER_SUSPEND",
  "resourceType": "USER",
  "resourceId": "cuid_user_123",
  "adminId": "uuid_admin_456",
  "durationMs": 42,
  "statusCode": 200,
  "metadata": {
    "reason": "Terms violation - abusive requests",
    "sessionsRevoked": 2
  }
}
```

### Redaction Invariants
The following keys are strictly redacted at logger entrypoints:
- `password`, `passwordHash`, `adminPasswordHash`
- `token`, `sessionToken`, `sessionTokenHash`, `connectionToken`
- `otp`, `otpHash`
- `authorization`, `cookie`, `apiKey`, `secret`
- `dataBase64`, `fileContent`, `payload`, `body`

---

## 3. Operational Metrics Matrix & Alert-Ready Thresholds

| Metric Identifier | Collector Component | Warning Threshold | Critical Alert Threshold |
| :--- | :--- | :--- | :--- |
| `http.requests.5xx_rate` | Fastify Response Hook | > 1.0% of total traffic | > 5.0% of total traffic |
| `http.latency.average_ms` | Fastify Response Hook | > 250 ms | > 1000 ms |
| `auth.admin.login_failures`| Admin Auth Service | > 5 failures / min | > 15 failures / min (Possible Brute Force) |
| `db.query_failures` | Prisma Pool / Health | > 0 in 1 min | > 5 in 1 min |
| `gateway.timed_out_requests`| Gateway Service | > 5 in 5 min | > 25 in 5 min |
| `gateway.relay_errors` | Gateway Service | > 10 in 5 min | > 50 in 5 min |
| `gateway.node.draining` | Gateway Node Cluster | Node in `MAINTENANCE` > 2h | Node down unannounced |
| `devices.reconnect_spikes` | Gateway WebSocket | > 50 reconnects / min | > 200 reconnects / min |

---

## 4. Admin Telemetry & Diagnostic Dashboards

- **Live Overview Dashboard**: Integrated into `/admin#dashboard` (real-time customer account, device node, server power, and gateway tunnel distributions).
- **Gateway Telemetry API**: `GET /api/v1/admin/operations/gateway/telemetry` provides live metrics for gateway nodes, active connections, reconnect counts, and socket distributions.
- **Diagnostics API**: `GET /api/v1/admin/operations/gateway/diagnostics` returns hardware node health, gateway memory consumption, and uptime.
