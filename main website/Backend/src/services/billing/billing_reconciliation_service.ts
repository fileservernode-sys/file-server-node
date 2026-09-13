import {
  PrismaClient,
  PaymentProvider,
  PaymentEnvironment,
  ReconciliationStatus,
  ReconciliationDiscrepancyType,
  ReconciliationRunStatus,
  ReconciliationEntityType,
  AuditEventType,
  ProcessingFeeStatus,
  ProcessingFeeSource,
  CurrencyCode,
  Prisma
} from '@prisma/client';
import { prisma as defaultPrisma } from '../../config/database.js';
import { ValidationError, NotFoundError } from '../../errors/app-error.js';
import {
  NormalizedReconRecord,
  NormalizedSettlementData
} from './providers/razorpay/razorpay_reconciliation_adapter.js';

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
}

export const billingReconciliationService = new BillingReconciliationService();
