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

- **Transport**: Outbound WebSocket over Gateway port `4001` (WSS in staging & production).
- **Request/Response Protocol**:
  - `FILE_REQUEST`: `{ "type": "FILE_REQUEST", "requestId": "...", "connectionId": "...", "authorizedUserId": "...", "operation": "LIST"|"CREATE_FOLDER"|"RENAME"|"DELETE"|"DOWNLOAD"|"UPLOAD"|"STORAGE"|"RECENT"|"HEALTH", ... }`
  - `FILE_RESPONSE`: `{ "type": "FILE_RESPONSE", "requestId": "...", "success": true, "data": ... }`
  - `FILE_STREAM_START`, `FILE_STREAM_CHUNK`, `FILE_STREAM_END`, `FILE_STREAM_CANCEL`, `FILE_ERROR`.

---

## 3. Staging Deployment & DNS Architecture (`viewduration.com`)

> [!NOTE]
> `viewduration.com` is used strictly as an exclusive, temporary development and staging domain for live testing. Production deployment replaces `REMOTENODE_BASE_DOMAIN` without requiring source code modifications.

### Required DNS Record Layout for Staging:
| Host / Name | Type | Target / Value | Purpose |
|-------------|------|----------------|---------|
| `viewduration.com` | `A` or `CNAME` | `<Frontend Server IP / Ingress>` | Main Informational & Auth Website |
| `api.viewduration.com` | `A` or `CNAME` | `<Backend Server IP / Ingress>` | Control Plane REST APIs |
| `gateway.viewduration.com` | `A` or `CNAME` | `<Gateway Server IP / Ingress>` | WSS Gateway Ingress |
| `*.viewduration.com` | `CNAME` | `gateway.viewduration.com` | Dynamic Server Subdomain Routing |

---

## 4. NAT & Carrier-Grade NAT (CGNAT) Resilience

- **Outbound-Only Connection**: The Android phone initiates and maintains persistent outbound WebSocket connections toward the RemoteNode Gateway.
- **Zero Inbound Port Requirements**: No router configuration, no UPnP, no public IP, and no firewall hole-punching are required on the Android phone.
- **Network Change Detection**: Automatic reconnection with bounded exponential backoff on Wi-Fi/cellular transitions or gateway restarts.

---

## 5. Authentication & Credential Separation

- **Platform Account**: Email + Password + 6-Digit Email OTP (Serverbyt SMTP).
- **File Server Credentials**: Configured during Android app setup, used exclusively for file manager access.
- **Strict Separation**: Platform passwords/OTPs are never sent to local file servers or transport gateways.

---

## 6. Manual End-to-End Verification Checklist

To verify full end-to-end functionality on the live staging deployment:

- [ ] **A.** Open `https://viewduration.com`.
- [ ] **B.** Register a new account.
- [ ] **C.** Verify 6-digit Email OTP delivered via Serverbyt SMTP.
- [ ] **D.** Log in to Main Website Dashboard.
- [ ] **E.** Log in to Android application with platform credentials.
- [ ] **F.** Start local embedded file server engine (`127.0.0.1:8080`).
- [ ] **G.** Connect Android app outbound to `wss://gateway.viewduration.com`.
- [ ] **H.** Verify Gateway logs show authenticated Android connection session.
- [ ] **I.** Open dynamic server endpoint: `https://<server-id>.viewduration.com`.
- [ ] **J.** Verify Home dashboard loads.
- [ ] **K.** Verify real disk storage capacity and categorized usage meters.
- [ ] **L.** Navigate to My Files view.
- [ ] **M.** Create a new folder (`POST /api/folders`).
- [ ] **N.** Upload a file (`POST /api/upload`).
- [ ] **O.** Download the file (`GET /api/download`).
- [ ] **P.** Rename the file (`POST /api/rename`).
- [ ] **Q.** Delete the file (`DELETE /api/files`).
- [ ] **R.** Navigate to Photos view.
- [ ] **S.** Verify thumbnail grid and open full-screen lightbox preview.
- [ ] **T.** Navigate to Videos view.
- [ ] **U.** Upload a test video file.
- [ ] **V.** Play supported video directly inside browser modal player.
- [ ] **W.** Test large file chunked streaming transfer (`FILE_STREAM_START` / `CHUNK` / `END`).
- [ ] **X.** Disconnect Android device Wi-Fi/cellular network.
- [ ] **Y.** Verify File Manager displays `RECONNECTING...` banner.
- [ ] **Z.** Restore Android network connection.
- [ ] **AA.** Verify File Manager returns to `CONNECTED` status.
- [ ] **AB.** Attempt unauthorized cross-user request; verify `UNAUTHORIZED_CROSS_USER_ACCESS`.
- [ ] **AC.** Access non-existent server endpoint; verify `404 SERVER_NOT_FOUND`.
- [ ] **AD.** Test with expired or revoked connection token; verify rejection.
- [ ] **AE.** Rapidly trigger requests to verify sliding-window rate limit protection.
- [ ] **AF.** Stop Android server; verify `503 SERVER_OFFLINE` response.

---

## 7. Production Domain Migration Procedure

When moving from the testing domain (`viewduration.com`) to the permanent production domain:
1. Update `.env` with `REMOTENODE_BASE_DOMAIN=<production-domain>`.
2. Provision DNS records for `<production-domain>`, `api.<production-domain>`, `gateway.<production-domain>`, and `*.<production-domain>`.
3. Provision TLS wildcard certificates for `*.<production-domain>`.
4. Compile Android release APK using `AppConfig.production(baseDomain: '<production-domain>')`.
5. No application source code changes are required.

---

## 8. Exclusions & Scope Guardrails

- **Google Authentication**: NOT USED.
- **Brevo Email Service**: NOT USED.
- **Cloud File Storage**: User files are hosted physically on the Android device (`RemoteNodeFiles/`) and never permanently cached on the Gateway or cloud.
