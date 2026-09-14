/**
 * ZdexCloud Frontend Billing API Client
 * Phase 7.2A — Shared Billing Foundation & API Client
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. Zero Client Financial Authority: Transports requests and responses only. Never computes prices, taxes, discounts, or proration.
 * 2. Strict Authentication: Integrates with existing apiRequest() and auth.js session management.
 * 3. Exact Backend Endpoint Fidelity: Wraps only verified, existing backend routes. No invented endpoints.
 * 4. Razorpay Cancellation Safety: Does NOT expose or assume cancellation reversal (Razorpay cannot reverse cancelled subscriptions).
 * 5. Single-Flight Protection: In-flight Promise deduplication for mutating operations to prevent accidental double-submits.
 */
(function(root, factory) {
  'use strict';
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BillingAPI = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  // In-flight Promise cache for mutating request deduplication
  const _inFlightRequests = new Map();

  /**
   * Helper to execute apiRequest with single-flight deduplication for mutations
   * @param {string} endpoint
   * @param {string} method
   * @param {object|null} body
   * @param {boolean} deduplicate
   * @returns {Promise<{ok: boolean, status: number, data: any}>}
   */
  async function executeRequest(endpoint, method = 'GET', body = null, deduplicate = false) {
    // Resolve global apiRequest function provided by auth.js
    const requestFn = (typeof window !== 'undefined' && typeof window.apiRequest === 'function')
      ? window.apiRequest
      : (typeof apiRequest === 'function' ? apiRequest : null);

    if (!requestFn) {
      return {
        ok: false,
        status: 0,
        data: {
          success: false,
          error: {
            code: 'CLIENT_CONFIGURATION_ERROR',
            message: 'ZdexCloud API client (apiRequest) is not available in the current runtime.'
          }
        }
      };
    }

    const dedupeKey = deduplicate ? (method.toUpperCase() + ':' + endpoint + ':' + (body ? JSON.stringify(body) : '')) : null;

    if (dedupeKey && _inFlightRequests.has(dedupeKey)) {
      return _inFlightRequests.get(dedupeKey);
    }

    const requestPromise = (async () => {
      try {
        return await requestFn(endpoint, method, body);
      } catch (err) {
        return {
          ok: false,
          status: 0,
          data: {
            success: false,
            error: {
              code: 'NETWORK_ERROR',
              message: err && err.message ? err.message : 'Network communication failure.'
            }
          }
        };
      } finally {
        if (dedupeKey) {
          _inFlightRequests.delete(dedupeKey);
        }
      }
    })();

    if (dedupeKey) {
      _inFlightRequests.set(dedupeKey, requestPromise);
    }

    return requestPromise;
  }

  const BillingAPI = {
    // =========================================================================
    // PUBLIC / STOREFRONT ENDPOINTS
    // =========================================================================

    /**
     * Fetch non-authoritative storefront geolocation hint and detected currency.
     * Accessible by anonymous visitors and authenticated users.
     * Route: GET /api/v1/storefront/region
     * @returns {Promise<{ok: boolean, status: number, data: any}>}
     */
    async getStorefrontRegion() {
      return executeRequest('/storefront/region', 'GET');
    },

    /**
     * Fetch public pricing catalog for the detected or specified currency.
     * Route: GET /api/v1/plans?currency=INR|USD
     * @param {string} [currency] - 'INR' | 'USD'
     * @returns {Promise<{ok: boolean, status: number, data: any}>}
     */
    async getPlansCatalog(currency) {
      const query = currency ? ('?currency=' + encodeURIComponent(currency)) : '';
      return executeRequest('/plans' + query, 'GET');
    },

    /**
     * Fetch a specific plan's details by plan code.
     * Route: GET /api/v1/plans/:code?currency=INR|USD
     * @param {string} planCode - 'FREE' | 'PRO_MONTHLY' | 'PRO_YEARLY'
     * @param {string} [currency] - 'INR' | 'USD'
     * @returns {Promise<{ok: boolean, status: number, data: any}>}
     */
    async getPlan(planCode, currency) {
      if (!planCode) {
        return {
          ok: false,
          status: 400,
          data: { success: false, error: { code: 'VALIDATION_ERROR', message: 'planCode is required' } }
        };
      }
      const query = currency ? ('?currency=' + encodeURIComponent(currency)) : '';
      return executeRequest('/plans/' + encodeURIComponent(planCode) + query, 'GET');
    },

    // =========================================================================
    // AUTHENTICATED BILLING STATE & COUNTRY CONFIGURATION
    // =========================================================================

    /**
     * Fetch authoritative account billing state, active subscription summary, and entitlements.
     * Route: GET /api/v1/billing
     * @returns {Promise<{ok: boolean, status: number, data: any}>}
     */
    async getBillingState() {
      return executeRequest('/billing', 'GET');
    },

    /**
     * Confirm or update customer billing country and postal code.
     * Derives authoritative currency server-side.
     * Route: PUT /api/v1/billing/country
     * @param {string} country - ISO 3166-1 alpha-2 country code (e.g. 'IN', 'US')
     * @param {string} postalCode - Postal or ZIP code
     * @returns {Promise<{ok: boolean, status: number, data: any}>}
     */
    async confirmBillingCountry(country, postalCode) {
      if (!country || !postalCode) {
        return {
          ok: false,
          status: 400,
          data: { success: false, error: { code: 'VALIDATION_ERROR', message: 'country and postalCode are required' } }
        };
      }
      return executeRequest('/billing/country', 'PUT', { country, postalCode }, true);
    },

    // =========================================================================
    // CHECKOUT & PAYMENT SESSION INITIALIZATION
    // =========================================================================

    /**
     * Retrieve authoritative checkout price breakdown (base, tax, total) prior to checkout modal.
     * Route: GET /api/v1/billing/checkout/price-breakdown?planCode=...
     * @param {string} planCode - 'PRO_MONTHLY' | 'PRO_YEARLY'
     * @returns {Promise<{ok: boolean, status: number, data: any}>}
     */
    async getCheckoutPriceBreakdown(planCode) {
      if (!planCode) {
        return {
          ok: false,
          status: 400,
          data: { success: false, error: { code: 'VALIDATION_ERROR', message: 'planCode query parameter is required' } }
        };
      }
      return executeRequest('/billing/checkout/price-breakdown?planCode=' + encodeURIComponent(planCode), 'GET');
    },

    /**
     * Initialize a secure Razorpay checkout session and subscription order.
     * Route: POST /api/v1/billing/checkout/session
     * @param {string} planCode - 'PRO_MONTHLY' | 'PRO_YEARLY'
     * @returns {Promise<{ok: boolean, status: number, data: any}>}
     */
    async createCheckoutSession(planCode) {
      if (!planCode) {
        return {
          ok: false,
          status: 400,
          data: { success: false, error: { code: 'VALIDATION_ERROR', message: 'planCode is required' } }
        };
      }
      return executeRequest('/billing/checkout/session', 'POST', { planCode }, true);
    },

    // =========================================================================
    // SUBSCRIPTION LIFECYCLE MUTATIONS
    // =========================================================================

    /**
     * Upgrade active Pro Monthly subscription to Pro Yearly with backend proration credit.
     * Route: POST /api/v1/billing/subscription/upgrade
     * @param {string} [targetPlanCode='PRO_YEARLY']
     * @returns {Promise<{ok: boolean, status: number, data: any}>}
     */
    async upgradeSubscription(targetPlanCode = 'PRO_YEARLY') {
      return executeRequest('/billing/subscription/upgrade', 'POST', { targetPlanCode }, true);
    },

    /**
     * Schedule a Pro Yearly to Pro Monthly downgrade effective at cycle end.
     * Route: POST /api/v1/billing/subscription/downgrade
     * @param {string} [targetPlanCode='PRO_MONTHLY']
     * @returns {Promise<{ok: boolean, status: number, data: any}>}
     */
    async downgradeSubscription(targetPlanCode = 'PRO_MONTHLY') {
      return executeRequest('/billing/subscription/downgrade', 'POST', { targetPlanCode }, true);
    },

    /**
     * Cancel a pending subscription downgrade before it becomes effective at period end.
     * Route: POST /api/v1/billing/subscription/downgrade/cancel
     * @returns {Promise<{ok: boolean, status: number, data: any}>}
     */
    async cancelDowngrade() {
      return executeRequest('/billing/subscription/downgrade/cancel', 'POST', {}, true);
    },

    /**
     * Schedule subscription cancellation at period end.
     * Route: POST /api/v1/billing/subscription/cancel
     * @param {string} [reason] - Optional customer cancellation reason
     * @returns {Promise<{ok: boolean, status: number, data: any}>}
     */
    async cancelSubscription(reason) {
      const body = reason ? { reason } : {};
      return executeRequest('/billing/subscription/cancel', 'POST', body, true);
    },

    // =========================================================================
    // REFUNDS & CLAIMS
    // =========================================================================

    /**
     * Request a refund for a payment within the 7-day policy window.
     * Route: POST /api/v1/billing/refunds
     * @param {object} payload
     * @param {string} payload.paymentId - Authoritative Payment ID
     * @param {number} [payload.amountMinorUnits] - Amount in minor units (default: full)
     * @param {string} payload.reason - Reason code ('ACCIDENTAL_PURCHASE', 'TECHNICAL_FAILURE', 'CUSTOMER_SATISFACTION', 'OTHER')
     * @param {string} [payload.reasonDetails] - Additional customer comments
     * @param {string} [payload.idempotencyKey] - Unique client idempotency key
     * @param {boolean} [payload.terminateSubscription=true] - Whether to immediately revoke Pro tier
     * @returns {Promise<{ok: boolean, status: number, data: any}>}
     */
    async requestRefund(payload) {
      if (!payload || !payload.paymentId) {
        return {
          ok: false,
          status: 400,
          data: { success: false, error: { code: 'VALIDATION_ERROR', message: 'paymentId is required' } }
        };
      }
      return executeRequest('/billing/refunds', 'POST', payload, true);
    },

    /**
     * Retrieve status and details of a specific refund record.
     * Route: GET /api/v1/billing/refunds/:id
     * @param {string} refundId
     * @returns {Promise<{ok: boolean, status: number, data: any}>}
     */
    async getRefund(refundId) {
      if (!refundId) {
        return {
          ok: false,
          status: 400,
          data: { success: false, error: { code: 'VALIDATION_ERROR', message: 'refundId is required' } }
        };
      }
      return executeRequest('/billing/refunds/' + encodeURIComponent(refundId), 'GET');
    },

    /**
     * Retrieve all refund records associated with a specific payment.
     * Route: GET /api/v1/billing/payments/:id/refunds
     * @param {string} paymentId
     * @returns {Promise<{ok: boolean, status: number, data: any}>}
     */
    async getPaymentRefunds(paymentId) {
      if (!paymentId) {
        return {
          ok: false,
          status: 400,
          data: { success: false, error: { code: 'VALIDATION_ERROR', message: 'paymentId is required' } }
        };
      }
      return executeRequest('/billing/payments/' + encodeURIComponent(paymentId) + '/refunds', 'GET');
    },

    // =========================================================================
    // RECEIPTS & INVOICES
    // =========================================================================

    /**
     * List customer's billing receipts with pagination.
     * Route: GET /api/v1/billing/receipts?page=1&limit=20
     * @param {number} [page=1]
     * @param {number} [limit=20]
     * @returns {Promise<{ok: boolean, status: number, data: any}>}
     */
    async getReceipts(page = 1, limit = 20) {
      const p = Math.max(1, parseInt(page, 10) || 1);
      const l = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
      return executeRequest('/billing/receipts?page=' + p + '&limit=' + l, 'GET');
    },

    /**
     * Retrieve metadata and line items for a specific billing receipt.
     * Route: GET /api/v1/billing/receipts/:id
     * @param {string} receiptId
     * @returns {Promise<{ok: boolean, status: number, data: any}>}
     */
    async getReceipt(receiptId) {
      if (!receiptId) {
        return {
          ok: false,
          status: 400,
          data: { success: false, error: { code: 'VALIDATION_ERROR', message: 'receiptId is required' } }
        };
      }
      return executeRequest('/billing/receipts/' + encodeURIComponent(receiptId), 'GET');
    },

    /**
     * Retrieve receipt for a specific payment ID.
     * Route: GET /api/v1/billing/payments/:id/receipt
     * @param {string} paymentId
     * @returns {Promise<{ok: boolean, status: number, data: any}>}
     */
    async getPaymentReceipt(paymentId) {
      if (!paymentId) {
        return {
          ok: false,
          status: 400,
          data: { success: false, error: { code: 'VALIDATION_ERROR', message: 'paymentId is required' } }
        };
      }
      return executeRequest('/billing/payments/' + encodeURIComponent(paymentId) + '/receipt', 'GET');
    },

    /**
     * Retrieve raw HTML content of a receipt for browser modal or iframe viewing.
     * Route: GET /api/v1/billing/receipts/:id/html
     * @param {string} receiptId
     * @returns {Promise<{ok: boolean, status: number, html?: string, error?: any}>}
     */
    async getReceiptHtml(receiptId) {
      if (!receiptId) {
        return {
          ok: false,
          status: 400,
          error: { code: 'VALIDATION_ERROR', message: 'receiptId is required' }
        };
      }

      const token = (typeof window !== 'undefined' && window.AuthService && typeof window.AuthService.getAuthToken === 'function')
        ? window.AuthService.getAuthToken()
        : (typeof localStorage !== 'undefined' ? (localStorage.getItem('zdexcloud_token') || localStorage.getItem('rn_auth_token')) : null);

      const base = (typeof window !== 'undefined' && window.API_BASE_URL) ? window.API_BASE_URL : '/api/v1';
      const url = base + '/billing/receipts/' + encodeURIComponent(receiptId) + '/html';

      try {
        const headers = {};
        if (token) {
          headers['Authorization'] = 'Bearer ' + token;
        }
        const res = await fetch(url, { method: 'GET', headers });
        if (!res.ok) {
          return { ok: false, status: res.status, error: { code: 'FETCH_ERROR', message: 'Failed to retrieve receipt HTML.' } };
        }
        const html = await res.text();
        return { ok: true, status: res.status, html: html };
      } catch (err) {
        return {
          ok: false,
          status: 0,
          error: { code: 'NETWORK_ERROR', message: err && err.message ? err.message : 'Network error loading receipt.' }
        };
      }
    },

    /**
     * Trigger browser download for receipt HTML document attachment.
     * Route: GET /api/v1/billing/receipts/:id/download
     * @param {string} receiptId
     * @returns {Promise<{ok: boolean, status: number, error?: any}>}
     */
    async downloadReceipt(receiptId) {
      if (!receiptId) {
        return {
          ok: false,
          status: 400,
          error: { code: 'VALIDATION_ERROR', message: 'receiptId is required' }
        };
      }

      const token = (typeof window !== 'undefined' && window.AuthService && typeof window.AuthService.getAuthToken === 'function')
        ? window.AuthService.getAuthToken()
        : (typeof localStorage !== 'undefined' ? (localStorage.getItem('zdexcloud_token') || localStorage.getItem('rn_auth_token')) : null);

      const base = (typeof window !== 'undefined' && window.API_BASE_URL) ? window.API_BASE_URL : '/api/v1';
      const url = base + '/billing/receipts/' + encodeURIComponent(receiptId) + '/download';

      try {
        const headers = {};
        if (token) {
          headers['Authorization'] = 'Bearer ' + token;
        }
        const res = await fetch(url, { method: 'GET', headers });
        if (!res.ok) {
          return { ok: false, status: res.status, error: { code: 'DOWNLOAD_FAILED', message: 'Failed to download receipt.' } };
        }

        const blob = await res.blob();
        if (typeof window !== 'undefined' && typeof document !== 'undefined') {
          const downloadUrl = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = downloadUrl;
          a.download = 'receipt-' + receiptId + '.html';
          document.body.appendChild(a);
          a.click();
          a.remove();
          window.URL.revokeObjectURL(downloadUrl);
        }

        return { ok: true, status: 200 };
      } catch (err) {
        return {
          ok: false,
          status: 0,
          error: { code: 'NETWORK_ERROR', message: err && err.message ? err.message : 'Network error downloading receipt.' }
        };
      }
    }
  };

  return BillingAPI;
}));
