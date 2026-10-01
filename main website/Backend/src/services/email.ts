import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { config } from '../config/env.js';
import {
  getEmailVerificationTemplate,
  getPasswordResetTemplate,
  getLoginOtpTemplate
} from './email_templates.js';
import { emailTrackingService } from './email_tracking_service.js';
import { RequestContextStore } from '../observability/request_context.js';
import {
  sanitizeLogString,
  sanitizeFailureReason,
  sanitizeJsonPayload
} from '../utils/email_sanitizer.js';

export interface EmailDispatchResult {
  success: boolean;
  provider: string;
  transport: 'BREVO_API' | 'SMTP_RELAY' | 'MOCK';
  providerMessageId?: string | null;
  providerResponseCode?: string | null;
  providerResponse?: any;
  errorMessage?: string | null;
  failureCode?: string | null;
  durationMs?: number;
}

export interface EmailDispatchOptions {
  userId?: string | null;
  notificationRecordId?: string | null;
  channelDeliveryRecordId?: string | null;
  sourcePipeline?: 'OTP' | 'NOTIFICATION' | 'SYSTEM' | 'TRANSACTIONAL';
  emailType?: string;
  templateId?: string;
  requestId?: string | null;
  correlationId?: string | null;
  deviceId?: string | null;
  serverId?: string | null;
  metadata?: Record<string, any>;
  attemptNumber?: number;
}

export interface EmailService {
  sendVerificationOtp(email: string, otpCode: string, options?: EmailDispatchOptions): Promise<EmailDispatchResult>;
  sendPasswordResetOtp(email: string, otpCode: string, options?: EmailDispatchOptions): Promise<EmailDispatchResult>;
  sendLoginOtp(email: string, otpCode: string, options?: EmailDispatchOptions): Promise<EmailDispatchResult>;
  sendRawMail(to: string, subject: string, html: string, text: string, options?: EmailDispatchOptions): Promise<EmailDispatchResult>;
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

