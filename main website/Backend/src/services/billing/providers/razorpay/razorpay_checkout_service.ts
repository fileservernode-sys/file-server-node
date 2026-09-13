import { prisma } from '../../../../config/database.js';
import {
  BillingStatus,
  BillingInterval,
  CurrencyCode,
  PaymentProvider,
  PaymentEnvironment,
  AuditEventType,
  Plan,
  PlanPrice,
  Subscription
} from '@prisma/client';
import { RazorpayClient, RazorpaySubscriptionResponse } from './razorpay_client.js';
import { RazorpayPlanCatalogService } from './razorpay_plan_catalog_service.js';
import { RazorpayProviderError } from './razorpay_error.js';
import { BillingStateService, PAID_ENTITLED_STATUSES } from '../../billing_state_service.js';
import { BillingCountryService } from '../../billing_country_service.js';
import { PriceFormatter } from '../../pricing_catalog_service.js';
import { ValidationError, NotFoundError, ConflictError } from '../../../../errors/app-error.js';

export interface CreateCheckoutSessionParams {
  planCode: string;
}

export interface CheckoutPriceBreakdownTax {
  included: boolean;
  formattedAmount: string;
}

export interface CheckoutPriceBreakdownFees {
  amountMinorUnits: number;
  formattedAmount: string;
}

export interface CheckoutPriceBreakdownSavings {
  amountMinorUnits: number;
  formattedAmount: string;
  percentage: number;
  annualizedMonthlyMinorUnits: number;
  formattedAnnualizedMonthly: string;
}

export interface CheckoutPriceBreakdownRenewal {
  interval: BillingInterval;
  formattedAmount: string;
  notice: string;
}

export interface PriceBreakdownResult {
  planCode: string;
  planName: string;
  interval: BillingInterval;
  billingCountry: string;
  currency: CurrencyCode;
  amountMinorUnits: number;
  formattedAmount: string;
  priceVersion: number;
  savings: CheckoutPriceBreakdownSavings | null;
  tax: CheckoutPriceBreakdownTax;
  fees: CheckoutPriceBreakdownFees;
  totalMinorUnits: number;
  formattedTotal: string;
  renewal: CheckoutPriceBreakdownRenewal;
}

export interface CheckoutSessionResult {
  keyId: string;
  subscriptionId: string;
  planCode: string;
  interval: BillingInterval;
  currency: CurrencyCode;
  amountMinorUnits: number;
  formattedAmount: string;
  billingCountry: string;
}

export interface CheckoutOptions {
  client?: RazorpayClient;
  environment?: PaymentEnvironment;
  logger?: {
    info: (msg: string, ...args: any[]) => void;
    warn: (msg: string, ...args: any[]) => void;
    error: (msg: string, ...args: any[]) => void;
  };
}

class KeyedMutex {
  private locks = new Map<string, Promise<void>>();

  public async runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    while (this.locks.has(key)) {
      await this.locks.get(key);
    }

    let release: () => void = () => {};
    const lockPromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(key, lockPromise);

    try {
      return await fn();
    } finally {
      this.locks.delete(key);
      release();
    }
  }
}

const checkoutMutex = new KeyedMutex();

export class RazorpayCheckoutService {
  /**
   * Authoritatively calculates the complete checkout price breakdown for an authenticated user.
   * 
   * Strict Invariants:
   * 1. Requires authenticated user with confirmed billing country.
   * 2. Authoritatively resolves currency: IN -> INR, non-IN -> USD.
   * 3. Resolves exact PlanPrice and version from internal catalog.
   * 4. Computes integer minor units arithmetic for base price, savings, and total.
   * 5. DOES NOT call Razorpay API, create subscriptions, or modify database state.
   */
  public static async getPriceBreakdown(
    userId: string,
    planCode: string
  ): Promise<PriceBreakdownResult> {
    if (!userId) {
      throw new ValidationError('userId is required');
    }

    if (!planCode) {
      throw new ValidationError('planCode is required');
    }

    const normalizedPlanCode = planCode.trim().toUpperCase();

    if (normalizedPlanCode === 'FREE') {
      throw new ValidationError('FREE plan tier cannot enter paid checkout flow');
    }

    if (normalizedPlanCode !== 'PRO_MONTHLY' && normalizedPlanCode !== 'PRO_YEARLY') {
      throw new ValidationError(`Unsupported planCode '${planCode}'. Must be PRO_MONTHLY or PRO_YEARLY`);
    }

    // 1. Verify user exists
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundError('User account not found');
    }

    // 2. Authoritative Billing Country & Currency Verification
    const billingState = await BillingStateService.getBillingState(userId);

    if (!billingState.billingCountry) {
      throw new ValidationError(
        'Billing country must be confirmed before viewing price breakdown. Please update your billing region in account settings.'
      );
    }

