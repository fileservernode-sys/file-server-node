/**
 * ZdexCloud Centralized Notification Template Registry
 * Track 4 - Batch NT-1.1 Architecture
 */

import { NotificationType } from '../types/type_registry.js';
import { NotificationChannel } from '../types/channel.js';
import { NotificationSeverity } from '../types/severity.js';
import {
  NotificationTemplate,
  TemplateContext,
  RenderedTemplate,
  buildTemplateContext
} from '../types/template.js';
import { createDeepLink } from '../types/deep_link.js';
import { SafeNotificationMetadata } from '../types/event.js';

class TemplateRegistry {
  private templates: Map<NotificationType, NotificationTemplate> = new Map();

  constructor() {
    this.registerDefaultTemplates();
  }

  public registerTemplate(template: NotificationTemplate): void {
    this.templates.set(template.type, template);
  }

  public getTemplate(type: NotificationType): NotificationTemplate {
    const tmpl = this.templates.get(type);
    if (!tmpl) {
      return this.getFallbackTemplate(type);
    }
    return tmpl;
  }

  public render(
    type: NotificationType,
    metadata: SafeNotificationMetadata = {},
    occurredAt: Date = new Date()
  ): RenderedTemplate {
    const template = this.getTemplate(type);
    const sanitizedMeta = this.sanitizeMetadata(metadata);
    const ctx = buildTemplateContext(sanitizedMeta, occurredAt);

    return {
      title: template.titleTemplate(ctx),
      body: template.bodyTemplate(ctx),
      emailSubject: template.emailSubjectTemplate(ctx),
      emailHtml: template.emailHtmlTemplate(ctx),
      emailText: template.emailTextTemplate(ctx),
      deepLink: template.defaultDeepLink ? template.defaultDeepLink(ctx) : undefined,
      defaultChannels: [...template.defaultChannels],
      priority: template.defaultSeverity
    };
  }

  private escapeHtml(str: any): string {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private sanitizeMetadata(meta: SafeNotificationMetadata = {}): SafeNotificationMetadata {
    const clean: SafeNotificationMetadata = { ...meta };
    const forbidden = [
      'password', 'token', 'jwt', 'fcmtoken', 'privatekey', 'secret', 'authorization', 'otp',
      'cvv', 'cardnumber', 'card_number', 'pan', 'paymentcredential', 'signature',
      'razorpay_signature', 'rawpayload', 'taxid', 'customertaxid', 'gstin', 'vatnumber',
      'accountnumber', 'account_number', 'privatedocumenturl', 'downloadurl', 'pdfurl'
    ];
    for (const key of Object.keys(clean)) {
      if (forbidden.some((f) => key.toLowerCase().includes(f))) {
        delete (clean as any)[key];
      } else if (typeof clean[key] === 'string') {
        // Apply HTML entity escaping to string values
        clean[key] = this.escapeHtml(clean[key]) as any;
      }
    }
    return clean;
  }

  private getFallbackTemplate(type: NotificationType): NotificationTemplate {
    return {
      type,
      titleTemplate: () => `ZdexCloud System Alert`,
      bodyTemplate: (ctx) => ctx.customSummary || `Notification event ${type} recorded.`,
      emailSubjectTemplate: () => `ZdexCloud System Notification`,
      emailHtmlTemplate: (ctx) => `<p>${ctx.customSummary || `Notification event ${type} recorded.`}</p>`,
      emailTextTemplate: (ctx) => ctx.customSummary || `Notification event ${type} recorded.`,
      defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
      defaultSeverity: NotificationSeverity.INFO,
      defaultDeepLink: () => createDeepLink('system', 'https://zdexcloud.com/pages/dashboard')
    };
  }

  private registerDefaultTemplates(): void {
    // 1. ACCOUNT_CREATED
    this.registerTemplate({
      type: NotificationType.ACCOUNT_CREATED,
      titleTemplate: () => 'Welcome to ZdexCloud',
      bodyTemplate: (ctx) => `Your ZdexCloud account was created successfully for ${ctx.userEmail || ctx.userName}.`,
      emailSubjectTemplate: () => 'Welcome to ZdexCloud Personal File Server',
      emailHtmlTemplate: (ctx) => `<h2>Welcome to ZdexCloud</h2><p>Hello ${ctx.userName},</p><p>Your account has been created. Connect your Android phone to start hosting your personal file server.</p>`,
      emailTextTemplate: (ctx) => `Hello ${ctx.userName},\n\nYour ZdexCloud account has been created.`,
      defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
      defaultSeverity: NotificationSeverity.INFO,
      defaultDeepLink: () => createDeepLink('account', 'https://zdexcloud.com/pages/dashboard', '/pages/dashboard')
    });

    // 2. EMAIL_VERIFICATION
    this.registerTemplate({
      type: NotificationType.EMAIL_VERIFICATION,
      titleTemplate: () => 'Verify Your ZdexCloud Email',
      bodyTemplate: () => 'A verification request was sent to your email address.',
      emailSubjectTemplate: () => 'Verify Your ZdexCloud Email Address',
      emailHtmlTemplate: (ctx) => `<h2>Email Verification</h2><p>Hello ${ctx.userName},</p><p>Please use your 6-digit OTP code to verify your account.</p>`,
      emailTextTemplate: (ctx) => `Hello ${ctx.userName},\n\nPlease verify your ZdexCloud account using your 6-digit code.`,
      defaultChannels: [NotificationChannel.EMAIL],
      defaultSeverity: NotificationSeverity.SECURITY,
      defaultDeepLink: () => createDeepLink('account', 'https://zdexcloud.com/pages/login', '/pages/login')
    });

    // 3. SIGN_IN
    this.registerTemplate({
      type: NotificationType.SIGN_IN,
      titleTemplate: () => 'New Sign-In Detected',
      bodyTemplate: (ctx) => `New sign-in to your ZdexCloud account from IP ${ctx.ipAddress || 'unknown'}.`,
      emailSubjectTemplate: () => '[ZdexCloud] Security Alert: New Sign-In',
      emailHtmlTemplate: (ctx) => `<h2>Security Alert: New Sign-In</h2><p>Hello ${ctx.userName || ctx.userEmail || 'Customer'},</p><p>A new sign-in to your ZdexCloud account occurred at ${ctx.timestamp} from IP address ${ctx.ipAddress || 'unknown'} (${ctx.userAgent || 'unknown'}).</p><p>If this was not you, please secure your account immediately.</p>`,
      emailTextTemplate: (ctx) => `Security Alert: New sign-in to ZdexCloud at ${ctx.timestamp} from IP ${ctx.ipAddress || 'unknown'}.`,
      defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.PUSH, NotificationChannel.EMAIL],
      defaultSeverity: NotificationSeverity.SECURITY,
      defaultDeepLink: () => createDeepLink('security', 'https://zdexcloud.com/pages/dashboard#security', '/pages/dashboard')
    });

    // 4. SECURITY_EVENT
    this.registerTemplate({
      type: NotificationType.SECURITY_EVENT,
      titleTemplate: () => 'Account Security Alert',
      bodyTemplate: (ctx) => ctx.customSummary || 'Important security event detected on your ZdexCloud account.',
      emailSubjectTemplate: () => '[ZdexCloud] Important Security Alert',
      emailHtmlTemplate: (ctx) => `<h2>Security Alert</h2><p>Hello ${ctx.userName || ctx.userEmail || 'Customer'},</p><p>${ctx.customSummary || 'A security setting or password change occurred on your account.'}</p>`,
      emailTextTemplate: (ctx) => `Security Alert: ${ctx.customSummary || 'A security setting changed on your account.'}`,
      defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.PUSH, NotificationChannel.EMAIL],
      defaultSeverity: NotificationSeverity.SECURITY,
      defaultDeepLink: () => createDeepLink('security', 'https://zdexcloud.com/pages/dashboard#security', '/pages/dashboard')
    });

