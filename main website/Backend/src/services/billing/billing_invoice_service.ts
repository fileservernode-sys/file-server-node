import crypto from 'node:crypto';
import { prisma } from '../../config/database.js';
import { config } from '../../config/env.js';
import {
  CurrencyCode,
  PaymentProvider,
  PaymentEnvironment,
  PaymentStatus,
  BillingInvoiceType,
  BillingInvoiceStatus,
  BillingInvoiceSettlementStatus,
  InvoiceNotificationOutboxStatus,
  AuditEventType,
  BillingInterval,
  Prisma,
  BillingInvoice
} from '@prisma/client';
import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
  StatutoryConfigurationMissingError,
  InvoiceIssuanceBlockedError
} from '../../errors/app-error.js';
import { appLogger } from '../../observability/logger.js';
import { BillingInvoiceSequenceService } from './billing_invoice_sequence_service.js';
import { StatutorySellerConfigService, ValidatedSellerConfig } from './statutory_seller_config_service.js';
import { TaxCalculationService, StatutoryTaxCalculationResult } from './tax_calculation_service.js';
import { BillingInvoiceNotificationService } from './billing_invoice_notification_service.js';
import { CustomerActivityService } from '../activity/customer_activity_service.js';
import { billingEventProducer } from '../../notifications/producers/billing_producer.js';

export interface GenerateInvoiceOptions {
  now?: Date;
  tx?: Prisma.TransactionClient;
  sendNotification?: boolean;
}

export interface GenerateInvoiceResult {
  invoice: BillingInvoice;
  isExisting: boolean;
}

export interface CustomerInvoiceDto {
  id: string;
  invoiceNumber: string;
  sequenceNumber: number;
  financialYear: string;
  seriesPrefix: string;
  type: BillingInvoiceType;
  status: BillingInvoiceStatus;
  settlementStatus: BillingInvoiceSettlementStatus;
  issuedAt: Date;
  paidAt: Date | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  planCode: string;
  planName: string;
  billingInterval: BillingInterval;
  currency: CurrencyCode;
  subtotalMinorUnits: number;
  discountMinorUnits: number;
  taxMinorUnits: number;
  totalMinorUnits: number;
  amountPaidMinorUnits: number;
  amountDueMinorUnits: number;
  customerName: string;
  customerEmail: string;
  customerCompanyName: string | null;
  customerTaxId: string | null;
  billingAddress: unknown;
  billingCountry: string;
  sellerName: string;
  sellerAddress: string;
  sellerSupportEmail: string;
  sellerTaxId: string;
  sellerJurisdiction: string;
  hsnSacCode: string;
  taxJurisdiction: string;
  taxType: string;
  taxRateBasisPoints: number;
  isInclusive: boolean;
  taxBreakdown: unknown;
  lineItems: unknown;
  documentTitle: string;
  documentVersion: number;
  contentHash: string;
  signatureAlgorithm: string;
  signedAt: Date | null;
  provider: PaymentProvider;
  createdAt: Date;
}

/**
 * Standard Indian GST State Code Mapping (2-digit GST state codes)
 */
export const INDIAN_STATE_CODE_MAP: Record<string, string> = {
  'JAMMU AND KASHMIR': '01',
  'HIMACHAL PRADESH': '02',
  'PUNJAB': '03',
  'CHANDIGARH': '04',
  'UTTARAKHAND': '05',
  'HARYANA': '06',
  'DELHI': '07',
  'RAJASTHAN': '08',
  'UTTAR PRADESH': '09',
  'BIHAR': '10',
  'SIKKIM': '11',
  'ARUNACHAL PRADESH': '12',
  'NAGALAND': '13',
  'MANIPUR': '14',
  'MIZORAM': '15',
  'TRIPURA': '16',
  'MEGHALAYA': '17',
  'ASSAM': '18',
  'WEST BENGAL': '19',
  'JHARKHAND': '20',
  'ODISHA': '21',
  'CHHATTISGARH': '22',
  'MADHYA PRADESH': '23',
  'GUJARAT': '24',
  'DAMAN AND DIU': '25',
  'DADRA AND NAGAR HAVELI': '26',
  'MAHARASHTRA': '27',
  'ANDHRA PRADESH': '28',
  'KARNATAKA': '29',
  'GOA': '30',
  'LAKSHADWEEP': '31',
  'KERALA': '32',
  'TAMIL NADU': '33',
  'PUDUCHERRY': '34',
  'ANDAMAN AND NICOBAR ISLANDS': '35',
  'TELANGANA': '36',
  'ANDHRA PRADESH (NEW)': '37',
  'LADAKH': '38',
  'OTHER TERRITORY': '97'
};

