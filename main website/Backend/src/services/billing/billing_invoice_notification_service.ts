/**
 * -----------------------------------------------------------------------------
 * ZDEXCLOUD INVOICE EMAIL NOTIFICATION SERVICE
 * (Phase 8.4, Batch D)
 *
 * Implements asynchronous, post-commit, non-blocking email notifications
 * alerting customers that a statutory tax invoice is available in the portal.
 *
 * ARCHITECTURAL & SECURITY INVARIANTS:
 * 1. ZERO ATTACHMENTS: PDFs are NEVER attached to outbound emails. Customers
 *    are directed to the authenticated portal to retrieve their invoices.
 * 2. NO CREDENTIALS IN LINKS: Portal links contain no tokens, credentials,
 *    passwords, or unauthenticated download URLs.
 * 3. STRICT ISOLATION: Notification errors NEVER abort, rollback, or invalidate
 *    invoice issuance or payment completion.
 * 4. LIFECYCLE GUARD: DRAFT, VOIDED, or SUPERSEDED invoices are NEVER notified.
 * 5. POST-COMMIT DISPATCH: Dispatched only AFTER the database transaction commits.
 * 6. IDEMPOTENCY & DEDUPLICATION: Multiple webhook or recovery attempts will not
 *    generate duplicate notification emails for the same invoice.
 * 7. FINAL PAYMENTS POLICY: Reminds customers that payments are final and non-refundable.
 * -----------------------------------------------------------------------------
 */

import {
  BillingInvoice,
  BillingInvoiceStatus,
  EmailMessageStatus
} from '@prisma/client';
import { prisma } from '../../config/database.js';
import { config } from '../../config/env.js';
import { emailService, EmailDispatchResult } from '../email.js';
import { getInvoiceIssuedEmailTemplate } from '../email_templates.js';
import { appLogger } from '../../observability/logger.js';
import { RequestContextStore } from '../../observability/request_context.js';

export interface InvoiceNotificationOptions {
  requestId?: string | null;
  correlationId?: string | null;
  forceResend?: boolean;
}

export interface InvoiceNotificationResult {
  sent: boolean;
  skipped?: boolean;
  reason?: string;
  emailMessageId?: string | null;
  dispatchResult?: EmailDispatchResult | null;
  error?: string | null;
}

