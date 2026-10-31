# ZDEXCLOUD — OPERATIONS RUNBOOK & INCIDENT RESPONSE
**Phase 9 Operational Guide for On-Call & DevOps Engineers**

---

## 1. System Architecture Quick Reference

- **Control Plane API**: Fastify on port 4000 (routes under `/api/v1/*`).
- **Gateway Transport**: WebSocket relay server attached to port 4000 (handles edge Android device tunnels).
- **Admin Control Plane**: `/admin` (SPA console utilizing `/api/v1/admin/*` APIs).
- **Database**: MySQL managed cluster accessed via Prisma ORM pool.

---

## 2. Standard Operational Procedures (SOPs)

### SOP-01: Admin Node Maintenance & Drain
1. Navigate to **Admin Panel &rarr; Gateway & Relays &rarr; Nodes**.
2. Select the target gateway node (e.g. `gw-node-a`).
3. Click **Drain Node** and provide an audit reason (minimum 5 characters).
4. The node transitions to `MAINTENANCE`. All active device connections on this node are terminated with graceful reconnect headers; devices will automatically reconnect to alternative active nodes.
5. Perform host/kernel maintenance.
6. Click **Restore Node** with an audit reason to return the node to `ACTIVE` state.

### SOP-02: User Account Emergency Quarantine / Suspension
1. Navigate to **Admin Panel &rarr; Customer Accounts**.
2. Select target customer and open Details drawer.
3. Click **Suspend Account** and provide compliance/abuse ticket reference.
4. **Impact**:
   - User status is immediately set to `SUSPENDED`.
   - All customer active sessions (`UserSession`) are deleted immediately.
   - All customer edge devices are blocked from authenticating tunnels.
   - An immutable, SHA-256 chained audit record is created in `AdminAuditLog`.

### SOP-03: Force Disconnecting a Compromised Device
1. Navigate to **Admin Panel &rarr; Devices & Nodes**.
2. Select target device and click **Disconnect Device**.
3. **Impact**:
   - Device status is marked `OFFLINE`.
   - The active WebSocket socket is evicted immediately.
   - Other devices and servers of the user remain completely undisturbed (strict tenant isolation).

---

## 3. Incident Triage Matrix

| Incident Symptom | Probable Root Cause | Immediate Triage Action |
| :--- | :--- | :--- |
| **HTTP 503 on `/health/ready`** | MySQL DB connection loss or pool exhaustion | 1. Check MySQL cluster health / CPU / IOPS.<br>2. Query `GET /api/v1/health/db` for categorized error (e.g. `P1001`, `AUTHENTICATION_FAILED`).<br>3. Verify DB credentials & network security group. |
| **Elevated 429 Rate Limits on Admin API** | Brute force or runaway dashboard polling | 1. Check `admin_lockouts` table.<br>2. Inspect client IP in error logs.<br>3. Check rate-limit window counters. |
| **Elevated Device Reconnects** | Gateway node network jitter or firewall timeout | 1. Inspect Gateway Telemetry (`/api/v1/admin/operations/gateway/telemetry`).<br>2. Verify NAT keepalive intervals.<br>3. Check heartbeat timeout reaper logs. |
| **403 Forbidden on Admin Operations** | Role assignment missing or expired session | 1. Inspect admin user role mappings in `admin_user_roles`.<br>2. Verify SuperAdmin flag or permission slugs (`users.suspend`, `devices.disconnect`, `servers.power`, `gateway.drain`). |

---

## 4. State Reconciliation & Drift Check

Run the built-in diagnostic audit service:
```typescript
import { StateReconciliationService } from './src/observability/state_reconciliation.js';

const report = await StateReconciliationService.auditState();
console.log(JSON.stringify(report, null, 2));
```
- Checks for orphaned database connection records where no live WebSocket socket exists.
- Reports silent online devices without heartbeat activity.
- Identifies any discrepancy between MySQL state and memory.
