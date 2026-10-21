// NOTE: These tests are NOT EXECUTED as per policy.
import { describe, it, expect } from 'vitest';
import { templateRegistry } from '../src/notifications/services/template_registry.js';
import { NotificationType } from '../src/notifications/types/type_registry.js';
import { NotificationChannel } from '../src/notifications/types/channel.js';
import { NotificationCategory } from '../src/notifications/types/category.js';
import { NotificationSeverity } from '../src/notifications/types/severity.js';
import { ChannelRouter } from '../src/notifications/services/channel_router.js';
import {
  getDefaultNotificationPreferences,
  UserNotificationPreferences
} from '../src/notifications/types/preference.js';
import {
  getPaymentSucceededEmailTemplate,
  getPaymentFailedEmailTemplate,
  getSubscriptionActivatedEmailTemplate,
  getSubscriptionRenewedEmailTemplate,
  getSubscriptionDunningEmailTemplate,
  getSubscriptionExpiredEmailTemplate,
  getRefundProcessedEmailTemplate
} from '../src/services/email_templates.js';

describe('Phase 11.3: Email Notification Expansion Test Suite (NOT EXECUTED)', () => {
  const billingTypes: NotificationType[] = [
    NotificationType.INVOICE_ISSUED,
    NotificationType.PAYMENT_SUCCEEDED,
    NotificationType.PAYMENT_FAILED,
    NotificationType.SUBSCRIPTION_ACTIVATED,
    NotificationType.SUBSCRIPTION_RENEWED,
    NotificationType.SUBSCRIPTION_PAYMENT_FAILED,
    NotificationType.SUBSCRIPTION_CANCELLED,
    NotificationType.SUBSCRIPTION_EXPIRED,
    NotificationType.BILLING_REFUND_PROCESSED,
    NotificationType.BILLING_REFUND_FAILED
  ];

  describe('1. Billing Notification Template Rendering & Consistency', () => {
    it.each(billingTypes)('renders valid HTML and plain text for %s with full metadata', (type) => {
      const metadata = {
        userName: 'Alex Mercer',
        userEmail: 'alex@example.com',
        invoiceNumber: 'INV-2026-0099',
        planName: 'Pro Tier (Annual)',
        formattedAmount: '120.00',
        currency: 'USD',
        amountMinorUnits: 12000,
        milestone: 'Day 3 Notice',
        billingPeriodEnd: '2027-10-15',
        customSummary: 'Custom summary for billing event'
      };

      const rendered = templateRegistry.render(type, metadata);

      expect(rendered.title).toBeDefined();
      expect(rendered.title.length).toBeGreaterThan(0);
      expect(rendered.emailSubject).toBeDefined();
      expect(rendered.emailSubject.length).toBeGreaterThan(0);
      expect(rendered.emailHtml).toBeDefined();
      expect(rendered.emailHtml.length).toBeGreaterThan(0);
      expect(rendered.emailText).toBeDefined();
      expect(rendered.emailText.length).toBeGreaterThan(0);

      // Verify no raw unparsed placeholders or undefined string leakage
      expect(rendered.emailHtml).not.toContain('undefined');
      expect(rendered.emailHtml).not.toContain('null');
      expect(rendered.emailHtml).not.toContain('NaN');
      expect(rendered.emailText).not.toContain('undefined');
      expect(rendered.emailText).not.toContain('null');
      expect(rendered.emailText).not.toContain('NaN');
    });

    it.each(billingTypes)('renders graceful fallbacks for %s when metadata is empty', (type) => {
      const rendered = templateRegistry.render(type, {});

      expect(rendered.title).toBeDefined();
      expect(rendered.emailSubject).toBeDefined();
      expect(rendered.emailHtml).toBeDefined();
      expect(rendered.emailText).toBeDefined();

      // Ensure fallback strings are clean and contain no 'undefined' literals
      expect(rendered.emailHtml).not.toContain('undefined');
      expect(rendered.emailHtml).not.toContain('null');
      expect(rendered.emailText).not.toContain('undefined');
      expect(rendered.emailText).not.toContain('null');
    });
  });

  describe('2. Metadata Sanitization & Financial Secret Prevention', () => {
    it('strips sensitive financial keys and credentials from template context and rendered output', () => {
      const leakedMetadata: Record<string, any> = {
        userName: 'Jordan Lee',
        formattedAmount: '49.99',
        currency: 'USD',
        cvv: '123',
        cardNumber: '4111222233334444',
        pan: '4111222233334444',
        paymentCredential: 'super-secret-key',
        razorpay_signature: 'abc123sig',
        rawPayload: '{"card":"leaked"}',
        taxId: 'TX-998877',
        gstin: '29ABCDE1234F1Z5',
        vatNumber: 'GB123456789',
        accountNumber: '9876543210',
        privateDocumentUrl: 'https://s3.private/invoice.pdf',
        downloadUrl: 'https://cdn.internal/doc.pdf',
        pdfUrl: 'https://storage.googleapis.com/secret.pdf'
      };

      const rendered = templateRegistry.render(NotificationType.PAYMENT_SUCCEEDED, leakedMetadata as any);

      // Assert none of the sensitive values are leaked into rendered outputs
      expect(rendered.emailHtml).not.toContain('123');
      expect(rendered.emailHtml).not.toContain('4111222233334444');
      expect(rendered.emailHtml).not.toContain('super-secret-key');
      expect(rendered.emailHtml).not.toContain('abc123sig');
      expect(rendered.emailHtml).not.toContain('TX-998877');
      expect(rendered.emailHtml).not.toContain('29ABCDE1234F1Z5');
      expect(rendered.emailHtml).not.toContain('GB123456789');
      expect(rendered.emailHtml).not.toContain('9876543210');
      expect(rendered.emailHtml).not.toContain('https://s3.private/invoice.pdf');
      expect(rendered.emailHtml).not.toContain('https://cdn.internal/doc.pdf');
      expect(rendered.emailHtml).not.toContain('https://storage.googleapis.com/secret.pdf');

      expect(rendered.emailText).not.toContain('4111222233334444');
      expect(rendered.emailText).not.toContain('super-secret-key');
    });

    it('escapes HTML special characters in metadata to prevent injection attacks', () => {
      const maliciousMetadata = {
        userName: '<script>alert("xss")</script>',
        planName: '<img src=x onerror=alert(1)>',
        customSummary: '<b>Alert!</b>'
      };

      const rendered = templateRegistry.render(NotificationType.PAYMENT_SUCCEEDED, maliciousMetadata as any);

      expect(rendered.emailHtml).not.toContain('<script>');
      expect(rendered.emailHtml).toContain('&lt;script&gt;');
      expect(rendered.emailHtml).not.toContain('<img src=x onerror=alert(1)>');
      expect(rendered.emailHtml).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });
  });

  describe('3. ChannelRouter Invoice Duplicate Prevention Guard', () => {
    const router = new ChannelRouter();

    it('suppresses NotificationChannel.EMAIL for INVOICE_ISSUED to prevent duplicate emails with dedicated outbox', () => {
      const invoiceEvent = {
        eventId: 'evt-inv-1',
        eventType: NotificationType.INVOICE_ISSUED,
        category: NotificationCategory.BILLING,
        severity: NotificationSeverity.INFO,
        userId: 'user-123',
        title: 'Invoice Issued',
        body: 'Your invoice is ready',
        metadata: { invoiceNumber: 'INV-2026-0001' },
        createdAt: new Date()
      };

      const prefs = getDefaultNotificationPreferences('user-123');
      // Ensure email is enabled globally and in billing category
      prefs.globalEmailEnabled = true;
      prefs.categories[NotificationCategory.BILLING].channels[NotificationChannel.EMAIL] = true;

      const routing = router.evaluateRouting(invoiceEvent, prefs, []);

      // Critical assertion: INVOICE_ISSUED must omit EMAIL to avoid double dispatch
      expect(routing.allowedChannels).toContain(NotificationChannel.IN_APP);
      expect(routing.allowedChannels).not.toContain(NotificationChannel.EMAIL);
      expect(routing.securityBypassTriggered).toBe(false);
    });

    it('allows NotificationChannel.EMAIL for standard billing events (PAYMENT_SUCCEEDED) when enabled in preferences', () => {
      const paymentEvent = {
        eventId: 'evt-pay-1',
        eventType: NotificationType.PAYMENT_SUCCEEDED,
        category: NotificationCategory.BILLING,
        severity: NotificationSeverity.INFO,
        userId: 'user-123',
        title: 'Payment Succeeded',
        body: 'Your payment was successful',
        metadata: { formattedAmount: '49.00' },
        createdAt: new Date()
      };

      const prefs = getDefaultNotificationPreferences('user-123');
      prefs.globalEmailEnabled = true;
      prefs.categories[NotificationCategory.BILLING].channels[NotificationChannel.EMAIL] = true;

      const routing = router.evaluateRouting(paymentEvent, prefs, []);

      expect(routing.allowedChannels).toContain(NotificationChannel.IN_APP);
      expect(routing.allowedChannels).toContain(NotificationChannel.EMAIL);
      expect(routing.securityBypassTriggered).toBe(false);
    });
  });

  describe('4. Preference Evaluation & Security Bypass Policy', () => {
    const router = new ChannelRouter();

    it('suppresses billing email and push channels when billing category is disabled in user preferences', () => {
      const billingEvent = {
        eventId: 'evt-bill-disabled',
        eventType: NotificationType.SUBSCRIPTION_RENEWED,
        category: NotificationCategory.BILLING,
        severity: NotificationSeverity.INFO,
        userId: 'user-pref-test',
        title: 'Subscription Renewed',
        body: 'Plan renewed',
        metadata: {},
        createdAt: new Date()
      };

      const prefs = getDefaultNotificationPreferences('user-pref-test');
      prefs.categories[NotificationCategory.BILLING].enabled = false;

      const routing = router.evaluateRouting(billingEvent, prefs, []);

      // In-app history preserved, but email and push suppressed
      expect(routing.allowedChannels).toEqual([NotificationChannel.IN_APP]);
      expect(routing.suppressionReason).toContain('disabled by user preferences');
      expect(routing.securityBypassTriggered).toBe(false);
    });

    it('forces delivery across IN_APP, PUSH, and EMAIL for security-critical events regardless of user preferences', () => {
      const securityEvent = {
        eventId: 'evt-sec-bypass',
        eventType: NotificationType.SECURITY_EVENT,
        category: NotificationCategory.ACCOUNT_SECURITY,
        severity: NotificationSeverity.CRITICAL,
        userId: 'user-sec-test',
        title: 'Security Alert',
        body: 'New sign-in from unusual IP',
        metadata: {},
        createdAt: new Date()
      };

      // Completely disabled preferences
      const disabledPrefs: UserNotificationPreferences = {
        userId: 'user-sec-test',
        globalPushEnabled: false,
        globalEmailEnabled: false,
        categories: {
          [NotificationCategory.ACCOUNT_SECURITY]: {
            enabled: false,
            channels: {
              [NotificationChannel.IN_APP]: false,
              [NotificationChannel.PUSH]: false,
              [NotificationChannel.EMAIL]: false
            }
          },
          [NotificationCategory.DEVICE_SERVER]: { enabled: false, channels: {} as any },
          [NotificationCategory.FILE_OPERATIONS]: { enabled: false, channels: {} as any },
          [NotificationCategory.STORAGE]: { enabled: false, channels: {} as any },
          [NotificationCategory.BILLING]: { enabled: false, channels: {} as any },
          [NotificationCategory.SYSTEM]: { enabled: false, channels: {} as any }
        },
        quietHours: { enabled: false, startUtc: '00:00', endUtc: '00:00', timezone: 'UTC' },
        updatedAt: new Date()
      };

      const routing = router.evaluateRouting(securityEvent, disabledPrefs, []);

      expect(routing.securityBypassTriggered).toBe(true);
      expect(routing.allowedChannels).toContain(NotificationChannel.IN_APP);
      expect(routing.allowedChannels).toContain(NotificationChannel.PUSH);
      expect(routing.allowedChannels).toContain(NotificationChannel.EMAIL);
    });
  });

  describe('5. Standalone Transactional Email Template Helpers', () => {
    it('generates well-formed payment succeeded template', () => {
      const res = getPaymentSucceededEmailTemplate({
        customerName: 'Samira Khan',
        formattedAmount: '29.00',
        currency: 'USD',
        planName: 'Pro Monthly',
        portalUrl: 'https://zdexcloud.com/pages/billing.html'
      });

      expect(res.subject).toContain('Payment Succeeded');
      expect(res.subject).toContain('Pro Monthly');
      expect(res.html).toContain('Samira Khan');
      expect(res.html).toContain('USD 29.00');
      expect(res.html).toContain('https://zdexcloud.com/pages/billing.html');
      expect(res.text).toContain('Samira Khan');
      expect(res.text).toContain('USD 29.00');
    });

    it('generates well-formed payment failed template', () => {
      const res = getPaymentFailedEmailTemplate({
        customerName: 'Marcus Cole',
        formattedAmount: '99.00',
        currency: 'EUR',
        planName: 'Business Tier',
        portalUrl: 'https://zdexcloud.com/pages/billing.html'
      });

      expect(res.subject).toContain('Payment Failed');
      expect(res.html).toContain('Marcus Cole');
      expect(res.html).toContain('EUR 99.00');
      expect(res.text).toContain('EUR 99.00');
    });

    it('generates well-formed subscription activated template', () => {
      const res = getSubscriptionActivatedEmailTemplate({
        customerName: 'Elena Rostova',
        planName: 'Ultimate',
        portalUrl: 'https://zdexcloud.com/pages/subscription.html'
      });

      expect(res.subject).toContain('Subscription Activated');
      expect(res.html).toContain('Ultimate');
      expect(res.text).toContain('https://zdexcloud.com/pages/subscription.html');
    });

    it('generates well-formed subscription renewed template', () => {
      const res = getSubscriptionRenewedEmailTemplate({
        customerName: 'Devon Miles',
        planName: 'Standard',
        formattedAmount: '19.99',
        currency: 'USD'
      });

      expect(res.subject).toContain('Subscription Renewal Confirmation');
      expect(res.html).toContain('Devon Miles');
      expect(res.html).toContain('USD 19.99');
      expect(res.text).toContain('Standard');
    });

    it('generates well-formed dunning reminder template with milestone and payment link', () => {
      const res = getSubscriptionDunningEmailTemplate({
        customerName: 'Taylor Swift',
        planName: 'Creator Tier',
        formattedAmount: '45.00',
        currency: 'USD',
        milestone: 'Final Warning (Day 7)',
        paymentLink: 'https://checkout.zdexcloud.com/pay/dun_123',
        portalUrl: 'https://zdexcloud.com/pages/billing.html'
      });

      expect(res.subject).toContain('Action Required');
      expect(res.subject).toContain('Final Warning (Day 7)');
      expect(res.html).toContain('Final Warning (Day 7)');
      expect(res.html).toContain('https://checkout.zdexcloud.com/pay/dun_123');
      expect(res.text).toContain('Final Warning (Day 7)');
      expect(res.text).toContain('https://checkout.zdexcloud.com/pay/dun_123');
    });

    it('generates well-formed subscription expired template', () => {
      const res = getSubscriptionExpiredEmailTemplate({
        customerName: 'Chris Pine',
        planName: 'Pro Tier'
      });

      expect(res.subject).toContain('Subscription Expired');
      expect(res.html).toContain('Chris Pine');
      expect(res.html).toContain('Pro Tier');
      expect(res.text).toContain('Subscription Expired');
    });

    it('generates well-formed refund processed template', () => {
      const res = getRefundProcessedEmailTemplate({
        customerName: 'Zoe Saldana',
        formattedAmount: '50.00',
        currency: 'USD',
        portalUrl: 'https://zdexcloud.com/pages/billing.html'
      });

      expect(res.subject).toContain('Refund Processed');
      expect(res.html).toContain('Zoe Saldana');
      expect(res.html).toContain('USD 50.00');
      expect(res.text).toContain('USD 50.00');
    });
  });
});
