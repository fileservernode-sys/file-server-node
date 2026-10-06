/**
 * Administrative System Configuration Service
 * Phase 17 Batch 17.7 — System Configuration
 *
 * Provides backend-authoritative runtime configuration management,
 * feature flag toggles, optimistic concurrency control, safe environment
 * allowlisting, and rigorous audit logging.
 */

import os from 'node:os';
import { AdminAuditAction } from '@prisma/client';
import { config } from '../../../../../config/env.js';
import { AdminAuditService } from '../../../../../services/admin/admin_audit_service.js';
import { ValidationError, NotFoundError, ForbiddenError, ConflictError } from '../../../../../errors/app-error.js';
import { AdminOperationContext } from '../../types.js';
import {
  ConfigCategory,
  SystemSettingItem,
  FeatureFlagItem,
  EnvironmentInventory,
  SystemConfigOverview,
  SystemSettingsListResult,
  FeatureFlagsListResult
} from './types.js';
import { SystemConfigQuery, UpdateSystemSettingPayload, UpdateFeatureFlagPayload } from './schemas.js';

interface InternalSettingDefinition {
  key: string;
  name: string;
  description: string;
  category: ConfigCategory;
  valueType: 'STRING' | 'NUMBER' | 'BOOLEAN' | 'ENUM';
  defaultValue: string | number | boolean;
  currentValue: string | number | boolean;
  isEditable: boolean;
  restartRequired: boolean;
  allowedValues?: string[];
  min?: number;
  max?: number;
  source: 'ENVIRONMENT_DEFAULT' | 'RUNTIME_OVERRIDE';
  version: number;
  updatedAt: string;
  updatedBy: string | null;
}

interface InternalFeatureFlagDefinition {
  key: string;
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
}

const FORBIDDEN_SECRET_KEYS = new Set([
  'database_url',
  'zdex_sql_diagnostic_database_url',
  'zdex_sql_controlled_write_database_url',
  'controlled_write_database_url',
  'zdex_sql_controlled_destructive_database_url',
  'controlled_destructive_database_url',
  'brevo_api_key',
  'brevo_webhook_secret',
  'smtp_password',
  'smtp_username',
  'fcm_private_key',
  'fcm_client_email',
  'razorpay_key_id',
  'razorpay_key_secret',
  'razorpay_webhook_secret',
  'jwt_secret',
  'session_secret',
  'encryption_key'
]);

export class AdminSystemConfigService {
  private static settingsRegistry: Map<string, InternalSettingDefinition> = new Map();
  private static flagsRegistry: Map<string, InternalFeatureFlagDefinition> = new Map();
  private static lastConfigChangeAt: string | null = null;
  private static changesCount24h = 0;
  private static isInitialized = false;

