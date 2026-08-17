package net.remotenode.fileserver

import android.content.Context
import android.content.Intent
import android.net.Uri
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.util.UUID

class MainActivity : FlutterActivity() {
    private val CHANNEL = "net.remotenode.fileserver/server_engine"
    private val localServerEngine = LocalServerEngine()

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
                    val storageDir = context.filesDir.resolve("RemoteNodeFiles")
                    val res = localServerEngine.start(port, storageDir, context)
                    result.success(res)
                }
                "setCredentials" -> {
                    val username = call.argument<String>("username")
                    val password = call.argument<String>("password")
                    localServerEngine.setCredentials(username, password)
                    result.success(true)
                }
                "stopServer" -> {
                    val res = localServerEngine.stop()
                    result.success(res)
                }
                "restartServer" -> {
                    val port = call.argument<Int>("port") ?: 8080
                    val storageDir = context.filesDir.resolve("RemoteNodeFiles")
                    val res = localServerEngine.restart(port, storageDir, context)
                    result.success(res)
                }
                "getServerStatus" -> {
                    val res = localServerEngine.getStatus()
                    result.success(res)
                }
                "getLocalUrl" -> {
                    val url = localServerEngine.getLocalUrl()
                    result.success(url)
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
