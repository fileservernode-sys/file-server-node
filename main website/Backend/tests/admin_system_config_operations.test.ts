import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { AdminSystemConfigService } from '../src/routes/admin/operations/system/config/service.js';
import { AdminOperationContext } from '../src/routes/admin/operations/types.js';
import { ValidationError, NotFoundError, ForbiddenError, ConflictError } from '../src/errors/app-error.js';

describe('Phase 17 Batch 17.7 — Admin System Configuration & Feature Flags Control Plane', () => {
  let app: FastifyInstance;

  const mockAdminContext: AdminOperationContext = {
    adminId: 'admin-config-test-001',
    adminEmail: 'admin.config@zdexcloud.internal',
    adminName: 'Config Test Admin',
    isSuperAdmin: true,
    status: 'ACTIVE' as any,
    sessionId: 'sess-config-test-001',
    roles: ['SUPER_ADMIN'],
    permissions: ['system.read', 'system.write'],
    requestId: 'req-cfg-test-001',
    clientIp: '127.0.0.1',
    userAgent: 'NodeTest/1.0'
  };

  before(async () => {
    app = await buildApp();
    await app.ready();
    AdminSystemConfigService.init();
  });

  after(async () => {
    await app.close();
  });

  // =========================================================================
  // SUITE 1: SERVICE UNIT, REGISTRY & INVENTORY COMPUTATION
  // =========================================================================
  describe('Suite 1: AdminSystemConfigService Registry & Inventory Computation', () => {
    test('1.1: getConfigOverview returns structured overview with environment topology', async () => {
      const overview = await AdminSystemConfigService.getConfigOverview();

      assert.ok(overview, 'Overview payload must exist');
      assert.strictEqual(typeof overview.totalSettingsCount, 'number');
      assert.strictEqual(typeof overview.editableSettingsCount, 'number');
      assert.strictEqual(typeof overview.runtimeOverridesCount, 'number');
      assert.strictEqual(typeof overview.activeFeatureFlagsCount, 'number');
      assert.strictEqual(typeof overview.totalFeatureFlagsCount, 'number');
      assert.ok(overview.totalSettingsCount > 0, 'Must have registered settings');
      assert.ok(overview.totalFeatureFlagsCount > 0, 'Must have registered feature flags');

      assert.ok(overview.environment, 'Environment inventory must exist');
      assert.strictEqual(typeof overview.environment.nodeEnv, 'string');
      assert.strictEqual(typeof overview.environment.nodeVersion, 'string');
      assert.strictEqual(typeof overview.environment.platform, 'string');
      assert.strictEqual(typeof overview.environment.uptimeSeconds, 'number');
    });

    test('1.2: listSettings returns all registered settings and categories', async () => {
      const res = await AdminSystemConfigService.listSettings();

      assert.ok(Array.isArray(res.items), 'Settings items must be an array');
      assert.ok(res.items.length > 0, 'Must contain settings');
      assert.strictEqual(res.total, res.items.length);
      assert.ok(Array.isArray(res.categories), 'Categories breakdown must be an array');

      for (const s of res.items) {
        assert.ok(s.key, 'Setting must have a key');
        assert.ok(s.name, 'Setting must have a name');
        assert.ok(s.category, 'Setting must have a category');
        assert.ok(['STRING', 'NUMBER', 'BOOLEAN', 'ENUM'].includes(s.valueType));
        assert.strictEqual(typeof s.isEditable, 'boolean');
        assert.strictEqual(typeof s.version, 'number');
      }
    });

    test('1.3: listSettings filters by category and search keyword', async () => {
      const filtered = await AdminSystemConfigService.listSettings({
        category: 'LOGGING_DIAGNOSTICS'
      });

      assert.ok(filtered.items.length > 0);
      assert.ok(filtered.items.every(s => s.category === 'LOGGING_DIAGNOSTICS'));

      const searched = await AdminSystemConfigService.listSettings({
        search: 'log_level'
      });
      assert.ok(searched.items.some(s => s.key === 'log_level'));
    });

    test('1.4: getSetting retrieves valid single setting item', async () => {
      const setting = await AdminSystemConfigService.getSetting('log_level');

      assert.strictEqual(setting.key, 'log_level');
      assert.strictEqual(setting.category, 'LOGGING_DIAGNOSTICS');
      assert.strictEqual(setting.valueType, 'ENUM');
      assert.strictEqual(setting.isEditable, true);
    });

    test('1.5: getSetting throws NotFoundError for unknown setting key', async () => {
      await assert.rejects(
        async () => {
          await AdminSystemConfigService.getSetting('unknown_non_existent_key_xyz');
        },
        (err: any) => {
          assert.ok(err instanceof NotFoundError || err.name === 'NotFoundError');
          return true;
        }
      );
    });
  });

  // =========================================================================
  // SUITE 2: SETTING MUTATION, VALIDATION & OPTIMISTIC CONCURRENCY
  // =========================================================================
  describe('Suite 2: Setting Mutation, Type/Range Validation & Optimistic Concurrency', () => {
    test('2.1: updateSetting successfully modifies editable number setting and bumps version', async () => {
      const current = await AdminSystemConfigService.getSetting('otp_max_attempts');
      const targetVal = current.currentValue === 5 ? 6 : 5;

      const res = await AdminSystemConfigService.updateSetting(
        'otp_max_attempts',
        { value: targetVal, expectedVersion: current.version },
        mockAdminContext
      );

      assert.strictEqual(res.setting.currentValue, targetVal);
      assert.strictEqual(res.setting.source, 'RUNTIME_OVERRIDE');
      assert.strictEqual(res.setting.version, current.version + 1);
      assert.strictEqual(res.setting.updatedBy, mockAdminContext.adminEmail);
    });

    test('2.2: updateSetting rejects out-of-range numerical values (below minimum)', async () => {
      const current = await AdminSystemConfigService.getSetting('otp_max_attempts');

      await assert.rejects(
        async () => {
          await AdminSystemConfigService.updateSetting(
            'otp_max_attempts',
            { value: 0, expectedVersion: current.version }, // min is 1
            mockAdminContext
          );
        },
        (err: any) => {
          assert.ok(err instanceof ValidationError || err.name === 'ValidationError');
          return true;
        }
      );
    });

    test('2.3: updateSetting rejects out-of-range numerical values (above maximum)', async () => {
      const current = await AdminSystemConfigService.getSetting('otp_max_attempts');

      await assert.rejects(
        async () => {
          await AdminSystemConfigService.updateSetting(
            'otp_max_attempts',
            { value: 100, expectedVersion: current.version }, // max is 10
            mockAdminContext
          );
        },
        (err: any) => {
          assert.ok(err instanceof ValidationError || err.name === 'ValidationError');
          return true;
        }
      );
    });

    test('2.4: updateSetting rejects invalid enum value for enum setting', async () => {
      const current = await AdminSystemConfigService.getSetting('log_level');

      await assert.rejects(
        async () => {
          await AdminSystemConfigService.updateSetting(
            'log_level',
            { value: 'super_verbose_unknown', expectedVersion: current.version },
            mockAdminContext
          );
        },
        (err: any) => {
          assert.ok(err instanceof ValidationError || err.name === 'ValidationError');
          return true;
        }
      );
    });

    test('2.5: updateSetting rejects mutation on immutable/deployment settings with ForbiddenError', async () => {
      await assert.rejects(
        async () => {
          await AdminSystemConfigService.updateSetting(
            'api_port',
            { value: 9000 },
            mockAdminContext
          );
        },
        (err: any) => {
          assert.ok(err instanceof ForbiddenError || err.name === 'ForbiddenError');
          return true;
        }
      );
    });

    test('2.6: updateSetting detects version mismatch and throws ConflictError (409)', async () => {
      const current = await AdminSystemConfigService.getSetting('otp_resend_cooldown_seconds');
      const staleVersion = current.version + 999;

      await assert.rejects(
        async () => {
          await AdminSystemConfigService.updateSetting(
            'otp_resend_cooldown_seconds',
            { value: 90, expectedVersion: staleVersion },
            mockAdminContext
          );
        },
        (err: any) => {
          assert.ok(err instanceof ConflictError || err.name === 'ConflictError');
          return true;
        }
      );
    });
  });

  // =========================================================================
  // SUITE 3: SECRET PROTECTION & FORBIDDEN KEY SHIELDING
  // =========================================================================
  describe('Suite 3: Secret Protection & Forbidden Key Shielding', () => {
    test('3.1: getSetting throws ForbiddenError when requesting database_url', async () => {
      await assert.rejects(
        async () => {
          await AdminSystemConfigService.getSetting('database_url');
        },
        (err: any) => {
          assert.ok(err instanceof ForbiddenError || err.name === 'ForbiddenError');
          return true;
        }
      );
    });

    test('3.2: getSetting throws ForbiddenError when requesting brevo_api_key', async () => {
      await assert.rejects(
        async () => {
          await AdminSystemConfigService.getSetting('brevo_api_key');
        },
        (err: any) => {
          assert.ok(err instanceof ForbiddenError || err.name === 'ForbiddenError');
          return true;
        }
      );
    });

    test('3.3: updateSetting throws ForbiddenError when attempting to update smtp_password', async () => {
      await assert.rejects(
        async () => {
          await AdminSystemConfigService.updateSetting(
            'smtp_password',
            { value: 'malicious_new_password' },
            mockAdminContext
          );
        },
        (err: any) => {
          assert.ok(err instanceof ForbiddenError || err.name === 'ForbiddenError');
          return true;
        }
      );
    });
  });

  // =========================================================================
  // SUITE 4: FEATURE FLAGS REGISTRY & TOGGLES
  // =========================================================================
  describe('Suite 4: Feature Flags Registry & Allowlist Controls', () => {
    test('4.1: listFeatureFlags returns recognized feature flags list', async () => {
      const res = await AdminSystemConfigService.listFeatureFlags();

      assert.ok(Array.isArray(res.items), 'Feature flags items must be an array');
      assert.ok(res.items.length > 0, 'Must have feature flags');
      assert.strictEqual(typeof res.activeCount, 'number');

      const maintenanceFlag = res.items.find(f => f.key === 'maintenance_mode');
      assert.ok(maintenanceFlag, 'maintenance_mode flag must exist');
      assert.strictEqual(typeof maintenanceFlag.enabled, 'boolean');
    });

    test('4.2: updateFeatureFlag successfully toggles flag state and increments version', async () => {
      const flagsRes = await AdminSystemConfigService.listFeatureFlags();
      const current = flagsRes.items.find(f => f.key === 'detailed_error_traces')!;
      const targetState = !current.enabled;

      const res = await AdminSystemConfigService.updateFeatureFlag(
        'detailed_error_traces',
        { enabled: targetState, expectedVersion: current.version },
        mockAdminContext
      );

      assert.strictEqual(res.flag.enabled, targetState);
      assert.strictEqual(res.flag.version, current.version + 1);
    });

    test('4.3: updateFeatureFlag rejects unknown feature flag key with NotFoundError', async () => {
      await assert.rejects(
        async () => {
          await AdminSystemConfigService.updateFeatureFlag(
            'arbitrary_unregistered_flag_key',
            { enabled: true },
            mockAdminContext
          );
        },
        (err: any) => {
          assert.ok(err instanceof NotFoundError || err.name === 'NotFoundError');
          return true;
        }
      );
    });

    test('4.4: updateFeatureFlag detects version mismatch and throws ConflictError (409)', async () => {
      const flagsRes = await AdminSystemConfigService.listFeatureFlags();
      const current = flagsRes.items.find(f => f.key === 'maintenance_mode')!;

      await assert.rejects(
        async () => {
          await AdminSystemConfigService.updateFeatureFlag(
            'maintenance_mode',
            { enabled: true, expectedVersion: current.version + 999 },
            mockAdminContext
          );
        },
        (err: any) => {
          assert.ok(err instanceof ConflictError || err.name === 'ConflictError');
          return true;
        }
      );
    });
  });

  // =========================================================================
  // SUITE 5: HTTP ROUTE SECURITY & RBAC ENFORCEMENT
  // =========================================================================
  describe('Suite 5: Route Security & RBAC Enforcement (401 & 403)', () => {
    test('5.1: GET /api/v1/admin/operations/system/config rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/system/config'
      });
      assert.strictEqual(res.statusCode, 401);
    });

    test('5.2: GET /api/v1/admin/operations/system/config/settings rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/system/config/settings'
      });
      assert.strictEqual(res.statusCode, 401);
    });

    test('5.3: GET /api/v1/admin/operations/system/config/settings/:key rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/system/config/settings/log_level'
      });
      assert.strictEqual(res.statusCode, 401);
    });

    test('5.4: PUT /api/v1/admin/operations/system/config/settings/:key rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/operations/system/config/settings/log_level',
        payload: { value: 'debug' }
      });
      assert.strictEqual(res.statusCode, 401);
    });

    test('5.5: GET /api/v1/admin/operations/system/config/flags rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/system/config/flags'
      });
      assert.strictEqual(res.statusCode, 401);
    });

    test('5.6: PUT /api/v1/admin/operations/system/config/flags/:key rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/operations/system/config/flags/maintenance_mode',
        payload: { enabled: true }
      });
      assert.strictEqual(res.statusCode, 401);
    });

    test('5.7: GET /api/v1/admin/operations/system/config/environment rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/system/config/environment'
      });
      assert.strictEqual(res.statusCode, 401);
    });

    // Canonical Route Aliases Verification
    test('5.8: Canonical alias GET /api/v1/admin/system/config rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/system/config'
      });
      assert.strictEqual(res.statusCode, 401);
    });

    test('5.9: Canonical alias GET /api/v1/admin/system/config/settings rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/system/config/settings'
      });
      assert.strictEqual(res.statusCode, 401);
    });

    test('5.10: Canonical alias PUT /api/v1/admin/system/config/settings/:key rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/system/config/settings/log_level',
        payload: { value: 'debug' }
      });
      assert.strictEqual(res.statusCode, 401);
    });

    test('5.11: Canonical alias GET /api/v1/admin/system/config/flags rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/system/config/flags'
      });
      assert.strictEqual(res.statusCode, 401);
    });

    test('5.12: Canonical alias PUT /api/v1/admin/system/config/flags/:key rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/system/config/flags/maintenance_mode',
        payload: { enabled: true }
      });
      assert.strictEqual(res.statusCode, 401);
    });
  });
});
