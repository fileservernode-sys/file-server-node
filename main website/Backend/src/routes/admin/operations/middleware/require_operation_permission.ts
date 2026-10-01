import { FastifyRequest, FastifyReply } from 'fastify';
import { AdminStatus, AdminAuditAction } from '@prisma/client';
import { AdminRbacService } from '../../../../services/admin/admin_rbac_service.js';
import { AdminAuditService } from '../../../../services/admin/admin_audit_service.js';
import { UnauthorizedError, ForbiddenError } from '../../../../errors/app-error.js';
import { AdminOperationContext } from '../types.js';
import { resolveClientIp } from '../../../../utils/ip.js';

declare module 'fastify' {
  interface FastifyRequest {
    operationContext?: AdminOperationContext;
  }
}

/**
 * Builds the strongly typed AdminOperationContext from the authenticated Fastify request.
 */
export async function resolveOperationContext(
  request: FastifyRequest,
  operationName?: string,
  targetResourceType?: string,
  targetResourceId?: string
): Promise<AdminOperationContext> {
  const admin = request.admin;
  if (!admin) {
    throw new UnauthorizedError('Authentication required: missing admin identity context');
  }

  const [roles, permissions] = await Promise.all([
    AdminRbacService.resolveAdminRoles(admin.id),
    AdminRbacService.resolveAdminPermissions(admin.id)
  ]);

  const context: AdminOperationContext = {
    adminId: admin.id,
    adminEmail: admin.email,
    adminName: admin.name,
    isSuperAdmin: admin.isSuperAdmin,
    status: admin.status,
    sessionId: admin.sessionId,
    roles,
    permissions,
    requestId: (request.id as string) || `req-op-${Date.now()}`,
    clientIp: resolveClientIp(request) || 'unknown',
    userAgent: (request.headers['user-agent'] as string) || 'unknown',
    operationName,
    targetResourceType,
    targetResourceId
  };

  request.operationContext = context;
  return context;
}

/**
 * Reusable preHandler middleware enforcing a single operational permission.
 */
export function requireOperationPermission(permission: string) {
  return async function operationPermissionGuard(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const admin = request.admin;

    if (!admin) {
      throw new UnauthorizedError('Authentication required: missing admin identity context');
    }

    if (admin.status !== AdminStatus.ACTIVE) {
      throw new ForbiddenError('Admin account is disabled');
    }

    const isAllowed = await AdminRbacService.hasPermission(admin, permission);

    if (!isAllowed) {
      await AdminAuditService.logEvent({
        adminId: admin.id,
        action: AdminAuditAction.ADMIN_AUTHZ_DENIED,
        status: 'DENIED',
        ipAddress: resolveClientIp(request) || null,
        userAgent: (request.headers['user-agent'] as string) || null,
        metadata: {
          requiredPermission: permission,
          url: request.url,
          method: request.method,
          namespace: 'operations'
        }
      });

      throw new ForbiddenError(`Access denied: missing required permission '${permission}'`);
    }

    // Attach enriched operation context to request
    await resolveOperationContext(request, `permission:${permission}`);
  };
}

/**
 * Reusable preHandler middleware requiring AT LEAST ONE of the specified permissions.
 */
export function requireAnyOperationPermission(permissions: string[]) {
  return async function anyOperationPermissionGuard(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
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
          method: request.method,
          namespace: 'operations'
        }
      });

      throw new ForbiddenError(`Access denied: requires at least one of [${permissions.join(', ')}]`);
    }

    await resolveOperationContext(request, `any_permission:${permissions.join('|')}`);
  };
}

/**
 * Reusable preHandler middleware requiring ALL of the specified permissions.
 */
export function requireAllOperationPermissions(permissions: string[]) {
  return async function allOperationPermissionsGuard(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
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
          method: request.method,
          namespace: 'operations'
        }
      });

      throw new ForbiddenError(`Access denied: requires all of [${permissions.join(', ')}]`);
    }

    await resolveOperationContext(request, `all_permissions:${permissions.join('&')}`);
  };
}
