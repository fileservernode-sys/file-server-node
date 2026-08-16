import { OtpPurpose } from '@prisma/client';
import { prisma } from '../config/database.js';
import { config } from '../config/env.js';
import { generateOtpCode, hashOtp, verifyOtpCode } from './crypto.js';
import { emailService } from '../services/email.js';

export interface IssueOtpResult {
  otpCode: string;
  expiresAt: Date;
}

export interface VerifyOtpResult {
  valid: boolean;
  error?: 'INVALID_OTP' | 'EXPIRED_OTP' | 'TOO_MANY_ATTEMPTS' | 'NO_ACTIVE_OTP';
  userId?: string;
}

/**
 * Generates a cryptographically secure 6-digit OTP code, persists its secure hash to EmailOtp table,
 * and dispatches email notification using Serverbyt SMTP service.
 * Enforces resend cooldown and invalidates prior unconsumed OTPs.
 */
export async function issueEmailOtp(
  userId: string,
  email: string,
  purpose: OtpPurpose
): Promise<IssueOtpResult> {
  const normalizedEmail = email.trim().toLowerCase();

  // Check Resend Cooldown
  const recentOtp = await prisma.emailOtp.findFirst({
    where: {
      email: normalizedEmail,
      purpose,
      createdAt: { gt: new Date(Date.now() - config.OTP_RESEND_COOLDOWN_SECONDS * 1000) }
    },
    orderBy: { createdAt: 'desc' }
  });

  if (recentOtp && !recentOtp.used) {
    const elapsedSec = Math.floor((Date.now() - recentOtp.createdAt.getTime()) / 1000);
    const remainingSec = Math.max(1, config.OTP_RESEND_COOLDOWN_SECONDS - elapsedSec);
    const error = new Error(`Please wait ${remainingSec} seconds before requesting a new verification code`);
    (error as any).statusCode = 429;
    (error as any).code = 'RESEND_COOLDOWN_ACTIVE';
    throw error;
  }

  // Invalidate previous unused OTPs for this email and purpose
  await prisma.emailOtp.updateMany({
    where: { email: normalizedEmail, purpose, used: false },
    data: { used: true }
  });

  const otpCode = generateOtpCode();
  const secureOtpRepresentation = hashOtp(otpCode);

  const ttlSeconds = purpose === 'PASSWORD_RESET'
    ? config.PASSWORD_RESET_OTP_EXPIRY_SECONDS
    : config.EMAIL_VERIFICATION_OTP_EXPIRY_SECONDS;

  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  await prisma.emailOtp.create({
    data: {
      userId,
      email: normalizedEmail,
      otpCode: secureOtpRepresentation,
      purpose,
      expiresAt,
      attempts: 0,
      used: false
    }
  });

  // Dispatch via Serverbyt SMTP / MockEmailService without logging the secret
  if (purpose === 'REGISTRATION_VERIFICATION') {
    await emailService.sendVerificationOtp(normalizedEmail, otpCode);
  } else if (purpose === 'PASSWORD_RESET') {
    await emailService.sendPasswordResetOtp(normalizedEmail, otpCode);
  } else {
    await emailService.sendLoginOtp(normalizedEmail, otpCode);
  }

  return { otpCode, expiresAt };
}

/**
 * Validates a submitted 6-digit OTP code against the EmailOtp database records
 * Includes attempt counting, brute-force lockout, single-use invalidation, and timing-safe matching.
 */
export async function verifyEmailOtp(
  email: string,
  code: string,
  purpose: OtpPurpose
): Promise<VerifyOtpResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedCode = code.trim();

  // Find most recent active unconsumed OTP
  const record = await prisma.emailOtp.findFirst({
    where: {
      email: normalizedEmail,
      purpose,
      used: false
    },
    orderBy: { createdAt: 'desc' }
  });

  if (!record) {
    return { valid: false, error: 'NO_ACTIVE_OTP' };
  }

  // Check if expired
  if (record.expiresAt < new Date()) {
    await prisma.emailOtp.update({
      where: { id: record.id },
      data: { used: true }
    });
    return { valid: false, error: 'EXPIRED_OTP' };
  }

  // Check attempt limit
  if (record.attempts >= config.OTP_MAX_ATTEMPTS) {
    await prisma.emailOtp.update({
      where: { id: record.id },
      data: { used: true }
    });
    return { valid: false, error: 'TOO_MANY_ATTEMPTS' };
  }

  // Verify OTP
  const isMatch = verifyOtpCode(normalizedCode, record.otpCode);

  if (!isMatch) {
    const newAttempts = record.attempts + 1;
    const shouldLockout = newAttempts >= config.OTP_MAX_ATTEMPTS;

    await prisma.emailOtp.update({
      where: { id: record.id },
      data: {
        attempts: newAttempts,
        used: shouldLockout ? true : record.used
      }
    });

    return {
      valid: false,
      error: shouldLockout ? 'TOO_MANY_ATTEMPTS' : 'INVALID_OTP'
    };
  }

  // OTP is valid -> Mark as used (single-use)
  await prisma.emailOtp.update({
    where: { id: record.id },
    data: { used: true }
  });

  return { valid: true, userId: record.userId };
}
