/**
 * Central Outbound Email Tracking & Lifecycle Persistence Service
 * Phase 13.2 Architecture
 */

import { prisma } from '../config/database.js';
import {
  EmailMessageStatus,
  EmailSourcePipeline,
  EmailTransport
} from '@prisma/client';
import { EmailDispatchResult } from './email.js';
import { RequestContextStore } from '../observability/request_context.js';
import { errorIngestionService } from './error_ingestion_service.js';
import {
  sanitizeSubject,
  sanitizeJsonPayload,
  sanitizeFailureReason,
  sanitizeTrackingId,
  sanitizeLogString
} from '../utils/email_sanitizer.js';

export interface RecordDirectOtpEmailParams {
  userId?: string | null;
  recipientEmail: string;
  recipientName?: string | null;
  emailType: string;
  templateId: string;
  subject: string;
  senderEmail?: string;
  senderName?: string;
  dispatchResult: EmailDispatchResult;
  requestId?: string | null;
  correlationId?: string | null;
  deviceId?: string | null;
  metadata?: Record<string, any>;
}

export interface RecordNotificationEmailParams {
  userId?: string | null;
  recipientEmail: string;
  recipientName?: string | null;
  notificationRecordId?: string | null;
  channelDeliveryRecordId?: string | null;
  emailType: string;
  templateId: string;
  subject: string;
  senderEmail?: string;
  senderName?: string;
  dispatchResult: EmailDispatchResult;
  requestId?: string | null;
  correlationId?: string | null;
  deviceId?: string | null;
  serverId?: string | null;
  metadata?: Record<string, any>;
  attemptNumber?: number;
}

export class EmailTrackingService {
  /**
   * Records a direct transactional/OTP email dispatch.
   * Completely fail-safe: any database persistence exception is logged without interrupting the auth flow.
   */
  public async recordDirectOtpEmail(params: RecordDirectOtpEmailParams): Promise<string | null> {
    const normalizedEmail = params.recipientEmail.trim().toLowerCase();
    const resolvedRequestId = sanitizeTrackingId(params.requestId || RequestContextStore.get()?.requestId || null);
    const resolvedCorrelationId = sanitizeTrackingId(params.correlationId);
    const resolvedDeviceId = sanitizeTrackingId(params.deviceId);
    const resolvedProviderMessageId = sanitizeTrackingId(params.dispatchResult.providerMessageId, 255);
    const sanitizedSubject = sanitizeSubject(params.subject);
    const sanitizedFailureReason = params.dispatchResult.errorMessage ? sanitizeFailureReason(params.dispatchResult.errorMessage) : null;
    const sanitizedProviderResponse = params.dispatchResult.providerResponse ? sanitizeJsonPayload(params.dispatchResult.providerResponse) : null;
    const sanitizedMetadata = params.metadata ? sanitizeJsonPayload(params.metadata) : null;
    const now = new Date();

    const status: EmailMessageStatus = params.dispatchResult.success
      ? EmailMessageStatus.SENT
      : EmailMessageStatus.FAILED;

    try {
      const emailRecord = await prisma.emailMessage.create({
        data: {
          userId: params.userId || null,
          emailType: params.emailType,
          templateId: params.templateId,
          recipientEmail: normalizedEmail,
          recipientName: params.recipientName || null,
          senderEmail: params.senderEmail || 'noreply@zdexcloud.com',
          senderName: params.senderName || 'ZdexCloud',
          subject: sanitizedSubject,
          sourcePipeline: EmailSourcePipeline.OTP,
          status,
          provider: params.dispatchResult.provider || 'BREVO',
          transport: (params.dispatchResult.transport as EmailTransport) || EmailTransport.BREVO_API,
          providerMessageId: resolvedProviderMessageId,
          providerResponseCode: params.dispatchResult.providerResponseCode || null,
          providerResponse: sanitizedProviderResponse,
          failureCode: params.dispatchResult.failureCode || null,
          failureReason: sanitizedFailureReason,
          attemptCount: 1,
          maxAttempts: 1,
          sentAt: params.dispatchResult.success ? now : null,
          failedAt: !params.dispatchResult.success ? now : null,
          lastAttemptAt: now,
          requestId: resolvedRequestId,
          correlationId: resolvedCorrelationId,
          deviceId: resolvedDeviceId,
          metadata: sanitizedMetadata,
          attempts: {
            create: {
              attemptNumber: 1,
              transport: (params.dispatchResult.transport as EmailTransport) || EmailTransport.BREVO_API,
              status,
              providerMessageId: resolvedProviderMessageId,
              providerResponseCode: params.dispatchResult.providerResponseCode || null,
              providerResponse: sanitizedProviderResponse,
              failureReason: sanitizedFailureReason,
              durationMs: params.dispatchResult.durationMs || null,
              attemptedAt: now
            }
          }
        }
      });

      if (!params.dispatchResult.success) {
        await errorIngestionService.ingest({
          component: 'EMAIL',
          severity: 'ERROR',
          errorCode: params.dispatchResult.failureCode || 'EMAIL_DIRECT_OTP_FAILED',
          errorType: 'EmailDispatchError',
          message: `Direct OTP email dispatch failed for template ${params.templateId}: ${sanitizedFailureReason || 'Unknown error'}`,
          requestId: resolvedRequestId || undefined,
          userId: params.userId || undefined,
          deviceId: resolvedDeviceId || undefined,
          metadata: {
            emailMessageId: emailRecord.id,
            emailType: params.emailType,
            templateId: params.templateId,
            transport: params.dispatchResult.transport || EmailTransport.BREVO_API,
            provider: params.dispatchResult.provider || 'BREVO',
            providerResponseCode: params.dispatchResult.providerResponseCode || null,
            failureCode: params.dispatchResult.failureCode || null,
            correlationId: resolvedCorrelationId || null
          }
        }).catch(() => {});
      }

      return emailRecord.id;
    } catch (err: any) {
      console.warn(`[EmailTrackingService] Failed to record direct OTP email for ${sanitizeLogString(normalizedEmail)}:`, sanitizeLogString(err?.message || err));
      return null;
    }
  }

