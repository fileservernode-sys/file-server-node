package net.remotenode.remote_node_app

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpHandler
import com.sun.net.httpserver.HttpServer
import java.io.File
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.URLDecoder
import java.nio.charset.StandardCharsets

/**
 * Embedded Local HTTP Server Engine for RemoteNode Android File Host
 * Listens strictly on loopback interface 127.0.0.1:8080
 */
class LocalServerEngine {
    private var server: HttpServer? = null
    private var isRunning: Boolean = false
    private var activePort: Int = 8080
    private var rootDirectory: File? = null

    fun start(port: Int = 8080, baseStorageDir: File? = null): Map<String, Any> {
        if (isRunning && server != null) {
            return mapOf(
                "success" to true,
                "port" to activePort,
                "localUrl" to "http://127.0.0.1:$activePort"
            )
        }

        return try {
            activePort = port
            val sandboxDir = baseStorageDir ?: File(System.getProperty("java.io.tmpdir"), "RemoteNodeFiles")
            if (!sandboxDir.exists()) {
                sandboxDir.mkdirs()
            }
            rootDirectory = sandboxDir

            val address = InetSocketAddress("127.0.0.1", activePort)
            val newServer = HttpServer.create(address, 0)

            // Health check endpoint
            newServer.createContext("/api/health", HealthHandler())

            // Local File Management API Contexts
            newServer.createContext("/api/files", FileListAndDeleteHandler(sandboxDir))
            newServer.createContext("/api/folders", CreateFolderHandler(sandboxDir))
            newServer.createContext("/api/rename", RenameHandler(sandboxDir))
            newServer.createContext("/api/download", DownloadHandler(sandboxDir))
            newServer.createContext("/api/upload", UploadHandler(sandboxDir))
            newServer.createContext("/api/auth/login", AuthHandler())

            // Static bundled website assets handler
            newServer.createContext("/", StaticAssetsHandler())

            newServer.executor = null
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

    /**
     * Filesystem Sandbox Helper — Rejects Path Traversal Attempts
     */
    companion object {
        fun resolveSandboxPath(rootDir: File, relPath: String): File {
            if (relPath.contains("\u0000") || relPath.contains("..")) {
                throw SecurityException("Path traversal or null-byte injection rejected.")
            }

            val decodedPath = URLDecoder.decode(relPath, StandardCharsets.UTF_8.name())
            val targetFile = File(rootDir, decodedPath).canonicalFile
            val canonicalRoot = rootDir.canonicalFile

            if (!targetFile.path.startsWith(canonicalRoot.path)) {
                throw SecurityException("Access denied: Resolved path escape outside sandbox root.")
            }
            return targetFile
        }

        fun sendJsonResponse(exchange: HttpExchange, statusCode: Int, json: String) {
            val bytes = json.toByteArray(StandardCharsets.UTF_8)
            exchange.responseHeaders.set("Content-Type", "application/json; charset=UTF-8")
            exchange.sendResponseHeaders(statusCode, bytes.size.toLong())
            val os: OutputStream = exchange.responseBody
            os.write(bytes)
            os.close()
        }
    }

    private class HealthHandler : HttpHandler {
        override fun handle(exchange: HttpExchange) {
            sendJsonResponse(exchange, 200, """{"status":"ok","server":"remote-node-file-server"}""")
        }
    }

    private class AuthHandler : HttpHandler {
        override fun handle(exchange: HttpExchange) {
            sendJsonResponse(exchange, 200, """{"success":true,"data":{"token":"file-server-local-token-xyz"}}""")
        }
    }

    private class FileListAndDeleteHandler(private val rootDir: File) : HttpHandler {
        override fun handle(exchange: HttpExchange) {
            try {
                if (exchange.requestMethod == "GET") {
                    val query = exchange.requestURI.rawQuery ?: ""
                    var reqPath = "/"
                    for (param in query.split("&")) {
                        val pair = param.split("=")
                        if (pair.size == 2 && pair[0] == "path") {
                            reqPath = pair[1]
                        }
                    }

                    val targetDir = resolveSandboxPath(rootDir, reqPath)
                    if (!targetDir.exists() || !targetDir.isDirectory) {
                        sendJsonResponse(exchange, 404, """{"success":false,"error":{"code":"DIRECTORY_NOT_FOUND","message":"Directory does not exist."}}""")
                        return
                    }

                    val items = targetDir.listFiles()?.map { file ->
                        val name = file.name
                        val isDir = file.isDirectory
                        val sizeBytes = if (isDir) 0L else file.length()
                        val relPath = file.canonicalPath.substringAfter(rootDir.canonicalPath).replace("\\", "/")
                        """{"name":"$name","isDir":$isDir,"sizeBytes":$sizeBytes,"path":"${if (relPath.isEmpty()) "/" else relPath}"}"""
                    }?.joinToString(",") ?: ""

                    sendJsonResponse(exchange, 200, """{"success":true,"data":{"items":[$items]}}""")
                } else if (exchange.requestMethod == "DELETE") {
                    val body = exchange.requestBody.bufferedReader().readText()
                    val pathValue = body.substringAfter("\"path\":\"").substringBefore("\"")
                    val targetFile = resolveSandboxPath(rootDir, pathValue)

                    if (targetFile.canonicalPath == rootDir.canonicalPath) {
                        sendJsonResponse(exchange, 400, """{"success":false,"error":{"code":"ROOT_DELETE_FORBIDDEN","message":"Cannot delete root directory."}}""")
                        return
                    }

                    if (!targetFile.exists()) {
                        sendJsonResponse(exchange, 404, """{"success":false,"error":{"code":"FILE_NOT_FOUND","message":"Item not found."}}""")
                        return
                    }

                    val deleted = targetFile.deleteRecursively()
                    if (deleted) {
                        sendJsonResponse(exchange, 200, """{"success":true,"data":{}}""")
                    } else {
                        sendJsonResponse(exchange, 500, """{"success":false,"error":{"code":"DELETE_FAILED","message":"Failed to delete file."}}""")
                    }
                }
            } catch (e: SecurityException) {
                sendJsonResponse(exchange, 403, """{"success":false,"error":{"code":"PATH_TRAVERSAL_REJECTED","message":"Path traversal attempt rejected."}}""")
            } catch (e: Exception) {
                sendJsonResponse(exchange, 500, """{"success":false,"error":{"code":"SERVER_ERROR","message":"${e.message}"}}""")
            }
        }
    }

    private class CreateFolderHandler(private val rootDir: File) : HttpHandler {
        override fun handle(exchange: HttpExchange) {
            try {
                val body = exchange.requestBody.bufferedReader().readText()
                val parentPath = body.substringAfter("\"path\":\"").substringBefore("\"")
                val folderName = body.substringAfter("\"name\":\"").substringBefore("\"")

                val targetParent = resolveSandboxPath(rootDir, parentPath)
                val newFolder = File(targetParent, folderName)
                resolveSandboxPath(rootDir, newFolder.canonicalPath.substringAfter(rootDir.canonicalPath))

                if (newFolder.exists()) {
                    sendJsonResponse(exchange, 400, """{"success":false,"error":{"code":"FOLDER_EXISTS","message":"Folder already exists."}}""")
                    return
                }

                val created = newFolder.mkdirs()
                if (created) {
                    sendJsonResponse(exchange, 200, """{"success":true,"data":{}}""")
                } else {
                    sendJsonResponse(exchange, 500, """{"success":false,"error":{"code":"CREATE_FAILED","message":"Failed to create folder."}}""")
                }
            } catch (e: SecurityException) {
                sendJsonResponse(exchange, 403, """{"success":false,"error":{"code":"PATH_TRAVERSAL_REJECTED","message":"Path traversal attempt rejected."}}""")
            } catch (e: Exception) {
                sendJsonResponse(exchange, 500, """{"success":false,"error":{"code":"SERVER_ERROR","message":"${e.message}"}}""")
            }
        }
    }

    private class RenameHandler(private val rootDir: File) : HttpHandler {
        override fun handle(exchange: HttpExchange) {
            try {
                val body = exchange.requestBody.bufferedReader().readText()
                val oldPath = body.substringAfter("\"oldPath\":\"").substringBefore("\"")
                val newName = body.substringAfter("\"newName\":\"").substringBefore("\"")

                val targetFile = resolveSandboxPath(rootDir, oldPath)
                val newFile = File(targetFile.parentFile, newName)
                resolveSandboxPath(rootDir, newFile.canonicalPath.substringAfter(rootDir.canonicalPath))

                val renamed = targetFile.renameTo(newFile)
                if (renamed) {
                    sendJsonResponse(exchange, 200, """{"success":true,"data":{}}""")
                } else {
                    sendJsonResponse(exchange, 500, """{"success":false,"error":{"code":"RENAME_FAILED","message":"Failed to rename item."}}""")
                }
            } catch (e: SecurityException) {
                sendJsonResponse(exchange, 403, """{"success":false,"error":{"code":"PATH_TRAVERSAL_REJECTED","message":"Path traversal attempt rejected."}}""")
            } catch (e: Exception) {
                sendJsonResponse(exchange, 500, """{"success":false,"error":{"code":"SERVER_ERROR","message":"${e.message}"}}""")
            }
        }
    }

    private class DownloadHandler(private val rootDir: File) : HttpHandler {
        override fun handle(exchange: HttpExchange) {
            try {
                val query = exchange.requestURI.rawQuery ?: ""
                var reqPath = "/"
                for (param in query.split("&")) {
                    val pair = param.split("=")
                    if (pair.size == 2 && pair[0] == "path") {
                        reqPath = pair[1]
                    }
                }

                val targetFile = resolveSandboxPath(rootDir, reqPath)
                if (!targetFile.exists() || targetFile.isDirectory) {
                    sendJsonResponse(exchange, 404, """{"success":false,"error":{"code":"FILE_NOT_FOUND","message":"File not found."}}""")
                    return
                }

                exchange.responseHeaders.set("Content-Type", "application/octet-stream")
                exchange.responseHeaders.set("Content-Disposition", "attachment; filename=\"${targetFile.name}\"")
                exchange.sendResponseHeaders(200, targetFile.length())
                val os: OutputStream = exchange.responseBody
                targetFile.inputStream().use { input -> input.copyTo(os) }
                os.close()
            } catch (e: SecurityException) {
                sendJsonResponse(exchange, 403, """{"success":false,"error":{"code":"PATH_TRAVERSAL_REJECTED","message":"Path traversal attempt rejected."}}""")
            } catch (e: Exception) {
                sendJsonResponse(exchange, 500, """{"success":false,"error":{"code":"SERVER_ERROR","message":"${e.message}"}}""")
            }
        }
    }

    private class UploadHandler(private val rootDir: File) : HttpHandler {
        override fun handle(exchange: HttpExchange) {
            try {
                val query = exchange.requestURI.rawQuery ?: ""
                var reqPath = "/"
                for (param in query.split("&")) {
                    val pair = param.split("=")
                    if (pair.size == 2 && pair[0] == "path") {
                        reqPath = pair[1]
                    }
                }

                val targetDir = resolveSandboxPath(rootDir, reqPath)
                if (!targetDir.exists()) targetDir.mkdirs()

                val newFile = File(targetDir, "upload_${System.currentTimeMillis()}.dat")
                val os = newFile.outputStream()
                exchange.requestBody.copyTo(os)
                os.close()

                sendJsonResponse(exchange, 200, """{"success":true,"data":{"filename":"${newFile.name}"}}""")
            } catch (e: SecurityException) {
                sendJsonResponse(exchange, 403, """{"success":false,"error":{"code":"PATH_TRAVERSAL_REJECTED","message":"Path traversal attempt rejected."}}""")
            } catch (e: Exception) {
                sendJsonResponse(exchange, 500, """{"success":false,"error":{"code":"SERVER_ERROR","message":"${e.message}"}}""")
            }
        }
    }

    private class StaticAssetsHandler : HttpHandler {
        override fun handle(exchange: HttpExchange) {
            val path = exchange.requestURI.path
            if (path.startsWith("/api/")) {
                sendJsonResponse(exchange, 404, """{"success":false,"error":{"code":"NOT_FOUND","message":"API route not found."}}""")
                return
            }

            val html = """
                <!DOCTYPE html>
                <html lang="en">
                <head>
                  <meta charset="UTF-8">
                  <meta name="viewport" content="width=device-width, initial-scale=1.0">
                  <title>File Manager | RemoteNode</title>
                  <style>
                    body { font-family: sans-serif; background: #FAFAFC; color: #0F172A; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 1rem; }
                    .card { background: #FFFFFF; border-radius: 12px; padding: 2rem; max-width: 480px; text-align: center; border: 1px solid #E2E8F0; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
                    .badge { color: #059669; background: #ECFDF5; padding: 4px 12px; border-radius: 99px; font-size: 0.85rem; font-weight: bold; }
                    h1 { margin-top: 1rem; font-size: 1.5rem; color: #2563EB; }
                    p { color: #475569; font-size: 0.9rem; margin-top: 0.5rem; }
                  </style>
                </head>
                <body>
                  <div class="card">
                    <span class="badge">LOCAL SERVER ONLINE</span>
                    <h1>RemoteNode File Manager</h1>
                    <p>Bundled Android File Manager running successfully at 127.0.0.1:8080.</p>
                  </div>
                </body>
                </html>
            """.trimIndent()

            exchange.responseHeaders.set("Content-Type", "text/html; charset=UTF-8")
            exchange.sendResponseHeaders(200, html.toByteArray(StandardCharsets.UTF_8).size.toLong())
            val os: OutputStream = exchange.responseBody
            os.write(html.toByteArray(StandardCharsets.UTF_8))
            os.close()
        }
    }
}