  /**
   * Initializes the in-memory authoritative configuration store from startup config.
   */
  public static init(): void {
    if (this.isInitialized) return;

    const now = new Date().toISOString();

    // 1. Logging & Diagnostics
    this.registerSetting({
      key: 'log_level',
      name: 'Application Log Level',
      description: 'Minimum severity threshold for application and Fastify structured logging.',
      category: 'LOGGING_DIAGNOSTICS',
      valueType: 'ENUM',
      defaultValue: config.LOG_LEVEL || 'info',
      currentValue: config.LOG_LEVEL || 'info',
      isEditable: true,
      restartRequired: false,
      allowedValues: ['fatal', 'error', 'warn', 'info', 'debug', 'trace'],
      source: 'ENVIRONMENT_DEFAULT',
      version: 1,
      updatedAt: now,
      updatedBy: null
    });

    // 2. Authentication & OTP Operational Parameters
    this.registerSetting({
      key: 'email_verification_otp_expiry_seconds',
      name: 'Email OTP Expiry Window (Seconds)',
      description: 'Validity duration in seconds for customer registration email verification OTP codes.',
      category: 'AUTHENTICATION_OTP',
      valueType: 'NUMBER',
      defaultValue: config.EMAIL_VERIFICATION_OTP_EXPIRY_SECONDS || 600,
      currentValue: config.EMAIL_VERIFICATION_OTP_EXPIRY_SECONDS || 600,
      isEditable: true,
      restartRequired: false,
      min: 60,
      max: 3600,
      source: 'ENVIRONMENT_DEFAULT',
      version: 1,
      updatedAt: now,
      updatedBy: null
    });

    this.registerSetting({
      key: 'password_reset_otp_expiry_seconds',
      name: 'Password Reset OTP Expiry (Seconds)',
      description: 'Validity duration in seconds for customer account password reset OTP tokens.',
      category: 'AUTHENTICATION_OTP',
      valueType: 'NUMBER',
      defaultValue: config.PASSWORD_RESET_OTP_EXPIRY_SECONDS || 600,
      currentValue: config.PASSWORD_RESET_OTP_EXPIRY_SECONDS || 600,
      isEditable: true,
      restartRequired: false,
      min: 60,
      max: 3600,
      source: 'ENVIRONMENT_DEFAULT',
      version: 1,
      updatedAt: now,
      updatedBy: null
    });

    this.registerSetting({
      key: 'otp_max_attempts',
      name: 'Maximum OTP Verification Attempts',
      description: 'Brute-force limit before an issued OTP code is permanently invalidated.',
      category: 'AUTHENTICATION_OTP',
      valueType: 'NUMBER',
      defaultValue: config.OTP_MAX_ATTEMPTS || 5,
      currentValue: config.OTP_MAX_ATTEMPTS || 5,
      isEditable: true,
      restartRequired: false,
      min: 1,
      max: 10,
      source: 'ENVIRONMENT_DEFAULT',
      version: 1,
      updatedAt: now,
      updatedBy: null
    });

    this.registerSetting({
      key: 'otp_resend_cooldown_seconds',
      name: 'OTP Resend Cooldown (Seconds)',
      description: 'Mandatory waiting period between successive OTP dispatch requests for the same recipient.',
      category: 'AUTHENTICATION_OTP',
      valueType: 'NUMBER',
      defaultValue: config.OTP_RESEND_COOLDOWN_SECONDS || 60,
      currentValue: config.OTP_RESEND_COOLDOWN_SECONDS || 60,
      isEditable: true,
      restartRequired: false,
      min: 10,
      max: 300,
      source: 'ENVIRONMENT_DEFAULT',
      version: 1,
      updatedAt: now,
      updatedBy: null
    });

    // 3. Notification & Delivery Reliability Controls
    this.registerSetting({
      key: 'notification_worker_poll_interval_ms',
      name: 'Notification Queue Poll Interval (ms)',
      description: 'Cycle duration in milliseconds for the background delivery worker polling queue.',
      category: 'NOTIFICATION_DELIVERY',
      valueType: 'NUMBER',
      defaultValue: config.NOTIFICATION_WORKER_POLL_INTERVAL_MS || 5000,
      currentValue: config.NOTIFICATION_WORKER_POLL_INTERVAL_MS || 5000,
      isEditable: true,
      restartRequired: false,
      min: 1000,
      max: 60000,
      source: 'ENVIRONMENT_DEFAULT',
      version: 1,
      updatedAt: now,
      updatedBy: null
    });

    this.registerSetting({
      key: 'notification_worker_batch_size',
      name: 'Notification Queue Batch Size',
      description: 'Maximum delivery jobs claimed per polling iteration by the background worker.',
      category: 'NOTIFICATION_DELIVERY',
      valueType: 'NUMBER',
      defaultValue: config.NOTIFICATION_WORKER_BATCH_SIZE || 20,
      currentValue: config.NOTIFICATION_WORKER_BATCH_SIZE || 20,
      isEditable: true,
      restartRequired: false,
      min: 1,
      max: 100,
      source: 'ENVIRONMENT_DEFAULT',
      version: 1,
      updatedAt: now,
      updatedBy: null
    });

    this.registerSetting({
      key: 'notification_provider_failure_threshold',
      name: 'Circuit Breaker Failure Threshold',
      description: 'Consecutive provider delivery failures before tripping the channel circuit breaker.',
      category: 'NOTIFICATION_DELIVERY',
      valueType: 'NUMBER',
      defaultValue: config.NOTIFICATION_PROVIDER_FAILURE_THRESHOLD || 5,
      currentValue: config.NOTIFICATION_PROVIDER_FAILURE_THRESHOLD || 5,
      isEditable: true,
      restartRequired: false,
      min: 1,
      max: 50,
      source: 'ENVIRONMENT_DEFAULT',
      version: 1,
      updatedAt: now,
      updatedBy: null
    });

    this.registerSetting({
      key: 'notification_provider_cooldown_ms',
      name: 'Circuit Breaker Cooldown (ms)',
      description: 'Duration a tripped notification provider remains in open state before probe retry.',
      category: 'NOTIFICATION_DELIVERY',
      valueType: 'NUMBER',
      defaultValue: config.NOTIFICATION_PROVIDER_COOLDOWN_MS || 60000,
      currentValue: config.NOTIFICATION_PROVIDER_COOLDOWN_MS || 60000,
      isEditable: true,
      restartRequired: false,
      min: 5000,
      max: 600000,
      source: 'ENVIRONMENT_DEFAULT',
      version: 1,
      updatedAt: now,
      updatedBy: null
    });

    this.registerSetting({
      key: 'notification_rate_limit_global_per_minute',
      name: 'Global Notification Rate Limit (/min)',
      description: 'Global outbound notification dispatch ceiling per minute across all channels.',
      category: 'NOTIFICATION_DELIVERY',
      valueType: 'NUMBER',
      defaultValue: config.NOTIFICATION_RATE_LIMIT_GLOBAL_PER_MINUTE || 300,
      currentValue: config.NOTIFICATION_RATE_LIMIT_GLOBAL_PER_MINUTE || 300,
      isEditable: true,
      restartRequired: false,
      min: 10,
      max: 2000,
      source: 'ENVIRONMENT_DEFAULT',
      version: 1,
      updatedAt: now,
      updatedBy: null
    });

    // 4. Retention & Cleanup Settings
    this.registerSetting({
      key: 'notification_retention_days',
      name: 'Notification Record Retention (Days)',
      description: 'Retention horizon in days for customer notification history before automated purge.',
      category: 'RETENTION_CLEANUP',
      valueType: 'NUMBER',
      defaultValue: config.NOTIFICATION_RETENTION_DAYS || 90,
      currentValue: config.NOTIFICATION_RETENTION_DAYS || 90,
      isEditable: true,
      restartRequired: false,
      min: 1,
      max: 365,
      source: 'ENVIRONMENT_DEFAULT',
      version: 1,
      updatedAt: now,
      updatedBy: null
    });

    this.registerSetting({
      key: 'notification_delivery_retention_days',
      name: 'Channel Delivery Record Retention (Days)',
      description: 'Retention horizon in days for completed channel delivery attempts.',
      category: 'RETENTION_CLEANUP',
      valueType: 'NUMBER',
      defaultValue: config.NOTIFICATION_DELIVERY_RETENTION_DAYS || 30,
      currentValue: config.NOTIFICATION_DELIVERY_RETENTION_DAYS || 30,
      isEditable: true,
      restartRequired: false,
      min: 1,
      max: 365,
      source: 'ENVIRONMENT_DEFAULT',
      version: 1,
      updatedAt: now,
      updatedBy: null
    });

    this.registerSetting({
      key: 'error_occurrence_retention_days',
      name: 'Error Occurrence Retention (Days)',
      description: 'Retention horizon in days for individual error occurrence diagnostic traces.',
      category: 'RETENTION_CLEANUP',
      valueType: 'NUMBER',
      defaultValue: config.ERROR_OCCURRENCE_RETENTION_DAYS || 30,
      currentValue: config.ERROR_OCCURRENCE_RETENTION_DAYS || 30,
      isEditable: true,
      restartRequired: false,
      min: 1,
      max: 365,
      source: 'ENVIRONMENT_DEFAULT',
      version: 1,
      updatedAt: now,
      updatedBy: null
    });

    this.registerSetting({
      key: 'error_resolved_incident_retention_days',
      name: 'Resolved Incident Retention (Days)',
      description: 'Retention horizon in days for resolved error incidents in the Observability Center.',
      category: 'RETENTION_CLEANUP',
      valueType: 'NUMBER',
      defaultValue: config.ERROR_RESOLVED_INCIDENT_RETENTION_DAYS || 90,
      currentValue: config.ERROR_RESOLVED_INCIDENT_RETENTION_DAYS || 90,
      isEditable: true,
      restartRequired: false,
      min: 7,
      max: 730,
      source: 'ENVIRONMENT_DEFAULT',
      version: 1,
      updatedAt: now,
      updatedBy: null
    });

    this.registerSetting({
      key: 'email_tracking_retention_days',
      name: 'Email Tracking Logs Retention (Days)',
      description: 'Retention horizon in days for outbound transactional email delivery and tracking records.',
      category: 'RETENTION_CLEANUP',
      valueType: 'NUMBER',
      defaultValue: config.EMAIL_TRACKING_RETENTION_DAYS || 90,
      currentValue: config.EMAIL_TRACKING_RETENTION_DAYS || 90,
      isEditable: true,
      restartRequired: false,
      min: 7,
      max: 730,
      source: 'ENVIRONMENT_DEFAULT',
      version: 1,
      updatedAt: now,
      updatedBy: null
    });

    // 5. Deployment & Topology (Immutable / Read-Only Settings)
    this.registerSetting({
      key: 'api_port',
      name: 'HTTP Port Binding',
      description: 'Local network port bound by the backend HTTP server.',
      category: 'ENVIRONMENT_DEPLOYMENT',
      valueType: 'NUMBER',
      defaultValue: config.PORT || 4000,
      currentValue: config.PORT || 4000,
      isEditable: false,
      restartRequired: true,
      source: 'ENVIRONMENT_DEFAULT',
      version: 1,
      updatedAt: now,
      updatedBy: null
    });

    this.registerSetting({
      key: 'remotenode_base_domain',
      name: 'Platform Base Domain',
      description: 'Canonical base domain for customer and administrative web portals.',
      category: 'ENVIRONMENT_DEPLOYMENT',
      valueType: 'STRING',
      defaultValue: config.REMOTENODE_BASE_DOMAIN || 'zdexcloud.com',
      currentValue: config.REMOTENODE_BASE_DOMAIN || 'zdexcloud.com',
      isEditable: false,
      restartRequired: true,
      source: 'ENVIRONMENT_DEFAULT',
      version: 1,
      updatedAt: now,
      updatedBy: null
    });

    this.registerSetting({
      key: 'remotenode_gateway_domain',
      name: 'Gateway Relay Cluster Domain',
      description: 'FQDN cluster domain for Android edge device WebSocket relays.',
      category: 'ENVIRONMENT_DEPLOYMENT',
      valueType: 'STRING',
      defaultValue: config.REMOTENODE_GATEWAY_DOMAIN || 'gateway.zdexcloud.com',
      currentValue: config.REMOTENODE_GATEWAY_DOMAIN || 'gateway.zdexcloud.com',
      isEditable: false,
      restartRequired: true,
      source: 'ENVIRONMENT_DEFAULT',
      version: 1,
      updatedAt: now,
      updatedBy: null
    });

    // 6. Known Feature Flags Allowlist
    this.registerFlag({
      key: 'maintenance_mode',
      name: 'Global Platform Maintenance Mode',
      description: 'When enabled, pauses customer write operations and displays maintenance notice.',
      category: 'OPERATIONS',
      enabled: false,
      version: 1,
      updatedAt: now,
      updatedBy: null
    });

    this.registerFlag({
      key: 'allow_user_registration',
      name: 'Public Customer Registration',
      description: 'Controls whether new customer signups and onboarding are permitted.',
      category: 'SECURITY',
      enabled: true,
      version: 1,
      updatedAt: now,
      updatedBy: null
    });

    this.registerFlag({
      key: 'email_delivery_tracking',
      name: 'Brevo Webhook Ingestion & Tracking',
      description: 'Enables asynchronous email delivery webhook receipt and status reconciliation.',
      category: 'COMMUNICATIONS',
      enabled: config.BREVO_WEBHOOK_ENABLED ?? true,
      version: 1,
      updatedAt: now,
      updatedBy: null
    });

    this.registerFlag({
      key: 'detailed_error_traces',
      name: 'Sanitized Trace Hints in Error Logs',
      description: 'Includes redacted stack trace snippets in structured diagnostic log entries.',
      category: 'DIAGNOSTICS',
      enabled: false,
      version: 1,
      updatedAt: now,
      updatedBy: null
    });

    this.registerFlag({
      key: 'gateway_compression_v2',
      name: 'Gateway WebSocket Compression',
      description: 'Enables per-message deflate compression on edge tunnel WebSocket relays.',
      category: 'INFRASTRUCTURE',
      enabled: true,
      version: 1,
      updatedAt: now,
      updatedBy: null
    });

    this.isInitialized = true;
  }

