import { AppError } from '../../../../errors/app-error.js';

export type RazorpayErrorCode =
  | 'NOT_CONFIGURED'
  | 'PARTIAL_CONFIG'
  | 'WEBHOOK_SECRET_MISSING'
  | 'AUTH_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT_ERROR'
  | 'API_ERROR'
  | 'INVALID_RESPONSE'
  | 'INVALID_SIGNATURE'
  | 'MAPPING_CONFLICT'
  | 'RESPONSE_MISMATCH'
  | 'CATALOG_INCOMPLETE'
  | 'VALIDATION_ERROR';

/**
 * Sanitized, provider-specific error class for Razorpay operations.
 * Extends AppError for seamless operational error handling in Fastify.
 * Guarantees zero credential leakage in error messages and stack traces.
 */
export class RazorpayProviderError extends AppError {
  public readonly code: RazorpayErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: RazorpayErrorCode,
    message: string,
    options?: { statusCode?: number; details?: Record<string, unknown> }
  ) {
    // Sanitize message to strip any inadvertent Basic auth or secret tokens
    const sanitizedMessage = RazorpayProviderError.sanitize(message);
    const resolvedStatusCode = options?.statusCode || (
      code === 'VALIDATION_ERROR' ? 400 :
      code === 'AUTH_ERROR' ? 502 :
      code === 'API_ERROR' ? 502 :
      code === 'NETWORK_ERROR' ? 502 :
      code === 'TIMEOUT_ERROR' ? 504 :
      code === 'INVALID_RESPONSE' ? 502 :
      code === 'RESPONSE_MISMATCH' ? 502 :
      code === 'CATALOG_INCOMPLETE' ? 500 :
      code === 'MAPPING_CONFLICT' ? 500 :
      500
    );
    super(sanitizedMessage, resolvedStatusCode, code);
    this.name = 'RazorpayProviderError';
    this.code = code;
    this.details = options?.details ? RazorpayProviderError.sanitizeDetails(options.details) : undefined;
    Object.setPrototypeOf(this, RazorpayProviderError.prototype);
  }

  /**
   * Sanitizes sensitive credentials, Authorization headers, and secrets from error strings.
   */
  public static sanitize(input: string): string {
    if (!input) return '';
    return input
      .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, 'Basic [REDACTED]')
      .replace(/rzp_(test|live)_[a-zA-Z0-9]+/gi, 'rzp_$1_[REDACTED]')
      .replace(/(secret|key_secret|webhook_secret)=[^&\s]+/gi, '$1=[REDACTED]');
  }

  public static sanitizeDetails(details: Record<string, unknown>): Record<string, unknown> {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(details)) {
      if (typeof v === 'string') {
        clean[k] = RazorpayProviderError.sanitize(v);
      } else if (typeof v === 'object' && v !== null) {
        clean[k] = '[OBJECT]';
      } else {
        clean[k] = v;
      }
    }
    return clean;
  }
}
