import crypto from 'node:crypto';

/**
 * ZDEXCLOUD OBSERVABILITY & ERROR CENTER — ERROR NORMALIZER & FINGERPRINTER (Phase 12.3)
 * Produces deterministic, stable fingerprints for operational errors by stripping
 * volatile runtime values (UUIDs, CUIDs, timestamps, session IDs, memory addresses)
 * while preserving distinct error types, codes, components, and root-cause signatures.
 */

export interface CanonicalFingerprintInput {
  component: string;
  errorCode: string;
  errorType: string;
  normalizedMessage: string;
  stackSignature: string;
  httpStatus: number | null;
}

export class ErrorNormalizer {
  /**
   * Normalizes volatile runtime values in error messages.
   * Preserves semantic error codes, HTTP status codes, and distinct failure reasons.
   */
  public static normalizeMessage(message: string): string {
    if (!message || typeof message !== 'string') {
      return 'unknown_error';
    }

    let normalized = message;

    // 1. Normalize UUIDs (e.g. 550e8400-e29b-41d4-a716-446655440000)
    normalized = normalized.replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, '<UUID>');

    // 2. Normalize CUIDs (e.g. cmuo6sqt200kk6jb88k58m8fz)
    normalized = normalized.replace(/\bc[a-z0-9]{24}\b/g, '<CUID>');

    // 3. Normalize ISO Timestamps (e.g. 2026-09-30T16:24:03.123Z)
    normalized = normalized.replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?\b/g, '<TIMESTAMP>');

    // 4. Normalize Request IDs (e.g. http-req-6gg4nw, req-11234)
    normalized = normalized.replace(/\b(?:http-)?req-[a-zA-Z0-9_-]{4,32}\b/g, '<REQ_ID>');

    // 5. Normalize Hex Memory Addresses / Hashes (e.g. 0x7ffd23a0, 64-char sha256)
    normalized = normalized.replace(/\b0x[0-9a-fA-F]{4,16}\b/g, '<MEM_ADDR>');
    normalized = normalized.replace(/\b[0-9a-fA-F]{32,64}\b/g, '<HEX_HASH>');

    // 6. Normalize Dynamic Customer Subdomains (e.g. node-6gg4nw.zdexcloud.com)
    normalized = normalized.replace(/node-[a-z0-9]{5,12}\.zdexcloud\.com/gi, 'node-<SLUG>.zdexcloud.com');
    normalized = normalized.replace(/node-[a-z0-9]{5,12}\.viewduration\.com/gi, 'node-<SLUG>.zdexcloud.com');

    // 7. Normalize Ephemeral Network Ports (e.g. 127.0.0.1:54321 -> 127.0.0.1:<PORT>)
    normalized = normalized.replace(/(:\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):\d{4,5}\b/g, '$1:<PORT>');

    // 8. Collapse whitespace and trim
    normalized = normalized.replace(/\s+/g, ' ').trim();

    return normalized || 'empty_message';
  }

  /**
   * Extracts a stable, normalized stack signature from a raw or sanitized stack trace.
   * Strips volatile deployment absolute paths, column numbers, and keeps the top frame call signatures.
   */
  public static extractStackSignature(stackTrace: string | null | undefined, maxFrames = 5): string {
    if (!stackTrace || typeof stackTrace !== 'string') {
      return 'no_stack';
    }

    const lines = stackTrace.split('\n');
    const normalizedFrames: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      // Only capture stack frames (starting with 'at ')
      if (!trimmed.startsWith('at ')) {
        continue;
      }

      // Normalize file paths: strip absolute OS prefixes
      let frame = trimmed
        .replace(/\\/g, '/') // Windows backslashes to forward slashes
        .replace(/.*\/Backend\//gi, 'Backend/')
        .replace(/.*\/src\//gi, 'src/')
        .replace(/.*\/dist\//gi, 'dist/')
        .replace(/.*\/node_modules\//gi, 'node_modules/')
        .replace(/:\d+:\d+\)?$/g, ')'); // Strip line and column numbers for stable grouping

      normalizedFrames.push(frame);

      if (normalizedFrames.length >= maxFrames) {
        break;
      }
    }

    if (normalizedFrames.length === 0) {
      // Fallback: take first line of stack (error header)
      return this.normalizeMessage(lines[0] || 'no_stack');
    }

    return normalizedFrames.join('\n');
  }

  /**
   * Constructs the deterministic canonical SHA-256 fingerprint hash.
   *
   * Algorithm:
   * 1. Collect normalized properties into CanonicalFingerprintInput.
   * 2. Serialize keys in strict lexicographical order.
   * 3. Compute SHA-256 hex digest.
   */
  public static computeFingerprint(input: {
    component: string;
    errorCode?: string | null;
    errorType?: string | null;
    rawMessage: string;
    stackTrace?: string | null;
    httpStatus?: number | null;
  }): { fingerprint: string; normalizedMessage: string; stackSignature: string } {
    const component = (input.component || 'API').toUpperCase().trim();
    const errorCode = (input.errorCode || 'UNKNOWN_ERROR').toUpperCase().trim();
    const errorType = (input.errorType || 'Error').trim();
    const normalizedMessage = this.normalizeMessage(input.rawMessage);
    const stackSignature = this.extractStackSignature(input.stackTrace);
    const httpStatus = typeof input.httpStatus === 'number' ? input.httpStatus : null;

    const canonicalObj: CanonicalFingerprintInput = {
      component,
      errorCode,
      errorType,
      httpStatus,
      normalizedMessage,
      stackSignature
    };

    // Strictly ordered key serialization
    const canonicalJson = JSON.stringify(canonicalObj, Object.keys(canonicalObj).sort());
    const fingerprint = crypto.createHash('sha256').update(canonicalJson, 'utf8').digest('hex');

    return {
      fingerprint,
      normalizedMessage,
      stackSignature
    };
  }
}
