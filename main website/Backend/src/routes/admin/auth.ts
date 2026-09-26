import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AdminAuthService } from '../../services/admin/admin_auth_service.js';
import { AdminRbacService } from '../../services/admin/admin_rbac_service.js';
import { adminAuthenticate, extractAdminToken } from '../../middleware/admin-auth.js';
import { createSuccessResponse, createErrorResponse } from '../../schemas/response.js';
import { ValidationError, UnauthorizedError } from '../../errors/app-error.js';

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
          timeWindow: '1 minute'
        }
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = adminLoginSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid login parameters');
      }

      const { email, password, otp } = parsed.data;
      const clientIp = request.ip || '127.0.0.1';
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
      const clientIp = request.ip || '127.0.0.1';
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
      const clientIp = request.ip || '127.0.0.1';
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

      const [roles, permissions] = await Promise.all([
        AdminRbacService.resolveAdminRoles(request.admin.id),
        AdminRbacService.resolveAdminPermissions(request.admin.id)
      ]);

      return reply.status(200).send(createSuccessResponse({
        admin: {
          ...request.admin,
          roles,
          permissions
        }
      }));
    }
  );
}