  private async sendMail(to: string, subject: string, html: string, text: string): Promise<EmailDispatchResult> {
    const apiKey = this.getApiKey();
    const fromEmail = (process.env.SMTP_FROM_EMAIL || this.fromEmail).trim();
    const fromName = (process.env.SMTP_FROM_NAME || this.fromName).trim();
    const startTime = Date.now();

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

        const durationMs = Date.now() - startTime;

        if (response.ok) {
          const responsePayload: any = await response.json().catch(() => ({}));
          const realMessageId = responsePayload?.messageId ? String(responsePayload.messageId) : undefined;
          console.log(`[Brevo Email API] Successfully dispatched transactional email to ${sanitizeLogString(to)} (messageId: ${sanitizeLogString(realMessageId) || 'N/A'})`);

          return {
            success: true,
            provider: 'BREVO',
            transport: 'BREVO_API',
            providerMessageId: realMessageId || null,
            providerResponseCode: String(response.status),
            providerResponse: sanitizeJsonPayload(responsePayload),
            durationMs
          };
        }

        const errorPayload: any = await response.json().catch(() => ({}));
        console.warn(`[Brevo Email API] REST API rejected delivery (${sanitizeLogString(errorPayload?.message || response.statusText)}). Falling back to Brevo SMTP Relay...`);
      } catch (err: any) {
        console.warn(`[Brevo Email API] Network error (${sanitizeLogString(err?.message)}). Falling back to Brevo SMTP Relay...`);
      }
    }

    // 2. Secondary: Brevo SMTP Relay (Port 587)
    const transporter = this.getTransporter();
    if (transporter) {
      try {
        const sendResult = await transporter.sendMail({
          from: `"${fromName}" <${fromEmail}>`,
          to,
          subject,
          text,
          html
        });

        const durationMs = Date.now() - startTime;
        const realMessageId = sendResult?.messageId ? String(sendResult.messageId) : undefined;
        console.log(`[Brevo SMTP Relay] Successfully dispatched email to ${sanitizeLogString(to)} (messageId: ${sanitizeLogString(realMessageId) || 'N/A'})`);

        return {
          success: true,
          provider: 'BREVO',
          transport: 'SMTP_RELAY',
          providerMessageId: realMessageId || null,
          providerResponseCode: '250',
          providerResponse: sanitizeJsonPayload({ response: sendResult?.response, accepted: sendResult?.accepted }),
          durationMs
        };
      } catch (err: any) {
        const durationMs = Date.now() - startTime;
        const safeErrMsg = sanitizeFailureReason(err?.message || 'SMTP delivery error');
        console.error(`[Brevo SMTP Relay] Failed to send email to ${sanitizeLogString(to)}: ${sanitizeLogString(safeErrMsg)}`);
        return {
          success: false,
          provider: 'BREVO',
          transport: 'SMTP_RELAY',
          errorMessage: safeErrMsg,
          durationMs
        };
      }
    }

    const durationMs = Date.now() - startTime;
    console.warn(`[Brevo Email] Neither BREVO_API_KEY nor SMTP credentials configured. Email dispatch to ${sanitizeLogString(to)} deferred.`);
    return {
      success: true,
      provider: 'BREVO',
      transport: 'BREVO_API',
      providerMessageId: null,
      providerResponseCode: 'DEFERRED',
      durationMs
    };
  }

  async sendVerificationOtp(email: string, otpCode: string, options?: EmailDispatchOptions): Promise<EmailDispatchResult> {
    const expiryMinutes = Math.round(config.EMAIL_VERIFICATION_OTP_EXPIRY_SECONDS / 60);
    const template = getEmailVerificationTemplate(otpCode, expiryMinutes);
    const dispatchResult = await this.sendMail(email, template.subject, template.html, template.text);

    // Track direct OTP email dispatch
    await emailTrackingService.recordDirectOtpEmail({
      userId: options?.userId || null,
      recipientEmail: email,
      emailType: options?.emailType || 'REGISTRATION_OTP',
      templateId: options?.templateId || 'EMAIL_VERIFICATION',
      subject: template.subject,
      senderEmail: config.SMTP_FROM_EMAIL,
      senderName: config.SMTP_FROM_NAME,
      dispatchResult,
      requestId: options?.requestId || RequestContextStore.get()?.requestId || null,
      correlationId: options?.correlationId || null,
      metadata: options?.metadata
    }).catch(() => {});

    return dispatchResult;
  }

  async sendPasswordResetOtp(email: string, otpCode: string, options?: EmailDispatchOptions): Promise<EmailDispatchResult> {
    const expiryMinutes = Math.round(config.PASSWORD_RESET_OTP_EXPIRY_SECONDS / 60);
    const template = getPasswordResetTemplate(otpCode, expiryMinutes);
    const dispatchResult = await this.sendMail(email, template.subject, template.html, template.text);

    // Track direct OTP email dispatch
    await emailTrackingService.recordDirectOtpEmail({
      userId: options?.userId || null,
      recipientEmail: email,
      emailType: options?.emailType || 'PASSWORD_RESET_OTP',
      templateId: options?.templateId || 'PASSWORD_RESET',
      subject: template.subject,
      senderEmail: config.SMTP_FROM_EMAIL,
      senderName: config.SMTP_FROM_NAME,
      dispatchResult,
      requestId: options?.requestId || RequestContextStore.get()?.requestId || null,
      correlationId: options?.correlationId || null,
      metadata: options?.metadata
    }).catch(() => {});

    return dispatchResult;
  }

  async sendLoginOtp(email: string, otpCode: string, options?: EmailDispatchOptions): Promise<EmailDispatchResult> {
    const expiryMinutes = Math.round(config.EMAIL_VERIFICATION_OTP_EXPIRY_SECONDS / 60);
    const template = getLoginOtpTemplate(otpCode, expiryMinutes);
    const dispatchResult = await this.sendMail(email, template.subject, template.html, template.text);

    // Track direct OTP email dispatch
    await emailTrackingService.recordDirectOtpEmail({
      userId: options?.userId || null,
      recipientEmail: email,
      emailType: options?.emailType || 'LOGIN_OTP',
      templateId: options?.templateId || 'LOGIN_2FA',
      subject: template.subject,
      senderEmail: config.SMTP_FROM_EMAIL,
      senderName: config.SMTP_FROM_NAME,
      dispatchResult,
      requestId: options?.requestId || RequestContextStore.get()?.requestId || null,
      correlationId: options?.correlationId || null,
      metadata: options?.metadata
    }).catch(() => {});

    return dispatchResult;
  }

  async sendRawMail(to: string, subject: string, html: string, text: string, options?: EmailDispatchOptions): Promise<EmailDispatchResult> {
    const dispatchResult = await this.sendMail(to, subject, html, text);

    // If notification tracking options are provided, record via central tracking
    if (options && options.sourcePipeline === 'NOTIFICATION') {
      await emailTrackingService.recordNotificationEmail({
        userId: options.userId || null,
        recipientEmail: to,
        notificationRecordId: options.notificationRecordId || null,
        channelDeliveryRecordId: options.channelDeliveryRecordId || null,
        emailType: options.emailType || 'NOTIFICATION',
        templateId: options.templateId || 'NOTIFICATION',
        subject,
        senderEmail: config.SMTP_FROM_EMAIL,
        senderName: config.SMTP_FROM_NAME,
        dispatchResult,
        requestId: options.requestId || RequestContextStore.get()?.requestId || null,
        correlationId: options.correlationId || null,
        deviceId: options.deviceId || null,
        serverId: options.serverId || null,
        metadata: options.metadata,
        attemptNumber: options.attemptNumber
      }).catch(() => {});
    }

    return dispatchResult;
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
  public dispatchedOtps: Array<{ email: string; otpCode: string; type: string; options?: EmailDispatchOptions }> = [];
  public dispatchedMails: Array<{ to: string; subject: string; html: string; text: string; options?: EmailDispatchOptions }> = [];

  async sendVerificationOtp(email: string, otpCode: string, options?: EmailDispatchOptions): Promise<EmailDispatchResult> {
    this.dispatchedOtps.push({ email, otpCode, type: 'VERIFICATION', options });
    const result: EmailDispatchResult = {
      success: true,
      provider: 'MOCK',
      transport: 'MOCK',
      providerMessageId: `mock_otp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      providerResponseCode: '200'
    };

    await emailTrackingService.recordDirectOtpEmail({
      userId: options?.userId || null,
      recipientEmail: email,
      emailType: options?.emailType || 'REGISTRATION_OTP',
      templateId: options?.templateId || 'EMAIL_VERIFICATION',
      subject: '[ZdexCloud] Verify Your Email Address',
      dispatchResult: result,
      requestId: options?.requestId || RequestContextStore.get()?.requestId || null,
      correlationId: options?.correlationId || null,
      metadata: options?.metadata
    }).catch(() => {});

    return result;
  }

  async sendPasswordResetOtp(email: string, otpCode: string, options?: EmailDispatchOptions): Promise<EmailDispatchResult> {
    this.dispatchedOtps.push({ email, otpCode, type: 'PASSWORD_RESET', options });
    const result: EmailDispatchResult = {
      success: true,
      provider: 'MOCK',
      transport: 'MOCK',
      providerMessageId: `mock_otp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      providerResponseCode: '200'
    };

    await emailTrackingService.recordDirectOtpEmail({
      userId: options?.userId || null,
      recipientEmail: email,
      emailType: options?.emailType || 'PASSWORD_RESET_OTP',
      templateId: options?.templateId || 'PASSWORD_RESET',
      subject: '[ZdexCloud] Reset Your Password',
      dispatchResult: result,
      requestId: options?.requestId || RequestContextStore.get()?.requestId || null,
      correlationId: options?.correlationId || null,
      metadata: options?.metadata
    }).catch(() => {});

    return result;
  }

  async sendLoginOtp(email: string, otpCode: string, options?: EmailDispatchOptions): Promise<EmailDispatchResult> {
    this.dispatchedOtps.push({ email, otpCode, type: 'LOGIN', options });
    const result: EmailDispatchResult = {
      success: true,
      provider: 'MOCK',
      transport: 'MOCK',
      providerMessageId: `mock_otp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      providerResponseCode: '200'
    };

    await emailTrackingService.recordDirectOtpEmail({
      userId: options?.userId || null,
      recipientEmail: email,
      emailType: options?.emailType || 'LOGIN_OTP',
      templateId: options?.templateId || 'LOGIN_2FA',
      subject: '[ZdexCloud] Your Login Security Code',
      dispatchResult: result,
      requestId: options?.requestId || RequestContextStore.get()?.requestId || null,
      correlationId: options?.correlationId || null,
      metadata: options?.metadata
    }).catch(() => {});

    return result;
  }

  async sendRawMail(to: string, subject: string, html: string, text: string, options?: EmailDispatchOptions): Promise<EmailDispatchResult> {
    this.dispatchedMails.push({ to, subject, html, text, options });
    const result: EmailDispatchResult = {
      success: true,
      provider: 'MOCK',
      transport: 'MOCK',
      providerMessageId: `mock_msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      providerResponseCode: '200'
    };

    if (options && options.sourcePipeline === 'NOTIFICATION') {
      await emailTrackingService.recordNotificationEmail({
        userId: options.userId || null,
        recipientEmail: to,
        notificationRecordId: options.notificationRecordId || null,
        channelDeliveryRecordId: options.channelDeliveryRecordId || null,
        emailType: options.emailType || 'NOTIFICATION',
        templateId: options.templateId || 'NOTIFICATION',
        subject,
        dispatchResult: result,
        requestId: options.requestId || RequestContextStore.get()?.requestId || null,
        correlationId: options.correlationId || null,
        deviceId: options.deviceId || null,
        serverId: options.serverId || null,
        metadata: options.metadata,
        attemptNumber: options.attemptNumber
      }).catch(() => {});
    }

    return result;
  }
}

export const emailService: EmailService = config.NODE_ENV === 'test'
  ? new MockEmailService()
  : new BrevoEmailService();
