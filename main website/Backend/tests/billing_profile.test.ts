import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';
import { hashSessionToken } from '../src/utils/crypto.js';
import { CurrencyCode, AuditEventType } from '@prisma/client';
import { BillingProfileService } from '../src/services/billing/billing_profile_service.js';
import { AdminUserService } from '../src/routes/admin/operations/users/service.js';

describe('PHASE 4.3 ADDENDUM: Customer Billing Profile and Full Address Test Suite', () => {
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
        fullName: 'Initial Name A',
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
        fullName: 'Initial Name B',
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

  it('1. Authenticated customer can read own initial billing profile', async () => {
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
    assert.strictEqual(body.data.fullName, 'Initial Name A');
    assert.strictEqual(body.data.countryConfirmed, false);
  });

  it('2. Unauthenticated request to GET /api/v1/billing/profile is rejected (401)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/profile'
    });

    assert.strictEqual(res.statusCode, 401);
  });

  it('3. Authenticated customer can update and persist own full billing profile', async () => {
    const profilePayload = {
      fullName: 'Jane Doe Enterprises',
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
    assert.strictEqual(body.data.fullName, 'Jane Doe Enterprises');
    assert.strictEqual(body.data.addressLine1, '123 Cloud Relay Way');
    assert.strictEqual(body.data.addressLine2, 'Suite 400');
    assert.strictEqual(body.data.city, 'San Francisco');
    assert.strictEqual(body.data.state, 'California');
    assert.strictEqual(body.data.postalCode, '94105');
    assert.strictEqual(body.data.country, 'US');
    assert.strictEqual(body.data.currency, CurrencyCode.USD);
    assert.strictEqual(body.data.countryConfirmed, true);

    // Verify persistence directly in AccountBillingState database table
    const dbRecord = await prisma.accountBillingState.findUnique({
      where: { userId: testUserA.id }
    });
    assert.ok(dbRecord);
    assert.strictEqual(dbRecord?.billingName, 'Jane Doe Enterprises');
    assert.strictEqual(dbRecord?.billingAddress1, '123 Cloud Relay Way');
    assert.strictEqual(dbRecord?.billingAddress2, 'Suite 400');
    assert.strictEqual(dbRecord?.billingCity, 'San Francisco');
    assert.strictEqual(dbRecord?.billingState, 'California');
    assert.strictEqual(dbRecord?.billingPostalCode, '94105');
    assert.strictEqual(dbRecord?.billingCountry, 'US');
    assert.strictEqual(dbRecord?.currency, CurrencyCode.USD);

    // Verify audit event was logged
    const auditEvent = await prisma.auditEvent.findFirst({
      where: {
        userId: testUserA.id,
        eventType: AuditEventType.BILLING_STATE_UPDATED
      },
      orderBy: { createdAt: 'desc' }
    });
    assert.ok(auditEvent);
    assert.strictEqual((auditEvent?.metadata as any)?.action, 'UPDATE_BILLING_PROFILE');
  });

  it('4. Updated billing profile is returned in subsequent GET requests', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/profile',
      headers: {
        authorization: `Bearer ${tokenA}`
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.data.fullName, 'Jane Doe Enterprises');
    assert.strictEqual(body.data.addressLine1, '123 Cloud Relay Way');
    assert.strictEqual(body.data.city, 'San Francisco');
    assert.strictEqual(body.data.state, 'California');
    assert.strictEqual(body.data.country, 'US');
    assert.strictEqual(body.data.currency, 'USD');
    assert.strictEqual(body.data.countryConfirmed, true);
  });

  it('5. Indian billing address derives INR currency authoritatively', async () => {
    const inPayload = {
      fullName: 'Ramesh Patel',
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
      payload: inPayload
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.data.currency, CurrencyCode.INR);
    assert.strictEqual(body.data.country, 'IN');
    assert.strictEqual(body.data.postalCode, '560001');
  });

  it('6. Strict IDOR protection: User B cannot access User A profile', async () => {
    // Requesting profile as User B returns only User B's profile
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
    assert.notStrictEqual(bodyB.data.fullName, 'Jane Doe Enterprises');
  });

  it('7. Validation error is returned for invalid or missing required fields', async () => {
    // Missing fullName
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

    // Disallowed pseudocountry code (XX)
    const res3 = await app.inject({
      method: 'PUT',
      url: '/api/v1/billing/profile',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        fullName: 'Valid Name',
        addressLine1: 'Some Street',
        city: 'City',
        state: 'State',
        postalCode: '12345',
        country: 'XX'
      }
    });
    assert.strictEqual(res3.statusCode, 400);
  });

  it('8. AdminUserService.getUserDetail reads authoritative billing profile', async () => {
    const adminUserDetail = await AdminUserService.getUserDetail(testUserA.id);

    assert.ok(adminUserDetail);
    assert.ok(adminUserDetail.billing);
    assert.strictEqual(adminUserDetail.billing?.billingName, 'Jane Doe Enterprises');
    assert.strictEqual(adminUserDetail.billing?.billingAddress1, '123 Cloud Relay Way');
    assert.strictEqual(adminUserDetail.billing?.billingAddress2, 'Suite 400');
    assert.strictEqual(adminUserDetail.billing?.billingCity, 'San Francisco');
    assert.strictEqual(adminUserDetail.billing?.billingState, 'California');
    assert.strictEqual(adminUserDetail.billing?.billingPostalCode, '94105');
    assert.strictEqual(adminUserDetail.billing?.billingCountry, 'US');
    assert.strictEqual(adminUserDetail.billing?.currency, CurrencyCode.USD);
  });
});
