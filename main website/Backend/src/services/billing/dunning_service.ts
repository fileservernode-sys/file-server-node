import { prisma } from '../../config/database.js';
import { EntitlementService } from './entitlement_service.js';
import {
  BillingStatus,
  AuditEventType,
  NotificationRecordStatus,
  Subscription,
  Plan,
  PlanPrice
} from '@prisma/client';
import { NotFoundError, ConflictError } from '../../errors/app-error.js';

export const GRACE_PERIOD_DAYS = 5;
export const DUNNING_MILESTONES = [0, 2, 4, 5] as const;
export type DunningMilestone = typeof DUNNING_MILESTONES[number];

export interface DunningEvaluationOptions {
  now?: Date;
  subscriptionId?: string;
  userId?: string;
}

export interface DunningEvaluationResult {
  evaluatedCount: number;
  milestonesProcessed: Array<{
    subscriptionId: string;
    userId: string;
    milestone: DunningMilestone;
    transitionedTo?: BillingStatus;
  }>;
}

export class DunningService {
  /**
   * Calendar-safe addition of calendar days to a date.
   */
  static addCalendarDays(date: Date, days: number): Date {
    const result = new Date(date.getTime());
    result.setDate(result.getDate() + days);
    return result;
  }

  /**
   * Computes elapsed whole calendar days between two dates.
   */
  static getElapsedCalendarDays(startDate: Date, currentDate: Date): number {
    const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const current = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
    const diffMs = current.getTime() - start.getTime();
    return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
  }

