import { OtpPurpose } from '@prisma/client';
import { prisma } from '../config/database.js';
import { config } from '../config/env.js';
import {
  generateOtpCode,
  hashOtp,
  verifyOtpCode,
  hashPasswordChangeOtp,
  verifyPasswordChangeOtpCode
} from './crypto.js';
import { emailService } from '../services/email.js';

export interface IssueOtpResult {
  otpCode: string;
  expiresAt: Date;
}

export interface VerifyOtpResult {
  valid: boolean;
  error?: 'INVALID_OTP' | 'EXPIRED_OTP' | 'TOO_MANY_ATTEMPTS' | 'NO_ACTIVE_OTP';
  userId?: string;
  otpRecordId?: string;
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

  // Check Resend Cooldown (excluding operation-bound password-change OTPs)
  const recentOtp = await prisma.emailOtp.findFirst({
    where: {
      email: normalizedEmail,
      purpose,
      NOT: { otpCode: { startsWith: 'pwdchg:' } },
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

  // Invalidate previous unused OTPs for this email and purpose (excluding password-change OTPs)
  await prisma.emailOtp.updateMany({
    where: {
      email: normalizedEmail,
      purpose,
      used: false,
      NOT: { otpCode: { startsWith: 'pwdchg:' } }
    },
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

  // Dispatch via Brevo / SMTP / MockEmailService without logging the secret
  const trackingOptions = {
    userId,
    sourcePipeline: 'OTP' as const,
    emailType: purpose === 'REGISTRATION_VERIFICATION'
      ? 'REGISTRATION_OTP'
      : purpose === 'PASSWORD_RESET'
      ? 'PASSWORD_RESET_OTP'
      : 'LOGIN_OTP',
    templateId: purpose === 'REGISTRATION_VERIFICATION'
      ? 'EMAIL_VERIFICATION'
      : purpose === 'PASSWORD_RESET'
      ? 'PASSWORD_RESET'
      : 'LOGIN_2FA'
  };

  if (purpose === 'REGISTRATION_VERIFICATION') {
    await emailService.sendVerificationOtp(normalizedEmail, otpCode, trackingOptions);
  } else if (purpose === 'PASSWORD_RESET') {
    await emailService.sendPasswordResetOtp(normalizedEmail, otpCode, trackingOptions);
  } else {
    await emailService.sendLoginOtp(normalizedEmail, otpCode, trackingOptions);
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
  purpose: OtpPurpose,
  options?: { consume?: boolean; expectedUserId?: string }
): Promise<VerifyOtpResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedCode = code.trim();

  // Find most recent active unconsumed OTP (strictly excluding password-change OTPs)
  const record = await prisma.emailOtp.findFirst({
    where: {
      email: normalizedEmail,
      purpose,
      used: false,
      NOT: { otpCode: { startsWith: 'pwdchg:' } }
    },
    orderBy: { createdAt: 'desc' }
  });

  if (!record) {
    return { valid: false, error: 'NO_ACTIVE_OTP' };
  }

  if (options?.expectedUserId && record.userId !== options.expectedUserId) {
    return { valid: false, error: 'INVALID_OTP' };
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

  // OTP is valid -> Mark as used (single-use) unless caller requested pre-verification only
  if (options?.consume !== false) {
    await prisma.emailOtp.update({
      where: { id: record.id },
      data: { used: true }
    });
  }

  return { valid: true, userId: record.userId, otpRecordId: record.id };
}

/**
 * Generates and dispatches an operation-bound, user-bound 6-digit OTP specifically for
 * authenticated password change.
 * Uses the existing EmailOtp persistence model with a `pwdchg:<userId>:<salt>:<hmac>` representation
 * so password-change OTPs and forgot-password/login/registration OTPs cannot cross-validate.
 */
export async function issuePasswordChangeOtp(
  userId: string,
  email: string
): Promise<IssueOtpResult> {
  const cleanUserId = userId.trim();
  const normalizedEmail = email.trim().toLowerCase();
  const prefix = `pwdchg:${cleanUserId}:`;

  // Enforce resend cooldown scoped to this user's password-change OTPs
  const recentOtp = await prisma.emailOtp.findFirst({
    where: {
      userId: cleanUserId,
      email: normalizedEmail,
      purpose: 'PASSWORD_RESET',
      otpCode: { startsWith: prefix },
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
    (error as any).retryAfterSeconds = remainingSec;
    throw error;
  }

  // Invalidate any prior unused password-change OTPs for this user
  await prisma.emailOtp.updateMany({
    where: {
      userId: cleanUserId,
      purpose: 'PASSWORD_RESET',
      otpCode: { startsWith: prefix },
      used: false
    },
    data: { used: true }
  });

  const otpCode = generateOtpCode();
  const secureOtpRepresentation = hashPasswordChangeOtp(cleanUserId, otpCode);
  const ttlSeconds = config.PASSWORD_RESET_OTP_EXPIRY_SECONDS;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  await prisma.emailOtp.create({
    data: {
      userId: cleanUserId,
      email: normalizedEmail,
      otpCode: secureOtpRepresentation,
      purpose: 'PASSWORD_RESET',
      expiresAt,
      attempts: 0,
      used: false
    }
  });

  await emailService.sendPasswordChangeOtp(normalizedEmail, otpCode, {
    userId: cleanUserId,
    sourcePipeline: 'OTP',
    emailType: 'PASSWORD_CHANGE_OTP',
    templateId: 'PASSWORD_CHANGE'
  });

  return { otpCode, expiresAt };
}

/**
 * Verifies an operation-bound, user-bound 6-digit OTP for authenticated password change.
 * Enforces expiry, max attempts lockout, user binding, and single-use consumption.
 */
export async function verifyPasswordChangeOtp(
  userId: string,
  email: string,
  code: string,
  options?: { consume?: boolean }
): Promise<VerifyOtpResult> {
  const cleanUserId = userId.trim();
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedCode = code.trim();
  const prefix = `pwdchg:${cleanUserId}:`;

  const record = await prisma.emailOtp.findFirst({
    where: {
      userId: cleanUserId,
      email: normalizedEmail,
      purpose: 'PASSWORD_RESET',
      otpCode: { startsWith: prefix },
      used: false
    },
    orderBy: { createdAt: 'desc' }
  });

  if (!record) {
    return { valid: false, error: 'NO_ACTIVE_OTP' };
  }

  if (record.expiresAt < new Date()) {
    await prisma.emailOtp.update({
      where: { id: record.id },
      data: { used: true }
    });
    return { valid: false, error: 'EXPIRED_OTP' };
  }

  if (record.attempts >= config.OTP_MAX_ATTEMPTS) {
    await prisma.emailOtp.update({
      where: { id: record.id },
      data: { used: true }
    });
    return { valid: false, error: 'TOO_MANY_ATTEMPTS' };
  }

  const isMatch = verifyPasswordChangeOtpCode(cleanUserId, normalizedCode, record.otpCode);

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

  if (options?.consume !== false) {
    const consumed = await prisma.emailOtp.updateMany({
      where: { id: record.id, userId: cleanUserId, used: false },
      data: { used: true }
    });
    if (consumed.count !== 1) {
      return { valid: false, error: 'NO_ACTIVE_OTP' };
    }
  }

  return { valid: true, userId: record.userId, otpRecordId: record.id };
}

