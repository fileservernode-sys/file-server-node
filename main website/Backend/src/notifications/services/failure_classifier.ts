/**
 * RemoteNode Centralized Provider Failure Classifier
 * Track 4 — Batch NT-1.6 Architecture
 */

export type ProviderFailureCategory =
  | 'PERMANENT_FAILURE'
  | 'TEMPORARY_FAILURE'
  | 'RATE_LIMITED'
  | 'AUTHENTICATION_FAILURE'
  | 'PROVIDER_UNAVAILABLE'
  | 'INVALID_RECIPIENT'
  | 'INVALID_TOKEN'
  | 'NETWORK_TIMEOUT'
  | 'DATABASE_FAILURE'
  | 'UNKNOWN_FAILURE';

export interface FailureClassificationResult {
  category: ProviderFailureCategory;
  retryable: boolean;
  recommendedDelayMs: number;
  providerResponseCode: string | null;
  safePublicReason: string;
  internalDiagnosticReason: string;
}

export class ProviderFailureClassifier {
  /**
   * Sanitizes error message string by masking secrets, tokens, passwords, JWTs, keys, and authorization headers.
   */
  public sanitizeErrorMessage(rawError: string | null | undefined): string {
    if (!rawError) return 'Unknown delivery error';

    let sanitized = String(rawError);

    // Filter out passwords, secret keys, FCM tokens, Bearer tokens, and JWTs
    sanitized = sanitized.replace(/(password|secret|apikey|api_key|token|privatekey)=["']?[^"'\s]+["']?/gi, '$1=[REDACTED]');
    sanitized = sanitized.replace(/bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [REDACTED]');
    sanitized = sanitized.replace(/eyJ[a-zA-Z0-9._-]+/gi, '[JWT_REDACTED]');

    return sanitized.substring(0, 300);
  }

  public classify(errorMessage: string | null | undefined, rawResponseCode?: string | number): FailureClassificationResult {
    const safeError = this.sanitizeErrorMessage(errorMessage);
    const codeStr = rawResponseCode ? String(rawResponseCode) : null;

    // 1. Invalid Token / Unregistered Device
    if (
      /INVALID_TOKEN/i.test(safeError) ||
      /unregistered/i.test(safeError) ||
      /registration-token/i.test(safeError) ||
      /invalid push token/i.test(safeError) ||
      /not_found/i.test(safeError) ||
      codeStr === 'messaging/registration-token-not-registered'
    ) {
      return {
        category: 'INVALID_TOKEN',
        retryable: false,
        recommendedDelayMs: 0,
        providerResponseCode: codeStr || 'INVALID_TOKEN',
        safePublicReason: 'Target device token is invalid or uninstalled',
        internalDiagnosticReason: safeError
      };
    }

    // 2. Invalid Recipient / Rejected Address
    if (
      /invalid recipient/i.test(safeError) ||
      /invalid email/i.test(safeError) ||
      /user not found/i.test(safeError) ||
      /recipient rejected/i.test(safeError) ||
      /INVALID_ADDRESS/i.test(safeError)
    ) {
      return {
        category: 'INVALID_RECIPIENT',
        retryable: false,
        recommendedDelayMs: 0,
        providerResponseCode: codeStr || 'INVALID_RECIPIENT',
        safePublicReason: 'Target recipient email address is invalid',
        internalDiagnosticReason: safeError
      };
    }

    // 3. Provider Rate Limited
    if (
      /rate limit/i.test(safeError) ||
      /too many requests/i.test(safeError) ||
      /quota exceeded/i.test(safeError) ||
      codeStr === '429'
    ) {
      return {
        category: 'RATE_LIMITED',
        retryable: true,
        recommendedDelayMs: 120000, // 2 mins backoff
        providerResponseCode: codeStr || '429',
        safePublicReason: 'Provider rate limit encountered',
        internalDiagnosticReason: safeError
      };
    }

    // 4. Provider Authentication Failure
    if (
      /auth failure/i.test(safeError) ||
      /invalid credentials/i.test(safeError) ||
      /unauthorized/i.test(safeError) ||
      codeStr === '401' ||
      codeStr === '403'
    ) {
      return {
        category: 'AUTHENTICATION_FAILURE',
        retryable: false,
        recommendedDelayMs: 0,
        providerResponseCode: codeStr || '401',
        safePublicReason: 'Provider authentication configuration error',
        internalDiagnosticReason: safeError
      };
    }

    // 5. Network / Provider Timeout
    if (
      /timeout/i.test(safeError) ||
      /etimedout/i.test(safeError) ||
      /econnreset/i.test(safeError) ||
      /network error/i.test(safeError) ||
      /aborted/i.test(safeError)
    ) {
      return {
        category: 'NETWORK_TIMEOUT',
        retryable: true,
        recommendedDelayMs: 30000,
        providerResponseCode: codeStr || 'TIMEOUT',
        safePublicReason: 'Network connection to provider timed out',
        internalDiagnosticReason: safeError
      };
    }

    // 6. Provider Service Unavailable
    if (
      /service unavailable/i.test(safeError) ||
      /503/i.test(safeError) ||
      /502/i.test(safeError) ||
      /504/i.test(safeError) ||
      /circuit open/i.test(safeError)
    ) {
      return {
        category: 'PROVIDER_UNAVAILABLE',
        retryable: true,
        recommendedDelayMs: 60000,
        providerResponseCode: codeStr || '503',
        safePublicReason: 'Transport provider service temporarily unavailable',
        internalDiagnosticReason: safeError
      };
    }

    // 7. Database Failure
    if (
      /prisma/i.test(safeError) ||
      /database/i.test(safeError) ||
      /foreign key/i.test(safeError) ||
      /connection refused/i.test(safeError)
    ) {
      return {
        category: 'DATABASE_FAILURE',
        retryable: true,
        recommendedDelayMs: 15000,
        providerResponseCode: codeStr || 'DB_ERR',
        safePublicReason: 'Internal database constraint or connectivity error',
        internalDiagnosticReason: safeError
      };
    }

    // 8. Explicit Permanent Failure
    if (/PERMANENT_FAILURE/i.test(safeError)) {
      return {
        category: 'PERMANENT_FAILURE',
        retryable: false,
        recommendedDelayMs: 0,
        providerResponseCode: codeStr || 'PERMANENT_FAILURE',
        safePublicReason: 'Permanent delivery failure',
        internalDiagnosticReason: safeError
      };
    }

    // Default: Temporary Failure
    return {
      category: 'TEMPORARY_FAILURE',
      retryable: true,
      recommendedDelayMs: 60000,
      providerResponseCode: codeStr || 'TEMPORARY_FAILURE',
      safePublicReason: 'Temporary transport delivery error',
      internalDiagnosticReason: safeError
    };
  }
}

export const failureClassifier = new ProviderFailureClassifier();
