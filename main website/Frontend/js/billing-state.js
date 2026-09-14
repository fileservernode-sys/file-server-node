/**
 * ZdexCloud Frontend Billing State & Presentation Layer
 * Phase 7.2A — Shared Billing Foundation & API Client
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. Four-Dimensional State Separation:
 *    - Plan (FREE, PRO_MONTHLY, PRO_YEARLY)
 *    - Subscription Status (FREE, CREATED, ACTIVE, PAST_DUE, GRACE_PERIOD, CANCELLING, EXPIRED, REFUNDED)
 *    - Entitlements ({ maxServers, priorityRelay })
 *    - Pending Actions ({ cancellation: boolean, downgrade: boolean })
 * 2. Zero Client Financial Authority: Display formatting only via integer minor units arithmetic.
 * 3. Server-Authoritative Refresh & Polling: In-memory reactive state with multi-tab storage notification signal.
 * 4. Error Sanitization: Normalizes backend error codes to user-friendly messages without leaking secrets.
 */
(function(root, factory) {
  'use strict';
  if (typeof define === 'function' && define.amd) {
    define(['./billing-api'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./billing-api'));
  } else {
    root.BillingState = factory(root.BillingAPI);
  }
}(typeof self !== 'undefined' ? self : this, function(BillingAPI) {
  'use strict';

  // State Change Event Identifier
  const STATE_CHANGED_EVENT = 'zdex:billing-state-changed';
  const MULTI_TAB_STORAGE_KEY = 'zdex_billing_refresh_ping';

  // Canonical Status Display Metadata (Zero Emojis, Pure Semantic Tokens & SVG/Lucide identifiers)
  const STATUS_CONFIG = {
    FREE: {
      label: 'Free Plan',
      variant: 'secondary',
      badgeClass: 'badge badge-secondary',
      icon: 'shield',
      description: 'Standard single-server community tier'
    },
    CREATED: {
      label: 'Pending Payment',
      variant: 'warning',
      badgeClass: 'badge badge-warning',
      icon: 'clock',
      description: 'Payment order created; awaiting gateway confirmation'
    },
    ACTIVE: {
      label: 'Active',
      variant: 'success',
      badgeClass: 'badge badge-success',
      icon: 'check-circle',
      description: 'Active subscription with recurring auto-renewal'
    },
    PAST_DUE: {
      label: 'Payment Past Due',
      variant: 'danger',
      badgeClass: 'badge badge-danger',
      icon: 'alert-triangle',
      description: 'Subscription payment failed; payment retry scheduled'
    },
    GRACE_PERIOD: {
      label: 'Grace Period',
      variant: 'warning',
      badgeClass: 'badge badge-warning',
      icon: 'alert-circle',
      description: 'Pro features active temporarily during grace period'
    },
    CANCELLING: {
      label: 'Cancelling at Period End',
      variant: 'warning',
      badgeClass: 'badge badge-warning',
      icon: 'calendar-x',
      description: 'Pro access remains active until the end of the paid billing period'
    },
    EXPIRED: {
      label: 'Expired',
      variant: 'secondary',
      badgeClass: 'badge badge-secondary',
      icon: 'x-circle',
      description: 'Subscription period completed; account returned to Free tier'
    },
    REFUNDED: {
      label: 'Refunded',
      variant: 'secondary',
      badgeClass: 'badge badge-secondary',
      icon: 'rotate-ccw',
      description: 'Subscription refunded; account returned to Free tier'
    }
  };

  // Plan Display Metadata
  const PLAN_CONFIG = {
    FREE: {
      name: 'Free',
      label: 'ZdexCloud Free',
      intervalLabel: 'Forever Free',
      maxServers: 1,
      priorityRelay: false,
      description: '1 Personal Android File Server with standard relay bandwidth'
    },
    PRO_MONTHLY: {
      name: 'Pro Monthly',
      label: 'ZdexCloud Pro Monthly',
      intervalLabel: 'Billed Monthly',
      maxServers: 5,
      priorityRelay: true,
      description: 'Up to 5 Android File Servers with Priority High-Speed Relay'
    },
    PRO_YEARLY: {
      name: 'Pro Yearly',
      label: 'ZdexCloud Pro Yearly',
      intervalLabel: 'Billed Annually',
      maxServers: 5,
      priorityRelay: true,
      description: 'Up to 5 Android File Servers with Priority High-Speed Relay (Annual discount)'
    }
  };

  // Customer-Safe Error Taxonomy Mapping
  const ERROR_MESSAGES = {
    UNAUTHORIZED: {
      message: 'Your session has expired. Please sign in again.',
      severity: 'error',
      retryable: false
    },
    COUNTRY_REQUIRED: {
      message: 'Please confirm your billing country before proceeding to checkout.',
      severity: 'warning',
      retryable: true
    },
    ACTIVE_SUBSCRIPTION_EXISTS: {
      message: 'Your account already has an active Pro subscription.',
      severity: 'warning',
      retryable: false
    },
    REFUND_WINDOW_EXPIRED: {
      message: 'Refund requests must be submitted within 7 days of the payment date.',
      severity: 'error',
      retryable: false
    },
    REFUND_ALREADY_PROCESSED: {
      message: 'A refund has already been processed for this payment.',
      severity: 'info',
      retryable: false
    },
    GATEWAY_RATE_LIMIT: {
      message: 'Too many requests. Please wait a moment before trying again.',
      severity: 'warning',
      retryable: true
    },
    PLAN_NOT_FOUND: {
      message: 'The requested plan catalog entry could not be found.',
      severity: 'error',
      retryable: false
    },
    VALIDATION_ERROR: {
      message: 'Invalid request data. Please check your inputs and try again.',
      severity: 'error',
      retryable: true
    },
    NETWORK_ERROR: {
      message: 'Unable to reach the billing server. Please check your connection.',
      severity: 'error',
      retryable: true
    }
  };

  // Internal In-Memory State Cache
  let _cachedState = null;
  const _listeners = new Set();

  /**
   * Normalizes the authoritative backend response from GET /api/v1/billing into a clean state object.
   * @param {object} apiData - The data payload returned by GET /api/v1/billing
   * @returns {object} Normalized Billing State
   */
  function normalizeBillingState(apiData) {
    if (!apiData || typeof apiData !== 'object') {
      return {
        plan: 'FREE',
        status: 'FREE',
        currency: 'INR',
        billingCountry: null,
        billingPostalCode: null,
        countryConfirmed: false,
        entitlements: {
          maxServers: 1,
          priorityRelay: false
        },
        subscription: null,
        pendingActions: {
          cancellation: false,
          downgrade: false
        },
        lastFetchedAt: new Date().toISOString()
      };
    }

    const sub = apiData.subscription || null;
    const isCancelling = sub ? Boolean(sub.cancelAtPeriodEnd) : false;
    const isDowngradePending = sub ? Boolean(sub.downgradePending || sub.pendingDowngrade) : false;

    // Resolve authoritative status
    let status = apiData.status || (sub ? sub.status : 'FREE');
    if (isCancelling && status === 'ACTIVE') {
      status = 'CANCELLING';
    }

    const planCode = apiData.plan || (sub ? sub.planCode : 'FREE');

    return {
      plan: planCode,
      status: status,
      currency: apiData.currency || 'INR',
      billingCountry: apiData.billingCountry || null,
      billingPostalCode: apiData.billingPostalCode || null,
      countryConfirmed: Boolean(apiData.countryConfirmed),
      entitlements: {
        maxServers: (apiData.entitlements && typeof apiData.entitlements.maxServers === 'number')
          ? apiData.entitlements.maxServers
          : (planCode.startsWith('PRO') ? 5 : 1),
        priorityRelay: (apiData.entitlements && typeof apiData.entitlements.priorityRelay === 'boolean')
          ? apiData.entitlements.priorityRelay
          : planCode.startsWith('PRO')
      },
      subscription: sub ? {
        id: sub.id,
        planCode: sub.planCode,
        planName: sub.planName,
        status: sub.status,
        billingInterval: sub.billingInterval,
        currency: sub.currency,
        amountMinorUnits: sub.amountMinorUnits,
        currentPeriodStart: sub.currentPeriodStart,
        currentPeriodEnd: sub.currentPeriodEnd,
        cancelAtPeriodEnd: Boolean(sub.cancelAtPeriodEnd),
        cancelledAt: sub.cancelledAt || null,
        gracePeriodEndsAt: sub.gracePeriodEndsAt || null,
        expiredAt: sub.expiredAt || null,
        refundedAt: sub.refundedAt || null
      } : null,
      pendingActions: {
        cancellation: isCancelling,
        downgrade: isDowngradePending
      },
      lastFetchedAt: new Date().toISOString()
    };
  }

  /**
   * Safe Integer Minor-Units Money Formatter (Display formatting only)
   * Converts integer paise/cents into standard formatted currency strings.
   * @param {number} minorUnits - Non-negative integer (e.g. 4900 paise or 99 cents)
   * @param {string} [currency='INR'] - 'INR' | 'USD'
   * @param {object} [options]
   * @param {boolean} [options.forceDecimals=false] - Force 2 decimal places for INR (e.g. ₹49.00)
   * @returns {string} Formatted currency string
   */
  function formatMinorUnits(minorUnits, currency = 'INR', options = {}) {
    const rawVal = parseInt(minorUnits, 10);
    const safeUnits = (isNaN(rawVal) || rawVal < 0) ? 0 : rawVal;
    const curr = (currency || 'INR').toUpperCase();

    if (curr === 'INR') {
      if (safeUnits === 0) return '₹0';
      if (!options.forceDecimals && safeUnits % 100 === 0) {
        return '₹' + (safeUnits / 100).toLocaleString('en-IN');
      }
      return '₹' + (safeUnits / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    if (curr === 'USD') {
      if (safeUnits === 0) return '$0';
      if (!options.forceDecimals && safeUnits % 100 === 0) {
        return '$' + (safeUnits / 100);
      }
      return '$' + (safeUnits / 100).toFixed(2);
    }

    // Generic fallback for other currencies
    return (safeUnits / 100).toFixed(2) + ' ' + curr;
  }

  /**
   * Authoritative Timestamp Formatter
   * Formats ISO 8601 strings into localized, accessible date strings.
   * @param {string|Date} isoDate
   * @param {object} [options]
   * @returns {string} Formatted date string
   */
  function formatBillingDate(isoDate, options = {}) {
    if (!isoDate) return 'N/A';
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return 'N/A';

    const defaultOptions = {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      ...options
    };

    try {
      return d.toLocaleDateString('en-US', defaultOptions);
    } catch {
      return d.toDateString();
    }
  }

  /**
   * Check if an authoritative date timestamp is past
   * @param {string|Date} isoDate
   * @returns {boolean}
   */
  function isDatePast(isoDate) {
    if (!isoDate) return false;
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return false;
    return d.getTime() < Date.now();
  }

  /**
   * Customer-Safe Error Normalizer
   * Extracts error codes safely and converts them into sanitized customer-facing messages.
   * @param {any} errorResponse - API response error object or Exception
   * @returns {{code: string, message: string, severity: string, retryable: boolean}}
   */
  function normalizeBillingError(errorResponse) {
    let code = 'NETWORK_ERROR';
    let rawMessage = '';

    if (errorResponse && errorResponse.data && errorResponse.data.error) {
      code = errorResponse.data.error.code || 'UNKNOWN_ERROR';
      rawMessage = errorResponse.data.error.message || '';
    } else if (errorResponse && errorResponse.error) {
      code = errorResponse.error.code || 'UNKNOWN_ERROR';
      rawMessage = errorResponse.error.message || '';
    } else if (errorResponse && errorResponse.code) {
      code = errorResponse.code;
      rawMessage = errorResponse.message || '';
    } else if (errorResponse instanceof Error) {
      rawMessage = errorResponse.message;
    }

    const mapping = ERROR_MESSAGES[code] || {
      message: rawMessage && rawMessage.length < 120 ? rawMessage : 'An unexpected billing error occurred. Please try again.',
      severity: 'error',
      retryable: false
    };

    return {
      code: code,
      message: mapping.message,
      severity: mapping.severity,
      retryable: mapping.retryable
    };
  }

  /**
   * Multi-Tab Synchronization: Listen to storage events to refresh state if another tab modified billing
   */
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('storage', function(e) {
      if (e.key === MULTI_TAB_STORAGE_KEY && e.newValue) {
        // Another tab signaled a billing modification; silently refresh authoritative state
        BillingState.refreshBillingState().catch(() => {});
      }
    });
  }

  const BillingState = {
    STATUS_CONFIG: STATUS_CONFIG,
    PLAN_CONFIG: PLAN_CONFIG,
    formatMinorUnits: formatMinorUnits,
    formatBillingDate: formatBillingDate,
    isDatePast: isDatePast,
    normalizeBillingState: normalizeBillingState,
    normalizeBillingError: normalizeBillingError,

    /**
     * Get the current in-memory cached state (or null if not yet fetched)
     * @returns {object|null}
     */
    getState() {
      return _cachedState;
    },

    /**
     * Subscribe to authoritative billing state change events
     * @param {function(object): void} listener
     * @returns {function(): void} Unsubscribe function
     */
    subscribe(listener) {
      if (typeof listener === 'function') {
        _listeners.add(listener);
        if (_cachedState) {
          try {
            listener(_cachedState);
          } catch (e) {
            console.warn('Error in billing state subscriber:', e);
          }
        }
      }
      return () => {
        _listeners.delete(listener);
      };
    },

    /**
     * Notify subscribers and dispatch DOM event
     * @param {object} newState
     */
    _notify(newState) {
      _cachedState = newState;

      _listeners.forEach(fn => {
        try {
          fn(newState);
        } catch (e) {
          console.warn('Error in billing state listener:', e);
        }
      });

      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent(STATE_CHANGED_EVENT, { detail: newState }));
      }
    },

    /**
     * Signals other open tabs that a billing state change occurred
     */
    broadcastChangeSignal() {
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(MULTI_TAB_STORAGE_KEY, Date.now().toString());
        } catch {}
      }
    },

    /**
     * Fetch authoritative billing state from backend, normalize, cache, and notify subscribers.
     * @returns {Promise<{ok: boolean, state: object, raw: any}>}
     */
    async refreshBillingState() {
      const client = BillingAPI || (typeof window !== 'undefined' ? window.BillingAPI : null);
      if (!client || typeof client.getBillingState !== 'function') {
        const fallback = normalizeBillingState(null);
        this._notify(fallback);
        return { ok: false, state: fallback, raw: null };
      }

      const res = await client.getBillingState();

      if (res.ok && res.data && res.data.success) {
        const normalized = normalizeBillingState(res.data.data);
        this._notify(normalized);
        return { ok: true, state: normalized, raw: res.data.data };
      }

      // If unauthorized, return clean unauthenticated/free fallback state
      if (res.status === 401) {
        const unauthState = normalizeBillingState(null);
        this._notify(unauthState);
        return { ok: false, state: unauthState, raw: res.data };
      }

      // Keep previous cached state if transient error occurred, otherwise default
      const stateToUse = _cachedState || normalizeBillingState(null);
      return { ok: false, state: stateToUse, raw: res.data };
    },

    /**
     * Generic Polling Helper for Asynchronous Webhook Processing / State Transitions
     * Polls GET /api/v1/billing until the predicate returns true or limits are exceeded.
     *
     * @param {function(object): boolean} predicate - Evaluates normalized state
     * @param {object} [options]
     * @param {number} [options.maxAttempts=10] - Maximum number of polling attempts
     * @param {number} [options.intervalMs=2000] - Interval between attempts in ms
     * @param {number} [options.timeoutMs=30000] - Total timeout limit in ms
     * @returns {Promise<{success: boolean, state: object, attempts: number}>}
     */
    async pollBillingStateUntil(predicate, options = {}) {
      if (typeof predicate !== 'function') {
        throw new Error('pollBillingStateUntil requires a predicate function.');
      }

      const maxAttempts = Math.max(1, parseInt(options.maxAttempts, 10) || 10);
      const intervalMs = Math.max(500, parseInt(options.intervalMs, 10) || 2000);
      const timeoutMs = Math.max(intervalMs, parseInt(options.timeoutMs, 10) || 30000);
      const startTime = Date.now();

      let attempts = 0;

      while (attempts < maxAttempts) {
        if (Date.now() - startTime > timeoutMs) {
          break;
        }

        attempts++;
        const refreshResult = await this.refreshBillingState();
        const currentState = refreshResult.state;

        try {
          if (predicate(currentState)) {
            this.broadcastChangeSignal();
            return {
              success: true,
              state: currentState,
              attempts: attempts
            };
          }
        } catch (e) {
          console.warn('Predicate evaluation error in billing polling:', e);
        }

        // Wait interval before next attempt if attempts remaining
        if (attempts < maxAttempts && (Date.now() - startTime + intervalMs) <= timeoutMs) {
          await new Promise(resolve => setTimeout(resolve, intervalMs));
        } else {
          break;
        }
      }

      return {
        success: false,
        state: _cachedState || normalizeBillingState(null),
        attempts: attempts
      };
    }
  };

  return BillingState;
}));
