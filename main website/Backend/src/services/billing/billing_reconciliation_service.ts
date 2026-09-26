import {
  PrismaClient,
  PaymentProvider,
  PaymentEnvironment,
  BillingStatus,
  ReconciliationStatus,
  ReconciliationDiscrepancyType,
  ReconciliationRunStatus,
  ReconciliationEntityType,
  AuditEventType,
  ProcessingFeeStatus,
  ProcessingFeeSource,
  CurrencyCode,
  WebhookEventStatus,
  Prisma
} from '@prisma/client';
import { prisma as defaultPrisma } from '../../config/database.js';
import { ValidationError, NotFoundError } from '../../errors/app-error.js';
import {
  NormalizedReconRecord,
  NormalizedSettlementData
} from './providers/razorpay/razorpay_reconciliation_adapter.js';
import { BillingStateService } from './billing_state_service.js';
import { EntitlementService } from './entitlement_service.js';

export enum ReconciliationDriftCategory {
  CUSTOMER_LINK_MISMATCH = 'CUSTOMER_LINK_MISMATCH',
  SUBSCRIPTION_STATUS_MISMATCH = 'SUBSCRIPTION_STATUS_MISMATCH',
  PLAN_MAPPING_MISMATCH = 'PLAN_MAPPING_MISMATCH',
  PRICE_MAPPING_MISMATCH = 'PRICE_MAPPING_MISMATCH',
  PERIOD_DATE_MISMATCH = 'PERIOD_DATE_MISMATCH',
  CANCELLATION_STATE_MISMATCH = 'CANCELLATION_STATE_MISMATCH',
  REFUND_STATE_MISMATCH = 'REFUND_STATE_MISMATCH',
  ENTITLEMENT_MISMATCH = 'ENTITLEMENT_MISMATCH',
  MISSING_PROVIDER_OBJECT = 'MISSING_PROVIDER_OBJECT',
  MISSING_LOCAL_OBJECT = 'MISSING_LOCAL_OBJECT',
  STALE_LOCAL_STATE = 'STALE_LOCAL_STATE',
  UNKNOWN_PROVIDER_STATE = 'UNKNOWN_PROVIDER_STATE',
  WEBHOOK_PROCESSING_GAP = 'WEBHOOK_PROCESSING_GAP',
  EXISTING_RESOURCE_OVER_CAPACITY = 'EXISTING_RESOURCE_OVER_CAPACITY'
}

export enum ReconciliationSeverity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  CRITICAL = 'CRITICAL'
}

export interface StateDriftFinding {
  category: ReconciliationDriftCategory;
  severity: ReconciliationSeverity;
  provider: PaymentProvider;
  userId?: string | null;
  subscriptionId?: string | null;
  providerEntityId?: string | null;
  expectedValue: string;
  actualValue: string;
  localStateSummary: Record<string, any>;
  providerStateSummary: Record<string, any>;
  detectedAt: Date;
  status: ReconciliationStatus;
  repaired: boolean;
  repairAction?: string | null;
  errorInfo?: string | null;
  discrepancyId?: string;
}

export interface ReconcileSubscriptionDriftParams {
  userId?: string;
  subscriptionId?: string;
  providerSubscriptionId?: string;
  providerSubscriptionData?: Record<string, any> | null;
  autoRepair?: boolean;
  runId?: string | null;
}

export interface ReconcileSubscriptionDriftResult {
  userId: string;
  subscriptionId?: string | null;
  hasDrift: boolean;
  findings: StateDriftFinding[];
  repairsApplied: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  effectivePlan: string;
  effectiveEntitlements: Record<string, any>;
}

export interface StartReconciliationRunParams {
  provider?: PaymentProvider;
  environment?: PaymentEnvironment;
  periodStart: Date;
  periodEnd: Date;
  correlationId?: string;
  metadata?: Record<string, any>;
}

export interface ExecuteReconciliationBatchParams {
  provider?: PaymentProvider;
  environment?: PaymentEnvironment;
  periodStart: Date;
  periodEnd: Date;
  providerRecords?: NormalizedReconRecord[];
  settlements?: NormalizedSettlementData[];
  correlationId?: string;
  metadata?: Record<string, any>;
}

export interface RecordDiscrepancyParams {
  runId?: string | null;
  reconciliationRecordId?: string | null;
  provider?: PaymentProvider;
  entityType: ReconciliationEntityType;
  providerEntityId: string;
  internalEntityId?: string | null;
  discrepancyType: ReconciliationDiscrepancyType;
  status?: ReconciliationStatus;
  expectedValue?: string | null;
  actualValue?: string | null;
  resolutionReason?: string | null;
  metadata?: Record<string, any>;
}

export interface ResolveDiscrepancyParams {
  discrepancyId: string;
  resolvedBy: string;
  resolutionReason: string;
  resolutionAction?: string;
}

export class BillingReconciliationService {
  private readonly db: PrismaClient;

  constructor(prismaClient?: PrismaClient) {
    this.db = prismaClient || defaultPrisma;
  }

  /**
   * Starts a new reconciliation batch run record.
   */
  public async startReconciliationRun(
    params: StartReconciliationRunParams,
    tx?: any
  ): Promise<any> {
    const client = tx || this.db;
    const provider = params.provider || PaymentProvider.RAZORPAY;
    const environment = params.environment || PaymentEnvironment.TEST;

    if (!params.periodStart || !params.periodEnd) {
      throw new ValidationError('periodStart and periodEnd are required for a reconciliation run');
    }
    if (params.periodStart > params.periodEnd) {
      throw new ValidationError('periodStart cannot be after periodEnd');
    }

    const run = await client.billingReconciliationRun.create({
      data: {
        provider,
        environment,
        periodStart: params.periodStart,
        periodEnd: params.periodEnd,
        status: ReconciliationRunStatus.STARTED,
        correlationId: params.correlationId || null,
        metadata: params.metadata ? (params.metadata as Prisma.InputJsonValue) : Prisma.DbNull
      }
    });

    try {
      await client.auditEvent.create({
        data: {
          userId: null,
          eventType: AuditEventType.BILLING_RECONCILIATION_STARTED,
          metadata: {
            runId: run.id,
            provider,
            environment,
            periodStart: params.periodStart.toISOString(),
            periodEnd: params.periodEnd.toISOString()
          }
        }
      });
    } catch {
      // Audit log non-blocking
    }

    return run;
  }

