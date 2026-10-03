import { FastifyRequest, FastifyReply } from 'fastify';
import { ForbiddenError, UnauthorizedError } from '../errors/app-error.js';
import { CSRF_HEADER_NAME, validateCsrfToken } from '../utils/csrf.js';

export { CSRF_HEADER_NAME, generateCsrfToken, validateCsrfToken } from '../utils/csrf.js';

/**
 * Dedicated Anti-CSRF Middleware for Fastify routes.
 * 
 * Enforcement Rules:
 * 1. State-changing methods (POST, PUT, PATCH, DELETE) require CSRF verification ONLY when authenticated via Cookie.
 * 2. Idempotent methods (GET, HEAD, OPTIONS) are exempted from CSRF verification.
 * 3. Native / Android / CLI requests authenticated via Bearer token are exempted from CSRF verification.
 * 4. Missing or invalid CSRF token on cookie-authenticated state-changing requests fails closed with 403 Forbidden.
 */
export async function verifyCsrf(
  request: FastifyRequest,
  reply?: FastifyReply
): Promise<void> {
  const method = request.method.toUpperCase();
  const isStateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  if (!isStateChanging) {
    return;
  }

  // Only cookie-authenticated sessions require Anti-CSRF token verification
  if (request.customerAuthSource !== 'cookie') {
    return;
  }

  const session = request.customerSession;
  if (!session || !session.id || !session.tokenHash) {
    throw new UnauthorizedError('Authentication required before CSRF validation');
  }

  const headerVal = (
    request.headers[CSRF_HEADER_NAME] ||
    request.headers['x-zdex-csrf-token'] ||
    request.headers['X-Zdex-Csrf-Token']
  ) as string | undefined;

  if (!headerVal || typeof headerVal !== 'string' || headerVal.trim().length === 0) {
    throw new ForbiddenError('CSRF validation failed: missing x-zdex-csrf-token header');
  }

  const isValid = validateCsrfToken(headerVal.trim(), {
    id: session.id,
    tokenHash: session.tokenHash
  });

  if (!isValid) {
    throw new ForbiddenError('CSRF validation failed: invalid or mismatched CSRF token');
  }
}
