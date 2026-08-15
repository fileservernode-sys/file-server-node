# Remote Android Personal File Server Platform

A personal, self-hosted file server platform that converts unused Android smartphones into remotely accessible storage nodes without router port forwarding, public IPs, or third-party cloud data hosting.

---

## 1. System Architecture

The platform architecture is structured into three logical planes:

1. **Control Plane (Main Website & Backend API)**:
   - Manages user registration, Email + Password + 6-Digit Email OTP authentication, account dashboards, device registration, and remote connection intent tokens (`DeviceConnection`).
   - Does NOT store or proxy user files.

2. **Transport Plane (Remote Gateway Nodes)**:
   - Outbound WebSocket/WSS relay infrastructure accepting persistent outbound connections initiated by Android storage nodes.
   - Authenticates connection attempts using single-use/revocable `connectionToken` tokens.
   - Conducts transport PING/PONG heartbeats and tracks active node state (`DISCONNECTED`, `CONNECTING`, `CONNECTED`, `RECONNECTING`, `FAILED`).

3. **Data Plane (Android Device & Local Engine)**:
   - The actual Android phone host running native embedded `LocalServerEngine` bound strictly to loopback `127.0.0.1:8080`.
   - Stores user files physically on Android storage media.

> **Scope Note for Batch 6H**:
> Batch 6H implements the secure remote transport foundation only. It does not implement production NAT traversal, public DNS provisioning, production gateway deployment, or the complete remote file-management system.

---

## 2. Authentication Model

- **Platform Account Authentication**: Email + Password + 6-Digit Email OTP ONLY.
- **File Server Authentication**: Dedicated file-server credentials configured during Android app setup.
- **Strict Separation**: Platform session tokens and credentials are never sent to local file servers; file-server passwords are never sent to the central control plane or transport gateway.

---

## 3. Technology Stack

- **Main Website Frontend**: Vanilla HTML5, Vanilla CSS3 (Variables + Design Token System), Modern Vanilla JS.
- **Main Website Backend**: Fastify (TypeScript), Prisma ORM, MySQL.
- **Gateway Node**: Standalone Node.js WebSocket (`ws`) Development Gateway.
- **Android Application**: Flutter (Dart), MethodChannels, Native Kotlin `LocalServerEngine`.