/**
 * Authoritative, Atomic Statutory Tax Invoice Issuance Service
 *
 * Implements end-to-end statutory invoice generation compliant with Indian GST Rule 46:
 * 1. Fail-closed validation against unconfigured or unapproved statutory seller details.
 * 2. Atomic, single-transaction boundary: sequence allocation and invoice persistence commit together.
 * 3. Monotonic, non-reusable consecutive serial numbering (max 16 characters per Rule 46(b)).
 * 4. Authoritative server-side pricing and tax calculation with Place of Supply branching.
 * 5. Deterministic SHA-256 canonical content hashing with recursive key sorting for document tampering detection.
 * 6. Idempotent webhook and payment event deduplication via unique paymentId constraint.
 * 7. Strictly preserves existing payment settlement and receipt generation functionality.
 */
export class BillingInvoiceService {
  /**
   * Resolves a customer's 2-digit GST state code from their GSTIN or registered billing state.
   */
  public static resolveCustomerStateCode(
    customerTaxId: string | null,
    customerState: string | null
  ): string | null {
    // 1. If customer supplied a valid 15-character GSTIN, first 2 digits are authoritative state code
    if (customerTaxId && customerTaxId.trim().length === 15) {
      const gstinPrefix = customerTaxId.trim().substring(0, 2);
      if (/^[0-9]{2}$/.test(gstinPrefix)) {
        return gstinPrefix;
      }
    }

    // 2. Direct 2-digit numeric state code
    if (customerState && /^[0-9]{2}$/.test(customerState.trim())) {
      return customerState.trim();
    }

    // 3. Normalized state name lookup
    if (customerState) {
      const normalizedStateName = customerState.trim().toUpperCase();
      if (INDIAN_STATE_CODE_MAP[normalizedStateName]) {
        return INDIAN_STATE_CODE_MAP[normalizedStateName];
      }
    }

    return null;
  }

  /**
   * Recursively normalizes values and sorts object keys for deterministic canonical serialization.
   * Preserves array ordering while deeply sorting nested objects and converting Dates to ISO strings.
   */
  public static canonicalize(val: unknown): unknown {
    if (val === null || val === undefined) {
      return null;
    }
    if (val instanceof Date) {
      return val.toISOString();
    }
    if (Array.isArray(val)) {
      return val.map((item) => BillingInvoiceService.canonicalize(item));
    }
    if (typeof val === 'object') {
      const sortedKeys = Object.keys(val as Record<string, unknown>).sort();
      const res: Record<string, unknown> = {};
      for (const k of sortedKeys) {
        res[k] = BillingInvoiceService.canonicalize((val as Record<string, unknown>)[k]);
      }
      return res;
    }
    return val;
  }

  /**
   * Computes a deterministic canonical SHA-256 hash over immutable statutory invoice snapshot fields.
   *
   * Document Integrity Notice:
   * The SHA-256 content hash provides tamper detection and document integrity.
   * It is not an asymmetric PKI digital signature or an e-Invoice IRP QR code.
   */
  public static computeInvoiceContentHash(payload: Record<string, unknown>): string {
    const canonicalPayload = BillingInvoiceService.canonicalize(payload);
    const serialized = JSON.stringify(canonicalPayload);
    return crypto.createHash('sha256').update(serialized, 'utf8').digest('hex');
  }

  /**
   * Constructs the standardized canonical hash payload dictionary for invoice creation and verification.
   */
  public static buildInvoiceHashPayload(params: {
    invoiceNumber: string;
    seriesPrefix: string;
    financialYear: string;
    issuedAt: string | Date;
    userId: string;
    planCode: string;
    planName: string;
    billingInterval: string;
    priceVersion: number;
    currency: string;
    subtotalMinorUnits: number;
    discountMinorUnits: number;
    taxMinorUnits: number;
    totalMinorUnits: number;
    customerName: string | null;
    customerEmail: string | null;
    customerCompanyName: string | null;
    customerTaxId: string | null;
    billingCountry: string | null;
    billingAddress: unknown;
    sellerName: string;
    sellerAddress: string;
    sellerTaxId: string | null;
    sellerJurisdiction: string;
    hsnSacCode: string;
    taxType: string;
    taxRateBasisPoints: number;
    isInclusive: boolean;
    taxBreakdown: unknown;
    lineItems: unknown;
    provider: string;
    providerPaymentId: string | null;
    providerOrderId: string | null;
  }): Record<string, unknown> {
    return {
      invoiceNumber: params.invoiceNumber,
      seriesPrefix: params.seriesPrefix,
      financialYear: params.financialYear,
      issuedAt: params.issuedAt instanceof Date ? params.issuedAt.toISOString() : String(params.issuedAt),
      userId: params.userId,
      planCode: params.planCode,
      planName: params.planName,
      billingInterval: params.billingInterval,
      priceVersion: params.priceVersion,
      currency: params.currency,
      subtotalMinorUnits: params.subtotalMinorUnits,
      discountMinorUnits: params.discountMinorUnits,
      taxMinorUnits: params.taxMinorUnits,
      totalMinorUnits: params.totalMinorUnits,
      customerName: params.customerName,
      customerEmail: params.customerEmail,
      customerCompanyName: params.customerCompanyName,
      customerTaxId: params.customerTaxId,
      billingCountry: params.billingCountry,
      billingAddress: params.billingAddress,
      sellerName: params.sellerName,
      sellerAddress: params.sellerAddress,
      sellerTaxId: params.sellerTaxId,
      sellerJurisdiction: params.sellerJurisdiction,
      hsnSacCode: params.hsnSacCode,
      taxType: params.taxType,
      taxRateBasisPoints: params.taxRateBasisPoints,
      isInclusive: params.isInclusive,
      taxBreakdown: params.taxBreakdown,
      lineItems: params.lineItems,
      provider: params.provider,
      providerPaymentId: params.providerPaymentId,
      providerOrderId: params.providerOrderId
    };
  }

