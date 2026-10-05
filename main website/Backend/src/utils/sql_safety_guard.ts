/**
 * SQL Safety Guard & Read-Only Policy Validator
 * Phase 15 Batch 15.1-R1 — Read-Only SQL Foundation Remediation & Hardening
 *
 * Implements strict lexical parsing and token analysis to guarantee that only
 * provably safe, single-statement read-only queries can be executed.
 */

export interface SqlValidationResult {
  valid: boolean;
  statementType?: 'SELECT' | 'WITH' | 'SHOW' | 'DESCRIBE' | 'DESC' | 'EXPLAIN';
  cleanedSql?: string;
  error?: string;
  reason?: string;
}

export interface SqlControlledWriteValidationResult {
  valid: boolean;
  statementType?: 'INSERT' | 'UPDATE';
  targetTable?: string;
  cleanedSql?: string;
  error?: string;
  reason?: string;
}

export interface SqlDestructiveValidationResult {
  valid: boolean;
  statementType?: 'DELETE';
  targetTable?: string;
  cleanedSql?: string;
  error?: string;
  reason?: string;
}

export const MAX_SQL_LENGTH = 10000;

// Internal database/tooling tables that are not application Prisma models
export const INTERNAL_TABLE_NAMES = new Set([
  '_PRISMA_MIGRATIONS'
]);

// Protected security, audit, and authentication tables that CANNOT be mutated via Controlled Write or Destructive Mode
export const PROTECTED_TABLE_NAMES = new Set([
  // Admin & Identity tables
  'ADMIN_USERS',
  'ADMIN_USER',
  'ADMINUSER',
  'ADMINUSERS',
  'ADMIN_SESSIONS',
  'ADMIN_SESSION',
  'ADMINSESSION',
  'ADMINSESSIONS',
  'ADMIN_EMAIL_OTPS',
  'ADMIN_EMAIL_OTP',
  'ADMINEMAILOTP',
  'ADMINEMAILOTPS',
  'ADMIN_LOCKOUTS',
  'ADMIN_LOCKOUT',
  'ADMINLOCKOUT',
  'ADMINLOCKOUTS',
  'ADMIN_ROLES',
  'ADMIN_ROLE',
  'ADMINROLE',
  'ADMINROLES',
  'ADMIN_PERMISSIONS',
  'ADMIN_PERMISSION',
  'ADMINPERMISSION',
  'ADMINPERMISSIONS',
  'ADMIN_USER_ROLES',
  'ADMIN_USER_ROLE',
  'ADMINUSERROLE',
  'ADMINUSERROLES',
  'ADMIN_ROLE_PERMISSIONS',
  'ADMIN_ROLE_PERMISSION',
  'ADMINROLEPERMISSION',
  'ADMINROLEPERMISSIONS',
  // Audit & Logging tables
  'ADMIN_AUDIT_LOGS',
  'ADMIN_AUDIT_LOG',
  'ADMINAUDITLOG',
  'ADMINAUDITLOGS',
  'ADMIN_AUDIT_LOG_ENTRIES',
  'ADMIN_AUDIT_LOG_ENTRY',
  'ADMINAUDITLOGENTRY',
  'ADMINAUDITLOGENTRIES',
  'SECURITY_AUDIT_LOGS',
  'SECURITY_AUDIT_LOG',
  'SECURITYAUDITLOG',
  'SECURITYAUDITLOGS',
  'AUDIT_EVENTS',
  'AUDIT_EVENT',
  'AUDITEVENT',
  'AUDITEVENTS',
  'AUDIT_LOGS',
  'AUDIT_LOG',
  'AUDITLOG',
  'AUDITLOGS',
  // Customer identity, sessions & credentials
  'USERS',
  'USER',
  'USER_SESSIONS',
  'USER_SESSION',
  'USERSESSION',
  'USERSESSIONS',
  'SESSIONS',
  'SESSION',
  'DEVICE_AUTH_CREDENTIALS',
  'DEVICE_AUTH_CREDENTIAL',
  'DEVICEAUTHCREDENTIAL',
  'DEVICEAUTHCREDENTIALS',
  'REFRESH_TOKENS',
  'REFRESH_TOKEN',
  'REFRESHTOKEN',
  'REFRESHTOKENS',
  'PASSWORD_RESET_TOKENS',
  'PASSWORD_RESET_TOKEN',
  'PASSWORDRESETTOKEN',
  'PASSWORDRESETTOKENS',
  'EMAIL_OTPS',
  'EMAIL_OTP',
  'EMAILOTP',
  'EMAILOTPS',
  'OTP_CODES',
  'OTP_CODE',
  'OTPCODE',
  'OTPCODES',
  'API_KEYS',
  'API_KEY',
  'APIKEY',
  'APIKEYS',
  // Gateway & Infrastructure nodes
  'GATEWAY_NODES',
  'GATEWAY_NODE',
  'GATEWAYNODE',
  'GATEWAYNODES',
  // User account privacy & communication consent
  'USER_NOTIFICATION_PREFERENCES',
  'USER_NOTIFICATION_PREFERENCE',
  'USERNOTIFICATIONPREFERENCES',
  'USERNOTIFICATIONPREFERENCE',
  // Settings & System
  'SECURITY_CONFIGURATIONS',
  'SECURITY_CONFIGURATION',
  'SECURITYCONFIGURATION',
  'SYSTEM_SETTINGS',
  'SYSTEM_SETTING',
  'SYSTEMSETTING',
  'SAVED_QUERIES',
  'SAVED_QUERY',
  'SAVEDQUERY',
  'SAVEDQUERIES',
  '_PRISMA_MIGRATIONS'
]);

// Business-sensitive financial, billing, subscription, plan, tax, and ledger tables strictly protected from DELETE
export const BUSINESS_SENSITIVE_TABLE_NAMES = new Set([
  // Financial payments & refunds
  'BILLING_PAYMENTS',
  'BILLING_PAYMENT',
  'BILLINGPAYMENT',
  'BILLINGPAYMENTS',
  'BILLING_REFUNDS',
  'BILLING_REFUND',
  'BILLINGREFUND',
  'BILLINGREFUNDS',
  'BILLING_SETTLEMENTS',
  'BILLING_SETTLEMENT',
  'BILLINGSETTLEMENT',
  'BILLINGSETTLEMENTS',
  'BILLING_PAYMENT_TAXES',
  'BILLING_PAYMENT_TAX',
  'BILLINGPAYMENTTAX',
  'BILLINGPAYMENTTAXES',
  'BILLING_PAYMENT_PROCESSING_FEES',
  'BILLING_PAYMENT_PROCESSING_FEE',
  'BILLINGPAYMENTPROCESSINGFEE',
  'BILLINGPAYMENTPROCESSINGFEES',
  'BILLING_RECEIPTS',
  'BILLING_RECEIPT',
  'BILLINGRECEIPT',
  'BILLINGRECEIPTS',
  // Financial reconciliation
  'BILLING_RECONCILIATION_RECORDS',
  'BILLING_RECONCILIATION_RECORD',
  'BILLINGRECONCILIATIONRECORD',
  'BILLINGRECONCILIATIONRECORDS',
  'BILLING_RECONCILIATION_RUNS',
  'BILLING_RECONCILIATION_RUN',
  'BILLINGRECONCILIATIONRUN',
  'BILLINGRECONCILIATIONRUNS',
  'BILLING_RECONCILIATION_DISCREPANCIES',
  'BILLING_RECONCILIATION_DISCREPANCY',
  'BILLINGRECONCILIATIONDISCREPANCY',
  'BILLINGRECONCILIATIONDISCREPANCIES',
  // Subscriptions & Account billing states
  'SUBSCRIPTIONS',
  'SUBSCRIPTION',
  'SUBSCRIPTION_PLAN_CHANGES',
  'SUBSCRIPTION_PLAN_CHANGE',
  'SUBSCRIPTIONPLANCHANGE',
  'SUBSCRIPTIONPLANCHANGES',
  'SUBSCRIPTION_UPGRADE_RECONCILIATIONS',
  'SUBSCRIPTION_UPGRADE_RECONCILIATION',
  'SUBSCRIPTIONUPGRADERECONCILIATION',
  'SUBSCRIPTIONUPGRADERECONCILIATIONS',
  'ACCOUNT_BILLING_STATES',
  'ACCOUNT_BILLING_STATE',
  'ACCOUNTBILLINGSTATE',
  'ACCOUNTBILLINGSTATES',
  // Commercial plans & Entitlements
  'PLANS',
  'PLAN',
  'PLAN_PRICES',
  'PLAN_PRICE',
  'PLANPRICE',
  'PLANPRICES',
  'PLAN_ENTITLEMENTS',
  'PLAN_ENTITLEMENT',
  'PLANENTITLEMENT',
  'PLANENTITLEMENTS',
  'ENTITLEMENT_DEFINITIONS',
  'ENTITLEMENT_DEFINITION',
  'ENTITLEMENTDEFINITION',
  'ENTITLEMENTDEFINITIONS',
  'BILLING_PROVIDER_PLAN_MAPPINGS',
  'BILLING_PROVIDER_PLAN_MAPPING',
  'BILLINGPROVIDERPLANMAPPING',
  'BILLINGPROVIDERPLANMAPPINGS',
  // Financial event logs & webhook idempotency
  'BILLING_WEBHOOK_EVENTS',
  'BILLING_WEBHOOK_EVENT',
  'BILLINGWEBHOOKEVENT',
  'BILLINGWEBHOOKEVENTS'
]);

