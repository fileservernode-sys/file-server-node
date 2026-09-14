import { FastifyBaseLogger } from 'fastify';
import { prisma } from '../../../../config/database.js';
import { getRazorpayConfig } from '../../../../config/razorpay.js';
import { verifyRazorpayWebhookSignature } from './webhook_crypto.js';
import { RazorpayProviderError } from './razorpay_error.js';
import { RazorpayPlanCatalogService } from './razorpay_plan_catalog_service.js';
import { EntitlementService } from '../../entitlement_service.js';
import { DunningService } from '../../dunning_service.js';
import { UpgradeReconciliationService } from '../../upgrade_reconciliation_service.js';
import { BillingReceiptService } from '../../billing_receipt_service.js';
import {
  PaymentProvider,
  PaymentEnvironment,
  BillingStatus,
  BillingInterval,
  CurrencyCode,
  PaymentStatus,
  WebhookEventStatus,
  PlanChangeStatus,
  AuditEventType,
  NotificationRecordStatus,
  UpgradeReconciliationStatus,
  RefundStatus,
  RefundReason,
  Prisma
} from '@prisma/client';
import { ValidationError } from '../../../../errors/app-error.js';

export interface WebhookHandlerOptions {
  webhookSecret?: string;
  environment?: PaymentEnvironment;
  logger?: FastifyBaseLogger;
}

export interface WebhookProcessingResult {
  success: boolean;
  message: string;
  providerEventId?: string;
  providerPaymentId?: string;
  eventType?: string;
  subscriptionId?: string;
  status?: string;
  idempotent?: boolean;
  unmatched?: boolean;
}

