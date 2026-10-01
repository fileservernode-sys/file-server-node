/**
 * Administrative Daily Email Analytics & Metrics Service
 * Phase 13.4 & Phase 13.13 Architecture
 *
 * Provides aggregated email metrics, status counts, source pipeline distribution,
 * transport distribution, daily time-series buckets over bounded UTC date ranges,
 * explicit delivery-rate formulas, and retention window transparency.
 *
 * Metric Integrity Invariants:
 * 1. EmailMessage is the authoritative message-level source of truth.
 * 2. EmailDeliveryAttempt logs represent attempts against an email and DO NOT inflate outbound message volume.
 * 3. SENT != DELIVERED (Explicit distinction between provider acceptance and delivery confirmation).
 * 4. Maximum requested date window is bounded to 366 days.
 * 5. Strict privacy invariant: Zero recipient emails, zero subjects, zero OTPs, zero PII.
 */

import { prisma } from '../../config/database.js';
import { config } from '../../config/env.js';
import {
  EmailMessageStatus,
  EmailSourcePipeline,
  EmailTransport
} from '@prisma/client';
import { ValidationError } from '../../errors/app-error.js';

export interface QueryEmailAnalyticsOptions {
  startDate?: string;
  endDate?: string;
}

export interface DailyEmailBucket {
  date: string; // YYYY-MM-DD
  total: number;
  queued: number;
  sent: number;
  delivered: number;
  retrying: number;
  failed: number;
  permanentlyFailed: number;
  bounced: number;
  softBounced: number;
  hardBounced: number;
  blocked: number;
  spam: number;
  deferred: number;
  attempts: number;
  bySourcePipeline: Record<EmailSourcePipeline, number>;
  byTransport: Record<EmailTransport, number>;
  byProvider: Record<string, number>;
  byEmailType: Record<string, number>;
}

export interface EmailAnalyticsKpis {
  totalEmails: number;
  totalAttempts: number;
  queuedCount: number;
  sentCount: number;
  deliveredCount: number;
  deferredCount: number;
  retryingCount: number;
  failedCount: number;
  permanentlyFailedCount: number;
  bouncedCount: number;
  softBouncedCount: number;
  hardBouncedCount: number;
  blockedCount: number;
  spamCount: number;
  terminalCount: number;
  deliveryConfirmationRatePercent: number;
  overallDeliveryRatePercent: number;
  deliveryRatePercent: number;
}

export interface EmailAnalyticsPeriodSummary {
  totalEmails: number;
  totalAttempts: number;
  statusCounts: Record<EmailMessageStatus, number>;
  sourcePipelineCounts: Record<EmailSourcePipeline, number>;
  transportCounts: Record<EmailTransport, number>;
  providerCounts: Record<string, number>;
  topEmailTypes: Array<{ emailType: string; count: number }>;
}

export interface RetentionWindowInfo {
  configuredRetentionDays: number;
  oldestRetainedRecordAt: string | null;
  isPartialData: boolean;
}

export interface EmailAnalyticsResult {
  timeRange: {
    startDate: string;
    endDate: string;
    daysCount: number;
  };
  kpis: EmailAnalyticsKpis;
  summary: EmailAnalyticsPeriodSummary;
  statusDistribution: Record<EmailMessageStatus, number>;
  pipelineDistribution: Record<EmailSourcePipeline, number>;
  transportDistribution: Record<EmailTransport, number>;
  providerDistribution: Record<string, number>;
  topEmailTypes: Array<{ emailType: string; count: number }>;
  dailyTrends: DailyEmailBucket[];
  daily: DailyEmailBucket[];
  retentionInfo: RetentionWindowInfo;
}

function initializeStatusCounts(): Record<EmailMessageStatus, number> {
  return {
    [EmailMessageStatus.QUEUED]: 0,
    [EmailMessageStatus.SENT]: 0,
    [EmailMessageStatus.DELIVERED]: 0,
    [EmailMessageStatus.RETRYING]: 0,
    [EmailMessageStatus.FAILED]: 0,
    [EmailMessageStatus.PERMANENTLY_FAILED]: 0,
    [EmailMessageStatus.BOUNCED]: 0,
    [EmailMessageStatus.BLOCKED]: 0,
    [EmailMessageStatus.SPAM]: 0,
    [EmailMessageStatus.DEFERRED]: 0
  };
}

