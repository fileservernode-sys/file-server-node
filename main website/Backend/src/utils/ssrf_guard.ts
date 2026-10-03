import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { AppError } from '../errors/app-error.js';

export class SsrfError extends AppError {
  constructor(message: string, public readonly reasonCode: string = 'SSRF_BLOCKED') {
    super(message, 400, 'SSRF_BLOCKED');
    this.name = 'SsrfError';
  }
}

export interface SsrfValidationOptions {
  allowedProtocols?: string[];
  allowedPorts?: number[];
  allowPrivateForLocalDev?: boolean;
  allowedHostnames?: string[];
  blockedHostnames?: string[];
}

export interface SafeFetchOptions extends SsrfValidationOptions {
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
  method?: string;
  body?: string | Buffer | Uint8Array;
}

// -----------------------------------------------------------------------------
// KNOWN CLOUD METADATA & RESTRICTED HOSTS
// -----------------------------------------------------------------------------
const METADATA_HOSTNAMES = new Set([
  'instance-data',
  'metadata.google.internal',
  'metadata.goog',
  'metadata.internal',
  '169.254.169.254',
  '169.254.169.123',
  '169.254.169.250',
  'fd00:ec2::254'
]);

// -----------------------------------------------------------------------------
// IP CLASSIFICATION & PARSING HELPERS
// -----------------------------------------------------------------------------

/**
 * Attempts to parse numeric/hex/octal IPv4 alternate representations into a standard dotted IPv4 string.
 * Example: "2130706433" -> "127.0.0.1", "0x7f000001" -> "127.0.0.1", "0177.0.0.1" -> "127.0.0.1"
 */
export function parseAlternateIpv4(host: string): string | null {
  const trimmed = host.trim().toLowerCase();

  // If pure decimal number or hex number (e.g. 2130706433 or 0x7f000001)
  if (/^(?:0x[0-9a-f]+|\d+)$/i.test(trimmed)) {
    const num = trimmed.startsWith('0x') ? parseInt(trimmed, 16) : parseInt(trimmed, 10);
    if (!isNaN(num) && num >= 0 && num <= 0xffffffff) {
      const b1 = (num >>> 24) & 0xff;
      const b2 = (num >>> 16) & 0xff;
      const b3 = (num >>> 8) & 0xff;
      const b4 = num & 0xff;
      return `${b1}.${b2}.${b3}.${b4}`;
    }
  }

  // Check dotted-parts with mixed hex/octal/dec (e.g., 0177.0.0.1 or 0x7f.0.0.1)
  const parts = trimmed.split('.');
  if (parts.length >= 2 && parts.length <= 4) {
    const parsedParts: number[] = [];
    for (const part of parts) {
      if (!part) return null;
      let val: number;
      if (part.startsWith('0x') || part.startsWith('0X')) {
        val = parseInt(part, 16);
      } else if (part.length > 1 && part.startsWith('0')) {
        val = parseInt(part, 8);
      } else if (/^\d+$/.test(part)) {
        val = parseInt(part, 10);
      } else {
        return null;
      }
      if (isNaN(val) || val < 0) return null;
      parsedParts.push(val);
    }

    if (parsedParts.length === 4) {
      if (parsedParts.every(p => p <= 255)) {
        return parsedParts.join('.');
      }
    } else if (parsedParts.length === 2) {
      // e.g. 127.1 -> 127.0.0.1
      const a = parsedParts[0];
      const b = parsedParts[1];
      if (a <= 255 && b <= 0xffffff) {
        return `${a}.${(b >>> 16) & 0xff}.${(b >>> 8) & 0xff}.${b & 0xff}`;
      }
    } else if (parsedParts.length === 3) {
      const a = parsedParts[0];
      const b = parsedParts[1];
      const c = parsedParts[2];
      if (a <= 255 && b <= 255 && c <= 0xffff) {
        return `${a}.${b}.${(c >>> 8) & 0xff}.${c & 0xff}`;
      }
    }
  }

  return null;
}

/**
 * Normalizes IPv4-mapped IPv6 (::ffff:127.0.0.1) or NAT64 translated addresses to standard IPv4 if applicable.
 */
