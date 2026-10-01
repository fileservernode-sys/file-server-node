import { FastifyRequest, FastifyReply } from 'fastify';
import { AdminStatus } from '@prisma/client';
import { AdminAuthService, AdminUserSanitized } from '../services/admin/admin_auth_service.js';
import { UnauthorizedError } from '../errors/app-error.js';
import { resolveClientIp } from '../utils/ip.js';

export interface AdminContext extends AdminUserSanitized {
  sessionId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    admin?: AdminContext;
  }
}

/**
 * Extracts raw admin token from request headers with strict dual-header standardization.
 * If both 'x-admin-session-token' and 'Authorization: Bearer' are supplied:
 * - If identical: returns the token deterministically.
 * - If conflicting: fails closed by throwing UnauthorizedError.
 */
export function extractAdminToken(request: FastifyRequest): string | null {
  let customToken: string | null = null;
  const customHeader = (request.headers['x-admin-session-token'] || request.headers['X-Admin-Session-Token']) as string | undefined;
  if (customHeader && typeof customHeader === 'string' && customHeader.trim().length > 0) {
    customToken = customHeader.trim();
  }

  let bearerToken: string | null = null;
  const authHeader = request.headers.authorization;
  if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const raw = authHeader.substring(7).trim();
    if (raw.length > 0) {
      bearerToken = raw;
    }
  }

  // Conflict Detection: fail closed if conflicting credentials are provided
  if (customToken && bearerToken) {
    if (customToken !== bearerToken) {
      throw new UnauthorizedError('Ambiguous authentication credentials: conflicting admin session tokens provided');
    }
    return customToken;
  }

  return customToken || bearerToken || null;
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

  const clientIp = resolveClientIp(request);
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
