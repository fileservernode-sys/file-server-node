import { getRazorpayConfig, assertRazorpayConfigured, RazorpayConfig } from '../../../../config/razorpay.js';
import { RazorpayProviderError } from './razorpay_error.js';
import { IPaymentProvider, PaymentProviderName } from '../types.js';

export interface RequestOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * Low-level authenticated HTTPS transport client for Razorpay API.
 * 
 * Strict Invariants:
 * 1. HTTPS only to official base URL https://api.razorpay.com/v1.
 * 2. Uses Basic Auth header constructed from backend secrets.
 * 3. Never logs credentials, Authorization headers, or key secrets.
 * 4. Applies request timeouts via AbortController.
 * 5. Does NOT expose high-level payment/subscription mutations (deferred to Phase 3.3+).
 */
export class RazorpayClient implements IPaymentProvider {
  public readonly name: PaymentProviderName = 'RAZORPAY';
  private readonly configOverrides?: { keyId?: string; keySecret?: string; baseUrl?: string; timeoutMs?: number };

  constructor(configOverrides?: { keyId?: string; keySecret?: string; baseUrl?: string; timeoutMs?: number }) {
    this.configOverrides = configOverrides;
  }

  public isConfigured(): boolean {
    const cfg = getRazorpayConfig(this.configOverrides);
    return cfg.isComplete;
  }

  public assertConfigured(): RazorpayConfig {
    return assertRazorpayConfigured(this.configOverrides);
  }

