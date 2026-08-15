# RemoteNode — Personal Android File Server Platform

A personal, self-hosted file server platform that converts unused Android smartphones into remotely accessible storage nodes without router port forwarding, public IPs, or third-party cloud data hosting.

---

## 1. System Architecture

The platform architecture is structured into three logical planes:

1. **Control Plane (Main Website & Backend API)**:
   - Manages user registration, Email + Password + 6-Digit Email OTP authentication, account dashboards, device registration, and remote connection intent tokens (`DeviceConnection`).
   - Does NOT store, proxy, or access user files.

2. **Transport Plane (Remote Gateway Nodes)**:
   - Standalone, vendor-neutral Node.js WebSocket/WSS relay infrastructure accepting persistent outbound connections initiated by Android storage nodes.
   - Routes structured `FILE_REQUEST` and `FILE_RESPONSE` messages between remote browsers and active Android sockets correlated by `connectionId` and `requestId`.
   - Includes automatic request timeout cleanup and payload validation guards.
   - Does NOT store user files, run filesystem business logic, or maintain cloud file copies.

3. **Data Plane (Android Device & Local Engine)**:
   - The actual Android phone host running native embedded `LocalServerEngine` bound strictly to loopback `127.0.0.1:8080`.
   - Stores user files physically inside an isolated application sandbox (`RemoteNodeFiles/`).
   - Processes local & remote file operations (`LIST`, `CREATE_FOLDER`, `RENAME`, `DELETE`, `DOWNLOAD`, `UPLOAD`, `HEALTH`).

---

## 2. Remote Data Plane Protocol

- **Transport**: Outbound WebSocket over Gateway port `4001`.
- **Request/Response Protocol**:
  - `FILE_REQUEST`: `{ "type": "FILE_REQUEST", "requestId": "...", "connectionId": "...", "operation": "LIST"|"CREATE_FOLDER"|"RENAME"|"DELETE"|"DOWNLOAD"|"UPLOAD"|"HEALTH", ... }`
  - `FILE_RESPONSE`: `{ "type": "FILE_RESPONSE", "requestId": "...", "success": true, "data": ... }`
  - `FILE_STREAM_START`, `FILE_STREAM_CHUNK`, `FILE_STREAM_END`, `FILE_ERROR`.

---

## 3. Authentication & Credential Separation

- **Platform Account**: Email + Password + 6-Digit Email OTP (Serverbyt SMTP).
- **File Server Credentials**: Configured during Android app setup, used exclusively for file manager access.
- **Strict Separation**: Platform passwords/OTPs are never sent to local file servers or transport gateways.

---

## 4. Phase 1 Boundaries & Exclusions

- **Google Authentication**: NOT USED.
- **Brevo Email Service**: NOT USED.
- **Production Infrastructure (Phase 2)**: STUN/TURN, QUIC, Cloudflare Tunnels, production gateway deployment, and live DNS automation belong strictly to Phase 2 and are NOT included in Phase 1.
