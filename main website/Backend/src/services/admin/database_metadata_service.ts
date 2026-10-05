/**
 * Database Metadata Service
 * Phase 15 Batch 15.1 & Batch 15.2 — Database Management Foundation & Professional Data Grid
 *
 * Provides safe, read-only introspection and metadata retrieval of the ZdexCloud application
 * database via MySQL information_schema and Prisma client. Implements table classification,
 * structural column inspection, relationship extraction, bounded read-only table previews,
 * and professional server-side paginated, sorted, searchable data grid querying.
 */

import { prisma } from '../../config/database.js';
import { getDestructiveTableClassification } from '../../utils/sql_safety_guard.js';
import { NotFoundError, ValidationError, ForbiddenError, ConflictError } from '../../errors/app-error.js';
import { AdminAuditService } from './admin_audit_service.js';
import { AdminAuditAction } from '@prisma/client';

export interface DatabaseOverview {
  databaseName: string;
  serverVersion: string;
  status: 'ONLINE' | 'DEGRADED';
  totalTables: number;
  visibleTables: number;
  totalEstimatedRows: number;
  totalDataSizeBytes: number;
  totalIndexSizeBytes: number;
  classificationCounts: {
    INTERNAL: number;
    PROTECTED: number;
    BUSINESS_SENSITIVE: number;
    NON_LEAF: number;
    APPROVED_LEAF: number;
    UNKNOWN: number;
  };
}

export interface TableSummary {
  tableName: string;
  displayName: string;
  tableType: string;
  engine: string;
  rowCountEstimate: number;
  columnCount: number;
  primaryKey: string[];
  classification: 'INTERNAL' | 'PROTECTED' | 'BUSINESS_SENSITIVE' | 'NON_LEAF' | 'APPROVED_LEAF' | 'UNKNOWN';
  dataSizeBytes: number;
  indexSizeBytes: number;
  createTime: string | null;
  updateTime: string | null;
}

export interface ColumnMetadata {
  name: string;
  ordinalPosition: number;
  dataType: string;
  columnType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  isAutoIncrement: boolean;
  isGenerated: boolean;
  isRequired: boolean;
  isInsertable: boolean;
  isEditable?: boolean;
  isSensitive: boolean;
  columnDefault: string | null;
  extra: string | null;
  comment: string | null;
  enumValues?: string[];
  characterMaximumLength?: number | null;
  numericPrecision?: number | null;
  numericScale?: number | null;
}

export interface IndexMetadata {
  name: string;
  isUnique: boolean;
  columns: string[];
  type: string;
}

export interface ForeignKeyMetadata {
  constraintName: string;
  columnName: string;
  referencedTable: string;
  referencedColumn: string;
}

export interface TableInsertPolicy {
  allowed: boolean;
  reason: string;
}

export const INSERT_POLICY_REGISTRY: Record<string, TableInsertPolicy> = {
  support_case_notes: {
    allowed: true,
    reason: 'Internal administrative support case notes creation'
  },
  error_occurrences: {
    allowed: true,
    reason: 'Manual recording of operational error telemetry'
  },
  email_delivery_attempts: {
    allowed: true,
    reason: 'Manual recording of email delivery attempt log'
  },
  device_connections: {
    allowed: true,
    reason: 'Manual recording of device connection lifecycle event'
  },
  device_push_tokens: {
    allowed: true,
    reason: 'Registration of device push notification tokens'
  },
  server_endpoints: {
    allowed: true,
    reason: 'Server instance subdomain endpoint mapping allocation'
  }
};

export interface TableUpdatePolicy {
  allowed: boolean;
  reason: string;
  allowedEditableColumns: string[];
  protectedColumns: string[];
  concurrencyField?: string;
}

export const UPDATE_POLICY_REGISTRY: Record<string, TableUpdatePolicy> = {
  support_case_notes: {
    allowed: true,
    reason: 'Internal administrative support case notes modification',
    allowedEditableColumns: ['note', 'isInternal'],
    protectedColumns: ['id', 'caseId', 'authorId', 'createdAt', 'updatedAt'],
    concurrencyField: 'updatedAt'
  },
  error_occurrences: {
    allowed: true,
    reason: 'Operational error occurrence metadata and diagnostics adjustment',
    allowedEditableColumns: ['message', 'stackTrace', 'metadata'],
    protectedColumns: ['id', 'fingerprintId', 'incidentId', 'occurredAt', 'component', 'severity', 'errorCode', 'errorType', 'httpMethod', 'httpPath', 'httpStatus', 'requestId', 'userId', 'deviceId', 'serverInstanceId', 'gatewayNodeId', 'connectionId', 'sessionId', 'createdAt'],
    concurrencyField: 'createdAt'
  },
  email_delivery_attempts: {
    allowed: true,
    reason: 'Email delivery attempt notes and diagnostics adjustment',
    allowedEditableColumns: ['providerResponse', 'failureReason'],
    protectedColumns: ['id', 'emailMessageId', 'attemptNumber', 'providerMessageId', 'attemptedAt', 'createdAt'],
    concurrencyField: 'attemptedAt'
  },
  device_connections: {
    allowed: true,
    reason: 'Manual update of edge device connection endpoint or status',
    allowedEditableColumns: ['remoteEndpoint', 'status'],
    protectedColumns: ['id', 'deviceId', 'gatewayNodeId', 'connectionToken', 'connectedAt', 'disconnectedAt', 'lastHeartbeatAt', 'createdAt', 'updatedAt'],
    concurrencyField: 'updatedAt'
  },
  device_push_tokens: {
    allowed: true,
    reason: 'Administrative update of device push notification token state',
    allowedEditableColumns: ['isActive', 'appVersion', 'platform'],
    protectedColumns: ['id', 'userId', 'deviceId', 'token', 'lastSeenAt', 'revokedAt', 'createdAt', 'updatedAt'],
    concurrencyField: 'updatedAt'
  },
  server_endpoints: {
    allowed: true,
    reason: 'Server endpoint routing hostname or status update',
    allowedEditableColumns: ['hostname', 'status'],
    protectedColumns: ['id', 'serverInstanceId', 'createdAt', 'updatedAt'],
    concurrencyField: 'updatedAt'
  }
};

export interface TableDeletePolicy {
  allowed: boolean;
  reason: string;
  maxRows: number;
}

export const DELETE_POLICY_REGISTRY: Record<string, TableDeletePolicy> = {
  support_case_notes: {
    allowed: true,
    reason: 'Internal administrative support case note deletion',
    maxRows: 50
  },
  error_occurrences: {
    allowed: true,
    reason: 'Operational error occurrence telemetry log pruning',
    maxRows: 50
  },
  email_delivery_attempts: {
    allowed: true,
    reason: 'Email delivery attempt log record cleanup',
    maxRows: 50
  },
  device_connections: {
    allowed: true,
    reason: 'Historical device gateway connection record deletion',
    maxRows: 50
  },
  device_push_tokens: {
    allowed: true,
    reason: 'Deactivated device push notification token cleanup',
    maxRows: 50
  },
  server_endpoints: {
    allowed: true,
    reason: 'Stale server endpoint mapping deletion',
    maxRows: 50
  }
};

