import {
  CurrencyCode,
  ReconciliationEntityType
} from '@prisma/client';
import { RazorpayClient } from './razorpay_client.js';
import { ValidationError } from '../../../../errors/app-error.js';

export interface NormalizedReconRecord {
  entityType: ReconciliationEntityType;
  providerEntityId: string;
  providerPaymentId?: string | null;
  providerRefundId?: string | null;
  providerSettlementId?: string | null;
  settlementUtr?: string | null;
  amountMinorUnits: number;
  debitMinorUnits?: number | null;
  creditMinorUnits?: number | null;
  currency: CurrencyCode;
  providerFeeMinorUnits?: number | null;
  providerFeeTaxMinorUnits?: number | null;
  settled: boolean;
  settledAt?: Date | null;
  orderId?: string | null;
  rawPayload: Record<string, any>;
}

export interface NormalizedSettlementData {
  providerSettlementId: string;
  settlementUtr?: string | null;
  settlementCurrency: CurrencyCode;
  settlementAmountMinorUnits: number;
  providerFeesMinorUnits: number;
  providerTaxMinorUnits: number;
  settlementStatus: string;
  settledAt?: Date | null;
  rawPayload: Record<string, any>;
}

export class RazorpayReconciliationAdapter {
  /**
   * Normalizes a raw Razorpay combined recon item into a typed NormalizedReconRecord.
   */
  public static normalizeReconItem(item: any): NormalizedReconRecord {
    if (!item || typeof item !== 'object') {
      throw new ValidationError('Invalid recon item payload');
    }

    const rawType = String(item.entity || item.type || item.entity_type || 'PAYMENT').toUpperCase();
    let entityType: ReconciliationEntityType;
    switch (rawType) {
      case 'PAYMENT':
        entityType = ReconciliationEntityType.PAYMENT;
        break;
      case 'REFUND':
        entityType = ReconciliationEntityType.REFUND;
        break;
      case 'TRANSFER':
        entityType = ReconciliationEntityType.TRANSFER;
        break;
      case 'ADJUSTMENT':
        entityType = ReconciliationEntityType.ADJUSTMENT;
        break;
      case 'SETTLEMENT':
        entityType = ReconciliationEntityType.SETTLEMENT;
        break;
      default:
        entityType = ReconciliationEntityType.PAYMENT;
    }

    const providerEntityId = String(
      item.id || item.entity_id || item.payment_id || item.refund_id || item.settlement_id || ''
    );
    if (!providerEntityId) {
      throw new ValidationError('Missing provider entity ID in recon item');
    }

    const currency: CurrencyCode = item.currency
      ? (String(item.currency).toUpperCase() as CurrencyCode)
      : CurrencyCode.INR;

    const amountMinorUnits = typeof item.amount === 'number'
      ? Math.max(0, Math.floor(item.amount))
      : typeof item.credit === 'number'
        ? Math.max(0, Math.floor(item.credit))
        : typeof item.debit === 'number'
          ? Math.max(0, Math.floor(item.debit))
          : 0;

    const debitMinorUnits = typeof item.debit === 'number' ? Math.max(0, Math.floor(item.debit)) : null;
    const creditMinorUnits = typeof item.credit === 'number' ? Math.max(0, Math.floor(item.credit)) : null;

    const providerFeeMinorUnits = typeof item.fee === 'number' ? Math.max(0, Math.floor(item.fee)) : null;
    const providerFeeTaxMinorUnits = typeof item.tax === 'number' ? Math.max(0, Math.floor(item.tax)) : null;

    const settled = Boolean(item.settled || item.settlement_id || item.settled_at);

    let settledAt: Date | null = null;
    if (item.settled_at) {
      settledAt = new Date(typeof item.settled_at === 'number' ? item.settled_at * 1000 : item.settled_at);
    }

    const providerPaymentId = item.payment_id
      ? String(item.payment_id)
      : entityType === ReconciliationEntityType.PAYMENT
        ? providerEntityId
        : null;

    const providerRefundId = item.refund_id
      ? String(item.refund_id)
      : entityType === ReconciliationEntityType.REFUND
        ? providerEntityId
        : null;

    const providerSettlementId = item.settlement_id ? String(item.settlement_id) : null;
    const settlementUtr = item.settlement_utr || item.utr || null;
    const orderId = item.order_id ? String(item.order_id) : null;

    return {
      entityType,
      providerEntityId,
      providerPaymentId,
      providerRefundId,
      providerSettlementId,
      settlementUtr,
      amountMinorUnits,
      debitMinorUnits,
      creditMinorUnits,
      currency,
      providerFeeMinorUnits,
      providerFeeTaxMinorUnits,
      settled,
      settledAt,
      orderId,
      rawPayload: item
    };
  }

