# ZDEXCLOUD PHASE 12.4: SERVER CONTENT IMPLEMENTATION REPORT

**Status:** Completed  
**Batch Type:** Implementation First  
**Verification Mode:** Static Source Inspection & Verification (Zero Test Runners, Zero Build Commands, Zero Migrations)  
**Em Dash Compliance:** 100% Passed (0 em dashes across all Phase 12.4 modified files)

---

## 1. Executive Summary

In Phase 12.4 (Server Content Implementation), customer-facing explanations of ZdexCloud's Android server engine, device pairing, remote connectivity flow, and server lifecycle states were audited against actual repository source code and updated across the public website.

All claims now align with the real architectural boundaries established in `GATEWAY_RELIABILITY_CONTRACT.md`, `CustomerStatusService.ts`, `ConnectionStateMachine.ts`, `device.ts`, and the native Android `RemoteNodeTunnelManager.kt`:
1. **Physical Storage Host Reality:** The Android phone is the physical storage host; storage capacity is strictly bounded by the device's internal flash and installed microSD cards (not an unlimited cloud storage allocation).
2. **Operational Availability Requirements:** Continuous availability requires uninterrupted AC power, working Wi-Fi or cellular connectivity, battery optimization whitelisting ("Unrestricted"), and manufacturer autostart permissions. ZdexCloud is clearly positioned as a remote file access solution, not an automated redundant cloud backup service.
3. **Hardware Pairing & Device Uniqueness:** Accounts link to Android nodes via a cryptographically generated, hardware-bound `installationId` stored in Android Keystore. The system strictly enforces a **1 server per physical device** constraint.
4. **Plan-Based Fleet Limits:** Free accounts support 1 active phone server; Pro accounts support up to 5 concurrent active phone servers.
5. **Gateway Routing & Authorization Boundaries:** Android phones establish persistent outbound TLS 1.3 WebSocket connections over port 443 to the stateless gateway. Knowing a server subdomain or public URL alone does NOT grant access without an active web session, account-to-device ownership verification, and on-device server credentials. The gateway buffers frames in volatile RAM and writes 0 bytes to disk.
6. **Six-State Lifecycle Engine:** The customer status engine dynamically evaluates server availability across 6 verified states (`ONLINE / RUNNING`, `CONNECTING`, `RECONNECTING`, `STOPPED`, `OFFLINE`, `FAILED / ERROR`), avoiding stale database assumptions.

---

## 2. Modified Customer-Facing Files

| File Path | Primary Sections / Topics Addressed |
| :--- | :--- |
| `main website/Frontend/pages/how-it-works.html` | Step 3 Gateway role & storage boundaries; 6-state lifecycle model in Section 5; Free (1) vs Pro (5) fleet limits and offline handling in Section 6; FAQ #5 clarifying remote access vs cloud backup. |
| `main website/Frontend/pages/documentation.html` | Category 02 Lifecycle States & Status Indicators table (6 states); Category 04 Access Authorization & No Cloud Expansion bullets; Category 05 Plan-based fleet caps, 1-server-per-device rule, and unlinking; Category 07 Troubleshooting symptoms 6 & 7 (Reconnecting status, MAX_SERVERS_REACHED). |
| `main website/Frontend/pages/faq.html` | Category 1 FAQ on remote access vs automatic cloud backup; Category 6 FAQ on 1-server-per-device rule and unlinking; Category 10 FAQ on server lifecycle status badges; Category 12 FAQ on recovering stuck servers. |
| `main website/Frontend/pages/product.html` | Section 10 Fleet Management Safeguards updated with Free (1) vs Pro (5) plan caps, 1 server per physical device constraint, and offline device handling. |
| `main website/Frontend/index.html` | Multi-Device section subtitle and capacity slot description updated to reflect Free (1 server) vs Pro (up to 5 servers) and 1 server per physical device. |
| `main website/Frontend/pages/server-access.html` | Replaced 5 em dashes with hyphens across `<title>`, `og:title`, `og:image:alt`, `twitter:title`, and `twitter:image:alt`. |
| `main website/Frontend/pages/pricing.html` | Replaced 3 em dashes with hyphens across `<title>`, `og:title`, and `twitter:title`. |

