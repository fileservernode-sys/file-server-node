import { FastifyRequest, FastifyReply } from 'fastify';
import { User, UserStatus } from '@prisma/client';
import { prisma } from '../config/database.js';
import { hashSessionToken } from '../utils/crypto.js';
import { UnauthorizedError, ForbiddenError } from '../errors/app-error.js';
import { CUSTOMER_SESSION_COOKIE_NAME } from '../config/cookie.js';
import { verifyCsrf } from './csrf.js';

export interface CustomerAuthContext {
  token: string | null;
  source: 'bearer' | 'cookie' | null;
}

export interface DeviceScopeContext {
  deviceId: string;
  scope: 'SERVER_RUNTIME';
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
    customerAuthSource?: 'bearer' | 'cookie';
    customerSession?: {
      id: string;
      userId: string;
      tokenHash: string;
      expiresAt: Date;
      createdAt: Date;
    };
    deviceScope?: DeviceScopeContext;
  }
}

/**
 * Extracts the raw customer session token from request headers or HttpOnly cookies.
 * Dual-Mode Resolution Order:
 * 1. Extract Bearer token from 'Authorization: Bearer <token>' if present.
 * 2. Extract Cookie token from '__Host-zdex_session' if present.
 * 3. Dual-Header / Cookie Conflict Detection:
 *    - If both exist and are identical: returns token deterministically.
 *    - If both exist and conflict: fails closed with UnauthorizedError.
 */
export function extractCustomerToken(request: FastifyRequest): CustomerAuthContext {
  let bearerToken: string | null = null;
  const authHeader = request.headers.authorization;
  if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const raw = authHeader.substring(7).trim();
    if (raw.length > 0) {
      bearerToken = raw;
    }
  }

  let cookieToken: string | null = null;
  const cookies = request.cookies;
  if (cookies) {
    const cookieVal = cookies[CUSTOMER_SESSION_COOKIE_NAME] ||
                      cookies['__Host-zdex_session'] ||
                      cookies['zdex_session'] ||
                      (cookies as Record<string, string | undefined>)['__Host_zdex_session'];
    if (cookieVal && typeof cookieVal === 'string' && cookieVal.trim().length > 0) {
      cookieToken = cookieVal.trim();
    }
  }

  // Conflict Detection: fail closed if conflicting credentials are provided
  if (bearerToken && cookieToken) {
    if (bearerToken !== cookieToken) {
      throw new UnauthorizedError('Ambiguous authentication credentials: conflicting session tokens provided');
    }
    return { token: bearerToken, source: 'bearer' };
  }

  if (bearerToken) {
    return { token: bearerToken, source: 'bearer' };
  }

  if (cookieToken) {
    return { token: cookieToken, source: 'cookie' };
  }

  return { token: null, source: null };
}

/**
 * Authoritatively validates raw session token against UserSession table in MySQL.
 * Verifies token hash, expiration, revocation, active user status, and device scope.
 */
export async function resolveCustomerSession(rawToken: string): Promise<{
  session: any;
  user: User;
  deviceScope?: DeviceScopeContext;
} | null> {
  if (!rawToken || typeof rawToken !== 'string') return null;

  let deviceScope: DeviceScopeContext | undefined;
  if (rawToken.startsWith('dst_')) {
    const parts = rawToken.split('_');
    if (parts.length >= 3 && parts[1]) {
      deviceScope = {
        deviceId: parts[1],
        scope: 'SERVER_RUNTIME'
      };
    }
  }

  const tokenHash = hashSessionToken(rawToken);
  const session = await prisma.userSession.findFirst({
    where: {
      tokenHash,
      expiresAt: { gt: new Date() }
    },
    include: {
      user: true
    }
  });

  if (!session || !session.user) {
    return null;
  }

  if (session.user.status !== UserStatus.ACTIVE) {
    return null;
  }

  return {
    session,
    user: session.user,
    deviceScope
  };
}

/**
 * Dedicated Customer Authentication Middleware with integrated CSRF verification.
 * 
 * Flow:
 * 1. Resolves identity from Bearer token (Android/CLI) or HttpOnly Cookie (Browser).
 * 2. Attaches request.user, request.customerSession, request.customerAuthSource, request.deviceScope.
 * 3. Enforces verifyCsrf if request is Cookie-authenticated and method is state-changing.
 */
export async function customerAuthenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const { token, source } = extractCustomerToken(request);

  if (!token) {
    throw new UnauthorizedError('Authentication required');
  }

  const resolved = await resolveCustomerSession(token);
  if (!resolved) {
    throw new UnauthorizedError('Session expired or invalid');
  }

  request.user = resolved.user;
  request.customerSession = resolved.session;
  request.customerAuthSource = source || undefined;
  request.deviceScope = resolved.deviceScope;

  // Enforce CSRF defense on state-changing cookie requests
  await verifyCsrf(request, reply);
}

/**
 * Helper: Extract and return authenticated platform user from request (Bearer or Cookie).
 * Automatically validates CSRF if request is state-changing and authenticated via Cookie.
 * Enforces strict device runtime scope boundaries to prevent privilege escalation.
 * Throws UnauthorizedError if unauthenticated or ForbiddenError if scope validation fails.
 */
export async function getAuthUser(
  request: FastifyRequest,
  options: {
    skipCsrf?: boolean;
    allowDeviceRuntime?: boolean;
    requiredDeviceId?: string;
  } = {}
): Promise<User> {
  const { token, source } = extractCustomerToken(request);

  if (!token) {
    throw new UnauthorizedError('Missing or invalid authentication credential');
  }

  const resolved = await resolveCustomerSession(token);
  if (!resolved) {
    throw new UnauthorizedError('Session expired or invalid token');
  }

  request.user = resolved.user;
  request.customerSession = resolved.session;
  request.customerAuthSource = source || undefined;
  request.deviceScope = resolved.deviceScope;

  // Security boundary enforcement: Device-scoped runtime tokens cannot access interactive user endpoints
  if (resolved.deviceScope && !options.allowDeviceRuntime) {
    throw new ForbiddenError('Device runtime tokens are restricted to server connection operations');
  }

  if (resolved.deviceScope && options.requiredDeviceId && resolved.deviceScope.deviceId !== options.requiredDeviceId) {
    throw new ForbiddenError('Device runtime token is not authorized for the requested device');
  }

  // Enforce CSRF check unless explicitly bypassed
  if (!options.skipCsrf) {
    await verifyCsrf(request);
  }

  return resolved.user;
}
