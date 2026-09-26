import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { adminAuthenticate } from '../../middleware/admin-auth.js';
import { requirePermission } from '../../middleware/admin-rbac.js';
import { AdminRbacService } from '../../services/admin/admin_rbac_service.js';
import { createSuccessResponse } from '../../schemas/response.js';
import { ValidationError } from '../../errors/app-error.js';

const assignRoleSchema = z.object({
  roleSlug: z.string().min(1, 'roleSlug is required')
});

export async function adminRbacRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/admin/rbac/roles
   * Lists all defined administrative roles and their assigned permissions
   */
  app.get(
    '/admin/rbac/roles',
    {
      preHandler: [adminAuthenticate, requirePermission('admin_roles.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const roles = await AdminRbacService.listRoles();
      return reply.status(200).send(createSuccessResponse({
        roles: roles.map(r => ({
          id: r.id,
          name: r.name,
          slug: r.slug,
          description: r.description,
          isSystemRole: r.isSystemRole,
          permissions: r.permissions.map((p: any) => p.permission.slug),
          createdAt: r.createdAt.toISOString()
        }))
      }));
    }
  );

  /**
   * GET /api/v1/admin/rbac/permissions
   * Lists all defined system permissions
   */
  app.get(
    '/admin/rbac/permissions',
    {
      preHandler: [adminAuthenticate, requirePermission('admin_roles.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const permissions = await AdminRbacService.listPermissions();
      return reply.status(200).send(createSuccessResponse({
        permissions: permissions.map(p => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          resource: p.resource,
          action: p.action,
          description: p.description
        }))
      }));
    }
  );

  /**
   * GET /api/v1/admin/rbac/admins/:adminId/effective-permissions
   * Inspects effective roles and permissions for a specific administrator
   */
  app.get(
    '/admin/rbac/admins/:adminId/effective-permissions',
    {
      preHandler: [adminAuthenticate, requirePermission('admin_roles.read')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as { adminId: string };
      const { adminId } = params;

      const [roles, permissions] = await Promise.all([
        AdminRbacService.resolveAdminRoles(adminId),
        AdminRbacService.resolveAdminPermissions(adminId)
      ]);

      return reply.status(200).send(createSuccessResponse({
        adminId,
        roles,
        permissions
      }));
    }
  );

  /**
   * POST /api/v1/admin/rbac/admins/:adminId/roles
   * Assigns a role to a target admin user
   */
  app.post(
    '/admin/rbac/admins/:adminId/roles',
    {
      preHandler: [adminAuthenticate, requirePermission('admin_roles.write')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as { adminId: string };
      const { adminId } = params;

      const parsed = assignRoleSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid role assignment payload');
      }

      const result = await AdminRbacService.assignRoleToAdmin({
        actor: request.admin!,
        targetAdminId: adminId,
        roleSlug: parsed.data.roleSlug,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] as string
      });

      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * DELETE /api/v1/admin/rbac/admins/:adminId/roles/:roleSlug
   * Removes a role assignment from a target admin user
   */
  app.delete(
    '/admin/rbac/admins/:adminId/roles/:roleSlug',
    {
      preHandler: [adminAuthenticate, requirePermission('admin_roles.write')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as { adminId: string; roleSlug: string };
      const { adminId, roleSlug } = params;

      const result = await AdminRbacService.removeRoleFromAdmin({
        actor: request.admin!,
        targetAdminId: adminId,
        roleSlug,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] as string
      });

      return reply.status(200).send(createSuccessResponse(result));
    }
  );
}