export function normalizeIpAddress(ip: string): { ip: string; isIpv6: boolean } {
  let clean = ip.trim().toLowerCase();
  if (clean.startsWith('[') && clean.endsWith(']')) {
    clean = clean.slice(1, -1);
  }

  // IPv4-mapped IPv6 e.g. ::ffff:192.168.1.1
  const mappedMatch = clean.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mappedMatch) {
    return { ip: mappedMatch[1], isIpv6: false };
  }

  // NAT64 prefix 64:ff9b::192.0.2.1
  const nat64Match = clean.match(/^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/i);
  if (nat64Match) {
    return { ip: nat64Match[1], isIpv6: false };
  }

  const isIpv6 = net.isIPv6(clean);
  const isIpv4 = net.isIPv4(clean);

  if (!isIpv4 && !isIpv6) {
    const alt = parseAlternateIpv4(clean);
    if (alt && net.isIPv4(alt)) {
      return { ip: alt, isIpv6: false };
    }
  }

  return { ip: clean, isIpv6 };
}

/**
 * Evaluates whether an IP address belongs to a private, loopback, link-local, carrier-grade NAT, or reserved range.
 */
export function isPrivateOrRestrictedIp(rawIp: string): boolean {
  const { ip, isIpv6 } = normalizeIpAddress(rawIp);

  // 1. IPv4 Range Checks
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(n => parseInt(n, 10));
    if (parts.length !== 4 || parts.some(isNaN)) return true;

    const [b0, b1, b2, b3] = parts;

    // 0.0.0.0/8 (This host on this network RFC 1122 / RFC 6890)
    if (b0 === 0) return true;

    // 10.0.0.0/8 (RFC 1918 Private)
    if (b0 === 10) return true;

    // 100.64.0.0/10 (Carrier-Grade NAT RFC 6598: 100.64.0.0 to 100.127.255.255)
    if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;

    // 127.0.0.0/8 (Loopback RFC 1122 / RFC 6890)
    if (b0 === 127) return true;

    // 169.254.0.0/16 (Link-Local & Cloud Metadata RFC 3927)
    if (b0 === 169 && b1 === 254) return true;

    // 172.16.0.0/12 (RFC 1918 Private: 172.16.0.0 to 172.31.255.255)
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;

    // 192.0.0.0/24 (IETF Protocol Assignments RFC 6890)
    if (b0 === 192 && b1 === 0 && b2 === 0) return true;

    // 192.0.2.0/24 (TEST-NET-1 RFC 5737)
    if (b0 === 192 && b1 === 0 && b2 === 2) return true;

    // 192.88.99.0/24 (6to4 Relay Anycast RFC 3068 / RFC 7526)
    if (b0 === 192 && b1 === 88 && b2 === 99) return true;

    // 192.168.0.0/16 (RFC 1918 Private)
    if (b0 === 192 && b1 === 168) return true;

    // 198.18.0.0/15 (Network Interconnect Benchmark RFC 2544: 198.18.0.0 to 198.19.255.255)
    if (b0 === 198 && (b1 === 18 || b1 === 19)) return true;

    // 198.51.100.0/24 (TEST-NET-2 RFC 5737)
    if (b0 === 198 && b1 === 51 && b2 === 100) return true;

    // 203.0.113.0/24 (TEST-NET-3 RFC 5737)
    if (b0 === 203 && b1 === 0 && b2 === 113) return true;

    // 224.0.0.0/4 (Multicast RFC 5771: 224.0.0.0 to 239.255.255.255)
    if (b0 >= 224 && b0 <= 239) return true;

    // 240.0.0.0/4 (Reserved RFC 1112: 240.0.0.0 to 255.255.255.254)
    if (b0 >= 240) return true;

    // Broadcast (255.255.255.255 RFC 919 / RFC 8190)
    if (b0 === 255 && b1 === 255 && b2 === 255 && b3 === 255) return true;

    return false;
  }

  // 2. IPv6 Range Checks
  if (isIpv6) {
    const clean = ip.toLowerCase();

    // ::1 (Loopback) & :: (Unspecified) (RFC 4291)
    if (clean === '::1' || clean === '::' || clean === '0:0:0:0:0:0:0:1' || clean === '0:0:0:0:0:0:0:0') return true;

    // Unique Local Address (ULA) fc00::/7 (fc00:: to fdff::, RFC 4193)
    if (clean.startsWith('fc') || clean.startsWith('fd')) return true;

    // Link-Local fe80::/10 (fe80:: to febf::, RFC 4291)
    if (clean.startsWith('fe8') || clean.startsWith('fe9') || clean.startsWith('fea') || clean.startsWith('feb')) return true;

    // Multicast ff00::/8 (RFC 4291)
    if (clean.startsWith('ff')) return true;

    // Discard prefix 100::/64 (RFC 6666)
    if (clean.startsWith('100:')) return true;

    // IPv6 Documentation 2001:db8::/32 (RFC 3849)
    if (clean.startsWith('2001:db8:') || clean.startsWith('2001:0db8:')) return true;

    // IETF Protocol Assignments 2001::/23 (RFC 2928)
    if (clean.startsWith('2001:0:') || clean.startsWith('2001:0000:') || clean.startsWith('2001:2:') || clean.startsWith('2001:20:')) return true;

    // 6to4 prefix 2002::/16 (RFC 3056)
    if (clean.startsWith('2002:')) return true;

    return false;
  }

  return true;
}