    const authoritativeCurrency = BillingCountryService.deriveBillingCurrency(billingState.billingCountry);

    // 3. Resolve Authoritative Plan and PlanPrice
    const plan = await prisma.plan.findUnique({
      where: { code: normalizedPlanCode },
      include: { prices: true }
    });

    if (!plan || !plan.isActive) {
      throw new NotFoundError(`Active plan '${normalizedPlanCode}' not found`);
    }

    const planPrice = plan.prices.find(
      (p) => p.currency === authoritativeCurrency && p.isActive && p.version === 1
    ) || plan.prices
      .filter((p) => p.currency === authoritativeCurrency && p.isActive)
      .sort((a, b) => b.version - a.version)[0];

    if (!planPrice) {
      throw new NotFoundError(
        `Active PlanPrice not found for plan '${normalizedPlanCode}' and currency '${authoritativeCurrency}'`
      );
    }

    const amountMinorUnits = planPrice.amountMinorUnits;
    const formattedAmount = PriceFormatter.format(amountMinorUnits, authoritativeCurrency);

    // 4. Calculate Savings for Yearly Plans (Integer Minor Units Arithmetic)
    let savings: CheckoutPriceBreakdownSavings | null = null;
    if (plan.interval === BillingInterval.YEARLY) {
      const monthlyPlan = await prisma.plan.findUnique({
        where: { code: 'PRO_MONTHLY' },
        include: { prices: true }
      });

      if (monthlyPlan) {
        const monthlyPrice = monthlyPlan.prices.find(
          (p) => p.currency === authoritativeCurrency && p.isActive && p.version === 1
        ) || monthlyPlan.prices
          .filter((p) => p.currency === authoritativeCurrency && p.isActive)
          .sort((a, b) => b.version - a.version)[0];

        if (monthlyPrice) {
          const annualizedMonthly = monthlyPrice.amountMinorUnits * 12;
          const savingsUnits = Math.max(0, annualizedMonthly - planPrice.amountMinorUnits);
          const percentage = annualizedMonthly > 0 ? Math.round((savingsUnits / annualizedMonthly) * 100) : 0;
          savings = {
            amountMinorUnits: savingsUnits,
            formattedAmount: PriceFormatter.format(savingsUnits, authoritativeCurrency),
            percentage,
            annualizedMonthlyMinorUnits: annualizedMonthly,
            formattedAnnualizedMonthly: PriceFormatter.format(annualizedMonthly, authoritativeCurrency)
          };
        }
      }
    }

    // 5. Tax Breakdown
    const isIndia = authoritativeCurrency === CurrencyCode.INR || billingState.billingCountry === 'IN';
    const tax: CheckoutPriceBreakdownTax = {
      included: isIndia,
      formattedAmount: isIndia ? 'Included in price' : 'Calculated at checkout'
    };

    // 6. Zero Processing/Gateway Fees Charged to Customer
    const fees: CheckoutPriceBreakdownFees = {
      amountMinorUnits: 0,
      formattedAmount: PriceFormatter.format(0, authoritativeCurrency)
    };

    // 7. Total Payable Amount
    const totalMinorUnits = amountMinorUnits;
    const formattedTotal = formattedAmount;

    // 8. Renewal Terms
    const isYearly = plan.interval === BillingInterval.YEARLY;
    const renewal: CheckoutPriceBreakdownRenewal = {
      interval: plan.interval,
      formattedAmount: formattedTotal,
      notice: isYearly
        ? `Renews annually at ${formattedTotal}/year until cancelled`
        : `Renews monthly at ${formattedTotal}/month until cancelled`
    };