  /**
   * Normalizes a raw Razorpay settlement payload into typed NormalizedSettlementData.
   */
  public static normalizeSettlement(item: any): NormalizedSettlementData {
    if (!item || typeof item !== 'object') {
      throw new ValidationError('Invalid settlement payload');
    }

    const providerSettlementId = String(item.id || item.settlement_id || '');
    if (!providerSettlementId) {
      throw new ValidationError('Missing provider settlement ID');
    }

    const settlementCurrency: CurrencyCode = item.currency
      ? (String(item.currency).toUpperCase() as CurrencyCode)
      : CurrencyCode.INR;

    const settlementAmountMinorUnits = typeof item.amount === 'number'
      ? Math.max(0, Math.floor(item.amount))
      : typeof item.credit === 'number'
        ? Math.max(0, Math.floor(item.credit))
        : 0;

    const providerFeesMinorUnits = typeof item.fees === 'number'
      ? Math.max(0, Math.floor(item.fees))
      : typeof item.fee === 'number'
        ? Math.max(0, Math.floor(item.fee))
        : 0;

    const providerTaxMinorUnits = typeof item.tax === 'number' ? Math.max(0, Math.floor(item.tax)) : 0;
    const settlementStatus = String(item.status || 'settled');

    let settledAt: Date | null = null;
    if (item.settled_at) {
      settledAt = new Date(typeof item.settled_at === 'number' ? item.settled_at * 1000 : item.settled_at);
    } else if (item.created_at) {
      settledAt = new Date(typeof item.created_at === 'number' ? item.created_at * 1000 : item.created_at);
    }

    return {
      providerSettlementId,
      settlementUtr: item.utr || item.settlement_utr || null,
      settlementCurrency,
      settlementAmountMinorUnits,
      providerFeesMinorUnits,
      providerTaxMinorUnits,
      settlementStatus,
      settledAt,
      rawPayload: item
    };
  }

  /**
   * Parses an array of combined recon items.
   */
  public static parseReconCombinedPayload(payload: any): NormalizedReconRecord[] {
    if (!payload) return [];
    const items = Array.isArray(payload)
      ? payload
      : Array.isArray(payload.items)
        ? payload.items
        : [];
    return items.map((item: any) => this.normalizeReconItem(item));
  }

  /**
   * Fetches paginated combined recon records from Razorpay API.
   */
  public static async fetchAndPaginateReconRecords(
    client: RazorpayClient,
    params: {
      from?: Date;
      to?: Date;
      year?: number;
      month?: number;
      day?: number;
      maxItems?: number;
      pageSize?: number;
    }
  ): Promise<NormalizedReconRecord[]> {
    const pageSize = params.pageSize || 100;
    const maxItems = params.maxItems || 1000;
    const allRecords: NormalizedReconRecord[] = [];
    let skip = 0;

    const fromTimestamp = params.from ? Math.floor(params.from.getTime() / 1000) : undefined;
    const toTimestamp = params.to ? Math.floor(params.to.getTime() / 1000) : undefined;

    while (allRecords.length < maxItems) {
      const response = await client.fetchCombinedReconRecords({
        from: fromTimestamp,
        to: toTimestamp,
        year: params.year,
        month: params.month,
        day: params.day,
        count: pageSize,
        skip
      });

      const items = response?.items || [];
      if (items.length === 0) {
        break;
      }

      const normalized = items.map((item: any) => this.normalizeReconItem(item));
      allRecords.push(...normalized);

      if (items.length < pageSize || (response.count !== undefined && allRecords.length >= response.count)) {
        break;
      }

      skip += items.length;
    }

    return allRecords.slice(0, maxItems);
  }

  /**
   * Fetches paginated settlements from Razorpay API.
   */
  public static async fetchAndPaginateSettlements(
    client: RazorpayClient,
    params: {
      from?: Date;
      to?: Date;
      maxItems?: number;
      pageSize?: number;
    }
  ): Promise<NormalizedSettlementData[]> {
    const pageSize = params.pageSize || 100;
    const maxItems = params.maxItems || 1000;
    const allSettlements: NormalizedSettlementData[] = [];
    let skip = 0;

    const fromTimestamp = params.from ? Math.floor(params.from.getTime() / 1000) : undefined;
    const toTimestamp = params.to ? Math.floor(params.to.getTime() / 1000) : undefined;

    while (allSettlements.length < maxItems) {
      const response = await client.fetchSettlements({
        from: fromTimestamp,
        to: toTimestamp,
        count: pageSize,
        skip
      });

      const items = response?.items || [];
      if (items.length === 0) {
        break;
      }

      const normalized = items.map((item: any) => this.normalizeSettlement(item));
      allSettlements.push(...normalized);

      if (items.length < pageSize || (response.count !== undefined && allSettlements.length >= response.count)) {
        break;
      }

      skip += items.length;
    }

    return allSettlements.slice(0, maxItems);
  }
}
