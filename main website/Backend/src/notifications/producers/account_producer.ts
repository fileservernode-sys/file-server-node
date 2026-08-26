import { notificationService } from '../services/notification_service.js';
import { NotificationType } from '../types/type_registry.js';
import { NotificationCategory } from '../types/category.js';
import { NotificationSeverity } from '../types/severity.js';

export class AccountEventProducer {
  public async emitAccountCreated(userId: string, userEmail: string, userName?: string): Promise<void> {
    try {
      await notificationService.dispatchEvent({
        eventType: NotificationType.ACCOUNT_CREATED,
        userId,
        category: NotificationCategory.ACCOUNT_SECURITY,
        severity: NotificationSeverity.INFO,
        metadata: {
          userEmail,
          userName: userName || userEmail.split('@')[0]
        },
        source: 'account-producer'
      });
    } catch (err) {
      console.warn(`[AccountEventProducer] Non-blocking dispatch warning:`, err);
    }
  }

  public async emitSignIn(userId: string, userEmail: string, ipAddress?: string, userAgent?: string): Promise<void> {
    try {
      await notificationService.dispatchEvent({
        eventType: NotificationType.SIGN_IN,
        userId,
        category: NotificationCategory.ACCOUNT_SECURITY,
        severity: NotificationSeverity.SECURITY,
        metadata: {
          userEmail,
          ipAddress: ipAddress || '127.0.0.1',
          userAgent: userAgent || 'RemoteNode Client'
        },
        source: 'account-producer'
      });
    } catch (err) {
      console.warn(`[AccountEventProducer] Non-blocking dispatch warning:`, err);
    }
  }

  public async emitSecurityEvent(userId: string, customSummary: string): Promise<void> {
    try {
      await notificationService.dispatchEvent({
        eventType: NotificationType.SECURITY_EVENT,
        userId,
        category: NotificationCategory.ACCOUNT_SECURITY,
        severity: NotificationSeverity.SECURITY,
        metadata: {
          customSummary
        },
        source: 'account-producer'
      });
    } catch (err) {
      console.warn(`[AccountEventProducer] Non-blocking dispatch warning:`, err);
    }
  }
}

export const accountEventProducer = new AccountEventProducer();
