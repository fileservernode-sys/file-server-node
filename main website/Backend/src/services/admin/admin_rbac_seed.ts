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
  { slug: 'users.suspend', name: 'Suspend Users', resource: 'users', action: 'suspend', description: 'Suspend or restore customer accounts' },
  { slug: 'users.impersonate', name: 'Impersonate Users', resource: 'users', action: 'impersonate', description: 'Generate ephemeral support sessions for customer troubleshooting' },

  // Devices & Servers
  { slug: 'devices.read', name: 'View Devices', resource: 'devices', action: 'read', description: 'View registered Android edge devices and topology' },
  { slug: 'devices.write', name: 'Manage Devices', resource: 'devices', action: 'write', description: 'Unpair or manage device nodes' },
  { slug: 'devices.disconnect', name: 'Disconnect Devices', resource: 'devices', action: 'disconnect', description: 'Forcefully terminate active edge device connections' },
  { slug: 'servers.read', name: 'View Server Instances', resource: 'servers', action: 'read', description: 'Inspect edge file server instances' },
  { slug: 'servers.write', name: 'Manage Server Instances', resource: 'servers', action: 'write', description: 'Start, stop, or delete server instances' },
  { slug: 'servers.power', name: 'Power Control Servers', resource: 'servers', action: 'power', description: 'Remotely start, stop, or restart server instances' },

  // Billing Operations
  { slug: 'billing.read', name: 'View Billing', resource: 'billing', action: 'read', description: 'View customer billing state, payments, subscriptions, and receipts' },
  { slug: 'billing.write', name: 'Manage Billing', resource: 'billing', action: 'write', description: 'Modify billing plans or trigger ledger sync' },
  { slug: 'billing.refund', name: 'Issue Refunds', resource: 'billing', action: 'refund', description: 'Execute or approve payment refunds' },
  { slug: 'billing.reconcile', name: 'Trigger Reconciliation', resource: 'billing', action: 'reconcile', description: 'Initiate and manage reconciliation runs' },

  // Support Desk
  { slug: 'support.read', name: 'View Support Tickets', resource: 'support', action: 'read', description: 'Read customer support tickets, cases, and communications' },
  { slug: 'support.write', name: 'Manage Support Tickets', resource: 'support', action: 'write', description: 'Create, update, resolve, and manage support cases' },
  { slug: 'support.assign', name: 'Assign Support Cases', resource: 'support', action: 'assign', description: 'Assign support cases to administrative agents' },
  { slug: 'support.notes', name: 'Manage Support Notes', resource: 'support', action: 'notes', description: 'Add and view internal operator notes on support cases' },

  // Communications & Notifications
  { slug: 'notifications.read', name: 'View Notifications', resource: 'notifications', action: 'read', description: 'View delivery logs and channel preferences' },
  { slug: 'notifications.write', name: 'Send Notifications', resource: 'notifications', action: 'write', description: 'Send system broadcasts and manual alerts' },

  // Email Tracking & Operations (Phase 13)
  { slug: 'emails.read', name: 'View Emails', resource: 'emails', action: 'read', description: 'Inspect outbound transactional and notification email logs and delivery states' },
  { slug: 'emails.manage', name: 'Manage Emails', resource: 'emails', action: 'manage', description: 'Manage outbound email operations and deliverability configuration' },

  // Gateway & Infrastructure
  { slug: 'gateway.read', name: 'View Gateway Telemetry', resource: 'gateway', action: 'read', description: 'Monitor WebSocket nodes and connected sockets' },
  { slug: 'gateway.write', name: 'Manage Gateway', resource: 'gateway', action: 'write', description: 'Execute ping probes and node maintenance' },
  { slug: 'gateway.drain', name: 'Drain Gateway Nodes', resource: 'gateway', action: 'drain', description: 'Drain gateway nodes and manage maintenance transitions' },

  // Observability & Error Center
  { slug: 'errors.read', name: 'View System Errors', resource: 'errors', action: 'read', description: 'Inspect error fingerprints, incidents, and occurrence telemetry' },
  { slug: 'errors.manage', name: 'Manage System Errors', resource: 'errors', action: 'manage', description: 'Acknowledge, resolve, mute, and unmute error incidents' },
  { slug: 'errors.export', name: 'Export System Errors', resource: 'errors', action: 'export', description: 'Export operational error telemetry and reports' },
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
      'users.read', 'users.write', 'users.suspend',
      'devices.read', 'devices.write', 'devices.disconnect',
      'servers.read', 'servers.write', 'servers.power',
      'billing.read', 'billing.write', 'billing.refund', 'billing.reconcile',
      'support.read', 'support.write', 'support.assign', 'support.notes',
      'notifications.read', 'notifications.write',
      'emails.read', 'emails.manage',
      'gateway.read', 'gateway.write', 'gateway.drain',
      'errors.read', 'errors.manage',
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
      'support.read', 'support.write', 'support.assign', 'support.notes',
      'notifications.read',
      'emails.read'
    ]
  },
  {
    slug: 'OPERATIONS',
    name: 'Operations Engineer',
    description: 'Infrastructure, edge topology, gateway, and diagnostics operations',
    permissions: [
      'devices.read', 'devices.write', 'devices.disconnect',
      'servers.read', 'servers.write', 'servers.power',
      'gateway.read', 'gateway.write', 'gateway.drain',
      'errors.read', 'errors.manage',
      'emails.read', 'emails.manage',
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

  // 1. Batch Fetch Existing Permissions
  const existingPerms = await prisma.adminPermission.findMany();
  const permissionMap = new Map<string, string>(); // slug -> id
  for (const ep of existingPerms) {
    permissionMap.set(ep.slug, ep.id);
  }

  for (const perm of SYSTEM_PERMISSIONS) {
    if (!permissionMap.has(perm.slug)) {
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
    }
  }

  // 2. Batch Fetch Existing Roles & Bindings
  const existingRoles = await prisma.adminRole.findMany();
  const roleMap = new Map<string, any>(); // slug -> role
  for (const er of existingRoles) {
    roleMap.set(er.slug, er);
  }

  const existingBindings = await prisma.adminRolePermission.findMany();
  const bindingSet = new Set<string>(); // "roleId:permId"
  for (const eb of existingBindings) {
    bindingSet.add(`${eb.roleId}:${eb.permissionId}`);
  }

  for (const roleDef of SYSTEM_ROLES) {
    let role = roleMap.get(roleDef.slug);
    if (!role) {
      role = await prisma.adminRole.create({
        data: {
          slug: roleDef.slug,
          name: roleDef.name,
          description: roleDef.description,
          isSystemRole: true
        }
      });
      roleMap.set(roleDef.slug, role);
      rolesCreated++;
    }

    // Bind permissions to role
    for (const permSlug of roleDef.permissions) {
      const permId = permissionMap.get(permSlug);
      if (permId) {
        const key = `${role.id}:${permId}`;
        if (!bindingSet.has(key)) {
          await prisma.adminRolePermission.create({
            data: {
              roleId: role.id,
              permissionId: permId
            }
          });
          bindingSet.add(key);
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
