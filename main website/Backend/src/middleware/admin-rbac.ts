import { FastifyRequest, FastifyReply } from 'fastify';
import { AdminStatus, AdminAuditAction } from '@prisma/client';
import { AdminRbacService } from '../services/admin/admin_rbac_service.js';
import { AdminAuditService } from '../services/admin/admin_audit_service.js';
import { UnauthorizedError, ForbiddenError } from '../errors/app-error.js';
import { resolveClientIp } from '../utils/ip.js';

/**
 * Creates a route-level preHandler middleware enforcing a single required permission.
 * Unauthenticated calls return 401 Unauthorized.
 * Authenticated calls lacking the permission return 403 Forbidden.
 */
export function requirePermission(permission: string) {
  return async function permissionGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const admin = request.admin;

    // 1. Confirm admin authentication has occurred
    if (!admin) {
      throw new UnauthorizedError('Authentication required: missing admin identity context');
    }

    // 2. Enforce active admin status
    if (admin.status !== AdminStatus.ACTIVE) {
      throw new ForbiddenError('Admin account is disabled');
    }

    // 3. Check permission
    const isAllowed = await AdminRbacService.hasPermission(admin, permission);

    if (!isAllowed) {
      // Log authorization denial with cryptographic integrity chaining
      await AdminAuditService.logEvent({
        adminId: admin.id,
        action: AdminAuditAction.ADMIN_AUTHZ_DENIED,
        status: 'DENIED',
        ipAddress: resolveClientIp(request) || null,
        userAgent: (request.headers['user-agent'] as string) || null,
        metadata: {
          requiredPermission: permission,
          url: request.url,
          method: request.method
        }
      });

      throw new ForbiddenError(`Access denied: missing required permission '${permission}'`);
    }
  };
}

/**
 * Creates a route-level preHandler middleware requiring AT LEAST ONE of the specified permissions.
 */
export function requireAnyPermission(permissions: string[]) {
  return async function anyPermissionGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const admin = request.admin;

    if (!admin) {
      throw new UnauthorizedError('Authentication required: missing admin identity context');
    }

    if (admin.status !== AdminStatus.ACTIVE) {
      throw new ForbiddenError('Admin account is disabled');
    }

    const isAllowed = await AdminRbacService.hasAnyPermission(admin, permissions);

    if (!isAllowed) {
      await AdminAuditService.logEvent({
        adminId: admin.id,
        action: AdminAuditAction.ADMIN_AUTHZ_DENIED,
        status: 'DENIED',
        ipAddress: resolveClientIp(request) || null,
        userAgent: (request.headers['user-agent'] as string) || null,
        metadata: {
          requiredAnyPermissions: permissions,
          url: request.url,
          method: request.method
        }
      });

      throw new ForbiddenError(`Access denied: requires at least one of [${permissions.join(', ')}]`);
    }
  };
}

/**
 * Creates a route-level preHandler middleware requiring ALL of the specified permissions.
 */
export function requireAllPermissions(permissions: string[]) {
  return async function allPermissionsGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const admin = request.admin;

    if (!admin) {
      throw new UnauthorizedError('Authentication required: missing admin identity context');
    }

    if (admin.status !== AdminStatus.ACTIVE) {
      throw new ForbiddenError('Admin account is disabled');
    }

    const isAllowed = await AdminRbacService.hasAllPermissions(admin, permissions);

    if (!isAllowed) {
      await AdminAuditService.logEvent({
        adminId: admin.id,
        action: AdminAuditAction.ADMIN_AUTHZ_DENIED,
        status: 'DENIED',
        ipAddress: resolveClientIp(request) || null,
        userAgent: (request.headers['user-agent'] as string) || null,
        metadata: {
          requiredAllPermissions: permissions,
          url: request.url,
          method: request.method
        }
      });

      throw new ForbiddenError(`Access denied: requires all of [${permissions.join(', ')}]`);
    }
  };
}
