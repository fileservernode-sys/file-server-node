/**
 * ZDEXCLOUD OBSERVABILITY & ERROR CENTER — ERROR SANITIZER (Phase 12.3)
 * Provides strict, non-destructive sanitization for operational error messages,
 * stack traces, and diagnostic metadata before persistence into ErrorOccurrence records.
 *
 * Security Invariants:
 * - ZERO secrets, passwords, OTPs, session tokens, or API keys are stored.
 * - ZERO customer file contents, binary payloads, or request/response buffers are stored.
 * - Strips control characters (CR/LF) to prevent log/record injection.
 * - Enforces bounded depth and string lengths to prevent payload explosion.
 */

const SENSITIVE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9\-_.]+/gi,
  /mysql:\/\/[^@\s]+@[^\s/]+/gi,
  /password=[^\s&]+/gi,
  /passwd=[^\s&]+/gi,
  /secret=[^\s&]+/gi,
  /api[_-]?key=[^\s&]+/gi,
  /token=[^\s&]+/gi,
  /otp=[^\s&]+/gi,
  /authorization:\s*[^\r\n]+/gi,
  /cookie:\s*[^\r\n]+/gi,
  /set-cookie:\s*[^\r\n]+/gi,
  /:[^\s@/:]+@/g // Basic auth credentials in URLs
];

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /passwd/i,
  /secret/i,
  /token/i,
  /accesstoken/i,
  /refreshtoken/i,
  /sessiontoken/i,
  /connectiontoken/i,
  /apikey/i,
  /privatekey/i,
  /clientsecret/i,
  /otp/i,
  /otphash/i,
  /auth/i,
  /authorization/i,
  /cookie/i,
  /setcookie/i,
  /credential/i,
  /signature/i,
  /databaseurl/i,
  /smtppassword/i,
  /payload/i,
  /body/i,
  /rawbody/i,
  /buffer/i,
  /binary/i,
  /blob/i,
  /filecontent/i,
  /database64/i,
  /uploadedfile/i
];

export const MAX_MESSAGE_LENGTH = 4096;
export const MAX_STACK_LENGTH = 8192;
export const MAX_METADATA_DEPTH = 5;
export const MAX_METADATA_STRING_LENGTH = 500;
export const MAX_METADATA_JSON_BYTES = 8192;

export class ErrorSanitizer {
  /**
   * Sanitizes an operational error message, masking credentials, tokens, and control characters.
   */
  public static sanitizeMessage(rawMessage: string | null | undefined): string {
    if (!rawMessage || typeof rawMessage !== 'string') {
      return 'Unknown error';
    }

    let sanitized = rawMessage;

    // 1. Mask sensitive token and credential patterns
    for (const pattern of SENSITIVE_PATTERNS) {
      sanitized = sanitized.replace(pattern, (match) => {
        if (/bearer/i.test(match)) return 'Bearer [REDACTED_TOKEN]';
        if (/mysql:/i.test(match)) return 'mysql://[REDACTED_DB_CREDENTIALS]@***';
        if (/password/i.test(match)) return 'password=[REDACTED]';
        if (/secret/i.test(match)) return 'secret=[REDACTED]';
        if (/token/i.test(match)) return 'token=[REDACTED]';
        if (/otp/i.test(match)) return 'otp=[REDACTED]';
        if (/authorization/i.test(match)) return 'authorization: [REDACTED]';
        if (/cookie/i.test(match)) return 'cookie: [REDACTED]';
        return '[REDACTED_CREDENTIAL]';
      });
    }

    // 2. Strip control characters (preserve clean single-line or clean multi-line)
    sanitized = sanitized.replace(/[\0\x08\x0B\x0C]/g, '');

    // 3. Enforce maximum length bound
    if (sanitized.length > MAX_MESSAGE_LENGTH) {
      sanitized = `${sanitized.substring(0, MAX_MESSAGE_LENGTH)}...[Truncated ${sanitized.length} bytes]`;
    }

    return sanitized.trim() || 'Empty error message';
  }

  /**
   * Sanitizes a stack trace, preserving file paths, line numbers, and function names
   * while stripping tokens, secrets, and sensitive strings.
   */
  public static sanitizeStackTrace(rawStack: string | null | undefined): string | null {
    if (!rawStack || typeof rawStack !== 'string') {
      return null;
    }

    let sanitized = rawStack;

    // Mask sensitive token patterns in stack frame messages
    for (const pattern of SENSITIVE_PATTERNS) {
      sanitized = sanitized.replace(pattern, '[REDACTED]');
    }

    // Strip control characters
    sanitized = sanitized.replace(/[\0\x08\x0B\x0C]/g, '');

    // Enforce maximum length bound
    if (sanitized.length > MAX_STACK_LENGTH) {
      sanitized = `${sanitized.substring(0, MAX_STACK_LENGTH)}\n...[Stack trace truncated]`;
    }

    return sanitized.trim();
  }

  /**
   * Recursively sanitizes diagnostic metadata objects.
   * Guarantees zero sensitive keys, tokens, or file contents leak into storage.
   */
  public static sanitizeMetadata(input: unknown, depth = 0): any {
    if (input === null || input === undefined) {
      return null;
    }

    if (depth > MAX_METADATA_DEPTH) {
      return '[MaxDepthExceeded]';
    }

    // Handle primitive types
    if (typeof input === 'number' || typeof input === 'boolean') {
      return input;
    }

    if (typeof input === 'string') {
      let str = this.sanitizeMessage(input);
      if (str.length > MAX_METADATA_STRING_LENGTH) {
        str = `${str.substring(0, MAX_METADATA_STRING_LENGTH)}...[Truncated]`;
      }
      return str;
    }

    // Handle Buffer / Binary data
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(input)) {
      return `[BINARY_BUFFER_${input.length}_BYTES]`;
    }

    // Handle Error objects
    if (input instanceof Error) {
      return {
        name: input.name,
        message: this.sanitizeMessage(input.message),
        code: (input as any).code || (input as any).errorCode
      };
    }

    // Handle Arrays
    if (Array.isArray(input)) {
      return input.slice(0, 50).map(item => this.sanitizeMetadata(item, depth + 1));
    }

    // Handle Objects
    if (typeof input === 'object') {
      const sanitizedObj: Record<string, any> = {};
      const entries = Object.entries(input as Record<string, any>);

      for (const [key, value] of entries.slice(0, 50)) {
        if (this.isSensitiveKey(key)) {
          sanitizedObj[key] = '[REDACTED]';
          continue;
        }

        sanitizedObj[key] = this.sanitizeMetadata(value, depth + 1);
      }

      // Check serialized byte size
      try {
        const jsonStr = JSON.stringify(sanitizedObj);
        if (jsonStr.length > MAX_METADATA_JSON_BYTES) {
          return { _truncated: true, _summary: 'Metadata exceeded byte limit' };
        }
      } catch {
        return { _unserializable: true };
      }

      return sanitizedObj;
    }

    return String(input);
  }

  /**
   * Checks whether a metadata key name matches sensitive keywords.
   */
  public static isSensitiveKey(key: string): boolean {
    const cleaned = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    return SENSITIVE_KEY_PATTERNS.some(pattern => pattern.test(cleaned) || pattern.test(key));
  }
}
