import { FastifyRequest, FastifyReply } from 'fastify';
import { AdminStatus } from '@prisma/client';
import { AdminAuthService, AdminUserSanitized } from '../services/admin/admin_auth_service.js';
import { UnauthorizedError, ForbiddenError } from '../errors/app-error.js';
import { resolveClientIp } from '../utils/ip.js';
import { ADMIN_SESSION_COOKIE_NAME } from '../config/cookie.js';
import { CSRF_HEADER_NAME, validateCsrfToken } from '../utils/csrf.js';

export interface AdminContext extends AdminUserSanitized {
  sessionId: string;
}

export interface AdminAuthContext {
  token: string | null;
  source: 'bearer' | 'cookie' | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    admin?: AdminContext;
    adminAuthSource?: 'bearer' | 'cookie';
    adminSession?: {
      id: string;
      adminId: string;
      tokenHash: string;
      expiresAt: Date;
      createdAt: Date;
    };
  }
}

/**
 * Extracts raw admin token from request headers or HttpOnly cookies with strict dual-mode resolution.
 * If both headers and cookies are supplied:
 * - If identical: returns the token deterministically.
 * - If conflicting: fails closed by throwing UnauthorizedError.
 */
export function extractAdminTokenContext(request: FastifyRequest): AdminAuthContext {
  let customToken: string | null = null;
  const customHeader = (request.headers['x-admin-session-token'] || request.headers['X-Admin-Session-Token']) as string | undefined;
  if (customHeader && typeof customHeader === 'string' && customHeader.trim().length > 0) {
    customToken = customHeader.trim();
  }

  let authHeaderToken: string | null = null;
  const authHeader = request.headers.authorization;
  if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const raw = authHeader.substring(7).trim();
    if (raw.length > 0) {
      authHeaderToken = raw;
    }
  }

  // Header conflict check: fail closed if both headers provided with conflicting tokens
  if (customToken && authHeaderToken && customToken !== authHeaderToken) {
    throw new UnauthorizedError('Ambiguous authentication credentials: conflicting admin session tokens provided in headers');
  }

  const bearerToken = customToken || authHeaderToken;

  let cookieToken: string | null = null;
  let isBrowserCookie = false;
  const cookies = request.cookies;
  if (cookies) {
    const browserCookieVal = cookies[ADMIN_SESSION_COOKIE_NAME] ||
                             cookies['__Host-zdex_admin_session'] ||
                             cookies['zdex_admin_session'] ||
                             (cookies as Record<string, string | undefined>)['__Host_zdex_admin_session'];
    if (browserCookieVal && typeof browserCookieVal === 'string' && browserCookieVal.trim().length > 0) {
      cookieToken = browserCookieVal.trim();
      isBrowserCookie = true;
    } else {
      const testCookieVal = cookies['admin_session'] || cookies['admin_session_token'];
      if (testCookieVal && typeof testCookieVal === 'string' && testCookieVal.trim().length > 0) {
        cookieToken = testCookieVal.trim();
        isBrowserCookie = false;
      }
    }
  }

  // Conflict Detection: fail closed if conflicting credentials are provided
  if (bearerToken && cookieToken) {
    if (bearerToken !== cookieToken) {
      throw new UnauthorizedError('Ambiguous authentication credentials: conflicting admin session tokens provided');
    }
    return { token: cookieToken, source: isBrowserCookie ? 'cookie' : 'bearer' };
  }

  if (cookieToken) {
    return { token: cookieToken, source: isBrowserCookie ? 'cookie' : 'bearer' };
  }

  if (bearerToken) {
    return { token: bearerToken, source: 'bearer' };
  }

  return { token: null, source: null };
}

/**
 * Backward-compatible helper extracting raw token string.
 */
export function extractAdminToken(request: FastifyRequest): string | null {
  return extractAdminTokenContext(request).token;
}

/**
 * Dedicated Admin Authentication Middleware
 * Validates session token hash, revocation, absolute expiration, 15-min idle timeout, and ACTIVE status.
 * Attaches resolved identity to request.admin (NEVER request.user).
 * Enforces Anti-CSRF on cookie-authenticated mutations.
 */
export async function adminAuthenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authContext = extractAdminTokenContext(request);

  if (!authContext.token) {
    throw new UnauthorizedError('Missing admin session token');
  }

  const clientIp = resolveClientIp(request);
  const validationResult = await AdminAuthService.validateSession(authContext.token, clientIp);

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

  request.adminAuthSource = authContext.source || 'bearer';
  request.adminSession = {
    id: session.id,
    adminId: session.adminId,
    tokenHash: session.sessionTokenHash,
    expiresAt: session.expiresAt,
    createdAt: session.createdAt
  };

  // Anti-CSRF Enforcement for cookie-authenticated state-changing requests
  const method = request.method.toUpperCase();
  const isStateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  if (isStateChanging && request.adminAuthSource === 'cookie') {
    const csrfHeader = (
      request.headers[CSRF_HEADER_NAME] ||
      request.headers['x-zdex-csrf-token'] ||
      request.headers['x-admin-csrf-token']
    ) as string | undefined;

    if (!csrfHeader || typeof csrfHeader !== 'string' || csrfHeader.trim().length === 0) {
      throw new ForbiddenError('CSRF validation failed: missing x-zdex-csrf-token header');
    }

    const isValidCsrf = validateCsrfToken(csrfHeader.trim(), {
      id: session.id,
      tokenHash: session.sessionTokenHash
    });

    if (!isValidCsrf) {
      throw new ForbiddenError('CSRF validation failed: invalid or mismatched admin CSRF token');
    }
  }
}

