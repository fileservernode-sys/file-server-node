/**
 * Rate Limiting Tier Presets & Key Generators
 * Phase 14 Batch #10 — Rate Limiting & Abuse Protection
 *
 * Implements granular, identity-aware, defense-in-depth rate limiting tiers
 * across Control Plane (Authentication, Customer, Admin, File Manager, Webhooks)
 * and Data Plane (Gateway, Reverse Proxy).
 */

import { FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import { resolveClientIp } from '../utils/ip.js';
import { createErrorResponse } from '../schemas/response.js';
import { extractCustomerToken, resolveCustomerSession } from './customer-auth.js';

/**
 * Standardized 429 Rate Limit Error Response Builder
 * Conforms to ZdexCloud API response contract with stable error codes and request correlation.
 */
export function buildRateLimitErrorResponse(
  req: FastifyRequest,
  context?: { after?: string; max?: number; ttl?: number }
) {
  const requestId = (req as any)?.id;
  const base = createErrorResponse('RATE_LIMITED', 'Too many requests. Please try again later.', requestId);
  return {
    statusCode: 429,
    ...base
  };
}

/**
 * Helper to produce a deterministic hash of an email or identifier
 * Prevents log leakage and standardizes key length without revealing account existence.
 */
export function hashIdentifier(identifier: string | null | undefined): string {
  if (!identifier || typeof identifier !== 'string') return 'anon';
  const normalized = identifier.trim().toLowerCase();
  return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 16);
}

/**
 * Extracts normalized email or identifier from request body/query for auth routes.
 */
export function extractAuthIdentifier(req: FastifyRequest): string {
  const body = req.body as Record<string, any> | undefined;
  const query = req.query as Record<string, any> | undefined;

  const candidate =
    body?.email ||
    query?.email ||
    body?.challengeToken ||
    query?.challengeToken ||
    body?.username;

  return hashIdentifier(typeof candidate === 'string' ? candidate : undefined);
}

export function extractCustomerRateLimitKey(req: FastifyRequest): string {
  const ip = resolveClientIp(req) || '127.0.0.1';
  const userId = (req as any)?.customerSession?.userId || (req as any)?.user?.id || 'anon_customer';
  return `cust_${userId}_${ip}`;
}

export function extractAdminRateLimitKey(req: FastifyRequest): string {
  const ip = resolveClientIp(req) || '127.0.0.1';
  const adminId = (req as any)?.admin?.id || 'anon_admin';
  return `admin_${adminId}_${ip}`;
}

export function extractFileManagerRateLimitKey(req: FastifyRequest): string {
  const ip = resolveClientIp(req) || '127.0.0.1';
  const userId = (req as any)?.customerSession?.userId || (req as any)?.user?.id || 'anon_customer';
  const serverId = (req as any)?.params?.serverId || 'unknown_server';
  return `filemgr_${userId}_${serverId}_${ip}`;
}

export function extractDeviceConnectionRateLimitKey(req: FastifyRequest): string {
  const ip = resolveClientIp(req) || '127.0.0.1';
  const userId = (req as any)?.customerSession?.userId || (req as any)?.user?.id;
  const body = req.body as Record<string, any> | undefined;
  const deviceId = body?.deviceId || (req as any)?.params?.deviceId || 'anon_dev';

  if (userId) {
    return `conn_reg_${userId}_${deviceId}_${ip}`;
  }

  try {
    const { token } = extractCustomerToken(req);
    if (token) {
      return `conn_reg_${hashIdentifier(token)}_${deviceId}_${ip}`;
    }
  } catch {}

  return `conn_reg_unauth_${ip}`;
}

/**
 * TIER A: High Capacity Public Endpoints (Health, Readiness, Probes)
 * Limit: 600 req/min per IP
 */
export const highCapacityHealthRateLimitConfig = {
  max: 600,
  timeWindow: '1 minute',
  keyGenerator: (req: FastifyRequest) => {
    const ip = resolveClientIp(req) || '127.0.0.1';
    return `public_health_${ip}`;
  },
  errorResponseBuilder: buildRateLimitErrorResponse
};

/**
 * TIER A: Standard Public Endpoints (Plans, Storefront Region, Static)
 * Limit: 120 req/min per IP
 */
