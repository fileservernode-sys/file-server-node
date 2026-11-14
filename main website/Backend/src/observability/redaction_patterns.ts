/**
 * ZDEXCLOUD SHARED PRIVACY & REDACTION PATTERNS (Phase 20.6.2)
 *
 * Single source of truth for key-level and string-level redaction across:
 * - StructuredLogger (logger.ts)
 * - AdminAuditSanitizer (admin_audit_sanitizer.ts)
 * - ErrorSanitizer (error_sanitizer.ts)
 *
 * Design Invariants:
 * - Redacts WebRTC negotiation payloads (SDP offers/answers, ICE candidates/ufrags/pwds),
 *   Camera & platform tokens (cvt_, dst_, pct_, zdc_, sess_), CSRF/device/admin headers,
 *   cookies, passwords, OTPs, and DB credentials.
 * - Preserves non-secret identifiers such as adminId, actorId, userId, deviceId, and cameraId.
 */

/**
 * Additional sensitive metadata key patterns shared across all sanitizers.
 * Matched against BOTH raw key names and normalized lowercase alphanumeric keys.
 */
export const WEBRTC_AND_CAMERA_KEY_PATTERNS: readonly RegExp[] = [
  /^(?:local|remote|webrtc)?sdp(?:offer|answer|mid|mlineindex|type|payload|description)?$/i,
  /^ice(?:candidate|candidates|servers?|ufrag|pwd)?$/i,
  /^candidates?$/i,
  /^(?:webrtc)?(?:offer|answer)$/i,
  /^(?:local|remote)description$/i,
  /csrf/i,
  /passcode/i,
  /pairingcode/i,
  /viewingtoken/i,
  /pairingchallengetoken/i,
  /connectiontoken/i,
  /sessiontokenhash/i,
  /credentialhash/i,
  /devicecredential/i
];

/**
 * Normalizes a metadata key to lowercase alphanumeric form for delimiter-insensitive matching.
 */
export function normalizeKeyForRedaction(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Evaluates a key against a caller's base patterns plus shared Camera/WebRTC/CSRF patterns
 * without colliding with non-secret identifiers (e.g. `deviceId` never matches `ice`).
 */
export function matchesSensitiveKeyPattern(
  key: string,
  basePatterns: readonly RegExp[]
): boolean {
  if (!key || typeof key !== 'string') return false;
  const normalized = normalizeKeyForRedaction(key);
  return (
    basePatterns.some((pattern) => pattern.test(normalized) || pattern.test(key)) ||
    WEBRTC_AND_CAMERA_KEY_PATTERNS.some((pattern) => pattern.test(normalized) || pattern.test(key))
  );
}

/**
 * Scrubs embedded tokens, cookies, CSRF/device/admin headers, credentials, DB DSNs,
 * and WebRTC SDP/ICE strings from freeform log/audit/error messages.
 */
export function scrubSensitiveEmbeddedStrings(input: string): string {
  if (!input || typeof input !== 'string') return '';

  return input
    // Authorization / Bearer tokens
    .replace(/Bearer\s+[A-Za-z0-9\-_.]+/gi, 'Bearer [REDACTED_TOKEN]')
    // Session cookies
    .replace(/__Host-zdex_session=[^\s;]+/gi, '__Host-zdex_session=[REDACTED_COOKIE]')
    .replace(/__Host-zdex_admin_session=[^\s;]+/gi, '__Host-zdex_admin_session=[REDACTED_COOKIE]')
    // CSRF, device credential, viewing token, admin session, cookie, and authorization headers
    .replace(/(x-zdex-csrf-token:\s*)[^\r\n ]+/gi, 'x-zdex-csrf-token: [REDACTED_CSRF]')
    .replace(/(x-zdex-admin-csrf-token:\s*)[^\r\n ]+/gi, 'x-zdex-admin-csrf-token: [REDACTED_CSRF]')
    .replace(/(x-device-credential:\s*)[^\r\n ]+/gi, '$1[REDACTED_CREDENTIAL]')
    .replace(/(x-viewing-token:\s*)[^\r\n ]+/gi, '$1[REDACTED_TOKEN]')
    .replace(/(x-admin-session:\s*)[^\r\n ]+/gi, '$1[REDACTED_TOKEN]')
    .replace(/(x-api-key:\s*)[^\r\n ]+/gi, '$1[REDACTED_KEY]')
    .replace(/((?:set-)?cookie:\s*)[^\r\n]+/gi, '$1[REDACTED]')
    .replace(/(authorization:\s*)[^\r\n]+/gi, '$1[REDACTED]')
    // URL query secrets & camera tokens
    .replace(
      /([?&](?:token|accessToken|sessionToken|authToken|connectionToken|viewingToken|pairingChallengeToken|deviceCredential|secret|key|apiKey|password|otp|csrf|signature)=)[^&\s]+/gi,
      '$1[REDACTED_URL_TOKEN]'
    )
    // Database / scheme credentials
    .replace(/mysql:\/\/[^@\s]+@[^\s/]+/gi, 'mysql://[REDACTED_DB_CREDENTIALS]@***')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^:\s@/]+:[^@\s/]+@/gi, '$1[REDACTED_CREDENTIALS]@')
    // Key=value secret fragments
    .replace(
      /((?:password|passwd|otp|secret|credential|api[_-]?key|viewingToken|pairingChallengeToken|connectionToken|sessionTokenHash|credentialHash)=)[^&\s]+/gi,
      '$1[REDACTED]'
    )
    // ZdexCloud internal token prefixes (Camera viewing, device auth, pairing challenge, zdc, sess)
    .replace(/\b(?:cvt|dst|pct|zdc|sess)_[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_TOKEN]')
    // Embedded WebRTC SDP blobs & attributes (both multi-line and single-line collapsed)
    .replace(/\bv=0[\r\n ]+o=[^\r\n]{0,1024}/gi, '[REDACTED_SDP]')
    .replace(/\ba=(?:ice-pwd|ice-ufrag|fingerprint):[^\s\r\n]+/gi, 'a=[REDACTED_WEBRTC_ATTR]')
    // Embedded WebRTC ICE candidates
    .replace(/\bcandidate:[A-Za-z0-9+/=:_.-]+\s+\d+\s+(?:udp|tcp)\s+\d+\s+[^\r\n;]{0,200}/gi, '[REDACTED_ICE_CANDIDATE]');
}
