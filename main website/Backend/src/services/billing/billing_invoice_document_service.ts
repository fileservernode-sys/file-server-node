import crypto from 'node:crypto';
import {
  BillingInvoice,
  BillingInvoiceStatus,
  BillingInvoiceSettlementStatus,
  BillingInvoiceType,
  CurrencyCode
} from '@prisma/client';
import { appLogger } from '../../observability/logger.js';
import { ValidationError, AppError } from '../../errors/app-error.js';

/**
 * Standard structured document model representing an invoice for document generation.
 * Derived solely from immutable persisted BillingInvoice snapshots.
 */
export interface InvoiceDocumentModel {
  id: string;
  invoiceNumber: string;
  seriesPrefix: string;
  financialYear: string;
  sequenceNumber: number;
  type: BillingInvoiceType;
  status: BillingInvoiceStatus;
  settlementStatus: BillingInvoiceSettlementStatus;
  issuedAt: Date;
  paidAt: Date | null;
  voidedAt: Date | null;
  periodStart: Date | null;
  periodEnd: Date | null;

  // Plan & service snapshots
  planCode: string;
  planName: string;
  billingInterval: string;
  priceVersion: number;

  // Financial amounts in integer minor units (paise/cents)
  currency: CurrencyCode;
  subtotalMinorUnits: number;
  discountMinorUnits: number;
  taxMinorUnits: number;
  totalMinorUnits: number;
  amountPaidMinorUnits: number;
  amountDueMinorUnits: number;

  // Customer snapshot
  customerName: string | null;
  customerEmail: string;
  customerCompanyName: string | null;
  customerTaxId: string | null;
  billingAddress: {
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  } | null;
  billingCountry: string | null;

  // Seller snapshot
  sellerName: string;
  sellerAddress: string | null;
  sellerSupportEmail: string;
  sellerTaxId: string | null;
  sellerJurisdiction: string | null;

  // Statutory tax snapshot
  hsnSacCode: string;
  taxJurisdiction: string | null;
  taxType: string;
  taxRateBasisPoints: number;
  isInclusive: boolean;
  taxBreakdown: {
    cgstMinorUnits?: number;
    sgstMinorUnits?: number;
    igstMinorUnits?: number;
    cgstRateBasisPoints?: number;
    sgstRateBasisPoints?: number;
    igstRateBasisPoints?: number;
  } | null;
  lineItems: Array<{
    description: string;
    sacCode: string;
    quantity: number;
    unitPriceMinorUnits: number;
    taxableAmountMinorUnits: number;
    taxAmountMinorUnits: number;
    totalMinorUnits: number;
    currency: string;
  }>;

  // Integrity & document control snapshots
  contentHash: string | null;
  documentTitle: string;
  documentVersion: number;
  voidReason: string | null;
  supersededByInvoiceId: string | null;
  correctionReason: string | null;
}

/**
 * Invoice Document Generation Service
 *
 * Implements read-only rendering of persisted invoice snapshot data into:
 * 1. Self-contained, responsive, printable HTML documents with embedded vector branding.
 * 2. Vector-based PDF documents (ISO 32000-1 / PDF 1.4) using in-memory byte stream assembly.
 *
 * Statutory & Compliance Boundaries:
 * - Accurately formats and displays persisted statutory fields (GSTIN, SAC, tax breakdown)
 *   in alignment with the current system tax model.
 * - Does NOT certify legal or tax compliance; actual statutory compliance remains subject
 *   to verification and approval by authorized human management and tax advisers.
 * - Renders solely from historical persisted snapshot data; never recalculates taxes or plan fees.
 *
 * Security & Integrity Guarantees:
 * - Read-only transformation: never mutates database, allocates sequences, or issues invoices.
 * - Strict HTML escaping and PDF text bounding to prevent XSS and layout corruption.
 * - Zero external network calls (no remote fonts, scripts, or images).
 * - Excludes internal provider IDs, gateway secrets, and payment snapshot payloads.
 */
