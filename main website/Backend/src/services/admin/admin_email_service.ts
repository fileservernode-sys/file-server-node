/**
 * Administrative Email Tracking & Audit Query Service
 * Phase 13.3 & Phase 13.5 Architecture
 *
 * Provides global email search, user-specific chronological email history,
 * bounded pagination, and strict privacy sanitization (Zero OTP/Credentials/Payload leakage).
 */

import { prisma } from '../../config/database.js';
import {
  EmailMessageStatus,
  EmailSourcePipeline,
  EmailTransport,
  Prisma
} from '@prisma/client';
import { NotFoundError, ValidationError } from '../../errors/app-error.js';

export interface QueryEmailsOptions {
  page?: number;
  limit?: number;
  pageSize?: number;
  sortBy?: 'createdAt' | 'queuedAt' | 'sentAt' | 'deliveredAt' | 'failedAt' | 'status' | 'emailType' | 'recipientEmail' | 'provider';
  sortOrder?: 'asc' | 'desc';
  userId?: string;
  recipientEmail?: string;
  emailType?: string;
  templateId?: string;
  sourcePipeline?: EmailSourcePipeline;
  provider?: string;
  transport?: EmailTransport;
  status?: EmailMessageStatus;
  providerMessageId?: string;
  notificationRecordId?: string;
  channelDeliveryRecordId?: string;
  requestId?: string;
  correlationId?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
}