// -----------------------------------------------------------------------------
// CENTRAL SSRF URL & HOSTNAME VALIDATORS
// -----------------------------------------------------------------------------

/**
 * Validates a URL against strict SSRF policies before network initiation.
 * By default, enforces HTTPS protocol and port 443 only.
 */
export function validateExternalUrl(rawUrl: string, options: SsrfValidationOptions = {}): URL {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new SsrfError('Invalid destination URL: URL must be a non-empty string', 'MALFORMED_URL');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new SsrfError(`Malformed destination URL: ${rawUrl}`, 'MALFORMED_URL');
  }

  const allowedProtocols = options.allowedProtocols || ['https:'];
  if (!allowedProtocols.includes(parsed.protocol.toLowerCase())) {
    throw new SsrfError(
      `Forbidden URL protocol '${parsed.protocol}'. Only ${allowedProtocols.join(', ')} permitted.`,
      'FORBIDDEN_PROTOCOL'
    );
  }

  // Disallow userinfo / embedded credentials (e.g. https://user:pass@evil.com)
  if (parsed.username || parsed.password) {
    throw new SsrfError('URLs containing user credentials/userinfo are strictly forbidden', 'EMBEDDED_CREDENTIALS');
  }

  // Port policy: HTTPS default allows only port 443 unless explicitly configured
  const allowedPorts = options.allowedPorts || (parsed.protocol === 'https:' ? [443] : [80]);
  const port = parsed.port ? parseInt(parsed.port, 10) : (parsed.protocol === 'https:' ? 443 : 80);
  if (isNaN(port) || !allowedPorts.includes(port)) {
    throw new SsrfError(`Forbidden explicit port '${parsed.port || port}'. Permitted ports: ${allowedPorts.join(', ')}`, 'FORBIDDEN_PORT');
  }

  let hostname = parsed.hostname.trim().toLowerCase();
  // Strip trailing dot if present (e.g., "example.com.")
  if (hostname.endsWith('.')) {
    hostname = hostname.slice(0, -1);
  }

  if (!hostname || hostname.length === 0 || hostname.length > 253) {
    throw new SsrfError('Invalid destination hostname length', 'INVALID_HOSTNAME');
  }

  // Metadata Hostnames
  if (METADATA_HOSTNAMES.has(hostname) || hostname.endsWith('.metadata.google.internal')) {
    throw new SsrfError('Access to cloud metadata endpoints is strictly blocked', 'CLOUD_METADATA_BLOCKED');
  }

  // Check explicit blocklist
  if (options.blockedHostnames?.some(b => b.toLowerCase() === hostname)) {
    throw new SsrfError(`Destination host '${hostname}' is on the security blocklist`, 'BLOCKED_HOSTNAME');
  }

  // Check explicit allowlist if configured
  if (options.allowedHostnames && options.allowedHostnames.length > 0) {
    const isExplicitlyAllowed = options.allowedHostnames.some(a => a.toLowerCase() === hostname);
    if (!isExplicitlyAllowed) {
      throw new SsrfError(`Destination host '${hostname}' is not in the approved hostname allowlist`, 'UNAPPROVED_HOSTNAME');
    }
  }

  // Localhost / Loopback String Check
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname === '[::1]' || hostname === '::1') {
    if (!options.allowPrivateForLocalDev) {
      throw new SsrfError('Loopback and localhost destinations are forbidden in production mode', 'LOOPBACK_FORBIDDEN');
    }
  }

  // Literal IP Address Checks
  const literalIp = net.isIP(hostname.replace(/^\[|\]$/g, '')) ? hostname.replace(/^\[|\]$/g, '') : parseAlternateIpv4(hostname);
  if (literalIp) {
    if (isPrivateOrRestrictedIp(literalIp)) {
      if (!options.allowPrivateForLocalDev) {
        throw new SsrfError(`Destination IP '${literalIp}' belongs to a private/restricted address range`, 'PRIVATE_IP_BLOCKED');
      }
    }
  }

  return parsed;
}