export interface InsertTableRowParams {
  adminId: string;
  tableName: string;
  values: Record<string, any>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface InsertTableRowResult {
  tableName: string;
  affectedRows: number;
  primaryKey: Record<string, any> | null;
  insertedRow: Record<string, any>;
}

export interface UpdateTableRowParams {
  adminId: string;
  tableName: string;
  primaryKey: Record<string, any>;
  values: Record<string, any>;
  concurrencyValue?: string | number | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface UpdateTableRowResult {
  tableName: string;
  affectedRows: number;
  primaryKey: Record<string, any>;
  updatedRow: Record<string, any>;
  changedColumns: string[];
}

export interface DeleteTableRowParams {
  adminId: string;
  tableName: string;
  primaryKey: Record<string, any>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface DeleteTableRowResult {
  tableName: string;
  affectedRows: number;
  primaryKey: Record<string, any>;
  deletedRowSummary?: Record<string, any>;
}

export interface BulkDeleteTableRowsParams {
  adminId: string;
  tableName: string;
  rows: Record<string, any>[];
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface BulkDeleteTableRowsResult {
  tableName: string;
  affectedRows: number;
  deletedCount: number;
  primaryKeys: Record<string, any>[];
}

export interface TableDetails {
  tableName: string;
  displayName: string;
  classification: 'INTERNAL' | 'PROTECTED' | 'BUSINESS_SENSITIVE' | 'NON_LEAF' | 'APPROVED_LEAF' | 'UNKNOWN';
  tableType: string;
  engine: string;
  rowCountEstimate: number;
  exactRowCount: number | null;
  dataSizeBytes: number;
  indexSizeBytes: number;
  primaryKeys: string[];
  columns: ColumnMetadata[];
  indexes: IndexMetadata[];
  foreignKeys: ForeignKeyMetadata[];
  incomingForeignKeyCount: number;
  insertCapability: {
    isInsertable: boolean;
    reason: string;
  };
  updateCapability: {
    isUpdatable: boolean;
    reason: string;
    allowedEditableColumns: string[];
    protectedColumns: string[];
    concurrencyField?: string | null;
  };
  deleteCapability: {
    isDeletable: boolean;
    reason: string;
    maxRows: number;
  };
}


export interface TablePreviewResult {
  tableName: string;
  columns: string[];
  rows: Record<string, any>[];
  limit: number;
  offset: number;
  returnedCount: number;
  totalEstimatedRows: number;
  truncated: boolean;
}

export function escapeLikeWildcards(str: string): string {
  return str.replace(/([\\%_])/g, '\\$1');
}

export type TableFilterOperator =
  | 'contains' | 'notContains' | 'not_contains'
  | 'equals' | 'notEquals' | 'not_equals'
  | 'startsWith' | 'starts_with'
  | 'endsWith' | 'ends_with'
  | 'isEmpty' | 'is_empty'
  | 'isNotEmpty' | 'is_not_empty'
  | 'greaterThan' | 'gt'
  | 'greaterThanOrEqual' | 'gte'
  | 'lessThan' | 'lt'
  | 'lessThanOrEqual' | 'lte'
  | 'between'
  | 'before'
  | 'after'
  | 'isTrue' | 'is_true'
  | 'isFalse' | 'is_false'
  | 'isNull' | 'is_null'
  | 'isNotNull' | 'is_not_null';

export interface TableFilterRule {
  column: string;
  operator: TableFilterOperator | string;
  value?: any;
  value2?: any;
}

export interface GetTableRowsOptions {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  search?: string;
  filters?: TableFilterRule[];
}

export interface TableRowsResult {
  tableName: string;
  displayName: string;
  classification: 'INTERNAL' | 'PROTECTED' | 'BUSINESS_SENSITIVE' | 'NON_LEAF' | 'APPROVED_LEAF' | 'UNKNOWN';
  primaryKeys: string[];
  columns: ColumnMetadata[];
  rows: Record<string, any>[];
  pagination: {
    page: number;
    pageSize: number;
    totalRows: number;
    totalMode: 'EXACT' | 'ESTIMATED' | 'UNKNOWN';
    totalPages: number;
  };
  sorting: {
    sortBy: string | null;
    sortDirection: 'asc' | 'desc';
    tieBreakers: string[];
  };
  search: {
    query: string | null;
    matchedColumns: string[];
  };
  filters: TableFilterRule[];
}

const SENSITIVE_COLUMN_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /hash/i,
  /private_key/i,
  /auth_key/i,
  /credential/i,
  /otp/i
];

function formatDisplayName(tableName: string): string {
  // Convert snake_case or existing PascalCase to human-readable title
  if (tableName.includes('_')) {
    return tableName
      .split('_')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ');
  }
  return tableName.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export class DatabaseMetadataService {
  /**
   * Validates table name against physical tables existing in current database schema.
   * Prevents SQL injection, path traversal, or unverified table access.
   */
  private static async getVerifiedTableNames(): Promise<Set<string>> {
    const rawTables = await prisma.$queryRawUnsafe<{ TABLE_NAME: string }[]>(
      `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()`
    );
    return new Set(rawTables.map(r => r.TABLE_NAME));
  }

  /**
   * Retrieves high-level database overview metrics and table classifications.
   */
  static async getDatabaseOverview(): Promise<DatabaseOverview> {
    const dbInfoRaw = await prisma.$queryRawUnsafe<{ db_name: string; version: string }[]>(
      `SELECT DATABASE() as db_name, VERSION() as version`
    );

    const databaseName = dbInfoRaw[0]?.db_name || 'zdexcloud';
    const serverVersion = dbInfoRaw[0]?.version || 'MySQL 8.0';

    const tablesRaw = await prisma.$queryRawUnsafe<any[]>(
      `SELECT 
        TABLE_NAME as tableName, 
        TABLE_TYPE as tableType, 
        ENGINE as engine, 
        TABLE_ROWS as tableRows, 
        DATA_LENGTH as dataLength, 
        INDEX_LENGTH as indexLength 
       FROM information_schema.TABLES 
       WHERE TABLE_SCHEMA = DATABASE() 
       ORDER BY TABLE_NAME ASC`
    );

    let totalEstimatedRows = 0;
    let totalDataSizeBytes = 0;
    let totalIndexSizeBytes = 0;

    const classificationCounts = {
      INTERNAL: 0,
      PROTECTED: 0,
      BUSINESS_SENSITIVE: 0,
      NON_LEAF: 0,
      APPROVED_LEAF: 0,
      UNKNOWN: 0
    };

    for (const table of tablesRaw) {
      const rows = Number(table.tableRows || 0);
      const dataLen = Number(table.dataLength || 0);
      const idxLen = Number(table.indexLength || 0);

      totalEstimatedRows += rows >= 0 ? rows : 0;
      totalDataSizeBytes += dataLen >= 0 ? dataLen : 0;
      totalIndexSizeBytes += idxLen >= 0 ? idxLen : 0;

      const classification = getDestructiveTableClassification(table.tableName).classification;
      if (classification in classificationCounts) {
        classificationCounts[classification as keyof typeof classificationCounts]++;
      } else {
        classificationCounts.UNKNOWN++;
      }
    }

    return {
      databaseName,
      serverVersion,
      status: 'ONLINE',
      totalTables: tablesRaw.length,
      visibleTables: tablesRaw.length,
      totalEstimatedRows,
      totalDataSizeBytes,
      totalIndexSizeBytes,
      classificationCounts
    };
  }

  /**
   * Discovers and lists all physical tables with structural summaries, row estimates, PKs, and classifications.
   */
  static async getTableList(): Promise<TableSummary[]> {
    const tablesRaw = await prisma.$queryRawUnsafe<any[]>(
      `SELECT 
        t.TABLE_NAME as tableName,
        t.TABLE_TYPE as tableType,
        IFNULL(t.ENGINE, 'InnoDB') as engine,
        IFNULL(t.TABLE_ROWS, 0) as rowCountEstimate,
        IFNULL(t.DATA_LENGTH, 0) as dataSizeBytes,
        IFNULL(t.INDEX_LENGTH, 0) as indexSizeBytes,
        t.CREATE_TIME as createTime,
        t.UPDATE_TIME as updateTime,
        (SELECT COUNT(*) FROM information_schema.COLUMNS c 
         WHERE c.TABLE_SCHEMA = DATABASE() AND c.TABLE_NAME = t.TABLE_NAME) as columnCount
       FROM information_schema.TABLES t
       WHERE t.TABLE_SCHEMA = DATABASE()
       ORDER BY t.TABLE_NAME ASC`
    );

    const pkRaw = await prisma.$queryRawUnsafe<any[]>(
      `SELECT TABLE_NAME as tableName, COLUMN_NAME as columnName
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'PRIMARY'
       ORDER BY TABLE_NAME, ORDINAL_POSITION`
    );

    const pkMap = new Map<string, string[]>();
    for (const pk of pkRaw) {
      if (!pkMap.has(pk.tableName)) {
        pkMap.set(pk.tableName, []);
      }
      pkMap.get(pk.tableName)!.push(pk.columnName);
    }

    return tablesRaw.map(t => {
      const rawClassification = getDestructiveTableClassification(t.tableName).classification;
      return {
        tableName: t.tableName,
        displayName: formatDisplayName(t.tableName),
        tableType: t.tableType || 'BASE TABLE',
        engine: t.engine,
        rowCountEstimate: Number(t.rowCountEstimate || 0),
        columnCount: Number(t.columnCount || 0),
        primaryKey: pkMap.get(t.tableName) || [],
        classification: rawClassification,
        dataSizeBytes: Number(t.dataSizeBytes || 0),
        indexSizeBytes: Number(t.indexSizeBytes || 0),
        createTime: t.createTime ? new Date(t.createTime).toISOString() : null,
        updateTime: t.updateTime ? new Date(t.updateTime).toISOString() : null
      };
    });
  }

  /**
   * Retrieves comprehensive table details, column definitions, index structures, foreign key constraints,
   * and topology relations for a specific table.
   */
  static async getTableDetails(tableName: string): Promise<TableDetails> {
    const verifiedTables = await this.getVerifiedTableNames();
    if (!verifiedTables.has(tableName)) {
      throw new NotFoundError(`Table '${tableName}' was not found in the database schema`);
    }

    const tableInfoRaw = await prisma.$queryRawUnsafe<any[]>(
      `SELECT 
        TABLE_NAME as tableName,
        TABLE_TYPE as tableType,
        IFNULL(ENGINE, 'InnoDB') as engine,
        IFNULL(TABLE_ROWS, 0) as rowCountEstimate,
        IFNULL(DATA_LENGTH, 0) as dataSizeBytes,
        IFNULL(INDEX_LENGTH, 0) as indexSizeBytes
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      tableName
    );

    const tableInfo = tableInfoRaw[0];

    // Fetch column definitions
    const columnsRaw = await prisma.$queryRawUnsafe<any[]>(
      `SELECT 
        COLUMN_NAME as columnName,
        ORDINAL_POSITION as ordinalPosition,
        COLUMN_DEFAULT as columnDefault,
        IS_NULLABLE as isNullable,
        DATA_TYPE as dataType,
        COLUMN_TYPE as columnType,
        COLUMN_KEY as columnKey,
        EXTRA as extra,
        COLUMN_COMMENT as comment,
        CHARACTER_MAXIMUM_LENGTH as characterMaximumLength,
        NUMERIC_PRECISION as numericPrecision,
        NUMERIC_SCALE as numericScale
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION ASC`,
      tableName
    );

    const insertPolicy = INSERT_POLICY_REGISTRY[tableName];
    const isInsertable = insertPolicy ? insertPolicy.allowed : false;
    const insertReason = insertPolicy ? insertPolicy.reason : 'Table is not in authorized insert policy registry';

    const updatePolicy = UPDATE_POLICY_REGISTRY[tableName];
    const isUpdatable = updatePolicy ? updatePolicy.allowed : false;
    const updateReason = updatePolicy ? updatePolicy.reason : 'Table is not in authorized update policy registry';
    const allowedEditableColumns = updatePolicy ? updatePolicy.allowedEditableColumns : [];
    const protectedColumns = updatePolicy ? updatePolicy.protectedColumns : [];
    const concurrencyField = updatePolicy ? (updatePolicy.concurrencyField || null) : null;

    const columns: ColumnMetadata[] = columnsRaw.map(c => {
      const extraStr = (c.extra || '').toLowerCase();
      const isAutoIncrement = extraStr.includes('auto_increment');
      const isGenerated = extraStr.includes('generated') || extraStr.includes('virtual') || extraStr.includes('stored');
      const isSensitive = SENSITIVE_COLUMN_PATTERNS.some(pat => pat.test(c.columnName));
      const isNullable = c.isNullable === 'YES';
      const hasDefault = c.columnDefault !== null;
      const isInsertable = !isAutoIncrement && !isGenerated && !isSensitive;
      const isRequired = !isNullable && !hasDefault && !isAutoIncrement && !isGenerated && !isSensitive;
      const isEditable = isUpdatable && allowedEditableColumns.includes(c.columnName) && !isAutoIncrement && !isGenerated && !isSensitive && c.columnKey !== 'PRI';

      let enumValues: string[] | undefined = undefined;
      if (c.dataType && c.dataType.toLowerCase() === 'enum' && c.columnType) {
        const match = String(c.columnType).match(/^enum\((.+)\)$/i);
        if (match && match[1]) {
          enumValues = match[1].split(',').map((s: string) => s.trim().replace(/^['"]|['"]$/g, ''));
        }
      }

      return {
        name: c.columnName,
        ordinalPosition: Number(c.ordinalPosition),
        dataType: c.dataType,
        columnType: c.columnType,
        isNullable,
        isPrimaryKey: c.columnKey === 'PRI',
        isAutoIncrement,
        isGenerated,
        isRequired,
        isInsertable,
        isEditable,
        isSensitive,
        columnDefault: c.columnDefault,
        extra: c.extra || null,
        comment: c.comment || null,
        enumValues,
        characterMaximumLength: c.characterMaximumLength !== null && c.characterMaximumLength !== undefined ? Number(c.characterMaximumLength) : null,
        numericPrecision: c.numericPrecision !== null && c.numericPrecision !== undefined ? Number(c.numericPrecision) : null,
        numericScale: c.numericScale !== null && c.numericScale !== undefined ? Number(c.numericScale) : null
      };
    });

    // Fetch indexes
    const indexesRaw = await prisma.$queryRawUnsafe<any[]>(
      `SELECT 
        INDEX_NAME as indexName,
        NON_UNIQUE as nonUnique,
        COLUMN_NAME as columnName,
        SEQ_IN_INDEX as seqInIndex,
        INDEX_TYPE as indexType
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
       ORDER BY INDEX_NAME, SEQ_IN_INDEX ASC`,
      tableName
    );

    const indexMap = new Map<string, { name: string; isUnique: boolean; columns: string[]; type: string }>();
    for (const idx of indexesRaw) {
      if (!indexMap.has(idx.indexName)) {
        indexMap.set(idx.indexName, {
          name: idx.indexName,
          isUnique: Number(idx.nonUnique) === 0,
          columns: [],
          type: idx.indexType || 'BTREE'
        });
      }
      indexMap.get(idx.indexName)!.columns.push(idx.columnName);
    }

    // Fetch outbound foreign keys
    const foreignKeysRaw = await prisma.$queryRawUnsafe<any[]>(
      `SELECT 
        CONSTRAINT_NAME as constraintName,
        COLUMN_NAME as columnName,
        REFERENCED_TABLE_NAME as referencedTable,
        REFERENCED_COLUMN_NAME as referencedColumn
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = DATABASE() 
         AND TABLE_NAME = ? 
         AND REFERENCED_TABLE_NAME IS NOT NULL
       ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION`,
      tableName
    );

    const foreignKeys: ForeignKeyMetadata[] = foreignKeysRaw.map(fk => ({
      constraintName: fk.constraintName,
      columnName: fk.columnName,
      referencedTable: fk.referencedTable,
      referencedColumn: fk.referencedColumn
    }));

    // Fetch incoming foreign key count (incoming references from other tables)
    const incomingFkRaw = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*) as incomingCount
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = DATABASE() 
         AND REFERENCED_TABLE_NAME = ?`,
      tableName
    );
    const incomingForeignKeyCount = Number(incomingFkRaw[0]?.incomingCount || 0);

    const primaryKeys = columns.filter(c => c.isPrimaryKey).map(c => c.name);
    const classificationMeta = getDestructiveTableClassification(tableName);

    // Exact row count for modest sized tables (< 100,000 estimated rows)
    let exactRowCount: number | null = null;
    const rowEstimate = Number(tableInfo?.rowCountEstimate || 0);
    if (rowEstimate < 100000 && /^[a-zA-Z0-9_]+$/.test(tableName)) {
      try {
        const countRaw = await prisma.$queryRawUnsafe<any[]>(
          `SELECT COUNT(*) as exactCount FROM \`${tableName}\``
        );
        if (countRaw && countRaw[0] && countRaw[0].exactCount !== undefined) {
          exactRowCount = Number(countRaw[0].exactCount);
        }
      } catch (_) {
        // Fallback gracefully to rowCountEstimate if counting fails or times out
      }
    }

    const deletePolicy = DELETE_POLICY_REGISTRY[tableName];
    const isDeletable = deletePolicy ? deletePolicy.allowed : false;
    const deleteReason = deletePolicy ? deletePolicy.reason : 'Table is not in authorized delete policy registry';
    const maxDeleteRows = deletePolicy ? (deletePolicy.maxRows || 50) : 50;

    return {
      tableName,
      displayName: formatDisplayName(tableName),
      classification: classificationMeta.classification,
      tableType: tableInfo?.tableType || 'BASE TABLE',
      engine: tableInfo?.engine || 'InnoDB',
      rowCountEstimate: rowEstimate,
      exactRowCount,
      dataSizeBytes: Number(tableInfo?.dataSizeBytes || 0),
      indexSizeBytes: Number(tableInfo?.indexSizeBytes || 0),
      primaryKeys,
      columns,
      indexes: Array.from(indexMap.values()),
      foreignKeys,
      incomingForeignKeyCount,
      insertCapability: {
        isInsertable,
        reason: insertReason
      },
      updateCapability: {
        isUpdatable,
        reason: updateReason,
        allowedEditableColumns,
        protectedColumns,
        concurrencyField
      },
      deleteCapability: {
        isDeletable: isDeletable && primaryKeys.length > 0,
        reason: primaryKeys.length === 0 ? 'Table has no primary key. Direct deletion is disabled.' : deleteReason,
        maxRows: maxDeleteRows
      }
    };

  }

  /**
   * Safely previews a bounded slice (max 50 rows) of table data.
   * Enforces strictly read-only execution, integer bounding, column extraction, and sensitive data masking.
   */
  static async getTablePreviewData(
    tableName: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<TablePreviewResult> {
    const verifiedTables = await this.getVerifiedTableNames();
    if (!verifiedTables.has(tableName)) {
      throw new NotFoundError(`Table '${tableName}' was not found in the database schema`);
    }

    if (!/^[a-zA-Z0-9_]+$/.test(tableName)) {
      throw new ValidationError(`Invalid table identifier format: '${tableName}'`);
    }

    const limit = Math.min(Math.max(1, Number(options.limit) || 50), 50);
    const offset = Math.max(0, Number(options.offset) || 0);

    // Fetch column names in schema order
    const columnsRaw = await prisma.$queryRawUnsafe<{ COLUMN_NAME: string }[]>(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION ASC`,
      tableName
    );
    const columnNames = columnsRaw.map(c => c.COLUMN_NAME);

    // Fetch row estimate
    const tableInfoRaw = await prisma.$queryRawUnsafe<{ TABLE_ROWS: number }[]>(
      `SELECT IFNULL(TABLE_ROWS, 0) as TABLE_ROWS FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      tableName
    );
    const totalEstimatedRows = Number(tableInfoRaw[0]?.TABLE_ROWS || 0);

    // Execute strictly bounded query with backtick-escaped verified table name
    const rawRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM \`${tableName}\` LIMIT ${limit} OFFSET ${offset}`
    );

    // Sanitize sensitive columns for safe preview
    const rows = rawRows.map(row => {
      const sanitizedRow: Record<string, any> = {};
      for (const col of columnNames) {
        let val = row[col];
        const isSensitive = SENSITIVE_COLUMN_PATTERNS.some(pat => pat.test(col));

        if (isSensitive && val !== null && val !== undefined) {
          sanitizedRow[col] = '[REDACTED]';
        } else if (typeof val === 'bigint') {
          sanitizedRow[col] = val.toString();
        } else if (val instanceof Date) {
          sanitizedRow[col] = val.toISOString();
        } else if (Buffer.isBuffer(val)) {
          sanitizedRow[col] = `[BINARY ${val.length} bytes]`;
        } else {
          sanitizedRow[col] = val;
        }
      }
      return sanitizedRow;
    });

    return {
      tableName,
      columns: columnNames,
      rows,
      limit,
      offset,
      returnedCount: rows.length,
      totalEstimatedRows,
      truncated: rows.length === limit
    };
  }

  /**
   * Phase 15 Batch 15.2: Professional Database Data Grid Querying
   *
   * Executes securely validated, server-side paginated, stably sorted, searchable, and filtered
   * table queries against the MySQL database.
   */
  static async getTableRows(
    tableName: string,
    options: GetTableRowsOptions = {}
  ): Promise<TableRowsResult> {
    const verifiedTables = await this.getVerifiedTableNames();
    if (!verifiedTables.has(tableName)) {
      throw new NotFoundError(`Table '${tableName}' was not found in the database schema`);
    }

    if (!/^[a-zA-Z0-9_]+$/.test(tableName)) {
      throw new ValidationError(`Invalid table identifier format: '${tableName}'`);
    }

    const tableDetails = await this.getTableDetails(tableName);
    const columnMap = new Map<string, ColumnMetadata>();
    for (const col of tableDetails.columns) {
      columnMap.set(col.name, col);
    }

    // 1. Pagination Normalization
    const page = Math.max(1, Number(options.page) || 1);
    const requestedPageSize = Number(options.pageSize) || 25;
    const pageSize = Math.min(Math.max(1, requestedPageSize), 100);
    const offset = (page - 1) * pageSize;

    // 2. Sorting Validation & Deterministic Tie-Breakers
    const sortDirection = (options.sortDirection || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
    let sortBy: string | null = null;
    const tieBreakers: string[] = [];

    if (options.sortBy) {
      const requestedSortBy = options.sortBy.trim();
      if (!columnMap.has(requestedSortBy)) {
        throw new ValidationError(`Sort column '${requestedSortBy}' does not exist on table '${tableName}'`);
      }
      sortBy = requestedSortBy;
    }

    // Tie-breaker assembly using primary key columns
    const pks = tableDetails.primaryKeys;
    if (sortBy) {
      for (const pk of pks) {
        if (pk !== sortBy) {
          tieBreakers.push(pk);
        }
      }
      if (tieBreakers.length === 0 && pks.length === 0 && columnMap.has('createdAt') && sortBy !== 'createdAt') {
        tieBreakers.push('createdAt');
      }
    } else {
      if (pks.length > 0) {
        sortBy = pks[0];
        for (let i = 1; i < pks.length; i++) {
          tieBreakers.push(pks[i]);
        }
      } else if (columnMap.has('createdAt')) {
        sortBy = 'createdAt';
      } else if (tableDetails.columns.length > 0) {
        sortBy = tableDetails.columns[0].name;
      }
    }

    const orderClauses: string[] = [];
    if (sortBy) {
      orderClauses.push(`\`${sortBy}\` ${sortDirection.toUpperCase()}`);
    }
    for (const tb of tieBreakers) {
      orderClauses.push(`\`${tb}\` ASC`);
    }
    const orderClause = orderClauses.length > 0 ? `ORDER BY ${orderClauses.join(', ')}` : '';

    // 3. Search Clause Construction
    const whereConditions: string[] = [];
    const queryParams: any[] = [];
    const matchedSearchColumns: string[] = [];

    if (options.search && typeof options.search === 'string' && options.search.trim().length > 0) {
      const searchVal = options.search.trim().substring(0, 256);
      const escapedSearch = escapeLikeWildcards(searchVal);
      const searchableColumns = tableDetails.columns.filter(col => {
        const isSensitive = SENSITIVE_COLUMN_PATTERNS.some(pat => pat.test(col.name));
        if (isSensitive) return false;
        const dt = col.dataType.toLowerCase();
        // Exclude binary, blob, bytea
        if (dt.includes('blob') || dt.includes('binary') || dt.includes('bytea')) return false;
        return dt.includes('char') || dt.includes('text') || dt.includes('enum') || dt.includes('json') || dt.includes('varchar');
      });

      if (searchableColumns.length > 0) {
        const searchSubClauses: string[] = [];
        for (const col of searchableColumns) {
          searchSubClauses.push(`\`${col.name}\` LIKE ?`);
          queryParams.push(`%${escapedSearch}%`);
          matchedSearchColumns.push(col.name);
        }
        whereConditions.push(`(${searchSubClauses.join(' OR ')})`);
      }
    }

    // 4. Column Filter Construction
    const appliedFilters: TableFilterRule[] = [];
    if (options.filters && Array.isArray(options.filters)) {
      const filterRules = options.filters.slice(0, 10); // Bound to maximum 10 filters
      for (const rule of filterRules) {
        if (!rule || typeof rule !== 'object') continue;
        const colName = (rule.column || '').trim();
        if (!columnMap.has(colName)) {
          throw new ValidationError(`Filter column '${colName}' does not exist on table '${tableName}'`);
        }

        const isSensitive = SENSITIVE_COLUMN_PATTERNS.some(pat => pat.test(colName));
        if (isSensitive) {
          throw new ValidationError(`Filtering on protected sensitive column '${colName}' is not permitted`);
        }

        const colMeta = columnMap.get(colName)!;
        const op = String(rule.operator || '').trim();
        const rawVal = rule.value;
        const rawVal2 = rule.value2;

        switch (op) {
          case 'contains': {
            const escaped = escapeLikeWildcards(String(rawVal ?? '').substring(0, 256));
            whereConditions.push(`\`${colName}\` LIKE ?`);
            queryParams.push(`%${escaped}%`);
            appliedFilters.push({ column: colName, operator: 'contains', value: rawVal });
            break;
          }
          case 'not_contains':
          case 'notContains': {
            const escaped = escapeLikeWildcards(String(rawVal ?? '').substring(0, 256));
            whereConditions.push(`(\`${colName}\` NOT LIKE ? OR \`${colName}\` IS NULL)`);
            queryParams.push(`%${escaped}%`);
            appliedFilters.push({ column: colName, operator: 'not_contains', value: rawVal });
            break;
          }
          case 'starts_with':
          case 'startsWith': {
            const escaped = escapeLikeWildcards(String(rawVal ?? '').substring(0, 256));
            whereConditions.push(`\`${colName}\` LIKE ?`);
            queryParams.push(`${escaped}%`);
            appliedFilters.push({ column: colName, operator: 'starts_with', value: rawVal });
            break;
          }
          case 'ends_with':
          case 'endsWith': {
            const escaped = escapeLikeWildcards(String(rawVal ?? '').substring(0, 256));
            whereConditions.push(`\`${colName}\` LIKE ?`);
            queryParams.push(`%${escaped}`);
            appliedFilters.push({ column: colName, operator: 'ends_with', value: rawVal });
            break;
          }
          case 'is_empty':
          case 'isEmpty': {
            whereConditions.push(`(\`${colName}\` = '' OR \`${colName}\` IS NULL)`);
            appliedFilters.push({ column: colName, operator: 'is_empty' });
            break;
          }
          case 'is_not_empty':
          case 'isNotEmpty': {
            whereConditions.push(`(\`${colName}\` != '' AND \`${colName}\` IS NOT NULL)`);
            appliedFilters.push({ column: colName, operator: 'is_not_empty' });
            break;
          }
          case 'equals': {
            whereConditions.push(`\`${colName}\` = ?`);
            queryParams.push(rawVal);
            appliedFilters.push({ column: colName, operator: 'equals', value: rawVal });
            break;
          }
          case 'not_equals':
          case 'notEquals': {
            whereConditions.push(`(\`${colName}\` != ? OR \`${colName}\` IS NULL)`);
            queryParams.push(rawVal);
            appliedFilters.push({ column: colName, operator: 'not_equals', value: rawVal });
            break;
          }
          case 'greaterThan':
          case 'gt': {
            whereConditions.push(`\`${colName}\` > ?`);
            queryParams.push(rawVal);
            appliedFilters.push({ column: colName, operator: 'greaterThan', value: rawVal });
            break;
          }
          case 'greaterThanOrEqual':
          case 'gte': {
            whereConditions.push(`\`${colName}\` >= ?`);
            queryParams.push(rawVal);
            appliedFilters.push({ column: colName, operator: 'greaterThanOrEqual', value: rawVal });
            break;
          }
          case 'lessThan':
          case 'lt': {
            whereConditions.push(`\`${colName}\` < ?`);
            queryParams.push(rawVal);
            appliedFilters.push({ column: colName, operator: 'lessThan', value: rawVal });
            break;
          }
          case 'lessThanOrEqual':
          case 'lte': {
            whereConditions.push(`\`${colName}\` <= ?`);
            queryParams.push(rawVal);
            appliedFilters.push({ column: colName, operator: 'lessThanOrEqual', value: rawVal });
            break;
          }
          case 'between': {
            let v1 = rawVal;
            let v2 = rawVal2;
            if (Array.isArray(rawVal) && rawVal.length >= 2) {
              v1 = rawVal[0];
              v2 = rawVal[1];
            }
            if (v1 === undefined || v2 === undefined || v1 === null || v2 === null) {
              throw new ValidationError(`Operator 'between' for column '${colName}' requires both start and end boundary values`);
            }
            whereConditions.push(`\`${colName}\` BETWEEN ? AND ?`);
            queryParams.push(v1, v2);
            appliedFilters.push({ column: colName, operator: 'between', value: v1, value2: v2 });
            break;
          }
          case 'before': {
            whereConditions.push(`\`${colName}\` < ?`);
            queryParams.push(rawVal);
            appliedFilters.push({ column: colName, operator: 'before', value: rawVal });
            break;
          }
          case 'after': {
            whereConditions.push(`\`${colName}\` > ?`);
            queryParams.push(rawVal);
            appliedFilters.push({ column: colName, operator: 'after', value: rawVal });
            break;
          }
          case 'is_true':
          case 'isTrue': {
            whereConditions.push(`(\`${colName}\` = 1 OR \`${colName}\` = TRUE)`);
            appliedFilters.push({ column: colName, operator: 'is_true' });
            break;
          }
          case 'is_false':
          case 'isFalse': {
            whereConditions.push(`(\`${colName}\` = 0 OR \`${colName}\` = FALSE)`);
            appliedFilters.push({ column: colName, operator: 'is_false' });
            break;
          }
          case 'is_null':
          case 'isNull': {
            whereConditions.push(`\`${colName}\` IS NULL`);
            appliedFilters.push({ column: colName, operator: 'isNull' });
            break;
          }
          case 'is_not_null':
          case 'isNotNull': {
            whereConditions.push(`\`${colName}\` IS NOT NULL`);
            appliedFilters.push({ column: colName, operator: 'isNotNull' });
            break;
          }
          default:
            throw new ValidationError(`Unsupported filter operator: '${op}'`);
        }
      }
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // 5. Total Row Count Calculation
    let totalRows = 0;
    let totalMode: 'EXACT' | 'ESTIMATED' | 'UNKNOWN' = 'ESTIMATED';

    if (whereConditions.length > 0) {
      // Filtered count query with same parameterized WHERE clauses
      const countSql = `SELECT COUNT(*) as cnt FROM \`${tableName}\` ${whereClause}`;
      const countResult = await prisma.$queryRawUnsafe<any[]>(countSql, ...queryParams);
      totalRows = Number(countResult[0]?.cnt || 0);
      totalMode = 'EXACT';
    } else {
      if (tableDetails.exactRowCount !== null) {
        totalRows = tableDetails.exactRowCount;
        totalMode = 'EXACT';
      } else {
        totalRows = tableDetails.rowCountEstimate;
        totalMode = 'ESTIMATED';
      }
    }

    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));

    // 6. Data Retrieval Query Execution
    const dataSql = `SELECT * FROM \`${tableName}\` ${whereClause} ${orderClause} LIMIT ${pageSize} OFFSET ${offset}`;
    const rawRows = await prisma.$queryRawUnsafe<any[]>(dataSql, ...queryParams);

    // 7. Type-Safe Sanitization and Sensitive Redaction
    const columnNames = tableDetails.columns.map(c => c.name);
    const rows = rawRows.map(row => {
      const sanitizedRow: Record<string, any> = {};
      for (const col of columnNames) {
        let val = row[col];
        const isSensitive = SENSITIVE_COLUMN_PATTERNS.some(pat => pat.test(col));

        if (isSensitive && val !== null && val !== undefined) {
          sanitizedRow[col] = '[REDACTED]';
        } else if (typeof val === 'bigint') {
          sanitizedRow[col] = val.toString();
        } else if (val instanceof Date) {
          sanitizedRow[col] = val.toISOString();
        } else if (Buffer.isBuffer(val)) {
          sanitizedRow[col] = `[BINARY ${val.length} bytes]`;
        } else {
          sanitizedRow[col] = val;
        }
      }
      return sanitizedRow;
    });

    return {
      tableName,
      displayName: tableDetails.displayName,
      classification: tableDetails.classification,
      primaryKeys: tableDetails.primaryKeys,
      columns: tableDetails.columns,
      rows,
      pagination: {
        page,
        pageSize,
        totalRows,
        totalMode,
        totalPages
      },
      sorting: {
        sortBy,
        sortDirection,
        tieBreakers
      },
      search: {
        query: options.search ? options.search.trim() : null,
        matchedColumns: matchedSearchColumns
      },
      filters: appliedFilters
    };
  }

  /**
   * Phase 15 Batch 15.4: Add / Insert Single Database Record
   *
   * Executes securely validated, parameter-bound, metadata-verified single row INSERT
   * within a database transaction, followed by tamper-evident cryptographic audit logging.
   */
  static async insertTableRow(params: InsertTableRowParams): Promise<InsertTableRowResult> {
    const { adminId, tableName, values, ipAddress, userAgent } = params;

    if (!tableName || !/^[a-zA-Z0-9_]+$/.test(tableName)) {
      throw new ValidationError(`Invalid table identifier format: '${tableName}'`);
    }

    const verifiedTables = await this.getVerifiedTableNames();
    if (!verifiedTables.has(tableName)) {
      throw new NotFoundError(`Table '${tableName}' was not found in the database schema`);
    }

    // 1. Authoritative Backend Policy Check
    const policy = INSERT_POLICY_REGISTRY[tableName];
    if (!policy || !policy.allowed) {
      const classification = getDestructiveTableClassification(tableName).classification;
      throw new ForbiddenError(
        `INSERT operation is not permitted on table '${tableName}' (Classification: ${classification}). ${policy?.reason || 'Table is not in authorized insert policy registry.'}`
      );
    }

    // 2. Fetch authoritative column metadata
    const tableDetails = await this.getTableDetails(tableName);
    const columnMap = new Map<string, ColumnMetadata>();
    for (const col of tableDetails.columns) {
      columnMap.set(col.name, col);
    }

    const submittedValues = values && typeof values === 'object' ? values : {};

    // 3. Reject unknown, protected, generated, or auto-increment columns
    for (const colName of Object.keys(submittedValues)) {
      const colMeta = columnMap.get(colName);
      if (!colMeta) {
        throw new ValidationError(`Unknown column '${colName}' on table '${tableName}'`);
      }
      if (colMeta.isSensitive) {
        throw new ValidationError(`Direct insert into sensitive column '${colName}' is prohibited`);
      }
      if (colMeta.isGenerated) {
        throw new ValidationError(`Cannot insert into generated column '${colName}'`);
      }
      if (colMeta.isAutoIncrement) {
        throw new ValidationError(`Cannot explicitly insert into auto-increment column '${colName}'`);
      }
    }

    // 4. Validate all required columns are provided
    for (const col of tableDetails.columns) {
      if (col.isRequired) {
        const val = submittedValues[col.name];
        if (val === undefined || val === null || (typeof val === 'string' && val.trim() === '')) {
          throw new ValidationError(`Field '${col.name}' is required and cannot be empty or null`);
        }
      }
    }

    // 5. Coerce, validate, and normalize submitted values
    const sanitizedValues: Record<string, any> = {};

    for (const [colName, rawVal] of Object.entries(submittedValues)) {
      const colMeta = columnMap.get(colName)!;

      // Handle explicit NULL
      if (rawVal === null || rawVal === undefined) {
        if (rawVal === null) {
          if (!colMeta.isNullable) {
            throw new ValidationError(`Column '${colName}' does not permit NULL values`);
          }
          sanitizedValues[colName] = null;
        }
        continue;
      }

      const dt = colMeta.dataType.toLowerCase();

      // String / Text Types
      if (dt.includes('char') || dt.includes('text')) {
        const strVal = String(rawVal);
        if (colMeta.characterMaximumLength && strVal.length > colMeta.characterMaximumLength) {
          throw new ValidationError(`Value for '${colName}' exceeds maximum length of ${colMeta.characterMaximumLength} characters`);
        }
        sanitizedValues[colName] = strVal;
      }
      // Enum Type
      else if (dt === 'enum') {
        const strVal = String(rawVal);
        if (colMeta.enumValues && !colMeta.enumValues.includes(strVal)) {
          throw new ValidationError(`Invalid value '${strVal}' for enum column '${colName}'. Allowed values: ${colMeta.enumValues.join(', ')}`);
        }
        sanitizedValues[colName] = strVal;
      }
      // JSON Type
      else if (dt === 'json') {
        if (typeof rawVal === 'object') {
          sanitizedValues[colName] = JSON.stringify(rawVal);
        } else {
          try {
            JSON.parse(String(rawVal));
            sanitizedValues[colName] = String(rawVal);
          } catch (_) {
            throw new ValidationError(`Invalid JSON syntax provided for column '${colName}'`);
          }
        }
      }
      // Integer Types
      else if (dt.includes('int')) {
        const strVal = String(rawVal).trim();
        if (!/^-?\d+$/.test(strVal)) {
          throw new ValidationError(`Column '${colName}' requires a valid integer`);
        }
        if (dt === 'bigint') {
          sanitizedValues[colName] = strVal; // String-preserved BIGINT
        } else {
          const num = Number(strVal);
          if (!Number.isSafeInteger(num)) {
            throw new ValidationError(`Column '${colName}' value exceeds safe integer range`);
          }
          sanitizedValues[colName] = num;
        }
      }
      // Decimal / Float / Double Types
      else if (dt.includes('decimal') || dt.includes('numeric') || dt.includes('float') || dt.includes('double')) {
        const strVal = String(rawVal).trim();
        if (isNaN(Number(strVal))) {
          throw new ValidationError(`Column '${colName}' requires a valid numeric value`);
        }
        sanitizedValues[colName] = strVal;
      }
      // Boolean / TinyInt(1) Types
      else if (dt.includes('bool') || colMeta.columnType.toLowerCase() === 'tinyint(1)') {
        sanitizedValues[colName] = (rawVal === true || rawVal === 'true' || rawVal === 1 || rawVal === '1') ? 1 : 0;
      }
      // Temporal Types
      else if (dt.includes('date') || dt.includes('time')) {
        const d = new Date(rawVal);
        if (isNaN(d.getTime())) {
          throw new ValidationError(`Invalid date/time format for column '${colName}'`);
        }
        if (dt === 'date') {
          sanitizedValues[colName] = d.toISOString().slice(0, 10);
        } else if (dt === 'time') {
          sanitizedValues[colName] = d.toISOString().slice(11, 19);
        } else {
          sanitizedValues[colName] = d.toISOString().slice(0, 19).replace('T', ' ');
        }
      }
      // Fallback
      else {
        sanitizedValues[colName] = rawVal;
      }
    }

    // 6. Assemble SQL and Parameters
    const insertCols = Object.keys(sanitizedValues);
    let sql: string;
    let queryParams: any[] = [];

    if (insertCols.length === 0) {
      sql = `INSERT INTO \`${tableName}\` () VALUES ()`;
    } else {
      const colList = insertCols.map(c => `\`${c}\``).join(', ');
      const placeholders = insertCols.map(() => '?').join(', ');
      sql = `INSERT INTO \`${tableName}\` (${colList}) VALUES (${placeholders})`;
      queryParams = insertCols.map(c => sanitizedValues[c]);
    }

    // 7. Transactional Execution & Affected-Row Verification
    let primaryKeyResult: Record<string, any> | null = null;
    let finalInsertedRow: Record<string, any> = {};

    try {
      await prisma.$transaction(async (tx) => {
        const affected = await tx.$executeRawUnsafe(sql, ...queryParams);
        if (affected !== 1) {
          throw new Error(`Expected exactly 1 inserted row, but database returned ${affected}`);
        }

        // Fetch generated auto-increment key if applicable
        const lastIdRows = await tx.$queryRawUnsafe<any[]>(`SELECT LAST_INSERT_ID() as lastId`);
        const lastId = lastIdRows[0]?.lastId;

        const pks = tableDetails.primaryKeys;
        if (pks.length === 1 && pks[0] && lastId && Number(lastId) > 0) {
          primaryKeyResult = { [pks[0]]: String(lastId) };
          const rows = await tx.$queryRawUnsafe<any[]>(`SELECT * FROM \`${tableName}\` WHERE \`${pks[0]}\` = ?`, lastId);
          if (rows[0]) {
            finalInsertedRow = rows[0];
          }
        } else if (pks.length > 0 && pks.every(k => sanitizedValues[k] !== undefined)) {
          primaryKeyResult = {};
          for (const pk of pks) {
            primaryKeyResult[pk] = String(sanitizedValues[pk]);
          }
          const wherePk = pks.map(k => `\`${k}\` = ?`).join(' AND ');
          const pkParams = pks.map(k => sanitizedValues[k]);
          const rows = await tx.$queryRawUnsafe<any[]>(`SELECT * FROM \`${tableName}\` WHERE ${wherePk}`, ...pkParams);
          if (rows[0]) {
            finalInsertedRow = rows[0];
          }
        } else {
          finalInsertedRow = { ...sanitizedValues };
        }
      });
    } catch (dbErr: any) {
      const msg = dbErr?.message || String(dbErr);
      const errCode = dbErr?.code || dbErr?.errno;

      if (errCode === 1062 || msg.includes('Duplicate entry') || msg.includes('Unique constraint')) {
        throw new ValidationError(`Unique constraint violation: Duplicate record already exists in '${tableName}'`);
      }
      if (errCode === 1452 || msg.includes('foreign key constraint fails')) {
        throw new ValidationError(`Foreign key constraint violation: The referenced entity does not exist`);
      }
      if (errCode === 1048 || msg.includes('cannot be null')) {
        throw new ValidationError(`Database constraint violation: A required field cannot be NULL`);
      }
      if (errCode === 1406 || msg.includes('Data too long')) {
        throw new ValidationError(`Database constraint violation: Submitted value exceeds column maximum capacity`);
      }
      if (errCode === 1265 || msg.includes('Data truncated')) {
        throw new ValidationError(`Database constraint violation: Data value or enum option is invalid for this column`);
      }
      throw new ValidationError(`Database insertion failed: ${msg}`);
    }

    // 8. Mask Sensitive Fields in the Returned Row
    const sanitizedReturnRow: Record<string, any> = {};
    for (const [k, v] of Object.entries(finalInsertedRow)) {
      if (SENSITIVE_COLUMN_PATTERNS.some(pat => pat.test(k))) {
        sanitizedReturnRow[k] = '[REDACTED]';
      } else if (typeof v === 'bigint') {
        sanitizedReturnRow[k] = v.toString();
      } else if (v instanceof Date) {
        sanitizedReturnRow[k] = v.toISOString();
      } else if (Buffer.isBuffer(v)) {
        sanitizedReturnRow[k] = `[BINARY ${v.length} bytes]`;
      } else {
        sanitizedReturnRow[k] = v;
      }
    }

    // 9. Tamper-Evident Cryptographic Audit Logging
    try {
      await AdminAuditService.logEvent({
        adminId,
        action: AdminAuditAction.ADMIN_STATUS_UPDATED,
        status: 'SUCCESS',
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        metadata: {
          operation: 'DATABASE_ROW_INSERT',
          table: tableName,
          affectedRows: 1,
          primaryKey: primaryKeyResult
        }
      });
    } catch (auditErr) {
      console.error('Failed to log admin audit event for database insert:', auditErr);
    }

    return {
      tableName,
      affectedRows: 1,
      primaryKey: primaryKeyResult,
      insertedRow: sanitizedReturnRow
    };
  }

  /**
   * Phase 15 Batch 15.5: Edit / Update Single Database Record
   *
   * Executes securely validated, parameter-bound, metadata-verified single row UPDATE
   * within a database transaction with single-row guarantee, optimistic concurrency protection,
   * and tamper-evident cryptographic audit logging.
   */
  static async updateTableRow(params: UpdateTableRowParams): Promise<UpdateTableRowResult> {
    const { adminId, tableName, primaryKey, values, concurrencyValue, ipAddress, userAgent } = params;

    if (!tableName || !/^[a-zA-Z0-9_]+$/.test(tableName)) {
      throw new ValidationError(`Invalid table identifier format: '${tableName}'`);
    }

    const verifiedTables = await this.getVerifiedTableNames();
    if (!verifiedTables.has(tableName)) {
      throw new NotFoundError(`Table '${tableName}' was not found in the database schema`);
    }

    // 1. Authoritative Backend Policy Check
    const policy = UPDATE_POLICY_REGISTRY[tableName];
    if (!policy || !policy.allowed) {
      const classification = getDestructiveTableClassification(tableName).classification;
      throw new ForbiddenError(
        `UPDATE operation is not permitted on table '${tableName}' (Classification: ${classification}). ${policy?.reason || 'Table is not in authorized update policy registry.'}`
      );
    }

    // 2. Fetch authoritative table details
    const tableDetails = await this.getTableDetails(tableName);
    if (!tableDetails.primaryKeys || tableDetails.primaryKeys.length === 0) {
      throw new ValidationError(`Table '${tableName}' has no primary key. Direct row UPDATE is disabled to prevent ambiguous multi-row mutation.`);
    }

    // 3. Validate Primary Key Identifiers
    if (!primaryKey || typeof primaryKey !== 'object' || Array.isArray(primaryKey)) {
      throw new ValidationError('Primary key object is required to identify the target record');
    }

    const pkMap: Record<string, any> = {};
    for (const pkCol of tableDetails.primaryKeys) {
      const val = primaryKey[pkCol];
      if (val === undefined || val === null || (typeof val === 'string' && val.trim() === '')) {
        throw new ValidationError(`Missing or empty primary key value for column '${pkCol}'`);
      }
      pkMap[pkCol] = val;
    }

    // 4. Validate Submitted Columns against Editable Column Policy
    const columnMap = new Map<string, ColumnMetadata>();
    for (const col of tableDetails.columns) {
      columnMap.set(col.name, col);
    }

    const submittedValues = values && typeof values === 'object' ? values : {};
    const submittedColNames = Object.keys(submittedValues);

    if (submittedColNames.length === 0) {
      throw new ValidationError('No column values provided for update');
    }

    for (const colName of submittedColNames) {
      const colMeta = columnMap.get(colName);
      if (!colMeta) {
        throw new ValidationError(`Unknown column '${colName}' on table '${tableName}'`);
      }
      if (colMeta.isPrimaryKey || tableDetails.primaryKeys.includes(colName)) {
        throw new ValidationError(`Primary key column '${colName}' cannot be modified`);
      }
      if (colMeta.isSensitive) {
        throw new ValidationError(`Direct update to sensitive column '${colName}' is prohibited`);
      }
      if (colMeta.isGenerated) {
        throw new ValidationError(`Cannot update generated column '${colName}'`);
      }
      if (colMeta.isAutoIncrement) {
        throw new ValidationError(`Cannot update auto-increment column '${colName}'`);
      }
      if (!policy.allowedEditableColumns.includes(colName)) {
        throw new ValidationError(`Column '${colName}' is not in the allowed editable columns list for table '${tableName}'`);
      }
    }

    // 5. Coerce and Validate Submitted Values
    const sanitizedValues: Record<string, any> = {};

    for (const [colName, rawVal] of Object.entries(submittedValues)) {
      const colMeta = columnMap.get(colName)!;

      // Handle explicit NULL
      if (rawVal === null || rawVal === undefined) {
        if (rawVal === null) {
          if (!colMeta.isNullable) {
            throw new ValidationError(`Column '${colName}' does not permit NULL values`);
          }
          sanitizedValues[colName] = null;
        }
        continue;
      }

      const dt = colMeta.dataType.toLowerCase();

      // String / Text Types
      if (dt.includes('char') || dt.includes('text')) {
        const strVal = String(rawVal);
        if (colMeta.characterMaximumLength && strVal.length > colMeta.characterMaximumLength) {
          throw new ValidationError(`Value for '${colName}' exceeds maximum length of ${colMeta.characterMaximumLength} characters`);
        }
        sanitizedValues[colName] = strVal;
      }
      // Enum Type
      else if (dt === 'enum') {
        const strVal = String(rawVal);
        if (colMeta.enumValues && !colMeta.enumValues.includes(strVal)) {
          throw new ValidationError(`Invalid value '${strVal}' for enum column '${colName}'. Allowed values: ${colMeta.enumValues.join(', ')}`);
        }
        sanitizedValues[colName] = strVal;
      }
      // JSON Type
      else if (dt === 'json') {
        if (typeof rawVal === 'object') {
          sanitizedValues[colName] = JSON.stringify(rawVal);
        } else {
          try {
            JSON.parse(String(rawVal));
            sanitizedValues[colName] = String(rawVal);
          } catch (_) {
            throw new ValidationError(`Invalid JSON syntax provided for column '${colName}'`);
          }
        }
      }
      // Integer Types
      else if (dt.includes('int')) {
        const strVal = String(rawVal).trim();
        if (!/^-?\d+$/.test(strVal)) {
          throw new ValidationError(`Column '${colName}' requires a valid integer`);
        }
        if (dt === 'bigint') {
          sanitizedValues[colName] = strVal; // String-preserved BIGINT
        } else {
          const num = Number(strVal);
          if (!Number.isSafeInteger(num)) {
            throw new ValidationError(`Column '${colName}' value exceeds safe integer range`);
          }
          sanitizedValues[colName] = num;
        }
      }
      // Decimal / Float / Double Types
      else if (dt.includes('decimal') || dt.includes('numeric') || dt.includes('float') || dt.includes('double')) {
        const strVal = String(rawVal).trim();
        if (isNaN(Number(strVal))) {
          throw new ValidationError(`Column '${colName}' requires a valid numeric value`);
        }
        sanitizedValues[colName] = strVal;
      }
      // Boolean / TinyInt(1) Types
      else if (dt.includes('bool') || colMeta.columnType.toLowerCase() === 'tinyint(1)') {
        sanitizedValues[colName] = (rawVal === true || rawVal === 'true' || rawVal === 1 || rawVal === '1') ? 1 : 0;
      }
      // Temporal Types
      else if (dt.includes('date') || dt.includes('time')) {
        const d = new Date(rawVal);
        if (isNaN(d.getTime())) {
          throw new ValidationError(`Invalid date/time format for column '${colName}'`);
        }
        if (dt === 'date') {
          sanitizedValues[colName] = d.toISOString().slice(0, 10);
        } else if (dt === 'time') {
          sanitizedValues[colName] = d.toISOString().slice(11, 19);
        } else {
          sanitizedValues[colName] = d.toISOString().slice(0, 19).replace('T', ' ');
        }
      }
      // Fallback
      else {
        sanitizedValues[colName] = rawVal;
      }
    }

    // 6. Transactional Execution with Single-Row Lock, Concurrency Check, and Guarantee
    let finalUpdatedRow: Record<string, any> = {};
    const changedColumns: string[] = [];

    const pkCols = tableDetails.primaryKeys;
    const wherePkClause = pkCols.map(k => `\`${k}\` = ?`).join(' AND ');
    const pkValues = pkCols.map(k => pkMap[k]);

    try {
      await prisma.$transaction(async (tx) => {
        // Step A: Fetch and lock target row
        const selectSql = `SELECT * FROM \`${tableName}\` WHERE ${wherePkClause} FOR UPDATE`;
        const existingRows = await tx.$queryRawUnsafe<any[]>(selectSql, ...pkValues);

        if (!existingRows || existingRows.length === 0) {
          throw new NotFoundError(`Target record in table '${tableName}' was not found or has already been deleted`);
        }

        const existingRow = existingRows[0];

        // Step B: Optimistic Concurrency Check
        if (policy.concurrencyField && concurrencyValue !== undefined && concurrencyValue !== null) {
          const currentConcurrencyVal = existingRow[policy.concurrencyField];
          if (currentConcurrencyVal !== undefined && currentConcurrencyVal !== null) {
            let currentNormalized = currentConcurrencyVal;
            if (currentConcurrencyVal instanceof Date) {
              currentNormalized = currentConcurrencyVal.toISOString();
            } else {
              currentNormalized = String(currentConcurrencyVal);
            }

            let submittedNormalized = String(concurrencyValue);

            let matches = currentNormalized === submittedNormalized;
            if (!matches) {
              const d1 = new Date(String(currentNormalized)).getTime();
              const d2 = new Date(String(submittedNormalized)).getTime();
              if (!isNaN(d1) && !isNaN(d2) && d1 === d2) {
                matches = true;
              }
            }

            if (!matches) {
              throw new ConflictError(
                `Optimistic concurrency conflict: Record in '${tableName}' has been modified by another process. Please reload and review current data before re-applying changes.`
              );
            }
          }
        }

        // Step C: Determine which columns actually changed
        for (const [colName, newVal] of Object.entries(sanitizedValues)) {
          const oldVal = existingRow[colName];
          let isSame = false;
          if (newVal === null && (oldVal === null || oldVal === undefined)) {
            isSame = true;
          } else if (typeof newVal === 'number' && typeof oldVal === 'number') {
            isSame = newVal === oldVal;
          } else if (oldVal instanceof Date) {
            const oldIso = oldVal.toISOString();
            isSame = oldIso.startsWith(String(newVal)) || oldVal.getTime() === new Date(String(newVal)).getTime();
          } else if (typeof oldVal === 'bigint') {
            isSame = oldVal.toString() === String(newVal);
          } else {
            isSame = String(oldVal ?? '') === String(newVal ?? '');
          }

          if (!isSame) {
            changedColumns.push(colName);
          }
        }

        // Step D: If no columns changed, return current row
        if (changedColumns.length === 0) {
          finalUpdatedRow = existingRow;
          return;
        }

        // Step E: Construct UPDATE query for changed columns
        const setClause = changedColumns.map(c => `\`${c}\` = ?`).join(', ');
        const updateSql = `UPDATE \`${tableName}\` SET ${setClause} WHERE ${wherePkClause}`;
        const updateParams = [...changedColumns.map(c => sanitizedValues[c]), ...pkValues];

        const affected = await tx.$executeRawUnsafe(updateSql, ...updateParams);
        if (affected > 1) {
          throw new Error(`Critical integrity violation: Expected exactly 1 row to be updated, but database reported ${affected} affected rows`);
        }

        // Step F: Re-fetch updated row inside transaction
        const refetchedRows = await tx.$queryRawUnsafe<any[]>(`SELECT * FROM \`${tableName}\` WHERE ${wherePkClause}`, ...pkValues);
        if (refetchedRows && refetchedRows.length > 0) {
          finalUpdatedRow = refetchedRows[0];
        } else {
          finalUpdatedRow = { ...existingRow, ...sanitizedValues };
        }
      });
    } catch (dbErr: any) {
      if (dbErr instanceof NotFoundError || dbErr instanceof ConflictError || dbErr instanceof ValidationError || dbErr instanceof ForbiddenError) {
        throw dbErr;
      }

      const msg = dbErr?.message || String(dbErr);
      const errCode = dbErr?.code || dbErr?.errno;

      if (errCode === 1062 || msg.includes('Duplicate entry') || msg.includes('Unique constraint')) {
        throw new ValidationError(`Unique constraint violation: Updated value creates a duplicate entry in '${tableName}'`);
      }
      if (errCode === 1452 || msg.includes('foreign key constraint fails')) {
        throw new ValidationError(`Foreign key constraint violation: The referenced entity does not exist`);
      }
      if (errCode === 1048 || msg.includes('cannot be null')) {
        throw new ValidationError(`Database constraint violation: A required field cannot be set to NULL`);
      }
      if (errCode === 1406 || msg.includes('Data too long')) {
        throw new ValidationError(`Database constraint violation: Submitted value exceeds column maximum capacity`);
      }
      if (errCode === 1265 || msg.includes('Data truncated')) {
        throw new ValidationError(`Database constraint violation: Data value or enum option is invalid for this column`);
      }
      throw new ValidationError(`Database update failed: ${msg}`);
    }

    // 7. Mask Sensitive Fields in Returned Row
    const sanitizedReturnRow: Record<string, any> = {};
    for (const [k, v] of Object.entries(finalUpdatedRow)) {
      if (SENSITIVE_COLUMN_PATTERNS.some(pat => pat.test(k))) {
        sanitizedReturnRow[k] = '[REDACTED]';
      } else if (typeof v === 'bigint') {
        sanitizedReturnRow[k] = v.toString();
      } else if (v instanceof Date) {
        sanitizedReturnRow[k] = v.toISOString();
      } else if (Buffer.isBuffer(v)) {
        sanitizedReturnRow[k] = `[BINARY ${v.length} bytes]`;
      } else {
        sanitizedReturnRow[k] = v;
      }
    }

    // 8. Cryptographic Tamper-Evident Audit Logging
    try {
      await AdminAuditService.logEvent({
        adminId,
        action: AdminAuditAction.ADMIN_STATUS_UPDATED,
        status: 'SUCCESS',
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        metadata: {
          operation: 'DATABASE_ROW_UPDATE',
          table: tableName,
          primaryKey: pkMap,
          changedColumns,
          affectedRows: 1
        }
      });
    } catch (auditErr) {
      console.error('Failed to log admin audit event for database update:', auditErr);
    }

    return {
      tableName,
      affectedRows: 1,
      primaryKey: pkMap,
      updatedRow: sanitizedReturnRow,
      changedColumns
    };
  }

  /**
   * Phase 15 Batch 15.6: Delete Single Database Record
   *
   * Executes securely validated, parameter-bound, metadata-verified single row DELETE
   * within a database transaction with single-row guarantee, foreign key preflight checking,
   * and tamper-evident cryptographic audit logging.
   */
  static async deleteTableRow(params: DeleteTableRowParams): Promise<DeleteTableRowResult> {
    const { adminId, tableName, primaryKey, ipAddress, userAgent } = params;

    if (!tableName || !/^[a-zA-Z0-9_]+$/.test(tableName)) {
      throw new ValidationError(`Invalid table identifier format: '${tableName}'`);
    }

    const verifiedTables = await this.getVerifiedTableNames();
    if (!verifiedTables.has(tableName)) {
      throw new NotFoundError(`Table '${tableName}' was not found in the database schema`);
    }

    // 1. Authoritative Backend Policy Check
    const policy = DELETE_POLICY_REGISTRY[tableName];
    if (!policy || !policy.allowed) {
      const classification = getDestructiveTableClassification(tableName).classification;
      throw new ForbiddenError(
        `DELETE operation is not permitted on table '${tableName}' (Classification: ${classification}). ${policy?.reason || 'Table is not in authorized delete policy registry.'}`
      );
    }

    // 2. Fetch authoritative table details
    const tableDetails = await this.getTableDetails(tableName);
    if (!tableDetails.primaryKeys || tableDetails.primaryKeys.length === 0) {
      throw new ValidationError(`Table '${tableName}' has no primary key. Direct row DELETE is disabled.`);
    }

    // 3. Validate Primary Key Payload
    if (!primaryKey || typeof primaryKey !== 'object' || Array.isArray(primaryKey)) {
      throw new ValidationError('Primary key object is required to identify the target record');
    }

    const pkMap: Record<string, any> = {};
    for (const pkCol of tableDetails.primaryKeys) {
      const val = primaryKey[pkCol];
      if (val === undefined || val === null || (typeof val === 'string' && val.trim() === '')) {
        throw new ValidationError(`Missing or empty primary key value for column '${pkCol}'`);
      }
      pkMap[pkCol] = val;
    }

    // Reject unexpected keys in primaryKey payload
    for (const submittedKey of Object.keys(primaryKey)) {
      if (!tableDetails.primaryKeys.includes(submittedKey)) {
        throw new ValidationError(`Unexpected attribute '${submittedKey}' in primary key identifier`);
      }
    }

    // 4. Construct Parameterized WHERE Clause for Primary Key
    const whereClauses: string[] = [];
    const queryParams: any[] = [];
    const columnMap = new Map<string, ColumnMetadata>();
    for (const col of tableDetails.columns) {
      columnMap.set(col.name, col);
    }

    for (const pkCol of tableDetails.primaryKeys) {
      const colMeta = columnMap.get(pkCol);
      const rawVal = pkMap[pkCol];
      const dt = (colMeta?.dataType || '').toLowerCase();

      whereClauses.push(`\`${pkCol}\` = ?`);
      if (dt.includes('int')) {
        const strVal = String(rawVal).trim();
        if (!/^-?\d+$/.test(strVal)) {
          throw new ValidationError(`Primary key column '${pkCol}' requires a valid integer`);
        }
        queryParams.push(dt === 'bigint' ? strVal : Number(strVal));
      } else {
        queryParams.push(String(rawVal));
      }
    }

    const whereSql = whereClauses.join(' AND ');

    // 5. Execute Transactional Single-Row Delete with Row Locking
    let affectedRows = 0;
    try {
      affectedRows = await prisma.$transaction(async (tx) => {
        // Step A: Lock and verify record exists
        const existingRows = await tx.$queryRawUnsafe<any[]>(
          `SELECT * FROM \`${tableName}\` WHERE ${whereSql} FOR UPDATE`,
          ...queryParams
        );

        if (!existingRows || existingRows.length === 0) {
          throw new NotFoundError(`Record with primary key ${JSON.stringify(pkMap)} not found in '${tableName}'`);
        }

        // Step B: Execute single row deletion
        const deleteResult = await tx.$executeRawUnsafe(
          `DELETE FROM \`${tableName}\` WHERE ${whereSql} LIMIT 1`,
          ...queryParams
        );

        if (deleteResult !== 1) {
          throw new Error(`Safety violation: Expected exactly 1 deleted row, but database returned ${deleteResult}. Transaction rolled back.`);
        }

        return deleteResult;
      });
    } catch (err: any) {
      if (err instanceof NotFoundError || err instanceof ValidationError || err instanceof ForbiddenError || err instanceof ConflictError) {
        throw err;
      }
      // MySQL Error Normalization
      const errCode = err?.code || (err?.meta?.code ? String(err.meta.code) : '') || (err?.message?.includes('1451') ? '1451' : '') || (err?.message?.includes('1452') ? '1452' : '');
      const errMsg = err?.message || '';

      if (errCode === '1451' || errCode === '1452' || errMsg.includes('foreign key constraint fails') || errMsg.includes('a foreign key constraint fails')) {
        throw new ConflictError(`This record cannot be deleted because dependent records in other tables reference it.`);
      }
      if (errCode === '1205' || errMsg.includes('Lock wait timeout') || errCode === '1213' || errMsg.includes('Deadlock')) {
        throw new ConflictError(`Database lock conflict detected. Please retry the operation.`);
      }

      console.error(`Database DELETE error on '${tableName}':`, err);
      throw new Error(`Failed to delete record: ${errMsg}`);
    }

    // 6. Cryptographic Audit Logging
    const SENSITIVE_PATTERNS = /password|token|secret|hash|private_key|auth_key|credential|otp/i;
    const sanitizedPk: Record<string, any> = {};
    for (const [k, v] of Object.entries(pkMap)) {
      sanitizedPk[k] = SENSITIVE_PATTERNS.test(k) ? '[REDACTED]' : v;
    }

    try {
      await AdminAuditService.logEvent({
        adminId,
        action: AdminAuditAction.ADMIN_STATUS_UPDATED,
        status: 'SUCCESS',
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        metadata: {
          operation: 'DATABASE_ROW_DELETE',
          table: tableName,
          affectedRows: 1,
          primaryKey: sanitizedPk
        }
      });
    } catch (auditErr) {
      console.error('Failed to log admin audit event for database row delete:', auditErr);
    }

    return {
      tableName,
      affectedRows: 1,
      primaryKey: sanitizedPk
    };
  }

  /**
   * Phase 15 Batch 15.6: Bulk Delete Database Records
   *
   * Executes securely validated, parameter-bound, metadata-verified multi-row DELETE (max 50 rows)
   * within an atomic database transaction with preflight existence verification across ALL requested
   * rows, dependency verification, and tamper-evident cryptographic audit logging.
   */
  static async bulkDeleteTableRows(params: BulkDeleteTableRowsParams): Promise<BulkDeleteTableRowsResult> {
    const { adminId, tableName, rows, ipAddress, userAgent } = params;

    if (!tableName || !/^[a-zA-Z0-9_]+$/.test(tableName)) {
      throw new ValidationError(`Invalid table identifier format: '${tableName}'`);
    }

    const verifiedTables = await this.getVerifiedTableNames();
    if (!verifiedTables.has(tableName)) {
      throw new NotFoundError(`Table '${tableName}' was not found in the database schema`);
    }

    // 1. Authoritative Backend Policy Check
    const policy = DELETE_POLICY_REGISTRY[tableName];
    if (!policy || !policy.allowed) {
      const classification = getDestructiveTableClassification(tableName).classification;
      throw new ForbiddenError(
        `Bulk DELETE operation is not permitted on table '${tableName}' (Classification: ${classification}). ${policy?.reason || 'Table is not in authorized delete policy registry.'}`
      );
    }

    // 2. Fetch authoritative table details
    const tableDetails = await this.getTableDetails(tableName);
    if (!tableDetails.primaryKeys || tableDetails.primaryKeys.length === 0) {
      throw new ValidationError(`Table '${tableName}' has no primary key. Bulk DELETE is disabled.`);
    }

    // 3. Validate Rows Array Bounds
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new ValidationError('At least 1 row identity must be provided for bulk deletion');
    }

    const maxAllowed = policy.maxRows || 50;
    if (rows.length > maxAllowed) {
      throw new ValidationError(`Bulk delete exceeds maximum allowed limit of ${maxAllowed} records per request`);
    }

    // 4. Validate & Normalize Every Row Identity
    const columnMap = new Map<string, ColumnMetadata>();
    for (const col of tableDetails.columns) {
      columnMap.set(col.name, col);
    }

    const normalizedPks: Record<string, any>[] = [];
    const seenIdentities = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const rowItem = rows[i];
      if (!rowItem || typeof rowItem !== 'object' || Array.isArray(rowItem)) {
        throw new ValidationError(`Invalid row identity object at index ${i}`);
      }

      const pkObj: Record<string, any> = {};
      for (const pkCol of tableDetails.primaryKeys) {
        const val = rowItem[pkCol];
        if (val === undefined || val === null || (typeof val === 'string' && val.trim() === '')) {
          throw new ValidationError(`Missing primary key value '${pkCol}' in row identity at index ${i}`);
        }

        const colMeta = columnMap.get(pkCol);
        const dt = (colMeta?.dataType || '').toLowerCase();
        if (dt.includes('int')) {
          const strVal = String(val).trim();
          if (!/^-?\d+$/.test(strVal)) {
            throw new ValidationError(`Primary key '${pkCol}' requires a valid integer at index ${i}`);
          }
          pkObj[pkCol] = dt === 'bigint' ? strVal : Number(strVal);
        } else {
          pkObj[pkCol] = String(val);
        }
      }

      // Check for unexpected fields
      for (const k of Object.keys(rowItem)) {
        if (!tableDetails.primaryKeys.includes(k)) {
          throw new ValidationError(`Unexpected attribute '${k}' in primary key identifier at index ${i}`);
        }
      }

      // Canonical identity duplicate check
      const canonicalStr = JSON.stringify(pkObj, Object.keys(pkObj).sort());
      if (seenIdentities.has(canonicalStr)) {
        throw new ValidationError(`Duplicate row identity detected in bulk delete payload at index ${i}`);
      }
      seenIdentities.add(canonicalStr);
      normalizedPks.push(pkObj);
    }

    // 5. Construct Parameterized Queries
    let whereCondition = '';
    const queryParams: any[] = [];

    if (tableDetails.primaryKeys.length === 1) {
      const pkCol = tableDetails.primaryKeys[0];
      const placeholders = normalizedPks.map(() => '?').join(', ');
      whereCondition = `\`${pkCol}\` IN (${placeholders})`;
      for (const pkObj of normalizedPks) {
        queryParams.push(pkObj[pkCol]);
      }
    } else {
      const orClauses: string[] = [];
      for (const pkObj of normalizedPks) {
        const andClauses = tableDetails.primaryKeys.map(pkCol => {
          queryParams.push(pkObj[pkCol]);
          return `\`${pkCol}\` = ?`;
        });
        orClauses.push(`(${andClauses.join(' AND ')})`);
      }
      whereCondition = orClauses.join(' OR ');
    }

    // 6. Execute Transactional Bulk Delete with Complete Preflight Verification
    let deletedCount = 0;
    try {
      deletedCount = await prisma.$transaction(async (tx) => {
        // Step A: Lock and verify ALL requested records exist
        const lockedRows = await tx.$queryRawUnsafe<any[]>(
          `SELECT * FROM \`${tableName}\` WHERE ${whereCondition} FOR UPDATE`,
          ...queryParams
        );

        if (!lockedRows || lockedRows.length !== normalizedPks.length) {
          const foundCount = lockedRows ? lockedRows.length : 0;
          const missingCount = normalizedPks.length - foundCount;
          throw new ConflictError(
            `Bulk delete preflight verification failed: ${missingCount} requested record(s) were missing or concurrently modified. Entire bulk operation aborted to prevent partial deletion.`
          );
        }

        // Step B: Execute bulk delete
        const resultCount = await tx.$executeRawUnsafe(
          `DELETE FROM \`${tableName}\` WHERE ${whereCondition}`,
          ...queryParams
        );

        if (resultCount !== normalizedPks.length) {
          throw new Error(
            `Safety violation: Expected to delete exactly ${normalizedPks.length} rows, but database affected ${resultCount}. Entire transaction rolled back.`
          );
        }

        return resultCount;
      });
    } catch (err: any) {
      if (err instanceof NotFoundError || err instanceof ValidationError || err instanceof ForbiddenError || err instanceof ConflictError) {
        throw err;
      }
      const errCode = err?.code || (err?.meta?.code ? String(err.meta.code) : '') || (err?.message?.includes('1451') ? '1451' : '') || (err?.message?.includes('1452') ? '1452' : '');
      const errMsg = err?.message || '';

      if (errCode === '1451' || errCode === '1452' || errMsg.includes('foreign key constraint fails') || errMsg.includes('a foreign key constraint fails')) {
        throw new ConflictError(`One or more records cannot be deleted because dependent records in other tables reference them.`);
      }
      if (errCode === '1205' || errMsg.includes('Lock wait timeout') || errCode === '1213' || errMsg.includes('Deadlock')) {
        throw new ConflictError(`Database lock conflict detected during bulk operation. Please retry.`);
      }

      console.error(`Database BULK DELETE error on '${tableName}':`, err);
      throw new Error(`Failed to bulk delete records: ${errMsg}`);
    }

    // 7. Cryptographic Audit Logging
    const SENSITIVE_PATTERNS = /password|token|secret|hash|private_key|auth_key|credential|otp/i;
    const sanitizedPkList = normalizedPks.map(pkObj => {
      const sanitized: Record<string, any> = {};
      for (const [k, v] of Object.entries(pkObj)) {
        sanitized[k] = SENSITIVE_PATTERNS.test(k) ? '[REDACTED]' : v;
      }
      return sanitized;
    });

    try {
      await AdminAuditService.logEvent({
        adminId,
        action: AdminAuditAction.ADMIN_STATUS_UPDATED,
        status: 'SUCCESS',
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        metadata: {
          operation: 'DATABASE_BULK_DELETE',
          table: tableName,
          requestedCount: normalizedPks.length,
          affectedRows: deletedCount,
          primaryKeys: sanitizedPkList
        }
      });
    } catch (auditErr) {
      console.error('Failed to log admin audit event for database bulk delete:', auditErr);
    }

    return {
      tableName,
      affectedRows: deletedCount,
      deletedCount,
      primaryKeys: sanitizedPkList
    };
  }
}