  /**
   * Reconciles an individual payment provider record.
   */
  public async reconcilePaymentRecord(
    runId: string | null,
    record: NormalizedReconRecord,
    tx?: any
  ): Promise<{
    reconRecord: any;
    discrepancies: any[];
    isDuplicate: boolean;
  }> {
    const client = tx || this.db;
    const discrepancies: any[] = [];
    const provider = PaymentProvider.RAZORPAY;
    const environment = PaymentEnvironment.TEST;

    // Check for duplicate provider record
    const existingRecord = await client.billingReconciliationRecord.findUnique({
      where: {
        billing_recon_rec_prov_entity_uniq: {
          provider,
          environment,
          providerEntityId: record.providerEntityId,
          entityType: ReconciliationEntityType.PAYMENT
        }
      }
    });

    if (existingRecord && existingRecord.runId === runId && existingRecord.runId !== null) {
      const disc = await this.recordDiscrepancy(
        {
          runId,
          reconciliationRecordId: existingRecord.id,
          provider,
          entityType: ReconciliationEntityType.PAYMENT,
          providerEntityId: record.providerEntityId,
          internalEntityId: existingRecord.internalPaymentId,
          discrepancyType: ReconciliationDiscrepancyType.DUPLICATE_PROVIDER_RECORD,
          status: ReconciliationStatus.REQUIRES_REVIEW,
          expectedValue: 'Single provider record',
          actualValue: `Duplicate record for ${record.providerEntityId}`,
          metadata: record.rawPayload
        },
        client
      );
      discrepancies.push(disc);
      return { reconRecord: existingRecord, discrepancies, isDuplicate: true };
    }

    // Lookup internal payment
    const providerPaymentId = record.providerPaymentId || record.providerEntityId;
    const internalPayment = await client.billingPayment.findFirst({
      where: {
        provider,
        environment,
        providerPaymentId
      },
      include: {
        processingFee: true,
        tax: true
      }
    });

    let recordStatus: ReconciliationStatus = ReconciliationStatus.MATCHED;
    let internalPaymentId: string | null = null;

    if (!internalPayment) {
      recordStatus = ReconciliationStatus.REQUIRES_REVIEW;
    } else {
      internalPaymentId = internalPayment.id;

      // 1. Validate Amount
      if (internalPayment.amountMinorUnits !== record.amountMinorUnits) {
        recordStatus = ReconciliationStatus.MISMATCHED;
        const disc = await this.recordDiscrepancy(
          {
            runId,
            provider,
            entityType: ReconciliationEntityType.PAYMENT,
            providerEntityId: record.providerEntityId,
            internalEntityId: internalPayment.id,
            discrepancyType: ReconciliationDiscrepancyType.PAYMENT_AMOUNT_MISMATCH,
            status: ReconciliationStatus.REQUIRES_REVIEW,
            expectedValue: String(internalPayment.amountMinorUnits),
            actualValue: String(record.amountMinorUnits),
            metadata: { internalPaymentId: internalPayment.id, raw: record.rawPayload }
          },
          client
        );
        discrepancies.push(disc);
      }

      // 2. Validate Currency
      if (internalPayment.currency !== record.currency) {
        recordStatus = ReconciliationStatus.MISMATCHED;
        const disc = await this.recordDiscrepancy(
          {
            runId,
            provider,
            entityType: ReconciliationEntityType.PAYMENT,
            providerEntityId: record.providerEntityId,
            internalEntityId: internalPayment.id,
            discrepancyType: ReconciliationDiscrepancyType.PAYMENT_CURRENCY_MISMATCH,
            status: ReconciliationStatus.REQUIRES_REVIEW,
            expectedValue: internalPayment.currency,
            actualValue: record.currency,
            metadata: { internalPaymentId: internalPayment.id, raw: record.rawPayload }
          },
          client
        );
        discrepancies.push(disc);
      }

      // 3. Validate Processing Fee if present
      if (record.providerFeeMinorUnits !== null && record.providerFeeMinorUnits !== undefined) {
        if (internalPayment.processingFee) {
          const currentFee = internalPayment.processingFee.feeAmountMinorUnits;
          const currentFeeTax = internalPayment.processingFee.feeTaxMinorUnits;

          const feeMismatched = currentFee !== record.providerFeeMinorUnits;
          const taxMismatched =
            record.providerFeeTaxMinorUnits !== null &&
            record.providerFeeTaxMinorUnits !== undefined &&
            currentFeeTax !== record.providerFeeTaxMinorUnits;

          if (feeMismatched) {
            recordStatus = ReconciliationStatus.MISMATCHED;
            const disc = await this.recordDiscrepancy(
              {
                runId,
                provider,
                entityType: ReconciliationEntityType.PAYMENT,
                providerEntityId: record.providerEntityId,
                internalEntityId: internalPayment.id,
                discrepancyType: ReconciliationDiscrepancyType.PROCESSING_FEE_MISMATCH,
                status: ReconciliationStatus.REQUIRES_REVIEW,
                expectedValue: String(currentFee),
                actualValue: String(record.providerFeeMinorUnits),
                metadata: { processingFeeId: internalPayment.processingFee.id }
              },
              client
            );
            discrepancies.push(disc);
          }

          if (taxMismatched) {
            recordStatus = ReconciliationStatus.MISMATCHED;
            const disc = await this.recordDiscrepancy(
              {
                runId,
                provider,
                entityType: ReconciliationEntityType.PAYMENT,
                providerEntityId: record.providerEntityId,
                internalEntityId: internalPayment.id,
                discrepancyType: ReconciliationDiscrepancyType.PROCESSING_FEE_TAX_MISMATCH,
                status: ReconciliationStatus.REQUIRES_REVIEW,
                expectedValue: String(currentFeeTax),
                actualValue: String(record.providerFeeTaxMinorUnits),
                metadata: { processingFeeId: internalPayment.processingFee.id }
              },
              client
            );
            discrepancies.push(disc);
          }

          // Transition fee status / update settlement linkage without changing customer financial data
          if (
            internalPayment.processingFee.status === ProcessingFeeStatus.PENDING ||
            internalPayment.processingFee.status === ProcessingFeeStatus.CAPTURED ||
            (record.providerSettlementId && internalPayment.processingFee.providerSettlementId !== record.providerSettlementId)
          ) {
            await client.billingPaymentProcessingFee.update({
              where: { id: internalPayment.processingFee.id },
              data: {
                status: record.settled ? ProcessingFeeStatus.RECONCILED : internalPayment.processingFee.status,
                providerSettlementId: record.providerSettlementId || internalPayment.processingFee.providerSettlementId,
                reconciledAt: record.settled ? (internalPayment.processingFee.reconciledAt || new Date()) : internalPayment.processingFee.reconciledAt
              }
            });
          }
        }
      }
    }

    // Upsert BillingReconciliationRecord
    const reconRecord = await client.billingReconciliationRecord.upsert({
      where: {
        billing_recon_rec_prov_entity_uniq: {
          provider,
          environment,
          providerEntityId: record.providerEntityId,
          entityType: ReconciliationEntityType.PAYMENT
        }
      },
      create: {
        runId,
        provider,
        environment,
        providerEntityId: record.providerEntityId,
        entityType: ReconciliationEntityType.PAYMENT,
        providerPaymentId,
        providerSettlementId: record.providerSettlementId || null,
        settlementUtr: record.settlementUtr || null,
        amountMinorUnits: record.amountMinorUnits,
        debitMinorUnits: record.debitMinorUnits || null,
        creditMinorUnits: record.creditMinorUnits || null,
        currency: record.currency,
        providerFeeMinorUnits: record.providerFeeMinorUnits || null,
        providerFeeTaxMinorUnits: record.providerFeeTaxMinorUnits || null,
        settled: record.settled,
        settledAt: record.settledAt || null,
        orderId: record.orderId || null,
        internalPaymentId,
        status: recordStatus,
        metadata: record.rawPayload ? (record.rawPayload as Prisma.InputJsonValue) : Prisma.DbNull
      },
      update: {
        runId: runId || undefined,
        providerPaymentId,
        providerSettlementId: record.providerSettlementId || undefined,
        settlementUtr: record.settlementUtr || undefined,
        amountMinorUnits: record.amountMinorUnits,
        currency: record.currency,
        providerFeeMinorUnits: record.providerFeeMinorUnits || undefined,
        providerFeeTaxMinorUnits: record.providerFeeTaxMinorUnits || undefined,
        settled: record.settled,
        settledAt: record.settledAt || undefined,
        internalPaymentId: internalPaymentId || undefined,
        status: recordStatus,
        metadata: record.rawPayload ? (record.rawPayload as Prisma.InputJsonValue) : undefined
      }
    });

    if (!internalPayment) {
      const disc = await this.recordDiscrepancy(
        {
          runId,
          reconciliationRecordId: reconRecord.id,
          provider,
          entityType: ReconciliationEntityType.PAYMENT,
          providerEntityId: record.providerEntityId,
          internalEntityId: null,
          discrepancyType: ReconciliationDiscrepancyType.INTERNAL_PAYMENT_NOT_FOUND,
          status: ReconciliationStatus.REQUIRES_REVIEW,
          expectedValue: 'Internal BillingPayment record',
          actualValue: `Provider payment ${record.providerEntityId} not found internally`,
          metadata: record.rawPayload
        },
        client
      );
      discrepancies.push(disc);
    }

    return { reconRecord, discrepancies, isDuplicate: false };
  }

  /**
   * Reconciles an individual refund provider record.
   */
  public async reconcileRefundRecord(
    runId: string | null,
    record: NormalizedReconRecord,
    tx?: any
  ): Promise<{
    reconRecord: any;
    discrepancies: any[];
    isDuplicate: boolean;
  }> {
    const client = tx || this.db;
    const discrepancies: any[] = [];
    const provider = PaymentProvider.RAZORPAY;
    const environment = PaymentEnvironment.TEST;

    // Check for duplicate refund record
    const existingRecord = await client.billingReconciliationRecord.findUnique({
      where: {
        billing_recon_rec_prov_entity_uniq: {
          provider,
          environment,
          providerEntityId: record.providerEntityId,
          entityType: ReconciliationEntityType.REFUND
        }
      }
    });

    if (existingRecord && existingRecord.runId === runId && existingRecord.runId !== null) {
      const disc = await this.recordDiscrepancy(
        {
          runId,
          reconciliationRecordId: existingRecord.id,
          provider,
          entityType: ReconciliationEntityType.REFUND,
          providerEntityId: record.providerEntityId,
          internalEntityId: existingRecord.internalRefundId,
          discrepancyType: ReconciliationDiscrepancyType.DUPLICATE_PROVIDER_RECORD,
          status: ReconciliationStatus.REQUIRES_REVIEW,
          expectedValue: 'Single provider refund record',
          actualValue: `Duplicate refund record for ${record.providerEntityId}`,
          metadata: record.rawPayload
        },
        client
      );
      discrepancies.push(disc);
      return { reconRecord: existingRecord, discrepancies, isDuplicate: true };
    }

    const providerRefundId = record.providerRefundId || record.providerEntityId;
    const internalRefund = await client.billingRefund.findFirst({
      where: {
        provider,
        providerEnvironment: environment,
        providerRefundId
      },
      include: {
        payment: true
      }
    });

    let recordStatus: ReconciliationStatus = ReconciliationStatus.MATCHED;
    let internalRefundId: string | null = null;
    let internalPaymentId: string | null = null;

    if (!internalRefund) {
      recordStatus = ReconciliationStatus.REQUIRES_REVIEW;
    } else {
      internalRefundId = internalRefund.id;
      internalPaymentId = internalRefund.paymentId;

      // 1. Validate Amount
      if (internalRefund.amountMinorUnits !== record.amountMinorUnits) {
        recordStatus = ReconciliationStatus.MISMATCHED;
        const disc = await this.recordDiscrepancy(
          {
            runId,
            provider,
            entityType: ReconciliationEntityType.REFUND,
            providerEntityId: record.providerEntityId,
            internalEntityId: internalRefund.id,
            discrepancyType: ReconciliationDiscrepancyType.REFUND_AMOUNT_MISMATCH,
            status: ReconciliationStatus.REQUIRES_REVIEW,
            expectedValue: String(internalRefund.amountMinorUnits),
            actualValue: String(record.amountMinorUnits),
            metadata: { internalRefundId: internalRefund.id, raw: record.rawPayload }
          },
          client
        );
        discrepancies.push(disc);
      }

      // 2. Validate Currency
      if (internalRefund.currency !== record.currency) {
        recordStatus = ReconciliationStatus.MISMATCHED;
        const disc = await this.recordDiscrepancy(
          {
            runId,
            provider,
            entityType: ReconciliationEntityType.REFUND,
            providerEntityId: record.providerEntityId,
            internalEntityId: internalRefund.id,
            discrepancyType: ReconciliationDiscrepancyType.REFUND_CURRENCY_MISMATCH,
            status: ReconciliationStatus.REQUIRES_REVIEW,
            expectedValue: internalRefund.currency,
            actualValue: record.currency,
            metadata: { internalRefundId: internalRefund.id, raw: record.rawPayload }
          },
          client
        );
        discrepancies.push(disc);
      }
    }

    // Upsert BillingReconciliationRecord
    const reconRecord = await client.billingReconciliationRecord.upsert({
      where: {
        billing_recon_rec_prov_entity_uniq: {
          provider,
          environment,
          providerEntityId: record.providerEntityId,
          entityType: ReconciliationEntityType.REFUND
        }
      },
      create: {
        runId,
        provider,
        environment,
        providerEntityId: record.providerEntityId,
        entityType: ReconciliationEntityType.REFUND,
        providerPaymentId: record.providerPaymentId || (internalRefund?.payment?.providerPaymentId || null),
        providerRefundId,
        providerSettlementId: record.providerSettlementId || null,
        settlementUtr: record.settlementUtr || null,
        amountMinorUnits: record.amountMinorUnits,
        debitMinorUnits: record.debitMinorUnits || null,
        creditMinorUnits: record.creditMinorUnits || null,
        currency: record.currency,
        providerFeeMinorUnits: record.providerFeeMinorUnits || null,
        providerFeeTaxMinorUnits: record.providerFeeTaxMinorUnits || null,
        settled: record.settled,
        settledAt: record.settledAt || null,
        orderId: record.orderId || null,
        internalPaymentId,
        internalRefundId,
        status: recordStatus,
        metadata: record.rawPayload ? (record.rawPayload as Prisma.InputJsonValue) : Prisma.DbNull
      },
      update: {
        runId: runId || undefined,
        providerPaymentId: record.providerPaymentId || undefined,
        providerRefundId,
        providerSettlementId: record.providerSettlementId || undefined,
        settlementUtr: record.settlementUtr || undefined,
        amountMinorUnits: record.amountMinorUnits,
        currency: record.currency,
        settled: record.settled,
        settledAt: record.settledAt || undefined,
        internalPaymentId: internalPaymentId || undefined,
        internalRefundId: internalRefundId || undefined,
        status: recordStatus,
        metadata: record.rawPayload ? (record.rawPayload as Prisma.InputJsonValue) : undefined
      }
    });

    if (!internalRefund) {
      const disc = await this.recordDiscrepancy(
        {
          runId,
          reconciliationRecordId: reconRecord.id,
          provider,
          entityType: ReconciliationEntityType.REFUND,
          providerEntityId: record.providerEntityId,
          internalEntityId: null,
          discrepancyType: ReconciliationDiscrepancyType.PROVIDER_REFUND_NOT_FOUND,
          status: ReconciliationStatus.REQUIRES_REVIEW,
          expectedValue: 'Internal BillingRefund record',
          actualValue: `Provider refund ${record.providerEntityId} not found internally`,
          metadata: record.rawPayload
        },
        client
      );
      discrepancies.push(disc);
    }

    return { reconRecord, discrepancies, isDuplicate: false };
  }