export class BillingInvoiceDocumentService {
  /**
   * Maps a persisted BillingInvoice Prisma entity into an InvoiceDocumentModel.
   */
  public static mapInvoiceToDocumentModel(invoice: BillingInvoice): InvoiceDocumentModel {
    if (!invoice) {
      throw new ValidationError('Invoice record is required for document generation');
    }

    let parsedAddress: any = null;
    if (invoice.billingAddress) {
      parsedAddress = typeof invoice.billingAddress === 'string'
        ? JSON.parse(invoice.billingAddress)
        : invoice.billingAddress;
    }

    let parsedTaxBreakdown: any = null;
    if (invoice.taxBreakdown) {
      parsedTaxBreakdown = typeof invoice.taxBreakdown === 'string'
        ? JSON.parse(invoice.taxBreakdown)
        : invoice.taxBreakdown;
    }

    let parsedLineItems: any[] = [];
    if (invoice.lineItems) {
      parsedLineItems = Array.isArray(invoice.lineItems)
        ? (invoice.lineItems as any[])
        : (typeof invoice.lineItems === 'string' ? JSON.parse(invoice.lineItems) : []);
    }

    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      seriesPrefix: invoice.seriesPrefix,
      financialYear: invoice.financialYear,
      sequenceNumber: invoice.sequenceNumber,
      type: invoice.type,
      status: invoice.status,
      settlementStatus: invoice.settlementStatus,
      issuedAt: invoice.issuedAt,
      paidAt: invoice.paidAt,
      voidedAt: invoice.voidedAt,
      periodStart: invoice.periodStart,
      periodEnd: invoice.periodEnd,
      planCode: invoice.planCode,
      planName: invoice.planName,
      billingInterval: String(invoice.billingInterval),
      priceVersion: invoice.priceVersion,
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
      billingAddress: parsedAddress,
      billingCountry: invoice.billingCountry,
      sellerName: invoice.sellerName,
      sellerAddress: invoice.sellerAddress,
      sellerSupportEmail: invoice.sellerSupportEmail,
      sellerTaxId: invoice.sellerTaxId,
      sellerJurisdiction: invoice.sellerJurisdiction,
      hsnSacCode: invoice.hsnSacCode || '998313',
      taxJurisdiction: invoice.taxJurisdiction,
      taxType: String(invoice.taxType),
      taxRateBasisPoints: invoice.taxRateBasisPoints,
      isInclusive: invoice.isInclusive,
      taxBreakdown: parsedTaxBreakdown,
      lineItems: parsedLineItems,
      contentHash: invoice.contentHash,
      documentTitle: invoice.documentTitle || 'Tax Invoice',
      documentVersion: invoice.documentVersion || 1,
      voidReason: invoice.voidReason,
      supersededByInvoiceId: invoice.supersededByInvoiceId,
      correctionReason: invoice.correctionReason
    };
  }

  /**
   * HTML escape helper to prevent XSS injection.
   */
  public static escapeHtml(str: string | null | undefined): string {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Formats currency amounts in minor integer units into clean localized display string with Unicode symbol.
   */
  public static formatAmount(amountMinorUnits: number, currency: CurrencyCode): string {
    const symbols: Record<CurrencyCode, string> = {
      [CurrencyCode.INR]: '₹',
      [CurrencyCode.USD]: '$',
      [CurrencyCode.EUR]: '€',
      [CurrencyCode.GBP]: '£'
    };
    const symbol = symbols[currency] || (currency === CurrencyCode.INR ? '₹' : '$');
    const major = (amountMinorUnits / 100).toFixed(2);
    return `${symbol}${major}`;
  }

  /**
   * Formats currency amounts using standard pure ASCII text (safe for standard PDF Type 1 fonts).
   * Note: The Indian Rupee symbol (₹, U+20B9) is NOT supported in standard Type 1 Helvetica.
   * Standard PDF rendering explicitly falls back to the ISO currency code prefix "INR "
   * until a repository-controlled TrueType/OpenType Unicode font is approved and bundled.
   */
  public static formatAmountAscii(amountMinorUnits: number, currency: CurrencyCode): string {
    const prefixes: Record<CurrencyCode, string> = {
      [CurrencyCode.INR]: 'INR ',
      [CurrencyCode.USD]: 'USD ',
      [CurrencyCode.EUR]: 'EUR ',
      [CurrencyCode.GBP]: 'GBP '
    };
    const prefix = prefixes[currency] || `${String(currency)} `;
    const major = (amountMinorUnits / 100).toFixed(2);
    return `${prefix}${major}`;
  }

  /**
   * Formats a date into a clean UTC billing date string (e.g. "01 Mar 2026").
   */
  public static formatDate(date: Date | string | null | undefined): string {
    if (!date) return 'N/A';
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return 'N/A';
    const day = String(d.getUTCDate()).padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[d.getUTCMonth()];
    const year = d.getUTCFullYear();
    return `${day} ${month} ${year}`;
  }

  /**
   * Computes the SHA-256 hash of rendered PDF document bytes.
   * Distinct from invoice.contentHash (which hashes structured database fields).
   * Note: This checksum is solely an archival and byte-transmission integrity hash;
   * it does NOT constitute a legal digital signature or statutory certification.
   */
  public static computeDocumentByteHash(pdfBuffer: Buffer): string {
    if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer)) {
      throw new ValidationError('A valid Buffer is required to compute document byte hash');
    }
    return crypto.createHash('sha256').update(pdfBuffer).digest('hex');
  }

  /**
   * Sanitizes invoice numbers for safe attachment filenames by replacing path delimiters and invalid characters.
   */
  public static sanitizeFilename(invoiceNumber: string): string {
    if (!invoiceNumber || typeof invoiceNumber !== 'string') {
      return 'invoice.pdf';
    }
    const safeNum = invoiceNumber.replace(/[\/\\?%*:|"<>]/g, '-').replace(/\.\.+/g, '-').trim();
    return `invoice-${safeNum}.pdf`;
  }

  /**
   * Renders the complete, self-contained, responsive, printable HTML document for an invoice.
   * Matches established BillingReceiptService conventions.
   */
  public static renderInvoiceHtml(input: BillingInvoice | InvoiceDocumentModel): string {
    const doc = 'financialYear' in input && typeof input.financialYear === 'string' && 'planCode' in input
      ? (input as InvoiceDocumentModel)
      : this.mapInvoiceToDocumentModel(input as BillingInvoice);

    const escape = this.escapeHtml;
    const formattedTotal = this.formatAmount(doc.totalMinorUnits, doc.currency);
    const formattedSubtotal = this.formatAmount(doc.subtotalMinorUnits, doc.currency);
    const formattedDiscount = this.formatAmount(doc.discountMinorUnits, doc.currency);
    const formattedTax = this.formatAmount(doc.taxMinorUnits, doc.currency);
    const formattedPaid = this.formatAmount(doc.amountPaidMinorUnits, doc.currency);
    const formattedDue = this.formatAmount(doc.amountDueMinorUnits, doc.currency);

    const issueDateStr = this.formatDate(doc.issuedAt);
    const periodStr = doc.periodStart && doc.periodEnd
      ? `${this.formatDate(doc.periodStart)} – ${this.formatDate(doc.periodEnd)}`
      : issueDateStr;

    // Lifecycle presentation
    let lifecycleWatermarkHtml = '';
    let statusBadgeClass = 'badge-issued';
    let statusBadgeText = 'ISSUED';

    if (doc.status === BillingInvoiceStatus.VOIDED) {
      statusBadgeClass = 'badge-voided';
      statusBadgeText = 'VOIDED';
      const safeReason = doc.voidReason
        ? escape(doc.voidReason.slice(0, 200))
        : 'This document has been voided and is no longer an active invoice.';
      lifecycleWatermarkHtml = `
      <div class="watermark-banner watermark-voided">
        <span class="watermark-title">VOIDED</span>
        <span class="watermark-sub">${safeReason}</span>
      </div>`;
    } else if (doc.status === BillingInvoiceStatus.SUPERSEDED) {
      statusBadgeClass = 'badge-superseded';
      statusBadgeText = 'SUPERSEDED';
      const safeReason = doc.correctionReason
        ? escape(doc.correctionReason.slice(0, 200))
        : 'This invoice has been superseded by a replacement invoice.';
      lifecycleWatermarkHtml = `
      <div class="watermark-banner watermark-superseded">
        <span class="watermark-title">SUPERSEDED</span>
        <span class="watermark-sub">${safeReason}</span>
      </div>`;
    } else if (doc.status === BillingInvoiceStatus.DRAFT) {
      statusBadgeClass = 'badge-draft';
      statusBadgeText = 'DRAFT';
      lifecycleWatermarkHtml = `
      <div class="watermark-banner watermark-draft">
        <span class="watermark-title">DRAFT - NOT AN ISSUED INVOICE</span>
      </div>`;
    }

    // Customer address formatting
    const addr = doc.billingAddress;
    const customerAddrLines: string[] = [];
    if (addr?.addressLine1) customerAddrLines.push(escape(addr.addressLine1));
    if (addr?.addressLine2) customerAddrLines.push(escape(addr.addressLine2));
    const cityStateZip = [addr?.city, addr?.state, addr?.postalCode].filter(Boolean).map(escape).join(', ');
    if (cityStateZip) customerAddrLines.push(cityStateZip);
    if (addr?.country || doc.billingCountry) customerAddrLines.push(escape(addr?.country || doc.billingCountry));

    // Tax breakdown table rows
    let taxBreakdownHtml = '';
    if (doc.taxBreakdown) {
      const tb = doc.taxBreakdown;
      const rows: string[] = [];
      if (tb.cgstMinorUnits !== undefined && tb.cgstMinorUnits > 0) {
        rows.push(`
          <div class="calc-row">
            <span>CGST (${((tb.cgstRateBasisPoints || 900) / 100).toFixed(1)}%):</span>
            <span>${this.formatAmount(tb.cgstMinorUnits, doc.currency)}</span>
          </div>
        `);
      }
      if (tb.sgstMinorUnits !== undefined && tb.sgstMinorUnits > 0) {
        rows.push(`
          <div class="calc-row">
            <span>SGST (${((tb.sgstRateBasisPoints || 900) / 100).toFixed(1)}%):</span>
            <span>${this.formatAmount(tb.sgstMinorUnits, doc.currency)}</span>
          </div>
        `);
      }
      if (tb.igstMinorUnits !== undefined && tb.igstMinorUnits > 0) {
        rows.push(`
          <div class="calc-row">
            <span>IGST (${((tb.igstRateBasisPoints || 1800) / 100).toFixed(1)}%):</span>
            <span>${this.formatAmount(tb.igstMinorUnits, doc.currency)}</span>
          </div>
        `);
      }
      taxBreakdownHtml = rows.join('');
    }

    // Line items table rows
    let lineItemsRowsHtml = '';
    if (doc.lineItems && doc.lineItems.length > 0) {
      lineItemsRowsHtml = doc.lineItems.map(item => `
        <tr>
          <td>
            <div class="item-name">${escape(item.description)}</div>
            <div class="item-meta">SAC: ${escape(item.sacCode || doc.hsnSacCode)}</div>
          </td>
          <td class="text-center">${item.quantity || 1}</td>
          <td class="text-right">${this.formatAmount(item.taxableAmountMinorUnits, doc.currency)}</td>
          <td class="text-right">${this.formatAmount(item.taxAmountMinorUnits, doc.currency)}</td>
          <td class="text-right font-medium">${this.formatAmount(item.totalMinorUnits, doc.currency)}</td>
        </tr>
      `).join('');
    } else {
      lineItemsRowsHtml = `
        <tr>
          <td>
            <div class="item-name">ZdexCloud ${escape(doc.planName)} (${escape(doc.billingInterval)})</div>
            <div class="item-meta">SAC: ${escape(doc.hsnSacCode)}</div>
          </td>
          <td class="text-center">1</td>
          <td class="text-right">${formattedSubtotal}</td>
          <td class="text-right">${formattedTax}</td>
          <td class="text-right font-medium">${formattedTotal}</td>
        </tr>
      `;
    }

    // ZdexCloud SVG Vector Logo
    const zdexLogoSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 64" fill="none" style="height: 38px; width: auto;">
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
      <text x="74" y="42" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="28" font-weight="700" letter-spacing="-0.03em" fill="#0F172A">
        Zdex<tspan fill="#2563EB" font-weight="600">Cloud</tspan>
      </text>
    </svg>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escape(doc.documentTitle)} - ${escape(doc.invoiceNumber)}</title>
  <style>
    :root {
      --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      --font-mono: SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
      --color-bg: #F8FAFC;
      --color-surface: #FFFFFF;
      --color-primary: #2563EB;
      --color-text-main: #0F172A;
      --color-text-muted: #64748B;
      --color-text-sub: #334155;
      --color-border: #E2E8F0;
      --color-border-light: #F1F5F9;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--font-sans);
      background-color: var(--color-bg);
      color: var(--color-text-main);
      line-height: 1.5;
      padding: 36px 16px;
      -webkit-font-smoothing: antialiased;
    }
    .invoice-card {
      max-width: 760px;
      margin: 0 auto;
      background: var(--color-surface);
      border-radius: 12px;
      border: 1px solid var(--color-border);
      box-shadow: 0 4px 16px rgba(15, 23, 42, 0.04);
      padding: 44px;
    }
    .header-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid var(--color-border-light);
      padding-bottom: 24px;
      margin-bottom: 24px;
    }
    .doc-meta { text-align: right; }
    .doc-title { font-size: 22px; font-weight: 800; color: var(--color-text-main); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.05em; }
    .invoice-num { font-family: var(--font-mono); font-size: 14px; font-weight: 700; color: var(--color-primary); margin-bottom: 6px; }
    .badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .badge-issued { background: #ECFDF5; color: #059669; border: 1px solid #A7F3D0; }
    .badge-voided { background: #FEF2F2; color: #DC2626; border: 1px solid #FECACA; }
    .badge-superseded { background: #FFFBEB; color: #D97706; border: 1px solid #FDE68A; }
    .badge-draft { background: #F1F5F9; color: #475569; border: 1px solid #CBD5E1; }
    .watermark-banner {
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 24px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .watermark-voided { background: #FEF2F2; border-left: 4px solid #DC2626; color: #991B1B; }
    .watermark-superseded { background: #FFFBEB; border-left: 4px solid #D97706; color: #92400E; }
    .watermark-draft { background: #F1F5F9; border-left: 4px solid #64748B; color: #334155; }
    .watermark-title { font-weight: 800; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; }
    .watermark-sub { font-size: 12px; }
    .addresses-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 32px;
      margin-bottom: 28px;
    }
    .addr-col h4 {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--color-text-muted);
      margin-bottom: 8px;
      font-weight: 700;
    }
    .addr-name { font-size: 14px; font-weight: 700; color: var(--color-text-main); margin-bottom: 2px; }
    .addr-detail { font-size: 13px; color: var(--color-text-sub); line-height: 1.45; }
    .addr-tax-id { font-family: var(--font-mono); font-size: 12px; font-weight: 600; color: var(--color-text-main); margin-top: 4px; }
    .meta-strip {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      background: var(--color-bg);
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 28px;
      gap: 12px;
    }
    .meta-item { display: flex; flex-direction: column; }
    .meta-label { font-size: 11px; color: var(--color-text-muted); text-transform: uppercase; font-weight: 600; margin-bottom: 2px; }
    .meta-val { font-size: 13px; font-weight: 700; color: var(--color-text-main); }
    .items-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 28px;
    }
    .items-table th {
      background: var(--color-bg);
      text-align: left;
      font-size: 11px;
      font-weight: 700;
      color: var(--color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 10px 12px;
      border-top: 1px solid var(--color-border);
      border-bottom: 1px solid var(--color-border);
    }
    .items-table td {
      padding: 12px;
      border-bottom: 1px solid var(--color-border-light);
      font-size: 13px;
      color: var(--color-text-sub);
    }
    .item-name { font-weight: 600; color: var(--color-text-main); }
    .item-meta { font-size: 11px; color: var(--color-text-muted); margin-top: 2px; font-family: var(--font-mono); }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .font-medium { font-weight: 600; color: var(--color-text-main); }
    .summary-grid {
      display: grid;
      grid-template-columns: 1fr 280px;
      gap: 24px;
      margin-bottom: 28px;
    }
    .statutory-notes { font-size: 12px; color: var(--color-text-muted); line-height: 1.5; }
    .statutory-notes p { margin-bottom: 6px; }
    .calc-box {
      background: var(--color-bg);
      border-radius: 8px;
      padding: 16px;
      border: 1px solid var(--color-border-light);
    }
    .calc-row {
      display: flex;
      justify-content: space-between;
      font-size: 13px;
      color: var(--color-text-sub);
      margin-bottom: 8px;
    }
    .calc-row.total-row {
      border-top: 2px solid var(--color-border);
      padding-top: 8px;
      margin-top: 8px;
      margin-bottom: 0;
      font-size: 15px;
      font-weight: 800;
      color: var(--color-text-main);
    }
    .footer-integrity {
      border-top: 1px solid var(--color-border-light);
      padding-top: 20px;
      margin-top: 20px;
      font-size: 11px;
      color: var(--color-text-muted);
      line-height: 1.5;
    }
    .hash-val { font-family: var(--font-mono); font-size: 10px; color: #475569; word-break: break-all; }
    @media print {
      body { background: #FFFFFF; padding: 0; }
      .invoice-card { border: none; box-shadow: none; padding: 20px 0; max-width: 100%; }
      @page { margin: 15mm; }
    }
  </style>
</head>
<body>
  <div class="invoice-card">
    <div class="header-row">
      <div class="brand-box">${zdexLogoSvg}</div>
      <div class="doc-meta">
        <div class="doc-title">${escape(doc.documentTitle)}</div>
        <div class="invoice-num">${escape(doc.invoiceNumber)}</div>
        <span class="badge ${statusBadgeClass}">${statusBadgeText}</span>
      </div>
    </div>

    ${lifecycleWatermarkHtml}

    <div class="addresses-grid">
      <div class="addr-col">
        <h4>Supplier (Seller)</h4>
        <div class="addr-name">${escape(doc.sellerName)}</div>
        <div class="addr-detail">${escape(doc.sellerAddress || '')}</div>
        ${doc.sellerTaxId ? `<div class="addr-tax-id">GSTIN: ${escape(doc.sellerTaxId)}</div>` : ''}
        ${doc.sellerJurisdiction ? `<div class="addr-detail">State: ${escape(doc.sellerJurisdiction)}</div>` : ''}
        <div class="addr-detail">Email: ${escape(doc.sellerSupportEmail)}</div>
      </div>
      <div class="addr-col">
        <h4>Recipient (Billed To)</h4>
        <div class="addr-name">${escape(doc.customerName || doc.customerEmail)}</div>
        ${doc.customerCompanyName ? `<div class="addr-detail font-medium">${escape(doc.customerCompanyName)}</div>` : ''}
        ${customerAddrLines.map(line => `<div class="addr-detail">${line}</div>`).join('')}
        ${doc.customerTaxId ? `<div class="addr-tax-id">GSTIN/Tax ID: ${escape(doc.customerTaxId)}</div>` : ''}
      </div>
    </div>

    <div class="meta-strip">
      <div class="meta-item">
        <span class="meta-label">Invoice Date</span>
        <span class="meta-val">${issueDateStr}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Financial Year</span>
        <span class="meta-val">${escape(doc.financialYear)}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Billing Period</span>
        <span class="meta-val">${periodStr}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Place of Supply</span>
        <span class="meta-val">${escape(doc.taxJurisdiction || doc.billingCountry || 'IN')}</span>
      </div>
    </div>

    <table class="items-table">
      <thead>
        <tr>
          <th>Description</th>
          <th class="text-center">Qty</th>
          <th class="text-right">Taxable Value</th>
          <th class="text-right">Tax (${((doc.taxRateBasisPoints || 0) / 100).toFixed(1)}%)</th>
          <th class="text-right">Total</th>
        </tr>
      </thead>
      <tbody>
        ${lineItemsRowsHtml}
      </tbody>
    </table>

    <div class="summary-grid">
      <div class="statutory-notes">
        <p><strong>Service Classification:</strong> SAC ${escape(doc.hsnSacCode)} — Cloud Computing and Data Processing Services.</p>
        <p>This document reflects persisted billing snapshot data according to the configured billing profile. Actual statutory tax compliance remains subject to authoritative review.</p>
        <p>Customer payments are final. For account inquiries, contact support at <strong>${escape(doc.sellerSupportEmail)}</strong>.</p>
      </div>
      <div class="calc-box">
        <div class="calc-row">
          <span>Subtotal:</span>
          <span>${formattedSubtotal}</span>
        </div>
        ${doc.discountMinorUnits > 0 ? `
        <div class="calc-row">
          <span>Discount:</span>
          <span>-${formattedDiscount}</span>
        </div>` : ''}
        <div class="calc-row">
          <span>Total Tax:</span>
          <span>${formattedTax}</span>
        </div>
        ${taxBreakdownHtml}
        <div class="calc-row total-row">
          <span>Total Amount:</span>
          <span>${formattedTotal}</span>
        </div>
        <div class="calc-row" style="margin-top: 6px; font-size: 12px; color: var(--color-text-muted);">
          <span>Amount Paid:</span>
          <span>${formattedPaid}</span>
        </div>
      </div>
    </div>

    <div class="footer-integrity">
      <div><strong>Document Record Integrity:</strong></div>
      <div>Canonical Data Hash: <span class="hash-val">${escape(doc.contentHash || 'N/A')}</span></div>
      <div>Document Version: ${doc.documentVersion} | Invoice No: ${escape(doc.invoiceNumber)}</div>
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Generates a vector-based PDF document (ISO 32000-1 / PDF 1.4) for an invoice.
   * Emits an in-memory Node.js Buffer containing the complete binary stream.
   *
   * Design:
   * Uses pure Node.js in-memory vector stream assembly.
   * Operates with no native OS dependencies or external font downloads.
   * Note: Unicode font support (such as the Indian Rupee symbol) requires bundling
   * an approved TrueType font; standard PDF output explicitly uses ASCII currency prefixes.
   */
  public static async generateInvoicePdf(input: BillingInvoice | InvoiceDocumentModel): Promise<Buffer> {
    const startTime = Date.now();
    const doc = 'financialYear' in input && typeof input.financialYear === 'string' && 'planCode' in input
      ? (input as InvoiceDocumentModel)
      : this.mapInvoiceToDocumentModel(input as BillingInvoice);

    try {
      const pdfBuffer = this.buildPurePdfBuffer(doc);
      const durationMs = Date.now() - startTime;

      appLogger.info('[BillingInvoiceDocument] Successfully assembled invoice PDF buffer', {
        metadata: {
          invoiceId: doc.id,
          invoiceNumber: doc.invoiceNumber,
          byteLength: pdfBuffer.length,
          durationMs
        }
      });

      return pdfBuffer;
    } catch (err: any) {
      const safeErrorMsg = err?.message || String(err);
      appLogger.error('[BillingInvoiceDocument] Failed to generate invoice PDF', {
        metadata: {
          invoiceId: doc.id,
          invoiceNumber: doc.invoiceNumber,
          error: safeErrorMsg
        }
      });
      throw new AppError(`Failed to generate invoice PDF document: ${safeErrorMsg}`, 500);
    }
  }

  /**
   * Internal pure Node.js vector PDF builder producing ISO 32000-1 (PDF 1.4) compliant binary buffers.
   * Renders typography, layout, borders, tables, and watermarks from snapshot data.
   */
  private static buildPurePdfBuffer(doc: InvoiceDocumentModel): Buffer {
    const sanitizeText = (txt: string | null | undefined, maxLength: number = 75): string => {
      if (!txt) return '';
      const cleaned = String(txt)
        .replace(/\\/g, '\\\\')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)')
        .replace(/[\r\n\t]+/g, ' ')
        .trim();
      return cleaned.length > maxLength ? cleaned.slice(0, maxLength) + '...' : cleaned;
    };

    // Format money using ASCII prefix for standard Type 1 Helvetica font
    const totalStr = this.formatAmountAscii(doc.totalMinorUnits, doc.currency);
    const subtotalStr = this.formatAmountAscii(doc.subtotalMinorUnits, doc.currency);
    const taxStr = this.formatAmountAscii(doc.taxMinorUnits, doc.currency);
    const issueDateStr = this.formatDate(doc.issuedAt);

    // Vector drawing stream
    const streamParts: string[] = [];

    // Header Title and Brand
    streamParts.push('BT /F2 18 Tf 40 780 Td (ZDEXCLOUD CONTROL PLANE) Tj ET');
    streamParts.push('BT /F2 16 Tf 420 780 Td (' + sanitizeText(doc.documentTitle.toUpperCase(), 30) + ') Tj ET');
    streamParts.push('BT /F1 11 Tf 420 762 Td (Invoice No: ' + sanitizeText(doc.invoiceNumber, 30) + ') Tj ET');
    streamParts.push('BT /F1 10 Tf 420 748 Td (Date: ' + sanitizeText(issueDateStr, 20) + ') Tj ET');
    streamParts.push('BT /F1 10 Tf 420 734 Td (FY: ' + sanitizeText(doc.financialYear, 15) + ') Tj ET');

    // Decorative Header Rule
    streamParts.push('0.15 0.39 0.92 RG 2 w 40 720 m 555 720 l S');

    // Lifecycle Status Banner (if VOIDED, SUPERSEDED, or DRAFT)
    if (doc.status === BillingInvoiceStatus.VOIDED) {
      streamParts.push('0.9 0.15 0.15 rg 40 685 515 24 re f');
      const safeReason = doc.voidReason
        ? sanitizeText(doc.voidReason, 60)
        : 'Document cancelled';
      streamParts.push('BT /F2 11 Tf 1 1 1 rg 50 692 Td (VOIDED: ' + safeReason + ') Tj ET');
    } else if (doc.status === BillingInvoiceStatus.SUPERSEDED) {
      streamParts.push('0.95 0.6 0.05 rg 40 685 515 24 re f');
      const safeReason = doc.correctionReason
        ? sanitizeText(doc.correctionReason, 60)
        : 'Superseded by replacement document';
      streamParts.push('BT /F2 11 Tf 1 1 1 rg 50 692 Td (SUPERSEDED: ' + safeReason + ') Tj ET');
    } else if (doc.status === BillingInvoiceStatus.DRAFT) {
      streamParts.push('0.5 0.5 0.5 rg 40 685 515 24 re f');
      streamParts.push('BT /F2 11 Tf 1 1 1 rg 50 692 Td (DRAFT: NOT AN ISSUED INVOICE) Tj ET');
    }

    // Addresses Section
    const addrY = doc.status === BillingInvoiceStatus.ISSUED ? 690 : 660;
    streamParts.push('0 0 0 rg');
    streamParts.push(`BT /F2 11 Tf 40 ${addrY} Td (SUPPLIER / SELLER:) Tj ET`);
    streamParts.push(`BT /F2 10 Tf 40 ${addrY - 16} Td (${sanitizeText(doc.sellerName, 45)}) Tj ET`);
    streamParts.push(`BT /F1 9 Tf 40 ${addrY - 28} Td (${sanitizeText(doc.sellerAddress || '', 55)}) Tj ET`);
    if (doc.sellerTaxId) {
      streamParts.push(`BT /F2 9 Tf 40 ${addrY - 40} Td (GSTIN: ${sanitizeText(doc.sellerTaxId, 25)}) Tj ET`);
    }
    streamParts.push(`BT /F1 9 Tf 40 ${addrY - 52} Td (State: ${sanitizeText(doc.sellerJurisdiction || 'Gujarat', 20)} | Email: ${sanitizeText(doc.sellerSupportEmail, 35)}) Tj ET`);

    streamParts.push(`BT /F2 11 Tf 300 ${addrY} Td (RECIPIENT / BILLED TO:) Tj ET`);
    streamParts.push(`BT /F2 10 Tf 300 ${addrY - 16} Td (${sanitizeText(doc.customerName || doc.customerEmail, 40)}) Tj ET`);
    if (doc.customerCompanyName) {
      streamParts.push(`BT /F1 9 Tf 300 ${addrY - 28} Td (${sanitizeText(doc.customerCompanyName, 45)}) Tj ET`);
    }
    const custCity = doc.billingAddress?.city ? `${doc.billingAddress.city}, ` : '';
    const custState = doc.billingAddress?.state || '';
    const custPin = doc.billingAddress?.postalCode ? ` - ${doc.billingAddress.postalCode}` : '';
    streamParts.push(`BT /F1 9 Tf 300 ${addrY - 40} Td (${sanitizeText(custCity + custState + custPin, 50)}) Tj ET`);
    if (doc.customerTaxId) {
      streamParts.push(`BT /F2 9 Tf 300 ${addrY - 52} Td (GSTIN/Tax ID: ${sanitizeText(doc.customerTaxId, 25)}) Tj ET`);
    }

    // Line Items Table Header
    const tableTop = addrY - 80;
    streamParts.push(`0.95 0.96 0.98 rg 40 ${tableTop} 515 20 re f`);
    streamParts.push(`0.85 0.88 0.92 RG 1 w 40 ${tableTop} 515 20 re S`);
    streamParts.push(`0 0 0 rg`);
    streamParts.push(`BT /F2 9 Tf 48 ${tableTop + 6} Td (DESCRIPTION / SAC) Tj ET`);
    streamParts.push(`BT /F2 9 Tf 280 ${tableTop + 6} Td (QTY) Tj ET`);
    streamParts.push(`BT /F2 9 Tf 340 ${tableTop + 6} Td (TAXABLE VAL) Tj ET`);
    streamParts.push(`BT /F2 9 Tf 430 ${tableTop + 6} Td (TAX AMOUNT) Tj ET`);
    streamParts.push(`BT /F2 9 Tf 505 ${tableTop + 6} Td (TOTAL) Tj ET`);

    // Line Item Row
    const rowY = tableTop - 24;
    streamParts.push(`0.85 0.88 0.92 RG 0.5 w 40 ${rowY - 8} m 555 ${rowY - 8} l S`);
    const itemDesc = doc.lineItems?.[0]?.description || `ZdexCloud ${doc.planName} (${doc.billingInterval}) - SAC ${doc.hsnSacCode}`;
    streamParts.push(`BT /F1 9 Tf 48 ${rowY} Td (${sanitizeText(itemDesc, 45)}) Tj ET`);
    streamParts.push(`BT /F1 9 Tf 285 ${rowY} Td (1) Tj ET`);
    streamParts.push(`BT /F1 9 Tf 340 ${rowY} Td (${sanitizeText(subtotalStr, 15)}) Tj ET`);
    streamParts.push(`BT /F1 9 Tf 430 ${rowY} Td (${sanitizeText(taxStr, 15)}) Tj ET`);
    streamParts.push(`BT /F2 9 Tf 505 ${rowY} Td (${sanitizeText(totalStr, 15)}) Tj ET`);

    // Financial Calculation Summary Box
    const calcY = rowY - 50;
    streamParts.push(`0.97 0.98 0.99 rg 320 ${calcY - 60} 235 90 re f`);
    streamParts.push(`0.85 0.88 0.92 RG 1 w 320 ${calcY - 60} 235 90 re S`);
    streamParts.push(`0 0 0 rg`);
    streamParts.push(`BT /F1 9 Tf 330 ${calcY + 14} Td (Taxable Subtotal:) Tj ET`);
    streamParts.push(`BT /F1 9 Tf 470 ${calcY + 14} Td (${sanitizeText(subtotalStr, 15)}) Tj ET`);
    streamParts.push(`BT /F1 9 Tf 330 ${calcY} Td (Tax Rate: ${((doc.taxRateBasisPoints || 0) / 100).toFixed(1)}% GST) Tj ET`);
    streamParts.push(`BT /F1 9 Tf 470 ${calcY} Td (${sanitizeText(taxStr, 15)}) Tj ET`);
    streamParts.push(`0.85 0.88 0.92 RG 1 w 330 ${calcY - 6} m 545 ${calcY - 6} l S`);
    streamParts.push(`0 0 0 rg`);
    streamParts.push(`BT /F2 11 Tf 330 ${calcY - 22} Td (Total Amount:) Tj ET`);
    streamParts.push(`BT /F2 11 Tf 470 ${calcY - 22} Td (${sanitizeText(totalStr, 15)}) Tj ET`);
    streamParts.push(`BT /F1 9 Tf 330 ${calcY - 38} Td (Amount Paid:) Tj ET`);
    streamParts.push(`BT /F1 9 Tf 470 ${calcY - 38} Td (${sanitizeText(totalStr, 15)}) Tj ET`);

    // Classification Notes (Left Box)
    streamParts.push(`BT /F2 8 Tf 40 ${calcY + 14} Td (CLASSIFICATION & RECORD NOTES:) Tj ET`);
    streamParts.push(`BT /F1 8 Tf 40 ${calcY} Td (SAC ${sanitizeText(doc.hsnSacCode, 10)} - IT Software and Infrastructure Services) Tj ET`);
    streamParts.push(`BT /F1 8 Tf 40 ${calcY - 12} Td (Reflects persisted billing snapshot. Subject to tax advisor review.) Tj ET`);
    streamParts.push(`BT /F1 8 Tf 40 ${calcY - 24} Td (Place of Supply: ${sanitizeText(doc.taxJurisdiction || doc.billingCountry || 'IN', 20)}) Tj ET`);
    streamParts.push(`BT /F1 8 Tf 40 ${calcY - 36} Td (Customer payments are final. Contact: ${sanitizeText(doc.sellerSupportEmail, 35)}) Tj ET`);

    // Record Integrity Footer
    streamParts.push('0.85 0.88 0.92 RG 1 w 40 80 m 555 80 l S');
    streamParts.push('0.3 0.35 0.4 rg');
    streamParts.push('BT /F2 8 Tf 40 68 Td (RECORD INTEGRITY CHECKSUM:) Tj ET');
    const hashDisplay = doc.contentHash ? `Canonical Data Hash: ${doc.contentHash}` : 'Hash: N/A';
    streamParts.push(`BT /F1 7 Tf 40 56 Td (${sanitizeText(hashDisplay, 90)}) Tj ET`);
    streamParts.push(`BT /F1 7 Tf 40 44 Td (Version: ${doc.documentVersion} | Invoice: ${sanitizeText(doc.invoiceNumber, 30)} | Generated electronically) Tj ET`);

    const contentStream = streamParts.join('\n');
    const contentStreamLength = Buffer.byteLength(contentStream, 'utf8');

    // PDF Object Hierarchy
    const objects: string[] = [];
    objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj');
    objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj');
    objects.push('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>\nendobj');
    objects.push(`4 0 obj\n<< /Length ${contentStreamLength} >>\nstream\n${contentStream}\nendstream\nendobj`);
    objects.push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj');
    objects.push('6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj');

    // Assemble cross-reference table and trailer
    let offset = '%PDF-1.4\n'.length;
    const xrefOffsets: number[] = [0]; // object 0 is free

    for (const obj of objects) {
      xrefOffsets.push(offset);
      offset += Buffer.byteLength(obj + '\n', 'utf8');
    }

    const startXref = offset;
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objects.length; i++) {
      xref += String(xrefOffsets[i]).padStart(10, '0') + ' 00000 n \n';
    }

    const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`;
    const fullPdfString = '%PDF-1.4\n' + objects.join('\n') + '\n' + xref + trailer;

    return Buffer.from(fullPdfString, 'utf8');
  }
}