// -----------------------------------------------------------------------------
// DNS PINNING & SOCKET-BINDING RESOLVER
// -----------------------------------------------------------------------------

/**
 * Creates a custom DNS lookup resolver for Node.js http/https agents and socket connections.
 * Intercepts DNS resolution at the exact moment of socket creation, ensuring that:
 * 1. ALL resolved IP addresses (IPv4 and IPv6) are validated against private/restricted ranges.
 * 2. If ANY address is private/restricted, socket creation is aborted immediately before any network traffic.
 * 3. Sockets are pinned to the validated IP address, completely mitigating DNS Rebinding and TOCTOU attacks.
 * 4. TLS SNI and standard certificate hostname verification remain fully intact.
 */
export function createSsrfSafeLookup(options: SsrfValidationOptions = {}) {
  return function ssrfSafeLookup(
    hostname: string,
    lookupOptions: dns.LookupOptions,
    callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void
  ) {
    let normalizedHost = hostname.trim().toLowerCase();
    if (normalizedHost.endsWith('.')) {
      normalizedHost = normalizedHost.slice(0, -1);
    }

    // Direct cloud metadata host check
    if (METADATA_HOSTNAMES.has(normalizedHost) || normalizedHost.endsWith('.metadata.google.internal')) {
      const err: any = new Error('Destination resolves to cloud metadata host');
      err.code = 'SSRF_CLOUD_METADATA_BLOCKED';
      return callback(err, '', 4);
    }

    // Direct literal IP check
    const cleanLiteral = normalizedHost.replace(/^\[|\]$/g, '');
    const altIp = parseAlternateIpv4(cleanLiteral);
    const literalIp = net.isIP(cleanLiteral) ? cleanLiteral : (altIp && net.isIP(altIp) ? altIp : null);

    if (literalIp) {
      if (isPrivateOrRestrictedIp(literalIp) && !options.allowPrivateForLocalDev) {
        const err: any = new Error(`Literal destination IP '${literalIp}' is a private or restricted address`);
        err.code = 'SSRF_PRIVATE_IP_BLOCKED';
        return callback(err, '', 4);
      }
      const family = net.isIPv6(literalIp) ? 6 : 4;
      if (lookupOptions.all) {
        return callback(null, [{ address: literalIp, family }]);
      }
      return callback(null, literalIp, family);
    }

    // Resolve via system DNS with all records
    dns.lookup(normalizedHost, { all: true, verbatim: true }, (err, addresses) => {
      if (err) {
        return callback(err, '', 4);
      }
      if (!addresses || addresses.length === 0) {
        const noRecErr: any = new Error(`No IP addresses resolved for host '${normalizedHost}'`);
        noRecErr.code = 'ENOTFOUND';
        return callback(noRecErr, '', 4);
      }

      // Check EVERY resolved address: if ANY is private/restricted, reject entire host
      for (const record of addresses) {
        if (isPrivateOrRestrictedIp(record.address) && !options.allowPrivateForLocalDev) {
          const ssrfErr: any = new Error(
            `Host '${normalizedHost}' resolved to private/restricted IP '${record.address}'. Connection rejected.`
          );
          ssrfErr.code = 'SSRF_DNS_REBINDING_PREVENTED';
          return callback(ssrfErr, '', 4);
        }
      }

      // Return validated address(es) to the socket
      if (lookupOptions.all) {
        return callback(null, addresses);
      } else {
        return callback(null, addresses[0].address, addresses[0].family);
      }
    });
  };
}

