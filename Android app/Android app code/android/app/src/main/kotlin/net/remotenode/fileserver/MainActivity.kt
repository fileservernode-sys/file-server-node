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
                    val res = localServerEngine.start(port, storageDir)
                    result.success(res)
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
                else -> {
                    result.notImplemented()
                }
            }
        }
    }
}
