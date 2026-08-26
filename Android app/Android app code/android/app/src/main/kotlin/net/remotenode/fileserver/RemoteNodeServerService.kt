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

        const val EXTRA_PORT = "extra_port"
        const val EXTRA_USERNAME = "extra_username"
        const val EXTRA_PASSWORD = "extra_password"

        private const val PREFS_NAME = "net.remotenode.server_prefs"
        private const val KEY_SERVER_ENABLED = "server_enabled"
        private const val KEY_PORT = "server_port"
        private const val KEY_ADMIN_USER = "admin_user"
        private const val KEY_ADMIN_PASS = "admin_pass"

        // Authoritative Singleton Local Server Engine instance
        val engine = LocalServerEngine()

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

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Handle OS process recreation where intent is null
        if (intent == null) {
            val desired = getDesiredServerEnabled(this)
            if (desired) {
                val port = getPersistedPort(this)
                handleStartServer(port)
                return START_STICKY
            } else {
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
        }

        return START_STICKY
    }

    private fun handleStartServer(port: Int) {
        synchronized(lifecycleLock) {
            try {
                currentServerState = "STARTING"
                val validatedPort = if (port in 1024..65535) port else 8080
                activePort = validatedPort
                persistPort(this, validatedPort)
                setDesiredServerEnabled(this, true)

                // Start Foreground immediately with starting notification
                val startingNotif = buildNotification("Starting RemoteNode file server...")
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
                "RemoteNode File Server Service",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows ongoing status and controls for your local RemoteNode personal file server"
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
            .setContentTitle("RemoteNode")
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
        releaseWakeLock()
    }
}
