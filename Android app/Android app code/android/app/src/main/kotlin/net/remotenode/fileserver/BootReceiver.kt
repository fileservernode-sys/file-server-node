package net.remotenode.fileserver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

/**
 * Boot Receiver to restore RemoteNode local file server service on device reboot
 * only if the user previously had the server enabled (persisted desired state).
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == "android.intent.action.QUICKBOOT_POWERON") {
            val isDesiredEnabled = RemoteNodeServerService.getDesiredServerEnabled(context)
            if (isDesiredEnabled) {
                val serviceIntent = Intent(context, RemoteNodeServerService::class.java).apply {
                    action = RemoteNodeServerService.ACTION_START_SERVER
                    putExtra(RemoteNodeServerService.EXTRA_PORT, RemoteNodeServerService.getPersistedPort(context))
                }
                try {
                    ContextCompat.startForegroundService(context, serviceIntent)
                } catch (_: Exception) {}
            }
        }
    }
}