export const DESTRUCTIVE_BUSINESS_SENSITIVE_TABLE_NAMES = BUSINESS_SENSITIVE_TABLE_NAMES;

// Tables that have 1 or more incoming foreign-key relationships (Non-Leaf)
export const NON_LEAF_TABLE_NAMES = new Set([
  'DEVICES',
  'DEVICE',
  'SERVER_INSTANCES',
  'SERVER_INSTANCE',
  'SERVERINSTANCE',
  'SERVERINSTANCES',
  'NOTIFICATION_RECORDS',
  'NOTIFICATION_RECORD',
  'NOTIFICATIONRECORD',
  'NOTIFICATIONRECORDS',
  'CHANNEL_DELIVERY_RECORDS',
  'CHANNEL_DELIVERY_RECORD',
  'CHANNELDELIVERYRECORD',
  'CHANNELDELIVERYRECORDS',
  'EMAIL_MESSAGES',
  'EMAIL_MESSAGE',
  'EMAILMESSAGE',
  'EMAILMESSAGES',
  'SUPPORT_CASES',
  'SUPPORT_CASE',
  'SUPPORTCASE',
  'SUPPORTCASES',
  'ERROR_FINGERPRINTS',
  'ERROR_FINGERPRINT',
  'ERRORFINGERPRINT',
  'ERRORFINGERPRINTS',
  'ERROR_INCIDENTS',
  'ERROR_INCIDENT',
  'ERRORINCIDENT',
  'ERRORINCIDENTS'
]);

// Approved non-sensitive, unreferenced operational & telemetry leaf tables (Incoming FK Count = 0, !Protected, !BusinessSensitive)
export const APPROVED_LEAF_TABLE_NAMES = new Set([
  // Support case operator notes
  'SUPPORT_CASE_NOTES',
  'SUPPORT_CASE_NOTE',
  'SUPPORTCASENOTES',
  'SUPPORTCASENOTE',
  // Error occurrences
  'ERROR_OCCURRENCES',
  'ERROR_OCCURRENCE',
  'ERROROCCURRENCES',
  'ERROROCCURRENCE',
  // Email delivery attempt logs
  'EMAIL_DELIVERY_ATTEMPTS',
  'EMAIL_DELIVERY_ATTEMPT',
  'EMAILDELIVERYATTEMPTS',
  'EMAILDELIVERYATTEMPT',
  // Device gateway connections
  'DEVICE_CONNECTIONS',
  'DEVICE_CONNECTION',
  'DEVICECONNECTIONS',
  'DEVICECONNECTION',
  // Device push tokens
  'DEVICE_PUSH_TOKENS',
  'DEVICE_PUSH_TOKEN',
  'DEVICEPUSHTOKENS',
  'DEVICEPUSHTOKEN',
  // Server endpoints
  'SERVER_ENDPOINTS',
  'SERVER_ENDPOINT',
  'SERVERENDPOINTS',
  'SERVERENDPOINT'
]);

export const DESTRUCTIVE_LEAF_TABLE_NAMES = APPROVED_LEAF_TABLE_NAMES;

// Tables that have ON DELETE CASCADE relationships propagating to protected credentials, sessions, RBAC, or billing ledger chains
export const UNSAFE_CASCADE_TABLE_NAMES = new Set([
  'USERS',
  'USER',
  'DEVICES',
  'DEVICE',
  'PLANS',
  'PLAN',
  'SUBSCRIPTIONS',
  'SUBSCRIPTION',
  'BILLING_PAYMENTS',
  'BILLING_PAYMENT',
  'BILLINGPAYMENT',
  'BILLINGPAYMENTS'
]);

// Authoritative mapping of approved WHERE columns permitted in destructive single-statement DELETE queries.
// Synchronized with column-level MySQL SELECT grants for the dedicated destructive database user.
export const DESTRUCTIVE_WHERE_SELECT_COLUMNS: Record<string, string[]> = {
  support_case_notes: ['id', 'caseId', 'adminId', 'authorId', 'isInternal', 'createdAt'],
  error_occurrences: ['id', 'fingerprintId', 'incidentId', 'occurredAt', 'component', 'severity', 'errorCode', 'userId', 'deviceId', 'serverInstanceId', 'gatewayNodeId', 'createdAt'],
  email_delivery_attempts: ['id', 'emailMessageId', 'attemptNumber', 'transport', 'status', 'providerResponseCode', 'attemptedAt'],
  device_connections: ['id', 'deviceId', 'gatewayNodeId', 'status', 'connectedAt', 'disconnectedAt', 'createdAt', 'updatedAt'],
  device_push_tokens: ['id', 'userId', 'deviceId', 'platform', 'isActive', 'lastSeenAt', 'revokedAt', 'createdAt', 'updatedAt'],
  server_endpoints: ['id', 'serverInstanceId', 'hostname', 'status', 'createdAt', 'updatedAt']
};

// Canonical DDL grants mapping synchronized directly with the authoritative WHERE columns
export const CANONICAL_DESTRUCTIVE_SELECT_GRANTS: Record<string, string[]> = {
  support_case_notes: ['id', 'caseId', 'adminId', 'authorId', 'isInternal', 'createdAt'],
  error_occurrences: ['id', 'fingerprintId', 'incidentId', 'occurredAt', 'component', 'severity', 'errorCode', 'userId', 'deviceId', 'serverInstanceId', 'gatewayNodeId', 'createdAt'],
  email_delivery_attempts: ['id', 'emailMessageId', 'attemptNumber', 'transport', 'status', 'providerResponseCode', 'attemptedAt'],
  device_connections: ['id', 'deviceId', 'gatewayNodeId', 'status', 'connectedAt', 'disconnectedAt', 'createdAt', 'updatedAt'],
  device_push_tokens: ['id', 'userId', 'deviceId', 'platform', 'isActive', 'lastSeenAt', 'revokedAt', 'createdAt', 'updatedAt'],
  server_endpoints: ['id', 'serverInstanceId', 'hostname', 'status', 'createdAt', 'updatedAt']
};

/**
 * Generates the authoritative, canonical MySQL DDL privilege script for the dedicated destructive database user.
 * Derived deterministically from DESTRUCTIVE_WHERE_SELECT_COLUMNS to guarantee 100% parity with zero manual drift.
 */
