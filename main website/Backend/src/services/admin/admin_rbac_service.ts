import { AdminStatus, AdminAuditAction } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { ForbiddenError, NotFoundError, ValidationError, UnauthorizedError } from '../../errors/app-error.js';
import { SYSTEM_PERMISSIONS } from './admin_rbac_seed.js';

export interface AdminActorContext {
  id: string;
  email: string;
  isSuperAdmin: boolean;
  status: AdminStatus;
}

export class AdminRbacService {
  /**
   * Resolves the list of assigned role slugs for a given admin
   */
  static async resolveAdminRoles(adminId: string): Promise<string[]> {
    const admin = await prisma.adminUser.findUnique({
      where: { id: adminId },
      include: {
        userRoles: {
          include: { role: true }
        }
      }
    });

    if (!admin || admin.status !== AdminStatus.ACTIVE) {
      return [];
    }

    const roles = admin.userRoles.map(ur => ur.role.slug);
    if (admin.isSuperAdmin && !roles.includes('SUPER_ADMIN')) {
      roles.unshift('SUPER_ADMIN');
    }

    return roles;
  }

  /**
   * Resolves the effective set of canonical permission slugs for a given admin.
   * If the admin is a SuperAdmin, returns all system permissions plus wildcard '*'.
   */
  static async resolveAdminPermissions(adminId: string): Promise<string[]> {
    const admin = await prisma.adminUser.findUnique({
      where: { id: adminId },
      include: {
        userRoles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: { permission: true }
                }
              }
            }
          }
        }
      }
    });

    if (!admin || admin.status !== AdminStatus.ACTIVE) {
      return [];
    }

    // SuperAdmin bypass: grants complete permission set
    if (admin.isSuperAdmin) {
      const allPerms = SYSTEM_PERMISSIONS.map(p => p.slug);
      return Array.from(new Set(['*', ...allPerms]));
    }

    // Aggregate permissions from all assigned active roles
    const permissionSet = new Set<string>();
    for (const ur of admin.userRoles) {
      for (const rp of ur.role.permissions) {
        permissionSet.add(rp.permission.slug);
      }
    }

    return Array.from(permissionSet);
  }

  /**
   * Verifies whether an admin possesses a specific canonical permission
   */
  static async hasPermission(
    admin: AdminActorContext | string,
    requiredPermission: string
  ): Promise<boolean> {
    const adminId = typeof admin === 'string' ? admin : admin.id;

    if (typeof admin !== 'string' && admin.isSuperAdmin && admin.status === AdminStatus.ACTIVE) {
      return true;
    }

    const permissions = await this.resolveAdminPermissions(adminId);
    return permissions.includes('*') || permissions.includes(requiredPermission.trim().toLowerCase());
  }

  /**
   * Verifies whether an admin possesses at least one of the required permissions
   */
  static async hasAnyPermission(
    admin: AdminActorContext | string,
    requiredPermissions: string[]
  ): Promise<boolean> {
    const adminId = typeof admin === 'string' ? admin : admin.id;

    if (typeof admin !== 'string' && admin.isSuperAdmin && admin.status === AdminStatus.ACTIVE) {
      return true;
    }

    const permissions = await this.resolveAdminPermissions(adminId);
    if (permissions.includes('*')) return true;

    const normalizedReqs = requiredPermissions.map(p => p.trim().toLowerCase());
    return normalizedReqs.some(req => permissions.includes(req));
  }

  /**
   * Verifies whether an admin possesses all of the required permissions
   */
  static async hasAllPermissions(
    admin: AdminActorContext | string,
    requiredPermissions: string[]
  ): Promise<boolean> {
    const adminId = typeof admin === 'string' ? admin : admin.id;

    if (typeof admin !== 'string' && admin.isSuperAdmin && admin.status === AdminStatus.ACTIVE) {
      return true;
    }

    const permissions = await this.resolveAdminPermissions(adminId);
    if (permissions.includes('*')) return true;

    const normalizedReqs = requiredPermissions.map(p => p.trim().toLowerCase());
    return normalizedReqs.every(req => permissions.includes(req));
  }

  /**
   * Assigns a role to a target admin user with strict anti-escalation safeguards.
   */
  static async assignRoleToAdmin(params: {
    actor: AdminActorContext;
    targetAdminId: string;
    roleSlug: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{ success: boolean; message: string }> {
    const { actor, targetAdminId, roleSlug, ipAddress, userAgent } = params;

    // 1. Verify actor status
    if (actor.status !== AdminStatus.ACTIVE) {
      throw new ForbiddenError('Inactive admin cannot assign roles');
    }

    // 2. Anti-Escalation Safeguards:
    // Only SuperAdmin can assign SUPER_ADMIN role
    if (roleSlug.toUpperCase() === 'SUPER_ADMIN' && !actor.isSuperAdmin) {
      throw new ForbiddenError('Only Super Administrators can assign the SUPER_ADMIN role');
    }

    // Non-SuperAdmin cannot modify their own roles (self-escalation defense)
    if (actor.id === targetAdminId && !actor.isSuperAdmin) {
      throw new ForbiddenError('Administrators cannot modify their own assigned roles');
    }

    // Non-SuperAdmin must possess the admin_roles.write permission
    if (!actor.isSuperAdmin) {
      const hasAuth = await this.hasPermission(actor.id, 'admin_roles.write');
      if (!hasAuth) {
        throw new ForbiddenError('Insufficient permissions: admin_roles.write is required');
      }
    }

    // 3. Resolve Target Admin & Role
    const targetAdmin = await prisma.adminUser.findUnique({
      where: { id: targetAdminId }
    });
    if (!targetAdmin) {
      throw new NotFoundError('Target admin user not found');
    }

    const role = await prisma.adminRole.findUnique({
      where: { slug: roleSlug }
    });
    if (!role) {
      throw new NotFoundError(`Role '${roleSlug}' does not exist`);
    }

    // 4. If actor is not SuperAdmin, ensure actor possesses all permissions granted by this role
    if (!actor.isSuperAdmin) {
      const actorPerms = await this.resolveAdminPermissions(actor.id);
      const rolePerms = await prisma.adminRolePermission.findMany({
        where: { roleId: role.id },
        include: { permission: true }
      });

      for (const rp of rolePerms) {
        if (!actorPerms.includes(rp.permission.slug)) {
          throw new ForbiddenError(`Cannot assign a role containing permission '${rp.permission.slug}' which you do not possess`);
        }
      }
    }

    // 5. Create assignment idempotently
    const existing = await prisma.adminUserRole.findUnique({
      where: {
        adminId_roleId: {
          adminId: targetAdmin.id,
          roleId: role.id
        }
      }
    });

    if (!existing) {
      await prisma.adminUserRole.create({
        data: {
          adminId: targetAdmin.id,
          roleId: role.id
        }
      });
    }

    // 6. Audit Trail
    await prisma.adminAuditLog.create({
      data: {
        adminId: actor.id,
        action: AdminAuditAction.ADMIN_ROLE_ASSIGNED,
        status: 'SUCCESS',
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        metadata: {
          targetAdminId: targetAdmin.id,
          targetEmail: targetAdmin.email,
          roleSlug: role.slug
        }
      }
    });

    return {
      success: true,
      message: `Role '${role.name}' assigned to admin '${targetAdmin.email}' successfully`
    };
  }

  /**
   * Removes a role from a target admin user
   */
  static async removeRoleFromAdmin(params: {
    actor: AdminActorContext;
    targetAdminId: string;
    roleSlug: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{ success: boolean; message: string }> {
    const { actor, targetAdminId, roleSlug, ipAddress, userAgent } = params;

    if (actor.status !== AdminStatus.ACTIVE) {
      throw new ForbiddenError('Inactive admin cannot remove roles');
    }

    // Self-modification protection
    if (actor.id === targetAdminId && !actor.isSuperAdmin) {
      throw new ForbiddenError('Administrators cannot modify their own assigned roles');
    }

    if (!actor.isSuperAdmin) {
      const hasAuth = await this.hasPermission(actor.id, 'admin_roles.write');
      if (!hasAuth) {
        throw new ForbiddenError('Insufficient permissions: admin_roles.write is required');
      }
    }

    const targetAdmin = await prisma.adminUser.findUnique({
      where: { id: targetAdminId }
    });
    if (!targetAdmin) {
      throw new NotFoundError('Target admin user not found');
    }

    const role = await prisma.adminRole.findUnique({
      where: { slug: roleSlug }
    });
    if (!role) {
      throw new NotFoundError(`Role '${roleSlug}' not found`);
    }

    await prisma.adminUserRole.deleteMany({
      where: {
        adminId: targetAdmin.id,
        roleId: role.id
      }
    });

    await prisma.adminAuditLog.create({
      data: {
        adminId: actor.id,
        action: AdminAuditAction.ADMIN_ROLE_REMOVED,
        status: 'SUCCESS',
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        metadata: {
          targetAdminId: targetAdmin.id,
          targetEmail: targetAdmin.email,
          roleSlug: role.slug
        }
      }
    });

    return {
      success: true,
      message: `Role '${role.name}' removed from admin '${targetAdmin.email}' successfully`
    };
  }

  /**
   * Lists all defined administrative roles and their assigned permissions
   */
  static async listRoles(): Promise<any[]> {
    return prisma.adminRole.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        permissions: {
          include: { permission: true }
        }
      }
    });
  }

  /**
   * Lists all defined administrative permissions
   */
  static async listPermissions(): Promise<any[]> {
    return prisma.adminPermission.findMany({
      orderBy: [{ resource: 'asc' }, { action: 'asc' }]
    });
  }
}
