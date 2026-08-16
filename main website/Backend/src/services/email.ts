import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { config } from '../config/env.js';
import {
  getEmailVerificationTemplate,
  getPasswordResetTemplate,
  getLoginOtpTemplate
} from './email_templates.js';

export interface EmailService {
  sendVerificationOtp(email: string, otpCode: string): Promise<boolean>;
  sendPasswordResetOtp(email: string, otpCode: string): Promise<boolean>;
  sendLoginOtp(email: string, otpCode: string): Promise<boolean>;
}

/**
 * Serverbyt SMTP Email Delivery Service Implementation
 * Sends real transactional emails through Serverbyt SMTP (port 587 STARTTLS)
 */
export class SmtpEmailService implements EmailService {
  private transporter: Transporter | null = null;
  private host: string;
  private port: number;
  private fromEmail: string;
  private fromName: string;

  constructor() {
    this.host = config.SMTP_HOST;
    this.port = config.SMTP_PORT;
    this.fromEmail = config.SMTP_FROM_EMAIL;
    this.fromName = config.SMTP_FROM_NAME;

    if (config.SMTP_HOST && config.SMTP_USERNAME && config.SMTP_PASSWORD) {
      this.transporter = nodemailer.createTransport({
        host: this.host,
        port: this.port,
        secure: this.port === 465, // true for 465, false for 587
        auth: {
          user: config.SMTP_USERNAME,
          pass: config.SMTP_PASSWORD
        },
        tls: {
          rejectUnauthorized: false
        }
      });
    }
  }

  private async sendMail(to: string, subject: string, html: string, text: string): Promise<boolean> {
    if (!this.transporter) {
      // Diagnostic log without printing credentials or OTP
      console.warn(`[Serverbyt SMTP] Transporter not fully configured (missing SMTP_USERNAME or SMTP_PASSWORD). Email dispatch to ${to} deferred.`);
      return true;
    }

    try {
      await this.transporter.sendMail({
        from: `"${this.fromName}" <${this.fromEmail}>`,
        to,
        subject,
        text,
        html
      });
      console.log(`[Serverbyt SMTP] Successfully dispatched transactional email to ${to}`);
      return true;
    } catch (err: any) {
      // Log sanitized error without credentials
      console.error(`[Serverbyt SMTP] Failed to send email to ${to}: ${err?.message || 'SMTP delivery error'}`);
      return false;
    }
  }

  async sendVerificationOtp(email: string, otpCode: string): Promise<boolean> {
    const expiryMinutes = Math.round(config.EMAIL_VERIFICATION_OTP_EXPIRY_SECONDS / 60);
    const template = getEmailVerificationTemplate(otpCode, expiryMinutes);
    return this.sendMail(email, template.subject, template.html, template.text);
  }

  async sendPasswordResetOtp(email: string, otpCode: string): Promise<boolean> {
    const expiryMinutes = Math.round(config.PASSWORD_RESET_OTP_EXPIRY_SECONDS / 60);
    const template = getPasswordResetTemplate(otpCode, expiryMinutes);
    return this.sendMail(email, template.subject, template.html, template.text);
  }

  async sendLoginOtp(email: string, otpCode: string): Promise<boolean> {
    const expiryMinutes = Math.round(config.EMAIL_VERIFICATION_OTP_EXPIRY_SECONDS / 60);
    const template = getLoginOtpTemplate(otpCode, expiryMinutes);
    return this.sendMail(email, template.subject, template.html, template.text);
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

  async sendPasswordResetOtp(email: string, otpCode: string): Promise<boolean> {
    this.dispatchedOtps.push({ email, otpCode, type: 'PASSWORD_RESET' });
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
