import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { prisma } from '../src/config/database.js';
import { RazorpayCheckoutService } from '../src/services/billing/providers/razorpay/index.js';
import { BillingCountryService } from '../src/services/billing/billing_country_service.js';
import { BillingProfileService } from '../src/services/billing/billing_profile_service.js';
import {
  CurrencyCode,
  PaymentProvider,
  PaymentEnvironment,
  BillingInterval,
  AuditEventType
} from '@prisma/client';
import { ValidationError } from '../src/errors/app-error.js';

describe('Checkout Billing Address Enforcement Test Suite', () => {
  let testUserId: string;

  before(async () => {
    const testUser = await prisma.user.create({
      data: {
        email: `checkout_addr_test_${Date.now()}@example.com`,
        fullName: 'Test Checkout User',
        passwordHash: 'dummy_hash_for_test'
      }
    });
    testUserId = testUser.id;
  });

  after(async () => {
    if (testUserId) {
      await prisma.auditEvent.deleteMany({ where: { userId: testUserId } });
      await prisma.accountBillingState.deleteMany({ where: { userId: testUserId } });
      await prisma.subscription.deleteMany({ where: { userId: testUserId } });
      await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
    }
  });

  test('TC-ADDR-01: Rejects checkout session when user has no confirmed billing country', async () => {
    await prisma.accountBillingState.deleteMany({ where: { userId: testUserId } });

    await assert.rejects(
      async () => {
        await RazorpayCheckoutService.createCheckoutSession(testUserId, {
          planCode: 'PRO_MONTHLY'
        });
      },
      (err: any) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /Billing country must be confirmed/i);
        return true;
      }
    );
  });

  test('TC-ADDR-02: Rejects checkout session when billing street address is missing', async () => {
    await prisma.accountBillingState.upsert({
      where: { userId: testUserId },
      update: {
        billingCountry: 'IN',
        currency: CurrencyCode.INR,
        billingName: 'Authorized Person',
        billingAddress1: null,
        billingCity: 'Mumbai',
        billingState: 'Maharashtra',
        billingPostalCode: '400001'
      },
      create: {
        userId: testUserId,
        billingCountry: 'IN',
        currency: CurrencyCode.INR,
        billingName: 'Authorized Person',
        billingAddress1: null,
        billingCity: 'Mumbai',
        billingState: 'Maharashtra',
        billingPostalCode: '400001'
      }
    });

    await assert.rejects(
      async () => {
        await RazorpayCheckoutService.createCheckoutSession(testUserId, {
          planCode: 'PRO_MONTHLY'
        });
      },
      (err: any) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /complete billing address and legal name are required/i);
        return true;
      }
    );
  });

  test('TC-ADDR-03: Rejects checkout session when city is missing', async () => {
    await prisma.accountBillingState.upsert({
      where: { userId: testUserId },
      update: {
        billingCountry: 'IN',
        currency: CurrencyCode.INR,
        billingName: 'Authorized Person',
        billingAddress1: '123 MG Road',
        billingCity: '',
        billingState: 'Maharashtra',
        billingPostalCode: '400001'
      },
      create: {
        userId: testUserId,
        billingCountry: 'IN',
        currency: CurrencyCode.INR,
        billingName: 'Authorized Person',
        billingAddress1: '123 MG Road',
        billingCity: '',
        billingState: 'Maharashtra',
        billingPostalCode: '400001'
      }
    });

    await assert.rejects(
      async () => {
        await RazorpayCheckoutService.createCheckoutSession(testUserId, {
          planCode: 'PRO_MONTHLY'
        });
      },
      (err: any) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /complete billing address and legal name are required/i);
        return true;
      }
    );
  });

  test('TC-ADDR-04: Rejects checkout session when state is missing for country requiring states', async () => {
    await prisma.accountBillingState.upsert({
      where: { userId: testUserId },
      update: {
        billingCountry: 'IN',
        currency: CurrencyCode.INR,
        billingName: 'Authorized Person',
        billingAddress1: '123 MG Road',
        billingCity: 'Mumbai',
        billingState: null,
        billingPostalCode: '400001'
      },
      create: {
        userId: testUserId,
        billingCountry: 'IN',
        currency: CurrencyCode.INR,
        billingName: 'Authorized Person',
        billingAddress1: '123 MG Road',
        billingCity: 'Mumbai',
        billingState: null,
        billingPostalCode: '400001'
      }
    });

    await assert.rejects(
      async () => {
        await RazorpayCheckoutService.createCheckoutSession(testUserId, {
          planCode: 'PRO_MONTHLY'
        });
      },
      (err: any) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /complete billing address and legal name are required/i);
        return true;
      }
    );
  });

  test('TC-ADDR-05: Rejects checkout session when postal code is missing for country requiring postal codes', async () => {
    await prisma.accountBillingState.upsert({
      where: { userId: testUserId },
      update: {
        billingCountry: 'IN',
        currency: CurrencyCode.INR,
        billingName: 'Authorized Person',
        billingAddress1: '123 MG Road',
        billingCity: 'Mumbai',
        billingState: 'Maharashtra',
        billingPostalCode: ''
      },
      create: {
        userId: testUserId,
        billingCountry: 'IN',
        currency: CurrencyCode.INR,
        billingName: 'Authorized Person',
        billingAddress1: '123 MG Road',
        billingCity: 'Mumbai',
        billingState: 'Maharashtra',
        billingPostalCode: ''
      }
    });

    await assert.rejects(
      async () => {
        await RazorpayCheckoutService.createCheckoutSession(testUserId, {
          planCode: 'PRO_MONTHLY'
        });
      },
      (err: any) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.message, /complete billing address and legal name are required/i);
        return true;
      }
    );
  });

  test('TC-ADDR-06: Allows checkout session when state is omitted for city-state countries (e.g. Singapore)', async () => {
    assert.strictEqual(BillingCountryService.isStateRequired('SG'), false);

    await prisma.accountBillingState.upsert({
      where: { userId: testUserId },
      update: {
        billingCountry: 'SG',
        currency: CurrencyCode.USD,
        billingName: 'Singapore Customer',
        billingAddress1: '10 Marina Boulevard',
        billingCity: 'Singapore',
        billingState: null,
        billingPostalCode: '018983'
      },
      create: {
        userId: testUserId,
        billingCountry: 'SG',
        currency: CurrencyCode.USD,
        billingName: 'Singapore Customer',
        billingAddress1: '10 Marina Boulevard',
        billingCity: 'Singapore',
        billingState: null,
        billingPostalCode: '018983'
      }
    });

    const profile = await BillingProfileService.getBillingProfile(testUserId);
    const isStateRequired = BillingCountryService.isStateRequired(profile.country);
    assert.strictEqual(isStateRequired, false);
    assert.ok(profile.fullName && profile.addressLine1 && profile.city && profile.postalCode);
  });

  test('TC-ADDR-07: Allows checkout session when postal code is omitted for countries without postal codes (e.g. UAE)', async () => {
    assert.strictEqual(BillingCountryService.isPostalCodeRequired('AE'), false);

    await prisma.accountBillingState.upsert({
      where: { userId: testUserId },
      update: {
        billingCountry: 'AE',
        currency: CurrencyCode.USD,
        billingName: 'Dubai Customer',
        billingAddress1: 'Sheikh Zayed Road',
        billingCity: 'Dubai',
        billingState: null,
        billingPostalCode: null
      },
      create: {
        userId: testUserId,
        billingCountry: 'AE',
        currency: CurrencyCode.USD,
        billingName: 'Dubai Customer',
        billingAddress1: 'Sheikh Zayed Road',
        billingCity: 'Dubai',
        billingState: null,
        billingPostalCode: null
      }
    });

    const profile = await BillingProfileService.getBillingProfile(testUserId);
    const isPostalRequired = BillingCountryService.isPostalCodeRequired(profile.country);
    assert.strictEqual(isPostalRequired, false);
    assert.ok(profile.fullName && profile.addressLine1 && profile.city);
  });
});