function initializePipelineCounts(): Record<EmailSourcePipeline, number> {
  return {
    [EmailSourcePipeline.OTP]: 0,
    [EmailSourcePipeline.NOTIFICATION]: 0,
    [EmailSourcePipeline.SYSTEM]: 0,
    [EmailSourcePipeline.TRANSACTIONAL]: 0
  };
}

function initializeTransportCounts(): Record<EmailTransport, number> {
  return {
    [EmailTransport.BREVO_API]: 0,
    [EmailTransport.SMTP_RELAY]: 0,
    [EmailTransport.MOCK]: 0
  };
}

function createEmptyDailyBucket(dateStr: string): DailyEmailBucket {
  return {
    date: dateStr,
    total: 0,
    queued: 0,
    sent: 0,
    delivered: 0,
    retrying: 0,
    failed: 0,
    permanentlyFailed: 0,
    bounced: 0,
    softBounced: 0,
    hardBounced: 0,
    blocked: 0,
    spam: 0,
    deferred: 0,
    attempts: 0,
    bySourcePipeline: initializePipelineCounts(),
    byTransport: initializeTransportCounts(),
    byProvider: {},
    byEmailType: {}
  };
}

function parseUtcDateRange(options: QueryEmailAnalyticsOptions): {
  start: Date;
  end: Date;
  startDateStr: string;
  endDateStr: string;
  daysCount: number;
} {
  const now = new Date();

  let end: Date;
  if (options.endDate) {
    const parsedEnd = new Date(options.endDate);
    if (isNaN(parsedEnd.getTime())) {
      throw new ValidationError('Invalid endDate format. Expected ISO date or YYYY-MM-DD');
    }
    if (options.endDate.trim().length <= 10) {
      end = new Date(Date.UTC(
        parsedEnd.getUTCFullYear(),
        parsedEnd.getUTCMonth(),
        parsedEnd.getUTCDate(),
        23, 59, 59, 999
      ));
    } else {
      end = parsedEnd;
    }
  } else {
    end = now;
  }

  let start: Date;
  if (options.startDate) {
    const parsedStart = new Date(options.startDate);
    if (isNaN(parsedStart.getTime())) {
      throw new ValidationError('Invalid startDate format. Expected ISO date or YYYY-MM-DD');
    }
    if (options.startDate.trim().length <= 10) {
      start = new Date(Date.UTC(
        parsedStart.getUTCFullYear(),
        parsedStart.getUTCMonth(),
        parsedStart.getUTCDate(),
        0, 0, 0, 0
      ));
    } else {
      start = parsedStart;
    }
  } else {
    // Default to 30 days prior to end
    const thirtyDaysAgo = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    start = new Date(Date.UTC(
      thirtyDaysAgo.getUTCFullYear(),
      thirtyDaysAgo.getUTCMonth(),
      thirtyDaysAgo.getUTCDate(),
      0, 0, 0, 0
    ));
  }

  if (start.getTime() > end.getTime()) {
    throw new ValidationError('startDate cannot be after endDate');
  }

  const durationMs = end.getTime() - start.getTime();
  const maxAllowedMs = 366 * 24 * 60 * 60 * 1000; // 366 days max window
  if (durationMs > maxAllowedMs) {
    throw new ValidationError('Requested date range exceeds maximum allowed window of 366 days');
  }

  const startDateStr = start.toISOString().slice(0, 10);
  const endDateStr = end.toISOString().slice(0, 10);

  const startDayUtc = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const endDayUtc = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  const daysCount = Math.floor((endDayUtc - startDayUtc) / (24 * 60 * 60 * 1000)) + 1;

  return {
    start,
    end,
    startDateStr,
    endDateStr,
    daysCount
  };
}