    // 5. DEVICE_LINKED
    this.registerTemplate({
      type: NotificationType.DEVICE_LINKED,
      titleTemplate: () => 'New Device Linked',
      bodyTemplate: (ctx) => `Device "${ctx.deviceName || 'Android Device'}" was linked to your ZdexCloud account from IP ${ctx.ipAddress || 'unknown'}.`,
      emailSubjectTemplate: () => '[ZdexCloud] Security Alert: New Device Linked',
      emailHtmlTemplate: (ctx) => `<h2>Security Alert: New Device Linked</h2><p>Hello ${ctx.userName || ctx.userEmail || 'Customer'},</p><p>A new Android phone "${ctx.deviceName || 'Android Device'}" was linked to your ZdexCloud account at ${ctx.timestamp} from IP address ${ctx.ipAddress || 'unknown'} (${ctx.userAgent || 'RemoteNode Client'}).</p><p>If you did not authorize this device, please navigate to your dashboard and remove it immediately.</p>`,
      emailTextTemplate: (ctx) => `Security Alert: Device "${ctx.deviceName || 'Android Device'}" was linked to your ZdexCloud account at ${ctx.timestamp} from IP ${ctx.ipAddress || 'unknown'}.`,
      defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.PUSH, NotificationChannel.EMAIL],
      defaultSeverity: NotificationSeverity.SUCCESS,
      defaultDeepLink: () => createDeepLink('device', `https://zdexcloud.com/pages/dashboard`, '/pages/dashboard')
    });

    // 6. DEVICE_ONLINE
    this.registerTemplate({
      type: NotificationType.DEVICE_ONLINE,
      titleTemplate: () => 'Device Connected',
      bodyTemplate: (ctx) => `Android device "${ctx.deviceName}" is now online and hosting storage.`,
      emailSubjectTemplate: (ctx) => `Device Online: ${ctx.deviceName}`,
      emailHtmlTemplate: (ctx) => `<p>Device "${ctx.deviceName}" reconnected to ZdexCloud.</p>`,
      emailTextTemplate: (ctx) => `Device "${ctx.deviceName}" is online.`,
      defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.PUSH],
      defaultSeverity: NotificationSeverity.INFO,
      defaultDeepLink: () => createDeepLink('device', 'https://zdexcloud.com/pages/dashboard', '/pages/dashboard')
    });

    // 7. DEVICE_OFFLINE
    this.registerTemplate({
      type: NotificationType.DEVICE_OFFLINE,
      titleTemplate: () => 'Device Disconnected',
      bodyTemplate: (ctx) => `Android device "${ctx.deviceName}" went offline. Storage remote access paused.`,
      emailSubjectTemplate: (ctx) => `Device Offline: ${ctx.deviceName}`,
      emailHtmlTemplate: (ctx) => `<p>Your device "${ctx.deviceName}" lost connection to ZdexCloud gateway.</p>`,
      emailTextTemplate: (ctx) => `Device "${ctx.deviceName}" went offline.`,
      defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.PUSH, NotificationChannel.EMAIL],
      defaultSeverity: NotificationSeverity.WARNING,
      defaultDeepLink: () => createDeepLink('device', 'https://zdexcloud.com/pages/dashboard', '/pages/dashboard')
    });

    // 8. SERVER_CREATED
    this.registerTemplate({
      type: NotificationType.SERVER_CREATED,
      titleTemplate: () => 'File Server Created',
      bodyTemplate: (ctx) => `Server "${ctx.serverName}" created on device "${ctx.deviceName}".`,
      emailSubjectTemplate: (ctx) => `Server Created: ${ctx.serverName}`,
      emailHtmlTemplate: (ctx) => `<h2>File Server Created</h2><p>Server "${ctx.serverName}" is configured on "${ctx.deviceName}".</p>`,
      emailTextTemplate: (ctx) => `Server "${ctx.serverName}" created on device "${ctx.deviceName}".`,
      defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
      defaultSeverity: NotificationSeverity.SUCCESS,
      defaultDeepLink: () => createDeepLink('server', 'https://zdexcloud.com/pages/dashboard', '/pages/dashboard')
    });

    // 9. SERVER_STARTED
    this.registerTemplate({
      type: NotificationType.SERVER_STARTED,
      titleTemplate: () => 'File Server Running',
      bodyTemplate: (ctx) => `Server "${ctx.serverName}" was started on "${ctx.deviceName}".`,
      emailSubjectTemplate: (ctx) => `Server Started: ${ctx.serverName}`,
      emailHtmlTemplate: (ctx) => `<p>Server "${ctx.serverName}" is running.</p>`,
      emailTextTemplate: (ctx) => `Server "${ctx.serverName}" is running on "${ctx.deviceName}".`,
      defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.PUSH],
      defaultSeverity: NotificationSeverity.INFO,
      defaultDeepLink: () => createDeepLink('server', 'https://zdexcloud.com/pages/dashboard', '/pages/dashboard')
    });

    // 10. SERVER_STOPPED
    this.registerTemplate({
      type: NotificationType.SERVER_STOPPED,
      titleTemplate: () => 'File Server Stopped',
      bodyTemplate: (ctx) => `Server "${ctx.serverName}" was stopped on "${ctx.deviceName}".`,
      emailSubjectTemplate: (ctx) => `Server Stopped: ${ctx.serverName}`,
      emailHtmlTemplate: (ctx) => `<p>Server "${ctx.serverName}" was stopped on "${ctx.deviceName}".</p>`,
      emailTextTemplate: (ctx) => `Server "${ctx.serverName}" was stopped on "${ctx.deviceName}".`,
      defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.PUSH],
      defaultSeverity: NotificationSeverity.WARNING,
      defaultDeepLink: () => createDeepLink('server', 'https://zdexcloud.com/pages/dashboard', '/pages/dashboard')
    });

    // SERVER_DELETED
    this.registerTemplate({
      type: NotificationType.SERVER_DELETED,
      titleTemplate: () => 'Server Deleted',
      bodyTemplate: (ctx) => {
        const fileNote = ctx.deleteFiles
          ? (ctx.filesPurged ? 'Uploaded files were permanently deleted.' : 'Files pending manual cleanup (device was offline).')
          : 'Uploaded files were preserved on your device.';
        return `Server "${ctx.serverName}" was deleted from device "${ctx.deviceName}". ${fileNote}`;
      },
      emailSubjectTemplate: (ctx) => `Server Deleted: ${ctx.serverName}`,
      emailHtmlTemplate: (ctx) => {
        const fileNote = ctx.deleteFiles
          ? (ctx.filesPurged
              ? '<p><strong>File Deletion:</strong> All uploaded files and folders have been purged from your host device.</p>'
              : '<p><strong>File Deletion:</strong> Deletion was requested, but your device was offline during removal. Please verify your storage folder manually.</p>')
          : '<p><strong>File Retention:</strong> All files and folders have been safely preserved on your device.</p>';
        return `<h2>Server Removed</h2><p>Server "${ctx.serverName}" on device "${ctx.deviceName}" has been removed from your account.</p>${fileNote}`;
      },
      emailTextTemplate: (ctx) => {
        const fileNote = ctx.deleteFiles
          ? (ctx.filesPurged ? 'All uploaded files were purged from your device.' : 'Deletion requested, but device was offline.')
          : 'All files were kept intact on your device.';
        return `Server "${ctx.serverName}" on device "${ctx.deviceName}" was deleted. ${fileNote}`;
      },
      defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
      defaultSeverity: NotificationSeverity.WARNING,
      defaultDeepLink: () => createDeepLink('server', 'https://zdexcloud.com/pages/dashboard', '/pages/dashboard')
    });

    // 11. SERVER_UNAVAILABLE
    this.registerTemplate({
      type: NotificationType.SERVER_UNAVAILABLE,
      titleTemplate: () => 'File Server Unavailable',
      bodyTemplate: (ctx) => `Server "${ctx.serverName}" is unreachable on device "${ctx.deviceName}".`,
      emailSubjectTemplate: (ctx) => `Urgent: Server "${ctx.serverName}" Unavailable`,
      emailHtmlTemplate: (ctx) => `<h2>Server Unavailable</h2><p>ZdexCloud lost communication with server "${ctx.serverName}" on "${ctx.deviceName}".</p>`,
      emailTextTemplate: (ctx) => `Urgent: Server "${ctx.serverName}" is unreachable on "${ctx.deviceName}".`,
      defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.PUSH, NotificationChannel.EMAIL],
      defaultSeverity: NotificationSeverity.CRITICAL,
      defaultDeepLink: () => createDeepLink('server', 'https://zdexcloud.com/pages/dashboard', '/pages/dashboard')
    });

    // 12. SERVER_RECOVERED
    this.registerTemplate({
      type: NotificationType.SERVER_RECOVERED,
      titleTemplate: () => 'File Server Recovered',
      bodyTemplate: (ctx) => `Server "${ctx.serverName}" connectivity restored on "${ctx.deviceName}".`,
      emailSubjectTemplate: (ctx) => `Server Recovered: ${ctx.serverName}`,
      emailHtmlTemplate: (ctx) => `<p>Server "${ctx.serverName}" is back online and accessible.</p>`,
      emailTextTemplate: (ctx) => `Server "${ctx.serverName}" connectivity restored.`,
      defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.PUSH],
      defaultSeverity: NotificationSeverity.SUCCESS,
      defaultDeepLink: () => createDeepLink('server', 'https://zdexcloud.com/pages/dashboard', '/pages/dashboard')
    });

    // 13. FILE_UPLOAD_COMPLETED
    this.registerTemplate({
      type: NotificationType.FILE_UPLOAD_COMPLETED,
      titleTemplate: () => 'Upload Completed',
      bodyTemplate: (ctx) => `Uploaded ${ctx.fileCount} file(s) to "${ctx.deviceName}".`,
      emailSubjectTemplate: () => 'File Upload Completed',
      emailHtmlTemplate: (ctx) => `<p>Successfully uploaded ${ctx.fileCount} file(s) to device storage "${ctx.deviceName}".</p>`,
      emailTextTemplate: (ctx) => `Uploaded ${ctx.fileCount} file(s) to "${ctx.deviceName}".`,
      defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.PUSH],
      defaultSeverity: NotificationSeverity.SUCCESS,
      defaultDeepLink: () => createDeepLink('file_manager', 'https://zdexcloud.com/pages/file-manager.html', '/file-manager')
    });

    // 14. FILE_UPLOAD_FAILED
    this.registerTemplate({
      type: NotificationType.FILE_UPLOAD_FAILED,
      titleTemplate: () => 'Upload Failed',
      bodyTemplate: (ctx) => `File upload to "${ctx.deviceName}" failed: ${ctx.reason || 'Network error'}.`,
      emailSubjectTemplate: () => 'File Upload Failed',
      emailHtmlTemplate: (ctx) => `<p>File upload failed: ${ctx.reason || 'Network error'}.</p>`,
      emailTextTemplate: (ctx) => `File upload failed: ${ctx.reason || 'Network error'}.`,
      defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.PUSH],
      defaultSeverity: NotificationSeverity.WARNING,
      defaultDeepLink: () => createDeepLink('file_manager', 'https://zdexcloud.com/pages/file-manager.html', '/file-manager')
    });

    // 15. STORAGE_WARNING
    this.registerTemplate({
      type: NotificationType.STORAGE_WARNING,
      titleTemplate: () => 'Storage Space Low',
      bodyTemplate: (ctx) => `Storage on "${ctx.deviceName}" is at ${ctx.storageUsedPercent}% capacity.`,
      emailSubjectTemplate: (ctx) => `Storage Space Low on ${ctx.deviceName}`,
      emailHtmlTemplate: (ctx) => `<h2>Storage Space Low</h2><p>Device "${ctx.deviceName}" has reached ${ctx.storageUsedPercent}% storage capacity.</p>`,
      emailTextTemplate: (ctx) => `Storage space low on "${ctx.deviceName}" (${ctx.storageUsedPercent}% used).`,
      defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.PUSH, NotificationChannel.EMAIL],
      defaultSeverity: NotificationSeverity.WARNING,
      defaultDeepLink: () => createDeepLink('device', 'https://zdexcloud.com/pages/dashboard', '/pages/dashboard')
    });

    // 16. STORAGE_CRITICAL
    this.registerTemplate({
      type: NotificationType.STORAGE_CRITICAL,
      titleTemplate: () => 'Storage Almost Full',
      bodyTemplate: (ctx) => `Critical: Storage on "${ctx.deviceName}" is at ${ctx.storageUsedPercent}% capacity.`,
      emailSubjectTemplate: (ctx) => `Critical Storage Alert: ${ctx.deviceName}`,
      emailHtmlTemplate: (ctx) => `<h2>Critical Storage Alert</h2><p>Device "${ctx.deviceName}" storage is critically low (${ctx.storageUsedPercent}% capacity used). Free up space to prevent file server disruption.</p>`,
      emailTextTemplate: (ctx) => `Critical Storage Alert on "${ctx.deviceName}" (${ctx.storageUsedPercent}% used).`,
      defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.PUSH, NotificationChannel.EMAIL],
      defaultSeverity: NotificationSeverity.CRITICAL,
      defaultDeepLink: () => createDeepLink('device', 'https://zdexcloud.com/pages/dashboard', '/pages/dashboard')
    });

    // 17. SERVICE_MAINTENANCE
    this.registerTemplate({
      type: NotificationType.SERVICE_MAINTENANCE,
      titleTemplate: () => 'Scheduled Maintenance',
      bodyTemplate: (ctx) => ctx.customSummary || 'ZdexCloud network maintenance is scheduled.',
      emailSubjectTemplate: () => 'Scheduled ZdexCloud Maintenance Notice',
      emailHtmlTemplate: (ctx) => `<h2>Maintenance Notice</h2><p>${ctx.customSummary || 'ZdexCloud will undergo scheduled maintenance.'}</p>`,
      emailTextTemplate: (ctx) => `Notice: ${ctx.customSummary || 'Scheduled maintenance.'}`,
      defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
      defaultSeverity: NotificationSeverity.INFO,
      defaultDeepLink: () => createDeepLink('system', 'https://zdexcloud.com/pages/dashboard')
    });

    // 18. SYSTEM_ANNOUNCEMENT
    this.registerTemplate({
      type: NotificationType.SYSTEM_ANNOUNCEMENT,
      titleTemplate: () => 'ZdexCloud Announcement',
      bodyTemplate: (ctx) => ctx.customSummary || 'System announcement from ZdexCloud.',
      emailSubjectTemplate: () => 'ZdexCloud System Announcement',
      emailHtmlTemplate: (ctx) => `<h2>System Announcement</h2><p>${ctx.customSummary || 'System announcement.'}</p>`,
      emailTextTemplate: (ctx) => `Announcement: ${ctx.customSummary || 'System announcement.'}`,
      defaultChannels: [NotificationChannel.IN_APP],
      defaultSeverity: NotificationSeverity.INFO,
      defaultDeepLink: () => createDeepLink('system', 'https://zdexcloud.com/pages/dashboard')
    });

    // 19. TEST_NOTIFICATION
    this.registerTemplate({
      type: NotificationType.TEST_NOTIFICATION,
      titleTemplate: (ctx) => ctx.customTitle || 'ZdexCloud Test Notification',
      bodyTemplate: (ctx) => ctx.customSummary || 'Test push notification delivered successfully to your Android phone.',
      emailSubjectTemplate: () => 'ZdexCloud Test Notification',
      emailHtmlTemplate: (ctx) => `<h2>Test Notification</h2><p>${ctx.customSummary || 'Test push notification delivered successfully.'}</p>`,
      emailTextTemplate: (ctx) => `Test Notification: ${ctx.customSummary || 'Test push notification delivered successfully.'}`,
      defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.PUSH],
      defaultSeverity: NotificationSeverity.INFO,
      defaultDeepLink: () => createDeepLink('system', 'https://zdexcloud.com/pages/notifications.html', '/pages/notifications')
    });

    // 20. INVOICE_ISSUED (In-App and Mobile Push only; email is dispatched exclusively by dedicated transactional outbox)
    this.registerTemplate({
      type: NotificationType.INVOICE_ISSUED,
      titleTemplate: (ctx) => `Tax Invoice Available${ctx.invoiceNumber ? ` (${ctx.invoiceNumber})` : ''}`,
      bodyTemplate: (ctx) => `Tax invoice ${ctx.invoiceNumber || ''} is now available in your portal.${ctx.formattedAmount ? ` Total: ${ctx.currency || 'USD'} ${ctx.formattedAmount}.` : ''}`,
      emailSubjectTemplate: (ctx) => `[ZdexCloud] Tax Invoice ${ctx.invoiceNumber || ''} Available`,
      emailHtmlTemplate: (ctx) => `<h2 style="font-size: 18px; font-weight: 700; color: #0F172A; margin: 0 0 12px 0;">Tax Invoice Issued</h2><p style="font-size: 14px; line-height: 1.6; color: #334155; margin: 0 0 12px 0;">Hello ${ctx.userName || 'Customer'},</p><p style="font-size: 14px; line-height: 1.6; color: #334155; margin: 0 0 16px 0;">Your statutory tax invoice <strong>${ctx.invoiceNumber || 'N/A'}</strong>${ctx.formattedAmount ? ` for <strong>${ctx.currency || 'USD'} ${ctx.formattedAmount}</strong>` : ''} has been issued. You can review and download the signed PDF from your authenticated portal.</p><p style="font-size: 13px; line-height: 1.5; color: #64748B; margin: 0;">For your security, invoices are stored securely within your dashboard and are not attached as raw files.</p>`,
      emailTextTemplate: (ctx) => `Hello ${ctx.userName || 'Customer'},\n\nYour tax invoice ${ctx.invoiceNumber || 'N/A'} is available in your account.${ctx.formattedAmount ? ` Total: ${ctx.currency || 'USD'} ${ctx.formattedAmount}.\n` : '\n'}Download your PDF invoice securely at: https://zdexcloud.com/pages/invoices.html\n\nSecurity Notice: Invoices are not sent as email attachments.`,
      defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.PUSH],
      defaultSeverity: NotificationSeverity.SUCCESS,
      defaultDeepLink: () => createDeepLink('billing', 'https://zdexcloud.com/pages/invoices.html', '/pages/invoices.html')
    });

    // 21. PAYMENT_SUCCEEDED
    this.registerTemplate({
      type: NotificationType.PAYMENT_SUCCEEDED,
      titleTemplate: () => 'Payment Succeeded',
      bodyTemplate: (ctx) => `Your payment${ctx.formattedAmount ? ` of ${ctx.currency || 'USD'} ${ctx.formattedAmount}` : ''} was processed successfully.`,
      emailSubjectTemplate: (ctx) => `[ZdexCloud] Payment Confirmation${ctx.formattedAmount ? ` - ${ctx.currency || 'USD'} ${ctx.formattedAmount}` : ''}`,
      emailHtmlTemplate: (ctx) => `<h2 style="font-size: 18px; font-weight: 700; color: #0F172A; margin: 0 0 12px 0;">Payment Confirmation</h2><p style="font-size: 14px; line-height: 1.6; color: #334155; margin: 0 0 12px 0;">Hello ${ctx.userName || 'Customer'},</p><p style="font-size: 14px; line-height: 1.6; color: #334155; margin: 0 0 16px 0;">Your payment${ctx.formattedAmount ? ` of <strong>${ctx.currency || 'USD'} ${ctx.formattedAmount}</strong>` : ''} has been processed successfully.</p><p style="font-size: 13px; line-height: 1.5; color: #64748B; margin: 0;">You can view your complete payment history, active entitlements, and tax invoices in your account dashboard.</p>`,
      emailTextTemplate: (ctx) => `Hello ${ctx.userName || 'Customer'},\n\nYour payment${ctx.formattedAmount ? ` of ${ctx.currency || 'USD'} ${ctx.formattedAmount}` : ''} was processed successfully.\n\nView your payment history at: https://zdexcloud.com/pages/billing.html`,
      defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.PUSH, NotificationChannel.EMAIL],
      defaultSeverity: NotificationSeverity.SUCCESS,
      defaultDeepLink: () => createDeepLink('billing', 'https://zdexcloud.com/pages/billing.html', '/pages/billing.html')
    });

    // 22. PAYMENT_FAILED
    this.registerTemplate({
      type: NotificationType.PAYMENT_FAILED,
      titleTemplate: () => 'Payment Failed',
      bodyTemplate: (ctx) => ctx.customSummary || 'Your payment could not be processed. Please update your payment method to maintain uninterrupted service.',
      emailSubjectTemplate: () => '[ZdexCloud] Action Required: Payment Failed',
      emailHtmlTemplate: (ctx) => `<h2 style="font-size: 18px; font-weight: 700; color: #DC2626; margin: 0 0 12px 0;">Payment Authorization Failed</h2><p style="font-size: 14px; line-height: 1.6; color: #334155; margin: 0 0 12px 0;">Hello ${ctx.userName || 'Customer'},</p><p style="font-size: 14px; line-height: 1.6; color: #334155; margin: 0 0 16px 0;">${ctx.customSummary || 'Your recent payment could not be processed by your payment provider.'}</p><p style="font-size: 13px; line-height: 1.5; color: #64748B; margin: 0 0 16px 0;">Please visit your billing dashboard to update your payment instrument and prevent service disruption.</p>`,
      emailTextTemplate: (ctx) => `Hello ${ctx.userName || 'Customer'},\n\nAction Required: Your payment could not be processed.\n\n${ctx.customSummary || 'Please update your payment method to maintain uninterrupted service.'}\n\nUpdate your billing details at: https://zdexcloud.com/pages/billing.html`,
      defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.PUSH, NotificationChannel.EMAIL],
      defaultSeverity: NotificationSeverity.WARNING,
      defaultDeepLink: () => createDeepLink('billing', 'https://zdexcloud.com/pages/billing.html', '/pages/billing.html')
    });

    // 23. SUBSCRIPTION_ACTIVATED
    this.registerTemplate({
      type: NotificationType.SUBSCRIPTION_ACTIVATED,
      titleTemplate: (ctx) => `ZdexCloud ${ctx.planName || 'Pro'} Activated`,
      bodyTemplate: (ctx) => `Your ZdexCloud ${ctx.planName || 'Pro'} subscription is now active with full priority routing and node capacity.`,
      emailSubjectTemplate: (ctx) => `[ZdexCloud] Welcome to ZdexCloud ${ctx.planName || 'Pro'}`,
      emailHtmlTemplate: (ctx) => `<h2 style="font-size: 18px; font-weight: 700; color: #0F172A; margin: 0 0 12px 0;">Subscription Activated</h2><p style="font-size: 14px; line-height: 1.6; color: #334155; margin: 0 0 12px 0;">Hello ${ctx.userName || 'Customer'},</p><p style="font-size: 14px; line-height: 1.6; color: #334155; margin: 0 0 16px 0;">Your ZdexCloud <strong>${ctx.planName || 'Pro'}</strong> subscription is now active with priority routing and multi-server capacity.</p><p style="font-size: 13px; line-height: 1.5; color: #64748B; margin: 0;">You can start configuring extra servers on your phone hardware immediately from the control plane.</p>`,
      emailTextTemplate: (ctx) => `Hello ${ctx.userName || 'Customer'},\n\nYour ZdexCloud ${ctx.planName || 'Pro'} subscription is now active with full priority routing and multi-server capacity.\n\nManage your servers at: https://zdexcloud.com/pages/subscription.html`,
      defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.PUSH, NotificationChannel.EMAIL],
      defaultSeverity: NotificationSeverity.SUCCESS,
      defaultDeepLink: () => createDeepLink('billing', 'https://zdexcloud.com/pages/subscription.html', '/pages/subscription.html')
    });

    // 24. SUBSCRIPTION_RENEWED
    this.registerTemplate({
      type: NotificationType.SUBSCRIPTION_RENEWED,
      titleTemplate: () => 'Subscription Renewed',
      bodyTemplate: (ctx) => `Your recurring subscription for ${ctx.planName || 'ZdexCloud Pro'} has been processed successfully.`,
      emailSubjectTemplate: (ctx) => `[ZdexCloud] Subscription Renewal Confirmation - ${ctx.planName || 'Pro'}`,
      emailHtmlTemplate: (ctx) => `<h2 style="font-size: 18px; font-weight: 700; color: #0F172A; margin: 0 0 12px 0;">Subscription Renewed</h2><p style="font-size: 14px; line-height: 1.6; color: #334155; margin: 0 0 12px 0;">Hello ${ctx.userName || 'Customer'},</p><p style="font-size: 14px; line-height: 1.6; color: #334155; margin: 0 0 16px 0;">Your recurring subscription for <strong>${ctx.planName || 'ZdexCloud Pro'}</strong>${ctx.formattedAmount ? ` (${ctx.currency || 'USD'} ${ctx.formattedAmount})` : ''} has been renewed successfully.</p><p style="font-size: 13px; line-height: 1.5; color: #64748B; margin: 0;">Invoices and billing details can be viewed anytime in your account portal.</p>`,
      emailTextTemplate: (ctx) => `Hello ${ctx.userName || 'Customer'},\n\nYour recurring subscription for ${ctx.planName || 'ZdexCloud Pro'} has been renewed successfully.${ctx.formattedAmount ? ` Amount: ${ctx.currency || 'USD'} ${ctx.formattedAmount}.\n` : '\n'}Manage your subscription at: https://zdexcloud.com/pages/subscription.html`,
      defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.PUSH, NotificationChannel.EMAIL],
      defaultSeverity: NotificationSeverity.INFO,
      defaultDeepLink: () => createDeepLink('billing', 'https://zdexcloud.com/pages/subscription.html', '/pages/subscription.html')
    });

    // 25. SUBSCRIPTION_PAYMENT_FAILED
    this.registerTemplate({
      type: NotificationType.SUBSCRIPTION_PAYMENT_FAILED,
      titleTemplate: () => 'Renewal Payment Failed - Grace Period Active',
      bodyTemplate: (ctx) => ctx.customSummary || 'Your renewal payment failed. Your paid features remain active during the grace period. Please update your payment details.',
      emailSubjectTemplate: (ctx) => `[ZdexCloud] Urgent: Renewal Payment Failed for ${ctx.planName || 'Subscription'}`,
      emailHtmlTemplate: (ctx) => `<h2 style="font-size: 18px; font-weight: 700; color: #DC2626; margin: 0 0 12px 0;">Subscription Renewal Failed</h2><p style="font-size: 14px; line-height: 1.6; color: #334155; margin: 0 0 12px 0;">Hello ${ctx.userName || 'Customer'},</p><p style="font-size: 14px; line-height: 1.6; color: #334155; margin: 0 0 16px 0;">${ctx.customSummary || 'Your recurring renewal payment could not be processed. Paid features remain active during your 5-day grace period.'}</p><p style="font-size: 13px; line-height: 1.5; color: #64748B; margin: 0 0 16px 0;">Please update your payment instrument before the grace period ends to maintain uninterrupted service and prevent account reversion to the Free tier.</p>`,
      emailTextTemplate: (ctx) => `Hello ${ctx.userName || 'Customer'},\n\nUrgent: Your recurring renewal payment could not be processed.\n\n${ctx.customSummary || 'Your paid features remain active during the grace period. Please update your payment method.'}\n\nUpdate your billing details at: https://zdexcloud.com/pages/billing.html`,
      defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.PUSH, NotificationChannel.EMAIL],
      defaultSeverity: NotificationSeverity.WARNING,
      defaultDeepLink: () => createDeepLink('billing', 'https://zdexcloud.com/pages/billing.html', '/pages/billing.html')
    });

    // 26. SUBSCRIPTION_CANCELLED
    this.registerTemplate({
      type: NotificationType.SUBSCRIPTION_CANCELLED,
      titleTemplate: () => 'Subscription Cancellation Scheduled',
      bodyTemplate: (ctx) => ctx.customSummary || 'Your subscription has been scheduled for cancellation at the end of your current period.',
      emailSubjectTemplate: (ctx) => `[ZdexCloud] Subscription Cancellation Scheduled - ${ctx.planName || 'Pro'}`,
      emailHtmlTemplate: (ctx) => `<h2 style="font-size: 18px; font-weight: 700; color: #D97706; margin: 0 0 12px 0;">Subscription Cancellation Scheduled</h2><p style="font-size: 14px; line-height: 1.6; color: #334155; margin: 0 0 12px 0;">Hello ${ctx.userName || 'Customer'},</p><p style="font-size: 14px; line-height: 1.6; color: #334155; margin: 0 0 16px 0;">${ctx.customSummary || 'Your subscription cancellation has been scheduled. You will retain access to your paid tier features until the end of your current billing period.'}</p><p style="font-size: 13px; line-height: 1.5; color: #64748B; margin: 0;">You can reactivate your subscription anytime at your subscription dashboard.</p>`,
      emailTextTemplate: (ctx) => `Hello ${ctx.userName || 'Customer'},\n\nYour subscription cancellation has been scheduled.\n\n${ctx.customSummary || 'You will retain access until the end of your current billing period.'}\n\nManage your subscription at: https://zdexcloud.com/pages/subscription.html`,
      defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
      defaultSeverity: NotificationSeverity.WARNING,
      defaultDeepLink: () => createDeepLink('billing', 'https://zdexcloud.com/pages/subscription.html', '/pages/subscription.html')
    });

    // 27. SUBSCRIPTION_EXPIRED
    this.registerTemplate({
      type: NotificationType.SUBSCRIPTION_EXPIRED,
      titleTemplate: () => 'Subscription Ended - Reverted to Free Plan',
      bodyTemplate: (ctx) => ctx.customSummary || 'Your paid subscription period has ended and your account has reverted to the Free tier. Your existing servers and files remain safe.',
      emailSubjectTemplate: () => '[ZdexCloud] Subscription Expired - Account Reverted to Free Plan',
      emailHtmlTemplate: (ctx) => `<h2 style="font-size: 18px; font-weight: 700; color: #DC2626; margin: 0 0 12px 0;">Subscription Expired</h2><p style="font-size: 14px; line-height: 1.6; color: #334155; margin: 0 0 12px 0;">Hello ${ctx.userName || 'Customer'},</p><p style="font-size: 14px; line-height: 1.6; color: #334155; margin: 0 0 16px 0;">${ctx.customSummary || 'Your paid subscription period has ended and your account has reverted to the Free tier (1 server limit).'}</p><p style="font-size: 13px; line-height: 1.5; color: #059669; margin: 0 0 16px 0;"><strong>Hardware Storage Guarantee:</strong> All personal files and servers remain safe and stored directly on your phone hardware.</p><p style="font-size: 13px; line-height: 1.5; color: #64748B; margin: 0;">You can upgrade your subscription at any time to reactivate additional server slots.</p>`,
      emailTextTemplate: (ctx) => `Hello ${ctx.userName || 'Customer'},\n\nYour paid subscription period has ended and your account has reverted to the Free tier.\n\nAll personal files and servers remain safe on your phone hardware.\n\nUpgrade your subscription at: https://zdexcloud.com/pages/subscription.html`,
      defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.PUSH, NotificationChannel.EMAIL],
      defaultSeverity: NotificationSeverity.CRITICAL,
      defaultDeepLink: () => createDeepLink('billing', 'https://zdexcloud.com/pages/subscription.html', '/pages/subscription.html')
    });

    // 28. BILLING_REFUND_PROCESSED
    this.registerTemplate({
      type: NotificationType.BILLING_REFUND_PROCESSED,
      titleTemplate: () => 'Refund Processed',
      bodyTemplate: (ctx) => ctx.customSummary || `Your refund${ctx.formattedAmount ? ` of ${ctx.currency || 'USD'} ${ctx.formattedAmount}` : ''} has been processed successfully.`,
      emailSubjectTemplate: (ctx) => `[ZdexCloud] Refund Processed${ctx.formattedAmount ? ` - ${ctx.currency || 'USD'} ${ctx.formattedAmount}` : ''}`,
      emailHtmlTemplate: (ctx) => `<h2 style="font-size: 18px; font-weight: 700; color: #0F172A; margin: 0 0 12px 0;">Refund Processed</h2><p style="font-size: 14px; line-height: 1.6; color: #334155; margin: 0 0 12px 0;">Hello ${ctx.userName || 'Customer'},</p><p style="font-size: 14px; line-height: 1.6; color: #334155; margin: 0 0 16px 0;">${ctx.customSummary || `Your refund${ctx.formattedAmount ? ` of <strong>${ctx.currency || 'USD'} ${ctx.formattedAmount}</strong>` : ''} has been processed successfully.`}</p><p style="font-size: 13px; line-height: 1.5; color: #64748B; margin: 0;">The refunded amount should reflect in your original payment method in accordance with your bank's processing timelines.</p>`,
      emailTextTemplate: (ctx) => `Hello ${ctx.userName || 'Customer'},\n\nYour refund${ctx.formattedAmount ? ` of ${ctx.currency || 'USD'} ${ctx.formattedAmount}` : ''} has been processed successfully.\n\nView details at: https://zdexcloud.com/pages/billing.html`,
      defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
      defaultSeverity: NotificationSeverity.INFO,
      defaultDeepLink: () => createDeepLink('billing', 'https://zdexcloud.com/pages/billing.html', '/pages/billing.html')
    });

    // 29. BILLING_REFUND_FAILED
    this.registerTemplate({
      type: NotificationType.BILLING_REFUND_FAILED,
      titleTemplate: () => 'Refund Request Failed',
      bodyTemplate: (ctx) => ctx.customSummary || 'Your refund request could not be processed by the payment provider.',
      emailSubjectTemplate: () => '[ZdexCloud] Refund Processing Notice',
      emailHtmlTemplate: (ctx) => `<h2 style="font-size: 18px; font-weight: 700; color: #D97706; margin: 0 0 12px 0;">Refund Request Update</h2><p style="font-size: 14px; line-height: 1.6; color: #334155; margin: 0 0 12px 0;">Hello ${ctx.userName || 'Customer'},</p><p style="font-size: 14px; line-height: 1.6; color: #334155; margin: 0 0 16px 0;">${ctx.customSummary || 'Your refund request could not be completed by the payment processor.'}</p><p style="font-size: 13px; line-height: 1.5; color: #64748B; margin: 0;">Please contact support@zdexcloud.com for assistance with this transaction.</p>`,
      emailTextTemplate: (ctx) => `Hello ${ctx.userName || 'Customer'},\n\nYour refund request could not be completed by the payment processor.\n\nPlease contact support@zdexcloud.com for assistance.`,
      defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
      defaultSeverity: NotificationSeverity.WARNING,
      defaultDeepLink: () => createDeepLink('billing', 'https://zdexcloud.com/pages/billing.html', '/pages/billing.html')
    });
  }
}

export const templateRegistry = new TemplateRegistry();
