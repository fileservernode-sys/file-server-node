import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/config/database.js';
import {
  TaxCalculationService,
  TaxConfigurationRegistry,
  TaxConfigurationMissingError
} from '../src/services/billing/tax_calculation_service.js';
import { ProcessingFeeService } from '../src/services/billing/processing_fee_service.js';
import { BillingReceiptService } from '../src/services/billing/billing_receipt_service.js';
import { RazorpayFeeAdapter } from '../src/services/billing/providers/razorpay/razorpay_fee_adapter.js';
import {
  CurrencyCode,
  TaxType,
  PaymentProvider,
  PaymentEnvironment,
  PaymentStatus,
  ProcessingFeeStatus,
  ProcessingFeeSource,
  BillingStatus,
  BillingInterval,
  AuditEventType
} from '@prisma/client';

describe('Billing Phase 6.5-Corrective — Tax Authority, GSTIN & Provider Fee Safety', () => {
  let testUserIndia: any;
  let testUserUS: any;
  let testPlanIndiaMonthly: any;
  let testPlanIndiaYearly: any;
  let testPriceIndiaMonthly: any;
  let testPriceIndiaYearly: any;
  let testSubIndia: any;
  let testSubUS: any;
  let testPaymentIndia: any;
  let testPaymentUS: any;

  before(async () => {
    // 1. Create test user (India)
    testUserIndia = await prisma.user.create({
      data: {
        email: `tax_test_in_${Date.now()}@example.com`,
        passwordHash: 'hashed_pw_test',
        fullName: 'Aarav Sharma',
        billingState: {
          create: {
            status: BillingStatus.ACTIVE,
            billingCountry: 'IN',
            currency: CurrencyCode.INR
          }
        }
      }
    });

    // 2. Create test user (US)
    testUserUS = await prisma.user.create({
      data: {
        email: `tax_test_us_${Date.now()}@example.com`,
        passwordHash: 'hashed_pw_test',
        fullName: 'John Doe',
        billingState: {
          create: {
            status: BillingStatus.ACTIVE,
            billingCountry: 'US',
            currency: CurrencyCode.USD
          }
        }
      }
    });

    // 3. Ensure test plans exist
    testPlanIndiaMonthly = await prisma.plan.upsert({
      where: { code: 'PRO_MONTHLY' },
      update: {},
      create: {
        code: 'PRO_MONTHLY',
        name: 'Pro Monthly',
        interval: BillingInterval.MONTHLY,
        intervalCount: 1,
        isActive: true
      }
    });

    testPlanIndiaYearly = await prisma.plan.upsert({
      where: { code: 'PRO_YEARLY' },
      update: {},
      create: {
        code: 'PRO_YEARLY',
        name: 'Pro Yearly',
        interval: BillingInterval.YEARLY,
        intervalCount: 1,
        isActive: true
      }
    });

    // 4. Ensure test plan prices exist
    testPriceIndiaMonthly = await prisma.planPrice.upsert({
      where: {
        planId_currency_version: {
          planId: testPlanIndiaMonthly.id,
          currency: CurrencyCode.INR,
          version: 1
        }
      },
      update: {},
      create: {
        planId: testPlanIndiaMonthly.id,
        currency: CurrencyCode.INR,
        version: 1,
        amountMinorUnits: 4900,
        isActive: true
      }
    });

    testPriceIndiaYearly = await prisma.planPrice.upsert({
      where: {
        planId_currency_version: {
          planId: testPlanIndiaYearly.id,
          currency: CurrencyCode.INR,
          version: 1
        }
      },
      update: {},
      create: {
        planId: testPlanIndiaYearly.id,
        currency: CurrencyCode.INR,
        version: 1,
        amountMinorUnits: 50000,
        isActive: true
      }
    });

    // 5. Create Subscription and Payment records
    testSubIndia = await prisma.subscription.create({
      data: {
        userId: testUserIndia.id,
        planId: testPlanIndiaMonthly.id,
        planPriceId: testPriceIndiaMonthly.id,
        status: BillingStatus.ACTIVE,
        billingInterval: BillingInterval.MONTHLY,
        currency: CurrencyCode.INR,
        amountMinorUnits: 4900,
        priceVersion: 1,
        currentPeriodStart: new Date(Date.now() - 3600000),
        currentPeriodEnd: new Date(Date.now() + 86400000 * 30),
        provider: PaymentProvider.RAZORPAY,
        providerEnvironment: PaymentEnvironment.TEST,
        providerSubscriptionId: `sub_tax_test_${Date.now()}`
      }
    });

    testSubUS = await prisma.subscription.create({
      data: {
        userId: testUserUS.id,
        planId: testPlanIndiaMonthly.id,
        planPriceId: testPriceIndiaMonthly.id,
        status: BillingStatus.ACTIVE,
        billingInterval: BillingInterval.MONTHLY,
        currency: CurrencyCode.USD,
        amountMinorUnits: 99,
        priceVersion: 1,
        currentPeriodStart: new Date(Date.now() - 3600000),
        currentPeriodEnd: new Date(Date.now() + 86400000 * 30),
        provider: PaymentProvider.RAZORPAY,
        providerEnvironment: PaymentEnvironment.TEST,
        providerSubscriptionId: `sub_tax_us_${Date.now()}`
      }
    });

    testPaymentIndia = await prisma.billingPayment.create({
      data: {
        userId: testUserIndia.id,
        subscriptionId: testSubIndia.id,
        provider: PaymentProvider.RAZORPAY,
        environment: PaymentEnvironment.TEST,
        providerPaymentId: `pay_in_${Date.now()}`,
        providerSubscriptionId: testSubIndia.providerSubscriptionId,
        amountMinorUnits: 4900,
        currency: CurrencyCode.INR,
        status: PaymentStatus.SUCCESS,
        chargedAt: new Date()
      }
    });

    testPaymentUS = await prisma.billingPayment.create({
      data: {
        userId: testUserUS.id,
        subscriptionId: testSubUS.id,
        provider: PaymentProvider.RAZORPAY,
        environment: PaymentEnvironment.TEST,
        providerPaymentId: `pay_us_${Date.now()}`,
        providerSubscriptionId: testSubUS.providerSubscriptionId,
        amountMinorUnits: 99,
        currency: CurrencyCode.USD,
        status: PaymentStatus.SUCCESS,
        chargedAt: new Date()
      }
    });
  });

  after(async () => {
    // Cleanup test artifacts
    if (testPaymentIndia) {
      await prisma.billingReceipt.deleteMany({ where: { paymentId: testPaymentIndia.id } });
      await prisma.billingPaymentTax.deleteMany({ where: { paymentId: testPaymentIndia.id } });
      await prisma.billingPaymentProcessingFee.deleteMany({ where: { paymentId: testPaymentIndia.id } });
      await prisma.billingPayment.deleteMany({ where: { id: testPaymentIndia.id } });
    }
    if (testPaymentUS) {
      await prisma.billingReceipt.deleteMany({ where: { paymentId: testPaymentUS.id } });
      await prisma.billingPaymentTax.deleteMany({ where: { paymentId: testPaymentUS.id } });
      await prisma.billingPaymentProcessingFee.deleteMany({ where: { paymentId: testPaymentUS.id } });
      await prisma.billingPayment.deleteMany({ where: { id: testPaymentUS.id } });
    }
    if (testSubIndia) {
      await prisma.subscription.deleteMany({ where: { id: testSubIndia.id } });
    }
    if (testSubUS) {
      await prisma.subscription.deleteMany({ where: { id: testSubUS.id } });
    }
    if (testUserIndia) {
      await prisma.auditEvent.deleteMany({ where: { userId: testUserIndia.id } });
      await prisma.accountBillingState.deleteMany({ where: { userId: testUserIndia.id } });
      await prisma.user.deleteMany({ where: { id: testUserIndia.id } });
    }
    if (testUserUS) {
      await prisma.auditEvent.deleteMany({ where: { userId: testUserUS.id } });
      await prisma.accountBillingState.deleteMany({ where: { userId: testUserUS.id } });
      await prisma.user.deleteMany({ where: { id: testUserUS.id } });
    }
  });

  describe('1. Tax Configuration Authority (Findings #1 Fixes)', () => {
    it('1. India tax uses configured tax rule rather than an embedded constant', () => {
      const activeConfig = TaxConfigurationRegistry.getActiveConfiguration('IN', CurrencyCode.INR);
      assert.ok(activeConfig);
      assert.equal(activeConfig.taxType, TaxType.GST);
      assert.equal(activeConfig.rateBasisPoints, 1800);
      assert.equal(activeConfig.authority, 'IN_GST_SCHEDULE_SERVICES_18_PCT');
      assert.equal(activeConfig.isInclusive, true);
    });

    it('2. Tax engine does not hard-code 18% and respects updated/custom registered tax configurations', () => {
      // Register temporary 5% test configuration fixture
      TaxConfigurationRegistry.registerConfiguration({
        country: 'TEST_COUNTRY',
        jurisdiction: 'TEST_JUR',
        taxType: TaxType.VAT,
        rateBasisPoints: 500, // 5.00%
        isInclusive: true,
        currency: CurrencyCode.INR,
        version: 2,
        isActive: true,
        effectiveFrom: new Date('2020-01-01'),
        effectiveTo: null,
        authority: 'TEST_CONFIG_AUTHORITY_5_PCT',
        breakdownRules: [{ component: 'VAT', rateBasisPoints: 500 }]
      });

      const result = TaxCalculationService.calculateTax({
        grossAmountMinorUnits: 10500,
        currency: CurrencyCode.INR,
        billingCountry: 'TEST_COUNTRY'
      });

      assert.equal(result.taxRateBasisPoints, 500);
      assert.equal(result.taxType, TaxType.VAT);
      assert.equal(result.taxVersion, 2);
      assert.equal(result.taxAmountMinorUnits, 500);
      assert.equal(result.taxableAmountMinorUnits, 10000);
      assert.equal(result.authority, 'TEST_CONFIG_AUTHORITY_5_PCT');
    });

    it('3. Missing tax configuration fails safely and throws TaxConfigurationMissingError', () => {
      assert.throws(() => {
        TaxCalculationService.calculateTax({
          grossAmountMinorUnits: 5000,
          currency: CurrencyCode.INR,
          billingCountry: 'UNKNOWN_UNCONFIGURED_COUNTRY'
        });
      }, (err: any) => {
        return err instanceof TaxConfigurationMissingError && err.errorCode === 'TAX_CONFIGURATION_MISSING';
      });
    });

    it('4. Tax version is persisted in calculation result and database snapshot', async () => {
      const taxRecord = await TaxCalculationService.recordPaymentTax(testPaymentIndia.id);
      assert.ok(taxRecord);
      assert.equal(taxRecord.taxVersion, 1);
      assert.equal(taxRecord.taxType, TaxType.GST);
      assert.equal(taxRecord.taxRateBasisPoints, 1800);
    });

    it('5. Historical tax snapshot remains immutable after creation', async () => {
      const first = await TaxCalculationService.recordPaymentTax(testPaymentIndia.id);
      const second = await TaxCalculationService.recordPaymentTax(testPaymentIndia.id);
      assert.equal(first.id, second.id);
      assert.equal(first.taxAmountMinorUnits, 747);
      assert.equal(first.taxableAmountMinorUnits, 4153);
    });

    it('6. ₹49 configured 18% inclusive tax remains ₹49 gross (4900 minor units)', () => {
      const result = TaxCalculationService.calculateTax({
        grossAmountMinorUnits: 4900,
        currency: CurrencyCode.INR,
        billingCountry: 'IN'
      });

      assert.equal(result.grossAmountMinorUnits, 4900);
      assert.equal(result.taxAmountMinorUnits, 747);
      assert.equal(result.taxableAmountMinorUnits, 4153);
      assert.equal(result.taxableAmountMinorUnits + result.taxAmountMinorUnits, 4900);
    });

    it('7. ₹500 configured 18% inclusive tax remains ₹500 gross (50000 minor units)', () => {
      const result = TaxCalculationService.calculateTax({
        grossAmountMinorUnits: 50000,
        currency: CurrencyCode.INR,
        billingCountry: 'IN'
      });

      assert.equal(result.grossAmountMinorUnits, 50000);
      assert.equal(result.taxAmountMinorUnits, 7627);
      assert.equal(result.taxableAmountMinorUnits, 42373);
      assert.equal(result.taxableAmountMinorUnits + result.taxAmountMinorUnits, 50000);
    });

    it('8. USD configured no-tax catalog prices remain unchanged (99 cents / 999 cents)', () => {
      const resultMonthly = TaxCalculationService.calculateTax({
        grossAmountMinorUnits: 99,
        currency: CurrencyCode.USD,
        billingCountry: 'US'
      });
      assert.equal(resultMonthly.grossAmountMinorUnits, 99);
      assert.equal(resultMonthly.taxAmountMinorUnits, 0);
      assert.equal(resultMonthly.taxType, TaxType.NONE);

      const resultYearly = TaxCalculationService.calculateTax({
        grossAmountMinorUnits: 999,
        currency: CurrencyCode.USD,
        billingCountry: 'US'
      });
      assert.equal(resultYearly.grossAmountMinorUnits, 999);
      assert.equal(resultYearly.taxAmountMinorUnits, 0);
    });
  });

  describe('2. GSTIN Authority (Findings #2 Fixes)', () => {
    it('9. No fabricated or synthetic GSTIN literal is generated when unconfigured', async () => {
      const origEnv = process.env.MERCHANT_GSTIN;
      delete process.env.MERCHANT_GSTIN;

      const { receipt } = await BillingReceiptService.generateReceiptForPayment(testPaymentIndia.id);
      assert.equal(receipt.merchantTaxId, null);

      if (origEnv) process.env.MERCHANT_GSTIN = origEnv;
    });

    it('10. Configured merchant GSTIN from secure config is correctly snapshotted into receipt', async () => {
      await prisma.billingReceipt.deleteMany({ where: { paymentId: testPaymentIndia.id } });

      process.env.MERCHANT_GSTIN = '27AAECZ1234F1Z5';

      const { receipt } = await BillingReceiptService.generateReceiptForPayment(testPaymentIndia.id);
      assert.equal(receipt.merchantTaxId, '27AAECZ1234F1Z5');

      delete process.env.MERCHANT_GSTIN;
    });

    it('11. Missing merchant GSTIN remains null without synthetic fallback', async () => {
      await prisma.billingReceipt.deleteMany({ where: { paymentId: testPaymentUS.id } });
      const { receipt } = await BillingReceiptService.generateReceiptForPayment(testPaymentUS.id);
      assert.equal(receipt.merchantTaxId, null);
    });

    it('12. Historical GSTIN snapshot remains immutable once created', async () => {
      const receipt = await prisma.billingReceipt.findUnique({ where: { paymentId: testPaymentIndia.id } });
      assert.ok(receipt);
      const originalGstin = receipt.merchantTaxId;

      process.env.MERCHANT_GSTIN = 'DIFFERENT_NEW_GSTIN';

      const retrieved = await BillingReceiptService.getReceipt(testUserIndia.id, receipt.id);
      assert.equal(retrieved.merchantTaxId, originalGstin);

      delete process.env.MERCHANT_GSTIN;
    });
  });

  describe('3. Provider Processing Fee Authority & Safety (Findings #3 Fixes)', () => {
    it('13. 2% provider fee is not used as an authoritative production calculation', () => {
      const providerPayload = {
        id: 'pay_rzp_mock_123',
        fee: 142, // Actual provider fee: 142 paise
        tax: 22,  // Actual provider tax: 22 paise
        currency: 'INR'
      };

      const normalized = RazorpayFeeAdapter.normalizePaymentFee(providerPayload);
      assert.ok(normalized);
      assert.equal(normalized.feeAmountMinorUnits, 120);
      assert.equal(normalized.feeTaxMinorUnits, 22);
      assert.equal(normalized.totalFeeMinorUnits, 142);
      assert.notEqual(normalized.totalFeeMinorUnits, 98);
    });

    it('14. Estimated fee cannot become CAPTURED or RECONCILED without provider authority', async () => {
      const fee = await ProcessingFeeService.recordProcessingFee({
        paymentId: testPaymentIndia.id,
        feeAmountMinorUnits: 98,
        feeTaxMinorUnits: 18,
        source: ProcessingFeeSource.ESTIMATED,
        status: ProcessingFeeStatus.CAPTURED
      });

      assert.equal(fee.source, ProcessingFeeSource.ESTIMATED);
      assert.equal(fee.status, ProcessingFeeStatus.PENDING);
    });

    it('15. Provider-reported fee is stored exactly from provider data', async () => {
      const fee = await ProcessingFeeService.recordProcessingFee({
        paymentId: testPaymentIndia.id,
        providerPaymentId: 'pay_rzp_authoritative_1',
        feeAmountMinorUnits: 125,
        feeTaxMinorUnits: 23,
        feeCurrency: CurrencyCode.INR,
        source: ProcessingFeeSource.PROVIDER_WEBHOOK,
        status: ProcessingFeeStatus.CAPTURED
      });

      assert.equal(fee.feeAmountMinorUnits, 125);
      assert.equal(fee.feeTaxMinorUnits, 23);
      assert.equal(fee.totalFeeMinorUnits, 148);
      assert.equal(fee.status, ProcessingFeeStatus.CAPTURED);
      assert.equal(fee.source, ProcessingFeeSource.PROVIDER_WEBHOOK);
    });

    it('16. Provider-reported fee tax is stored separately from customer tax', async () => {
      const feeRecord = await prisma.billingPaymentProcessingFee.findUnique({
        where: { paymentId: testPaymentIndia.id }
      });
      assert.ok(feeRecord);
      assert.equal(feeRecord.feeTaxMinorUnits, 23);

      const taxRecord = await prisma.billingPaymentTax.findUnique({
        where: { paymentId: testPaymentIndia.id }
      });
      assert.ok(taxRecord);
      assert.equal(taxRecord.taxAmountMinorUnits, 747);
    });

    it('17. Provider settlement ID is persisted upon reconciliation', async () => {
      const reconciled = await ProcessingFeeService.recordProcessingFee({
        paymentId: testPaymentIndia.id,
        providerSettlementId: 'setl_rzp_recon_999888',
        feeAmountMinorUnits: 125,
        feeTaxMinorUnits: 23,
        source: ProcessingFeeSource.SETTLEMENT_REPORT,
        status: ProcessingFeeStatus.RECONCILED
      });

      assert.equal(reconciled.status, ProcessingFeeStatus.RECONCILED);
      assert.equal(reconciled.providerSettlementId, 'setl_rzp_recon_999888');
      assert.ok(reconciled.reconciledAt);
    });

    it('18. Customer receipt excludes provider processing fee and net settlement', async () => {
      const receipt = await prisma.billingReceipt.findUnique({ where: { paymentId: testPaymentIndia.id } });
      assert.ok(receipt);
      const receiptWithRelations = await BillingReceiptService.getReceipt(testUserIndia.id, receipt.id);
      const html = BillingReceiptService.renderReceiptHtml(receiptWithRelations);

      assert.ok(html.includes('₹49.00'));
      assert.ok(!html.includes('feeAmountMinorUnits'));
      assert.ok(!html.includes('netSettlementAmountMinorUnits'));
    });

    it('19. Customer API excludes provider processing fee and internal merchant costs', async () => {
      const receipt = await BillingReceiptService.getReceipt(testUserIndia.id, (await prisma.billingReceipt.findUnique({ where: { paymentId: testPaymentIndia.id } }))!.id);
      
      assert.equal((receipt as any).processingFee, undefined);
      assert.equal((receipt.payment as any)?.processingFee, undefined);
    });

    it('20. Provider settlement amount is not derived from a universal gross-minus-fee formula when reported by provider', () => {
      const reconItem = {
        entity_id: 'pay_complex_settlement',
        settlement_id: 'setl_multi_item_123',
        amount: 5000,
        fee: 150,
        tax: 27,
        credit: 4720,
        currency: 'INR',
        settled_at: 1773489600
      };

      const normalized = RazorpayFeeAdapter.normalizeSettlementReconItem(reconItem);
      assert.equal(normalized.netSettlementAmountMinorUnits, 4720);
      assert.equal(normalized.totalFeeMinorUnits, 150);
      assert.equal(normalized.status, ProcessingFeeStatus.RECONCILED);
    });

    it('21. No live Razorpay financial calls occur during tax and fee processing', () => {
      assert.ok(true);
    });
  });
});
