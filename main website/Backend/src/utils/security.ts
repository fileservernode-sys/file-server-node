/**
 * ZDEXCLOUD ADMIN SECURITY UTILITIES (Phase 7.5-C)
 * Browser & Transport Security Hardening: Safe Redirects, CORS Validation, CSP
 */

/**
 * Validates whether a requested redirect target is a safe internal Admin destination.
 * Strict Allowlist / Relative Path Validator:
 * - Must start with `/admin` or be a valid Admin hash anchor
 * - Rejects external schemes (http:, https:, javascript:, data:, vbscript:, etc.)
 * - Rejects protocol-relative URLs (//, \\, /\)
 * - Rejects backslash obfuscation and userinfo (@) tricks
 * - Rejects URL encoding / double encoding bypasses
 */
export function isValidAdminRedirect(rawTarget: string | null | undefined): boolean {
  if (!rawTarget || typeof rawTarget !== 'string') {
    return false;
  }

  let target = rawTarget.trim();
  if (target.length === 0 || target.length > 2048) {
    return false;
  }

  // Iteratively decode URI components up to 2 times to detect double-encoded payloads
  for (let i = 0; i < 2; i++) {
    try {
      if (target.includes('%')) {
        target = decodeURIComponent(target);
      }
    } catch {
      // Malformed URI encoding -> Fail closed
      return false;
    }
  }

  target = target.trim();

  // 1. Disallow any explicit schemes, data URIs, javascript URIs
  // Note: Scheme check catches any "scheme:" prefix (e.g. javascript:, http:, https:, data:, blob:)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target)) {
    return false;
  }

  // 2. Disallow protocol-relative URLs (//, \\, /\, \/) or backslashes
  if (target.startsWith('//') || target.startsWith('\\') || target.startsWith('/\\') || target.startsWith('\\/')) {
    return false;
  }
  if (target.includes('\\')) {
    return false;
  }

  // 3. Disallow userinfo / @ tricks
  if (target.includes('@')) {
    return false;
  }

  // 4. Disallow newline/control characters
  if (/[\r\n\t\0]/.test(target)) {
    return false;
  }

  // 5. Must match approved internal Admin destinations
  // Allowed patterns:
  // - /admin
  // - /admin/
  // - /admin/login
  // - /admin/login.html
  // - /admin/index.html
  // - /admin#... or /admin/#... or /admin/index.html#...
  // - Hash only (e.g. #dashboard, #admin-roles)
  const isApprovedAdminPath =
    /^\/admin(\/([a-zA-Z0-9_.-]+)?)?([?#].*)?$/.test(target) ||
    /^#([a-zA-Z0-9_\-\/]+)$/.test(target) ||
    /^index\.html(#.*)?$/.test(target);

  return isApprovedAdminPath;
}

/**
 * Returns a normalized safe admin redirect destination, falling back to '/admin/' if unsafe.
 */
export function getSafeAdminRedirect(rawTarget: string | null | undefined, defaultFallback = '/admin/'): string {
  if (isValidAdminRedirect(rawTarget)) {
    let target = (rawTarget as string).trim();
    if (target.startsWith('#')) {
      return `/admin/${target}`;
    }
    if (target === 'index.html' || target.startsWith('index.html#')) {
      return `/admin/${target}`;
    }
    return target;
  }
  return defaultFallback;
}

/**
 * Determines whether an Origin header is permitted to access API endpoints via CORS.
 * Fail-closed policy:
 * - No Origin header (curl, mobile app, same-origin without Origin) -> ALLOW
 * - Development/Test -> Allow localhost / 127.0.0.1, explicitly configured CORS_ORIGIN, and production domains
 * - Production -> Only explicit whitelist in CORS_ORIGIN and verified ZdexCloud domain & subdomain patterns
 */
export function isOriginAllowed(
  origin: string | undefined | null,
  env: string,
  allowedOrigins: string[],
  baseDomain: string
): boolean {
  // Requests without an Origin header are typically same-origin, curl, server-to-server, or native mobile apps
  if (!origin) {
    return true;
  }

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    // Malformed Origin header -> Fail closed
    return false;
  }

  const protocol = parsed.protocol.toLowerCase();
  const hostname = parsed.hostname.toLowerCase();
  const normalizedOrigin = `${protocol}//${parsed.host.toLowerCase()}`;

  // Protocol must be http or https
  if (protocol !== 'http:' && protocol !== 'https:') {
    return false;
  }

  // 1. Development & Test Whitelist
  if (env === 'development' || env === 'test') {
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return true;
    }
  }

  // 2. Explicitly configured whitelist from environment variable
  const normalizedAllowed = allowedOrigins.map(o => o.trim().toLowerCase()).filter(Boolean);
  if (normalizedAllowed.includes(normalizedOrigin)) {
    return true;
  }

  // 3. Exact production domain matches
  const normalizedBase = baseDomain.trim().toLowerCase();
  const exactProductionHosts = new Set([
    'zdexcloud.com',
    'www.zdexcloud.com',
    'app.zdexcloud.com',
    'api.zdexcloud.com',
    'admin.zdexcloud.com',
    'gateway.zdexcloud.com',
    normalizedBase,
    `www.${normalizedBase}`,
    `app.${normalizedBase}`,
    `api.${normalizedBase}`,
    `admin.${normalizedBase}`,
    `gateway.${normalizedBase}`
  ]);

  if (protocol === 'https:' && exactProductionHosts.has(hostname)) {
    return true;
  }

  // 4. Valid Subdomains under approved base domains
  // Matches: srv-*.zdexcloud.com, node-*.zdexcloud.com, *.onrender.com
  const isSubdomainOf = (host: string, domain: string) => {
    return host.endsWith(`.${domain}`) && !host.includes('..') && /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(host.slice(0, -(domain.length + 1)));
  };

  if (protocol === 'https:') {
    if (isSubdomainOf(hostname, 'zdexcloud.com')) {
      return true;
    }
    if (normalizedBase && isSubdomainOf(hostname, normalizedBase)) {
      return true;
    }
    // Staging onrender.com subdomains
    if (isSubdomainOf(hostname, 'onrender.com')) {
      return true;
    }
  }

  // Fail closed
  return false;
}

/**
 * Constructs the authoritative Content Security Policy (CSP) header value for Admin routes.
 */
export function getAdminCspHeader(): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'"
  ].join('; ');
}