  /**
   * Internal authenticated HTTP request transport using standard fetch.
   */
  public async request<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    endpoint: string,
    body?: unknown,
    options?: RequestOptions
  ): Promise<T> {
    const cfg = this.assertConfigured();

    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const targetUrl = `${cfg.baseUrl}${normalizedEndpoint}`;

    // Ensure target URL is strict HTTPS
    if (!targetUrl.startsWith('https://') && !targetUrl.startsWith('http://localhost') && !targetUrl.startsWith('http://127.0.0.1')) {
      throw new RazorpayProviderError('NETWORK_ERROR', 'Razorpay API base URL must use HTTPS');
    }

    const timeoutMs = options?.timeoutMs || cfg.timeoutMs;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    const authHeader = 'Basic ' + Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString('base64');

    const headers: Record<string, string> = {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'ZdexCloud-Billing-Engine/1.0',
      ...(options?.headers || {})
    };

    try {
      const response = await fetch(targetUrl, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });

      clearTimeout(timeoutHandle);

      const contentType = response.headers.get('content-type') || '';
      const responseText = await response.text();

      let parsedData: any;
      if (contentType.includes('application/json') && responseText) {
        try {
          parsedData = JSON.parse(responseText);
        } catch {
          throw new RazorpayProviderError('INVALID_RESPONSE', 'Invalid JSON returned from Razorpay API');
        }
      } else {
        parsedData = responseText;
      }

      if (!response.ok) {
        const errorMsg = parsedData?.error?.description || parsedData?.error?.message || response.statusText || 'Razorpay API request failed';
        const errorCode = response.status === 401 ? 'AUTH_ERROR' : 'API_ERROR';
        throw new RazorpayProviderError(errorCode, `Razorpay API Error (${response.status}): ${errorMsg}`, {
          statusCode: response.status,
          details: { endpoint: normalizedEndpoint, status: response.status }
        });
      }

      return parsedData as T;
    } catch (err: any) {
      clearTimeout(timeoutHandle);

      if (err instanceof RazorpayProviderError) {
        throw err;
      }

      if (err.name === 'AbortError') {
        throw new RazorpayProviderError('TIMEOUT_ERROR', `Razorpay API request timed out after ${timeoutMs}ms`);
      }

      throw new RazorpayProviderError('NETWORK_ERROR', `Failed to communicate with Razorpay API: ${err.message}`);
    }
  }

  public async get<T = unknown>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('GET', endpoint, undefined, options);
  }

  public async post<T = unknown>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('POST', endpoint, body, options);
  }

  /**
   * Fetches an individual Plan entity by its Razorpay plan_id.
   * Calls GET /v1/plans/{planId}.
   */
  public async fetchPlan(planId: string, options?: RequestOptions): Promise<any> {
    if (!planId) {
      throw new RazorpayProviderError('VALIDATION_ERROR', 'planId is required to fetch plan');
    }
    return this.get<any>(`/plans/${planId}`, options);
  }

  /**
   * Fetches a paginated list of Plans from Razorpay.
   * Calls GET /v1/plans?count=...&skip=...
   */
  public async fetchPlans(
    params?: { count?: number; skip?: number; from?: number; to?: number },
    options?: RequestOptions
  ): Promise<{ entity: string; count: number; items: any[] }> {
    const queryParts: string[] = [];
    if (params?.count !== undefined) queryParts.push(`count=${encodeURIComponent(params.count)}`);
    if (params?.skip !== undefined) queryParts.push(`skip=${encodeURIComponent(params.skip)}`);
    if (params?.from !== undefined) queryParts.push(`from=${encodeURIComponent(params.from)}`);
    if (params?.to !== undefined) queryParts.push(`to=${encodeURIComponent(params.to)}`);

    const queryString = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';
    return this.get<{ entity: string; count: number; items: any[] }>(`/plans${queryString}`, options);
  }

  /**
   * Fetches all plans from Razorpay using pagination until all items are retrieved or maxItems reached.
   */
  public async fetchAllPlans(
    options?: { maxItems?: number; pageSize?: number } & RequestOptions
  ): Promise<any[]> {
    const pageSize = options?.pageSize || 100;
    const maxItems = options?.maxItems || 1000;
    const allItems: any[] = [];
    let skip = 0;

    while (allItems.length < maxItems) {
      const response = await this.fetchPlans(
        { count: pageSize, skip },
        options
      );

      const items = response?.items || [];
      if (items.length === 0) {
        break;
      }

      allItems.push(...items);

      if (items.length < pageSize || (response.count !== undefined && allItems.length >= response.count)) {
        break;
      }

      skip += items.length;
    }

    return allItems.slice(0, maxItems);
  }

  /**
   * Creates a Subscription on Razorpay.
   * Calls POST /v1/subscriptions.
   */
  public async createSubscription(
    params: RazorpayCreateSubscriptionParams,
    options?: RequestOptions
  ): Promise<RazorpaySubscriptionResponse> {
    if (!params || !params.plan_id) {
      throw new RazorpayProviderError('VALIDATION_ERROR', 'plan_id is required to create a subscription');
    }
    if (!params.total_count || params.total_count < 1) {
      throw new RazorpayProviderError('VALIDATION_ERROR', 'total_count must be at least 1');
    }
    return this.post<RazorpaySubscriptionResponse>('/subscriptions', params, options);
  }

  /**
   * Fetches a Subscription by its provider ID.
   * Calls GET /v1/subscriptions/{subscriptionId}.
   */
  public async fetchSubscription(
    subscriptionId: string,
    options?: RequestOptions
  ): Promise<RazorpaySubscriptionResponse> {
    if (!subscriptionId) {
      throw new RazorpayProviderError('VALIDATION_ERROR', 'subscriptionId is required to fetch subscription');
    }
    return this.get<RazorpaySubscriptionResponse>(`/subscriptions/${subscriptionId}`, options);
  }

  /**
   * Cancels an active Subscription on Razorpay.
   * Calls POST /v1/subscriptions/{subscriptionId}/cancel.
   * Default cancel_at_cycle_end is 1 (cancel at the end of the current billing cycle).
   */
  public async cancelSubscription(
    subscriptionId: string,
    params: { cancel_at_cycle_end?: 0 | 1 } = { cancel_at_cycle_end: 1 },
    options?: RequestOptions
  ): Promise<RazorpaySubscriptionResponse> {
    if (!subscriptionId) {
      throw new RazorpayProviderError('VALIDATION_ERROR', 'subscriptionId is required to cancel subscription');
    }
    return this.post<RazorpaySubscriptionResponse>(`/subscriptions/${subscriptionId}/cancel`, params, options);
  }

  /**
   * Updates an active Subscription on Razorpay (e.g. plan change / upgrade).
   * Calls PATCH /v1/subscriptions/{subscriptionId}.
   */
  public async updateSubscription(
    subscriptionId: string,
    params: {
      plan_id: string;
      schedule_change_at?: 'now' | 'cycle_end';
      customer_notify?: 0 | 1;
      quantity?: number;
      remaining_count?: number;
      start_at?: number;
    },
    options?: RequestOptions
  ): Promise<RazorpaySubscriptionResponse> {
    if (!subscriptionId) {
      throw new RazorpayProviderError('VALIDATION_ERROR', 'subscriptionId is required to update subscription');
    }
    if (!params || !params.plan_id) {
      throw new RazorpayProviderError('VALIDATION_ERROR', 'plan_id is required to update subscription');
    }
    return this.request<RazorpaySubscriptionResponse>(
      'PATCH',
      `/subscriptions/${subscriptionId}`,
      params,
      options
    );
  }

  /**
   * Cancels scheduled changes on an active Subscription on Razorpay.
   * Calls POST /v1/subscriptions/{subscriptionId}/cancel_scheduled_changes.
   */
  public async cancelScheduledChanges(
    subscriptionId: string,
    options?: RequestOptions
  ): Promise<RazorpaySubscriptionResponse> {
    if (!subscriptionId) {
      throw new RazorpayProviderError('VALIDATION_ERROR', 'subscriptionId is required to cancel scheduled changes');
    }
    return this.post<RazorpaySubscriptionResponse>(`/subscriptions/${subscriptionId}/cancel_scheduled_changes`, {}, options);
  }

  /**
   * Creates a refund for a payment on Razorpay.
   * Calls POST /v1/payments/{paymentId}/refund.
   */
  public async createRefund(
    paymentId: string,
    params?: RazorpayCreateRefundParams,
    options?: RequestOptions & { idempotencyKey?: string }
  ): Promise<RazorpayRefundResponse> {
    if (!paymentId) {
      throw new RazorpayProviderError('VALIDATION_ERROR', 'paymentId is required to create a refund');
    }
    const headers: Record<string, string> = { ...(options?.headers || {}) };
    if (options?.idempotencyKey) {
      headers['X-Refund-Idempotency'] = options.idempotencyKey;
    }
    return this.post<RazorpayRefundResponse>(
      `/payments/${paymentId}/refund`,
      params || {},
      { ...options, headers }
    );
  }

  /**
   * Fetches an individual Refund entity by its Razorpay refund_id.
   * Calls GET /v1/refunds/{refundId}.
   */
  public async fetchRefund(refundId: string, options?: RequestOptions): Promise<RazorpayRefundResponse> {
    if (!refundId) {
      throw new RazorpayProviderError('VALIDATION_ERROR', 'refundId is required to fetch refund');
    }
    return this.get<RazorpayRefundResponse>(`/refunds/${refundId}`, options);
  }

  /**
   * Fetches refunds for a specific payment from Razorpay.
   * Calls GET /v1/payments/{paymentId}/refunds.
   */
  public async fetchPaymentRefunds(
    paymentId: string,
    options?: RequestOptions
  ): Promise<{ entity: string; count: number; items: RazorpayRefundResponse[] }> {
    if (!paymentId) {
      throw new RazorpayProviderError('VALIDATION_ERROR', 'paymentId is required to fetch payment refunds');
    }
    return this.get<{ entity: string; count: number; items: RazorpayRefundResponse[] }>(
      `/payments/${paymentId}/refunds`,
      options
    );
  }

  /**
   * Fetches an individual Payment entity by its Razorpay payment_id.
   * Calls GET /v1/payments/{paymentId}.
   */
  public async fetchPayment(paymentId: string, options?: RequestOptions): Promise<any> {
    if (!paymentId) {
      throw new RazorpayProviderError('VALIDATION_ERROR', 'paymentId is required to fetch payment');
    }
    return this.get<any>(`/payments/${paymentId}`, options);
  }

  /**
   * Fetches an individual Settlement entity by its Razorpay settlement_id.
   * Calls GET /v1/settlements/{settlementId}.
   */
  public async fetchSettlement(settlementId: string, options?: RequestOptions): Promise<any> {
    if (!settlementId) {
      throw new RazorpayProviderError('VALIDATION_ERROR', 'settlementId is required to fetch settlement');
    }
    return this.get<any>(`/settlements/${settlementId}`, options);
  }

  /**
   * Fetches a paginated list of Settlements from Razorpay.
   * Calls GET /v1/settlements?count=...&skip=...&from=...&to=...
   */
  public async fetchSettlements(
    params?: { count?: number; skip?: number; from?: number; to?: number },
    options?: RequestOptions
  ): Promise<{ entity: string; count: number; items: any[] }> {
    const queryParts: string[] = [];
    if (params?.count !== undefined) queryParts.push(`count=${encodeURIComponent(params.count)}`);
    if (params?.skip !== undefined) queryParts.push(`skip=${encodeURIComponent(params.skip)}`);
    if (params?.from !== undefined) queryParts.push(`from=${encodeURIComponent(params.from)}`);
    if (params?.to !== undefined) queryParts.push(`to=${encodeURIComponent(params.to)}`);

    const queryString = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';
    return this.get<{ entity: string; count: number; items: any[] }>(`/settlements${queryString}`, options);
  }

  /**
   * Fetches combined settlement & transaction reconciliation records from Razorpay.
   * Calls GET /v1/settlements/recon/combined?year=...&month=...&day=... OR from/to timestamps.
   */
  public async fetchCombinedReconRecords(
    params?: {
      year?: number;
      month?: number;
      day?: number;
      from?: number;
      to?: number;
      count?: number;
      skip?: number;
    },
    options?: RequestOptions
  ): Promise<{ entity: string; count: number; items: any[] }> {
    const queryParts: string[] = [];
    if (params?.year !== undefined) queryParts.push(`year=${encodeURIComponent(params.year)}`);
    if (params?.month !== undefined) queryParts.push(`month=${encodeURIComponent(params.month)}`);
    if (params?.day !== undefined) queryParts.push(`day=${encodeURIComponent(params.day)}`);
    if (params?.from !== undefined) queryParts.push(`from=${encodeURIComponent(params.from)}`);
    if (params?.to !== undefined) queryParts.push(`to=${encodeURIComponent(params.to)}`);
    if (params?.count !== undefined) queryParts.push(`count=${encodeURIComponent(params.count)}`);
    if (params?.skip !== undefined) queryParts.push(`skip=${encodeURIComponent(params.skip)}`);

    const queryString = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';
    return this.get<{ entity: string; count: number; items: any[] }>(
      `/settlements/recon/combined${queryString}`,
      options
    );
  }
}

