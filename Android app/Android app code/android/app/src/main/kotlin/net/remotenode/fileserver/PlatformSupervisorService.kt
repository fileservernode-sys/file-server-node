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
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import net.remotenode.fileserver.camera.CameraCaptureEngine
import java.io.File

/**
 * PlatformSupervisorService — Unified Android Foreground-Service Lifecycle Supervisor (Phase 21.5.1).
 *
 * Responsibilities:
 * 1. Owns the single Android foreground-service lifecycle and persistent notification (ID 9001).
 * 2. Coordinates independent Storage and Camera engine lifecycles under unified supervision.
 * 3. Keeps the foreground service alive as long as at least one engine requires background persistence.
 * 4. Ensures stopping one engine NEVER stops the other engine or releases the other's resources.
 * 5. Stops itself only when zero engines require the service.
 * 6. Dynamically updates Android 14+ foregroundServiceType bitmasks (DATA_SYNC | SPECIAL_USE | CAMERA).
 * 7. Presents clear, non-competing persistent notification actions for independent engine control.
 */
class PlatformSupervisorService : Service() {

    companion object {
        private const val TAG = "PlatformSupervisor"
        const val CHANNEL_ID = "zdexcloud_supervisor_channel"
        const val NOTIFICATION_ID = 9001

        // Intent Actions
        const val ACTION_START_STORAGE = "net.remotenode.fileserver.ACTION_START_STORAGE"
        const val ACTION_STOP_STORAGE = "net.remotenode.fileserver.ACTION_STOP_STORAGE"
        const val ACTION_RESTART_STORAGE = "net.remotenode.fileserver.ACTION_RESTART_STORAGE"
        const val ACTION_START_TUNNEL = "net.remotenode.fileserver.ACTION_START_TUNNEL"
        const val ACTION_STOP_TUNNEL = "net.remotenode.fileserver.ACTION_STOP_TUNNEL"

        const val ACTION_START_CAMERA = "net.remotenode.fileserver.ACTION_START_CAMERA"
        const val ACTION_STOP_CAMERA = "net.remotenode.fileserver.ACTION_STOP_CAMERA"
        const val ACTION_STOP_ALL = "net.remotenode.fileserver.ACTION_STOP_ALL"
        const val ACTION_KEEPALIVE_PULSE = "net.remotenode.fileserver.ACTION_KEEPALIVE_PULSE"

        private const val KEEPALIVE_INTERVAL_MS = 25000L

        // Intent Extras
        const val EXTRA_PORT = "extra_port"
        const val EXTRA_STORAGE_PATH = "extra_storage_path"
        const val EXTRA_USERNAME = "extra_username"
        const val EXTRA_PASSWORD = "extra_password"
        const val EXTRA_DEVICE_ID = "extra_device_id"
        const val EXTRA_SESSION_TOKEN = "extra_session_token"
        const val EXTRA_API_BASE_URL = "extra_api_base_url"
        const val EXTRA_GATEWAY_WS_URL = "extra_gateway_ws_url"
        const val EXTRA_DEVICE_CREDENTIAL = "extra_device_credential"

        // Authoritative Global Supervisor State
        @Volatile
        var isStorageActive: Boolean = false
            private set

        @Volatile
        var isCameraActive: Boolean = false
            private set

        @Volatile
        var storageServerState: String = "STOPPED"
            private set

        @Volatile
        var activePort: Int = 8080
            private set

        @Volatile
        var lastSupervisorError: String? = null
            private set

        // Strong reference to active Camera engine while running (Phase 21.5.1.1)
        @Volatile
        private var activeCameraEngine: CameraCaptureEngine? = null

        private val supervisorLock = Any()

        // Shutdown generation counter to prevent delayed stopSelf() races
        @Volatile
        private var shutdownGeneration: Long = 0L

        // Asynchronous Camera FGS Promotion Acknowledgement Queue (Phase 21.5.1.1)
        typealias CameraPromotionCallback = (success: Boolean, errorCode: String?, errorMessage: String?) -> Unit
        private val pendingCameraPromotionCallbacks = mutableListOf<CameraPromotionCallback>()
        private var isCameraPromotionInFlight: Boolean = false
        private var cameraPromotionTimeoutRunnable: Runnable? = null
        private val mainHandler = Handler(Looper.getMainLooper())
        private const val PROMOTION_TIMEOUT_MS = 5000L

        /**
         * Returns true if either engine is currently active in the supervisor.
         */
        val isAnyEngineActive: Boolean
            get() = isStorageActive || isCameraActive

        /**
         * Attaches active CameraCaptureEngine with strong service ownership.
         */
        fun attachActiveCameraEngine(engine: CameraCaptureEngine) {
            synchronized(supervisorLock) {
                activeCameraEngine = engine
            }
        }

        fun getActiveCameraEngine(): CameraCaptureEngine? {
            return synchronized(supervisorLock) { activeCameraEngine }
        }

        fun detachActiveCameraEngine(): CameraCaptureEngine? {
            return synchronized(supervisorLock) {
                val engine = activeCameraEngine
                activeCameraEngine = null
                engine
            }
        }

        /**
         * Registers active CameraCaptureEngine with the supervisor for lifecycle coordination (legacy alias).
         */
        fun registerCameraEngine(engine: CameraCaptureEngine) {
            attachActiveCameraEngine(engine)
        }

        /**
         * Unregisters CameraCaptureEngine from the supervisor (legacy alias).
         */
        fun unregisterCameraEngine(engine: CameraCaptureEngine) {
            synchronized(supervisorLock) {
                if (activeCameraEngine === engine) {
                    activeCameraEngine = null
                }
            }
        }

        /**
         * Asynchronously requests foreground service promotion with CAMERA type.
         * Guarantees that callback is invoked ONLY after supervisor has successfully
         * promoted itself to foreground with FOREGROUND_SERVICE_TYPE_CAMERA.
         *
         * Does NOT open Camera2 hardware.
         */
        fun requestCameraForegroundPromotion(
            context: Context,
            callback: CameraPromotionCallback
        ) {
            val (alreadyActive, shouldInitiate) = synchronized(supervisorLock) {
                if (isCameraActive) {
                    Pair(true, false)
                } else {
                    pendingCameraPromotionCallbacks.add(callback)
                    if (!isCameraPromotionInFlight) {
                        isCameraPromotionInFlight = true
                        Pair(false, true)
                    } else {
                        // Already in flight; request queued to receive same acknowledgement
                        Pair(false, false)
                    }
                }
            }

            if (alreadyActive) {
                mainHandler.post { callback(true, null, null) }
                return
            }

            if (shouldInitiate) {
                val timeoutRunnable = Runnable {
                    val callbacksToNotify = synchronized(supervisorLock) {
                        if (isCameraPromotionInFlight) {
                            isCameraPromotionInFlight = false
                            val list = ArrayList(pendingCameraPromotionCallbacks)
                            pendingCameraPromotionCallbacks.clear()
                            list
                        } else emptyList()
                    }
                    callbacksToNotify.forEach { cb ->
                        cb(false, "PROMOTION_TIMEOUT", "Camera foreground service promotion timed out after 5000ms")
                    }
                }

                synchronized(supervisorLock) {
                    cameraPromotionTimeoutRunnable = timeoutRunnable
                }
                mainHandler.postDelayed(timeoutRunnable, PROMOTION_TIMEOUT_MS)

                val intent = Intent(context.applicationContext, PlatformSupervisorService::class.java).apply {
                    action = ACTION_START_CAMERA
                }
                try {
                    ContextCompat.startForegroundService(context.applicationContext, intent)
                } catch (e: Exception) {
                    mainHandler.removeCallbacks(timeoutRunnable)
                    val callbacksToNotify = synchronized(supervisorLock) {
                        isCameraPromotionInFlight = false
                        isCameraActive = false
                        val list = ArrayList(pendingCameraPromotionCallbacks)
                        pendingCameraPromotionCallbacks.clear()
                        list
                    }
                    val errCode = if (e is SecurityException) "CAMERA_FGS_REJECTED" else "START_SERVICE_FAILED"
                    callbacksToNotify.forEach { cb ->
                        cb(false, errCode, e.message ?: "Failed to start supervisor service")
                    }
                }
            }
        }

        /**
         * Signals supervisor that Camera capture has started (synchronous/intent helper).
         */
        fun onCameraStarted(context: Context, engine: CameraCaptureEngine) {
            attachActiveCameraEngine(engine)
            synchronized(supervisorLock) {
                isCameraActive = true
                lastSupervisorError = null
            }
            val intent = Intent(context.applicationContext, PlatformSupervisorService::class.java).apply {
                action = ACTION_START_CAMERA
            }
            try {
                ContextCompat.startForegroundService(context.applicationContext, intent)
            } catch (e: Exception) {
                synchronized(supervisorLock) {
                    isCameraActive = false
                    lastSupervisorError = e.message
                }
                Log.w(TAG, "Failed to start supervisor foreground service for Camera: ${e.message}")
                throw e
            }
        }

        /**
         * Signals supervisor that Camera capture has stopped.
         */
        fun onCameraStopped(context: Context) {
            synchronized(supervisorLock) {
                isCameraActive = false
            }
            val intent = Intent(context.applicationContext, PlatformSupervisorService::class.java).apply {
                action = ACTION_STOP_CAMERA
            }
            try {
                context.startService(intent)
            } catch (_: Exception) {}
        }

        /**
         * Computes the Android 14+ (UPSIDE_DOWN_CAKE) foregroundServiceType bitmask
         * based on active engines.
         */
        fun computeForegroundServiceType(storageActive: Boolean, cameraActive: Boolean): Int {
            var type = 0
            if (storageActive) {
                type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC or ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            }
            if (cameraActive) {
                type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
            }
            if (type == 0) {
                type = ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC or ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            }
            return type
        }

        /**
         * Computes the user-facing persistent notification text based on active engines.
         */
        fun computeStatusText(
            storageActive: Boolean,
            cameraActive: Boolean,
            port: Int = 8080,
            tunnelStateText: String? = null
        ): String {
            return when {
                storageActive && cameraActive -> {
                    "Storage & Camera active (Port $port)"
                }
                storageActive -> {
                    if (!tunnelStateText.isNullOrBlank()) {
                        "File server on port $port | Gateway: $tunnelStateText"
                    } else {
                        "File server active on port $port"
                    }
                }
                cameraActive -> {
                    "Camera capture engine active"
                }
                else -> {
                    "ZdexCloud background services idle"
                }
            }
        }

        /**
         * State reset helper for write-only tests and testing harnesses.
         */
        internal fun resetStateForTesting() {
            synchronized(supervisorLock) {
                isStorageActive = false
                isCameraActive = false
                storageServerState = "STOPPED"
                activePort = 8080
                lastSupervisorError = null
                activeCameraEngine = null
                shutdownGeneration = 0L
                isCameraPromotionInFlight = false
                cameraPromotionTimeoutRunnable?.let { mainHandler.removeCallbacks(it) }
                cameraPromotionTimeoutRunnable = null
                pendingCameraPromotionCallbacks.clear()
            }
        }

        /**
         * State mutation helper for unit tests simulating engine states.
         */
        internal fun setEngineStateForTesting(storage: Boolean, camera: Boolean, port: Int = 8080) {
            synchronized(supervisorLock) {
                isStorageActive = storage
                isCameraActive = camera
                activePort = port
                storageServerState = if (storage) "RUNNING" else "STOPPED"
            }
        }
    }