export function generateCanonicalDestructiveGrantsDdl(
  dbName = 'zdexcloud',
  userName = 'zdex_destructive_user',
  host = '%'
): string {
  const statements: string[] = [
    `-- Step 1: Revoke all existing permissions to establish a clean state`,
    `REVOKE ALL PRIVILEGES, GRANT OPTION FROM '${userName}'@'${host}';`,
    ``,
    `-- Step 2: Grant base connection capability (No table or database privileges)`,
    `GRANT USAGE ON *.* TO '${userName}'@'${host}';`,
    ``,
    `-- Step 3: Column-Level SELECT and Table-Level DELETE for the 6 approved leaf tables`
  ];

  let index = 1;
  for (const [table, columns] of Object.entries(DESTRUCTIVE_WHERE_SELECT_COLUMNS)) {
    const colList = columns.join(', ');
    statements.push(`-- ${index}. ${table}`);
    statements.push(`GRANT SELECT (${colList}),`);
    statements.push(`      DELETE`);
    statements.push(`ON ${dbName}.${table}`);
    statements.push(`TO '${userName}'@'${host}';`);
    statements.push(``);
    index++;
  }

  statements.push(`FLUSH PRIVILEGES;`);
  return statements.join('\n');
}



export type TableClassificationType =
  | 'INTERNAL'
  | 'PROTECTED'
  | 'BUSINESS_SENSITIVE'
  | 'NON_LEAF'
  | 'APPROVED_LEAF'
  | 'UNKNOWN';

export interface TableClassificationResult {
  normalizedTable: string;
  canonicalTable: string;
  classification: TableClassificationType;
  isProtected: boolean;
  isBusinessSensitive: boolean;
  incomingForeignKeyCount: number;
  isExplicitlyApproved: boolean;
  destructiveEligible: boolean;
  rejectionCode?: string;
  rejectionReason?: string;
}

/**
 * Resolves the authoritative security, financial, and topology classification for a database table.
 * Enforces deterministic precedence: INTERNAL > PROTECTED > BUSINESS_SENSITIVE > NON_LEAF > APPROVED_LEAF.
 * Unknown tables fail closed with UNKNOWN classification.
 */
