package net.remotenode.fileserver

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * RemoteNode Native Android Persistent Foreground Service
 * Phase APP-R1.11 Hardened: Authoritative server lifecycle owner.
 */
class RemoteNodeServerService : Service() {

    companion object {
        const val CHANNEL_ID = "remotenode_server_channel"
        const val NOTIFICATION_ID = 9001

        const val ACTION_START_SERVER = "net.remotenode.fileserver.ACTION_START_SERVER"
        const val ACTION_STOP_SERVER = "net.remotenode.fileserver.ACTION_STOP_SERVER"
        const val ACTION_RESTART_SERVER = "net.remotenode.fileserver.ACTION_RESTART_SERVER"
        const val ACTION_SET_CREDENTIALS = "net.remotenode.fileserver.ACTION_SET_CREDENTIALS"
        const val ACTION_START_TUNNEL = "net.remotenode.fileserver.ACTION_START_TUNNEL"
        const val ACTION_STOP_TUNNEL = "net.remotenode.fileserver.ACTION_STOP_TUNNEL"

        const val EXTRA_PORT = "extra_port"
        const val EXTRA_USERNAME = "extra_username"
        const val EXTRA_PASSWORD = "extra_password"
        const val EXTRA_DEVICE_ID = "extra_device_id"
        const val EXTRA_SESSION_TOKEN = "extra_session_token"
        const val EXTRA_API_BASE_URL = "extra_api_base_url"
        const val EXTRA_GATEWAY_WS_URL = "extra_gateway_ws_url"

        private const val PREFS_NAME = "net.remotenode.server_prefs"
        private const val KEY_SERVER_ENABLED = "server_enabled"
        private const val KEY_TUNNEL_ENABLED = "tunnel_enabled"
        private const val KEY_PORT = "server_port"
        private const val KEY_ADMIN_USER = "admin_user"
        private const val KEY_ADMIN_PASS = "admin_pass"
        private const val KEY_DEVICE_ID = "tunnel_device_id"
        private const val KEY_SESSION_TOKEN = "tunnel_session_token"
        private const val KEY_API_BASE_URL = "tunnel_api_base_url"
        private const val KEY_GATEWAY_WS_URL = "tunnel_gateway_ws_url"

        // Authoritative Singleton Local Server Engine instance
        val engine = LocalServerEngine()
        val tunnelManager = RemoteNodeTunnelManager

        @Volatile
        var isServiceRunning: Boolean = false
            private set

        @Volatile
        var currentServerState: String = "STOPPED"
            private set

        @Volatile
        var activePort: Int = 8080
            private set

        fun getDesiredServerEnabled(context: Context): Boolean {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            return prefs.getBoolean(KEY_SERVER_ENABLED, false)
        }

        fun setDesiredServerEnabled(context: Context, enabled: Boolean) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit().putBoolean(KEY_SERVER_ENABLED, enabled).apply()
        }

        fun getDesiredTunnelEnabled(context: Context): Boolean {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            return prefs.getBoolean(KEY_TUNNEL_ENABLED, false)
        }