  /**
   * Records a notification pipeline email dispatch.
   * Connects to existing NotificationRecord and ChannelDeliveryRecord.
   * If a retry occurs for the same ChannelDeliveryRecord, updates the existing EmailMessage and adds a new EmailDeliveryAttempt.
   */
  public async recordNotificationEmail(params: RecordNotificationEmailParams): Promise<string | null> {
    const normalizedEmail = params.recipientEmail.trim().toLowerCase();
    const resolvedRequestId = sanitizeTrackingId(params.requestId || RequestContextStore.get()?.requestId || null);
    const resolvedCorrelationId = sanitizeTrackingId(params.correlationId);
    const resolvedDeviceId = sanitizeTrackingId(params.deviceId);
    const resolvedServerId = sanitizeTrackingId(params.serverId);
    const resolvedProviderMessageId = sanitizeTrackingId(params.dispatchResult.providerMessageId, 255);
    const sanitizedSubject = sanitizeSubject(params.subject);
    const sanitizedFailureReason = params.dispatchResult.errorMessage ? sanitizeFailureReason(params.dispatchResult.errorMessage) : null;
    const sanitizedProviderResponse = params.dispatchResult.providerResponse ? sanitizeJsonPayload(params.dispatchResult.providerResponse) : null;
    const sanitizedMetadata = params.metadata ? sanitizeJsonPayload(params.metadata) : null;
    const now = new Date();

    const status: EmailMessageStatus = params.dispatchResult.success
      ? EmailMessageStatus.SENT
      : EmailMessageStatus.RETRYING;

    try {
      // Check if an existing EmailMessage is already tracked for this channel delivery
      if (params.channelDeliveryRecordId) {
        const existing = await prisma.emailMessage.findFirst({
          where: { channelDeliveryRecordId: params.channelDeliveryRecordId },
          include: { attempts: true }
        });

        if (existing) {
          const nextAttemptNumber = (params.attemptNumber || existing.attemptCount) + 1;
          const isFinalFailure = !params.dispatchResult.success && nextAttemptNumber >= existing.maxAttempts;
          const updatedStatus = params.dispatchResult.success
            ? EmailMessageStatus.SENT
            : isFinalFailure
            ? EmailMessageStatus.PERMANENTLY_FAILED
            : EmailMessageStatus.RETRYING;

          await prisma.emailMessage.update({
            where: { id: existing.id },
            data: {
              status: updatedStatus,
              provider: params.dispatchResult.provider || existing.provider,
              transport: (params.dispatchResult.transport as EmailTransport) || existing.transport,
              providerMessageId: resolvedProviderMessageId || existing.providerMessageId,
              providerResponseCode: params.dispatchResult.providerResponseCode || null,
              providerResponse: sanitizedProviderResponse || existing.providerResponse,
              failureReason: sanitizedFailureReason,
              attemptCount: nextAttemptNumber,
              lastAttemptAt: now,
              sentAt: params.dispatchResult.success ? (existing.sentAt || now) : existing.sentAt,
              failedAt: isFinalFailure ? now : existing.failedAt,
              attempts: {
                create: {
                  attemptNumber: nextAttemptNumber,
                  transport: (params.dispatchResult.transport as EmailTransport) || EmailTransport.BREVO_API,
                  status: params.dispatchResult.success ? EmailMessageStatus.SENT : EmailMessageStatus.FAILED,
                  providerMessageId: resolvedProviderMessageId,
                  providerResponseCode: params.dispatchResult.providerResponseCode || null,
                  providerResponse: sanitizedProviderResponse,
                  failureReason: sanitizedFailureReason,
                  durationMs: params.dispatchResult.durationMs || null,
                  attemptedAt: now
                }
              }
            }
          });

          if (isFinalFailure) {
            await errorIngestionService.ingest({
              component: 'EMAIL',
              severity: 'ERROR',
              errorCode: params.dispatchResult.failureCode || 'EMAIL_DELIVERY_PERMANENTLY_FAILED',
              errorType: 'EmailDeliveryExhaustedError',
              message: `Notification email delivery permanently failed after ${nextAttemptNumber} attempts for template ${existing.templateId}: ${sanitizedFailureReason || 'Max attempts exceeded'}`,
              requestId: resolvedRequestId || existing.requestId || undefined,
              userId: existing.userId || undefined,
              deviceId: resolvedDeviceId || existing.deviceId || undefined,
              metadata: {
                emailMessageId: existing.id,
                notificationRecordId: existing.notificationRecordId || null,
                channelDeliveryRecordId: existing.channelDeliveryRecordId || null,
                emailType: existing.emailType,
                templateId: existing.templateId,
                attemptCount: nextAttemptNumber,
                transport: params.dispatchResult.transport || existing.transport,
                provider: params.dispatchResult.provider || existing.provider,
                failureCode: params.dispatchResult.failureCode || null,
                correlationId: resolvedCorrelationId || existing.correlationId || null
              }
            }).catch(() => {});
          }

          return existing.id;
        }
      }

      // Initial creation for notification email
      const emailRecord = await prisma.emailMessage.create({
        data: {
          userId: params.userId || null,
          notificationRecordId: params.notificationRecordId || null,
          channelDeliveryRecordId: params.channelDeliveryRecordId || null,
          emailType: params.emailType,
          templateId: params.templateId,
          recipientEmail: normalizedEmail,
          recipientName: params.recipientName || null,
          senderEmail: params.senderEmail || 'noreply@zdexcloud.com',
          senderName: params.senderName || 'ZdexCloud',
          subject: sanitizedSubject,
          sourcePipeline: EmailSourcePipeline.NOTIFICATION,
          status,
          provider: params.dispatchResult.provider || 'BREVO',
          transport: (params.dispatchResult.transport as EmailTransport) || EmailTransport.BREVO_API,
          providerMessageId: resolvedProviderMessageId,
          providerResponseCode: params.dispatchResult.providerResponseCode || null,
          providerResponse: sanitizedProviderResponse,
          failureReason: sanitizedFailureReason,
          attemptCount: 1,
          maxAttempts: 5,
          sentAt: params.dispatchResult.success ? now : null,
          failedAt: !params.dispatchResult.success ? now : null,
          lastAttemptAt: now,
          requestId: resolvedRequestId,
          correlationId: resolvedCorrelationId,
          deviceId: resolvedDeviceId,
          serverId: resolvedServerId,
          metadata: sanitizedMetadata,
          attempts: {
            create: {
              attemptNumber: 1,
              transport: (params.dispatchResult.transport as EmailTransport) || EmailTransport.BREVO_API,
              status: params.dispatchResult.success ? EmailMessageStatus.SENT : EmailMessageStatus.FAILED,
              providerMessageId: resolvedProviderMessageId,
              providerResponseCode: params.dispatchResult.providerResponseCode || null,
              providerResponse: sanitizedProviderResponse,
              failureReason: sanitizedFailureReason,
              durationMs: params.dispatchResult.durationMs || null,
              attemptedAt: now
            }
          }
        }
      });

      return emailRecord.id;
    } catch (err: any) {
      console.warn(`[EmailTrackingService] Failed to record notification email for ${sanitizeLogString(normalizedEmail)}:`, sanitizeLogString(err?.message || err));
      return null;
    }
  }
}

export const emailTrackingService = new EmailTrackingService();
