import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';
import { hashSessionToken } from '../src/utils/crypto.js';
import { CurrencyCode, AuditEventType } from '@prisma/client';
import { BillingProfileService } from '../src/services/billing/billing_profile_service.js';
import { AdminUserService } from '../src/routes/admin/operations/users/service.js';

describe('PHASE 6.4: Full Legal Name, Billing Address & Tax Profile Test Suite', () => {
  let app: FastifyInstance;
  let testUserA: any;
  let tokenA: string;
  let testUserB: any;
  let tokenB: string;

  before(async () => {
    app = await buildApp();
    await app.ready();

    // Create Test User A
    testUserA = await prisma.user.create({
      data: {
        email: `billing.profile.a.${Date.now()}@zdexcloud.com`,
        fullName: 'Initial Legal Name A',
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    tokenA = `tok_billing_profile_a_${Date.now()}`;
    await prisma.userSession.create({
      data: {
        userId: testUserA.id,
        tokenHash: hashSessionToken(tokenA),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });

    // Create Test User B
    testUserB = await prisma.user.create({
      data: {
        email: `billing.profile.b.${Date.now()}@zdexcloud.com`,
        fullName: 'Initial Legal Name B',
        status: 'ACTIVE',
        emailVerified: true
      }
    });

    tokenB = `tok_billing_profile_b_${Date.now()}`;
    await prisma.userSession.create({
      data: {
        userId: testUserB.id,
        tokenHash: hashSessionToken(tokenB),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });
  });

  after(async () => {
    if (testUserA) {
      await prisma.auditEvent.deleteMany({ where: { userId: testUserA.id } });
      await prisma.userSession.deleteMany({ where: { userId: testUserA.id } });
      await prisma.accountBillingState.deleteMany({ where: { userId: testUserA.id } });
      await prisma.user.deleteMany({ where: { id: testUserA.id } });
    }
    if (testUserB) {
      await prisma.auditEvent.deleteMany({ where: { userId: testUserB.id } });
      await prisma.userSession.deleteMany({ where: { userId: testUserB.id } });
      await prisma.accountBillingState.deleteMany({ where: { userId: testUserB.id } });
      await prisma.user.deleteMany({ where: { id: testUserB.id } });
    }
    await app.close();
  });

  it('1. Authenticated customer can read initial billing profile with verified account email', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/profile',
      headers: {
        authorization: `Bearer ${tokenA}`
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.fullName, 'Initial Legal Name A');
    assert.strictEqual(body.data.email, testUserA.email);
    assert.strictEqual(body.data.companyName, null);
    assert.strictEqual(body.data.taxId, null);
    assert.strictEqual(body.data.countryConfirmed, false);
  });

  it('2. Unauthenticated request to GET /api/v1/billing/profile is rejected (401)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/profile'
    });

    assert.strictEqual(res.statusCode, 401);
  });

  it('3. Authenticated customer can update and persist full legal name, business entity, and address', async () => {
    const profilePayload = {
      fullName: 'Alice Walker',
      companyName: 'Walker Cloud Systems LLC',
      taxId: 'US-987654321',
      addressLine1: '123 Cloud Relay Way',
      addressLine2: 'Suite 400',
      city: 'San Francisco',
      state: 'California',
      postalCode: '94105',
      country: 'US'
    };

    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/billing/profile',
      headers: {
        authorization: `Bearer ${tokenA}`
      },
      payload: profilePayload
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.fullName, 'Alice Walker');
    assert.strictEqual(body.data.email, testUserA.email);
    assert.strictEqual(body.data.companyName, 'Walker Cloud Systems LLC');
    assert.strictEqual(body.data.taxId, 'US-987654321');
    assert.strictEqual(body.data.addressLine1, '123 Cloud Relay Way');
    assert.strictEqual(body.data.addressLine2, 'Suite 400');
    assert.strictEqual(body.data.city, 'San Francisco');
    assert.strictEqual(body.data.state, 'California');
    assert.strictEqual(body.data.postalCode, '94105');
    assert.strictEqual(body.data.country, 'US');
    assert.strictEqual(body.data.currency, CurrencyCode.USD);
    assert.strictEqual(body.data.countryConfirmed, true);

    // Verify persistence in AccountBillingState database table
    const dbRecord = await prisma.accountBillingState.findUnique({
      where: { userId: testUserA.id }
    });
    assert.ok(dbRecord);
    assert.strictEqual(dbRecord?.billingName, 'Alice Walker');
    assert.strictEqual(dbRecord?.billingAddress1, '123 Cloud Relay Way');
    assert.strictEqual(dbRecord?.billingAddress2, 'Suite 400');
    assert.strictEqual(dbRecord?.billingCity, 'San Francisco');
    assert.strictEqual(dbRecord?.billingState, 'California');
    assert.strictEqual(dbRecord?.billingPostalCode, '94105');
    assert.strictEqual(dbRecord?.billingCountry, 'US');
    assert.strictEqual(dbRecord?.currency, CurrencyCode.USD);

    // Verify audit event logged with companyName and taxId metadata
    const auditEvent = await prisma.auditEvent.findFirst({
      where: {
        userId: testUserA.id,
        eventType: AuditEventType.BILLING_STATE_UPDATED
      },
      orderBy: { createdAt: 'desc' }
    });
    assert.ok(auditEvent);
    const meta = auditEvent?.metadata as any;
    assert.strictEqual(meta?.action, 'UPDATE_BILLING_PROFILE');
    assert.strictEqual(meta?.fullName, 'Alice Walker');
    assert.strictEqual(meta?.companyName, 'Walker Cloud Systems LLC');
    assert.strictEqual(meta?.taxId, 'US-987654321');
  });

  it('4. Updated billing profile round-trips via GET /api/v1/billing/profile', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/profile',
      headers: {
        authorization: `Bearer ${tokenA}`
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.data.fullName, 'Alice Walker');
    assert.strictEqual(body.data.email, testUserA.email);
    assert.strictEqual(body.data.companyName, 'Walker Cloud Systems LLC');
    assert.strictEqual(body.data.taxId, 'US-987654321');
    assert.strictEqual(body.data.addressLine1, '123 Cloud Relay Way');
    assert.strictEqual(body.data.city, 'San Francisco');
    assert.strictEqual(body.data.state, 'California');
    assert.strictEqual(body.data.country, 'US');
    assert.strictEqual(body.data.currency, 'USD');
    assert.strictEqual(body.data.countryConfirmed, true);
  });

  it('5. Indian billing address derives INR currency and validates GSTIN format', async () => {
    const validInPayload = {
      fullName: 'Ramesh Patel',
      companyName: 'Patel Infotech Private Limited',
      taxId: '24ABCDE1234F1Z5',
      addressLine1: '42 Tech Park, MG Road',
      addressLine2: null,
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560001',
      country: 'IN'
    };

    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/billing/profile',
      headers: {
        authorization: `Bearer ${tokenB}`
      },
      payload: validInPayload
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.data.currency, CurrencyCode.INR);
    assert.strictEqual(body.data.country, 'IN');
    assert.strictEqual(body.data.taxId, '24ABCDE1234F1Z5');
    assert.strictEqual(body.data.postalCode, '560001');
  });

  it('6. Invalid Indian GSTIN format is rejected with validation error (400)', async () => {
    const invalidGstinPayload = {
      fullName: 'Ramesh Patel',
      companyName: 'Patel Infotech',
      taxId: 'INVALID_GSTIN_123',
      addressLine1: '42 Tech Park, MG Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560001',
      country: 'IN'
    };

    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/billing/profile',
      headers: {
        authorization: `Bearer ${tokenB}`
      },
      payload: invalidGstinPayload
    });

    assert.strictEqual(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, false);
    assert.ok(body.error.message.includes('GSTIN'));
  });

  it('7. Country-aware rules: Singapore allows empty state/province', async () => {
    const sgPayload = {
      fullName: 'Tan Wei Ming',
      companyName: null,
      taxId: null,
      addressLine1: '10 Marina Boulevard',
      addressLine2: '#20-01 Marina Bay',
      city: 'Singapore',
      state: '',
      postalCode: '018983',
      country: 'SG'
    };

    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/billing/profile',
      headers: {
        authorization: `Bearer ${tokenA}`
      },
      payload: sgPayload
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.data.country, 'SG');
    assert.strictEqual(body.data.state, '');
  });

  it('8. Country-aware rules: UAE allows empty postal/ZIP code', async () => {
    const uaePayload = {
      fullName: 'Rashid Al Maktoum',
      companyName: 'Emirates Cloud FZE',
      taxId: null,
      addressLine1: 'Sheikh Zayed Road',
      addressLine2: 'Level 14',
      city: 'Dubai',
      state: 'Dubai',
      postalCode: '',
      country: 'AE'
    };

    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/billing/profile',
      headers: {
        authorization: `Bearer ${tokenA}`
      },
      payload: uaePayload
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.data.country, 'AE');
    assert.strictEqual(body.data.postalCode, '');
  });

  it('9. Strict IDOR protection: User B cannot access User A profile', async () => {
    const resB = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/profile',
      headers: {
        authorization: `Bearer ${tokenB}`
      }
    });

    assert.strictEqual(resB.statusCode, 200);
    const bodyB = JSON.parse(resB.body);
    assert.strictEqual(bodyB.data.fullName, 'Ramesh Patel');
    assert.strictEqual(bodyB.data.email, testUserB.email);
    assert.notStrictEqual(bodyB.data.fullName, 'Alice Walker');
  });

  it('10. Validation error is returned for invalid or missing required fields', async () => {
    // Missing legal name
    const res1 = await app.inject({
      method: 'PUT',
      url: '/api/v1/billing/profile',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        fullName: '',
        addressLine1: 'Some Street',
        city: 'City',
        state: 'State',
        postalCode: '12345',
        country: 'US'
      }
    });
    assert.strictEqual(res1.statusCode, 400);

    // Invalid country code (not ISO 3166-1)
    const res2 = await app.inject({
      method: 'PUT',
      url: '/api/v1/billing/profile',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        fullName: 'Valid Name',
        addressLine1: 'Some Street',
        city: 'City',
        state: 'State',
        postalCode: '12345',
        country: 'INVALID_COUNTRY'
      }
    });
    assert.strictEqual(res2.statusCode, 400);

    // State required for US when omitted
    const res3 = await app.inject({
      method: 'PUT',
      url: '/api/v1/billing/profile',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        fullName: 'Valid Name',
        addressLine1: 'Some Street',
        city: 'City',
        state: '',
        postalCode: '12345',
        country: 'US'
      }
    });
    assert.strictEqual(res3.statusCode, 400);
  });

  it('11. AdminUserService.getUserDetail reads authoritative billing profile including company and tax ID', async () => {
    const adminUserDetail = await AdminUserService.getUserDetail(testUserB.id);

    assert.ok(adminUserDetail);
    assert.ok(adminUserDetail.billing);
    assert.strictEqual(adminUserDetail.billing?.billingName, 'Ramesh Patel');
    assert.strictEqual(adminUserDetail.billing?.companyName, 'Patel Infotech Private Limited');
    assert.strictEqual(adminUserDetail.billing?.taxId, '24ABCDE1234F1Z5');
    assert.strictEqual(adminUserDetail.billing?.billingAddress1, '42 Tech Park, MG Road');
    assert.strictEqual(adminUserDetail.billing?.billingCity, 'Bengaluru');
    assert.strictEqual(adminUserDetail.billing?.billingState, 'Karnataka');
    assert.strictEqual(adminUserDetail.billing?.billingPostalCode, '560001');
    assert.strictEqual(adminUserDetail.billing?.billingCountry, 'IN');
    assert.strictEqual(adminUserDetail.billing?.currency, CurrencyCode.INR);
  });
});
