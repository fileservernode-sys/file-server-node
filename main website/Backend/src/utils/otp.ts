import { OtpPurpose } from '@prisma/client';
import { prisma } from '../config/database.js';
import { generateOtpCode } from './crypto.js';

export interface IssueOtpResult {
  otpCode: string;
  expiresAt: Date;
}

/**
 * Generates a 6-digit OTP code, persists to EmailOtp database table (expires in 10 minutes),
 * and dispatches email notification.
 */
export async function issueEmailOtp(userId: string, email: string, purpose: OtpPurpose): Promise<IssueOtpResult> {
  // Invalidate previous unused OTPs for this email and purpose
  await prisma.emailOtp.updateMany({
    where: { email, purpose, used: false },
    data: { used: true }
  });

  const otpCode = generateOtpCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 Minutes TTL

  await prisma.emailOtp.create({
    data: {
      userId,
      email,
      otpCode,
      purpose,
      expiresAt,
      used: false
    }
  });

  // Log dispatch in development mode
  console.log(`\n==================================================`);
  console.log(`📧 EMAIL OTP DISPATCH: [${purpose}]`);
  console.log(`To: ${email}`);
  console.log(`OTP Code: ${otpCode}`);
  console.log(`Expires: ${expiresAt.toISOString()}`);
  console.log(`==================================================\n`);

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
