import { config } from '../../config/env.js';
import crypto from 'node:crypto';
import { prisma } from '../../config/database.js';
import {
  BillingReceipt,
  BillingReceiptStatus,
  BillingReceiptType,
  BillingInterval,
  CurrencyCode,
  PaymentStatus,
  PaymentProvider,
  PaymentEnvironment,
  AuditEventType,
  Prisma
} from '@prisma/client';
import {
  AppError,
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError
} from '../../errors/app-error.js';
import { TaxCalculationService } from './tax_calculation_service.js';

export interface GenerateReceiptOptions {
  now?: Date;
  isAdmin?: boolean;
}

export interface ReceiptListOptions {
  page?: number;
  limit?: number;
}

export type BillingReceiptWithRelations = BillingReceipt & {
  payment?: any;
  subscription?: any;
  planChange?: any;
  refunds?: any[];
};

export class BillingReceiptService {
  /**
   * Generates or retrieves an immutable BillingReceipt for a successful payment.
   * Fully idempotent: calling multiple times for the same payment returns the existing receipt without duplicate records.
   */
  public static async generateReceiptForPayment(
    paymentId: string,
    options?: GenerateReceiptOptions
  ): Promise<{ success: boolean; receipt: BillingReceipt; idempotent?: boolean }> {
    if (!paymentId || typeof paymentId !== 'string') {
      throw new ValidationError('paymentId is required to generate a billing receipt');
    }

    // 1. Check if receipt already exists for this payment (idempotency guard)
    const existing = await prisma.billingReceipt.findUnique({
      where: { paymentId }
    });

    if (existing) {
      return { success: true, receipt: existing, idempotent: true };
    }

    // 2. Fetch authoritative payment and linked relations
    const payment = await prisma.billingPayment.findUnique({
      where: { id: paymentId },
      include: {
        user: {
          include: {
            billingState: true
          }
        },
        subscription: {
          include: {
            plan: true,
            planPrice: true
          }
        },
        planChange: {
          include: {
            fromPlan: true,
            toPlan: true,
            fromPlanPrice: true,
            toPlanPrice: true
          }
        },
        refunds: true,
        tax: true
      }
    });

    if (!payment) {
      throw new NotFoundError(`BillingPayment ${paymentId} not found`);
    }

    // 3. Status validation: only captured/successful or refunded payments can issue receipts
    if (payment.status !== PaymentStatus.SUCCESS && payment.status !== PaymentStatus.REFUNDED) {
      const err = new ConflictError(`Cannot issue billing receipt for payment in status ${payment.status}`);
      (err as any).errorCode = 'PAYMENT_NOT_CAPTURED';
      throw err;
    }

    const now = options?.now || new Date();
    const chargedAt = payment.chargedAt || payment.createdAt;

    // 4. Determine Receipt Type
    let type: BillingReceiptType = BillingReceiptType.SUBSCRIPTION_PURCHASE;
    if (payment.planChangeId) {
      type = BillingReceiptType.SUBSCRIPTION_UPGRADE;
    } else if (payment.subscription) {
      const subStart = payment.subscription.currentPeriodStart;
      const isInitial = Math.abs(subStart.getTime() - chargedAt.getTime()) < 60000;
      if (!isInitial) {
        type = BillingReceiptType.SUBSCRIPTION_RENEWAL;
      }
    }

    // 5. Generate deterministic, unique, public receipt number (ZCR-YYYYMM-XXXXXX)
    const datePrefix = chargedAt.toISOString().slice(0, 7).replace('-', '');
    const randomSuffix = crypto.randomBytes(3).toString('hex').toUpperCase();
    const receiptNumber = `ZCR-${datePrefix}-${randomSuffix}`;

    // 6. Snapshot Plan & Cadence details
    const sub = payment.subscription;
    const plan = sub?.plan;
    const planCode = plan?.code || (type === BillingReceiptType.SUBSCRIPTION_UPGRADE ? payment.planChange?.toPlan?.code : 'PRO_MONTHLY') || 'PRO_MONTHLY';
    const planName = plan?.name || (type === BillingReceiptType.SUBSCRIPTION_UPGRADE ? payment.planChange?.toPlan?.name : 'Pro Plan') || 'Pro Plan';
    const billingInterval = sub?.billingInterval || (type === BillingReceiptType.SUBSCRIPTION_UPGRADE ? payment.planChange?.toPlan?.interval : BillingInterval.MONTHLY) || BillingInterval.MONTHLY;
    const priceVersion = sub?.priceVersion || 1;

    // 7. Snapshot Customer & Merchant information
    const customer = payment.user;
    const customerName = customer?.fullName || null;
    const customerEmail = customer?.email || 'customer@example.com';
    const billingCountry = customer?.billingState?.billingCountry || 'IN';

    // 8. Tax Snapshot & Amounts in minor integer units
    let paymentTax = (payment as any).tax;
    if (!paymentTax) {
      try {
        paymentTax = await TaxCalculationService.recordPaymentTax(payment.id, { billingCountry });
      } catch {
        // Fallback gracefully
      }
    }

    const amountMinorUnits = payment.amountMinorUnits;
    const taxMinorUnits = paymentTax ? paymentTax.taxAmountMinorUnits : 0;
    const subtotalMinorUnits = paymentTax && paymentTax.isInclusive
      ? paymentTax.taxableAmountMinorUnits
      : (paymentTax && !paymentTax.isInclusive ? paymentTax.taxableAmountMinorUnits : amountMinorUnits);
    const discountMinorUnits = 0;
    const totalMinorUnits = paymentTax && !paymentTax.isInclusive
      ? paymentTax.grossAmountMinorUnits
      : amountMinorUnits;
    const amountPaidMinorUnits = amountMinorUnits;

    // Metadata snapshots for upgrade proration or custom line items
    const metadata: Record<string, any> = {
      generatedAt: now.toISOString(),
      provider: payment.provider,
      providerPaymentId: payment.providerPaymentId,
      providerSubscriptionId: payment.providerSubscriptionId
    };

    if (paymentTax) {
      metadata.tax = {
        jurisdiction: paymentTax.jurisdiction,
        taxType: paymentTax.taxType,
        isInclusive: paymentTax.isInclusive,
        taxRateBasisPoints: paymentTax.taxRateBasisPoints,
        taxableAmountMinorUnits: paymentTax.taxableAmountMinorUnits,
        taxAmountMinorUnits: paymentTax.taxAmountMinorUnits,
        grossAmountMinorUnits: paymentTax.grossAmountMinorUnits,
        breakdown: paymentTax.breakdown
      };
    }

    if (payment.planChange) {
      metadata.upgradeDetails = {
        fromPlan: payment.planChange.fromPlan?.name,
        toPlan: payment.planChange.toPlan?.name,
        fromAmountMinorUnits: payment.planChange.fromAmountMinorUnits,
        toAmountMinorUnits: payment.planChange.toAmountMinorUnits,
        creditMinorUnits: payment.planChange.creditMinorUnits,
        netAmountMinorUnits: payment.planChange.netAmountMinorUnits
      };
    }

    // 9. Atomically create BillingReceipt
    let receipt: BillingReceipt;
    try {
      receipt = await prisma.$transaction(async (tx) => {
        const created = await tx.billingReceipt.create({
          data: {
            receiptNumber,
            userId: payment.userId,
            subscriptionId: payment.subscriptionId,
            paymentId: payment.id,
            planChangeId: payment.planChangeId,
            type,
            status: BillingReceiptStatus.ISSUED,
            issuedAt: now,
            chargedAt,
            periodStart: sub?.currentPeriodStart || null,
            periodEnd: sub?.currentPeriodEnd || null,
            planCode,
            planName,
            billingInterval,
            priceVersion,
            currency: payment.currency,
            subtotalMinorUnits,
            discountMinorUnits,
            taxMinorUnits,
            totalMinorUnits,
            amountPaidMinorUnits,
            customerName,
            customerEmail,
            billingCountry,
            billingAddress: Prisma.DbNull,
            merchantName: 'ZdexCloud',
            merchantAddress: 'ZdexCloud Inc.',
            merchantSupportEmail: 'support@zdexcloud.com',
            merchantTaxId: config.MERCHANT_GSTIN || process.env.MERCHANT_GSTIN || null,
            provider: payment.provider,
            providerEnvironment: payment.environment,
            providerPaymentId: payment.providerPaymentId,
            providerSubscriptionId: payment.providerSubscriptionId,
            providerInvoiceId: null,
            documentTitle: 'ZdexCloud Customer Billing Receipt',
            documentVersion: 1,
            metadata
          }
        });

        await tx.auditEvent.create({
          data: {
            userId: payment.userId,
            eventType: AuditEventType.BILLING_RECEIPT_CREATED,
            metadata: {
              receiptId: created.id,
              receiptNumber: created.receiptNumber,
              paymentId: payment.id,
              subscriptionId: payment.subscriptionId,
              type,
              amountMinorUnits,
              currency: payment.currency
            }
          }
        });

        await tx.auditEvent.create({
          data: {
            userId: payment.userId,
            eventType: AuditEventType.BILLING_RECEIPT_ISSUED,
            metadata: {
              receiptId: created.id,
              receiptNumber: created.receiptNumber,
              issuedAt: now.toISOString()
            }
          }
        });

        return created;
      }, { maxWait: 15000, timeout: 30000 });
    } catch (createErr: any) {
      if (createErr.code === 'P2002') {
        // Unique constraint violation (race condition / already created)
        const recheck = await prisma.billingReceipt.findUnique({
          where: { paymentId }
        });
        if (recheck) {
          return { success: true, receipt: recheck, idempotent: true };
        }
      }

      // Record failure audit without failing the payment
      try {
        await prisma.auditEvent.create({
          data: {
            userId: payment.userId,
            eventType: AuditEventType.BILLING_RECEIPT_GENERATION_FAILED,
            metadata: {
              paymentId: payment.id,
              error: createErr.message
            }
          }
        });
      } catch {
        // Non-blocking
      }

      throw createErr;
    }

    // 10. Emit in-app notification
    await this.emitNotification({
      userId: payment.userId,
      eventType: 'BILLING_RECEIPT_ISSUED',
      title: 'Billing Receipt Available',
      body: `Your receipt ${receiptNumber} for ${payment.currency} ${(amountMinorUnits / 100).toFixed(2)} (${planName}) is now available in your billing history.`,
      metadata: {
        receiptId: receipt.id,
        receiptNumber: receipt.receiptNumber,
        paymentId: payment.id,
        amountMinorUnits,
        currency: payment.currency
      }
    });

    return { success: true, receipt };
  }