export function getDestructiveTableClassification(rawTableName: string): TableClassificationResult {
  let normalized = (rawTableName || '').trim();
  if (normalized.includes('.')) {
    const parts = normalized.split('.');
    normalized = parts[parts.length - 1];
  }
  normalized = normalized.replace(/[`"']/g, '').trim().toUpperCase();
  const canonical = normalized.toLowerCase();

  if (!normalized) {
    return {
      normalizedTable: '',
      canonicalTable: '',
      classification: 'UNKNOWN',
      isProtected: false,
      isBusinessSensitive: false,
      incomingForeignKeyCount: 0,
      isExplicitlyApproved: false,
      destructiveEligible: false,
      rejectionCode: 'SQL_TARGET_TABLE_MISSING',
      rejectionReason: 'Could not extract valid target table name for DELETE operation'
    };
  }

  // Precedence 1: INTERNAL
  if (INTERNAL_TABLE_NAMES.has(normalized)) {
    return {
      normalizedTable: normalized,
      canonicalTable: canonical,
      classification: 'INTERNAL',
      isProtected: true,
      isBusinessSensitive: false,
      incomingForeignKeyCount: 0,
      isExplicitlyApproved: false,
      destructiveEligible: false,
      rejectionCode: 'SQL_WRITE_PROTECTED_TABLE',
      rejectionReason: `Destructive deletion from internal database table '${rawTableName}' is strictly forbidden`
    };
  }

  // Precedence 2: PROTECTED
  if (PROTECTED_TABLE_NAMES.has(normalized)) {
    return {
      normalizedTable: normalized,
      canonicalTable: canonical,
      classification: 'PROTECTED',
      isProtected: true,
      isBusinessSensitive: false,
      incomingForeignKeyCount: 0,
      isExplicitlyApproved: false,
      destructiveEligible: false,
      rejectionCode: 'SQL_WRITE_PROTECTED_TABLE',
      rejectionReason: `Destructive deletion from protected system/security table '${rawTableName}' is strictly forbidden`
    };
  }

  // Precedence 3: BUSINESS_SENSITIVE
  if (BUSINESS_SENSITIVE_TABLE_NAMES.has(normalized)) {
    return {
      normalizedTable: normalized,
      canonicalTable: canonical,
      classification: 'BUSINESS_SENSITIVE',
      isProtected: false,
      isBusinessSensitive: true,
      incomingForeignKeyCount: 0,
      isExplicitlyApproved: false,
      destructiveEligible: false,
      rejectionCode: 'DESTRUCTIVE_DELETE_BUSINESS_SENSITIVE_NOT_ALLOWED',
      rejectionReason: `Destructive DELETE against business-sensitive/financial table '${rawTableName}' is strictly prohibited. Financial, billing, subscription, ledger, and commercial state records cannot be deleted via the SQL console.`
    };
  }

  // Precedence 4: NON_LEAF
  if (NON_LEAF_TABLE_NAMES.has(normalized)) {
    return {
      normalizedTable: normalized,
      canonicalTable: canonical,
      classification: 'NON_LEAF',
      isProtected: false,
      isBusinessSensitive: false,
      incomingForeignKeyCount: 1,
      isExplicitlyApproved: false,
      destructiveEligible: false,
      rejectionCode: 'DESTRUCTIVE_DELETE_NON_LEAF_TABLE_NOT_ALLOWED',
      rejectionReason: `Destructive DELETE against non-leaf table '${rawTableName}' is prohibited. Destructive operations are strictly restricted to isolated leaf tables with zero incoming foreign-key relationships.`
    };
  }

  // Precedence 5: APPROVED_LEAF
  if (APPROVED_LEAF_TABLE_NAMES.has(normalized)) {
    return {
      normalizedTable: normalized,
      canonicalTable: canonical,
      classification: 'APPROVED_LEAF',
      isProtected: false,
      isBusinessSensitive: false,
      incomingForeignKeyCount: 0,
      isExplicitlyApproved: true,
      destructiveEligible: true
    };
  }

  // Fallback: UNKNOWN (Fail Closed)
  return {
    normalizedTable: normalized,
    canonicalTable: canonical,
    classification: 'UNKNOWN',
    isProtected: false,
    isBusinessSensitive: false,
    incomingForeignKeyCount: 0,
    isExplicitlyApproved: false,
    destructiveEligible: false,
    rejectionCode: 'DESTRUCTIVE_DELETE_UNKNOWN_TABLE_NOT_ALLOWED',
    rejectionReason: `Destructive DELETE against unrecognized or unapproved table '${rawTableName}' is prohibited. Only explicitly cataloged, non-sensitive leaf tables may be targeted.`
  };
}

// Approved read-only statement starting keywords
const ALLOWED_INITIAL_KEYWORDS = new Set([
  'SELECT',
  'WITH',
  'SHOW',
  'DESCRIBE',
  'DESC',
  'EXPLAIN'
]);

// Prohibited mutation, DDL, DCL, administration, transaction, and locking keywords
const FORBIDDEN_KEYWORDS = new Set([
  'INSERT',
  'UPDATE',
  'DELETE',
  'REPLACE',
  'UPSERT',
  'MERGE',
  'TRUNCATE',
  'DROP',
  'ALTER',
  'CREATE',
  'RENAME',
  'GRANT',
  'REVOKE',
  'CALL',
  'DO',
  'LOAD',
  'HANDLER',
  'PREPARE',
  'EXECUTE',
  'DEALLOCATE',
  'LOCK',
  'UNLOCK',
  'SET',
  'START',
  'COMMIT',
  'ROLLBACK',
  'SAVEPOINT',
  'SHUTDOWN',
  'RESTART',
  'KILL',
  'FLUSH',
  'RESET',
  'PURGE',
  'CHANGE',
  'STOP',
  'INSTALL',
  'UNINSTALL'
]);

// Prohibited abusive, delay, resource exhaustion, locking, or file reading functions
const FORBIDDEN_FUNCTIONS = new Set([
  'SLEEP',
  'BENCHMARK',
  'LOAD_FILE',
  'GET_LOCK',
  'RELEASE_LOCK',
  'RELEASE_ALL_LOCKS',
  'IS_FREE_LOCK',
  'IS_USED_LOCK'
]);

// Sensitive database column names that cannot be referenced in any expression (even aliased or transformed)
const SENSITIVE_COLUMN_NAMES = new Set([
  'PASSWORD',
  'PASSWORDHASH',
  'PASS_HASH',
  'PASSWD',
  'PASSWORD_HASH',
  'TOKENHASH',
  'SESSIONTOKEN',
  'SESSIONTOKENHASH',
  'REFRESHTOKEN',
  'REFRESHTOKENHASH',
  'TOTPSECRET',
  'MFASECRET',
  'OTPCODE',
  'OTP_CODE',
  'INTERNALSERVICEKEY',
  'APIKEY',
  'API_KEY',
  'SECRET',
  'CLIENTSECRET',
  'CLIENT_SECRET',
  'PRIVATEKEY',
  'PRIVATE_KEY',
  'CREDENTIAL'
]);

// Explicitly approved SHOW variants
const APPROVED_SHOW_PREFIXES = [
  ['SHOW', 'TABLES'],
  ['SHOW', 'FULL', 'TABLES'],
  ['SHOW', 'CREATE', 'TABLE'],
  ['SHOW', 'CREATE', 'VIEW'],
  ['SHOW', 'COLUMNS', 'FROM'],
  ['SHOW', 'FIELDS', 'FROM'],
  ['SHOW', 'FULL', 'COLUMNS', 'FROM'],
  ['SHOW', 'INDEX', 'FROM'],
  ['SHOW', 'INDEXES', 'FROM'],
  ['SHOW', 'KEYS', 'FROM'],
  ['SHOW', 'TABLE', 'STATUS']
];

export interface TokenizeResult {
  tokens: string[];
  rawTokens: string[];
  statementCount: number;
  cleanedSql: string;
  hasUnclosedQuote: boolean;
  hasUnclosedComment: boolean;
  hasOutfileOrDumpfile: boolean;
  hasForUpdateOrLock: boolean;
  hasMultiStatements: boolean;
  hasUserVariable: boolean;
  abusiveFunctionsFound: string[];
  sensitiveColumnsFound: string[];
}

/**
 * Tokenizes SQL query while respecting single quotes, double quotes, backticks,
 * line comments (-- / #), block comments (/* ... * /), and escape characters.
 */
export function sanitizeAndTokenizeSql(rawSql: string): TokenizeResult {
  const len = rawSql.length;
  let i = 0;
  const tokens: string[] = [];
  const rawTokens: string[] = [];
  let currentToken = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  const cleanedChars: string[] = [];
  let semicolonCount = 0;
  let hasTrailingStatements = false;
  let hasOutfileOrDumpfile = false;
  let hasForUpdateOrLock = false;
  let hasUserVariable = false;
  const abusiveFunctionsFound: string[] = [];
  const sensitiveColumnsFound: string[] = [];

  while (i < len) {
    const char = rawSql[i];
    const nextChar = i + 1 < len ? rawSql[i + 1] : '';

    // Handle escape sequences in strings
    if ((inSingleQuote || inDoubleQuote) && char === '\\') {
      if (i + 1 < len) {
        if (!inLineComment && !inBlockComment) {
          cleanedChars.push(char);
          cleanedChars.push(nextChar);
        }
        i += 2;
        continue;
      }
    }

    // Line comment handling (-- or #)
    if (!inSingleQuote && !inDoubleQuote && !inBacktick && !inBlockComment) {
      if ((char === '-' && nextChar === '-') || char === '#') {
        inLineComment = true;
        i += (char === '-' ? 2 : 1);
        continue;
      }
    }

    if (inLineComment) {
      if (char === '\n' || char === '\r') {
        inLineComment = false;
        cleanedChars.push(' ');
      }
      i++;
      continue;
    }

    // Block comment handling (/* ... */)
    if (!inSingleQuote && !inDoubleQuote && !inBacktick && !inLineComment) {
      if (char === '/' && nextChar === '*') {
        inBlockComment = true;
        i += 2;
        continue;
      }
    }

    if (inBlockComment) {
      if (char === '*' && nextChar === '/') {
        inBlockComment = false;
        cleanedChars.push(' ');
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    // Single quote toggle
    if (char === "'" && !inDoubleQuote && !inBacktick) {
      inSingleQuote = !inSingleQuote;
      cleanedChars.push(char);
      i++;
      continue;
    }

    // Double quote toggle
    if (char === '"' && !inSingleQuote && !inBacktick) {
      inDoubleQuote = !inDoubleQuote;
      cleanedChars.push(char);
      i++;
      continue;
    }

    // Backtick toggle (quoted identifier in MySQL)
    if (char === '`' && !inSingleQuote && !inDoubleQuote) {
      if (inBacktick) {
        inBacktick = false;
        if (currentToken.length > 0) {
          tokens.push(currentToken);
          rawTokens.push(currentToken);
          currentToken = '';
        }
      } else {
        inBacktick = true;
      }
      cleanedChars.push(char);
      i++;
      continue;
    }

    // If inside a string literal, preserve literal chars without tokenizing
    if (inSingleQuote || inDoubleQuote) {
      cleanedChars.push(char);
      i++;
      continue;
    }

    // Detect user variable assignment := or variable reference @var outside strings
    if (char === ':' && nextChar === '=') {
      hasUserVariable = true;
      if (currentToken.length > 0) {
        tokens.push(currentToken);
        rawTokens.push(currentToken);
        currentToken = '';
      }
      cleanedChars.push(':=');
      i += 2;
      continue;
    }

    if (char === '@') {
      hasUserVariable = true;
      cleanedChars.push(char);
      i++;
      continue;
    }

    // Semicolon handling (statement terminator)
    if (char === ';') {
      if (currentToken.length > 0) {
        tokens.push(currentToken);
        rawTokens.push(currentToken);
        currentToken = '';
      }
      semicolonCount++;
      const remainder = rawSql.slice(i + 1);
      const remainingCode = stripComments(remainder);
      if (remainingCode.length > 0) {
        hasTrailingStatements = true;
      }
      cleanedChars.push(';');
      i++;
      continue;
    }

    // Delimiters (whitespace, punctuation, operators)
    if (/\s/.test(char) || [',', '(', ')', '=', '<', '>', '+', '-', '*', '/', '%', '.'].includes(char)) {
      if (currentToken.length > 0) {
        tokens.push(currentToken);
        rawTokens.push(currentToken);
        currentToken = '';
      }
      cleanedChars.push(char);
      i++;
      continue;
    }

    // Word character
    currentToken += char;
    cleanedChars.push(char);
    i++;
  }

  if (currentToken.length > 0) {
    tokens.push(currentToken);
    rawTokens.push(currentToken);
  }

  const cleanedSql = cleanedChars.join('').trim();
  const upperTokens = tokens.map(t => t.toUpperCase());

  // Check for dangerous MySQL specific clauses, abusive functions, and sensitive column identifiers
  for (let k = 0; k < upperTokens.length; k++) {
    const t = upperTokens[k];
    const next1 = k + 1 < upperTokens.length ? upperTokens[k + 1] : '';
    const next2 = k + 2 < upperTokens.length ? upperTokens[k + 2] : '';
    const next3 = k + 3 < upperTokens.length ? upperTokens[k + 3] : '';

    // INTO OUTFILE / INTO DUMPFILE / INTO @VAR
    if (t === 'INTO' && (next1 === 'OUTFILE' || next1 === 'DUMPFILE' || next1.startsWith('@'))) {
      hasOutfileOrDumpfile = true;
    }

    // FOR UPDATE / FOR SHARE / LOCK IN SHARE MODE
    if (t === 'FOR' && (next1 === 'UPDATE' || next1 === 'SHARE')) {
      hasForUpdateOrLock = true;
    }
    if (t === 'LOCK' && next1 === 'IN' && next2 === 'SHARE' && next3 === 'MODE') {
      hasForUpdateOrLock = true;
    }

    // Abusive functions
    if (FORBIDDEN_FUNCTIONS.has(t)) {
      abusiveFunctionsFound.push(t);
    }

    // Semantic sensitive column identifier inspection
    const normalizedIdentifier = t.replace(/[^A-Z0-9_]/g, '');
    if (SENSITIVE_COLUMN_NAMES.has(normalizedIdentifier)) {
      sensitiveColumnsFound.push(rawTokens[k] || t);
    }
  }

  return {
    tokens,
    rawTokens,
    statementCount: semicolonCount > 0 && hasTrailingStatements ? 2 : 1,
    cleanedSql,
    hasUnclosedQuote: inSingleQuote || inDoubleQuote || inBacktick,
    hasUnclosedComment: inLineComment || inBlockComment,
    hasOutfileOrDumpfile,
    hasForUpdateOrLock,
    hasMultiStatements: hasTrailingStatements,
    hasUserVariable,
    abusiveFunctionsFound,
    sensitiveColumnsFound
  };
}

