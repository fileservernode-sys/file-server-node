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
 * Verifies a plaintext password against a stored salt:hash string
 */
export function verifyPassword(password: string, storedHash: string | null | undefined): boolean {
  if (!storedHash || !storedHash.includes(':')) return false;

  const [salt, originalHash] = storedHash.split(':');
  if (!salt || !originalHash) return false;

  try {
    const candidateHash = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(candidateHash, 'hex'), Buffer.from(originalHash, 'hex'));
  } catch {
    return false;
  }
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
  if (!storedRepresentation) return false;

  const cleanCandidate = candidateOtp.trim();

  // If stored representation is salt:hash
  if (storedRepresentation.includes(':')) {
    const [salt, originalHash] = storedRepresentation.split(':');
    if (!salt || !originalHash) return false;
    const candidateHash = crypto.createHmac('sha256', salt).update(cleanCandidate).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(candidateHash, 'hex'), Buffer.from(originalHash, 'hex'));
  }

  // Plaintext fallback comparison using timingSafeEqual
  const a = Buffer.from(cleanCandidate);
  const b = Buffer.from(storedRepresentation.trim());
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
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
