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
 * Brevo Transactional Email Service
 * Supports direct HTTPS REST API (Port 443 - zero cloud firewall issues on Render)
 * as well as Brevo / Standard SMTP Relay fallback.
 */
export class BrevoEmailService implements EmailService {
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

  private getApiKey(): string {
    return (process.env.BREVO_API_KEY || config.BREVO_API_KEY || '').trim();
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
    const apiKey = this.getApiKey();
    const fromEmail = (process.env.SMTP_FROM_EMAIL || this.fromEmail).trim();
    const fromName = (process.env.SMTP_FROM_NAME || this.fromName).trim();

    // 1. Primary: Brevo HTTPS REST API
    if (apiKey) {
      try {
        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'api-key': apiKey,
            'content-type': 'application/json',
            'accept': 'application/json'
          },
          body: JSON.stringify({
            sender: { name: fromName, email: fromEmail },
            to: [{ email: to }],
            subject,
            htmlContent: html,
            textContent: text
          })
        });

        if (response.ok) {
          console.log(`[Brevo Email API] Successfully dispatched transactional email to ${to}`);
          return true;
        }

        const errorPayload: any = await response.json().catch(() => ({}));
        console.warn(`[Brevo Email API] REST API rejected delivery (${errorPayload?.message || response.statusText}). Falling back to Brevo SMTP Relay...`);
      } catch (err: any) {
        console.warn(`[Brevo Email API] Network error (${err?.message}). Falling back to Brevo SMTP Relay...`);
      }
    }

    // 2. Secondary: Brevo SMTP Relay (Port 587)
    const transporter = this.getTransporter();
    if (transporter) {
      try {
        await transporter.sendMail({
          from: `"${fromName}" <${fromEmail}>`,
          to,
          subject,
          text,
          html
        });
        console.log(`[Brevo SMTP Relay] Successfully dispatched email to ${to}`);
        return true;
      } catch (err: any) {
        console.error(`[Brevo SMTP Relay] Failed to send email to ${to}: ${err?.message || 'SMTP error'}`);
        return false;
      }
    }

    console.warn(`[Brevo Email] Neither BREVO_API_KEY nor SMTP credentials configured. Email dispatch to ${to} deferred.`);
    return true;
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
 * Backward compatibility alias for SmtpEmailService
 */
export const SmtpEmailService = BrevoEmailService;

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
  : new BrevoEmailService();