/**
 * Helper to strip comments for multi-statement tail inspection
 */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '')
    .replace(/#.*$/gm, '')
    .trim();
}

export class SqlSafetyGuard {
  public static readonly INTERNAL_TABLE_NAMES = INTERNAL_TABLE_NAMES;
  public static readonly PROTECTED_TABLE_NAMES = PROTECTED_TABLE_NAMES;
  public static readonly BUSINESS_SENSITIVE_TABLE_NAMES = BUSINESS_SENSITIVE_TABLE_NAMES;
  public static readonly NON_LEAF_TABLE_NAMES = NON_LEAF_TABLE_NAMES;
  public static readonly APPROVED_LEAF_TABLE_NAMES = APPROVED_LEAF_TABLE_NAMES;
  public static readonly UNSAFE_CASCADE_TABLE_NAMES = UNSAFE_CASCADE_TABLE_NAMES;
  public static readonly DESTRUCTIVE_WHERE_SELECT_COLUMNS = DESTRUCTIVE_WHERE_SELECT_COLUMNS;
  public static readonly CANONICAL_DESTRUCTIVE_SELECT_GRANTS = CANONICAL_DESTRUCTIVE_SELECT_GRANTS;
  public static getDestructiveTableClassification = getDestructiveTableClassification;

  /**
   * Validates a SQL query string against ZdexCloud Read-Only Policy.
   * Fail-Closed: If anything is ambiguous or dangerous, rejects immediately.
   */
  public static validateReadOnlyQuery(rawSql: string): SqlValidationResult {
    // 1. Basic format & length bounds
    if (!rawSql || typeof rawSql !== 'string') {
      return {
        valid: false,
        error: 'SQL_EMPTY',
        reason: 'SQL query text must be a non-empty string'
      };
    }

    const trimmed = rawSql.trim();
    if (trimmed.length === 0) {
      return {
        valid: false,
        error: 'SQL_EMPTY',
        reason: 'SQL query text cannot be empty or whitespace only'
      };
    }

    if (trimmed.length > MAX_SQL_LENGTH) {
      return {
        valid: false,
        error: 'SQL_LENGTH_EXCEEDED',
        reason: `SQL query exceeds maximum allowed length of ${MAX_SQL_LENGTH} characters`
      };
    }

    // 2. Lexical & token analysis
    const analysis = sanitizeAndTokenizeSql(trimmed);

    if (analysis.hasUnclosedQuote) {
      return {
        valid: false,
        error: 'SQL_SYNTAX_ERROR',
        reason: 'SQL query contains unclosed string literal or quoted identifier'
      };
    }

    if (analysis.hasUnclosedComment) {
      return {
        valid: false,
        error: 'SQL_SYNTAX_ERROR',
        reason: 'SQL query contains unclosed block comment'
      };
    }

    // 3. Multi-statement execution rejection
    if (analysis.hasMultiStatements) {
      return {
        valid: false,
        error: 'SQL_MULTI_STATEMENT_PROHIBITED',
        reason: 'Multi-statement execution is strictly forbidden. Execute only one SQL statement per request.'
      };
    }

    if (analysis.tokens.length === 0) {
      return {
        valid: false,
        error: 'SQL_EMPTY',
        reason: 'No executable SQL tokens found after stripping comments'
      };
    }

    // 4. Initial Statement Keyword Validation
    const firstKeyword = analysis.tokens[0].toUpperCase();

    if (!ALLOWED_INITIAL_KEYWORDS.has(firstKeyword)) {
      return {
        valid: false,
        error: 'SQL_MUTATION_PROHIBITED',
        reason: `Statement type '${firstKeyword}' is not permitted. Only read-only statements (SELECT, WITH, SHOW, DESCRIBE, EXPLAIN) are allowed.`
      };
    }

    // 5. User Variables / Session State Mutation Rejection
    if (analysis.hasUserVariable) {
      return {
        valid: false,
        error: 'SQL_USER_VARIABLE_PROHIBITED',
        reason: 'User variables (@var, :=) and session-state mutation are prohibited in read-only SQL runner'
      };
    }

    // 6. MySQL Specific Side-Effect Protections (Outfile, Dumpfile, Locking Clauses)
    if (analysis.hasOutfileOrDumpfile) {
      return {
        valid: false,
        error: 'SQL_INTO_OUTFILE_PROHIBITED',
        reason: 'SELECT ... INTO OUTFILE / DUMPFILE constructs are strictly forbidden'
      };
    }

    if (analysis.hasForUpdateOrLock) {
      return {
        valid: false,
        error: 'SQL_LOCKING_PROHIBITED',
        reason: 'Locking clauses (FOR UPDATE, LOCK IN SHARE MODE, FOR SHARE) are prohibited in read-only mode'
      };
    }

    // 7. Abusive Function Rejection (SLEEP, BENCHMARK, LOAD_FILE, Locks)
    if (analysis.abusiveFunctionsFound.length > 0) {
      const fn = analysis.abusiveFunctionsFound[0];
      return {
        valid: false,
        error: 'SQL_ABUSIVE_FUNCTION_PROHIBITED',
        reason: `Function '${fn}()' is prohibited in read-only SQL runner (resource abuse / side-effect protection)`
      };
    }

    // 8. Explicit SHOW Variant Policy
    if (firstKeyword === 'SHOW') {
      const upperTokens = analysis.tokens.map(t => t.toUpperCase());
      const isApprovedShow = APPROVED_SHOW_PREFIXES.some(prefix => {
        if (upperTokens.length < prefix.length) return false;
        return prefix.every((token, idx) => upperTokens[idx] === token);
      });

      if (!isApprovedShow) {
        const showTarget = upperTokens.slice(1, 3).join(' ');
        return {
          valid: false,
          error: 'SQL_SHOW_VARIANT_PROHIBITED',
          reason: `SHOW variant 'SHOW ${showTarget}' is not permitted in read-only runner. Permitted variants: SHOW TABLES, SHOW CREATE TABLE, SHOW COLUMNS, SHOW INDEX, SHOW TABLE STATUS.`
        };
      }
    }

    // 9. Semantic Sensitive Column Identifier Protection
    if (analysis.sensitiveColumnsFound.length > 0) {
      const col = analysis.sensitiveColumnsFound[0];
      return {
        valid: false,
        error: 'SQL_SENSITIVE_COLUMN_PROHIBITED',
        reason: `Direct or transformed access to sensitive column '${col}' is prohibited in read-only SQL runner`
      };
    }

    // 10. Check for forbidden mutation & transaction control keywords anywhere in query tokens
    const upperTokens = analysis.tokens.map(t => t.toUpperCase());

    for (const token of upperTokens) {
      if (FORBIDDEN_KEYWORDS.has(token)) {
        if (['START', 'COMMIT', 'ROLLBACK', 'SAVEPOINT'].includes(token)) {
          return {
            valid: false,
            error: 'SQL_TRANSACTION_CONTROL_PROHIBITED',
            reason: `Transaction control statement '${token}' is prohibited in read-only runner`
          };
        }

        if (['SELECT', 'WITH'].includes(firstKeyword)) {
          if (['DROP', 'UPDATE', 'DELETE', 'INSERT', 'REPLACE', 'TRUNCATE', 'ALTER', 'CREATE', 'RENAME', 'GRANT', 'REVOKE', 'CALL', 'DO', 'LOAD', 'SET'].includes(token)) {
            return {
              valid: false,
              error: 'SQL_MUTATION_PROHIBITED',
              reason: `Forbidden keyword '${token}' detected in read-only query`
            };
          }
        } else if (firstKeyword === 'EXPLAIN') {
          if (['DROP', 'UPDATE', 'DELETE', 'INSERT', 'ALTER', 'CREATE', 'TRUNCATE', 'GRANT', 'REVOKE'].includes(token)) {
            // EXPLAIN on mutations is blocked to prevent accidental execution risk
            return {
              valid: false,
              error: 'SQL_MUTATION_PROHIBITED',
              reason: `EXPLAIN on mutation statement '${token}' is prohibited in read-only runner`
            };
          }
        } else if (firstKeyword === 'SHOW') {
          // SHOW statements are strictly validated by the positive APPROVED_SHOW_PREFIXES allowlist in rule 8
        } else {
          if (token !== firstKeyword && ['DROP', 'UPDATE', 'DELETE', 'INSERT', 'ALTER', 'CREATE', 'TRUNCATE', 'GRANT', 'REVOKE', 'SET'].includes(token)) {
            return {
              valid: false,
              error: 'SQL_MUTATION_PROHIBITED',
              reason: `Forbidden keyword '${token}' detected in ${firstKeyword} query`
            };
          }
        }
      }
    }

    // Statement type mapping
    let statementType: 'SELECT' | 'WITH' | 'SHOW' | 'DESCRIBE' | 'DESC' | 'EXPLAIN' = 'SELECT';
    if (firstKeyword === 'WITH') statementType = 'WITH';
    else if (firstKeyword === 'SHOW') statementType = 'SHOW';
    else if (firstKeyword === 'DESCRIBE') statementType = 'DESCRIBE';
    else if (firstKeyword === 'DESC') statementType = 'DESC';
    else if (firstKeyword === 'EXPLAIN') statementType = 'EXPLAIN';

    return {
      valid: true,
      statementType,
      cleanedSql: analysis.cleanedSql.replace(/;+$/, '').trim()
    };
  }

