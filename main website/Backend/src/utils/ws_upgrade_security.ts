import http from 'node:http';
import net from 'node:net';
import type { Socket } from 'node:net';

export const WS_UPGRADE_HANDLED = Symbol.for('zdex.ws.upgrade_handled');
export const WS_REJECT_SCHEDULED = Symbol.for('zdex.ws.reject_scheduled');

/**
 * Marks an HTTP Upgrade request as claimed by its owning WebSocket server
 * so sibling listeners or the unhandled-path fallback do not touch it.
 */
export function markUpgradeHandled(req: http.IncomingMessage): void {
  (req as any)[WS_UPGRADE_HANDLED] = true;
}

/**
 * Schedules a single deterministic 404 rejection on the next tick if no
 * WebSocket listener claims the HTTP Upgrade request synchronously.
 */
export function scheduleUnhandledUpgradeRejection(req: http.IncomingMessage, socket: Socket): void {
  const taggedReq = req as any;
  if (taggedReq[WS_UPGRADE_HANDLED] || taggedReq[WS_REJECT_SCHEDULED]) {
    return;
  }
  taggedReq[WS_REJECT_SCHEDULED] = true;

  setImmediate(() => {
    if (taggedReq[WS_UPGRADE_HANDLED] || socket.destroyed) {
      return;
    }
    try {
      if (socket.writable) {
        socket.write(
          'HTTP/1.1 404 Not Found\r\n' +
            'Connection: close\r\n' +
            'Content-Type: application/json; charset=utf-8\r\n\r\n' +
            '{"success":false,"error":{"code":"WS_PATH_NOT_FOUND","message":"WebSocket endpoint not found."}}'
        );
      }
    } catch {
      // Ignore write failures on half-closed sockets
    } finally {
      try {
        socket.destroy();
      } catch {}
    }
  });
}

/**
 * Immediately rejects an HTTP Upgrade handshake without leaking internal details.
 */
export function rejectUpgradeHandshake(
  socket: Socket,
  statusCode: number,
  statusText: string,
  errorCode: string,
  message: string
): void {
  try {
    if (!socket.destroyed && socket.writable) {
      const body = JSON.stringify({
        success: false,
        error: { code: errorCode, message }
      });
      socket.write(
        `HTTP/1.1 ${statusCode} ${statusText}\r\n` +
          'Connection: close\r\n' +
          'Content-Type: application/json; charset=utf-8\r\n' +
          `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n` +
          body
      );
    }
  } catch {
    // Socket may already be closed
  } finally {
    try {
      socket.destroy();
    } catch {}
  }
}

/**
 * Normalizes and validates a strict HTTP(S) Origin string without paths, query,
 * hash, userinfo, trailing slashes, or wildcards. Returns null if invalid.
 */
export function normalizeExactOrigin(rawOrigin: string): string | null {
  if (typeof rawOrigin !== 'string') return null;
  const trimmed = rawOrigin.trim();
  if (!trimmed || trimmed === 'null' || trimmed.includes('*') || /\s/.test(trimmed) || trimmed.includes(',')) {
    return null;
  }
  if (trimmed.endsWith('/')) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    return null;
  }

  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    return null;
  }

  const canonical = `${protocol}//${parsed.host.toLowerCase()}`;
  return canonical === trimmed.toLowerCase() ? canonical : null;
}

/**
 * Builds the exact normalized trusted browser-origin allowlist for Camera signaling.
 * Wildcard entries and malformed URLs are excluded (fail-closed).
 */
export function buildAllowedBrowserOrigins(options: {
  explicitOrigins?: string | string[];
  corsOrigins?: string;
  frontendUrl?: string;
}): Set<string> {
  const result = new Set<string>();

  const addCandidateList = (candidates: string[]) => {
    for (const item of candidates) {
      const normalized = normalizeExactOrigin(item);
      if (normalized) {
        result.add(normalized);
      }
    }
  };

  if (options.explicitOrigins !== undefined) {
    const list = Array.isArray(options.explicitOrigins)
      ? options.explicitOrigins
      : options.explicitOrigins.split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length > 0) {
      addCandidateList(list);
      return result;
    }
  }

  if (options.corsOrigins) {
    addCandidateList(options.corsOrigins.split(',').map((s) => s.trim()).filter(Boolean));
  }
  if (options.frontendUrl) {
    addCandidateList([options.frontendUrl.trim()]);
  }

  return result;
}

