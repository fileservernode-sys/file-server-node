import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { config } from '../config/env.js';
import { emailService } from '../services/email.js';
import { createSuccessResponse, createErrorResponse } from '../schemas/response.js';
import { resolveClientIp } from '../utils/ip.js';
import { contactFormRateLimitConfig } from '../middleware/rate_limit_presets.js';

export const contactFormSchema = z.object({
  name: z
    .string({ required_error: 'Full name is required' })
    .trim()
    .min(1, 'Full name is required')
    .max(100, 'Full name must not exceed 100 characters'),
  email: z
    .string({ required_error: 'Email address is required' })
    .trim()
    .email('Please provide a valid email address')
    .max(254, 'Email address is too long'),
  reason: z.enum([
    'general',
    'support',
    'pairing',
    'account',
    'billing',
    'security',
    'feedback',
    'other'
  ], {
    errorMap: () => ({ message: 'Please select a valid reason for contact' })
  }),
  subject: z
    .string({ required_error: 'Subject is required' })
    .trim()
    .min(3, 'Subject must be at least 3 characters')
    .max(200, 'Subject must not exceed 200 characters'),
  message: z
    .string({ required_error: 'Message is required' })
    .trim()
    .min(10, 'Message must be at least 10 characters')
    .max(3000, 'Message must not exceed 3000 characters'),
  _hp_security_check: z.string().optional()
});

const REASON_LABELS: Record<string, string> = {
  general: 'General Question',
  support: 'Technical Support & Setup',
  pairing: 'Device Pairing & Connectivity',
  account: 'Account & Authentication',
  billing: 'Billing & Subscription Plans',
  security: 'Security & Vulnerability Report',
  feedback: 'Product Feedback & Feature Request',
  other: 'Other'
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export async function contactRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/contact',
    {
      config: {
        rateLimit: contactFormRateLimitConfig
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = contactFormSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send(
          createErrorResponse('VALIDATION_ERROR', parsed.error.errors[0]?.message || 'Invalid contact form submission')
        );
      }

      const { name, email, reason, subject, message, _hp_security_check } = parsed.data;

      // Honeypot anti-spam check: if bot filled this hidden field, return success without dispatching email
      if (_hp_security_check && _hp_security_check.trim().length > 0) {
        request.log.warn({ ip: resolveClientIp(request) }, 'Contact submission dropped due to honeypot trigger');
        return reply.status(200).send(createSuccessResponse({
          message: 'Your inquiry has been received. Our team will review it and follow up at your provided email address.'
        }));
      }

      const categoryLabel = REASON_LABELS[reason] || reason;
      const destinationEmail = config.SMTP_FROM_EMAIL || 'support@zdexcloud.com';
      const emailSubject = `[ZdexCloud Inquiry - ${categoryLabel}] ${subject}`;

      const textBody = [
        'ZdexCloud Customer Support Inquiry',
        '==================================',
        `Submitted: ${new Date().toISOString()}`,
        `Client IP: ${resolveClientIp(request)}`,
        '',
        'Sender Details:',
        `- Name: ${name}`,
        `- Email: ${email}`,
        `- Category: ${categoryLabel} (${reason})`,
        `- Subject: ${subject}`,
        '',
        'Message:',
        '----------------------------------',
        message,
        '----------------------------------',
        '',
        'Notice: Verify caller identity before discussing account details. Never ask the customer for their password, OTP, or on-device credentials.'
      ].join('\n');

      const htmlBody = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; line-height: 1.6; color: #1E293B;">
          <div style="background-color: #2563EB; padding: 16px 20px; border-radius: 8px 8px 0 0; color: #FFFFFF;">
            <h2 style="margin: 0; font-size: 18px; font-weight: 700;">ZdexCloud Support Desk Inquiry</h2>
          </div>
          <div style="padding: 20px; border: 1px solid #E2E8F0; border-top: none; border-radius: 0 0 8px 8px; background: #FFFFFF;">
            <p style="margin-top: 0;">A new inquiry has been submitted through the ZdexCloud website contact form.</p>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
              <tr>
                <td style="padding: 8px 0; font-weight: 600; width: 120px; color: #64748B;">From:</td>
                <td style="padding: 8px 0;"><strong>${escapeHtml(name)}</strong> &lt;<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>&gt;</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: 600; color: #64748B;">Category:</td>
                <td style="padding: 8px 0;"><span style="background: #EFF6FF; color: #2563EB; padding: 2px 8px; border-radius: 4px; font-size: 13px; font-weight: 600;">${escapeHtml(categoryLabel)}</span></td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: 600; color: #64748B;">Subject:</td>
                <td style="padding: 8px 0;">${escapeHtml(subject)}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: 600; color: #64748B;">Received:</td>
                <td style="padding: 8px 0; color: #64748B; font-size: 13px;">${new Date().toUTCString()}</td>
              </tr>
            </table>

            <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px; padding: 16px; margin-bottom: 20px;">
              <h4 style="margin: 0 0 8px 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748B;">Inquiry Message</h4>
              <p style="margin: 0; white-space: pre-wrap; font-size: 14px; color: #0F172A;">${escapeHtml(message)}</p>
            </div>

            <div style="background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 6px; padding: 12px; font-size: 12px; color: #92400E;">
              <strong>Security reminder:</strong> Never ask customers for passwords, OTP codes, or on-device file server access tokens.
            </div>
          </div>
        </div>
      `;

      try {
        await emailService.sendRawMail(
          destinationEmail,
          emailSubject,
          htmlBody,
          textBody,
          {
            sourcePipeline: 'TRANSACTIONAL',
            emailType: 'CONTACT_FORM_SUBMISSION',
            metadata: {
              customerEmail: email,
              category: reason
            }
          }
        );

        request.log.info(
          { category: reason, senderDomain: email.split('@')[1] },
          'Contact inquiry email dispatched'
        );

        return reply.status(200).send(createSuccessResponse({
          message: 'Your inquiry has been received. Our team will review it and follow up at your provided email address.'
        }));
      } catch (err: any) {
        request.log.error({ err }, 'Failed to dispatch contact form inquiry email');
        return reply.status(500).send(
          createErrorResponse('DISPATCH_ERROR', 'Unable to send message at this time. Please email support@zdexcloud.com directly.')
        );
      }
    }
  );
}
