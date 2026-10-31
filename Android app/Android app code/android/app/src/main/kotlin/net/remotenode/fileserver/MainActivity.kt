package net.remotenode.fileserver

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.StatFs
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugin.common.EventChannel
import net.remotenode.fileserver.security.AndroidSecureStorage
import java.io.File
import android.os.Environment
import android.provider.DocumentsContract
import java.util.Locale
import java.util.UUID

class MainActivity : FlutterActivity() {
    companion object {
        const val CHANNEL_GENERAL_ID = "remotenode_general"
        const val CHANNEL_CRITICAL_ID = "remotenode_critical"
        const val CHANNEL_SECURITY_ID = "remotenode_security"
    }

    private val CHANNEL = "net.remotenode.fileserver/server_engine"
    private val SECURE_STORAGE_CHANNEL = "net.remotenode.fileserver/secure_storage"
    private val NETWORK_EVENT_CHANNEL = "net.remotenode.fileserver/network_events"
    private val TUNNEL_EVENT_CHANNEL = "net.remotenode.fileserver/tunnel_events"
    private val REQUEST_POST_NOTIFICATIONS = 101
    private val REQUEST_PICK_FOLDER = 102
    private var pendingNotificationPermissionResult: MethodChannel.Result? = null
    private var pendingFolderPickerResult: MethodChannel.Result? = null
    private var networkEventSink: EventChannel.EventSink? = null
    private var tunnelEventSink: EventChannel.EventSink? = null
    private var tunnelListener: ((Map<String, Any?>) -> Unit)? = null

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        if (requestCode == REQUEST_POST_NOTIFICATIONS) {
            val granted = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
            pendingNotificationPermissionResult?.success(granted)
            pendingNotificationPermissionResult = null
            return
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == REQUEST_PICK_FOLDER) {
            if (resultCode == RESULT_OK && data != null && data.data != null) {
                val treeUri = data.data!!
                try {
                    contentResolver.takePersistableUriPermission(
                        treeUri,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                    )
                } catch (_: Exception) {}
                val resolvedPath = resolveTreeUriToPath(treeUri) ?: treeUri.toString()
                pendingFolderPickerResult?.success(resolvedPath)
            } else {
                pendingFolderPickerResult?.success(null)
            }
            pendingFolderPickerResult = null
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    private fun resolveTreeUriToPath(treeUri: Uri): String? {
        try {
            val docId = DocumentsContract.getTreeDocumentId(treeUri)
            val parts = docId.split(":")
            if (parts.size >= 2) {
                val volumeId = parts[0]
                val subPath = parts[1]
                if (volumeId.equals("primary", ignoreCase = true)) {
                    val root = Environment.getExternalStorageDirectory().absolutePath
                    val resolved = if (subPath.isNotEmpty()) "$root/$subPath" else root
                    File(resolved).apply { if (!exists()) mkdirs() }
                    return resolved
                } else {
                    val sdRoot = "/storage/$volumeId"
                    val resolved = if (subPath.isNotEmpty()) "$sdRoot/$subPath" else sdRoot
                    File(resolved).apply { if (!exists()) mkdirs() }
                    return resolved
                }
            }
        } catch (_: Exception) {}
        return null
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        registerNotificationChannels(context)

        NetworkWatcher.start(context)
        NetworkWatcher.addListener { event ->
            networkEventSink?.success(event)
        }

        EventChannel(flutterEngine.dartExecutor.binaryMessenger, NETWORK_EVENT_CHANNEL).setStreamHandler(
            object : EventChannel.StreamHandler {
                override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
                    networkEventSink = events
                    val current = NetworkWatcher.getCurrentNetworkInfo(context)
                    try {
                        events?.success(mapOf(
                            "type" to "INITIAL_STATE",
                            "networkId" to current["networkId"],
                            "transport" to current["transport"],
                            "hasInternet" to current["hasInternet"],
                            "isValidated" to current["isValidated"]
                        ))
                    } catch (_: Exception) {}
                }

                override fun onCancel(arguments: Any?) {
                    networkEventSink = null
                }
            }
        )

        EventChannel(flutterEngine.dartExecutor.binaryMessenger, TUNNEL_EVENT_CHANNEL).setStreamHandler(
            object : EventChannel.StreamHandler {
                override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
                    tunnelEventSink = events
                    val listener: (Map<String, Any?>) -> Unit = { ev ->
                        try {
                            tunnelEventSink?.success(ev)
                        } catch (_: Exception) {}
                    }
                    tunnelListener = listener
                    RemoteNodeTunnelManager.addListener(listener)
                    try {
                        val status = RemoteNodeTunnelManager.getStatus()
                        events?.success(mapOf(
                            "type" to "TUNNEL_STATE_CHANGED",
                            "state" to (status["state"] ?: RemoteNodeTunnelManager.currentState),
                            "connectionId" to status["connectionId"],
                            "remoteEndpoint" to status["remoteEndpoint"],
                            "hostname" to status["hostname"],
                            "publicUrl" to status["publicUrl"],
                            "errorMessage" to status["errorMessage"],
                            "generation" to status["generation"],
                            "lastHeartbeatAt" to status["lastHeartbeatAt"],
                            "timestamp" to System.currentTimeMillis()
                        ))
                    } catch (_: Exception) {}
                }

                override fun onCancel(arguments: Any?) {
                    tunnelListener?.let { RemoteNodeTunnelManager.removeListener(it) }
                    tunnelListener = null
                    tunnelEventSink = null
                }
            }
        )

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, SECURE_STORAGE_CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "saveSession" -> {
                    val sessionJson = call.argument<String>("sessionJson")
                    if (sessionJson != null) {
                        val ok = AndroidSecureStorage.saveSession(context, sessionJson)
                        result.success(ok)
                    } else {
                        result.error("INVALID_ARGS", "Missing sessionJson argument", null)
                    }
                }
                "getSession" -> {
                    val sessionJson = AndroidSecureStorage.getSession(context)
                    result.success(sessionJson)
                }
                "clearSession" -> {
                    val ok = AndroidSecureStorage.clearSession(context)
                    result.success(ok)
                }
                "writeKv" -> {
                    val key = call.argument<String>("key")
                    val value = call.argument<String>("value")
                    if (key != null && value != null) {
                        val ok = AndroidSecureStorage.writeKv(context, key, value)
                        result.success(ok)
                    } else {
                        result.error("INVALID_ARGS", "Missing key or value argument", null)
                    }
                }
                "readKv" -> {
                    val key = call.argument<String>("key")
                    if (key != null) {
                        val valStr = AndroidSecureStorage.readKv(context, key)
                        result.success(valStr)
                    } else {
                        result.error("INVALID_ARGS", "Missing key argument", null)
                    }
                }
                "deleteKv" -> {
                    val key = call.argument<String>("key")
                    if (key != null) {
                        val ok = AndroidSecureStorage.deleteKv(context, key)
                        result.success(ok)
                    } else {
                        result.error("INVALID_ARGS", "Missing key argument", null)
                    }
                }
                else -> result.notImplemented()
            }
        }

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "startTunnel" -> {
                    val deviceId = call.argument<String>("deviceId")
                    val sessionToken = call.argument<String>("sessionToken")
                    val apiBaseUrl = call.argument<String>("apiBaseUrl")
                    val gatewayWsUrl = call.argument<String>("gatewayWsUrl")
                    val deviceCredential = call.argument<String>("deviceCredential") ?: AndroidSecureStorage.readKv(context, "device_credential")

                    if (!deviceId.isNullOrEmpty() && !sessionToken.isNullOrEmpty() && !apiBaseUrl.isNullOrEmpty() && !gatewayWsUrl.isNullOrEmpty()) {
                        val intent = Intent(context, RemoteNodeServerService::class.java).apply {
                            action = RemoteNodeServerService.ACTION_START_TUNNEL
                            putExtra(RemoteNodeServerService.EXTRA_DEVICE_ID, deviceId)
                            putExtra(RemoteNodeServerService.EXTRA_SESSION_TOKEN, sessionToken)
                            putExtra(RemoteNodeServerService.EXTRA_API_BASE_URL, apiBaseUrl)
                            putExtra(RemoteNodeServerService.EXTRA_GATEWAY_WS_URL, gatewayWsUrl)
                            if (!deviceCredential.isNullOrEmpty()) {
                                putExtra(RemoteNodeServerService.EXTRA_DEVICE_CREDENTIAL, deviceCredential)
                            }
                        }
                        try {
                            ContextCompat.startForegroundService(context, intent)
                        } catch (_: Exception) {
                            RemoteNodeTunnelManager.startTunnel(context, deviceId, sessionToken, apiBaseUrl, gatewayWsUrl, deviceCredential)
                        }
                        result.success(RemoteNodeTunnelManager.getStatus())
                    } else {
                        result.error("INVALID_ARGS", "Missing tunnel parameters", null)
                    }
                }
                "stopTunnel" -> {
                    val intent = Intent(context, RemoteNodeServerService::class.java).apply {
                        action = RemoteNodeServerService.ACTION_STOP_TUNNEL
                    }
                    try {
                        context.startService(intent)
                    } catch (_: Exception) {
                        RemoteNodeTunnelManager.stopTunnel()
                    }
                    result.success(RemoteNodeTunnelManager.getStatus())
                }
                "getTunnelStatus" -> {
                    result.success(RemoteNodeTunnelManager.getStatus())
                }
                "reconnectTunnel" -> {
                    RemoteNodeTunnelManager.triggerReconnect(immediate = true)
                    result.success(true)
                }
                "getNetworkStatus" -> {
                    val status = NetworkWatcher.getCurrentNetworkInfo(context)
                    result.success(status)
                }
                "getInstallationId" -> {
                    try {
                        val prefs = context.getSharedPreferences("net.remotenode.device_identity", Context.MODE_PRIVATE)
                        var installationId = prefs.getString("installation_id", null)
                        if (installationId.isNullOrEmpty()) {
                            installationId = "inst-" + UUID.randomUUID().toString()
                            prefs.edit().putString("installation_id", installationId).apply()
                        }
                        result.success(installationId)
                    } catch (e: Exception) {
                        result.error("IDENTITY_ERROR", e.message, null)
                    }
                }
                "getFcmToken" -> {
                    try {
                        val prefs = context.getSharedPreferences("net.remotenode.device_identity", Context.MODE_PRIVATE)
                        val fcmToken = prefs.getString("fcm_token", null)
                        // Purge legacy synthetic UUID tokens that were mistakenly generated in earlier phases
                        if (fcmToken != null && fcmToken.startsWith("fcm_token_")) {
                            prefs.edit().remove("fcm_token").apply()
                            result.success(null)
                        } else {
                            result.success(fcmToken)
                        }
                    } catch (e: Exception) {
                        result.error("FCM_ERROR", e.message, null)
                    }
                }
                "updateFcmToken" -> {
                    try {
                        val token = call.argument<String>("token")
                        if (!token.isNullOrBlank()) {
                            val prefs = context.getSharedPreferences("net.remotenode.device_identity", Context.MODE_PRIVATE)
                            prefs.edit().putString("fcm_token", token.trim()).apply()
                            result.success(true)
                        } else {
                            result.error("INVALID_ARGS", "Token cannot be empty", null)
                        }
                    } catch (e: Exception) {
                        result.error("FCM_UPDATE_ERROR", e.message, null)
                    }
                }
                "deleteFcmToken" -> {
                    try {
                        val prefs = context.getSharedPreferences("net.remotenode.device_identity", Context.MODE_PRIVATE)
                        prefs.edit().remove("fcm_token").apply()
                        result.success(true)
                    } catch (e: Exception) {
                        result.error("FCM_DELETE_ERROR", e.message, null)
                    }
                }
                "getDeviceModel" -> {
                    try {
                        var customName: String? = null
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N_MR1) {
                            customName = android.provider.Settings.Global.getString(context.contentResolver, android.provider.Settings.Global.DEVICE_NAME)
                        }
                        if (customName.isNullOrBlank()) {
                            customName = android.provider.Settings.Secure.getString(context.contentResolver, "bluetooth_name")
                        }
                        if (!customName.isNullOrBlank()) {
                            result.success(customName.trim())
                        } else {
                            val manufacturer = Build.MANUFACTURER?.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.US) else it.toString() } ?: "Android"
                            val model = Build.MODEL ?: "Device"
                            val name = if (model.startsWith(manufacturer, ignoreCase = true)) model else "$manufacturer $model"
                            result.success(name.trim())
                        }
                    } catch (e: Exception) {
                        result.success("Android Device")
                    }
                }
                "getOsVersion" -> {
                    try {
                        val release = Build.VERSION.RELEASE ?: "14"
                        result.success(release)
                    } catch (e: Exception) {
                        result.success("14")
                    }
                }
                "getStorageReadiness" -> {
                    try {
                        val pathArg = call.argument<String>("path")
                        val persistedPath = RemoteNodeServerService.getPersistedStoragePath(context)
                        val candidatePath = if (!pathArg.isNullOrBlank()) pathArg else persistedPath
                        
                        var targetFile = if (!candidatePath.isNullOrBlank()) File(candidatePath) else null
                        if (targetFile == null || !targetFile.exists()) {
                            targetFile = Environment.getExternalStorageDirectory()
                        }
                        if (targetFile == null || !targetFile.exists()) {
                            targetFile = Environment.getDataDirectory()
                        }
                        if (targetFile == null || !targetFile.exists()) {
                            targetFile = context.filesDir
                        }

                        val stat = StatFs(targetFile.absolutePath)
                        var totalBytes = stat.totalBytes
                        var availableBytes = stat.availableBytes

                        if (totalBytes <= 0L) {
                            val dataStat = StatFs(Environment.getDataDirectory().absolutePath)
                            totalBytes = dataStat.totalBytes
                            availableBytes = dataStat.availableBytes
                        }

                        val usedBytes = if (totalBytes > availableBytes) (totalBytes - availableBytes) else 0L
                        val minThreshold = 100L * 1024L * 1024L // 100MB minimum operational threshold
                        val lowThreshold = 500L * 1024L * 1024L // 500MB warning threshold
                        val isSufficient = availableBytes >= minThreshold
                        val isLow = availableBytes < lowThreshold

                        val availableGb = availableBytes.toDouble() / (1024.0 * 1024.0 * 1024.0)
                        val usedGb = usedBytes.toDouble() / (1024.0 * 1024.0 * 1024.0)
                        val totalGb = totalBytes.toDouble() / (1024.0 * 1024.0 * 1024.0)

                        val availableMb = (availableBytes / (1024L * 1024L)).toInt()
                        val usedMb = (usedBytes / (1024L * 1024L)).toInt()
                        val totalMb = (totalBytes / (1024L * 1024L)).toInt()

                        fun formatBytes(bytes: Long): String {
                            val gb = bytes.toDouble() / (1024.0 * 1024.0 * 1024.0)
                            return if (gb >= 1.0) {
                                String.format(Locale.US, "%.1f GB", gb)
                            } else {
                                val mb = (bytes.toDouble() / (1024.0 * 1024.0)).toInt()
                                "$mb MB"
                            }
                        }

                        val usageRatio = if (totalBytes > 0L) {
                            (usedBytes.toDouble() / totalBytes.toDouble()).coerceIn(0.0, 1.0)
                        } else {
                            0.0
                        }

                        result.success(mapOf(
                            "availableBytes" to availableBytes,
                            "totalBytes" to totalBytes,
                            "usedBytes" to usedBytes,
                            "isSufficient" to isSufficient,
                            "isLow" to isLow,
                            "availableMb" to availableMb,
                            "usedMb" to usedMb,
                            "totalMb" to totalMb,
                            "availableGb" to availableGb,
                            "usedGb" to usedGb,
                            "totalGb" to totalGb,
                            "usageRatio" to usageRatio,
                            "formattedAvailable" to formatBytes(availableBytes),
                            "formattedUsed" to formatBytes(usedBytes),
                            "formattedTotal" to formatBytes(totalBytes)
                        ))
                    } catch (e: Exception) {
                        result.success(mapOf(
                            "availableBytes" to 40L * 1024L * 1024L * 1024L,
                            "totalBytes" to 64L * 1024L * 1024L * 1024L,
                            "usedBytes" to 24L * 1024L * 1024L * 1024L,
                            "isSufficient" to true,
                            "isLow" to false,
                            "availableMb" to 40960,
                            "usedMb" to 24576,
                            "totalMb" to 65536,
                            "availableGb" to 40.0,
                            "usedGb" to 24.0,
                            "totalGb" to 64.0,
                            "usageRatio" to 0.375,
                            "formattedAvailable" to "40.0 GB",
                            "formattedUsed" to "24.0 GB",
                            "formattedTotal" to "64.0 GB"
                        ))
                    }
                }
                "getPowerReadiness" -> {
                    try {
                        val batteryIntent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
                        val status = batteryIntent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
                        val isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
                        val level = batteryIntent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
                        val scale = batteryIntent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
                        val batteryPct = if (level >= 0 && scale > 0) (level * 100 / scale) else 100
                        result.success(mapOf(
                            "isCharging" to isCharging,
                            "batteryLevel" to batteryPct
                        ))
                    } catch (e: Exception) {
                        result.success(mapOf(
                            "isCharging" to true,
                            "batteryLevel" to 100
                        ))
                    }
                }
                "startServer" -> {
                    val port = call.argument<Int>("port") ?: 8080
                    val storagePath = call.argument<String>("storagePath")
                    val intent = Intent(context, RemoteNodeServerService::class.java).apply {
                        action = RemoteNodeServerService.ACTION_START_SERVER
                        putExtra(RemoteNodeServerService.EXTRA_PORT, port)
                        if (!storagePath.isNullOrBlank()) {
                            putExtra(RemoteNodeServerService.EXTRA_STORAGE_PATH, storagePath)
                        }
                    }
                    try {
                        ContextCompat.startForegroundService(context, intent)
                        val ip = RemoteNodeServerService.engine.getDeviceIpAddress()
                        result.success(mapOf(
                            "success" to true,
                            "port" to port,
                            "localUrl" to "http://$ip:$port",
                            "status" to "ONLINE",
                            "serviceRunning" to true
                        ))
                    } catch (e: Exception) {
                        result.error("START_SERVICE_FAILED", e.message, null)
                    }
                }
                "setCredentials" -> {
                    val username = call.argument<String>("username")
                    val password = call.argument<String>("password")
                    RemoteNodeServerService.engine.setCredentials(username, password)
                    val intent = Intent(context, RemoteNodeServerService::class.java).apply {
                        action = RemoteNodeServerService.ACTION_SET_CREDENTIALS
                        putExtra(RemoteNodeServerService.EXTRA_USERNAME, username)
                        putExtra(RemoteNodeServerService.EXTRA_PASSWORD, password)
                    }
                    try {
                        context.startService(intent)
                    } catch (_: Exception) {}
                    result.success(true)
                }
                "stopServer" -> {
                    val intent = Intent(context, RemoteNodeServerService::class.java).apply {
                        action = RemoteNodeServerService.ACTION_STOP_SERVER
                    }
                    try {
                        context.startService(intent)
                    } catch (_: Exception) {}
                    RemoteNodeTunnelManager.stopTunnel()
                    val res = RemoteNodeServerService.engine.stop()
                    result.success(res)
                }
                "purgeStorageFiles" -> {
                    try {
                        val count = RemoteNodeServerService.purgeStorageFolder(context)
                        result.success(mapOf(
                            "success" to true,
                            "deletedCount" to count
                        ))
                    } catch (e: Exception) {
                        result.error("PURGE_FAILED", e.message, null)
                    }
                }
                "restartServer" -> {
                    val port = call.argument<Int>("port") ?: 8080
                    val storagePath = call.argument<String>("storagePath")
                    val intent = Intent(context, RemoteNodeServerService::class.java).apply {
                        action = RemoteNodeServerService.ACTION_RESTART_SERVER
                        putExtra(RemoteNodeServerService.EXTRA_PORT, port)
                        if (!storagePath.isNullOrBlank()) {
                            putExtra(RemoteNodeServerService.EXTRA_STORAGE_PATH, storagePath)
                        }
                    }
                    try {
                        ContextCompat.startForegroundService(context, intent)
                        val ip = RemoteNodeServerService.engine.getDeviceIpAddress()
                        result.success(mapOf(
                            "success" to true,
                            "port" to port,
                            "localUrl" to "http://$ip:$port",
                            "status" to "ONLINE",
                            "serviceRunning" to true
                        ))
                    } catch (e: Exception) {
                        result.error("RESTART_SERVICE_FAILED", e.message, null)
                    }
                }
                "getDefaultStoragePath" -> {
                    try {
                        val defaultDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                        if (!defaultDir.exists()) {
                            defaultDir.mkdirs()
                        }
                        result.success(defaultDir.absolutePath)
                    } catch (e: Exception) {
                        result.success("/storage/emulated/0/Download")
                    }
                }
                "getAvailableStorageLocations" -> {
                    val locations = mutableListOf<Map<String, Any>>()
                    try {
                        val downloadDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                        if (!downloadDir.exists()) downloadDir.mkdirs()
                        locations.add(mapOf(
                            "name" to "Download Folder (Default)",
                            "path" to downloadDir.absolutePath,
                            "type" to "download",
                            "isDefault" to true,
                            "exists" to downloadDir.exists()
                        ))
                    } catch (_: Exception) {}

                    try {
                        val documentsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS)
                        if (!documentsDir.exists()) documentsDir.mkdirs()
                        locations.add(mapOf(
                            "name" to "Documents Folder",
                            "path" to documentsDir.absolutePath,
                            "type" to "documents",
                            "isDefault" to false,
                            "exists" to documentsDir.exists()
                        ))
                    } catch (_: Exception) {}

                    try {
                        val dcimDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DCIM)
                        if (dcimDir.exists()) {
                            locations.add(mapOf(
                                "name" to "DCIM / Photos Folder",
                                "path" to dcimDir.absolutePath,
                                "type" to "media",
                                "isDefault" to false,
                                "exists" to true
                            ))
                        }
                    } catch (_: Exception) {}

                    // Removable SD cards / USB storage detection
                    try {
                        val externalDirs = ContextCompat.getExternalFilesDirs(context, null)
                        for (file in externalDirs) {
                            if (file != null) {
                                val isRemovable = Environment.isExternalStorageRemovable(file)
                                val path = file.absolutePath
                                if (isRemovable || !path.contains("emulated/0")) {
                                    val rootIdx = path.indexOf("/Android/data")
                                    val rootPath = if (rootIdx != -1) path.substring(0, rootIdx) else path
                                    val volumeName = rootPath.substringAfterLast("/")
                                    val exists = File(rootPath).exists()
                                    locations.add(mapOf(
                                        "name" to "SD Card / Drive ($volumeName)",
                                        "path" to rootPath,
                                        "type" to "sdcard",
                                        "isDefault" to false,
                                        "exists" to exists
                                    ))
                                }
                            }
                        }
                    } catch (_: Exception) {}

                    result.success(locations)
                }
                "pickStorageFolder" -> {
                    try {
                        pendingFolderPickerResult = result
                        val pickIntent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
                            addFlags(
                                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                                Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                                Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
                                Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
                            )
                        }
                        startActivityForResult(pickIntent, REQUEST_PICK_FOLDER)
                    } catch (e: Exception) {
                        pendingFolderPickerResult = null
                        result.error("PICK_FOLDER_ERROR", e.message, null)
                    }
                }
                "setStoragePath" -> {
                    val path = call.argument<String>("path")
                    if (!path.isNullOrBlank()) {
                        RemoteNodeServerService.persistStoragePath(context, path)
                        result.success(true)
                    } else {
                        result.error("INVALID_ARGS", "Path cannot be empty", null)
                    }
                }
                "getStoragePath" -> {
                    val path = RemoteNodeServerService.getPersistedStoragePath(context)
                    result.success(path)
                }
                "getServerStatus" -> {
                    val engineStatus = RemoteNodeServerService.engine.getStatus()
                    val isRunning = RemoteNodeServerService.isServiceRunning || (engineStatus["status"] == "ONLINE")
                    val mergedStatus = HashMap(engineStatus).apply {
                        put("serviceRunning", isRunning)
                        put("desiredEnabled", RemoteNodeServerService.getDesiredServerEnabled(context))
                        put("serverState", RemoteNodeServerService.currentServerState)
                    }
                    result.success(mergedStatus)
                }
                "getLocalUrl" -> {
                    val url = RemoteNodeServerService.engine.getLocalUrl()
                    result.success(url)
                }
                "isServiceRunning" -> {
                    val isRunning = RemoteNodeServerService.isServiceRunning
                    result.success(isRunning)
                }
                "isNotificationPermissionGranted" -> {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        val granted = ContextCompat.checkSelfPermission(
                            this@MainActivity,
                            android.Manifest.permission.POST_NOTIFICATIONS
                        ) == PackageManager.PERMISSION_GRANTED
                        result.success(granted)
                    } else {
                        result.success(true)
                    }
                }
                "requestNotificationPermission" -> {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        val isGranted = ContextCompat.checkSelfPermission(
                            this@MainActivity,
                            android.Manifest.permission.POST_NOTIFICATIONS
                        ) == PackageManager.PERMISSION_GRANTED
                        if (isGranted) {
                            result.success(true)
                        } else {
                            pendingNotificationPermissionResult = result
                            ActivityCompat.requestPermissions(
                                this@MainActivity,
                                arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),
                                REQUEST_POST_NOTIFICATIONS
                            )
                        }
                    } else {
                        result.success(true)
                    }
                }
                "checkNotificationPermissionRationale" -> {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        val shouldShow = ActivityCompat.shouldShowRequestPermissionRationale(
                            this@MainActivity,
                            android.Manifest.permission.POST_NOTIFICATIONS
                        )
                        result.success(shouldShow)
                    } else {
                        result.success(false)
                    }
                }
                "getInitialNotification" -> {
                    val payload = extractNotificationPayload(intent)
                    intent?.removeExtra("deepLink")
                    intent?.removeExtra("deepLinkUri")
                    intent?.removeExtra("notificationId")
                    result.success(payload)
                }
                "openNotificationSettings" -> {
                    try {
                        val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                            Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                                putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, context.packageName)
                            }
                        } else {
                            Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                                data = Uri.parse("package:" + context.packageName)
                            }
                        }
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        context.startActivity(intent)
                        result.success(true)
                    } catch (e: Exception) {
                        result.error("NOTIFICATION_SETTINGS_ERROR", e.message, null)
                    }
                }
                "isBatteryOptimizationIgnored" -> {
                    val ignored = BatteryOptimizationHelper.isIgnoringBatteryOptimizations(context)
                    result.success(ignored)
                }
                "requestIgnoreBatteryOptimization" -> {
                    try {
                        val optIntent = BatteryOptimizationHelper.createRequestIgnoreBatteryOptimizationIntent(context)
                        context.startActivity(optIntent)
                        result.success(true)
                    } catch (e: Exception) {
                        result.error("BATTERY_OPT_ERROR", e.message, null)
                    }
                }
                "openUrl" -> {
                    val url = call.argument<String>("url")
                    if (url != null) {
                        try {
                            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            context.startActivity(intent)
                            result.success(true)
                        } catch (e: Exception) {
                            result.error("OPEN_URL_FAILED", e.message, null)
                        }
                    } else {
                        result.error("INVALID_URL", "URL string cannot be null", null)
                    }
                }
                else -> {
                    result.notImplemented()
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val payload = extractNotificationPayload(intent)
        if (payload != null) {
            flutterEngine?.dartExecutor?.binaryMessenger?.let { messenger ->
                MethodChannel(messenger, CHANNEL).invokeMethod("onNotificationTap", payload)
            }
        }
    }

    private fun extractNotificationPayload(intent: Intent?): Map<String, Any?>? {
        if (intent == null) return null
        val extras = intent.extras ?: return null

        val deepLink = extras.getString("deepLink") ?: extras.getString("deepLinkUri")
        val notificationId = extras.getString("notificationId")
        val category = extras.getString("category")
        val severity = extras.getString("severity")
        val serverId = extras.getString("serverId")
        val deviceId = extras.getString("deviceId")
        val title = extras.getString("title")
        val body = extras.getString("body")

        if (deepLink == null && notificationId == null && serverId == null) {
            return null
        }

        val map = HashMap<String, Any?>()
        deepLink?.let { map["deepLink"] = it }
        notificationId?.let { map["notificationId"] = it }
        category?.let { map["category"] = it }
        severity?.let { map["severity"] = it }
        serverId?.let { map["serverId"] = it }
        deviceId?.let { map["deviceId"] = it }
        title?.let { map["title"] = it }
        body?.let { map["body"] = it }
        return map
    }

    private fun registerNotificationChannels(ctx: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val notificationManager = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
                ?: return

            // 1. General notifications (Server status, storage alerts, updates)
            val generalChannel = NotificationChannel(
                CHANNEL_GENERAL_ID,
                "General RemoteNode Notifications",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "Server status, storage alerts, and operational updates"
                enableLights(true)
            }

            // 2. Critical alerts (Offline, outage, storage critical)
            val criticalChannel = NotificationChannel(
                CHANNEL_CRITICAL_ID,
                "Critical System Alerts",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "High-priority server offline, outage, and storage critical alerts"
                enableLights(true)
                enableVibration(true)
            }

            // 3. Security alerts (Login, device linking, security events)
            val securityChannel = NotificationChannel(
                CHANNEL_SECURITY_ID,
                "Account & Security Alerts",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Login alerts, device linking, and mandatory security notifications"
                enableLights(true)
                enableVibration(true)
            }

            notificationManager.createNotificationChannel(generalChannel)
            notificationManager.createNotificationChannel(criticalChannel)
            notificationManager.createNotificationChannel(securityChannel)
        }
    }

    override fun cleanUpFlutterEngine(flutterEngine: FlutterEngine) {
        android.util.Log.i("MainActivity", "[UI_DISCONNECT] source=flutter_activity_teardown action=detach_only persistentServerPreserved=true")
        tunnelListener?.let { RemoteNodeTunnelManager.removeListener(it) }
        tunnelListener = null
        tunnelEventSink = null
        networkEventSink = null
        super.cleanUpFlutterEngine(flutterEngine)
    }
}