  private static registerSetting(def: InternalSettingDefinition): void {
    this.settingsRegistry.set(def.key, def);
  }

  private static registerFlag(flag: InternalFeatureFlagDefinition): void {
    this.flagsRegistry.set(flag.key, flag);
  }

  /**
   * Returns complete overview of system configuration and environment inventory.
   */
  public static async getConfigOverview(): Promise<SystemConfigOverview> {
    this.init();

    const environment = this.getEnvironmentInventory();
    const settings = Array.from(this.settingsRegistry.values());
    const flags = Array.from(this.flagsRegistry.values());

    const editableSettingsCount = settings.filter(s => s.isEditable).length;
    const runtimeOverridesCount = settings.filter(s => s.source === 'RUNTIME_OVERRIDE').length;
    const activeFeatureFlagsCount = flags.filter(f => f.enabled).length;
    const settingsRequiringRestartCount = settings.filter(s => s.restartRequired).length;

    return {
      totalSettingsCount: settings.length,
      editableSettingsCount,
      runtimeOverridesCount,
      activeFeatureFlagsCount,
      totalFeatureFlagsCount: flags.length,
      environment,
      recentChangesCount24h: this.changesCount24h,
      lastConfigChangeAt: this.lastConfigChangeAt,
      settingsRequiringRestartCount
    };
  }