    inner class SupervisorBinder : android.os.Binder() {
        val service: PlatformSupervisorService
            get() = this@PlatformSupervisorService
    }

    private val binder = SupervisorBinder()
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private var systemEventReceiver: BroadcastReceiver? = null

    private val tunnelListener: (Map<String, Any?>) -> Unit = {
        if (isStorageActive) {
            updateNotification()
        }
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()

        // Immediate foreground promotion in onCreate to satisfy Android 14+ FGS start timeouts
        try {
            val initialNotif = buildNotification("Initializing ZdexCloud services...")
            promoteToForeground(initialNotif)
        } catch (e: Exception) {
            Log.e(TAG, "onCreate promoteToForeground failed: ${e.message}")
        }

        registerSystemEventReceiver()
        NetworkWatcher.start(this)
        RemoteNodeTunnelManager.addListener(tunnelListener)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent == null) {
            // OS Process Recreation handling
            val storageDesired = RemoteNodeServerService.getDesiredServerEnabled(this)
            val tunnelDesired = RemoteNodeServerService.getDesiredTunnelEnabled(this)

            if (storageDesired || tunnelDesired) {
                acquireWakeLock()
                acquireWifiLock()
                scheduleNextKeepAliveAlarm()
                val port = RemoteNodeServerService.getPersistedPort(this)
                handleStartStorage(port)
                return START_STICKY
            } else if (!isCameraActive) {
                stopSupervisorIfNoEngines()
                return START_NOT_STICKY
            }
            updateNotification()
            return START_STICKY
        }

