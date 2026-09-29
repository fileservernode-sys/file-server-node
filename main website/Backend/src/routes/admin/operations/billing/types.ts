import {
  BillingStatus,
  CurrencyCode,
  BillingInterval,
  PaymentProvider,
  PaymentEnvironment,
  PaymentStatus,
  RefundStatus,
  RefundReason,
  PlanChangeStatus,
  UpgradeReconciliationStatus,
  ReconciliationStatus,
  ReconciliationDiscrepancyType,
  ReconciliationRunStatus,
  ReconciliationEntityType,
  WebhookEventStatus
} from '@prisma/client';

export interface AdminSubscriptionSummary {
  id: string;
  userId: string;
  userEmail: string;
  userFullName: string | null;
  planId: string;
  planCode: string;
  planName: string;
  status: BillingStatus;
  billingInterval: BillingInterval;
  currency: CurrencyCode;
  amountMinorUnits: number;
  priceVersion: number;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  cancelledAt: string | null;
  gracePeriodStartedAt: string | null;
  gracePeriodEndsAt: string | null;
  expiredAt: string | null;
  refundedAt: string | null;
  provider: PaymentProvider;
  providerEnvironment: PaymentEnvironment;
  providerSubscriptionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminSubscriptionDetail extends AdminSubscriptionSummary {
  planDetails: {
    id: string;
    code: string;
    name: string;
    serverLimit: number;
    priorityRelay: boolean;
    isActive: boolean;
  };
  priceDetails: {
    id: string;
    currency: CurrencyCode;
    amountMinorUnits: number;
    effectiveFrom: string;
    effectiveTo: string | null;
    version: number;
  };
  userAccountBillingState: {
    status: BillingStatus;
    billingCountry: string | null;
    billingPostalCode: string | null;
    currency: CurrencyCode | null;
  } | null;
  recentPayments: Array<{
    id: string;
    amountMinorUnits: number;
    currency: CurrencyCode;
    status: PaymentStatus;
    chargedAt: string;
    providerPaymentId: string | null;
    hasReceipt: boolean;
  }>;
  recentRefunds: Array<{
    id: string;
    amountMinorUnits: number;
    currency: CurrencyCode;
    status: RefundStatus;
    reason: RefundReason;
    requestedAt: string;
  }>;
  recentPlanChanges: Array<{
    id: string;
    fromPlanCode: string;
    toPlanCode: string;
    status: PlanChangeStatus;
    creditMinorUnits: number;
    netAmountMinorUnits: number;
    requestedAt: string;
    completedAt: string | null;
  }>;
  upgradeReconciliations: Array<{
    id: string;
    status: UpgradeReconciliationStatus;
    expectedAmountMinorUnits: number;
    actualAmountMinorUnits: number | null;
    checkedAt: string;
    resolvedAt: string | null;
    mismatchReason: string | null;
  }>;
}

export interface AdminPaymentSummary {
  id: string;
  userId: string;
  userEmail: string;
  userFullName: string | null;
  subscriptionId: string;
  planCode: string | null;
  amountMinorUnits: number;
  currency: CurrencyCode;
  status: PaymentStatus;
  chargedAt: string;
  provider: PaymentProvider;
  providerEnvironment: PaymentEnvironment;
  providerPaymentId: string | null;
  providerSubscriptionId: string | null;
  receiptNumber: string | null;
  totalTaxMinorUnits: number | null;
  totalFeeMinorUnits: number | null;
  refundCount: number;
  refundedAmountMinorUnits: number;
  createdAt: string;
}

export interface AdminPaymentDetail extends AdminPaymentSummary {
  receipt: {
    id: string;
    receiptNumber: string;
    status: string;
    type: string;
    subtotalMinorUnits: number;
    taxMinorUnits: number;
    totalMinorUnits: number;
    issuedAt: string;
  } | null;
  tax: {
    id: string;
    jurisdiction: string;
    taxType: string;
    isInclusive: boolean;
    taxRateBasisPoints: number;
    taxableAmountMinorUnits: number;
    taxAmountMinorUnits: number;
    breakdown: Record<string, unknown> | null;
  } | null;
  processingFee: {
    id: string;
    feeAmountMinorUnits: number;
    feeTaxMinorUnits: number;
    totalFeeMinorUnits: number;
    feeCurrency: CurrencyCode;
    netSettlementAmountMinorUnits: number | null;
    status: string;
    source: string;
  } | null;
  refunds: Array<{
    id: string;
    amountMinorUnits: number;
    currency: CurrencyCode;
    reason: RefundReason;
    status: RefundStatus;
    requestedBy: string;
    requestedAt: string;
    providerRefundId: string | null;
  }>;
  reconciliationRecords: Array<{
    id: string;
    runId: string | null;
    status: ReconciliationStatus;
    settled: boolean;
    settledAt: string | null;
    providerFeeMinorUnits: number | null;
  }>;
}

export interface AdminRefundSummary {
  id: string;
  userId: string;
  userEmail: string;
  userFullName: string | null;
  paymentId: string;
  subscriptionId: string | null;
  amountMinorUnits: number;
  currency: CurrencyCode;
  reason: RefundReason;
  reasonDetails: string | null;
  status: RefundStatus;
  requestedBy: string;
  requestedAt: string;
  providerRequestedAt: string | null;
  providerProcessedAt: string | null;
  providerRefundId: string | null;
  providerPaymentId: string | null;
  failureCode: string | null;
  failureReason: string | null;
  createdAt: string;
}

export interface AdminRefundDetail extends AdminRefundSummary {
  payment: {
    id: string;
    amountMinorUnits: number;
    currency: CurrencyCode;
    status: PaymentStatus;
    chargedAt: string;
    providerPaymentId: string | null;
  };
  subscription: {
    id: string;
    planCode: string;
    status: BillingStatus;
  } | null;
  reconciliationRecords: Array<{
    id: string;
    status: ReconciliationStatus;
    providerRefundId: string | null;
  }>;
}

export interface AdminReconciliationRunSummary {
  id: string;
  provider: PaymentProvider;
  environment: PaymentEnvironment;
  periodStart: string;
  periodEnd: string;
  status: ReconciliationRunStatus;
  totalRecords: number;
  paymentRecords: number;
  refundRecords: number;
  transferRecords: number;
  adjustmentRecords: number;
  matchedCount: number;
  mismatchCount: number;
  reviewCount: number;
  duplicateCount: number;
  failureCount: number;
  durationMs: number | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
}

export interface AdminReconciliationDiscrepancySummary {
  id: string;
  runId: string | null;
  provider: PaymentProvider;
  entityType: ReconciliationEntityType;
  providerEntityId: string;
  internalEntityId: string | null;
  discrepancyType: ReconciliationDiscrepancyType;
  status: ReconciliationStatus;
  expectedValue: string | null;
  actualValue: string | null;
  resolutionReason: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminPlanSummary {
  id: string;
  code: string;
  name: string;
  description: string | null;
  interval: BillingInterval;
  intervalCount: number;
  serverLimit: number;
  priorityRelay: boolean;
  isActive: boolean;
  prices: Array<{
    id: string;
    currency: CurrencyCode;
    amountMinorUnits: number;
    effectiveFrom: string;
    effectiveTo: string | null;
    isActive: boolean;
    version: number;
  }>;
  entitlements: Array<{
    code: string;
    name: string;
    intValue: number | null;
    boolValue: boolean | null;
  }>;
  activeSubscriberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminBillingOverviewMetrics {
  activeSubscriptions: number;
  pastDueSubscriptions: number;
  gracePeriodSubscriptions: number;
  cancellingSubscriptions: number;
  totalPaidUsers: number;
  revenue30dMinorUnits: Record<string, number>;
  refunds30dMinorUnits: Record<string, number>;
  pendingDiscrepancies: number;
  stuckWebhooksCount: number;
  latestReconciliationRun: {
    id: string;
    status: ReconciliationRunStatus;
    completedAt: string | null;
    mismatchCount: number;
  } | null;
}

export interface AdminSubscriptionDunningDetail {
  subscriptionId: string;
  userId: string;
  userEmail: string;
  status: BillingStatus;
  isInDunning: boolean;
  gracePeriodStartedAt: string | null;
  gracePeriodEndsAt: string | null;
  gracePeriodDaysTotal: number;
  gracePeriodDaysRemaining: number | null;
  dunningMilestones: number[];
  latestMilestone: number | null;
  dunningLastEvaluatedAt: string | null;
  failedPaymentCount: number;
  recentFailedPayments: Array<{
    id: string;
    amountMinorUnits: number;
    currency: CurrencyCode;
    status: PaymentStatus;
    chargedAt: string;
    providerPaymentId: string | null;
  }>;
  entitlementConsequence: {
    currentEntitled: boolean;
    willExpireAt: string | null;
    afterExpirationPlan: string;
  };
  recommendedAction: string;
}

export interface AdminCancelSubscriptionBody {
  mode?: 'PERIOD_END' | 'IMMEDIATE';
  reason?: string;
}

export interface AdminCancelSubscriptionResult {
  id: string;
  userId: string;
  previousStatus: BillingStatus;
  newStatus: BillingStatus;
  cancelAtPeriodEnd: boolean;
  cancelledAt: string;
  currentPeriodEnd: string;
  mode: 'PERIOD_END' | 'IMMEDIATE';
  reason: string;
}

export interface AdminProviderSubscriptionInspectionResult {
  subscriptionId: string;
  userId: string;
  provider: PaymentProvider;
  providerEnvironment: PaymentEnvironment;
  providerSubscriptionId: string | null;
  isConfigured: boolean;
  localState: {
    status: BillingStatus;
    planCode: string;
    currency: CurrencyCode;
    amountMinorUnits: number;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
  };
  providerState: {
    status?: string;
    planId?: string;
    currentEnd?: string | null;
    endedAt?: string | null;
    chargeAt?: string | null;
    totalCount?: number;
    paidCount?: number;
    remainingCount?: number;
    shortUrl?: string;
  } | null;
  comparison: {
    isMatched: boolean;
    statusMatches: boolean;
    periodMatches: boolean;
    mismatches: string[];
  };
  inspectedAt: string;
}

export interface AdminProviderPaymentInspectionResult {
  paymentId: string;
  userId: string;
  provider: PaymentProvider;
  providerEnvironment: PaymentEnvironment;
  providerPaymentId: string | null;
  providerSubscriptionId: string | null;
  isConfigured: boolean;
  localState: {
    status: PaymentStatus;
    amountMinorUnits: number;
    currency: CurrencyCode;
    chargedAt: string;
    refundedAmountMinorUnits: number;
  };
  providerState: {
    id?: string;
    entity?: string;
    amount?: number;
    currency?: string;
    status?: string;
    orderId?: string;
    invoiceId?: string;
    international?: boolean;
    method?: string;
    amountRefunded?: number;
    refundStatus?: string;
    captured?: boolean;
    description?: string;
    card?: {
      network?: string;
      last4?: string;
      type?: string;
      issuer?: string;
    };
    bank?: string;
    wallet?: string;
    vpa?: string;
    email?: string;
    contact?: string;
    fee?: number;
    tax?: number;
    errorCode?: string;
    errorDescription?: string;
    createdAt?: string | null;
  } | null;
  comparison: {
    isMatched: boolean;
    statusMatches: boolean;
    amountMatches: boolean;
    currencyMatches: boolean;
    mismatches: string[];
  };
  inspectedAt: string;
}

export interface AdminProviderRefundInspectionResult {
  refundId: string;
  paymentId: string;
  userId: string;
  provider: PaymentProvider;
  providerEnvironment: PaymentEnvironment;
  providerRefundId: string | null;
  providerPaymentId: string | null;
  isConfigured: boolean;
  localState: {
    status: RefundStatus;
    amountMinorUnits: number;
    currency: CurrencyCode;
    reason: RefundReason;
    requestedAt: string;
  };
  providerState: {
    id?: string;
    entity?: string;
    amount?: number;
    currency?: string;
    paymentId?: string;
    status?: string;
    speedProcessed?: string;
    speedRequested?: string;
    receipt?: string;
    createdAt?: string | null;
  } | null;
  comparison: {
    isMatched: boolean;
    statusMatches: boolean;
    amountMatches: boolean;
    currencyMatches: boolean;
    mismatches: string[];
  };
  inspectedAt: string;
}

export interface AdminExecuteRefundBody {
  amountMinorUnits?: number;
  reason?: RefundReason;
  reasonDetails?: string;
  idempotencyKey?: string;
  terminateSubscription?: boolean;
  correlationId?: string;
}

export interface AdminExecuteRefundResult {
  success: boolean;
  refund: AdminRefundDetail | AdminRefundSummary;
  payment: {
    id: string;
    amountMinorUnits: number;
    cumulativeRefundedMinorUnits: number;
    remainingRefundableMinorUnits: number;
    status: PaymentStatus;
  };
  idempotent?: boolean;
}

export interface AdminReconciliationRunDetail extends AdminReconciliationRunSummary {
  recentRecords: Array<{
    id: string;
    providerEntityId: string;
    entityType: ReconciliationEntityType;
    amountMinorUnits: number;
    currency: CurrencyCode;
    status: ReconciliationStatus;
    settled: boolean;
    settledAt: string | null;
  }>;
  recentDiscrepancies: Array<{
    id: string;
    entityType: ReconciliationEntityType;
    providerEntityId: string;
    discrepancyType: ReconciliationDiscrepancyType;
    status: ReconciliationStatus;
    expectedValue: string | null;
    actualValue: string | null;
  }>;
  metadata: Record<string, unknown> | null;
}

export interface AdminStartReconciliationRunBody {
  scope?: 'DATE_RANGE' | 'PAYMENTS' | 'REFUNDS' | 'SETTLEMENTS' | 'FULL_BILLING';
  startDate: string;
  endDate: string;
  provider?: PaymentProvider;
  environment?: PaymentEnvironment;
  idempotencyKey?: string;
  dryRun?: boolean;
}

export interface AdminStartReconciliationRunResult {
  run: AdminReconciliationRunSummary | AdminReconciliationRunDetail;
  idempotent?: boolean;
  activeRunDetected?: boolean;
}

export interface AdminReconciliationDiscrepancyDetail extends AdminReconciliationDiscrepancySummary {
  run: {
    id: string;
    periodStart: string;
    periodEnd: string;
    status: ReconciliationRunStatus;
  } | null;
  reconciliationRecord: {
    id: string;
    providerPaymentId: string | null;
    providerRefundId: string | null;
    amountMinorUnits: number;
    currency: CurrencyCode;
    status: ReconciliationStatus;
  } | null;
  linkedPayment: {
    id: string;
    userId: string;
    userEmail?: string;
    amountMinorUnits: number;
    currency: CurrencyCode;
    status: PaymentStatus;
    chargedAt: string;
  } | null;
  linkedRefund: {
    id: string;
    userId: string;
    userEmail?: string;
    amountMinorUnits: number;
    currency: CurrencyCode;
    status: RefundStatus;
    requestedAt: string;
  } | null;
}

export interface AdminResolveDiscrepancyBody {
  action: 'ACKNOWLEDGE' | 'RETRY_PROVIDER_LOOKUP' | 'MARK_RESOLVED' | 'SYNC_PROVIDER_REFERENCE';
  resolutionReason: string;
  idempotencyKey?: string;
}

export interface AdminResolveDiscrepancyResult {
  success: boolean;
  discrepancy: AdminReconciliationDiscrepancyDetail | AdminReconciliationDiscrepancySummary;
  actionApplied: string;
  idempotent?: boolean;
}

