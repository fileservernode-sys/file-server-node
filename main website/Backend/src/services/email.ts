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
 * Sends real transactional emails through Serverbyt SMTP (port 587 STARTTLS / port 465 SSL)
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

  private getTransporter(): Transporter | null {
    const host = process.env.SMTP_HOST || this.host;
    const port = Number(process.env.SMTP_PORT || this.port);
    const user = process.env.SMTP_USERNAME || process.env.SMTP_USER || config.SMTP_USERNAME;
    const pass = process.env.SMTP_PASSWORD || process.env.SMTP_PASS || config.SMTP_PASSWORD;

    if (!host || !user || !pass) {
      return null;
    }

    return nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      tls: {
        rejectUnauthorized: false
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000
    });
  }

  private async sendMail(to: string, subject: string, html: string, text: string): Promise<boolean> {
    const transporter = this.getTransporter();
    const fromEmail = process.env.SMTP_FROM_EMAIL || this.fromEmail;
    const fromName = process.env.SMTP_FROM_NAME || this.fromName;

    if (!transporter) {
      console.warn(`[Serverbyt SMTP] Transporter not fully configured (missing SMTP_USERNAME/SMTP_USER or SMTP_PASSWORD/SMTP_PASS in environment). Email dispatch to ${to} deferred.`);
      return true;
    }

    try {
      await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to,
        subject,
        text,
        html
      });
      console.log(`[Serverbyt SMTP] Successfully dispatched transactional email to ${to}`);
      return true;
    } catch (err: any) {
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
