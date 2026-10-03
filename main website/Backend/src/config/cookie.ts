import { config } from './env.js';

export const CUSTOMER_SESSION_COOKIE_NAME = '__Host-zdex_session';
export const CUSTOMER_SESSION_COOKIE_PATH = '/';
export const CUSTOMER_SESSION_COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60; // 86400 seconds = 24 hours
export const CUSTOMER_SESSION_COOKIE_SAMESITE = 'lax' as const;
export const CUSTOMER_SESSION_COOKIE_HTTPONLY = true;

/**
 * Generates options for setting the __Host-zdex_session customer cookie.
 * RFC 6265bis __Host- prefix requirements:
 * 1. Must include Secure flag (enforced in production; in non-prod secure=true on https/localhost).
 * 2. Must have Path=/
 * 3. Must NOT specify Domain attribute.
 */
export function getCustomerSessionCookieOptions(isProduction = config.NODE_ENV === 'production') {
  return {
    path: CUSTOMER_SESSION_COOKIE_PATH,
    secure: true, // RFC 6265bis: __Host- prefix strictly requires Secure attribute across all environments
    httpOnly: CUSTOMER_SESSION_COOKIE_HTTPONLY,
    sameSite: CUSTOMER_SESSION_COOKIE_SAMESITE,
    maxAge: CUSTOMER_SESSION_COOKIE_MAX_AGE_SECONDS
  };
}

/**
 * Generates options for clearing the __Host-zdex_session customer cookie.
 */
export function getCustomerSessionCookieClearOptions(isProduction = config.NODE_ENV === 'production') {
  return {
    path: CUSTOMER_SESSION_COOKIE_PATH,
    secure: true, // RFC 6265bis: __Host- prefix strictly requires Secure attribute across all environments
    httpOnly: CUSTOMER_SESSION_COOKIE_HTTPONLY,
    sameSite: CUSTOMER_SESSION_COOKIE_SAMESITE,
    maxAge: 0
  };
}

// ---------------------------------------------------------------------------
// Administrator Browser Session Cookie Configuration (Phase 14.15)
// ---------------------------------------------------------------------------
export const ADMIN_SESSION_COOKIE_NAME = '__Host-zdex_admin_session';
export const ADMIN_SESSION_COOKIE_PATH = '/';
export const ADMIN_SESSION_COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60; // 86400 seconds = 24 hours
export const ADMIN_SESSION_COOKIE_SAMESITE = 'lax' as const;
export const ADMIN_SESSION_COOKIE_HTTPONLY = true;

/**
 * Generates options for setting the __Host-zdex_admin_session administrator cookie.
 * RFC 6265bis __Host- prefix requirements:
 * 1. Must include Secure flag (enforced across all environments).
 * 2. Must have Path=/
 * 3. Must NOT specify Domain attribute.
 */
export function getAdminSessionCookieOptions(isProduction = config.NODE_ENV === 'production') {
  return {
    path: ADMIN_SESSION_COOKIE_PATH,
    secure: true, // RFC 6265bis: __Host- prefix strictly requires Secure attribute
    httpOnly: ADMIN_SESSION_COOKIE_HTTPONLY,
    sameSite: ADMIN_SESSION_COOKIE_SAMESITE,
    maxAge: ADMIN_SESSION_COOKIE_MAX_AGE_SECONDS
  };
}

/**
 * Generates options for clearing the __Host-zdex_admin_session administrator cookie.
 */
export function getAdminSessionCookieClearOptions(isProduction = config.NODE_ENV === 'production') {
  return {
    path: ADMIN_SESSION_COOKIE_PATH,
    secure: true, // RFC 6265bis: __Host- prefix strictly requires Secure attribute
    httpOnly: ADMIN_SESSION_COOKIE_HTTPONLY,
    sameSite: ADMIN_SESSION_COOKIE_SAMESITE,
    maxAge: 0
  };
}