  /**
   * Verifies the SHA-256 canonical content hash of an invoice record without mutating state.
   */
  public static verifyInvoiceContentHash(invoice: BillingInvoice): {
    isValid: boolean;
    storedHash: string;
    computedHash: string;
  } {
    if (!invoice || !invoice.contentHash) {
      return {
        isValid: false,
        storedHash: invoice?.contentHash || '',
        computedHash: ''
      };
    }

    const hashPayload = BillingInvoiceService.buildInvoiceHashPayload({
      invoiceNumber: invoice.invoiceNumber,
      seriesPrefix: invoice.seriesPrefix,
      financialYear: invoice.financialYear,
      issuedAt: invoice.issuedAt,
      userId: invoice.userId,
      planCode: invoice.planCode,
      planName: invoice.planName,
      billingInterval: invoice.billingInterval,
      priceVersion: invoice.priceVersion,
      currency: invoice.currency,
      subtotalMinorUnits: invoice.subtotalMinorUnits,
      discountMinorUnits: invoice.discountMinorUnits,
      taxMinorUnits: invoice.taxMinorUnits,
      totalMinorUnits: invoice.totalMinorUnits,
      customerName: invoice.customerName,
      customerEmail: invoice.customerEmail,
      customerCompanyName: invoice.customerCompanyName,
      customerTaxId: invoice.customerTaxId,
      billingCountry: invoice.billingCountry,
      billingAddress: invoice.billingAddress,
      sellerName: invoice.sellerName,
      sellerAddress: invoice.sellerAddress,
      sellerTaxId: invoice.sellerTaxId,
      sellerJurisdiction: invoice.sellerJurisdiction,
      hsnSacCode: invoice.hsnSacCode,
      taxType: invoice.taxType,
      taxRateBasisPoints: invoice.taxRateBasisPoints,
      isInclusive: invoice.isInclusive,
      taxBreakdown: invoice.taxBreakdown,
      lineItems: invoice.lineItems,
      provider: invoice.provider,
      providerPaymentId: invoice.providerPaymentId,
      providerOrderId: invoice.providerOrderId
    });

    const computedHash = BillingInvoiceService.computeInvoiceContentHash(hashPayload);
    return {
      isValid: computedHash === invoice.contentHash,
      storedHash: invoice.contentHash,
      computedHash
    };
  }

