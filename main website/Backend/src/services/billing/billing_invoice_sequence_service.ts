import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { appLogger } from '../../observability/logger.js';

export interface AllocatedInvoiceSequence {
  sequenceNumber: number;
  invoiceNumber: string;
  financialYear: string;
  shortFinancialYear: string;
  seriesPrefix: string;
  scope: string;
}

export interface AllocateSequenceOptions {
  scope?: string;
  seriesPrefix?: string;
  date?: Date;
}

/**
 * Concurrency-Safe Statutory Invoice Number Sequence Allocator
 *
 * Implements atomic, monotonic serial numbering compliant with Indian GST
 * statutory rules (Rule 46(b) of CGST Rules 2017):
 * 1. Consecutive serial number not exceeding 16 characters.
 * 2. Unique for a financial year (running April 1 to March 31).
 * 3. Formatted as [PREFIX]-[SHORT_FY]-[PADDED NUMBER], e.g.:
 *    - 6-digit padded sequence: "ZCI-2627-000001" (15 characters: 3 + 1 + 4 + 1 + 6 = 15).
 *    - 7-digit unpadded sequence: "ZCI-2627-1000000" (16 characters: 3 + 1 + 4 + 1 + 7 = 16).
 * 4. Guaranteed atomic allocation using database row locking (FOR UPDATE) inside transactions.
 *
 * CRITICAL NUMBERING INTEGRITY & ISSUANCE BOUNDARY:
 * - A sequence number MUST ONLY be allocated as the final atomic step in the invoice
 *   issuance transaction, immediately before database commit.
 * - Sequence numbers must NEVER be allocated speculatively for drafts or preliminary calculations.
 * - The sequence allocator and invoice insertion MUST share the exact same database transaction (tx).
 * - allocateStandalone() commits independently and must NEVER be used in invoice issuance flows.
 * - If a transaction rolls back before commit, database locks are released. However, once
 *   an invoice is committed with an allocated number, that number is permanent.
 * - If an issued invoice is subsequently cancelled, amended, or refunded, it must be marked
 *   as VOIDED or offset via CREDIT_NOTE. The number must NEVER be recycled or reused.
 */
export class BillingInvoiceSequenceService {
  public static readonly DEFAULT_SCOPE = 'TAX_INVOICE';
  public static readonly DEFAULT_SERIES_PREFIX = 'ZCI';

  // Statutory maximum sequence limit under Rule 46(b) (Prefix: 3, Short FY: 4, Delimiters: 2 -> Max Seq: 7 digits = 16 chars)
  public static readonly MAX_SEQUENCE_NUMBER = 9999999;