export interface SafeEmailMessageSummary {
  id: string;
  userId: string | null;
  notificationRecordId: string | null;
  channelDeliveryRecordId: string | null;
  emailType: string;
  templateId: string;
  recipientEmail: string;
  recipientName: string | null;
  senderEmail: string;
  senderName: string | null;
  subject: string;
  sourcePipeline: EmailSourcePipeline;
  status: EmailMessageStatus;
  provider: string;
  transport: EmailTransport;
  providerMessageId: string | null;
  providerResponseCode: string | null;
  failureCode: string | null;
  failureReason: string | null;
  attemptCount: number;
  maxAttempts: number;
  queuedAt: Date | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  failedAt: Date | null;
  lastAttemptAt: Date | null;
  nextRetryAt: Date | null;
  requestId: string | null;
  correlationId: string | null;
  deviceId: string | null;
  serverId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SafeEmailDeliveryAttemptItem {
  id: string;
  emailMessageId: string;
  attemptNumber: number;
  transport: EmailTransport;
  status: EmailMessageStatus;
  providerMessageId: string | null;
  providerResponseCode: string | null;
  providerResponse: any | null;
  failureReason: string | null;
  durationMs: number | null;
  attemptedAt: Date;
}

export interface SafeEmailMessageDetail extends SafeEmailMessageSummary {
  providerResponse: any | null;
  metadata: any | null;
  attempts: SafeEmailDeliveryAttemptItem[];
}

export interface UserEmailHistoryResult {
  userId: string;
  userEmail: string;
  userName: string | null;
  emails: SafeEmailMessageSummary[];
  items: SafeEmailMessageSummary[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const ALLOWED_SORT_FIELDS = new Set([
  'createdAt',
  'queuedAt',
  'sentAt',
  'deliveredAt',
  'failedAt',
  'status',
  'emailType',
  'recipientEmail',
  'provider'
]);

import {
  sanitizeSubject,
  sanitizeJsonPayload,
  sanitizeFailureReason
} from '../../utils/email_sanitizer.js';

export {
  sanitizeSubject,
  sanitizeJsonPayload,
  sanitizeFailureReason
};

/**
 * Builds a parameterized Prisma where clause for email searches and filtering.
 */
function buildEmailWhereClause(options: QueryEmailsOptions): Prisma.EmailMessageWhereInput {
  const where: Prisma.EmailMessageWhereInput = {};

  if (options.userId) {
    where.userId = options.userId.trim();
  }

  if (options.recipientEmail) {
    where.recipientEmail = {
      contains: options.recipientEmail.trim().toLowerCase()
    };
  }

  if (options.emailType) {
    where.emailType = options.emailType.trim();
  }

  if (options.templateId) {
    where.templateId = options.templateId.trim();
  }

  if (options.sourcePipeline) {
    where.sourcePipeline = options.sourcePipeline;
  }

  if (options.provider) {
    where.provider = options.provider.trim();
  }

  if (options.transport) {
    where.transport = options.transport;
  }

  if (options.status) {
    where.status = options.status;
  }

  if (options.providerMessageId) {
    where.providerMessageId = options.providerMessageId.trim();
  }

  if (options.notificationRecordId) {
    where.notificationRecordId = options.notificationRecordId.trim();
  }

  if (options.channelDeliveryRecordId) {
    where.channelDeliveryRecordId = options.channelDeliveryRecordId.trim();
  }

  if (options.requestId) {
    where.requestId = options.requestId.trim();
  }

  if (options.correlationId) {
    where.correlationId = options.correlationId.trim();
  }

  // Date Range Filter (UTC Parsing)
  if (options.startDate || options.endDate) {
    if (options.startDate && options.endDate) {
      const startTs = new Date(options.startDate).getTime();
      const endTs = new Date(options.endDate).getTime();
      if (!isNaN(startTs) && !isNaN(endTs)) {
        if (startTs > endTs) {
          throw new ValidationError('startDate cannot be after endDate');
        }
        const maxWindowMs = 366 * 24 * 60 * 60 * 1000;
        if (endTs - startTs > maxWindowMs) {
          throw new ValidationError('Requested date range exceeds maximum allowed window of 366 days');
        }
      }
    }

    where.createdAt = {};
    if (options.startDate) {
      const parsedStart = new Date(options.startDate);
      if (!isNaN(parsedStart.getTime())) {
        if (options.startDate.trim().length <= 10) {
          where.createdAt.gte = new Date(Date.UTC(
            parsedStart.getUTCFullYear(),
            parsedStart.getUTCMonth(),
            parsedStart.getUTCDate(),
            0, 0, 0, 0
          ));
        } else {
          where.createdAt.gte = parsedStart;
        }
      }
    }
    if (options.endDate) {
      const parsedEnd = new Date(options.endDate);
      if (!isNaN(parsedEnd.getTime())) {
        if (options.endDate.trim().length <= 10) {
          where.createdAt.lte = new Date(Date.UTC(
            parsedEnd.getUTCFullYear(),
            parsedEnd.getUTCMonth(),
            parsedEnd.getUTCDate(),
            23, 59, 59, 999
          ));
        } else {
          where.createdAt.lte = parsedEnd;
        }
      }
    }
  }

  // Search Query (Multi-attribute OR across non-sensitive identifiers and attributes)
  if (options.search && options.search.trim() !== '') {
    const searchTerm = options.search.trim();
    const isEmail = searchTerm.includes('@');
    where.OR = [
      { recipientEmail: { contains: searchTerm.toLowerCase() } },
      { subject: { contains: searchTerm } },
      { providerMessageId: { contains: searchTerm } },
      { emailType: { contains: searchTerm } },
      { templateId: { contains: searchTerm } },
      { requestId: searchTerm },
      { correlationId: searchTerm }
    ];

    if (!isEmail && searchTerm.length >= 10) {
      where.OR.push({ userId: searchTerm });
    }
  }

  return where;
}

export class AdminEmailService {
  /**
   * Queries paginated outbound email records with rich administrative filtering and search.
   */
  public static async listEmails(options: QueryEmailsOptions = {}): Promise<{
    items: SafeEmailMessageSummary[];
    pagination: {
      page: number;
      limit: number;
      pageSize: number;
      total: number;
      totalPages: number;
      hasNext: boolean;
      hasPrevious: boolean;
    };
  }> {
    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(options.pageSize || options.limit) || 20));
    const skip = (page - 1) * limit;

    const sortBy = options.sortBy && ALLOWED_SORT_FIELDS.has(options.sortBy)
      ? options.sortBy
      : 'createdAt';
    const sortOrder: Prisma.SortOrder = options.sortOrder === 'asc' ? 'asc' : 'desc';

    const where = buildEmailWhereClause(options);

    const [total, records] = await Promise.all([
      prisma.emailMessage.count({ where }),
      prisma.emailMessage.findMany({
        where,
        skip,
        take: limit,
        orderBy: [
          { [sortBy]: sortOrder },
          { id: 'desc' }
        ],
        select: {
          id: true,
          userId: true,
          notificationRecordId: true,
          channelDeliveryRecordId: true,
          emailType: true,
          templateId: true,
          recipientEmail: true,
          recipientName: true,
          senderEmail: true,
          senderName: true,
          subject: true,
          sourcePipeline: true,
          status: true,
          provider: true,
          transport: true,
          providerMessageId: true,
          providerResponseCode: true,
          failureCode: true,
          failureReason: true,
          attemptCount: true,
          maxAttempts: true,
          queuedAt: true,
          sentAt: true,
          deliveredAt: true,
          failedAt: true,
          lastAttemptAt: true,
          nextRetryAt: true,
          requestId: true,
          correlationId: true,
          deviceId: true,
          serverId: true,
          createdAt: true,
          updatedAt: true
        }
      })
    ]);

    const sanitizedRecords: SafeEmailMessageSummary[] = records.map(r => ({
      ...r,
      subject: sanitizeSubject(r.subject),
      failureReason: r.failureReason ? sanitizeFailureReason(r.failureReason) : null
    }));

    const totalPages = Math.ceil(total / limit) || 1;
    const hasNext = page < totalPages;
    const hasPrevious = page > 1;

    return {
      items: sanitizedRecords,
      pagination: {
        page,
        limit,
        pageSize: limit,
        total,
        totalPages,
        hasNext,
        hasPrevious
      }
    };
  }

