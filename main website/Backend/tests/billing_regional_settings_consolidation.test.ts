import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

describe('ZC-BILLING-REGIONAL Consolidation Test Suite', () => {
  test('TC-BR-01: billing.html contains Billing & Regional Settings card', async () => {
    const billingPath = path.resolve(__dirname, '../../Frontend/pages/billing.html');
    assert.strictEqual(fs.existsSync(billingPath), true, 'billing.html must exist');
    const content = fs.readFileSync(billingPath, 'utf-8');
    assert.strictEqual(content.includes('id="billing-region-card"'), true, 'billing.html must include billing-region-card');
    assert.strictEqual(content.includes('id="billing-country-select"'), true, 'billing.html must include billing-country-select');
    assert.strictEqual(content.includes('id="billing-postal-input"'), true, 'billing.html must include billing-postal-input');
    assert.strictEqual(content.includes('saveBillingRegion'), true, 'billing.html must have saveBillingRegion handler');
    assert.strictEqual(content.includes('—'), false, 'billing.html must contain 0 em dashes');
  });

  test('TC-BR-02: Dashboard sidebar navigations do not include Regional Settings link', async () => {
    const pages = ['servers.html', 'subscription.html', 'transactions.html', 'billing.html', 'notifications.html'];
    for (const page of pages) {
      const pagePath = path.resolve(__dirname, `../../Frontend/pages/${page}`);
      const content = fs.readFileSync(pagePath, 'utf-8');
      assert.strictEqual(content.includes('<span>Regional Settings</span>'), false, `${page} must not have Regional Settings in sidebar`);
    }
  });

  test('TC-BR-03: settings.html redirects cleanly to billing.html', async () => {
    const settingsPath = path.resolve(__dirname, '../../Frontend/pages/settings.html');
    assert.strictEqual(fs.existsSync(settingsPath), true, 'settings.html must exist as a redirect');
    const content = fs.readFileSync(settingsPath, 'utf-8');
    assert.strictEqual(content.includes('billing.html'), true, 'settings.html must redirect to billing.html');
  });
});
