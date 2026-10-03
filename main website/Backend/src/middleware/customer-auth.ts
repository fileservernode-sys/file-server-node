import { FastifyRequest, FastifyReply } from 'fastify';
import { User, UserStatus } from '@prisma/client';
import { prisma } from '../config/database.js';
import { hashSessionToken } from '../utils/crypto.js';
import { UnauthorizedError } from '../errors/app-error.js';
import { CUSTOMER_SESSION_COOKIE_NAME } from '../config/cookie.js';
import { verifyCsrf } from './csrf.js';

export interface CustomerAuthContext {
  token: string | null;
  source: 'bearer' | 'cookie' | null;
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
 * Verifies token hash, expiration, revocation, and active user status.
 */
export async function resolveCustomerSession(rawToken: string): Promise<{
  session: any;
  user: User;
} | null> {
  if (!rawToken || typeof rawToken !== 'string') return null;

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
    user: session.user
  };
}

/**
 * Dedicated Customer Authentication Middleware with integrated CSRF verification.
 * 
 * Flow:
 * 1. Resolves identity from Bearer token (Android/CLI) or HttpOnly Cookie (Browser).
 * 2. Attaches request.user, request.customerSession, request.customerAuthSource.
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

  // Enforce CSRF defense on state-changing cookie requests
  await verifyCsrf(request, reply);
}

/**
 * Helper: Extract and return authenticated platform user from request (Bearer or Cookie).
 * Automatically validates CSRF if request is state-changing and authenticated via Cookie.
 * Throws UnauthorizedError if unauthenticated or ForbiddenError if CSRF validation fails.
 */
export async function getAuthUser(
  request: FastifyRequest,
  options: { skipCsrf?: boolean } = {}
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

  // Enforce CSRF check unless explicitly bypassed
  if (!options.skipCsrf) {
    await verifyCsrf(request);
  }

  return resolved.user;
}
