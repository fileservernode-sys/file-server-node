import crypto from 'node:crypto';

/**
 * Hashes a plaintext password using native crypto.scryptSync with a salt
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Verifies a plaintext password against a stored salt:hash string.
 * Supports standard scrypt `${salt}:${hash}` representation and provides safe backwards
 * compatibility for any legacy 64-character SHA-256 hex hashes.
 */
export function verifyPassword(password: string, storedHash: string | null | undefined): boolean {
  if (!storedHash || typeof storedHash !== 'string') return false;

  // Standard scrypt format: salt:hash
  if (storedHash.includes(':')) {
    const [salt, originalHash] = storedHash.split(':');
    if (!salt || !originalHash) return false;

    try {
      const candidateHash = crypto.scryptSync(password, salt, 64).toString('hex');
      const a = Buffer.from(candidateHash, 'hex');
      const b = Buffer.from(originalHash, 'hex');
      if (a.length !== b.length) return false;
      return crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  // Legacy SHA-256 fallback compatibility (e.g. 64-character hex string)
  if (storedHash.length === 64 && /^[0-9a-fA-F]{64}$/.test(storedHash)) {
    try {
      const shaHash = crypto.createHash('sha256').update(password).digest('hex');
      const a = Buffer.from(shaHash, 'hex');
      const b = Buffer.from(storedHash, 'hex');
      if (a.length !== b.length) return false;
      return crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Hashes a 6-digit OTP code using SHA-256 with a salt for secure storage
 */
export function hashOtp(otp: string): string {
  const salt = crypto.randomBytes(8).toString('hex');
  const hash = crypto.createHmac('sha256', salt).update(otp.trim()).digest('hex');
  return `${salt}:${hash}`;
}

/**
 * Timing-safely verifies a candidate 6-digit OTP against stored OTP representation
 */
export function verifyOtpCode(candidateOtp: string, storedRepresentation: string): boolean {
  if (!storedRepresentation || storedRepresentation.startsWith('pwdchg:')) return false;

  const cleanCandidate = candidateOtp.trim();

  // If stored representation is salt:hash
  if (storedRepresentation.includes(':')) {
    const [salt, originalHash] = storedRepresentation.split(':');
    if (!salt || !originalHash) return false;
    try {
      const candidateHash = crypto.createHmac('sha256', salt).update(cleanCandidate).digest('hex');
      return crypto.timingSafeEqual(Buffer.from(candidateHash, 'hex'), Buffer.from(originalHash, 'hex'));
    } catch {
      return false;
    }
  }

  // Plaintext fallback comparison using timingSafeEqual
  const a = Buffer.from(cleanCandidate);
  const b = Buffer.from(storedRepresentation.trim());
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Hashes a 6-digit OTP code bound strictly to the authenticated password-change operation and userId.
 * Stored representation format: pwdchg:<userId>:<salt>:<hmac>
 */
export function hashPasswordChangeOtp(userId: string, otp: string): string {
  const cleanUserId = userId.trim();
  const cleanOtp = otp.trim();
  const salt = crypto.randomBytes(8).toString('hex');
  const hash = crypto
    .createHmac('sha256', salt)
    .update(`PASSWORD_CHANGE:${cleanUserId}:${cleanOtp}`)
    .digest('hex');
  return `pwdchg:${cleanUserId}:${salt}:${hash}`;
}

/**
 * Timing-safely verifies a candidate 6-digit OTP against an operation-bound password-change OTP representation.
 */
export function verifyPasswordChangeOtpCode(
  userId: string,
  candidateOtp: string,
  storedRepresentation: string
): boolean {
  if (!userId || !candidateOtp || !storedRepresentation) return false;
  if (!storedRepresentation.startsWith('pwdchg:')) return false;

  const parts = storedRepresentation.split(':');
  if (parts.length !== 4) return false;

  const [prefix, storedUserId, salt, originalHash] = parts;
  const cleanUserId = userId.trim();
  if (prefix !== 'pwdchg' || !storedUserId || storedUserId !== cleanUserId || !salt || !originalHash) {
    return false;
  }

  try {
    const cleanCandidate = candidateOtp.trim();
    const candidateHash = crypto
      .createHmac('sha256', salt)
      .update(`PASSWORD_CHANGE:${cleanUserId}:${cleanCandidate}`)
      .digest('hex');
    const a = Buffer.from(candidateHash, 'hex');
    const b = Buffer.from(originalHash, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Generates a secure random 64-character hex session token
 */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generates a cryptographically secure random 6-digit numeric OTP code (e.g. "849201")
 */
export function generateOtpCode(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

/**
 * Computes SHA-256 hash of a session token for secure database persistence
 */
export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}
