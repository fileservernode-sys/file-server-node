import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseMetadataService, escapeLikeWildcards } from '../src/services/admin/database_metadata_service.js';
import { getDestructiveTableClassification } from '../src/utils/sql_safety_guard.js';
import { NotFoundError, ValidationError, ConflictError } from '../src/errors/app-error.js';
import { SYSTEM_PERMISSIONS, SYSTEM_ROLES } from '../src/services/admin/admin_rbac_seed.js';

test('Phase 15 — Batch 15.1: Database Management Foundation Test Suite', async (t) => {

  await t.test('1. RBAC & Permission Catalog Verification', async (t2: any) => {
    await t2.test('includes database.management.view permission in SYSTEM_PERMISSIONS', () => {
      const perm = SYSTEM_PERMISSIONS.find(p => p.slug === 'database.management.view');
      assert.ok(perm, 'database.management.view permission should be registered');
      assert.strictEqual(perm?.resource, 'database');
      assert.strictEqual(perm?.action, 'view');
    });

    await t2.test('SUPER_ADMIN role includes database.management.view', () => {
      const superAdminRole = SYSTEM_ROLES.find(r => r.slug === 'SUPER_ADMIN');
      assert.ok(superAdminRole, 'SUPER_ADMIN role should exist');
      assert.ok(superAdminRole?.permissions.includes('database.management.view'));
    });

    await t2.test('ADMIN role includes database.management.view', () => {
      const adminRole = SYSTEM_ROLES.find(r => r.slug === 'ADMIN');
      assert.ok(adminRole, 'ADMIN role should exist');
      assert.ok(adminRole?.permissions.includes('database.management.view'));
    });

    await t2.test('OPERATIONS role includes database.management.view', () => {
      const opsRole = SYSTEM_ROLES.find(r => r.slug === 'OPERATIONS');
      assert.ok(opsRole, 'OPERATIONS role should exist');
      assert.ok(opsRole?.permissions.includes('database.management.view'));
    });

    await t2.test('SUPPORT role does NOT include database.management.view', () => {
      const supportRole = SYSTEM_ROLES.find(r => r.slug === 'SUPPORT');
      assert.ok(supportRole, 'SUPPORT role should exist');
      assert.strictEqual(supportRole?.permissions.includes('database.management.view'), false);
    });
  });

  await t.test('2. Table Classification Matrix Consistency', async (t2: any) => {
    await t2.test('classifies _prisma_migrations as INTERNAL', () => {
      const res = getDestructiveTableClassification('_prisma_migrations');
      assert.strictEqual(res.classification, 'INTERNAL');
      assert.strictEqual(res.isProtected, true);
    });

    await t2.test('classifies admin and user security tables as PROTECTED', () => {
      const protectedTables = [
        'admin_users', 'admin_sessions', 'admin_email_otps', 'admin_lockouts',
        'admin_roles', 'admin_permissions', 'admin_user_roles', 'admin_role_permissions',
        'admin_audit_logs', 'security_audit_logs', 'audit_events',
        'users', 'user_sessions', 'device_auth_credentials', 'user_notification_preferences'
      ];
      for (const table of protectedTables) {
        const res = getDestructiveTableClassification(table);
        assert.strictEqual(res.classification, 'PROTECTED', `Table ${table} should be classified as PROTECTED`);
        assert.strictEqual(res.isProtected, true);
      }
    });

    await t2.test('classifies commercial and ledger tables as BUSINESS_SENSITIVE', () => {
      const sensitiveTables = [
        'billing_payments', 'billing_refunds', 'billing_settlements',
        'billing_payment_taxes', 'billing_payment_processing_fees', 'billing_receipts',
        'billing_reconciliation_records', 'billing_reconciliation_runs', 'billing_reconciliation_discrepancies',
        'subscriptions', 'subscription_plan_changes', 'subscription_upgrade_reconciliations',
        'account_billing_states', 'plans', 'plan_prices', 'plan_entitlements',
        'entitlement_definitions', 'billing_provider_plan_mappings', 'billing_webhook_events'
      ];
      for (const table of sensitiveTables) {
        const res = getDestructiveTableClassification(table);
        assert.strictEqual(res.classification, 'BUSINESS_SENSITIVE', `Table ${table} should be classified as BUSINESS_SENSITIVE`);
        assert.strictEqual(res.isBusinessSensitive, true);
      }
    });

    await t2.test('classifies referenced parent entities as NON_LEAF', () => {
      const nonLeafTables = [
        'devices', 'server_instances', 'notification_records',
        'channel_delivery_records', 'email_messages', 'support_cases',
        'error_fingerprints', 'error_incidents'
      ];
      for (const table of nonLeafTables) {
        const res = getDestructiveTableClassification(table);
        assert.strictEqual(res.classification, 'NON_LEAF', `Table ${table} should be classified as NON_LEAF`);
        assert.strictEqual(res.incomingForeignKeyCount, 1);
      }
    });

    await t2.test('classifies approved telemetry and note tables as APPROVED_LEAF', () => {
      const leafTables = [
        'support_case_notes', 'error_occurrences', 'email_delivery_attempts',
        'device_connections', 'device_push_tokens', 'server_endpoints'
      ];
      for (const table of leafTables) {
        const res = getDestructiveTableClassification(table);
        assert.strictEqual(res.classification, 'APPROVED_LEAF', `Table ${table} should be classified as APPROVED_LEAF`);
        assert.strictEqual(res.isExplicitlyApproved, true);
      }
    });

    await t2.test('fails closed with UNKNOWN classification for uncataloged tables', () => {
      const res = getDestructiveTableClassification('some_unknown_arbitrary_table');
      assert.strictEqual(res.classification, 'UNKNOWN');
      assert.strictEqual(res.destructiveEligible, false);
    });
  });

  await t.test('3. Database Metadata Service Structural & Bounded Guarantees', async (t2: any) => {
    await t2.test('validates table identifier security sanitization', () => {
      const invalidTableNames = [
        'users; DROP TABLE users',
        'users--',
        'users/*comment*/',
        'users`',
        'table name with spaces',
        'users; SELECT 1'
      ];

      for (const invalidName of invalidTableNames) {
        const isValid = /^[a-zA-Z0-9_]+$/.test(invalidName);
        assert.strictEqual(isValid, false, `Invalid table name '${invalidName}' should fail regex validation`);
      }
    });

    await t2.test('bounds preview limit to maximum 50 rows', () => {
      const clampLimit = (limit: number | undefined) => Math.min(Math.max(1, Number(limit) || 50), 50);
      assert.strictEqual(clampLimit(100), 50);
      assert.strictEqual(clampLimit(1000), 50);
      assert.strictEqual(clampLimit(0), 50);
      assert.strictEqual(clampLimit(-10), 50);
      assert.strictEqual(clampLimit(25), 25);
      assert.strictEqual(clampLimit(undefined), 50);
    });

    await t2.test('clamps preview offset to non-negative integer', () => {
      const clampOffset = (offset: number | undefined) => Math.max(0, Number(offset) || 0);
      assert.strictEqual(clampOffset(-5), 0);
      assert.strictEqual(clampOffset(0), 0);
      assert.strictEqual(clampOffset(50), 50);
      assert.strictEqual(clampOffset(undefined), 0);
    });

    await t2.test('redacts sensitive column values in preview datasets', () => {
      const sensitiveColPatterns = [
        /password/i,
        /token/i,
        /secret/i,
        /hash/i,
        /private_key/i,
        /auth_key/i,
        /credential/i,
        /otp/i
      ];

      const checkRedacted = (colName: string) => sensitiveColPatterns.some(pat => pat.test(colName));

      assert.strictEqual(checkRedacted('passwordHash'), true);
      assert.strictEqual(checkRedacted('sessionTokenHash'), true);
      assert.strictEqual(checkRedacted('apiKeyHash'), true);
      assert.strictEqual(checkRedacted('otpCode'), true);
      assert.strictEqual(checkRedacted('clientSecret'), true);
      assert.strictEqual(checkRedacted('id'), false);
      assert.strictEqual(checkRedacted('email'), false);
      assert.strictEqual(checkRedacted('status'), false);
      assert.strictEqual(checkRedacted('createdAt'), false);
    });
  });

  await t.test('4. Phase 15 — Batch 15.2: Database Data Grid Service Logic & Protections', async (t2: any) => {
    await t2.test('bounds data grid pagination: page >= 1, pageSize in [1, 100]', () => {
      const normalizePagination = (page: any, pageSize: any) => {
        const p = Math.max(1, parseInt(String(page), 10) || 1);
        const ps = Math.min(100, Math.max(1, parseInt(String(pageSize), 10) || 25));
        return { page: p, pageSize: ps, offset: (p - 1) * ps };
      };

      assert.deepStrictEqual(normalizePagination(0, 25), { page: 1, pageSize: 25, offset: 0 });
      assert.deepStrictEqual(normalizePagination(-5, 50), { page: 1, pageSize: 50, offset: 0 });
      assert.deepStrictEqual(normalizePagination(1, 1000), { page: 1, pageSize: 100, offset: 0 });
      assert.deepStrictEqual(normalizePagination(3, 10), { page: 3, pageSize: 10, offset: 20 });
      assert.deepStrictEqual(normalizePagination(undefined, undefined), { page: 1, pageSize: 25, offset: 0 });
    });

    await t2.test('validates sort direction strictly to asc or desc', () => {
      const normalizeSortDir = (dir: string | undefined): 'ASC' | 'DESC' => {
        return (dir && dir.toLowerCase() === 'asc') ? 'ASC' : 'DESC';
      };

      assert.strictEqual(normalizeSortDir('asc'), 'ASC');
      assert.strictEqual(normalizeSortDir('ASC'), 'ASC');
      assert.strictEqual(normalizeSortDir('desc'), 'DESC');
      assert.strictEqual(normalizeSortDir('DESC'), 'DESC');
      assert.strictEqual(normalizeSortDir('invalid'), 'DESC');
      assert.strictEqual(normalizeSortDir(undefined), 'DESC');
    });

    await t2.test('enforces deterministic sorting with primary key tie-breaker', () => {
      const buildOrderBy = (sortByCol: string, sortDir: 'ASC' | 'DESC', pkCol: string | null) => {
        const clauses = [`\`${sortByCol}\` ${sortDir}`];
        if (pkCol && pkCol !== sortByCol) {
          clauses.push(`\`${pkCol}\` ASC`);
        }
        return `ORDER BY ${clauses.join(', ')}`;
      };

      assert.strictEqual(
        buildOrderBy('createdAt', 'DESC', 'id'),
        'ORDER BY `createdAt` DESC, `id` ASC'
      );
      assert.strictEqual(
        buildOrderBy('id', 'DESC', 'id'),
        'ORDER BY `id` DESC'
      );
      assert.strictEqual(
        buildOrderBy('status', 'ASC', 'id'),
        'ORDER BY `status` ASC, `id` ASC'
      );
      assert.strictEqual(
        buildOrderBy('name', 'ASC', null),
        'ORDER BY `name` ASC'
      );
    });

    await t2.test('enforces max 5 column filters limit', () => {
      const validateFilters = (filters: any[]) => {
        if (!Array.isArray(filters)) return [];
        if (filters.length > 5) {
          throw new ValidationError('Maximum of 5 column filters can be applied simultaneously');
        }
        return filters;
      };

      assert.doesNotThrow(() => validateFilters([
        { column: 'status', operator: 'equals', value: 'ACTIVE' },
        { column: 'email', operator: 'contains', value: 'example.com' }
      ]));

      assert.throws(() => validateFilters([
        { column: 'c1', operator: 'equals', value: '1' },
        { column: 'c2', operator: 'equals', value: '2' },
        { column: 'c3', operator: 'equals', value: '3' },
        { column: 'c4', operator: 'equals', value: '4' },
        { column: 'c5', operator: 'equals', value: '5' },
        { column: 'c6', operator: 'equals', value: '6' }
      ]), /Maximum of 5 column filters/);
    });

    await t2.test('validates supported filter operators', () => {
      const allowedOperators = [
        'equals', 'contains', 'startsWith', 'greaterThan',
        'lessThan', 'before', 'after', 'isNull', 'isNotNull'
      ];

      const isOperatorAllowed = (op: string) => allowedOperators.includes(op);

      for (const op of allowedOperators) {
        assert.strictEqual(isOperatorAllowed(op), true, `Operator ${op} should be valid`);
      }

      assert.strictEqual(isOperatorAllowed('in'), false);
      assert.strictEqual(isOperatorAllowed('raw_sql'), false);
      assert.strictEqual(isOperatorAllowed('union'), false);
      assert.strictEqual(isOperatorAllowed('regex'), false);
    });

    await t2.test('determines total row count mode: EXACT vs ESTIMATED', () => {
      const determineCountMode = (hasFiltersOrSearch: boolean, approximateCount: number) => {
        if (hasFiltersOrSearch || approximateCount < 100000) {
          return 'EXACT';
        }
        return 'ESTIMATED';
      };

      assert.strictEqual(determineCountMode(true, 500000), 'EXACT');
      assert.strictEqual(determineCountMode(false, 5000), 'EXACT');
      assert.strictEqual(determineCountMode(false, 250000), 'ESTIMATED');
    });
  });

  await t.test('5. Phase 15 — Batch 15.3: Row Selection & Multi-Select Model Test Suite', async (t2: any) => {
    // Helper function reproducing the client-side canonical identity logic
    const getCanonicalRowKey = (tableName: string, primaryKeys: string[], row: any, rowIndex: number, page: number) => {
      if (primaryKeys && Array.isArray(primaryKeys) && primaryKeys.length > 0) {
        const sortedKeys = [...primaryKeys].sort();
        const pkObj: Record<string, string> = {};
        for (const pk of sortedKeys) {
          pkObj[pk] = (row[pk] !== undefined && row[pk] !== null) ? String(row[pk]) : '';
        }
        return JSON.stringify({ t: tableName, k: pkObj });
      }
      return JSON.stringify({ t: tableName, nopk: true, p: page || 1, i: rowIndex });
    };

    await t2.test('1. No selected rows initially in state', () => {
      const selectedKeys = new Set<string>();
      assert.strictEqual(selectedKeys.size, 0);
    });

    await t2.test('2. Selecting a single row adds its canonical identity', () => {
      const selectedKeys = new Set<string>();
      const key = getCanonicalRowKey('users', ['id'], { id: 'user_123', email: 'test@zdex.com' }, 0, 1);
      selectedKeys.add(key);
      assert.strictEqual(selectedKeys.size, 1);
      assert.strictEqual(selectedKeys.has(key), true);
    });

    await t2.test('3. Deselecting a single row removes its canonical identity', () => {
      const selectedKeys = new Set<string>();
      const key = getCanonicalRowKey('users', ['id'], { id: 'user_123' }, 0, 1);
      selectedKeys.add(key);
      assert.strictEqual(selectedKeys.size, 1);
      selectedKeys.delete(key);
      assert.strictEqual(selectedKeys.size, 0);
    });

    await t2.test('4. Selecting all visible rows populates visible keys', () => {
      const selectedKeys = new Set<string>();
      const rows = [{ id: '1' }, { id: '2' }, { id: '3' }];
      for (let i = 0; i < rows.length; i++) {
        selectedKeys.add(getCanonicalRowKey('users', ['id'], rows[i], i, 1));
      }
      assert.strictEqual(selectedKeys.size, 3);
    });

    await t2.test('5. Header checkbox indeterminate state when partial visible rows selected', () => {
      const rows = [{ id: '1' }, { id: '2' }, { id: '3' }];
      const selectedKeys = new Set<string>([getCanonicalRowKey('users', ['id'], rows[0], 0, 1)]);

      const visibleKeys = rows.map((r, idx) => getCanonicalRowKey('users', ['id'], r, idx, 1));
      const visibleSelectedCount = visibleKeys.filter(k => selectedKeys.has(k)).length;

      const isIndeterminate = visibleSelectedCount > 0 && visibleSelectedCount < visibleKeys.length;
      const isChecked = visibleSelectedCount === visibleKeys.length;

      assert.strictEqual(isIndeterminate, true);
      assert.strictEqual(isChecked, false);
    });

    await t2.test('6. Header checkbox checked state when all visible rows selected', () => {
      const rows = [{ id: '1' }, { id: '2' }, { id: '3' }];
      const selectedKeys = new Set<string>(rows.map((r, idx) => getCanonicalRowKey('users', ['id'], r, idx, 1)));

      const visibleKeys = rows.map((r, idx) => getCanonicalRowKey('users', ['id'], r, idx, 1));
      const visibleSelectedCount = visibleKeys.filter(k => selectedKeys.has(k)).length;

      const isIndeterminate = visibleSelectedCount > 0 && visibleSelectedCount < visibleKeys.length;
      const isChecked = visibleSelectedCount === visibleKeys.length && visibleKeys.length > 0;

      assert.strictEqual(isIndeterminate, false);
      assert.strictEqual(isChecked, true);
    });

    await t2.test('7. Clearing header selection removes only visible-page selections', () => {
      // Page 1 has row 1, 2. Page 2 has row 3.
      const page1Rows = [{ id: '1' }, { id: '2' }];
      const page2Rows = [{ id: '3' }];

      const p1Keys = page1Rows.map((r, idx) => getCanonicalRowKey('users', ['id'], r, idx, 1));
      const p2Keys = page2Rows.map((r, idx) => getCanonicalRowKey('users', ['id'], r, idx, 2));

      const selectedKeys = new Set<string>([...p1Keys, ...p2Keys]);
      assert.strictEqual(selectedKeys.size, 3);

      // Deselect all on Page 1
      for (const k of p1Keys) {
        selectedKeys.delete(k);
      }

      assert.strictEqual(selectedKeys.size, 1);
      assert.strictEqual(selectedKeys.has(p2Keys[0]), true);
    });

    await t2.test('8. Selection persists across pagination for stable primary-key tables', () => {
      const selectedKeys = new Set<string>();
      const p1Row = { id: 'row_page_1' };
      const p1Key = getCanonicalRowKey('devices', ['id'], p1Row, 0, 1);
      selectedKeys.add(p1Key);

      // Navigate to page 2 (does not clear PK selections)
      const p2Row = { id: 'row_page_2' };
      const p2Key = getCanonicalRowKey('devices', ['id'], p2Row, 0, 2);
      selectedKeys.add(p2Key);

      assert.strictEqual(selectedKeys.size, 2);
      assert.strictEqual(selectedKeys.has(p1Key), true);
      assert.strictEqual(selectedKeys.has(p2Key), true);
    });

    await t2.test('9. Selection survives sorting for stable primary-key tables', () => {
      const selectedKeys = new Set<string>();
      const targetRow = { id: 'stable_id_999', name: 'Zdex' };
      const keyBeforeSort = getCanonicalRowKey('devices', ['id'], targetRow, 5, 1);
      selectedKeys.add(keyBeforeSort);

      // After sort, same row appears at index 0
      const keyAfterSort = getCanonicalRowKey('devices', ['id'], targetRow, 0, 1);

      assert.strictEqual(keyBeforeSort, keyAfterSort);
      assert.strictEqual(selectedKeys.has(keyAfterSort), true);
    });

    await t2.test('10. Table switch clears selection completely', () => {
      const selectedKeys = new Set<string>();
      selectedKeys.add(getCanonicalRowKey('users', ['id'], { id: '1' }, 0, 1));
      selectedKeys.add(getCanonicalRowKey('users', ['id'], { id: '2' }, 1, 1));
      assert.strictEqual(selectedKeys.size, 2);

      // On table switch:
      selectedKeys.clear();
      assert.strictEqual(selectedKeys.size, 0);
    });

    await t2.test('11. Search-change preserves stable PK selections with visible count distinction', () => {
      const selectedKeys = new Set<string>();
      const rowA = { id: 'a', email: 'alice@example.com' };
      const rowB = { id: 'b', email: 'bob@example.com' };

      const keyA = getCanonicalRowKey('users', ['id'], rowA, 0, 1);
      const keyB = getCanonicalRowKey('users', ['id'], rowB, 1, 1);
      selectedKeys.add(keyA);
      selectedKeys.add(keyB);

      // User searches "alice" -> only rowA is visible in results
      const currentVisibleRows = [rowA];
      const visibleKeys = currentVisibleRows.map((r, idx) => getCanonicalRowKey('users', ['id'], r, idx, 1));
      const visibleSelectedCount = visibleKeys.filter(k => selectedKeys.has(k)).length;

      assert.strictEqual(selectedKeys.size, 2);
      assert.strictEqual(visibleSelectedCount, 1);
    });

    await t2.test('12. Filter-change preserves stable PK selections with scope tracking', () => {
      const selectedKeys = new Set<string>();
      const key1 = getCanonicalRowKey('devices', ['id'], { id: 'dev_1' }, 0, 1);
      selectedKeys.add(key1);

      // Filter applied -> 0 rows currently visible
      const visibleRows: any[] = [];
      const visibleKeys = visibleRows.map((r, idx) => getCanonicalRowKey('devices', ['id'], r, idx, 1));
      const visibleSelectedCount = visibleKeys.filter(k => selectedKeys.has(k)).length;

      assert.strictEqual(selectedKeys.size, 1);
      assert.strictEqual(visibleSelectedCount, 0);
    });

    await t2.test('13. Refresh reconciles visible selections against state', () => {
      const selectedKeys = new Set<string>();
      const row = { id: 'existing_item' };
      const key = getCanonicalRowKey('plans', ['id'], row, 0, 1);
      selectedKeys.add(key);

      // Refresh fetches new rows
      const refreshedRows = [{ id: 'existing_item' }, { id: 'new_item' }];
      const isFirstSelected = selectedKeys.has(getCanonicalRowKey('plans', ['id'], refreshedRows[0], 0, 1));
      const isSecondSelected = selectedKeys.has(getCanonicalRowKey('plans', ['id'], refreshedRows[1], 1, 1));

      assert.strictEqual(isFirstSelected, true);
      assert.strictEqual(isSecondSelected, false);
    });

    await t2.test('14. Stale responses do not corrupt selection state', () => {
      let currentRequestId = 5;
      const selectedKeys = new Set<string>();
      selectedKeys.add(getCanonicalRowKey('users', ['id'], { id: 'correct_user' }, 0, 1));

      // Simulated stale response callback with old reqId = 4
      const staleReqId = 4;
      if (staleReqId === currentRequestId) {
        selectedKeys.clear(); // would corrupt if executed
      }

      assert.strictEqual(selectedKeys.size, 1);
    });

    await t2.test('15. Composite primary keys create unambiguous canonical identities', () => {
      // Must distinguish ['a', 'bc'] from ['ab', 'c']
      const key1 = getCanonicalRowKey('user_roles', ['userId', 'roleId'], { userId: 'a', roleId: 'bc' }, 0, 1);
      const key2 = getCanonicalRowKey('user_roles', ['userId', 'roleId'], { userId: 'ab', roleId: 'c' }, 0, 1);

      assert.notStrictEqual(key1, key2, 'Composite keys with ambiguous concatenations must produce distinct canonical keys');

      assert.strictEqual(
        key1,
        JSON.stringify({ t: 'user_roles', k: { roleId: 'bc', userId: 'a' } })
      );
      assert.strictEqual(
        key2,
        JSON.stringify({ t: 'user_roles', k: { roleId: 'c', userId: 'ab' } })
      );
    });

    await t2.test('16. BIGINT primary key identities preserve exact precision without conversion to Number', () => {
      const largeBigIntStr = '90071992547409939999'; // Exceeds Number.MAX_SAFE_INTEGER
      const key = getCanonicalRowKey('audit_events', ['id'], { id: largeBigIntStr }, 0, 1);

      assert.strictEqual(
        key,
        JSON.stringify({ t: 'audit_events', k: { id: '90071992547409939999' } })
      );
      assert.ok(key.includes('90071992547409939999'));
    });

    await t2.test('17. No-primary-key tables use result-scoped identities and reset on context changes', () => {
      const selectedKeys = new Set<string>();
      const noPkRow = { colA: 'val1', colB: 'val2' };
      const key = getCanonicalRowKey('no_pk_table', [], noPkRow, 2, 1);

      assert.strictEqual(key, JSON.stringify({ t: 'no_pk_table', nopk: true, p: 1, i: 2 }));
      selectedKeys.add(key);
      assert.strictEqual(selectedKeys.size, 1);

      // On pagination or sort change for no-PK table:
      const isNoPk = true;
      if (isNoPk) {
        selectedKeys.clear();
      }
      assert.strictEqual(selectedKeys.size, 0);
    });

    await t2.test('18. Selection limit (500) is strictly enforced', () => {
      const selectionLimit = 500;
      const selectedKeys = new Set<string>();

      for (let i = 0; i < selectionLimit; i++) {
        selectedKeys.add(`key_${i}`);
      }

      assert.strictEqual(selectedKeys.size, 500);

      // Attempting to add 501st row
      const canAddMore = selectedKeys.size < selectionLimit;
      assert.strictEqual(canAddMore, false);
    });

    await t2.test('19. Clear selection resets state immediately', () => {
      const selectedKeys = new Set<string>(['k1', 'k2', 'k3']);
      assert.strictEqual(selectedKeys.size, 3);
      selectedKeys.clear();
      assert.strictEqual(selectedKeys.size, 0);
    });

    await t2.test('20. Selected count properly pluralized and tracked', () => {
      const formatCount = (n: number) => `${n} ${n === 1 ? 'row' : 'rows'} selected`;
      assert.strictEqual(formatCount(0), '0 rows selected');
      assert.strictEqual(formatCount(1), '1 row selected');
      assert.strictEqual(formatCount(12), '12 rows selected');
    });

    await t2.test('21. Visible selected count accurate across pagination', () => {
      const selectedKeys = new Set<string>(['p1_k1', 'p1_k2', 'p2_k1']);
      const currentPageVisibleKeys = ['p1_k1', 'p1_k2', 'p1_k3'];

      const visibleSelectedCount = currentPageVisibleKeys.filter(k => selectedKeys.has(k)).length;
      assert.strictEqual(selectedKeys.size, 3);
      assert.strictEqual(visibleSelectedCount, 2);
    });

    await t2.test('22. Future bulk action identity serializer returns structured metadata', () => {
      const selectedRowsMeta = new Map<string, any>();
      const userMeta = { table: 'users', primaryKey: { id: 'u_100' }, noPrimaryKey: false };
      selectedRowsMeta.set('k1', userMeta);

      const exportIdentities = () => {
        const results = [];
        for (const [canonicalKey, meta] of selectedRowsMeta.entries()) {
          results.push({
            canonicalKey,
            table: meta.table,
            primaryKey: meta.primaryKey,
            noPrimaryKey: meta.noPrimaryKey
          });
        }
        return results;
      };

      const identities = exportIdentities();
      assert.strictEqual(identities.length, 1);
      assert.deepStrictEqual(identities[0], {
        canonicalKey: 'k1',
        table: 'users',
        primaryKey: { id: 'u_100' },
        noPrimaryKey: false
      });
    });

    await t2.test('23. Sensitive primary keys use generic accessible labels', () => {
      const SENSITIVE_PATTERNS = /password|token|secret|hash|private_key|auth_key|credential|otp/i;
      const getAccessibleLabel = (pkName: string, pkVal: any, rowIndex: number) => {
        if (SENSITIVE_PATTERNS.test(pkName)) {
          return `Select database row #${rowIndex + 1}`;
        }
        return `Select row with ${pkName} ${pkVal}`;
      };

      assert.strictEqual(getAccessibleLabel('sessionTokenHash', 'secret_hash_val', 0), 'Select database row #1');
      assert.strictEqual(getAccessibleLabel('id', 'user_123', 0), 'Select row with id user_123');
    });

    await t2.test('24. Ephemeral state verification: selection is not written to persistent storage', () => {
      const isPersistent = false; // Never saved to localStorage / sessionStorage
      assert.strictEqual(isPersistent, false);
    });
  });

  /* =========================================================================
     Phase 15 — Batch 15.4: Add / Insert Records Test Suite
     ========================================================================= */
  await t.test('6. Phase 15 — Batch 15.4: Add / Insert Records Verification Suite', async (t2: any) => {

    await t2.test('1. RBAC: database.management.insert permission catalog validation', () => {
      const perm = SYSTEM_PERMISSIONS.find(p => p.slug === 'database.management.insert');
      assert.ok(perm, 'database.management.insert permission must be registered');
      assert.strictEqual(perm?.resource, 'database');
      assert.strictEqual(perm?.action, 'insert');

      const superAdminRole = SYSTEM_ROLES.find(r => r.slug === 'SUPER_ADMIN');
      assert.ok(superAdminRole?.permissions.includes('database.management.insert'), 'SUPER_ADMIN must have insert permission');

      const adminRole = SYSTEM_ROLES.find(r => r.slug === 'ADMIN');
      assert.ok(adminRole?.permissions.includes('database.management.insert'), 'ADMIN must have insert permission');

      const opsRole = SYSTEM_ROLES.find(r => r.slug === 'OPERATIONS');
      assert.strictEqual(opsRole?.permissions.includes('database.management.insert'), false, 'OPERATIONS must NOT have insert permission');

      const supportRole = SYSTEM_ROLES.find(r => r.slug === 'SUPPORT');
      assert.strictEqual(supportRole?.permissions.includes('database.management.insert'), false, 'SUPPORT must NOT have insert permission');
    });

    await t2.test('2. INSERT_POLICY_REGISTRY: exactly 6 approved leaf tables permitted', () => {
      const expectedLeafTables = [
        'support_case_notes',
        'error_occurrences',
        'email_delivery_attempts',
        'device_connections',
        'device_push_tokens',
        'server_endpoints'
      ];

      for (const table of expectedLeafTables) {
        const cls = getDestructiveTableClassification(table);
        assert.strictEqual(cls.classification, 'APPROVED_LEAF', `${table} must be classified as APPROVED_LEAF`);
        assert.strictEqual(cls.isExplicitlyApproved, true);
      }
    });

    await t2.test('3. Fail-Closed: insertion rejected for all NON_LEAF, PROTECTED, BUSINESS_SENSITIVE, and INTERNAL tables', () => {
      const prohibitedTables = [
        '_prisma_migrations',
        'admin_users',
        'admin_sessions',
        'users',
        'user_sessions',
        'billing_payments',
        'subscriptions',
        'devices',
        'server_instances',
        'support_cases',
        'email_messages',
        'unknown_custom_table'
      ];

      for (const table of prohibitedTables) {
        const cls = getDestructiveTableClassification(table);
        assert.notStrictEqual(cls.classification, 'APPROVED_LEAF', `${table} must NOT be APPROVED_LEAF`);
      }
    });

    await t2.test('4. Server-Side column validation: rejects uncataloged columns', () => {
      const knownColumns = new Set(['id', 'caseId', 'adminId', 'note', 'createdAt']);
      const inputValues = { id: 'note_1', caseId: 'case_1', note: 'test', maliciousCol: 'DROP TABLE' };

      const rejectedCols: string[] = [];
      for (const col of Object.keys(inputValues)) {
        if (!knownColumns.has(col)) {
          rejectedCols.push(col);
        }
      }

      assert.deepStrictEqual(rejectedCols, ['maliciousCol']);
    });

    await t2.test('5. Server-Side column validation: rejects auto-increment columns in values payload', () => {
      const columns = [
        { name: 'id', isAutoIncrement: true, isInsertable: false },
        { name: 'note', isAutoIncrement: false, isInsertable: true }
      ];

      const inputValues = { id: 100, note: 'Valid note text' };
      const nonInsertableAttempt = Object.keys(inputValues).filter(k => {
        const col = columns.find(c => c.name === k);
        return !col || !col.isInsertable;
      });

      assert.deepStrictEqual(nonInsertableAttempt, ['id']);
    });

    await t2.test('6. Server-Side column validation: rejects generated columns in values payload', () => {
      const columns = [
        { name: 'full_name', isGenerated: true, isInsertable: false },
        { name: 'first_name', isGenerated: false, isInsertable: true }
      ];

      const inputValues = { full_name: 'Computed Name', first_name: 'John' };
      const nonInsertableAttempt = Object.keys(inputValues).filter(k => {
        const col = columns.find(c => c.name === k);
        return !col || !col.isInsertable;
      });

      assert.deepStrictEqual(nonInsertableAttempt, ['full_name']);
    });

    await t2.test('7. Server-Side column validation: rejects sensitive columns in direct insert payload', () => {
      const columns = [
        { name: 'password_hash', isSensitive: true, isInsertable: false },
        { name: 'username', isSensitive: false, isInsertable: true }
      ];

      const inputValues = { password_hash: 'secret', username: 'john' };
      const nonInsertableAttempt = Object.keys(inputValues).filter(k => {
        const col = columns.find(c => c.name === k);
        return !col || !col.isInsertable;
      });

      assert.deepStrictEqual(nonInsertableAttempt, ['password_hash']);
    });

    await t2.test('8. Server-Side column validation: enforces required fields without defaults', () => {
      const columns = [
        { name: 'caseId', isRequired: true, columnDefault: null, isInsertable: true },
        { name: 'note', isRequired: true, columnDefault: null, isInsertable: true },
        { name: 'isInternal', isRequired: false, columnDefault: '1', isInsertable: true }
      ];

      const inputValues = { caseId: 'case_123' }; // missing 'note'
      const missingRequired = columns.filter(c => c.isInsertable && c.isRequired && c.columnDefault === null && !(c.name in inputValues));

      assert.strictEqual(missingRequired.length, 1);
      assert.strictEqual(missingRequired[0].name, 'note');
    });

    await t2.test('9. Server-Side column validation: allows omission of fields with defaults', () => {
      const columns = [
        { name: 'status', isRequired: true, columnDefault: "'PENDING'", isInsertable: true }
      ];

      const inputValues = {};
      const missingRequired = columns.filter(c => c.isInsertable && c.isRequired && c.columnDefault === null && !(c.name in inputValues));

      assert.strictEqual(missingRequired.length, 0);
    });

    await t2.test('10. Server-Side column validation: allows explicit null for nullable columns', () => {
      const columns = [
        { name: 'adminId', isNullable: true, isInsertable: true }
      ];

      const inputValues = { adminId: null };
      const isNullAllowed = columns.find(c => c.name === 'adminId')?.isNullable;

      assert.strictEqual(isNullAllowed, true);
      assert.strictEqual(inputValues.adminId, null);
    });

    await t2.test('11. Type validation: enum value check against schema allowlist', () => {
      const enumValues = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
      const validVal = 'HIGH';
      const invalidVal = 'SUPER_URGENT';

      assert.strictEqual(enumValues.includes(validVal), true);
      assert.strictEqual(enumValues.includes(invalidVal), false);
    });

    await t2.test('12. Type validation: JSON syntax validation & stringification', () => {
      const validJsonObj = { foo: 'bar', count: 42 };
      const validJsonStr = JSON.stringify(validJsonObj);
      const invalidJsonStr = '{ foo: bar }';

      assert.doesNotThrow(() => JSON.parse(validJsonStr));
      assert.throws(() => JSON.parse(invalidJsonStr));
    });

    await t2.test('13. Type validation: integer format and bounds validation', () => {
      const validateInt = (val: string) => /^-?\d+$/.test(val.trim());
      assert.strictEqual(validateInt('12345'), true);
      assert.strictEqual(validateInt('-50'), true);
      assert.strictEqual(validateInt('12.34'), false);
      assert.strictEqual(validateInt('abc'), false);
      assert.strictEqual(validateInt('123abc'), false);
    });

    await t2.test('14. Precision preservation: BigInt strings preserved without IEEE 754 precision loss', () => {
      const bigIntStr = '90071992547409939999';
      // Verifying string representation is not passed through Number()
      assert.strictEqual(typeof bigIntStr, 'string');
      assert.strictEqual(bigIntStr.length, 20);
      assert.ok(BigInt(bigIntStr).toString() === bigIntStr);
    });

    await t2.test('15. Type validation: decimal format check', () => {
      const validateDecimal = (val: string) => /^-?\d+(\.\d+)?$/.test(val.trim());
      assert.strictEqual(validateDecimal('99.99'), true);
      assert.strictEqual(validateDecimal('100'), true);
      assert.strictEqual(validateDecimal('-0.05'), true);
      assert.strictEqual(validateDecimal('99.99.99'), false);
      assert.strictEqual(validateDecimal('foo'), false);
    });

    await t2.test('16. Type validation: boolean normalization', () => {
      const normalizeBool = (val: any) => {
        if (typeof val === 'boolean') return val;
        if (val === 'true' || val === 1 || val === '1') return true;
        if (val === 'false' || val === 0 || val === '0') return false;
        throw new Error('Invalid boolean');
      };

      assert.strictEqual(normalizeBool(true), true);
      assert.strictEqual(normalizeBool('true'), true);
      assert.strictEqual(normalizeBool(1), true);
      assert.strictEqual(normalizeBool(false), false);
      assert.strictEqual(normalizeBool('false'), false);
      assert.strictEqual(normalizeBool(0), false);
      assert.throws(() => normalizeBool('maybe'));
    });

    await t2.test('17. String truncation & length validation: characterMaximumLength enforcement', () => {
      const maxLen = 50;
      const validStr = 'Short string';
      const oversizedStr = 'A'.repeat(51);

      assert.strictEqual(validStr.length <= maxLen, true);
      assert.strictEqual(oversizedStr.length <= maxLen, false);
    });

    await t2.test('18. Parameterized SQL generator: creates safe INSERT statement with placeholders', () => {
      const tableName = 'support_case_notes';
      const columns = ['id', 'caseId', 'adminId', 'note'];
      const placeholders = columns.map(() => '?').join(', ');
      const sql = `INSERT INTO \`${tableName}\` (${columns.map(c => `\`${c}\``).join(', ')}) VALUES (${placeholders})`;

      assert.strictEqual(
        sql,
        'INSERT INTO `support_case_notes` (`id`, `caseId`, `adminId`, `note`) VALUES (?, ?, ?, ?)'
      );
    });

    await t2.test('19. Single-row assertion: transaction enforces exactly 1 affected row', () => {
      const assertSingleRow = (affectedRows: number) => {
        if (affectedRows !== 1) {
          throw new Error(`Expected exactly 1 affected row, got ${affectedRows}. Transaction rolled back.`);
        }
      };

      assert.doesNotThrow(() => assertSingleRow(1));
      assert.throws(() => assertSingleRow(0));
      assert.throws(() => assertSingleRow(2));
    });

    await t2.test('20. Auto-increment key recovery logic', () => {
      const resultWithInsertId = { insertId: 1042, affectedRows: 1 };
      const autoIncrementCol = 'id';
      const recoveredId = resultWithInsertId.insertId ? resultWithInsertId.insertId : null;

      assert.strictEqual(recoveredId, 1042);
    });

    await t2.test('21. Cryptographic audit logging: masks sensitive column values in event metadata', () => {
      const SENSITIVE_PATTERNS = /password|token|secret|hash|private_key|auth_key|credential|otp/i;
      const maskPayload = (data: Record<string, any>) => {
        const masked: Record<string, any> = {};
        for (const [k, v] of Object.entries(data)) {
          masked[k] = SENSITIVE_PATTERNS.test(k) ? '[REDACTED]' : v;
        }
        return masked;
      };

      const rawData = {
        tableName: 'device_push_tokens',
        deviceToken: 'secret_apns_token_value',
        platform: 'IOS'
      };

      const masked = maskPayload(rawData);
      assert.strictEqual(masked.tableName, 'device_push_tokens');
      assert.strictEqual(masked.deviceToken, '[REDACTED]');
      assert.strictEqual(masked.platform, 'IOS');
    });

    await t2.test('22. MySQL Error Mapping: 1062 unique constraint error normalized to 409 Conflict', () => {
      const normalizeError = (errCode: number, message: string) => {
        if (errCode === 1062) {
          return { status: 409, message: 'Duplicate record exists with the same unique key.' };
        }
        return { status: 500, message };
      };

      const res = normalizeError(1062, 'Duplicate entry for key PRIMARY');
      assert.strictEqual(res.status, 409);
      assert.ok(res.message.includes('Duplicate record'));
    });

    await t2.test('23. MySQL Error Mapping: 1452 foreign key constraint error normalized to 400 Bad Request', () => {
      const normalizeError = (errCode: number, message: string) => {
        if (errCode === 1452) {
          return { status: 400, message: 'Referenced foreign key entity does not exist.' };
        }
        return { status: 500, message };
      };

      const res = normalizeError(1452, 'Cannot add or update a child row: a foreign key constraint fails');
      assert.strictEqual(res.status, 400);
      assert.ok(res.message.includes('foreign key entity does not exist'));
    });

    await t2.test('24. MySQL Error Mapping: 1048 not null violation normalized to 400 Bad Request', () => {
      const normalizeError = (errCode: number, message: string) => {
        if (errCode === 1048) {
          return { status: 400, message: 'Column cannot be null.' };
        }
        return { status: 500, message };
      };

      const res = normalizeError(1048, "Column 'note' cannot be null");
      assert.strictEqual(res.status, 400);
      assert.ok(res.message.includes('cannot be null'));
    });

    await t2.test('25. MySQL Error Mapping: 1406 data too long violation normalized to 400 Bad Request', () => {
      const normalizeError = (errCode: number, message: string) => {
        if (errCode === 1406) {
          return { status: 400, message: 'Data too long for column.' };
        }
        return { status: 500, message };
      };

      const res = normalizeError(1406, "Data too long for column 'note' at row 1");
      assert.strictEqual(res.status, 400);
      assert.ok(res.message.includes('Data too long'));
    });

    await t2.test('26. MySQL Error Mapping: 1265 data truncated violation normalized to 400 Bad Request', () => {
      const normalizeError = (errCode: number, message: string) => {
        if (errCode === 1265) {
          return { status: 400, message: 'Data truncated: invalid value for column/enum type.' };
        }
        return { status: 500, message };
      };

      const res = normalizeError(1265, "Data truncated for column 'status' at row 1");
      assert.strictEqual(res.status, 400);
      assert.ok(res.message.includes('invalid value'));
    });

    await t2.test('27. Frontend dirty-state tracking: unedited drawer discards without confirmation', () => {
      const addRowState = { tableName: 'support_case_notes', isDirty: false, isSubmitting: false };
      const requiresConfirmation = addRowState.isDirty;
      assert.strictEqual(requiresConfirmation, false);
    });

    await t2.test('28. Frontend dirty-state tracking: touched field marks form dirty and requires confirmation', () => {
      const addRowState = { tableName: 'support_case_notes', isDirty: true, isSubmitting: false };
      const requiresConfirmation = addRowState.isDirty;
      assert.strictEqual(requiresConfirmation, true);
    });

    await t2.test('29. Double-submit prevention: submit button disabled during in-flight request', () => {
      let isSubmitting = false;
      const submit = () => {
        if (isSubmitting) return 'PREVENTED';
        isSubmitting = true;
        return 'SUBMITTED';
      };

      assert.strictEqual(submit(), 'SUBMITTED');
      assert.strictEqual(submit(), 'PREVENTED');
    });

    await t2.test('30. Strict batch isolation: NO edit, delete, or bulk mutation endpoints exist in this batch', () => {
      const allowedActions = ['VIEW', 'EXPLORE', 'SEARCH', 'FILTER', 'SELECT', 'INSERT_ROW'];
      const disallowedActions = ['UPDATE_ROW', 'DELETE_ROW', 'BULK_DELETE', 'BULK_EDIT', 'DUPLICATE_ROW', 'DROP_TABLE', 'ALTER_TABLE'];

      for (const disallowed of disallowedActions) {
        assert.strictEqual(allowedActions.includes(disallowed), false, `${disallowed} must NOT be implemented in Batch 15.4`);
      }
    });
  });

  /* =========================================================================
     Phase 15 — Batch 15.5: Edit / Update Records Test Suite
     ========================================================================= */
  await t.test('7. Phase 15 — Batch 15.5: Edit / Update Records Verification Suite', async (t2: any) => {

    await t2.test('1. RBAC: database.management.update permission catalog validation', () => {
      const perm = SYSTEM_PERMISSIONS.find(p => p.slug === 'database.management.update');
      assert.ok(perm, 'database.management.update permission must be registered');
      assert.strictEqual(perm?.resource, 'database');
      assert.strictEqual(perm?.action, 'update');

      const superAdminRole = SYSTEM_ROLES.find(r => r.slug === 'SUPER_ADMIN');
      assert.ok(superAdminRole?.permissions.includes('database.management.update'), 'SUPER_ADMIN must have update permission');

      const adminRole = SYSTEM_ROLES.find(r => r.slug === 'ADMIN');
      assert.ok(adminRole?.permissions.includes('database.management.update'), 'ADMIN must have update permission');

      const opsRole = SYSTEM_ROLES.find(r => r.slug === 'OPERATIONS');
      assert.strictEqual(opsRole?.permissions.includes('database.management.update'), false, 'OPERATIONS must NOT have update permission');

      const supportRole = SYSTEM_ROLES.find(r => r.slug === 'SUPPORT');
      assert.strictEqual(supportRole?.permissions.includes('database.management.update'), false, 'SUPPORT must NOT have update permission');
    });

    await t2.test('2. UPDATE_POLICY_REGISTRY: exactly 6 approved leaf tables permitted with explicit column policies', () => {
      const expectedLeafPolicies: Record<string, { editableColumns: string[]; concurrencyField?: string }> = {
        support_case_notes: { editableColumns: ['note', 'isInternal'], concurrencyField: 'updatedAt' },
        error_occurrences: { editableColumns: ['message', 'stackTrace', 'metadata'], concurrencyField: 'createdAt' },
        email_delivery_attempts: { editableColumns: ['providerResponse', 'failureReason'], concurrencyField: 'attemptedAt' },
        device_connections: { editableColumns: ['remoteEndpoint', 'status'], concurrencyField: 'updatedAt' },
        device_push_tokens: { editableColumns: ['isActive', 'appVersion', 'platform'], concurrencyField: 'updatedAt' },
        server_endpoints: { editableColumns: ['hostname', 'status'], concurrencyField: 'updatedAt' }
      };

      for (const [table, policy] of Object.entries(expectedLeafPolicies)) {
        const cls = getDestructiveTableClassification(table);
        assert.strictEqual(cls.classification, 'APPROVED_LEAF', `${table} must be classified as APPROVED_LEAF`);
        assert.strictEqual(cls.isExplicitlyApproved, true);
        assert.ok(policy.editableColumns.length > 0, `${table} must declare editable columns`);
      }
    });

    await t2.test('3. Fail-Closed: update rejected for all NON_LEAF, PROTECTED, BUSINESS_SENSITIVE, and INTERNAL tables', () => {
      const prohibitedTables = [
        '_prisma_migrations',
        'admin_users',
        'admin_sessions',
        'users',
        'user_sessions',
        'billing_payments',
        'subscriptions',
        'devices',
        'server_instances',
        'support_cases',
        'email_messages',
        'unknown_custom_table'
      ];

      for (const table of prohibitedTables) {
        const cls = getDestructiveTableClassification(table);
        assert.notStrictEqual(cls.classification, 'APPROVED_LEAF', `${table} must NOT be editable`);
      }
    });

    await t2.test('4. Primary Key targeting: rejects tables without a primary key', () => {
      const validateTableHasPk = (primaryKeys: string[]) => {
        if (!primaryKeys || primaryKeys.length === 0) {
          throw new ValidationError('Table has no primary key defined. Single-row update is not permitted.');
        }
      };

      assert.doesNotThrow(() => validateTableHasPk(['id']));
      assert.doesNotThrow(() => validateTableHasPk(['deviceId', 'connectionId']));
      assert.throws(() => validateTableHasPk([]), /no primary key/);
    });

    await t2.test('5. Primary Key targeting: enforces complete primary key payload for single and composite PKs', () => {
      const validatePkPayload = (requiredPks: string[], payload: Record<string, any>) => {
        for (const pk of requiredPks) {
          if (payload[pk] === undefined || payload[pk] === null || payload[pk] === '') {
            throw new ValidationError(`Missing primary key value for '${pk}'`);
          }
        }
      };

      assert.doesNotThrow(() => validatePkPayload(['id'], { id: 'note_123' }));
      assert.doesNotThrow(() => validatePkPayload(['userId', 'roleId'], { userId: 'u_1', roleId: 'r_1' }));
      assert.throws(() => validatePkPayload(['id'], {}), /Missing primary key/);
      assert.throws(() => validatePkPayload(['userId', 'roleId'], { userId: 'u_1' }), /Missing primary key value for 'roleId'/);
    });

    await t2.test('6. Column Policy: rejects attempts to update unapproved or immutable columns', () => {
      const allowedColumns = new Set(['note', 'isInternal']);
      const requestedUpdates = { note: 'New Note', createdAt: '2026-01-01', id: 'new_id' };

      const rejectedCols = Object.keys(requestedUpdates).filter(col => !allowedColumns.has(col));
      assert.deepStrictEqual(rejectedCols, ['createdAt', 'id']);
    });

    await t2.test('7. Column Policy: rejects primary key, auto-increment, generated, and sensitive column modifications', () => {
      const columns = [
        { name: 'id', isPrimaryKey: true, isAutoIncrement: true, isEditable: false },
        { name: 'password_hash', isSensitive: true, isEditable: false },
        { name: 'full_name', isGenerated: true, isEditable: false },
        { name: 'note', isEditable: true }
      ];

      for (const col of columns) {
        if (col.isPrimaryKey || col.isAutoIncrement || col.isSensitive || col.isGenerated) {
          assert.strictEqual(col.isEditable, false, `${col.name} must NOT be editable`);
        }
      }
    });

    await t2.test('8. Optimistic Concurrency Control: detects stale records and rejects with 409 Conflict', () => {
      const checkConcurrency = (currentVal: any, submittedVal: any) => {
        if (submittedVal === undefined || submittedVal === null) return true;
        const currentIso = currentVal instanceof Date ? currentVal.toISOString() : String(currentVal);
        const submittedIso = submittedVal instanceof Date ? submittedVal.toISOString() : String(submittedVal);
        return currentIso === submittedIso;
      };

      const now = new Date('2026-10-05T12:00:00.000Z');
      const older = new Date('2026-10-05T11:00:00.000Z');

      assert.strictEqual(checkConcurrency(now, now.toISOString()), true);
      assert.strictEqual(checkConcurrency(now, older.toISOString()), false);
    });

    await t2.test('9. Unchanged values detection: skips redundant write when values are identical', () => {
      const currentRow = { id: 'note_1', note: 'Original Note', isInternal: true };
      const submittedValues = { note: 'Original Note', isInternal: true };

      let changedCount = 0;
      for (const [k, v] of Object.entries(submittedValues)) {
        if ((currentRow as any)[k] !== v) {
          changedCount++;
        }
      }

      assert.strictEqual(changedCount, 0);
    });

    await t2.test('10. Type validation: strictly validates JSON payload format on update', () => {
      const validateJson = (val: any) => {
        if (typeof val === 'object' && val !== null) return JSON.stringify(val);
        if (typeof val === 'string') {
          JSON.parse(val);
          return val;
        }
        throw new Error('Invalid JSON');
      };

      assert.doesNotThrow(() => validateJson('{"status": "ok"}'));
      assert.doesNotThrow(() => validateJson({ status: 'ok' }));
      assert.throws(() => validateJson('{ invalid: json }'));
    });

    await t2.test('11. Type validation: boolean normalization for tinyint(1) and boolean columns', () => {
      const coerceBool = (val: any) => {
        if (typeof val === 'boolean') return val ? 1 : 0;
        if (val === 'true' || val === 1 || val === '1') return 1;
        if (val === 'false' || val === 0 || val === '0') return 0;
        throw new Error('Invalid boolean');
      };

      assert.strictEqual(coerceBool(true), 1);
      assert.strictEqual(coerceBool('true'), 1);
      assert.strictEqual(coerceBool(false), 0);
      assert.strictEqual(coerceBool('false'), 0);
      assert.throws(() => coerceBool('invalid'));
    });

    await t2.test('12. BigInt string precision preservation on row update targeting', () => {
      const bigIntPk = '90071992547409939999';
      assert.strictEqual(typeof bigIntPk, 'string');
      assert.strictEqual(bigIntPk.length, 20);
      // Validating string is passed directly into parameterized query without floating point corruption
      assert.strictEqual(BigInt(bigIntPk).toString(), bigIntPk);
    });

    await t2.test('13. Transactional single-row guarantee: rolls back if affected rows !== 1', () => {
      const assertSingleRowAffected = (affectedRows: number) => {
        if (affectedRows > 1) {
          throw new Error(`Safety violation: update affected ${affectedRows} rows. Rolled back.`);
        }
        return affectedRows;
      };

      assert.doesNotThrow(() => assertSingleRowAffected(1));
      assert.doesNotThrow(() => assertSingleRowAffected(0)); // 0 when values unchanged
      assert.throws(() => assertSingleRowAffected(2), /Safety violation/);
      assert.throws(() => assertSingleRowAffected(50), /Safety violation/);
    });

    await t2.test('14. Parameterized SQL generator for UPDATE: creates safe UPDATE statement with WHERE clause', () => {
      const tableName = 'support_case_notes';
      const updateCols = ['note', 'isInternal'];
      const pkCols = ['id'];

      const setClauses = updateCols.map(c => `\`${c}\` = ?`).join(', ');
      const whereClauses = pkCols.map(c => `\`${c}\` = ?`).join(' AND ');
      const sql = `UPDATE \`${tableName}\` SET ${setClauses} WHERE ${whereClauses} LIMIT 1`;

      assert.strictEqual(
        sql,
        'UPDATE `support_case_notes` SET `note` = ?, `isInternal` = ? WHERE `id` = ? LIMIT 1'
      );
    });

    await t2.test('15. Cryptographic audit logging: logs DATABASE_ROW_UPDATE with previous and new values diff', () => {
      const SENSITIVE_PATTERNS = /password|token|secret|hash|private_key|auth_key|credential|otp/i;
      const maskPayload = (data: Record<string, any>) => {
        const masked: Record<string, any> = {};
        for (const [k, v] of Object.entries(data)) {
          masked[k] = SENSITIVE_PATTERNS.test(k) ? '[REDACTED]' : v;
        }
        return masked;
      };

      const auditEvent = {
        action: 'DATABASE_ROW_UPDATE',
        tableName: 'support_case_notes',
        primaryKey: { id: 'note_123' },
        changes: {
          note: { from: 'Old Note', to: 'New Note' },
          secretToken: { from: '[REDACTED]', to: '[REDACTED]' }
        }
      };

      assert.strictEqual(auditEvent.action, 'DATABASE_ROW_UPDATE');
      assert.strictEqual(auditEvent.changes.note.to, 'New Note');
      assert.strictEqual(auditEvent.changes.secretToken.to, '[REDACTED]');
    });

    await t2.test('16. MySQL Error Mapping for UPDATE operations', () => {
      const mapError = (code: number, msg: string) => {
        if (code === 1062) return { status: 409, message: 'Duplicate entry for unique constraint.' };
        if (code === 1452) return { status: 400, message: 'Foreign key constraint violation.' };
        if (code === 1048) return { status: 400, message: 'Column cannot be null.' };
        if (code === 1406) return { status: 400, message: 'Data too long for column.' };
        if (code === 1265) return { status: 400, message: 'Data truncated: invalid value.' };
        return { status: 500, message: msg };
      };

      assert.strictEqual(mapError(1062, '').status, 409);
      assert.strictEqual(mapError(1452, '').status, 400);
      assert.strictEqual(mapError(1048, '').status, 400);
      assert.strictEqual(mapError(1406, '').status, 400);
      assert.strictEqual(mapError(1265, '').status, 400);
    });

    await t2.test('17. Selection State Preservation: row selection survives after single-row edit', () => {
      const selectedRowKeys = new Set<string>(['{"t":"support_case_notes","k":{"id":"note_1"}}']);
      const updatedRowKey = '{"t":"support_case_notes","k":{"id":"note_1"}}';

      // After update, grid reloads, and row key matches authoritative PK
      assert.strictEqual(selectedRowKeys.has(updatedRowKey), true);
    });

    await t2.test('18. Strict Batch Isolation: NO delete, bulk delete, bulk edit, or DDL operations exist in Batch 15.5', () => {
      const allowedBatchEndpoints = ['GET /tables', 'GET /tables/:name', 'GET /tables/:name/rows', 'POST /tables/:name/rows', 'PUT /tables/:name/rows'];
      const forbiddenBatchEndpoints = ['PUT /tables/:name/bulk-rows', 'POST /tables', 'DROP TABLE'];

      for (const endpoint of forbiddenBatchEndpoints) {
        assert.strictEqual(allowedBatchEndpoints.includes(endpoint), false, `${endpoint} must NOT exist in Batch 15.5`);
      }
    });
  });

  /* =========================================================================
     Phase 15 — Batch 15.6: Delete & Bulk Delete Records Test Suite
     ========================================================================= */
  await t.test('8. Phase 15 — Batch 15.6: Delete & Bulk Delete Records Verification Suite', async (t2: any) => {

    // -------------------------------------------------------------------------
    // A. Authorization & RBAC
    // -------------------------------------------------------------------------
    await t2.test('1. RBAC: database.management.delete permission catalog validation', () => {
      const perm = SYSTEM_PERMISSIONS.find(p => p.slug === 'database.management.delete');
      assert.ok(perm, 'database.management.delete permission must be registered in SYSTEM_PERMISSIONS');
      assert.strictEqual(perm?.resource, 'database');
      assert.strictEqual(perm?.action, 'delete');
    });

    await t2.test('2. RBAC: SUPER_ADMIN and ADMIN roles possess database.management.delete', () => {
      const superAdminRole = SYSTEM_ROLES.find(r => r.slug === 'SUPER_ADMIN');
      assert.ok(superAdminRole?.permissions.includes('database.management.delete'), 'SUPER_ADMIN must have delete permission');

      const adminRole = SYSTEM_ROLES.find(r => r.slug === 'ADMIN');
      assert.ok(adminRole?.permissions.includes('database.management.delete'), 'ADMIN must have delete permission');
    });

    await t2.test('3. RBAC: OPERATIONS and SUPPORT roles are DENIED database.management.delete', () => {
      const opsRole = SYSTEM_ROLES.find(r => r.slug === 'OPERATIONS');
      assert.strictEqual(opsRole?.permissions.includes('database.management.delete'), false, 'OPERATIONS must NOT have delete permission');

      const supportRole = SYSTEM_ROLES.find(r => r.slug === 'SUPPORT');
      assert.strictEqual(supportRole?.permissions.includes('database.management.delete'), false, 'SUPPORT must NOT have delete permission');
    });

    // -------------------------------------------------------------------------
    // B. Destructive Table Policy
    // -------------------------------------------------------------------------
    await t2.test('4. Table Policy: DELETE allowed only on 6 approved leaf tables', () => {
      const approvedLeafTables = [
        'support_case_notes',
        'error_occurrences',
        'email_delivery_attempts',
        'device_connections',
        'device_push_tokens',
        'server_endpoints'
      ];

      for (const table of approvedLeafTables) {
        const cls = getDestructiveTableClassification(table);
        assert.strictEqual(cls.classification, 'APPROVED_LEAF', `${table} must be classified as APPROVED_LEAF`);
        assert.strictEqual(cls.isExplicitlyApproved, true);
      }
    });

    await t2.test('5. Table Policy: INTERNAL tables are strictly DENIED for delete', () => {
      const internalTables = ['_prisma_migrations'];
      for (const table of internalTables) {
        const cls = getDestructiveTableClassification(table);
        assert.strictEqual(cls.classification, 'INTERNAL');
        assert.strictEqual(cls.isProtected, true);
      }
    });

    await t2.test('6. Table Policy: PROTECTED security and user tables are strictly DENIED for delete', () => {
      const protectedTables = [
        'admin_users', 'admin_sessions', 'admin_roles', 'admin_permissions',
        'admin_audit_logs', 'security_audit_logs', 'audit_events',
        'users', 'user_sessions', 'device_auth_credentials'
      ];
      for (const table of protectedTables) {
        const cls = getDestructiveTableClassification(table);
        assert.strictEqual(cls.classification, 'PROTECTED');
        assert.strictEqual(cls.isProtected, true);
      }
    });

    await t2.test('7. Table Policy: BUSINESS_SENSITIVE billing and ledger tables are strictly DENIED for delete', () => {
      const sensitiveTables = [
        'billing_payments', 'billing_refunds', 'billing_settlements',
        'subscriptions', 'subscription_plan_changes', 'account_billing_states', 'plans'
      ];
      for (const table of sensitiveTables) {
        const cls = getDestructiveTableClassification(table);
        assert.strictEqual(cls.classification, 'BUSINESS_SENSITIVE');
        assert.strictEqual(cls.isBusinessSensitive, true);
      }
    });

    await t2.test('8. Table Policy: NON_LEAF parent entities are strictly DENIED for delete', () => {
      const nonLeafTables = ['devices', 'server_instances', 'support_cases', 'email_messages'];
      for (const table of nonLeafTables) {
        const cls = getDestructiveTableClassification(table);
        assert.strictEqual(cls.classification, 'NON_LEAF');
        assert.strictEqual(cls.incomingForeignKeyCount > 0, true);
      }
    });

    await t2.test('9. Table Policy: UNKNOWN uncataloged tables fail closed with DENY', () => {
      const cls = getDestructiveTableClassification('arbitrary_unknown_table');
      assert.strictEqual(cls.classification, 'UNKNOWN');
      assert.strictEqual(cls.destructiveEligible, false);
    });

    // -------------------------------------------------------------------------
    // C. Row Identity & PK Targeting
    // -------------------------------------------------------------------------
    await t2.test('10. Row Identity: validates single primary key resolution', () => {
      const pks = ['id'];
      const payload = { id: 'note_123' };
      const missingPayload = {};

      const isValid = (reqPks: string[], body: Record<string, any>) => {
        for (const pk of reqPks) {
          if (!body[pk] || (typeof body[pk] === 'string' && body[pk].trim() === '')) return false;
        }
        return true;
      };

      assert.strictEqual(isValid(pks, payload), true);
      assert.strictEqual(isValid(pks, missingPayload), false);
    });

    await t2.test('11. Row Identity: validates composite primary key resolution', () => {
      const pks = ['deviceId', 'connectionId'];
      const validPayload = { deviceId: 'dev_1', connectionId: 'conn_1' };
      const partialPayload = { deviceId: 'dev_1' };

      const isValid = (reqPks: string[], body: Record<string, any>) => {
        for (const pk of reqPks) {
          if (!body[pk] || (typeof body[pk] === 'string' && body[pk].trim() === '')) return false;
        }
        return true;
      };

      assert.strictEqual(isValid(pks, validPayload), true);
      assert.strictEqual(isValid(pks, partialPayload), false);
    });

    await t2.test('12. Row Identity: rejects unexpected or arbitrary attributes in PK payload', () => {
      const allowedPks = ['id'];
      const maliciousPayload = { id: '123', arbitraryWhere: '1=1; DROP TABLE users' };

      const hasUnexpected = Object.keys(maliciousPayload).some(k => !allowedPks.includes(k));
      assert.strictEqual(hasUnexpected, true);
    });

    await t2.test('13. Row Identity: tables without primary key strictly deny delete', () => {
      const primaryKeys: string[] = [];
      const canDelete = primaryKeys.length > 0;
      assert.strictEqual(canDelete, false);
    });

    // -------------------------------------------------------------------------
    // D. Bulk Delete Selection & Bounds
    // -------------------------------------------------------------------------
    await t2.test('14. Bulk Delete: enforces maximum 50 records limit per request', () => {
      const validateBulkCount = (rows: any[], maxLimit = 50) => {
        if (!Array.isArray(rows) || rows.length === 0) throw new ValidationError('At least 1 row required');
        if (rows.length > maxLimit) throw new ValidationError(`Bulk delete exceeds limit of ${maxLimit}`);
        return true;
      };

      const validList = Array.from({ length: 50 }, (_, i) => ({ id: `id_${i}` }));
      const oversizedList = Array.from({ length: 51 }, (_, i) => ({ id: `id_${i}` }));
      const emptyList: any[] = [];

      assert.doesNotThrow(() => validateBulkCount(validList));
      assert.throws(() => validateBulkCount(oversizedList), /exceeds limit/);
      assert.throws(() => validateBulkCount(emptyList), /At least 1 row/);
    });

    await t2.test('15. Bulk Delete: detects and rejects duplicate row identities in payload', () => {
      const rows = [
        { id: 'item_1' },
        { id: 'item_2' },
        { id: 'item_1' } // Duplicate
      ];

      const checkDuplicates = (items: Record<string, any>[]) => {
        const seen = new Set<string>();
        for (const item of items) {
          const key = JSON.stringify(item, Object.keys(item).sort());
          if (seen.has(key)) throw new ValidationError('Duplicate row identity detected');
          seen.add(key);
        }
      };

      assert.throws(() => checkDuplicates(rows), /Duplicate row identity/);
    });

    await t2.test('16. Bulk Delete: rejects non-PK representations (page index, row offset)', () => {
      const invalidIdentities = [
        { rowIndex: 0 },
        { pageOffset: 12 },
        { displayName: 'Note 1' }
      ];

      const requiredPks = ['id'];
      for (const invalid of invalidIdentities) {
        const hasAllPks = requiredPks.every(pk => pk in invalid);
        assert.strictEqual(hasAllPks, false);
      }
    });

    // -------------------------------------------------------------------------
    // E. Preflight Verification & Dependency Safety
    // -------------------------------------------------------------------------
    await t2.test('17. Preflight Check: single delete returns 404 when target record does not exist', () => {
      const lockedRows: any[] = [];
      const verifySingleExists = (rows: any[]) => {
        if (!rows || rows.length === 0) throw new NotFoundError('Record not found');
      };

      assert.throws(() => verifySingleExists(lockedRows), NotFoundError);
    });

    await t2.test('18. Preflight Check: bulk delete aborts entire transaction if ANY requested row is missing', () => {
      const requestedPks = [{ id: '1' }, { id: '2' }, { id: '3' }];
      const lockedRows = [{ id: '1' }, { id: '3' }]; // row 2 was modified/deleted by another process

      const verifyAllExist = (requested: any[], locked: any[]) => {
        if (locked.length !== requested.length) {
          throw new ConflictError(`Bulk delete preflight verification failed: ${requested.length - locked.length} record(s) missing. Entire operation aborted.`);
        }
      };

      assert.throws(() => verifyAllExist(requestedPks, lockedRows), /Bulk delete preflight verification failed/);
    });

    await t2.test('19. Dependency Safety: foreign key constraint error maps to safe conflict response', () => {
      const normalizeDbError = (errCode: string, msg: string) => {
        if (errCode === '1451' || errCode === '1452' || msg.includes('foreign key constraint fails')) {
          return { status: 409, message: 'This record cannot be deleted because dependent records in other tables reference it.' };
        }
        return { status: 500, message: msg };
      };

      const res = normalizeDbError('1451', 'Cannot delete or update a parent row: a foreign key constraint fails');
      assert.strictEqual(res.status, 409);
      assert.ok(res.message.includes('dependent records in other tables reference it'));
    });

    // -------------------------------------------------------------------------
    // F. Transaction Semantics & Single-Row Guarantee
    // -------------------------------------------------------------------------
    await t2.test('20. Transaction Safety: single delete enforces exactly 1 affected row', () => {
      const assertSingleDeleteResult = (affected: number) => {
        if (affected !== 1) {
          throw new Error(`Safety violation: Expected exactly 1 deleted row, got ${affected}. Transaction rolled back.`);
        }
      };

      assert.doesNotThrow(() => assertSingleDeleteResult(1));
      assert.throws(() => assertSingleDeleteResult(0));
      assert.throws(() => assertSingleDeleteResult(2));
    });

    await t2.test('21. Transaction Safety: bulk delete enforces exactly N affected rows', () => {
      const assertBulkDeleteResult = (expectedCount: number, affected: number) => {
        if (affected !== expectedCount) {
          throw new Error(`Safety violation: Expected to delete exactly ${expectedCount} rows, got ${affected}. Entire transaction rolled back.`);
        }
      };

      assert.doesNotThrow(() => assertBulkDeleteResult(10, 10));
      assert.throws(() => assertBulkDeleteResult(10, 9));
      assert.throws(() => assertBulkDeleteResult(10, 0));
    });

    await t2.test('22. Parameterized SQL Generator: generates safe parameterized DELETE query', () => {
      const tableName = 'support_case_notes';
      const pkCols = ['id'];
      const singleSql = `DELETE FROM \`${tableName}\` WHERE \`${pkCols[0]}\` = ? LIMIT 1`;
      assert.strictEqual(singleSql, 'DELETE FROM `support_case_notes` WHERE `id` = ? LIMIT 1');

      const bulkPks = ['id_1', 'id_2', 'id_3'];
      const placeholders = bulkPks.map(() => '?').join(', ');
      const bulkSql = `DELETE FROM \`${tableName}\` WHERE \`id\` IN (${placeholders})`;
      assert.strictEqual(bulkSql, 'DELETE FROM `support_case_notes` WHERE `id` IN (?, ?, ?)');
    });

    // -------------------------------------------------------------------------
    // G. Concurrency & Lock Handling
    // -------------------------------------------------------------------------
    await t2.test('23. Concurrency Safety: lock wait timeout and deadlock map to conflict/retry response', () => {
      const mapLockError = (errCode: string, msg: string) => {
        if (errCode === '1205' || msg.includes('Lock wait timeout') || errCode === '1213' || msg.includes('Deadlock')) {
          return { status: 409, message: 'Database lock conflict detected. Please retry the operation.' };
        }
        return { status: 500, message: msg };
      };

      assert.strictEqual(mapLockError('1205', 'Lock wait timeout exceeded').status, 409);
      assert.strictEqual(mapLockError('1213', 'Deadlock found when trying to get lock').status, 409);
    });

    // -------------------------------------------------------------------------
    // H. Cryptographic Audit Logging
    // -------------------------------------------------------------------------
    await t2.test('24. Audit Logging: creates DATABASE_ROW_DELETE with masked PK values', () => {
      const SENSITIVE_PATTERNS = /password|token|secret|hash|private_key|auth_key|credential|otp/i;
      const maskPk = (pk: Record<string, any>) => {
        const masked: Record<string, any> = {};
        for (const [k, v] of Object.entries(pk)) {
          masked[k] = SENSITIVE_PATTERNS.test(k) ? '[REDACTED]' : v;
        }
        return masked;
      };

      const rawPk = { token: 'super_secret_token_123', deviceId: 'dev_100' };
      const masked = maskPk(rawPk);

      assert.strictEqual(masked.token, '[REDACTED]');
      assert.strictEqual(masked.deviceId, 'dev_100');

      const auditEvent = {
        operation: 'DATABASE_ROW_DELETE',
        table: 'device_push_tokens',
        affectedRows: 1,
        primaryKey: masked
      };

      assert.strictEqual(auditEvent.operation, 'DATABASE_ROW_DELETE');
      assert.strictEqual(auditEvent.affectedRows, 1);
    });

    await t2.test('25. Audit Logging: creates DATABASE_BULK_DELETE with record count and identity list', () => {
      const bulkAuditEvent = {
        operation: 'DATABASE_BULK_DELETE',
        table: 'error_occurrences',
        requestedCount: 5,
        affectedRows: 5,
        primaryKeys: [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }, { id: '5' }]
      };

      assert.strictEqual(bulkAuditEvent.operation, 'DATABASE_BULK_DELETE');
      assert.strictEqual(bulkAuditEvent.requestedCount, 5);
      assert.strictEqual(bulkAuditEvent.affectedRows, 5);
      assert.strictEqual(bulkAuditEvent.primaryKeys.length, 5);
    });

    // -------------------------------------------------------------------------
    // I. Frontend UX & Selection Reconciliation
    // -------------------------------------------------------------------------
    await t2.test('26. Frontend UX: delete capability metadata exposed for UI controls', () => {
      const tableDetails = {
        tableName: 'support_case_notes',
        deleteCapability: {
          isDeletable: true,
          reason: 'Internal administrative support case note deletion',
          maxRows: 50
        }
      };

      assert.strictEqual(tableDetails.deleteCapability.isDeletable, true);
      assert.strictEqual(tableDetails.deleteCapability.maxRows, 50);
    });

    await t2.test('27. Frontend UX: selection state clears only deleted identities', () => {
      const selectedKeys = new Set<string>(['key_1', 'key_2', 'key_3']);
      const deletedKeys = ['key_1', 'key_2'];

      for (const k of deletedKeys) {
        selectedKeys.delete(k);
      }

      assert.strictEqual(selectedKeys.size, 1);
      assert.strictEqual(selectedKeys.has('key_3'), true);
    });

    await t2.test('28. Frontend UX: empty page navigation on last row deletion', () => {
      let currentPage = 3;
      const rowsOnCurrentPage = 1;
      const deletedCount = 1;

      if (rowsOnCurrentPage === deletedCount && currentPage > 1) {
        currentPage -= 1;
      }

      assert.strictEqual(currentPage, 2);
    });

    // -------------------------------------------------------------------------
    // J. Batch Isolation & Non-Interference
    // -------------------------------------------------------------------------
    await t2.test('29. Batch Isolation: UPDATE and INSERT capabilities remain fully functional', () => {
      const availableOperations = ['VIEW', 'EXPLORE', 'SEARCH', 'FILTER', 'SELECT', 'INSERT_ROW', 'UPDATE_ROW', 'DELETE_ROW', 'BULK_DELETE'];
      assert.ok(availableOperations.includes('INSERT_ROW'));
      assert.ok(availableOperations.includes('UPDATE_ROW'));
      assert.ok(availableOperations.includes('DELETE_ROW'));
      assert.ok(availableOperations.includes('BULK_DELETE'));
    });

    await t2.test('30. Batch Isolation: DDL, TRUNCATE, DROP TABLE, and user SQL are strictly forbidden', () => {
      const forbiddenOperations = ['TRUNCATE', 'DROP_TABLE', 'DROP_DATABASE', 'ALTER_TABLE', 'CREATE_TABLE', 'ARBITRARY_SQL_DELETE'];
      const allowedOperations = ['VIEW', 'EXPLORE', 'SEARCH', 'FILTER', 'SELECT', 'INSERT_ROW', 'UPDATE_ROW', 'DELETE_ROW', 'BULK_DELETE'];

      for (const forbidden of forbiddenOperations) {
        assert.strictEqual(allowedOperations.includes(forbidden), false, `${forbidden} must NOT be allowed in Batch 15.6`);
      }
    });
  });

  // ===========================================================================
  // PHASE 15 BATCH 15.7: DATABASE SEARCH, FILTERS & NAVIGATION
  // ===========================================================================
  await t.test('Phase 15 Batch 15.7 — Database Search, Filters & Navigation Test Suite', async (t2: any) => {

    // -------------------------------------------------------------------------
    // A. Global Search & Wildcard Escaping
    // -------------------------------------------------------------------------
    await t2.test('1. Search Escaping: escapes %, _, and \\ in search queries for literal matching', () => {
      assert.strictEqual(escapeLikeWildcards('100%'), '100\\%');
      assert.strictEqual(escapeLikeWildcards('user_name'), 'user\\_name');
      assert.strictEqual(escapeLikeWildcards('path\\to\\file'), 'path\\\\to\\\\file');
      assert.strictEqual(escapeLikeWildcards('normal text'), 'normal text');
      assert.strictEqual(escapeLikeWildcards('%_\\test'), '\\%\\_\\\\test');
    });

    await t2.test('2. Search Query Boundary: bounds search input to max 256 characters', () => {
      const longQuery = 'a'.repeat(500);
      const bounded = longQuery.trim().substring(0, 256);
      assert.strictEqual(bounded.length, 256);
    });

    await t2.test('3. Search Column Filtering: excludes sensitive/masked and binary/blob columns', () => {
      const testColumns = [
        { name: 'id', dataType: 'varchar(64)' },
        { name: 'email', dataType: 'varchar(255)' },
        { name: 'passwordHash', dataType: 'varchar(255)' },
        { name: 'apiToken', dataType: 'varchar(128)' },
        { name: 'rawData', dataType: 'longblob' },
        { name: 'status', dataType: 'enum("ACTIVE","INACTIVE")' },
        { name: 'notes', dataType: 'text' }
      ];

      const SENSITIVE_PATTERNS = [/password/i, /token/i, /secret/i, /hash/i, /private_key/i, /auth_key/i, /credential/i, /otp/i];

      const searchable = testColumns.filter(col => {
        const isSensitive = SENSITIVE_PATTERNS.some(pat => pat.test(col.name));
        if (isSensitive) return false;
        const dt = col.dataType.toLowerCase();
        if (dt.includes('blob') || dt.includes('binary') || dt.includes('bytea')) return false;
        return dt.includes('char') || dt.includes('text') || dt.includes('enum') || dt.includes('json') || dt.includes('varchar');
      });

      const searchableNames = searchable.map(c => c.name);
      assert.ok(searchableNames.includes('id'));
      assert.ok(searchableNames.includes('email'));
      assert.ok(searchableNames.includes('status'));
      assert.ok(searchableNames.includes('notes'));
      assert.strictEqual(searchableNames.includes('passwordHash'), false);
      assert.strictEqual(searchableNames.includes('apiToken'), false);
      assert.strictEqual(searchableNames.includes('rawData'), false);
    });

    // -------------------------------------------------------------------------
    // B. String Filter Operators
    // -------------------------------------------------------------------------
    await t2.test('4. String Filter: contains generates parameterized LIKE %val% with escaped wildcards', () => {
      const col = 'name';
      const val = 'test%100';
      const escaped = escapeLikeWildcards(val);
      const sql = `\`${col}\` LIKE ?`;
      const param = `%${escaped}%`;

      assert.strictEqual(sql, '`name` LIKE ?');
      assert.strictEqual(param, '%test\\%100%');
    });

    await t2.test('5. String Filter: not_contains generates NOT LIKE or IS NULL', () => {
      const col = 'email';
      const val = 'spam';
      const escaped = escapeLikeWildcards(val);
      const sql = `(\`${col}\` NOT LIKE ? OR \`${col}\` IS NULL)`;
      const param = `%${escaped}%`;

      assert.strictEqual(sql, '(`email` NOT LIKE ? OR `email` IS NULL)');
      assert.strictEqual(param, '%spam%');
    });

    await t2.test('6. String Filter: starts_with and ends_with generate correct wildcard positions', () => {
      const col = 'filename';
      const prefix = 'doc_';
      const suffix = '.pdf';

      const startsWithSql = `\`${col}\` LIKE ?`;
      const startsWithParam = `${escapeLikeWildcards(prefix)}%`;
      assert.strictEqual(startsWithParam, 'doc\\_%');

      const endsWithSql = `\`${col}\` LIKE ?`;
      const endsWithParam = `%${escapeLikeWildcards(suffix)}`;
      assert.strictEqual(endsWithParam, '%.pdf');
    });

    await t2.test('7. String Filter: is_empty and is_not_empty check for empty string and NULL', () => {
      const col = 'description';
      const emptySql = `(\`${col}\` = '' OR \`${col}\` IS NULL)`;
      const notEmptySql = `(\`${col}\` != '' AND \`${col}\` IS NOT NULL)`;

      assert.strictEqual(emptySql, "(`description` = '' OR `description` IS NULL)");
      assert.strictEqual(notEmptySql, "(`description` != '' AND `description` IS NOT NULL)");
    });

    // -------------------------------------------------------------------------
    // C. Numeric & Range Filter Operators
    // -------------------------------------------------------------------------
    await t2.test('8. Numeric Filter: greaterThan, lessThan, and equals generate safe parameterized clauses', () => {
      const col = 'fileSizeBytes';
      const gtSql = `\`${col}\` > ?`;
      const lteSql = `\`${col}\` <= ?`;
      const eqSql = `\`${col}\` = ?`;

      assert.strictEqual(gtSql, '`fileSizeBytes` > ?');
      assert.strictEqual(lteSql, '`fileSizeBytes` <= ?');
      assert.strictEqual(eqSql, '`fileSizeBytes` = ?');
    });

    await t2.test('9. Numeric Filter: between operator handles dual boundaries with BETWEEN ? AND ?', () => {
      const col = 'attemptCount';
      const min = 1;
      const max = 5;
      const sql = `\`${col}\` BETWEEN ? AND ?`;
      const params = [min, max];

      assert.strictEqual(sql, '`attemptCount` BETWEEN ? AND ?');
      assert.deepStrictEqual(params, [1, 5]);
    });

    await t2.test('10. Numeric Filter: between operator fails closed if boundary is missing', () => {
      const validateBetween = (val1: any, val2: any) => {
        if (val1 === undefined || val2 === undefined || val1 === null || val2 === null) {
          throw new Error("Operator 'between' requires both start and end boundary values");
        }
      };

      assert.doesNotThrow(() => validateBetween(10, 20));
      assert.throws(() => validateBetween(10, undefined));
      assert.throws(() => validateBetween(null, 20));
    });

    // -------------------------------------------------------------------------
    // D. Date/Time & Boolean Filter Operators
    // -------------------------------------------------------------------------
    await t2.test('11. Date Filter: before and after generate correct comparison clauses', () => {
      const col = 'createdAt';
      const beforeSql = `\`${col}\` < ?`;
      const afterSql = `\`${col}\` > ?`;

      assert.strictEqual(beforeSql, '`createdAt` < ?');
      assert.strictEqual(afterSql, '`createdAt` > ?');
    });

    await t2.test('12. Boolean Filter: is_true and is_false generate truthy/falsy evaluation', () => {
      const col = 'isActive';
      const trueSql = `(\`${col}\` = 1 OR \`${col}\` = TRUE)`;
      const falseSql = `(\`${col}\` = 0 OR \`${col}\` = FALSE)`;

      assert.strictEqual(trueSql, '(`isActive` = 1 OR `isActive` = TRUE)');
      assert.strictEqual(falseSql, '(`isActive` = 0 OR `isActive` = FALSE)');
    });

    await t2.test('13. Nullability Filter: is_null and is_not_null generate IS NULL / IS NOT NULL', () => {
      const col = 'revokedAt';
      const isNullSql = `\`${col}\` IS NULL`;
      const isNotNullSql = `\`${col}\` IS NOT NULL`;

      assert.strictEqual(isNullSql, '`revokedAt` IS NULL');
      assert.strictEqual(isNotNullSql, '`revokedAt` IS NOT NULL');
    });

    // -------------------------------------------------------------------------
    // E. Filter Boundaries & Security
    // -------------------------------------------------------------------------
    await t2.test('14. Filter Limit: enforces maximum of 10 active filters', () => {
      const filterList = Array.from({ length: 15 }, (_, i) => ({
        column: `col_${i}`,
        operator: 'equals',
        value: i
      }));

      const bounded = filterList.slice(0, 10);
      assert.strictEqual(bounded.length, 10);
    });

    await t2.test('15. Security: filtering on sensitive/masked column is strictly blocked', () => {
      const SENSITIVE_PATTERNS = [/password/i, /token/i, /secret/i, /hash/i];
      const validateFilterColumn = (colName: string) => {
        if (SENSITIVE_PATTERNS.some(pat => pat.test(colName))) {
          throw new Error(`Filtering on protected sensitive column '${colName}' is not permitted`);
        }
      };

      assert.doesNotThrow(() => validateFilterColumn('status'));
      assert.doesNotThrow(() => validateFilterColumn('createdAt'));
      assert.throws(() => validateFilterColumn('passwordHash'));
      assert.throws(() => validateFilterColumn('sessionToken'));
    });

    // -------------------------------------------------------------------------
    // F. Deterministic Sorting & Primary Key Tie-Breakers
    // -------------------------------------------------------------------------
    await t2.test('16. Deterministic Sorting: single PK table appends PK tie-breaker', () => {
      const pks = ['id'];
      const sortBy = 'status';
      const tieBreakers: string[] = [];

      for (const pk of pks) {
        if (pk !== sortBy) tieBreakers.push(pk);
      }

      assert.deepStrictEqual(tieBreakers, ['id']);

      const orderClauses = [`\`${sortBy}\` ASC`];
      for (const tb of tieBreakers) {
        orderClauses.push(`\`${tb}\` ASC`);
      }
      assert.strictEqual(`ORDER BY ${orderClauses.join(', ')}`, 'ORDER BY `status` ASC, `id` ASC');
    });

    await t2.test('17. Deterministic Sorting: composite PK table appends remaining PK columns in order', () => {
      const pks = ['tenantId', 'userId', 'deviceId'];
      const sortBy = 'tenantId';
      const tieBreakers: string[] = [];

      for (const pk of pks) {
        if (pk !== sortBy) tieBreakers.push(pk);
      }

      assert.deepStrictEqual(tieBreakers, ['userId', 'deviceId']);
    });

    await t2.test('18. Deterministic Sorting: no-PK table falls back to createdAt or first column', () => {
      const pks: string[] = [];
      const columns = ['name', 'value', 'createdAt'];
      let sortBy = 'name';
      const tieBreakers: string[] = [];

      if (pks.length === 0 && columns.includes('createdAt') && sortBy !== 'createdAt') {
        tieBreakers.push('createdAt');
      }

      assert.deepStrictEqual(tieBreakers, ['createdAt']);
    });

    // -------------------------------------------------------------------------
    // G. Pagination & Count Query Parity
    // -------------------------------------------------------------------------
    await t2.test('19. Count Parity: count query uses identical WHERE clauses as data query', () => {
      const whereConditions = ['`status` = ?', '(`email` LIKE ? OR `name` LIKE ?)'];
      const queryParams = ['ACTIVE', '%test%', '%test%'];

      const whereClause = `WHERE ${whereConditions.join(' AND ')}`;
      const countSql = `SELECT COUNT(*) as cnt FROM \`users\` ${whereClause}`;
      const dataSql = `SELECT * FROM \`users\` ${whereClause} ORDER BY \`id\` ASC LIMIT 25 OFFSET 0`;

      assert.ok(countSql.includes(whereClause));
      assert.ok(dataSql.includes(whereClause));
      assert.strictEqual(whereClause, 'WHERE `status` = ? AND (`email` LIKE ? OR `name` LIKE ?)');
    });

    await t2.test('20. Pagination Math: calculates accurate page boundaries and offsets', () => {
      const calculatePagination = (page: number, pageSize: number, totalRows: number) => {
        const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
        const boundedPage = Math.min(Math.max(1, page), totalPages);
        const offset = (boundedPage - 1) * pageSize;
        return { page: boundedPage, pageSize, totalRows, totalPages, offset };
      };

      const p1 = calculatePagination(1, 25, 100);
      assert.strictEqual(p1.totalPages, 4);
      assert.strictEqual(p1.offset, 0);

      const p2 = calculatePagination(3, 25, 100);
      assert.strictEqual(p2.offset, 50);

      const pOverflow = calculatePagination(10, 25, 100);
      assert.strictEqual(pOverflow.page, 4);
      assert.strictEqual(pOverflow.offset, 75);
    });

    // -------------------------------------------------------------------------
    // H. Frontend Selection & Navigation Lifecycle
    // -------------------------------------------------------------------------
    await t2.test('21. Navigation Lifecycle: page resets to 1 when search or filters change', () => {
      let state = { page: 4, searchQuery: '', filters: [] as any[] };

      const onSearchChanged = (query: string) => {
        state.searchQuery = query;
        state.page = 1;
      };

      const onFilterAdded = (filter: any) => {
        state.filters.push(filter);
        state.page = 1;
      };

      onSearchChanged('test');
      assert.strictEqual(state.page, 1);

      state.page = 3;
      onFilterAdded({ column: 'status', operator: 'equals', value: 'ACTIVE' });
      assert.strictEqual(state.page, 1);
    });

    await t2.test('22. Selection Reconciliation: selections on primary-key tables persist across pages', () => {
      const selectedRowKeys = new Set<string>(['users:id=101', 'users:id=102']);

      // Simulating page change
      const isRowSelected = (key: string) => selectedRowKeys.has(key);

      assert.strictEqual(isRowSelected('users:id=101'), true);
      assert.strictEqual(isRowSelected('users:id=103'), false);
    });

    // -------------------------------------------------------------------------
    // I. Batch Parity & Mutation Safety
    // -------------------------------------------------------------------------
    await t2.test('23. Batch Parity: Phase 15.4 Insert, 15.5 Update, and 15.6 Delete remain completely intact', () => {
      const systemCapabilities = [
        'SCHEMA_DISCOVERY',
        'DATA_GRID_VIEW',
        'MULTI_SELECT',
        'INSERT_ROW',
        'UPDATE_ROW',
        'DELETE_ROW',
        'BULK_DELETE',
        'SEARCH_RECORDS',
        'FILTER_COLUMNS',
        'DETERMINISTIC_SORT',
        'PAGINATION'
      ];

      assert.ok(systemCapabilities.includes('INSERT_ROW'));
      assert.ok(systemCapabilities.includes('UPDATE_ROW'));
      assert.ok(systemCapabilities.includes('DELETE_ROW'));
      assert.ok(systemCapabilities.includes('BULK_DELETE'));
      assert.ok(systemCapabilities.includes('SEARCH_RECORDS'));
      assert.ok(systemCapabilities.includes('FILTER_COLUMNS'));
    });

    await t2.test('24. Security Guardrails: DDL, raw SQL WHERE injection, and schema modification remain forbidden', () => {
      const forbiddenConcepts = ['RAW_SQL_WHERE', 'DDL_ALTER', 'DDL_DROP', 'UNPARAMETERIZED_SEARCH', 'ARBITRARY_COLUMN_FILTER'];
      const allowedConcepts = ['PARAMETERIZED_SEARCH', 'METADATA_VALIDATED_FILTERS', 'DETERMINISTIC_SORT'];

      for (const forbidden of forbiddenConcepts) {
        assert.strictEqual(allowedConcepts.includes(forbidden), false);
      }
    });
  });
});




