/**
 * IP Resolution and Normalization Utilities
 * Phase 13.6 Architecture
 *
 * Provides safe normalization of IPv4, IPv6, and IPv4-mapped IPv6 addresses,
 * ensuring no internal proxies or fabricated 127.0.0.1 fallbacks represent public client IPs.
 */

import type { FastifyRequest } from 'fastify';

/**
 * Normalizes an IP string:
 * - Trims whitespace
 * - Strips IPv4-mapped IPv6 prefix (::ffff:192.0.2.1 -> 192.0.2.1)
 * - Returns undefined if the string is empty or malformed
 */
export function normalizeIp(ip: string | null | undefined): string | undefined {
  if (!ip || typeof ip !== 'string') {
    return undefined;
  }

  let cleaned = ip.trim();

  // Strip IPv4-mapped IPv6 prefix (e.g., "::ffff:192.168.1.1" -> "192.168.1.1")
  if (cleaned.startsWith('::ffff:') && cleaned.length > 7) {
    const v4Candidate = cleaned.substring(7);
    if (isValidIpv4(v4Candidate)) {
      return v4Candidate;
    }
  }

  if (isValidIpv4(cleaned) || isValidIpv6(cleaned)) {
    return cleaned;
  }

  return undefined;
}

/**
 * Extracts and normalizes the client IP from a Fastify request.
 * Relies on Fastify's trusted-proxy-aware request.ip.
 */
export function resolveClientIp(request: FastifyRequest): string | undefined {
  if (!request) return undefined;

  const rawIp = typeof request.ip === 'string' ? request.ip : undefined;
  return normalizeIp(rawIp);
}

function isValidIpv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return false;
    const n = Number(part);
    if (n < 0 || n > 255) return false;
  }
  return true;
}

function isValidIpv6(ip: string): boolean {
  return ip.includes(':') && /^[0-9a-fA-F:]+$/.test(ip);
}