export const publicStandardRateLimitConfig = {
  max: 120,
  timeWindow: '1 minute',
  keyGenerator: (req: FastifyRequest) => {
    const ip = resolveClientIp(req) || '127.0.0.1';
    return `public_std_${ip}`;
  },
  errorResponseBuilder: buildRateLimitErrorResponse
};

/**
 * TIER B: Authentication — Login & Register & Password Reset
 * Limit: 5 req/min per (IP + Account Identifier Hash)
 * Prevents credential stuffing, account enumeration, and brute force while preventing
 * an attacker with rotating IPs from overwhelming a single victim email.
 */
export const authStrictRateLimitConfig = {
  max: 5,
  timeWindow: '1 minute',
  hook: 'preHandler' as const,
  keyGenerator: (req: FastifyRequest) => {
    const ip = resolveClientIp(req) || '127.0.0.1';
    const idHash = extractAuthIdentifier(req);
    return `auth_strict_${ip}_${idHash}`;
  },
  errorResponseBuilder: buildRateLimitErrorResponse
};

/**
 * TIER B: Authentication — OTP Verification (Email Verification, 2FA, Reset OTP)
 * Limit: 10 req/min per (IP + Account Identifier Hash)
 */
export const authOtpVerifyRateLimitConfig = {
  max: 10,
  timeWindow: '1 minute',
  hook: 'preHandler' as const,
  keyGenerator: (req: FastifyRequest) => {
    const ip = resolveClientIp(req) || '127.0.0.1';
    const idHash = extractAuthIdentifier(req);
    return `auth_otp_${ip}_${idHash}`;
  },
  errorResponseBuilder: buildRateLimitErrorResponse
};

/**
 * TIER B: Authentication — Resend OTP & Forgot Password
 * Limit: 5 req/min per (IP + Account Identifier Hash)
 * Protects against Brevo email bombing and transactional provider cost explosion.
 */
export const authResendOtpRateLimitConfig = {
  max: 5,
  timeWindow: '1 minute',
  hook: 'preHandler' as const,
  keyGenerator: (req: FastifyRequest) => {
    const ip = resolveClientIp(req) || '127.0.0.1';
    const idHash = extractAuthIdentifier(req);
    return `auth_resend_${ip}_${idHash}`;
  },
  errorResponseBuilder: buildRateLimitErrorResponse
};

/**
 * TIER C: Customer Authenticated Standard Operations (Profile, Notifications, Status)
 * Limit: 120 req/min per (User ID + IP)
 */
export const customerStandardRateLimitConfig = {
  max: 120,
  timeWindow: '1 minute',
  hook: 'preHandler' as const,
  keyGenerator: (req: FastifyRequest) => {
    const ip = resolveClientIp(req) || '127.0.0.1';
    const userId = (req as any)?.customerSession?.userId || (req as any)?.user?.id || 'anon_customer';
    return `cust_std_${userId}_${ip}`;
  },
  errorResponseBuilder: buildRateLimitErrorResponse
};

/**
 * TIER D: Expensive Customer Operations (Server creation, Device registration, Tunnel register, Test Push)
 * Limit: 20 req/min per (User ID + IP)
 */
export const expensiveCustomerRateLimitConfig = {
  max: 20,
  timeWindow: '1 minute',
  hook: 'preHandler' as const,
  keyGenerator: (req: FastifyRequest) => {
    const ip = resolveClientIp(req) || '127.0.0.1';
    const userId = (req as any)?.customerSession?.userId || (req as any)?.user?.id || 'anon_customer';
    return `cust_exp_${userId}_${ip}`;
  },
  errorResponseBuilder: buildRateLimitErrorResponse
};

/**
 * TIER D: Connection Registration & Failover Reconnect Requests
 * Limit: 30 req/min per (Device ID + IP)
 */
export const connectionRegisterRateLimitConfig = {
  max: 30,
  timeWindow: '1 minute',
  hook: 'preHandler' as const,
  keyGenerator: (req: FastifyRequest) => extractDeviceConnectionRateLimitKey(req),
  errorResponseBuilder: buildRateLimitErrorResponse
};

/**
 * TIER E: Admin Authentication (Login & Verify 2FA)
 * Limit: 5 req/min per (IP + Admin Email Hash)
 */