/**
 * Standalone asynchronous DNS resolution validator.
 */
export async function resolveAndValidateDestination(
  hostname: string,
  options: SsrfValidationOptions = {}
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const lookup = createSsrfSafeLookup(options);
    lookup(hostname, { all: true }, (err, result) => {
      if (err) {
        if (err.code === 'SSRF_CLOUD_METADATA_BLOCKED') {
          return reject(new SsrfError(err.message, 'CLOUD_METADATA_BLOCKED'));
        }
        if (err.code === 'SSRF_PRIVATE_IP_BLOCKED') {
          return reject(new SsrfError(err.message, 'PRIVATE_IP_BLOCKED'));
        }
        if (err.code === 'SSRF_DNS_REBINDING_PREVENTED') {
          return reject(new SsrfError(err.message, 'DNS_REBINDING_PREVENTED'));
        }
        if (err.code === 'ENOTFOUND') {
          return reject(new SsrfError(err.message, 'DNS_NO_RECORDS'));
        }
        return reject(new SsrfError(`DNS resolution failed for host '${hostname}': ${err.message}`, 'DNS_RESOLUTION_FAILED'));
      }

      if (Array.isArray(result)) {
        return resolve(result.map(r => r.address));
      }
      return resolve([result as string]);
    });
  });
}

// -----------------------------------------------------------------------------
// HARDENED OUTBOUND HTTP/HTTPS CLIENT (SAFE EXTERNAL FETCH)
// -----------------------------------------------------------------------------

/**
 * Executes a hardened outbound HTTP/HTTPS request with complete SSRF, DNS-to-socket binding,
 * manual redirect re-validation, timeout abort, and response size bounding.
 */
export async function safeExternalFetch(
  targetUrl: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Buffer | Uint8Array;
    signal?: AbortSignal;
  } = {},
  options: SafeFetchOptions = {}
): Promise<{
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyText: string;
  bodyJson?: any;
  finalUrl: string;
}> {
  const timeoutMs = options.timeoutMs || 10000;
  const maxBytes = options.maxResponseBytes || 5 * 1024 * 1024; // 5 MB max response body
  const maxRedirects = options.maxRedirects !== undefined ? options.maxRedirects : 3;

  let currentUrl = targetUrl;
  let redirectCount = 0;

  while (true) {
    // 1. Validate Target URL with policy
    const parsedUrl = validateExternalUrl(currentUrl, options);

    // 2. Perform Single Request with Socket-Bound DNS Lookup
    const response = await executeSingleSafeRequest(parsedUrl, currentUrl, init, options, timeoutMs, maxBytes);

    // 3. Handle Redirects Manually with Recursive Re-validation
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      redirectCount++;
      if (redirectCount > maxRedirects) {
        throw new SsrfError(`Too many redirects (exceeded maximum limit of ${maxRedirects})`, 'EXCESSIVE_REDIRECTS');
      }

      const location = response.headers['location'] || response.headers['Location'];
      if (!location) {
        throw new SsrfError('Redirect response missing Location header', 'MALFORMED_REDIRECT');
      }

      // Resolve relative redirects against current URL
      let nextUrl: string;
      try {
        nextUrl = new URL(location, currentUrl).toString();
      } catch {
        throw new SsrfError(`Invalid redirect Location header '${location}'`, 'MALFORMED_REDIRECT');
      }

      // Pre-validate the next redirect URL before issuing any network connection
      validateExternalUrl(nextUrl, options);

      currentUrl = nextUrl;
      continue;
    }

    return response;
  }
}

/**
 * Internal single-hop HTTP/HTTPS request executor with socket DNS lookup interceptor.
 */
