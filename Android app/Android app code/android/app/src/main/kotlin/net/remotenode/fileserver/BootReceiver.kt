package net.remotenode.fileserver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.content.ContextCompat

/**
 * Boot Receiver to restore RemoteNode local file server service on device reboot
 * only if the user previously had the server enabled (persisted desired state).
 *
 * Android 15 (API 35+) Platform Compliance (Phase 21.5.1.1):
 * Android 15 strictly prohibits launching dataSync foreground services from
 * BOOT_COMPLETED broadcast receivers. On API 35+, boot restoration is suppressed
 * and flagged in SharedPreferences until the user explicitly opens the application.
 * On API < 35, Storage-only foreground service restoration is legally performed.
 * Camera is NEVER restored at boot under any circumstances.
 */
class BootReceiver : BroadcastReceiver() {
    companion object {
        const val PREFS_NAME = "net.remotenode.server_prefs"
        const val KEY_BOOT_RESTORE_SUPPRESSED = "boot_restoration_suppressed"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        if (action == Intent.ACTION_BOOT_COMPLETED || 
            action == "android.intent.action.QUICKBOOT_POWERON" || 
            action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            
            val isDesiredEnabled = RemoteNodeServerService.getDesiredServerEnabled(context)
            if (!isDesiredEnabled) return

            // CAMERA ENGINE IS NEVER RESTORED AT BOOT UNDER ANY CIRCUMSTANCES

            // Android 15+ (API 35+) Platform Policy Enforcement:
            // BroadcastReceivers responding to BOOT_COMPLETED cannot start dataSync foreground services.
            if (Build.VERSION.SDK_INT >= 35) {
                android.util.Log.i(
                    "BootReceiver",
                    "Storage boot restoration suppressed on Android 15+ (API 35+) per platform FGS policy. Awaiting user app launch."
                )
                val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                prefs.edit().putBoolean(KEY_BOOT_RESTORE_SUPPRESSED, true).apply()
                return
            }

            // Android 14 and earlier (API < 35): Legally permitted to restore Storage foreground service
            val serviceIntent = Intent(context, PlatformSupervisorService::class.java).apply {
                this.action = PlatformSupervisorService.ACTION_START_STORAGE
                putExtra(PlatformSupervisorService.EXTRA_PORT, RemoteNodeServerService.getPersistedPort(context))
            }
            try {
                ContextCompat.startForegroundService(context, serviceIntent)
            } catch (e: Exception) {
                android.util.Log.e("BootReceiver", "Failed to restore storage service at boot: ${e.message}")
            }
        }
    }
}
