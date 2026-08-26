package net.remotenode.fileserver

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
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
