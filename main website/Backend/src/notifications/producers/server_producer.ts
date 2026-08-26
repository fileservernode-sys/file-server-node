import { notificationService } from '../services/notification_service.js';
import { NotificationType } from '../types/type_registry.js';
import { NotificationCategory } from '../types/category.js';
import { NotificationSeverity } from '../types/severity.js';

export class ServerEventProducer {
  public async emitServerCreated(
    userId: string,
    deviceId: string,
    serverId: string,
    serverName: string,
    deviceName: string
  ): Promise<void> {
    try {
      await notificationService.dispatchEvent({
        eventType: NotificationType.SERVER_CREATED,
        userId,
        deviceId,
        serverId,
        category: NotificationCategory.DEVICE_SERVER,
        severity: NotificationSeverity.SUCCESS,
        metadata: {
          serverName,
          deviceName
        },
        source: 'server-producer'
      });
    } catch (err) {
      console.warn(`[ServerEventProducer] Non-blocking dispatch warning:`, err);
    }
  }

  public async emitServerStarted(
    userId: string,
    deviceId: string,
    serverId: string,
    serverName: string,
    deviceName: string
  ): Promise<void> {
    try {
      await notificationService.dispatchEvent({
        eventType: NotificationType.SERVER_STARTED,
        userId,
        deviceId,
        serverId,
        category: NotificationCategory.DEVICE_SERVER,
        severity: NotificationSeverity.INFO,
        metadata: {
          serverName,
          deviceName
        },
        source: 'server-producer'
      });
    } catch (err) {
      console.warn(`[ServerEventProducer] Non-blocking dispatch warning:`, err);
    }
  }

  public async emitServerStopped(
    userId: string,
    deviceId: string,
    serverId: string,
    serverName: string,
    deviceName: string
  ): Promise<void> {
    try {
      await notificationService.dispatchEvent({
        eventType: NotificationType.SERVER_STOPPED,
        userId,
        deviceId,
        serverId,
        category: NotificationCategory.DEVICE_SERVER,
        severity: NotificationSeverity.WARNING,
        metadata: {
          serverName,
          deviceName
        },
        source: 'server-producer'
      });
    } catch (err) {
      console.warn(`[ServerEventProducer] Non-blocking dispatch warning:`, err);
    }
  }

  public async emitServerUnavailable(
    userId: string,
    deviceId: string,
    serverId: string,
    serverName: string,
    deviceName: string
  ): Promise<void> {
    try {
      await notificationService.dispatchEvent({
        eventType: NotificationType.SERVER_UNAVAILABLE,
        userId,
        deviceId,
        serverId,
        category: NotificationCategory.DEVICE_SERVER,
        severity: NotificationSeverity.CRITICAL,
        metadata: {
          serverName,
          deviceName
        },
        source: 'server-producer'
      });
    } catch (err) {
      console.warn(`[ServerEventProducer] Non-blocking dispatch warning:`, err);
    }
  }

  public async emitServerRecovered(
    userId: string,
    deviceId: string,
    serverId: string,
    serverName: string,
    deviceName: string
  ): Promise<void> {
    try {
      await notificationService.dispatchEvent({
        eventType: NotificationType.SERVER_RECOVERED,
        userId,
        deviceId,
        serverId,
        category: NotificationCategory.DEVICE_SERVER,
        severity: NotificationSeverity.SUCCESS,
        metadata: {
          serverName,
          deviceName
        },
        source: 'server-producer'
      });
    } catch (err) {
      console.warn(`[ServerEventProducer] Non-blocking dispatch warning:`, err);
    }
  }
}

export const serverEventProducer = new ServerEventProducer();
