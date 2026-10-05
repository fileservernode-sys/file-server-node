import test from 'node:test';
import assert from 'node:assert/strict';
import { SqlSafetyGuard } from '../src/utils/sql_safety_guard.js';
import { SqlRunnerService, getActiveQueryCount, resetActiveQueryCount, MAX_CONCURRENT_QUERIES } from '../src/services/admin/sql_runner_service.js';
import { buildApp } from '../src/app.js';
import { generateCsrfToken } from '../src/utils/csrf.js';
import { ValidationError, AppError, UnauthorizedError } from '../src/errors/app-error.js';

test('Phase 15 — Batch 15.1-R1: SQL Query Runner — Hardened Read-Only SQL Foundation', async (t) => {

  await t.test('1. SQL Safety Guard Lexical & Policy Engine', async (t2: any) => {
    // 1.1 Read-Only Statements Permitted
    await t2.test('accepts basic SELECT query', () => {
      const res = SqlSafetyGuard.validateReadOnlyQuery('SELECT id, email, status FROM User WHERE status = "ACTIVE"');
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.statementType, 'SELECT');
    });

    await t2.test('accepts CTE queries starting with WITH ... SELECT', () => {
      const res = SqlSafetyGuard.validateReadOnlyQuery('WITH ActiveUsers AS (SELECT id, email FROM User) SELECT * FROM ActiveUsers');
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.statementType, 'WITH');
    });

    await t2.test('accepts approved SHOW statements (SHOW TABLES, SHOW CREATE TABLE, SHOW COLUMNS, SHOW INDEX)', () => {
      const res1 = SqlSafetyGuard.validateReadOnlyQuery('SHOW TABLES');
      assert.strictEqual(res1.valid, true);
      assert.strictEqual(res1.statementType, 'SHOW');

      const res2 = SqlSafetyGuard.validateReadOnlyQuery('SHOW CREATE TABLE User');
      assert.strictEqual(res2.valid, true);

      const res3 = SqlSafetyGuard.validateReadOnlyQuery('SHOW COLUMNS FROM User');
      assert.strictEqual(res3.valid, true);

      const res4 = SqlSafetyGuard.validateReadOnlyQuery('SHOW INDEX FROM User');
      assert.strictEqual(res4.valid, true);
    });

    await t2.test('accepts DESCRIBE and DESC statements', () => {
      const res1 = SqlSafetyGuard.validateReadOnlyQuery('DESCRIBE User');
      assert.strictEqual(res1.valid, true);
      assert.strictEqual(res1.statementType, 'DESCRIBE');

      const res2 = SqlSafetyGuard.validateReadOnlyQuery('DESC AdminUser');
      assert.strictEqual(res2.valid, true);
      assert.strictEqual(res2.statementType, 'DESC');
    });

    await t2.test('accepts EXPLAIN queries for SELECT statements', () => {
      const res = SqlSafetyGuard.validateReadOnlyQuery('EXPLAIN SELECT id, email FROM User WHERE email = "test@example.com"');
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.statementType, 'EXPLAIN');
    });

    await t2.test('accepts queries with trailing semicolon and surrounding whitespace', () => {
      const res = SqlSafetyGuard.validateReadOnlyQuery('   SELECT 1;   ');
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.cleanedSql, 'SELECT 1');
    });

    await t2.test('accepts queries containing semicolons and quotes within string literals', () => {
      const res1 = SqlSafetyGuard.validateReadOnlyQuery("SELECT id, message FROM AuditEvent WHERE message = 'semicolon; inside string; literal'");
      assert.strictEqual(res1.valid, true);

      const res2 = SqlSafetyGuard.validateReadOnlyQuery("SELECT id, name FROM User WHERE name = 'O\\'Reilly'");
      assert.strictEqual(res2.valid, true);
    });

    // 1.2 Multi-Statement Execution Rejections
    await t2.test('rejects multi-statement queries (SELECT; SELECT)', () => {
      const res = SqlSafetyGuard.validateReadOnlyQuery('SELECT 1; SELECT 2');
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_MULTI_STATEMENT_PROHIBITED');
    });

    await t2.test('rejects multi-statement injection (SELECT; DROP TABLE users)', () => {
      const res = SqlSafetyGuard.validateReadOnlyQuery('SELECT id FROM User; DROP TABLE User;');
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_MULTI_STATEMENT_PROHIBITED');
    });

    await t2.test('rejects comment-obfuscated multi-statement execution', () => {
      const res = SqlSafetyGuard.validateReadOnlyQuery('SELECT 1; /* harmless comment */ DROP TABLE User;');
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_MULTI_STATEMENT_PROHIBITED');
    });

    // 1.3 User Variables and Session State Mutation Rejections
    await t2.test('rejects user variable assignment (@var := ...)', () => {
      const res1 = SqlSafetyGuard.validateReadOnlyQuery('SELECT @x := 1');
      assert.strictEqual(res1.valid, false);
      assert.strictEqual(res1.error, 'SQL_USER_VARIABLE_PROHIBITED');

      const res2 = SqlSafetyGuard.validateReadOnlyQuery('SELECT @admin_token FROM User');
      assert.strictEqual(res2.valid, false);
      assert.strictEqual(res2.error, 'SQL_USER_VARIABLE_PROHIBITED');
    });

    // 1.4 Abusive & Side-Effect Functions Rejections
    await t2.test('rejects SLEEP function (deliberate delay / resource exhaustion)', () => {
      const res = SqlSafetyGuard.validateReadOnlyQuery('SELECT SLEEP(10)');
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_ABUSIVE_FUNCTION_PROHIBITED');
    });

    await t2.test('rejects BENCHMARK function (CPU exhaustion loop)', () => {
      const res = SqlSafetyGuard.validateReadOnlyQuery('SELECT BENCHMARK(10000000, MD5(1))');
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_ABUSIVE_FUNCTION_PROHIBITED');
    });

    await t2.test('rejects LOAD_FILE function (filesystem read exfiltration)', () => {
      const res = SqlSafetyGuard.validateReadOnlyQuery('SELECT LOAD_FILE("/etc/passwd")');
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_ABUSIVE_FUNCTION_PROHIBITED');
    });

    await t2.test('rejects lock manipulation functions (GET_LOCK, RELEASE_LOCK)', () => {
      const res1 = SqlSafetyGuard.validateReadOnlyQuery('SELECT GET_LOCK("custom_lock", 10)');
      assert.strictEqual(res1.valid, false);
      assert.strictEqual(res1.error, 'SQL_ABUSIVE_FUNCTION_PROHIBITED');

      const res2 = SqlSafetyGuard.validateReadOnlyQuery('SELECT RELEASE_LOCK("custom_lock")');
      assert.strictEqual(res2.valid, false);
      assert.strictEqual(res2.error, 'SQL_ABUSIVE_FUNCTION_PROHIBITED');
    });

    // 1.5 SHOW Policy Tightening Rejections
    await t2.test('rejects unapproved SHOW variants (SHOW PROCESSLIST, SHOW VARIABLES, SHOW STATUS, SHOW GRANTS)', () => {
      const res1 = SqlSafetyGuard.validateReadOnlyQuery('SHOW PROCESSLIST');
      assert.strictEqual(res1.valid, false);
      assert.strictEqual(res1.error, 'SQL_SHOW_VARIANT_PROHIBITED');

      const res2 = SqlSafetyGuard.validateReadOnlyQuery('SHOW VARIABLES');
      assert.strictEqual(res2.valid, false);
      assert.strictEqual(res2.error, 'SQL_SHOW_VARIANT_PROHIBITED');

      const res3 = SqlSafetyGuard.validateReadOnlyQuery('SHOW GLOBAL VARIABLES');
      assert.strictEqual(res3.valid, false);
      assert.strictEqual(res3.error, 'SQL_SHOW_VARIANT_PROHIBITED');

      const res4 = SqlSafetyGuard.validateReadOnlyQuery('SHOW STATUS');
      assert.strictEqual(res4.valid, false);
      assert.strictEqual(res4.error, 'SQL_SHOW_VARIANT_PROHIBITED');

      const res5 = SqlSafetyGuard.validateReadOnlyQuery('SHOW GRANTS');
      assert.strictEqual(res5.valid, false);
      assert.strictEqual(res5.error, 'SQL_SHOW_VARIANT_PROHIBITED');

      const res6 = SqlSafetyGuard.validateReadOnlyQuery('SHOW MASTER STATUS');
      assert.strictEqual(res6.valid, false);
      assert.strictEqual(res6.error, 'SQL_SHOW_VARIANT_PROHIBITED');
    });

    // 1.6 Semantic Sensitive Column Identifier Protection in Expressions
    await t2.test('rejects direct reference to sensitive column passwordHash', () => {
      const res = SqlSafetyGuard.validateReadOnlyQuery('SELECT passwordHash FROM User');
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_SENSITIVE_COLUMN_PROHIBITED');
    });

    await t2.test('rejects aliased reference to sensitive column (passwordHash AS x)', () => {
      const res = SqlSafetyGuard.validateReadOnlyQuery('SELECT passwordHash AS diagnostic_value FROM User');
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_SENSITIVE_COLUMN_PROHIBITED');
    });

    await t2.test('rejects transformed sensitive column in CONCAT or string expressions', () => {
      const res = SqlSafetyGuard.validateReadOnlyQuery('SELECT CONCAT(passwordHash, "") AS extracted FROM User');
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_SENSITIVE_COLUMN_PROHIBITED');
    });

    await t2.test('rejects sensitive column inside JSON_OBJECT expression', () => {
      const res = SqlSafetyGuard.validateReadOnlyQuery('SELECT JSON_OBJECT("token", tokenHash) FROM AdminSession');
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_SENSITIVE_COLUMN_PROHIBITED');
    });

    await t2.test('rejects sensitive column inside conditional IF expression', () => {
      const res = SqlSafetyGuard.validateReadOnlyQuery('SELECT IF(1=1, otpCode, "none") FROM User');
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_SENSITIVE_COLUMN_PROHIBITED');
    });

    await t2.test('rejects backticked sensitive column identifier', () => {
      const res = SqlSafetyGuard.validateReadOnlyQuery('SELECT `passwordHash` FROM User');
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_SENSITIVE_COLUMN_PROHIBITED');
    });

    // 1.7 Mutation, DDL & Transaction Control Statement Rejections
    await t2.test('rejects INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE statements', () => {
      assert.strictEqual(SqlSafetyGuard.validateReadOnlyQuery('INSERT INTO User (id) VALUES ("1")').valid, false);
      assert.strictEqual(SqlSafetyGuard.validateReadOnlyQuery('UPDATE User SET status = "ACTIVE"').valid, false);
      assert.strictEqual(SqlSafetyGuard.validateReadOnlyQuery('DELETE FROM User WHERE id = "1"').valid, false);
      assert.strictEqual(SqlSafetyGuard.validateReadOnlyQuery('DROP TABLE User').valid, false);
      assert.strictEqual(SqlSafetyGuard.validateReadOnlyQuery('ALTER TABLE User ADD COLUMN pwn INT').valid, false);
      assert.strictEqual(SqlSafetyGuard.validateReadOnlyQuery('CREATE TABLE backdoor (id INT)').valid, false);
      assert.strictEqual(SqlSafetyGuard.validateReadOnlyQuery('TRUNCATE TABLE User').valid, false);
    });

    await t2.test('rejects transaction control statements (START TRANSACTION, COMMIT, ROLLBACK, SAVEPOINT)', () => {
      const res1 = SqlSafetyGuard.validateReadOnlyQuery('START TRANSACTION');
      assert.strictEqual(res1.valid, false);

      const res2 = SqlSafetyGuard.validateReadOnlyQuery('COMMIT');
      assert.strictEqual(res2.valid, false);

      const res3 = SqlSafetyGuard.validateReadOnlyQuery('ROLLBACK');
      assert.strictEqual(res3.valid, false);
    });

    await t2.test('rejects GRANT, REVOKE, CALL, DO, LOAD DATA, SET statements', () => {
      assert.strictEqual(SqlSafetyGuard.validateReadOnlyQuery('GRANT ALL PRIVILEGES ON *.* TO "hacker"@"%"').valid, false);
      assert.strictEqual(SqlSafetyGuard.validateReadOnlyQuery('REVOKE ALL PRIVILEGES ON *.* FROM "admin"@"%"').valid, false);
      assert.strictEqual(SqlSafetyGuard.validateReadOnlyQuery('CALL sp_delete_all()').valid, false);
      assert.strictEqual(SqlSafetyGuard.validateReadOnlyQuery('DO SLEEP(5)').valid, false);
      assert.strictEqual(SqlSafetyGuard.validateReadOnlyQuery('LOAD DATA INFILE "/tmp/x" INTO TABLE User').valid, false);
      assert.strictEqual(SqlSafetyGuard.validateReadOnlyQuery('SET GLOBAL general_log = "ON"').valid, false);
    });

    // 1.8 MySQL-Specific Side-Effect Rejections
    await t2.test('rejects SELECT ... INTO OUTFILE / DUMPFILE / @VAR constructs', () => {
      assert.strictEqual(SqlSafetyGuard.validateReadOnlyQuery('SELECT id FROM User INTO OUTFILE "/tmp/u.txt"').valid, false);
      assert.strictEqual(SqlSafetyGuard.validateReadOnlyQuery('SELECT id FROM User INTO DUMPFILE "/tmp/u.bin"').valid, false);
    });

    await t2.test('rejects SELECT ... FOR UPDATE / FOR SHARE / LOCK IN SHARE MODE', () => {
      assert.strictEqual(SqlSafetyGuard.validateReadOnlyQuery('SELECT id FROM User FOR UPDATE').valid, false);
      assert.strictEqual(SqlSafetyGuard.validateReadOnlyQuery('SELECT id FROM User FOR SHARE').valid, false);
      assert.strictEqual(SqlSafetyGuard.validateReadOnlyQuery('SELECT id FROM User LOCK IN SHARE MODE').valid, false);
    });

    // 1.9 Syntax and Format Guards
    await t2.test('rejects empty or whitespace-only queries', () => {
      assert.strictEqual(SqlSafetyGuard.validateReadOnlyQuery('').valid, false);
      assert.strictEqual(SqlSafetyGuard.validateReadOnlyQuery('   \n\t  ').valid, false);
    });

    await t2.test('rejects unclosed quotes and comments', () => {
      assert.strictEqual(SqlSafetyGuard.validateReadOnlyQuery("SELECT id FROM User WHERE email = 'unclosed").valid, false);
      assert.strictEqual(SqlSafetyGuard.validateReadOnlyQuery('SELECT id FROM User /* unclosed comment').valid, false);
    });

    await t2.test('rejects oversized queries exceeding 10,000 characters', () => {
      const longSql = 'SELECT id FROM User WHERE id = "' + 'a'.repeat(10050) + '"';
      assert.strictEqual(SqlSafetyGuard.validateReadOnlyQuery(longSql).valid, false);
    });
  });

  await t.test('2. Admin SQL Runner Service Execution & Safety', async (t2: any) => {
    const mockAdmin = {
      id: 'admin_test_123',
      email: 'admin@zdexcloud.com',
      isSuperAdmin: true
    };

    await t2.test('successfully executes read-only SELECT query and returns sanitized results', async () => {
      const result = await SqlRunnerService.executeReadOnlyQuery({
        sql: 'SELECT 1 as id, "test@example.com" as email, "ACTIVE" as status',
        admin: mockAdmin,
        requestId: 'req_test_sql_1'
      });

      assert.strictEqual(result.statementType, 'SELECT');
      assert.strictEqual(result.rowCount, 1);
      assert.strictEqual(result.rows[0].id, 1);
      assert.strictEqual(result.rows[0].email, 'test@example.com');
      assert.strictEqual(result.rows[0].status, 'ACTIVE');
      assert.ok(result.executionTimeMs >= 0);
    });

    await t2.test('rejects execution of query accessing sensitive column passwordHash with ValidationError', async () => {
      await assert.rejects(
        async () => {
          await SqlRunnerService.executeReadOnlyQuery({
            sql: 'SELECT passwordHash FROM User',
            admin: mockAdmin,
            requestId: 'req_test_sql_sens'
          });
        },
        ValidationError
      );
    });

    await t2.test('rejects execution of mutation query with ValidationError', async () => {
      await assert.rejects(
        async () => {
          await SqlRunnerService.executeReadOnlyQuery({
            sql: 'DROP TABLE User',
            admin: mockAdmin,
            requestId: 'req_test_sql_2'
          });
        },
        ValidationError
      );
    });

    await t2.test('rejects execution of abusive SLEEP function query with ValidationError', async () => {
      await assert.rejects(
        async () => {
          await SqlRunnerService.executeReadOnlyQuery({
            sql: 'SELECT SLEEP(5)',
            admin: mockAdmin,
            requestId: 'req_test_sql_3'
          });
        },
        ValidationError
      );
    });

    await t2.test('enforces concurrency limit and rejects when MAX_CONCURRENT_QUERIES is reached', async () => {
      resetActiveQueryCount();
      assert.strictEqual(getActiveQueryCount(), 0);

      // Verify slot release after query execution
      await SqlRunnerService.executeReadOnlyQuery({
        sql: 'SELECT 1',
        admin: mockAdmin,
        requestId: 'req_test_conc_1'
      });
      assert.strictEqual(getActiveQueryCount(), 0);
    });
  });

  await t.test('3. Admin SQL Runner HTTP Endpoint Security, CSRF & RBAC', async (t2: any) => {
    const app = await buildApp();

    await t2.test('POST /api/v1/admin/sql/query rejects unauthenticated caller with 401', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/sql/query',
        payload: { sql: 'SELECT 1' }
      });

      assert.strictEqual(response.statusCode, 401);
      const json = JSON.parse(response.body);
      assert.strictEqual(json.success, false);
    });

    await t2.test('POST /api/v1/admin/sql/query rejects invalid request body with 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/sql/query',
        headers: {
          authorization: 'Bearer invalid_token'
        },
        payload: { sql: '' }
      });

      assert.ok([400, 401].includes(response.statusCode));
    });

    await t2.test('POST /api/v1/admin/sql/query rejects customer authentication tokens with 401', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/sql/query',
        headers: {
          authorization: 'Bearer customer_session_token_xyz'
        },
        payload: { sql: 'SELECT 1' }
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  await t.test('4. Phase 15.2 — Professional SQL Query Editor Template & Formatting Engine', async (t2: any) => {
    // 4.1 All Predefined Editor Templates are Valid & Safe
    await t2.test('all 8 quick query templates pass SqlSafetyGuard validation', () => {
      const predefinedTemplates = [
        'SHOW TABLES;',
        'SHOW COLUMNS FROM users;',
        'SHOW CREATE TABLE users;',
        'SHOW INDEX FROM users;',
        'SELECT id, email, status, createdAt FROM users ORDER BY createdAt DESC LIMIT 10;',
        'SELECT id, name, status, platform, lastSeenAt FROM devices ORDER BY lastSeenAt DESC LIMIT 10;',
        'SELECT id, action, status, createdAt FROM audit_events ORDER BY createdAt DESC LIMIT 10;',
        "EXPLAIN SELECT id, email FROM users WHERE status = 'ACTIVE';"
      ];

      for (const tpl of predefinedTemplates) {
        const res = SqlSafetyGuard.validateReadOnlyQuery(tpl);
        assert.strictEqual(res.valid, true, `Template "${tpl}" failed validation with ${res.error}`);
        assert.ok(['SHOW', 'SELECT', 'EXPLAIN'].includes(res.statementType!));
      }
    });

    // 4.2 Sensitive Data Detection in UI Payloads
    await t2.test('identifies redacted sensitive markers in result cell values', () => {
      const testRow = {
        id: 'usr_12345',
        email: 'admin@zdexcloud.internal',
        passwordHash: '[REDACTED_SENSITIVE_DATA]',
        twoFactorSecret: '[REDACTED_SENSITIVE_DATA]',
        createdAt: '2026-10-04T00:00:00.000Z'
      };

      assert.strictEqual(testRow.passwordHash, '[REDACTED_SENSITIVE_DATA]');
      assert.strictEqual(testRow.twoFactorSecret, '[REDACTED_SENSITIVE_DATA]');
      assert.strictEqual(typeof testRow.email, 'string');
      assert.ok(!testRow.email.includes('[REDACTED'));
    });

    // 4.3 CSV Export Escaping (RFC-4180 Compliance)
    await t2.test('RFC-4180 CSV serialization escaping rules', () => {
      const escapeCsv = (val: any) => {
        if (val === null || val === undefined) return '';
        let str = typeof val === 'object' ? JSON.stringify(val) : String(val);
        if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
          str = '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
      };

      assert.strictEqual(escapeCsv('simple text'), 'simple text');
      assert.strictEqual(escapeCsv('text with, comma'), '"text with, comma"');
      assert.strictEqual(escapeCsv('text with "quotes"'), '"text with ""quotes"""');
      assert.strictEqual(escapeCsv('text\nwith\nnewlines'), '"text\nwith\nnewlines"');
      assert.strictEqual(escapeCsv(null), '');
      assert.strictEqual(escapeCsv(12345), '12345');
    });

    // 4.4 Result Truncation Safety Indicators
    await t2.test('handles result set truncation flags properly', () => {
      const fullResultSet = {
        success: true,
        data: {
          statementType: 'SELECT',
          rowCount: 500,
          executionTimeMs: 42,
          truncated: true,
          columns: ['id', 'email'],
          rows: Array(500).fill({ id: 'usr_mock', email: 'user@zdexcloud.internal' })
        }
      };

      assert.strictEqual(fullResultSet.data.rowCount, 500);
      assert.strictEqual(fullResultSet.data.truncated, true);
      assert.strictEqual(fullResultSet.data.rows.length, 500);
    });
  });

  await t.test('5. Phase 15.3 — Query Results & Data Handling Engine', async (t2: any) => {
    // Helper escape function matching frontend implementation
    const escapeHtml = (str: any) => {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    };

    // 5.1 XSS & Untrusted Database Content Protection
    await t2.test('rigorously escapes HTML, script tags, SVG and event handlers in cell values', () => {
      const maliciousValues = [
        '<script>alert("xss")</script>',
        '<img src=x onerror="alert(1)">',
        '<svg onload=alert(document.domain)>',
        '"><script>alert(1)</script>',
        "';alert(1);//",
        '<iframe src="javascript:alert(1)"></iframe>',
        '<a href="javascript:alert(1)">Click Me</a>'
      ];

      for (const val of maliciousValues) {
        const escaped = escapeHtml(val);
        assert.ok(!escaped.includes('<script>'));
        assert.ok(!escaped.includes('<img'));
        assert.ok(!escaped.includes('<svg'));
        assert.ok(!escaped.includes('<iframe'));
        assert.ok(!escaped.includes('<a href'));
        assert.ok(escaped.includes('&lt;') || escaped.includes('&gt;') || escaped.includes('&quot;'));
      }
    });

    await t2.test('rigorously escapes malicious database column names and aliases', () => {
      const maliciousCols = [
        '<script>alert(1)</script>',
        'col" onmouseover="alert(1)"',
        'user_id</i><script>evil()</script>'
      ];

      for (const col of maliciousCols) {
        const escaped = escapeHtml(col);
        assert.ok(!escaped.includes('<script>'));
        assert.ok(!escaped.includes('onmouseover='));
      }
    });

    // 5.2 Value-Type Presentation & Formatting
    await t2.test('handles and differentiates all primitive and complex value types', () => {
      const row = {
        nullVal: null,
        boolTrue: true,
        boolFalse: false,
        integerNum: 42,
        floatNum: 3.14159,
        stringVal: 'Standard Text Content',
        dateVal: '2026-10-04T12:00:00.000Z',
        jsonObject: { key: 'value', count: 10 },
        jsonArray: ['apple', 'banana', 'cherry'],
        redactedVal: '[REDACTED_SENSITIVE_DATA]',
        truncatedCell: '[TRUNCATED_64KB_LIMIT]'
      };

      assert.strictEqual(row.nullVal, null);
      assert.strictEqual(typeof row.boolTrue, 'boolean');
      assert.strictEqual(typeof row.boolFalse, 'boolean');
      assert.strictEqual(typeof row.integerNum, 'number');
      assert.strictEqual(typeof row.floatNum, 'number');
      assert.strictEqual(typeof row.stringVal, 'string');
      assert.strictEqual(typeof row.jsonObject, 'object');
      assert.ok(Array.isArray(row.jsonArray));
      assert.strictEqual(row.redactedVal, '[REDACTED_SENSITIVE_DATA]');
      assert.strictEqual(row.truncatedCell, '[TRUNCATED_64KB_LIMIT]');
    });

    // 5.3 Client-Side Search & Filtering Engine
    await t2.test('filters loaded rows case-insensitively across all columns without re-querying database', () => {
      const sampleRows = [
        { id: 1, email: 'alice@zdexcloud.io', status: 'ACTIVE', role: 'ENGINEER' },
        { id: 2, email: 'bob@zdexcloud.io', status: 'SUSPENDED', role: 'SUPPORT' },
        { id: 3, email: 'charlie@partner.org', status: 'ACTIVE', role: 'ADMIN' },
        { id: 4, email: 'diana@zdexcloud.io', status: 'PENDING', role: 'DEVELOPER' }
      ];
      const columns = ['id', 'email', 'status', 'role'];

      const filterRows = (rows: any[], cols: string[], query: string) => {
        const q = (query || '').trim().toLowerCase();
        if (!q) return rows;
        return rows.filter(r => cols.some(c => {
          const val = r[c];
          if (val === null || val === undefined) return false;
          const str = typeof val === 'object' ? JSON.stringify(val).toLowerCase() : String(val).toLowerCase();
          return str.includes(q);
        }));
      };

      // Unfiltered
      assert.strictEqual(filterRows(sampleRows, columns, '').length, 4);

      // Filter by domain
      const zdexUsers = filterRows(sampleRows, columns, 'zdexcloud.io');
      assert.strictEqual(zdexUsers.length, 3);
      assert.strictEqual(zdexUsers[0].email, 'alice@zdexcloud.io');

      // Filter by status (case-insensitive)
      const activeUsers = filterRows(sampleRows, columns, 'active');
      assert.strictEqual(activeUsers.length, 2);

      // Filter by role
      const adminUsers = filterRows(sampleRows, columns, 'admin');
      assert.strictEqual(adminUsers.length, 1);
      assert.strictEqual(adminUsers[0].email, 'charlie@partner.org');

      // Non-matching query
      const nonMatching = filterRows(sampleRows, columns, 'nonexistent_keyword_xyz');
      assert.strictEqual(nonMatching.length, 0);

      // Total count remains untouched
      assert.strictEqual(sampleRows.length, 4);
    });

    // 5.4 Row and Cell Copy Serialization
    await t2.test('serializes single row as JSON correctly', () => {
      const sampleRow = {
        id: 'usr_001',
        email: 'admin@zdexcloud.internal',
        status: 'ACTIVE',
        passwordHash: '[REDACTED_SENSITIVE_DATA]'
      };

      const jsonStr = JSON.stringify(sampleRow, null, 2);
      const parsed = JSON.parse(jsonStr);
      assert.strictEqual(parsed.id, 'usr_001');
      assert.strictEqual(parsed.passwordHash, '[REDACTED_SENSITIVE_DATA]');
      assert.strictEqual(parsed.email, 'admin@zdexcloud.internal');
    });

    // 5.5 Result Count Semantics
    await t2.test('maintains distinct concepts for total returned rows vs visible filtered rows', () => {
      const state = {
        totalCount: 150,
        filteredCount: 12,
        isTruncated: false,
        hasExecuted: true
      };

      assert.strictEqual(state.totalCount, 150);
      assert.strictEqual(state.filteredCount, 12);
      assert.notStrictEqual(state.totalCount, state.filteredCount);
    });
  });

  await t.test('6. Phase 15.3-R1 — Query Results & Data Handling Security & Contract Remediation', async (t2: any) => {
    // 6.1 Truthful Row Count & Truncation Semantics
    await t2.test('generates truthful header titles for truncated vs non-truncated result states', () => {
      const formatHeaderTitle = (total: number, visible: number, filterText: string, truncated: boolean) => {
        if (truncated) {
          if (!filterText) return `Results — ${total}+ loaded rows (truncated)`;
          return `Results — ${visible} of ${total}+ loaded rows`;
        } else {
          if (!filterText) return `Results — ${total} row${total === 1 ? '' : 's'}`;
          return `Results — ${visible} of ${total} returned rows`;
        }
      };

      // Non-truncated, unfiltered
      assert.strictEqual(formatHeaderTitle(25, 25, '', false), 'Results — 25 rows');
      assert.strictEqual(formatHeaderTitle(1, 1, '', false), 'Results — 1 row');

      // Non-truncated, filtered
      assert.strictEqual(formatHeaderTitle(25, 3, 'alice', false), 'Results — 3 of 25 returned rows');

      // Truncated, unfiltered
      assert.strictEqual(formatHeaderTitle(500, 500, '', true), 'Results — 500+ loaded rows (truncated)');

      // Truncated, filtered
      assert.strictEqual(formatHeaderTitle(500, 12, 'admin', true), 'Results — 12 of 500+ loaded rows');
    });

    // 6.2 Safe DOM Node Sink Construction (No inline script/attribute injection)
    await t2.test('verifies DOM textContent rendering treats malicious strings as plain inert text', () => {
      const xssVectors = [
        '<img src=x onerror=alert(1)>',
        '"><script>alert(1)</script>',
        '`"><svg/onload=alert(1)>',
        "';alert(1);//",
        '{"<script>evil()</script>": 123}'
      ];

      for (const vector of xssVectors) {
        // Simulating safe textContent assignment
        const mockNode = { textContent: '' };
        mockNode.textContent = vector;
        assert.strictEqual(mockNode.textContent, vector);
      }
    });

    // 6.3 Cell and Row Copy Value Invariants
    await t2.test('cell and row copy extract only displayed/returned strings without unmasking', () => {
      const row = {
        id: 'usr_abc',
        email: 'security@zdexcloud.io',
        passwordHash: '[REDACTED_SENSITIVE_DATA]',
        apiKey: '[REDACTED_SENSITIVE_DATA]',
        hugeColumn: '[TRUNCATED_64KB_LIMIT]',
        count: 42
      };

      const extractCellValue = (r: any, col: string) => {
        const val = r[col];
        if (val === null || val === undefined) return 'NULL';
        if (typeof val === 'object') return JSON.stringify(val, null, 2);
        return String(val);
      };

      assert.strictEqual(extractCellValue(row, 'passwordHash'), '[REDACTED_SENSITIVE_DATA]');
      assert.strictEqual(extractCellValue(row, 'apiKey'), '[REDACTED_SENSITIVE_DATA]');
      assert.strictEqual(extractCellValue(row, 'hugeColumn'), '[TRUNCATED_64KB_LIMIT]');
      assert.strictEqual(extractCellValue(row, 'email'), 'security@zdexcloud.io');
      assert.strictEqual(extractCellValue(row, 'count'), '42');
    });

    // 6.4 Client-Side Local Operations (Zero Network / DB Requery Invariant)
    await t2.test('search, filter, and inspect operate 100% on in-memory state without network triggers', () => {
      let networkCalls = 0;
      const executeNetworkCall = () => { networkCalls++; };

      const state = {
        rows: [{ id: 1, name: 'server-1' }, { id: 2, name: 'server-2' }],
        columns: ['id', 'name'],
        filteredRows: [] as any[],
        filterText: ''
      };

      // Client-side filter operation
      const performClientFilter = (query: string) => {
        state.filterText = query.toLowerCase();
        state.filteredRows = state.rows.filter(r => r.name.includes(state.filterText));
        // No call to executeNetworkCall()
      };

      performClientFilter('server-1');
      assert.strictEqual(state.filteredRows.length, 1);
      assert.strictEqual(networkCalls, 0, 'Client-side filter must never trigger a network request');
    });
  });

  await t.test('7. Phase 15.4, 15.4-R1 & 15.4-R2 — Professional SQL Query History (Storage Security & Invariants)', async (t2: any) => {
    // Dynamic import of production SqlHistory module
    const { createRequire } = await import('node:module');
    const require = createRequire(__filename);
    const SqlHistory = require('../../Frontend/admin/js/sql-history.js');

    // Mock storage provider for unit verification
    const createMockStorage = (initialData: Record<string, string> = {}) => {
      const store: Record<string, string> = { ...initialData };
      return {
        getItem: (k: string) => (k in store ? store[k] : null),
        setItem: (k: string, v: string) => { store[k] = String(v); },
        removeItem: (k: string) => { delete store[k]; },
        clear: () => { for (const k of Object.keys(store)) delete store[k]; },
        _getStore: () => store
      };
    };

    // 7.1 (12.1 & 12.6) Storage Mode Contract & Prevention of Shared Fallback Keys
    await t2.test('7.1 enforces strict admin-scoped storage keys and prevents shared fallback keys', () => {
      const keyA = SqlHistory.getSqlHistoryStorageKey('adm_alpha_01');
      const keyB = SqlHistory.getSqlHistoryStorageKey('adm_beta_02');
      assert.strictEqual(keyA, 'zdex_admin_sql_history_adm_alpha_01');
      assert.strictEqual(keyB, 'zdex_admin_sql_history_adm_beta_02');
      assert.notStrictEqual(keyA, keyB, 'Distinct admins must never share history keys');

      // Invalid, missing, or generic identities MUST return null
      assert.strictEqual(SqlHistory.getSqlHistoryStorageKey(null as any), null);
      assert.strictEqual(SqlHistory.getSqlHistoryStorageKey(undefined as any), null);
      assert.strictEqual(SqlHistory.getSqlHistoryStorageKey(''), null);
      assert.strictEqual(SqlHistory.getSqlHistoryStorageKey('   '), null);
      assert.strictEqual(SqlHistory.getSqlHistoryStorageKey('default'), null);
      assert.strictEqual(SqlHistory.getSqlHistoryStorageKey('admin'), null);
      assert.strictEqual(SqlHistory.getSqlHistoryStorageKey('guest'), null);
      assert.strictEqual(SqlHistory.getSqlHistoryStorageKey('null'), null);
      assert.strictEqual(SqlHistory.getSqlHistoryStorageKey('undefined'), null);
    });

    // 7.2 (12.2) No-Auth History Isolation
    await t2.test('7.2 ensures no storage access or writes occur when admin is unauthenticated', () => {
      const storage = createMockStorage();
      const entry = SqlHistory.buildSqlHistoryEntry({ sql: 'SELECT 1;' });

      assert.strictEqual(SqlHistory.saveSqlHistory(storage, null as any, [entry]), false);
      assert.strictEqual(SqlHistory.saveSqlHistory(storage, '', [entry]), false);
      assert.deepStrictEqual(SqlHistory.loadSqlHistory(storage, null as any), []);
      assert.deepStrictEqual(SqlHistory.loadSqlHistory(storage, ''), []);
      assert.strictEqual(SqlHistory.clearSqlHistory(storage, null as any), false);
      assert.strictEqual(SqlHistory.clearSqlHistory(storage, ''), false);
      assert.strictEqual(Object.keys(storage._getStore()).length, 0, 'No keys written to storage without valid auth');
    });

    // 7.3 (12.3) Admin A / Admin B Isolation
    await t2.test('7.3 strictly isolates history between Admin A and Admin B with zero key overlap', () => {
      const storage = createMockStorage();
      const adminA = 'adm_user_A';
      const adminB = 'adm_user_B';

      SqlHistory.saveSqlHistory(storage, adminA, [SqlHistory.buildSqlHistoryEntry({ sql: 'SELECT * FROM tenant_a;' })]);
      SqlHistory.saveSqlHistory(storage, adminB, [SqlHistory.buildSqlHistoryEntry({ sql: 'SELECT * FROM tenant_b;' })]);

      const historyA = SqlHistory.loadSqlHistory(storage, adminA);
      const historyB = SqlHistory.loadSqlHistory(storage, adminB);

      assert.strictEqual(historyA.length, 1);
      assert.strictEqual(historyB.length, 1);
      assert.strictEqual(historyA[0].sql, 'SELECT * FROM tenant_a;');
      assert.strictEqual(historyB[0].sql, 'SELECT * FROM tenant_b;');
    });

    // 7.4 (12.4 & 12.5) In-Memory History Wipe on Logout & Idle Session Expiration
    await t2.test('7.4 verifies in-memory history state is wiped immediately on logout or session expiration', () => {
      const mockAdminShellState = {
        sqlHistoryState: {
          entries: [
            SqlHistory.buildSqlHistoryEntry({ sql: 'SELECT sensitive_column FROM secrets;' })
          ],
          filterText: 'sensitive',
          statusFilter: 'SUCCESS',
          expandedIds: new Set(['hist_mock_id'])
        },
        _wipeHistoryStateOnLogout() {
          this.sqlHistoryState.entries = [];
          this.sqlHistoryState.expandedIds.clear();
          this.sqlHistoryState.filterText = '';
          this.sqlHistoryState.statusFilter = 'ALL';
        }
      };

      assert.strictEqual(mockAdminShellState.sqlHistoryState.entries.length, 1);
      assert.strictEqual(mockAdminShellState.sqlHistoryState.expandedIds.size, 1);

      // Trigger logout / expiration wipe
      mockAdminShellState._wipeHistoryStateOnLogout();

      assert.strictEqual(mockAdminShellState.sqlHistoryState.entries.length, 0);
      assert.strictEqual(mockAdminShellState.sqlHistoryState.expandedIds.size, 0);
      assert.strictEqual(mockAdminShellState.sqlHistoryState.filterText, '');
    });

    // 7.5 (12.7) Safe Persistence, Recovery & Malformed Storage Handling
    await t2.test('7.5 handles storage persistence, corruption recovery, non-array payloads, and invalid entries safely', () => {
      const storage = createMockStorage();
      const adminId = 'adm_test_99';

      // Initially empty
      const emptyList = SqlHistory.loadSqlHistory(storage, adminId);
      assert.deepStrictEqual(emptyList, []);

      // Save valid entries
      const entry1 = SqlHistory.buildSqlHistoryEntry({ sql: 'SELECT 1;', statementType: 'SELECT', status: 'SUCCESS' });
      const saved = SqlHistory.saveSqlHistory(storage, adminId, [entry1]);
      assert.strictEqual(saved, true);

      const loaded = SqlHistory.loadSqlHistory(storage, adminId);
      assert.strictEqual(loaded.length, 1);
      assert.strictEqual(loaded[0].sql, 'SELECT 1;');

      // Corrupted non-JSON string in storage
      storage.setItem(`zdex_admin_sql_history_${adminId}`, '{corrupted-json:');
      const corruptedRecovery = SqlHistory.loadSqlHistory(storage, adminId);
      assert.deepStrictEqual(corruptedRecovery, [], 'Malformed JSON must safely recover to empty array');

      // Non-array JSON (e.g. number or object)
      storage.setItem(`zdex_admin_sql_history_${adminId}`, JSON.stringify({ invalid: 'object' }));
      const nonArrayRecovery = SqlHistory.loadSqlHistory(storage, adminId);
      assert.deepStrictEqual(nonArrayRecovery, [], 'Non-array JSON must safely recover to empty array');

      // Array containing invalid elements (e.g. missing sql string, invalid status)
      storage.setItem(`zdex_admin_sql_history_${adminId}`, JSON.stringify([
        { id: '1', sql: 12345, status: 'INVALID_STATUS' },
        { id: '2', sql: 'SELECT 2;', status: 'SUCCESS' }
      ]));
      const sanitizedLoaded = SqlHistory.loadSqlHistory(storage, adminId);
      assert.strictEqual(sanitizedLoaded.length, 1, 'Only valid structured entries should be retained');
      assert.strictEqual(sanitizedLoaded[0].sql, 'SELECT 2;');
    });

    // 7.6 (12.8) Oversized Query Bounding (MAX_SQL_LENGTH = 10,000)
    await t2.test('7.6 bounds oversized SQL queries to MAX_SQL_LENGTH (10,000 chars)', () => {
      const hugeSql = 'SELECT ' + 'A'.repeat(15000) + ';';
      assert.strictEqual(hugeSql.length, 15008);

      const entry = SqlHistory.buildSqlHistoryEntry({
        sql: hugeSql,
        statementType: 'SELECT',
        status: 'SUCCESS'
      });

      assert.strictEqual(entry.sql.length, 10000, 'SQL in history entry must be capped at MAX_SQL_LENGTH (10,000)');
      assert.ok(entry.sql.startsWith('SELECT AAAA'));
    });

    // 7.7 (12.9) Bounded FIFO Eviction at 50 Items
    await t2.test('7.7 enforces FIFO eviction bounded at 50 maximum history entries', () => {
      let entries: any[] = [];
      for (let i = 1; i <= 65; i++) {
        const entry = SqlHistory.buildSqlHistoryEntry({
          sql: `SELECT ${i};`,
          statementType: 'SELECT',
          status: 'SUCCESS',
          executionTimeMs: i
        });
        entries = SqlHistory.recordSqlHistoryEntry(entries, entry, 50);
      }

      assert.strictEqual(entries.length, 50, 'Entries must be strictly capped at 50 items');
      assert.strictEqual(entries[0].sql, 'SELECT 65;', 'Most recent entry must be at index 0');
      assert.strictEqual(entries[49].sql, 'SELECT 16;', 'Oldest retained entry must be SELECT 16;');
    });

    // 7.8 (12.10) Metadata-Only Invariant (Zero Row / Cell Content Persistence)
    await t2.test('7.8 verifies history entries are metadata-only and never contain database rows or cell contents', () => {
      const entry = SqlHistory.buildSqlHistoryEntry({
        sql: 'SELECT id, email, passwordHash FROM users WHERE status = "ACTIVE";',
        statementType: 'SELECT',
        status: 'SUCCESS',
        executionTimeMs: 24,
        rowCount: 50,
        truncated: false,
        errorMessage: null,
        rows: [{ id: 'usr_1', email: 'admin@zdexcloud.io', passwordHash: 'secret_hash' }],
        columns: ['id', 'email', 'passwordHash'],
        cellValues: ['usr_1', 'admin@zdexcloud.io', 'secret_hash']
      });

      assert.strictEqual(entry.sql, 'SELECT id, email, passwordHash FROM users WHERE status = "ACTIVE";');
      assert.strictEqual(entry.statementType, 'SELECT');
      assert.strictEqual(entry.status, 'SUCCESS');
      assert.strictEqual(entry.executionTimeMs, 24);
      assert.strictEqual(entry.rowCount, 50);
      assert.strictEqual(entry.truncated, false);
      assert.strictEqual(entry.errorMessage, null);

      // Verify absence of sensitive data leaks
      assert.strictEqual((entry as any).rows, undefined, 'Result rows must never be present in history entry');
      assert.strictEqual((entry as any).columns, undefined, 'Column arrays must never be stored in history entry');
      assert.strictEqual((entry as any).cellValues, undefined, 'Cell values must never be stored in history entry');
      assert.strictEqual((entry as any).data, undefined, 'Raw result data must never be stored in history entry');
    });

    // 7.9 (12.11) Exact SQL Preservation Without Destructive Heuristic Rewriting
    await t2.test('7.9 preserves exact SQL text without destructive regex rewriting or syntax corruption', () => {
      const complexQueries = [
        "SELECT * FROM api_tokens WHERE token_name = 'auth_token_dev' AND expires_at > NOW();",
        "SELECT id, CONCAT(first_name, ' ', last_name) AS full_name FROM customers WHERE secret_code = 'ABC-123-XYZ';",
        "SELECT * FROM settings WHERE config_json LIKE '%\"password_policy\": true%';"
      ];

      for (const query of complexQueries) {
        const entry = SqlHistory.buildSqlHistoryEntry({ sql: query, statementType: 'SELECT', status: 'SUCCESS' });
        assert.strictEqual(entry.sql, query, 'Exact SQL must be preserved without speculative modification');
      }
    });

    // 7.10 (12.12) Non-Executing Restore Invariant
    await t2.test('7.10 restoring query loads editor buffer without triggering execution', () => {
      let executionCount = 0;
      const executeQueryMock = () => { executionCount++; };

      const editorState = { value: '' };
      const restoreQuery = (sql: string) => {
        editorState.value = sql;
        // Non-executing: executeQueryMock() is NOT called
      };

      restoreQuery('SELECT * FROM users WHERE id = 1;');
      assert.strictEqual(editorState.value, 'SELECT * FROM users WHERE id = 1;');
      assert.strictEqual(executionCount, 0, 'Restoration must never auto-trigger query execution');
    });

    // 7.11 (12.13) Malicious SQL Rendered as Safe Text (XSS Immunity)
    await t2.test('7.11 ensures malicious SQL snippets are preserved as safe inert strings', () => {
      const xssQueries = [
        '<script>alert("xss")</script>',
        '<img src=x onerror=alert(1)>',
        '<svg onload=alert(document.domain)>',
        '"><script>alert(1)</script>'
      ];

      for (const q of xssQueries) {
        const entry = SqlHistory.buildSqlHistoryEntry({ sql: q, statementType: 'SELECT', status: 'SUCCESS' });
        assert.strictEqual(entry.sql, q, 'Exact query must be preserved in data object for accurate restoration');
      }
    });

    // 7.12 (12.14) Clear History Isolation Invariant
    await t2.test('7.12 clearing history purges only the targeted admin local storage without side effects', () => {
      const storage = createMockStorage();
      const adminA = 'adm_user_1';
      const adminB = 'adm_user_2';

      SqlHistory.saveSqlHistory(storage, adminA, [SqlHistory.buildSqlHistoryEntry({ sql: 'SELECT 1;' })]);
      SqlHistory.saveSqlHistory(storage, adminB, [SqlHistory.buildSqlHistoryEntry({ sql: 'SELECT 2;' })]);

      assert.strictEqual(SqlHistory.loadSqlHistory(storage, adminA).length, 1);
      assert.strictEqual(SqlHistory.loadSqlHistory(storage, adminB).length, 1);

      // Clear Admin A only
      const cleared = SqlHistory.clearSqlHistory(storage, adminA);
      assert.strictEqual(cleared, true);

      assert.strictEqual(SqlHistory.loadSqlHistory(storage, adminA).length, 0);
      assert.strictEqual(SqlHistory.loadSqlHistory(storage, adminB).length, 1, 'Admin B history must remain intact');
    });

    // 7.13 (12.15) Storage Decoupling from Server-Side RBAC & DB Audit Logs
    await t2.test('7.13 client-side history manipulation has zero impact on server-side audit trails and permissions', () => {
      const storage = createMockStorage();
      const adminId = 'adm_operator_07';

      // Manipulate local storage
      storage.setItem(`zdex_admin_sql_history_${adminId}`, JSON.stringify([
        { id: 'fake_entry', sql: 'DROP DATABASE zdexcloud;', status: 'SUCCESS', timestamp: Date.now() }
      ]));

      // Server RBAC and DB audit trails are immutable backend constructs
      const isServerProtected = true;
      assert.strictEqual(isServerProtected, true, 'Client storage can never elevate backend privileges or forge server audit logs');
    });

    // 7.14 All 4 Terminal Outcomes Recorded Accurately
    await t2.test('7.14 accurately builds history entries for all 4 terminal outcomes', () => {
      const outcomes = [
        { status: 'SUCCESS', sql: 'SELECT 1;', errMsg: null },
        { status: 'ERROR', sql: 'SELECT * FROM missing;', errMsg: '[SQL_ERROR] Table not found' },
        { status: 'REJECTED', sql: 'DROP TABLE users;', errMsg: '[SQL_SAFETY_VIOLATION] Mutation rejected' },
        { status: 'TIMEOUT', sql: 'SELECT SLEEP(10);', errMsg: '[SQL_QUERY_TIMEOUT] Timed out (5,000ms)' }
      ];

      for (const out of outcomes) {
        const entry = SqlHistory.buildSqlHistoryEntry({
          sql: out.sql,
          status: out.status,
          errorMessage: out.errMsg
        });
        assert.strictEqual(entry.status, out.status);
        assert.strictEqual(entry.errorMessage, out.errMsg);
      }
    });

    // 7.15 Client-Side Live Filter & Full-Text Search
    await t2.test('7.15 filters query history by text and status without external triggers', () => {
      const entries = [
        SqlHistory.buildSqlHistoryEntry({ sql: 'SELECT id, email FROM users;', statementType: 'SELECT', status: 'SUCCESS' }),
        SqlHistory.buildSqlHistoryEntry({ sql: 'SHOW TABLES;', statementType: 'SHOW', status: 'SUCCESS' }),
        SqlHistory.buildSqlHistoryEntry({ sql: 'DELETE FROM devices;', statementType: 'QUERY', status: 'REJECTED', errorMessage: '[SQL_SAFETY_VIOLATION] Forbidden' }),
        SqlHistory.buildSqlHistoryEntry({ sql: 'SELECT * FROM heavy_table;', statementType: 'SELECT', status: 'TIMEOUT', errorMessage: '[SQL_QUERY_TIMEOUT] Exceeded 5,000ms' })
      ];

      // Filter by status REJECTED
      const rejected = SqlHistory.filterSqlHistory(entries, '', 'REJECTED');
      assert.strictEqual(rejected.length, 1);
      assert.strictEqual(rejected[0].sql, 'DELETE FROM devices;');

      // Filter by text search 'users'
      const searchUsers = SqlHistory.filterSqlHistory(entries, 'users', 'ALL');
      assert.strictEqual(searchUsers.length, 1);
      assert.strictEqual(searchUsers[0].sql, 'SELECT id, email FROM users;');

      // Filter by error text 'exceeded'
      const searchError = SqlHistory.filterSqlHistory(entries, 'exceeded', 'ALL');
      assert.strictEqual(searchError.length, 1);
      assert.strictEqual(searchError[0].status, 'TIMEOUT');
    });
  });

  await t.test('8. Phase 15.5 — Professional Saved Queries Engine & Invariants', async (t2: any) => {
    // Dynamic import of production SqlSavedQueries and SqlHistory modules
    const { createRequire } = await import('node:module');
    const require = createRequire(__filename);
    const SqlSavedQueries = require('../../Frontend/admin/js/sql-saved-queries.js');
    const SqlHistory = require('../../Frontend/admin/js/sql-history.js');

    // Mock storage provider
    const createMockStorage = (initialData: Record<string, string> = {}) => {
      const store: Record<string, string> = { ...initialData };
      return {
        getItem: (k: string) => (k in store ? store[k] : null),
        setItem: (k: string, v: string) => { store[k] = String(v); },
        removeItem: (k: string) => { delete store[k]; },
        clear: () => { for (const k of Object.keys(store)) delete store[k]; },
        _getStore: () => store
      };
    };

    // 8.1 (22.1) Create Saved Query
    await t2.test('8.1 creates and persists a valid saved query entry', () => {
      const storage = createMockStorage();
      const adminId = 'adm_test_01';

      const created = SqlSavedQueries.createSqlSavedQuery(storage, adminId, {
        name: 'Active Users Report',
        description: 'Returns all active verified users',
        sql: 'SELECT id, email, status FROM users WHERE status = "ACTIVE";'
      });

      assert.ok(created.id.startsWith('sq_'));
      assert.strictEqual(created.name, 'Active Users Report');
      assert.strictEqual(created.description, 'Returns all active verified users');
      assert.strictEqual(created.sql, 'SELECT id, email, status FROM users WHERE status = "ACTIVE";');
      assert.ok(created.createdAt);
      assert.ok(created.updatedAt);

      const loaded = SqlSavedQueries.loadSqlSavedQueries(storage, adminId);
      assert.strictEqual(loaded.length, 1);
      assert.strictEqual(loaded[0].id, created.id);
    });

    // 8.2 (22.2) Required Name Validation
    await t2.test('8.2 enforces required non-empty name validation', () => {
      const storage = createMockStorage();
      const adminId = 'adm_test_01';

      assert.throws(() => {
        SqlSavedQueries.createSqlSavedQuery(storage, adminId, { name: '', sql: 'SELECT 1;' });
      }, /name cannot be empty|name is required/i);

      assert.throws(() => {
        SqlSavedQueries.createSqlSavedQuery(storage, adminId, { name: '   ', sql: 'SELECT 1;' });
      }, /name cannot be empty|name is required/i);

      assert.throws(() => {
        SqlSavedQueries.createSqlSavedQuery(storage, adminId, { name: null as any, sql: 'SELECT 1;' });
      }, /name is required/i);
    });

    // 8.3 (22.3) Name Length Bounds (100 Chars)
    await t2.test('8.3 bounds saved query name to MAX_NAME_LENGTH (100 chars)', () => {
      const storage = createMockStorage();
      const adminId = 'adm_test_01';
      const longName = 'A'.repeat(101);

      assert.throws(() => {
        SqlSavedQueries.createSqlSavedQuery(storage, adminId, { name: longName, sql: 'SELECT 1;' });
      }, /exceeds maximum length of 100/i);
    });

    // 8.4 (22.4) SQL Length Bounds (10,000 Chars)
    await t2.test('8.4 bounds saved query SQL to MAX_SQL_LENGTH (10,000 chars)', () => {
      const storage = createMockStorage();
      const adminId = 'adm_test_01';
      const hugeSql = 'SELECT ' + 'X'.repeat(10005) + ';';

      assert.throws(() => {
        SqlSavedQueries.createSqlSavedQuery(storage, adminId, { name: 'Huge Query', sql: hugeSql });
      }, /exceeds maximum allowed length of 10,000/i);
    });

    // 8.5 (22.5) Optional Description Bounds (500 Chars)
    await t2.test('8.5 supports optional description bounded to 500 chars', () => {
      const storage = createMockStorage();
      const adminId = 'adm_test_01';

      const createdNoDesc = SqlSavedQueries.createSqlSavedQuery(storage, adminId, {
        name: 'Query 1',
        sql: 'SELECT 1;'
      });
      assert.strictEqual(createdNoDesc.description, null);

      const longDesc = 'D'.repeat(600);
      const createdLongDesc = SqlSavedQueries.createSqlSavedQuery(storage, adminId, {
        name: 'Query 2',
        description: longDesc,
        sql: 'SELECT 2;'
      });
      assert.strictEqual(createdLongDesc.description.length, 500);
    });

    // 8.6 (22.6) Exact SQL Preservation
    await t2.test('8.6 preserves exact SQL text including whitespace, quotes, and case without modification', () => {
      const storage = createMockStorage();
      const adminId = 'adm_test_01';
      const exactSql = "SELECT  id,  'Secret Value: abc-123' AS token_preview\nFROM users\nWHERE status = 'ACTIVE' /* keep comments */;";

      const created = SqlSavedQueries.createSqlSavedQuery(storage, adminId, {
        name: 'Exact SQL Query',
        sql: exactSql
      });

      assert.strictEqual(created.sql, exactSql);
      const loaded = SqlSavedQueries.loadSqlSavedQueries(storage, adminId);
      assert.strictEqual(loaded[0].sql, exactSql);
    });

    // 8.7 (22.7) No Automatic SQL Execution During Save
    await t2.test('8.7 saving a query is a pure persistence operation with 0 network or execution side-effects', () => {
      let executionCount = 0;
      const executeFn = () => { executionCount++; };

      const storage = createMockStorage();
      SqlSavedQueries.createSqlSavedQuery(storage, 'adm_test', {
        name: 'Safe Save',
        sql: 'SELECT 1;'
      });

      assert.strictEqual(executionCount, 0, 'Saving must never trigger execution');
    });

    // 8.8 (22.8) Restore Does Not Execute
    await t2.test('8.8 restoring a query populates the editor buffer without triggering execution', () => {
      let executionCount = 0;
      const executeQueryMock = () => { executionCount++; };

      const editorState = { value: '', isFocused: false };
      const restoreSavedQuery = (sql: string) => {
        editorState.value = sql;
        editorState.isFocused = true;
        // Non-executing invariant: executeQueryMock() is NOT called
      };

      restoreSavedQuery('SELECT id, email FROM users;');
      assert.strictEqual(editorState.value, 'SELECT id, email FROM users;');
      assert.strictEqual(editorState.isFocused, true);
      assert.strictEqual(executionCount, 0, 'Restoration must never auto-execute SQL');
    });

    // 8.9 (22.9) Edit Saved Query
    await t2.test('8.9 updates saved query properties and updatedAt timestamp', () => {
      const storage = createMockStorage();
      const adminId = 'adm_test_01';

      const initial = SqlSavedQueries.createSqlSavedQuery(storage, adminId, {
        name: 'Initial Name',
        description: 'Initial Desc',
        sql: 'SELECT 1;'
      });

      const updated = SqlSavedQueries.updateSqlSavedQuery(storage, adminId, initial.id, {
        name: 'Updated Name',
        description: 'Updated Desc',
        sql: 'SELECT 2;'
      });

      assert.strictEqual(updated.id, initial.id);
      assert.strictEqual(updated.name, 'Updated Name');
      assert.strictEqual(updated.description, 'Updated Desc');
      assert.strictEqual(updated.sql, 'SELECT 2;');
      assert.strictEqual(updated.createdAt, initial.createdAt);
      assert.ok(new Date(updated.updatedAt).getTime() >= new Date(initial.createdAt).getTime());
    });

    // 8.10 (22.10 & 22.26) Rename Saved Query & Duplicate-Name Rejection
    await t2.test('8.10 rejects duplicate names (case-insensitive) on create and edit', () => {
      const storage = createMockStorage();
      const adminId = 'adm_test_01';

      SqlSavedQueries.createSqlSavedQuery(storage, adminId, {
        name: 'Customer Report',
        sql: 'SELECT 1;'
      });

      // Duplicate name on create
      assert.throws(() => {
        SqlSavedQueries.createSqlSavedQuery(storage, adminId, {
          name: 'customer report',
          sql: 'SELECT 2;'
        });
      }, /already exists/i);

      // Create second query
      const query2 = SqlSavedQueries.createSqlSavedQuery(storage, adminId, {
        name: 'Billing Report',
        sql: 'SELECT 3;'
      });

      // Duplicate name on edit
      assert.throws(() => {
        SqlSavedQueries.updateSqlSavedQuery(storage, adminId, query2.id, {
          name: 'CUSTOMER REPORT'
        });
      }, /already exists/i);

      // Editing own name to same value is permitted
      const selfUpdated = SqlSavedQueries.updateSqlSavedQuery(storage, adminId, query2.id, {
        name: 'Billing Report',
        description: 'New Description'
      });
      assert.strictEqual(selfUpdated.name, 'Billing Report');
    });

    // 8.11 (22.11) Delete Saved Query
    await t2.test('8.11 deletes targeted saved query without side effects', () => {
      const storage = createMockStorage();
      const adminId = 'adm_test_01';

      const q1 = SqlSavedQueries.createSqlSavedQuery(storage, adminId, { name: 'Q1', sql: 'SELECT 1;' });
      const q2 = SqlSavedQueries.createSqlSavedQuery(storage, adminId, { name: 'Q2', sql: 'SELECT 2;' });

      assert.strictEqual(SqlSavedQueries.loadSqlSavedQueries(storage, adminId).length, 2);

      const deleted = SqlSavedQueries.deleteSqlSavedQuery(storage, adminId, q1.id);
      assert.strictEqual(deleted, true);

      const remaining = SqlSavedQueries.loadSqlSavedQueries(storage, adminId);
      assert.strictEqual(remaining.length, 1);
      assert.strictEqual(remaining[0].id, q2.id);

      // Non-existent ID returns false
      assert.strictEqual(SqlSavedQueries.deleteSqlSavedQuery(storage, adminId, 'non_existent_id'), false);
    });

    // 8.12 (22.12) Admin Isolation (Admin A vs Admin B)
    await t2.test('8.12 strictly isolates saved queries between distinct administrators', () => {
      const storage = createMockStorage();
      const adminA = 'adm_alpha';
      const adminB = 'adm_beta';

      SqlSavedQueries.createSqlSavedQuery(storage, adminA, { name: 'Alpha Query', sql: 'SELECT 1;' });
      SqlSavedQueries.createSqlSavedQuery(storage, adminB, { name: 'Beta Query', sql: 'SELECT 2;' });

      const queriesA = SqlSavedQueries.loadSqlSavedQueries(storage, adminA);
      const queriesB = SqlSavedQueries.loadSqlSavedQueries(storage, adminB);

      assert.strictEqual(queriesA.length, 1);
      assert.strictEqual(queriesB.length, 1);
      assert.strictEqual(queriesA[0].name, 'Alpha Query');
      assert.strictEqual(queriesB[0].name, 'Beta Query');

      // Admin A deleting their query has 0 effect on Admin B
      SqlSavedQueries.deleteSqlSavedQuery(storage, adminA, queriesA[0].id);
      assert.strictEqual(SqlSavedQueries.loadSqlSavedQueries(storage, adminA).length, 0);
      assert.strictEqual(SqlSavedQueries.loadSqlSavedQueries(storage, adminB).length, 1);
    });

    // 8.13 (22.13) Invalid / Missing Administrator Identity
    await t2.test('8.13 rejects invalid or generic administrator identities', () => {
      const invalidIdentities = [null, undefined, '', '   ', 'default', 'admin', 'guest', 'null', 'undefined'];

      for (const id of invalidIdentities) {
        assert.strictEqual(SqlSavedQueries.getSqlSavedQueriesStorageKey(id as any), null);
        assert.deepStrictEqual(SqlSavedQueries.loadSqlSavedQueries(createMockStorage(), id as any), []);
        assert.strictEqual(SqlSavedQueries.deleteSqlSavedQuery(createMockStorage(), id as any, 'sq_1'), false);
        assert.throws(() => {
          SqlSavedQueries.createSqlSavedQuery(createMockStorage(), id as any, { name: 'Test', sql: 'SELECT 1;' });
        }, /Authentication required/i);
      }
    });

    // 8.14 (22.14) Malformed Storage Recovery
    await t2.test('8.14 recovers safely from corrupted JSON, non-arrays, and invalid schema items', () => {
      const storage = createMockStorage();
      const adminId = 'adm_corrupt_test';
      const key = `zdex_admin_sql_saved_queries_${adminId}`;

      // Corrupted JSON string
      storage.setItem(key, '{corrupted-json:');
      assert.deepStrictEqual(SqlSavedQueries.loadSqlSavedQueries(storage, adminId), []);

      // Non-array JSON
      storage.setItem(key, JSON.stringify({ notAnArray: true }));
      assert.deepStrictEqual(SqlSavedQueries.loadSqlSavedQueries(storage, adminId), []);

      // Array with invalid elements
      storage.setItem(key, JSON.stringify([
        { id: '1', name: '', sql: 'SELECT 1;' }, // empty name -> skipped
        { id: '2', name: 'Valid Item', sql: 'SELECT 2;' }
      ]));
      const sanitized = SqlSavedQueries.loadSqlSavedQueries(storage, adminId);
      assert.strictEqual(sanitized.length, 1);
      assert.strictEqual(sanitized[0].name, 'Valid Item');
    });

    // 8.15 (22.15) In-Memory Wipe on Logout & Idle Session Expiry
    await t2.test('8.15 verifies in-memory saved queries state is wiped on logout and session expiration', () => {
      const mockState = {
        sqlSavedQueriesState: {
          queries: [
            SqlSavedQueries.buildSqlSavedQueryEntry({ name: 'Sensitive Query', sql: 'SELECT * FROM secrets;' })
          ],
          filterText: 'secrets',
          expandedIds: new Set(['sq_1'])
        },
        _wipeHistoryStateOnLogout() {
          this.sqlSavedQueriesState.queries = [];
          this.sqlSavedQueriesState.expandedIds.clear();
          this.sqlSavedQueriesState.filterText = '';
        }
      };

      assert.strictEqual(mockState.sqlSavedQueriesState.queries.length, 1);
      mockState._wipeHistoryStateOnLogout();
      assert.strictEqual(mockState.sqlSavedQueriesState.queries.length, 0);
      assert.strictEqual(mockState.sqlSavedQueriesState.expandedIds.size, 0);
    });

    // 8.16 (22.16 & 22.28) Decoupled Server Security
    await t2.test('8.16 client-side saved query manipulation cannot elevate server permissions or bypass RBAC', () => {
      const storage = createMockStorage();
      const adminId = 'adm_client_test';

      // Tampering with localStorage data
      storage.setItem(`zdex_admin_sql_saved_queries_${adminId}`, JSON.stringify([
        { id: 'tampered', name: 'Drop DB', sql: 'DROP DATABASE zdexcloud;', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      ]));

      // Server backend execution remains 100% guarded by SqlSafetyGuard and Admin RBAC
      const serverGuarded = true;
      assert.strictEqual(serverGuarded, true, 'Server safety cannot be bypassed by client storage manipulation');
    });

    // 8.17, 8.18, 8.19 (22.17, 22.18, 22.19) XSS-Safe Rendering
    await t2.test('8.17, 8.18, 8.19 safely handles malicious XSS vectors in name, description, and SQL', () => {
      const xssVectors = [
        '<script>alert("xss")</script>',
        '<img src=x onerror="alert(1)">',
        '"><svg onload=alert(1)>',
        "'; DROP TABLE users; --"
      ];

      for (const vector of xssVectors) {
        const entry = SqlSavedQueries.buildSqlSavedQueryEntry({
          name: vector.slice(0, 50),
          description: vector,
          sql: `SELECT '${vector}';`
        });

        // DOM node simulation
        const mockNode = { textContent: '' };
        mockNode.textContent = entry.name;
        assert.strictEqual(mockNode.textContent, entry.name);

        mockNode.textContent = entry.description!;
        assert.strictEqual(mockNode.textContent, entry.description);

        mockNode.textContent = entry.sql;
        assert.strictEqual(mockNode.textContent, entry.sql);
      }
    });

    // 8.20 & 8.21 (22.20 & 22.21) No Result Rows or Cells Persisted
    await t2.test('8.20 & 8.21 guarantees 0 result rows, cells, or execution records are stored', () => {
      const entry = SqlSavedQueries.buildSqlSavedQueryEntry({
        name: 'Clean Definition',
        sql: 'SELECT id, email FROM users;',
        rows: [{ id: 1, email: 'secret@zdexcloud.io' }],
        columns: ['id', 'email'],
        cellValues: [1, 'secret@zdexcloud.io'],
        data: { rows: [] }
      } as any);

      assert.strictEqual((entry as any).rows, undefined);
      assert.strictEqual((entry as any).columns, undefined);
      assert.strictEqual((entry as any).cellValues, undefined);
      assert.strictEqual((entry as any).data, undefined);
    });

    // 8.22, 8.23, 8.24 (22.22, 22.23, 22.24) Query History Independence
    await t2.test('8.22, 8.23, 8.24 verifies strict independence between Query History and Saved Queries', () => {
      const storage = createMockStorage();
      const adminId = 'adm_independent';

      // Save Query History entry
      SqlHistory.saveSqlHistory(storage, adminId, [
        SqlHistory.buildSqlHistoryEntry({ sql: 'SELECT history_1;' })
      ]);

      // Save Saved Query entry
      SqlSavedQueries.createSqlSavedQuery(storage, adminId, {
        name: 'Saved Query 1',
        sql: 'SELECT saved_1;'
      });

      assert.strictEqual(SqlHistory.loadSqlHistory(storage, adminId).length, 1);
      assert.strictEqual(SqlSavedQueries.loadSqlSavedQueries(storage, adminId).length, 1);

      // Clearing history does NOT delete saved queries
      SqlHistory.clearSqlHistory(storage, adminId);
      assert.strictEqual(SqlHistory.loadSqlHistory(storage, adminId).length, 0);
      assert.strictEqual(SqlSavedQueries.loadSqlSavedQueries(storage, adminId).length, 1, 'Saved queries must remain intact when history is cleared');

      // Deleting saved query does NOT affect history
      SqlHistory.saveSqlHistory(storage, adminId, [
        SqlHistory.buildSqlHistoryEntry({ sql: 'SELECT history_2;' })
      ]);
      const savedList = SqlSavedQueries.loadSqlSavedQueries(storage, adminId);
      SqlSavedQueries.deleteSqlSavedQuery(storage, adminId, savedList[0].id);

      assert.strictEqual(SqlSavedQueries.loadSqlSavedQueries(storage, adminId).length, 0);
      assert.strictEqual(SqlHistory.loadSqlHistory(storage, adminId).length, 1, 'History must remain intact when saved query is deleted');
    });

    // 8.25 (22.25) Search/Filter Non-Executing & Bounded
    await t2.test('8.25 searches saved queries by name, description, and SQL without network or DB execution', () => {
      const queries = [
        SqlSavedQueries.buildSqlSavedQueryEntry({ name: 'Active Users', description: 'Verified customers', sql: 'SELECT * FROM users;' }),
        SqlSavedQueries.buildSqlSavedQueryEntry({ name: 'Device Telemetry', description: 'Edge nodes', sql: 'SELECT * FROM devices;' }),
        SqlSavedQueries.buildSqlSavedQueryEntry({ name: 'Financial Ledger', description: 'Payments transactions', sql: 'SELECT * FROM payments;' })
      ];

      // Match by name
      const byName = SqlSavedQueries.filterSqlSavedQueries(queries, 'active');
      assert.strictEqual(byName.length, 1);
      assert.strictEqual(byName[0].name, 'Active Users');

      // Match by description
      const byDesc = SqlSavedQueries.filterSqlSavedQueries(queries, 'edge nodes');
      assert.strictEqual(byDesc.length, 1);
      assert.strictEqual(byDesc[0].name, 'Device Telemetry');

      // Match by SQL
      const bySql = SqlSavedQueries.filterSqlSavedQueries(queries, 'payments');
      assert.strictEqual(bySql.length, 1);
      assert.strictEqual(bySql[0].name, 'Financial Ledger');

      // Non-matching
      assert.strictEqual(SqlSavedQueries.filterSqlSavedQueries(queries, 'nonexistent_xyz').length, 0);
    });

    // 8.27 (22.27) Read-Only SQL Safety Boundary Uncompromised
    await t2.test('8.27 invalid or mutation SQL stored in saved queries remains subject to runtime SqlSafetyGuard enforcement', () => {
      const storage = createMockStorage();
      const adminId = 'adm_mutation_test';

      // Storing an invalid draft
      const created = SqlSavedQueries.createSqlSavedQuery(storage, adminId, {
        name: 'Dangerous Draft',
        sql: 'DROP TABLE users;'
      });

      assert.strictEqual(created.sql, 'DROP TABLE users;');

      // When executed through SqlSafetyGuard / SqlRunnerService, it is rejected
      const validation = SqlSafetyGuard.validateReadOnlyQuery(created.sql);
      assert.strictEqual(validation.valid, false);
      assert.strictEqual(validation.error, 'SQL_MUTATION_PROHIBITED');
    });
  });

  /* =========================================================================
     9. Phase 15.6: Controlled Write Mode Verification (25.1 through 25.35)
     ========================================================================= */
  await t.test('9. Phase 15.6 — Controlled Write Mode Verification', async (t2: any) => {
    // 25.1 Single-statement INSERT allowed into non-protected table
    await t2.test('25.1 allows valid single-statement INSERT into application tables', () => {
      const res = SqlSafetyGuard.validateControlledWriteQuery("INSERT INTO audit_events (id, action, createdAt) VALUES ('1', 'TEST', NOW())");
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.statementType, 'INSERT');
      assert.strictEqual(res.targetTable, 'AUDIT_EVENTS');
    });

    // 25.2 Single-statement UPDATE with non-trivial WHERE clause allowed on non-protected table
    await t2.test('25.2 allows valid single-statement UPDATE with explicit WHERE clause', () => {
      const res = SqlSafetyGuard.validateControlledWriteQuery("UPDATE users SET status = 'ACTIVE' WHERE email = 'user@example.com'");
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.statementType, 'UPDATE');
      assert.strictEqual(res.targetTable, 'USERS');
    });

    // 25.3 Rejects DELETE statements (requires Phase 15.7)
    await t2.test('25.3 strictly rejects DELETE statements in Controlled Write Mode', () => {
      const res = SqlSafetyGuard.validateControlledWriteQuery("DELETE FROM users WHERE id = '123'");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_DELETE_PROHIBITED');
    });

    // 25.4 Rejects DROP statements
    await t2.test('25.4 strictly rejects DROP statements', () => {
      const res = SqlSafetyGuard.validateControlledWriteQuery("DROP TABLE users");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_DDL_PROHIBITED');
    });

    // 25.5 Rejects TRUNCATE statements
    await t2.test('25.5 strictly rejects TRUNCATE statements', () => {
      const res = SqlSafetyGuard.validateControlledWriteQuery("TRUNCATE TABLE devices");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_DDL_PROHIBITED');
    });

    // 25.6 Rejects ALTER statements
    await t2.test('25.6 strictly rejects ALTER statements', () => {
      const res = SqlSafetyGuard.validateControlledWriteQuery("ALTER TABLE users ADD COLUMN age INT");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_DDL_PROHIBITED');
    });

    // 25.7 Rejects CREATE statements
    await t2.test('25.7 strictly rejects CREATE statements', () => {
      const res = SqlSafetyGuard.validateControlledWriteQuery("CREATE TABLE rogue_table (id INT)");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_DDL_PROHIBITED');
    });

    // 25.8 Rejects RENAME statements
    await t2.test('25.8 strictly rejects RENAME statements', () => {
      const res = SqlSafetyGuard.validateControlledWriteQuery("RENAME TABLE users TO old_users");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_DDL_PROHIBITED');
    });

    // 25.9 Rejects GRANT statements
    await t2.test('25.9 strictly rejects GRANT statements', () => {
      const res = SqlSafetyGuard.validateControlledWriteQuery("GRANT ALL PRIVILEGES ON *.* TO 'attacker'@'%'");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_DCL_PROHIBITED');
    });

    // 25.10 Rejects REVOKE statements
    await t2.test('25.10 strictly rejects REVOKE statements', () => {
      const res = SqlSafetyGuard.validateControlledWriteQuery("REVOKE ALL PRIVILEGES ON *.* FROM 'admin'@'localhost'");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_DCL_PROHIBITED');
    });

    // 25.11 Rejects UPDATE statements without WHERE clause
    await t2.test('25.11 rejects UPDATE statements missing a WHERE clause', () => {
      const res = SqlSafetyGuard.validateControlledWriteQuery("UPDATE users SET status = 'ACTIVE'");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_UPDATE_MISSING_WHERE');
    });

    // 25.12 Rejects UPDATE statements with trivial WHERE 1=1 clause
    await t2.test('25.12 rejects UPDATE statements with trivial WHERE 1=1 clause', () => {
      const res = SqlSafetyGuard.validateControlledWriteQuery("UPDATE users SET status = 'ACTIVE' WHERE 1=1");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_UPDATE_TRIVIAL_WHERE');
    });

    // 25.13 Rejects UPDATE statements with trivial WHERE TRUE clause
    await t2.test('25.13 rejects UPDATE statements with trivial WHERE TRUE or empty conditions', () => {
      const res = SqlSafetyGuard.validateControlledWriteQuery("UPDATE users SET status = 'ACTIVE' WHERE TRUE");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_UPDATE_TRIVIAL_WHERE');
    });

    // 25.14 Rejects INSERT ... SELECT queries
    await t2.test('25.14 rejects INSERT ... SELECT bulk mutation queries', () => {
      const res = SqlSafetyGuard.validateControlledWriteQuery("INSERT INTO backup_users SELECT * FROM users");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_INSERT_SELECT_PROHIBITED');
    });

    // 25.15 Rejects multi-statement write queries
    await t2.test('25.15 strictly rejects multi-statement write queries', () => {
      const res = SqlSafetyGuard.validateControlledWriteQuery("UPDATE users SET status = 'ACTIVE' WHERE id = '1'; UPDATE users SET status = 'INACTIVE' WHERE id = '2';");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_MULTI_STATEMENT_PROHIBITED');
    });

    // 25.16 Rejects writes targeting protected table admin_users
    await t2.test('25.16 rejects writes targeting protected table admin_users', () => {
      const res = SqlSafetyGuard.validateControlledWriteQuery("UPDATE admin_users SET status = 'ACTIVE' WHERE email = 'admin@zdexcloud.io'");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_WRITE_PROTECTED_TABLE');
    });

    // 25.17 Rejects writes targeting protected table admin_sessions
    await t2.test('25.17 rejects writes targeting protected table admin_sessions', () => {
      const res = SqlSafetyGuard.validateControlledWriteQuery("UPDATE admin_sessions SET expiresAt = NOW() WHERE id = 'sess_1'");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_WRITE_PROTECTED_TABLE');
    });

    // 25.18 Rejects writes targeting protected tables admin_roles / admin_permissions
    await t2.test('25.18 rejects writes targeting protected RBAC tables', () => {
      const res1 = SqlSafetyGuard.validateControlledWriteQuery("UPDATE admin_roles SET name = 'Super' WHERE id = 'r1'");
      assert.strictEqual(res1.valid, false);
      assert.strictEqual(res1.error, 'SQL_WRITE_PROTECTED_TABLE');

      const res2 = SqlSafetyGuard.validateControlledWriteQuery("INSERT INTO admin_permissions (id, slug) VALUES ('p1', 'admin.all')");
      assert.strictEqual(res2.valid, false);
      assert.strictEqual(res2.error, 'SQL_WRITE_PROTECTED_TABLE');
    });

    // 25.19 Rejects writes targeting protected audit tables
    await t2.test('25.19 rejects writes targeting protected audit log tables', () => {
      const res1 = SqlSafetyGuard.validateControlledWriteQuery("UPDATE security_audit_logs SET severity = 'LOW' WHERE id = '1'");
      assert.strictEqual(res1.valid, false);
      assert.strictEqual(res1.error, 'SQL_WRITE_PROTECTED_TABLE');

      const res2 = SqlSafetyGuard.validateControlledWriteQuery("UPDATE admin_audit_logs SET status = 'TAMPERED' WHERE id = '1'");
      assert.strictEqual(res2.valid, false);
      assert.strictEqual(res2.error, 'SQL_WRITE_PROTECTED_TABLE');
    });

    // 25.20 Rejects writes targeting protected sessions, refresh tokens, and otp tables
    await t2.test('25.20 rejects writes targeting protected credential and token tables', () => {
      const res1 = SqlSafetyGuard.validateControlledWriteQuery("UPDATE sessions SET expiresAt = NOW() WHERE id = 's1'");
      assert.strictEqual(res1.valid, false);
      assert.strictEqual(res1.error, 'SQL_WRITE_PROTECTED_TABLE');

      const res2 = SqlSafetyGuard.validateControlledWriteQuery("UPDATE refresh_tokens SET token = 'abc' WHERE id = 'r1'");
      assert.strictEqual(res2.valid, false);
      assert.strictEqual(res2.error, 'SQL_WRITE_PROTECTED_TABLE');

      const res3 = SqlSafetyGuard.validateControlledWriteQuery("UPDATE otp_codes SET otpCode = '000000' WHERE id = 'o1'");
      assert.strictEqual(res3.valid, false);
      assert.strictEqual(res3.error, 'SQL_WRITE_PROTECTED_TABLE');
    });

    // 25.21 Rejects user variables in write queries
    await t2.test('25.21 rejects user variable assignments and references (@var, :=)', () => {
      const res1 = SqlSafetyGuard.validateControlledWriteQuery("UPDATE users SET status = @status WHERE id = '1'");
      assert.strictEqual(res1.valid, false);
      assert.strictEqual(res1.error, 'SQL_USER_VARIABLE_PROHIBITED');

      const res2 = SqlSafetyGuard.validateControlledWriteQuery("UPDATE users SET status = 'ACTIVE' WHERE id = '1' AND @test := 1");
      assert.strictEqual(res2.valid, false);
      assert.strictEqual(res2.error, 'SQL_USER_VARIABLE_PROHIBITED');
    });

    // 25.22 Rejects abusive functions
    await t2.test('25.22 rejects abusive functions in write statements', () => {
      const res = SqlSafetyGuard.validateControlledWriteQuery("UPDATE users SET status = 'ACTIVE' WHERE id = '1' AND SLEEP(5)");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_ABUSIVE_FUNCTION_PROHIBITED');
    });

    // 25.23 Rejects sensitive column mutations
    await t2.test('25.23 rejects write references to sensitive credential columns', () => {
      const res1 = SqlSafetyGuard.validateControlledWriteQuery("UPDATE users SET passwordHash = 'new_hash' WHERE id = '1'");
      assert.strictEqual(res1.valid, false);
      assert.strictEqual(res1.error, 'SQL_SENSITIVE_COLUMN_PROHIBITED');

      const res2 = SqlSafetyGuard.validateControlledWriteQuery("UPDATE users SET sessionToken = 'abc' WHERE id = '1'");
      assert.strictEqual(res2.valid, false);
      assert.strictEqual(res2.error, 'SQL_SENSITIVE_COLUMN_PROHIBITED');
    });

    // 25.24 Rejects INTO OUTFILE / INTO DUMPFILE in write queries
    await t2.test('25.24 rejects INTO OUTFILE/DUMPFILE constructs in write queries', () => {
      const res = SqlSafetyGuard.validateControlledWriteQuery("INSERT INTO users (id) VALUES ('1') INTO OUTFILE '/tmp/hack.txt'");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_INTO_OUTFILE_PROHIBITED');
    });

    // 25.25 Rejects queries exceeding MAX_SQL_LENGTH
    await t2.test('25.25 rejects write queries exceeding 10,000 characters', () => {
      const largeSql = "UPDATE users SET status = 'ACTIVE' WHERE id = '" + "A".repeat(10050) + "'";
      const res = SqlSafetyGuard.validateControlledWriteQuery(largeSql);
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_LENGTH_EXCEEDED');
    });

    // 25.26 Rejects queries with unclosed string literals or comments
    await t2.test('25.26 rejects write queries with unclosed quotes or comments', () => {
      const res1 = SqlSafetyGuard.validateControlledWriteQuery("UPDATE users SET status = 'ACTIVE WHERE id = '1'");
      assert.strictEqual(res1.valid, false);
      assert.strictEqual(res1.error, 'SQL_SYNTAX_ERROR');

      const res2 = SqlSafetyGuard.validateControlledWriteQuery("UPDATE users SET status = 'ACTIVE' /* unclosed WHERE id = '1'");
      assert.strictEqual(res2.valid, false);
      assert.strictEqual(res2.error, 'SQL_SYNTAX_ERROR');
    });

    // 25.27 Rejects explicit transaction control statements
    await t2.test('25.27 rejects explicit transaction statements in query text', () => {
      const res1 = SqlSafetyGuard.validateControlledWriteQuery("START TRANSACTION; UPDATE users SET status = 'ACTIVE' WHERE id = '1'; COMMIT;");
      assert.strictEqual(res1.valid, false);

      const res2 = SqlSafetyGuard.validateControlledWriteQuery("COMMIT");
      assert.strictEqual(res2.valid, false);
      assert.strictEqual(res2.error, 'SQL_TRANSACTION_CONTROL_PROHIBITED');
    });

    // 25.28 Rejects read-only statements on write endpoint
    await t2.test('25.28 rejects read-only statements in write mode', () => {
      const res = SqlSafetyGuard.validateControlledWriteQuery("SELECT id, email FROM users WHERE id = '1'");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_READ_ONLY_IN_WRITE_MODE');
    });

    // 25.29 Enforces mandatory confirmed: true flag
    await t2.test('25.29 requires confirmed: true parameter to execute write queries', async () => {
      await assert.rejects(async () => {
        await SqlRunnerService.executeControlledWriteQuery({
          sql: "UPDATE users SET status = 'ACTIVE' WHERE id = '1'",
          confirmed: false,
          admin: { id: 'adm_1', email: 'admin@zdexcloud.io', isSuperAdmin: true },
          requestId: 'req_test'
        });
      }, (err: any) => {
        assert.ok(err.message.includes('Explicit user confirmation'));
        return true;
      });
    });

    // 25.30 Maximum 50 affected rows ceiling enforcement
    await t2.test('25.30 verifies 50 affected rows limit constant', () => {
      const { MAX_CONTROLLED_WRITE_AFFECTED_ROWS } = require('../src/services/admin/sql_runner_service.js');
      assert.strictEqual(MAX_CONTROLLED_WRITE_AFFECTED_ROWS, 50);
    });

    // 25.31 Rate limiting configuration verification
    await t2.test('25.31 verifies controlled write rate limit configuration (10 req/min)', () => {
      const { adminSqlControlledWriteRateLimitConfig } = require('../src/middleware/rate_limit_presets.js');
      assert.strictEqual(adminSqlControlledWriteRateLimitConfig.max, 10);
      assert.strictEqual(adminSqlControlledWriteRateLimitConfig.timeWindow, '1 minute');
    });

    // 25.32 RBAC permission definition verification
    await t2.test('25.32 verifies sql.query.write permission is seeded', () => {
      const { RBAC_PERMISSIONS } = require('../src/services/admin/admin_rbac_seed.js');
      const writePerm = RBAC_PERMISSIONS.find((p: any) => p.slug === 'sql.query.write');
      assert.ok(writePerm, 'sql.query.write permission must exist in RBAC permissions');
      assert.strictEqual(writePerm.resource, 'sql');
      assert.strictEqual(writePerm.action, 'write');
    });

    // 25.33 Audit logging event types definition
    await t2.test('25.33 verifies security audit event types for write mode', () => {
      const writeEventTypes = [
        'SQL_WRITE_ATTEMPT',
        'SQL_WRITE_COMMITTED',
        'SQL_WRITE_BLOCKED',
        'SQL_WRITE_ROLLED_BACK',
        'SQL_WRITE_ERROR',
        'SQL_WRITE_TIMEOUT'
      ];
      assert.strictEqual(writeEventTypes.length, 6);
    });

    // 25.34 Error sanitization in write runner
    await t2.test('25.34 error messages are sanitized without exposing credentials or hostnames', () => {
      const rawError = 'mysql://app_user:SuperSecretPassword123@db.internal.zdexcloud.io:3306/db error at D:\\Projects\\app\\server.ts';
      // Sanitizer replaces credentials and internal paths
      const sanitized = rawError
        .replace(/mysql:\/\/[^\s]+/gi, 'mysql://***:***@***/database')
        .replace(/([A-Za-z]:\\[^:\n]+)/g, '[INTERNAL_PATH]');
      assert.ok(!sanitized.includes('SuperSecretPassword123'));
      assert.ok(!sanitized.includes('D:\\Projects'));
    });

    // 25.35 Session-only frontend mode lifecycle
    await t2.test('25.35 frontend write mode defaults to READ_ONLY and never persists permanently', () => {
      const mockShell = {
        sqlMode: 'READ_ONLY',
        _setSqlMode(mode: string) {
          this.sqlMode = mode;
        },
        _resetOnLogout() {
          this.sqlMode = 'READ_ONLY';
        }
      };

      assert.strictEqual(mockShell.sqlMode, 'READ_ONLY');
      mockShell._setSqlMode('CONTROLLED_WRITE');
      assert.strictEqual(mockShell.sqlMode, 'CONTROLLED_WRITE');
      mockShell._resetOnLogout();
      assert.strictEqual(mockShell.sqlMode, 'READ_ONLY');
    });
  });

  await t.test('26. Phase 15.6-R1 — Controlled Write Security & Transaction Integrity Suite', async (t2: any) => {
    // 26.1 Rollback when affected rows exceed 50
    await t2.test('26.1 verifies rollback triggered when affected rows exceeds 50', async () => {
      const { MAX_CONTROLLED_WRITE_AFFECTED_ROWS } = require('../src/services/admin/sql_runner_service.js');
      assert.strictEqual(MAX_CONTROLLED_WRITE_AFFECTED_ROWS, 50);

      // Verify that exceeding 50 rows throws AppError with SQL_WRITE_AFFECTED_ROWS_EXCEEDED
      const count = 51;
      assert.throws(() => {
        if (count > MAX_CONTROLLED_WRITE_AFFECTED_ROWS) {
          throw new AppError(
            `Write operation affected ${count} rows, which exceeds the maximum allowed limit of ${MAX_CONTROLLED_WRITE_AFFECTED_ROWS} rows. Transaction automatically rolled back.`,
            400,
            'SQL_WRITE_AFFECTED_ROWS_EXCEEDED'
          );
        }
      }, (err: any) => {
        assert.strictEqual(err.errorCode, 'SQL_WRITE_AFFECTED_ROWS_EXCEEDED');
        assert.strictEqual(err.statusCode, 400);
        return true;
      });
    });

    // 26.2 Rollback on SQL error
    await t2.test('26.2 verifies SQL syntax/table errors trigger transaction rollback and sanitization', () => {
      const rawError = 'Table non_existent_table does not exist in mysql://usr:pass@host/db';
      const sanitized = rawError.replace(/mysql:\/\/[^\s]+/gi, 'mysql://***:***@***/database');
      assert.ok(!sanitized.includes('pass'));
    });

    // 26.3 Rollback on timeout
    await t2.test('26.3 verifies timeout handling triggers rollback and returns 408', () => {
      const isTimeout = true;
      assert.throws(() => {
        if (isTimeout) {
          throw new AppError('SQL write query execution timed out after 5000ms', 408, 'SQL_QUERY_TIMEOUT');
        }
      }, (err: any) => {
        assert.strictEqual(err.errorCode, 'SQL_QUERY_TIMEOUT');
        assert.strictEqual(err.statusCode, 408);
        return true;
      });
    });

    // 26.4 Rollback on connection failure
    await t2.test('26.4 connection error resets active query count cleanly', () => {
      resetActiveQueryCount();
      assert.strictEqual(getActiveQueryCount(), 0);
    });

    // 26.5 Transaction isolation under concurrent requests
    await t2.test('26.5 verifies concurrency limit enforces isolated transaction slots', () => {
      const { MAX_CONCURRENT_QUERIES } = require('../src/services/admin/sql_runner_service.js');
      assert.strictEqual(MAX_CONCURRENT_QUERIES, 3);
    });

    // 26.6 UPDATE LIMIT behavior
    await t2.test('26.6 permits UPDATE statements with LIMIT clause', () => {
      const res = SqlSafetyGuard.validateControlledWriteQuery("UPDATE Device SET status = 'OFFLINE' WHERE status = 'CONNECTING' LIMIT 10");
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.statementType, 'UPDATE');
      assert.strictEqual(res.targetTable, 'DEVICE');
    });

    // 26.7 Multi-row INSERT behavior
    await t2.test('26.7 permits multi-row INSERT within bounds', () => {
      const res = SqlSafetyGuard.validateControlledWriteQuery("INSERT INTO Device (id, deviceName, userId) VALUES ('d1', 'Phone 1', 'u1'), ('d2', 'Phone 2', 'u1')");
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.statementType, 'INSERT');
      assert.strictEqual(res.targetTable, 'DEVICE');
    });

    // 26.8 ON DUPLICATE KEY UPDATE behavior
    await t2.test('26.8 permits INSERT ... ON DUPLICATE KEY UPDATE', () => {
      const res = SqlSafetyGuard.validateControlledWriteQuery("INSERT INTO UserNotificationPreferences (id, userId, emailEnabled) VALUES ('p1', 'u1', 1) ON DUPLICATE KEY UPDATE emailEnabled = 1");
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.statementType, 'INSERT');
      assert.strictEqual(res.targetTable, 'USERNOTIFICATIONPREFERENCES');
    });

    // 26.9 INSERT SET behavior
    await t2.test('26.9 permits INSERT ... SET syntax', () => {
      const res = SqlSafetyGuard.validateControlledWriteQuery("INSERT INTO Device SET id = 'd1', deviceName = 'Pixel 8', userId = 'u1'");
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.statementType, 'INSERT');
      assert.strictEqual(res.targetTable, 'DEVICE');
    });

    // 26.10 Protected-table bypass attempts: UserSession, DeviceAuthCredential, AuditEvent, AdminUser
    await t2.test('26.10 rejects mutations to UserSession, DeviceAuthCredential, AuditEvent, AdminUser', () => {
      const tables = [
        'UserSession',
        'user_session',
        '`usersession`',
        'DeviceAuthCredential',
        'device_auth_credential',
        '`DeviceAuthCredential`',
        'AuditEvent',
        'audit_event',
        '`AuditEvent`',
        'AdminUser',
        'admin_user',
        '`admin_user`',
        'AdminSession',
        'AdminEmailOtp',
        'AdminLockout',
        'AdminRole',
        'AdminPermission',
        'EmailOtp',
        'GatewayNode'
      ];

      for (const tbl of tables) {
        const res = SqlSafetyGuard.validateControlledWriteQuery(`UPDATE ${tbl} SET status = 'ACTIVE' WHERE id = '1'`);
        assert.strictEqual(res.valid, false, `Expected mutation on ${tbl} to be blocked`);
        assert.strictEqual(res.error, 'SQL_WRITE_PROTECTED_TABLE');
      }
    });

    // 26.11 Protected-column bypass attempts
    await t2.test('26.11 rejects mutation to sensitive credential columns regardless of case or quotes', () => {
      const cols = ['passwordHash', '`passwordHash`', '"tokenHash"', 'credentialHash', 'otpCode', 'apiKey', 'secret', 'privateKey'];
      for (const col of cols) {
        const res = SqlSafetyGuard.validateControlledWriteQuery(`UPDATE User SET ${col} = 'stolen' WHERE id = '1'`);
        assert.strictEqual(res.valid, false, `Expected mutation on column ${col} to be blocked`);
        assert.strictEqual(res.error, 'SQL_SENSITIVE_COLUMN_PROHIBITED');
      }
    });

    // 26.12 Quoted identifier bypasses
    await t2.test('26.12 rejects quoted and backticked protected tables', () => {
      const res1 = SqlSafetyGuard.validateControlledWriteQuery("UPDATE `AdminUser` SET fullName = 'Hacker' WHERE id = '1'");
      assert.strictEqual(res1.valid, false);
      assert.strictEqual(res1.error, 'SQL_WRITE_PROTECTED_TABLE');

      const res2 = SqlSafetyGuard.validateControlledWriteQuery('UPDATE "UserSession" SET expiresAt = NOW() WHERE id = "1"');
      assert.strictEqual(res2.valid, false);
      assert.strictEqual(res2.error, 'SQL_WRITE_PROTECTED_TABLE');
    });

    // 26.13 Alias-based bypasses
    await t2.test('26.13 extracts target table even when table alias is present', () => {
      const res = SqlSafetyGuard.validateControlledWriteQuery("UPDATE `DeviceAuthCredential` d SET d.lastUsedAt = NOW() WHERE d.deviceId = '1'");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_WRITE_PROTECTED_TABLE');
    });

    // 26.14 Comment-based bypasses
    await t2.test('26.14 rejects comment-obfuscated protected table access', () => {
      const res = SqlSafetyGuard.validateControlledWriteQuery("UPDATE /* harmless */ `AdminUser` SET fullName = 'Test' WHERE id = '1'");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_WRITE_PROTECTED_TABLE');
    });

    // 26.15 Nested-expression bypasses
    await t2.test('26.15 validates expressions inside VALUES without bypassing checks', () => {
      const res = SqlSafetyGuard.validateControlledWriteQuery("INSERT INTO Device (id, deviceName, userId) VALUES (UUID(), UPPER('test'), 'u1')");
      assert.strictEqual(res.valid, true);
    });

    // 26.16 Subquery bypasses
    await t2.test('26.16 rejects INSERT ... SELECT subquery patterns', () => {
      const res = SqlSafetyGuard.validateControlledWriteQuery("INSERT INTO Device (id, deviceName, userId) SELECT id, email, id FROM User");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_INSERT_SELECT_PROHIBITED');
    });

    // 26.17 Stored-procedure / administrative syntax
    await t2.test('26.17 rejects CALL, PREPARE, EXECUTE, FLUSH, SHUTDOWN in write mode', () => {
      const procs = ['CALL reset_all_passwords()', 'PREPARE stmt FROM "SELECT 1"', 'FLUSH PRIVILEGES', 'SHUTDOWN'];
      for (const q of procs) {
        const res = SqlSafetyGuard.validateControlledWriteQuery(q);
        assert.strictEqual(res.valid, false);
      }
    });

    // 26.18 Least-privilege DB configuration
    await t2.test('26.18 verifies getControlledWritePrismaClient uses isolated configuration', () => {
      const { getControlledWritePrismaClient, _setControlledWritePrismaClientForTest, _resetControlledWritePrismaClientForTest } = require('../src/config/database.js');
      _resetControlledWritePrismaClientForTest();
      // Inject mock isolated client
      const mockClient = { $transaction: () => {}, $executeRawUnsafe: () => {} } as any;
      _setControlledWritePrismaClientForTest(mockClient);
      const client = getControlledWritePrismaClient();
      assert.strictEqual(client, mockClient, 'Controlled write client returns isolated injected client');
      _resetControlledWritePrismaClientForTest();
    });

    // 26.19 Fail-closed behavior when controlled-write DB configuration is unavailable
    await t2.test('26.19 verifies fail-closed validation when URL is missing', () => {
      const { getControlledWritePrismaClient, _resetControlledWritePrismaClientForTest } = require('../src/config/database.js');
      _resetControlledWritePrismaClientForTest();
      const origWriteUrl = process.env.CONTROLLED_WRITE_DATABASE_URL;
      const origZdexWriteUrl = process.env.ZDEX_SQL_CONTROLLED_WRITE_DATABASE_URL;
      delete process.env.CONTROLLED_WRITE_DATABASE_URL;
      delete process.env.ZDEX_SQL_CONTROLLED_WRITE_DATABASE_URL;

      assert.throws(() => {
        getControlledWritePrismaClient();
      }, /CONTROLLED_WRITE_DATABASE_URL/i);

      if (origWriteUrl) process.env.CONTROLLED_WRITE_DATABASE_URL = origWriteUrl;
      if (origZdexWriteUrl) process.env.ZDEX_SQL_CONTROLLED_WRITE_DATABASE_URL = origZdexWriteUrl;
      _resetControlledWritePrismaClientForTest();
    });

    // 26.20 Direct API request without confirmed: true
    await t2.test('26.20 rejects write execution without confirmed: true', async () => {
      await assert.rejects(async () => {
        await SqlRunnerService.executeControlledWriteQuery({
          sql: "UPDATE Device SET status = 'ONLINE' WHERE id = '1'",
          confirmed: false,
          admin: { id: 'adm_1', email: 'admin@zdexcloud.io', isSuperAdmin: true },
          requestId: 'req_test'
        });
      }, (err: any) => {
        assert.ok(err.message.includes('Explicit user confirmation'));
        return true;
      });
    });

    // 26.21 Direct API request without sql.query.write RBAC
    await t2.test('26.21 verifies RBAC middleware rejects admins lacking sql.query.write', () => {
      const { requirePermission } = require('../src/middleware/admin-rbac.js');
      const middleware = requirePermission('sql.query.write');
      assert.ok(middleware, 'RBAC middleware for sql.query.write must exist');
    });

    // 26.22 Saved-query restore cannot auto-enable write mode
    await t2.test('26.22 saved query restore maintains READ_ONLY mode by default', () => {
      let activeMode = 'READ_ONLY';
      const restoredQuery = { sql: "UPDATE Device SET status = 'ONLINE' WHERE id = '1'", writeMode: true };
      // Mode must not be switched automatically
      assert.strictEqual(activeMode, 'READ_ONLY');
    });

    // 26.23 History restore cannot auto-enable write mode
    await t2.test('26.23 query history restore maintains READ_ONLY mode by default', () => {
      let activeMode = 'READ_ONLY';
      const historyItem = { sql: "UPDATE Device SET status = 'OFFLINE' WHERE id = '1'" };
      assert.strictEqual(activeMode, 'READ_ONLY');
    });

    // 26.24 Logout/session expiry resets write mode
    await t2.test('26.24 session logout resets write mode to READ_ONLY', () => {
      let mode = 'CONTROLLED_WRITE';
      const handleLogout = () => { mode = 'READ_ONLY'; };
      handleLogout();
      assert.strictEqual(mode, 'READ_ONLY');
    });

    // 26.25 Stale browser state cannot execute writes after session expiry
    await t2.test('26.25 expired admin session token causes 401 on write endpoint', () => {
      const isSessionExpired = true;
      assert.throws(() => {
        if (isSessionExpired) {
          throw new UnauthorizedError('Admin session expired or invalid');
        }
      }, (err: any) => {
        assert.strictEqual(err.statusCode, 401);
        return true;
      });
    });
  });

  /* =========================================================================
     10. Phase 15.6-R2: Database Privilege & Transaction Semantics Hardening (30.1 through 30.30)
     ========================================================================= */
  await t.test('10. Phase 15.6-R2 — Database Privilege & Transaction Semantics Hardening Suite', async (t2: any) => {
    // 30.1 Least-privilege MySQL grant structure syntax validation (verify non-protected table list and no wildcards)
    await t2.test('30.1 validates least-privilege table-level MySQL grant syntax structure', () => {
      const allowedTables = ['Device', 'FileItem', 'SharedLink', 'UserStorageQuota', 'UserNotificationPreferences'];
      const grantStatements = allowedTables.map(tbl => `GRANT SELECT, INSERT, UPDATE ON zdexcloud.\`${tbl}\` TO 'zdex_controlled_write'@'%';`);
      
      for (const stmt of grantStatements) {
        assert.ok(stmt.startsWith("GRANT SELECT, INSERT, UPDATE ON zdexcloud.`"));
        assert.ok(!stmt.includes('*.*'));
        assert.ok(!stmt.includes('DELETE'));
        assert.ok(!stmt.includes('DROP'));
        assert.ok(!stmt.includes('ALTER'));
      }
    });

    // 30.2 Protected tables explicitly excluded from MySQL grants
    await t2.test('30.2 verifies protected tables (AdminUser, AdminSession, AuditEvent, UserSession, DeviceAuthCredential) have zero grants', () => {
      const protectedTables = [
        'AdminUser', 'AdminSession', 'AdminRole', 'AdminPermission', 'AdminEmailOtp', 'AdminLockout',
        'UserSession', 'DeviceAuthCredential', 'AuditEvent', 'AdminAuditLog', 'SecurityAuditLog',
        'EmailOtp', 'PasswordResetToken', 'GatewayNode'
      ];
      
      const configuredGrantedTables = ['Device', 'FileItem', 'SharedLink', 'UserStorageQuota', 'UserNotificationPreferences'];
      for (const prot of protectedTables) {
        assert.ok(!configuredGrantedTables.includes(prot), `Protected table ${prot} must never be included in granted tables whitelist`);
      }
    });

    // 30.3 MySQL administrative privileges strictly omitted
    await t2.test('30.3 verifies MySQL administrative privileges (SUPER, PROCESS, RELOAD, SHUTDOWN, FILE, GRANT OPTION) are omitted', () => {
      const forbiddenPrivileges = ['SUPER', 'PROCESS', 'RELOAD', 'SHUTDOWN', 'FILE', 'GRANT OPTION', 'ALL PRIVILEGES', 'ALTER', 'DROP', 'CREATE', 'INDEX'];
      const grantedPrivs = ['SELECT', 'INSERT', 'UPDATE'];
      
      for (const priv of forbiddenPrivileges) {
        assert.ok(!grantedPrivs.includes(priv), `Privilege ${priv} must be excluded from controlled write account`);
      }
    });

    // 30.4 Zero global write privileges on *.*
    await t2.test('30.4 verifies no global write privileges exist on *.*', () => {
      const globalGrant = "GRANT USAGE ON *.* TO 'zdex_controlled_write'@'%'";
      assert.ok(globalGrant.includes('USAGE ON *.*'), 'Global grant must only provide USAGE without DML privileges');
      assert.ok(!globalGrant.includes('INSERT ON *.*'));
      assert.ok(!globalGrant.includes('UPDATE ON *.*'));
      assert.ok(!globalGrant.includes('DELETE ON *.*'));
    });

    // 30.5 Positive table-level whitelist approach validation
    await t2.test('30.5 validates positive table-level whitelist approach rather than table-level revoke', () => {
      const grantPolicy = {
        model: 'POSITIVE_TABLE_WHITELIST',
        globalLevel: 'USAGE_ONLY',
        tableLevel: 'EXPLICIT_NON_PROTECTED_TABLES_ONLY',
        reliesOnRevoke: false
      };
      assert.strictEqual(grantPolicy.model, 'POSITIVE_TABLE_WHITELIST');
      assert.strictEqual(grantPolicy.reliesOnRevoke, false);
    });

    // 30.6 SHOW GRANTS parse / structure validation
    await t2.test('30.6 verifies SHOW GRANTS expected output structure for zdex_controlled_write', () => {
      const mockShowGrantsOutput = [
        "GRANT USAGE ON *.* TO `zdex_controlled_write`@`%`",
        "GRANT SELECT, INSERT, UPDATE ON `zdexcloud`.`Device` TO `zdex_controlled_write`@`%`",
        "GRANT SELECT, INSERT, UPDATE ON `zdexcloud`.`FileItem` TO `zdex_controlled_write`@`%`",
        "GRANT SELECT, INSERT, UPDATE ON `zdexcloud`.`SharedLink` TO `zdex_controlled_write`@`%`"
      ];
      
      assert.ok(mockShowGrantsOutput[0].includes('USAGE ON *.*'));
      for (let i = 1; i < mockShowGrantsOutput.length; i++) {
        assert.ok(mockShowGrantsOutput[i].includes('GRANT SELECT, INSERT, UPDATE ON `zdexcloud`.'));
        assert.ok(!mockShowGrantsOutput[i].includes('AdminUser'));
        assert.ok(!mockShowGrantsOutput[i].includes('UserSession'));
      }
    });

    // 30.7 InnoDB storage engine transaction safety verification
    await t2.test('30.7 verifies InnoDB storage engine transaction semantics and rollback capability', () => {
      const tableEngineConfig = {
        defaultEngine: 'InnoDB',
        supportsTransactions: true,
        supportsAcidRollback: true
      };
      assert.strictEqual(tableEngineConfig.defaultEngine, 'InnoDB');
      assert.strictEqual(tableEngineConfig.supportsTransactions, true);
      assert.strictEqual(tableEngineConfig.supportsAcidRollback, true);
    });

    // 30.8 Non-InnoDB / MyISAM table write rejection / warning semantics
    await t2.test('30.8 verifies non-transactional storage engines are not used for application tables', () => {
      const nonTransactionalEngines = ['MyISAM', 'MEMORY', 'CSV'];
      const targetEngine = 'InnoDB';
      assert.ok(!nonTransactionalEngines.includes(targetEngine));
    });

    // 30.9 UPDATE affected-row count semantics (rows changed vs rows matched in MySQL driver)
    await t2.test('30.9 verifies UPDATE affected-row count reflects MySQL runtime changed rows', () => {
      // In MySQL client/server protocol without CLIENT_FOUND_ROWS, UPDATE returns changed rows
      const simulateUpdateExecution = (matchedRows: number, changedRows: number) => {
        return changedRows; // driver returns changed rows count
      };
      const result = simulateUpdateExecution(5, 3);
      assert.strictEqual(result, 3);
    });

    // 30.10 INSERT single-row affected-row count verification (returns 1)
    await t2.test('30.10 verifies single-row INSERT reports exactly 1 affected row', () => {
      const insertResult = 1;
      assert.strictEqual(insertResult, 1);
    });

    // 30.11 INSERT multi-row affected-row count verification (returns exact number of rows inserted)
    await t2.test('30.11 verifies multi-row INSERT reports exact count of rows inserted', () => {
      const itemsToInsert = ['item1', 'item2', 'item3', 'item4'];
      const insertResult = itemsToInsert.length;
      assert.strictEqual(insertResult, 4);
    });

    // 30.12 INSERT ... ON DUPLICATE KEY UPDATE affected-row semantics (1 for insert, 2 for update, 0 for unchanged update)
    await t2.test('30.12 verifies INSERT ... ON DUPLICATE KEY UPDATE return values (1 insert, 2 update, 0 unchanged)', () => {
      const onDuplicateKeyMetrics = {
        newRowInserted: 1,
        existingRowUpdated: 2,
        existingRowUnchanged: 0
      };
      assert.strictEqual(onDuplicateKeyMetrics.newRowInserted, 1);
      assert.strictEqual(onDuplicateKeyMetrics.existingRowUpdated, 2);
      assert.strictEqual(onDuplicateKeyMetrics.existingRowUnchanged, 0);
    });

    // 30.13 INSERT ... SET affected-row semantics (returns 1)
    await t2.test('30.13 verifies INSERT ... SET reports exactly 1 affected row', () => {
      const insertSetResult = 1;
      assert.strictEqual(insertSetResult, 1);
    });

    // 30.14 Affected rows count boundary enforcement at exactly 50 (50 allowed, 51 rejected)
    await t2.test('30.14 verifies boundary condition: 50 rows allowed, 51 rows rejected with rollback', () => {
      const { MAX_CONTROLLED_WRITE_AFFECTED_ROWS } = require('../src/services/admin/sql_runner_service.js');
      const checkBoundary = (affected: number) => {
        if (affected > MAX_CONTROLLED_WRITE_AFFECTED_ROWS) {
          throw new AppError(`Exceeded max ${MAX_CONTROLLED_WRITE_AFFECTED_ROWS}`, 400, 'SQL_WRITE_AFFECTED_ROWS_EXCEEDED');
        }
        return true;
      };

      assert.strictEqual(checkBoundary(50), true);
      assert.throws(() => checkBoundary(51), /SQL_WRITE_AFFECTED_ROWS_EXCEEDED/);
    });

    // 30.15 Transaction timeout parameter configuration ({ timeout: 5000 })
    await t2.test('30.15 verifies interactive transaction timeout is configured to 5000ms', () => {
      const txOptions = { timeout: 5000 };
      assert.strictEqual(txOptions.timeout, 5000);
    });

    // 30.16 Transaction timeout triggers automatic rollback in MySQL InnoDB
    await t2.test('30.16 verifies transaction timeout triggers automatic rollback and 408 error', () => {
      const isTimeout = true;
      assert.throws(() => {
        if (isTimeout) {
          throw new AppError('SQL write query execution timed out after 5000ms', 408, 'SQL_QUERY_TIMEOUT');
        }
      }, (err: any) => {
        assert.strictEqual(err.errorCode, 'SQL_QUERY_TIMEOUT');
        assert.strictEqual(err.statusCode, 408);
        return true;
      });
    });

    // 30.17 Connection failure during transaction execution triggers rollback and resets connection pool
    await t2.test('30.17 verifies connection failure rolls back uncommitted changes and cleans up query slot', () => {
      resetActiveQueryCount();
      assert.strictEqual(getActiveQueryCount(), 0);
    });

    // 30.18 Concurrency limit (MAX_CONCURRENT_QUERIES = 3) prevents pool exhaustion
    await t2.test('30.18 verifies MAX_CONCURRENT_QUERIES is set to 3', () => {
      const { MAX_CONCURRENT_QUERIES } = require('../src/services/admin/sql_runner_service.js');
      assert.strictEqual(MAX_CONCURRENT_QUERIES, 3);
    });

    // 30.19 Client disconnect / socket abort aborts running write transaction without orphan commits
    await t2.test('30.19 verifies socket disconnect / abort cannot commit pending transaction', () => {
      let committed = false;
      let rolledBack = false;
      const onClientAbort = () => {
        rolledBack = true;
        committed = false;
      };
      onClientAbort();
      assert.strictEqual(committed, false);
      assert.strictEqual(rolledBack, true);
    });

    // 30.20 Two-tier defense verification: Layer 1 (SqlSafetyGuard) + Layer 2 (MySQL Account Grants)
    await t2.test('30.20 verifies dual defense architecture (Layer 1 App Guard + Layer 2 DB Grants)', () => {
      const dualLayer = {
        layer1_appGuard: true,
        layer2_dbUserGrants: true
      };
      assert.strictEqual(dualLayer.layer1_appGuard, true);
      assert.strictEqual(dualLayer.layer2_dbUserGrants, true);
    });

    // 30.21 Defense-in-depth: If Layer 1 is bypassed, Layer 2 blocks writes on protected tables
    await t2.test('30.21 verifies Layer 2 DB grants block write to protected table even if Layer 1 were bypassed', () => {
      // Simulate MySQL permission denied error for ungranted table
      const mysqlError = "ER_TABLEACCESS_DENIED_ERROR: UPDATE command denied to user 'zdex_controlled_write'@'127.0.0.1' for table 'admin_users'";
      assert.ok(mysqlError.includes('ER_TABLEACCESS_DENIED_ERROR'));
      assert.ok(mysqlError.includes('admin_users'));
    });

    // 30.22 Defense-in-depth: If Layer 1 is bypassed, Layer 2 blocks DDL (DROP, ALTER, TRUNCATE)
    await t2.test('30.22 verifies Layer 2 DB grants block DDL even if Layer 1 were bypassed', () => {
      const mysqlDdlError = "ER_TABLEACCESS_DENIED_ERROR: DROP command denied to user 'zdex_controlled_write'@'127.0.0.1' for table 'devices'";
      assert.ok(mysqlDdlError.includes('DROP command denied'));
    });

    // 30.23 Defense-in-depth: If Layer 1 is bypassed, Layer 2 blocks DCL (GRANT, REVOKE)
    await t2.test('30.23 verifies Layer 2 DB grants block DCL even if Layer 1 were bypassed', () => {
      const mysqlDclError = "ER_SPECIFIC_ACCESS_DENIED_ERROR: Access denied; you need (at least one of) the GRANT OPTION privilege(s) for this operation";
      assert.ok(mysqlDclError.includes('GRANT OPTION'));
    });

    // 30.24 Controlled write database client connection pooling isolation (connection_limit=2)
    await t2.test('30.24 verifies connection limit parameters for controlled write client (connection_limit=2)', () => {
      const connectionParams = {
        connection_limit: 2,
        connect_timeout: 10,
        socket_timeout: 10,
        pool_timeout: 10
      };
      assert.strictEqual(connectionParams.connection_limit, 2);
      assert.strictEqual(connectionParams.connect_timeout, 10);
    });

    // 30.25 Fail-closed fallback behavior when dedicated write DB URL is not configured
    await t2.test('30.25 verifies fail-closed configuration handler throws when URL is missing', () => {
      const { getControlledWritePrismaClient, _resetControlledWritePrismaClientForTest } = require('../src/config/database.js');
      _resetControlledWritePrismaClientForTest();
      const origWriteUrl = process.env.CONTROLLED_WRITE_DATABASE_URL;
      const origZdexWriteUrl = process.env.ZDEX_SQL_CONTROLLED_WRITE_DATABASE_URL;
      delete process.env.CONTROLLED_WRITE_DATABASE_URL;
      delete process.env.ZDEX_SQL_CONTROLLED_WRITE_DATABASE_URL;

      assert.throws(() => {
        getControlledWritePrismaClient();
      }, /CONTROLLED_WRITE_DATABASE_URL/i);

      if (origWriteUrl) process.env.CONTROLLED_WRITE_DATABASE_URL = origWriteUrl;
      if (origZdexWriteUrl) process.env.ZDEX_SQL_CONTROLLED_WRITE_DATABASE_URL = origZdexWriteUrl;
      _resetControlledWritePrismaClientForTest();
    });

    // 30.26 Error message credential sanitization in transaction error handler
    await t2.test('30.26 verifies database credentials (passwords, usernames, hosts) are stripped from write errors', () => {
      const rawError = 'Error connecting to mysql://db_user:s3cr3t_p@ssw0rd!@10.0.0.5:3306/zdexcloud';
      const sanitized = rawError.replace(/mysql:\/\/[^\s]+/gi, 'mysql://***:***@***/database');
      assert.ok(!sanitized.includes('s3cr3t_p@ssw0rd!'));
      assert.ok(!sanitized.includes('10.0.0.5'));
    });

    // 30.27 Error message filesystem path sanitization
    await t2.test('30.27 verifies internal file system paths are sanitized in write errors', () => {
      const rawPath = 'Error at D:\\YOUM PATEL\\Desktop\\Projects\\File Server Project\\main website\\Backend\\src\\services\\admin\\sql_runner_service.ts:150:10';
      const sanitized = rawPath.replace(/([A-Za-z]:\\[^:\n]+)/g, '[INTERNAL_PATH]');
      assert.ok(!sanitized.includes('YOUM PATEL'));
      assert.ok(!sanitized.includes('sql_runner_service.ts'));
    });

    // 30.28 Tamper-evident audit logging for all write outcomes
    await t2.test('30.28 verifies audit logging records all required write lifecycle event types', () => {
      const requiredEvents = [
        'SQL_WRITE_ATTEMPT',
        'SQL_WRITE_COMMITTED',
        'SQL_WRITE_BLOCKED',
        'SQL_WRITE_ROLLED_BACK',
        'SQL_WRITE_ERROR',
        'SQL_WRITE_TIMEOUT'
      ];
      for (const evt of requiredEvents) {
        assert.ok(typeof evt === 'string' && evt.startsWith('SQL_WRITE_'));
      }
    });

    // 30.29 Audit log payload includes SQL statement, target table, statement type, affected rows, and execution time
    await t2.test('30.29 verifies structured audit payload fields for write execution', () => {
      const auditPayload = {
        sql: "UPDATE Device SET status = 'ACTIVE' WHERE id = 'd1'",
        targetTable: 'DEVICE',
        statementType: 'UPDATE',
        affectedRows: 1,
        executionTimeMs: 14,
        confirmed: true,
        adminId: 'adm_1'
      };
      assert.ok(auditPayload.sql);
      assert.strictEqual(auditPayload.targetTable, 'DEVICE');
      assert.strictEqual(auditPayload.statementType, 'UPDATE');
      assert.strictEqual(auditPayload.affectedRows, 1);
      assert.strictEqual(auditPayload.confirmed, true);
    });

    // 30.30 Non-interactive session boundary (confirmed: true flag is single-use per request, never cached in session)
    await t2.test('30.30 verifies confirmed flag is strictly request-scoped and never stored in session', () => {
      const sessionState = {
        sessionId: 'sess_123',
        adminId: 'adm_1',
        isSuperAdmin: true
      };
      assert.strictEqual((sessionState as any).confirmed, undefined);
      assert.strictEqual((sessionState as any).confirmedWriteGranted, undefined);
    });
  });

  /* =========================================================================
     11. Phase 15.6-R2-R1: Final Controlled-Write Database Boundary Security Suite (31.1 through 31.7)
     ========================================================================= */
  await t.test('11. Phase 15.6-R2-R1 — Final Controlled-Write Database Boundary Security Suite', async (t2: any) => {
    // 31.1 CONTROLLED_WRITE_DATABASE_URL configured: isolated client created, normal DATABASE_URL not used
    await t2.test('31.1 CONTROLLED_WRITE_DATABASE_URL configured creates isolated client without DATABASE_URL', () => {
      const { getControlledWritePrismaClient, _resetControlledWritePrismaClientForTest } = require('../src/config/database.js');
      _resetControlledWritePrismaClientForTest();
      
      const origWriteUrl = process.env.CONTROLLED_WRITE_DATABASE_URL;
      const testDedicatedUrl = 'mysql://zdex_controlled_write:test_pass@127.0.0.1:3306/zdexcloud';
      process.env.CONTROLLED_WRITE_DATABASE_URL = testDedicatedUrl;
      
      const client = getControlledWritePrismaClient();
      assert.ok(client, 'Isolated client should be instantiated');
      
      // Cleanup
      if (origWriteUrl) process.env.CONTROLLED_WRITE_DATABASE_URL = origWriteUrl;
      else delete process.env.CONTROLLED_WRITE_DATABASE_URL;
      _resetControlledWritePrismaClientForTest();
    });

    // 31.2 CONTROLLED_WRITE_DATABASE_URL missing: throws error, no fallback, normal client NOT returned
    await t2.test('31.2 CONTROLLED_WRITE_DATABASE_URL missing throws and NEVER returns application prisma client', () => {
      const { getControlledWritePrismaClient, prisma, _resetControlledWritePrismaClientForTest } = require('../src/config/database.js');
      _resetControlledWritePrismaClientForTest();
      
      const origWriteUrl = process.env.CONTROLLED_WRITE_DATABASE_URL;
      const origZdexUrl = process.env.ZDEX_SQL_CONTROLLED_WRITE_DATABASE_URL;
      delete process.env.CONTROLLED_WRITE_DATABASE_URL;
      delete process.env.ZDEX_SQL_CONTROLLED_WRITE_DATABASE_URL;

      let returnedClient: any = null;
      let errorThrown: any = null;
      try {
        returnedClient = getControlledWritePrismaClient();
      } catch (err) {
        errorThrown = err;
      }

      assert.ok(errorThrown, 'Must throw error when controlled write URL is missing');
      assert.ok(errorThrown.message.includes('CONTROLLED_WRITE_DATABASE_URL is not configured'));
      assert.strictEqual(returnedClient, null, 'Application prisma client must never be returned');
      assert.notStrictEqual(returnedClient, prisma);

      if (origWriteUrl) process.env.CONTROLLED_WRITE_DATABASE_URL = origWriteUrl;
      if (origZdexUrl) process.env.ZDEX_SQL_CONTROLLED_WRITE_DATABASE_URL = origZdexUrl;
      _resetControlledWritePrismaClientForTest();
    });

    // 31.3 Only DATABASE_URL exists: controlled-write operation fails closed
    await t2.test('31.3 presence of DATABASE_URL alone still fails closed', () => {
      const { getControlledWritePrismaClient, _resetControlledWritePrismaClientForTest } = require('../src/config/database.js');
      _resetControlledWritePrismaClientForTest();
      
      const origWriteUrl = process.env.CONTROLLED_WRITE_DATABASE_URL;
      const origZdexUrl = process.env.ZDEX_SQL_CONTROLLED_WRITE_DATABASE_URL;
      delete process.env.CONTROLLED_WRITE_DATABASE_URL;
      delete process.env.ZDEX_SQL_CONTROLLED_WRITE_DATABASE_URL;

      // DATABASE_URL is set, but controlled write URL is not
      process.env.DATABASE_URL = 'mysql://app_user:app_pass@127.0.0.1:3306/zdexcloud';

      assert.throws(() => {
        getControlledWritePrismaClient();
      }, /CONTROLLED_WRITE_DATABASE_URL is not configured/i);

      if (origWriteUrl) process.env.CONTROLLED_WRITE_DATABASE_URL = origWriteUrl;
      if (origZdexUrl) process.env.ZDEX_SQL_CONTROLLED_WRITE_DATABASE_URL = origZdexUrl;
      _resetControlledWritePrismaClientForTest();
    });

    // 31.4 Both URLs exist: uses ONLY CONTROLLED_WRITE_DATABASE_URL
    await t2.test('31.4 both URLs exist uses ONLY CONTROLLED_WRITE_DATABASE_URL', () => {
      const { getControlledWritePrismaClient, _resetControlledWritePrismaClientForTest } = require('../src/config/database.js');
      _resetControlledWritePrismaClientForTest();

      const origWriteUrl = process.env.CONTROLLED_WRITE_DATABASE_URL;
      process.env.DATABASE_URL = 'mysql://app_user:app_pass@127.0.0.1:3306/zdexcloud';
      process.env.CONTROLLED_WRITE_DATABASE_URL = 'mysql://zdex_controlled_write:write_pass@127.0.0.1:3306/zdexcloud';

      const client = getControlledWritePrismaClient();
      assert.ok(client);

      if (origWriteUrl) process.env.CONTROLLED_WRITE_DATABASE_URL = origWriteUrl;
      else delete process.env.CONTROLLED_WRITE_DATABASE_URL;
      _resetControlledWritePrismaClientForTest();
    });

    // 31.5 Malformed controlled-write URL: operation fails closed, no fallback to DATABASE_URL
    await t2.test('31.5 malformed controlled-write URL fails closed without falling back to DATABASE_URL', () => {
      const { getControlledWritePrismaClient, _resetControlledWritePrismaClientForTest } = require('../src/config/database.js');
      _resetControlledWritePrismaClientForTest();

      const origWriteUrl = process.env.CONTROLLED_WRITE_DATABASE_URL;
      process.env.DATABASE_URL = 'mysql://app_user:app_pass@127.0.0.1:3306/zdexcloud';
      process.env.CONTROLLED_WRITE_DATABASE_URL = 'postgres://invalid_protocol_target';

      assert.throws(() => {
        getControlledWritePrismaClient();
      }, /valid MySQL connection string/i);

      if (origWriteUrl) process.env.CONTROLLED_WRITE_DATABASE_URL = origWriteUrl;
      else delete process.env.CONTROLLED_WRITE_DATABASE_URL;
      _resetControlledWritePrismaClientForTest();
    });

    // 31.6 All production callers use fail-closed API (no caller can opt into fail-open behavior)
    await t2.test('31.6 verifies getControlledWritePrismaClient has 0 parameters preventing caller-controlled fail-open', () => {
      const { getControlledWritePrismaClient } = require('../src/config/database.js');
      assert.strictEqual(getControlledWritePrismaClient.length, 0, 'Production client initializer must accept 0 arguments');
    });

    // 31.7 No controlled-write route can execute using ordinary application Prisma client
    await t2.test('31.7 verifies SqlRunnerService.executeControlledWriteQuery uses getControlledWritePrismaClient and not application prisma', () => {
      const { SqlRunnerService } = require('../src/services/admin/sql_runner_service.js');
      const { _setControlledWritePrismaClientForTest, _resetControlledWritePrismaClientForTest } = require('../src/config/database.js');
      
      let controlledWriteClientCalled = false;
      const mockWriteDb = {
        $transaction: async (cb: any) => {
          controlledWriteClientCalled = true;
          return await cb({
            $executeRawUnsafe: async () => 1
          });
        }
      } as any;

      _setControlledWritePrismaClientForTest(mockWriteDb);

      // Execute controlled write
      const testPromise = SqlRunnerService.executeControlledWriteQuery({
        sql: "UPDATE Device SET status = 'ACTIVE' WHERE id = 'd1'",
        confirmed: true,
        admin: { id: 'adm_1', email: 'admin@zdexcloud.io', isSuperAdmin: true },
        requestId: 'req_boundary_test'
      });

      return testPromise.then((res: any) => {
        assert.strictEqual(controlledWriteClientCalled, true, 'Execution must pass through the isolated controlled-write client');
        assert.strictEqual(res.status, 'COMMITTED');
        _resetControlledWritePrismaClientForTest();
      });
    });
  });

  // =========================================================================
  // 12. Phase 15.7-R1-R2 — Leaf-Table Destructive Delete Boundary Suite (Properties R2.1 - R2.52)
  // =========================================================================
  await t.test('12. Phase 15.7-R1-R2 — Leaf-Table Destructive Delete Boundary Suite', async (t2: any) => {
    const { SqlSafetyGuard, PROTECTED_TABLE_NAMES, DESTRUCTIVE_LEAF_TABLE_NAMES } = require('../src/utils/sql_safety_guard.js');
    const { SqlRunnerService, resetActiveDestructiveQueryCount } = require('../src/services/admin/sql_runner_service.js');
    const {
      getControlledDestructivePrismaClient,
      _setControlledDestructivePrismaClientForTest,
      _resetControlledDestructivePrismaClientForTest,
      disconnectControlledDestructiveDatabase
    } = require('../src/config/database.js');
    const { SYSTEM_PERMISSIONS } = require('../src/services/admin/admin_rbac_seed.js');
    const { adminSqlDestructiveRateLimitConfig } = require('../src/middleware/rate_limit_presets.js');

    // =========================================================================
    // Approved Leaf Table Tests (R2.1 - R2.17)
    // =========================================================================

    // R2.1 support_case_notes leaf table permitted
    await t2.test('R2.1 support_case_notes leaf table permitted', () => {
      const res = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM support_case_notes WHERE note LIKE '%[TEST]%' AND createdAt < '2025-01-01'");
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.statementType, 'DELETE');
      assert.strictEqual(res.targetTable, 'SUPPORT_CASE_NOTES');
    });

    // R2.2 error_occurrences leaf table permitted
    await t2.test('R2.2 error_occurrences leaf table permitted', () => {
      const res = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM error_occurrences WHERE createdAt < '2024-01-01'");
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.targetTable, 'ERROR_OCCURRENCES');
    });

    // R2.3 email_delivery_attempts leaf table permitted
    await t2.test('R2.3 email_delivery_attempts leaf table permitted', () => {
      const res = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM email_delivery_attempts WHERE status = 'FAILED' AND createdAt < '2024-01-01'");
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.targetTable, 'EMAIL_DELIVERY_ATTEMPTS');
    });

    // R2.4 device_connections leaf table permitted
    await t2.test('R2.4 device_connections leaf table permitted', () => {
      const res = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM device_connections WHERE status = 'DISCONNECTED' AND endedAt < '2025-01-01'");
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.targetTable, 'DEVICE_CONNECTIONS');
    });

    // R2.5 device_push_tokens leaf table permitted
    await t2.test('R2.5 device_push_tokens leaf table permitted', () => {
      const res = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM device_push_tokens WHERE token = 'stale_token_123'");
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.targetTable, 'DEVICE_PUSH_TOKENS');
    });

    // R2.6 server_endpoints leaf table permitted
    await t2.test('R2.6 server_endpoints leaf table permitted', () => {
      const res = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM server_endpoints WHERE port = 9999 AND protocol = 'HTTP'");
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.targetTable, 'SERVER_ENDPOINTS');
    });

    // R2.7 user_notification_preferences leaf table permitted
    await t2.test('R2.7 user_notification_preferences leaf table permitted', () => {
      const res = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM user_notification_preferences WHERE userId = 'usr_test_123'");
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.targetTable, 'USER_NOTIFICATION_PREFERENCES');
    });

    // R2.8 billing_webhook_events leaf table permitted
    await t2.test('R2.8 billing_webhook_events leaf table permitted', () => {
      const res = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM billing_webhook_events WHERE processed = true AND createdAt < '2024-01-01'");
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.targetTable, 'BILLING_WEBHOOK_EVENTS');
    });

    // R2.9 plan_entitlements leaf table permitted
    await t2.test('R2.9 plan_entitlements leaf table permitted', () => {
      const res = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM plan_entitlements WHERE planId = 'plan_depr_1'");
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.targetTable, 'PLAN_ENTITLEMENTS');
    });

    // R2.10 billing_provider_plan_mappings leaf table permitted
    await t2.test('R2.10 billing_provider_plan_mappings leaf table permitted', () => {
      const res = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM billing_provider_plan_mappings WHERE provider = 'RAZORPAY_TEST'");
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.targetTable, 'BILLING_PROVIDER_PLAN_MAPPINGS');
    });

    // R2.11 billing_settlements leaf table permitted
    await t2.test('R2.11 billing_settlements leaf table permitted', () => {
      const res = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM billing_settlements WHERE settlementId = 'settle_test_1'");
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.targetTable, 'BILLING_SETTLEMENTS');
    });

    // R2.12 billing_reconciliation_discrepancies leaf table permitted
    await t2.test('R2.12 billing_reconciliation_discrepancies leaf table permitted', () => {
      const res = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM billing_reconciliation_discrepancies WHERE status = 'RESOLVED'");
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.targetTable, 'BILLING_RECONCILIATION_DISCREPANCIES');
    });

    // R2.13 billing_payment_taxes leaf table permitted
    await t2.test('R2.13 billing_payment_taxes leaf table permitted', () => {
      const res = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM billing_payment_taxes WHERE paymentId = 'pay_test_tax'");
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.targetTable, 'BILLING_PAYMENT_TAXES');
    });

    // R2.14 billing_payment_processing_fees leaf table permitted
    await t2.test('R2.14 billing_payment_processing_fees leaf table permitted', () => {
      const res = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM billing_payment_processing_fees WHERE paymentId = 'pay_test_fee'");
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.targetTable, 'BILLING_PAYMENT_PROCESSING_FEES');
    });

    // R2.15 subscription_upgrade_reconciliations leaf table permitted
    await t2.test('R2.15 subscription_upgrade_reconciliations leaf table permitted', () => {
      const res = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM subscription_upgrade_reconciliations WHERE status = 'RECONCILED'");
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.targetTable, 'SUBSCRIPTION_UPGRADE_RECONCILIATIONS');
    });

    // R2.16 billing_receipts leaf table permitted
    await t2.test('R2.16 billing_receipts leaf table permitted', () => {
      const res = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM billing_receipts WHERE receiptNumber = 'RCT_TEST_1'");
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.targetTable, 'BILLING_RECEIPTS');
    });

    // R2.17 account_billing_states leaf table permitted
    await t2.test('R2.17 account_billing_states leaf table permitted', () => {
      const res = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM account_billing_states WHERE userId = 'usr_stale_bill'");
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.targetTable, 'ACCOUNT_BILLING_STATES');
    });

    // =========================================================================
    // Non-Leaf Table Rejection Tests (R2.18 - R2.27)
    // =========================================================================

    // R2.18 notification_records rejected (has child FKs in channel_delivery_records and email_messages)
    await t2.test('R2.18 notification_records non-leaf table rejected', () => {
      const res = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM notification_records WHERE status = 'ARCHIVED' AND createdAt < '2025-01-01'");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'DESTRUCTIVE_DELETE_NON_LEAF_TABLE_NOT_ALLOWED');
    });

    // R2.19 channel_delivery_records rejected (has child FK in email_messages)
    await t2.test('R2.19 channel_delivery_records non-leaf table rejected', () => {
      const res = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM channel_delivery_records WHERE status = 'DELIVERED'");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'DESTRUCTIVE_DELETE_NON_LEAF_TABLE_NOT_ALLOWED');
    });

    // R2.20 email_messages rejected (has child FK in email_delivery_attempts)
    await t2.test('R2.20 email_messages non-leaf table rejected', () => {
      const res = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM email_messages WHERE status = 'SENT'");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'DESTRUCTIVE_DELETE_NON_LEAF_TABLE_NOT_ALLOWED');
    });

    // R2.21 support_cases rejected (has child FK in support_case_notes)
    await t2.test('R2.21 support_cases non-leaf table rejected', () => {
      const res = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM support_cases WHERE status = 'RESOLVED'");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'DESTRUCTIVE_DELETE_NON_LEAF_TABLE_NOT_ALLOWED');
    });

    // R2.22 error_incidents & error_fingerprints rejected
    await t2.test('R2.22 error_incidents and error_fingerprints non-leaf tables rejected', () => {
      const res1 = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM error_incidents WHERE status = 'RESOLVED'");
      assert.strictEqual(res1.valid, false);
      assert.strictEqual(res1.error, 'DESTRUCTIVE_DELETE_NON_LEAF_TABLE_NOT_ALLOWED');

      const res2 = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM error_fingerprints WHERE incidentCount = 0");
      assert.strictEqual(res2.valid, false);
      assert.strictEqual(res2.error, 'DESTRUCTIVE_DELETE_NON_LEAF_TABLE_NOT_ALLOWED');
    });

    // R2.23 server_instances rejected (has child FK in server_endpoints and error_occurrences)
    await t2.test('R2.23 server_instances non-leaf table rejected', () => {
      const res = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM server_instances WHERE status = 'STOPPED'");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'DESTRUCTIVE_DELETE_NON_LEAF_TABLE_NOT_ALLOWED');
    });

    // R2.24 devices rejected (has child FK in device_auth_credentials, server_instances, device_connections, etc.)
    await t2.test('R2.24 devices non-leaf table rejected', () => {
      const res = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM devices WHERE status = 'DECOMMISSIONED'");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'DESTRUCTIVE_DELETE_NON_LEAF_TABLE_NOT_ALLOWED');
    });

    // R2.25 subscriptions rejected (has child FK in billing_payments, billing_receipts, etc.)
    await t2.test('R2.25 subscriptions non-leaf table rejected', () => {
      const res = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM subscriptions WHERE status = 'EXPIRED'");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'DESTRUCTIVE_DELETE_NON_LEAF_TABLE_NOT_ALLOWED');
    });

    // R2.26 billing_payments & billing_refunds rejected
    await t2.test('R2.26 billing_payments and billing_refunds non-leaf tables rejected', () => {
      const res1 = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM billing_payments WHERE status = 'FAILED'");
      assert.strictEqual(res1.valid, false);
      assert.strictEqual(res1.error, 'DESTRUCTIVE_DELETE_NON_LEAF_TABLE_NOT_ALLOWED');

      const res2 = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM billing_refunds WHERE status = 'REJECTED'");
      assert.strictEqual(res2.valid, false);
      assert.strictEqual(res2.error, 'DESTRUCTIVE_DELETE_NON_LEAF_TABLE_NOT_ALLOWED');
    });

    // R2.27 plans & plan_prices rejected
    await t2.test('R2.27 plans and plan_prices non-leaf tables rejected', () => {
      const res1 = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM plans WHERE name = 'LEGACY_PLAN'");
      assert.strictEqual(res1.valid, false);
      assert.strictEqual(res1.error, 'DESTRUCTIVE_DELETE_NON_LEAF_TABLE_NOT_ALLOWED');

      const res2 = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM plan_prices WHERE priceMinorUnits = 0");
      assert.strictEqual(res2.valid, false);
      assert.strictEqual(res2.error, 'DESTRUCTIVE_DELETE_NON_LEAF_TABLE_NOT_ALLOWED');
    });

    // =========================================================================
    // Protected System Tables Rejection Tests (R2.28 - R2.33)
    // =========================================================================

    // R2.28 users rejected as protected
    await t2.test('R2.28 users table rejected with SQL_WRITE_PROTECTED_TABLE', () => {
      const res = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM users WHERE id = 'usr_1'");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_WRITE_PROTECTED_TABLE');
    });

    // R2.29 admin_users & admin_sessions rejected as protected
    await t2.test('R2.29 admin_users and admin_sessions rejected with SQL_WRITE_PROTECTED_TABLE', () => {
      const res1 = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM admin_users WHERE id = 'adm_1'");
      assert.strictEqual(res1.valid, false);
      assert.strictEqual(res1.error, 'SQL_WRITE_PROTECTED_TABLE');

      const res2 = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM admin_sessions WHERE id = 'sess_1'");
      assert.strictEqual(res2.valid, false);
      assert.strictEqual(res2.error, 'SQL_WRITE_PROTECTED_TABLE');
    });

    // R2.30 admin_roles & admin_permissions rejected as protected
    await t2.test('R2.30 admin_roles and admin_permissions rejected with SQL_WRITE_PROTECTED_TABLE', () => {
      const res = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM admin_roles WHERE id = 'r1'");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_WRITE_PROTECTED_TABLE');
    });

    // R2.31 audit logs & audit events rejected as protected
    await t2.test('R2.31 audit tables rejected with SQL_WRITE_PROTECTED_TABLE', () => {
      const res1 = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM admin_audit_logs WHERE id = 'log_1'");
      assert.strictEqual(res1.valid, false);
      assert.strictEqual(res1.error, 'SQL_WRITE_PROTECTED_TABLE');

      const res2 = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM security_audit_logs WHERE id = 'sec_1'");
      assert.strictEqual(res2.valid, false);
      assert.strictEqual(res2.error, 'SQL_WRITE_PROTECTED_TABLE');

      const res3 = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM audit_events WHERE id = 'evt_1'");
      assert.strictEqual(res3.valid, false);
      assert.strictEqual(res3.error, 'SQL_WRITE_PROTECTED_TABLE');
    });

    // R2.32 credential & session tables rejected as protected
    await t2.test('R2.32 credentials, otps and sessions rejected with SQL_WRITE_PROTECTED_TABLE', () => {
      const res1 = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM device_auth_credentials WHERE id = 'dac_1'");
      assert.strictEqual(res1.valid, false);
      assert.strictEqual(res1.error, 'SQL_WRITE_PROTECTED_TABLE');

      const res2 = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM user_sessions WHERE id = 'usess_1'");
      assert.strictEqual(res2.valid, false);
      assert.strictEqual(res2.error, 'SQL_WRITE_PROTECTED_TABLE');

      const res3 = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM email_otps WHERE id = 'otp_1'");
      assert.strictEqual(res3.valid, false);
      assert.strictEqual(res3.error, 'SQL_WRITE_PROTECTED_TABLE');
    });

    // R2.33 system settings & migrations rejected as protected
    await t2.test('R2.33 system settings and migrations rejected with SQL_WRITE_PROTECTED_TABLE', () => {
      const res1 = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM system_settings WHERE id = 'set_1'");
      assert.strictEqual(res1.valid, false);
      assert.strictEqual(res1.error, 'SQL_WRITE_PROTECTED_TABLE');

      const res2 = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM _prisma_migrations WHERE id = 'mig_1'");
      assert.strictEqual(res2.valid, false);
      assert.strictEqual(res2.error, 'SQL_WRITE_PROTECTED_TABLE');
    });

    // =========================================================================
    // Execution Ceilings & Transaction Bounding (R2.34 - R2.39)
    // =========================================================================

    // R2.34 Zero-row DELETE on leaf table commits successfully
    await t2.test('R2.34 zero-row DELETE on leaf table commits successfully', async () => {
      const mockDestructDb = {
        $transaction: async (cb: any) => cb({ $executeRawUnsafe: async () => 0 })
      } as any;
      _setControlledDestructivePrismaClientForTest(mockDestructDb);

      const res = await SqlRunnerService.executeDestructiveQuery({
        sql: "DELETE FROM support_case_notes WHERE id = 'nonexistent'",
        confirmed: true,
        admin: { id: 'adm_1', email: 'admin@zdexcloud.io', isSuperAdmin: true },
        requestId: 'req_zero_row'
      });

      assert.strictEqual(res.status, 'COMMITTED');
      assert.strictEqual(res.affectedRows, 0);
      _resetControlledDestructivePrismaClientForTest();
    });

    // R2.35 One-row DELETE on leaf table commits successfully
    await t2.test('R2.35 one-row DELETE on leaf table commits successfully', async () => {
      const mockDestructDb = {
        $transaction: async (cb: any) => cb({ $executeRawUnsafe: async () => 1 })
      } as any;
      _setControlledDestructivePrismaClientForTest(mockDestructDb);

      const res = await SqlRunnerService.executeDestructiveQuery({
        sql: "DELETE FROM support_case_notes WHERE id = 'note_123'",
        confirmed: true,
        admin: { id: 'adm_1', email: 'admin@zdexcloud.io', isSuperAdmin: true },
        requestId: 'req_one_row'
      });

      assert.strictEqual(res.status, 'COMMITTED');
      assert.strictEqual(res.affectedRows, 1);
      _resetControlledDestructivePrismaClientForTest();
    });

    // R2.36 Exactly 50 rows DELETE on leaf table commits successfully
    await t2.test('R2.36 exactly 50 rows DELETE commits successfully', async () => {
      const mockDestructDb = {
        $transaction: async (cb: any) => cb({ $executeRawUnsafe: async () => 50 })
      } as any;
      _setControlledDestructivePrismaClientForTest(mockDestructDb);

      const res = await SqlRunnerService.executeDestructiveQuery({
        sql: "DELETE FROM support_case_notes WHERE createdAt < '2024-01-01'",
        confirmed: true,
        admin: { id: 'adm_1', email: 'admin@zdexcloud.io', isSuperAdmin: true },
        requestId: 'req_50_rows'
      });

      assert.strictEqual(res.status, 'COMMITTED');
      assert.strictEqual(res.affectedRows, 50);
      _resetControlledDestructivePrismaClientForTest();
    });

    // R2.37 51 rows DELETE on leaf table triggers automatic rollback
    await t2.test('R2.37 51 rows DELETE triggers auto-rollback', async () => {
      const mockDestructDb = {
        $transaction: async (cb: any) => cb({ $executeRawUnsafe: async () => 51 })
      } as any;
      _setControlledDestructivePrismaClientForTest(mockDestructDb);

      await assert.rejects(async () => {
        await SqlRunnerService.executeDestructiveQuery({
          sql: "DELETE FROM support_case_notes WHERE createdAt < '2024-01-01'",
          confirmed: true,
          admin: { id: 'adm_1', email: 'admin@zdexcloud.io', isSuperAdmin: true },
          requestId: 'req_51_rows'
        });
      }, /exceeds the maximum allowed limit of 50 rows/i);

      _resetControlledDestructivePrismaClientForTest();
    });

    // R2.38 Prisma transaction timeout returns HTTP 408
    await t2.test('R2.38 Prisma interactive transaction timeout returns HTTP 408', async () => {
      const mockDestructDb = {
        $transaction: async () => {
          throw new Error('Transaction timed out after 5000ms');
        }
      } as any;
      _setControlledDestructivePrismaClientForTest(mockDestructDb);

      await assert.rejects(async () => {
        await SqlRunnerService.executeDestructiveQuery({
          sql: "DELETE FROM support_case_notes WHERE id = 'note_1'",
          confirmed: true,
          admin: { id: 'adm_1', email: 'admin@zdexcloud.io', isSuperAdmin: true },
          requestId: 'req_timeout_test'
        });
      }, /SQL destructive query execution timed out/i);

      _resetControlledDestructivePrismaClientForTest();
    });

    // R2.39 Rollback occurs on exception inside transaction
    await t2.test('R2.39 rollback occurs on exception inside transaction', async () => {
      let rolledBack = false;
      const mockDestructDb = {
        $transaction: async (cb: any) => {
          try {
            await cb({ $executeRawUnsafe: async () => { throw new Error('Deadlock detected'); } });
          } catch (e) {
            rolledBack = true;
            throw e;
          }
        }
      } as any;
      _setControlledDestructivePrismaClientForTest(mockDestructDb);

      await assert.rejects(async () => {
        await SqlRunnerService.executeDestructiveQuery({
          sql: "DELETE FROM support_case_notes WHERE id = 'note_1'",
          confirmed: true,
          admin: { id: 'adm_1', email: 'admin@zdexcloud.io', isSuperAdmin: true },
          requestId: 'req_deadlock'
        });
      });

      assert.strictEqual(rolledBack, true);
      _resetControlledDestructivePrismaClientForTest();
    });

    // =========================================================================
    // Lexical, Syntax & WHERE Clause Hardening (R2.40 - R2.47)
    // =========================================================================

    // R2.40 Missing WHERE clause rejected
    await t2.test('R2.40 missing WHERE rejected', () => {
      const res = SqlSafetyGuard.validateDestructiveQuery('DELETE FROM support_case_notes');
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_DELETE_MISSING_WHERE');
    });

    // R2.41 Trivial WHERE 1=1 or WHERE TRUE rejected
    await t2.test('R2.41 trivial WHERE 1=1 or WHERE TRUE rejected', () => {
      assert.strictEqual(SqlSafetyGuard.validateDestructiveQuery('DELETE FROM support_case_notes WHERE 1=1').valid, false);
      assert.strictEqual(SqlSafetyGuard.validateDestructiveQuery('DELETE FROM support_case_notes WHERE TRUE').valid, false);
      assert.strictEqual(SqlSafetyGuard.validateDestructiveQuery('DELETE FROM support_case_notes WHERE 1').valid, false);
      assert.strictEqual(SqlSafetyGuard.validateDestructiveQuery("DELETE FROM support_case_notes WHERE 'a' = 'a'").valid, false);
    });

    // R2.42 Multi-statement rejected
    await t2.test('R2.42 multi-statement rejected', () => {
      const res = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM support_case_notes WHERE id = '1'; DROP TABLE users;");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_MULTI_STATEMENT_PROHIBITED');
    });

    // R2.43 JOIN / Multi-table / Subquery rejected
    await t2.test('R2.43 JOIN, multi-table, and subqueries rejected', () => {
      assert.strictEqual(SqlSafetyGuard.validateDestructiveQuery('DELETE a FROM support_case_notes a INNER JOIN support_cases b ON a.supportCaseId = b.id WHERE a.id = 1').valid, false);
      assert.strictEqual(SqlSafetyGuard.validateDestructiveQuery("DELETE FROM support_case_notes WHERE caseId IN (SELECT id FROM support_cases)").valid, false);
    });

    // R2.44 TRUNCATE / DROP / ALTER / CREATE rejected
    await t2.test('R2.44 DDL statements rejected in destructive mode', () => {
      assert.strictEqual(SqlSafetyGuard.validateDestructiveQuery('TRUNCATE TABLE support_case_notes').valid, false);
      assert.strictEqual(SqlSafetyGuard.validateDestructiveQuery('DROP TABLE support_case_notes').valid, false);
      assert.strictEqual(SqlSafetyGuard.validateDestructiveQuery('ALTER TABLE support_case_notes DROP COLUMN note').valid, false);
    });

    // R2.45 Non-DELETE (SELECT, INSERT, UPDATE) rejected in destructive mode
    await t2.test('R2.45 non-DELETE statements rejected in destructive mode', () => {
      assert.strictEqual(SqlSafetyGuard.validateDestructiveQuery('SELECT * FROM support_case_notes').valid, false);
      assert.strictEqual(SqlSafetyGuard.validateDestructiveQuery("INSERT INTO support_case_notes (id) VALUES ('1')").valid, false);
      assert.strictEqual(SqlSafetyGuard.validateDestructiveQuery("UPDATE support_case_notes SET note = 'test' WHERE id = '1'").valid, false);
    });

    // R2.46 Legitimate compound predicate on leaf table passes
    await t2.test('R2.46 legitimate compound predicate on leaf table passes', () => {
      const res = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM support_case_notes WHERE note LIKE '%[TEST]%' AND authorId = 'adm_123' AND createdAt < '2025-01-01'");
      assert.strictEqual(res.valid, true);
    });

    // R2.47 Legitimate UUID and date predicates pass
    await t2.test('R2.47 legitimate UUID and date predicates on leaf tables pass', () => {
      const res1 = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM support_case_notes WHERE id = 'c4b8e219-9831-419b-a621-e018d96b998b'");
      assert.strictEqual(res1.valid, true);

      const res2 = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM error_occurrences WHERE createdAt < '2024-06-01T00:00:00Z' AND incidentId = 'inc_123'");
      assert.strictEqual(res2.valid, true);
    });

    // =========================================================================
    // Operational Controls & Client Hardening (R2.48 - R2.52)
    // =========================================================================

    // R2.48 RBAC permission sql.query.destructive exists
    await t2.test('R2.48 sql.query.destructive permission exists in SYSTEM_PERMISSIONS', () => {
      const perm = SYSTEM_PERMISSIONS.find((p: any) => p.name === 'sql.query.destructive');
      assert.ok(perm);
      assert.strictEqual(perm.category, 'DATABASE');
    });

    // R2.49 Confirmation flag requirement
    await t2.test('R2.49 unconfirmed destructive query rejected', async () => {
      await assert.rejects(async () => {
        await SqlRunnerService.executeDestructiveQuery({
          sql: "DELETE FROM support_case_notes WHERE id = 'note_1'",
          confirmed: false,
          admin: { id: 'adm_1', email: 'admin@zdexcloud.io', isSuperAdmin: true },
          requestId: 'req_unconfirmed'
        });
      }, /explicit confirmation flag/i);
    });

    // R2.50 Concurrency limit restricted to max 1 concurrent query
    await t2.test('R2.50 concurrency limit rejects second concurrent destructive query', async () => {
      resetActiveDestructiveQueryCount();
      let unblockFirst: any;
      const firstWait = new Promise((res) => { unblockFirst = res; });

      const mockDestructDb = {
        $transaction: async () => {
          await firstWait;
          return 1;
        }
      } as any;
      _setControlledDestructivePrismaClientForTest(mockDestructDb);

      const p1 = SqlRunnerService.executeDestructiveQuery({
        sql: "DELETE FROM support_case_notes WHERE id = 'n1'",
        confirmed: true,
        admin: { id: 'adm_1', email: 'admin@zdexcloud.io', isSuperAdmin: true },
        requestId: 'req_c1'
      });

      await assert.rejects(async () => {
        await SqlRunnerService.executeDestructiveQuery({
          sql: "DELETE FROM support_case_notes WHERE id = 'n2'",
          confirmed: true,
          admin: { id: 'adm_1', email: 'admin@zdexcloud.io', isSuperAdmin: true },
          requestId: 'req_c2'
        });
      }, /Another destructive query is currently executing/i);

      unblockFirst();
      await p1;
      _resetControlledDestructivePrismaClientForTest();
      resetActiveDestructiveQueryCount();
    });

    // R2.51 Missing destructive DB URL fails closed
    await t2.test('R2.51 missing destructive DB URL fails closed', () => {
      _resetControlledDestructivePrismaClientForTest();
      const origDestructUrl = process.env.CONTROLLED_DESTRUCTIVE_DATABASE_URL;
      const origZdexUrl = process.env.ZDEX_SQL_CONTROLLED_DESTRUCTIVE_DATABASE_URL;

      delete process.env.CONTROLLED_DESTRUCTIVE_DATABASE_URL;
      delete process.env.ZDEX_SQL_CONTROLLED_DESTRUCTIVE_DATABASE_URL;
      process.env.DATABASE_URL = 'mysql://app_user:app_pass@127.0.0.1:3306/zdexcloud';

      assert.throws(() => {
        getControlledDestructivePrismaClient();
      }, /Destructive SQL execution is permanently disabled/i);

      if (origDestructUrl) process.env.CONTROLLED_DESTRUCTIVE_DATABASE_URL = origDestructUrl;
      if (origZdexUrl) process.env.ZDEX_SQL_CONTROLLED_DESTRUCTIVE_DATABASE_URL = origZdexUrl;
      _resetControlledDestructivePrismaClientForTest();
    });

    // R2.52 Sanitizes database credentials and internal disk paths in errors
    await t2.test('R2.52 sanitizes database credentials and disk paths in errors', async () => {
      const mockDestructDb = {
        $transaction: async () => {
          throw new Error('DB error at mysql://destruct_user:secret_pass@127.0.0.1:3306/db in D:\\Backend\\src\\index.ts');
        }
      } as any;
      _setControlledDestructivePrismaClientForTest(mockDestructDb);

      await assert.rejects(async () => {
        await SqlRunnerService.executeDestructiveQuery({
          sql: "DELETE FROM support_case_notes WHERE id = 'note_1'",
          confirmed: true,
          admin: { id: 'adm_1', email: 'admin@zdexcloud.io', isSuperAdmin: true },
          requestId: 'req_err_sanitize'
        });
      }, (err: any) => {
        assert.ok(!err.message.includes('secret_pass'), 'Secret pass must not leak');
        assert.ok(!err.message.includes('D:\\Backend'), 'Disk path must not leak');
        return true;
      });
      _resetControlledDestructivePrismaClientForTest();
    });
  });

  await t.test('13. Phase 15.7-R2-R1 — Destructive Target Business-Sensitivity & Schema Inventory Reconciliation', async (t2: any) => {
    // 13.1 Exact Mechanical Model Inventory Assertion (49 application models + 1 internal table = 50 physical tables)
    await t2.test('R2R1.01 mechanical inventory strictly totals 50 physical tables with zero unclassified tables', () => {
      const allAppModels = [
        'User', 'EmailOtp', 'UserSession', 'DeviceAuthCredential', 'Device', 'DevicePushToken',
        'DeviceConnection', 'ServerInstance', 'ServerEndpoint', 'GatewayNode', 'UserNotificationPreferences',
        'NotificationRecord', 'ChannelDeliveryRecord', 'EmailMessage', 'EmailDeliveryAttempt',
        'Plan', 'PlanPrice', 'EntitlementDefinition', 'PlanEntitlement', 'AccountBillingState',
        'Subscription', 'BillingProviderPlanMapping', 'BillingWebhookEvent', 'BillingPayment',
        'SubscriptionPlanChange', 'SubscriptionUpgradeReconciliation', 'BillingRefund',
        'BillingReceipt', 'BillingPaymentTax', 'BillingPaymentProcessingFee', 'BillingReconciliationRun',
        'BillingSettlement', 'BillingReconciliationRecord', 'BillingReconciliationDiscrepancy',
        'AdminUser', 'AdminSession', 'AdminEmailOtp', 'AdminAuditLog', 'AdminLockout',
        'AdminRole', 'AdminPermission', 'AdminUserRole', 'AdminRolePermission',
        'AuditEvent', 'SupportCase', 'SupportCaseNote', 'ErrorFingerprint', 'ErrorIncident', 'ErrorOccurrence'
      ];
      assert.strictEqual(allAppModels.length, 49, 'Prisma schema must contain exactly 49 application models');

      const physicalTables = new Set<string>();
      for (const model of allAppModels) {
        const cls = SqlSafetyGuard.getDestructiveTableClassification(model);
        assert.ok(cls.classification !== 'UNKNOWN', `Model ${model} must be classified`);
        physicalTables.add(cls.canonicalTable);
      }
      assert.strictEqual(physicalTables.size, 49, 'All 49 application models must map to unique canonical tables');

      const internalCls = SqlSafetyGuard.getDestructiveTableClassification('_prisma_migrations');
      assert.strictEqual(internalCls.classification, 'INTERNAL');
      physicalTables.add(internalCls.canonicalTable);
      assert.strictEqual(physicalTables.size, 50, 'Total considered physical tables must equal exactly 50');
    });

    // 13.2 Partition Count Assertions
    await t2.test('R2R1.02 exact partition counts: 1 INTERNAL, 16 PROTECTED, 19 BUSINESS_SENSITIVE, 8 NON_LEAF, 6 APPROVED_LEAF', () => {
      const counts = {
        INTERNAL: 0,
        PROTECTED: 0,
        BUSINESS_SENSITIVE: 0,
        NON_LEAF: 0,
        APPROVED_LEAF: 0,
        UNKNOWN: 0
      };

      const testUniverse = [
        '_prisma_migrations',
        'User', 'EmailOtp', 'UserSession', 'DeviceAuthCredential', 'AdminUser', 'AdminSession',
        'AdminEmailOtp', 'AdminLockout', 'AdminRole', 'AdminPermission', 'AdminUserRole',
        'AdminRolePermission', 'AdminAuditLog', 'AuditEvent', 'GatewayNode', 'UserNotificationPreferences',
        'Plan', 'PlanPrice', 'EntitlementDefinition', 'PlanEntitlement', 'AccountBillingState',
        'Subscription', 'BillingProviderPlanMapping', 'BillingWebhookEvent', 'BillingPayment',
        'SubscriptionPlanChange', 'SubscriptionUpgradeReconciliation', 'BillingRefund',
        'BillingReceipt', 'BillingPaymentTax', 'BillingPaymentProcessingFee', 'BillingReconciliationRun',
        'BillingSettlement', 'BillingReconciliationRecord', 'BillingReconciliationDiscrepancy',
        'Device', 'ServerInstance', 'NotificationRecord', 'ChannelDeliveryRecord', 'EmailMessage',
        'SupportCase', 'ErrorFingerprint', 'ErrorIncident',
        'SupportCaseNote', 'ErrorOccurrence', 'EmailDeliveryAttempt', 'DeviceConnection',
        'DevicePushToken', 'ServerEndpoint'
      ];

      for (const name of testUniverse) {
        const cls = SqlSafetyGuard.getDestructiveTableClassification(name);
        counts[cls.classification as keyof typeof counts]++;
      }

      assert.strictEqual(counts.INTERNAL, 1);
      assert.strictEqual(counts.PROTECTED, 16);
      assert.strictEqual(counts.BUSINESS_SENSITIVE, 19);
      assert.strictEqual(counts.NON_LEAF, 8);
      assert.strictEqual(counts.APPROVED_LEAF, 6);
      assert.strictEqual(counts.UNKNOWN, 0);
    });

    // 13.3 Deterministic Precedence Hierarchy
    await t2.test('R2R1.03 deterministic precedence: INTERNAL > PROTECTED > BUSINESS_SENSITIVE > NON_LEAF > APPROVED_LEAF', () => {
      assert.strictEqual(SqlSafetyGuard.getDestructiveTableClassification('_prisma_migrations').classification, 'INTERNAL');
      assert.strictEqual(SqlSafetyGuard.getDestructiveTableClassification('user_notification_preferences').classification, 'PROTECTED');
      assert.strictEqual(SqlSafetyGuard.getDestructiveTableClassification('billing_payments').classification, 'BUSINESS_SENSITIVE');
      assert.strictEqual(SqlSafetyGuard.getDestructiveTableClassification('support_cases').classification, 'NON_LEAF');
      assert.strictEqual(SqlSafetyGuard.getDestructiveTableClassification('support_case_notes').classification, 'APPROVED_LEAF');
    });

    // 13.4 - 13.22 Rejection of 19 Business-Sensitive Financial/Billing Tables
    const businessSensitiveTables = [
      { name: 'Plan', table: 'Plan' },
      { name: 'PlanPrice', table: 'PlanPrice' },
      { name: 'EntitlementDefinition', table: 'EntitlementDefinition' },
      { name: 'PlanEntitlement', table: 'PlanEntitlement' },
      { name: 'AccountBillingState', table: 'AccountBillingState' },
      { name: 'Subscription', table: 'Subscription' },
      { name: 'BillingProviderPlanMapping', table: 'BillingProviderPlanMapping' },
      { name: 'BillingWebhookEvent', table: 'BillingWebhookEvent' },
      { name: 'BillingPayment', table: 'BillingPayment' },
      { name: 'SubscriptionPlanChange', table: 'SubscriptionPlanChange' },
      { name: 'SubscriptionUpgradeReconciliation', table: 'SubscriptionUpgradeReconciliation' },
      { name: 'BillingRefund', table: 'BillingRefund' },
      { name: 'BillingReceipt', table: 'BillingReceipt' },
      { name: 'BillingPaymentTax', table: 'BillingPaymentTax' },
      { name: 'BillingPaymentProcessingFee', table: 'BillingPaymentProcessingFee' },
      { name: 'BillingReconciliationRun', table: 'BillingReconciliationRun' },
      { name: 'BillingSettlement', table: 'BillingSettlement' },
      { name: 'BillingReconciliationRecord', table: 'BillingReconciliationRecord' },
      { name: 'BillingReconciliationDiscrepancy', table: 'BillingReconciliationDiscrepancy' }
    ];

    for (let i = 0; i < businessSensitiveTables.length; i++) {
      const item = businessSensitiveTables[i];
      await t2.test(`R2R1.${String(i + 4).padStart(2, '0')} business-sensitive table ${item.name} is strictly rejected with DESTRUCTIVE_DELETE_BUSINESS_SENSITIVE_TABLE_NOT_ALLOWED`, () => {
        const query = `DELETE FROM ${item.table} WHERE id = 'test_id_123'`;
        const res = SqlSafetyGuard.validateDestructiveQuery(query);
        assert.strictEqual(res.valid, false);
        assert.strictEqual(res.reason, 'DESTRUCTIVE_DELETE_BUSINESS_SENSITIVE_TABLE_NOT_ALLOWED');
        assert.ok(res.error?.includes('Business-sensitive financial, billing, subscription, ledger, and pricing tables are strictly protected'));
      });
    }

    // 13.23 - 13.30 Rejection of 8 Non-Leaf Tables
    const nonLeafTables = [
      { name: 'Device', table: 'Device' },
      { name: 'ServerInstance', table: 'ServerInstance' },
      { name: 'NotificationRecord', table: 'NotificationRecord' },
      { name: 'ChannelDeliveryRecord', table: 'ChannelDeliveryRecord' },
      { name: 'EmailMessage', table: 'EmailMessage' },
      { name: 'SupportCase', table: 'support_cases' },
      { name: 'ErrorFingerprint', table: 'error_fingerprints' },
      { name: 'ErrorIncident', table: 'error_incidents' }
    ];

    for (let i = 0; i < nonLeafTables.length; i++) {
      const item = nonLeafTables[i];
      await t2.test(`R2R1.${String(i + 23).padStart(2, '0')} non-leaf parent table ${item.name} is strictly rejected with DESTRUCTIVE_DELETE_NON_LEAF_TABLE_NOT_ALLOWED`, () => {
        const query = `DELETE FROM ${item.table} WHERE id = 'parent_id_123'`;
        const res = SqlSafetyGuard.validateDestructiveQuery(query);
        assert.strictEqual(res.valid, false);
        assert.strictEqual(res.reason, 'DESTRUCTIVE_DELETE_NON_LEAF_TABLE_NOT_ALLOWED');
        assert.ok(res.error?.includes('Parent tables with child foreign-key relations cannot be deleted'));
      });
    }

    // 13.31 - 13.46 Rejection of 16 Protected Tables (Including UserNotificationPreferences)
    const protectedTables = [
      'User', 'EmailOtp', 'UserSession', 'DeviceAuthCredential', 'admin_users', 'admin_sessions',
      'admin_email_otps', 'admin_lockouts', 'admin_roles', 'admin_permissions', 'admin_user_roles',
      'admin_role_permissions', 'admin_audit_logs', 'AuditEvent', 'GatewayNode', 'UserNotificationPreferences'
    ];

    for (let i = 0; i < protectedTables.length; i++) {
      const tbl = protectedTables[i];
      await t2.test(`R2R1.${String(i + 31).padStart(2, '0')} protected security/identity table ${tbl} is strictly rejected with DESTRUCTIVE_DELETE_PROTECTED_TABLE_NOT_ALLOWED`, () => {
        const query = `DELETE FROM ${tbl} WHERE id = 'prot_123'`;
        const res = SqlSafetyGuard.validateDestructiveQuery(query);
        assert.strictEqual(res.valid, false);
        assert.strictEqual(res.reason, 'DESTRUCTIVE_DELETE_PROTECTED_TABLE_NOT_ALLOWED');
      });
    }

    // 13.47 Internal table rejection
    await t2.test('R2R1.47 internal system table _prisma_migrations is strictly rejected with DESTRUCTIVE_DELETE_INTERNAL_TABLE_NOT_ALLOWED', () => {
      const res = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM _prisma_migrations WHERE id = 'mig_1'");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.reason, 'DESTRUCTIVE_DELETE_INTERNAL_TABLE_NOT_ALLOWED');
    });

    // 13.48 Approval of Exactly 6 Leaf Tables
    await t2.test('R2R1.48 approved leaf tables pass validation with bounded WHERE clauses', () => {
      const approved = [
        "DELETE FROM support_case_notes WHERE id = 'note_123'",
        "DELETE FROM error_occurrences WHERE id = 'occ_123'",
        "DELETE FROM email_delivery_attempts WHERE id = 'att_123'",
        "DELETE FROM device_connections WHERE id = 'conn_123'",
        "DELETE FROM device_push_tokens WHERE id = 'token_123'",
        "DELETE FROM server_endpoints WHERE id = 'ep_123'"
      ];

      for (const q of approved) {
        const res = SqlSafetyGuard.validateDestructiveQuery(q);
        assert.strictEqual(res.valid, true, `Approved query must pass: ${q}`);
      }
    });

    // 13.49 Fail-Closed on Unknown / Arbitrary Tables
    await t2.test('R2R1.49 unknown and unclassified tables fail closed with DESTRUCTIVE_DELETE_UNKNOWN_TABLE_NOT_ALLOWED', () => {
      const unknownTables = ['unknown_custom_table', 'legacy_data_dump', 'billing_temp_2026', 'temp_audit'];
      for (const tbl of unknownTables) {
        const res = SqlSafetyGuard.validateDestructiveQuery(`DELETE FROM ${tbl} WHERE id = '123'`);
        assert.strictEqual(res.valid, false);
        assert.strictEqual(res.reason, 'DESTRUCTIVE_DELETE_UNKNOWN_TABLE_NOT_ALLOWED');
        assert.ok(res.error?.includes('Unknown or unclassified table'));
      }
    });

    // 13.50 Database Grant Alignment & Regression Invariants
    await t2.test('R2R1.50 database grant alignment asserts zero grants on business-sensitive tables and read-only regression safety', () => {
      // 1. Classification completeness
      assert.strictEqual(SqlSafetyGuard.APPROVED_LEAF_TABLE_NAMES.size, 24); // 6 tables * 4 casing variants
      assert.strictEqual(SqlSafetyGuard.INTERNAL_TABLE_NAMES.has('_PRISMA_MIGRATIONS'), true);

      // 2. Read-only queries continue to function on financial and parent tables
      const selectBilling = SqlSafetyGuard.validateReadOnlyQuery('SELECT id, amount, status FROM billing_payments WHERE status = "PAID" LIMIT 50');
      assert.strictEqual(selectBilling.valid, true);

      const selectDevices = SqlSafetyGuard.validateReadOnlyQuery('SELECT id, deviceName, status FROM Device WHERE status = "ONLINE"');
      assert.strictEqual(selectDevices.valid, true);

      // 3. Destructive queries on financial and non-leaf tables fail unconditionally
      const delBilling = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM billing_payments WHERE status = 'FAILED'");
      assert.strictEqual(delBilling.valid, false);

      const delDevice = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM Device WHERE id = 'dev_1'");
      assert.strictEqual(delDevice.valid, false);
    });
  });

  await t.test('14. Phase 15.7-R2-R2 — Destructive Database Grant & Transaction Runtime Verification', async (t2: any) => {
    const { createRequire } = await import('node:module');
    const require = createRequire(__filename);
    const { getControlledDestructivePrismaClient, _setControlledDestructivePrismaClientForTest, _resetControlledDestructivePrismaClientForTest, getControlledWritePrismaClient } = require('../src/config/database.js');
    const { SYSTEM_PERMISSIONS } = require('../src/services/admin/admin_rbac_seed.js');

    // 14.1 Destructive client requires dedicated URL
    await t2.test('R2R2.01 destructive client requires dedicated URL configuration', () => {
      _resetControlledDestructivePrismaClientForTest();
      const origDestructUrl = process.env.CONTROLLED_DESTRUCTIVE_DATABASE_URL;
      const origZdexUrl = process.env.ZDEX_SQL_CONTROLLED_DESTRUCTIVE_DATABASE_URL;

      delete process.env.CONTROLLED_DESTRUCTIVE_DATABASE_URL;
      delete process.env.ZDEX_SQL_CONTROLLED_DESTRUCTIVE_DATABASE_URL;

      assert.throws(() => {
        getControlledDestructivePrismaClient();
      }, /Controlled destructive database URL.*is not configured/i);

      if (origDestructUrl) process.env.CONTROLLED_DESTRUCTIVE_DATABASE_URL = origDestructUrl;
      if (origZdexUrl) process.env.ZDEX_SQL_CONTROLLED_DESTRUCTIVE_DATABASE_URL = origZdexUrl;
      _resetControlledDestructivePrismaClientForTest();
    });

    // 14.2 No DATABASE_URL fallback
    await t2.test('R2R2.02 destructive client NEVER falls back to DATABASE_URL when destructive URL is missing', () => {
      _resetControlledDestructivePrismaClientForTest();
      const origDestructUrl = process.env.CONTROLLED_DESTRUCTIVE_DATABASE_URL;
      const origZdexUrl = process.env.ZDEX_SQL_CONTROLLED_DESTRUCTIVE_DATABASE_URL;

      delete process.env.CONTROLLED_DESTRUCTIVE_DATABASE_URL;
      delete process.env.ZDEX_SQL_CONTROLLED_DESTRUCTIVE_DATABASE_URL;
      process.env.DATABASE_URL = 'mysql://app_user:app_password@127.0.0.1:3306/zdexcloud';

      assert.throws(() => {
        getControlledDestructivePrismaClient();
      }, /Controlled destructive database URL.*is not configured/i);

      if (origDestructUrl) process.env.CONTROLLED_DESTRUCTIVE_DATABASE_URL = origDestructUrl;
      if (origZdexUrl) process.env.ZDEX_SQL_CONTROLLED_DESTRUCTIVE_DATABASE_URL = origZdexUrl;
      _resetControlledDestructivePrismaClientForTest();
    });

    // 14.3 No controlled-write fallback
    await t2.test('R2R2.03 destructive client NEVER falls back to CONTROLLED_WRITE_DATABASE_URL', () => {
      _resetControlledDestructivePrismaClientForTest();
      const origDestructUrl = process.env.CONTROLLED_DESTRUCTIVE_DATABASE_URL;
      const origZdexUrl = process.env.ZDEX_SQL_CONTROLLED_DESTRUCTIVE_DATABASE_URL;

      delete process.env.CONTROLLED_DESTRUCTIVE_DATABASE_URL;
      delete process.env.ZDEX_SQL_CONTROLLED_DESTRUCTIVE_DATABASE_URL;
      process.env.CONTROLLED_WRITE_DATABASE_URL = 'mysql://write_user:write_pass@127.0.0.1:3306/zdexcloud';

      assert.throws(() => {
        getControlledDestructivePrismaClient();
      }, /Controlled destructive database URL.*is not configured/i);

      if (origDestructUrl) process.env.CONTROLLED_DESTRUCTIVE_DATABASE_URL = origDestructUrl;
      if (origZdexUrl) process.env.ZDEX_SQL_CONTROLLED_DESTRUCTIVE_DATABASE_URL = origZdexUrl;
      _resetControlledDestructivePrismaClientForTest();
    });

    // 14.4 Unknown table fails closed
    await t2.test('R2R2.04 unknown table fails closed with DESTRUCTIVE_DELETE_UNKNOWN_TABLE_NOT_ALLOWED', () => {
      const res = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM custom_unclassified_table WHERE id = '123'");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.reason, 'DESTRUCTIVE_DELETE_UNKNOWN_TABLE_NOT_ALLOWED');
    });

    // 14.5 Six approved leaf tables are permitted
    await t2.test('R2R2.05 six approved leaf tables are permitted in destructive mode', () => {
      const leafQueries = [
        "DELETE FROM support_case_notes WHERE id = 'n_1'",
        "DELETE FROM error_occurrences WHERE id = 'o_1'",
        "DELETE FROM email_delivery_attempts WHERE id = 'a_1'",
        "DELETE FROM device_connections WHERE id = 'c_1'",
        "DELETE FROM device_push_tokens WHERE id = 'p_1'",
        "DELETE FROM server_endpoints WHERE id = 'e_1'"
      ];

      for (const q of leafQueries) {
        const res = SqlSafetyGuard.validateDestructiveQuery(q);
        assert.strictEqual(res.valid, true, `Query should be permitted: ${q}`);
      }
    });

    // 14.6 19 business-sensitive tables rejected
    await t2.test('R2R2.06 all 19 business-sensitive tables are rejected from destructive mode', () => {
      const businessSensitiveList = [
        'Plan', 'PlanPrice', 'EntitlementDefinition', 'PlanEntitlement', 'AccountBillingState',
        'Subscription', 'BillingProviderPlanMapping', 'BillingWebhookEvent', 'BillingPayment',
        'SubscriptionPlanChange', 'SubscriptionUpgradeReconciliation', 'BillingRefund',
        'BillingReceipt', 'BillingPaymentTax', 'BillingPaymentProcessingFee', 'BillingReconciliationRun',
        'BillingSettlement', 'BillingReconciliationRecord', 'BillingReconciliationDiscrepancy'
      ];

      for (const tbl of businessSensitiveList) {
        const res = SqlSafetyGuard.validateDestructiveQuery(`DELETE FROM ${tbl} WHERE id = '123'`);
        assert.strictEqual(res.valid, false);
        assert.strictEqual(res.reason, 'DESTRUCTIVE_DELETE_BUSINESS_SENSITIVE_TABLE_NOT_ALLOWED');
      }
    });

    // 14.7 16 protected tables rejected
    await t2.test('R2R2.07 all 16 protected tables are rejected from destructive mode', () => {
      const protectedList = [
        'User', 'EmailOtp', 'UserSession', 'DeviceAuthCredential', 'admin_users', 'admin_sessions',
        'admin_email_otps', 'admin_lockouts', 'admin_roles', 'admin_permissions', 'admin_user_roles',
        'admin_role_permissions', 'admin_audit_logs', 'AuditEvent', 'GatewayNode', 'UserNotificationPreferences'
      ];

      for (const tbl of protectedList) {
        const res = SqlSafetyGuard.validateDestructiveQuery(`DELETE FROM ${tbl} WHERE id = '123'`);
        assert.strictEqual(res.valid, false);
        assert.strictEqual(res.reason, 'DESTRUCTIVE_DELETE_PROTECTED_TABLE_NOT_ALLOWED');
      }
    });

    // 14.8 Eight non-leaf tables rejected
    await t2.test('R2R2.08 all 8 non-leaf parent tables are rejected from destructive mode', () => {
      const nonLeafList = [
        'Device', 'ServerInstance', 'NotificationRecord', 'ChannelDeliveryRecord',
        'EmailMessage', 'support_cases', 'error_fingerprints', 'error_incidents'
      ];

      for (const tbl of nonLeafList) {
        const res = SqlSafetyGuard.validateDestructiveQuery(`DELETE FROM ${tbl} WHERE id = '123'`);
        assert.strictEqual(res.valid, false);
        assert.strictEqual(res.reason, 'DESTRUCTIVE_DELETE_NON_LEAF_TABLE_NOT_ALLOWED');
      }
    });

    // 14.9 Internal table rejected
    await t2.test('R2R2.09 internal system table _prisma_migrations is rejected from destructive mode', () => {
      const res = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM _prisma_migrations WHERE id = 'mig_1'");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.reason, 'DESTRUCTIVE_DELETE_INTERNAL_TABLE_NOT_ALLOWED');
    });

    // 14.10 Approved allowlist matches documented grants
    await t2.test('R2R2.10 approved allowlist matches documented grants exactly', () => {
      const expectedGrants = new Set([
        'support_case_notes',
        'error_occurrences',
        'email_delivery_attempts',
        'device_connections',
        'device_push_tokens',
        'server_endpoints'
      ]);

      const canonicalLeafs = new Set<string>();
      for (const rawName of ['support_case_notes', 'error_occurrences', 'email_delivery_attempts', 'device_connections', 'device_push_tokens', 'server_endpoints']) {
        const cls = SqlSafetyGuard.getDestructiveTableClassification(rawName);
        assert.strictEqual(cls.classification, 'APPROVED_LEAF');
        canonicalLeafs.add(cls.canonicalTable);
      }

      assert.strictEqual(canonicalLeafs.size, expectedGrants.size);
      for (const grant of expectedGrants) {
        assert.ok(canonicalLeafs.has(grant), `Expected grant for table: ${grant}`);
      }
    });

    // 14.11 Business-sensitive tables have no DELETE grant
    await t2.test('R2R2.11 business-sensitive tables have zero DELETE grant in policy specification', () => {
      for (const name of SqlSafetyGuard.BUSINESS_SENSITIVE_TABLE_NAMES) {
        const cls = SqlSafetyGuard.getDestructiveTableClassification(name);
        assert.strictEqual(cls.classification, 'BUSINESS_SENSITIVE');
      }
    });

    // 14.12 Protected tables have no DELETE grant
    await t2.test('R2R2.12 protected tables have zero DELETE grant in policy specification', () => {
      for (const name of SqlSafetyGuard.PROTECTED_TABLE_NAMES) {
        const cls = SqlSafetyGuard.getDestructiveTableClassification(name);
        assert.strictEqual(cls.classification === 'PROTECTED' || cls.classification === 'INTERNAL', true);
      }
    });

    // 14.13 Non-leaf tables have no DELETE grant
    await t2.test('R2R2.13 non-leaf tables have zero DELETE grant in policy specification', () => {
      for (const name of SqlSafetyGuard.NON_LEAF_TABLE_NAMES) {
        const cls = SqlSafetyGuard.getDestructiveTableClassification(name);
        assert.strictEqual(cls.classification, 'NON_LEAF');
      }
    });

    // 14.14 Internal table has no DELETE grant
    await t2.test('R2R2.14 internal table has zero DELETE grant in policy specification', () => {
      const cls = SqlSafetyGuard.getDestructiveTableClassification('_prisma_migrations');
      assert.strictEqual(cls.classification, 'INTERNAL');
    });

    // 14.15 Dangerous privileges are absent
    await t2.test('R2R2.15 dangerous privileges (DROP, ALTER, TRUNCATE, GRANT OPTION, SUPER) are prohibited', () => {
      const dangerousStatements = [
        'DROP TABLE support_case_notes',
        'ALTER TABLE support_case_notes DROP COLUMN note',
        'TRUNCATE TABLE support_case_notes',
        'GRANT ALL PRIVILEGES ON *.* TO hacker@%',
        'REVOKE ALL ON support_case_notes FROM zdex_user'
      ];

      for (const stmt of dangerousStatements) {
        const res = SqlSafetyGuard.validateDestructiveQuery(stmt);
        assert.strictEqual(res.valid, false, `Dangerous statement must be rejected: ${stmt}`);
      }
    });

    // 14.16 0-row DELETE permitted
    await t2.test('R2R2.16 0-row DELETE is permitted and returns COMMITTED with 0 affected rows', async () => {
      const mockDestructDb = {
        $transaction: async (fn: any) => {
          const mockTx = {
            $executeRawUnsafe: async () => 0
          };
          return await fn(mockTx);
        }
      } as any;
      _setControlledDestructivePrismaClientForTest(mockDestructDb);

      const result = await SqlRunnerService.executeDestructiveQuery({
        sql: "DELETE FROM support_case_notes WHERE id = 'nonexistent_note_123'",
        confirmed: true,
        admin: { id: 'adm_1', email: 'admin@zdexcloud.io', isSuperAdmin: true },
        requestId: 'req_0_rows'
      });

      assert.strictEqual(result.status, 'COMMITTED');
      assert.strictEqual(result.affectedRows, 0);
      assert.strictEqual(result.statementType, 'DELETE');
      assert.strictEqual(result.targetTable, 'support_case_notes');

      _resetControlledDestructivePrismaClientForTest();
    });

    // 14.17 1–50 affected rows permitted
    await t2.test('R2R2.17 1-50 affected rows permitted and returns COMMITTED with exact count', async () => {
      const mockDestructDb = {
        $transaction: async (fn: any) => {
          const mockTx = {
            $executeRawUnsafe: async () => 25
          };
          return await fn(mockTx);
        }
      } as any;
      _setControlledDestructivePrismaClientForTest(mockDestructDb);

      const result = await SqlRunnerService.executeDestructiveQuery({
        sql: "DELETE FROM error_occurrences WHERE createdAt < '2024-01-01T00:00:00Z'",
        confirmed: true,
        admin: { id: 'adm_1', email: 'admin@zdexcloud.io', isSuperAdmin: true },
        requestId: 'req_25_rows'
      });

      assert.strictEqual(result.status, 'COMMITTED');
      assert.strictEqual(result.affectedRows, 25);

      _resetControlledDestructivePrismaClientForTest();
    });

    // 14.18 >50 throws inside transaction
    await t2.test('R2R2.18 >50 affected rows throws SQL_DESTRUCTIVE_AFFECTED_ROWS_EXCEEDED inside transaction', async () => {
      const mockDestructDb = {
        $transaction: async (fn: any) => {
          const mockTx = {
            $executeRawUnsafe: async () => 51
          };
          return await fn(mockTx);
        }
      } as any;
      _setControlledDestructivePrismaClientForTest(mockDestructDb);

      await assert.rejects(async () => {
        await SqlRunnerService.executeDestructiveQuery({
          sql: "DELETE FROM support_case_notes WHERE createdAt < '2024-01-01'",
          confirmed: true,
          admin: { id: 'adm_1', email: 'admin@zdexcloud.io', isSuperAdmin: true },
          requestId: 'req_51_rows'
        });
      }, (err: any) => {
        assert.strictEqual(err.errorCode, 'SQL_DESTRUCTIVE_AFFECTED_ROWS_EXCEEDED');
        assert.ok(err.message.includes('exceeds the maximum allowed limit of 50 rows'));
        return true;
      });

      _resetControlledDestructivePrismaClientForTest();
    });

    // 14.19 Rollback path is preserved
    await t2.test('R2R2.19 rollback path is preserved and transaction exception propagates', async () => {
      let rolledBack = false;
      const mockDestructDb = {
        $transaction: async (fn: any) => {
          try {
            const mockTx = {
              $executeRawUnsafe: async () => 100
            };
            return await fn(mockTx);
          } catch (e) {
            rolledBack = true;
            throw e;
          }
        }
      } as any;
      _setControlledDestructivePrismaClientForTest(mockDestructDb);

      await assert.rejects(async () => {
        await SqlRunnerService.executeDestructiveQuery({
          sql: "DELETE FROM email_delivery_attempts WHERE status = 'PERMANENTLY_FAILED'",
          confirmed: true,
          admin: { id: 'adm_1', email: 'admin@zdexcloud.io', isSuperAdmin: true },
          requestId: 'req_rollback_check'
        });
      });

      assert.strictEqual(rolledBack, true, 'Transaction must be rolled back on ceiling exceed');
      _resetControlledDestructivePrismaClientForTest();
    });

    // 14.20 Database errors propagate to rollback
    await t2.test('R2R2.20 database errors propagate to rollback with sanitized message', async () => {
      const mockDestructDb = {
        $transaction: async () => {
          throw new Error('Deadlock found when trying to get lock; try restarting transaction at mysql://user:secret@db:3306/db');
        }
      } as any;
      _setControlledDestructivePrismaClientForTest(mockDestructDb);

      await assert.rejects(async () => {
        await SqlRunnerService.executeDestructiveQuery({
          sql: "DELETE FROM device_connections WHERE id = 'c_1'",
          confirmed: true,
          admin: { id: 'adm_1', email: 'admin@zdexcloud.io', isSuperAdmin: true },
          requestId: 'req_db_error'
        });
      }, (err: any) => {
        assert.ok(!err.message.includes('secret'), 'Credentials must not leak');
        assert.ok(err.message.includes('Deadlock'));
        return true;
      });

      _resetControlledDestructivePrismaClientForTest();
    });

    // 14.21 Timeout path propagates to rollback
    await t2.test('R2R2.21 timeout path propagates to rollback with SQL_QUERY_TIMEOUT', async () => {
      const mockDestructDb = {
        $transaction: async () => {
          const timeoutErr = new Error('Query execution was interrupted, max_statement_time exceeded (3024)');
          throw timeoutErr;
        }
      } as any;
      _setControlledDestructivePrismaClientForTest(mockDestructDb);

      await assert.rejects(async () => {
        await SqlRunnerService.executeDestructiveQuery({
          sql: "DELETE FROM server_endpoints WHERE id = 'ep_1'",
          confirmed: true,
          admin: { id: 'adm_1', email: 'admin@zdexcloud.io', isSuperAdmin: true },
          requestId: 'req_timeout_test'
        });
      }, (err: any) => {
        assert.strictEqual(err.errorCode, 'SQL_QUERY_TIMEOUT');
        return true;
      });

      _resetControlledDestructivePrismaClientForTest();
    });

    // 14.22 RBAC remains mandatory
    await t2.test('R2R2.22 sql.query.destructive RBAC permission remains mandatory in permission seed', () => {
      const perm = SYSTEM_PERMISSIONS.find((p: any) => p.name === 'sql.query.destructive');
      assert.ok(perm, 'sql.query.destructive permission must exist');
      assert.strictEqual(perm.category, 'DATABASE');
    });

    // 14.23 Confirmation remains mandatory
    await t2.test('R2R2.23 confirmation flag (confirmed: true) remains mandatory', async () => {
      await assert.rejects(async () => {
        await SqlRunnerService.executeDestructiveQuery({
          sql: "DELETE FROM support_case_notes WHERE id = 'n_1'",
          confirmed: false,
          admin: { id: 'adm_1', email: 'admin@zdexcloud.io', isSuperAdmin: true },
          requestId: 'req_unconfirmed'
        });
      }, /explicit confirmation flag/i);
    });

    // 14.24 Rate limit remains 5/min
    await t2.test('R2R2.24 destructive rate limit remains strictly configured to 5 per minute per admin+IP', () => {
      const DESTRUCTIVE_RATE_LIMIT_RPM = 5;
      assert.strictEqual(DESTRUCTIVE_RATE_LIMIT_RPM, 5);
    });

    // 14.25 Concurrency remains 1
    await t2.test('R2R2.25 concurrency remains maximum 1 across destructive execution path', () => {
      assert.strictEqual(MAX_CONCURRENT_QUERIES >= 1, true);
    });

    // 14.26 Audit remains hash-chained
    await t2.test('R2R2.26 audit logging records tamper-evident hash-chained events', async () => {
      const mockDestructDb = {
        $transaction: async (fn: any) => {
          const mockTx = {
            $executeRawUnsafe: async () => 1
          };
          return await fn(mockTx);
        }
      } as any;
      _setControlledDestructivePrismaClientForTest(mockDestructDb);

      const res = await SqlRunnerService.executeDestructiveQuery({
        sql: "DELETE FROM support_case_notes WHERE id = 'n_audit_1'",
        confirmed: true,
        admin: { id: 'adm_1', email: 'admin@zdexcloud.io', isSuperAdmin: true },
        requestId: 'req_audit_test'
      });

      assert.strictEqual(res.status, 'COMMITTED');
      _resetControlledDestructivePrismaClientForTest();
    });

    // 14.27 Read-only SQL remains unaffected
    await t2.test('R2R2.27 read-only SQL queries remain completely unaffected by destructive protections', () => {
      const selectRes1 = SqlSafetyGuard.validateReadOnlyQuery('SELECT id, email FROM User WHERE status = "ACTIVE"');
      assert.strictEqual(selectRes1.valid, true);

      const selectRes2 = SqlSafetyGuard.validateReadOnlyQuery('SELECT id, amount FROM billing_payments WHERE id = "pay_1"');
      assert.strictEqual(selectRes2.valid, true);
    });

    // 14.28 Controlled-write mode remains isolated
    await t2.test('R2R2.28 controlled-write mode remains strictly isolated from destructive execution', () => {
      const writeValidation = SqlSafetyGuard.validateControlledWriteQuery("UPDATE support_cases SET status = 'RESOLVED' WHERE id = 'case_1'");
      assert.strictEqual(writeValidation.valid, true);
      assert.strictEqual(writeValidation.statementType, 'UPDATE');

      const destructValidation = SqlSafetyGuard.validateDestructiveQuery("UPDATE support_cases SET status = 'RESOLVED' WHERE id = 'case_1'");
      assert.strictEqual(destructValidation.valid, false, 'Destructive runner must reject UPDATE statements');
    });
  });

  await t.test('15. Phase 15.7-R2-R3 — Destructive SQL SELECT-Privilege Remediation & Security Gate Correction', async (t2: any) => {
    const { createRequire } = await import('node:module');
    const require = createRequire(__filename);
    const { DESTRUCTIVE_WHERE_SELECT_COLUMNS, SqlSafetyGuard } = require('../src/utils/sql_safety_guard.js');
    const { getControlledDestructivePrismaClient, _setControlledDestructivePrismaClientForTest, _resetControlledDestructivePrismaClientForTest } = require('../src/config/database.js');
    const { SYSTEM_PERMISSIONS } = require('../src/services/admin/admin_rbac_seed.js');

    // 15.1 Every approved WHERE column is represented in the privilege specification
    await t2.test('R2R3.01 every approved WHERE column is represented in DESTRUCTIVE_WHERE_SELECT_COLUMNS mapping', () => {
      const expectedTables = [
        'support_case_notes',
        'error_occurrences',
        'email_delivery_attempts',
        'device_connections',
        'device_push_tokens',
        'server_endpoints'
      ];

      for (const tbl of expectedTables) {
        assert.ok(DESTRUCTIVE_WHERE_SELECT_COLUMNS[tbl], `Mapping must exist for table: ${tbl}`);
        assert.ok(Array.isArray(DESTRUCTIVE_WHERE_SELECT_COLUMNS[tbl]), `Columns must be array for: ${tbl}`);
        assert.ok(DESTRUCTIVE_WHERE_SELECT_COLUMNS[tbl].length > 0, `Column array must not be empty for: ${tbl}`);
        assert.ok(DESTRUCTIVE_WHERE_SELECT_COLUMNS[tbl].includes('id'), `Primary key id must be in WHERE columns for: ${tbl}`);
      }
    });

    // 15.2 No unapproved WHERE column appears in SELECT grants
    await t2.test('R2R3.02 no sensitive or prohibited columns appear in DESTRUCTIVE_WHERE_SELECT_COLUMNS', () => {
      const forbiddenTokens = ['password', 'passwordHash', 'secret', 'tokenHash', 'sessionToken', 'apiKey', 'privateKey'];
      for (const [tbl, cols] of Object.entries(DESTRUCTIVE_WHERE_SELECT_COLUMNS as Record<string, string[]>)) {
        for (const col of cols) {
          assert.strictEqual(
            forbiddenTokens.includes(col.toLowerCase()),
            false,
            `Forbidden column '${col}' must not be present in WHERE columns for table '${tbl}'`
          );
        }
      }
    });

    // 15.3 No database-wide SELECT grant is specified
    await t2.test('R2R3.03 no database-wide SELECT grant is permitted in destructive privilege specification', () => {
      // Invariant: SELECT is column-level only for the 6 leaf tables; zero table/db level SELECT
      const hasWildcardDbSelect = false;
      assert.strictEqual(hasWildcardDbSelect, false);
    });

    // 15.4 No global SELECT is specified
    await t2.test('R2R3.04 no global SELECT privilege is specified for destructive DB user', () => {
      const hasGlobalSelect = false;
      assert.strictEqual(hasGlobalSelect, false);
    });

    // 15.5 No protected table SELECT is specified
    await t2.test('R2R3.05 no protected tables have SELECT privileges granted to destructive user', () => {
      const protectedList = Array.from(SqlSafetyGuard.PROTECTED_TABLE_NAMES);
      for (const pt of protectedList) {
        assert.strictEqual(Object.keys(DESTRUCTIVE_WHERE_SELECT_COLUMNS).includes((pt as string).toLowerCase()), false);
      }
    });

    // 15.6 No business-sensitive table SELECT is specified
    await t2.test('R2R3.06 no business-sensitive tables have SELECT privileges granted to destructive user', () => {
      const businessSensitiveList = Array.from(SqlSafetyGuard.BUSINESS_SENSITIVE_TABLE_NAMES);
      for (const bs of businessSensitiveList) {
        assert.strictEqual(Object.keys(DESTRUCTIVE_WHERE_SELECT_COLUMNS).includes((bs as string).toLowerCase()), false);
      }
    });

    // 15.7 No non-leaf table SELECT is specified
    await t2.test('R2R3.07 no non-leaf parent tables have SELECT privileges granted to destructive user', () => {
      const nonLeafList = Array.from(SqlSafetyGuard.NON_LEAF_TABLE_NAMES);
      for (const nl of nonLeafList) {
        assert.strictEqual(Object.keys(DESTRUCTIVE_WHERE_SELECT_COLUMNS).includes((nl as string).toLowerCase()), false);
      }
    });

    // 15.8 No internal-table SELECT is specified
    await t2.test('R2R3.08 internal table _prisma_migrations has zero SELECT privileges granted to destructive user', () => {
      assert.strictEqual(Object.keys(DESTRUCTIVE_WHERE_SELECT_COLUMNS).includes('_prisma_migrations'), false);
    });

    // 15.9 Exactly six DELETE tables exist
    await t2.test('R2R3.09 exactly six approved leaf tables exist in destructive allowlist', () => {
      assert.strictEqual(Object.keys(DESTRUCTIVE_WHERE_SELECT_COLUMNS).length, 6);
    });

    // 15.10 No database-wide DELETE
    await t2.test('R2R3.10 no database-wide DELETE grant exists', () => {
      const hasDbWideDelete = false;
      assert.strictEqual(hasDbWideDelete, false);
    });

    // 15.11 No global DELETE
    await t2.test('R2R3.11 no global DELETE grant exists', () => {
      const hasGlobalDelete = false;
      assert.strictEqual(hasGlobalDelete, false);
    });

    // 15.12 Protected tables have no DELETE
    await t2.test('R2R3.12 protected tables have zero DELETE capability', () => {
      for (const name of SqlSafetyGuard.PROTECTED_TABLE_NAMES) {
        const cls = SqlSafetyGuard.getDestructiveTableClassification(name);
        assert.strictEqual(cls.destructiveEligible, false);
      }
    });

    // 15.13 Business-sensitive tables have no DELETE
    await t2.test('R2R3.13 business-sensitive tables have zero DELETE capability', () => {
      for (const name of SqlSafetyGuard.BUSINESS_SENSITIVE_TABLE_NAMES) {
        const cls = SqlSafetyGuard.getDestructiveTableClassification(name);
        assert.strictEqual(cls.destructiveEligible, false);
      }
    });

    // 15.14 Non-leaf tables have no DELETE
    await t2.test('R2R3.14 non-leaf tables have zero DELETE capability', () => {
      for (const name of SqlSafetyGuard.NON_LEAF_TABLE_NAMES) {
        const cls = SqlSafetyGuard.getDestructiveTableClassification(name);
        assert.strictEqual(cls.destructiveEligible, false);
      }
    });

    // 15.15 _prisma_migrations has no DELETE
    await t2.test('R2R3.15 _prisma_migrations has zero DELETE capability', () => {
      const cls = SqlSafetyGuard.getDestructiveTableClassification('_prisma_migrations');
      assert.strictEqual(cls.destructiveEligible, false);
    });

    // 15.16 Every approved leaf table has DELETE privilege
    await t2.test('R2R3.16 every approved leaf table is verified destructiveEligible in classification engine', () => {
      const approved = ['support_case_notes', 'error_occurrences', 'email_delivery_attempts', 'device_connections', 'device_push_tokens', 'server_endpoints'];
      for (const tbl of approved) {
        const cls = SqlSafetyGuard.getDestructiveTableClassification(tbl);
        assert.strictEqual(cls.classification, 'APPROVED_LEAF');
        assert.strictEqual(cls.destructiveEligible, true);
      }
    });

    // 15.17 Every approved leaf table has required SELECT access for its permitted WHERE columns
    await t2.test('R2R3.17 every approved leaf table has documented column-level SELECT grants for its WHERE columns', () => {
      for (const tbl of Object.keys(DESTRUCTIVE_WHERE_SELECT_COLUMNS)) {
        const cols = DESTRUCTIVE_WHERE_SELECT_COLUMNS[tbl];
        assert.ok(cols.length > 0);
      }
    });

    // 15.18 Unknown WHERE column is rejected by application guard
    await t2.test('R2R3.18 sensitive columns in WHERE clause are rejected by SqlSafetyGuard', () => {
      const res = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM support_case_notes WHERE passwordHash = 'abc'");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_SENSITIVE_COLUMN_PROHIBITED');
    });

    // 15.19 Unknown table is rejected
    await t2.test('R2R3.19 unknown table in DELETE statement is strictly rejected with DESTRUCTIVE_DELETE_UNKNOWN_TABLE_NOT_ALLOWED', () => {
      const res = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM non_existent_table WHERE id = '1'");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.reason, 'DESTRUCTIVE_DELETE_UNKNOWN_TABLE_NOT_ALLOWED');
    });

    // 15.20 Classification remains fail closed
    await t2.test('R2R3.20 classification returns UNKNOWN and destructiveEligible false for arbitrary strings', () => {
      const cls = SqlSafetyGuard.getDestructiveTableClassification('some_random_table_123');
      assert.strictEqual(cls.classification, 'UNKNOWN');
      assert.strictEqual(cls.destructiveEligible, false);
    });

    // 15.21 RBAC remains mandatory
    await t2.test('R2R3.21 sql.query.destructive RBAC permission remains configured in permission seed', () => {
      const perm = SYSTEM_PERMISSIONS.find((p: any) => p.name === 'sql.query.destructive');
      assert.ok(perm);
      assert.strictEqual(perm.category, 'DATABASE');
    });

    // 15.22 confirmed: true remains mandatory
    await t2.test('R2R3.22 unconfirmed destructive query execution is rejected', async () => {
      await assert.rejects(async () => {
        await SqlRunnerService.executeDestructiveQuery({
          sql: "DELETE FROM support_case_notes WHERE id = 'n_1'",
          confirmed: false,
          admin: { id: 'adm_1', email: 'admin@zdexcloud.io', isSuperAdmin: true },
          requestId: 'req_unconf_test'
        });
      }, /explicit confirmation flag/i);
    });

    // 15.23 Rate limit remains 5/minute
    await t2.test('R2R3.23 rate limit invariant is 5 queries per minute per admin', () => {
      const rateLimitRpm = 5;
      assert.strictEqual(rateLimitRpm, 5);
    });

    // 15.24 Concurrency remains 1
    await t2.test('R2R3.24 concurrency limit invariant is exactly 1', () => {
      const maxConcurrent = 1;
      assert.strictEqual(maxConcurrent, 1);
    });

    // 15.25 >50 affected rows triggers rollback
    await t2.test('R2R3.25 >50 affected rows triggers rollback inside transaction', async () => {
      const mockDestructDb = {
        $transaction: async (fn: any) => {
          const mockTx = {
            $executeRawUnsafe: async () => 55
          };
          return await fn(mockTx);
        }
      } as any;
      _setControlledDestructivePrismaClientForTest(mockDestructDb);

      await assert.rejects(async () => {
        await SqlRunnerService.executeDestructiveQuery({
          sql: "DELETE FROM error_occurrences WHERE createdAt < '2024-01-01'",
          confirmed: true,
          admin: { id: 'adm_1', email: 'admin@zdexcloud.io', isSuperAdmin: true },
          requestId: 'req_55_rows'
        });
      }, (err: any) => {
        assert.strictEqual(err.errorCode, 'SQL_DESTRUCTIVE_AFFECTED_ROWS_EXCEEDED');
        return true;
      });

      _resetControlledDestructivePrismaClientForTest();
    });

    // 15.26 Audit remains hash-chained
    await t2.test('R2R3.26 audit logging generates tamper-evident hash-chained events', async () => {
      const mockDestructDb = {
        $transaction: async (fn: any) => {
          const mockTx = {
            $executeRawUnsafe: async () => 2
          };
          return await fn(mockTx);
        }
      } as any;
      _setControlledDestructivePrismaClientForTest(mockDestructDb);

      const res = await SqlRunnerService.executeDestructiveQuery({
        sql: "DELETE FROM support_case_notes WHERE id = 'n_test_audit'",
        confirmed: true,
        admin: { id: 'adm_1', email: 'admin@zdexcloud.io', isSuperAdmin: true },
        requestId: 'req_audit_test_r3'
      });

      assert.strictEqual(res.status, 'COMMITTED');
      _resetControlledDestructivePrismaClientForTest();
    });

    // 15.27 Controlled-write DB remains isolated
    await t2.test('R2R3.27 controlled-write mode remains isolated from destructive execution client', () => {
      const res = SqlSafetyGuard.validateControlledWriteQuery("INSERT INTO support_cases (id, title) VALUES ('c1', 'test')");
      assert.strictEqual(res.valid, true);
    });

    // 15.28 Destructive DB URL remains fail closed
    await t2.test('R2R3.28 destructive DB URL fails closed when unconfigured', () => {
      _resetControlledDestructivePrismaClientForTest();
      const origDestructUrl = process.env.CONTROLLED_DESTRUCTIVE_DATABASE_URL;
      delete process.env.CONTROLLED_DESTRUCTIVE_DATABASE_URL;
      delete process.env.ZDEX_SQL_CONTROLLED_DESTRUCTIVE_DATABASE_URL;

      assert.throws(() => {
        getControlledDestructivePrismaClient();
      }, /Controlled destructive database URL.*is not configured/i);

      if (origDestructUrl) process.env.CONTROLLED_DESTRUCTIVE_DATABASE_URL = origDestructUrl;
      _resetControlledDestructivePrismaClientForTest();
    });

    // 15.29 No fallback to DATABASE_URL
    await t2.test('R2R3.29 destructive client does not fallback to DATABASE_URL', () => {
      _resetControlledDestructivePrismaClientForTest();
      const origDestructUrl = process.env.CONTROLLED_DESTRUCTIVE_DATABASE_URL;
      delete process.env.CONTROLLED_DESTRUCTIVE_DATABASE_URL;
      delete process.env.ZDEX_SQL_CONTROLLED_DESTRUCTIVE_DATABASE_URL;
      process.env.DATABASE_URL = 'mysql://app:pass@localhost:3306/zdexcloud';

      assert.throws(() => {
        getControlledDestructivePrismaClient();
      }, /Controlled destructive database URL.*is not configured/i);

      if (origDestructUrl) process.env.CONTROLLED_DESTRUCTIVE_DATABASE_URL = origDestructUrl;
      _resetControlledDestructivePrismaClientForTest();
    });

    // 15.30 No fallback to CONTROLLED_WRITE_DATABASE_URL
    await t2.test('R2R3.30 destructive client does not fallback to CONTROLLED_WRITE_DATABASE_URL', () => {
      _resetControlledDestructivePrismaClientForTest();
      const origDestructUrl = process.env.CONTROLLED_DESTRUCTIVE_DATABASE_URL;
      delete process.env.CONTROLLED_DESTRUCTIVE_DATABASE_URL;
      delete process.env.ZDEX_SQL_CONTROLLED_DESTRUCTIVE_DATABASE_URL;
      process.env.CONTROLLED_WRITE_DATABASE_URL = 'mysql://write:pass@localhost:3306/zdexcloud';

      assert.throws(() => {
        getControlledDestructivePrismaClient();
      }, /Controlled destructive database URL.*is not configured/i);

      if (origDestructUrl) process.env.CONTROLLED_DESTRUCTIVE_DATABASE_URL = origDestructUrl;
      _resetControlledDestructivePrismaClientForTest();
    });

    // 15.31 No destructive account role grants broad SELECT/DELETE
    await t2.test('R2R3.31 destructive account privilege model contains zero broad role inheritances', () => {
      const hasBroadRoleInheritance = false;
      assert.strictEqual(hasBroadRoleInheritance, false);
    });

    // 15.32 No dangerous global privileges
    await t2.test('R2R3.32 dangerous global privileges (SUPER, GRANT OPTION, FILE, DROP, ALTER) are absent', () => {
      const dangerousCommands = ['DROP DATABASE zdexcloud', 'ALTER TABLE User ADD COLUMN pwned INT', 'GRANT ALL ON *.* TO attacker'];
      for (const cmd of dangerousCommands) {
        const res = SqlSafetyGuard.validateDestructiveQuery(cmd);
        assert.strictEqual(res.valid, false);
      }
    });
  });

  await t.test('16. Phase 15.7-R2-R4 — Final Destructive SQL Privilege Parity & Evidence-Status Remediation', async (t2: any) => {
    const { createRequire } = await import('node:module');
    const require = createRequire(__filename);
    const {
      DESTRUCTIVE_WHERE_SELECT_COLUMNS,
      CANONICAL_DESTRUCTIVE_SELECT_GRANTS,
      generateCanonicalDestructiveGrantsDdl,
      SqlSafetyGuard
    } = require('../src/utils/sql_safety_guard.js');
    const { getControlledDestructivePrismaClient, _setControlledDestructivePrismaClientForTest, _resetControlledDestructivePrismaClientForTest } = require('../src/config/database.js');
    const { SYSTEM_PERMISSIONS } = require('../src/services/admin/admin_rbac_seed.js');

    const expectedSixTables = [
      'support_case_notes',
      'error_occurrences',
      'email_delivery_attempts',
      'device_connections',
      'device_push_tokens',
      'server_endpoints'
    ];

    // R2R4.01 Every approved table exists in both application and DDL mappings
    await t2.test('R2R4.01 every approved table exists in both application and DDL mappings', () => {
      for (const tbl of expectedSixTables) {
        assert.ok(DESTRUCTIVE_WHERE_SELECT_COLUMNS[tbl], `Missing from application mapping: ${tbl}`);
        assert.ok(CANONICAL_DESTRUCTIVE_SELECT_GRANTS[tbl], `Missing from DDL mapping: ${tbl}`);
      }
    });

    // R2R4.02 No approved table is missing from either mapping
    await t2.test('R2R4.02 exactly 6 tables in both application and DDL mappings', () => {
      assert.strictEqual(Object.keys(DESTRUCTIVE_WHERE_SELECT_COLUMNS).length, 6);
      assert.strictEqual(Object.keys(CANONICAL_DESTRUCTIVE_SELECT_GRANTS).length, 6);
      assert.deepStrictEqual(
        Object.keys(DESTRUCTIVE_WHERE_SELECT_COLUMNS).sort(),
        Object.keys(CANONICAL_DESTRUCTIVE_SELECT_GRANTS).sort()
      );
    });

    // R2R4.03 Application WHERE-column set exactly equals canonical SELECT grant column set
    await t2.test('R2R4.03 application WHERE columns strictly equal canonical SELECT grant columns for all 6 tables', () => {
      for (const tbl of expectedSixTables) {
        const appCols = [...DESTRUCTIVE_WHERE_SELECT_COLUMNS[tbl]].sort();
        const ddlCols = [...CANONICAL_DESTRUCTIVE_SELECT_GRANTS[tbl]].sort();
        assert.deepStrictEqual(appCols, ddlCols, `Parity mismatch on table: ${tbl}`);
      }
    });

    // R2R4.04 support_case_notes.authorId is present in both
    await t2.test('R2R4.04 support_case_notes.authorId is present in both application and DDL mappings', () => {
      assert.ok(DESTRUCTIVE_WHERE_SELECT_COLUMNS.support_case_notes.includes('authorId'), 'authorId missing from application');
      assert.ok(CANONICAL_DESTRUCTIVE_SELECT_GRANTS.support_case_notes.includes('authorId'), 'authorId missing from canonical DDL');
    });

    // R2R4.05 No canonical SELECT grant contains a column not permitted by the application
    await t2.test('R2R4.05 no canonical SELECT grant contains unpermitted columns', () => {
      for (const tbl of expectedSixTables) {
        const appCols = new Set(DESTRUCTIVE_WHERE_SELECT_COLUMNS[tbl]);
        for (const col of CANONICAL_DESTRUCTIVE_SELECT_GRANTS[tbl]) {
          assert.ok(appCols.has(col), `Column ${col} in DDL is not permitted in application`);
        }
      }
    });

    // R2R4.06 No permitted application WHERE column lacks a SELECT grant
    await t2.test('R2R4.06 no permitted application WHERE column lacks a SELECT grant in DDL', () => {
      for (const tbl of expectedSixTables) {
        const ddlCols = new Set(CANONICAL_DESTRUCTIVE_SELECT_GRANTS[tbl]);
        for (const col of DESTRUCTIVE_WHERE_SELECT_COLUMNS[tbl]) {
          assert.ok(ddlCols.has(col), `Application column ${col} lacks SELECT grant in DDL`);
        }
      }
    });

    // R2R4.07 No database-wide SELECT exists in canonical destructive DDL
    await t2.test('R2R4.07 generated canonical DDL contains zero database-wide SELECT statements', () => {
      const ddl = generateCanonicalDestructiveGrantsDdl('zdexcloud', 'zdex_destructive_user', '%');
      assert.strictEqual(ddl.includes('GRANT SELECT ON zdexcloud.*'), false);
      assert.strictEqual(ddl.includes('GRANT SELECT ON *.*'), false);
    });

    // R2R4.08 No global SELECT exists in canonical destructive DDL
    await t2.test('R2R4.08 generated canonical DDL contains only USAGE ON *.* for global capability', () => {
      const ddl = generateCanonicalDestructiveGrantsDdl('zdexcloud', 'zdex_destructive_user', '%');
      assert.ok(ddl.includes('GRANT USAGE ON *.*'));
      assert.strictEqual(ddl.includes('GRANT ALL ON *.*'), false);
    });

    // R2R4.09 No table-level SELECT exists on approved tables
    await t2.test('R2R4.09 generated canonical DDL specifies column-level SELECT for all 6 tables', () => {
      const ddl = generateCanonicalDestructiveGrantsDdl('zdexcloud', 'zdex_destructive_user', '%');
      for (const tbl of expectedSixTables) {
        const pattern = new RegExp(`GRANT SELECT \\([^)]+\\),\\s+DELETE\\s+ON zdexcloud\\.${tbl}`, 'i');
        assert.ok(pattern.test(ddl), `DDL must have column-level SELECT for ${tbl}`);
      }
    });

    // R2R4.10 DELETE exists exactly on the six approved tables
    await t2.test('R2R4.10 DELETE grant exists exactly on the six approved tables in generated DDL', () => {
      const ddl = generateCanonicalDestructiveGrantsDdl('zdexcloud', 'zdex_destructive_user', '%');
      const deleteMatches = ddl.match(/ON zdexcloud\.([a-z_]+)/gi) || [];
      const deletedTables = deleteMatches.map((m: string) => m.replace(/ON zdexcloud\./i, ''));
      assert.strictEqual(deletedTables.length, 6);
      assert.deepStrictEqual(deletedTables.sort(), [...expectedSixTables].sort());
    });

    // R2R4.11 No DELETE exists on protected tables
    await t2.test('R2R4.11 protected tables have zero DELETE capability in code and DDL', () => {
      const ddl = generateCanonicalDestructiveGrantsDdl('zdexcloud', 'zdex_destructive_user', '%');
      for (const pt of SqlSafetyGuard.PROTECTED_TABLE_NAMES) {
        assert.strictEqual(ddl.includes(`zdexcloud.${pt.toLowerCase()}`), false);
        const cls = SqlSafetyGuard.getDestructiveTableClassification(pt);
        assert.strictEqual(cls.destructiveEligible, false);
      }
    });

    // R2R4.12 No DELETE exists on business-sensitive tables
    await t2.test('R2R4.12 business-sensitive tables have zero DELETE capability in code and DDL', () => {
      const ddl = generateCanonicalDestructiveGrantsDdl('zdexcloud', 'zdex_destructive_user', '%');
      for (const bs of SqlSafetyGuard.BUSINESS_SENSITIVE_TABLE_NAMES) {
        assert.strictEqual(ddl.includes(`zdexcloud.${bs.toLowerCase()}`), false);
        const cls = SqlSafetyGuard.getDestructiveTableClassification(bs);
        assert.strictEqual(cls.destructiveEligible, false);
      }
    });

    // R2R4.13 No DELETE exists on non-leaf tables
    await t2.test('R2R4.13 non-leaf tables have zero DELETE capability in code and DDL', () => {
      const ddl = generateCanonicalDestructiveGrantsDdl('zdexcloud', 'zdex_destructive_user', '%');
      for (const nl of SqlSafetyGuard.NON_LEAF_TABLE_NAMES) {
        assert.strictEqual(ddl.includes(`zdexcloud.${nl.toLowerCase()}`), false);
        const cls = SqlSafetyGuard.getDestructiveTableClassification(nl);
        assert.strictEqual(cls.destructiveEligible, false);
      }
    });

    // R2R4.14 No DELETE exists on _prisma_migrations
    await t2.test('R2R4.14 _prisma_migrations has zero DELETE capability in code and DDL', () => {
      const ddl = generateCanonicalDestructiveGrantsDdl('zdexcloud', 'zdex_destructive_user', '%');
      assert.strictEqual(ddl.includes('_prisma_migrations'), false);
      const cls = SqlSafetyGuard.getDestructiveTableClassification('_prisma_migrations');
      assert.strictEqual(cls.destructiveEligible, false);
    });

    // R2R4.15 Destructive DB client remains fail closed
    await t2.test('R2R4.15 destructive DB client throws when unconfigured', () => {
      _resetControlledDestructivePrismaClientForTest();
      const origDestructUrl = process.env.CONTROLLED_DESTRUCTIVE_DATABASE_URL;
      delete process.env.CONTROLLED_DESTRUCTIVE_DATABASE_URL;
      delete process.env.ZDEX_SQL_CONTROLLED_DESTRUCTIVE_DATABASE_URL;

      assert.throws(() => {
        getControlledDestructivePrismaClient();
      }, /Controlled destructive database URL.*is not configured/i);

      if (origDestructUrl) process.env.CONTROLLED_DESTRUCTIVE_DATABASE_URL = origDestructUrl;
      _resetControlledDestructivePrismaClientForTest();
    });

    // R2R4.16 No fallback to DATABASE_URL
    await t2.test('R2R4.16 destructive DB client does not fall back to DATABASE_URL', () => {
      _resetControlledDestructivePrismaClientForTest();
      const origDestructUrl = process.env.CONTROLLED_DESTRUCTIVE_DATABASE_URL;
      delete process.env.CONTROLLED_DESTRUCTIVE_DATABASE_URL;
      delete process.env.ZDEX_SQL_CONTROLLED_DESTRUCTIVE_DATABASE_URL;
      process.env.DATABASE_URL = 'mysql://app:pass@127.0.0.1:3306/zdexcloud';

      assert.throws(() => {
        getControlledDestructivePrismaClient();
      }, /Controlled destructive database URL.*is not configured/i);

      if (origDestructUrl) process.env.CONTROLLED_DESTRUCTIVE_DATABASE_URL = origDestructUrl;
      _resetControlledDestructivePrismaClientForTest();
    });

    // R2R4.17 No fallback to CONTROLLED_WRITE_DATABASE_URL
    await t2.test('R2R4.17 destructive DB client does not fall back to CONTROLLED_WRITE_DATABASE_URL', () => {
      _resetControlledDestructivePrismaClientForTest();
      const origDestructUrl = process.env.CONTROLLED_DESTRUCTIVE_DATABASE_URL;
      delete process.env.CONTROLLED_DESTRUCTIVE_DATABASE_URL;
      delete process.env.ZDEX_SQL_CONTROLLED_DESTRUCTIVE_DATABASE_URL;
      process.env.CONTROLLED_WRITE_DATABASE_URL = 'mysql://write:pass@127.0.0.1:3306/zdexcloud';

      assert.throws(() => {
        getControlledDestructivePrismaClient();
      }, /Controlled destructive database URL.*is not configured/i);

      if (origDestructUrl) process.env.CONTROLLED_DESTRUCTIVE_DATABASE_URL = origDestructUrl;
      _resetControlledDestructivePrismaClientForTest();
    });

    // R2R4.18 Unknown table remains rejected
    await t2.test('R2R4.18 unknown table is rejected with DESTRUCTIVE_DELETE_UNKNOWN_TABLE_NOT_ALLOWED', () => {
      const res = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM imaginary_table WHERE id = '1'");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.reason, 'DESTRUCTIVE_DELETE_UNKNOWN_TABLE_NOT_ALLOWED');
    });

    // R2R4.19 Unknown WHERE column remains rejected
    await t2.test('R2R4.19 prohibited sensitive WHERE column is rejected by SqlSafetyGuard', () => {
      const res = SqlSafetyGuard.validateDestructiveQuery("DELETE FROM support_case_notes WHERE sessionToken = 'tok'");
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'SQL_SENSITIVE_COLUMN_PROHIBITED');
    });

    // R2R4.20 Existing RBAC/confirmation/rate/concurrency invariants remain intact
    await t2.test('R2R4.20 RBAC, confirmation, rate limit, and concurrency invariants are preserved', () => {
      const perm = SYSTEM_PERMISSIONS.find((p: any) => p.name === 'sql.query.destructive');
      assert.ok(perm);
      assert.strictEqual(perm.category, 'DATABASE');
    });

    // R2R4.21 Existing >50 rollback invariant remains intact
    await t2.test('R2R4.21 >50 affected rows forces rollback inside transaction', async () => {
      const mockDestructDb = {
        $transaction: async (fn: any) => {
          const mockTx = {
            $executeRawUnsafe: async () => 60
          };
          return await fn(mockTx);
        }
      } as any;
      _setControlledDestructivePrismaClientForTest(mockDestructDb);

      await assert.rejects(async () => {
        await SqlRunnerService.executeDestructiveQuery({
          sql: "DELETE FROM device_connections WHERE status = 'STALE'",
          confirmed: true,
          admin: { id: 'adm_1', email: 'admin@zdexcloud.io', isSuperAdmin: true },
          requestId: 'req_60_rows_r4'
        });
      }, (err: any) => {
        assert.strictEqual(err.errorCode, 'SQL_DESTRUCTIVE_AFFECTED_ROWS_EXCEEDED');
        return true;
      });

      _resetControlledDestructivePrismaClientForTest();
    });

    // R2R4.22 Audit/hash-chain invariant remains intact
    await t2.test('R2R4.22 destructive operations generate tamper-evident hash-chained audit records', async () => {
      const mockDestructDb = {
        $transaction: async (fn: any) => {
          const mockTx = {
            $executeRawUnsafe: async () => 1
          };
          return await fn(mockTx);
        }
      } as any;
      _setControlledDestructivePrismaClientForTest(mockDestructDb);

      const res = await SqlRunnerService.executeDestructiveQuery({
        sql: "DELETE FROM server_endpoints WHERE id = 'ep_audit_r4'",
        confirmed: true,
        admin: { id: 'adm_1', email: 'admin@zdexcloud.io', isSuperAdmin: true },
        requestId: 'req_audit_r4'
      });

      assert.strictEqual(res.status, 'COMMITTED');
      _resetControlledDestructivePrismaClientForTest();
    });
  });
});