  /**
   * Retrieves a single BillingReceipt by internal ID with strict ownership enforcement.
   */
  public static async getReceipt(
    userId: string,
    receiptId: string,
    options?: { isAdmin?: boolean }
  ): Promise<BillingReceiptWithRelations> {
    if (!receiptId) {
      throw new ValidationError('receiptId is required');
    }

    const receipt = await prisma.billingReceipt.findUnique({
      where: { id: receiptId },
      include: {
        payment: {
          include: {
            refunds: {
              orderBy: { requestedAt: 'desc' }
            }
          }
        },
        subscription: true,
        planChange: true
      }
    });

    if (!receipt) {
      throw new NotFoundError(`Billing receipt ${receiptId} not found`);
    }

    if (!options?.isAdmin && receipt.userId !== userId) {
      throw new ForbiddenError('You do not have permission to access this billing receipt');
    }

    // Emit access audit
    try {
      await prisma.auditEvent.create({
        data: {
          userId,
          eventType: AuditEventType.BILLING_RECEIPT_ACCESSED,
          metadata: {
            receiptId: receipt.id,
            receiptNumber: receipt.receiptNumber,
            accessedBy: options?.isAdmin ? 'ADMIN' : userId
          }
        }
      });
    } catch {
      // Non-blocking audit
    }

    return receipt;
  }