export class RazorpayWebhookService {
  /**
   * Primary entry point to securely process inbound Razorpay webhook events.
   * Guarantees raw-body HMAC validation, durable database idempotency,
   * provider plan consistency, atomic billing state activation, audit logging, and notification dispatch.
   */
  static async handleWebhook(
    rawBody: string | Buffer | undefined,
    signature: string | undefined | null,
    eventIdHeader: string | undefined | null,
    payload: any,
    options?: WebhookHandlerOptions
  ): Promise<WebhookProcessingResult> {
    const rzpConfig = getRazorpayConfig();
    const secret = options?.webhookSecret || rzpConfig.webhookSecret || process.env.RAZORPAY_WEBHOOK_SECRET || '';
    const environment = options?.environment || RazorpayPlanCatalogService.resolvePaymentEnvironment();

    // 1. Webhook Signature Validation (HMAC-SHA256 over exact raw body)
    if (!rawBody || !signature || !secret) {
      throw new RazorpayProviderError(
        'INVALID_SIGNATURE',
        'Missing webhook signature, raw payload body, or webhook secret',
        { statusCode: 400 }
      );
    }

    const isValid = verifyRazorpayWebhookSignature(rawBody, signature, secret);
    if (!isValid) {
      throw new RazorpayProviderError(
        'INVALID_SIGNATURE',
        'Invalid Razorpay webhook signature. Request may be forged or tampered with.',
        { statusCode: 400 }
      );
    }

    // 2. Payload Structure Validation
    if (!payload || typeof payload !== 'object') {
      throw new ValidationError('Invalid webhook payload structure: expected JSON object');
    }

    const eventType: string = payload.event;
    if (!eventType || typeof eventType !== 'string') {
      throw new ValidationError('Missing or invalid event field in webhook payload');
    }

    const providerEventId: string =
      (eventIdHeader && typeof eventIdHeader === 'string' && eventIdHeader.trim()) ||
      payload.event_id ||
      payload.id ||
      `evt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // 3. Durable Idempotency Check & Atomic Event Registration
    let webhookLog: any;
    try {
      webhookLog = await prisma.billingWebhookEvent.create({
        data: {
          provider: PaymentProvider.RAZORPAY,
          environment,
          providerEventId,
          eventType,
          status: WebhookEventStatus.PROCESSING
        }
      });
    } catch (createErr: any) {
      // If unique constraint violation or concurrent insert
      const existing = await prisma.billingWebhookEvent.findUnique({
        where: {
          provider_environment_providerEventId: {
            provider: PaymentProvider.RAZORPAY,
            environment,
            providerEventId
          }
        }
      });

      if (existing) {
        if (existing.status === WebhookEventStatus.PROCESSED || existing.status === WebhookEventStatus.PROCESSING) {
          return {
            success: true,
            message: 'Webhook event already processed or currently processing (idempotency guard)',
            providerEventId,
            eventType,
            idempotent: true
          };
        }

        // If previous attempt failed, allow retry by moving to PROCESSING
        webhookLog = await prisma.billingWebhookEvent.update({
          where: { id: existing.id },
          data: {
            status: WebhookEventStatus.PROCESSING,
            eventType,
            failureReason: null
          }
        });
      } else {
        throw createErr;
      }
    }

    try {
      // 4. Route according to event type
      if (eventType === 'subscription.activated' || eventType === 'subscription.authenticated') {
        const result = await this.processSubscriptionActivationEvent({
          payload,
          eventType,
          providerEventId,
          environment,
          webhookLogId: webhookLog.id
        });
        return result;
      }

      if (eventType === 'subscription.charged') {
        const result = await this.processSubscriptionChargedEvent({
          payload,
          eventType,
          providerEventId,
          environment,
          webhookLogId: webhookLog.id
        });
        return result;
      }

      if (
        eventType === 'subscription.pending' ||
        eventType === 'subscription.halted' ||
        eventType === 'payment.failed'
      ) {
        const result = await this.processSubscriptionPendingEvent({
          payload,
          eventType,
          providerEventId,
          environment,
          webhookLogId: webhookLog.id
        });
        return result;
      }

      if (eventType === 'subscription.cancelled' || eventType === 'subscription.paused') {
        const result = await this.processSubscriptionCancelledEvent({
          payload,
          eventType,
          providerEventId,
          environment,
          webhookLogId: webhookLog.id
        });
        return result;
      }

      if (eventType === 'subscription.updated') {
        const result = await this.processSubscriptionUpdatedEvent({
          payload,
          eventType,
          providerEventId,
          environment,
          webhookLogId: webhookLog.id
        });
        return result;
      }

      if (
        eventType === 'refund.processed' ||
        eventType === 'refund.created' ||
        eventType === 'refund.failed' ||
        eventType === 'refund.speed_changed' ||
        eventType === 'payment.refunded'
      ) {
        const result = await this.processRefundEvent({
          payload,
          eventType,
          providerEventId,
          environment,
          webhookLogId: webhookLog.id
        });
        return result;
      }

      // Safe acknowledgement for non-activation events outside Phase 5.1-5.3 scope
      await prisma.billingWebhookEvent.update({
        where: { id: webhookLog.id },
        data: {
          status: WebhookEventStatus.PROCESSED,
          processedAt: new Date()
        }
      });

      return {
        success: true,
        message: `Webhook event '${eventType}' acknowledged (no state transition required)`,
        providerEventId,
        eventType
      };
    } catch (err: any) {
      // Record failure reason on webhook log
      await prisma.billingWebhookEvent.update({
        where: { id: webhookLog.id },
        data: {
          status: WebhookEventStatus.FAILED,
          failureReason: err?.message ? String(err.message).substring(0, 1000) : 'Unknown processing error'
        }
      }).catch(() => {});

      throw err;
    }
  }

  /**
   * Internal processor for subscription.activated and subscription.authenticated events.
   */
  private static async processSubscriptionActivationEvent(params: {
    payload: any;
    eventType: string;
    providerEventId: string;
    environment: PaymentEnvironment;
    webhookLogId: string;
  }): Promise<WebhookProcessingResult> {
    const { payload, eventType, providerEventId, environment, webhookLogId } = params;

    // 1. Extract and validate subscription payload entity
    const subEntity = payload.payload?.subscription?.entity;
    if (!subEntity || typeof subEntity !== 'object') {
      throw new ValidationError("Missing 'payload.subscription.entity' in subscription webhook payload");
    }

    const providerSubscriptionId: string = subEntity.id;
    const providerPlanId: string = subEntity.plan_id;

    if (!providerSubscriptionId || typeof providerSubscriptionId !== 'string') {
      throw new ValidationError("Missing 'subscription.id' in subscription webhook entity");
    }

    if (!providerPlanId || typeof providerPlanId !== 'string') {
      throw new ValidationError("Missing 'subscription.plan_id' in subscription webhook entity");
    }

    // 2. Lookup internal Subscription contract by providerSubscriptionId
    const subscription = await prisma.subscription.findUnique({
      where: { providerSubscriptionId },
      include: {
        plan: true,
        planPrice: true,
        user: true
      }
    });

    if (!subscription) {
      // Unmatched provider subscription: do not create user or grant entitlements
      await prisma.billingWebhookEvent.update({
        where: { id: webhookLogId },
        data: {
          status: WebhookEventStatus.PROCESSED,
          processedAt: new Date(),
          failureReason: `Unmatched provider subscription ID: ${providerSubscriptionId}`
        }
      });

      return {
        success: false,
        message: `Unmatched provider subscription: ${providerSubscriptionId}. No account updated.`,
        providerEventId,
        eventType,
        unmatched: true
      };
    }

    // 3. Environment Isolation Check
    if (subscription.providerEnvironment !== environment) {
      throw new RazorpayProviderError(
        'VALIDATION_ERROR',
        `Environment mismatch: subscription is in ${subscription.providerEnvironment} but webhook is from ${environment}`,
        { statusCode: 400 }
      );
    }

    // 4. Provider Plan Consistency Validation
    if (subscription.providerPlanId && subscription.providerPlanId !== providerPlanId) {
      throw new RazorpayProviderError(
        'MAPPING_CONFLICT',
        `Provider plan mismatch: subscription contracted for ${subscription.providerPlanId} but webhook payload has ${providerPlanId}`,
        { statusCode: 400 }
      );
    }

    // 5. Handling subscription.authenticated (Preserves Monotonicity)
    if (eventType === 'subscription.authenticated') {
      if (subscription.status === BillingStatus.ACTIVE) {
        // Monotonic rule: Do NOT revert an already ACTIVE subscription back to CREATED
        await prisma.billingWebhookEvent.update({
          where: { id: webhookLogId },
          data: {
            status: WebhookEventStatus.PROCESSED,
            processedAt: new Date()
          }
        });

        return {
          success: true,
          message: 'Subscription is already ACTIVE. Monotonic state preserved.',
          providerEventId,
          eventType,
          subscriptionId: subscription.id,
          status: 'ACTIVE'
        };
      }

      // If CREATED, record provider authentication without granting Pro entitlement
      await prisma.billingWebhookEvent.update({
        where: { id: webhookLogId },
        data: {
          status: WebhookEventStatus.PROCESSED,
          processedAt: new Date()
        }
      });

      return {
        success: true,
        message: 'Subscription authenticated recorded. Entitlements remain FREE pending activation.',
        providerEventId,
        eventType,
        subscriptionId: subscription.id,
        status: subscription.status
      };
    }

    // 6. Handling subscription.activated (Authoritative Pro Activation)
    if (eventType === 'subscription.activated') {
      const now = new Date();

      // Resolve period start & end from provider timestamps or interval defaults
      const currentPeriodStart =
        subEntity.current_start && Number.isInteger(subEntity.current_start)
          ? new Date(subEntity.current_start * 1000)
          : now;

      let currentPeriodEnd =
        subEntity.current_end && Number.isInteger(subEntity.current_end)
          ? new Date(subEntity.current_end * 1000)
          : null;

      if (!currentPeriodEnd || currentPeriodEnd <= currentPeriodStart) {
        currentPeriodEnd = new Date(currentPeriodStart.getTime() + (subscription.billingInterval === 'YEARLY' ? 365 : 30) * 24 * 3600 * 1000);
      }

      // Execute Atomic State Transition Transaction
      await prisma.$transaction(
        async (tx) => {
          // A. Update internal Subscription to ACTIVE
          await tx.subscription.update({
            where: { id: subscription.id },
            data: {
              status: BillingStatus.ACTIVE,
              currentPeriodStart,
              currentPeriodEnd,
              gracePeriodStartedAt: null,
              gracePeriodEndsAt: null,
              dunningMilestones: Prisma.DbNull,
              dunningLastEvaluatedAt: null,
              updatedAt: now
            }
          });

          // B. Update AccountBillingState to ACTIVE and link activeSubscriptionId
          await tx.accountBillingState.upsert({
            where: { userId: subscription.userId },
            update: {
              status: BillingStatus.ACTIVE,
              activeSubscriptionId: subscription.id,
              currency: subscription.currency,
              updatedAt: now
            },
            create: {
              userId: subscription.userId,
              status: BillingStatus.ACTIVE,
              activeSubscriptionId: subscription.id,
              currency: subscription.currency
            }
          });

          // C. Record Authoritative Audit Event (Zero Secrets)
          await tx.auditEvent.create({
            data: {
              userId: subscription.userId,
              eventType: AuditEventType.SUBSCRIPTION_ACTIVATED,
              metadata: {
                action: 'SUBSCRIPTION_ACTIVATED',
                subscriptionId: subscription.id,
                provider: 'RAZORPAY',
                providerSubscriptionId,
                providerEventId,
                planCode: subscription.plan.code,
                priceVersion: subscription.priceVersion,
                currency: subscription.currency,
                amountMinorUnits: subscription.amountMinorUnits,
                environment
              }
            }
          });

          // D. Mark Webhook Event as PROCESSED
          await tx.billingWebhookEvent.update({
            where: { id: webhookLogId },
            data: {
              status: WebhookEventStatus.PROCESSED,
              processedAt: now
            }
          });
        },
        {
          timeout: 30000,
          maxWait: 15000
        }
      );

      // 7. Entitlement Recalculation via Entitlement Engine
      await EntitlementService.resolveUserEntitlements(subscription.userId);

      // 8. In-App Notification Dispatch (Non-blocking, zero rollback on failure)
      try {
        const notifIdempotencyKey = `notif_act_${subscription.id}_${providerEventId}`;
        const existingNotif = await prisma.notificationRecord.findUnique({
          where: { idempotencyKey: notifIdempotencyKey }
        });

        if (!existingNotif) {
          await prisma.notificationRecord.create({
            data: {
              userId: subscription.userId,
              eventId: providerEventId,
              eventType: 'SUBSCRIPTION_ACTIVATED',
              category: 'ACCOUNT_SECURITY',
              severity: 'INFO',
              title: 'ZdexCloud Pro Activated',
              body: `Your ZdexCloud ${subscription.plan.name} subscription is now active. You have access to up to ${subscription.plan.serverLimit} servers with priority relay routing.`,
              idempotencyKey: notifIdempotencyKey,
              status: NotificationRecordStatus.UNREAD,
              metadata: {
                subscriptionId: subscription.id,
                planCode: subscription.plan.code,
                currency: subscription.currency
              }
            }
          });
        }
      } catch (notifErr: any) {
        if (params.payload?._logger) {
          params.payload._logger.warn?.('Failed to create in-app activation notification record', notifErr);
        }
      }

      return {
        success: true,
        message: 'Subscription successfully activated',
        providerEventId,
        eventType,
        subscriptionId: subscription.id,
        status: 'ACTIVE'
      };
    }

    return {
      success: true,
      message: `Event '${eventType}' processed`,
      providerEventId,
      eventType
    };
  }

  /**
   * Internal processor for subscription.charged events (Authoritative Recurring Renewal & Grace Recovery).
   */
  private static async processSubscriptionChargedEvent(params: {
    payload: any;
    eventType: string;
    providerEventId: string;
    environment: PaymentEnvironment;
    webhookLogId: string;
  }): Promise<WebhookProcessingResult> {
    const { payload, eventType, providerEventId, environment, webhookLogId } = params;

    // 1. Extract and validate subscription payload entity
    const subEntity = payload.payload?.subscription?.entity;
    if (!subEntity || typeof subEntity !== 'object') {
      throw new ValidationError("Missing 'payload.subscription.entity' in subscription.charged webhook payload");
    }

    const providerSubscriptionId: string = subEntity.id;
    const providerPlanId: string = subEntity.plan_id;

    if (!providerSubscriptionId || typeof providerSubscriptionId !== 'string') {
      throw new ValidationError("Missing 'subscription.id' in subscription.charged webhook entity");
    }

    // 2. Lookup internal Subscription contract by providerSubscriptionId
    const subscription = await prisma.subscription.findUnique({
      where: { providerSubscriptionId },
      include: {
        plan: true,
        planPrice: true,
        user: true
      }
    });

    if (!subscription) {
      // Unmatched provider subscription: do not create user or grant entitlements
      await prisma.billingWebhookEvent.update({
        where: { id: webhookLogId },
        data: {
          status: WebhookEventStatus.PROCESSED,
          processedAt: new Date(),
          failureReason: `Unmatched provider subscription ID: ${providerSubscriptionId}`
        }
      });

      return {
        success: false,
        message: `Unmatched provider subscription: ${providerSubscriptionId}. No account updated.`,
        providerEventId,
        eventType,
        unmatched: true
      };
    }

    // 3. Environment Isolation Check
    if (subscription.providerEnvironment !== environment) {
      throw new RazorpayProviderError(
        'VALIDATION_ERROR',
        `Environment mismatch: subscription is in ${subscription.providerEnvironment} but webhook is from ${environment}`,
        { statusCode: 400 }
      );
    }

    // 4. Provider Plan Consistency Validation
    if (subscription.providerPlanId && providerPlanId && subscription.providerPlanId !== providerPlanId) {
      const scheduledChange = await prisma.subscriptionPlanChange.findFirst({
        where: {
          subscriptionId: subscription.id,
          status: PlanChangeStatus.SCHEDULED
        }
      });

      const providerMapping = await prisma.billingProviderPlanMapping.findUnique({
        where: {
          provider_environment_providerPlanId: {
            provider: PaymentProvider.RAZORPAY,
            environment,
            providerPlanId
          }
        }
      });

      if (!scheduledChange || !providerMapping || providerMapping.planId !== scheduledChange.toPlanId) {
        throw new RazorpayProviderError(
          'MAPPING_CONFLICT',
          `Provider plan mismatch: subscription contracted for ${subscription.providerPlanId} but webhook payload has ${providerPlanId}`,
          { statusCode: 400 }
        );
      }
    }

    // 5. Subscription Status Validation
    // A successful charge must NOT silently activate a CREATED subscription,
    // nor silently reactivate an EXPIRED / REFUNDED subscription.
    if (subscription.status === BillingStatus.CREATED) {
      await prisma.billingWebhookEvent.update({
        where: { id: webhookLogId },
        data: {
          status: WebhookEventStatus.PROCESSED,
          processedAt: new Date(),
          failureReason: `Cannot renew subscription ${subscription.id} in CREATED status without initial activation.`
        }
      });

      return {
        success: false,
        message: `Cannot renew subscription in CREATED state. Initial activation required.`,
        providerEventId,
        eventType,
        subscriptionId: subscription.id,
        status: 'CREATED'
      };
    }

    if (subscription.status === BillingStatus.EXPIRED || subscription.status === BillingStatus.REFUNDED) {
      await prisma.billingWebhookEvent.update({
        where: { id: webhookLogId },
        data: {
          status: WebhookEventStatus.PROCESSED,
          processedAt: new Date(),
          failureReason: `Cannot renew subscription ${subscription.id} in ${subscription.status} status.`
        }
      });

      return {
        success: false,
        message: `Cannot renew subscription in ${subscription.status} state.`,
        providerEventId,
        eventType,
        subscriptionId: subscription.id,
        status: subscription.status
      };
    }

    const isRecoveringFromGrace =
      subscription.status === BillingStatus.PAST_DUE ||
      subscription.status === BillingStatus.GRACE_PERIOD;

    const validStatuses: Set<BillingStatus> = new Set<BillingStatus>([
      BillingStatus.ACTIVE,
      BillingStatus.PAST_DUE,
      BillingStatus.GRACE_PERIOD,
      BillingStatus.CANCELLING
    ]);

    if (!validStatuses.has(subscription.status)) {
      await prisma.billingWebhookEvent.update({
        where: { id: webhookLogId },
        data: {
          status: WebhookEventStatus.PROCESSED,
          processedAt: new Date(),
          failureReason: `Cannot renew subscription ${subscription.id} in ${subscription.status} status.`
        }
      });

      return {
        success: false,
        message: `Subscription is not in a renewable state (current: ${subscription.status}).`,
        providerEventId,
        eventType,
        subscriptionId: subscription.id,
        status: subscription.status
      };
    }

    // 6. Payment / Charge Entity Validation
    const paymentEntity = payload.payload?.payment?.entity;
    let providerPaymentId: string | null = null;

    if (paymentEntity && typeof paymentEntity === 'object') {
      providerPaymentId = paymentEntity.id || null;

      // Reject failed payment charges
      if (paymentEntity.status === 'failed' || paymentEntity.error_code) {
        await prisma.billingWebhookEvent.update({
          where: { id: webhookLogId },
          data: {
            status: WebhookEventStatus.PROCESSED,
            processedAt: new Date(),
            failureReason: `Payment charge failed: ${paymentEntity.error_description || paymentEntity.error_code || 'Payment failed'}`
          }
        });

        return {
          success: false,
          message: `Payment failed for recurring charge: ${paymentEntity.error_description || 'Payment error'}`,
          providerEventId,
          providerPaymentId: providerPaymentId || undefined,
          eventType,
          status: 'FAILED'
        };
      }

      // Currency check
      if (paymentEntity.currency && paymentEntity.currency.toUpperCase() !== subscription.currency) {
        throw new RazorpayProviderError(
          'VALIDATION_ERROR',
          `Currency mismatch: subscription contracted for ${subscription.currency} but payment charged in ${paymentEntity.currency.toUpperCase()}`,
          { statusCode: 400 }
        );
      }

      // Amount check
      if (paymentEntity.amount !== undefined && paymentEntity.amount !== subscription.amountMinorUnits) {
        throw new RazorpayProviderError(
          'VALIDATION_ERROR',
          `Amount mismatch: subscription contracted for ${subscription.amountMinorUnits} but payment charged ${paymentEntity.amount}`,
          { statusCode: 400 }
        );
      }
    }

    // 7. Calculate Period Advancement (Calendar-safe arithmetic)
    const prevPeriodStart = subscription.currentPeriodStart;
    const prevPeriodEnd = subscription.currentPeriodEnd;

    let nextPeriodStart: Date;
    let nextPeriodEnd: Date;

    const providerStartSec = subEntity.current_start;
    const providerEndSec = subEntity.current_end;

    if (
      providerStartSec &&
      providerEndSec &&
      Number.isInteger(providerStartSec) &&
      Number.isInteger(providerEndSec) &&
      providerEndSec > providerStartSec
    ) {
      const pStart = new Date(providerStartSec * 1000);
      const pEnd = new Date(providerEndSec * 1000);
      if (pStart >= prevPeriodStart) {
        nextPeriodStart = pStart;
        nextPeriodEnd = pEnd;
      } else {
        nextPeriodStart = new Date(prevPeriodEnd);
        nextPeriodEnd = new Date(prevPeriodEnd);
        if (subscription.billingInterval === BillingInterval.YEARLY) {
          nextPeriodEnd.setFullYear(nextPeriodEnd.getFullYear() + (subscription.plan.intervalCount || 1));
        } else {
          nextPeriodEnd.setMonth(nextPeriodEnd.getMonth() + (subscription.plan.intervalCount || 1));
        }
      }
    } else {
      nextPeriodStart = new Date(prevPeriodEnd);
      nextPeriodEnd = new Date(prevPeriodEnd);
      if (subscription.billingInterval === BillingInterval.YEARLY) {
        nextPeriodEnd.setFullYear(nextPeriodEnd.getFullYear() + (subscription.plan.intervalCount || 1));
      } else {
        nextPeriodEnd.setMonth(nextPeriodEnd.getMonth() + (subscription.plan.intervalCount || 1));
      }
    }

    const now = new Date();

    // 8. Atomic Renewal Transaction
    await prisma.$transaction(
      async (tx) => {
        // A. Advance Subscription current period and clear grace period state
        await tx.subscription.update({
          where: { id: subscription.id },
          data: {
            status: BillingStatus.ACTIVE,
            currentPeriodStart: nextPeriodStart,
            currentPeriodEnd: nextPeriodEnd,
            gracePeriodStartedAt: null,
            gracePeriodEndsAt: null,
            dunningMilestones: Prisma.DbNull,
            dunningLastEvaluatedAt: null,
            updatedAt: now
          }
        });

        // B. Keep AccountBillingState ACTIVE and maintain activeSubscriptionId
        await tx.accountBillingState.upsert({
          where: { userId: subscription.userId },
          update: {
            status: BillingStatus.ACTIVE,
            activeSubscriptionId: subscription.id,
            currency: subscription.currency,
            updatedAt: now
          },
          create: {
            userId: subscription.userId,
            status: BillingStatus.ACTIVE,
            activeSubscriptionId: subscription.id,
            currency: subscription.currency
          }
        });

        // C. Check for associated pending Upgrade Plan Change
        const pendingUpgrade = await tx.subscriptionPlanChange.findFirst({
          where: {
            subscriptionId: subscription.id,
            reconciliation: {
              status: UpgradeReconciliationStatus.PENDING
            }
          },
          orderBy: { requestedAt: 'desc' }
        });

        const planChangeId = pendingUpgrade?.id || null;

        // D. Record Immutable Financial History (BillingPayment)
        if (providerPaymentId) {
          try {
            await tx.billingPayment.create({
              data: {
                provider: PaymentProvider.RAZORPAY,
                environment,
                providerPaymentId,
                providerSubscriptionId,
                providerEventId,
                userId: subscription.userId,
                subscriptionId: subscription.id,
                planChangeId,
                amountMinorUnits: subscription.amountMinorUnits,
                currency: subscription.currency,
                status: PaymentStatus.SUCCESS,
                chargedAt: now,
                metadata: {
                  planCode: subscription.plan.code,
                  priceVersion: subscription.priceVersion,
                  billingInterval: subscription.billingInterval,
                  providerPlanId,
                  isRecoveringFromGrace,
                  planChangeId
                }
              }
            });
          } catch (payErr: any) {
            if (payErr.code === 'P2002') {
              // Duplicate provider payment record already saved
            } else {
              throw payErr;
            }
          }
        } else {
          // Record payment transaction tied to provider event ID
          await tx.billingPayment.create({
            data: {
              provider: PaymentProvider.RAZORPAY,
              environment,
              providerPaymentId: null,
              providerSubscriptionId,
              providerEventId,
              userId: subscription.userId,
              subscriptionId: subscription.id,
              planChangeId,
              amountMinorUnits: subscription.amountMinorUnits,
              currency: subscription.currency,
              status: PaymentStatus.SUCCESS,
              chargedAt: now,
              metadata: {
                planCode: subscription.plan.code,
                priceVersion: subscription.priceVersion,
                billingInterval: subscription.billingInterval,
                providerPlanId,
                isRecoveringFromGrace,
                planChangeId
              }
            }
          });
        }

        // E. Authoritative Upgrade Reconciliation if charge is linked to an upgrade
        if (pendingUpgrade) {
          await UpgradeReconciliationService.reconcileUpgradeFinancials(
            pendingUpgrade.id,
            {
              actualAmountMinorUnits: paymentEntity?.amount ?? subscription.amountMinorUnits,
              actualCurrency: (paymentEntity?.currency?.toUpperCase() as CurrencyCode) || subscription.currency,
              providerPaymentId: providerPaymentId || undefined,
              providerEventId,
              providerEventType: eventType
            },
            { tx, timestamp: now }
          );
        }

        // D. Record Dedicated Authoritative Audit Event
        if (isRecoveringFromGrace) {
          await tx.auditEvent.create({
            data: {
              userId: subscription.userId,
              eventType: AuditEventType.SUBSCRIPTION_GRACE_PERIOD_RECOVERED,
              metadata: {
                action: 'SUBSCRIPTION_GRACE_PERIOD_RECOVERED',
                subscriptionId: subscription.id,
                provider: 'RAZORPAY',
                providerSubscriptionId,
                providerPaymentId: providerPaymentId || undefined,
                providerEventId,
                planCode: subscription.plan.code,
                priceVersion: subscription.priceVersion,
                currency: subscription.currency,
                amountMinorUnits: subscription.amountMinorUnits,
                previousStatus: subscription.status,
                newPeriodStart: nextPeriodStart.toISOString(),
                newPeriodEnd: nextPeriodEnd.toISOString(),
                environment
              }
            }
          });
        } else {
          await tx.auditEvent.create({
            data: {
              userId: subscription.userId,
              eventType: AuditEventType.SUBSCRIPTION_RENEWED,
              metadata: {
                action: 'SUBSCRIPTION_RENEWED',
                subscriptionId: subscription.id,
                provider: 'RAZORPAY',
                providerSubscriptionId,
                providerPaymentId: providerPaymentId || undefined,
                providerEventId,
                planCode: subscription.plan.code,
                priceVersion: subscription.priceVersion,
                currency: subscription.currency,
                amountMinorUnits: subscription.amountMinorUnits,
                previousPeriodStart: prevPeriodStart.toISOString(),
                previousPeriodEnd: prevPeriodEnd.toISOString(),
                newPeriodStart: nextPeriodStart.toISOString(),
                newPeriodEnd: nextPeriodEnd.toISOString(),
                environment
              }
            }
          });
        }

        // E. Mark Webhook Event as PROCESSED
        await tx.billingWebhookEvent.update({
          where: { id: webhookLogId },
          data: {
            status: WebhookEventStatus.PROCESSED,
            processedAt: now
          }
        });
      },
      {
        timeout: 30000,
        maxWait: 15000
      }
    );

    // 9. Entitlement Recalculation via Entitlement Engine
    await EntitlementService.resolveUserEntitlements(subscription.userId);

    // 10. In-App Notification Dispatch (Non-blocking)
    try {
      const notifIdempotencyKey = `notif_renew_${subscription.id}_${providerPaymentId || providerEventId}`;
      const existingNotif = await prisma.notificationRecord.findUnique({
        where: { idempotencyKey: notifIdempotencyKey }
      });

      if (!existingNotif) {
        let title: string;
        let body: string;

        if (isRecoveringFromGrace) {
          title = 'Payment Recovered — Pro Subscription Active';
          body = `Your recurring payment of ${subscription.currency} ${(subscription.amountMinorUnits / 100).toFixed(2)} was successfully recovered. Your Pro access has been fully restored.`;
        } else {
          title = 'ZdexCloud Pro Subscription Renewed';
          body = `Your recurring payment of ${subscription.currency} ${(subscription.amountMinorUnits / 100).toFixed(2)} for ${subscription.plan.name} has been processed successfully.`;
        }

        await prisma.notificationRecord.create({
          data: {
            userId: subscription.userId,
            eventId: providerEventId,
            eventType: isRecoveringFromGrace ? 'SUBSCRIPTION_PAYMENT_RECOVERED' : 'SUBSCRIPTION_RENEWED',
            category: 'BILLING',
            severity: 'INFO',
            title,
            body,
            idempotencyKey: notifIdempotencyKey,
            status: NotificationRecordStatus.UNREAD,
            metadata: {
              subscriptionId: subscription.id,
              planCode: subscription.plan.code,
              currency: subscription.currency,
              amountMinorUnits: subscription.amountMinorUnits,
              currentPeriodEnd: nextPeriodEnd.toISOString(),
              recoveredFromGrace: isRecoveringFromGrace
            }
          }
        });
      }
    } catch (notifErr: any) {
      if (params.payload?._logger) {
        params.payload._logger.warn?.('Failed to create in-app renewal notification record', notifErr);
      }
    }

    // 11. Customer Billing Receipt Generation (Decoupled & Non-blocking)
    try {
      const paymentRecord = await prisma.billingPayment.findFirst({
        where: {
          subscriptionId: subscription.id,
          OR: [
            { providerPaymentId: providerPaymentId || undefined },
            { providerEventId }
          ]
        },
        orderBy: { chargedAt: 'desc' }
      });

      if (paymentRecord) {
        await BillingReceiptService.generateReceiptForPayment(paymentRecord.id);
      }
    } catch (receiptErr: any) {
      if (params.payload?._logger) {
        params.payload._logger.warn?.('Failed to generate billing receipt for subscription charge', receiptErr);
      }
    }

    return {
      success: true,
      message: isRecoveringFromGrace ? 'Subscription successfully recovered to ACTIVE' : 'Subscription successfully renewed',
      providerEventId,
      providerPaymentId: providerPaymentId || undefined,
      eventType,
      subscriptionId: subscription.id,
      status: 'ACTIVE'
    };
  }

  /**
   * Internal processor for subscription.pending, subscription.halted, and payment.failed events.
   * Authoritatively transitions ACTIVE subscription to PAST_DUE and initiates the 5-day GRACE_PERIOD.
   */
  /**
   * Internal processor for subscription.cancelled and subscription.paused events.
   */
  private static async processSubscriptionCancelledEvent(params: {
    payload: any;
    eventType: string;
    providerEventId: string;
    environment: PaymentEnvironment;
    webhookLogId: string;
  }): Promise<WebhookProcessingResult> {
    const { payload, eventType, providerEventId, environment, webhookLogId } = params;

    const subEntity = payload.payload?.subscription?.entity;
    if (!subEntity || typeof subEntity !== 'object') {
      throw new ValidationError("Missing 'payload.subscription.entity' in subscription webhook payload");
    }

    const providerSubscriptionId: string = subEntity.id;
    if (!providerSubscriptionId || typeof providerSubscriptionId !== 'string') {
      throw new ValidationError("Missing 'subscription.id' in subscription webhook entity");
    }

    const subscription = await prisma.subscription.findUnique({
      where: { providerSubscriptionId },
      include: {
        plan: true,
        planPrice: true,
        user: true
      }
    });

    if (!subscription) {
      await prisma.billingWebhookEvent.update({
        where: { id: webhookLogId },
        data: {
          status: WebhookEventStatus.PROCESSED,
          processedAt: new Date(),
          failureReason: `Unmatched provider subscription ID: ${providerSubscriptionId}`
        }
      });

      return {
        success: false,
        message: `Unmatched provider subscription: ${providerSubscriptionId}. No account updated.`,
        providerEventId,
        eventType,
        unmatched: true
      };
    }

    if (subscription.providerEnvironment !== environment) {
      throw new RazorpayProviderError(
        'VALIDATION_ERROR',
        `Environment mismatch: subscription is in ${subscription.providerEnvironment} but webhook is from ${environment}`,
        { statusCode: 400 }
      );
    }

    // If already EXPIRED or REFUNDED, idempotent return
    if (subscription.status === BillingStatus.EXPIRED || subscription.status === BillingStatus.REFUNDED) {
      await prisma.billingWebhookEvent.update({
        where: { id: webhookLogId },
        data: {
          status: WebhookEventStatus.PROCESSED,
          processedAt: new Date()
        }
      });

      return {
        success: true,
        message: `Subscription is already in ${subscription.status} state. Idempotent return.`,
        providerEventId,
        eventType,
        subscriptionId: subscription.id,
        status: subscription.status
      };
    }

    const now = new Date();
    const endedAtSec = subEntity.ended_at;
    const isImmediate = Boolean(endedAtSec && (endedAtSec * 1000 <= now.getTime())) || (now >= subscription.currentPeriodEnd);

    if (isImmediate) {
      await prisma.$transaction(async (tx) => {
        await tx.subscription.update({
          where: { id: subscription.id },
          data: {
            status: BillingStatus.EXPIRED,
            expiredAt: now,
            cancelAtPeriodEnd: true,
            cancelledAt: subscription.cancelledAt || now,
            updatedAt: now
          }
        });

        await tx.accountBillingState.update({
          where: { userId: subscription.userId },
          data: {
            status: BillingStatus.EXPIRED,
            activeSubscriptionId: null,
            updatedAt: now
          }
        });

        await tx.auditEvent.create({
          data: {
            userId: subscription.userId,
            eventType: AuditEventType.SUBSCRIPTION_EXPIRED,
            metadata: {
              action: 'SUBSCRIPTION_EXPIRED_VIA_WEBHOOK',
              subscriptionId: subscription.id,
              provider: 'RAZORPAY',
              providerSubscriptionId,
              providerEventId,
              environment
            }
          }
        });

        await tx.billingWebhookEvent.update({
          where: { id: webhookLogId },
          data: {
            status: WebhookEventStatus.PROCESSED,
            processedAt: now
          }
        });
      }, { maxWait: 15000, timeout: 30000 });

      await EntitlementService.resolveUserEntitlements(subscription.userId);

      return {
        success: true,
        message: 'Subscription transitioned to EXPIRED via provider webhook',
        providerEventId,
        eventType,
        subscriptionId: subscription.id,
        status: 'EXPIRED'
      };
    } else {
      await prisma.$transaction(async (tx) => {
        await tx.subscription.update({
          where: { id: subscription.id },
          data: {
            status: BillingStatus.CANCELLING,
            cancelAtPeriodEnd: true,
            cancelledAt: subscription.cancelledAt || now,
            updatedAt: now
          }
        });

        await tx.accountBillingState.update({
          where: { userId: subscription.userId },
          data: {
            status: BillingStatus.CANCELLING,
            updatedAt: now
          }
        });

        await tx.auditEvent.create({
          data: {
            userId: subscription.userId,
            eventType: AuditEventType.SUBSCRIPTION_CANCELLATION_REQUESTED,
            metadata: {
              action: 'SUBSCRIPTION_CANCELLATION_WEBHOOK',
              subscriptionId: subscription.id,
              provider: 'RAZORPAY',
              providerSubscriptionId,
              providerEventId,
              currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
              environment
            }
          }
        });

        await tx.billingWebhookEvent.update({
          where: { id: webhookLogId },
          data: {
            status: WebhookEventStatus.PROCESSED,
            processedAt: now
          }
        });
      }, { maxWait: 15000, timeout: 30000 });

      return {
        success: true,
        message: 'Subscription cancellation scheduled via provider webhook',
        providerEventId,
        eventType,
        subscriptionId: subscription.id,
        status: 'CANCELLING'
      };
    }
  }

  private static async processSubscriptionPendingEvent(params: {
    payload: any;
    eventType: string;
    providerEventId: string;
    environment: PaymentEnvironment;
    webhookLogId: string;
  }): Promise<WebhookProcessingResult> {
    const { payload, eventType, providerEventId, environment, webhookLogId } = params;

    // 1. Extract provider subscription ID from payload
    const subEntity = payload.payload?.subscription?.entity;
    const paymentEntity = payload.payload?.payment?.entity;

    const providerSubscriptionId: string | undefined =
      subEntity?.id ||
      paymentEntity?.subscription_id ||
      payload.subscription_id;

    if (!providerSubscriptionId || typeof providerSubscriptionId !== 'string') {
      await prisma.billingWebhookEvent.update({
        where: { id: webhookLogId },
        data: {
          status: WebhookEventStatus.PROCESSED,
          processedAt: new Date(),
          failureReason: "Missing subscription ID in failure/pending webhook payload"
        }
      });

      return {
        success: true,
        message: 'Non-subscription payment failure acknowledged (no subscription linked)',
        providerEventId,
        eventType
      };
    }

    // 2. Lookup internal Subscription contract
    const subscription = await prisma.subscription.findUnique({
      where: { providerSubscriptionId },
      include: {
        plan: true,
        planPrice: true,
        user: true
      }
    });

    if (!subscription) {
      await prisma.billingWebhookEvent.update({
        where: { id: webhookLogId },
        data: {
          status: WebhookEventStatus.PROCESSED,
          processedAt: new Date(),
          failureReason: `Unmatched provider subscription ID: ${providerSubscriptionId}`
        }
      });

      return {
        success: false,
        message: `Unmatched provider subscription: ${providerSubscriptionId}. No account updated.`,
        providerEventId,
        eventType,
        unmatched: true
      };
    }

    // 3. Environment check
    if (subscription.providerEnvironment !== environment) {
      throw new RazorpayProviderError(
        'VALIDATION_ERROR',
        `Environment mismatch: subscription is in ${subscription.providerEnvironment} but webhook is from ${environment}`,
        { statusCode: 400 }
      );
    }

    // 4. Status safety validation
    if (subscription.status === BillingStatus.CREATED) {
      await prisma.billingWebhookEvent.update({
        where: { id: webhookLogId },
        data: {
          status: WebhookEventStatus.PROCESSED,
          processedAt: new Date(),
          failureReason: `Cannot start grace period for subscription ${subscription.id} in CREATED status.`
        }
      });

      return {
        success: false,
        message: 'Cannot start grace period for unactivated CREATED subscription.',
        providerEventId,
        eventType,
        subscriptionId: subscription.id,
        status: 'CREATED'
      };
    }

    if (subscription.status === BillingStatus.EXPIRED || subscription.status === BillingStatus.REFUNDED) {
      await prisma.billingWebhookEvent.update({
        where: { id: webhookLogId },
        data: {
          status: WebhookEventStatus.PROCESSED,
          processedAt: new Date(),
          failureReason: `Cannot start grace period for subscription ${subscription.id} in ${subscription.status} status.`
        }
      });

      return {
        success: false,
        message: `Cannot start grace period for subscription in ${subscription.status} state.`,
        providerEventId,
        eventType,
        subscriptionId: subscription.id,
        status: subscription.status
      };
    }

    // 5. Stale / Out-of-order event check:
    // If subscription is ACTIVE and has already been renewed/advanced beyond this failure event's period,
    // do not regress ACTIVE back to GRACE_PERIOD.
    const subEntityStart = subEntity?.current_start ? subEntity.current_start * 1000 : null;
    const paymentCreated = paymentEntity?.created_at ? paymentEntity.created_at * 1000 : null;
    const eventTimestamp = subEntityStart || paymentCreated;

    if (
      subscription.status === BillingStatus.ACTIVE &&
      eventTimestamp &&
      eventTimestamp < subscription.currentPeriodStart.getTime()
    ) {
      await prisma.billingWebhookEvent.update({
        where: { id: webhookLogId },
        data: {
          status: WebhookEventStatus.PROCESSED,
          processedAt: new Date()
        }
      });

      return {
        success: true,
        message: 'Stale/out-of-order failure event acknowledged without regressing ACTIVE subscription',
        providerEventId,
        eventType,
        subscriptionId: subscription.id,
        status: 'ACTIVE'
      };
    }

    // 6. If ACTIVE (or CANCELLING/PAST_DUE), start or maintain grace period via DunningService
    const now = new Date();
    const reason = paymentEntity?.error_description || paymentEntity?.error_code || `Provider recurring failure (${eventType})`;

    if (subscription.status === BillingStatus.ACTIVE || subscription.status === BillingStatus.CANCELLING) {
      await DunningService.startGracePeriod(subscription.id, { now, reason });
    }

    // 6. Record failed payment entry if payment entity present
    if (paymentEntity && paymentEntity.id) {
      try {
        await prisma.billingPayment.create({
          data: {
            provider: PaymentProvider.RAZORPAY,
            environment,
            providerPaymentId: paymentEntity.id,
            providerSubscriptionId,
            providerEventId,
            userId: subscription.userId,
            subscriptionId: subscription.id,
            amountMinorUnits: paymentEntity.amount || subscription.amountMinorUnits,
            currency: (paymentEntity.currency?.toUpperCase() as CurrencyCode) || subscription.currency,
            status: PaymentStatus.FAILED,
            chargedAt: now,
            metadata: {
              errorCode: paymentEntity.error_code,
              errorDescription: paymentEntity.error_description,
              eventType
            }
          }
        });
      } catch (err: any) {
        // Ignore duplicate payment record
      }
    }

    // 7. Mark Webhook as PROCESSED
    await prisma.billingWebhookEvent.update({
      where: { id: webhookLogId },
      data: {
        status: WebhookEventStatus.PROCESSED,
        processedAt: now
      }
    });

    return {
      success: true,
      message: `Subscription ${subscription.id} entered/maintained in GRACE_PERIOD`,
      providerEventId,
      providerPaymentId: paymentEntity?.id || undefined,
      eventType,
      subscriptionId: subscription.id,
      status: 'GRACE_PERIOD'
    };
  }
  /**
   * Internal processor for subscription.updated events (Authoritative Plan Change / Upgrade Webhook).
   */
  private static async processSubscriptionUpdatedEvent(params: {
    payload: any;
    eventType: string;
    providerEventId: string;
    environment: PaymentEnvironment;
    webhookLogId: string;
  }): Promise<WebhookProcessingResult> {
    const { payload, eventType, providerEventId, environment, webhookLogId } = params;

    // 1. Extract and validate subscription payload entity
    const subEntity = payload.payload?.subscription?.entity;
    if (!subEntity || typeof subEntity !== 'object') {
      throw new ValidationError("Missing 'payload.subscription.entity' in subscription.updated webhook payload");
    }

    const providerSubscriptionId: string = subEntity.id;
    const providerPlanId: string = subEntity.plan_id;

    if (!providerSubscriptionId || typeof providerSubscriptionId !== 'string') {
      throw new ValidationError("Missing 'subscription.id' in subscription.updated webhook entity");
    }

    if (!providerPlanId || typeof providerPlanId !== 'string') {
      throw new ValidationError("Missing 'subscription.plan_id' in subscription.updated webhook entity");
    }

    // 2. Lookup internal Subscription contract
    const subscription = await prisma.subscription.findUnique({
      where: { providerSubscriptionId },
      include: {
        plan: true,
        planPrice: true,
        user: true
      }
    });

    if (!subscription) {
      await prisma.billingWebhookEvent.update({
        where: { id: webhookLogId },
        data: {
          status: WebhookEventStatus.PROCESSED,
          processedAt: new Date(),
          failureReason: `Unmatched provider subscription ID: ${providerSubscriptionId}`
        }
      });

      return {
        success: false,
        message: `Unmatched provider subscription: ${providerSubscriptionId}. No account updated.`,
        providerEventId,
        eventType,
        unmatched: true
      };
    }

    // 3. Environment Isolation Check
    if (subscription.providerEnvironment !== environment) {
      throw new RazorpayProviderError(
        'VALIDATION_ERROR',
        `Environment mismatch: subscription is in ${subscription.providerEnvironment} but webhook is from ${environment}`,
        { statusCode: 400 }
      );
    }

    // 4. Resolve Target Provider Plan Mapping
    const mapping = await prisma.billingProviderPlanMapping.findUnique({
      where: {
        provider_environment_providerPlanId: {
          provider: PaymentProvider.RAZORPAY,
          environment,
          providerPlanId
        }
      },
      include: {
        plan: true,
        planPrice: true
      }
    });

    if (!mapping || !mapping.plan || !mapping.planPrice) {
      const pendingChange = await prisma.subscriptionPlanChange.findFirst({
        where: {
          subscriptionId: subscription.id,
          status: { in: [PlanChangeStatus.PROCESSING, PlanChangeStatus.SCHEDULED] }
        }
      });

      if (pendingChange) {
        await prisma.subscriptionPlanChange.update({
          where: { id: pendingChange.id },
          data: {
            status: PlanChangeStatus.REQUIRES_REVIEW,
            failureReason: `Provider plan mismatch: no mapping found for provider plan: ${providerPlanId}`
          }
        });
        await prisma.auditEvent.create({
          data: {
            userId: subscription.userId,
            eventType: AuditEventType.SUBSCRIPTION_DOWNGRADE_MISMATCHED,
            metadata: {
              subscriptionId: subscription.id,
              planChangeId: pendingChange.id,
              receivedProviderPlanId: providerPlanId
            }
          }
        });
      }

      await prisma.billingWebhookEvent.update({
        where: { id: webhookLogId },
        data: {
          status: WebhookEventStatus.PROCESSED,
          processedAt: new Date(),
          failureReason: `No mapping found for provider plan: ${providerPlanId}`
        }
      });

      return {
        success: false,
        message: `No mapping found for provider plan ${providerPlanId}`,
        providerEventId,
        eventType,
        subscriptionId: subscription.id
      };
    }

    // 5. Check Idempotency (Already on target plan and price)
    if (
      subscription.planId === mapping.planId &&
      subscription.planPriceId === mapping.planPriceId &&
      subscription.providerPlanId === providerPlanId
    ) {
      await prisma.billingWebhookEvent.update({
        where: { id: webhookLogId },
        data: {
          status: WebhookEventStatus.PROCESSED,
          processedAt: new Date()
        }
      });

      return {
        success: true,
        message: 'Subscription already synchronized with provider plan update',
        providerEventId,
        eventType,
        subscriptionId: subscription.id,
        idempotent: true
      };
    }

    const now = new Date();
    const nextPeriodStart = subEntity.current_start ? new Date(subEntity.current_start * 1000) : now;
    let nextPeriodEnd: Date;
    if (subEntity.current_end) {
      nextPeriodEnd = new Date(subEntity.current_end * 1000);
    } else {
      nextPeriodEnd = new Date(nextPeriodStart);
      if (mapping.plan.interval === BillingInterval.YEARLY) {
        nextPeriodEnd.setFullYear(nextPeriodEnd.getFullYear() + (mapping.plan.intervalCount || 1));
      } else {
        nextPeriodEnd.setMonth(nextPeriodEnd.getMonth() + (mapping.plan.intervalCount || 1));
      }
    }

    const isDowngrade = subscription.plan.code === 'PRO_YEARLY' && mapping.plan.code === 'PRO_MONTHLY';

    // 6. Atomic Transaction to sync subscription and audit logs
    await prisma.$transaction(async (tx) => {
      // B. Check any pending SubscriptionPlanChange
      const pendingChange = await tx.subscriptionPlanChange.findFirst({
        where: {
          subscriptionId: subscription.id,
          status: { in: [PlanChangeStatus.PROCESSING, PlanChangeStatus.SCHEDULED] }
        }
      });

      const isMismatch = pendingChange && pendingChange.toPlanId !== mapping.planId;

      if (isMismatch) {
        await tx.subscriptionPlanChange.update({
          where: { id: pendingChange.id },
          data: {
            status: PlanChangeStatus.REQUIRES_REVIEW,
            failureReason: `Provider plan mismatch: expected plan ID ${pendingChange.toPlanId}, received ${mapping.planId} (${providerPlanId})`,
            updatedAt: now
          }
        });

        await tx.auditEvent.create({
          data: {
            userId: subscription.userId,
            eventType: isDowngrade ? AuditEventType.SUBSCRIPTION_DOWNGRADE_MISMATCHED : AuditEventType.SUBSCRIPTION_UPGRADE_RECONCILIATION_MISMATCHED,
            metadata: {
              action: isDowngrade ? 'SUBSCRIPTION_DOWNGRADE_MISMATCHED' : 'SUBSCRIPTION_UPGRADE_MISMATCHED',
              subscriptionId: subscription.id,
              planChangeId: pendingChange.id,
              expectedPlanId: pendingChange.toPlanId,
              receivedPlanId: mapping.planId,
              providerPlanId,
              providerSubscriptionId,
              providerEventId,
              environment
            }
          }
        });
      }

      // A. Update Subscription to target plan
      await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          planId: mapping.planId,
          planPriceId: mapping.planPriceId,
          providerPlanId: mapping.providerPlanId,
          billingInterval: mapping.plan.interval,
          amountMinorUnits: mapping.planPrice.amountMinorUnits,
          priceVersion: mapping.planPrice.version,
          currentPeriodStart: nextPeriodStart,
          currentPeriodEnd: nextPeriodEnd,
          updatedAt: now
        }
      });

      if (pendingChange && !isMismatch) {
        await tx.subscriptionPlanChange.update({
          where: { id: pendingChange.id },
          data: {
            status: PlanChangeStatus.COMPLETED,
            completedAt: now,
            updatedAt: now
          }
        });

        if (!isDowngrade) {
          await UpgradeReconciliationService.reconcileUpgradeFinancials(
            pendingChange.id,
            {
              actualAmountMinorUnits: pendingChange.netAmountMinorUnits,
              actualCurrency: pendingChange.currency,
              providerEventId,
              providerEventType: eventType
            },
            { tx, timestamp: now }
          );
        }
      }

      // C. Record Audit Event
      await tx.auditEvent.create({
        data: {
          userId: subscription.userId,
          eventType: isDowngrade ? AuditEventType.SUBSCRIPTION_DOWNGRADE_EFFECTIVE : AuditEventType.SUBSCRIPTION_UPGRADED,
          metadata: {
            action: isDowngrade ? 'SUBSCRIPTION_DOWNGRADE_EFFECTIVE_VIA_WEBHOOK' : 'SUBSCRIPTION_UPGRADED_VIA_WEBHOOK',
            subscriptionId: subscription.id,
            planChangeId: pendingChange?.id,
            fromPlan: subscription.plan.code,
            toPlan: mapping.plan.code,
            fromPlanPriceId: subscription.planPriceId,
            toPlanPriceId: mapping.planPriceId,
            fromAmountMinorUnits: subscription.amountMinorUnits,
            toAmountMinorUnits: mapping.planPrice.amountMinorUnits,
            currency: subscription.currency,
            provider: 'RAZORPAY',
            providerSubscriptionId,
            providerEventId,
            environment
          }
        }
      });

      // D. Mark Webhook as PROCESSED
      await tx.billingWebhookEvent.update({
        where: { id: webhookLogId },
        data: {
          status: WebhookEventStatus.PROCESSED,
          processedAt: now
        }
      });
    }, { timeout: 30000, maxWait: 15000 });

    // 7. Entitlement recalculation
    await EntitlementService.resolveUserEntitlements(subscription.userId);

    // 8. In-App Notification (non-blocking)
    try {
      const notifIdempotencyKey = `notif_${isDowngrade ? 'down' : 'upg'}_wh_${subscription.id}_${providerEventId}`;
      const existingNotif = await prisma.notificationRecord.findUnique({
        where: { idempotencyKey: notifIdempotencyKey }
      });

      if (!existingNotif) {
        await prisma.notificationRecord.create({
          data: {
            userId: subscription.userId,
            eventId: providerEventId,
            eventType: isDowngrade ? 'SUBSCRIPTION_DOWNGRADE_EFFECTIVE' : 'SUBSCRIPTION_UPGRADED',
            category: 'BILLING',
            severity: 'INFO',
            title: isDowngrade ? 'Subscription Downgraded to Pro Monthly' : 'Subscription Upgraded to Pro Yearly',
            body: isDowngrade ? 'Your subscription has transitioned to Pro Monthly.' : `Your subscription has been successfully updated to ${mapping.plan.name}.`,
            idempotencyKey: notifIdempotencyKey,
            status: NotificationRecordStatus.UNREAD,
            metadata: {
              subscriptionId: subscription.id,
              planCode: mapping.plan.code,
              currency: subscription.currency
            }
          }
        });
      }
    } catch {}

    return {
      success: true,
      message: `Subscription ${subscription.id} successfully updated to plan ${mapping.plan.code}`,
      providerEventId,
      eventType,
      subscriptionId: subscription.id,
      status: 'ACTIVE'
    };
  }

  /**
   * Internal processor for refund.processed, refund.created, refund.failed, payment.refunded, refund.speed_changed.
   */
  private static async processRefundEvent(params: {
    payload: any;
    eventType: string;
    providerEventId: string;
    environment: PaymentEnvironment;
    webhookLogId: string;
  }): Promise<WebhookProcessingResult> {
    const { payload, eventType, providerEventId, environment, webhookLogId } = params;

    // 1. Extract refund and payment entity details from Razorpay payload
    const refundEntity = payload?.payload?.refund?.entity || payload?.refund?.entity || payload?.refund;
    const paymentEntity = payload?.payload?.payment?.entity || payload?.payment?.entity || payload?.payment;

    const providerRefundId = refundEntity?.id;
    const providerPaymentId = refundEntity?.payment_id || paymentEntity?.id;
    const refundAmountMinorUnits = refundEntity?.amount !== undefined ? Number(refundEntity.amount) : undefined;
    const refundCurrency = refundEntity?.currency || paymentEntity?.currency;
    const refundStatus = refundEntity?.status || (eventType === 'refund.failed' ? 'failed' : 'processed');

    if (!providerRefundId && !providerPaymentId) {
      await prisma.billingWebhookEvent.update({
        where: { id: webhookLogId },
        data: {
          status: WebhookEventStatus.PROCESSED,
          processedAt: new Date()
        }
      });
      return {
        success: true,
        message: 'Refund event ignored: missing providerRefundId and providerPaymentId',
        providerEventId,
        eventType
      };
    }

    // 2. Locate internal BillingRefund record
    let refundRecord: any = null;

    if (providerRefundId) {
      refundRecord = await prisma.billingRefund.findUnique({
        where: { providerRefundId },
        include: { payment: true, user: true, subscription: true }
      });
    }

    if (!refundRecord && refundEntity?.notes?.internalRefundId) {
      refundRecord = await prisma.billingRefund.findUnique({
        where: { id: String(refundEntity.notes.internalRefundId) },
        include: { payment: true, user: true, subscription: true }
      });
    }

    if (!refundRecord && providerPaymentId) {
      refundRecord = await prisma.billingRefund.findFirst({
        where: {
          providerPaymentId,
          status: { in: [RefundStatus.PROCESSING, RefundStatus.REQUESTED, RefundStatus.REQUIRES_REVIEW] }
        },
        orderBy: { requestedAt: 'desc' },
        include: { payment: true, user: true, subscription: true }
      });
    }

    // If still not found, check if payment exists to create external refund record
    if (!refundRecord && providerPaymentId) {
      const payment = await prisma.billingPayment.findFirst({
        where: { providerPaymentId },
        include: { user: true, subscription: true }
      });

      if (payment) {
        const idempotencyKey = `wh_ref_${providerRefundId || providerEventId}`;
        refundRecord = await prisma.billingRefund.upsert({
          where: { idempotencyKey },
          update: {},
          create: {
            userId: payment.userId,
            subscriptionId: payment.subscriptionId,
            paymentId: payment.id,
            provider: PaymentProvider.RAZORPAY,
            providerEnvironment: environment,
            providerPaymentId,
            providerRefundId: providerRefundId || null,
            amountMinorUnits: refundAmountMinorUnits || payment.amountMinorUnits,
            currency: payment.currency,
            reason: RefundReason.ADMIN_APPROVED_EXCEPTION,
            reasonDetails: 'External provider refund synchronized via webhook',
            status: refundStatus === 'failed' ? RefundStatus.FAILED : RefundStatus.PROCESSING,
            idempotencyKey,
            requestedBy: 'RAZORPAY_WEBHOOK',
            requestedAt: new Date(),
            providerRequestedAt: new Date()
          },
          include: { payment: true, user: true, subscription: true }
        });
      }
    }

    if (!refundRecord) {
      await prisma.billingWebhookEvent.update({
        where: { id: webhookLogId },
        data: {
          status: WebhookEventStatus.PROCESSED,
          processedAt: new Date()
        }
      });
      return {
        success: true,
        message: 'Refund event processed (no matching local payment or refund)',
        providerEventId,
        eventType,
        unmatched: true
      };
    }

    // 3. Financial / Provider Mismatch Checking
    let hasMismatch = false;
    let mismatchReason = '';

    // Check payment linkage
    if (providerPaymentId && refundRecord.payment && refundRecord.payment.providerPaymentId && refundRecord.payment.providerPaymentId !== providerPaymentId) {
      hasMismatch = true;
      mismatchReason = `Payment ID mismatch: internal=${refundRecord.payment.providerPaymentId}, webhook=${providerPaymentId}`;
    }

    // Check currency
    if (refundCurrency && refundRecord.currency !== refundCurrency) {
      hasMismatch = true;
      mismatchReason = `Currency mismatch: internal=${refundRecord.currency}, webhook=${refundCurrency}`;
    }

    // Check amount
    if (refundAmountMinorUnits !== undefined && refundRecord.amountMinorUnits !== refundAmountMinorUnits) {
      hasMismatch = true;
      mismatchReason = `Refund amount mismatch: internal=${refundRecord.amountMinorUnits}, webhook=${refundAmountMinorUnits}`;
    }

    if (hasMismatch) {
      await prisma.billingRefund.update({
        where: { id: refundRecord.id },
        data: {
          status: RefundStatus.REQUIRES_REVIEW,
          failureReason: mismatchReason
        }
      });

      await prisma.auditEvent.create({
        data: {
          userId: refundRecord.userId,
          eventType: AuditEventType.REFUND_REQUIRES_REVIEW,
          metadata: {
            refundId: refundRecord.id,
            providerRefundId,
            providerPaymentId,
            mismatchReason,
            providerEventId
          }
        }
      });

      await prisma.billingWebhookEvent.update({
        where: { id: webhookLogId },
        data: {
          status: WebhookEventStatus.PROCESSED,
          processedAt: new Date()
        }
      });

      return {
        success: true,
        message: `Refund webhook marked REQUIRES_REVIEW: ${mismatchReason}`,
        providerEventId,
        eventType,
        status: 'REQUIRES_REVIEW'
      };
    }

    // 4. Authoritative State Transitions
    if (eventType === 'refund.failed' || refundStatus === 'failed') {
      if (refundRecord.status !== RefundStatus.FAILED) {
        await prisma.billingRefund.update({
          where: { id: refundRecord.id },
          data: {
            providerRefundId: providerRefundId || refundRecord.providerRefundId,
            status: RefundStatus.FAILED,
            failureReason: refundEntity?.error_description || 'Refund failed at provider'
          }
        });

        await prisma.auditEvent.create({
          data: {
            userId: refundRecord.userId,
            eventType: AuditEventType.REFUND_FAILED,
            metadata: {
              refundId: refundRecord.id,
              providerRefundId,
              providerEventId,
              reason: refundEntity?.error_description
            }
          }
        });

        // Dispatch failure notification
        const idempotencyKey = `notif_wh_ref_failed_${refundRecord.id}`;
        await prisma.notificationRecord.upsert({
          where: { idempotencyKey },
          update: {},
          create: {
            eventId: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            userId: refundRecord.userId,
            eventType: 'BILLING_REFUND_FAILED',
            category: 'BILLING',
            severity: 'INFO',
            title: 'Refund Request Failed',
            body: `Your refund of ${refundRecord.currency} ${(refundRecord.amountMinorUnits / 100).toFixed(2)} could not be processed by the payment provider.`,
            metadata: { refundId: refundRecord.id },
            idempotencyKey
          }
        }).catch(() => {});
      }
    } else {
      // Processed
      if (refundRecord.status !== RefundStatus.PROCESSED) {
        await prisma.billingRefund.update({
          where: { id: refundRecord.id },
          data: {
            providerRefundId: providerRefundId || refundRecord.providerRefundId,
            status: RefundStatus.PROCESSED,
            providerProcessedAt: new Date()
          }
        });

        await prisma.auditEvent.create({
          data: {
            userId: refundRecord.userId,
            eventType: AuditEventType.REFUND_PROCESSED,
            metadata: {
              refundId: refundRecord.id,
              providerRefundId,
              amountMinorUnits: refundRecord.amountMinorUnits,
              currency: refundRecord.currency,
              providerEventId
            }
          }
        });

        // Dispatch success notification
        const idempotencyKey = `notif_wh_ref_processed_${refundRecord.id}`;
        await prisma.notificationRecord.upsert({
          where: { idempotencyKey },
          update: {},
          create: {
            eventId: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            userId: refundRecord.userId,
            eventType: 'BILLING_REFUND_PROCESSED',
            category: 'BILLING',
            severity: 'INFO',
            title: 'Refund Processed',
            body: `Your refund of ${refundRecord.currency} ${(refundRecord.amountMinorUnits / 100).toFixed(2)} has been successfully processed.`,
            metadata: { refundId: refundRecord.id, providerRefundId },
            idempotencyKey
          }
        }).catch(() => {});
      }
    }

    // 5. Finalize Webhook Log
    await prisma.billingWebhookEvent.update({
      where: { id: webhookLogId },
      data: {
        status: WebhookEventStatus.PROCESSED,
        processedAt: new Date()
      }
    });

    return {
      success: true,
      message: `Refund webhook '${eventType}' processed successfully`,
      providerEventId,
      eventType,
      status: refundRecord.status
    };
  }
}
