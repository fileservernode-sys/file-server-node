import { z } from 'zod';

const domainRegex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export const gatewayConfigSchema = z
  .object({
    GATEWAY_HOST: z.string().default('0.0.0.0'),
    GATEWAY_PORT: z.coerce.number().default(4001),
    GATEWAY_PUBLIC_URL: z.string().default('http://localhost:4001'),
    GATEWAY_WS_URL: z.string().default('ws://localhost:4001'),
    CONTROL_PLANE_URL: z.string().default('http://localhost:4000/api/v1'),

    // Testing / Staging / Production Dynamic Base Domain
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

    GATEWAY_PUBLIC_BASE_URL: z.string().default('https://viewduration.com'),
    GATEWAY_PUBLIC_WS_URL: z.string().default('wss://viewduration.com'),

    GATEWAY_MAX_CONNECTIONS: z.coerce.number().default(1000),
    GATEWAY_AUTH_TIMEOUT_MS: z.coerce.number().default(10000),
    GATEWAY_REQUEST_TIMEOUT_MS: z.coerce.number().default(15000),
    GATEWAY_MAX_MESSAGE_SIZE_BYTES: z.coerce.number().default(10485760), // 10MB limit
    GATEWAY_HEARTBEAT_INTERVAL_MS: z.coerce.number().default(30000),
    GATEWAY_MAX_AUTH_FAILURES: z.coerce.number().default(3),
    GATEWAY_RATE_LIMIT_RPM: z.coerce.number().default(600), // 600 requests per minute
    GATEWAY_TRANSFER_TIMEOUT_MS: z.coerce.number().default(60000), // 60s stream timeout
    GATEWAY_TRANSFER_CHUNK_SIZE_BYTES: z.coerce.number().default(1048576), // 1MB chunk limit
    GATEWAY_TLS_CERT_PATH: z.string().optional(),
    GATEWAY_TLS_KEY_PATH: z.string().optional(),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development')
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === 'production') {
      if (data.GATEWAY_WS_URL.startsWith('ws://')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Insecure ws:// protocol is strictly forbidden in production mode. Use wss:// instead.',
          path: ['GATEWAY_WS_URL']
        });
      }
    }
  });

export type GatewayConfig = z.infer<typeof gatewayConfigSchema>;

export function loadGatewayConfig(overrides: Partial<Record<string, string | number>> = {}): GatewayConfig {
  const envSource = {
    GATEWAY_HOST: overrides.GATEWAY_HOST ?? process.env.GATEWAY_HOST,
    GATEWAY_PORT: overrides.GATEWAY_PORT ?? process.env.GATEWAY_PORT,
    GATEWAY_PUBLIC_URL: overrides.GATEWAY_PUBLIC_URL ?? process.env.GATEWAY_PUBLIC_URL,
    GATEWAY_WS_URL: overrides.GATEWAY_WS_URL ?? process.env.GATEWAY_WS_URL,
    CONTROL_PLANE_URL: overrides.CONTROL_PLANE_URL ?? process.env.CONTROL_PLANE_URL,
    REMOTENODE_BASE_DOMAIN: overrides.REMOTENODE_BASE_DOMAIN ?? process.env.REMOTENODE_BASE_DOMAIN,
    GATEWAY_PUBLIC_BASE_URL: overrides.GATEWAY_PUBLIC_BASE_URL ?? process.env.GATEWAY_PUBLIC_BASE_URL,
    GATEWAY_PUBLIC_WS_URL: overrides.GATEWAY_PUBLIC_WS_URL ?? process.env.GATEWAY_PUBLIC_WS_URL,
    GATEWAY_MAX_CONNECTIONS: overrides.GATEWAY_MAX_CONNECTIONS ?? process.env.GATEWAY_MAX_CONNECTIONS,
    GATEWAY_AUTH_TIMEOUT_MS: overrides.GATEWAY_AUTH_TIMEOUT_MS ?? process.env.GATEWAY_AUTH_TIMEOUT_MS,
    GATEWAY_REQUEST_TIMEOUT_MS: overrides.GATEWAY_REQUEST_TIMEOUT_MS ?? process.env.GATEWAY_REQUEST_TIMEOUT_MS,
    GATEWAY_MAX_MESSAGE_SIZE_BYTES:
      overrides.GATEWAY_MAX_MESSAGE_SIZE_BYTES ?? process.env.GATEWAY_MAX_MESSAGE_SIZE_BYTES,
    GATEWAY_HEARTBEAT_INTERVAL_MS:
      overrides.GATEWAY_HEARTBEAT_INTERVAL_MS ?? process.env.GATEWAY_HEARTBEAT_INTERVAL_MS,
    GATEWAY_MAX_AUTH_FAILURES: overrides.GATEWAY_MAX_AUTH_FAILURES ?? process.env.GATEWAY_MAX_AUTH_FAILURES,
    GATEWAY_RATE_LIMIT_RPM: overrides.GATEWAY_RATE_LIMIT_RPM ?? process.env.GATEWAY_RATE_LIMIT_RPM,
    GATEWAY_TRANSFER_TIMEOUT_MS: overrides.GATEWAY_TRANSFER_TIMEOUT_MS ?? process.env.GATEWAY_TRANSFER_TIMEOUT_MS,
    GATEWAY_TRANSFER_CHUNK_SIZE_BYTES:
      overrides.GATEWAY_TRANSFER_CHUNK_SIZE_BYTES ?? process.env.GATEWAY_TRANSFER_CHUNK_SIZE_BYTES,
    GATEWAY_TLS_CERT_PATH: overrides.GATEWAY_TLS_CERT_PATH ?? process.env.GATEWAY_TLS_CERT_PATH,
    GATEWAY_TLS_KEY_PATH: overrides.GATEWAY_TLS_KEY_PATH ?? process.env.GATEWAY_TLS_KEY_PATH,
    NODE_ENV: overrides.NODE_ENV ?? process.env.NODE_ENV
  };

  const result = gatewayConfigSchema.safeParse(envSource);
  if (!result.success) {
    const formattedErrors = result.error.errors.map((err) => `  - ${err.path.join('.')}: ${err.message}`).join('\n');
    throw new Error('Invalid Gateway Configuration:\n' + formattedErrors);
  }

  return result.data;
}

export const defaultGatewayConfig = loadGatewayConfig();