  /**
   * Returns safe allowlisted environment inventory.
   */
  public static getEnvironmentInventory(): EnvironmentInventory {
    const uptimeSeconds = Math.floor(process.uptime());
    const startedAt = new Date(Date.now() - uptimeSeconds * 1000).toISOString();

    return {
      nodeEnv: process.env.NODE_ENV || 'development',
      appVersion: '1.0.0',
      apiVersion: 'v1',
      nodeVersion: process.version,
      platform: `${process.platform} (${process.arch})`,
      arch: process.arch,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      uptimeSeconds,
      uptimeFormatted: this.formatUptime(uptimeSeconds),
      startedAt,
      databaseEngine: 'MySQL 8.0 (Prisma ORM Client v5.22.0)',
      trustedProxy: config.TRUST_PROXY || 'loopback,linklocal,uniquelocal',
      baseDomain: config.REMOTENODE_BASE_DOMAIN || 'zdexcloud.com',
      gatewayDomain: config.REMOTENODE_GATEWAY_DOMAIN || 'gateway.zdexcloud.com'
    };
  }

  /**
   * List settings with optional category and search filters.
   */
  public static async listSettings(query: SystemConfigQuery = {}): Promise<SystemSettingsListResult> {
    this.init();

    let items = Array.from(this.settingsRegistry.values());

    if (query.category) {
      items = items.filter(s => s.category === query.category);
    }

    if (query.editableOnly !== undefined) {
      items = items.filter(s => s.isEditable === query.editableOnly);
    }

    if (query.search) {
      const q = query.search.toLowerCase();
      items = items.filter(s =>
        s.key.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
      );
    }

    const categoriesMap = new Map<ConfigCategory, number>();
    for (const item of this.settingsRegistry.values()) {
      categoriesMap.set(item.category, (categoriesMap.get(item.category) || 0) + 1);
    }

    const categories = Array.from(categoriesMap.entries()).map(([category, count]) => ({
      category,
      count
    }));

    return {
      items: items.map(this.toPublicSettingItem),
      total: items.length,
      categories
    };
  }