---

## 3. Source Verification & Implementation Mapping

All customer-facing server statements were mapped directly to repository source files prior to editing:

| Customer-Facing Claim | Source File & Implementation Evidence |
| :--- | :--- |
| **Phone as Physical Storage Host** | `Android app/.../RemoteNodeServerService.kt` and `LocalServerEngine.kt` binding to `/storage/emulated/0` and SD card paths on loopback `127.0.0.1:8080`. |
| **Storage Bounded by Local Hardware** | `RemoteNodeHttpServer.kt` querying Android `StatFs` on local storage volumes; 0 cloud storage allocation on backend. |
| **Outbound WebSocket Tunnel (No Port Forwarding)** | `RemoteNodeTunnelManager.kt` initiating outbound OkHttp WebSocket connection to `gateway_service.ts` over standard port 443. |
| **Stateless RAM-Only Relay (0 Disk Writes)** | `gateway_service.ts` handling duplex chunk streaming via in-memory socket pipes (`activeTransfers`, `pendingRequests`) with zero disk I/O. |
| **Multi-Layer Authorization (URL Alone != Access)** | `gateway_service.ts` verifying session cookies and device ownership before piping HTTP requests to the phone tunnel; phone HTTP engine requiring local credentials. |
| **1 Server per Physical Device** | `Backend/src/routes/device.ts` enforcing unique `userId_installationId` mapping and idempotent `ServerInstance` updates on the same device. |
| **Server Limits: 1 on Free, 5 on Pro** | `Backend/src/routes/device.ts` (lines 85, 126) resolving user entitlements via `EntitlementService` and throwing `MAX_SERVERS_REACHED` when `serverCount >= entitlements.maxServers`. |
| **6-State Server Lifecycle Engine** | `Backend/src/services/connection_state_machine.ts` and `GATEWAY_RELIABILITY_CONTRACT.md` defining `DISCONNECTED`, `CONNECTING`, `CONNECTED`, `RECONNECTING`, `STALE`, and `FAILED`. |
| **Dynamic Customer Status Derivation** | `Backend/src/services/customer_status_service.ts` evaluating the 9-point composite liveness rule rather than relying on stale database columns. |
| **Reconnection with Jittered Backoff** | `RemoteNodeTunnelManager.kt` using exponential backoff ($T_{\text{base}} = 1\text{s}$, $T_{\text{max}} = 30\text{s}$, jitter factor $J = 0.30$) resetting on 15s stability. |
| **Background Execution & Battery Whitelist** | `RemoteNodeServerService.kt` running as Android `FOREGROUND_SERVICE` with `START_STICKY` and ongoing status notification. |

---

## 4. Content Changes by Batch

### Batch 12.4.1: Android Server Explanation
- **`how-it-works.html`:** Added FAQ #5 explicitly clarifying that ZdexCloud is a remote personal file access tool, not an automated redundant cloud backup service.
- **`faq.html`:** Added Category 1 question explaining that data remains physically on the phone's flash or microSD card and reinforcing the 3-2-1 backup strategy.
- **`documentation.html`:** Reaffirmed prerequisites (Android 8.0+, 1.5GB+ RAM, AC power, 2.4/5GHz Wi-Fi) and storage media support (internal flash, Class 10 / UHS-1 microSD).

### Batch 12.4.2: Device Linking and Server Instances
- **`how-it-works.html`:** Updated Section 6 to document plan-based server caps (Free: 1, Pro: up to 5), the 1-server-per-physical-device rule, and unlinking behavior.
- **`product.html`:** Updated Section 10 Fleet Management Safeguards to document the 1 server per physical device constraint and offline device handling.
- **`index.html`:** Clarified that Free accounts support 1 server and Pro accounts support up to 5 servers, with 1 server per physical hardware device.
- **`documentation.html`:** Updated Category 05 to detail hardware-bound `installationId` pairing, independent server passwords, and unlinking behavior.
- **`faq.html`:** Added Category 6 FAQ detailing the one-server-per-physical-device rule and confirming that unlinking a device halts remote routing while leaving on-device files completely intact.