export function isExactBrowserOriginAllowed(
  rawOrigin: string | string[] | undefined,
  allowedOrigins: ReadonlySet<string>,
  options: { allowHttpInCurrentEnv: boolean }
): { allowed: boolean; normalizedOrigin: string | null } {
  if (!rawOrigin || Array.isArray(rawOrigin)) {
    return { allowed: false, normalizedOrigin: null };
  }

  const normalized = normalizeExactOrigin(rawOrigin);
  if (!normalized) {
    return { allowed: false, normalizedOrigin: null };
  }

  if (!options.allowHttpInCurrentEnv && !normalized.startsWith('https://')) {
    return { allowed: false, normalizedOrigin: normalized };
  }

  return {
    allowed: allowedOrigins.has(normalized),
    normalizedOrigin: normalized
  };
}

function normalizeRemoteAddress(addr?: string | null): string | null {
  if (!addr || typeof addr !== 'string') return null;
  let cleaned = addr.trim();
  if (!cleaned) return null;
  const zoneIdx = cleaned.indexOf('%');
  if (zoneIdx !== -1) cleaned = cleaned.slice(0, zoneIdx);
  if (cleaned.startsWith('::ffff:')) {
    const v4Candidate = cleaned.slice(7);
    if (net.isIPv4(v4Candidate)) {
      return v4Candidate;
    }
  }
  return cleaned;
}

