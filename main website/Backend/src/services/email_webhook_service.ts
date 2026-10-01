/**
 * Brevo Transactional Email Webhook Ingestion & Delivery Synchronization Service
 * Phase 13.9 Architecture
 */

import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { config } from '../config/env.js';
import {
  EmailMessageStatus,
  ChannelDeliveryStatus
} from '@prisma/client';
import { errorIngestionService } from './error_ingestion_service.js';
import { RequestContextStore } from '../observability/request_context.js';
import {
  sanitizeSubject,
  sanitizeJsonPayload,
  sanitizeFailureReason,
  sanitizeEngagementUrl,
  sanitizeLogString,
  sanitizeTrackingId
} from '../utils/email_sanitizer.js';

/**
 * Brevo Transactional Event Types
 */
export enum BrevoEventType {
  REQUEST = 'request',
  SENT = 'sent',
  DELIVERED = 'delivered',
  DEFERRED = 'deferred',
  SOFT_BOUNCE = 'soft_bounce',
  HARD_BOUNCE = 'hard_bounce',
  BLOCKED = 'blocked',
  SPAM = 'spam',
  INVALID_EMAIL = 'invalid_email',
  ERROR = 'error',
  UNSUBSCRIBED = 'unsubscribed',
  OPENED = 'opened',
  UNIQUE_OPENED = 'unique_opened',
  CLICKED = 'clicked',
  PROXY_OPEN = 'proxy_open',
  UNIQUE_PROXY_OPEN = 'unique_proxy_open'
}

/**
 * Schema for a single Brevo Webhook Event Payload
 */
export const brevoWebhookEventSchema = z.object({
  event: z.string().trim().min(1),
  email: z.string().trim().email(),
  'message-id': z.string().trim().optional(),
  message_id: z.string().trim().optional(),
  id: z.union([z.string(), z.number()]).optional(),
  date: z.string().trim().optional(),
  ts: z.union([z.number(), z.string()]).optional(),
  ts_event: z.union([z.number(), z.string()]).optional(),
  ts_epoch: z.union([z.number(), z.string()]).optional(),
  subject: z.string().trim().optional(),
  reason: z.string().trim().max(1000).optional(),
  tag: z.union([z.string(), z.array(z.string())]).optional(),
  link: z.string().trim().max(2048).optional(),
  ip: z.string().trim().max(100).optional(),
  user_agent: z.string().trim().max(500).optional(),
  template_id: z.union([z.number(), z.string()]).optional()
}).passthrough();

export type BrevoWebhookEvent = z.infer<typeof brevoWebhookEventSchema>;

export const brevoWebhookPayloadSchema = z.union([
  brevoWebhookEventSchema,
  z.array(brevoWebhookEventSchema)
]);

export interface WebhookProcessResult {
  success: boolean;
  matched: boolean;
  duplicate: boolean;
  event: string;
  emailMessageId?: string | null;
  providerMessageId?: string | null;
  previousStatus?: string | null;
  currentStatus?: string | null;
  message?: string;
}

/**
 * State Monotonicity & Precedence Map
 * Higher numbers represent more authoritative/terminal states.
 */
const STATUS_PRECEDENCE: Record<EmailMessageStatus, number> = {
  [EmailMessageStatus.QUEUED]: 0,
  [EmailMessageStatus.SENT]: 1,
  [EmailMessageStatus.RETRYING]: 2,
  [EmailMessageStatus.DEFERRED]: 2,
  [EmailMessageStatus.DELIVERED]: 3,
  [EmailMessageStatus.BOUNCED]: 3,
  [EmailMessageStatus.BLOCKED]: 3,
  [EmailMessageStatus.SPAM]: 3,
  [EmailMessageStatus.FAILED]: 3,
  [EmailMessageStatus.PERMANENTLY_FAILED]: 3
};

export class EmailWebhookService {
  /**
   * Timing-safe verification of webhook shared secret
   */
  public static verifyWebhookSecret(providedSecret?: string | null): boolean {
    const configuredSecret = (process.env.BREVO_WEBHOOK_SECRET || config.BREVO_WEBHOOK_SECRET || '').trim();

    // If no secret is configured in dev/test, allow; in production fail closed
    if (!configuredSecret) {
      if (process.env.NODE_ENV === 'production') {
        console.warn('[EmailWebhookService] Rejecting webhook: BREVO_WEBHOOK_SECRET is not configured in production.');
        return false;
      }
      return true;
    }

    if (!providedSecret) {
      return false;
    }

    try {
      const providedBuffer = Buffer.from(providedSecret.trim());
      const configuredBuffer = Buffer.from(configuredSecret);

      if (providedBuffer.length !== configuredBuffer.length) {
        return false;
      }

      return crypto.timingSafeEqual(providedBuffer, configuredBuffer);
    } catch {
      return false;
    }
  }