  /**
   * Reconciles adjustments or transfers.
   */
  public async reconcileAdjustmentOrTransfer(
    runId: string | null,
    record: NormalizedReconRecord,
    tx?: any
  ): Promise<{
    reconRecord: any;
    discrepancies: any[];
  }> {
    const client = tx || this.db;
    const discrepancies: any[] = [];
    const provider = PaymentProvider.RAZORPAY;
    const environment = PaymentEnvironment.TEST;

    const discrepancyType =
      record.entityType === ReconciliationEntityType.TRANSFER
        ? ReconciliationDiscrepancyType.PROVIDER_TRANSFER_UNMATCHED
        : ReconciliationDiscrepancyType.PROVIDER_ADJUSTMENT_UNMATCHED;

    const reconRecord = await client.billingReconciliationRecord.upsert({
      where: {
        billing_recon_rec_prov_entity_uniq: {
          provider,
          environment,
          providerEntityId: record.providerEntityId,
          entityType: record.entityType
        }
      },
      create: {
        runId,
        provider,
        environment,
        providerEntityId: record.providerEntityId,
        entityType: record.entityType,
        providerPaymentId: record.providerPaymentId || null,
        providerRefundId: record.providerRefundId || null,
        providerSettlementId: record.providerSettlementId || null,
        settlementUtr: record.settlementUtr || null,
        amountMinorUnits: record.amountMinorUnits,
        debitMinorUnits: record.debitMinorUnits || null,
        creditMinorUnits: record.creditMinorUnits || null,
        currency: record.currency,
        providerFeeMinorUnits: record.providerFeeMinorUnits || null,
        providerFeeTaxMinorUnits: record.providerFeeTaxMinorUnits || null,
        settled: record.settled,
        settledAt: record.settledAt || null,
        status: ReconciliationStatus.REQUIRES_REVIEW,
        metadata: record.rawPayload ? (record.rawPayload as Prisma.InputJsonValue) : Prisma.DbNull
      },
      update: {
        runId: runId || undefined,
        amountMinorUnits: record.amountMinorUnits,
        settled: record.settled,
        settledAt: record.settledAt || undefined,
        status: ReconciliationStatus.REQUIRES_REVIEW,
        metadata: record.rawPayload ? (record.rawPayload as Prisma.InputJsonValue) : undefined
      }
    });

    const disc = await this.recordDiscrepancy(
      {
        runId,
        reconciliationRecordId: reconRecord.id,
        provider,
        entityType: record.entityType,
        providerEntityId: record.providerEntityId,
        internalEntityId: null,
        discrepancyType,
        status: ReconciliationStatus.REQUIRES_REVIEW,
        expectedValue: 'Internal standard transaction',
        actualValue: `Provider ${record.entityType.toLowerCase()} ${record.providerEntityId} requires manual review`,
        metadata: record.rawPayload
      },
      client
    );
    discrepancies.push(disc);

    return { reconRecord, discrepancies };
  }

  /**
   * Reconciles an authoritative settlement entity.
   */
  public async reconcileSettlementRecord(
    settlement: NormalizedSettlementData,
    tx?: any
  ): Promise<{
    settlement: any;
    discrepancies: any[];
  }> {
    const client = tx || this.db;
    const discrepancies: any[] = [];
    const provider = PaymentProvider.RAZORPAY;
    const environment = PaymentEnvironment.TEST;

    const existingSettlement = await client.billingSettlement.findUnique({
      where: { providerSettlementId: settlement.providerSettlementId }
    });

    let reconStatus: ReconciliationStatus = ReconciliationStatus.MATCHED;

    if (existingSettlement) {
      if (existingSettlement.settlementAmountMinorUnits !== settlement.settlementAmountMinorUnits) {
        reconStatus = ReconciliationStatus.MISMATCHED;
        const disc = await this.recordDiscrepancy(
          {
            provider,
            entityType: ReconciliationEntityType.SETTLEMENT,
            providerEntityId: settlement.providerSettlementId,
            internalEntityId: existingSettlement.id,
            discrepancyType: ReconciliationDiscrepancyType.SETTLEMENT_AMOUNT_MISMATCH,
            status: ReconciliationStatus.REQUIRES_REVIEW,
            expectedValue: String(existingSettlement.settlementAmountMinorUnits),
            actualValue: String(settlement.settlementAmountMinorUnits),
            metadata: settlement.rawPayload
          },
          client
        );
        discrepancies.push(disc);
      }

      if (existingSettlement.settlementCurrency !== settlement.settlementCurrency) {
        reconStatus = ReconciliationStatus.MISMATCHED;
        const disc = await this.recordDiscrepancy(
          {
            provider,
            entityType: ReconciliationEntityType.SETTLEMENT,
            providerEntityId: settlement.providerSettlementId,
            internalEntityId: existingSettlement.id,
            discrepancyType: ReconciliationDiscrepancyType.SETTLEMENT_CURRENCY_MISMATCH,
            status: ReconciliationStatus.REQUIRES_REVIEW,
            expectedValue: existingSettlement.settlementCurrency,
            actualValue: settlement.settlementCurrency,
            metadata: settlement.rawPayload
          },
          client
        );
        discrepancies.push(disc);
      }
    }

    const savedSettlement = await client.billingSettlement.upsert({
      where: { providerSettlementId: settlement.providerSettlementId },
      create: {
        provider,
        environment,
        providerSettlementId: settlement.providerSettlementId,
        settlementUtr: settlement.settlementUtr || null,
        settlementCurrency: settlement.settlementCurrency,
        settlementAmountMinorUnits: settlement.settlementAmountMinorUnits,
        providerFeesMinorUnits: settlement.providerFeesMinorUnits,
        providerTaxMinorUnits: settlement.providerTaxMinorUnits,
        settlementStatus: settlement.settlementStatus,
        settledAt: settlement.settledAt || null,
        reconciliationStatus: reconStatus,
        metadata: settlement.rawPayload ? (settlement.rawPayload as Prisma.InputJsonValue) : Prisma.DbNull
      },
      update: {
        settlementUtr: settlement.settlementUtr || undefined,
        settlementAmountMinorUnits: settlement.settlementAmountMinorUnits,
        providerFeesMinorUnits: settlement.providerFeesMinorUnits,
        providerTaxMinorUnits: settlement.providerTaxMinorUnits,
        settlementStatus: settlement.settlementStatus,
        settledAt: settlement.settledAt || undefined,
        reconciliationStatus: reconStatus,
        metadata: settlement.rawPayload ? (settlement.rawPayload as Prisma.InputJsonValue) : undefined
      }
    });

    try {
      await client.auditEvent.create({
        data: {
          userId: null,
          eventType: AuditEventType.BILLING_SETTLEMENT_RECORDED,
          metadata: {
            settlementId: savedSettlement.id,
            providerSettlementId: settlement.providerSettlementId,
            amountMinorUnits: settlement.settlementAmountMinorUnits,
            currency: settlement.settlementCurrency,
            reconciliationStatus: reconStatus
          }
        }
      });
    } catch {
      // Non-blocking
    }

    return { settlement: savedSettlement, discrepancies };
  }

  /**
   * Reconciles missing provider payment records for internal successful payments.
   */
  public async reconcileMissingProviderPayments(
    runId: string,
    periodStart: Date,
    periodEnd: Date,
    tx?: any
  ): Promise<any[]> {
    const client = tx || this.db;
    const discrepancies: any[] = [];

    const internalPayments = await client.billingPayment.findMany({
      where: {
        status: 'SUCCESS',
        chargedAt: {
          gte: periodStart,
          lte: periodEnd
        }
      }
    });

    for (const payment of internalPayments) {
      if (!payment.providerPaymentId) continue;

      const reconRecord = await client.billingReconciliationRecord.findUnique({
        where: {
          billing_recon_rec_prov_entity_uniq: {
            provider: payment.provider,
            environment: payment.environment,
            providerEntityId: payment.providerPaymentId,
            entityType: ReconciliationEntityType.PAYMENT
          }
        }
      });

      if (!reconRecord) {
        const disc = await this.recordDiscrepancy(
          {
            runId,
            provider: payment.provider,
            entityType: ReconciliationEntityType.PAYMENT,
            providerEntityId: payment.providerPaymentId,
            internalEntityId: payment.id,
            discrepancyType: ReconciliationDiscrepancyType.PROVIDER_PAYMENT_NOT_FOUND,
            status: ReconciliationStatus.REQUIRES_REVIEW,
            expectedValue: `Payment ${payment.providerPaymentId} charged at ${payment.chargedAt.toISOString()}`,
            actualValue: 'Missing in provider reconciliation records',
            metadata: { internalPaymentId: payment.id, amountMinorUnits: payment.amountMinorUnits }
          },
          client
        );
        discrepancies.push(disc);
      }
    }

    return discrepancies;
  }

