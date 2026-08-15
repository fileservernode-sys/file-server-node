import { OtpPurpose } from '@prisma/client';
import { prisma } from '../config/database.js';
import { generateOtpCode } from './crypto.js';
import { emailService } from '../services/email.js';

export interface IssueOtpResult {
  otpCode: string;
  expiresAt: Date;
}

/**
 * Generates a cryptographically secure 6-digit OTP code, persists to EmailOtp table (expires in 10 mins),
 * and dispatches email notification using Serverbyt SMTP service.
 */
export async function issueEmailOtp(userId: string, email: string, purpose: OtpPurpose): Promise<IssueOtpResult> {
  const normalizedEmail = email.trim().toLowerCase();

  // Invalidate previous unused OTPs for this email and purpose
  await prisma.emailOtp.updateMany({
    where: { email: normalizedEmail, purpose, used: false },
    data: { used: true }
  });

  const otpCode = generateOtpCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 Minutes TTL

  await prisma.emailOtp.create({
    data: {
      userId,
      email: normalizedEmail,
      otpCode,
      purpose,
      expiresAt,
      used: false
    }
  });

  if (purpose === 'REGISTRATION_VERIFICATION') {
    await emailService.sendVerificationOtp(normalizedEmail, otpCode);
  } else {
    await emailService.sendLoginOtp(normalizedEmail, otpCode);
  }

  return { otpCode, expiresAt };
}

/**
 * Validates a submitted 6-digit OTP code against the EmailOtp database records
 */
export async function verifyEmailOtp(email: string, code: string, purpose: OtpPurpose): Promise<boolean> {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedCode = code.trim();

  const record = await prisma.emailOtp.findFirst({
    where: {
      email: normalizedEmail,
      otpCode: normalizedCode,
      purpose,
      used: false,
      expiresAt: { gt: new Date() }
    },
    orderBy: { createdAt: 'desc' }
  });

  if (!record) {
    return false;
  }

  // Mark as used
  await prisma.emailOtp.update({
    where: { id: record.id },
    data: { used: true }
  });

  return true;
}