  /**
   * Normalizes Brevo event string to internal EmailMessageStatus or Engagement indicator
   */
  public static normalizeBrevoEvent(eventStr: string): {
    status?: EmailMessageStatus;
    isEngagement: boolean;
    engagementType?: 'opened' | 'clicked' | 'unsubscribed';
  } {
    const normalized = eventStr.toLowerCase().trim();

    switch (normalized) {
      case 'request':
      case 'sent':
        return { status: EmailMessageStatus.SENT, isEngagement: false };

      case 'delivered':
        return { status: EmailMessageStatus.DELIVERED, isEngagement: false };

      case 'deferred':
        return { status: EmailMessageStatus.DEFERRED, isEngagement: false };

      case 'soft_bounce':
      case 'hard_bounce':
        return { status: EmailMessageStatus.BOUNCED, isEngagement: false };

      case 'blocked':
        return { status: EmailMessageStatus.BLOCKED, isEngagement: false };

      case 'spam':
        return { status: EmailMessageStatus.SPAM, isEngagement: false };

      case 'invalid_email':
      case 'error':
        return { status: EmailMessageStatus.FAILED, isEngagement: false };

      case 'opened':
      case 'unique_opened':
      case 'proxy_open':
      case 'unique_proxy_open':
        return { isEngagement: true, engagementType: 'opened' };

      case 'clicked':
        return { isEngagement: true, engagementType: 'clicked' };

      case 'unsubscribed':
        return { isEngagement: true, engagementType: 'unsubscribed' };

      default:
        return { isEngagement: false };
    }
  }

  /**
   * Parses and normalizes Brevo event timestamp to Date
   */
  public static normalizeEventTimestamp(payload: BrevoWebhookEvent): Date {
    // 1. ts_event (seconds)
    if (payload.ts_event) {
      const sec = Number(payload.ts_event);
      if (!isNaN(sec) && sec > 0) return new Date(sec * 1000);
    }

    // 2. ts_epoch (milliseconds)
    if (payload.ts_epoch) {
      const ms = Number(payload.ts_epoch);
      if (!isNaN(ms) && ms > 0) return new Date(ms);
    }

    // 3. ts (seconds)
    if (payload.ts) {
      const sec = Number(payload.ts);
      if (!isNaN(sec) && sec > 0) return new Date(sec * 1000);
    }

    // 4. date string (e.g. '2026-10-01 14:00:00')
    if (payload.date) {
      const parsed = new Date(payload.date);
      if (!isNaN(parsed.getTime())) return parsed;
    }

    return new Date();
  }

  /**
   * Processes an incoming verified Brevo transactional webhook payload
   */
  public static async processWebhookPayload(
    rawPayload: unknown,
    requestId?: string | null
  ): Promise<WebhookProcessResult[]> {
    const parseResult = brevoWebhookPayloadSchema.safeParse(rawPayload);
    if (!parseResult.success) {
      const errorMsg = parseResult.error.errors[0]?.message || 'Invalid Brevo webhook payload structure';
      console.warn(`[EmailWebhookService] Malformed webhook rejected: ${errorMsg}`);
      
      // Ingest malformed webhook error into Error Center
      await errorIngestionService.ingest({
        component: 'EMAIL',
        severity: 'WARNING',
        errorCode: 'BREVO_WEBHOOK_MALFORMED',
        errorType: 'ValidationError',
        message: `Malformed Brevo webhook payload: ${errorMsg}`,
        requestId: requestId || RequestContextStore.get()?.requestId
      }).catch(() => {});

      throw new Error(errorMsg);
    }

    const events: BrevoWebhookEvent[] = Array.isArray(parseResult.data)
      ? parseResult.data
      : [parseResult.data];

    const results: WebhookProcessResult[] = [];

    for (const event of events) {
      const result = await this.processSingleEvent(event, requestId);
      results.push(result);
    }

    return results;
  }