        fun setDesiredTunnelEnabled(context: Context, enabled: Boolean) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit().putBoolean(KEY_TUNNEL_ENABLED, enabled).apply()
        }

        fun persistTunnelConfig(
            context: Context,
            deviceId: String,
            sessionToken: String,
            apiBaseUrl: String,
            gatewayWsUrl: String
        ) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit()
                .putString(KEY_DEVICE_ID, deviceId)
                .putString(KEY_SESSION_TOKEN, sessionToken)
                .putString(KEY_API_BASE_URL, apiBaseUrl)
                .putString(KEY_GATEWAY_WS_URL, gatewayWsUrl)
                .putBoolean(KEY_TUNNEL_ENABLED, true)
                .apply()
        }

        fun getPersistedTunnelConfig(context: Context): Map<String, String?> {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            return mapOf(
                "deviceId" to prefs.getString(KEY_DEVICE_ID, null),
                "sessionToken" to prefs.getString(KEY_SESSION_TOKEN, null),
                "apiBaseUrl" to prefs.getString(KEY_API_BASE_URL, null),
                "gatewayWsUrl" to prefs.getString(KEY_GATEWAY_WS_URL, null)
            )
        }

        fun clearPersistedCredentials(context: Context) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit()
                .remove(KEY_SESSION_TOKEN)
                .remove(KEY_DEVICE_ID)
                .remove(KEY_API_BASE_URL)
                .remove(KEY_GATEWAY_WS_URL)
                .putBoolean(KEY_TUNNEL_ENABLED, false)
                .apply()
            RemoteNodeTunnelManager.stopTunnel()
        }

        fun getPersistedPort(context: Context): Int {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val port = prefs.getInt(KEY_PORT, 8080)
            return if (port in 1024..65535) port else 8080
        }

        fun persistPort(context: Context, port: Int) {
            val validPort = if (port in 1024..65535) port else 8080
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit().putInt(KEY_PORT, validPort).apply()
        }
    }

    private var wakeLock: PowerManager.WakeLock? = null
    private val lifecycleLock = Any()

    private val tunnelListener: (Map<String, Any?>) -> Unit = { event ->
        if (isServiceRunning) {
            val tunnelState = event["state"] as? String ?: "DISCONNECTED"
            val text = "Personal file server on port $activePort | Gateway: $tunnelState"
            val runningNotif = buildNotification(text)
            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.notify(NOTIFICATION_ID, runningNotif)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        // Promote immediately in onCreate to satisfy Android 14/15 FGS timeout contracts
        val initialNotif = buildNotification("Initializing ZdexCloud background service...")
        promoteToForeground(initialNotif)

        NetworkWatcher.start(this)
        RemoteNodeTunnelManager.addListener(tunnelListener)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Handle OS process recreation where intent is null
        if (intent == null) {
            val desired = getDesiredServerEnabled(this)
            if (desired) {
                val port = getPersistedPort(this)
                if (!isServiceRunning) {
                    handleStartServer(port)
                } else {
                    val notif = buildNotification("Personal file server is running on port $activePort")
                    val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                    notificationManager.notify(NOTIFICATION_ID, notif)
                }
                return START_STICKY
            } else {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    stopForeground(STOP_FOREGROUND_REMOVE)
                } else {
                    @Suppress("DEPRECATION")
                    stopForeground(true)
                }
                stopSelf()
                return START_NOT_STICKY
            }
        }

        val action = intent.action ?: ACTION_START_SERVER

        when (action) {
            ACTION_START_SERVER -> {
                val port = intent.getIntExtra(EXTRA_PORT, getPersistedPort(this))
                val user = intent.getStringExtra(EXTRA_USERNAME)
                val pass = intent.getStringExtra(EXTRA_PASSWORD)
                if (user != null && pass != null) {
                    engine.setCredentials(user, pass)
                }
                handleStartServer(port)
            }
            ACTION_STOP_SERVER -> {
                handleStopServer()
            }
            ACTION_RESTART_SERVER -> {
                val port = intent.getIntExtra(EXTRA_PORT, activePort)
                handleRestartServer(port)
            }
            ACTION_SET_CREDENTIALS -> {
                val user = intent.getStringExtra(EXTRA_USERNAME)
                val pass = intent.getStringExtra(EXTRA_PASSWORD)
                engine.setCredentials(user, pass)
            }
            ACTION_START_TUNNEL -> {
                val devId = intent.getStringExtra(EXTRA_DEVICE_ID)
                val token = intent.getStringExtra(EXTRA_SESSION_TOKEN)
                val apiBase = intent.getStringExtra(EXTRA_API_BASE_URL)
                val gatewayWs = intent.getStringExtra(EXTRA_GATEWAY_WS_URL)
                if (!devId.isNullOrEmpty() && !token.isNullOrEmpty() && !apiBase.isNullOrEmpty() && !gatewayWs.isNullOrEmpty()) {
                    persistTunnelConfig(this, devId, token, apiBase, gatewayWs)
                    RemoteNodeTunnelManager.startTunnel(this, devId, token, apiBase, gatewayWs)
                }
            }
            ACTION_STOP_TUNNEL -> {
                setDesiredTunnelEnabled(this, false)
                RemoteNodeTunnelManager.stopTunnel()
                val text = "Personal file server on port $activePort | Gateway: DISCONNECTED"
                val runningNotif = buildNotification(text)
                val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                notificationManager.notify(NOTIFICATION_ID, runningNotif)
            }
        }

        return START_STICKY
    }

    private fun handleStartServer(port: Int) {
        synchronized(lifecycleLock) {
            try {
                val validatedPort = if (port in 1024..65535) port else 8080

                // Idempotent start protection: if already running on the same port, refresh and return
                if (isServiceRunning && activePort == validatedPort) {
                    val text = "Personal file server is running on port $validatedPort"
                    val runningNotif = buildNotification(text)
                    val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                    notificationManager.notify(NOTIFICATION_ID, runningNotif)
                    return
                }

                currentServerState = "STARTING"
                activePort = validatedPort
                persistPort(this, validatedPort)
                setDesiredServerEnabled(this, true)

                // Start Foreground with starting notification
                val startingNotif = buildNotification("Starting ZdexCloud file server on port $validatedPort...")
                promoteToForeground(startingNotif)

                acquireWakeLock()

                val storageDir = filesDir.resolve("RemoteNodeFiles")
                val startResult = engine.start(validatedPort, storageDir, applicationContext)

                if (startResult["success"] == true) {
                    isServiceRunning = true
                    currentServerState = "RUNNING"
                    val runningNotif = buildNotification("Personal file server is running on port $validatedPort")
                    val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                    notificationManager.notify(NOTIFICATION_ID, runningNotif)

                    // Auto-restore remote access tunnel if enabled and configured (e.g. after reboot)
                    if (getDesiredTunnelEnabled(this)) {
                        val tunnelConfig = getPersistedTunnelConfig(this)
                        val devId = tunnelConfig["deviceId"]
                        val token = tunnelConfig["sessionToken"]
                        val apiBase = tunnelConfig["apiBaseUrl"]
                        val gatewayWs = tunnelConfig["gatewayWsUrl"]
                        if (!devId.isNullOrEmpty() && !token.isNullOrEmpty() && !apiBase.isNullOrEmpty() && !gatewayWs.isNullOrEmpty()) {
                            RemoteNodeTunnelManager.startTunnel(this, devId, token, apiBase, gatewayWs)
                        }
                    }
                } else {
                    isServiceRunning = false
                    currentServerState = "START_FAILED"
                    releaseWakeLock()
                    val errNotif = buildNotification("Failed to start file server on port $validatedPort")
                    val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                    notificationManager.notify(NOTIFICATION_ID, errNotif)
                }
            } catch (e: Exception) {
                isServiceRunning = false
                currentServerState = "ERROR"
                releaseWakeLock()
            }
        }
    }

    private fun handleStopServer() {
        synchronized(lifecycleLock) {
            try {
                setDesiredTunnelEnabled(this, false)
                RemoteNodeTunnelManager.stopTunnel()
                setDesiredServerEnabled(this, false)
                engine.stop()
                releaseWakeLock()
                isServiceRunning = false
                currentServerState = "STOPPED"

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    stopForeground(STOP_FOREGROUND_REMOVE)
                } else {
                    @Suppress("DEPRECATION")
                    stopForeground(true)
                }
                stopSelf()
            } catch (_: Exception) {
                stopSelf()
            }
        }
    }

    private fun handleRestartServer(port: Int) {
        synchronized(lifecycleLock) {
            handleStopServer()
            handleStartServer(port)
        }
    }

    private fun promoteToForeground(notification: Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun acquireWakeLock() {
        if (wakeLock == null) {
            val powerManager = getSystemService(Context.POWER_SERVICE) as? PowerManager
            wakeLock = powerManager?.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "net.remotenode:server_wakelock"
            )?.apply {
                setReferenceCounted(false)
            }
        }
        wakeLock?.acquire(12 * 60 * 60 * 1000L) // 12 hours max continuous execution safety timeout
    }

    private fun releaseWakeLock() {
        try {
            if (wakeLock?.isHeld == true) {
                wakeLock?.release()
            }
        } catch (_: Exception) {}
        wakeLock = null
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "ZdexCloud File Server Service",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows ongoing status and controls for your local ZdexCloud personal file server"
                setShowBadge(false)
            }
            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(statusText: String): Notification {
        val openAppIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val openAppPendingIntent = PendingIntent.getActivity(
            this,
            0,
            openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val stopIntent = Intent(this, RemoteNodeServerService::class.java).apply {
            action = ACTION_STOP_SERVER
        }
        val stopPendingIntent = PendingIntent.getService(
            this,
            1,
            stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("ZdexCloud")
            .setContentText(statusText)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(openAppPendingIntent)
            .addAction(0, "Open App", openAppPendingIntent)
            .addAction(0, "Stop Server", stopPendingIntent)
            .build()
    }

    override fun onDestroy() {
        super.onDestroy()
        RemoteNodeTunnelManager.removeListener(tunnelListener)
        releaseWakeLock()
        if (isServiceRunning) {
            try {
                engine.stop()
            } catch (_: Exception) {}
            isServiceRunning = false
        }
    }
}