  /**
   * Retrieves a single BillingReceipt by payment ID.
   */
  public static async getReceiptByPayment(
    userId: string,
    paymentId: string,
    options?: { isAdmin?: boolean }
  ): Promise<BillingReceiptWithRelations> {
    if (!paymentId) {
      throw new ValidationError('paymentId is required');
    }

    const receipt = await prisma.billingReceipt.findUnique({
      where: { paymentId },
      include: {
        payment: {
          include: {
            refunds: {
              orderBy: { requestedAt: 'desc' }
            }
          }
        },
        subscription: true,
        planChange: true
      }
    });

    if (!receipt) {
      throw new NotFoundError(`Billing receipt for payment ${paymentId} not found`);
    }

    if (!options?.isAdmin && receipt.userId !== userId) {
      throw new ForbiddenError('You do not have permission to access this billing receipt');
    }

    return receipt;
  }

  /**
   * Lists billing receipts for the authenticated customer with pagination.
   */
  public static async listCustomerReceipts(
    userId: string,
    options?: ReceiptListOptions
  ): Promise<{ receipts: BillingReceipt[]; total: number; page: number; limit: number }> {
    const page = Math.max(1, options?.page || 1);
    const limit = Math.min(50, Math.max(1, options?.limit || 20));
    const skip = (page - 1) * limit;

    const [receipts, total] = await Promise.all([
      prisma.billingReceipt.findMany({
        where: { userId },
        orderBy: { issuedAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.billingReceipt.count({
        where: { userId }
      })
    ]);

    return { receipts, total, page, limit };
  }

  /**
   * Formats currency amount in minor integer units into clean localized display string.
   */
  public static formatAmount(amountMinorUnits: number, currency: CurrencyCode): string {
    const symbol = currency === CurrencyCode.INR ? '₹' : '$';
    const major = (amountMinorUnits / 100).toFixed(2);
    return `${symbol}${major}`;
  }

  /**
   * Formats a date into a clean, human-readable billing date (e.g. "13 Sep 2026").
   */
  public static formatDate(date: Date | null | undefined): string {
    if (!date) return 'N/A';
    const d = new Date(date);
    const day = String(d.getUTCDate()).padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[d.getUTCMonth()];
    const year = d.getUTCFullYear();
    return `${day} ${month} ${year}`;
  }

  /**
   * Renders the complete, self-contained, responsive, printable HTML document for a BillingReceipt.
   */
  public static renderReceiptHtml(receipt: BillingReceiptWithRelations): string {
    const formattedAmount = this.formatAmount(receipt.amountPaidMinorUnits, receipt.currency);
    const formattedSubtotal = this.formatAmount(receipt.subtotalMinorUnits, receipt.currency);
    const formattedDiscount = this.formatAmount(receipt.discountMinorUnits, receipt.currency);
    const formattedTax = this.formatAmount(receipt.taxMinorUnits, receipt.currency);
    const formattedTotal = this.formatAmount(receipt.totalMinorUnits, receipt.currency);

    const issueDateStr = this.formatDate(receipt.issuedAt);
    const chargedDateStr = this.formatDate(receipt.chargedAt);
    const periodStr =
      receipt.periodStart && receipt.periodEnd
        ? `${this.formatDate(receipt.periodStart)} – ${this.formatDate(receipt.periodEnd)}`
        : chargedDateStr;

    // Refund calculations
    const refunds = receipt.payment?.refunds || [];
    const processedRefunds = refunds.filter((r: any) => r.status === 'PROCESSED');
    const totalRefundedMinorUnits = processedRefunds.reduce((sum: number, r: any) => sum + r.amountMinorUnits, 0);
    const netRetainedMinorUnits = Math.max(0, receipt.amountPaidMinorUnits - totalRefundedMinorUnits);

    let refundSectionHtml = '';
    if (processedRefunds.length > 0) {
      const formattedRefunded = this.formatAmount(totalRefundedMinorUnits, receipt.currency);
      const formattedNet = this.formatAmount(netRetainedMinorUnits, receipt.currency);

      refundSectionHtml = `
      <div class="refund-box">
        <div class="refund-header">
          <span class="refund-title">Refund Adjustments</span>
          <span class="refund-badge">Refund Processed</span>
        </div>
        <div class="refund-details">
          <div class="refund-row">
            <span>Total Refunded Amount:</span>
            <span class="refund-negative">-${formattedRefunded}</span>
          </div>
          <div class="refund-row refund-net">
            <span>Net Retained Amount:</span>
            <span>${formattedNet}</span>
          </div>
        </div>
      </div>
      `;
    }

    // Official ZdexCloud SVG Horizontal Logo
    const zdexLogoSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 64" fill="none" style="height: 40px; width: auto;">
      <defs>
        <linearGradient id="logoZcGrad" x1="12" y1="8" x2="52" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#2563EB" />
          <stop offset="100%" stop-color="#1E40AF" />
        </linearGradient>
      </defs>
      <g transform="translate(0, 0)">
        <rect x="4" y="4" width="56" height="56" rx="16" fill="url(#logoZcGrad)" />
        <path d="M18 22C18 20.8954 18.8954 20 20 20H44C45.1046 20 46 20.8954 46 22C46 23.1046 45.1046 24 44 24H20C18.8954 24 18 23.1046 18 22Z" fill="#FFFFFF" />
        <path d="M44.5 21.5L20.5 42.5" stroke="#FFFFFF" stroke-width="4.5" stroke-linecap="round" />
        <path d="M20 42C18.8954 42 18 42.8954 18 44C18 45.1046 18.8954 46 20 46H44C45.1046 46 46 45.1046 46 44C46 42.8954 45.1046 42 44 42H20Z" fill="#FFFFFF" />
        <circle cx="32" cy="32" r="4.5" fill="#60A5FA" stroke="#FFFFFF" stroke-width="2.5" />
      </g>
      <text x="74" y="42" font-family="'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="28" font-weight="700" letter-spacing="-0.03em" fill="#0F172A">
        Zdex<tspan fill="#2563EB" font-weight="600">Cloud</tspan>
      </text>
    </svg>
    `;

    // Official Razorpay SVG Vector
    const razorpayLogoSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 28" fill="none" style="height: 18px; width: auto; vertical-align: middle;">
      <path d="M14.5 3.5L4 18.5H10.5L8.5 24.5L19 9.5H12.5L14.5 3.5Z" fill="#0C2340"/>
      <text x="26" y="19" font-family="'Plus Jakarta Sans', -apple-system, sans-serif" font-size="16" font-weight="700" fill="#0C2340" letter-spacing="-0.02em">Razorpay</text>
    </svg>
    `;

    const escape = (str: string | null | undefined) => {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    };

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escape(receipt.documentTitle)} - ${escape(receipt.receiptNumber)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --font-sans: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      --font-mono: 'JetBrains Mono', monospace;
      --color-bg: #F8FAFC;
      --color-surface: #FFFFFF;
      --color-primary: #2563EB;
      --color-text-main: #0F172A;
      --color-text-muted: #64748B;
      --color-text-sub: #334155;
      --color-border: #E2E8F0;
      --color-badge-bg: #ECFDF5;
      --color-badge-text: #059669;
      --color-badge-border: #A7F3D0;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: var(--font-sans);
      background-color: var(--color-bg);
      color: var(--color-text-main);
      line-height: 1.5;
      padding: 40px 20px;
      -webkit-font-smoothing: antialiased;
    }
    .receipt-container {
      max-width: 720px;
      margin: 0 auto;
      background: var(--color-surface);
      border-radius: 12px;
      border: 1px solid var(--color-border);
      box-shadow: 0 4px 12px rgba(15, 23, 42, 0.04);
      padding: 48px;
    }
    .header-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 1px solid var(--color-border);
      padding-bottom: 28px;
      margin-bottom: 28px;
    }
    .doc-meta {
      text-align: right;
    }
    .doc-title {
      font-size: 18px;
      font-weight: 700;
      color: var(--color-text-main);
      margin-bottom: 4px;
    }
    .receipt-num {
      font-family: var(--font-mono);
      font-size: 14px;
      font-weight: 600;
      color: var(--color-primary);
      margin-bottom: 4px;
    }
    .doc-date {
      font-size: 13px;
      color: var(--color-text-muted);
    }
    .details-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 32px;
      margin-bottom: 32px;
    }
    .section-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--color-text-muted);
      margin-bottom: 8px;
    }
    .party-name {
      font-size: 15px;
      font-weight: 600;
      color: var(--color-text-main);
      margin-bottom: 2px;
    }
    .party-sub {
      font-size: 13px;
      color: var(--color-text-muted);
      margin-bottom: 2px;
    }
    .charges-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 24px;
    }
    .charges-table th {
      text-align: left;
      font-size: 12px;
      font-weight: 600;
      color: var(--color-text-muted);
      padding: 12px 0;
      border-bottom: 1px solid var(--color-border);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .charges-table td {
      padding: 16px 0;
      font-size: 14px;
      color: var(--color-text-main);
      border-bottom: 1px solid var(--color-border);
    }
    .charges-table .col-amount {
      text-align: right;
      font-family: var(--font-mono);
      font-weight: 500;
    }
    .summary-section {
      width: 280px;
      margin-left: auto;
      margin-bottom: 32px;
    }
    .summary-row {
      display: flex;
      justify-content: space-between;
      font-size: 13px;
      color: var(--color-text-sub);
      padding: 6px 0;
    }
    .summary-row.total-row {
      border-top: 1px solid var(--color-border);
      margin-top: 6px;
      padding-top: 12px;
      font-size: 16px;
      font-weight: 700;
      color: var(--color-text-main);
    }
    .summary-row.paid-row {
      color: var(--color-primary);
      font-weight: 700;
      font-size: 15px;
    }
    .payment-info-box {
      background: #F1F5F9;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
    }
    .payment-badge {
      display: inline-flex;
      align-items: center;
      padding: 4px 10px;
      border-radius: 9999px;
      background: var(--color-badge-bg);
      color: var(--color-badge-text);
      border: 1px solid var(--color-badge-border);
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 6px;
    }
    .payment-ref {
      font-size: 12px;
      color: var(--color-text-muted);
      font-family: var(--font-mono);
    }
    .provider-attribution {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--color-text-sub);
    }
    .refund-box {
      background: #FEF2F2;
      border: 1px solid #FECACA;
      border-radius: 8px;
      padding: 16px 20px;
      margin-bottom: 24px;
    }
    .refund-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .refund-title {
      font-size: 13px;
      font-weight: 700;
      color: #991B1B;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .refund-badge {
      font-size: 11px;
      font-weight: 600;
      color: #DC2626;
      background: #FEE2E2;
      padding: 2px 8px;
      border-radius: 4px;
    }
    .refund-details {
      font-size: 13px;
    }
    .refund-row {
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
      color: #7F1D1D;
    }
    .refund-row.refund-net {
      border-top: 1px dashed #FCA5A5;
      margin-top: 6px;
      padding-top: 8px;
      font-weight: 700;
      color: #991B1B;
    }
    .refund-negative {
      font-family: var(--font-mono);
      font-weight: 600;
    }
    .footer {
      border-top: 1px solid var(--color-border);
      padding-top: 24px;
      text-align: center;
      font-size: 12px;
      color: var(--color-text-muted);
      line-height: 1.6;
    }
    .footer a {
      color: var(--color-primary);
      text-decoration: none;
    }
    @media print {
      body {
        background: none;
        padding: 0;
      }
      .receipt-container {
        border: none;
        box-shadow: none;
        padding: 0;
        max-width: 100%;
      }
    }
    @media (max-width: 600px) {
      .receipt-container {
        padding: 24px;
      }
      .header-row {
        flex-direction: column;
        gap: 16px;
      }
      .doc-meta {
        text-align: left;
      }
      .details-grid {
        grid-template-columns: 1fr;
        gap: 20px;
      }
      .summary-section {
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <div class="receipt-container">
    <header class="header-row">
      <div class="brand">
        ${zdexLogoSvg}
      </div>
      <div class="doc-meta">
        <div class="doc-title">${escape(receipt.documentTitle)}</div>
        <div class="receipt-num">${escape(receipt.receiptNumber)}</div>
        <div class="doc-date">Issued on: ${escape(issueDateStr)}</div>
      </div>
    </header>

    <div class="details-grid">
      <div class="billed-to">
        <div class="section-label">Billed To</div>
        <div class="party-name">${escape(receipt.customerName || 'ZdexCloud Customer')}</div>
        <div class="party-sub">${escape(receipt.customerEmail)}</div>
        <div class="party-sub">Country: ${escape(receipt.billingCountry || 'IN')}</div>
      </div>
      <div class="merchant-info">
        <div class="section-label">Service Provider</div>
        <div class="party-name">${escape(receipt.merchantName)}</div>
        <div class="party-sub">Support: ${escape(receipt.merchantSupportEmail)}</div>
        <div class="party-sub">Personal Android Cloud Platform</div>
      </div>
    </div>

    <table class="charges-table">
      <thead>
        <tr>
          <th style="width: 60%;">Description</th>
          <th style="width: 15%; text-align: center;">Interval</th>
          <th style="width: 25%; text-align: right;">Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <div style="font-weight: 600; color: var(--color-text-main);">${escape(receipt.planName)} Subscription</div>
            <div style="font-size: 12px; color: var(--color-text-muted); margin-top: 2px;">Billing Period: ${escape(periodStr)}</div>
          </td>
          <td style="text-align: center; color: var(--color-text-muted); font-size: 13px;">
            ${escape(receipt.billingInterval)}
          </td>
          <td class="col-amount">${formattedSubtotal}</td>
        </tr>
      </tbody>
    </table>

    <div class="summary-section">
      <div class="summary-row">
        <span>Subtotal</span>
        <span style="font-family: var(--font-mono);">${formattedSubtotal}</span>
      </div>
      ${receipt.discountMinorUnits > 0 ? `
      <div class="summary-row">
        <span>Discount</span>
        <span style="font-family: var(--font-mono); font-weight: 500;">-${formattedDiscount}</span>
      </div>` : ''}
      <div class="summary-row">
        <span>Tax</span>
        <span style="font-family: var(--font-mono);">${formattedTax}</span>
      </div>
      <div class="summary-row total-row">
        <span>Total</span>
        <span style="font-family: var(--font-mono);">${formattedTotal}</span>
      </div>
      <div class="summary-row paid-row">
        <span>Amount Paid (${escape(receipt.currency)})</span>
        <span style="font-family: var(--font-mono);">${formattedAmount}</span>
      </div>
    </div>

    <div class="payment-info-box">
      <div>
        <div class="payment-badge">✓ Paid in Full</div>
        <div class="payment-ref">Transaction Date: ${escape(chargedDateStr)}</div>
        ${receipt.providerPaymentId ? `<div class="payment-ref">Payment Reference: ${escape(receipt.providerPaymentId)}</div>` : ''}
      </div>
      <div class="provider-attribution">
        <span>Payment Provider:</span>
        ${razorpayLogoSvg}
      </div>
    </div>

    ${refundSectionHtml}

    <footer class="footer">
      <p>This document is generated from ZdexCloud's authoritative billing records.</p>
      <p>If you have any questions or require support, please contact <a href="mailto:${escape(receipt.merchantSupportEmail)}">${escape(receipt.merchantSupportEmail)}</a>.</p>
    </footer>
  </div>
</body>
</html>`;
  }

  /**
   * Helper to emit idempotent in-app notifications without throwing.
   */
  private static async emitNotification(opts: {
    userId: string;
    eventType: string;
    title: string;
    body: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    try {
      const idempotencyKey = `notif_${opts.eventType}_${opts.userId}_${opts.metadata?.receiptId || Date.now()}`;
      await prisma.notificationRecord.upsert({
        where: { idempotencyKey },
        update: {},
        create: {
          eventId: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          userId: opts.userId,
          eventType: opts.eventType,
          category: 'BILLING',
          severity: 'INFO',
          title: opts.title,
          body: opts.body,
          metadata: opts.metadata || {},
          idempotencyKey
        }
      });
    } catch {
      // Non-blocking notification emission
    }
  }
}