function ipv4ToInt(ip: string): number | null {
  if (!net.isIPv4(ip)) return null;
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
  return (((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0);
}

function ipv4MatchesCidr(ip: string, network: string, prefixLen: number): boolean {
  if (prefixLen < 0 || prefixLen > 32) return false;
  const ipInt = ipv4ToInt(ip);
  const netInt = ipv4ToInt(network);
  if (ipInt === null || netInt === null) return false;
  const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
  return (ipInt & mask) === (netInt & mask);
}

function expandIpv6ToBigInt(ip: string): bigint | null {
  if (!net.isIPv6(ip)) return null;
  const parts = ip.split('::');
  if (parts.length > 2) return null;

  const parseSide = (side: string): number[] | null => {
    if (!side) return [];
    const tokens = side.split(':');
    const out: number[] = [];
    for (const tok of tokens) {
      if (tok.includes('.')) {
        const v4 = ipv4ToInt(tok);
        if (v4 === null) return null;
        out.push((v4 >>> 16) & 0xffff, v4 & 0xffff);
      } else {
        const val = parseInt(tok, 16);
        if (Number.isNaN(val) || val < 0 || val > 0xffff) return null;
        out.push(val);
      }
    }
    return out;
  };

  const left = parseSide(parts[0]);
  if (!left) return null;
  const right = parts.length === 2 ? parseSide(parts[1]) : [];
  if (!right) return null;

  const missing = 8 - (left.length + right.length);
  if ((parts.length === 1 && missing !== 0) || (parts.length === 2 && missing < 0)) {
    return null;
  }

  const full = [...left, ...new Array<number>(Math.max(0, missing)).fill(0), ...right];
  if (full.length !== 8) return null;

  let acc = 0n;
  for (const hextet of full) {
    acc = (acc << 16n) | BigInt(hextet);
  }
  return acc;
}

function ipv6MatchesCidr(ip: string, network: string, prefixLen: number): boolean {
  if (prefixLen < 0 || prefixLen > 128) return false;
  const ipInt = expandIpv6ToBigInt(ip);
  const netInt = expandIpv6ToBigInt(network);
  if (ipInt === null || netInt === null) return false;
  if (prefixLen === 0) return true;
  const shift = BigInt(128 - prefixLen);
  return (ipInt >> shift) === (netInt >> shift);
}

/**
 * Evaluates whether the direct TCP peer IP matches the backend's TRUST_PROXY configuration.
 * Supports: 'false', 'true', 'loopback', 'linklocal', 'uniquelocal', exact IPs, and IPv4/IPv6 CIDRs.
 */
export function isTrustedProxyIp(remoteAddress: string | undefined | null, trustProxyConfig: string): boolean {
  const ip = normalizeRemoteAddress(remoteAddress);
  if (!ip || net.isIP(ip) === 0) {
    return false;
  }

  const trimmed = (trustProxyConfig || '').trim();
  if (!trimmed || trimmed.toLowerCase() === 'false') {
    return false;
  }
  if (trimmed.toLowerCase() === 'true') {
    return true;
  }

  const entries = trimmed.split(',').map((e) => e.trim()).filter(Boolean);
  for (const entry of entries) {
    const lower = entry.toLowerCase();
    if (lower === 'loopback') {
      if (net.isIPv4(ip) && ipv4MatchesCidr(ip, '127.0.0.0', 8)) return true;
      if (net.isIPv6(ip) && ipv6MatchesCidr(ip, '::1', 128)) return true;
      continue;
    }
    if (lower === 'linklocal') {
      if (net.isIPv4(ip) && ipv4MatchesCidr(ip, '169.254.0.0', 16)) return true;
      if (net.isIPv6(ip) && ipv6MatchesCidr(ip, 'fe80::', 10)) return true;
      continue;
    }
    if (lower === 'uniquelocal') {
      if (
        net.isIPv4(ip) &&
        (ipv4MatchesCidr(ip, '10.0.0.0', 8) ||
          ipv4MatchesCidr(ip, '172.16.0.0', 12) ||
          ipv4MatchesCidr(ip, '192.168.0.0', 16))
      ) {
        return true;
      }
      if (net.isIPv6(ip) && ipv6MatchesCidr(ip, 'fc00::', 7)) {
        return true;
      }
      continue;
    }

    if (entry.includes('/')) {
      const [networkRaw, prefixRaw] = entry.split('/');
      const network = normalizeRemoteAddress(networkRaw);
      const prefixLen = Number(prefixRaw);
      if (!network || !Number.isInteger(prefixLen)) continue;
      if (net.isIPv4(ip) && net.isIPv4(network) && ipv4MatchesCidr(ip, network, prefixLen)) return true;
      if (net.isIPv6(ip) && net.isIPv6(network) && ipv6MatchesCidr(ip, network, prefixLen)) return true;
      continue;
    }

    const normalizedEntry = normalizeRemoteAddress(entry);
    if (normalizedEntry && ip === normalizedEntry) {
      return true;
    }
  }

  return false;
}

/**
 * Determines whether an HTTP Upgrade request arrived via secure TLS transport (`wss://`),
 * accepting `X-Forwarded-Proto` / `Forwarded` ONLY when the immediate peer is a configured trusted proxy.
 */
export function isSecureUpgradeRequest(req: http.IncomingMessage, trustProxyConfig: string): boolean {
  if ((req.socket as any)?.encrypted === true) {
    return true;
  }

  if (!isTrustedProxyIp(req.socket?.remoteAddress, trustProxyConfig)) {
    return false;
  }

  const xfp = req.headers['x-forwarded-proto'];
  if (typeof xfp === 'string' && xfp.trim().length > 0) {
    const protos = xfp.split(',').map((p) => p.trim().toLowerCase()).filter(Boolean);
    return protos.length > 0 && protos.every((p) => p === 'https');
  }

  const forwarded = req.headers.forwarded;
  if (typeof forwarded === 'string' && forwarded.trim().length > 0) {
    const hops = forwarded.split(',').map((h) => h.trim()).filter(Boolean);
    if (hops.length === 0) return false;
    return hops.every((hop) => /(?:^|;)\s*proto=https(?:\s*;|$)/i.test(hop));
  }

  return false;
}