  /**
   * Reconciles missing provider refund records for internal processed refunds.
   */
  public async reconcileMissingProviderRefunds(
    runId: string,
    periodStart: Date,
    periodEnd: Date,
    tx?: any
  ): Promise<any[]> {
    const client = tx || this.db;
    const discrepancies: any[] = [];

    const internalRefunds = await client.billingRefund.findMany({
      where: {
        status: 'PROCESSED',
        requestedAt: {
          gte: periodStart,
          lte: periodEnd
        }
      }
    });

    for (const refund of internalRefunds) {
      if (!refund.providerRefundId) continue;

      const reconRecord = await client.billingReconciliationRecord.findUnique({
        where: {
          billing_recon_rec_prov_entity_uniq: {
            provider: refund.provider,
            environment: refund.providerEnvironment,
            providerEntityId: refund.providerRefundId,
            entityType: ReconciliationEntityType.REFUND
          }
        }
      });

      if (!reconRecord) {
        const disc = await this.recordDiscrepancy(
          {
            runId,
            provider: refund.provider,
            entityType: ReconciliationEntityType.REFUND,
            providerEntityId: refund.providerRefundId,
            internalEntityId: refund.id,
            discrepancyType: ReconciliationDiscrepancyType.PROVIDER_REFUND_NOT_FOUND,
            status: ReconciliationStatus.REQUIRES_REVIEW,
            expectedValue: `Refund ${refund.providerRefundId} processed internally`,
            actualValue: 'Missing in provider reconciliation records',
            metadata: { internalRefundId: refund.id, amountMinorUnits: refund.amountMinorUnits }
          },
          client
        );
        discrepancies.push(disc);
      }
    }

    return discrepancies;
  }