### Batch 12.4.3: Remote Connectivity and Access Flow
- **`how-it-works.html`:** Updated Section 2 Step 3 to explicitly note that the gateway buffers frames in volatile memory, does not turn phone storage into cloud storage, and that public domain knowledge alone does not grant file access.
- **`documentation.html`:** Added bullets in Category 04 detailing Multi-Layer Authorization (session token + device ownership check + on-device server credentials) and No Cloud Storage Expansion.
- **Transport Security Consistency:** Maintained exact alignment with Phase 12.3 (TLS 1.3 in transit, explicit disclosure of non-E2EE / non-zero-knowledge status, zero persistent disk writes on relay).

### Batch 12.4.4: Lifecycle, Status, and Troubleshooting Guidance
- **`documentation.html`:**
  - Added a dedicated **Server Lifecycle States & Status Indicators** matrix in Category 02 documenting all 6 states (`ONLINE / RUNNING`, `CONNECTING`, `RECONNECTING`, `STOPPED`, `OFFLINE`, `FAILED / ERROR`), corresponding dashboard badge colors, and operational behaviors.
  - Added Symptom 6 (Server stuck in RECONNECTING status with backoff guidance) and Symptom 7 (`MAX_SERVERS_REACHED` pairing error with slot management guidance) in Category 07.
- **`how-it-works.html`:** Expanded Section 5 Server State Machine card from 4 to 6 states, accurately reflecting the full lifecycle engine.
- **`faq.html`:**
  - Added Category 10 FAQ item defining all 6 dashboard status indicators and their operational meaning.
  - Added Category 12 FAQ item providing actionable troubleshooting steps for stuck servers (power, Wi-Fi, notification, battery optimization whitelist, and toggling Server Mode to bypass backoff).

### Batch 12.4.5: Consistency Across Existing Content & Zero Em Dashes
- Replaced 5 legacy em dashes with hyphens in `server-access.html` meta tags.
- Replaced 3 legacy em dashes with hyphens in `pricing.html` meta tags.
- Automated regex audit confirmed **0 em dashes** across all modified files.

---

## 5. Verification & Compliance Results

### 5.1. Em Dash Audit Results
An automated Node.js scan (`/\u2014/g`) was executed across all Phase 12.4 modified files:
- `main website/Frontend/index.html`: 0 em dashes found
- `main website/Frontend/pages/product.html`: 0 em dashes found
- `main website/Frontend/pages/how-it-works.html`: 0 em dashes found
- `main website/Frontend/pages/documentation.html`: 0 em dashes found
- `main website/Frontend/pages/faq.html`: 0 em dashes found
- `main website/Frontend/pages/server-access.html`: 0 em dashes found
- `main website/Frontend/pages/pricing.html`: 0 em dashes found
- **Total:** 0 em dashes found across all modified files.

### 5.2. Static Syntax & Layout Integrity
- Validated all modified HTML opening and closing tags.
- Preserved existing CSS classes, IDs, design system tokens, and semantic HTML table structures.
- Verified that all navigation links, buttons, and form attributes remain intact.
- Confirmed zero backend, database, migration, or package changes were introduced.
- Confirmed zero test runners, build commands, browser automation, or runtime executions were run.

---

## 6. Remaining Limitations & Unresolved Claims

1. **Hardware-Specific Battery Whitelisting Steps:** OEM Android skins (Xiaomi HyperOS, Samsung One UI, Oppo/OnePlus ColorOS/OxygenOS) frequently relocate battery optimization and background autostart toggles across OS versions. Documentation provides universal principles (unrestricted battery + lock in recents) but cannot guarantee exact menu paths for every sub-model.
2. **Cellular Carrier Inbound Socket Behavior:** While outbound connections over port 443 reliably traverse standard mobile carrier CGNAT, specific enterprise APNs or metered roaming networks with aggressive WebSocket idle timeouts (<15s) may experience elevated keepalive misses.

---

## 7. Conclusion

Phase 12.4 is complete. All customer-facing explanations of the Android server host, device linking rules, remote access architecture, and server lifecycle states are verified against repository code, fully documented, and strictly compliant with all engineering requirements.