  /**
   * Validates a SQL query string against ZdexCloud Controlled Write Mode Policy.
   * Allows only single-statement, bounded, non-destructive INSERT and UPDATE queries
   * targeting non-protected tables with mandatory non-trivial WHERE clauses for UPDATE.
   */
  public static validateControlledWriteQuery(rawSql: string): SqlControlledWriteValidationResult {
    // 1. Basic format & length bounds
    if (!rawSql || typeof rawSql !== 'string') {
      return {
        valid: false,
        error: 'SQL_EMPTY',
        reason: 'SQL query text must be a non-empty string'
      };
    }

    const trimmed = rawSql.trim();
    if (trimmed.length === 0) {
      return {
        valid: false,
        error: 'SQL_EMPTY',
        reason: 'SQL query text cannot be empty or whitespace only'
      };
    }

    if (trimmed.length > MAX_SQL_LENGTH) {
      return {
        valid: false,
        error: 'SQL_LENGTH_EXCEEDED',
        reason: `SQL query exceeds maximum allowed length of ${MAX_SQL_LENGTH} characters`
      };
    }

    // 2. Lexical & token analysis
    const analysis = sanitizeAndTokenizeSql(trimmed);

    if (analysis.hasUnclosedQuote) {
      return {
        valid: false,
        error: 'SQL_SYNTAX_ERROR',
        reason: 'SQL query contains unclosed string literal or quoted identifier'
      };
    }

    if (analysis.hasUnclosedComment) {
      return {
        valid: false,
        error: 'SQL_SYNTAX_ERROR',
        reason: 'SQL query contains unclosed block comment'
      };
    }

    // 3. Multi-statement execution rejection
    if (analysis.hasMultiStatements) {
      return {
        valid: false,
        error: 'SQL_MULTI_STATEMENT_PROHIBITED',
        reason: 'Multi-statement execution is strictly forbidden. Execute only one SQL statement per request.'
      };
    }

    if (analysis.tokens.length === 0) {
      return {
        valid: false,
        error: 'SQL_EMPTY',
        reason: 'No executable SQL tokens found after stripping comments'
      };
    }

    // 4. Initial Statement Keyword Validation
    const firstKeyword = analysis.tokens[0].toUpperCase();

    if (firstKeyword === 'DELETE') {
      return {
        valid: false,
        error: 'SQL_DELETE_PROHIBITED',
        reason: 'DELETE statements are not permitted in Controlled Write Mode (requires Phase 15.7 Destructive Query Protection)'
      };
    }

    if (['DROP', 'TRUNCATE', 'ALTER', 'CREATE', 'RENAME'].includes(firstKeyword)) {
      return {
        valid: false,
        error: 'SQL_DDL_PROHIBITED',
        reason: `DDL statement type '${firstKeyword}' is strictly prohibited in SQL runner`
      };
    }

    if (['GRANT', 'REVOKE'].includes(firstKeyword)) {
      return {
        valid: false,
        error: 'SQL_DCL_PROHIBITED',
        reason: `DCL statement type '${firstKeyword}' is strictly prohibited in SQL runner`
      };
    }

    if (['SELECT', 'WITH', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN'].includes(firstKeyword)) {
      return {
        valid: false,
        error: 'SQL_READ_ONLY_IN_WRITE_MODE',
        reason: `Read-only statement type '${firstKeyword}' must be executed using Read-Only Mode (/admin/sql/query)`
      };
    }

    if (firstKeyword !== 'INSERT' && firstKeyword !== 'UPDATE') {
      return {
        valid: false,
        error: 'SQL_WRITE_DISALLOWED_OPERATION',
        reason: `Statement type '${firstKeyword}' is not permitted in Controlled Write Mode. Only INSERT and UPDATE statements are supported.`
      };
    }

    // 5. User Variables / Session State Mutation Rejection
    if (analysis.hasUserVariable) {
      return {
        valid: false,
        error: 'SQL_USER_VARIABLE_PROHIBITED',
        reason: 'User variables (@var, :=) and session-state mutation are prohibited in Controlled Write Mode'
      };
    }

    // 6. MySQL Specific Side-Effect Protections (Outfile, Dumpfile)
    if (analysis.hasOutfileOrDumpfile) {
      return {
        valid: false,
        error: 'SQL_INTO_OUTFILE_PROHIBITED',
        reason: 'INTO OUTFILE / DUMPFILE constructs are strictly forbidden'
      };
    }

    // 7. Abusive Function Rejection (SLEEP, BENCHMARK, LOAD_FILE, Locks)
    if (analysis.abusiveFunctionsFound.length > 0) {
      const fn = analysis.abusiveFunctionsFound[0];
      return {
        valid: false,
        error: 'SQL_ABUSIVE_FUNCTION_PROHIBITED',
        reason: `Function '${fn}()' is prohibited in Controlled Write Mode (resource abuse / side-effect protection)`
      };
    }

    // 8. Semantic Sensitive Column Identifier Protection
    if (analysis.sensitiveColumnsFound.length > 0) {
      const col = analysis.sensitiveColumnsFound[0];
      return {
        valid: false,
        error: 'SQL_SENSITIVE_COLUMN_PROHIBITED',
        reason: `Direct or transformed access/mutation to sensitive column '${col}' is prohibited in Controlled Write Mode`
      };
    }

    const upperTokens = analysis.tokens.map(t => t.toUpperCase());

    // 9. Transaction control statement keyword rejection
    for (const token of upperTokens) {
      if (['START', 'COMMIT', 'ROLLBACK', 'SAVEPOINT'].includes(token)) {
        return {
          valid: false,
          error: 'SQL_TRANSACTION_CONTROL_PROHIBITED',
          reason: `Explicit transaction control statement '${token}' is prohibited (transactions are automatically managed by backend)`
        };
      }
      if (['DROP', 'TRUNCATE', 'ALTER', 'CREATE', 'RENAME', 'GRANT', 'REVOKE', 'DELETE', 'CALL', 'DO', 'LOAD', 'HANDLER', 'PREPARE', 'EXECUTE', 'DEALLOCATE', 'LOCK', 'UNLOCK', 'SHUTDOWN', 'KILL', 'FLUSH', 'RESET', 'PURGE'].includes(token)) {
        return {
          valid: false,
          error: 'SQL_MUTATION_PROHIBITED',
          reason: `Forbidden keyword '${token}' detected in write query`
        };
      }
    }

    let targetTable = '';

    // 10. Statement-Specific Rules
    if (firstKeyword === 'INSERT') {
      // Reject INSERT ... SELECT
      if (upperTokens.includes('SELECT')) {
        return {
          valid: false,
          error: 'SQL_INSERT_SELECT_PROHIBITED',
          reason: 'INSERT ... SELECT operations are prohibited in Controlled Write Mode'
        };
      }

      // Extract target table
      if (upperTokens[1] === 'INTO') {
        targetTable = analysis.tokens[2] || '';
      } else {
        targetTable = analysis.tokens[1] || '';
      }
    } else if (firstKeyword === 'UPDATE') {
      // Mandatory WHERE clause
      const whereIdx = upperTokens.indexOf('WHERE');
      if (whereIdx === -1) {
        return {
          valid: false,
          error: 'SQL_UPDATE_MISSING_WHERE',
          reason: 'UPDATE statements must include an explicit WHERE clause to prevent accidental table-wide modifications'
        };
      }

      // Check for trivial WHERE clause (e.g. WHERE 1=1, WHERE 1, WHERE TRUE)
      const tokensAfterWhere = upperTokens.slice(whereIdx + 1).filter(t => t !== '(' && t !== ')');
      if (tokensAfterWhere.length === 0) {
        return {
          valid: false,
          error: 'SQL_UPDATE_TRIVIAL_WHERE',
          reason: 'UPDATE WHERE clause cannot be empty'
        };
      }

      const whereJoined = tokensAfterWhere.join('');
      if (
        whereJoined === '1=1' ||
        whereJoined === '1' ||
        whereJoined === 'TRUE' ||
        whereJoined === "''=''" ||
        whereJoined === '0=0' ||
        whereJoined === '""=""'
      ) {
        return {
          valid: false,
          error: 'SQL_UPDATE_TRIVIAL_WHERE',
          reason: 'UPDATE WHERE clause cannot be trivially true (e.g. 1=1 or TRUE)'
        };
      }

      targetTable = analysis.tokens[1] || '';
    }

    // 11. Normalize and validate Target Table against PROTECTED_TABLE_NAMES
    let normalizedTable = targetTable.trim();
    if (normalizedTable.includes('.')) {
      const parts = normalizedTable.split('.');
      normalizedTable = parts[parts.length - 1];
    }
    normalizedTable = normalizedTable.replace(/[`"']/g, '').trim().toUpperCase();

    if (!normalizedTable) {
      return {
        valid: false,
        error: 'SQL_TARGET_TABLE_MISSING',
        reason: 'Could not determine target table name for write operation'
      };
    }

    if (PROTECTED_TABLE_NAMES.has(normalizedTable)) {
      return {
        valid: false,
        error: 'SQL_WRITE_PROTECTED_TABLE',
        reason: `Modifications to protected system/security table '${targetTable}' are strictly forbidden`
      };
    }

    return {
      valid: true,
      statementType: firstKeyword as 'INSERT' | 'UPDATE',
      targetTable: normalizedTable,
      cleanedSql: analysis.cleanedSql.replace(/;+$/, '').trim()
    };
  }

  /**
   * Validates a SQL query string against ZdexCloud Destructive Query Policy (Phase 15.7).
   * Allows ONLY single-statement, bounded DELETE queries targeting non-protected tables
   * with mandatory non-trivial WHERE clauses.
   * Prohibits TRUNCATE, DROP, ALTER, RENAME, CREATE, GRANT, REVOKE, multi-table DELETEs,
   * DELETE JOIN, DELETE USING, subqueries, user variables, and protected tables.
   */
  public static validateDestructiveQuery(rawSql: string): SqlDestructiveValidationResult {
    // 1. Basic format & length bounds
    if (!rawSql || typeof rawSql !== 'string') {
      return {
        valid: false,
        error: 'SQL_EMPTY',
        reason: 'SQL query text must be a non-empty string'
      };
    }

    const trimmed = rawSql.trim();
    if (trimmed.length === 0) {
      return {
        valid: false,
        error: 'SQL_EMPTY',
        reason: 'SQL query text cannot be empty or whitespace only'
      };
    }

    if (trimmed.length > MAX_SQL_LENGTH) {
      return {
        valid: false,
        error: 'SQL_LENGTH_EXCEEDED',
        reason: `SQL query exceeds maximum allowed length of ${MAX_SQL_LENGTH} characters`
      };
    }

    // 2. Lexical & token analysis
    const analysis = sanitizeAndTokenizeSql(trimmed);

    if (analysis.hasUnclosedQuote) {
      return {
        valid: false,
        error: 'SQL_SYNTAX_ERROR',
        reason: 'SQL query contains unclosed string literal or quoted identifier'
      };
    }

    if (analysis.hasUnclosedComment) {
      return {
        valid: false,
        error: 'SQL_SYNTAX_ERROR',
        reason: 'SQL query contains unclosed block comment'
      };
    }

    // 3. Multi-statement execution rejection
    if (analysis.hasMultiStatements) {
      return {
        valid: false,
        error: 'SQL_MULTI_STATEMENT_PROHIBITED',
        reason: 'Multi-statement execution is strictly forbidden. Execute only one SQL statement per request.'
      };
    }

    if (analysis.tokens.length === 0) {
      return {
        valid: false,
        error: 'SQL_EMPTY',
        reason: 'No executable SQL tokens found after stripping comments'
      };
    }

    // 4. Initial Statement Keyword Validation
    const firstKeyword = analysis.tokens[0].toUpperCase();

    if (firstKeyword === 'TRUNCATE') {
      return {
        valid: false,
        error: 'SQL_TRUNCATE_PROHIBITED',
        reason: 'TRUNCATE operations are prohibited. Use bounded DELETE with an explicit WHERE clause.'
      };
    }

    if (['DROP', 'ALTER', 'CREATE', 'RENAME'].includes(firstKeyword)) {
      return {
        valid: false,
        error: 'SQL_DDL_PROHIBITED',
        reason: `DDL statement type '${firstKeyword}' is strictly prohibited in destructive SQL runner`
      };
    }

    if (['GRANT', 'REVOKE'].includes(firstKeyword)) {
      return {
        valid: false,
        error: 'SQL_DCL_PROHIBITED',
        reason: `DCL statement type '${firstKeyword}' is strictly prohibited in destructive SQL runner`
      };
    }

    if (['SELECT', 'WITH', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN'].includes(firstKeyword)) {
      return {
        valid: false,
        error: 'SQL_READ_ONLY_IN_DESTRUCTIVE_MODE',
        reason: `Read-only statement type '${firstKeyword}' must be executed using Read-Only Mode (/admin/sql/query)`
      };
    }

    if (['INSERT', 'UPDATE'].includes(firstKeyword)) {
      return {
        valid: false,
        error: 'SQL_WRITE_IN_DESTRUCTIVE_MODE',
        reason: `Non-destructive write statement type '${firstKeyword}' must be executed using Controlled Write Mode (/admin/sql/write)`
      };
    }

    if (firstKeyword !== 'DELETE') {
      return {
        valid: false,
        error: 'SQL_DESTRUCTIVE_DISALLOWED_OPERATION',
        reason: `Statement type '${firstKeyword}' is not permitted in Destructive Mode. Only single-statement DELETE queries are supported.`
      };
    }

    // 5. User Variables / Session State Mutation Rejection
    if (analysis.hasUserVariable) {
      return {
        valid: false,
        error: 'SQL_USER_VARIABLE_PROHIBITED',
        reason: 'User variables (@var, :=) and session-state mutation are prohibited in Destructive Mode'
      };
    }

    // 6. MySQL Specific Side-Effect Protections (Outfile, Dumpfile)
    if (analysis.hasOutfileOrDumpfile) {
      return {
        valid: false,
        error: 'SQL_INTO_OUTFILE_PROHIBITED',
        reason: 'INTO OUTFILE / DUMPFILE constructs are strictly forbidden'
      };
    }

    // 7. Abusive Function Rejection (SLEEP, BENCHMARK, LOAD_FILE, Locks)
    if (analysis.abusiveFunctionsFound.length > 0) {
      const fn = analysis.abusiveFunctionsFound[0];
      return {
        valid: false,
        error: 'SQL_ABUSIVE_FUNCTION_PROHIBITED',
        reason: `Function '${fn}()' is prohibited in Destructive Mode (resource abuse / side-effect protection)`
      };
    }

    // 8. Semantic Sensitive Column Identifier Protection
    if (analysis.sensitiveColumnsFound.length > 0) {
      const col = analysis.sensitiveColumnsFound[0];
      return {
        valid: false,
        error: 'SQL_SENSITIVE_COLUMN_PROHIBITED',
        reason: `Direct or transformed access/mutation to sensitive column '${col}' is prohibited in Destructive Mode`
      };
    }

    const upperTokens = analysis.tokens.map(t => t.toUpperCase());

    // 9. Prohibited keyword and construct checks
    for (const token of upperTokens) {
      if (['START', 'COMMIT', 'ROLLBACK', 'SAVEPOINT'].includes(token)) {
        return {
          valid: false,
          error: 'SQL_TRANSACTION_CONTROL_PROHIBITED',
          reason: `Explicit transaction control statement '${token}' is prohibited (transactions are automatically managed by backend)`
        };
      }
      if (['DROP', 'TRUNCATE', 'ALTER', 'CREATE', 'RENAME', 'GRANT', 'REVOKE', 'CALL', 'DO', 'LOAD', 'HANDLER', 'PREPARE', 'EXECUTE', 'DEALLOCATE', 'LOCK', 'UNLOCK', 'SHUTDOWN', 'KILL', 'FLUSH', 'RESET', 'PURGE'].includes(token)) {
        return {
          valid: false,
          error: 'SQL_DESTRUCTIVE_DISALLOWED_OPERATION',
          reason: `Forbidden keyword '${token}' detected in destructive query`
        };
      }
      if (token === 'JOIN' || token === 'INNER' || token === 'LEFT' || token === 'RIGHT' || token === 'CROSS' || token === 'STRAIGHT_JOIN') {
        return {
          valid: false,
          error: 'SQL_DELETE_JOIN_PROHIBITED',
          reason: 'Multi-table DELETE JOIN constructs are prohibited in Destructive Mode'
        };
      }
      if (token === 'USING') {
        return {
          valid: false,
          error: 'SQL_DELETE_USING_PROHIBITED',
          reason: 'DELETE ... USING constructs are prohibited in Destructive Mode'
        };
      }
      if (token === 'SELECT') {
        return {
          valid: false,
          error: 'SQL_DELETE_SUBQUERY_PROHIBITED',
          reason: 'Subqueries inside DELETE statements are prohibited in Destructive Mode'
        };
      }
    }

    // 10. Syntax Structure & Target Table Extraction
    // Expected syntax: DELETE FROM <table> [alias] WHERE <predicate> [LIMIT n]
    if (upperTokens[1] !== 'FROM') {
      return {
        valid: false,
        error: 'SQL_MULTI_TABLE_DELETE_PROHIBITED',
        reason: 'DELETE statements must adhere to single-table syntax: DELETE FROM <table> WHERE ...'
      };
    }

    const rawTargetTable = analysis.tokens[2] || '';
    if (!rawTargetTable) {
      return {
        valid: false,
        error: 'SQL_TARGET_TABLE_MISSING',
        reason: 'Could not determine target table name for DELETE operation'
      };
    }

    // Check if multiple comma-separated tables after FROM
    if (analysis.tokens.length > 3 && analysis.tokens[3] === ',') {
      return {
        valid: false,
        error: 'SQL_MULTI_TABLE_DELETE_PROHIBITED',
        reason: 'Multi-table DELETE syntax is strictly prohibited'
      };
    }

    // 11. Mandatory WHERE Clause & Trivial Predicate Hardening
    const whereIdx = upperTokens.indexOf('WHERE');
    if (whereIdx === -1) {
      return {
        valid: false,
        error: 'SQL_DELETE_MISSING_WHERE',
        reason: 'DELETE statements must include an explicit WHERE clause to prevent accidental table-wide data loss'
      };
    }

    // Extract raw predicate text from cleanedSql after the WHERE token
    const whereMatch = analysis.cleanedSql.match(/\bWHERE\s+([\s\S]+)$/i);
    if (!whereMatch || !whereMatch[1] || whereMatch[1].trim().length === 0) {
      return {
        valid: false,
        error: 'SQL_DELETE_MISSING_WHERE',
        reason: 'DELETE WHERE clause cannot be empty'
      };
    }

    const rawWherePredicate = whereMatch[1].trim().replace(/;+$/, '').trim();
    const normalizedPredicate = rawWherePredicate.replace(/\s+/g, '').replace(/[()]/g, '').toUpperCase();

    if (
      normalizedPredicate === '1=1' ||
      normalizedPredicate === '1' ||
      normalizedPredicate === 'TRUE' ||
      normalizedPredicate === "'A'='A'" ||
      normalizedPredicate === "'1'='1'" ||
      normalizedPredicate === "''=''" ||
      normalizedPredicate === '""=""' ||
      normalizedPredicate === '0=0' ||
      normalizedPredicate === 'NOTFALSE' ||
      normalizedPredicate === 'NULLISNULL' ||
      normalizedPredicate === '1ISNOTNULL' ||
      normalizedPredicate === '1=1OR1=1'
    ) {
      return {
        valid: false,
        error: 'SQL_DELETE_TRIVIAL_WHERE',
        reason: 'DELETE WHERE clause cannot be trivially true (e.g. 1=1 or TRUE)'
      };
    }

    // 12. Authoritative Target Table Classification & Safety Verification
    const classification = getDestructiveTableClassification(rawTargetTable);

    if (!classification.destructiveEligible) {
      return {
        valid: false,
        error: classification.rejectionCode || 'DESTRUCTIVE_DELETE_NOT_ALLOWED',
        reason: classification.rejectionReason || `Destructive DELETE against table '${rawTargetTable}' is prohibited by security policy`
      };
    }

    return {
      valid: true,
      statementType: 'DELETE',
      targetTable: classification.normalizedTable,
      cleanedSql: analysis.cleanedSql.replace(/;+$/, '').trim()
    };
  }
}

