import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AdminAuditAction } from '@prisma/client';
import { AdminAuthService } from '../../services/admin/admin_auth_service.js';
import { AdminRbacService } from '../../services/admin/admin_rbac_service.js';
import { AdminAuditService } from '../../services/admin/admin_audit_service.js';
import { adminAuthenticate, extractAdminToken } from '../../middleware/admin-auth.js';
import { requirePermission } from '../../middleware/admin-rbac.js';
import { createSuccessResponse, createErrorResponse } from '../../schemas/response.js';
import { ValidationError, UnauthorizedError } from '../../errors/app-error.js';
import { resolveClientIp } from '../../utils/ip.js';

// Input Schemas
const adminLoginSchema = z.object({
  email: z.string().email('Valid admin email is required'),
  password: z.string().min(1, 'Password is required'),
  otp: z.string().length(6, 'OTP must be exactly 6 digits').optional()
});

const adminVerifyOtpSchema = z.object({
  challengeToken: z.string().min(1, 'Challenge token is required'),
  otp: z.string().length(6, 'OTP must be exactly 6 digits')
});

const changePasswordSchema = z.object({
  newPassword: z.string().min(8, 'New password must be at least 8 characters in length')
}).strict();

const updateAdminStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'DISABLED'], {
    errorMap: () => ({ message: "Status must be either 'ACTIVE' or 'DISABLED'" })
  })
}).strict();

const adminIdParamSchema = z.object({
  adminId: z.string().trim().min(1, 'adminId is required').max(64, 'adminId too long')
});

export async function adminAuthRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/v1/admin/auth/login
   * Initiates admin authentication. Returns either a session token or a 2FA challenge.
   */
  app.post(
    '/admin/auth/login',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest) => {
            const clientIp = resolveClientIp(req) || 'unknown';
            return `admin_login_${clientIp}`;
          }
        }
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = adminLoginSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid login parameters');
      }

      const { email, password, otp } = parsed.data;
      const clientIp = resolveClientIp(request);
      const userAgent = request.headers['user-agent'] as string | undefined;

      const result = await AdminAuthService.login({
        email,
        password,
        otp,
        ipAddress: clientIp,
        userAgent
      });

      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * POST /api/v1/admin/auth/verify-otp
   * Completes 2FA OTP verification and returns active AdminSession.
   */
  app.post(
    '/admin/auth/verify-otp',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute'
        }
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = adminVerifyOtpSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid OTP verification parameters');
      }

      const { challengeToken, otp } = parsed.data;
      const clientIp = resolveClientIp(request);
      const userAgent = request.headers['user-agent'] as string | undefined;

      const result = await AdminAuthService.verifyOtpAndLogin({
        challengeToken,
        otp,
        ipAddress: clientIp,
        userAgent
      });

      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * POST /api/v1/admin/auth/logout
   * Revokes the current AdminSession immediately. Safe to call repeatedly.
   */
  app.post(
    '/admin/auth/logout',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const token = extractAdminToken(request);
      const clientIp = resolveClientIp(request);
      const userAgent = request.headers['user-agent'] as string | undefined;

      if (token) {
        await AdminAuthService.logout(token, clientIp, userAgent);
      }

      return reply.status(200).send(createSuccessResponse({
        message: 'Admin logged out successfully'
      }));
    }
  );

  /**
   * GET /api/v1/admin/auth/me
   * Returns current authenticated Admin identity along with effective roles and permissions.
   */
  app.get(
    '/admin/auth/me',
    {
      preHandler: [adminAuthenticate]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.admin) {
        throw new UnauthorizedError('Admin identity not found');
      }

      const clientIp = resolveClientIp(request);

      const [roles, permissions] = await Promise.all([
        AdminRbacService.resolveAdminRoles(request.admin.id),
        AdminRbacService.resolveAdminPermissions(request.admin.id)
      ]);

      // SEC-MED-05: Session Bootstrap Audit Logging
      await AdminAuditService.logEvent({
        adminId: request.admin.id,
        action: AdminAuditAction.ADMIN_SESSION_BOOTSTRAP,
        status: 'SUCCESS',
        ipAddress: clientIp || null,
        userAgent: request.headers['user-agent'] as string | undefined,
        metadata: {
          rolesCount: roles.length,
          permissionsCount: permissions.length
        }
      });

      return reply.status(200).send(createSuccessResponse({
        admin: {
          ...request.admin,
          roles,
          permissions
        }
      }));
    }
  );

  /**
   * POST /api/v1/admin/auth/change-password
   * Changes current Admin user password and bulk revokes all existing sessions.
   */
  app.post(
    '/admin/auth/change-password',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest) => {
            const adminId = (req as any).admin?.id || 'anonymous';
            const clientIp = resolveClientIp(req) || 'unknown';
            return `admin_pwd_change_${adminId}_${clientIp}`;
          }
        }
      },
      preHandler: [adminAuthenticate]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = changePasswordSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid password change payload');
      }

      const clientIp = resolveClientIp(request);
      const userAgent = request.headers['user-agent'] as string | undefined;

      const result = await AdminAuthService.updatePassword({
        adminId: request.admin!.id,
        newPassword: parsed.data.newPassword,
        ipAddress: clientIp,
        userAgent
      });

      return reply.status(200).send(createSuccessResponse(result));
    }
  );

  /**
   * PATCH /api/v1/admin/auth/admins/:adminId/status
   * Updates target Admin user's status. If set to DISABLED, all active sessions are revoked immediately.
   */
  app.patch(
    '/admin/auth/admins/:adminId/status',
    {
      preHandler: [adminAuthenticate, requirePermission('admin_roles.write')]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramParsed = adminIdParamSchema.safeParse(request.params);
      if (!paramParsed.success) {
        throw new ValidationError(paramParsed.error.errors[0]?.message || 'Invalid adminId parameter');
      }

      const bodyParsed = updateAdminStatusSchema.safeParse(request.body);
      if (!bodyParsed.success) {
        throw new ValidationError(bodyParsed.error.errors[0]?.message || 'Invalid status payload');
      }

      const clientIp = resolveClientIp(request);
      const userAgent = request.headers['user-agent'] as string | undefined;

      const result = await AdminAuthService.updateAdminStatus({
        actor: request.admin!,
        targetAdminId: paramParsed.data.adminId,
        newStatus: bodyParsed.data.status as any,
        ipAddress: clientIp,
        userAgent
      });

      return reply.status(200).send(createSuccessResponse(result));
    }
  );
}

