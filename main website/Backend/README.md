# Control Plane Backend API — Remote Android Personal File Server Platform

Production-ready, portable Control Plane Backend service built using **Node.js, TypeScript, Fastify, Prisma ORM, and MySQL**.

---

## 1. Architecture Overview: Control Plane vs. Data Plane

### Control Plane (This Service)
The backend API acts strictly as the **Control Plane** for platform coordination. It owns:
- Platform accounts & email verification metadata
- Device registration & ownership mapping
- Server instance status tracking (`ONLINE`, `OFFLINE`, `CONNECTING`, `RECONNECTING`)
- Gateway outbound tunnel registration metadata
- Assigned server subdomain endpoints

### Data Plane (Android Smartphone Storage)
The backend API **does NOT host, proxy, or store user files**. All files remain physically stored on the user's Android phone storage. The Android device runs its own lightweight file server component.

---

## 2. Technology Stack & Rationale

| Technology | Purpose & Selection Rationale |
| :--- | :--- |
| **Node.js** | Highly efficient asynchronous I/O event loop suitable for handling non-blocking API routing and device heartbeats. |
| **TypeScript** | Strict compile-time type safety, preventing runtime property dereferencing errors and enforcing schema boundaries. |
| **Fastify** | High-performance, low-overhead HTTP web framework with built-in schema validation, structured Pino logging, and fast routing. |
| **Prisma ORM** | Type-safe database access layer with auto-generated client, robust migration system, and query parameterization preventing SQL injection. |
| **MySQL** | Reliable relational database supported natively by Serverbyt remote hosting, Render, and Hetzner VPS instances. |

---

## 3. Directory Structure

```
main website/Backend/
├── prisma/
│   └── schema.prisma            # Prisma schema (User, Device, ServerInstance, ServerEndpoint, DeviceConnection, AuditEvent)
├── src/
│   ├── config/
│   │   ├── env.ts               # Zod environment variable validation
│   │   └── database.ts          # Singleton Prisma Client & connection lifecycle
│   ├── errors/
│   │   └── app-error.ts         # Custom error hierarchy (AppError, NotFoundError, ValidationError)
│   ├── middleware/
│   │   ├── error-handler.ts     # Global Fastify error handler (masks internal stack traces in production)
│   │   └── security.ts          # Helmet security headers, CORS, rate limiting
│   ├── routes/
│   │   ├── index.ts             # API v1 router prefix (/api/v1)
│   │   ├── health.ts            # GET /api/v1/health (Process liveness probe)
│   │   └── ready.ts             # GET /api/v1/ready (Database connection readiness probe)
│   ├── schemas/
│   │   └── response.ts          # Standardized response wrappers ({ success, data/error })
│   ├── utils/
│   │   └── logger.ts            # Fastify Pino logger setup
│   ├── app.ts                   # Fastify app factory (for testing and execution)
│   └── server.ts                # Server entry point with graceful shutdown (SIGINT/SIGTERM)
├── tests/
│   └── health.test.ts           # Foundational unit tests for health & readiness probes
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
└── README.md
```

---

## 4. Environment Configuration (`.env.example`)

| Variable | Default / Description |
| :--- | :--- |
| `NODE_ENV` | `development` / `production` / `test` |
| `PORT` | `4000` (Binds to process `PORT` on Render / Hetzner) |
| `HOST` | `0.0.0.0` |
| `DATABASE_URL` | MySQL Connection String (`mysql://USER:PASS@HOST:3306/DB_NAME`) |
| `CORS_ORIGIN` | Configurable allowed origins (comma separated) |
| `LOG_LEVEL` | `info` / `debug` |

---

## 5. API Response Conventions & Error Formatting

### Success Payload
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "timestamp": "2026-08-15T20:58:00.000Z"
  }
}
```

### Standardized Error Payload
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request payload parameters"
  }
}
```

---

## 6. Endpoints Implemented

- **`GET /api/v1/health`**: Process Liveness Probe (returns 200 OK without exposing secrets or paths).
- **`GET /api/v1/ready`**: Service Readiness Probe (queries `SELECT 1` on MySQL via Prisma; returns 200 OK when ready or 503 Service Unavailable when DB is down).

---

## 7. Conceptual Future API Contract (`POST /api/v1/server-discovery`)

In Phase 2, the frontend `findDevicesByEmail(email)` service will connect to this endpoint:

**Request**:
```json
POST /api/v1/server-discovery
Content-Type: application/json

{
  "email": "user@example.com"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "devices": [
      {
        "id": "cuid...",
        "deviceName": "Pixel 6a",
        "status": "ONLINE",
        "lastSeenAt": "2026-08-15T20:55:00.000Z",
        "endpoint": "https://pixel6a.remotenode.net"
      }
    ]
  }
}
```

---

## 8. Deployment Portability & Hosting Guidelines

### Serverbyt Remote MySQL
Specify the remote MySQL credentials in `DATABASE_URL` inside your production `.env` environment configuration. The Prisma client query engine supports remote MySQL connections out of the box.

### Render Deployment
- Build Command: `npm run build`
- Start Command: `npm start`
- Port Binding: Binds dynamically to `process.env.PORT` on host `0.0.0.0`.

### Hetzner VPS Portability
The backend service relies strictly on standard Node.js without vendor-specific proprietary APIs. It can be containerized via Docker or managed via PM2/Systemd on any Hetzner Linux VPS.

---

## 9. Deferral & Scope Limits Notice

The following features are deliberately deferred to subsequent dedicated implementation batches:
- Real user registration & login password verification logic.
- Email verification link generation & SMTP sending.
- Android application device registration & heartbeat APIs.
- WebSocket gateway tunneling & NAT traversal servers.
- Automatic DNS subdomain allocation APIs.
