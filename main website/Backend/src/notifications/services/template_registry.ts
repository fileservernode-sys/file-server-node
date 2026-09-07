/**
 * ZdexCloud Centralized Notification Template Registry
 * Track 4 — Batch NT-1.1 Architecture
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
    const forbidden = ['password', 'token', 'jwt', 'fcmtoken', 'privatekey', 'secret', 'authorization', 'otp'];
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
      bodyTemplate: (ctx) => `New sign-in to your ZdexCloud account from IP ${ctx.ipAddress}.`,
      emailSubjectTemplate: () => 'Security Alert: New Sign-In to ZdexCloud',
      emailHtmlTemplate: (ctx) => `<h2>Security Alert: New Sign-In</h2><p>Hello ${ctx.userName},</p><p>A new sign-in to your ZdexCloud account occurred at ${ctx.timestamp} from IP address ${ctx.ipAddress} (${ctx.userAgent}).</p><p>If this was not you, please secure your account immediately.</p>`,
      emailTextTemplate: (ctx) => `Security Alert: New sign-in to ZdexCloud at ${ctx.timestamp} from IP ${ctx.ipAddress}.`,
      defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.PUSH, NotificationChannel.EMAIL],
      defaultSeverity: NotificationSeverity.SECURITY,
      defaultDeepLink: () => createDeepLink('security', 'https://zdexcloud.com/pages/dashboard#security', '/pages/dashboard')
    });

    // 4. SECURITY_EVENT
    this.registerTemplate({
      type: NotificationType.SECURITY_EVENT,
      titleTemplate: () => 'Account Security Alert',
      bodyTemplate: (ctx) => ctx.customSummary || 'Important security event detected on your ZdexCloud account.',
      emailSubjectTemplate: () => 'Important Security Alert — ZdexCloud',
      emailHtmlTemplate: (ctx) => `<h2>Security Alert</h2><p>Hello ${ctx.userName},</p><p>${ctx.customSummary || 'A security setting or password change occurred on your account.'}</p>`,
      emailTextTemplate: (ctx) => `Security Alert: ${ctx.customSummary || 'A security setting changed on your account.'}`,
      defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.PUSH, NotificationChannel.EMAIL],
      defaultSeverity: NotificationSeverity.SECURITY,
      defaultDeepLink: () => createDeepLink('security', 'https://zdexcloud.com/pages/dashboard#security', '/pages/dashboard')
    });

    // 5. DEVICE_LINKED
    this.registerTemplate({
      type: NotificationType.DEVICE_LINKED,
      titleTemplate: () => 'New Device Linked',
      bodyTemplate: (ctx) => `Device "${ctx.deviceName}" was linked to your ZdexCloud account.`,
      emailSubjectTemplate: (ctx) => `Device Linked: ${ctx.deviceName}`,
      emailHtmlTemplate: (ctx) => `<h2>Device Linked</h2><p>Android phone "${ctx.deviceName}" has been registered as a storage node.</p>`,
      emailTextTemplate: (ctx) => `Device "${ctx.deviceName}" was linked to your ZdexCloud account.`,
      defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.PUSH, NotificationChannel.EMAIL],
      defaultSeverity: NotificationSeverity.SUCCESS,
      defaultDeepLink: (ctx) => createDeepLink('device', `https://zdexcloud.com/pages/dashboard`, '/pages/dashboard')
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
  }
}

export const templateRegistry = new TemplateRegistry();
