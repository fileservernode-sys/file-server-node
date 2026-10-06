/**
 * Phase 17 Batch 17.8 — System Security Controls Types
 * Admin Sessions, Lockouts, RBAC Inventory, Security Events & Credential-Related Posture
 */

export type AdminSessionStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';

export interface AdminSessionItem {
  id: string;
  adminId: string;
  adminEmail: string;
  adminName: string;
  isSuperAdmin: boolean;
  ipAddress: string | null;
  userAgent: string | null;
  lastActivityAt: string;
  expiresAt: string;
  revokedAt: string | null;
  status: AdminSessionStatus;
  createdAt: string;
}

export interface AdminLockoutItem {
  id: string;
  key: string;
  ipAddress: string;
  email: string;
  failedAttempts: number;
  lockedUntil: string | null;
  isLocked: boolean;
  remainingSeconds: number;
  lastAttemptAt: string;
  createdAt: string;
}

export interface SecurityEventItem {
  id: string;
  adminId: string | null;
  adminEmail: string | null;
  action: string;
  status: string;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  integrityHash: string | null;
  sequence: number | null;
  createdAt: string;
}

export interface RbacRoleItem {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isSystemRole: boolean;
  permissionSlugs: string[];
  assignedAdminCount: number;
  createdAt: string;
}

export interface RbacPermissionItem {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  resource: string;
  action: string;
  roleSlugs: string[];
  createdAt: string;
}

export interface RbacInventoryResult {
  roles: RbacRoleItem[];
  permissions: RbacPermissionItem[];
  matrix: {
    roleSlug: string;
    roleName: string;
    permissions: string[];
  }[];
  superAdminPrivilege: {
    description: string;
    wildcardEnabled: boolean;
  };
}

export interface SecurityPostureOverview {
  activeSessionsCount: number;
  recentLoginsCount24h: number;
  failedLoginsCount24h: number;
  activeLockoutsCount: number;
  permissionDenialsCount24h: number;
  totalRolesCount: number;
  totalPermissionsCount: number;
  csrfPosture: {
    enabled: boolean;
    mode: string;
    header: string;
    enforcedOnMutations: boolean;
  };
  mfaPosture: {
    enabled: boolean;
    method: string;
    validityMinutes: number;
  };
  sessionPolicy: {
    absoluteLifetimeHours: number;
    idleTimeoutMinutes: number;
    tokenStorageMode: string;
  };
  bruteForcePolicy: {
    maxFailedAttempts: number;
    lockoutDurationMinutes: number;
  };
}

export interface AdminCredentialPostureItem {
  id: string;
  email: string;
  name: string;
  status: string;
  isSuperAdmin: boolean;
  lastLoginAt: string | null;
  activeSessionsCount: number;
  hasPasswordConfigured: boolean;
  twoFactorConfigured: boolean;
  roles: string[];
  createdAt: string;
}

export interface AdminSessionsListResult {
  items: AdminSessionItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface SecurityEventsListResult {
  items: SecurityEventItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