  /**
   * Get single setting detail by key.
   */
  public static async getSetting(key: string): Promise<SystemSettingItem> {
    this.init();

    const normalizedKey = key.trim().toLowerCase();

    if (FORBIDDEN_SECRET_KEYS.has(normalizedKey)) {
      throw new ForbiddenError(`Access to secret configuration key '${key}' is strictly forbidden`);
    }

    const setting = this.settingsRegistry.get(normalizedKey);
    if (!setting) {
      throw new NotFoundError(`System configuration setting '${key}' not found`);
    }

    return this.toPublicSettingItem(setting);
  }

  /**
   * Updates an editable runtime setting with validation, optimistic concurrency, and audit logging.
   */
  public static async updateSetting(
    key: string,
    payload: UpdateSystemSettingPayload,
    context: AdminOperationContext
  ): Promise<{ setting: SystemSettingItem; message: string }> {
    this.init();

    const normalizedKey = key.trim().toLowerCase();

    if (FORBIDDEN_SECRET_KEYS.has(normalizedKey)) {
      throw new ForbiddenError(`Direct mutation of secret parameter '${key}' is prohibited`);
    }

    const setting = this.settingsRegistry.get(normalizedKey);
    if (!setting) {
      throw new NotFoundError(`System configuration setting '${key}' not found`);
    }

    if (!setting.isEditable) {
      throw new ForbiddenError(`Setting '${key}' is an immutable deployment parameter and cannot be edited at runtime`);
    }

    // Optimistic Concurrency Control
    if (payload.expectedVersion !== undefined && payload.expectedVersion !== setting.version) {
      throw new ConflictError(
        `Setting '${key}' was modified by another administrator (expected version ${payload.expectedVersion}, current version ${setting.version})`
      );
    }

    // Value Type & Range Validation
    const validatedValue = this.validateSettingValue(setting, payload.value);

    const previousValue = setting.currentValue;
    const now = new Date().toISOString();

    // Apply Runtime Mutation
    setting.currentValue = validatedValue;
    setting.source = 'RUNTIME_OVERRIDE';
    setting.version += 1;
    setting.updatedAt = now;
    setting.updatedBy = context.adminEmail || context.adminId;

    this.lastConfigChangeAt = now;
    this.changesCount24h += 1;

    // Persistent Audit Logging with SHA-256 Hash Chaining
    await AdminAuditService.logEvent({
      adminId: context.adminId,
      action: AdminAuditAction.ADMIN_STATUS_UPDATED,
      status: 'SUCCESS',
      ipAddress: context.clientIp,
      userAgent: context.userAgent,
      metadata: {
        operation: 'UPDATE_SYSTEM_SETTING',
        targetResourceType: 'system_setting',
        targetResourceId: setting.key,
        settingKey: setting.key,
        settingName: setting.name,
        category: setting.category,
        previousValue,
        newValue: validatedValue,
        version: setting.version,
        restartRequired: setting.restartRequired
      }
    });

    return {
      setting: this.toPublicSettingItem(setting),
      message: setting.restartRequired
        ? `Setting '${setting.name}' updated successfully (Note: Server restart required for full effect)`
        : `Setting '${setting.name}' updated successfully and applied to running processes`
    };
  }