  /**
   * Computes the Indian Financial Year (April 1 to March 31) for a given date.
   * Explicitly evaluates date in Indian Standard Time (Asia/Kolkata, UTC+05:30)
   * to guarantee deterministic boundary alignment across global server runtimes.
   */
  public static getIndianFinancialYear(date: Date = new Date()): {
    financialYear: string;
    shortFinancialYear: string;
  } {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: 'numeric'
    });
    const parts = formatter.formatToParts(date);
    const yearStr = parts.find((p) => p.type === 'year')?.value;
    const monthStr = parts.find((p) => p.type === 'month')?.value;

    const year = yearStr ? parseInt(yearStr, 10) : date.getUTCFullYear();
    const month = monthStr ? parseInt(monthStr, 10) : date.getUTCMonth() + 1; // 1-12 in IST

    let startYear: number;
    let endYear: number;

    if (month >= 4) {
      // April (4) to December (12) belongs to FY (currentYear - nextYear)
      startYear = year;
      endYear = year + 1;
    } else {
      // January (1) to March (3) belongs to FY (previousYear - currentYear)
      startYear = year - 1;
      endYear = year;
    }

    const financialYear = `${startYear}-${endYear}`;
    const shortFinancialYear = `${String(startYear).slice(-2)}${String(endYear).slice(-2)}`;

    return {
      financialYear,
      shortFinancialYear
    };
  }

  /**
   * Computes the maximum allowable sequence number for a given prefix and short financial year
   * to guarantee that the total invoice number does not exceed 16 characters (GST Rule 46(b)).
   * Formula: maxDigits = 16 - (prefix.length + 1 + shortFY.length + 1)
   */
  public static getMaxSequenceForPrefix(seriesPrefix: string, shortFinancialYear: string): number {
    const cleanPrefix = (seriesPrefix || this.DEFAULT_SERIES_PREFIX).trim().toUpperCase();
    if (!/^[A-Z0-9]{1,8}$/.test(cleanPrefix)) {
      throw new Error(`Invalid series prefix '${seriesPrefix}': must be 1 to 8 alphanumeric characters`);
    }

    const cleanShortFy = (shortFinancialYear || '').trim();
    if (!/^[0-9]{4}$/.test(cleanShortFy)) {
      throw new Error(`Invalid short financial year '${shortFinancialYear}': must be 4 numeric digits (e.g. '2627')`);
    }

    const fixedLength = cleanPrefix.length + 1 + cleanShortFy.length + 1; // e.g. 3 + 1 + 4 + 1 = 9
    const maxDigits = 16 - fixedLength;
    if (maxDigits < 1) {
      throw new Error(`Prefix '${cleanPrefix}' with FY '${cleanShortFy}' leaves no digits for serial numbers within 16 characters`);
    }
    return Math.pow(10, maxDigits) - 1;
  }

  /**
   * Formats a statutory invoice number according to Rule 46(b) constraints.
   * Total length must not exceed 16 characters.
   * Dynamically adjusts zero-padding to respect maxDigits when prefix length > 4.
   */
  public static formatInvoiceNumber(
    seriesPrefix: string,
    shortFinancialYear: string,
    sequenceNumber: number
  ): string {
    if (!Number.isInteger(sequenceNumber) || sequenceNumber < 1) {
      throw new Error(`Invalid sequence number: must be a positive integer, got ${sequenceNumber}`);
    }

    const cleanPrefix = (seriesPrefix || this.DEFAULT_SERIES_PREFIX).trim().toUpperCase();
    const cleanShortFy = (shortFinancialYear || '').trim();

    const maxAllowed = this.getMaxSequenceForPrefix(cleanPrefix, cleanShortFy);
    if (sequenceNumber > maxAllowed) {
      throw new Error(
        `Statutory sequence overflow: allocated sequence number ${sequenceNumber} exceeds maximum length allowed under GST Rule 46(b) for prefix '${cleanPrefix}'`
      );
    }

    const fixedLength = cleanPrefix.length + 1 + cleanShortFy.length + 1;
    const maxDigits = 16 - fixedLength;
    const padLength = Math.max(1, Math.min(6, maxDigits));

    const paddedSequence = String(sequenceNumber).padStart(padLength, '0');
    const formatted = `${cleanPrefix}-${cleanShortFy}-${paddedSequence}`;

    if (formatted.length > 16) {
      throw new Error(
        `Statutory sequence overflow: formatted invoice number '${formatted}' exceeds maximum 16-character limit under GST Rule 46(b)`
      );
    }

    return formatted;
  }

  /**
   * Atomically allocates the next consecutive invoice number within a transaction.
   * Uses upsert for race-free sequence record initialization and row-level locking
   * (SELECT ... FOR UPDATE) to serialize concurrent allocators and prevent gaps.
   */
  public static async allocateNextNumber(
    tx: Prisma.TransactionClient,
    options: AllocateSequenceOptions = {}
  ): Promise<AllocatedInvoiceSequence> {
    const scope = (options.scope ?? this.DEFAULT_SCOPE).trim();
    const seriesPrefix = (options.seriesPrefix ?? this.DEFAULT_SERIES_PREFIX).trim().toUpperCase();
    const targetDate = options.date ?? new Date();

    const { financialYear, shortFinancialYear } = this.getIndianFinancialYear(targetDate);

    // Pre-validate prefix, short FY, and max sequence capacity before touching database
    const maxAllowed = this.getMaxSequenceForPrefix(seriesPrefix, shortFinancialYear);

    // 1. Race-free atomic upsert ensures the sequence counter exists for the scope/FY/series
    const sequenceRow = await tx.billingInvoiceSequence.upsert({
      where: {
        scope_financialYear_seriesPrefix: {
          scope,
          financialYear,
          seriesPrefix
        }
      },
      create: {
        scope,
        financialYear,
        seriesPrefix,
        lastNumber: 0
      },
      update: {}
    });

    // 2. Row-lock the sequence record to serialize concurrent allocators and read the authoritative counter
    const lockedRows = await tx.$queryRawUnsafe<Array<{ id: string; lastNumber: number }>>(
      'SELECT id, lastNumber FROM `BillingInvoiceSequence` WHERE id = ? FOR UPDATE',
      sequenceRow.id
    );

    const currentLastNumber =
      lockedRows && lockedRows.length > 0 && typeof lockedRows[0].lastNumber === 'number'
        ? lockedRows[0].lastNumber
        : sequenceRow.lastNumber;

    const nextNumber = currentLastNumber + 1;

    // Check overflow before updating the counter
    if (nextNumber > maxAllowed) {
      throw new Error(
        `Statutory sequence overflow: allocated sequence number ${nextNumber} exceeds maximum length allowed under GST Rule 46(b) for prefix '${seriesPrefix}'`
      );
    }

    // 3. Persist incremented counter
    await tx.billingInvoiceSequence.update({
      where: { id: sequenceRow.id },
      data: {
        lastNumber: nextNumber
      }
    });

    const invoiceNumber = this.formatInvoiceNumber(seriesPrefix, shortFinancialYear, nextNumber);

    appLogger.info('[BillingInvoiceSequence] Allocated consecutive statutory invoice number', {
      metadata: {
        scope,
        financialYear,
        seriesPrefix,
        sequenceNumber: nextNumber,
        invoiceNumber
      }
    });

    return {
      sequenceNumber: nextNumber,
      invoiceNumber,
      financialYear,
      shortFinancialYear,
      seriesPrefix,
      scope
    };
  }

  /**
   * Helper to execute standalone sequence allocation inside an isolated Prisma transaction.
   *
   * WARNING: DO NOT USE IN PRODUCTION INVOICE ISSUANCE FLOWS.
   * Committing a sequence number in an isolated transaction before invoice insertion
   * creates an unrecoverable sequence gap if invoice persistence subsequently fails.
   * Production issuance flows must invoke allocateNextNumber(tx, options) using the
   * shared invoice issuance transaction client.
   */
  public static async allocateStandalone(
    options: AllocateSequenceOptions = {}
  ): Promise<AllocatedInvoiceSequence> {
    return await prisma.$transaction(
      async (tx) => {
        return await this.allocateNextNumber(tx, options);
      },
      { maxWait: 10000, timeout: 20000 }
    );
  }
}