  /**
   * Records a granular discrepancy.
   */
  public async recordDiscrepancy(
    params: RecordDiscrepancyParams,
    tx?: any
  ): Promise<any> {
    const client = tx || this.db;

    let runId = params.runId || null;
    if (runId) {
      try {
        const runExists = await client.billingReconciliationRun.findUnique({
          where: { id: runId },
          select: { id: true }
        });
        if (!runExists) {
          runId = null;
        }
      } catch {
        runId = null;
      }
    }

    // Deduplicate against existing open/unresolved discrepancy for the same entity and type
    const existingOpenDiscrepancy = await client.billingReconciliationDiscrepancy.findFirst({
      where: {
        providerEntityId: params.providerEntityId,
        entityType: params.entityType,
        discrepancyType: params.discrepancyType,
        status: { in: [ReconciliationStatus.REQUIRES_REVIEW, ReconciliationStatus.PENDING, ReconciliationStatus.MISMATCHED] }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (existingOpenDiscrepancy) {
      const updatedDiscrepancy = await client.billingReconciliationDiscrepancy.update({
        where: { id: existingOpenDiscrepancy.id },
        data: {
          runId: runId || existingOpenDiscrepancy.runId,
          reconciliationRecordId: params.reconciliationRecordId || existingOpenDiscrepancy.reconciliationRecordId,
          internalEntityId: params.internalEntityId || existingOpenDiscrepancy.internalEntityId,
          status: params.status || existingOpenDiscrepancy.status,
          expectedValue: params.expectedValue !== undefined ? params.expectedValue : existingOpenDiscrepancy.expectedValue,
          actualValue: params.actualValue !== undefined ? params.actualValue : existingOpenDiscrepancy.actualValue,
          resolutionReason: params.resolutionReason !== undefined ? params.resolutionReason : existingOpenDiscrepancy.resolutionReason,
          metadata: params.metadata ? (params.metadata as Prisma.InputJsonValue) : existingOpenDiscrepancy.metadata
        }
      });
      return updatedDiscrepancy;
    }

    const discrepancy = await client.billingReconciliationDiscrepancy.create({
      data: {
        runId,
        reconciliationRecordId: params.reconciliationRecordId || null,
        provider: params.provider || PaymentProvider.RAZORPAY,
        entityType: params.entityType,
        providerEntityId: params.providerEntityId,
        internalEntityId: params.internalEntityId || null,
        discrepancyType: params.discrepancyType,
        status: params.status || ReconciliationStatus.REQUIRES_REVIEW,
        expectedValue: params.expectedValue || null,
        actualValue: params.actualValue || null,
        resolutionReason: params.resolutionReason || null,
        metadata: params.metadata ? (params.metadata as Prisma.InputJsonValue) : Prisma.DbNull
      }
    });

    try {
      await client.auditEvent.create({
        data: {
          userId: null,
          eventType: AuditEventType.BILLING_RECONCILIATION_DISCREPANCY_DETECTED,
          metadata: {
            discrepancyId: discrepancy.id,
            runId: params.runId,
            discrepancyType: params.discrepancyType,
            providerEntityId: params.providerEntityId,
            entityType: params.entityType
          }
        }
      });
    } catch {
      // Non-blocking
    }

    return discrepancy;
  }

  /**
   * Resolves an existing discrepancy with audit trail.
   */
  public async resolveDiscrepancy(
    params: ResolveDiscrepancyParams,
    tx?: any
  ): Promise<any> {
    const client = tx || this.db;

    const existing = await client.billingReconciliationDiscrepancy.findUnique({
      where: { id: params.discrepancyId }
    });

    if (!existing) {
      throw new NotFoundError(`Discrepancy with ID ${params.discrepancyId} not found`);
    }

    const updated = await client.billingReconciliationDiscrepancy.update({
      where: { id: params.discrepancyId },
      data: {
        status: ReconciliationStatus.RESOLVED,
        resolvedBy: params.resolvedBy,
        resolutionReason: params.resolutionReason,
        resolvedAt: new Date()
      }
    });

    try {
      await client.auditEvent.create({
        data: {
          userId: null,
          eventType: AuditEventType.BILLING_RECONCILIATION_DISCREPANCY_RESOLVED,
          metadata: {
            discrepancyId: params.discrepancyId,
            resolvedBy: params.resolvedBy,
            resolutionReason: params.resolutionReason,
            resolutionAction: params.resolutionAction || 'MANUAL_RESOLUTION'
          }
        }
      });
    } catch {
      // Non-blocking
    }

    return updated;
  }

  /**
   * Executes a complete batch reconciliation run across provider records and settlements.
   */
  public async executeReconciliationBatch(
    params: ExecuteReconciliationBatchParams,
    tx?: any
  ): Promise<any> {
    const startTime = Date.now();
    const run = await this.startReconciliationRun(
      {
        provider: params.provider,
        environment: params.environment,
        periodStart: params.periodStart,
        periodEnd: params.periodEnd,
        correlationId: params.correlationId,
        metadata: params.metadata
      },
      tx
    );

    const client = tx || this.db;

    let paymentRecords = 0;
    let refundRecords = 0;
    let transferRecords = 0;
    let adjustmentRecords = 0;
    let matchedCount = 0;
    let mismatchCount = 0;
    let reviewCount = 0;
    let duplicateCount = 0;
    let failureCount = 0;

    const providerRecords = params.providerRecords || [];
    const settlements = params.settlements || [];

    // 1. Process settlements
    for (const settlement of settlements) {
      try {
        const res = await this.reconcileSettlementRecord(settlement, client);
        if (res.discrepancies.length > 0) {
          mismatchCount += res.discrepancies.length;
        }
      } catch {
        failureCount++;
      }
    }

    // 2. Process transaction records
    for (const record of providerRecords) {
      try {
        if (record.entityType === ReconciliationEntityType.PAYMENT) {
          paymentRecords++;
          const res = await this.reconcilePaymentRecord(run.id, record, client);
          if (res.isDuplicate) {
            duplicateCount++;
          } else if (res.reconRecord.status === ReconciliationStatus.MATCHED) {
            matchedCount++;
          } else if (res.reconRecord.status === ReconciliationStatus.MISMATCHED) {
            mismatchCount++;
          } else if (res.reconRecord.status === ReconciliationStatus.REQUIRES_REVIEW) {
            reviewCount++;
          }
        } else if (record.entityType === ReconciliationEntityType.REFUND) {
          refundRecords++;
          const res = await this.reconcileRefundRecord(run.id, record, client);
          if (res.isDuplicate) {
            duplicateCount++;
          } else if (res.reconRecord.status === ReconciliationStatus.MATCHED) {
            matchedCount++;
          } else if (res.reconRecord.status === ReconciliationStatus.MISMATCHED) {
            mismatchCount++;
          } else if (res.reconRecord.status === ReconciliationStatus.REQUIRES_REVIEW) {
            reviewCount++;
          }
        } else if (
          record.entityType === ReconciliationEntityType.TRANSFER ||
          record.entityType === ReconciliationEntityType.ADJUSTMENT
        ) {
          if (record.entityType === ReconciliationEntityType.TRANSFER) transferRecords++;
          if (record.entityType === ReconciliationEntityType.ADJUSTMENT) adjustmentRecords++;
          const res = await this.reconcileAdjustmentOrTransfer(run.id, record, client);
          reviewCount++;
        }
      } catch {
        failureCount++;
      }
    }

    // 3. Process missing provider records
    const missingPayments = await this.reconcileMissingProviderPayments(
      run.id,
      params.periodStart,
      params.periodEnd,
      client
    );
    reviewCount += missingPayments.length;

    const missingRefunds = await this.reconcileMissingProviderRefunds(
      run.id,
      params.periodStart,
      params.periodEnd,
      client
    );
    reviewCount += missingRefunds.length;

    const durationMs = Date.now() - startTime;
    const totalRecords = providerRecords.length + missingPayments.length + missingRefunds.length;

    const finalStatus =
      failureCount > 0
        ? ReconciliationRunStatus.PARTIALLY_COMPLETED
        : ReconciliationRunStatus.COMPLETED;

    const completedRun = await client.billingReconciliationRun.update({
      where: { id: run.id },
      data: {
        status: finalStatus,
        totalRecords,
        paymentRecords,
        refundRecords,
        transferRecords,
        adjustmentRecords,
        matchedCount,
        mismatchCount,
        reviewCount,
        duplicateCount,
        failureCount,
        durationMs,
        completedAt: new Date()
      }
    });

    try {
      await client.auditEvent.create({
        data: {
          userId: null,
          eventType: AuditEventType.BILLING_RECONCILIATION_COMPLETED,
          metadata: {
            runId: run.id,
            totalRecords,
            matchedCount,
            mismatchCount,
            reviewCount,
            durationMs,
            status: finalStatus
          }
        }
      });
    } catch {
      // Non-blocking
    }

    return completedRun;
  }

  /**
   * Retrieves summary details of a reconciliation run.
   */
  public async getReconciliationRunSummary(runId: string, tx?: any): Promise<any> {
    const client = tx || this.db;
    const run = await client.billingReconciliationRun.findUnique({
      where: { id: runId },
      include: {
        discrepancies: true,
        records: true
      }
    });

    if (!run) {
      throw new NotFoundError(`Reconciliation run with ID ${runId} not found`);
    }

    return run;
  }

  /**
   * Retrieves unresolved discrepancies requiring review.
   */
  public async getUnresolvedDiscrepancies(
    params?: {
      runId?: string;
      entityType?: ReconciliationEntityType;
      limit?: number;
      offset?: number;
    },
    tx?: any
  ): Promise<any[]> {
    const client = tx || this.db;
    const where: any = {
      status: {
        in: [ReconciliationStatus.REQUIRES_REVIEW, ReconciliationStatus.MISMATCHED, ReconciliationStatus.PENDING]
      }
    };

    if (params?.runId) where.runId = params.runId;
    if (params?.entityType) where.entityType = params.entityType;

    return client.billingReconciliationDiscrepancy.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: params?.limit || 100,
      skip: params?.offset || 0
    });
  }
  /**
   * Reconciles subscription state and entitlement drift between provider and local database.
   * Classifies drift, determines severity, applies safe deterministic projections where eligible,
   * leaves ambiguous financial cases as REQUIRES_REVIEW, and preserves existing resources safely.
   */
  public async reconcileSubscriptionDrift(
    params: ReconcileSubscriptionDriftParams,
    tx?: any
  ): Promise<ReconcileSubscriptionDriftResult> {
    const client = tx || this.db;
    const provider = PaymentProvider.RAZORPAY;
    const autoRepair = params.autoRepair ?? true;
    const runId = params.runId || null;

    // 1. Resolve local user and subscription
    let targetUserId = params.userId || null;
    let localSub: any = null;

    if (params.subscriptionId) {
      localSub = await client.subscription.findUnique({
        where: { id: params.subscriptionId },
        include: { plan: true, planPrice: true, user: true }
      });
      if (localSub) {
        targetUserId = localSub.userId;
      }
    } else if (params.providerSubscriptionId) {
      localSub = await client.subscription.findUnique({
        where: { providerSubscriptionId: params.providerSubscriptionId },
        include: { plan: true, planPrice: true, user: true }
      });
      if (localSub) {
        targetUserId = localSub.userId;
      }
    } else if (targetUserId) {
      const activeState = await client.accountBillingState.findUnique({
        where: { userId: targetUserId },
        include: {
          activeSubscription: {
            include: { plan: true, planPrice: true, user: true }
          }
        }
      });
      if (activeState?.activeSubscription) {
        localSub = activeState.activeSubscription;
      } else {
        localSub = await client.subscription.findFirst({
          where: { userId: targetUserId },
          orderBy: { createdAt: 'desc' },
          include: { plan: true, planPrice: true, user: true }
        });
      }
    }

    const findings: StateDriftFinding[] = [];
    let repairsApplied = 0;

    // Case: Missing local object when provider data exists
    if (!localSub && !targetUserId && params.providerSubscriptionData) {
      const disc = await this.recordDiscrepancy(
        {
          runId,
          provider,
          entityType: ReconciliationEntityType.PAYMENT,
          providerEntityId: String(params.providerSubscriptionData.id || params.providerSubscriptionId || 'unknown'),
          internalEntityId: null,
          discrepancyType: ReconciliationDiscrepancyType.INTERNAL_PAYMENT_NOT_FOUND,
          status: ReconciliationStatus.REQUIRES_REVIEW,
          expectedValue: 'Local Subscription & User contract',
          actualValue: `Provider subscription ${params.providerSubscriptionData.id} has no matching local account`,
          metadata: {
            category: ReconciliationDriftCategory.MISSING_LOCAL_OBJECT,
            severity: ReconciliationSeverity.CRITICAL,
            providerData: params.providerSubscriptionData
          }
        },
        client
      );

      findings.push({
        category: ReconciliationDriftCategory.MISSING_LOCAL_OBJECT,
        severity: ReconciliationSeverity.CRITICAL,
        provider,
        userId: null,
        subscriptionId: null,
        providerEntityId: String(params.providerSubscriptionData.id || params.providerSubscriptionId || ''),
        expectedValue: 'Local Subscription & User contract',
        actualValue: 'No matching local account found',
        localStateSummary: {},
        providerStateSummary: params.providerSubscriptionData,
        detectedAt: new Date(),
        status: ReconciliationStatus.REQUIRES_REVIEW,
        repaired: false,
        discrepancyId: disc.id
      });

      return {
        userId: '',
        subscriptionId: null,
        hasDrift: true,
        findings,
        repairsApplied: 0,
        criticalCount: 1,
        warningCount: 0,
        infoCount: 0,
        effectivePlan: 'FREE',
        effectiveEntitlements: { maxServers: 1, priorityRelay: false }
      };
    }

    if (!targetUserId && localSub) {
      targetUserId = localSub.userId;
    }

    if (!targetUserId) {
      throw new ValidationError('userId or valid subscription is required for drift reconciliation');
    }

    const providerData = params.providerSubscriptionData;
    const now = new Date();

    // Case: Missing provider object when local subscription has external provider ID
    if (localSub?.providerSubscriptionId && providerData === null && params.providerSubscriptionData !== undefined) {
      const disc = await this.recordDiscrepancy(
        {
          runId,
          provider,
          entityType: ReconciliationEntityType.PAYMENT,
          providerEntityId: localSub.providerSubscriptionId,
          internalEntityId: localSub.id,
          discrepancyType: ReconciliationDiscrepancyType.PROVIDER_PAYMENT_NOT_FOUND,
          status: ReconciliationStatus.REQUIRES_REVIEW,
          expectedValue: `Provider subscription entity ${localSub.providerSubscriptionId}`,
          actualValue: 'Provider returned 404 or missing object',
          metadata: {
            category: ReconciliationDriftCategory.MISSING_PROVIDER_OBJECT,
            severity: ReconciliationSeverity.CRITICAL,
            userId: targetUserId,
            subscriptionId: localSub.id
          }
        },
        client
      );

      findings.push({
        category: ReconciliationDriftCategory.MISSING_PROVIDER_OBJECT,
        severity: ReconciliationSeverity.CRITICAL,
        provider,
        userId: targetUserId,
        subscriptionId: localSub.id,
        providerEntityId: localSub.providerSubscriptionId,
        expectedValue: `Provider subscription entity ${localSub.providerSubscriptionId}`,
        actualValue: 'Missing in provider records',
        localStateSummary: { status: localSub.status, planCode: localSub.plan?.code },
        providerStateSummary: {},
        detectedAt: now,
        status: ReconciliationStatus.REQUIRES_REVIEW,
        repaired: false,
        discrepancyId: disc.id
      });
    }

    // 2. Compare provider subscription against local subscription if both exist
    if (localSub && providerData && typeof providerData === 'object') {
      const providerStatus = String(providerData.status || '').toLowerCase();
      const localStatus = String(localSub.status || '');
      const providerPlanId = providerData.plan_id ? String(providerData.plan_id) : null;
      const providerCurrentStart = providerData.current_start ? new Date(providerData.current_start * 1000) : null;
      const providerCurrentEnd = providerData.current_end ? new Date(providerData.current_end * 1000) : null;
      const providerEndedAt = providerData.ended_at ? new Date(providerData.ended_at * 1000) : null;
      const providerCancelAtEnd = Boolean(providerData.cancel_at_cycle_end === 1 || providerData.cancel_at_cycle_end === true);

      // A. Status Drift Comparison
      const isProviderActive = providerStatus === 'active';
      const isProviderEnded = providerStatus === 'cancelled' || providerStatus === 'completed' || providerStatus === 'expired' || (providerEndedAt && providerEndedAt <= now);
      const isLocalActive = localStatus === 'ACTIVE';
      const isLocalExpired = localStatus === 'EXPIRED';

      if (isProviderActive && isLocalExpired) {
        // Provider says ACTIVE, local says EXPIRED -> CRITICAL
        let repaired = false;
        let repairAction: string | null = null;

        if (autoRepair) {
          // Safe deterministic projection: re-activate local subscription
          await client.subscription.update({
            where: { id: localSub.id },
            data: {
              status: BillingStatus.ACTIVE,
              currentPeriodStart: providerCurrentStart || localSub.currentPeriodStart,
              currentPeriodEnd: providerCurrentEnd || localSub.currentPeriodEnd,
              expiredAt: null,
              updatedAt: now
            }
          });

          await client.accountBillingState.upsert({
            where: { userId: targetUserId },
            update: {
              status: BillingStatus.ACTIVE,
              activeSubscriptionId: localSub.id,
              currency: localSub.currency,
              updatedAt: now
            },
            create: {
              userId: targetUserId,
              status: BillingStatus.ACTIVE,
              activeSubscriptionId: localSub.id,
              currency: localSub.currency
            }
          });

          try {
            await client.auditEvent.create({
              data: {
                userId: targetUserId,
                eventType: AuditEventType.BILLING_RECONCILIATION_DISCREPANCY_RESOLVED,
                metadata: {
                  action: 'AUTO_REPAIR_STATUS_ACTIVE',
                  category: ReconciliationDriftCategory.SUBSCRIPTION_STATUS_MISMATCH,
                  subscriptionId: localSub.id,
                  providerSubscriptionId: localSub.providerSubscriptionId,
                  previousStatus: localStatus,
                  newStatus: 'ACTIVE'
                }
              }
            });
          } catch {}

          repaired = true;
          repairAction = 'RESTORED_LOCAL_ACTIVE_STATE';
          repairsApplied++;
        }

        const disc = await this.recordDiscrepancy(
          {
            runId,
            provider,
            entityType: ReconciliationEntityType.PAYMENT,
            providerEntityId: localSub.providerSubscriptionId || localSub.id,
            internalEntityId: localSub.id,
            discrepancyType: ReconciliationDiscrepancyType.PAYMENT_STATE_MISMATCH,
            status: repaired ? ReconciliationStatus.RESOLVED : ReconciliationStatus.REQUIRES_REVIEW,
            expectedValue: 'ACTIVE (matching provider)',
            actualValue: 'EXPIRED (local database)',
            resolutionReason: repairAction,
            metadata: {
              category: ReconciliationDriftCategory.SUBSCRIPTION_STATUS_MISMATCH,
              severity: ReconciliationSeverity.CRITICAL,
              repaired
            }
          },
          client
        );

        findings.push({
          category: ReconciliationDriftCategory.SUBSCRIPTION_STATUS_MISMATCH,
          severity: ReconciliationSeverity.CRITICAL,
          provider,
          userId: targetUserId,
          subscriptionId: localSub.id,
          providerEntityId: localSub.providerSubscriptionId,
          expectedValue: 'ACTIVE',
          actualValue: 'EXPIRED',
          localStateSummary: { status: localStatus },
          providerStateSummary: { status: providerStatus },
          detectedAt: now,
          status: repaired ? ReconciliationStatus.RESOLVED : ReconciliationStatus.REQUIRES_REVIEW,
          repaired,
          repairAction,
          discrepancyId: disc.id
        });
      } else if (isProviderEnded && isLocalActive) {
        // Provider has ended/cancelled, local still ACTIVE -> CRITICAL
        let repaired = false;
        let repairAction: string | null = null;

        if (autoRepair) {
          // Safe deterministic projection: expire local subscription without deleting any server resources
          await client.subscription.update({
            where: { id: localSub.id },
            data: {
              status: BillingStatus.EXPIRED,
              expiredAt: providerEndedAt || now,
              updatedAt: now
            }
          });

          await client.accountBillingState.update({
            where: { userId: targetUserId },
            data: {
              status: BillingStatus.EXPIRED,
              activeSubscriptionId: null,
              updatedAt: now
            }
          });

          try {
            await client.auditEvent.create({
              data: {
                userId: targetUserId,
                eventType: AuditEventType.BILLING_RECONCILIATION_DISCREPANCY_RESOLVED,
                metadata: {
                  action: 'AUTO_REPAIR_STATUS_EXPIRED',
                  category: ReconciliationDriftCategory.SUBSCRIPTION_STATUS_MISMATCH,
                  subscriptionId: localSub.id,
                  providerSubscriptionId: localSub.providerSubscriptionId,
                  previousStatus: localStatus,
                  newStatus: 'EXPIRED',
                  serverResourcesPreserved: true
                }
              }
            });
          } catch {}

          repaired = true;
          repairAction = 'EXPIRED_LOCAL_SUBSCRIPTION_PRESERVED_RESOURCES';
          repairsApplied++;
        }

        const disc = await this.recordDiscrepancy(
          {
            runId,
            provider,
            entityType: ReconciliationEntityType.PAYMENT,
            providerEntityId: localSub.providerSubscriptionId || localSub.id,
            internalEntityId: localSub.id,
            discrepancyType: ReconciliationDiscrepancyType.PAYMENT_STATE_MISMATCH,
            status: repaired ? ReconciliationStatus.RESOLVED : ReconciliationStatus.REQUIRES_REVIEW,
            expectedValue: 'EXPIRED (matching provider cancellation/completion)',
            actualValue: 'ACTIVE (local database)',
            resolutionReason: repairAction,
            metadata: {
              category: ReconciliationDriftCategory.SUBSCRIPTION_STATUS_MISMATCH,
              severity: ReconciliationSeverity.CRITICAL,
              repaired
            }
          },
          client
        );

        findings.push({
          category: ReconciliationDriftCategory.SUBSCRIPTION_STATUS_MISMATCH,
          severity: ReconciliationSeverity.CRITICAL,
          provider,
          userId: targetUserId,
          subscriptionId: localSub.id,
          providerEntityId: localSub.providerSubscriptionId,
          expectedValue: 'EXPIRED',
          actualValue: 'ACTIVE',
          localStateSummary: { status: localStatus },
          providerStateSummary: { status: providerStatus, endedAt: providerEndedAt },
          detectedAt: now,
          status: repaired ? ReconciliationStatus.RESOLVED : ReconciliationStatus.REQUIRES_REVIEW,
          repaired,
          repairAction,
          discrepancyId: disc.id
        });
      }

      // B. Plan Mapping Drift Comparison
      if (providerPlanId && localSub.providerPlanId && providerPlanId !== localSub.providerPlanId) {
        const mapping = await client.billingProviderPlanMapping.findFirst({
          where: { providerPlanId }
        });

        const isUnknownPlan = !mapping;
        const severity = isUnknownPlan ? ReconciliationSeverity.CRITICAL : ReconciliationSeverity.WARNING;
        const category = isUnknownPlan ? ReconciliationDriftCategory.UNKNOWN_PROVIDER_STATE : ReconciliationDriftCategory.PLAN_MAPPING_MISMATCH;

        const disc = await this.recordDiscrepancy(
          {
            runId,
            provider,
            entityType: ReconciliationEntityType.PAYMENT,
            providerEntityId: localSub.providerSubscriptionId || localSub.id,
            internalEntityId: localSub.id,
            discrepancyType: ReconciliationDiscrepancyType.PAYMENT_STATE_MISMATCH,
            status: ReconciliationStatus.REQUIRES_REVIEW, // Ambiguous plan change requires review; never auto-grant Pro
            expectedValue: localSub.providerPlanId,
            actualValue: providerPlanId,
            metadata: { category, severity, isUnknownPlan }
          },
          client
        );

        findings.push({
          category,
          severity,
          provider,
          userId: targetUserId,
          subscriptionId: localSub.id,
          providerEntityId: localSub.providerSubscriptionId,
          expectedValue: localSub.providerPlanId,
          actualValue: providerPlanId,
          localStateSummary: { providerPlanId: localSub.providerPlanId, planCode: localSub.plan?.code },
          providerStateSummary: { plan_id: providerPlanId },
          detectedAt: now,
          status: ReconciliationStatus.REQUIRES_REVIEW,
          repaired: false,
          errorInfo: isUnknownPlan ? 'Unknown provider plan ID not mapped in catalog' : 'Provider plan differs from contracted plan',
          discrepancyId: disc.id
        });
      }

      // C. Price Mapping Drift Comparison
      if (providerData.item?.amount !== undefined || providerData.amount !== undefined) {
        const providerAmount = typeof providerData.item?.amount === 'number' ? providerData.item.amount : providerData.amount;
        if (typeof providerAmount === 'number' && providerAmount !== localSub.amountMinorUnits) {
          const disc = await this.recordDiscrepancy(
            {
              runId,
              provider,
              entityType: ReconciliationEntityType.PAYMENT,
              providerEntityId: localSub.providerSubscriptionId || localSub.id,
              internalEntityId: localSub.id,
              discrepancyType: ReconciliationDiscrepancyType.PAYMENT_AMOUNT_MISMATCH,
              status: ReconciliationStatus.REQUIRES_REVIEW, // Ambiguous financial difference requires review
              expectedValue: String(localSub.amountMinorUnits),
              actualValue: String(providerAmount),
              metadata: {
                category: ReconciliationDriftCategory.PRICE_MAPPING_MISMATCH,
                severity: ReconciliationSeverity.CRITICAL
              }
            },
            client
          );

          findings.push({
            category: ReconciliationDriftCategory.PRICE_MAPPING_MISMATCH,
            severity: ReconciliationSeverity.CRITICAL,
            provider,
            userId: targetUserId,
            subscriptionId: localSub.id,
            providerEntityId: localSub.providerSubscriptionId,
            expectedValue: String(localSub.amountMinorUnits),
            actualValue: String(providerAmount),
            localStateSummary: { amountMinorUnits: localSub.amountMinorUnits, currency: localSub.currency },
            providerStateSummary: { amountMinorUnits: providerAmount },
            detectedAt: now,
            status: ReconciliationStatus.REQUIRES_REVIEW,
            repaired: false,
            discrepancyId: disc.id
          });
        }
      }

      // D. Period Date Drift Comparison
      if (providerCurrentEnd && Math.abs(providerCurrentEnd.getTime() - localSub.currentPeriodEnd.getTime()) > 60000) {
        let repaired = false;
        let repairAction: string | null = null;

        if (autoRepair && providerCurrentEnd > localSub.currentPeriodStart) {
          // Safe deterministic projection: synchronize period dates to authoritative provider timestamps
          await client.subscription.update({
            where: { id: localSub.id },
            data: {
              currentPeriodStart: providerCurrentStart || localSub.currentPeriodStart,
              currentPeriodEnd: providerCurrentEnd,
              updatedAt: now
            }
          });

          try {
            await client.auditEvent.create({
              data: {
                userId: targetUserId,
                eventType: AuditEventType.BILLING_RECONCILIATION_DISCREPANCY_RESOLVED,
                metadata: {
                  action: 'AUTO_REPAIR_PERIOD_DATES',
                  category: ReconciliationDriftCategory.PERIOD_DATE_MISMATCH,
                  subscriptionId: localSub.id,
                  previousPeriodEnd: localSub.currentPeriodEnd.toISOString(),
                  newPeriodEnd: providerCurrentEnd.toISOString()
                }
              }
            });
          } catch {}

          repaired = true;
          repairAction = 'SYNCHRONIZED_PERIOD_DATES';
          repairsApplied++;
        }

        const disc = await this.recordDiscrepancy(
          {
            runId,
            provider,
            entityType: ReconciliationEntityType.PAYMENT,
            providerEntityId: localSub.providerSubscriptionId || localSub.id,
            internalEntityId: localSub.id,
            discrepancyType: ReconciliationDiscrepancyType.PAYMENT_STATE_MISMATCH,
            status: repaired ? ReconciliationStatus.RESOLVED : ReconciliationStatus.REQUIRES_REVIEW,
            expectedValue: localSub.currentPeriodEnd.toISOString(),
            actualValue: providerCurrentEnd.toISOString(),
            resolutionReason: repairAction,
            metadata: {
              category: ReconciliationDriftCategory.PERIOD_DATE_MISMATCH,
              severity: ReconciliationSeverity.WARNING,
              repaired
            }
          },
          client
        );

        findings.push({
          category: ReconciliationDriftCategory.PERIOD_DATE_MISMATCH,
          severity: ReconciliationSeverity.WARNING,
          provider,
          userId: targetUserId,
          subscriptionId: localSub.id,
          providerEntityId: localSub.providerSubscriptionId,
          expectedValue: localSub.currentPeriodEnd.toISOString(),
          actualValue: providerCurrentEnd.toISOString(),
          localStateSummary: { currentPeriodEnd: localSub.currentPeriodEnd },
          providerStateSummary: { current_end: providerCurrentEnd },
          detectedAt: now,
          status: repaired ? ReconciliationStatus.RESOLVED : ReconciliationStatus.REQUIRES_REVIEW,
          repaired,
          repairAction,
          discrepancyId: disc.id
        });
      }

      // E. Cancellation State Drift Comparison
      if (providerCancelAtEnd !== localSub.cancelAtPeriodEnd) {
        let repaired = false;
        let repairAction: string | null = null;

        if (autoRepair) {
          await client.subscription.update({
            where: { id: localSub.id },
            data: {
              cancelAtPeriodEnd: providerCancelAtEnd,
              status: providerCancelAtEnd && localSub.status === BillingStatus.ACTIVE ? BillingStatus.CANCELLING : localSub.status,
              cancelledAt: providerCancelAtEnd ? (localSub.cancelledAt || now) : null,
              updatedAt: now
            }
          });

          try {
            await client.auditEvent.create({
              data: {
                userId: targetUserId,
                eventType: AuditEventType.BILLING_RECONCILIATION_DISCREPANCY_RESOLVED,
                metadata: {
                  action: 'AUTO_REPAIR_CANCELLATION_STATE',
                  category: ReconciliationDriftCategory.CANCELLATION_STATE_MISMATCH,
                  subscriptionId: localSub.id,
                  cancelAtPeriodEnd: providerCancelAtEnd
                }
              }
            });
          } catch {}

          repaired = true;
          repairAction = 'SYNCHRONIZED_CANCELLATION_STATE';
          repairsApplied++;
        }

        const disc = await this.recordDiscrepancy(
          {
            runId,
            provider,
            entityType: ReconciliationEntityType.PAYMENT,
            providerEntityId: localSub.providerSubscriptionId || localSub.id,
            internalEntityId: localSub.id,
            discrepancyType: ReconciliationDiscrepancyType.PAYMENT_STATE_MISMATCH,
            status: repaired ? ReconciliationStatus.RESOLVED : ReconciliationStatus.REQUIRES_REVIEW,
            expectedValue: String(localSub.cancelAtPeriodEnd),
            actualValue: String(providerCancelAtEnd),
            resolutionReason: repairAction,
            metadata: {
              category: ReconciliationDriftCategory.CANCELLATION_STATE_MISMATCH,
              severity: ReconciliationSeverity.WARNING,
              repaired
            }
          },
          client
        );

        findings.push({
          category: ReconciliationDriftCategory.CANCELLATION_STATE_MISMATCH,
          severity: ReconciliationSeverity.WARNING,
          provider,
          userId: targetUserId,
          subscriptionId: localSub.id,
          providerEntityId: localSub.providerSubscriptionId,
          expectedValue: String(localSub.cancelAtPeriodEnd),
          actualValue: String(providerCancelAtEnd),
          localStateSummary: { cancelAtPeriodEnd: localSub.cancelAtPeriodEnd },
          providerStateSummary: { cancel_at_cycle_end: providerCancelAtEnd },
          detectedAt: now,
          status: repaired ? ReconciliationStatus.RESOLVED : ReconciliationStatus.REQUIRES_REVIEW,
          repaired,
          repairAction,
          discrepancyId: disc.id
        });
      }
    }

    // 3. Check Refund State Drift (e.g. processed refund on subscription while status is still active)
    if (localSub) {
      const processedRefund = await client.billingRefund.findFirst({
        where: {
          subscriptionId: localSub.id,
          status: 'PROCESSED'
        }
      });

      if (processedRefund && localSub.status === BillingStatus.ACTIVE && !localSub.refundedAt) {
        const disc = await this.recordDiscrepancy(
          {
            runId,
            provider,
            entityType: ReconciliationEntityType.REFUND,
            providerEntityId: processedRefund.providerRefundId || processedRefund.id,
            internalEntityId: localSub.id,
            discrepancyType: ReconciliationDiscrepancyType.REFUND_STATE_MISMATCH,
            status: ReconciliationStatus.REQUIRES_REVIEW,
            expectedValue: 'REFUNDED status on Subscription',
            actualValue: `ACTIVE subscription with processed refund ${processedRefund.id}`,
            metadata: {
              category: ReconciliationDriftCategory.REFUND_STATE_MISMATCH,
              severity: ReconciliationSeverity.CRITICAL,
              refundId: processedRefund.id
            }
          },
          client
        );

        findings.push({
          category: ReconciliationDriftCategory.REFUND_STATE_MISMATCH,
          severity: ReconciliationSeverity.CRITICAL,
          provider,
          userId: targetUserId,
          subscriptionId: localSub.id,
          providerEntityId: processedRefund.providerRefundId,
          expectedValue: 'REFUNDED',
          actualValue: 'ACTIVE with processed refund',
          localStateSummary: { subscriptionStatus: localSub.status, refundId: processedRefund.id },
          providerStateSummary: {},
          detectedAt: now,
          status: ReconciliationStatus.REQUIRES_REVIEW,
          repaired: false,
          discrepancyId: disc.id
        });
      }
    }

    // 4. Entitlement Drift & Resource Safety
    // Authoritatively resolve effective plan and entitlements via BillingStateService and EntitlementService
    const effectivePlanResult = await BillingStateService.getEffectivePlan(targetUserId);
    const expectedEntitlements = await EntitlementService.resolvePlanEntitlements(effectivePlanResult.planCode);
    const userEntitlements = await EntitlementService.resolveUserEntitlements(targetUserId);

    // Verify expected vs effective technical capabilities
    if (
      userEntitlements.maxServers !== expectedEntitlements.maxServers ||
      userEntitlements.priorityRelay !== expectedEntitlements.priorityRelay
    ) {
      const disc = await this.recordDiscrepancy(
        {
          runId,
          provider,
          entityType: ReconciliationEntityType.PAYMENT,
          providerEntityId: localSub?.providerSubscriptionId || targetUserId,
          internalEntityId: targetUserId,
          discrepancyType: ReconciliationDiscrepancyType.PAYMENT_STATE_MISMATCH,
          status: ReconciliationStatus.REQUIRES_REVIEW,
          expectedValue: `maxServers=${expectedEntitlements.maxServers}, priorityRelay=${expectedEntitlements.priorityRelay}`,
          actualValue: `maxServers=${userEntitlements.maxServers}, priorityRelay=${userEntitlements.priorityRelay}`,
          metadata: {
            category: ReconciliationDriftCategory.ENTITLEMENT_MISMATCH,
            severity: ReconciliationSeverity.CRITICAL
          }
        },
        client
      );

      findings.push({
        category: ReconciliationDriftCategory.ENTITLEMENT_MISMATCH,
        severity: ReconciliationSeverity.CRITICAL,
        provider,
        userId: targetUserId,
        subscriptionId: localSub?.id || null,
        providerEntityId: localSub?.providerSubscriptionId || null,
        expectedValue: `maxServers=${expectedEntitlements.maxServers}, priorityRelay=${expectedEntitlements.priorityRelay}`,
        actualValue: `maxServers=${userEntitlements.maxServers}, priorityRelay=${userEntitlements.priorityRelay}`,
        localStateSummary: { effectivePlan: effectivePlanResult.planCode, userEntitlements },
        providerStateSummary: {},
        detectedAt: now,
        status: ReconciliationStatus.REQUIRES_REVIEW,
        repaired: false,
        discrepancyId: disc.id
      });
    }

    // Resource safety check: check if user has more existing server instances than effective maxServers
    try {
      const serverCount = await client.serverInstance.count({
        where: {
          device: {
            userId: targetUserId
          }
        }
      });

      if (serverCount > expectedEntitlements.maxServers) {
        // DO NOT delete servers! Record resource over-capacity finding (INFO/WARNING)
        findings.push({
          category: ReconciliationDriftCategory.EXISTING_RESOURCE_OVER_CAPACITY,
          severity: ReconciliationSeverity.INFO,
          provider,
          userId: targetUserId,
          subscriptionId: localSub?.id || null,
          providerEntityId: localSub?.providerSubscriptionId || null,
          expectedValue: `Allowed maxServers=${expectedEntitlements.maxServers}`,
          actualValue: `Existing servers=${serverCount}`,
          localStateSummary: { serverCount, maxServers: expectedEntitlements.maxServers },
          providerStateSummary: {},
          detectedAt: now,
          status: ReconciliationStatus.REQUIRES_REVIEW,
          repaired: false,
          repairAction: 'EXISTING_RESOURCES_PRESERVED_CREATION_BLOCKED'
        });
      }
    } catch {
      // Non-blocking
    }

    const criticalCount = findings.filter((f) => f.severity === ReconciliationSeverity.CRITICAL).length;
    const warningCount = findings.filter((f) => f.severity === ReconciliationSeverity.WARNING).length;
    const infoCount = findings.filter((f) => f.severity === ReconciliationSeverity.INFO).length;

    return {
      userId: targetUserId,
      subscriptionId: localSub?.id || null,
      hasDrift: findings.length > 0,
      findings,
      repairsApplied,
      criticalCount,
      warningCount,
      infoCount,
      effectivePlan: effectivePlanResult.planCode,
      effectiveEntitlements: {
        maxServers: expectedEntitlements.maxServers,
        priorityRelay: expectedEntitlements.priorityRelay
      }
    };
  }

  /**
   * Retrieves high-level operational metrics and reconciliation health statistics.
   * Exposes counts, latencies, critical findings, and pending review queue without secrets.
   */
  public async getReconciliationMetrics(tx?: any): Promise<{
    totalRuns: number;
    completedRuns: number;
    failedRuns: number;
    pendingDiscrepancies: number;
    criticalDiscrepancies: number;
    resolvedDiscrepancies: number;
    lastRunAt: Date | null;
  }> {
    const client = tx || this.db;

    const [totalRuns, completedRuns, failedRuns, lastRun] = await Promise.all([
      client.billingReconciliationRun.count(),
      client.billingReconciliationRun.count({ where: { status: ReconciliationRunStatus.COMPLETED } }),
      client.billingReconciliationRun.count({ where: { status: ReconciliationRunStatus.FAILED } }),
      client.billingReconciliationRun.findFirst({ orderBy: { startedAt: 'desc' }, select: { startedAt: true } })
    ]);

    const [pendingDiscrepancies, resolvedDiscrepancies, allDiscrepancies] = await Promise.all([
      client.billingReconciliationDiscrepancy.count({
        where: { status: { in: [ReconciliationStatus.REQUIRES_REVIEW, ReconciliationStatus.MISMATCHED, ReconciliationStatus.PENDING] } }
      }),
      client.billingReconciliationDiscrepancy.count({
        where: { status: ReconciliationStatus.RESOLVED }
      }),
      client.billingReconciliationDiscrepancy.findMany({
        where: { status: { in: [ReconciliationStatus.REQUIRES_REVIEW, ReconciliationStatus.MISMATCHED] } },
        select: { metadata: true }
      })
    ]);

    let criticalDiscrepancies = 0;
    for (const disc of allDiscrepancies) {
      const meta = disc.metadata as any;
      if (meta?.severity === ReconciliationSeverity.CRITICAL || meta?.severity === 'CRITICAL') {
        criticalDiscrepancies++;
      }
    }

    return {
      totalRuns,
      completedRuns,
      failedRuns,
      pendingDiscrepancies,
      criticalDiscrepancies,
      resolvedDiscrepancies,
      lastRunAt: lastRun?.startedAt || null
    };
  }

  /**
   * Retrieves paginated reconciliation run history with operational filtering.
   * Safe, sanitised output without secrets or unnecessary customer PII.
   */
  public async getReconciliationRuns(
    params: {
      page?: number;
      limit?: number;
      status?: ReconciliationRunStatus;
      startDate?: Date;
      endDate?: Date;
    },
    tx?: any
  ): Promise<{
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    runs: Array<{
      id: string;
      provider: PaymentProvider;
      environment: PaymentEnvironment;
      periodStart: Date;
      periodEnd: Date;
      status: ReconciliationRunStatus;
      totalRecords: number;
      paymentRecords: number;
      refundRecords: number;
      matchedCount: number;
      mismatchCount: number;
      reviewCount: number;
      duplicateCount: number;
      failureCount: number;
      durationMs: number | null;
      correlationId: string | null;
      startedAt: Date;
      completedAt: Date | null;
    }>;
  }> {
    const client = tx || this.db;
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.BillingReconciliationRunWhereInput = {};
    if (params.status) {
      where.status = params.status;
    }
    if (params.startDate || params.endDate) {
      where.startedAt = {};
      if (params.startDate) where.startedAt.gte = params.startDate;
      if (params.endDate) where.startedAt.lte = params.endDate;
    }

    const [total, records] = await Promise.all([
      client.billingReconciliationRun.count({ where }),
      client.billingReconciliationRun.findMany({
        where,
        skip,
        take: limit,
        orderBy: { startedAt: 'desc' },
        select: {
          id: true,
          provider: true,
          environment: true,
          periodStart: true,
          periodEnd: true,
          status: true,
          totalRecords: true,
          paymentRecords: true,
          refundRecords: true,
          matchedCount: true,
          mismatchCount: true,
          reviewCount: true,
          duplicateCount: true,
          failureCount: true,
          durationMs: true,
          correlationId: true,
          startedAt: true,
          completedAt: true
        }
      })
    ]);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      runs: records
    };
  }

