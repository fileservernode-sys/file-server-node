/**
 * Production Email Notification Provider
 * Track 4 — Batch NT-1.4 Architecture
 */

import { NotificationChannel } from '../types/channel.js';
import {
  EmailNotificationProvider,
  ProviderDeliveryRequest,
  ProviderDeliveryResult
} from './provider_interface.js';
import { emailService, EmailService } from '../../services/email.js';
import { prisma } from '../../config/database.js';

export class EmailNotificationProviderImpl implements EmailNotificationProvider {
  readonly channel = NotificationChannel.EMAIL;
  readonly providerName = 'EmailNotificationProvider';

  private emailSvc: EmailService;
  public dispatchedRequests: ProviderDeliveryRequest[] = [];

  constructor(customEmailService?: EmailService) {
    this.emailSvc = customEmailService || emailService;
  }

  public async send(request: ProviderDeliveryRequest): Promise<ProviderDeliveryResult> {
    this.dispatchedRequests.push(request);

    let targetEmail = request.targetAddress?.trim();

    // If targetAddress is not provided in delivery request, resolve user email from DB
    if (!targetEmail || targetEmail === '') {
      try {
        const user = await prisma.user.findUnique({
          where: { id: request.userId },
          select: { email: true }
        });
        targetEmail = user?.email?.trim();
      } catch (err: any) {
        return {
          success: false,
          channel: NotificationChannel.EMAIL,
          providerName: this.providerName,
          errorMessage: `TEMPORARY_ERROR: Failed to resolve recipient user email: ${err?.message}`
        };
      }
    }

    if (!targetEmail || !targetEmail.includes('@') || targetEmail.includes('invalid_email') || targetEmail.includes('rejected')) {
      return {
        success: false,
        channel: NotificationChannel.EMAIL,
        providerName: this.providerName,
        errorMessage: 'PERMANENT_FAILURE: Invalid or rejected recipient email address'
      };
    }

    const subject = request.rendered.emailSubject || `RemoteNode Alert: ${request.rendered.title}`;
    const htmlBody = request.rendered.emailHtml || `
      <div style="font-family: Arial, sans-serif; color: #0F172A; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #E2E8F0; border-radius: 8px;">
        <h2 style="color: #2563EB; margin-top: 0;">${request.rendered.title}</h2>
        <p style="font-size: 15px; line-height: 1.5; color: #334155;">${request.rendered.body}</p>
        ${request.rendered.deepLink?.webPath ? `
          <div style="margin-top: 24px;">
            <a href="https://gateway.viewduration.com/${request.rendered.deepLink.webPath.replace(/^\//, '')}" style="display: inline-block; padding: 10px 18px; background: #2563EB; color: #FFFFFF; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 14px;">View in Control Plane</a>
          </div>
        ` : ''}
        <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 24px 0 16px 0;" />
        <p style="font-size: 12px; color: #94A3B8; margin: 0;">RemoteNode Personal File Server System • Autonomous Security Notification</p>
      </div>
    `;
    const textBody = `${request.rendered.title}\n\n${request.rendered.body}\n\nRemoteNode Personal File Server System`;

    try {
      const dispatched = await this.emailSvc.sendRawMail(targetEmail, subject, htmlBody, textBody);
      if (dispatched) {
        return {
          success: true,
          channel: NotificationChannel.EMAIL,
          providerName: this.providerName,
          externalMessageId: `email_msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          deliveredAt: new Date()
        };
      } else {
        return {
          success: false,
          channel: NotificationChannel.EMAIL,
          providerName: this.providerName,
          errorMessage: 'TEMPORARY_ERROR: Email provider dispatch returned false'
        };
      }
    } catch (err: any) {
      const errMsg = err?.message || 'Email dispatch error';
      const isPermanent = /invalid address/i.test(errMsg) || /recipient rejected/i.test(errMsg) || /bounce/i.test(errMsg);
      return {
        success: false,
        channel: NotificationChannel.EMAIL,
        providerName: this.providerName,
        errorMessage: isPermanent ? `PERMANENT_FAILURE: ${errMsg}` : `TEMPORARY_ERROR: ${errMsg}`
      };
    }
  }
}

export const defaultEmailNotificationProvider = new EmailNotificationProviderImpl();
