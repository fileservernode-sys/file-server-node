import { notificationService } from '../services/notification_service.js';
import { NotificationType } from '../types/type_registry.js';
import { NotificationCategory } from '../types/category.js';
import { NotificationSeverity } from '../types/severity.js';
import { normalizeIp } from '../../utils/ip.js';

export class DeviceEventProducer {
  public async emitDeviceLinked(
    userId: string,
    deviceId: string,
    deviceName: string,
    ipAddress?: string,
    userAgent?: string,
    userEmail?: string,
    userName?: string
  ): Promise<void> {
    try {
      const cleanIp = ipAddress ? normalizeIp(ipAddress) : undefined;
      await notificationService.dispatchEvent({
        eventType: NotificationType.DEVICE_LINKED,
        userId,
        deviceId,
        category: NotificationCategory.DEVICE_SERVER,
        severity: NotificationSeverity.SUCCESS,
        metadata: {
          deviceName,
          ipAddress: cleanIp,
          userAgent: userAgent || 'RemoteNode Client',
          userEmail,
          userName: userName || (userEmail ? userEmail.split('@')[0] : undefined)
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
