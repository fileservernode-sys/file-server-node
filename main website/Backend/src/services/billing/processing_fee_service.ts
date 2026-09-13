import { prisma } from '../../config/database.js';
import {
  CurrencyCode,
  PaymentProvider,
  PaymentEnvironment,
  ProcessingFeeStatus,
  ProcessingFeeSource,
  AuditEventType,
  Prisma,
  BillingPaymentProcessingFee
} from '@prisma/client';
import { ValidationError, NotFoundError } from '../../errors/app-error.js';

export interface CaptureProcessingFeeParams {
  paymentId: string;
  providerPaymentId?: string;
  providerSettlementId?: string | null;
  feeAmountMinorUnits: number;
  feeTaxMinorUnits?: number;
  feeCurrency?: CurrencyCode;
  netSettlementAmountMinorUnits?: number | null;
  source?: ProcessingFeeSource;
  status?: ProcessingFeeStatus;
  metadata?: Record<string, any>;
}

export class ProcessingFeeService {
  /**
   * Records or updates an internal merchant processing fee record for a BillingPayment.
   * Completely separated from customer charges (ZdexCloud absorbs provider fees).
   *
   * Invariant: Estimated fees are non-authoritative and must have status PENDING, never CAPTURED or RECONCILED.
   */
  public static async recordProcessingFee(
    params: CaptureProcessingFeeParams,
    options?: { tx?: Prisma.TransactionClient }
  ): Promise<BillingPaymentProcessingFee> {
    const client = options?.tx || prisma;
    const {
      paymentId,
      providerPaymentId,
      providerSettlementId,
      feeAmountMinorUnits,
      feeTaxMinorUnits = 0,
      feeCurrency = CurrencyCode.INR,
      netSettlementAmountMinorUnits = null,
      source = ProcessingFeeSource.ESTIMATED
    } = params;

    let { status = ProcessingFeeStatus.CAPTURED } = params;

    if (!paymentId) {
      throw new ValidationError('paymentId is required');
    }

    if (!Number.isInteger(feeAmountMinorUnits) || feeAmountMinorUnits < 0) {
      throw new ValidationError('feeAmountMinorUnits must be a non-negative integer');
    }

    if (!Number.isInteger(feeTaxMinorUnits) || feeTaxMinorUnits < 0) {
      throw new ValidationError('feeTaxMinorUnits must be a non-negative integer');
    }

    // Safety Invariant: An estimated fee must never be marked CAPTURED or RECONCILED without provider authority
    if (source === ProcessingFeeSource.ESTIMATED && (status === ProcessingFeeStatus.CAPTURED || status === ProcessingFeeStatus.RECONCILED)) {
      status = ProcessingFeeStatus.PENDING;
    }

    // Safety Invariant: Status RECONCILED requires an authoritative providerSettlementId
    if (status === ProcessingFeeStatus.RECONCILED && !providerSettlementId) {
      throw new ValidationError('providerSettlementId is required for RECONCILED processing fee status');
    }

    const payment = await client.billingPayment.findUnique({
      where: { id: paymentId }
    });

    if (!payment) {
      throw new NotFoundError(`BillingPayment ${paymentId} not found`);
    }

    const totalFeeMinorUnits = feeAmountMinorUnits + feeTaxMinorUnits;

    // Derived settlement credit (authoritative when reported by provider settlement report)
    const effectiveNetSettlement =
      netSettlementAmountMinorUnits !== undefined && netSettlementAmountMinorUnits !== null
        ? netSettlementAmountMinorUnits
        : (source === ProcessingFeeSource.SETTLEMENT_REPORT ? Math.max(0, payment.amountMinorUnits - totalFeeMinorUnits) : null);

    const feeRecord = await client.billingPaymentProcessingFee.upsert({
      where: { paymentId },
      update: {
        providerPaymentId: providerPaymentId || payment.providerPaymentId,
        providerSettlementId: providerSettlementId || undefined,
        feeAmountMinorUnits,
        feeTaxMinorUnits,
        totalFeeMinorUnits,
        feeCurrency,
        netSettlementAmountMinorUnits: effectiveNetSettlement,
        status,
        source,
        capturedAt: status === ProcessingFeeStatus.CAPTURED || status === ProcessingFeeStatus.RECONCILED ? new Date() : undefined,
        reconciledAt: status === ProcessingFeeStatus.RECONCILED ? new Date() : undefined,
        metadata: params.metadata ? (params.metadata as Prisma.InputJsonValue) : undefined
      },
      create: {
        paymentId,
        provider: payment.provider,
        providerEnvironment: payment.environment,
        providerPaymentId: providerPaymentId || payment.providerPaymentId,
        providerSettlementId: providerSettlementId || null,
        feeAmountMinorUnits,
        feeTaxMinorUnits,
        totalFeeMinorUnits,
        feeCurrency,
        netSettlementAmountMinorUnits: effectiveNetSettlement,
        status,
        source,
        capturedAt: status === ProcessingFeeStatus.CAPTURED || status === ProcessingFeeStatus.RECONCILED ? new Date() : null,
        reconciledAt: status === ProcessingFeeStatus.RECONCILED ? new Date() : null,
        metadata: params.metadata ? (params.metadata as Prisma.InputJsonValue) : Prisma.DbNull
      }
    });

    // Record audit event
    try {
      await client.auditEvent.create({
        data: {
          userId: payment.userId,
          eventType: AuditEventType.PROCESSING_FEE_RECORDED,
          metadata: {
            paymentId,
            providerPaymentId: feeRecord.providerPaymentId,
            providerSettlementId: feeRecord.providerSettlementId,
            feeAmountMinorUnits,
            feeTaxMinorUnits,
            totalFeeMinorUnits,
            feeCurrency,
            netSettlementAmountMinorUnits: feeRecord.netSettlementAmountMinorUnits,
            status,
            source
          }
        }
      });
    } catch {
      // Non-blocking audit
    }

    return feeRecord;
  }
}