  /**
   * Sanitizes an invoice record for customer-facing responses, omitting internal snapshots and technical metadata.
   */
  public static sanitizeCustomerInvoiceView(invoice: BillingInvoice): CustomerInvoiceDto {
    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      sequenceNumber: invoice.sequenceNumber,
      financialYear: invoice.financialYear,
      seriesPrefix: invoice.seriesPrefix,
      type: invoice.type,
      status: invoice.status,
      settlementStatus: invoice.settlementStatus,
      issuedAt: invoice.issuedAt,
      paidAt: invoice.paidAt,
      periodStart: invoice.periodStart,
      periodEnd: invoice.periodEnd,
      planCode: invoice.planCode,
      planName: invoice.planName,
      billingInterval: invoice.billingInterval,
      currency: invoice.currency,
      subtotalMinorUnits: invoice.subtotalMinorUnits,
      discountMinorUnits: invoice.discountMinorUnits,
      taxMinorUnits: invoice.taxMinorUnits,
      totalMinorUnits: invoice.totalMinorUnits,
      amountPaidMinorUnits: invoice.amountPaidMinorUnits,
      amountDueMinorUnits: invoice.amountDueMinorUnits,
      customerName: invoice.customerName,
      customerEmail: invoice.customerEmail,
      customerCompanyName: invoice.customerCompanyName,
      customerTaxId: invoice.customerTaxId,
      billingAddress: invoice.billingAddress,
      billingCountry: invoice.billingCountry,
      sellerName: invoice.sellerName,
      sellerAddress: invoice.sellerAddress,
      sellerSupportEmail: invoice.sellerSupportEmail,
      sellerTaxId: invoice.sellerTaxId,
      sellerJurisdiction: invoice.sellerJurisdiction,
      hsnSacCode: invoice.hsnSacCode,
      taxJurisdiction: invoice.taxJurisdiction,
      taxType: invoice.taxType,
      taxRateBasisPoints: invoice.taxRateBasisPoints,
      isInclusive: invoice.isInclusive,
      taxBreakdown: invoice.taxBreakdown,
      lineItems: invoice.lineItems,
      documentTitle: invoice.documentTitle,
      documentVersion: invoice.documentVersion,
      contentHash: invoice.contentHash,
      signatureAlgorithm: invoice.signatureAlgorithm,
      signedAt: invoice.signedAt,
      provider: invoice.provider,
      createdAt: invoice.createdAt
    };
  }

  /**
   * Authoritatively generates and persists a statutory tax invoice for a verified payment.
   * Enforces fail-closed validation, atomic transaction bounds, and payment idempotency.
   */
  public static async generateInvoiceForPayment(
    paymentId: string,
    options?: GenerateInvoiceOptions
  ): Promise<GenerateInvoiceResult> {
    if (!paymentId || typeof paymentId !== 'string') {
      throw new ValidationError('paymentId is required for invoice generation');
    }

    // 1. Check idempotency: Return existing invoice if already issued for this payment
    const existingInvoice = await prisma.billingInvoice.findUnique({
      where: { paymentId }
    });

    if (existingInvoice) {
      appLogger.info('[BillingInvoice] Idempotent hit: invoice already exists for payment', {
        metadata: {
          paymentId,
          invoiceId: existingInvoice.id,
          invoiceNumber: existingInvoice.invoiceNumber
        }
      });
      return {
        invoice: existingInvoice,
        isExisting: true
      };
    }

    // 2. Fetch authoritative payment with user, subscription, plan, and billingState
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
            plan: true
          }
        },
        planChange: {
          include: {
            fromPlan: true,
            toPlan: true
          }
        }
      }
    });

    if (!payment) {
      throw new NotFoundError(`BillingPayment ${paymentId} not found`);
    }

    // 3. Payment Status and Source Validation: Only captured successful payments with positive amounts and provider identifiers can receive tax invoices
    if (payment.status !== PaymentStatus.SUCCESS) {
      throw new ConflictError(
        `Cannot issue statutory tax invoice for payment in status '${payment.status}' (payment must be SUCCESS)`
      );
    }

    if (!payment.providerPaymentId || payment.providerPaymentId.trim().length === 0) {
      throw new ConflictError(
        'Cannot issue statutory tax invoice: payment does not have a verified provider transaction identifier'
      );
    }

    if (payment.amountMinorUnits <= 0) {
      throw new ValidationError(
        'Cannot issue statutory tax invoice: payment amount must be strictly greater than zero'
      );
    }

    if (!payment.user || payment.userId !== payment.user.id) {
      throw new ValidationError(
        'Payment user reference is missing or inconsistent with customer account'
      );
    }

    if (payment.subscription) {
      if (payment.subscription.userId !== payment.userId) {
        throw new ValidationError(
          'Payment user reference is inconsistent with subscription owner'
        );
      }
      if (payment.subscription.currency !== payment.currency) {
        throw new ValidationError(
          `Payment currency '${payment.currency}' does not match subscription currency '${payment.subscription.currency}'`
        );
      }
    }

    if (payment.planChange) {
      if (payment.planChange.userId !== payment.userId) {
        throw new ValidationError(
          'Payment user reference is inconsistent with plan change owner'
        );
      }
      if (payment.planChange.currency !== payment.currency) {
        throw new ValidationError(
          `Payment currency '${payment.currency}' does not match plan change currency '${payment.planChange.currency}'`
        );
      }
      if (payment.amountMinorUnits !== payment.planChange.netAmountMinorUnits) {
        throw new ValidationError(
          `Payment amount (${payment.amountMinorUnits}) does not match plan change net amount (${payment.planChange.netAmountMinorUnits})`
        );
      }
    }

    // 4. Validate Customer Billing Snapshot Requirements
    const user = payment.user;
    const bs = user?.billingState;
    const customerName = bs?.billingName || user?.fullName || null;
    const customerEmail = user?.email || '';
    const customerCompanyName = bs?.companyName || null;
    const customerTaxId = bs?.taxId || null;
    const billingCountry = (bs?.billingCountry || 'IN').trim().toUpperCase();
    const billingState = bs?.billingState || null;
    const billingCity = bs?.billingCity || null;
    const billingAddress1 = bs?.billingAddress1 || null;
    const billingAddress2 = bs?.billingAddress2 || null;
    const billingPostalCode = bs?.billingPostalCode || null;

    if (!customerName || !billingAddress1 || !billingCity || !billingPostalCode) {
      throw new ValidationError(
        'Customer billing profile is incomplete: customer full name, street address, city, and postal code are required for statutory invoice issuance'
      );
    }

    const billingAddress = {
      addressLine1: billingAddress1,
      addressLine2: billingAddress2,
      city: billingCity,
      state: billingState,
      postalCode: billingPostalCode,
      country: billingCountry
    };

    // 5. Fail-Closed Statutory Seller Configuration Validation
    let sellerConfig: ValidatedSellerConfig;
    try {
      sellerConfig = StatutorySellerConfigService.getApprovedSellerConfig();
    } catch (err: any) {
      if (err instanceof StatutoryConfigurationMissingError) {
        appLogger.warn('[BillingInvoice] Invoice issuance fail-closed: seller configuration is unapproved or incomplete', {
          metadata: { paymentId, reason: err.message }
        });
        throw err;
      }
      throw err;
    }

    // 6. Resolve Customer State Code for Indian GST Place of Supply
    let customerStateCode: string | null = null;
    if (billingCountry === 'IN') {
      customerStateCode = this.resolveCustomerStateCode(customerTaxId, billingState);
      if (!customerStateCode) {
        throw new StatutoryConfigurationMissingError(
          `Place of supply cannot be determined for Indian customer: state '${billingState || ''}' cannot be resolved to a 2-digit GST state code`
        );
      }
    }

    // 7. Authoritative Statutory Tax Calculation
    const taxCalc: StatutoryTaxCalculationResult = TaxCalculationService.calculateStatutoryInvoiceTax({
      grossAmountMinorUnits: payment.amountMinorUnits,
      currency: payment.currency,
      customerCountry: billingCountry,
      customerStateCode,
      supplierCountry: sellerConfig.country,
      supplierStateCode: sellerConfig.stateCode,
      sacCode: sellerConfig.sacCode,
      isExclusive: false,
      isExportApproved: sellerConfig.exportInvoicingApproved,
      exportLutArn: sellerConfig.exportLutArn,
      atDate: payment.chargedAt || payment.createdAt
    });

    const now = options?.now || new Date();
    const sub = payment.subscription;
    const plan = sub?.plan;

    // Determine invoice document type
    let invoiceType: BillingInvoiceType = BillingInvoiceType.SUBSCRIPTION_PURCHASE;
    if (payment.planChangeId) {
      invoiceType = BillingInvoiceType.SUBSCRIPTION_UPGRADE;
    } else if (sub) {
      const chargedAtTime = (payment.chargedAt || payment.createdAt).getTime();
      const subStartTime = sub.currentPeriodStart.getTime();
      if (Math.abs(subStartTime - chargedAtTime) > 60000) {
        invoiceType = BillingInvoiceType.SUBSCRIPTION_RENEWAL;
      }
    }

    const planCode = plan?.code || (invoiceType === BillingInvoiceType.SUBSCRIPTION_UPGRADE ? payment.planChange?.toPlan?.code : 'PRO_MONTHLY') || 'PRO_MONTHLY';
    const planName = plan?.name || (invoiceType === BillingInvoiceType.SUBSCRIPTION_UPGRADE ? payment.planChange?.toPlan?.name : 'Pro Plan') || 'Pro Plan';
    const billingInterval = sub?.billingInterval || (invoiceType === BillingInvoiceType.SUBSCRIPTION_UPGRADE ? payment.planChange?.toPlan?.interval : BillingInterval.MONTHLY) || BillingInterval.MONTHLY;
    const priceVersion = sub?.priceVersion || 1;

    // Line items description
    const lineItems = [
      {
        description: `ZdexCloud ${planName} (${billingInterval})`,
        sacCode: sellerConfig.sacCode,
        quantity: 1,
        unitPriceMinorUnits: taxCalc.taxableAmountMinorUnits,
        taxableAmountMinorUnits: taxCalc.taxableAmountMinorUnits,
        taxAmountMinorUnits: taxCalc.taxAmountMinorUnits,
        totalMinorUnits: taxCalc.grossAmountMinorUnits,
        currency: payment.currency
      }
    ];

    // Source payment transaction snapshot (excludes sensitive credentials)
    const sourcePaymentSnapshot = {
      paymentId: payment.id,
      amountMinorUnits: payment.amountMinorUnits,
      currency: payment.currency,
      provider: payment.provider,
      providerPaymentId: payment.providerPaymentId,
      providerSubscriptionId: payment.providerSubscriptionId,
      providerEventId: payment.providerEventId,
      chargedAt: (payment.chargedAt || payment.createdAt).toISOString()
    };

    // 8. ATOMIC ISSUANCE TRANSACTION BOUNDARY
    // Sequence allocation and invoice persistence MUST share the exact same database transaction
    let txResult: GenerateInvoiceResult;

    try {
      txResult = await prisma.$transaction(
        async (tx) => {
          // 1. Row-lock the payment record to serialize against concurrent status mutations and guarantee latest committed state
          const lockedRows = await tx.$queryRawUnsafe<Array<{ id: string; status: PaymentStatus }>>(
            'SELECT id, status FROM `BillingPayment` WHERE id = ? FOR UPDATE',
            paymentId
          );
          const paymentInTx = lockedRows && lockedRows.length > 0 ? lockedRows[0] : null;
          if (!paymentInTx) {
            throw new NotFoundError(`BillingPayment ${paymentId} not found in transaction`);
          }
          if (paymentInTx.status !== PaymentStatus.SUCCESS) {
            throw new ConflictError(
              `Cannot issue statutory tax invoice: payment status transitioned to '${paymentInTx.status}'`
            );
          }

          // 2. Double-check idempotency race condition inside transaction after acquiring payment lock
          const existingInsideTx = await tx.billingInvoice.findUnique({
            where: { paymentId }
          });
          if (existingInsideTx) {
            return {
              invoice: existingInsideTx,
              isExisting: true
            };
          }

          const settlementStatus = BillingInvoiceSettlementStatus.SETTLED;

          // A. Allocate atomic consecutive sequence number inside transaction
          const sequenceAllocation = await BillingInvoiceSequenceService.allocateNextNumber(tx, {
            scope: 'TAX_INVOICE',
            seriesPrefix: sellerConfig.invoiceSeriesPrefix,
            date: now
          });

          const fullSellerAddress = `${sellerConfig.addressLine1}${sellerConfig.addressLine2 ? ', ' + sellerConfig.addressLine2 : ''}, ${sellerConfig.city}, ${sellerConfig.state} ${sellerConfig.postalCode}`;

          // B. Construct deterministic snapshot payload for SHA-256 canonical hash
          const hashPayload = BillingInvoiceService.buildInvoiceHashPayload({
            invoiceNumber: sequenceAllocation.invoiceNumber,
            seriesPrefix: sequenceAllocation.seriesPrefix,
            financialYear: sequenceAllocation.financialYear,
            issuedAt: now.toISOString(),
            userId: payment.userId,
            planCode,
            planName,
            billingInterval,
            priceVersion,
            currency: payment.currency,
            subtotalMinorUnits: taxCalc.taxableAmountMinorUnits,
            discountMinorUnits: 0,
            taxMinorUnits: taxCalc.taxAmountMinorUnits,
            totalMinorUnits: taxCalc.grossAmountMinorUnits,
            customerName,
            customerEmail,
            customerCompanyName,
            customerTaxId,
            billingCountry,
            billingAddress,
            sellerName: sellerConfig.legalName,
            sellerAddress: fullSellerAddress,
            sellerTaxId: sellerConfig.gstin,
            sellerJurisdiction: sellerConfig.state,
            hsnSacCode: sellerConfig.sacCode,
            taxType: taxCalc.taxType,
            taxRateBasisPoints: taxCalc.taxRateBasisPoints,
            isInclusive: taxCalc.isInclusive,
            taxBreakdown: taxCalc.breakdown,
            lineItems,
            provider: payment.provider,
            providerPaymentId: payment.providerPaymentId,
            providerOrderId: null
          });

          const contentHash = BillingInvoiceService.computeInvoiceContentHash(hashPayload);

          // C. Atomically create BillingInvoice record
          const invoiceRecord = await tx.billingInvoice.create({
            data: {
              invoiceNumber: sequenceAllocation.invoiceNumber,
              sequenceNumber: sequenceAllocation.sequenceNumber,
              financialYear: sequenceAllocation.financialYear,
              seriesPrefix: sequenceAllocation.seriesPrefix,
              userId: payment.userId,
              subscriptionId: payment.subscriptionId,
              paymentId: payment.id,
              planChangeId: payment.planChangeId,
              type: invoiceType,
              status: BillingInvoiceStatus.ISSUED,
              settlementStatus,
              issuedAt: now,
              paidAt: payment.chargedAt || payment.createdAt,
              periodStart: sub?.currentPeriodStart || null,
              periodEnd: sub?.currentPeriodEnd || null,
              planCode,
              planName,
              billingInterval,
              priceVersion,
              currency: payment.currency,
              subtotalMinorUnits: taxCalc.taxableAmountMinorUnits,
              discountMinorUnits: 0,
              taxMinorUnits: taxCalc.taxAmountMinorUnits,
              totalMinorUnits: taxCalc.grossAmountMinorUnits,
              amountPaidMinorUnits: taxCalc.grossAmountMinorUnits,
              amountDueMinorUnits: 0,
              customerName,
              customerEmail,
              customerCompanyName,
              customerTaxId,
              billingAddress,
              billingCountry,
              sellerName: sellerConfig.legalName,
              sellerAddress: fullSellerAddress,
              sellerSupportEmail: sellerConfig.supportEmail,
              sellerTaxId: sellerConfig.gstin,
              sellerJurisdiction: sellerConfig.state,
              provider: payment.provider,
              providerEnvironment: payment.environment,
              providerPaymentId: payment.providerPaymentId,
              providerSubscriptionId: payment.providerSubscriptionId,
              providerOrderId: null,
              sourcePaymentSnapshot,
              hsnSacCode: sellerConfig.sacCode,
              taxJurisdiction: taxCalc.jurisdiction,
              taxType: taxCalc.taxType,
              taxRateBasisPoints: taxCalc.taxRateBasisPoints,
              isInclusive: taxCalc.isInclusive,
              taxBreakdown: taxCalc.breakdown as any,
              lineItems: lineItems as any,
              contentHash,
              signatureAlgorithm: 'SHA-256',
              signedAt: now,
              documentTitle: 'Tax Invoice',
              documentVersion: 1,
              metadata: {
                isInterState: taxCalc.isInterState,
                supplierStateCode: sellerConfig.stateCode,
                customerStateCode,
                ruleExplanation: taxCalc.ruleExplanation,
                authority: taxCalc.authority
              }
            }
          });

          // D. Record audit event inside transaction
          await tx.auditEvent.create({
            data: {
              userId: payment.userId,
              eventType: AuditEventType.BILLING_STATE_UPDATED,
              metadata: {
                action: 'STATUTORY_INVOICE_ISSUED',
                invoiceId: invoiceRecord.id,
                invoiceNumber: invoiceRecord.invoiceNumber,
                paymentId: payment.id,
                totalMinorUnits: invoiceRecord.totalMinorUnits,
                currency: invoiceRecord.currency
              }
            }
          });

          // E. Transactional Outbox Ingestion under Dispatch Mode Ownership (Phase 8.4 Batch E.4)
          const dispatchMode = config.INVOICE_NOTIFICATION_DISPATCH_MODE;
          if (dispatchMode === 'OUTBOX_WORKER' || dispatchMode === 'DUAL_WRITE_LEGACY_DISPATCH') {
            const outboxStatus = dispatchMode === 'OUTBOX_WORKER'
              ? InvoiceNotificationOutboxStatus.PENDING
              : InvoiceNotificationOutboxStatus.SHADOW_PENDING;

            await (tx as any).invoiceNotificationOutbox.create({
              data: {
                invoiceId: invoiceRecord.id,
                userId: payment.userId,
                notificationType: 'INVOICE_ISSUED',
                recipientEmail: customerEmail,
                recipientName: customerName,
                documentTitle: invoiceRecord.documentTitle,
                invoiceNumber: invoiceRecord.invoiceNumber,
                currency: invoiceRecord.currency,
                totalMinorUnits: invoiceRecord.totalMinorUnits,
                status: outboxStatus,
                provider: 'BREVO',
                metadata: {
                  dispatchMode,
                  paymentId: payment.id,
                  issuedAt: now.toISOString()
                }
              }
            });
          }

          return {
            invoice: invoiceRecord,
            isExisting: false
          };
        },
        { maxWait: 15000, timeout: 30000 }
      );
    } catch (txErr: any) {
      if (txErr.code === 'P2002') {
        // Unique constraint race condition: re-query committed invoice
        const raceInvoice = await prisma.billingInvoice.findUnique({
          where: { paymentId }
        });
        if (raceInvoice) {
          return { invoice: raceInvoice, isExisting: true };
        }
      }
      throw txErr;
    }

    if (!txResult.isExisting) {
      appLogger.info('[BillingInvoice] Successfully issued statutory tax invoice', {
        metadata: {
          invoiceId: txResult.invoice.id,
          invoiceNumber: txResult.invoice.invoiceNumber,
          paymentId,
          userId: txResult.invoice.userId,
          totalMinorUnits: txResult.invoice.totalMinorUnits,
          currency: txResult.invoice.currency
        }
      });

      await CustomerActivityService.recordEventSafe({
        userId: txResult.invoice.userId,
        eventType: 'BILLING.INVOICE_ISSUED',
        invoiceId: txResult.invoice.id,
        paymentId: txResult.invoice.paymentId || paymentId,
        subscriptionId: txResult.invoice.subscriptionId || null,
        idempotencyKey: `invoice_issued_${txResult.invoice.id}`,
        occurredAt: txResult.invoice.issuedAt,
        metadata: {
          invoiceNumber: txResult.invoice.invoiceNumber,
          totalMinorUnits: txResult.invoice.totalMinorUnits,
          currency: txResult.invoice.currency,
          planName: txResult.invoice.planName
        }
      });

      // In-App & Push Notification via CentralNotificationService (Phase 11.2)
      if (txResult.invoice.status === BillingInvoiceStatus.ISSUED && options?.sendNotification !== false) {
        billingEventProducer.emitInvoiceIssued({
          id: txResult.invoice.id,
          userId: txResult.invoice.userId,
          invoiceNumber: txResult.invoice.invoiceNumber,
          currency: txResult.invoice.currency,
          totalMinorUnits: txResult.invoice.totalMinorUnits,
          status: txResult.invoice.status,
          issuedAt: txResult.invoice.issuedAt
        }).catch((err) => {
          appLogger.warn('[BillingInvoice] Non-blocking in-app invoice notification emit failed', {
            metadata: { invoiceId: txResult.invoice.id, error: err?.message }
          });
        });
      }

      // Post-commit invoice availability notification (Single-Owner Dispatch Gate)
      // If OUTBOX_WORKER is active, direct dispatch is suppressed; background outbox worker owns sending.
      const dispatchMode = config.INVOICE_NOTIFICATION_DISPATCH_MODE;
      if (
        txResult.invoice.status === BillingInvoiceStatus.ISSUED &&
        options?.sendNotification !== false &&
        dispatchMode !== 'OUTBOX_WORKER'
      ) {
        BillingInvoiceNotificationService.sendInvoiceIssuedNotification(txResult.invoice, {
          correlationId: `invoice_${txResult.invoice.id}`
        }).then(async (dispatchRes) => {
          // In DUAL_WRITE_LEGACY_DISPATCH, update the shadow outbox record post-send
          if (dispatchMode === 'DUAL_WRITE_LEGACY_DISPATCH') {
            try {
              const isAmbiguous = /timeout|etimedout|econnreset|hang up|502|504|gateway/i.test(dispatchRes.error || '');
              const shadowStatus = dispatchRes.sent
                ? InvoiceNotificationOutboxStatus.DISPATCHED
                : isAmbiguous
                  ? InvoiceNotificationOutboxStatus.AMBIGUOUS_OUTCOME
                  : InvoiceNotificationOutboxStatus.RETRYABLE_FAILURE;

              const cleanMsgId = dispatchRes.dispatchResult?.providerMessageId
                ? String(dispatchRes.dispatchResult.providerMessageId).trim().replace(/^<|>$/g, '')
                : null;

              await (prisma as any).invoiceNotificationOutbox.updateMany({
                where: {
                  invoiceId: txResult.invoice.id,
                  notificationType: 'INVOICE_ISSUED',
                  status: InvoiceNotificationOutboxStatus.SHADOW_PENDING
                },
                data: {
                  status: shadowStatus,
                  providerMessageId: cleanMsgId,
                  dispatchedAt: dispatchRes.sent ? new Date() : null,
                  ambiguousAt: isAmbiguous ? new Date() : null,
                  ambiguousReason: isAmbiguous ? (dispatchRes.error || 'Ambiguous transport timeout') : null,
                  failureReason: dispatchRes.sent ? null : (dispatchRes.error || 'Direct dispatch failed')
                }
              });
            } catch (shadowErr) {
              appLogger.warn('[BillingInvoice] Failed to align shadow outbox record post-dispatch', {
                metadata: { invoiceId: txResult.invoice.id, error: String(shadowErr) }
              });
            }
          }
        }).catch((notifyErr) => {
          appLogger.warn('[BillingInvoice] Post-commit invoice notification error (isolated)', {
            metadata: {
              invoiceId: txResult.invoice.id,
              invoiceNumber: txResult.invoice.invoiceNumber,
              error: notifyErr?.message || String(notifyErr)
            }
          });
        });
      }
    } else {
      appLogger.info('[BillingInvoice] Concurrent race serialized: invoice already exists for payment', {
        metadata: {
          paymentId,
          invoiceId: txResult.invoice.id,
          invoiceNumber: txResult.invoice.invoiceNumber
        }
      });
    }

    return txResult;
  }

  /**
   * Retrieves an invoice by primary ID with strict user ownership and admin authorization.
   * Returns NotFoundError when unauthorized to prevent IDOR user enumeration.
   */
  public static async getInvoiceById(
    invoiceId: string,
    requestingUserId: string,
    isAdmin = false
  ): Promise<BillingInvoice> {
    if (!invoiceId) {
      throw new ValidationError('invoiceId is required');
    }

    const invoice = await prisma.billingInvoice.findUnique({
      where: { id: invoiceId }
    });

    if (!invoice || (!isAdmin && invoice.userId !== requestingUserId)) {
      throw new NotFoundError(`BillingInvoice ${invoiceId} not found`);
    }

    return invoice;
  }

  /**
   * Retrieves an invoice by source payment ID with strict user ownership and admin authorization.
   * Returns null when unauthorized or not found to prevent IDOR user enumeration.
   */
  public static async getInvoiceByPaymentId(
    paymentId: string,
    requestingUserId: string,
    isAdmin = false
  ): Promise<BillingInvoice | null> {
    if (!paymentId) {
      throw new ValidationError('paymentId is required');
    }

    const invoice = await prisma.billingInvoice.findUnique({
      where: { paymentId }
    });

    if (!invoice || (!isAdmin && invoice.userId !== requestingUserId)) {
      return null;
    }

    return invoice;
  }

  /**
   * Lists statutory invoices for an authenticated user with pagination.
   */
  public static async listInvoicesForUser(
    userId: string,
    options: { page?: number; limit?: number; includeDrafts?: boolean } = {}
  ): Promise<{ invoices: BillingInvoice[]; total: number; page: number; limit: number }> {
    if (!userId) {
      throw new ValidationError('userId is required');
    }

    const page = Math.max(1, options.page || 1);
    const limit = Math.min(100, Math.max(1, options.limit || 20));
    const skip = (page - 1) * limit;

    const whereClause: any = { userId };
    if (!options.includeDrafts) {
      whereClause.status = { not: BillingInvoiceStatus.DRAFT };
    }

    const [invoices, total] = await Promise.all([
      prisma.billingInvoice.findMany({
        where: whereClause,
        orderBy: { issuedAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.billingInvoice.count({
        where: whereClause
      })
    ]);

    return {
      invoices,
      total,
      page,
      limit
    };
  }
}
