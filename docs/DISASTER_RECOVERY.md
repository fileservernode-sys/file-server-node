# ZDEXCLOUD — DISASTER RECOVERY & BACKUP SPECIFICATION
**Phase 9 Operational Reliability Protocol**

---

## 1. Disaster Recovery Objectives

- **Recovery Point Objective (RPO)**: < 15 minutes for MySQL transactional metadata.
- **Recovery Time Objective (RTO)**: < 30 minutes for Control Plane API & Gateway nodes.

---

## 2. Component Backup & Restoration Strategy

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        BACKUP CLASSIFICATION                           │
├───────────────────────────────┬────────────────────────────────────────┤
│ CRITICAL STATE (Must Backup)  │ RECONSTRUCTIBLE STATE                  │
├───────────────────────────────┼────────────────────────────────────────┤
│ • User Accounts & Auth DB     │ • In-Memory Gateway Socket Maps        │
│ • Admin RBAC & Audit Log Chain│ • Active Device WebSocket Tunnels      │
│ • Device Registrations        │ • Ephemeral Metrics & Counters         │
│ • Server Configurations & DNS │ • Background Worker Lease Locks        │
│ • Billing & Receipts Ledger   │ • Static HTML/CSS/JS Assets            │
└───────────────────────────────┴────────────────────────────────────────┘
```

### 1. MySQL Database Backup
- **Automated Snapshots**: Daily point-in-time recovery (PITR) with binary log archiving.
- **Logical Dump**: Encrypted mysqldump backups executed off-site with retention:
  - Daily: 30 days
  - Monthly: 12 months
- **Security Rule**: Database dumps MUST NEVER be stored on public S3 buckets or unencrypted volumes.

### 2. Zero Customer File Storage Invariant
- **Fundamental Architectural Principle**: ZdexCloud Control Plane **DOES NOT store customer file contents**. Customer files reside strictly on customer-owned Android edge hardware.
- Disaster recovery for the control plane involves **only metadata, routing, and access tokens**. No customer data loss occurs even during a complete control plane database restoration.

---

## 3. Disaster Recovery Scenarios & Playbooks

### Scenario A: Complete Control Plane Host Failure
1. Provision new compute container / VPS instance.
2. Inject production environment variables from secure secret vault (Infisical / AWS Secrets Manager).
3. Connect to managed MySQL database cluster.
4. Execute `npm run build` and `npm start`.
5. Gateway nodes register automatically during startup.
6. Edge Android devices detect connection loss and automatically reconnect via exponential backoff (1s, 2s, 4s, 8s, up to 30s) to re-establish WebSocket tunnels.

### Scenario B: Database Corruption / Point-in-Time Restore
1. Put all Gateway nodes into `MAINTENANCE` mode via Admin API or environment override.
2. Restore MySQL cluster from the latest verified snapshot prior to corruption.
3. Verify Prisma schema consistency (`npx prisma migrate status`).
4. Validate SHA-256 audit chain integrity in `AdminAuditLog` (`previousHash` -> `integrityHash`).
5. Restore Gateway nodes to `ACTIVE` to resume customer traffic.

### Scenario C: Compromised Admin Account
1. Execute SuperAdmin emergency account lockout:
   - Mark compromised admin status as `DISABLED` in `admin_users`.
   - Delete all active `AdminSession` records for the admin.
2. Invalidate all issued OTPs in `admin_email_otps`.
3. Rotate SuperAdmin bootstrap credentials if master key compromised.
4. Inspect `AdminAuditLog` for any unauthorized administrative actions.