export class BillingInvoiceNotificationService {
  /**
   * Dispatches an invoice availability notification email to the customer.
   * Fully fail-safe: any failure is caught, logged, and isolated without throwing.
   */
  public static async sendInvoiceIssuedNotification(
    invoice: BillingInvoice,
    options?: InvoiceNotificationOptions
  ): Promise<InvoiceNotificationResult> {
    try {
      if (!invoice) {
        appLogger.warn('[BillingInvoiceNotification] Null invoice supplied; notification skipped');
        return { sent: false, skipped: true, reason: 'INVALID_INVOICE' };
      }

      // 1. Lifecycle Guard: Only finalized ISSUED invoices may be notified
      if (invoice.status === BillingInvoiceStatus.DRAFT) {
        appLogger.warn('[BillingInvoiceNotification] Cannot send notification for DRAFT invoice; blocked', {
          metadata: {
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber
          }
        });
        return { sent: false, skipped: true, reason: 'DRAFT_STATUS_BLOCKED' };
      }

      if (invoice.status === BillingInvoiceStatus.VOIDED || invoice.status === BillingInvoiceStatus.SUPERSEDED) {
        appLogger.warn('[BillingInvoiceNotification] Cannot send issued notification for inactive invoice status', {
          metadata: {
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            status: invoice.status
          }
        });
        return { sent: false, skipped: true, reason: 'INACTIVE_STATUS_BLOCKED' };
      }

      // 2. Recipient Validation
      const customerEmail = (invoice.customerEmail || '').trim().toLowerCase();
      if (!customerEmail || !customerEmail.includes('@')) {
        appLogger.warn('[BillingInvoiceNotification] Missing or invalid customer email on invoice; notification skipped', {
          metadata: {
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber
          }
        });
        return { sent: false, skipped: true, reason: 'MISSING_CUSTOMER_EMAIL' };
      }

      // 3. Sequential Deduplication Check
      // VERIFIED ARCHITECTURAL LIMITATION (Phase 8.4 Batch E.1):
      // 1. EmailMessage.correlationId is indexed (CREATE INDEX) but has NO @unique constraint in schema.prisma.
      // 2. Direct transactional email dispatch does NOT persist a pre-send QUEUED row prior to calling transport;
      //    the EmailMessage record is created strictly post-transport in recordTransactionalEmail().
      // 3. Consequently, NO ATOMIC RESERVATION OR DISTRIBUTED WORKER LEASE EXISTS in the current schema.
      // 4. This findFirst check serializes sequential retries, replayed webhooks, and recovery ticks, but
      //    concurrent workers executing in the exact same millisecond window CANNOT be atomically serialized
      //    without an approved schema migration adding @@unique([correlationId, emailType]) or a transactional outbox.
      const correlationId = options?.correlationId || `invoice_${invoice.id}`;
      if (!options?.forceResend) {
        const existingMessage = await prisma.emailMessage.findFirst({
          where: { correlationId },
          orderBy: { createdAt: 'desc' }
        });

        if (existingMessage) {
          // If already delivered or sent, suppress duplicate delivery immediately
          if (
            existingMessage.status === EmailMessageStatus.SENT ||
            existingMessage.status === EmailMessageStatus.DELIVERED
          ) {
            appLogger.info('[BillingInvoiceNotification] Invoice notification already delivered; skipping duplicate send', {
              metadata: {
                invoiceId: invoice.id,
                invoiceNumber: invoice.invoiceNumber,
                emailMessageId: existingMessage.id,
                status: existingMessage.status
              }
            });
            return {
              sent: false,
              skipped: true,
              reason: 'ALREADY_SENT',
              emailMessageId: existingMessage.id
            };
          }

          // Defensive check: if QUEUED status is present from an external queue or future outbox
          if (existingMessage.status === EmailMessageStatus.QUEUED) {
            const leaseTimeoutMs = 300000; // 5 minutes
            const elapsed = Date.now() - existingMessage.createdAt.getTime();
            if (elapsed < leaseTimeoutMs) {
              appLogger.info('[BillingInvoiceNotification] Invoice notification record exists in QUEUED state; skipping duplicate trigger', {
                metadata: {
                  invoiceId: invoice.id,
                  invoiceNumber: invoice.invoiceNumber,
                  emailMessageId: existingMessage.id,
                  elapsedMs: elapsed
                }
              });
              return {
                sent: false,
                skipped: true,
                reason: 'IN_PROGRESS',
                emailMessageId: existingMessage.id
              };
            }
          }
        }
      }

      // 4. Secure Portal URL Construction (Verified canonical frontend page path)
      const frontendBase = (config.FRONTEND_URL || 'https://zdexcloud.com').replace(/\/+$/, '');
      const portalUrl = `${frontendBase}/pages/billing.html`;

      // 5. Template Assembly
      const template = getInvoiceIssuedEmailTemplate({
        invoiceNumber: invoice.invoiceNumber,
        issuedAt: invoice.issuedAt,
        totalMinorUnits: invoice.totalMinorUnits,
        currency: invoice.currency,
        customerName: invoice.customerName,
        portalUrl
      });

      // 6. Asynchronous Dispatch via Brevo / Standard Email Service (No Attachments)
      const requestId = options?.requestId || RequestContextStore.get()?.requestId || null;

      const dispatchResult = await emailService.sendRawMail(
        customerEmail,
        template.subject,
        template.html,
        template.text,
        {
          userId: invoice.userId,
          sourcePipeline: 'TRANSACTIONAL',
          emailType: 'BILLING_INVOICE_ISSUED',
          templateId: 'INVOICE_ISSUED',
          correlationId,
          requestId,
          metadata: {
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            currency: invoice.currency,
            totalMinorUnits: invoice.totalMinorUnits,
            paymentId: invoice.paymentId
          }
        }
      );

      // 7. Verification & Logging
      if (dispatchResult.success) {
        appLogger.info('[BillingInvoiceNotification] Successfully dispatched invoice availability notification', {
          metadata: {
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            customerEmail,
            providerMessageId: dispatchResult.providerMessageId,
            transport: dispatchResult.transport
          }
        });
        return {
          sent: true,
          dispatchResult
        };
      } else {
        appLogger.warn('[BillingInvoiceNotification] Invoice notification delivery reported non-success (non-blocking)', {
          metadata: {
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            customerEmail,
            failureReason: dispatchResult.errorMessage,
            failureCode: dispatchResult.failureCode
          }
        });
        return {
          sent: false,
          dispatchResult,
          reason: 'DISPATCH_FAILED',
          error: dispatchResult.errorMessage
        };
      }
    } catch (err: any) {
      // 8. Total Failure Isolation: Never disrupt issuance or payment flow
      appLogger.warn('[BillingInvoiceNotification] Unexpected error in invoice notification service (isolated)', {
        metadata: {
          invoiceId: invoice?.id,
          error: err?.message || String(err)
        }
      });
      return {
        sent: false,
        reason: 'UNEXPECTED_ERROR',
        error: err?.message || String(err)
      };
    }
  }

  /**
   * Instance method proxy for dependency injection and testing.
   */
  public async sendInvoiceIssuedNotification(
    invoice: BillingInvoice,
    options?: InvoiceNotificationOptions
  ): Promise<InvoiceNotificationResult> {
    return BillingInvoiceNotificationService.sendInvoiceIssuedNotification(invoice, options);
  }
}

export const billingInvoiceNotificationService = new BillingInvoiceNotificationService();
