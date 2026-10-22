/**
 * ZdexCloud Admin Billing Notification Operations Service
 * Phase 8.4 Batch E.5 Architecture
 *
 * Implements backend-authoritative administrative operations for inspecting and reconciling
 * invoice notification outbox records and staged provider webhook events.
 */

import {
  AdminAuditAction,
  InvoiceNotificationOutboxStatus,
  EmailWebhookInboxStatus,
  EmailMessageStatus,
  Prisma
} from '@prisma/client';
import { prisma } from '../../../../config/database.js';
import { NotFoundError, ConflictError, ValidationError } from '../../../../errors/app-error.js';
import { executeAdminOperation } from '../utils/operation_executor.js';
import { AdminOperationContext, PaginatedResult } from '../types.js';
import {
  AdminInvoiceNotificationListQuery,
  AdminWebhookInboxListQuery,
  AdminForceMarkDispatchedInput,
  AdminAuthorizeResendInput
} from './notifications_schemas.js';
import { sanitizeJsonPayload, sanitizeFailureReason } from '../../../../utils/email_sanitizer.js';

export class AdminInvoiceNotificationService {
  /**
   * Lists customer invoice notification outbox records with multi-column filtering and bounded pagination.
   */
  static async listNotifications(
    query: AdminInvoiceNotificationListQuery
  ): Promise<PaginatedResult<any>> {
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize || 20));
    const skip = (page - 1) * pageSize;

    const whereConditions: string[] = ['1=1'];
    const queryParams: any[] = [];

    if (query.status) {
      whereConditions.push('`status` = ?');
      queryParams.push(query.status);
    }
    if (query.invoiceId) {
      whereConditions.push('`invoiceId` = ?');
      queryParams.push(query.invoiceId);
    }
    if (query.invoiceNumber) {
      whereConditions.push('`invoiceNumber` = ?');
      queryParams.push(query.invoiceNumber);
    }
    if (query.userId) {
      whereConditions.push('`userId` = ?');
      queryParams.push(query.userId);
    }
    if (query.recipientEmail) {
      whereConditions.push('`recipientEmail` = ?');
      queryParams.push(query.recipientEmail.toLowerCase());
    }
    if (query.startDate) {
      whereConditions.push('`createdAt` >= ?');
      queryParams.push(new Date(query.startDate));
    }
    if (query.endDate) {
      whereConditions.push('`createdAt` <= ?');
      queryParams.push(new Date(query.endDate));
    }

    const whereClause = whereConditions.join(' AND ');

    // Count total matching
    const countRes = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*) as count FROM \`InvoiceNotificationOutbox\` WHERE ${whereClause}`,
      ...queryParams
    );
    const total = Number(countRes[0]?.count || 0);

    // Fetch page items
    const items = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT \`id\`, \`invoiceId\`, \`userId\`, \`notificationType\`, \`recipientEmail\`,
              \`recipientName\`, \`documentTitle\`, \`invoiceNumber\`, \`currency\`,
              \`totalMinorUnits\`, \`status\`, \`attemptCount\`, \`maxAttempts\`,
              \`lastAttemptAt\`, \`nextAttemptAt\`, \`claimedBy\`, \`claimedAt\`,
              \`claimExpiresAt\`, \`transportStartedAt\`, \`provider\`, \`providerMessageId\`,
              \`emailMessageId\`, \`dispatchedAt\`, \`deliveredAt\`, \`failedAt\`,
              \`failureCode\`, \`failureReason\`, \`ambiguousAt\`, \`ambiguousReason\`,
              \`resendAuthorized\`, \`resendAuthorizedBy\`, \`resendAuthorizedAt\`,
              \`resendAuthorizationCount\`, \`resendReason\`, \`createdAt\`, \`updatedAt\`
       FROM \`InvoiceNotificationOutbox\`
       WHERE ${whereClause}
       ORDER BY \`createdAt\` DESC
       LIMIT ? OFFSET ?`,
      ...queryParams,
      pageSize,
      skip
    );

    const totalPages = Math.ceil(total / pageSize);

    return {
      items: items.map((r) => ({
        ...r,
        totalMinorUnits: Number(r.totalMinorUnits),
        attemptCount: Number(r.attemptCount),
        maxAttempts: Number(r.maxAttempts),
        resendAuthorizationCount: Number(r.resendAuthorizationCount)
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages
      },
      total,
      page,
      pageSize,
      totalPages
    };
  }

  /**
   * Retrieves detailed inspection state of a single invoice notification outbox record,
   * including linked email messages and staged webhook events.
   */
  static async getNotificationDetail(id: string): Promise<any> {
    const records = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT * FROM \`InvoiceNotificationOutbox\` WHERE \`id\` = ?`,
      id
    );

    if (records.length === 0) {
      throw new NotFoundError(`Invoice notification outbox record '${id}' not found`);
    }

    const outbox = records[0];

    // Fetch linked EmailWebhookInbox records
    const cleanMsgId = outbox.providerMessageId ? outbox.providerMessageId.replace(/^<|>$/g, '').trim() : null;
    let webhooks: any[] = [];

    if (cleanMsgId) {
      webhooks = await prisma.$queryRawUnsafe<Array<any>>(
        `SELECT \`id\`, \`provider\`, \`eventId\`, \`eventType\`, \`providerMessageId\`,
                \`recipientEmail\`, \`eventTimestamp\`, \`receivedAt\`, \`status\`,
                \`reconciledAt\`, \`processingAttempts\`, \`lastError\`, \`createdAt\`
         FROM \`EmailWebhookInbox\`
         WHERE \`matchedOutboxId\` = ? OR \`providerMessageId\` = ?
         ORDER BY \`createdAt\` DESC
         LIMIT 20`,
        outbox.id,
        cleanMsgId
      );
    } else {
      webhooks = await prisma.$queryRawUnsafe<Array<any>>(
        `SELECT \`id\`, \`provider\`, \`eventId\`, \`eventType\`, \`providerMessageId\`,
                \`recipientEmail\`, \`eventTimestamp\`, \`receivedAt\`, \`status\`,
                \`reconciledAt\`, \`processingAttempts\`, \`lastError\`, \`createdAt\`
         FROM \`EmailWebhookInbox\`
         WHERE \`matchedOutboxId\` = ?
         ORDER BY \`createdAt\` DESC
         LIMIT 20`,
        outbox.id
      );
    }

    // Fetch linked EmailMessage record
    let linkedEmailMessage: any = null;
    if (outbox.emailMessageId) {
      linkedEmailMessage = await prisma.emailMessage.findUnique({
        where: { id: outbox.emailMessageId },
        select: {
          id: true,
          status: true,
          attemptCount: true,
          provider: true,
          providerMessageId: true,
          sentAt: true,
          deliveredAt: true,
          failedAt: true,
          failureCode: true,
          failureReason: true,
          createdAt: true
        }
      });
    }

    return {
      notification: {
        ...outbox,
        totalMinorUnits: Number(outbox.totalMinorUnits),
        attemptCount: Number(outbox.attemptCount),
        maxAttempts: Number(outbox.maxAttempts),
        resendAuthorizationCount: Number(outbox.resendAuthorizationCount),
        metadata: typeof outbox.metadata === 'string' ? JSON.parse(outbox.metadata || '{}') : (outbox.metadata || {})
      },
      linkedEmailMessage,
      associatedWebhooks: webhooks.map((w) => ({
        ...w,
        processingAttempts: Number(w.processingAttempts)
      }))
    };
  }

  /**
   * Lists staged EmailWebhookInbox records with multi-column filtering and bounded pagination.
   */
  static async listWebhookInbox(
    query: AdminWebhookInboxListQuery
  ): Promise<PaginatedResult<any>> {
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize || 20));
    const skip = (page - 1) * pageSize;

    const whereConditions: string[] = ['1=1'];
    const queryParams: any[] = [];

    if (query.status) {
      whereConditions.push('`status` = ?');
      queryParams.push(query.status);
    }
    if (query.eventType) {
      whereConditions.push('`eventType` = ?');
      queryParams.push(query.eventType.toLowerCase().trim());
    }
    if (query.providerMessageId) {
      const cleanId = query.providerMessageId.replace(/^<|>$/g, '').trim();
      whereConditions.push('`providerMessageId` = ?');
      queryParams.push(cleanId);
    }
    if (query.recipientEmail) {
      whereConditions.push('`recipientEmail` = ?');
      queryParams.push(query.recipientEmail.toLowerCase().trim());
    }
    if (query.startDate) {
      whereConditions.push('`createdAt` >= ?');
      queryParams.push(new Date(query.startDate));
    }
    if (query.endDate) {
      whereConditions.push('`createdAt` <= ?');
      queryParams.push(new Date(query.endDate));
    }

    const whereClause = whereConditions.join(' AND ');

    const countRes = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*) as count FROM \`EmailWebhookInbox\` WHERE ${whereClause}`,
      ...queryParams
    );
    const total = Number(countRes[0]?.count || 0);

    const items = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT \`id\`, \`provider\`, \`eventId\`, \`eventType\`, \`providerMessageId\`,
              \`recipientEmail\`, \`eventTimestamp\`, \`receivedAt\`, \`status\`,
              \`matchedEmailMessageId\`, \`matchedOutboxId\`, \`reconciledAt\`,
              \`processingAttempts\`, \`lastError\`, \`createdAt\`, \`updatedAt\`
       FROM \`EmailWebhookInbox\`
       WHERE ${whereClause}
       ORDER BY \`createdAt\` DESC
       LIMIT ? OFFSET ?`,
      ...queryParams,
      pageSize,
      skip
    );

    const totalPages = Math.ceil(total / pageSize);

    return {
      items: items.map((r) => ({
        ...r,
        processingAttempts: Number(r.processingAttempts)
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages
      },
      total,
      page,
      pageSize,
      totalPages
    };
  }

  /**
   * Retrieves full detailed view of a single staged webhook inbox event, including sanitized payload.
   */
  static async getWebhookInboxDetail(id: string): Promise<any> {
    const records = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT * FROM \`EmailWebhookInbox\` WHERE \`id\` = ?`,
      id
    );

    if (records.length === 0) {
      throw new NotFoundError(`Email webhook inbox record '${id}' not found`);
    }

    const item = records[0];
    const rawPayload = typeof item.rawPayload === 'string'
      ? JSON.parse(item.rawPayload)
      : item.rawPayload;

    return {
      webhook: {
        ...item,
        processingAttempts: Number(item.processingAttempts),
        rawPayload: sanitizeJsonPayload(rawPayload)
      }
    };
  }

  /**
   * FORCE_MARK_DISPATCHED
   * Operator administrative mutation: Marks a notification as DISPATCHED following out-of-band verification.
   *
   * Invariants:
   * - Enforces requireOperationPermission('billing.reconcile').
   * - Marks status as DISPATCHED, NEVER as DELIVERED without provider delivery proof.
   * - Does NOT send real emails or contact provider API.
   * - Idempotent if already DISPATCHED.
   * - Rejects contradictory transitions (e.g. from DELIVERED or PENDING).
   * - Cryptographically logged via executeAdminOperation with fail-closed audit trail.
   */
  static async forceMarkDispatched(
    id: string,
    input: AdminForceMarkDispatchedInput,
    context: AdminOperationContext
  ): Promise<any> {
    const existingRows = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT * FROM \`InvoiceNotificationOutbox\` WHERE \`id\` = ?`,
      id
    );

    if (existingRows.length === 0) {
      throw new NotFoundError(`Invoice notification outbox record '${id}' not found`);
    }

    const outbox = existingRows[0];
    const priorStatus = outbox.status as InvoiceNotificationOutboxStatus;

    if (priorStatus === InvoiceNotificationOutboxStatus.DISPATCHED) {
      return {
        success: true,
        message: 'Notification is already DISPATCHED; no state change required',
        outboxId: outbox.id,
        invoiceNumber: outbox.invoiceNumber,
        status: priorStatus
      };
    }

    if (priorStatus === InvoiceNotificationOutboxStatus.PERMANENT_FAILURE) {
      throw new ConflictError('Cannot force-mark as DISPATCHED: notification is in terminal PERMANENT_FAILURE. Use AUTHORIZE_RESEND if re-sending to a corrected address.');
    }

    if (priorStatus === InvoiceNotificationOutboxStatus.EXHAUSTED) {
      throw new ConflictError('Cannot force-mark as DISPATCHED: notification attempts are EXHAUSTED. Use AUTHORIZE_RESEND to queue a new dispatch attempt.');
    }

    if (priorStatus === InvoiceNotificationOutboxStatus.DELIVERED) {
      throw new ConflictError('Cannot force-mark as DISPATCHED: notification is already confirmed DELIVERED');
    }

    if (priorStatus === InvoiceNotificationOutboxStatus.PENDING) {
      throw new ConflictError('Cannot force-mark as DISPATCHED: notification has not yet been processed by worker');
    }

    const trimmedId = input.providerMessageId.trim();
    if (!/^[a-zA-Z0-9<>\-_@.]+$/.test(trimmedId)) {
      throw new ValidationError('Invalid providerMessageId format: contains unsupported characters');
    }
    const cleanId = trimmedId.replace(/^<|>$/g, '');

    // Task B: Verify evidence against existing persisted records (EmailWebhookInbox or EmailMessage)
    // Fail-closed: An unverified operator assertion cannot establish provider acceptance.
    const webhookEvidence = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT \`id\`, \`provider\`, \`eventType\`, \`providerMessageId\`, \`recipientEmail\`
       FROM \`EmailWebhookInbox\`
       WHERE (\`providerMessageId\` = ? OR \`providerMessageId\` = ?)
         AND (\`recipientEmail\` = ? OR \`matchedOutboxId\` = ?)
       LIMIT 1`,
      cleanId,
      `<${cleanId}>`,
      outbox.recipientEmail,
      outbox.id
    );

    const emailEvidence = webhookEvidence.length === 0
      ? await prisma.emailMessage.findFirst({
          where: {
            OR: [
              { providerMessageId: cleanId },
              { providerMessageId: `<${cleanId}>` }
            ],
            recipientEmail: outbox.recipientEmail
          },
          select: { id: true, provider: true, providerMessageId: true, status: true }
        })
      : null;

    if (webhookEvidence.length === 0 && !emailEvidence) {
      throw new ConflictError(
        `Cannot force-mark as DISPATCHED: No persisted provider evidence found in EmailWebhookInbox or EmailMessage matching providerMessageId '${cleanId}' for recipient '${outbox.recipientEmail}'. Unverified operator assertions are rejected.`
      );
    }

    const evidenceType = webhookEvidence.length > 0 ? 'EMAIL_WEBHOOK_INBOX' : 'EMAIL_MESSAGE';
    const evidenceRecordId = webhookEvidence.length > 0 ? webhookEvidence[0].id : emailEvidence?.id;

    const effectiveProviderMessageId = cleanId;

    return executeAdminOperation({
      operationName: 'admin_force_mark_invoice_notification_dispatched',
      targetResourceType: 'invoice_notification_outbox',
      targetResourceId: outbox.id,
      context,
      action: AdminAuditAction.ADMIN_STATUS_UPDATED,
      metadata: {
        outboxId: outbox.id,
        invoiceNumber: outbox.invoiceNumber,
        priorStatus,
        resultingStatus: InvoiceNotificationOutboxStatus.DISPATCHED,
        operatorReason: input.reason,
        providerMessageId: effectiveProviderMessageId,
        evidenceType,
        evidenceRecordId
      },
      execute: async (tx) => {
        const existingMeta = typeof outbox.metadata === 'string'
          ? JSON.parse(outbox.metadata || '{}')
          : (outbox.metadata || {});

        const updatedMeta = sanitizeJsonPayload({
          ...existingMeta,
          forceMarkDispatched: {
            operatorId: context.adminId,
            operatorEmail: context.adminEmail,
            reason: input.reason,
            priorStatus,
            providerMessageId: effectiveProviderMessageId,
            verifiedEvidence: {
              source: evidenceType,
              recordId: evidenceRecordId
            },
            priorAmbiguousReason: outbox.ambiguousReason || null,
            priorFailureCode: outbox.failureCode || null,
            priorFailureReason: outbox.failureReason || null,
            at: new Date().toISOString()
          }
        });

        const updateCount = await tx.$executeRawUnsafe(
          `UPDATE \`InvoiceNotificationOutbox\`
           SET \`status\` = 'DISPATCHED',
               \`dispatchedAt\` = COALESCE(\`dispatchedAt\`, NOW(3)),
               \`providerMessageId\` = ?,
               \`ambiguousAt\` = NULL,
               \`ambiguousReason\` = NULL,
               \`failureCode\` = NULL,
               \`failureReason\` = NULL,
               \`metadata\` = ?,
               \`updatedAt\` = NOW(3)
           WHERE \`id\` = ? AND \`status\` = ?`,
          effectiveProviderMessageId,
          JSON.stringify(updatedMeta),
          outbox.id,
          priorStatus
        );

        if (updateCount === 0) {
          throw new ConflictError('Notification state was concurrently modified; force-mark rejected');
        }

        return {
          success: true,
          message: 'Notification successfully force-marked as DISPATCHED with verified persisted provider evidence',
          outboxId: outbox.id,
          invoiceNumber: outbox.invoiceNumber,
          priorStatus,
          status: InvoiceNotificationOutboxStatus.DISPATCHED,
          providerMessageId: effectiveProviderMessageId,
          evidence: {
            type: evidenceType,
            recordId: evidenceRecordId
          }
        };
      }
    });
  }

  /**
   * AUTHORIZE_RESEND
   * Operator administrative mutation: Explicitly authorizes a resend for an ambiguous, failed, or exhausted notification.
   *
   * Invariants:
   * - Enforces requireOperationPermission('billing.write').
   * - Authorization is strictly separated from dispatch: resets status to PENDING for normal single-owner worker pickup.
   * - NEVER triggers direct network send in the request handler.
   * - Preserves original statutory invoice number, tax calculation, totalMinorUnits, and currency.
   * - Never creates duplicate statutory invoices.
   * - Preserves durable history of prior attempt (attemptNumber, transportStartedAt, ambiguousReason, previousProviderMessageIds).
   * - Rejects re-authorizing actively pending, claimed, or already delivered notifications.
   * - Uses atomic optimistic fencing (WHERE status = :prior AND claimVersion = :expectedVersion) to prevent duplicate authorization races.
   * - Cryptographically logged via executeAdminOperation with fail-closed audit trail.
   */
  static async authorizeResend(
    id: string,
    input: AdminAuthorizeResendInput,
    context: AdminOperationContext
  ): Promise<any> {
    const existingRows = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT * FROM \`InvoiceNotificationOutbox\` WHERE \`id\` = ?`,
      id
    );

    if (existingRows.length === 0) {
      throw new NotFoundError(`Invoice notification outbox record '${id}' not found`);
    }

    const outbox = existingRows[0];
    const priorStatus = outbox.status as InvoiceNotificationOutboxStatus;
    const currentClaimVersion = BigInt(outbox.claimVersion ?? 0);

    if (priorStatus === InvoiceNotificationOutboxStatus.PENDING ||
        priorStatus === InvoiceNotificationOutboxStatus.CLAIMED) {
      throw new ConflictError('Notification is already pending or actively claimed by a worker');
    }

    if (priorStatus === InvoiceNotificationOutboxStatus.DELIVERED) {
      throw new ConflictError('Notification is already confirmed DELIVERED; re-send authorization rejected');
    }

    return executeAdminOperation({
      operationName: 'admin_authorize_invoice_notification_resend',
      targetResourceType: 'invoice_notification_outbox',
      targetResourceId: outbox.id,
      context,
      action: AdminAuditAction.ADMIN_STATUS_UPDATED,
      metadata: {
        outboxId: outbox.id,
        invoiceNumber: outbox.invoiceNumber,
        priorStatus,
        resultingStatus: InvoiceNotificationOutboxStatus.PENDING,
        operatorReason: input.reason,
        resetAttemptCount: input.resetAttemptCount ?? false
      },
      execute: async (tx) => {
        const existingMeta = typeof outbox.metadata === 'string'
          ? JSON.parse(outbox.metadata || '{}')
          : (outbox.metadata || {});

        const priorAttempts = Array.isArray(existingMeta.priorAttempts)
          ? existingMeta.priorAttempts
          : [];

        const previousProviderMessageIds: string[] = Array.isArray(existingMeta.previousProviderMessageIds)
          ? existingMeta.previousProviderMessageIds
          : [];

        if (outbox.providerMessageId && !previousProviderMessageIds.includes(outbox.providerMessageId)) {
          previousProviderMessageIds.push(outbox.providerMessageId);
        }

        const updatedMeta = sanitizeJsonPayload({
          ...existingMeta,
          previousProviderMessageIds,
          priorAttempts: [
            ...priorAttempts.slice(-10), // Retain up to 10 prior attempts
            {
              attemptNumber: Number(outbox.attemptCount || 0),
              status: priorStatus,
              transportStartedAt: outbox.transportStartedAt ? new Date(outbox.transportStartedAt).toISOString() : null,
              dispatchedAt: outbox.dispatchedAt ? new Date(outbox.dispatchedAt).toISOString() : null,
              providerMessageId: outbox.providerMessageId || null,
              ambiguousAt: outbox.ambiguousAt ? new Date(outbox.ambiguousAt).toISOString() : null,
              ambiguousReason: outbox.ambiguousReason || null,
              failureCode: outbox.failureCode || null,
              failureReason: outbox.failureReason || null,
              resendAuthorizedBy: context.adminId,
              resendReason: input.reason,
              authorizedAt: new Date().toISOString()
            }
          ],
          lastResendAuthorization: {
            operatorId: context.adminId,
            operatorEmail: context.adminEmail,
            reason: input.reason,
            priorStatus,
            at: new Date().toISOString()
          }
        });

        const newAttemptCount = input.resetAttemptCount ? 0 : Number(outbox.attemptCount || 0);

        const updateCount = await tx.$executeRawUnsafe(
          `UPDATE \`InvoiceNotificationOutbox\`
           SET \`status\` = 'PENDING',
               \`resendAuthorized\` = true,
               \`resendAuthorizedBy\` = ?,
               \`resendAuthorizedAt\` = NOW(3),
               \`resendAuthorizationCount\` = \`resendAuthorizationCount\` + 1,
               \`resendReason\` = ?,
               \`attemptCount\` = ?,
               \`nextAttemptAt\` = NOW(3),
               \`claimedBy\` = NULL,
               \`claimedAt\` = NULL,
               \`claimExpiresAt\` = NULL,
               \`transportStartedAt\` = NULL,
               \`claimVersion\` = \`claimVersion\` + 1,
               \`metadata\` = ?,
               \`updatedAt\` = NOW(3)
           WHERE \`id\` = ? AND \`status\` = ? AND \`claimVersion\` = ?`,
          context.adminId,
          input.reason,
          newAttemptCount,
          JSON.stringify(updatedMeta),
          outbox.id,
          priorStatus,
          currentClaimVersion
        );

        if (updateCount === 0) {
          throw new ConflictError('Notification state was concurrently modified; resend authorization rejected');
        }

        return {
          success: true,
          message: 'Notification resend authorized successfully; queued for outbox worker dispatch',
          outboxId: outbox.id,
          invoiceNumber: outbox.invoiceNumber,
          priorStatus,
          status: InvoiceNotificationOutboxStatus.PENDING,
          resendAuthorized: true,
          resendAuthorizationCount: Number(outbox.resendAuthorizationCount || 0) + 1
        };
      }
    });
  }
}

