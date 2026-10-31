package net.remotenode.fileserver

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Environment
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import java.io.File

/**
 * RemoteNode Native Android Persistent Foreground Service
 * Phase APP-R1.11 Hardened: Authoritative server lifecycle owner and persistent supervisor.
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
        const val ACTION_KEEPALIVE_PULSE = "net.remotenode.fileserver.ACTION_KEEPALIVE_PULSE"

        private const val KEEPALIVE_INTERVAL_MS = 25000L

        const val EXTRA_PORT = "extra_port"
        const val EXTRA_STORAGE_PATH = "extra_storage_path"
        const val EXTRA_USERNAME = "extra_username"
        const val EXTRA_PASSWORD = "extra_password"
        const val EXTRA_DEVICE_ID = "extra_device_id"
        const val EXTRA_SESSION_TOKEN = "extra_session_token"
        const val EXTRA_API_BASE_URL = "extra_api_base_url"
        const val EXTRA_GATEWAY_WS_URL = "extra_gateway_ws_url"
        const val EXTRA_DEVICE_CREDENTIAL = "extra_device_credential"

        private const val PREFS_NAME = "net.remotenode.server_prefs"
        private const val KEY_SERVER_ENABLED = "server_enabled"
        private const val KEY_TUNNEL_ENABLED = "tunnel_enabled"
        private const val KEY_PORT = "server_port"
        private const val KEY_STORAGE_PATH = "storage_path"
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
            gatewayWsUrl: String,
            deviceCredential: String? = null
        ) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit()
                .putString(KEY_DEVICE_ID, deviceId)
                .putString(KEY_SESSION_TOKEN, sessionToken)
                .putString(KEY_API_BASE_URL, apiBaseUrl)
                .putString(KEY_GATEWAY_WS_URL, gatewayWsUrl)
                .putBoolean(KEY_TUNNEL_ENABLED, true)
                .apply()
            if (!deviceCredential.isNullOrEmpty()) {
                net.remotenode.fileserver.security.AndroidSecureStorage.writeKv(context, "device_credential", deviceCredential)
            }
        }

        fun getPersistedTunnelConfig(context: Context): Map<String, String?> {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            return mapOf(
                "deviceId" to prefs.getString(KEY_DEVICE_ID, null),
                "sessionToken" to prefs.getString(KEY_SESSION_TOKEN, null),
                "apiBaseUrl" to prefs.getString(KEY_API_BASE_URL, null),
                "gatewayWsUrl" to prefs.getString(KEY_GATEWAY_WS_URL, null),
                "deviceCredential" to net.remotenode.fileserver.security.AndroidSecureStorage.readKv(context, "device_credential")
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
            net.remotenode.fileserver.security.AndroidSecureStorage.deleteKv(context, "device_credential")
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

        fun getPersistedStoragePath(context: Context): String {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val saved = prefs.getString(KEY_STORAGE_PATH, null)
            if (!saved.isNullOrBlank()) {
                val f = File(saved)
                if (f.exists() || f.mkdirs()) {
                    return f.absolutePath
                }
            }
            val defaultDownloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            if (!defaultDownloads.exists()) {
                defaultDownloads.mkdirs()
            }
            return defaultDownloads.absolutePath
        }

        fun persistStoragePath(context: Context, path: String) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit().putString(KEY_STORAGE_PATH, path).apply()
        }

        fun purgeStorageFolder(context: Context): Int {
            return try {
                val path = getPersistedStoragePath(context)
                val dir = File(path)
                var count = 0
                if (dir.exists() && dir.isDirectory) {
                    val files = dir.listFiles()
                    if (files != null) {
                        for (f in files) {
                            if (f.isDirectory) {
                                count += deleteDirectoryRecursively(f)
                            } else {
                                if (f.delete()) count++
                            }
                        }
                    }
                }
                count
            } catch (_: Exception) {
                0
            }
        }

        private fun deleteDirectoryRecursively(dir: File): Int {
            var count = 0
            val files = dir.listFiles()
            if (files != null) {
                for (f in files) {
                    if (f.isDirectory) {
                        count += deleteDirectoryRecursively(f)
                    } else {
                        if (f.delete()) count++
                    }
                }
            }
            if (dir.delete()) count++
            return count
        }
    }

    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private var systemEventReceiver: BroadcastReceiver? = null
    private val lifecycleLock = Any()

    private val tunnelListener: (Map<String, Any?>) -> Unit = { event ->
        if (isServiceRunning) {
            updateNotification()
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        // Promote immediately in onCreate to satisfy Android 14/15 FGS timeout contracts
        val initialNotif = buildNotification("Initializing ZdexCloud background service...")
        promoteToForeground(initialNotif)

        registerSystemEventReceiver()
        NetworkWatcher.start(this)
        RemoteNodeTunnelManager.addListener(tunnelListener)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Handle OS process recreation where intent is null
        if (intent == null) {
            val desired = getDesiredServerEnabled(this)
            val tunnelDesired = getDesiredTunnelEnabled(this)
            if (desired || tunnelDesired) {
                acquireWakeLock()
                acquireWifiLock()
                scheduleNextKeepAliveAlarm()
                val port = getPersistedPort(this)
                if (desired && !isServiceRunning) {
                    handleStartServer(port)
                } else {
                    updateNotification()
                }
                if (tunnelDesired) {
                    val tunnelConfig = getPersistedTunnelConfig(this)
                    val devId = tunnelConfig["deviceId"]
                    val token = tunnelConfig["sessionToken"]
                    val apiBase = tunnelConfig["apiBaseUrl"]
                    val gatewayWs = tunnelConfig["gatewayWsUrl"]
                    val cred = tunnelConfig["deviceCredential"]
                    if (!devId.isNullOrEmpty() && !apiBase.isNullOrEmpty() && !gatewayWs.isNullOrEmpty() && (!token.isNullOrEmpty() || !cred.isNullOrEmpty())) {
                        RemoteNodeTunnelManager.startTunnel(this, devId, token ?: "", apiBase, gatewayWs, cred)
                    }
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
                android.util.Log.i("RemoteNodeServerService", "[SERVER_START_REQUESTED] action=ACTION_START_SERVER")
                val port = intent.getIntExtra(EXTRA_PORT, getPersistedPort(this))
                val customStoragePath = intent.getStringExtra(EXTRA_STORAGE_PATH)
                val user = intent.getStringExtra(EXTRA_USERNAME)
                val pass = intent.getStringExtra(EXTRA_PASSWORD)
                if (user != null && pass != null) {
                    engine.setCredentials(user, pass)
                }
                handleStartServer(port, customStoragePath)
            }
            ACTION_STOP_SERVER -> {
                android.util.Log.i("RemoteNodeServerService", "[SERVER_STOP_REQUESTED] action=ACTION_STOP_SERVER source=intent")
                handleStopServer()
            }
            ACTION_RESTART_SERVER -> {
                val port = intent.getIntExtra(EXTRA_PORT, activePort)
                val customStoragePath = intent.getStringExtra(EXTRA_STORAGE_PATH)
                handleRestartServer(port, customStoragePath)
            }
            ACTION_SET_CREDENTIALS -> {
                val user = intent.getStringExtra(EXTRA_USERNAME)
                val pass = intent.getStringExtra(EXTRA_PASSWORD)
                engine.setCredentials(user, pass)
            }
            ACTION_START_TUNNEL -> {
                acquireWakeLock()
                acquireWifiLock()
                scheduleNextKeepAliveAlarm()
                val devId = intent.getStringExtra(EXTRA_DEVICE_ID)
                val token = intent.getStringExtra(EXTRA_SESSION_TOKEN)
                val apiBase = intent.getStringExtra(EXTRA_API_BASE_URL)
                val gatewayWs = intent.getStringExtra(EXTRA_GATEWAY_WS_URL)
                val deviceCredential = intent.getStringExtra(EXTRA_DEVICE_CREDENTIAL) ?: net.remotenode.fileserver.security.AndroidSecureStorage.readKv(this, "device_credential")
                if (!devId.isNullOrEmpty() && !token.isNullOrEmpty() && !apiBase.isNullOrEmpty() && !gatewayWs.isNullOrEmpty()) {
                    persistTunnelConfig(this, devId, token, apiBase, gatewayWs, deviceCredential)
                    RemoteNodeTunnelManager.startTunnel(this, devId, token, apiBase, gatewayWs, deviceCredential)
                }
                updateNotification()
            }
            ACTION_STOP_TUNNEL -> {
                android.util.Log.i("RemoteNodeServerService", "[EXPLICIT_STOP] action=ACTION_STOP_TUNNEL source=intent")
                setDesiredTunnelEnabled(this, false)
                RemoteNodeTunnelManager.stopTunnel()
                if (!getDesiredServerEnabled(this)) {
                    cancelKeepAliveAlarm()
                    releaseWifiLock()
                    releaseWakeLock()
                }
                updateNotification()
            }
            ACTION_KEEPALIVE_PULSE -> {
                if (isServiceRunning || getDesiredTunnelEnabled(this)) {
                    acquireWakeLock()
                    acquireWifiLock()
                    RemoteNodeTunnelManager.checkAndPulseKeepalive()
                    scheduleNextKeepAliveAlarm()
                } else {
                    cancelKeepAliveAlarm()
                }
            }
        }

        return START_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        val desired = getDesiredServerEnabled(this)
        android.util.Log.i("RemoteNodeServerService", "[ON_TASK_REMOVED] serverDesired=$desired isRunning=$isServiceRunning activePort=$activePort")
        if (desired) {
            updateNotification()
        }
    }

    private fun updateNotification() {
        if (!isServiceRunning) return

        val tunnelState = RemoteNodeTunnelManager.currentState
        val statusText = when (tunnelState) {
            RemoteNodeTunnelManager.STATE_CONNECTED -> "Personal file server on port $activePort | Gateway: Connected"
            RemoteNodeTunnelManager.STATE_CONNECTING -> "Personal file server on port $activePort | Gateway: Connecting..."
            RemoteNodeTunnelManager.STATE_AUTHENTICATING -> "Personal file server on port $activePort | Gateway: Authenticating..."
            RemoteNodeTunnelManager.STATE_RECONNECTING -> "Personal file server on port $activePort | Gateway: Reconnecting..."
            RemoteNodeTunnelManager.STATE_NETWORK_UNAVAILABLE -> "Personal file server on port $activePort | Waiting for network..."
            RemoteNodeTunnelManager.STATE_AUTH_FAILED -> "ZdexCloud: Device Authorization Required"
            RemoteNodeTunnelManager.STATE_ERROR -> "Personal file server on port $activePort | Gateway: Reconnecting..."
            RemoteNodeTunnelManager.STATE_STOPPED -> {
                if (getDesiredTunnelEnabled(this)) {
                    "Personal file server on port $activePort | Gateway: Reconnecting..."
                } else {
                    "Personal file server is running on port $activePort"
                }
            }
            else -> "Personal file server is running on port $activePort"
        }

        val notif = buildNotification(statusText)
        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
        notificationManager?.notify(NOTIFICATION_ID, notif)
    }

    private fun handleStartServer(port: Int, customStoragePath: String? = null) {
        synchronized(lifecycleLock) {
            try {
                val validatedPort = if (port in 1024..65535) port else 8080

                // Idempotent start protection: if already running on the same port, refresh and return
                if (isServiceRunning && activePort == validatedPort) {
                    updateNotification()
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
                acquireWifiLock()
                scheduleNextKeepAliveAlarm()

                val storagePath = if (!customStoragePath.isNullOrBlank()) {
                    persistStoragePath(this, customStoragePath)
                    customStoragePath
                } else {
                    getPersistedStoragePath(this)
                }
                val storageDir = File(storagePath).apply { if (!exists()) mkdirs() }
                val startResult = engine.start(validatedPort, storageDir, applicationContext)

                if (startResult["success"] == true) {
                    isServiceRunning = true
                    currentServerState = "RUNNING"
                    android.util.Log.i("RemoteNodeServerService", "[SERVER_STARTED] port=$validatedPort localEngine=ONLINE")
                    updateNotification()

                    // Auto-restore remote access tunnel if enabled and configured (e.g. after reboot or service start)
                    if (getDesiredTunnelEnabled(this)) {
                        val tunnelConfig = getPersistedTunnelConfig(this)
                        val devId = tunnelConfig["deviceId"]
                        val token = tunnelConfig["sessionToken"]
                        val apiBase = tunnelConfig["apiBaseUrl"]
                        val gatewayWs = tunnelConfig["gatewayWsUrl"]
                        val cred = tunnelConfig["deviceCredential"]
                        if (!devId.isNullOrEmpty() && !apiBase.isNullOrEmpty() && !gatewayWs.isNullOrEmpty() && (!token.isNullOrEmpty() || !cred.isNullOrEmpty())) {
                            RemoteNodeTunnelManager.startTunnel(this, devId, token ?: "", apiBase, gatewayWs, cred)
                        }
                    }
                } else {
                    isServiceRunning = false
                    currentServerState = "START_FAILED"
                    cancelKeepAliveAlarm()
                    releaseWifiLock()
                    releaseWakeLock()
                    val errNotif = buildNotification("Failed to start file server on port $validatedPort")
                    val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                    notificationManager.notify(NOTIFICATION_ID, errNotif)
                }
            } catch (e: Exception) {
                isServiceRunning = false
                currentServerState = "ERROR"
                cancelKeepAliveAlarm()
                releaseWifiLock()
                releaseWakeLock()
                val tunnelConfig = getPersistedTunnelConfig(this)
                AndroidErrorTelemetry.reportError(
                    tunnelConfig["apiBaseUrl"],
                    tunnelConfig["sessionToken"],
                    AndroidErrorTelemetry.ErrorTelemetryPayload(
                        component = "ANDROID_SERVICE",
                        errorCode = "SERVICE_START_EXCEPTION",
                        errorType = e.javaClass.simpleName,
                        severity = "ERROR",
                        message = "Android foreground service failed during startup: ${e.message}",
                        throwable = e,
                        deviceId = tunnelConfig["deviceId"],
                        metadata = mapOf("port" to port)
                    )
                )
            }
        }
    }

    private fun handleStopServer() {
        synchronized(lifecycleLock) {
            try {
                android.util.Log.i("RemoteNodeServerService", "[EXPLICIT_STOP] handleStopServer: Stopping local engine and tunnel explicitly")
                setDesiredTunnelEnabled(this, false)
                setDesiredServerEnabled(this, false)
                isServiceRunning = false
                currentServerState = "STOPPED"
                engine.stop()
                RemoteNodeTunnelManager.stopTunnel()
                cancelKeepAliveAlarm()
                releaseWifiLock()
                releaseWakeLock()

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

    private fun handleRestartServer(port: Int, customStoragePath: String? = null) {
        synchronized(lifecycleLock) {
            handleStopServer()
            handleStartServer(port, customStoragePath)
        }
    }

    private fun promoteToForeground(notification: Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC or ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            )
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
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
        try {
            wakeLock?.acquire(24 * 60 * 60 * 1000L) // 24 hours continuous execution safety renewal
        } catch (_: Exception) {}
    }

    private fun releaseWakeLock() {
        try {
            if (wakeLock?.isHeld == true) {
                wakeLock?.release()
            }
        } catch (_: Exception) {}
        wakeLock = null
    }

    private fun acquireWifiLock() {
        if (wifiLock == null) {
            val wifiManager = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                WifiManager.WIFI_MODE_FULL_HIGH_PERF
            } else {
                @Suppress("DEPRECATION")
                WifiManager.WIFI_MODE_FULL
            }
            wifiLock = wifiManager?.createWifiLock(mode, "net.remotenode:wifi_lock")?.apply {
                setReferenceCounted(false)
            }
        }
        try {
            if (wifiLock?.isHeld != true) {
                wifiLock?.acquire()
            }
        } catch (_: Exception) {}
    }

    private fun releaseWifiLock() {
        try {
            if (wifiLock?.isHeld == true) {
                wifiLock?.release()
            }
        } catch (_: Exception) {}
        wifiLock = null
    }

    private fun scheduleNextKeepAliveAlarm() {
        if (!isServiceRunning && !getDesiredTunnelEnabled(this)) return
        try {
            val alarmManager = getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
            val intent = Intent(this, RemoteNodeServerService::class.java).apply {
                action = ACTION_KEEPALIVE_PULSE
            }
            val pendingIntent = PendingIntent.getService(
                this,
                9002,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val triggerAt = SystemClock.elapsedRealtime() + KEEPALIVE_INTERVAL_MS
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pendingIntent)
            } else {
                alarmManager.setExact(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pendingIntent)
            }
        } catch (e: Exception) {
            android.util.Log.w("RemoteNodeServerService", "Failed to schedule keepalive alarm: ${e.message}")
        }
    }

    private fun cancelKeepAliveAlarm() {
        try {
            val alarmManager = getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
            val intent = Intent(this, RemoteNodeServerService::class.java).apply {
                action = ACTION_KEEPALIVE_PULSE
            }
            val pendingIntent = PendingIntent.getService(
                this,
                9002,
                intent,
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
            )
            if (pendingIntent != null) {
                alarmManager.cancel(pendingIntent)
                pendingIntent.cancel()
            }
        } catch (_: Exception) {}
    }

    private fun registerSystemEventReceiver() {
        if (systemEventReceiver != null) return
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                val action = intent?.action ?: return
                when (action) {
                    Intent.ACTION_SCREEN_ON,
                    Intent.ACTION_USER_PRESENT,
                    Intent.ACTION_POWER_CONNECTED -> {
                        android.util.Log.i("RemoteNodeServerService", "[SYSTEM_EVENT] action=$action. Restoring locks and pulsing keepalive.")
                        if (isServiceRunning || getDesiredTunnelEnabled(this@RemoteNodeServerService)) {
                            acquireWakeLock()
                            acquireWifiLock()
                            RemoteNodeTunnelManager.triggerImmediateRecovery()
                            scheduleNextKeepAliveAlarm()
                        }
                    }
                }
            }
        }
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_USER_PRESENT)
            addAction(Intent.ACTION_POWER_CONNECTED)
        }
        try {
            registerReceiver(receiver, filter)
            systemEventReceiver = receiver
        } catch (e: Exception) {
            android.util.Log.w("RemoteNodeServerService", "Failed to register system event receiver: ${e.message}")
        }
    }

    private fun unregisterSystemEventReceiver() {
        try {
            if (systemEventReceiver != null) {
                unregisterReceiver(systemEventReceiver)
                systemEventReceiver = null
            }
        } catch (_: Exception) {}
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

        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("ZdexCloud")
            .setContentText(statusText)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(openAppPendingIntent)
            .addAction(0, "Open App", openAppPendingIntent)
            .addAction(0, "Stop Server", stopPendingIntent)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
        }

        return builder.build()
    }

    override fun onDestroy() {
        super.onDestroy()
        RemoteNodeTunnelManager.removeListener(tunnelListener)
        unregisterSystemEventReceiver()
        cancelKeepAliveAlarm()
        releaseWifiLock()
        releaseWakeLock()
        if (isServiceRunning) {
            try {
                engine.stop()
            } catch (_: Exception) {}
            isServiceRunning = false
        }
    }
}
