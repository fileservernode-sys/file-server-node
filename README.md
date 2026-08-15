# RemoteNode — Personal Android File Server Platform

A personal, self-hosted file server platform that converts unused Android smartphones into remotely accessible storage nodes without router port forwarding, public IPs, or third-party cloud data hosting.

---

## 1. System Architecture

The platform architecture is structured into three logical planes:

1. **Control Plane (Main Website & Backend API)**:
   - Manages user registration, Email + Password + 6-Digit Email OTP authentication, account dashboards, device registration, and remote connection intent tokens (`DeviceConnection`).
   - Does NOT store, proxy, or access user files.

2. **Transport Plane (Remote Gateway Nodes & Connectivity Abstraction)**:
   - Standalone, vendor-neutral Node.js WebSocket/WSS relay infrastructure accepting persistent outbound connections initiated by Android storage nodes.
   - Extensible `ConnectivityTransport` abstraction (`RELAY`, `DIRECT`, `FUTURE_P2P`) with reliable WSS relay as the default.
   - Routes structured `FILE_REQUEST` and `FILE_RESPONSE` messages between remote browsers and active Android sockets correlated by `connectionId`, `authorizedUserId`, and `requestId`.
   - Multi-user / multi-device routing isolation, cross-user routing prevention, duplicate session replacement, and idempotent request caching.
   - Includes automatic request timeout cleanup, streaming cancellation handling, sliding-window rate limiting, and security headers.
   - Does NOT store user files, run filesystem business logic, or maintain cloud file copies.

3. **Data Plane (Android Device & Local Engine)**:
   - The actual Android phone host running native embedded `LocalServerEngine` bound strictly to loopback `127.0.0.1:8080`.
   - Stores user files physically inside an isolated application sandbox (`RemoteNodeFiles/`).
   - Processes local & remote file operations (`LIST`, `CREATE_FOLDER`, `RENAME`, `DELETE`, `DOWNLOAD`, `UPLOAD`, `STORAGE`, `RECENT`, `HEALTH`).
   - Handles network state transitions (Wi-Fi/mobile network changes, gateway reconnects) without interrupting the local loopback engine.

---

## 2. Remote Data Plane & Streaming Protocol

- **Transport**: Outbound WebSocket over Gateway port `4001` (WSS in production).
- **Request/Response Protocol**:
  - `FILE_REQUEST`: `{ "type": "FILE_REQUEST", "requestId": "...", "connectionId": "...", "authorizedUserId": "...", "operation": "LIST"|"CREATE_FOLDER"|"RENAME"|"DELETE"|"DOWNLOAD"|"UPLOAD"|"STORAGE"|"RECENT"|"HEALTH", ... }`
  - `FILE_RESPONSE`: `{ "type": "FILE_RESPONSE", "requestId": "...", "success": true, "data": ... }`
  - `FILE_STREAM_START`, `FILE_STREAM_CHUNK`, `FILE_STREAM_END`, `FILE_STREAM_CANCEL`, `FILE_ERROR`.

---

## 3. NAT & Carrier-Grade NAT (CGNAT) Resilience

- **Outbound-Only Connection**: The Android phone initiates and maintains persistent outbound WebSocket connections toward the RemoteNode Gateway.
- **Zero Inbound Port Requirements**: No router configuration, no UPnP, no public IP, and no firewall hole-punching are required on the Android phone.
- **Network Change Detection**: Automatic reconnection with bounded exponential backoff on Wi-Fi/cellular transitions or gateway restarts.

---

## 4. Authentication & Credential Separation

- **Platform Account**: Email + Password + 6-Digit Email OTP (Serverbyt SMTP).
- **File Server Credentials**: Configured during Android app setup, used exclusively for file manager access.
- **Strict Separation**: Platform passwords/OTPs are never sent to local file servers or transport gateways.

---

## 5. Security & Exclusions

- **Google Authentication**: NOT USED.
- **Brevo Email Service**: NOT USED.
- **Direct P2P / STUN / TURN / WebRTC**: Conceptually abstracted via `ConnectivityTransport` for future extensibility, but not mandatory for the production relay path.
