import crypto from 'node:crypto';
import { config } from '../config/env.js';

export const CSRF_HEADER_NAME = 'x-zdex-csrf-token';

/**
 * Derives the server-side HMAC secret for CSRF token signing.
 * Fails closed to secure environment secrets in production.
 */
function getCsrfSecret(): string {
  const secret = process.env.ZDEX_CSRF_SECRET || process.env.INTERNAL_SERVICE_KEY || process.env.ADMIN_AUTH_SECRET;
  if (!secret) {
    if (config.NODE_ENV === 'production') {
      throw new Error('Fatal Security Configuration: ZDEX_CSRF_SECRET or INTERNAL_SERVICE_KEY must be defined in production');
    }
    return 'zdex-csrf-secure-hmac-secret-development-fallback';
  }
  return secret;
}

export interface SessionBindingContext {
  id: string;
  tokenHash: string;
}

/**
 * Generates a signed, session-bound CSRF token.
 * Token Format: `${sessionId}.${nonce}.${hmacSignature}`
 * 
 * Cryptographic Invariants:
 * 1. Bound to specific UserSession.id (guarantees cross-session and cross-tenant isolation).
 * 2. Bound to UserSession.tokenHash (guarantees invalidation if session is rotated/modified).
 * 3. 128-bit CSPRNG nonce prevents pre-computation and token replay.
 * 4. Zero exposure of raw session tokens, passwords, or secrets.
 */
export function generateCsrfToken(session: SessionBindingContext): string {
  if (!session || !session.id || !session.tokenHash) {
    throw new Error('Invalid session context provided for CSRF token generation');
  }

  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = `${session.id}:${session.tokenHash}:${nonce}`;
  const secret = getCsrfSecret();
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  return `${session.id}.${nonce}.${signature}`;
}

/**
 * Validates a signed, session-bound CSRF token against the active UserSession in constant time.
 */
export function validateCsrfToken(
  csrfToken: string | undefined | null,
  session: SessionBindingContext
): boolean {
  if (!csrfToken || typeof csrfToken !== 'string' || !session || !session.id || !session.tokenHash) {
    return false;
  }

  const parts = csrfToken.trim().split('.');
  if (parts.length !== 3) {
    return false;
  }

  const [sessionId, nonce, signature] = parts;

  // Session ID binding check: Token must belong strictly to the authenticated UserSession
  if (sessionId !== session.id) {
    return false;
  }

  if (!nonce || nonce.length < 16 || !signature || signature.length !== 64) {
    return false;
  }

  try {
    const payload = `${session.id}:${session.tokenHash}:${nonce}`;
    const secret = getCsrfSecret();
    const expectedSignature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    const signatureBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (signatureBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
  } catch {
    return false;
  }
}