function executeSingleSafeRequest(
  parsedUrl: URL,
  currentUrl: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Buffer | Uint8Array;
    signal?: AbortSignal;
  },
  options: SafeFetchOptions,
  timeoutMs: number,
  maxBytes: number
): Promise<{
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyText: string;
  bodyJson?: any;
  finalUrl: string;
}> {
  return new Promise((resolve, reject) => {
    const isHttps = parsedUrl.protocol === 'https:';
    const transport = isHttps ? https : http;
    const customLookup = createSsrfSafeLookup(options);

    const port = parsedUrl.port ? parseInt(parsedUrl.port, 10) : (isHttps ? 443 : 80);
    const method = (init.method || options.method || 'GET').toUpperCase();

    const headers: Record<string, string> = {
      'Accept': '*/*',
      'User-Agent': 'ZdexCloud-Security-Client/1.0',
      ...(options.headers || {}),
      ...(init.headers || {})
    };

    let isAborted = false;
    let timer: NodeJS.Timeout | null = null;

    const requestOptions: https.RequestOptions = {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port,
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method,
      headers,
      lookup: customLookup,
      timeout: timeoutMs
    };

    const req = transport.request(requestOptions, (res) => {
      const responseHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers)) {
        if (v !== undefined) {
          responseHeaders[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
        }
      }

      const chunks: Buffer[] = [];
      let totalBytes = 0;

      res.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
          res.destroy();
          req.destroy();
          if (timer) clearTimeout(timer);
          return reject(new SsrfError(`Response payload exceeded maximum permitted size of ${maxBytes} bytes`, 'PAYLOAD_TOO_LARGE'));
        }
        chunks.push(chunk);
      });

      res.on('end', () => {
        if (timer) clearTimeout(timer);
        if (isAborted) return;

        const bodyBuffer = Buffer.concat(chunks);
        const bodyText = bodyBuffer.toString('utf-8');
        let bodyJson: any;

        const contentType = responseHeaders['content-type'] || '';
        if (contentType.includes('application/json') && bodyText.trim()) {
          try {
            bodyJson = JSON.parse(bodyText);
          } catch {
            // Non-fatal JSON parse error
          }
        }

        resolve({
          status: res.statusCode || 200,
          statusText: res.statusMessage || 'OK',
          headers: responseHeaders,
          bodyText,
          bodyJson,
          finalUrl: currentUrl
        });
      });

      res.on('error', (err) => {
        if (timer) clearTimeout(timer);
        reject(new SsrfError(`Response stream error: ${err.message}`, 'REQUEST_FAILED'));
      });
    });

    // Handle Request Timeout
    timer = setTimeout(() => {
      isAborted = true;
      req.destroy();
      reject(new SsrfError(`External request timed out after ${timeoutMs}ms`, 'REQUEST_TIMEOUT'));
    }, timeoutMs);

    // Support external AbortSignal
    if (init.signal) {
      if (init.signal.aborted) {
        if (timer) clearTimeout(timer);
        req.destroy();
        return reject(new SsrfError('External request was aborted by caller', 'REQUEST_ABORTED'));
      }
      init.signal.addEventListener('abort', () => {
        isAborted = true;
        if (timer) clearTimeout(timer);
        req.destroy();
        reject(new SsrfError('External request was aborted by caller', 'REQUEST_ABORTED'));
      });
    }

    req.on('timeout', () => {
      isAborted = true;
      if (timer) clearTimeout(timer);
      req.destroy();
      reject(new SsrfError(`External request socket timed out after ${timeoutMs}ms`, 'REQUEST_TIMEOUT'));
    });

    req.on('error', (err: any) => {
      if (timer) clearTimeout(timer);
      if (isAborted) return;

      if (err.code === 'SSRF_CLOUD_METADATA_BLOCKED') {
        return reject(new SsrfError(err.message, 'CLOUD_METADATA_BLOCKED'));
      }
      if (err.code === 'SSRF_PRIVATE_IP_BLOCKED') {
        return reject(new SsrfError(err.message, 'PRIVATE_IP_BLOCKED'));
      }
      if (err.code === 'SSRF_DNS_REBINDING_PREVENTED') {
        return reject(new SsrfError(err.message, 'DNS_REBINDING_PREVENTED'));
      }
      if (err.code === 'ENOTFOUND') {
        return reject(new SsrfError(`DNS resolution failed for host '${parsedUrl.hostname}'`, 'DNS_NO_RECORDS'));
      }

      reject(new SsrfError(`Safe external request failed: ${err.message}`, 'REQUEST_FAILED'));
    });

    // Write body if provided
    if (init.body) {
      req.write(init.body);
    }
    req.end();
  });
}