export interface RazorpayCreateSubscriptionParams {
  plan_id: string;
  total_count: number;
  quantity?: number;
  start_at?: number;
  expire_by?: number;
  customer_notify?: 0 | 1;
  notes?: Record<string, string>;
}

export interface RazorpaySubscriptionResponse {
  id: string;
  entity?: string;
  plan_id: string;
  status: string;
  current_start?: number | null;
  current_end?: number | null;
  ended_at?: number | null;
  quantity?: number;
  notes?: Record<string, string>;
  charge_at?: number | null;
  start_at?: number | null;
  end_at?: number | null;
  auth_attempts?: number;
  total_count?: number;
  paid_count?: number;
  remaining_count?: number;
  customer_notify?: boolean | number;
  created_at?: number;
  [key: string]: any;
}

export interface RazorpayCreateRefundParams {
  amount?: number; // Amount in minor units (e.g. paise)
  reverse_all?: 0 | 1;
  speed?: 'normal' | 'optimum';
  notes?: Record<string, string>;
  receipt?: string;
}

export interface RazorpayRefundResponse {
  id: string;
  entity?: string;
  amount: number;
  currency: string;
  payment_id: string;
  notes?: Record<string, string>;
  receipt?: string;
  acquirer_data?: Record<string, any>;
  created_at: number;
  batch_id?: string | null;
  status: string; // 'processed', 'pending', 'failed'
  speed_processed?: string;
  speed_requested?: string;
  [key: string]: any;
}


