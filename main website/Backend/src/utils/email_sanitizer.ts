/**
 * ZDEXCLOUD EMAIL SECURITY & PRIVACY SANITIZATION UTILITIES
 * Phase 13.14 Architecture
 *
 * Enforces OWASP-aligned privacy boundaries across outbound email tracking,
 * provider delivery synchronization, operational logging, and administrative inspection.
 *
 * Security Invariants:
 * - ZERO plaintext OTPs, passwords, reset tokens, or API keys are stored or exposed.
 * - Provider responses and metadata payloads are recursively redacted.
 * - Log injection prevention: newlines, carriage returns, and control characters are stripped.
 * - URLs in webhook engagement tracking are stripped of sensitive query parameters.
 */

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /passwd/i,
  /pass/i,
  /secret/i,
  /client_?secret/i,
  /webhook_?secret/i,
  /token/i,
  /access_?token/i,
  /refresh_?token/i,
  /id_?token/i,
  /session_?token/i,
  /jwt/i,
  /authorization/i,
  /auth/i,
  /cookie/i,
  /set-?cookie/i,
  /api_?key/i,
  /apikey/i,
  /private_?key/i,
  /smtp_?password/i,
  /smtppassword/i,
  /brevo_?api_?key/i,
  /otp/i,
  /otp_?code/i,
  /verification_?code/i,
  /reset_?token/i,
  /session_?id/i,
  /credential/i,
  /credentials/i
];

// Preserved legitimate non-secret operational keys
const ALLOWED_OPERATIONAL_KEYS = new Set([
  'providermessageid',
  'messageid',
  'message-id',
  'message_id',
  'email',
  'subject',
  'event',
  'status',
  'reason',
  'templateid',
  'template_id',
  'requestid',
  'correlationid',
  'deviceid',
  'serverid',
  'attemptcount',
  'attemptnumber',
  'maxattempts',
  'durationms',
  'timestamp',
  'date',
  'ts',
  'ts_event',
  'ts_epoch',
  'tag',
  'link',
  'ip',
  'user_agent',
  'response',
  'accepted',
  'rejected',
  'code',
  'count'
]);

const SENSITIVE_VALUE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9\-_.]+/gi,
  /eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/g, // JWTs
  /(password|passwd|secret|api_?key|token|jwt|smtp_?pass)=["']?[^"'\s&]+["']?/gi,
  /mysql:\/\/[^@\s]+@[^\s/]+/gi,
  /:[^\s@/:]+@/g // Basic auth in URLs
];

const MAX_STRING_LENGTH = 1000;
const MAX_PAYLOAD_DEPTH = 6;

/**
 * Strips any potential 4-8 digit OTP codes or secret strings from email subjects.
 * (e.g. "[ZdexCloud] Your Verification Code: 123456" -> "[ZdexCloud] Your Verification Code: [REDACTED]")
 */
export function sanitizeSubject(subject: string | null | undefined): string {
  if (!subject || typeof subject !== 'string') return '';
  return subject
    .replace(/[\r\n\0]/g, ' ')
    .replace(/(code:\s*)\b\d{4,8}\b/gi, '$1[REDACTED]')
    .replace(/\b\d{6}\b/g, '[REDACTED]')
    .substring(0, 300)
    .trim();
}

/**
 * Strips any sensitive credentials, tokens, or PII from failure reasons.
 * Also strips control characters to prevent log injection.
 */
export function sanitizeFailureReason(raw: string | null | undefined): string {
  if (!raw) return 'Unknown transport error';
  let sanitized = String(raw)
    .replace(/[\r\n\0]/g, ' ')
    .replace(/(password|secret|apikey|api_key|token|jwt|privatekey|smtp_pass)=["']?[^"'\s&]+["']?/gi, '$1=[REDACTED]')
    .replace(/bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/eyJ[a-zA-Z0-9._-]+/gi, '[JWT_REDACTED]');

  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }

  return sanitized.substring(0, 300).trim() || 'Unknown transport error';
}

/**
 * Checks if a key name matches sensitive secret keywords.
 */