  /**
   * Authoritatively starts the 5-day grace period for an active subscription following a failed renewal.
   */
  static async startGracePeriod(
    subscriptionId: string,
    options?: { now?: Date; reason?: string }
  ): Promise<Subscription> {
    const now = options?.now || new Date();

    const sub = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true, planPrice: true }
    });

    if (!sub) {
      throw new NotFoundError('Subscription not found');
    }

    // If already in GRACE_PERIOD or PAST_DUE, maintain existing grace timeline (idempotent)
    if (sub.status === BillingStatus.GRACE_PERIOD) {
      return sub;
    }

    if (sub.status !== BillingStatus.ACTIVE && sub.status !== BillingStatus.PAST_DUE && sub.status !== BillingStatus.CANCELLING) {
      throw new ConflictError(`Cannot enter grace period from status '${sub.status}'`);
    }

    const gracePeriodStartedAt = sub.gracePeriodStartedAt || now;
    const gracePeriodEndsAt = sub.gracePeriodEndsAt || this.addCalendarDays(gracePeriodStartedAt, GRACE_PERIOD_DAYS);

    let currentMilestones: number[] = [];
    if (Array.isArray(sub.dunningMilestones)) {
      currentMilestones = (sub.dunningMilestones as any[]).map((m) => Number(m));
    }
    if (!currentMilestones.includes(0)) {
      currentMilestones.push(0);
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Update Subscription
      const subUpdated = await tx.subscription.update({
        where: { id: sub.id },
        data: {
          status: BillingStatus.GRACE_PERIOD,
          gracePeriodStartedAt,
          gracePeriodEndsAt,
          dunningMilestones: currentMilestones,
          dunningLastEvaluatedAt: now,
          updatedAt: now
        }
      });

      // Update AccountBillingState
      await tx.accountBillingState.update({
        where: { userId: sub.userId },
        data: {
          status: BillingStatus.GRACE_PERIOD,
          activeSubscriptionId: sub.id,
          updatedAt: now
        }
      });

      // Audit Events
      await tx.auditEvent.create({
        data: {
          userId: sub.userId,
          eventType: AuditEventType.SUBSCRIPTION_PAST_DUE,
          metadata: {
            action: 'SUBSCRIPTION_PAST_DUE',
            subscriptionId: sub.id,
            reason: options?.reason || 'Recurring renewal payment failed',
            gracePeriodEndsAt: gracePeriodEndsAt.toISOString()
          }
        }
      });

      await tx.auditEvent.create({
        data: {
          userId: sub.userId,
          eventType: AuditEventType.SUBSCRIPTION_GRACE_PERIOD_STARTED,
          metadata: {
            action: 'SUBSCRIPTION_GRACE_PERIOD_STARTED',
            subscriptionId: sub.id,
            gracePeriodStartedAt: gracePeriodStartedAt.toISOString(),
            gracePeriodEndsAt: gracePeriodEndsAt.toISOString(),
            milestone: 0
          }
        }
      });

      return subUpdated;
    }, { maxWait: 15000, timeout: 30000 });

    // Dispatch Day 0 in-app notification
    await this.dispatchDunningNotification({
      userId: sub.userId,
      subscriptionId: sub.id,
      milestone: 0,
      planName: sub.plan.name,
      gracePeriodEndsAt
    });

    return updated;
  }

  /**
   * Deterministically evaluates active grace-period subscriptions against dunning milestones (0, 2, 4, 5)
   * and expires subscriptions whose 5-day grace period has elapsed.
   */
  static async processDunningAndExpirations(
    options?: DunningEvaluationOptions
  ): Promise<DunningEvaluationResult> {
    const now = options?.now || new Date();
    const result: DunningEvaluationResult = {
      evaluatedCount: 0,
      milestonesProcessed: []
    };

    const whereClause: any = {
      status: {
        in: [BillingStatus.GRACE_PERIOD, BillingStatus.PAST_DUE, BillingStatus.CANCELLING]
      }
    };

    if (options?.subscriptionId) {
      whereClause.id = options.subscriptionId;
    }
    if (options?.userId) {
      whereClause.userId = options.userId;
    }

    const subscriptions = await prisma.subscription.findMany({
      where: whereClause,
      include: {
        plan: true,
        planPrice: true
      }
    });

    result.evaluatedCount = subscriptions.length;

    for (const sub of subscriptions) {
      // Check Period-End Expiration for CANCELLING subscriptions
      if (sub.status === BillingStatus.CANCELLING) {
        if (now >= sub.currentPeriodEnd) {
          const expired = await this.expireCancelledSubscriptionDueToPeriodEnd(sub, now);
          if (expired) {
            result.milestonesProcessed.push({
              subscriptionId: sub.id,
              userId: sub.userId,
              milestone: 5,
              transitionedTo: BillingStatus.EXPIRED
            });
          }
        }
        continue;
      }
      const graceStart = sub.gracePeriodStartedAt || sub.createdAt;
      const graceEnd = sub.gracePeriodEndsAt || this.addCalendarDays(graceStart, GRACE_PERIOD_DAYS);
      const elapsedDays = this.getElapsedCalendarDays(graceStart, now);

      let processedMilestones: number[] = [];
      if (Array.isArray(sub.dunningMilestones)) {
        processedMilestones = (sub.dunningMilestones as any[]).map((m) => Number(m));
      }

      // Check Day 5 / Expiration Condition
      if (now >= graceEnd || elapsedDays >= GRACE_PERIOD_DAYS) {
        if (!processedMilestones.includes(5) || sub.status !== BillingStatus.EXPIRED) {
          const expired = await this.expireSubscriptionDueToGraceExhaustion(sub, now, processedMilestones);
          if (expired) {
            result.milestonesProcessed.push({
              subscriptionId: sub.id,
              userId: sub.userId,
              milestone: 5,
              transitionedTo: BillingStatus.EXPIRED
            });
          }
          continue; // Expired, no further dunning evaluation needed
        }
      }

      // Check Day 4 Final Warning
      if (elapsedDays >= 4 && !processedMilestones.includes(4)) {
        processedMilestones.push(4);
        await prisma.subscription.update({
          where: { id: sub.id },
          data: {
            dunningMilestones: processedMilestones,
            dunningLastEvaluatedAt: now
          }
        });

        await prisma.auditEvent.create({
          data: {
            userId: sub.userId,
            eventType: AuditEventType.BILLING_STATE_UPDATED,
            metadata: {
              action: 'DUNNING_MILESTONE_DAY_4',
              subscriptionId: sub.id,
              milestone: 4,
              gracePeriodEndsAt: graceEnd.toISOString()
            }
          }
        });

        await this.dispatchDunningNotification({
          userId: sub.userId,
          subscriptionId: sub.id,
          milestone: 4,
          planName: sub.plan.name,
          gracePeriodEndsAt: graceEnd
        });

        result.milestonesProcessed.push({
          subscriptionId: sub.id,
          userId: sub.userId,
          milestone: 4
        });
      }

      // Check Day 2 Reminder
      if (elapsedDays >= 2 && !processedMilestones.includes(2)) {
        processedMilestones.push(2);
        await prisma.subscription.update({
          where: { id: sub.id },
          data: {
            dunningMilestones: processedMilestones,
            dunningLastEvaluatedAt: now
          }
        });

        await prisma.auditEvent.create({
          data: {
            userId: sub.userId,
            eventType: AuditEventType.BILLING_STATE_UPDATED,
            metadata: {
              action: 'DUNNING_MILESTONE_DAY_2',
              subscriptionId: sub.id,
              milestone: 2,
              gracePeriodEndsAt: graceEnd.toISOString()
            }
          }
        });

        await this.dispatchDunningNotification({
          userId: sub.userId,
          subscriptionId: sub.id,
          milestone: 2,
          planName: sub.plan.name,
          gracePeriodEndsAt: graceEnd
        });

        result.milestonesProcessed.push({
          subscriptionId: sub.id,
          userId: sub.userId,
          milestone: 2
        });
      }
    }

    return result;
  }

  /**
   * Internal handler to expire a subscription after grace period exhaustion.
   */
  /**
   * Internal handler to expire a CANCELLING subscription once the current paid period ends.
   */
  private static async expireCancelledSubscriptionDueToPeriodEnd(
    sub: Subscription & { plan: Plan; planPrice: PlanPrice },
    now: Date
  ): Promise<boolean> {
    const transitioned = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SELECT id FROM `User` WHERE id = ? FOR UPDATE', sub.userId);
      const current = await tx.subscription.findUnique({ where: { id: sub.id } });
      if (!current || current.status === BillingStatus.EXPIRED) {
        return false;
      }

      // 1. Mark Subscription EXPIRED
      await tx.subscription.update({
        where: { id: sub.id },
        data: {
          status: BillingStatus.EXPIRED,
          expiredAt: now,
          updatedAt: now
        }
      });

      // 2. Mark AccountBillingState EXPIRED and detach activeSubscriptionId
      await tx.accountBillingState.update({
        where: { userId: sub.userId },
        data: {
          status: BillingStatus.EXPIRED,
          activeSubscriptionId: null,
          updatedAt: now
        }
      });

      // 3. Authoritative Audit Event
      await tx.auditEvent.create({
        data: {
          userId: sub.userId,
          eventType: AuditEventType.SUBSCRIPTION_EXPIRED,
          metadata: {
            action: 'SUBSCRIPTION_EXPIRED',
            subscriptionId: sub.id,
            reason: 'Cancellation paid period ended',
            previousStatus: current.status,
            currentPeriodEnd: sub.currentPeriodEnd.toISOString()
          }
        }
      });

      return true;
    }, { maxWait: 15000, timeout: 30000 });

    if (transitioned) {
      // 4. Entitlement recalculation (Downgrades effective limits to Free: maxServers = 1)
      await EntitlementService.resolveUserEntitlements(sub.userId);

      // 5. In-App Expiration Notification
      const idempotencyKey = `notif_cancel_expired_${sub.id}`;
      try {
        const existing = await prisma.notificationRecord.findUnique({
          where: { idempotencyKey }
        });
        if (!existing) {
          await prisma.notificationRecord.create({
            data: {
              userId: sub.userId,
              eventId: idempotencyKey,
              eventType: 'SUBSCRIPTION_EXPIRED',
              category: 'BILLING',
              severity: 'CRITICAL',
              title: 'Subscription Ended — Reverted to Free Plan',
              body: `Your ZdexCloud ${sub.plan.name} paid period has ended and your account has reverted to the Free tier (1 server limit). Your existing servers and files remain safe and intact.`,
              idempotencyKey,
              status: NotificationRecordStatus.UNREAD,
              metadata: {
                subscriptionId: sub.id,
                planCode: sub.plan.code,
                expiredAt: now.toISOString()
              }
            }
          });
        }
      } catch {
        // Non-blocking
      }
    }

    return transitioned;
  }

  private static async expireSubscriptionDueToGraceExhaustion(
    sub: Subscription & { plan: Plan; planPrice: PlanPrice },
    now: Date,
    processedMilestones: number[]
  ): Promise<boolean> {
    const updatedMilestones = Array.from(new Set([...processedMilestones, 5]));

    const transitioned = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SELECT id FROM `User` WHERE id = ? FOR UPDATE', sub.userId);
      const current = await tx.subscription.findUnique({ where: { id: sub.id } });
      if (!current || current.status === BillingStatus.EXPIRED) {
        return false;
      }

      // 1. Mark Subscription EXPIRED
      await tx.subscription.update({
        where: { id: sub.id },
        data: {
          status: BillingStatus.EXPIRED,
          expiredAt: now,
          dunningMilestones: updatedMilestones,
          dunningLastEvaluatedAt: now,
          updatedAt: now
        }
      });

      // 2. Mark AccountBillingState EXPIRED and detach activeSubscriptionId
      await tx.accountBillingState.update({
        where: { userId: sub.userId },
        data: {
          status: BillingStatus.EXPIRED,
          activeSubscriptionId: null,
          updatedAt: now
        }
      });

      // 3. Authoritative Audit Event
      await tx.auditEvent.create({
        data: {
          userId: sub.userId,
          eventType: AuditEventType.SUBSCRIPTION_EXPIRED,
          metadata: {
            action: 'SUBSCRIPTION_EXPIRED',
            subscriptionId: sub.id,
            reason: 'Grace period exhausted without recovery',
            previousStatus: current.status,
            milestone: 5
          }
        }
      });

      return true;
    }, { maxWait: 15000, timeout: 30000 });

    if (transitioned) {
      // 4. Entitlement recalculation (Downgrades effective limits to Free: maxServers = 1)
      await EntitlementService.resolveUserEntitlements(sub.userId);

      // 5. In-App Expiration Notification
      await this.dispatchDunningNotification({
        userId: sub.userId,
        subscriptionId: sub.id,
        milestone: 5,
        planName: sub.plan.name,
        gracePeriodEndsAt: sub.gracePeriodEndsAt || now
      });
    }

    return transitioned;
  }

  /**
   * Dispatches idempotent, non-blocking in-app notifications for dunning milestones.
   */
  static async dispatchDunningNotification(params: {
    userId: string;
    subscriptionId: string;
    milestone: DunningMilestone;
    planName: string;
    gracePeriodEndsAt: Date;
  }): Promise<void> {
    const { userId, subscriptionId, milestone, planName, gracePeriodEndsAt } = params;

    const formattedDate = gracePeriodEndsAt.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });

    let eventType: string;
    let title: string;
    let body: string;
    let severity: 'INFO' | 'WARNING' | 'CRITICAL';

    switch (milestone) {
      case 0:
        eventType = 'SUBSCRIPTION_PAYMENT_FAILED';
        title = 'Payment Failed — 5-Day Grace Period Started';
        body = `Your recurring renewal payment for ZdexCloud ${planName} could not be processed. Your paid features remain active until ${formattedDate}. Please update your payment details.`;
        severity = 'WARNING';
        break;
      case 2:
        eventType = 'SUBSCRIPTION_PAYMENT_DUE';
        title = 'Renewal Payment Due — Reminder';
        body = `Your ZdexCloud ${planName} payment is past due. Your grace period will end on ${formattedDate}. Please resolve the payment to maintain uninterrupted service.`;
        severity = 'WARNING';
        break;
      case 4:
        eventType = 'SUBSCRIPTION_GRACE_PERIOD_FINAL_WARNING';
        title = 'Final Notice — Grace Period Expiring Soon';
        body = `Your ZdexCloud ${planName} subscription will expire on ${formattedDate}. If payment is not completed, your account will revert to the Free tier.`;
        severity = 'CRITICAL';
        break;
      case 5:
        eventType = 'SUBSCRIPTION_EXPIRED';
        title = 'Subscription Expired — Reverted to Free Plan';
        body = `Your ZdexCloud ${planName} subscription has expired and your account has reverted to the Free tier (1 server limit). Your existing servers and files remain safe and intact.`;
        severity = 'CRITICAL';
        break;
      default:
        return;
    }

    const idempotencyKey = `notif_dunning_${subscriptionId}_day_${milestone}`;

    try {
      const existing = await prisma.notificationRecord.findUnique({
        where: { idempotencyKey }
      });

      if (!existing) {
        await prisma.notificationRecord.create({
          data: {
            userId,
            eventId: idempotencyKey,
            eventType,
            category: 'BILLING',
            severity,
            title,
            body,
            idempotencyKey,
            status: NotificationRecordStatus.UNREAD,
            metadata: {
              subscriptionId,
              milestone,
              gracePeriodEndsAt: gracePeriodEndsAt.toISOString()
            }
          }
        });
      }
    } catch (err: any) {
      // Non-blocking notification dispatch
    }
  }
}
