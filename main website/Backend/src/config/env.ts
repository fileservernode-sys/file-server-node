import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

// Load .env file into process.env if present
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf8');
  envConfig.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const [key, ...values] = trimmed.split('=');
      let val = values.join('=').trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key && val && !process.env[key.trim()]) {
        process.env[key.trim()] = val;
      }
    }
  });
}

const domainRegex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test', 'staging']).default('development'),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL environment variable is required'),
  CORS_ORIGIN: z.string().default('http://localhost:3000,http://localhost:8080,https://viewduration.com,https://www.viewduration.com,https://gateway.viewduration.com'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  API_BASE_URL: z.string().default('http://localhost:4000/api/v1'),

  // Configurable Base Domain (Default: viewduration.com for testing/staging; replaceable in production)
  REMOTENODE_BASE_DOMAIN: z
    .string()
    .default('viewduration.com')
    .refine(
      (val) => !val.includes('://') && !val.includes('/') && !val.includes(' ') && domainRegex.test(val),
      {
        message:
          'REMOTENODE_BASE_DOMAIN must be a valid domain name without protocol prefix (http/https), path, or trailing slash'
      }
    ),

  // Configurable Gateway Domain for Remote Node Subdomains (*.gateway.viewduration.com)
  REMOTENODE_GATEWAY_DOMAIN: z
    .string()
    .default('gateway.viewduration.com')
    .refine(
      (val) => !val.includes('://') && !val.includes('/') && !val.includes(' ') && domainRegex.test(val),
      {
        message:
          'REMOTENODE_GATEWAY_DOMAIN must be a valid domain name without protocol prefix (http/https), path, or trailing slash'
      }
    ),

  // Brevo & SMTP Email Configuration Schema Parameters
  BREVO_API_KEY: z.string().default(''),
  SMTP_HOST: z.string().default('smtp-relay.brevo.com'),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USERNAME: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  SMTP_FROM_EMAIL: z.string().default('noreply@viewduration.com'),
  SMTP_FROM_NAME: z.string().default('RemoteNode File Server'),

  // OTP Expiry and Brute-force Limit Parameters
  EMAIL_VERIFICATION_OTP_EXPIRY_SECONDS: z.coerce.number().default(600),
  PASSWORD_RESET_OTP_EXPIRY_SECONDS: z.coerce.number().default(600),
  OTP_MAX_ATTEMPTS: z.coerce.number().default(5),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().default(60),

  // Firebase Cloud Messaging (FCM) Android Push Configuration
  FCM_PROJECT_ID: z.string().default(''),
  FCM_CLIENT_EMAIL: z.string().default(''),
  FCM_PRIVATE_KEY: z.string().default(''),

  // Notification Background Worker & Retention System Configuration
  NOTIFICATION_WORKER_ENABLED: z.preprocess(
    (val) => (val === undefined ? true : val === 'true' || val === true),
    z.boolean()
  ).default(true),
  NOTIFICATION_WORKER_POLL_INTERVAL_MS: z.coerce.number().default(5000),
  NOTIFICATION_WORKER_BATCH_SIZE: z.coerce.number().default(20),
  NOTIFICATION_WORKER_LEASE_MS: z.coerce.number().default(300000),
  NOTIFICATION_WORKER_SHUTDOWN_TIMEOUT_MS: z.coerce.number().default(10000),
  NOTIFICATION_RETENTION_DAYS: z.coerce.number().default(90),
  NOTIFICATION_DELIVERY_RETENTION_DAYS: z.coerce.number().default(30),
  NOTIFICATION_CLEANUP_INTERVAL_MS: z.coerce.number().default(86400000),
  NOTIFICATION_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  NOTIFICATION_RATE_LIMIT_MAX_EVENTS: z.coerce.number().default(10)
});

function loadConfig() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formattedErrors = result.error.errors.map(err => `  - ${err.path.join('.')}: ${err.message}`).join('\n');
    console.error('\n❌ FATAL: Environment Configuration Error:\n' + formattedErrors + '\n');
    process.exit(1);
  }

  return result.data;
}

export const config = loadConfig();
export type Config = z.infer<typeof envSchema>;
