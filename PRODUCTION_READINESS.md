# ZDEXCLOUD — PRODUCTION READINESS & DEPLOYMENT SAFETY BASELINE
**Phase 9 Operational Specification**

---

## 1. Executive Overview
This document establishes the production deployment, operational health, and infrastructure readiness standards for the ZdexCloud Control Plane and Gateway Relay backend.

---

## 2. Environment Configuration & Invariant Matrix

| Configuration Variable | Classification | Production Invariant | Default / Safe Setting |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | Required / Critical | Must be `production` in live deployments. Test and development fixtures are disabled. | `production` |
| `DATABASE_URL` | Required / Secret | Must connect to managed MySQL cluster with SSL/TLS. Cannot point to localhost in production. | `mysql://...` |
| `PORT` / `HOST` | Required / Network | Default listener port and interface. | `4000` / `0.0.0.0` |
| `CORS_ORIGIN` | Required / Security | Strict explicit origins list. Wildcard `*` is strictly forbidden in production. | Explicit domains |
| `LOG_LEVEL` | Operational | Recommended `info` or `warn` in production. | `info` |
| `REMOTENODE_BASE_DOMAIN` | Domain Routing | Primary marketing and customer routing base domain. | `zdexcloud.com` |
| `REMOTENODE_GATEWAY_DOMAIN`| Gateway Cluster | Authoritative WebSocket relay gateway domain. | `gateway.zdexcloud.com` |
| `BREVO_API_KEY` | External Provider | API Key for transactional emails (Port 443 HTTPS). | [SECRET] |
| `SMTP_HOST` / `PORT` / `USER` | External Provider | Fallback SMTP configuration. | `smtp-relay.brevo.com` |
| `FCM_PROJECT_ID` / `PRIVATE_KEY`| Push Gateway | Service account credentials for Firebase Cloud Messaging. | [SECRET] |

---

## 3. Health, Liveness & Readiness Architecture

ZdexCloud implements standard multi-tier health endpoints compliant with cloud orchestrators (Render, Kubernetes, AWS ECS, Docker Swarm):

```text
               ┌───────────────────────┐
               │    Inbound Traffic    │
               └───────────┬───────────┘
                           │
       ┌───────────────────┴───────────────────┐
       ▼                                       ▼
┌──────────────┐                       ┌──────────────┐
│   Liveness   │                       │  Readiness   │
│ GET /health/live                     │ GET /health/ready
│ (Process Up) │                       │ (DB + Nodes) │
└──────────────┘                       └──────────────┘
```

- **Liveness Probe** (`GET /health`, `GET /health/live`, `GET /api/v1/health`, `GET /api/v1/health/live`):
  - Returns `200 OK` if the Node.js process is executing and event loop is responsive.
  - Does NOT fail if an external downstream service is temporarily degraded.
- **Readiness Probe** (`GET /health/ready`, `GET /api/v1/health/ready`, `GET /ready`):
  - Returns `200 OK` only when MySQL database pool responds to `SELECT 1`.
  - Returns `503 Service Unavailable` if database connectivity is lost, preventing load balancers from routing traffic to an unready instance.
- **Diagnostic Database Probe** (`GET /api/v1/health/db`):
  - Provides categorized database connectivity state with sanitized summaries.

---

## 4. Graceful Shutdown Protocol

The backend process traps `SIGINT` and `SIGTERM` signals and initiates a deterministic 4-stage teardown:
1. **Notification Workers**: Delivery and retention background workers finish in-flight batches and stop polling.
2. **Gateway Relay Server**: WebSocket connections are sent graceful disconnect frames (`DISCONNECT`), active streams cancelled, and server closed.
3. **Fastify HTTP Server**: Ceases accepting new connections; drains active HTTP requests.
4. **Prisma Database Pool**: Closes all pooled MySQL connections safely.
5. **Bounded Timeout Protection**: A 15-second unref timer guarantees the process will never hang indefinitely during shutdown.

---

## 5. Deployment Checklist
- [ ] Run `prisma migrate deploy` against target database.
- [ ] Verify `validateEnvironment()` produces 0 errors during startup.
- [ ] Verify SSL/TLS certificates for `zdexcloud.com` and `*.zdexcloud.com`.
- [ ] Confirm `GET /health/ready` returns 200 prior to switching traffic.
- [ ] Verify Admin SuperAdmin account is initialized with multi-factor authentication (2FA).