  /**
   * List all feature flags.
   */
  public static async listFeatureFlags(): Promise<FeatureFlagsListResult> {
    this.init();

    const items = Array.from(this.flagsRegistry.values());
    const activeCount = items.filter(f => f.enabled).length;

    return {
      items: items.map(this.toPublicFeatureFlagItem),
      total: items.length,
      activeCount
    };
  }

  /**
   * Updates a feature flag state with allowlist verification and audit logging.
   */
  public static async updateFeatureFlag(
    key: string,
    payload: UpdateFeatureFlagPayload,
    context: AdminOperationContext
  ): Promise<{ flag: FeatureFlagItem; message: string }> {
    this.init();

    const normalizedKey = key.trim().toLowerCase();
    const flag = this.flagsRegistry.get(normalizedKey);

    if (!flag) {
      throw new NotFoundError(
        `Feature flag '${key}' is not in the recognized allowlist of system flags`
      );
    }

    // Optimistic Concurrency Control
    if (payload.expectedVersion !== undefined && payload.expectedVersion !== flag.version) {
      throw new ConflictError(
        `Feature flag '${key}' was modified by another administrator (expected version ${payload.expectedVersion}, current version ${flag.version})`
      );
    }

    const previousState = flag.enabled;
    const now = new Date().toISOString();

    flag.enabled = payload.enabled;
    flag.version += 1;
    flag.updatedAt = now;
    flag.updatedBy = context.adminEmail || context.adminId;

    this.lastConfigChangeAt = now;
    this.changesCount24h += 1;

    // Persistent Audit Log
    await AdminAuditService.logEvent({
      adminId: context.adminId,
      action: AdminAuditAction.ADMIN_STATUS_UPDATED,
      status: 'SUCCESS',
      ipAddress: context.clientIp,
      userAgent: context.userAgent,
      metadata: {
        operation: 'UPDATE_FEATURE_FLAG',
        targetResourceType: 'feature_flag',
        targetResourceId: flag.key,
        flagKey: flag.key,
        flagName: flag.name,
        previousState,
        newState: flag.enabled,
        version: flag.version
      }
    });

    return {
      flag: this.toPublicFeatureFlagItem(flag),
      message: `Feature flag '${flag.name}' ${flag.enabled ? 'ENABLED' : 'DISABLED'} successfully`
    };
  }

