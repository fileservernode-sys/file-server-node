import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';
import { BillingStatus, CurrencyCode, AuditEventType } from '@prisma/client';
import { BillingStateService } from '../src/services/billing/billing_state_service.js';
import { BillingCountryService } from '../src/services/billing/billing_country_service.js';
import { PlanService } from '../src/services/billing/plan_service.js';

describe('ZC-BILLING-2.3 & 2.3-CORRECTIVE Billing Country and Unconfirmed Currency Test Suite', () => {
  let app: FastifyInstance;
  let testUserA: any;
  let tokenA: string;
  let testUserB: any;
  let tokenB: string;
  let testUserUnconfirmed: any;
  let tokenUnconfirmed: string;

  before(async () => {
    app = await buildApp();
    await app.ready();
    await PlanService.seedInitialCatalog();

    // Create Test User A
    testUserA = await prisma.user.create({
      data: {
        email: `billing.country.a.${Date.now()}@remotenode.io`,
        fullName: 'Billing Test User A',
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    const sessionA = await prisma.userSession.create({
      data: {
        userId: testUserA.id,
        token: `tok_billing_country_a_${Date.now()}`,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });
    tokenA = sessionA.token;

    // Create Test User B
    testUserB = await prisma.user.create({
      data: {
        email: `billing.country.b.${Date.now()}@remotenode.io`,
        fullName: 'Billing Test User B',
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    const sessionB = await prisma.userSession.create({
      data: {
        userId: testUserB.id,
        token: `tok_billing_country_b_${Date.now()}`,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });
    tokenB = sessionB.token;

    // Create Unconfirmed Test User
    testUserUnconfirmed = await prisma.user.create({
      data: {
        email: `billing.unconfirmed.${Date.now()}@remotenode.io`,
        fullName: 'Unconfirmed Billing User',
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    const sessionUnconfirmed = await prisma.userSession.create({
      data: {
        userId: testUserUnconfirmed.id,
        token: `tok_billing_unconfirmed_${Date.now()}`,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });
    tokenUnconfirmed = sessionUnconfirmed.token;
  });

  after(async () => {
    // Cleanup users and associated records
    if (testUserA) {
      await prisma.user.delete({ where: { id: testUserA.id } }).catch(() => {});
    }
    if (testUserB) {
      await prisma.user.delete({ where: { id: testUserB.id } }).catch(() => {});
    }
    if (testUserUnconfirmed) {
      await prisma.user.delete({ where: { id: testUserUnconfirmed.id } }).catch(() => {});
    }
    await app.close();
  });

  // Scenario 1: New / Unconfirmed account semantics
  it('1. New unconfirmed account has billingCountry = null, currency = null, countryConfirmed = false', async () => {
    const state = await BillingStateService.getBillingState(testUserUnconfirmed.id);
    assert.strictEqual(state.billingCountry, null);
    assert.strictEqual(state.currency, null);
    assert.strictEqual(state.status, BillingStatus.FREE);

    const effective = await BillingStateService.getEffectivePlan(testUserUnconfirmed.id);
    assert.strictEqual(effective.planCode, 'FREE');
    assert.strictEqual(effective.billingCountry, null);
    assert.strictEqual(effective.currency, null);
  });

  // Scenario 2: GET /api/v1/billing for unconfirmed account returns currency = null
  it('2. GET /api/v1/billing for unconfirmed account returns currency = null, countryConfirmed = false (not INR)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/billing',
      headers: {
        authorization: `Bearer ${tokenUnconfirmed}`
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.billingCountry, null);
    assert.strictEqual(body.data.currency, null);
    assert.strictEqual(body.data.countryConfirmed, false);
    assert.strictEqual(body.data.plan, 'FREE');
  });

  // Scenario 3: India confirmation
  it('3. Authenticated user confirms IN + valid postal -> persisted successfully with currency = INR', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/billing/country',
      headers: {
        authorization: `Bearer ${tokenA}`
      },
      payload: {
        country: 'IN',
        postalCode: '392001'
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.billingCountry, 'IN');
    assert.strictEqual(body.data.billingPostalCode, '392001');
    assert.strictEqual(body.data.currency, 'INR');
    assert.strictEqual(body.data.countryConfirmed, true);

    // Verify database state
    const state = await prisma.accountBillingState.findUnique({
      where: { userId: testUserA.id }
    });
    assert.ok(state);
    assert.strictEqual(state.billingCountry, 'IN');
    assert.strictEqual(state.billingPostalCode, '392001');
    assert.strictEqual(state.currency, CurrencyCode.INR);
  });

  // Scenario 4: Non-India confirmation
  it('4. Authenticated user confirms US + valid postal -> USD derived', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/billing/country',
      headers: {
        authorization: `Bearer ${tokenA}`
      },
      payload: {
        country: 'US',
        postalCode: '90210'
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.billingCountry, 'US');
    assert.strictEqual(body.data.billingPostalCode, '90210');
    assert.strictEqual(body.data.currency, 'USD');
    assert.strictEqual(body.data.countryConfirmed, true);

    const state = await prisma.accountBillingState.findUnique({
      where: { userId: testUserA.id }
    });
    assert.strictEqual(state?.currency, CurrencyCode.USD);
  });

  it('5. Lowercase country code (e.g. in) normalized to IN', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/billing/country',
      headers: {
        authorization: `Bearer ${tokenA}`
      },
      payload: {
        country: '  in  ',
        postalCode: '110001'
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.data.billingCountry, 'IN');
    assert.strictEqual(body.data.currency, 'INR');
  });

  it('6. Invalid country code (e.g. IND / 3-letter / full name) rejected with 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/billing/country',
      headers: {
        authorization: `Bearer ${tokenA}`
      },
      payload: {
        country: 'IND',
        postalCode: '110001'
      }
    });

    assert.strictEqual(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'VALIDATION_ERROR');
  });

  it('7. Disallowed pseudocountry code T1 rejected with 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/billing/country',
      headers: {
        authorization: `Bearer ${tokenA}`
      },
      payload: {
        country: 'T1',
        postalCode: '12345'
      }
    });

    assert.strictEqual(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.error.code, 'VALIDATION_ERROR');
  });

  it('8. Disallowed pseudocountry code XX rejected with 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/billing/country',
      headers: {
        authorization: `Bearer ${tokenA}`
      },
      payload: {
        country: 'XX',
        postalCode: '12345'
      }
    });

    assert.strictEqual(res.statusCode, 400);
  });

  it('9. Empty postal code rejected with 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/billing/country',
      headers: {
        authorization: `Bearer ${tokenA}`
      },
      payload: {
        country: 'IN',
        postalCode: ''
      }
    });

    assert.strictEqual(res.statusCode, 400);
  });

  it('10. Whitespace-only postal code rejected with 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/billing/country',
      headers: {
        authorization: `Bearer ${tokenA}`
      },
      payload: {
        country: 'IN',
        postalCode: '   '
      }
    });

    assert.strictEqual(res.statusCode, 400);
  });

  it('11. Legitimate international alphanumeric postal code accepted (e.g. UK SW1A 1AA)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/billing/country',
      headers: {
        authorization: `Bearer ${tokenA}`
      },
      payload: {
        country: 'GB',
        postalCode: 'SW1A 1AA'
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.data.billingCountry, 'GB');
    assert.strictEqual(body.data.billingPostalCode, 'SW1A 1AA');
    assert.strictEqual(body.data.currency, 'USD');
  });

  it('12. Unauthenticated request rejected with 401', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/billing/country',
      payload: {
        country: 'IN',
        postalCode: '392001'
      }
    });

    assert.strictEqual(res.statusCode, 401);
  });

  // Scenario 10: IDOR protection
  it('13. IDOR Protection: User A cannot modify User B billing country via body payload', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/billing/country',
      headers: {
        authorization: `Bearer ${tokenA}`
      },
      payload: {
        userId: testUserB.id,
        accountId: testUserB.id,
        country: 'AE',
        postalCode: '00000'
      }
    });

    assert.strictEqual(res.statusCode, 200);

    // Verify User A was updated to AE, but User B remains untouched
    const stateA = await prisma.accountBillingState.findUnique({
      where: { userId: testUserA.id }
    });
    assert.strictEqual(stateA?.billingCountry, 'AE');

    const stateB = await prisma.accountBillingState.findUnique({
      where: { userId: testUserB.id }
    });
    assert.strictEqual(stateB?.billingCountry || null, null);
  });

  it('14. Country IN authoritatively derives INR', () => {
    assert.strictEqual(BillingCountryService.deriveBillingCurrency('IN'), CurrencyCode.INR);
    assert.strictEqual(BillingCountryService.deriveBillingCurrency('in'), CurrencyCode.INR);
  });

  it('15. Non-IN countries derive USD (GB, DE, US, AE, SG)', () => {
    assert.strictEqual(BillingCountryService.deriveBillingCurrency('US'), CurrencyCode.USD);
    assert.strictEqual(BillingCountryService.deriveBillingCurrency('GB'), CurrencyCode.USD);
    assert.strictEqual(BillingCountryService.deriveBillingCurrency('DE'), CurrencyCode.USD);
    assert.strictEqual(BillingCountryService.deriveBillingCurrency('AE'), CurrencyCode.USD);
    assert.strictEqual(BillingCountryService.deriveBillingCurrency('SG'), CurrencyCode.USD);
  });

  // Scenario 5: Reverse spoofing
  it('16. Client cannot force country=IN and currency=USD (currency ignored/overridden to INR)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/billing/country',
      headers: {
        authorization: `Bearer ${tokenA}`
      },
      payload: {
        country: 'IN',
        postalCode: '392001',
        currency: 'USD'
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.data.billingCountry, 'IN');
    assert.strictEqual(body.data.currency, 'INR');

    const state = await prisma.accountBillingState.findUnique({
      where: { userId: testUserA.id }
    });
    assert.strictEqual(state?.currency, CurrencyCode.INR);
  });

  // Scenario 6: Client spoofing
  it('17. Client cannot force country=US and currency=INR (currency ignored/overridden to USD)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/billing/country',
      headers: {
        authorization: `Bearer ${tokenA}`
      },
      payload: {
        country: 'US',
        postalCode: '10001',
        currency: 'INR'
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.data.billingCountry, 'US');
    assert.strictEqual(body.data.currency, 'USD');

    const state = await prisma.accountBillingState.findUnique({
      where: { userId: testUserA.id }
    });
    assert.strictEqual(state?.currency, CurrencyCode.USD);
  });

  // Scenario 9: Storefront region does not mutate billing country
  it('18. Request CF-IPCountry header does not automatically persist to billing country', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/v1/storefront/region',
      headers: {
        'cf-ipcountry': 'DE'
      }
    });

    const state = await prisma.accountBillingState.findUnique({
      where: { userId: testUserB.id }
    });
    // User B never confirmed country, must remain null
    assert.strictEqual(state?.billingCountry || null, null);
    assert.strictEqual(state?.currency || null, null);
  });

  it('19. Detected country in new requests does not overwrite confirmed country', async () => {
    // User A has confirmed US
    await app.inject({
      method: 'GET',
      url: '/api/v1/billing',
      headers: {
        authorization: `Bearer ${tokenA}`,
        'cf-ipcountry': 'IN'
      }
    });

    const state = await prisma.accountBillingState.findUnique({
      where: { userId: testUserA.id }
    });
    // Remains US
    assert.strictEqual(state?.billingCountry, 'US');
    assert.strictEqual(state?.currency, CurrencyCode.USD);
  });

  // Scenario 8: Existing subscription preservation
  it('20. Existing subscription remains unchanged after country change', async () => {
    // Create an active INR subscription for User A
    const sub = await BillingStateService.createSubscription({
      userId: testUserA.id,
      planCode: 'PRO_MONTHLY',
      currency: CurrencyCode.INR
    });

    assert.strictEqual(sub.currency, CurrencyCode.INR);
    assert.strictEqual(sub.amountMinorUnits, 4900);
    const initialPlanPriceId = sub.planPriceId;

    // Now User A updates country to Germany (DE) -> USD
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/billing/country',
      headers: {
        authorization: `Bearer ${tokenA}`
      },
      payload: {
        country: 'DE',
        postalCode: '10115'
      }
    });

    assert.strictEqual(res.statusCode, 200);

    // Verify AccountBillingState updated to DE and USD
    const state = await prisma.accountBillingState.findUnique({
      where: { userId: testUserA.id }
    });
    assert.strictEqual(state?.billingCountry, 'DE');
    assert.strictEqual(state?.currency, CurrencyCode.USD);

    // Verify Subscription contract remained UNMUTED
    const refreshedSub = await prisma.subscription.findUnique({
      where: { id: sub.id }
    });
    assert.strictEqual(refreshedSub?.currency, CurrencyCode.INR);
    assert.strictEqual(refreshedSub?.amountMinorUnits, 4900);
    assert.strictEqual(refreshedSub?.planPriceId, initialPlanPriceId);
  });

  it('21. Existing PlanPrice remains unchanged after country change', async () => {
    const pricesBefore = await prisma.planPrice.findMany();
    
    await app.inject({
      method: 'PUT',
      url: '/api/v1/billing/country',
      headers: {
        authorization: `Bearer ${tokenA}`
      },
      payload: {
        country: 'JP',
        postalCode: '100-0001'
      }
    });

    const pricesAfter = await prisma.planPrice.findMany();
    assert.strictEqual(pricesBefore.length, pricesAfter.length);
  });

  it('22. Entitlements remain unchanged after country change', async () => {
    const effective = await BillingStateService.getEffectivePlan(testUserA.id);
    assert.strictEqual(effective.planCode, 'PRO_MONTHLY');
    assert.strictEqual(effective.status, BillingStatus.ACTIVE);
  });

  it('23. Server/device records remain unchanged', async () => {
    const devices = await prisma.device.findMany({ where: { userId: testUserA.id } });
    assert.strictEqual(devices.length, 0);
  });

  it('24. Billing audit event BILLING_STATE_UPDATED is recorded with metadata', async () => {
    const auditEvents = await prisma.auditEvent.findMany({
      where: {
        userId: testUserA.id,
        eventType: AuditEventType.BILLING_STATE_UPDATED
      },
      orderBy: { createdAt: 'desc' }
    });

    assert.ok(auditEvents.length > 0);
    const latestEvent = auditEvents[0];
    const metadata = latestEvent.metadata as any;
    assert.strictEqual(metadata.action, 'CONFIRM_BILLING_COUNTRY');
    assert.strictEqual(metadata.newCountry, 'JP');
    assert.strictEqual(metadata.newCurrency, 'USD');
  });

  it('25. AccountBillingState remains unique per user', async () => {
    const count = await prisma.accountBillingState.count({
      where: { userId: testUserA.id }
    });
    assert.strictEqual(count, 1);
  });

  it('26. Concurrent confirmation does not create duplicate billing-state rows', async () => {
    // Run 5 parallel confirmations for User B
    await Promise.all([
      BillingCountryService.confirmBillingCountry(testUserB.id, { country: 'SG', postalCode: '048616' }),
      BillingCountryService.confirmBillingCountry(testUserB.id, { country: 'SG', postalCode: '048616' }),
      BillingCountryService.confirmBillingCountry(testUserB.id, { country: 'SG', postalCode: '048616' }),
      BillingCountryService.confirmBillingCountry(testUserB.id, { country: 'SG', postalCode: '048616' }),
      BillingCountryService.confirmBillingCountry(testUserB.id, { country: 'SG', postalCode: '048616' })
    ]);

    const countB = await prisma.accountBillingState.count({
      where: { userId: testUserB.id }
    });
    assert.strictEqual(countB, 1);
  });

  // Scenario 7: Existing confirmed account remains consistent
  it('27. GET /api/v1/billing returns confirmed country, currency, and countryConfirmed: true', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/billing',
      headers: {
        authorization: `Bearer ${tokenB}`
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.billingCountry, 'SG');
    assert.strictEqual(body.data.currency, 'USD');
    assert.strictEqual(body.data.countryConfirmed, true);
  });
});