export function isSensitiveKey(key: string): boolean {
  if (!key) return false;
  const lower = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (ALLOWED_OPERATIONAL_KEYS.has(lower)) {
    return false;
  }
  return SENSITIVE_KEY_PATTERNS.some(p => p.test(key) || p.test(lower));
}

/**
 * Recursively sanitizes JSON metadata and provider payloads to redact sensitive tokens, credentials, and cookies.
 */
export function sanitizeJsonPayload(payload: any, depth = 0): any {
  if (payload === null || payload === undefined) {
    return payload;
  }

  if (depth > MAX_PAYLOAD_DEPTH) {
    return '[MaxDepthExceeded]';
  }

  if (typeof payload === 'number' || typeof payload === 'boolean') {
    return payload;
  }

  if (typeof payload === 'string') {
    let str = payload;
    for (const pattern of SENSITIVE_VALUE_PATTERNS) {
      str = str.replace(pattern, '[REDACTED]');
    }
    if (str.length > MAX_STRING_LENGTH) {
      return `${str.substring(0, MAX_STRING_LENGTH)}...[Truncated]`;
    }
    return str;
  }

  if (Array.isArray(payload)) {
    return payload.slice(0, 100).map(item => sanitizeJsonPayload(item, depth + 1));
  }

  if (typeof payload === 'object') {
    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (isSensitiveKey(key)) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = sanitizeJsonPayload(value, depth + 1);
      } else if (typeof value === 'string') {
        let strVal = value;
        for (const pattern of SENSITIVE_VALUE_PATTERNS) {
          strVal = strVal.replace(pattern, '[REDACTED]');
        }
        if (strVal.length > MAX_STRING_LENGTH) {
          strVal = `${strVal.substring(0, MAX_STRING_LENGTH)}...[Truncated]`;
        }
        sanitized[key] = strVal;
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  return String(payload);
}

/**
 * Sanitizes URLs captured in click engagement tracking by stripping query parameters
 * that might contain tokens, codes, or secrets.
 */
export function sanitizeEngagementUrl(rawUrl: string | null | undefined): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  try {
    const parsed = new URL(rawUrl);
    const sensitiveParams = ['token', 'code', 'otp', 'secret', 'key', 'auth', 'jwt', 'reset'];
    for (const param of Array.from(parsed.searchParams.keys())) {
      if (sensitiveParams.some(s => param.toLowerCase().includes(s))) {
        parsed.searchParams.set(param, '[REDACTED]');
      }
    }
    return parsed.toString().substring(0, 500);
  } catch {
    // If not a valid absolute URL, sanitize as a string
    return rawUrl
      .replace(/(token|code|otp|secret|key)=[^&\s]+/gi, '$1=[REDACTED]')
      .replace(/[\r\n\0]/g, '')
      .substring(0, 500);
  }
}

/**
 * Sanitizes strings for safe inclusion in operational logs.
 * Strips \r, \n, null bytes, control characters, and secret patterns.
 */
export function sanitizeLogString(raw: string | null | undefined, maxLength = 255): string {
  if (!raw || typeof raw !== 'string') return '';
  let sanitized = raw
    .replace(/[\r\n\t\0\x08\x0B\x0C]/g, ' ')
    .replace(/(password|secret|apikey|api_key|token|jwt)=["']?[^"'\s&]+["']?/gi, '$1=[REDACTED]')
    .replace(/bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/eyJ[a-zA-Z0-9._-]+/gi, '[JWT_REDACTED]');

  return sanitized.substring(0, maxLength).trim();
}

/**
 * Validates and sanitizes diagnostic request/correlation/provider IDs.
 * Rejects values containing secret tokens or exceeding length limits.
 */
export function sanitizeTrackingId(rawId: string | null | undefined, maxLength = 128): string | null {
  if (!rawId || typeof rawId !== 'string') return null;
  const trimmed = rawId.trim().replace(/[\r\n\0]/g, '');
  if (!trimmed || trimmed.length > maxLength) return null;
  if (/bearer|eyj/i.test(trimmed)) return null; // Reject token-like strings
  return trimmed;
}
