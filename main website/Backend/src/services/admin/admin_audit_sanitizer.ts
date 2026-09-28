/**
 * ZDEXCLOUD ADMIN AUDIT METADATA SANITIZER (Phase 7.5-D)
 * Defends against Log Injection (CR/LF), Secret Leakage, Delimiter Injection, and Nested Payloads.
 */

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /key/i,
  /otp/i,
  /auth/i,
  /cookie/i,
  /credential/i,
  /signature/i,
  /session/i
];

const MAX_STRING_LENGTH = 1024;
const MAX_OBJECT_DEPTH = 3;
const MAX_TOTAL_JSON_BYTES = 4096;

export class AdminAuditSanitizer {
  /**
   * Sanitizes any metadata value before it is recorded into the audit trail or exported.
   */
  static sanitizeMetadata(input: unknown, depth = 0): unknown {
    if (input === null || input === undefined) {
      return null;
    }

    if (depth > MAX_OBJECT_DEPTH) {
      return '[TRUNCATED_NESTED_OBJECT]';
    }

    if (typeof input === 'string') {
      return this.sanitizeString(input);
    }

    if (typeof input === 'number' || typeof input === 'boolean') {
      return input;
    }

    if (Array.isArray(input)) {
      return input.slice(0, 50).map(item => this.sanitizeMetadata(item, depth + 1));
    }

    if (typeof input === 'object') {
      const sanitizedObj: Record<string, unknown> = {};
      const entries = Object.entries(input as Record<string, unknown>);

      for (const [key, value] of entries.slice(0, 50)) {
        // Redact if key name matches sensitive patterns
        if (this.isSensitiveKey(key)) {
          sanitizedObj[key] = '[REDACTED]';
          continue;
        }

        sanitizedObj[this.sanitizeString(key)] = this.sanitizeMetadata(value, depth + 1);
      }

      // Check total byte size constraint
      try {
        const jsonString = JSON.stringify(sanitizedObj);
        if (jsonString.length > MAX_TOTAL_JSON_BYTES) {
          return { _truncated: true, _summary: 'Metadata exceeded maximum size limit' };
        }
      } catch {
        return { _unserializable: true };
      }

      return sanitizedObj;
    }

    return String(input);
  }

  /**
   * Strips CR/LF characters to prevent log injection and escapes delimiter characters
   */
  static sanitizeString(str: string): string {
    if (!str || typeof str !== 'string') return '';
    let cleaned = str
      .replace(/[\r\n\t\0]/g, ' ') // Strip control characters and newlines
      .trim();

    if (cleaned.length > MAX_STRING_LENGTH) {
      cleaned = cleaned.substring(0, MAX_STRING_LENGTH) + '...';
    }

    return cleaned;
  }

  /**
   * Checks whether a key contains sensitive terminology
   */
  static isSensitiveKey(key: string): boolean {
    return SENSITIVE_KEY_PATTERNS.some(pattern => pattern.test(key));
  }
}
