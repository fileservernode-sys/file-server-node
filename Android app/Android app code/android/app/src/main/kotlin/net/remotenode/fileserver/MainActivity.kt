package net.remotenode.fileserver

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private val CHANNEL = "net.remotenode.fileserver/server_engine"
    private val localServerEngine = LocalServerEngine()

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
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
                    val res = localServerEngine.restart(port)
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
                            val intent = android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url))
                            intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
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