export const adminAuthRateLimitConfig = {
  max: 5,
  timeWindow: '1 minute',
  hook: 'preHandler' as const,
  keyGenerator: (req: FastifyRequest) => {
    const ip = resolveClientIp(req) || '127.0.0.1';
    const idHash = extractAuthIdentifier(req);
    return `admin_auth_${ip}_${idHash}`;
  },
  errorResponseBuilder: buildRateLimitErrorResponse
};

/**
 * TIER E: Admin Operations (Management APIs, RBAC, Users, Servers, Devices)
 * Limit: 120 req/min per (Admin ID + IP)
 */
export const adminOperationsRateLimitConfig = {
  max: 120,
  timeWindow: '1 minute',
  hook: 'preHandler' as const,
  keyGenerator: (req: FastifyRequest) => {
    const ip = resolveClientIp(req) || '127.0.0.1';
    const adminId = (req as any)?.admin?.id || 'anon_admin';
    return `admin_ops_${adminId}_${ip}`;
  },
  errorResponseBuilder: buildRateLimitErrorResponse
};

/**
 * TIER E: Heavy Admin Queries & Exports (Audit Logs, CSV export)
 * Limit: 30 req/min per (Admin ID + IP)
 */
export const adminHeavyQueryRateLimitConfig = {
  max: 30,
  timeWindow: '1 minute',
  hook: 'preHandler' as const,
  keyGenerator: (req: FastifyRequest) => {
    const ip = resolveClientIp(req) || '127.0.0.1';
    const adminId = (req as any)?.admin?.id || 'anon_admin';
    return `admin_heavy_${adminId}_${ip}`;
  },
  errorResponseBuilder: buildRateLimitErrorResponse
};

/**
 * TIER F: File Manager API Operations (Directory Listing, Metadata, Storage)
 * Limit: 120 req/min per (User ID + Server ID)
 */
export const fileManagerStandardRateLimitConfig = {
  max: 120,
  timeWindow: '1 minute',
  hook: 'preHandler' as const,
  keyGenerator: (req: FastifyRequest) => {
    const ip = resolveClientIp(req) || '127.0.0.1';
    const userId = (req as any)?.customerSession?.userId || (req as any)?.user?.id || 'anon_customer';
    const serverId = (req as any)?.params?.serverId || 'unknown_server';
    return `filemgr_std_${userId}_${serverId}_${ip}`;
  },
  errorResponseBuilder: buildRateLimitErrorResponse
};

/**
 * TIER F: File Manager Upload Initiation & Mutations
 * Limit: 30 req/min per (User ID + Server ID)
 */
export const fileManagerMutationRateLimitConfig = {
  max: 30,
  timeWindow: '1 minute',
  hook: 'preHandler' as const,
  keyGenerator: (req: FastifyRequest) => {
    const ip = resolveClientIp(req) || '127.0.0.1';
    const userId = (req as any)?.customerSession?.userId || (req as any)?.user?.id || 'anon_customer';
    const serverId = (req as any)?.params?.serverId || 'unknown_server';
    return `filemgr_mut_${userId}_${serverId}_${ip}`;
  },
  errorResponseBuilder: buildRateLimitErrorResponse
};

/**
 * TIER F: File Manager Media Stream & Download
 * Limit: 60 req/min per (User ID + Server ID)
 */
export const fileManagerDownloadRateLimitConfig = {
  max: 60,
  timeWindow: '1 minute',
  hook: 'preHandler' as const,
  keyGenerator: (req: FastifyRequest) => {
    const ip = resolveClientIp(req) || '127.0.0.1';
    const userId = (req as any)?.customerSession?.userId || (req as any)?.user?.id || 'anon_customer';
    const serverId = (req as any)?.params?.serverId || 'unknown_server';
    return `filemgr_dl_${userId}_${serverId}_${ip}`;
  },
  errorResponseBuilder: buildRateLimitErrorResponse
};

/**
 * TIER A: Inbound Provider Webhooks (Brevo, Razorpay)
 * Limit: 180 req/min per IP
 */
export const providerWebhookRateLimitConfig = {
  max: 180,
  timeWindow: '1 minute',
  keyGenerator: (req: FastifyRequest) => {
    const ip = resolveClientIp(req) || '127.0.0.1';
    return `webhook_${ip}`;
  },
  errorResponseBuilder: buildRateLimitErrorResponse
};