  // =========================================================================
  // VALIDATION & PROJECTION HELPERS
  // =========================================================================

  private static validateSettingValue(
    def: InternalSettingDefinition,
    rawValue: unknown
  ): string | number | boolean {
    if (def.valueType === 'BOOLEAN') {
      if (typeof rawValue !== 'boolean') {
        throw new ValidationError(`Setting '${def.key}' requires a boolean value (true or false)`);
      }
      return rawValue;
    }

    if (def.valueType === 'NUMBER') {
      const num = Number(rawValue);
      if (isNaN(num) || !Number.isFinite(num)) {
        throw new ValidationError(`Setting '${def.key}' requires a valid numerical value`);
      }
      if (def.min !== undefined && num < def.min) {
        throw new ValidationError(`Setting '${def.key}' value (${num}) cannot be less than minimum allowed (${def.min})`);
      }
      if (def.max !== undefined && num > def.max) {
        throw new ValidationError(`Setting '${def.key}' value (${num}) cannot exceed maximum allowed (${def.max})`);
      }
      return num;
    }

    if (def.valueType === 'ENUM') {
      const str = String(rawValue).trim().toLowerCase();
      const allowed = def.allowedValues?.map(v => v.toLowerCase()) || [];
      if (!allowed.includes(str)) {
        throw new ValidationError(
          `Invalid value '${rawValue}' for setting '${def.key}'. Allowed values: ${def.allowedValues?.join(', ')}`
        );
      }
      return str;
    }

    if (def.valueType === 'STRING') {
      const str = String(rawValue).trim();
      if (str.length === 0) {
        throw new ValidationError(`Setting '${def.key}' cannot be an empty string`);
      }
      if (str.length > 500) {
        throw new ValidationError(`Setting '${def.key}' exceeds maximum length of 500 characters`);
      }
      return str;
    }

    throw new ValidationError(`Unsupported value type for setting '${def.key}'`);
  }

  private static toPublicSettingItem(def: InternalSettingDefinition): SystemSettingItem {
    return {
      key: def.key,
      name: def.name,
      description: def.description,
      category: def.category,
      valueType: def.valueType,
      currentValue: def.currentValue,
      defaultValue: def.defaultValue,
      isEditable: def.isEditable,
      restartRequired: def.restartRequired,
      allowedValues: def.allowedValues,
      min: def.min,
      max: def.max,
      source: def.source,
      version: def.version,
      updatedAt: def.updatedAt,
      updatedBy: def.updatedBy
    };
  }

  private static toPublicFeatureFlagItem(def: InternalFeatureFlagDefinition): FeatureFlagItem {
    return {
      key: def.key,
      name: def.name,
      description: def.description,
      category: def.category,
      enabled: def.enabled,
      version: def.version,
      updatedAt: def.updatedAt,
      updatedBy: def.updatedBy
    };
  }

  private static formatUptime(seconds: number): string {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    const parts: string[] = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0 || d > 0) parts.push(`${h}h`);
    if (m > 0 || h > 0 || d > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
  }
}
