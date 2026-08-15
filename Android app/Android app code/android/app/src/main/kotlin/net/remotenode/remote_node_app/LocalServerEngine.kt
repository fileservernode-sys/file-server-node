package net.remotenode.remote_node_app

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpHandler
import com.sun.net.httpserver.HttpServer
import java.io.OutputStream
import java.net.InetSocketAddress

/**
 * Embedded Local HTTP Server Engine for RemoteNode Android File Host
 */
class LocalServerEngine {
    private var server: HttpServer? = null
    private var isRunning: Boolean = false
    private var activePort: Int = 8080

    fun start(port: Int = 8080): Map<String, Any> {
        if (isRunning && server != null) {
            return mapOf(
                "success" to true,
                "port" to activePort,
                "localUrl" to "http://127.0.0.1:$activePort"
            )
        }

        return try {
            activePort = port
            val address = InetSocketAddress("127.0.0.1", activePort)
            val newServer = HttpServer.create(address, 0)

            // Health check endpoint
            newServer.createContext("/api/health", HealthHandler())

            // Static bundled website / test page handler
            newServer.createContext("/", RootHandler())

            newServer.executor = null // Creates a default executor
            newServer.start()

            server = newServer
            isRunning = true

            mapOf(
                "success" to true,
                "port" to activePort,
                "localUrl" to "http://127.0.0.1:$activePort"
            )
        } catch (e: Exception) {
            isRunning = false
            server = null
            mapOf(
                "success" to false,
                "error" to (e.message ?: "Failed to bind local HTTP server port")
            )
        }
    }

    fun stop(): Map<String, Any> {
        return try {
            server?.stop(0)
            server = null
            isRunning = false
            mapOf("success" to true)
        } catch (e: Exception) {
            mapOf("success" to false, "error" to (e.message ?: "Failed to stop local server"))
        }
    }

    fun restart(port: Int = 8080): Map<String, Any> {
        stop()
        return start(port)
    }

    fun getStatus(): Map<String, Any> {
        return mapOf(
            "status" to if (isRunning) "ONLINE" else "STOPPED",
            "port" to activePort,
            "localUrl" to "http://127.0.0.1:$activePort"
        )
    }

    fun getLocalUrl(): String {
        return "http://127.0.0.1:$activePort"
    }

    private class HealthHandler : HttpHandler {
        override fun handle(exchange: HttpExchange) {
            val response = """{"status":"ok","server":"remote-node-file-server"}"""
            exchange.responseHeaders.set("Content-Type", "application/json")
            exchange.sendResponseHeaders(200, response.toByteArray().size.toLong())
            val os: OutputStream = exchange.responseBody
            os.write(response.toByteArray())
            os.close()
        }
    }

    private class RootHandler : HttpHandler {
        override fun handle(exchange: HttpExchange) {
            val html = """
                <!DOCTYPE html>
                <html lang="en">
                <head>
                  <meta charset="UTF-8">
                  <meta name="viewport" content="width=device-width, initial-scale=1.0">
                  <title>RemoteNode Local File Server</title>
                  <style>
                    body { font-family: sans-serif; background: #0F172A; color: #FAFAFC; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 1rem; }
                    .card { background: #1E293B; border-radius: 12px; padding: 2rem; max-width: 440px; text-align: center; border: 1px solid rgba(255,255,255,0.1); }
                    .badge { color: #10B981; background: rgba(16,185,129,0.15); padding: 4px 12px; border-radius: 99px; font-size: 0.85rem; font-weight: bold; }
                    h1 { margin-top: 1rem; font-size: 1.5rem; }
                    p { color: #94A3B8; font-size: 0.9rem; margin-top: 0.5rem; }
                  </style>
                </head>
                <body>
                  <div class="card">
                    <span class="badge">LOCAL SERVER ONLINE</span>
                    <h1>RemoteNode File Server</h1>
                    <p>Local server engine is running successfully on your Android device host.</p>
                  </div>
                </body>
                </html>
            """.trimIndent()

            exchange.responseHeaders.set("Content-Type", "text/html; charset=UTF-8")
            exchange.sendResponseHeaders(200, html.toByteArray().size.toLong())
            val os: OutputStream = exchange.responseBody
            os.write(html.toByteArray())
            os.close()
        }
    }
}