        val action = intent.action ?: ACTION_START_STORAGE

        when (action) {
            ACTION_START_STORAGE -> {
                val port = intent.getIntExtra(EXTRA_PORT, RemoteNodeServerService.getPersistedPort(this))
                val customPath = intent.getStringExtra(EXTRA_STORAGE_PATH)
                val user = intent.getStringExtra(EXTRA_USERNAME)
                val pass = intent.getStringExtra(EXTRA_PASSWORD)
                if (user != null && pass != null) {
                    RemoteNodeServerService.engine.setCredentials(user, pass)
                }
                handleStartStorage(port, customPath)
            }

            ACTION_STOP_STORAGE -> {
                handleStopStorage()
            }

            ACTION_RESTART_STORAGE -> {
                val port = intent.getIntExtra(EXTRA_PORT, activePort)
                val customPath = intent.getStringExtra(EXTRA_STORAGE_PATH)
                handleRestartStorage(port, customPath)
            }

            ACTION_START_TUNNEL -> {
                acquireWakeLock()
                acquireWifiLock()
                scheduleNextKeepAliveAlarm()
                val devId = intent.getStringExtra(EXTRA_DEVICE_ID)
                val token = intent.getStringExtra(EXTRA_SESSION_TOKEN)
                val apiBase = intent.getStringExtra(EXTRA_API_BASE_URL)
                val gatewayWs = intent.getStringExtra(EXTRA_GATEWAY_WS_URL)
                val deviceCredential = intent.getStringExtra(EXTRA_DEVICE_CREDENTIAL)
                    ?: net.remotenode.fileserver.security.AndroidSecureStorage.readKv(this, "device_credential")

                if (!devId.isNullOrEmpty() && !token.isNullOrEmpty() && !apiBase.isNullOrEmpty() && !gatewayWs.isNullOrEmpty()) {
                    RemoteNodeServerService.persistTunnelConfig(this, devId, token, apiBase, gatewayWs, deviceCredential)
                    RemoteNodeTunnelManager.startTunnel(this, devId, token, apiBase, gatewayWs, deviceCredential)
                }
                updateNotification()
            }

            ACTION_STOP_TUNNEL -> {
                RemoteNodeServerService.setDesiredTunnelEnabled(this, false)
                RemoteNodeTunnelManager.stopTunnel()
                if (!isStorageActive) {
                    cancelKeepAliveAlarm()
                }
                updateNotification()
            }

            ACTION_START_CAMERA -> {
                handleStartCamera()
            }

            ACTION_STOP_CAMERA -> {
                handleStopCamera()
            }

            ACTION_STOP_ALL -> {
                handleStopAll()
            }

            ACTION_KEEPALIVE_PULSE -> {
                if (isStorageActive || RemoteNodeServerService.getDesiredTunnelEnabled(this)) {
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
        Log.i(TAG, "onTaskRemoved: storageActive=$isStorageActive cameraActive=$isCameraActive")
        if (isAnyEngineActive) {
            acquireWakeLock()
            acquireWifiLock()
            scheduleNextKeepAliveAlarm()
            updateNotification()
        }
    }

    // -------------------------------------------------------------------------
    // Storage Engine Lifecycle Operations
    // -------------------------------------------------------------------------

    private fun handleStartStorage(port: Int, customStoragePath: String? = null) {
        synchronized(supervisorLock) {
            shutdownGeneration++
            try {
                val validatedPort = if (port in 1024..65535) port else 8080

                // Idempotent start protection
                if (isStorageActive && activePort == validatedPort) {
                    updateNotification()
                    return
                }

                storageServerState = "STARTING"
                activePort = validatedPort
                RemoteNodeServerService.persistPort(this, validatedPort)
                RemoteNodeServerService.setDesiredServerEnabled(this, true)

                acquireWakeLock()
                acquireWifiLock()
                scheduleNextKeepAliveAlarm()

                val storagePath = if (!customStoragePath.isNullOrBlank()) {
                    RemoteNodeServerService.persistStoragePath(this, customStoragePath)
                    customStoragePath
                } else {
                    RemoteNodeServerService.getPersistedStoragePath(this)
                }
                val storageDir = File(storagePath).apply { if (!exists()) mkdirs() }
                val startResult = RemoteNodeServerService.engine.start(validatedPort, storageDir, applicationContext)

                if (startResult["success"] == true) {
                    isStorageActive = true
                    storageServerState = "RUNNING"
                    Log.i(TAG, "Storage engine started successfully on port $validatedPort")

                    // Auto-restore tunnel if enabled
                    if (RemoteNodeServerService.getDesiredTunnelEnabled(this)) {
                        val cfg = RemoteNodeServerService.getPersistedTunnelConfig(this)
                        val devId = cfg["deviceId"]
                        val token = cfg["sessionToken"]
                        val apiBase = cfg["apiBaseUrl"]
                        val gatewayWs = cfg["gatewayWsUrl"]
                        val cred = cfg["deviceCredential"]
                        if (!devId.isNullOrEmpty() && !apiBase.isNullOrEmpty() && !gatewayWs.isNullOrEmpty()) {
                            RemoteNodeTunnelManager.startTunnel(this, devId, token ?: "", apiBase, gatewayWs, cred)
                        }
                    }
                } else {
                    isStorageActive = false
                    storageServerState = "START_FAILED"
                    Log.e(TAG, "Storage engine failed to start on port $validatedPort")
                }
            } catch (e: Exception) {
                isStorageActive = false
                storageServerState = "ERROR"
                lastSupervisorError = "Storage startup error: ${e.message}"
                Log.e(TAG, "Storage startup exception", e)
            }
        }
        updateNotification()
    }

    private fun handleStopStorage() {
        synchronized(supervisorLock) {
            Log.i(TAG, "handleStopStorage: stopping storage engine (cameraActive=$isCameraActive)")
            RemoteNodeServerService.setDesiredTunnelEnabled(this, false)
            RemoteNodeServerService.setDesiredServerEnabled(this, false)
            isStorageActive = false
            storageServerState = "STOPPED"

            try {
                RemoteNodeServerService.engine.stop()
                RemoteNodeTunnelManager.stopTunnel()
            } catch (_: Exception) {}

            if (!isCameraActive) {
                cancelKeepAliveAlarm()
                releaseWifiLock()
                releaseWakeLock()
            }
        }

        // Critical: Check if Camera is still active before stopping supervisor service!
        if (isCameraActive) {
            Log.i(TAG, "Storage stopped, but Camera remains active. Maintaining foreground service.")
            updateNotification()
        } else {
            stopSupervisorIfNoEngines()
        }
    }

    private fun handleRestartStorage(port: Int, customStoragePath: String? = null) {
        handleStopStorage()
        handleStartStorage(port, customStoragePath)
    }

    // -------------------------------------------------------------------------
    // Camera Engine Lifecycle Operations
    // -------------------------------------------------------------------------

    private fun handleStartCamera() {
        var promotionSuccess = false
        var promotionException: Exception? = null

        synchronized(supervisorLock) {
            shutdownGeneration++
            isCameraActive = true
            acquireWakeLock()
            Log.i(TAG, "handleStartCamera: Camera marked active (storageActive=$isStorageActive)")
        }

        try {
            updateNotification()
            promotionSuccess = true
        } catch (e: Exception) {
            promotionException = e
            synchronized(supervisorLock) {
                isCameraActive = false
                lastSupervisorError = e.message
            }
            Log.e(TAG, "handleStartCamera: Failed promoting to foreground with camera type: ${e.message}")
        }

        // Cancel timeout and dispatch to pending promotion callbacks outside lock
        val callbacksToNotify = synchronized(supervisorLock) {
            cameraPromotionTimeoutRunnable?.let { mainHandler.removeCallbacks(it) }
            cameraPromotionTimeoutRunnable = null
            isCameraPromotionInFlight = false
            val list = ArrayList(pendingCameraPromotionCallbacks)
            pendingCameraPromotionCallbacks.clear()
            list
        }

        val errCode = if (promotionException is SecurityException) "CAMERA_FGS_REJECTED" else "PROMOTION_FAILED"
        val errMsg = promotionException?.message

        mainHandler.post {
            callbacksToNotify.forEach { cb ->
                cb(promotionSuccess, if (promotionSuccess) null else errCode, errMsg)
            }
        }
    }

    private fun handleStopCamera() {
        var engineToStop: CameraCaptureEngine? = null

        synchronized(supervisorLock) {
            isCameraActive = false
            Log.i(TAG, "handleStopCamera: Camera marked inactive (storageActive=$isStorageActive)")

            // Cancel any in-flight promotion callbacks
            cameraPromotionTimeoutRunnable?.let { mainHandler.removeCallbacks(it) }
            cameraPromotionTimeoutRunnable = null
            if (isCameraPromotionInFlight) {
                isCameraPromotionInFlight = false
                val pending = ArrayList(pendingCameraPromotionCallbacks)
                pendingCameraPromotionCallbacks.clear()
                mainHandler.post {
                    pending.forEach { it(false, "OPERATION_CANCELLED", "Camera stop requested while promotion was pending") }
                }
            }

            engineToStop = activeCameraEngine
            activeCameraEngine = null

            if (!isStorageActive) {
                releaseWakeLock()
                releaseWifiLock()
            }
        }

        try {
            engineToStop?.stopCapture()
            engineToStop?.release()
        } catch (_: Exception) {}

        // Critical: Check if Storage is still active before stopping supervisor service!
        if (isStorageActive) {
            Log.i(TAG, "Camera stopped, but Storage remains active. Maintaining foreground service.")
            updateNotification()
        } else {
            stopSupervisorIfNoEngines()
        }
    }

    private fun handleStopAll() {
        handleStopStorage()
        handleStopCamera()
        stopSupervisorIfNoEngines()
    }

    // -------------------------------------------------------------------------
    // Supervisor Shutdown Arbitration
    // -------------------------------------------------------------------------

    private fun stopSupervisorIfNoEngines() {
        val (shouldStop, currentGen) = synchronized(supervisorLock) {
            if (!isStorageActive && !isCameraActive) {
                Pair(true, ++shutdownGeneration)
            } else {
                Pair(false, shutdownGeneration)
            }
        }

        if (shouldStop) {
            synchronized(supervisorLock) {
                if (isStorageActive || isCameraActive || shutdownGeneration != currentGen) {
                    Log.i(TAG, "stopSupervisorIfNoEngines: Aborted because a newer start request was received")
                    return
                }
            }
            Log.i(TAG, "Zero active engines remaining. Demoting foreground and stopping supervisor.")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE)
            } else {
                @Suppress("DEPRECATION")
                stopForeground(true)
            }
            stopSelf()
        }
    }