  /**
   * Retrieves paginated reconciliation discrepancies with filters and metadata sanitisation.
   */
  public async getDiscrepancies(
    params: {
      page?: number;
      limit?: number;
      status?: ReconciliationStatus;
      severity?: string;
      entityType?: ReconciliationEntityType;
      discrepancyType?: ReconciliationDiscrepancyType;
      runId?: string;
    },
    tx?: any
  ): Promise<{
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    discrepancies: Array<any>;
  }> {
    const client = tx || this.db;
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.BillingReconciliationDiscrepancyWhereInput = {};
    if (params.status) where.status = params.status;
    if (params.entityType) where.entityType = params.entityType;
    if (params.discrepancyType) where.discrepancyType = params.discrepancyType;
    if (params.runId) where.runId = params.runId;

    const [total, rawRecords] = await Promise.all([
      client.billingReconciliationDiscrepancy.count({ where }),
      client.billingReconciliationDiscrepancy.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          runId: true,
          reconciliationRecordId: true,
          provider: true,
          entityType: true,
          providerEntityId: true,
          internalEntityId: true,
          discrepancyType: true,
          status: true,
          expectedValue: true,
          actualValue: true,
          resolutionReason: true,
          resolvedBy: true,
          resolvedAt: true,
          metadata: true,
          createdAt: true,
          updatedAt: true
        }
      })
    ]);

    const sanitized = rawRecords.map((d: any) => ({
      ...d,
      metadata: sanitizeOperationalMetadata(d.metadata)
    }));

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      discrepancies: sanitized
    };
  }

  /**
   * Retrieves single discrepancy details by ID with sanitized metadata.
   */
  public async getDiscrepancyById(id: string, tx?: any): Promise<any> {
    const client = tx || this.db;
    const record = await client.billingReconciliationDiscrepancy.findUnique({
      where: { id },
      include: {
        run: {
          select: {
            id: true,
            status: true,
            startedAt: true,
            completedAt: true
          }
        },
        reconciliationRecord: {
          select: {
            id: true,
            amountMinorUnits: true,
            currency: true,
            status: true
          }
        }
      }
    });

    if (!record) {
      throw new NotFoundError(`Reconciliation discrepancy '${id}' not found`);
    }

    return {
      ...record,
      metadata: sanitizeOperationalMetadata(record.metadata)
    };
  }

  /**
   * Safely updates discrepancy status (manual review resolution / dismissal) with audit trail.
   */
  public async updateDiscrepancyStatus(
    id: string,
    params: {
      status: ReconciliationStatus;
      resolutionReason: string;
      operatorUserId: string;
    },
    tx?: any
  ): Promise<any> {
    const client = tx || this.db;
    const existing = await client.billingReconciliationDiscrepancy.findUnique({
      where: { id }
    });

    if (!existing) {
      throw new NotFoundError(`Reconciliation discrepancy '${id}' not found`);
    }

    const validTargetStatuses: ReconciliationStatus[] = [
      ReconciliationStatus.RESOLVED,
      ReconciliationStatus.IGNORED,
      ReconciliationStatus.REQUIRES_REVIEW
    ];
    if (!validTargetStatuses.includes(params.status)) {
      throw new ValidationError(`Invalid target status '${params.status}' for manual review resolution`);
    }

    if (!params.resolutionReason || typeof params.resolutionReason !== 'string' || params.resolutionReason.trim().length === 0) {
      throw new ValidationError('A non-empty resolutionReason is required when updating discrepancy status');
    }

    const updated = await client.billingReconciliationDiscrepancy.update({
      where: { id },
      data: {
        status: params.status,
        resolutionReason: params.resolutionReason.trim(),
        resolvedBy: params.operatorUserId,
        resolvedAt: params.status === ReconciliationStatus.RESOLVED || params.status === ReconciliationStatus.IGNORED ? new Date() : null
      }
    });

    try {
      await client.auditEvent.create({
        data: {
          userId: params.operatorUserId !== 'SYSTEM_OPERATOR' ? params.operatorUserId : undefined,
          eventType: AuditEventType.BILLING_RECONCILIATION_DISCREPANCY_RESOLVED,
          metadata: {
            discrepancyId: id,
            providerEntityId: updated.providerEntityId,
            discrepancyType: updated.discrepancyType,
            previousStatus: existing.status,
            newStatus: params.status,
            resolutionReason: params.resolutionReason.trim(),
            resolvedBy: params.operatorUserId
          }
        }
      });
    } catch {
      // Non-blocking audit failure
    }

    return {
      ...updated,
      metadata: sanitizeOperationalMetadata(updated.metadata)
    };
  }

  /**
   * Retrieves paginated webhook events for stuck/failed webhook diagnostics.
   */
  public async getWebhookEvents(
    params: {
      page?: number;
      limit?: number;
      status?: WebhookEventStatus;
      eventType?: string;
    },
    tx?: any
  ): Promise<{
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    events: Array<{
      id: string;
      provider: PaymentProvider;
      environment: PaymentEnvironment;
      providerEventId: string;
      eventType: string;
      status: WebhookEventStatus;
      receivedAt: Date;
      processedAt: Date | null;
      failureReason: string | null;
      createdAt: Date;
      updatedAt: Date;
    }>;
  }> {
    const client = tx || this.db;
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.BillingWebhookEventWhereInput = {};
    if (params.status) where.status = params.status;
    if (params.eventType) where.eventType = params.eventType;

    const [total, records] = await Promise.all([
      client.billingWebhookEvent.count({ where }),
      client.billingWebhookEvent.findMany({
        where,
        skip,
        take: limit,
        orderBy: { receivedAt: 'desc' },
        select: {
          id: true,
          provider: true,
          environment: true,
          providerEventId: true,
          eventType: true,
          status: true,
          receivedAt: true,
          processedAt: true,
          failureReason: true,
          createdAt: true,
          updatedAt: true
        }
      })
    ]);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      events: records
    };
  }
}

function sanitizeOperationalMetadata(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeOperationalMetadata);
  const copy: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    const lower = key.toLowerCase();
    if (
      lower.includes('secret') ||
      lower.includes('password') ||
      lower.includes('token') ||
      lower.includes('key') ||
      lower.includes('auth') ||
      lower.includes('card') ||
      lower.includes('cvv') ||
      lower.includes('pan')
    ) {
      copy[key] = '[REDACTED]';
    } else if (value && typeof value === 'object') {
      copy[key] = sanitizeOperationalMetadata(value);
    } else {
      copy[key] = value;
    }
  }
  return copy;
}

export const billingReconciliationService = new BillingReconciliationService();