export class AdminEmailAnalyticsService {
  /**
   * Computes comprehensive email volume analytics, status distributions,
   * delivery confirmation rate, retry telemetry, transport usage, and daily time-series buckets.
   */
  public static async getDailyAnalytics(options: QueryEmailAnalyticsOptions = {}): Promise<EmailAnalyticsResult> {
    const { start, end, startDateStr, endDateStr, daysCount } = parseUtcDateRange(options);

    // 1. Initialize all daily buckets in range (chronological ascending)
    const dailyMap = new Map<string, DailyEmailBucket>();
    const curDate = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    const endCalendar = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));

    while (curDate.getTime() <= endCalendar.getTime()) {
      const dateKey = curDate.toISOString().slice(0, 10);
      dailyMap.set(dateKey, createEmptyDailyBucket(dateKey));
      curDate.setUTCDate(curDate.getUTCDate() + 1);
    }

    // 2. Query raw EmailMessage records bounded by timestamp
    const [records, oldestRecord] = await Promise.all([
      prisma.emailMessage.findMany({
        where: {
          createdAt: {
            gte: start,
            lte: end
          }
        },
        select: {
          id: true,
          status: true,
          sourcePipeline: true,
          transport: true,
          provider: true,
          emailType: true,
          attemptCount: true,
          failureReason: true,
          createdAt: true
        }
      }),
      prisma.emailMessage.findFirst({
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true }
      })
    ]);

    const summaryStatus = initializeStatusCounts();
    const summaryPipeline = initializePipelineCounts();
    const summaryTransport = initializeTransportCounts();
    const summaryProvider: Record<string, number> = {};
    const summaryEmailTypes = new Map<string, number>();

    let totalEmails = 0;
    let totalAttempts = 0;
    let softBouncedCount = 0;
    let hardBouncedCount = 0;

    for (const record of records) {
      totalEmails++;
      const attemptsForRecord = record.attemptCount || 1;
      totalAttempts += attemptsForRecord;

      // Update Summary Counts
      summaryStatus[record.status] = (summaryStatus[record.status] || 0) + 1;
      summaryPipeline[record.sourcePipeline] = (summaryPipeline[record.sourcePipeline] || 0) + 1;
      summaryTransport[record.transport] = (summaryTransport[record.transport] || 0) + 1;

      const providerKey = record.provider || 'UNKNOWN';
      summaryProvider[providerKey] = (summaryProvider[providerKey] || 0) + 1;

      const typeKey = record.emailType || 'UNKNOWN';
      summaryEmailTypes.set(typeKey, (summaryEmailTypes.get(typeKey) || 0) + 1);

      // Bounce classification (Soft vs Hard)
      const isSoftBounce = record.status === EmailMessageStatus.BOUNCED &&
        record.failureReason && /soft/i.test(record.failureReason);
      if (isSoftBounce) {
        softBouncedCount++;
      } else if (record.status === EmailMessageStatus.BOUNCED) {
        hardBouncedCount++;
      }

      // Update Daily Bucket
      const dateKey = record.createdAt.toISOString().slice(0, 10);
      let bucket = dailyMap.get(dateKey);
      if (!bucket) {
        bucket = createEmptyDailyBucket(dateKey);
        dailyMap.set(dateKey, bucket);
      }

      bucket.total++;
      bucket.attempts += attemptsForRecord;

      switch (record.status) {
        case EmailMessageStatus.QUEUED:
          bucket.queued++;
          break;
        case EmailMessageStatus.SENT:
          bucket.sent++;
          break;
        case EmailMessageStatus.DELIVERED:
          bucket.delivered++;
          break;
        case EmailMessageStatus.RETRYING:
          bucket.retrying++;
          break;
        case EmailMessageStatus.FAILED:
          bucket.failed++;
          break;
        case EmailMessageStatus.PERMANENTLY_FAILED:
          bucket.permanentlyFailed++;
          break;
        case EmailMessageStatus.BOUNCED:
          bucket.bounced++;
          if (isSoftBounce) bucket.softBounced++;
          else bucket.hardBounced++;
          break;
        case EmailMessageStatus.BLOCKED:
          bucket.blocked++;
          break;
        case EmailMessageStatus.SPAM:
          bucket.spam++;
          break;
        case EmailMessageStatus.DEFERRED:
          bucket.deferred++;
          break;
      }

      bucket.bySourcePipeline[record.sourcePipeline] = (bucket.bySourcePipeline[record.sourcePipeline] || 0) + 1;
      bucket.byTransport[record.transport] = (bucket.byTransport[record.transport] || 0) + 1;
      bucket.byProvider[providerKey] = (bucket.byProvider[providerKey] || 0) + 1;
      bucket.byEmailType[typeKey] = (bucket.byEmailType[typeKey] || 0) + 1;
    }

    // 3. Compute KPI Rates
    const deliveredCount = summaryStatus[EmailMessageStatus.DELIVERED] || 0;
    const sentCount = summaryStatus[EmailMessageStatus.SENT] || 0;
    const queuedCount = summaryStatus[EmailMessageStatus.QUEUED] || 0;
    const deferredCount = summaryStatus[EmailMessageStatus.DEFERRED] || 0;
    const retryingCount = summaryStatus[EmailMessageStatus.RETRYING] || 0;
    const failedCount = summaryStatus[EmailMessageStatus.FAILED] || 0;
    const permanentlyFailedCount = summaryStatus[EmailMessageStatus.PERMANENTLY_FAILED] || 0;
    const bouncedCount = summaryStatus[EmailMessageStatus.BOUNCED] || 0;
    const blockedCount = summaryStatus[EmailMessageStatus.BLOCKED] || 0;
    const spamCount = summaryStatus[EmailMessageStatus.SPAM] || 0;

    // Terminal outcome volume (Messages that reached a conclusive terminal delivery state)
    const terminalCount = deliveredCount + failedCount + permanentlyFailedCount + bouncedCount + blockedCount + spamCount;

    // Formula 1: Delivery Confirmation Rate = DELIVERED / (DELIVERED + TERMINAL_FAILURES)
    const deliveryConfirmationRatePercent = terminalCount > 0
      ? Number(((deliveredCount / terminalCount) * 100).toFixed(2))
      : (deliveredCount > 0 ? 100 : 0);

    // Formula 2: Overall Delivery Rate = DELIVERED / DISPATCHED_VOLUME
    const activeNonDispatched = queuedCount + retryingCount + deferredCount;
    const dispatchedVolume = Math.max(0, totalEmails - activeNonDispatched);
    const overallDeliveryRatePercent = dispatchedVolume > 0
      ? Number(((deliveredCount / dispatchedVolume) * 100).toFixed(2))
      : 0;

    const kpis: EmailAnalyticsKpis = {
      totalEmails,
      totalAttempts,
      queuedCount,
      sentCount,
      deliveredCount,
      deferredCount,
      retryingCount,
      failedCount,
      permanentlyFailedCount,
      bouncedCount,
      softBouncedCount,
      hardBouncedCount,
      blockedCount,
      spamCount,
      terminalCount,
      deliveryConfirmationRatePercent,
      overallDeliveryRatePercent,
      deliveryRatePercent: deliveryConfirmationRatePercent
    };

    const topEmailTypes = Array.from(summaryEmailTypes.entries())
      .map(([emailType, count]) => ({ emailType, count }))
      .sort((a, b) => b.count - a.count);

    const daily = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    // Retention window metadata
    const configuredRetentionDays = config.EMAIL_TRACKING_RETENTION_DAYS ?? 90;
    const oldestRetainedRecordAt = oldestRecord ? oldestRecord.createdAt.toISOString() : null;
    const isPartialData = Boolean(
      oldestRecord && start.getTime() < oldestRecord.createdAt.getTime()
    );

    return {
      timeRange: {
        startDate: startDateStr,
        endDate: endDateStr,
        daysCount
      },
      kpis,
      summary: {
        totalEmails,
        totalAttempts,
        statusCounts: summaryStatus,
        sourcePipelineCounts: summaryPipeline,
        transportCounts: summaryTransport,
        providerCounts: summaryProvider,
        topEmailTypes
      },
      statusDistribution: summaryStatus,
      pipelineDistribution: summaryPipeline,
      transportDistribution: summaryTransport,
      providerDistribution: summaryProvider,
      topEmailTypes,
      dailyTrends: daily,
      daily,
      retentionInfo: {
        configuredRetentionDays,
        oldestRetainedRecordAt,
        isPartialData
      }
    };
  }
}
