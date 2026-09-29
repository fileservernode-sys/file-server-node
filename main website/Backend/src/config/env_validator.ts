import { config } from './env.js';
import { appLogger } from '../observability/logger.js';

export interface EnvValidationResult {
  valid: boolean;
  environment: string;
  requiredVarsPresent: boolean;
  warnings: string[];
  errors: string[];
  configSummary: {
    nodeEnv: string;
    port: number;
    host: string;
    logLevel: string;
    baseDomain: string;
    gatewayDomain: string;
    emailProviderConfigured: boolean;
    fcmConfigured: boolean;
    notificationWorkerEnabled: boolean;
  };
}

/**
 * Validates system environment configuration before server startup.
 * Enforces production invariants, categorizes variables, and blocks dangerous configurations.
 */
export function validateEnvironment(): EnvValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const isProd = config.NODE_ENV === 'production';

  // 1. Required Variables
  if (!config.DATABASE_URL) {
    errors.push('DATABASE_URL is mandatory and cannot be empty.');
  } else if (isProd) {
    if (config.DATABASE_URL.includes('localhost') || config.DATABASE_URL.includes('127.0.0.1')) {
      warnings.push('DATABASE_URL points to localhost/127.0.0.1 in production environment.');
    }
  }

  // 2. Production Security Invariants
  if (isProd) {
    if (config.CORS_ORIGIN.includes('*')) {
      errors.push('Wildcard CORS_ORIGIN (*) is strictly forbidden in production mode.');
    }
    if (config.LOG_LEVEL === 'trace') {
      warnings.push('LOG_LEVEL is set to trace in production; recommended level is info or warn.');
    }
  }

  // 3. Email Provider Configuration
  const hasBrevo = Boolean(config.BREVO_API_KEY && config.BREVO_API_KEY.trim());
  const hasSmtp = Boolean(config.SMTP_USERNAME && config.SMTP_PASSWORD);
  if (!hasBrevo && !hasSmtp) {
    warnings.push('Neither BREVO_API_KEY nor SMTP credentials configured. Transactional emails will fail to dispatch.');
  }

  // 4. FCM Configuration
  const hasFcm = Boolean(config.FCM_PROJECT_ID && config.FCM_CLIENT_EMAIL && config.FCM_PRIVATE_KEY);
  if (!hasFcm) {
    warnings.push('FCM credentials incomplete. Android background push notifications will be simulated or deferred.');
  }

  const valid = errors.length === 0;

  const result: EnvValidationResult = {
    valid,
    environment: config.NODE_ENV,
    requiredVarsPresent: Boolean(config.DATABASE_URL),
    warnings,
    errors,
    configSummary: {
      nodeEnv: config.NODE_ENV,
      port: config.PORT,
      host: config.HOST,
      logLevel: config.LOG_LEVEL,
      baseDomain: config.REMOTENODE_BASE_DOMAIN,
      gatewayDomain: config.REMOTENODE_GATEWAY_DOMAIN,
      emailProviderConfigured: hasBrevo || hasSmtp,
      fcmConfigured: hasFcm,
      notificationWorkerEnabled: config.NOTIFICATION_WORKER_ENABLED
    }
  };

  if (!valid) {
    appLogger.error('Fatal environment configuration validation failure', undefined, {
      operation: 'ENV_VALIDATION',
      metadata: { errors, warnings }
    });
  } else {
    appLogger.info('Environment configuration validated successfully', {
      operation: 'ENV_VALIDATION',
      metadata: {
        environment: config.NODE_ENV,
        warningsCount: warnings.length
      }
    });
  }

  return result;
}
