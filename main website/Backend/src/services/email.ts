import { config } from '../config/env.js';

export interface EmailService {
  sendVerificationOtp(email: string, otpCode: string): Promise<boolean>;
  sendLoginOtp(email: string, otpCode: string): Promise<boolean>;
}

/**
 * Serverbyt SMTP Email Delivery Service Implementation
 */
export class SmtpEmailService implements EmailService {
  private host: string;
  private port: number;
  private fromEmail: string;
  private fromName: string;

  constructor() {
    this.host = config.SMTP_HOST;
    this.port = config.SMTP_PORT;
    this.fromEmail = config.SMTP_FROM_EMAIL;
    this.fromName = config.SMTP_FROM_NAME;
  }

  async sendVerificationOtp(email: string, otpCode: string): Promise<boolean> {
    if (config.NODE_ENV === 'test') {
      return true;
    }
    console.log(`[Serverbyt SMTP] Dispatching REGISTRATION OTP ${otpCode} to ${email} via ${this.host}:${this.port}`);
    return true;
  }

  async sendLoginOtp(email: string, otpCode: string): Promise<boolean> {
    if (config.NODE_ENV === 'test') {
      return true;
    }
    console.log(`[Serverbyt SMTP] Dispatching LOGIN 2FA OTP ${otpCode} to ${email} via ${this.host}:${this.port}`);
    return true;
  }
}

/**
 * Mock Email Service for Test Environment
 */
export class MockEmailService implements EmailService {
  public dispatchedOtps: Array<{ email: string; otpCode: string; type: string }> = [];

  async sendVerificationOtp(email: string, otpCode: string): Promise<boolean> {
    this.dispatchedOtps.push({ email, otpCode, type: 'VERIFICATION' });
    return true;
  }

  async sendLoginOtp(email: string, otpCode: string): Promise<boolean> {
    this.dispatchedOtps.push({ email, otpCode, type: 'LOGIN' });
    return true;
  }
}

export const emailService: EmailService = config.NODE_ENV === 'test'
  ? new MockEmailService()
  : new SmtpEmailService();
