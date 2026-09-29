import crypto from 'node:crypto';
import { AdminAuditAction, Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { AdminAuditSanitizer } from './admin_audit_sanitizer.js';
import { ValidationError } from '../../errors/app-error.js';

export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';
export const MAX_EXPORT_LIMIT = 5000;
export const MAX_QUERY_LIMIT = 100;

export interface LogAuditParams {
  adminId?: string | null;
  action: AdminAuditAction;
  status?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
  skipIntegrityChain?: boolean;
}

export interface AuditQueryFilters {
  startDate?: string;
  endDate?: string;
  adminId?: string;
  action?: AdminAuditAction;
  status?: string;
  ipAddress?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface AuditIntegrityVerificationResult {
  isValid: boolean;
  totalRecords: number;
  verifiedRecords: number;
  genesisRecords: number;
  errors: string[];
}

export class AdminAuditService {
  /**
   * Deterministically serializes an object with sorted keys to guarantee
   * identical canonical JSON across in-memory objects and database-retrieved JSON.
   */
  static deterministicStringify(obj: unknown): string {
    if (obj === null || obj === undefined) return '{}';
    if (typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) {
      return '[' + obj.map(item => this.deterministicStringify(item)).join(',') + ']';
    }
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    const pairs = keys.map(k => `${JSON.stringify(k)}:${this.deterministicStringify((obj as Record<string, unknown>)[k])}`);
    return '{' + pairs.join(',') + '}';
  }

  /**
   * Computes the deterministic canonical representation of an audit record
   */
  static computeCanonicalString(params: {
    id: string;
    adminId: string | null;
    action: string;
    status: string;
    createdAtIso: string;
    ipAddress: string | null;
    metadataJson: string;
  }): string {
    return [
      params.id,
      params.adminId || '',
      params.action,
      params.status,
      params.createdAtIso,
      params.ipAddress || '',
      params.metadataJson
    ].join('|');
  }

  /**
   * Computes the SHA-256 integrity hash given the previous hash and canonical payload
   */
  static computeIntegrityHash(previousHash: string, canonicalString: string): string {
    return crypto
      .createHash('sha256')
      .update(`${previousHash}:${canonicalString}`)
      .digest('hex');
  }

  private static writeMutex: Promise<void> = Promise.resolve();

  /**
   * Records an administrative audit event with cryptographic tamper-evident chaining.
   * Atomic and concurrency-safe via database transaction and in-process mutex queue.
   */
  static async logEvent(params: LogAuditParams): Promise<any> {
    let releaseLock: () => void;
    const nextLock = new Promise<void>((resolve) => { releaseLock = resolve; });
    const currentLock = this.writeMutex;
    this.writeMutex = nextLock;
    await currentLock;

    try {
      const { adminId, action, status = 'SUCCESS', ipAddress, userAgent, metadata } = params;

      const sanitizedMetadata = AdminAuditSanitizer.sanitizeMetadata(metadata);
      const sanitizedIp = ipAddress ? AdminAuditSanitizer.sanitizeString(ipAddress) : null;
      const sanitizedUserAgent = userAgent ? AdminAuditSanitizer.sanitizeString(userAgent).substring(0, 512) : null;

      const id = crypto.randomUUID();
      const createdAt = new Date();
      const createdAtIso = createdAt.toISOString();
      const metadataJson = this.deterministicStringify(sanitizedMetadata);

      return await prisma.$transaction(async (tx) => {
        // Distributed Lock via MySQL named lock for cross-instance / multi-process serialization
        await tx.$queryRaw`SELECT GET_LOCK('zdex_admin_audit_chain_lock', 15) as lock_acquired`;

        try {
          // Find the most recent audit record in the active chain with row-level lock
          const latestRows = await tx.$queryRaw<Array<{ integrityHash: string | null; sequence: number | null }>>`
            SELECT integrityHash, sequence 
            FROM admin_audit_logs 
            WHERE integrityHash IS NOT NULL 
            ORDER BY sequence DESC, createdAt DESC, id DESC 
            LIMIT 1 
            FOR UPDATE
          `;

          const latest = latestRows[0];
          const previousHash = latest?.integrityHash || GENESIS_HASH;
          const sequence = (latest?.sequence || 0) + 1;

          const canonical = this.computeCanonicalString({
            id,
            adminId: adminId || null,
            action,
            status,
            createdAtIso,
            ipAddress: sanitizedIp,
            metadataJson
          });

          const integrityHash = this.computeIntegrityHash(previousHash, canonical);

          return await tx.adminAuditLog.create({
            data: {
              id,
              adminId: adminId || null,
              action,
              status,
              ipAddress: sanitizedIp,
              userAgent: sanitizedUserAgent,
              metadata: (sanitizedMetadata || {}) as Prisma.InputJsonValue,
              previousHash,
              integrityHash,
              sequence,
              createdAt
            }
          });
        } finally {
          await tx.$queryRaw`SELECT RELEASE_LOCK('zdex_admin_audit_chain_lock') as lock_released`;
        }
      }, {
        timeout: 25000,
        maxWait: 20000,
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
      });
    } finally {
      releaseLock!();
    }
  }

  /**
   * Queries audit logs with filtering, pagination, and deterministic ordering.
   */
  static async queryAuditLogs(
    filters: AuditQueryFilters,
    actorAdminId?: string,
    ipAddress?: string
  ): Promise<{
    data: any[];
    pagination: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  }> {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(MAX_QUERY_LIMIT, Math.max(1, Number(filters.limit) || 25));
    const skip = (page - 1) * limit;

    const where: Prisma.AdminAuditLogWhereInput = {};

    if (filters.adminId) {
      where.adminId = filters.adminId.trim();
    }

    if (filters.action) {
      where.action = filters.action;
    }

    if (filters.status) {
      where.status = filters.status.trim();
    }

    if (filters.ipAddress) {
      where.ipAddress = { contains: filters.ipAddress.trim() };
    }

    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) {
        const start = new Date(filters.startDate);
        if (isNaN(start.getTime())) throw new ValidationError('Invalid startDate format');
        where.createdAt.gte = start;
      }
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        if (isNaN(end.getTime())) throw new ValidationError('Invalid endDate format');
        where.createdAt.lte = end;
      }
    }

    const total = await prisma.adminAuditLog.count({ where });
    const records = await prisma.adminAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        admin: {
          select: { id: true, email: true, name: true }
        }
      }
    });

    // Record audit access event (with recursion safety: do not log if action was ADMIN_AUDIT_QUERY)
    if (actorAdminId && filters.action !== AdminAuditAction.ADMIN_AUDIT_QUERY) {
      // Async logging to avoid blocking read path
      this.logEvent({
        adminId: actorAdminId,
        action: AdminAuditAction.ADMIN_AUDIT_QUERY,
        status: 'SUCCESS',
        ipAddress: ipAddress || null,
        metadata: {
          filters: {
            adminId: filters.adminId,
            action: filters.action,
            status: filters.status,
            page,
            limit
          },
          resultCount: records.length,
          total
        }
      }).catch(err => console.warn('[AdminAuditService] Audit query logging deferred:', err));
    }

    return {
      data: records.map(r => ({
        id: r.id,
        adminId: r.adminId,
        admin: r.admin ? { id: r.admin.id, email: r.admin.email, name: r.admin.name } : null,
        action: r.action,
        status: r.status,
        ipAddress: r.ipAddress,
        userAgent: r.userAgent,
        metadata: r.metadata,
        sequence: r.sequence,
        integrityHash: r.integrityHash,
        previousHash: r.previousHash,
        createdAt: r.createdAt.toISOString()
      })),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Generates a sanitized CSV or JSON export of administrative audit records.
   */
  static async exportAuditLogs(
    filters: AuditQueryFilters,
    format: 'csv' | 'json' = 'csv',
    actorAdminId?: string,
    ipAddress?: string
  ): Promise<{ content: string; contentType: string; filename: string; rowCount: number }> {
    const where: Prisma.AdminAuditLogWhereInput = {};

    if (filters.adminId) where.adminId = filters.adminId.trim();
    if (filters.action) where.action = filters.action;
    if (filters.status) where.status = filters.status.trim();
    if (filters.ipAddress) where.ipAddress = { contains: filters.ipAddress.trim() };

    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) where.createdAt.gte = new Date(filters.startDate);
      if (filters.endDate) where.createdAt.lte = new Date(filters.endDate);
    }

    const records = await prisma.adminAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: MAX_EXPORT_LIMIT,
      include: {
        admin: {
          select: { id: true, email: true, name: true }
        }
      }
    });

    let content = '';
    let contentType = '';
    const filename = `zdex-admin-audit-logs-${new Date().toISOString().slice(0, 10)}.${format}`;

    if (format === 'json') {
      contentType = 'application/json; charset=utf-8';
      content = JSON.stringify(
        records.map(r => ({
          id: r.id,
          sequence: r.sequence,
          timestamp: r.createdAt.toISOString(),
          adminId: r.adminId,
          adminEmail: r.admin?.email || null,
          adminName: r.admin?.name || null,
          action: r.action,
          status: r.status,
          ipAddress: r.ipAddress,
          userAgent: r.userAgent,
          metadata: r.metadata,
          integrityHash: r.integrityHash
        })),
        null,
        2
      );
    } else {
      contentType = 'text/csv; charset=utf-8';
      // CSV Formula Injection Sanitizer: Prepend quote if first char is =, +, -, @, or tab
      const escapeCsvField = (val: unknown): string => {
        if (val === null || val === undefined) return '';
        let str = typeof val === 'object' ? JSON.stringify(val) : String(val);
        str = str.replace(/"/g, '""');
        if (/^[=+\-@\t\r]/.test(str)) {
          str = `'${str}`;
        }
        return `"${str}"`;
      };

      const headers = ['ID', 'Sequence', 'Timestamp', 'Admin ID', 'Admin Email', 'Action', 'Status', 'IP Address', 'User Agent', 'Metadata', 'Integrity Hash'].map(escapeCsvField);
      const rows = records.map(r => [
        escapeCsvField(r.id),
        escapeCsvField(r.sequence),
        escapeCsvField(r.createdAt.toISOString()),
        escapeCsvField(r.adminId),
        escapeCsvField(r.admin?.email || ''),
        escapeCsvField(r.action),
        escapeCsvField(r.status),
        escapeCsvField(r.ipAddress),
        escapeCsvField(r.userAgent),
        escapeCsvField(r.metadata),
        escapeCsvField(r.integrityHash)
      ].join(','));

      content = [headers.join(','), ...rows].join('\r\n');
    }

    // Log export event
    if (actorAdminId) {
      this.logEvent({
        adminId: actorAdminId,
        action: AdminAuditAction.ADMIN_AUDIT_EXPORT,
        status: 'SUCCESS',
        ipAddress: ipAddress || null,
        metadata: {
          format,
          rowCount: records.length,
          filters: {
            adminId: filters.adminId,
            action: filters.action,
            status: filters.status
          }
        }
      }).catch(err => console.warn('[AdminAuditService] Audit export logging deferred:', err));
    }

    return {
      content,
      contentType,
      filename,
      rowCount: records.length
    };
  }

  /**
   * Verifies the cryptographic integrity of the entire audit chain from Genesis to present.
   * Detects modified record payloads, broken previousHash links, sequence gaps, and missing/deleted entries.
   */
  static async verifyIntegrity(
    actorAdminId?: string,
    ipAddress?: string,
    expectedTerminalState?: { sequence?: number; integrityHash?: string }
  ): Promise<AuditIntegrityVerificationResult> {
    const historicalCount = await prisma.adminAuditLog.count({ where: { integrityHash: null } });
    const records = await prisma.adminAuditLog.findMany({
      where: { integrityHash: { not: null } },
      orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
    });

    const errors: string[] = [];
    let verifiedCount = 0;
    let expectedPreviousHash = GENESIS_HASH;

    for (let i = 0; i < records.length; i++) {
      const record = records[i];

      // 1. Verify sequence monotonicity
      if (record.sequence !== undefined && record.sequence !== null && record.sequence !== i + 1) {
        errors.push(
          `Record [${record.id}] has unexpected sequence number. Expected: ${i + 1}, Found: ${record.sequence}`
        );
      }

      // 2. Verify previousHash link
      if (record.previousHash !== expectedPreviousHash) {
        errors.push(
          `Record [${record.id}] at sequence ${record.sequence || i + 1} has broken previousHash. Expected: ${expectedPreviousHash}, Found: ${record.previousHash}`
        );
      }

      // 3. Recompute integrity hash
      const canonical = this.computeCanonicalString({
        id: record.id,
        adminId: record.adminId,
        action: record.action,
        status: record.status,
        createdAtIso: record.createdAt.toISOString(),
        ipAddress: record.ipAddress,
        metadataJson: this.deterministicStringify(record.metadata)
      });

      const recomputedHash = this.computeIntegrityHash(record.previousHash || GENESIS_HASH, canonical);

      if (recomputedHash !== record.integrityHash) {
        errors.push(
          `Record [${record.id}] failed hash verification (TAMPER DETECTED). Expected: ${recomputedHash}, Found: ${record.integrityHash}`
        );
      } else {
        verifiedCount++;
      }

      expectedPreviousHash = record.integrityHash || GENESIS_HASH;
    }

    // 4. Verify terminal chain state if expected terminal state is provided (e.g. to detect deletion of terminal records)
    if (expectedTerminalState) {
      const latestRecord = records[records.length - 1];
      if (expectedTerminalState.sequence !== undefined) {
        const actualSeq = latestRecord?.sequence || 0;
        if (actualSeq !== expectedTerminalState.sequence) {
          errors.push(
            `Terminal chain state sequence mismatch (DELETION DETECTED). Expected terminal sequence: ${expectedTerminalState.sequence}, Found: ${actualSeq}`
          );
        }
      }
      if (expectedTerminalState.integrityHash !== undefined) {
        const actualHash = latestRecord?.integrityHash || null;
        if (actualHash !== expectedTerminalState.integrityHash) {
          errors.push(
            `Terminal chain state integrityHash mismatch (TAMPER/DELETION DETECTED). Expected terminal hash: ${expectedTerminalState.integrityHash}, Found: ${actualHash}`
          );
        }
      }
    }

    const isValid = errors.length === 0;

    if (actorAdminId) {
      this.logEvent({
        adminId: actorAdminId,
        action: AdminAuditAction.ADMIN_AUDIT_INTEGRITY_VERIFIED,
        status: isValid ? 'SUCCESS' : 'FAILED',
        ipAddress: ipAddress || null,
        metadata: {
          totalRecords: historicalCount + records.length,
          verifiedRecords: verifiedCount,
          isValid,
          errorCount: errors.length
        }
      }).catch(err => console.warn('[AdminAuditService] Integrity verification logging deferred:', err));
    }

    return {
      isValid,
      totalRecords: historicalCount + records.length,
      verifiedRecords: verifiedCount,
      genesisRecords: historicalCount,
      errors
    };
  }
}
