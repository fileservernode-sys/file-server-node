import { notificationService } from '../services/notification_service.js';
import { NotificationType } from '../types/type_registry.js';
import { NotificationCategory } from '../types/category.js';
import { NotificationSeverity } from '../types/severity.js';

export class DeviceEventProducer {
  public async emitDeviceLinked(userId: string, deviceId: string, deviceName: string): Promise<void> {
    try {
      await notificationService.dispatchEvent({
        eventType: NotificationType.DEVICE_LINKED,
        userId,
        deviceId,
        category: NotificationCategory.DEVICE_SERVER,
        severity: NotificationSeverity.SUCCESS,
        metadata: {
          deviceName
        },
        source: 'device-producer'
      });
    } catch (err) {
      console.warn(`[DeviceEventProducer] Non-blocking dispatch warning:`, err);
    }
  }

  public async emitDeviceOnline(userId: string, deviceId: string, deviceName: string): Promise<void> {
    try {
      await notificationService.dispatchEvent({
        eventType: NotificationType.DEVICE_ONLINE,
        userId,
        deviceId,
        category: NotificationCategory.DEVICE_SERVER,
        severity: NotificationSeverity.INFO,
        metadata: {
          deviceName
        },
        source: 'device-producer'
      });
    } catch (err) {
      console.warn(`[DeviceEventProducer] Non-blocking dispatch warning:`, err);
    }
  }

  public async emitDeviceOffline(userId: string, deviceId: string, deviceName: string): Promise<void> {
    try {
      await notificationService.dispatchEvent({
        eventType: NotificationType.DEVICE_OFFLINE,
        userId,
        deviceId,
        category: NotificationCategory.DEVICE_SERVER,
        severity: NotificationSeverity.WARNING,
        metadata: {
          deviceName
        },
        source: 'device-producer'
      });
    } catch (err) {
      console.warn(`[DeviceEventProducer] Non-blocking dispatch warning:`, err);
    }
  }
}

export const deviceEventProducer = new DeviceEventProducer();
