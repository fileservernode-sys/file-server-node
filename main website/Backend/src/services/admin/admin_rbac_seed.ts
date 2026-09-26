import { prisma } from '../../config/database.js';

export interface SystemPermissionDef {
  slug: string;
  name: string;
  resource: string;
  action: string;
  description: string;
}

export interface SystemRoleDef {
  slug: string;
  name: string;
  description: string;
  permissions: string[];
}

export const SYSTEM_PERMISSIONS: SystemPermissionDef[] = [
  // User Management
  { slug: 'users.read', name: 'View Users', resource: 'users', action: 'read', description: 'View customer accounts and profiles' },
  { slug: 'users.write', name: 'Manage Users', resource: 'users', action: 'write', description: 'Create, update, or suspend customer accounts' },
  { slug: 'users.impersonate', name: 'Impersonate Users', resource: 'users', action: 'impersonate', description: 'Generate ephemeral support sessions for customer troubleshooting' },

  // Devices & Servers
  { slug: 'devices.read', name: 'View Devices', resource: 'devices', action: 'read', description: 'View registered Android edge devices and topology' },
  { slug: 'devices.write', name: 'Manage Devices', resource: 'devices', action: 'write', description: 'Unpair or manage device nodes' },
  { slug: 'servers.read', name: 'View Server Instances', resource: 'servers', action: 'read', description: 'Inspect edge file server instances' },
  { slug: 'servers.write', name: 'Manage Server Instances', resource: 'servers', action: 'write', description: 'Start, stop, or delete server instances' },

  // Billing Operations
  { slug: 'billing.read', name: 'View Billing', resource: 'billing', action: 'read', description: 'View customer billing state, payments, subscriptions, and receipts' },
  { slug: 'billing.write', name: 'Manage Billing', resource: 'billing', action: 'write', description: 'Modify billing plans or trigger ledger sync' },
  { slug: 'billing.refund', name: 'Issue Refunds', resource: 'billing', action: 'refund', description: 'Execute or approve payment refunds' },
  { slug: 'billing.reconcile', name: 'Trigger Reconciliation', resource: 'billing', action: 'reconcile', description: 'Initiate and manage reconciliation runs' },

  // Support Desk
  { slug: 'support.read', name: 'View Support Tickets', resource: 'support', action: 'read', description: 'Read customer support tickets and communications' },
  { slug: 'support.write', name: 'Manage Support Tickets', resource: 'support', action: 'write', description: 'Respond to and manage support tickets' },

  // Communications & Notifications
  { slug: 'notifications.read', name: 'View Notifications', resource: 'notifications', action: 'read', description: 'View delivery logs and channel preferences' },
  { slug: 'notifications.write', name: 'Send Notifications', resource: 'notifications', action: 'write', description: 'Send system broadcasts and manual alerts' },

  // Gateway & Infrastructure
  { slug: 'gateway.read', name: 'View Gateway Telemetry', resource: 'gateway', action: 'read', description: 'Monitor WebSocket nodes and connected sockets' },
  { slug: 'gateway.write', name: 'Manage Gateway', resource: 'gateway', action: 'write', description: 'Execute ping probes and node maintenance' },

  // Observability & Audit
  { slug: 'errors.read', name: 'View System Errors', resource: 'errors', action: 'read', description: 'Inspect error fingerprints and incidents' },
  { slug: 'audit.read', name: 'View Audit Logs', resource: 'audit', action: 'read', description: 'Inspect customer and administrative audit trails' },

  // RBAC & Administration
  { slug: 'admin_roles.read', name: 'View Admin Roles', resource: 'admin_roles', action: 'read', description: 'View administrative roles and permission matrix' },
  { slug: 'admin_roles.write', name: 'Manage Admin Roles', resource: 'admin_roles', action: 'write', description: 'Assign roles and configure permissions' },

  // System & Operations
  { slug: 'system.read', name: 'View System Config', resource: 'system', action: 'read', description: 'View system environment and health metrics' },
  { slug: 'system.write', name: 'Manage System Config', resource: 'system', action: 'write', description: 'Modify system runtime parameters' }
];

export const SYSTEM_ROLES: SystemRoleDef[] = [
  {
    slug: 'SUPER_ADMIN',
    name: 'Super Administrator',
    description: 'Unrestricted full access across all control plane systems and operations',
    permissions: SYSTEM_PERMISSIONS.map(p => p.slug)
  },
  {
    slug: 'ADMIN',
    name: 'Administrator',
    description: 'Standard operational administrator with management access across domains',
    permissions: [
      'users.read', 'users.write',
      'devices.read', 'devices.write',
      'servers.read', 'servers.write',
      'billing.read', 'billing.write', 'billing.refund', 'billing.reconcile',
      'support.read', 'support.write',
      'notifications.read', 'notifications.write',
      'gateway.read',
      'errors.read',
      'audit.read',
      'admin_roles.read',
      'system.read'
    ]
  },
  {
    slug: 'SUPPORT',
    name: 'Support Agent',
    description: 'Customer-facing support and ticket triage operations',
    permissions: [
      'users.read',
      'devices.read',
      'servers.read',
      'billing.read',
      'support.read', 'support.write',
      'notifications.read'
    ]
  },
  {
    slug: 'OPERATIONS',
    name: 'Operations Engineer',
    description: 'Infrastructure, edge topology, gateway, and diagnostics operations',
    permissions: [
      'devices.read', 'devices.write',
      'servers.read', 'servers.write',
      'gateway.read', 'gateway.write',
      'errors.read',
      'audit.read',
      'system.read'
    ]
  }
];

/**
 * Idempotently seeds system permissions, system roles, and their assignments.
 * Safe to run multiple times without duplicating or corrupting existing data.
 */
export async function seedAdminRbac(): Promise<{
  permissionsCreated: number;
  rolesCreated: number;
  assignmentsCreated: number;
}> {
  let permissionsCreated = 0;
  let rolesCreated = 0;
  let assignmentsCreated = 0;

  // 1. Upsert Permissions
  const permissionMap = new Map<string, string>(); // slug -> id
  for (const perm of SYSTEM_PERMISSIONS) {
    const existing = await prisma.adminPermission.findUnique({ where: { slug: perm.slug } });
    if (!existing) {
      const created = await prisma.adminPermission.create({
        data: {
          slug: perm.slug,
          name: perm.name,
          resource: perm.resource,
          action: perm.action,
          description: perm.description
        }
      });
      permissionMap.set(perm.slug, created.id);
      permissionsCreated++;
    } else {
      permissionMap.set(perm.slug, existing.id);
    }
  }

  // 2. Upsert System Roles & Bindings
  for (const roleDef of SYSTEM_ROLES) {
    let role = await prisma.adminRole.findUnique({ where: { slug: roleDef.slug } });
    if (!role) {
      role = await prisma.adminRole.create({
        data: {
          slug: roleDef.slug,
          name: roleDef.name,
          description: roleDef.description,
          isSystemRole: true
        }
      });
      rolesCreated++;
    }

    // Bind permissions to role
    for (const permSlug of roleDef.permissions) {
      const permId = permissionMap.get(permSlug);
      if (permId) {
        const binding = await prisma.adminRolePermission.findUnique({
          where: {
            roleId_permissionId: {
              roleId: role.id,
              permissionId: permId
            }
          }
        });

        if (!binding) {
          await prisma.adminRolePermission.create({
            data: {
              roleId: role.id,
              permissionId: permId
            }
          });
          assignmentsCreated++;
        }
      }
    }
  }

  return {
    permissionsCreated,
    rolesCreated,
    assignmentsCreated
  };
}