    // -------------------------------------------------------------------------
    // Foreground Service & Notification Management
    // -------------------------------------------------------------------------

    private fun promoteToForeground(notification: Notification) {
        try {
            val fgsType = calculateForegroundServiceType()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, fgsType)
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val legacyType = if ((fgsType and ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA) != 0) {
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
                } else {
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
                }
                ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, legacyType)
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            lastSupervisorError = "Failed to promote to foreground: ${e.message}"
            Log.e(TAG, "promoteToForeground error: ${e.message}")
        }
    }

    private fun calculateForegroundServiceType(): Int {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                if (isCameraActive) ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA else ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            } else 0
        }

        return computeForegroundServiceType(isStorageActive, isCameraActive)
    }

    private fun updateNotification() {
        val statusText = buildStatusText()
        val notif = buildNotification(statusText)
        promoteToForeground(notif)
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
        nm?.notify(NOTIFICATION_ID, notif)
    }

    private fun buildStatusText(): String {
        return when {
            isStorageActive && isCameraActive -> {
                "Storage & Camera active (Port $activePort)"
            }
            isStorageActive -> {
                val tunnelState = RemoteNodeTunnelManager.currentState
                when (tunnelState) {
                    RemoteNodeTunnelManager.STATE_CONNECTED -> "Personal file server on port $activePort | Gateway: Connected"
                    RemoteNodeTunnelManager.STATE_CONNECTING -> "Personal file server on port $activePort | Gateway: Connecting..."
                    RemoteNodeTunnelManager.STATE_AUTHENTICATING -> "Personal file server on port $activePort | Gateway: Authenticating..."
                    RemoteNodeTunnelManager.STATE_RECONNECTING -> "Personal file server on port $activePort | Gateway: Reconnecting..."
                    RemoteNodeTunnelManager.STATE_NETWORK_UNAVAILABLE -> "Personal file server on port $activePort | Waiting for network..."
                    RemoteNodeTunnelManager.STATE_AUTH_FAILED -> "ZdexCloud: Device Authorization Required"
                    else -> "Personal file server is running on port $activePort"
                }
            }
            isCameraActive -> {
                "Camera active (Local preview standby)"
            }
            else -> {
                "ZdexCloud background services idle"
            }
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

        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("ZdexCloud")
            .setContentText(statusText)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(openAppPendingIntent)
            .addAction(0, "Open App", openAppPendingIntent)

        // Engine-Specific Non-Destructive Actions
        if (isStorageActive) {
            val stopStorageIntent = Intent(this, PlatformSupervisorService::class.java).apply {
                action = ACTION_STOP_STORAGE
            }
            val stopStoragePending = PendingIntent.getService(
                this,
                11,
                stopStorageIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            builder.addAction(0, "Stop Storage", stopStoragePending)
        }

        if (isCameraActive) {
            val stopCameraIntent = Intent(this, PlatformSupervisorService::class.java).apply {
                action = ACTION_STOP_CAMERA
            }
            val stopCameraPending = PendingIntent.getService(
                this,
                12,
                stopCameraIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            builder.addAction(0, "Stop Camera", stopCameraPending)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
        }

        return builder.build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "ZdexCloud Background Services",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows ongoing status and controls for ZdexCloud Storage and Camera services"
                setShowBadge(false)
            }
            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    // -------------------------------------------------------------------------
    // Power & Connectivity Locks
    // -------------------------------------------------------------------------

    private fun acquireWakeLock() {
        if (wakeLock == null) {
            val powerManager = getSystemService(Context.POWER_SERVICE) as? PowerManager
            wakeLock = powerManager?.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "net.remotenode:supervisor_wakelock"
            )?.apply {
                setReferenceCounted(false)
            }
        }
        try {
            wakeLock?.acquire(24 * 60 * 60 * 1000L)
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
            wifiLock = wifiManager?.createWifiLock(mode, "net.remotenode:supervisor_wifi_lock")?.apply {
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
        if (!isStorageActive && !RemoteNodeServerService.getDesiredTunnelEnabled(this)) return
        try {
            val alarmManager = getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
            val intent = Intent(this, PlatformSupervisorService::class.java).apply {
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
            Log.w(TAG, "Failed to schedule keepalive alarm: ${e.message}")
        }
    }

    private fun cancelKeepAliveAlarm() {
        try {
            val alarmManager = getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
            val intent = Intent(this, PlatformSupervisorService::class.java).apply {
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
                        if (isStorageActive || isCameraActive) {
                            acquireWakeLock()
                            acquireWifiLock()
                            if (isStorageActive) {
                                RemoteNodeTunnelManager.triggerImmediateRecovery()
                                scheduleNextKeepAliveAlarm()
                            }
                        }
                    }
                    Intent.ACTION_SCREEN_OFF -> {
                        if (isStorageActive || isCameraActive) {
                            acquireWakeLock()
                            acquireWifiLock()
                            if (isStorageActive) {
                                RemoteNodeTunnelManager.checkAndPulseKeepalive()
                                scheduleNextKeepAliveAlarm()
                            }
                        }
                    }
                }
            }
        }
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_USER_PRESENT)
            addAction(Intent.ACTION_POWER_CONNECTED)
        }
        try {
            registerReceiver(receiver, filter)
            systemEventReceiver = receiver
        } catch (e: Exception) {
            Log.w(TAG, "Failed to register system event receiver: ${e.message}")
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

    override fun onDestroy() {
        super.onDestroy()
        RemoteNodeTunnelManager.removeListener(tunnelListener)
        unregisterSystemEventReceiver()
        cancelKeepAliveAlarm()
        releaseWifiLock()
        releaseWakeLock()

        val engineToClean: CameraCaptureEngine?
        synchronized(supervisorLock) {
            engineToClean = activeCameraEngine
            activeCameraEngine = null
            isCameraActive = false
            if (isStorageActive) {
                try {
                    RemoteNodeServerService.engine.stop()
                    RemoteNodeTunnelManager.stopTunnel()
                } catch (_: Exception) {}
                isStorageActive = false
            }
        }
        try {
            engineToClean?.stopCapture()
            engineToClean?.release()
        } catch (_: Exception) {}
        Log.i(TAG, "PlatformSupervisorService destroyed. Cleaned up all managed engines.")
    }
}
