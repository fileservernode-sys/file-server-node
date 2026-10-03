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
export function validateEnvironment(configOverride?: Record<string, any>): EnvValidationResult {
  const cfg = { ...config, ...(configOverride || {}) };
  const warnings: string[] = [];
  const errors: string[] = [];
  const isProd = cfg.NODE_ENV === 'production';

  // 1. Required Variables
  if (!cfg.DATABASE_URL || !cfg.DATABASE_URL.trim()) {
    errors.push('DATABASE_URL is mandatory and cannot be empty.');
  } else if (isProd) {
    if (cfg.DATABASE_URL.includes('localhost') || cfg.DATABASE_URL.includes('127.0.0.1')) {
      warnings.push('DATABASE_URL points to localhost/127.0.0.1 in production environment.');
    }
  }

  // 2. Production Security Invariants
  if (isProd) {
    // A. CORS Policy Validation
    if (cfg.CORS_ORIGIN.includes('*')) {
      errors.push('Wildcard CORS_ORIGIN (*) is strictly forbidden in production mode.');
    }

    // B. Protocol & Domain Hardening
    if (cfg.API_BASE_URL && cfg.API_BASE_URL.startsWith('http://')) {
      errors.push('Insecure http:// protocol in API_BASE_URL is forbidden in production. Use https:// instead.');
    }

    if (cfg.REMOTENODE_BASE_DOMAIN === 'localhost' || cfg.REMOTENODE_BASE_DOMAIN === '127.0.0.1') {
      errors.push('REMOTENODE_BASE_DOMAIN cannot be localhost or 127.0.0.1 in production.');
    }

    if (cfg.REMOTENODE_GATEWAY_DOMAIN === 'localhost' || cfg.REMOTENODE_GATEWAY_DOMAIN === '127.0.0.1') {
      errors.push('REMOTENODE_GATEWAY_DOMAIN cannot be localhost or 127.0.0.1 in production.');
    }

    // C. Proxy Trust Safety
    const trimmedTrust = (cfg.TRUST_PROXY || '').trim().toLowerCase();
    if (trimmedTrust === '*' || trimmedTrust === 'all' || trimmedTrust === '0.0.0.0/0') {
      errors.push('Unbounded wildcard TRUST_PROXY (*) is forbidden in production due to IP spoofing risk.');
    }

    // D. Cryptographic Secret Validation
    const csrfSecret = process.env.ZDEX_CSRF_SECRET || process.env.INTERNAL_SERVICE_KEY || process.env.ADMIN_AUTH_SECRET;
    if (!csrfSecret || !csrfSecret.trim()) {
      errors.push('Production startup requires at least one authoritative cryptographic secret (ZDEX_CSRF_SECRET, INTERNAL_SERVICE_KEY, or ADMIN_AUTH_SECRET).');
    } else if (csrfSecret.includes('development-fallback') || csrfSecret.includes('test-secret') || csrfSecret.length < 16) {
      errors.push('Insecure or weak development secret detected in production environment.');
    }

    // E. Dangerous Debug & Bypass Flag Detection
    const dangerousFlags = [
      { key: 'DISABLE_AUTH', label: 'Authentication Bypass' },
      { key: 'SKIP_CSRF', label: 'CSRF Defense Bypass' },
      { key: 'DISABLE_RATE_LIMIT', label: 'Rate Limiting Disabled' },
      { key: 'BYPASS_SSRF', label: 'SSRF Guard Bypass' },
      { key: 'DISABLE_AUDIT', label: 'Audit Logging Disabled' },
      { key: 'NO_SANITIZE', label: 'Log Sanitization Disabled' }
    ];

    for (const flag of dangerousFlags) {
      const val = process.env[flag.key];
      if (val === 'true' || val === '1') {
        errors.push(`Dangerous configuration flag ${flag.key} (${flag.label}) is strictly prohibited in production mode.`);
      }
    }

    if (cfg.LOG_LEVEL === 'trace') {
      warnings.push('LOG_LEVEL is set to trace in production; recommended level is info or warn.');
    }
  }

  // 3. Email Provider Configuration
  const hasBrevo = Boolean(cfg.BREVO_API_KEY && cfg.BREVO_API_KEY.trim());
  const hasSmtp = Boolean(cfg.SMTP_USERNAME && cfg.SMTP_PASSWORD);
  if (!hasBrevo && !hasSmtp) {
    warnings.push('Neither BREVO_API_KEY nor SMTP credentials configured. Transactional emails will fail to dispatch.');
  }

  // 4. FCM Configuration
  const hasFcm = Boolean(cfg.FCM_PROJECT_ID && cfg.FCM_CLIENT_EMAIL && cfg.FCM_PRIVATE_KEY);
  if (!hasFcm) {
    warnings.push('FCM credentials incomplete. Android background push notifications will be simulated or deferred.');
  }

  const valid = errors.length === 0;

  const result: EnvValidationResult = {
    valid,
    environment: cfg.NODE_ENV,
    requiredVarsPresent: Boolean(cfg.DATABASE_URL),
    warnings,
    errors,
    configSummary: {
      nodeEnv: cfg.NODE_ENV,
      port: cfg.PORT,
      host: cfg.HOST,
      logLevel: cfg.LOG_LEVEL,
      baseDomain: cfg.REMOTENODE_BASE_DOMAIN,
      gatewayDomain: cfg.REMOTENODE_GATEWAY_DOMAIN,
      emailProviderConfigured: hasBrevo || hasSmtp,
      fcmConfigured: hasFcm,
      notificationWorkerEnabled: cfg.NOTIFICATION_WORKER_ENABLED
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
        environment: cfg.NODE_ENV,
        warningsCount: warnings.length
      }
    });
  }

  return result;
}
