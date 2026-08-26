package net.remotenode.fileserver

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
import java.util.Locale
import java.util.UUID

class MainActivity : FlutterActivity() {
    private val CHANNEL = "net.remotenode.fileserver/server_engine"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
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
                        val stat = StatFs(context.filesDir.absolutePath)
                        val availableBytes = stat.availableBytes
                        val totalBytes = stat.totalBytes
                        val minThreshold = 100L * 1024L * 1024L // 100MB minimum operational threshold
                        val lowThreshold = 500L * 1024L * 1024L // 500MB warning threshold
                        val isSufficient = availableBytes >= minThreshold
                        val isLow = availableBytes < lowThreshold
                        val availableGb = availableBytes.toDouble() / (1024.0 * 1024.0 * 1024.0)
                        val availableMb = (availableBytes / (1024L * 1024L)).toInt()
                        result.success(mapOf(
                            "availableBytes" to availableBytes,
                            "totalBytes" to totalBytes,
                            "isSufficient" to isSufficient,
                            "isLow" to isLow,
                            "availableMb" to availableMb,
                            "formattedAvailable" to String.format(Locale.US, "%.1f GB", availableGb)
                        ))
                    } catch (e: Exception) {
                        result.success(mapOf(
                            "availableBytes" to 1024L * 1024L * 1024L,
                            "totalBytes" to 10L * 1024L * 1024L * 1024L,
                            "isSufficient" to true,
                            "isLow" to false,
                            "availableMb" to 1024,
                            "formattedAvailable" to "1.0 GB"
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
                    val intent = Intent(context, RemoteNodeServerService::class.java).apply {
                        action = RemoteNodeServerService.ACTION_START_SERVER
                        putExtra(RemoteNodeServerService.EXTRA_PORT, port)
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
                    val res = RemoteNodeServerService.engine.stop()
                    result.success(res)
                }
                "restartServer" -> {
                    val port = call.argument<Int>("port") ?: 8080
                    val intent = Intent(context, RemoteNodeServerService::class.java).apply {
                        action = RemoteNodeServerService.ACTION_RESTART_SERVER
                        putExtra(RemoteNodeServerService.EXTRA_PORT, port)
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
                        ActivityCompat.requestPermissions(
                            this@MainActivity,
                            arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),
                            101
                        )
                        result.success(true)
                    } else {
                        result.success(true)
                    }
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
}
