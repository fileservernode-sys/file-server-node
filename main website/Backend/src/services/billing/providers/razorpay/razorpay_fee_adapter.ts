import {
  CurrencyCode,
  ProcessingFeeStatus,
  ProcessingFeeSource
} from '@prisma/client';
import { ValidationError } from '../../../../errors/app-error.js';

export interface NormalizedProviderFeeData {
  providerPaymentId: string;
  providerSettlementId?: string | null;
  feeAmountMinorUnits: number;
  feeTaxMinorUnits: number;
  totalFeeMinorUnits: number;
  netSettlementAmountMinorUnits?: number | null;
  feeCurrency: CurrencyCode;
  source: ProcessingFeeSource;
  status: ProcessingFeeStatus;
  capturedAt?: Date | null;
  reconciledAt?: Date | null;
  rawPayload?: Record<string, any>;
}

export class RazorpayFeeAdapter {
  /**
   * Normalizes transaction-level fee data reported by Razorpay payment entity / webhook.
   * Extracts authoritative provider fee, fee tax, and provider currency.
   */
  public static normalizePaymentFee(paymentEntity: any): NormalizedProviderFeeData | null {
    if (!paymentEntity || typeof paymentEntity !== 'object') {
      return null;
    }

    const providerPaymentId = paymentEntity.id;
    if (!providerPaymentId || typeof providerPaymentId !== 'string') {
      return null;
    }

    // Razorpay returns fee and tax in minor units (paise) on captured payment objects
    if (typeof paymentEntity.fee !== 'number') {
      return null;
    }

    const totalFee = Math.max(0, Math.floor(paymentEntity.fee));
    const feeTax = typeof paymentEntity.tax === 'number' ? Math.max(0, Math.floor(paymentEntity.tax)) : 0;
    const baseFee = Math.max(0, totalFee - feeTax);

    const feeCurrency = paymentEntity.currency
      ? (String(paymentEntity.currency).toUpperCase() as CurrencyCode)
      : CurrencyCode.INR;

    return {
      providerPaymentId,
      providerSettlementId: null,
      feeAmountMinorUnits: baseFee,
      feeTaxMinorUnits: feeTax,
      totalFeeMinorUnits: totalFee,
      netSettlementAmountMinorUnits: null, // Non-authoritative until settlement reconciliation
      feeCurrency,
      source: ProcessingFeeSource.PROVIDER_WEBHOOK,
      status: ProcessingFeeStatus.CAPTURED,
      capturedAt: new Date(),
      reconciledAt: null,
      rawPayload: {
        providerFee: paymentEntity.fee,
        providerTax: paymentEntity.tax,
        providerCurrency: paymentEntity.currency
      }
    };
  }

  /**
   * Normalizes settlement reconciliation transaction records (e.g. from GET /v1/settlements/recon/combined).
   * Extracts authoritative settlement ID, transaction fee, fee tax, settlement amount, and settlement status.
   */
  public static normalizeSettlementReconItem(reconItem: any): NormalizedProviderFeeData {
    if (!reconItem || typeof reconItem !== 'object') {
      throw new ValidationError('Invalid settlement reconciliation item');
    }

    const providerPaymentId = reconItem.payment_id || reconItem.entity_id;
    if (!providerPaymentId || typeof providerPaymentId !== 'string') {
      throw new ValidationError("Missing 'payment_id' or 'entity_id' in settlement reconciliation item");
    }

    const providerSettlementId = reconItem.settlement_id || null;
    const totalFee = typeof reconItem.fee === 'number' ? Math.max(0, Math.floor(reconItem.fee)) : 0;
    const feeTax = typeof reconItem.tax === 'number' ? Math.max(0, Math.floor(reconItem.tax)) : 0;
    const baseFee = Math.max(0, totalFee - feeTax);

    const feeCurrency = reconItem.currency
      ? (String(reconItem.currency).toUpperCase() as CurrencyCode)
      : CurrencyCode.INR;

    // Razorpay settlement credit / net amount
    let netSettlementAmountMinorUnits: number | null = null;
    if (typeof reconItem.credit === 'number') {
      netSettlementAmountMinorUnits = Math.max(0, Math.floor(reconItem.credit));
    } else if (typeof reconItem.amount === 'number' && typeof reconItem.fee === 'number') {
      netSettlementAmountMinorUnits = Math.max(0, Math.floor(reconItem.amount - reconItem.fee));
    }

    const settledAt = reconItem.settled_at
      ? new Date(typeof reconItem.settled_at === 'number' ? reconItem.settled_at * 1000 : reconItem.settled_at)
      : new Date();

    return {
      providerPaymentId,
      providerSettlementId,
      feeAmountMinorUnits: baseFee,
      feeTaxMinorUnits: feeTax,
      totalFeeMinorUnits: totalFee,
      netSettlementAmountMinorUnits,
      feeCurrency,
      source: ProcessingFeeSource.SETTLEMENT_REPORT,
      status: ProcessingFeeStatus.RECONCILED,
      capturedAt: settledAt,
      reconciledAt: settledAt,
      rawPayload: reconItem
    };
  }
}