  /**
   * Retrieves chronological outbound email history for a specific customer user account.
   */
  public static async getUserEmailHistory(
    userId: string,
    options: QueryEmailsOptions = {}
  ): Promise<UserEmailHistoryResult> {
    const cleanUserId = (userId || '').trim();
    if (!cleanUserId) {
      throw new ValidationError('userId is required');
    }

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: cleanUserId },
      select: {
        id: true,
        email: true,
        fullName: true
      }
    });

    if (!user) {
      throw new NotFoundError(`User with ID '${cleanUserId}' not found`);
    }

    // Query emails scoped to userId
    const scopedOptions: QueryEmailsOptions = {
      ...options,
      userId: cleanUserId
    };

    const queryResult = await this.listEmails(scopedOptions);

    return {
      userId: user.id,
      userEmail: user.email,
      userName: user.fullName,
      emails: queryResult.items,
      items: queryResult.items,
      pagination: queryResult.pagination
    };
  }

  /**
   * Retrieves a single email message detail with its attempts and sanitized provider metadata.
   */
  public static async getEmailById(emailId: string): Promise<SafeEmailMessageDetail> {
    const cleanEmailId = (emailId || '').trim();
    if (!cleanEmailId) {
      throw new ValidationError('emailId is required');
    }

    const record = await prisma.emailMessage.findUnique({
      where: { id: cleanEmailId },
      include: {
        attempts: {
          orderBy: { attemptNumber: 'asc' }
        }
      }
    });

    if (!record) {
      throw new NotFoundError(`Email message with ID '${cleanEmailId}' not found`);
    }

    const safeAttempts: SafeEmailDeliveryAttemptItem[] = record.attempts.map(att => ({
      id: att.id,
      emailMessageId: att.emailMessageId,
      attemptNumber: att.attemptNumber,
      transport: att.transport,
      status: att.status,
      providerMessageId: att.providerMessageId,
      providerResponseCode: att.providerResponseCode,
      providerResponse: sanitizeJsonPayload(att.providerResponse),
      failureReason: att.failureReason ? sanitizeFailureReason(att.failureReason) : null,
      durationMs: att.durationMs,
      attemptedAt: att.attemptedAt
    }));

    return {
      id: record.id,
      userId: record.userId,
      notificationRecordId: record.notificationRecordId,
      channelDeliveryRecordId: record.channelDeliveryRecordId,
      emailType: record.emailType,
      templateId: record.templateId,
      recipientEmail: record.recipientEmail,
      recipientName: record.recipientName,
      senderEmail: record.senderEmail,
      senderName: record.senderName,
      subject: sanitizeSubject(record.subject),
      sourcePipeline: record.sourcePipeline,
      status: record.status,
      provider: record.provider,
      transport: record.transport,
      providerMessageId: record.providerMessageId,
      providerResponseCode: record.providerResponseCode,
      providerResponse: sanitizeJsonPayload(record.providerResponse),
      failureCode: record.failureCode,
      failureReason: record.failureReason ? sanitizeFailureReason(record.failureReason) : null,
      attemptCount: record.attemptCount,
      maxAttempts: record.maxAttempts,
      queuedAt: record.queuedAt,
      sentAt: record.sentAt,
      deliveredAt: record.deliveredAt,
      failedAt: record.failedAt,
      lastAttemptAt: record.lastAttemptAt,
      nextRetryAt: record.nextRetryAt,
      requestId: record.requestId,
      correlationId: record.correlationId,
      deviceId: record.deviceId,
      serverId: record.serverId,
      metadata: sanitizeJsonPayload(record.metadata),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      attempts: safeAttempts
    };
  }

  /**
   * Retrieves only the delivery attempts for a given email message.
   */
  public static async getEmailAttempts(emailId: string): Promise<SafeEmailDeliveryAttemptItem[]> {
    const cleanEmailId = (emailId || '').trim();
    if (!cleanEmailId) {
      throw new ValidationError('emailId is required');
    }

    const emailExists = await prisma.emailMessage.findUnique({
      where: { id: cleanEmailId },
      select: { id: true }
    });

    if (!emailExists) {
      throw new NotFoundError(`Email message with ID '${cleanEmailId}' not found`);
    }

    const attempts = await prisma.emailDeliveryAttempt.findMany({
      where: { emailMessageId: cleanEmailId },
      orderBy: { attemptNumber: 'asc' }
    });

    return attempts.map(att => ({
      id: att.id,
      emailMessageId: att.emailMessageId,
      attemptNumber: att.attemptNumber,
      transport: att.transport,
      status: att.status,
      providerMessageId: att.providerMessageId,
      providerResponseCode: att.providerResponseCode,
      providerResponse: sanitizeJsonPayload(att.providerResponse),
      failureReason: att.failureReason ? sanitizeFailureReason(att.failureReason) : null,
      durationMs: att.durationMs,
      attemptedAt: att.attemptedAt
    }));
  }
}