    return {
      planCode: plan.code,
      planName: plan.name,
      interval: plan.interval,
      billingCountry: billingState.billingCountry,
      currency: authoritativeCurrency,
      amountMinorUnits,
      formattedAmount,
      priceVersion: planPrice.version,
      savings,
      tax,
      fees,
      totalMinorUnits,
      formattedTotal,
      renewal
    };
  }

  /**
   * Initializes a secure, backend-authoritative checkout session and Razorpay Subscription.
   * Serialized per userId via in-memory mutex to eliminate race conditions under concurrent requests.
   * 
   * Strict Invariants:
   * 1. Requires authenticated user with confirmed billing country.
   * 2. Authoritatively resolves currency: IN -> INR, non-IN -> USD.
   * 3. Resolves exact PlanPrice and verified BillingProviderPlanMapping.
   * 4. Prevents duplicate checkouts for accounts with existing active subscriptions.
   * 5. Reuses unresolved CREATED checkout for exact same plan/currency within 1 hour.
   * 6. Persists Subscription in pre-activation status (BillingStatus.CREATED).
   * 7. DOES NOT activate AccountBillingState or upgrade technical entitlements.
   * 8. Returns only public keyId and subscriptionId; secrets are never returned.
   */
  public static async createCheckoutSession(
    userId: string,
    params: CreateCheckoutSessionParams,
    options?: CheckoutOptions
  ): Promise<CheckoutSessionResult> {
    if (!userId) {
      throw new ValidationError('userId is required');
    }

    if (!params || !params.planCode) {
      throw new ValidationError('planCode is required');
    }

    const normalizedPlanCode = params.planCode.trim().toUpperCase();

    if (normalizedPlanCode === 'FREE') {
      throw new ValidationError('FREE plan tier cannot enter paid checkout flow');
    }

    if (normalizedPlanCode !== 'PRO_MONTHLY' && normalizedPlanCode !== 'PRO_YEARLY') {
      throw new ValidationError(`Unsupported planCode '${params.planCode}'. Must be PRO_MONTHLY or PRO_YEARLY`);
    }

    return checkoutMutex.runExclusive(userId, async () => {
      // 1. Verify user exists
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        throw new NotFoundError('User account not found');
      }

      // 2. Authoritative Billing Country & Currency Verification
      const billingState = await BillingStateService.getBillingState(userId);

      if (!billingState.billingCountry) {
        throw new ValidationError(
          'Billing country must be confirmed before initiating checkout. Please update your billing region in account settings.'
        );
      }

      const authoritativeCurrency = BillingCountryService.deriveBillingCurrency(billingState.billingCountry);

      // 3. Existing Active Subscription Protection
      const existingActiveSub = await BillingStateService.getActiveSubscription(userId);
      if (existingActiveSub && PAID_ENTITLED_STATUSES.has(existingActiveSub.status)) {
        throw new ConflictError(
          'Account already has an active subscription. Manage or cancel your existing subscription before purchasing a new one.'
        );
      }

      const directPaidSub = await prisma.subscription.findFirst({
        where: {
          userId,
          status: { in: Array.from(PAID_ENTITLED_STATUSES) }
        }
      });
      if (directPaidSub) {
        throw new ConflictError(
          'Account already has an active subscription. Manage or cancel your existing subscription before purchasing a new one.'
        );
      }

      if (billingState.status === BillingStatus.ACTIVE) {
        throw new ConflictError('Account is already on an active plan.');
      }

      // 4. Resolve Authoritative Plan and PlanPrice
      const plan = await prisma.plan.findUnique({
        where: { code: normalizedPlanCode },
        include: { prices: true }
      });

      if (!plan || !plan.isActive) {
        throw new NotFoundError(`Active plan '${normalizedPlanCode}' not found`);
      }

      const planPrice = plan.prices.find(
        (p) => p.currency === authoritativeCurrency && p.isActive && p.version === 1
      ) || plan.prices
        .filter((p) => p.currency === authoritativeCurrency && p.isActive)
        .sort((a, b) => b.version - a.version)[0];

      if (!planPrice) {
        throw new NotFoundError(
          `Active PlanPrice not found for plan '${normalizedPlanCode}' and currency '${authoritativeCurrency}'`
        );
      }

      // 5. Resolve Verified Provider Plan Mapping
      const environment = options?.environment || RazorpayPlanCatalogService.resolvePaymentEnvironment();

      const mapping = await prisma.billingProviderPlanMapping.findUnique({
        where: {
          provider_environment_planPriceId: {
            provider: PaymentProvider.RAZORPAY,
            environment,
            planPriceId: planPrice.id
          }
        }
      });

      if (!mapping || !mapping.isActive || !mapping.providerPlanId) {
        throw new RazorpayProviderError(
          'CATALOG_INCOMPLETE',
          `No active Razorpay plan mapping found for '${normalizedPlanCode}' (${authoritativeCurrency}) in environment '${environment}'. Please ensure catalog synchronization has run.`
        );
      }

      if (mapping.currency !== planPrice.currency || mapping.amountMinorUnits !== planPrice.amountMinorUnits) {
        throw new RazorpayProviderError(
          'MAPPING_CONFLICT',
          `Local provider plan mapping '${mapping.id}' has conflicting price attributes with PlanPrice '${planPrice.id}'`
        );
      }

      // 6. Idempotency & Pending Checkout Protection (Same Plan & Currency within 1 hour)
      const existingPending = await prisma.subscription.findFirst({
        where: {
          userId: user.id,
          planPriceId: planPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: environment,
          status: BillingStatus.CREATED,
          createdAt: {
            gt: new Date(Date.now() - 3600 * 1000) // 1-hour pending window
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      const client = options?.client || new RazorpayClient();
      const rzpConfig = client.assertConfigured();

      if (existingPending && existingPending.providerSubscriptionId) {
        options?.logger?.info(
          `[RazorpayCheckout] Reusing pending checkout session ${existingPending.providerSubscriptionId} for user ${user.id}`
        );
        return {
          keyId: rzpConfig.keyId,
          subscriptionId: existingPending.providerSubscriptionId,
          planCode: plan.code,
          interval: plan.interval,
          currency: planPrice.currency,
          amountMinorUnits: planPrice.amountMinorUnits,
          formattedAmount: PriceFormatter.format(planPrice.amountMinorUnits, planPrice.currency),
          billingCountry: billingState.billingCountry
        };
      }

      // 7. Create Razorpay Subscription via API
      // Total count: 120 cycles for monthly (10 years), 10 cycles for yearly (10 years)
      const totalCount = plan.interval === BillingInterval.YEARLY ? 10 : 120;

      const notes: Record<string, string> = {
        zdexcloud_user_id: user.id,
        zdexcloud_plan_id: plan.id,
        zdexcloud_plan_price_id: planPrice.id,
        zdexcloud_price_version: String(planPrice.version),
        zdexcloud_environment: environment
      };

      const payload = {
        plan_id: mapping.providerPlanId,
        total_count: totalCount,
        quantity: 1,
        customer_notify: 1 as const,
        notes
      };

      options?.logger?.info(
        `[RazorpayCheckout] Creating Razorpay Subscription for user ${user.id} -> ${plan.code} (${planPrice.currency}) [${environment}]`
      );

      const providerResponse: RazorpaySubscriptionResponse = await client.createSubscription(payload);

      // 8. Validate Provider Response Thoroughly
      if (!providerResponse || typeof providerResponse !== 'object') {
        throw new RazorpayProviderError(
          'INVALID_RESPONSE',
          'Razorpay API returned invalid non-object subscription response'
        );
      }

      if (!providerResponse.id || typeof providerResponse.id !== 'string' || !providerResponse.id.startsWith('sub_')) {
        throw new RazorpayProviderError(
          'INVALID_RESPONSE',
          'Razorpay API returned invalid subscription response: missing valid subscription id (must start with sub_)'
        );
      }

      if (providerResponse.plan_id !== mapping.providerPlanId) {
        throw new RazorpayProviderError(
          'RESPONSE_MISMATCH',
          `Razorpay subscription returned plan_id '${providerResponse.plan_id}', expected '${mapping.providerPlanId}'`
        );
      }

      if (providerResponse.entity && providerResponse.entity !== 'subscription') {
        throw new RazorpayProviderError(
          'INVALID_RESPONSE',
          `Razorpay subscription returned entity '${providerResponse.entity}', expected 'subscription'`
        );
      }

      const acceptableStatuses = ['created', 'authenticated', 'active'];
      if (providerResponse.status && !acceptableStatuses.includes(providerResponse.status.toLowerCase())) {
        throw new RazorpayProviderError(
          'INVALID_RESPONSE',
          `Razorpay subscription returned unexpected status '${providerResponse.status}'`
        );
      }

      // 9. Persist Internal Subscription Contract in CREATED status
      const now = new Date();
      const periodDays = plan.interval === BillingInterval.YEARLY ? 365 : 30;
      const currentPeriodEnd = new Date(now.getTime() + periodDays * 24 * 60 * 60 * 1000);

      const subscription = await prisma.subscription.create({
        data: {
          userId: user.id,
          planId: plan.id,
          planPriceId: planPrice.id,
          provider: PaymentProvider.RAZORPAY,
          providerEnvironment: environment,
          providerSubscriptionId: providerResponse.id,
          providerPlanId: mapping.providerPlanId,
          status: BillingStatus.CREATED,
          billingInterval: plan.interval,
          currency: planPrice.currency,
          amountMinorUnits: planPrice.amountMinorUnits,
          priceVersion: planPrice.version,
          currentPeriodStart: now,
          currentPeriodEnd,
          cancelAtPeriodEnd: false
        }
      });

      // 10. Record Safe Audit Event (Zero Credentials / Secrets)
      await prisma.auditEvent.create({
        data: {
          userId: user.id,
          eventType: AuditEventType.SUBSCRIPTION_CREATED,
          metadata: {
            action: 'CHECKOUT_SESSION_INITIALIZED',
            subscriptionId: subscription.id,
            provider: 'RAZORPAY',
            providerSubscriptionId: providerResponse.id,
            planCode: plan.code,
            currency: planPrice.currency,
            amountMinorUnits: planPrice.amountMinorUnits,
            priceVersion: planPrice.version,
            environment
          }
        }
      });

      // 11. Return Safe Checkout Initialization Result (Public Key ID Only)
      return {
        keyId: rzpConfig.keyId,
        subscriptionId: providerResponse.id,
        planCode: plan.code,
        interval: plan.interval,
        currency: planPrice.currency,
        amountMinorUnits: planPrice.amountMinorUnits,
        formattedAmount: PriceFormatter.format(planPrice.amountMinorUnits, planPrice.currency),
        billingCountry: billingState.billingCountry
      };
    });
  }
}
