import { notificationService } from '../services/notification_service.js';
import { NotificationType } from '../types/type_registry.js';
import { NotificationCategory } from '../types/category.js';
import { NotificationSeverity } from '../types/severity.js';

export class GatewayEventProducer {
  public async emitGatewayConnected(userId: string, deviceId: string, deviceName: string): Promise<void> {
    try {
      await notificationService.dispatchEvent({
        eventType: NotificationType.GATEWAY_CONNECTED,
        userId,
        deviceId,
        category: NotificationCategory.SYSTEM,
        severity: NotificationSeverity.INFO,
        metadata: {
          deviceName
        },
        source: 'gateway-producer'
      });
    } catch (err) {
      console.warn(`[GatewayEventProducer] Non-blocking dispatch warning:`, err);
    }
  }

  public async emitGatewayDisconnected(userId: string, deviceId: string, deviceName: string): Promise<void> {
    try {
      await notificationService.dispatchEvent({
        eventType: NotificationType.GATEWAY_DISCONNECTED,
        userId,
        deviceId,
        category: NotificationCategory.SYSTEM,
        severity: NotificationSeverity.WARNING,
        metadata: {
          deviceName
        },
        source: 'gateway-producer'
      });
    } catch (err) {
      console.warn(`[GatewayEventProducer] Non-blocking dispatch warning:`, err);
    }
  }
}

export const gatewayEventProducer = new GatewayEventProducer();
