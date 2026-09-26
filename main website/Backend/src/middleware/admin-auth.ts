import { FastifyRequest, FastifyReply } from 'fastify';
import { AdminStatus } from '@prisma/client';
import { AdminAuthService, AdminUserSanitized } from '../services/admin/admin_auth_service.js';
import { UnauthorizedError } from '../errors/app-error.js';

export interface AdminContext extends AdminUserSanitized {
  sessionId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    admin?: AdminContext;
  }
}

/**
 * Extracts raw admin token from request headers
 */
export function extractAdminToken(request: FastifyRequest): string | null {
  const customHeader = (request.headers['x-admin-session-token'] || request.headers['X-Admin-Session-Token']) as string | undefined;
  if (customHeader && typeof customHeader === 'string' && customHeader.trim().length > 0) {
    return customHeader.trim();
  }

  const authHeader = request.headers.authorization;
  if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }

  return null;
}

/**
 * Dedicated Admin Authentication Middleware
 * Validates session token hash, revocation, absolute expiration, 15-min idle timeout, and ACTIVE status.
 * Attaches resolved identity to request.admin (NEVER request.user).
 */
export async function adminAuthenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const token = extractAdminToken(request);

  if (!token) {
    throw new UnauthorizedError('Missing admin session token');
  }

  const clientIp = request.ip || '127.0.0.1';
  const validationResult = await AdminAuthService.validateSession(token, clientIp);

  if (!validationResult) {
    throw new UnauthorizedError('Invalid, expired, or revoked admin session');
  }

  const { session, admin } = validationResult;

  if (admin.status !== AdminStatus.ACTIVE) {
    throw new UnauthorizedError('Admin account is disabled');
  }

  // Attach strictly to request.admin
  request.admin = {
    ...admin,
    sessionId: session.id
  };
}