  /**
   * Reconciles a single Brevo transactional event against EmailMessage and ChannelDeliveryRecord
   */
  private static async processSingleEvent(
    event: BrevoWebhookEvent,
    requestId?: string | null
  ): Promise<WebhookProcessResult> {
    const rawMessageId = event['message-id'] || event.message_id || (event.id ? String(event.id) : undefined);
    const eventType = event.event.trim().toLowerCase();
    const eventDate = this.normalizeEventTimestamp(event);

    if (!rawMessageId) {
      console.warn(`[EmailWebhookService] Webhook event '${sanitizeLogString(eventType)}' missing message-id for recipient: ${sanitizeLogString(event.email)}`);
      return {
        success: true,
        matched: false,
        duplicate: false,
        event: eventType,
        message: 'Omitted message-id acknowledged'
      };
    }

    const cleanMessageId = rawMessageId.trim().replace(/^<|>$/g, '');
    const recipientEmail = event.email.trim().toLowerCase();

    try {
      // 1. Authoritative Lookup by providerMessageId for BREVO provider
      const emailMessage = await prisma.emailMessage.findFirst({
        where: {
          OR: [
            { providerMessageId: cleanMessageId },
            { providerMessageId: `<${cleanMessageId}>` },
            { providerMessageId: rawMessageId.trim() }
          ],
          provider: 'BREVO'
        },
        include: { attempts: true }
      });

      if (!emailMessage) {
        console.log(`[EmailWebhookService] Unmatched providerMessageId: ${sanitizeLogString(cleanMessageId)} (recipient: ${sanitizeLogString(recipientEmail)}, event: ${sanitizeLogString(eventType)})`);
        return {
          success: true,
          matched: false,
          duplicate: false,
          event: eventType,
          providerMessageId: cleanMessageId,
          message: 'Unmatched providerMessageId acknowledged'
        };
      }

      // 2. Idempotency Check
      const existingMetadata = (emailMessage.metadata as Record<string, any>) || {};
      const processedEvents: Array<{ eventId: string; event: string; at: string }> = Array.isArray(existingMetadata.processedEvents)
        ? existingMetadata.processedEvents
        : [];

      const derivedEventId = `${cleanMessageId}_${eventType}_${eventDate.getTime()}`;
      const isDuplicate = processedEvents.some(e => e.eventId === derivedEventId || (e.event === eventType && e.at === eventDate.toISOString()));

      if (isDuplicate) {
        return {
          success: true,
          matched: true,
          duplicate: true,
          event: eventType,
          emailMessageId: emailMessage.id,
          providerMessageId: cleanMessageId,
          previousStatus: emailMessage.status,
          currentStatus: emailMessage.status,
          message: 'Duplicate event acknowledged'
        };
      }

      // 3. Event Normalization & State Monotonicity
      const normalized = this.normalizeBrevoEvent(eventType);
      let targetStatus = emailMessage.status;
      let statusChanged = false;

      if (normalized.status) {
        const currentRank = STATUS_PRECEDENCE[emailMessage.status] ?? 0;
        const targetRank = STATUS_PRECEDENCE[normalized.status] ?? 0;

        // Monotonicity Rule: Do not regress from terminal (DELIVERED, BOUNCED, BLOCKED, SPAM, FAILED)
        if (targetRank >= currentRank) {
          // Additional safety: If already DELIVERED, do not overwrite with DEFERRED or SENT
          if (emailMessage.status === EmailMessageStatus.DELIVERED && normalized.status !== EmailMessageStatus.DELIVERED) {
            targetStatus = emailMessage.status;
          } else {
            targetStatus = normalized.status;
            statusChanged = (targetStatus !== emailMessage.status);
          }
        }
      }

      // 4. Update Metadata with sanitized provider info (zero secrets)
      const updatedMetadata: Record<string, any> = {
        ...existingMetadata,
        lastProviderEvent: eventType,
        lastProviderEventAt: eventDate.toISOString(),
        processedEvents: [
          ...processedEvents.slice(-20), // Keep last 20 events
          { eventId: derivedEventId, event: eventType, at: eventDate.toISOString() }
        ]
      };

      if (normalized.isEngagement) {
        if (normalized.engagementType === 'opened') {
          updatedMetadata.openedAt = updatedMetadata.openedAt || eventDate.toISOString();
          updatedMetadata.lastOpenedAt = eventDate.toISOString();
          updatedMetadata.openCount = (updatedMetadata.openCount || 0) + 1;
        } else if (normalized.engagementType === 'clicked') {
          updatedMetadata.clickedAt = updatedMetadata.clickedAt || eventDate.toISOString();
          updatedMetadata.lastClickedAt = eventDate.toISOString();
          updatedMetadata.clickCount = (updatedMetadata.clickCount || 0) + 1;
          if (event.link) {
            updatedMetadata.lastClickedUrl = sanitizeEngagementUrl(event.link);
          }
        }
      }

      // Safe reason capture for bounce/block/error
      const failureReason = event.reason ? sanitizeFailureReason(event.reason) : emailMessage.failureReason;

      // 5. Database Update on EmailMessage
      const updateData: any = {
        status: targetStatus,
        metadata: sanitizeJsonPayload(updatedMetadata),
        failureReason
      };

      if (targetStatus === EmailMessageStatus.DELIVERED && !emailMessage.deliveredAt) {
        updateData.deliveredAt = eventDate;
      }

      if ((targetStatus === EmailMessageStatus.BOUNCED || targetStatus === EmailMessageStatus.BLOCKED || targetStatus === EmailMessageStatus.FAILED) && !emailMessage.failedAt) {
        updateData.failedAt = eventDate;
      }

      // If a webhook brings a subject, sanitize before considering (preserves existing clean subject)
      if (event.subject && !emailMessage.subject) {
        updateData.subject = sanitizeSubject(event.subject);
      }

      await prisma.emailMessage.update({
        where: { id: emailMessage.id },
        data: updateData
      });

      // 6. Record Delivery Attempt if status changed or failure/deferred reported
      if (statusChanged && (targetStatus === EmailMessageStatus.BOUNCED || targetStatus === EmailMessageStatus.BLOCKED || targetStatus === EmailMessageStatus.DEFERRED || targetStatus === EmailMessageStatus.FAILED)) {
        await prisma.emailDeliveryAttempt.create({
          data: {
            emailMessageId: emailMessage.id,
            attemptNumber: emailMessage.attemptCount,
            transport: emailMessage.transport,
            status: targetStatus,
            providerMessageId: cleanMessageId,
            providerResponseCode: eventType,
            providerResponse: sanitizeJsonPayload({ event: eventType, timestamp: eventDate.toISOString() }),
            failureReason,
            attemptedAt: eventDate
          }
        }).catch(() => {});
      }

      // 7. ChannelDeliveryRecord Synchronization (if linked to central notification pipeline)
      if (emailMessage.channelDeliveryRecordId) {
        try {
          if (targetStatus === EmailMessageStatus.DELIVERED) {
            await prisma.channelDeliveryRecord.update({
              where: { id: emailMessage.channelDeliveryRecordId },
              data: {
                status: ChannelDeliveryStatus.DELIVERED,
                deliveredAt: eventDate
              }
            });
          } else if (targetStatus === EmailMessageStatus.BOUNCED || targetStatus === EmailMessageStatus.BLOCKED || targetStatus === EmailMessageStatus.SPAM) {
            await prisma.channelDeliveryRecord.update({
              where: { id: emailMessage.channelDeliveryRecordId },
              data: {
                status: ChannelDeliveryStatus.FAILED,
                failedAt: eventDate,
                failureReason: `Brevo webhook: ${eventType} (${failureReason || 'Terminal rejection'})`
              }
            });
          }
        } catch (cdrErr) {
          console.warn(`[EmailWebhookService] Failed to synchronize ChannelDeliveryRecord ${emailMessage.channelDeliveryRecordId}:`, cdrErr);
        }
      }

      return {
        success: true,
        matched: true,
        duplicate: false,
        event: eventType,
        emailMessageId: emailMessage.id,
        providerMessageId: cleanMessageId,
        previousStatus: emailMessage.status,
        currentStatus: targetStatus
      };
    } catch (err: any) {
      console.error(`[EmailWebhookService] Processing error for messageId ${sanitizeLogString(cleanMessageId)}:`, sanitizeLogString(err?.message || err));

      await errorIngestionService.ingest({
        error: err,
        component: 'EMAIL',
        severity: 'ERROR',
        errorCode: 'BREVO_WEBHOOK_PROCESSING_FAILED',
        errorType: err.name || 'WebhookProcessingError',
        message: `Failed to reconcile Brevo webhook event '${sanitizeLogString(eventType)}' for providerMessageId: ${sanitizeLogString(cleanMessageId)}`,
        requestId: requestId || RequestContextStore.get()?.requestId,
        metadata: {
          eventType: sanitizeLogString(eventType),
          providerMessageId: sanitizeLogString(cleanMessageId)
        }
      }).catch(() => {});

      throw err;
    }
  }
}
