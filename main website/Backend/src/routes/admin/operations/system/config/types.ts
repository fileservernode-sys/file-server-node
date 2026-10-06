/**
 * Phase 17 Batch 17.7 — System Configuration Types
 * Safe Runtime Configuration, Feature Flags & Operational Settings
 */

export type ConfigCategory =
  | 'LOGGING_DIAGNOSTICS'
  | 'AUTHENTICATION_OTP'
  | 'NOTIFICATION_DELIVERY'
  | 'RETENTION_CLEANUP'
  | 'PLATFORM_GENERAL'
  | 'ENVIRONMENT_DEPLOYMENT';

export type ConfigValueType = 'STRING' | 'NUMBER' | 'BOOLEAN' | 'ENUM';

export type ConfigSource = 'ENVIRONMENT_DEFAULT' | 'RUNTIME_OVERRIDE';

export interface SystemSettingItem {
  key: string;
  name: string;
  description: string;
  category: ConfigCategory;
  valueType: ConfigValueType;
  currentValue: string | number | boolean;
  defaultValue: string | number | boolean;
  isEditable: boolean;
  restartRequired: boolean;
  allowedValues?: string[];
  min?: number;
  max?: number;
  source: ConfigSource;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
}

export interface FeatureFlagItem {
  key: string;
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
}

export interface EnvironmentInventory {
  nodeEnv: string;
  appVersion: string;
  apiVersion: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  timezone: string;
  uptimeSeconds: number;
  uptimeFormatted: string;
  startedAt: string;
  databaseEngine: string;
  trustedProxy: string;
  baseDomain: string;
  gatewayDomain: string;
}

export interface SystemConfigOverview {
  totalSettingsCount: number;
  editableSettingsCount: number;
  runtimeOverridesCount: number;
  activeFeatureFlagsCount: number;
  totalFeatureFlagsCount: number;
  environment: EnvironmentInventory;
  recentChangesCount24h: number;
  lastConfigChangeAt: string | null;
  settingsRequiringRestartCount: number;
}

export interface SystemSettingsListResult {
  items: SystemSettingItem[];
  total: number;
  categories: {
    category: ConfigCategory;
    count: number;
  }[];
}

export interface FeatureFlagsListResult {
  items: FeatureFlagItem[];
  total: number;
  activeCount: number;
}
