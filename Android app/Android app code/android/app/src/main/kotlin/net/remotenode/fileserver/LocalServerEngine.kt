package net.remotenode.fileserver

import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

// -----------------------------------------------------------------------------
// Pure Java/Android-Compatible Embedded HTTP Server Abstractions
// (Replaces non-Android com.sun.net.httpserver.* packages)
// -----------------------------------------------------------------------------

class HttpHeaders {
    private val headers = mutableMapOf<String, String>()

    fun set(key: String, value: String) {
        headers[key.lowercase(Locale.ROOT)] = value
    }

    fun getFirst(key: String): String? {
        return headers[key.lowercase(Locale.ROOT)]
    }

    fun getAll(): Map<String, String> = headers
}

class HttpExchange(
    val requestMethod: String,
    val requestURI: URI,
    val requestHeaders: HttpHeaders,
    val responseHeaders: HttpHeaders,
    val requestBody: InputStream,
    val responseBody: OutputStream,
    private val sendHeaderCallback: (Int, Long) -> Unit
) {
    fun sendResponseHeaders(rCode: Int, responseLength: Long) {
        sendHeaderCallback(rCode, responseLength)
    }
}

interface HttpHandler {
    fun handle(exchange: HttpExchange)
}

class HttpServer private constructor(private val address: InetSocketAddress) {
    private var serverSocket: ServerSocket? = null
    private var isRunning = false
    private val contexts = mutableMapOf<String, HttpHandler>()
    private var threadPool: ExecutorService = Executors.newCachedThreadPool()

    fun createContext(path: String, handler: HttpHandler) {
        contexts[path] = handler
    }

    fun start() {
        serverSocket = ServerSocket(address.port, 50, address.address)
        isRunning = true
        threadPool.execute {
            while (isRunning && serverSocket != null && !serverSocket!!.isClosed) {
                try {
                    val socket = serverSocket?.accept() ?: break
                    threadPool.execute {
                        handleClient(socket)
                    }
                } catch (_: Exception) {
                    if (!isRunning) break
                }
            }
        }
    }

    fun stop(delay: Int) {
        isRunning = false
        try {
            serverSocket?.close()
        } catch (_: Exception) {}
        try {
            threadPool.shutdownNow()
        } catch (_: Exception) {}
    }

    private fun handleClient(socket: Socket) {
        try {
            socket.soTimeout = 15000
            val rawInput = socket.getInputStream()
            val rawOutput = socket.getOutputStream()
            val bufferedInput = BufferedInputStream(rawInput)

            // Read HTTP request line
            val requestLine = readLine(bufferedInput) ?: return
            val parts = requestLine.trim().split(" ")
            if (parts.size < 2) return

            val method = parts[0].uppercase(Locale.ROOT)
            val rawUri = parts[1]
            val uri = URI(rawUri)

            // Read HTTP request headers
            val reqHeaders = HttpHeaders()
            while (true) {
                val line = readLine(bufferedInput) ?: break
                if (line.isEmpty()) break
                val colonIdx = line.indexOf(':')
                if (colonIdx > 0) {
                    val headerName = line.substring(0, colonIdx).trim()
                    val headerValue = line.substring(colonIdx + 1).trim()
                    reqHeaders.set(headerName, headerValue)
                }
            }

            // Handle OPTIONS preflight immediately
            if (method == "OPTIONS") {
                val resp = StringBuilder()
                resp.append("HTTP/1.1 204 No Content\r\n")
                resp.append("Access-Control-Allow-Origin: *\r\n")
                resp.append("Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS\r\n")
                resp.append("Access-Control-Allow-Headers: Content-Type, Authorization\r\n")
                resp.append("Content-Length: 0\r\n")
                resp.append("Connection: close\r\n\r\n")
                rawOutput.write(resp.toString().toByteArray(StandardCharsets.UTF_8))
                rawOutput.flush()
                return
            }

            val contentLength = reqHeaders.getFirst("content-length")?.toLongOrNull() ?: 0L
            val bodyStream = BoundedInputStream(bufferedInput, contentLength)

            val respHeaders = HttpHeaders()
            var headersSent = false

            val exchange = HttpExchange(
                requestMethod = method,
                requestURI = uri,
                requestHeaders = reqHeaders,
                responseHeaders = respHeaders,
                requestBody = bodyStream,
                responseBody = rawOutput,
                sendHeaderCallback = { statusCode, length ->
                    if (!headersSent) {
                        headersSent = true
                        val statusText = when (statusCode) {
                            200 -> "OK"
                            201 -> "Created"
                            204 -> "No Content"
                            400 -> "Bad Request"
                            401 -> "Unauthorized"
                            403 -> "Forbidden"
                            404 -> "Not Found"
                            405 -> "Method Not Allowed"
                            500 -> "Internal Server Error"
                            else -> "OK"
                        }

                        val sb = StringBuilder()
                        sb.append("HTTP/1.1 $statusCode $statusText\r\n")
                        for ((k, v) in respHeaders.getAll()) {
                            sb.append("$k: $v\r\n")
                        }
                        if (length >= 0) {
                            sb.append("Content-Length: $length\r\n")
                        }
                        sb.append("Connection: close\r\n\r\n")
                        rawOutput.write(sb.toString().toByteArray(StandardCharsets.UTF_8))
                        rawOutput.flush()
                    }
                }
            )

            // Route to longest matching context
            val matchedHandler = findHandler(uri.path)
            if (matchedHandler != null) {
                matchedHandler.handle(exchange)
            } else {
                LocalServerEngine.sendJsonResponse(exchange, 404, """{"success":false,"error":{"code":"NOT_FOUND","message":"Not Found"}}""")
            }

            rawOutput.flush()
        } catch (_: Exception) {
        } finally {
            try {
                socket.close()
            } catch (_: Exception) {}
        }
    }

    private fun findHandler(path: String): HttpHandler? {
        val sortedKeys = contexts.keys.sortedByDescending { it.length }
        for (k in sortedKeys) {
            if (k == "/" || path == k || path.startsWith("$k/")) {
                return contexts[k]
            }
        }
        return contexts["/"]
    }

    private fun readLine(input: InputStream): String? {
        val baos = ByteArrayOutputStream()
        while (true) {
            val b = input.read()
            if (b == -1) {
                if (baos.size() == 0) return null
                break
            }
            if (b == '\n'.code) {
                break
            }
            if (b != '\r'.code) {
                baos.write(b)
            }
        }
        return baos.toString(StandardCharsets.UTF_8.name())
    }

    companion object {
        fun create(address: InetSocketAddress, backlog: Int): HttpServer {
            return HttpServer(address)
        }
    }
}

class BoundedInputStream(private val wrapped: InputStream, private val limit: Long) : InputStream() {
    private var count = 0L

    override fun read(): Int {
        if (limit in 0..count) return -1
        val b = wrapped.read()
        if (b != -1) count++
        return b
    }

    override fun read(b: ByteArray, off: Int, len: Int): Int {
        if (limit in 0..count) return -1
        val toRead = if (limit >= 0) Math.min(len.toLong(), limit - count).toInt() else len
        val bytesRead = wrapped.read(b, off, toRead)
        if (bytesRead > 0) count += bytesRead
        return bytesRead
    }
}

// -----------------------------------------------------------------------------
// Embedded Local HTTP Server Engine for RemoteNode Android File Host
// Listens strictly on loopback interface 127.0.0.1:8080
// -----------------------------------------------------------------------------

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

            // Health & Auth endpoints
            newServer.createContext("/api/health", HealthHandler())
            newServer.createContext("/api/auth/login", AuthHandler())

            // Storage Statistics & Intelligence endpoint
            newServer.createContext("/api/storage", StorageHandler(sandboxDir))

            // Recent Files endpoint
            newServer.createContext("/api/files/recent", RecentFilesHandler(sandboxDir))

            // Local File Management API Contexts
            newServer.createContext("/api/files", FileListAndDeleteHandler(sandboxDir))
            newServer.createContext("/api/folders", CreateFolderHandler(sandboxDir))
            newServer.createContext("/api/rename", RenameHandler(sandboxDir))
            newServer.createContext("/api/download", DownloadHandler(sandboxDir))
            newServer.createContext("/api/upload", UploadHandler(sandboxDir))

            // Static bundled website assets handler
            newServer.createContext("/", StaticAssetsHandler())

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
     * Filesystem Sandbox Helper & Category Classifier
     */
    companion object {
        private val PHOTO_EXTS = setOf("jpg", "jpeg", "png", "webp", "gif", "bmp", "heic", "heif", "svg")
        private val VIDEO_EXTS = setOf("mp4", "mkv", "webm", "mov", "avi", "m4v", "3gp", "wmv", "flv")
        private val DOC_EXTS = setOf("pdf", "doc", "docx", "txt", "md", "csv", "xlsx", "pptx", "json", "xml", "html", "epub")
        private val AUDIO_EXTS = setOf("mp3", "wav", "aac", "flac", "ogg", "m4a", "wma")
        private val ARCHIVE_EXTS = setOf("zip", "tar", "gz", "7z", "rar", "bz2", "xz")

        fun classifyFile(filename: String): String {
            val ext = filename.substringAfterLast('.', "").lowercase(Locale.ROOT)
            return when {
                PHOTO_EXTS.contains(ext) -> "photos"
                VIDEO_EXTS.contains(ext) -> "videos"
                DOC_EXTS.contains(ext) -> "documents"
                AUDIO_EXTS.contains(ext) -> "audio"
                ARCHIVE_EXTS.contains(ext) -> "archives"
                else -> "other"
            }
        }

        fun getMimeType(filename: String): String {
            val ext = filename.substringAfterLast('.', "").lowercase(Locale.ROOT)
            return when (ext) {
                "jpg", "jpeg" -> "image/jpeg"
                "png" -> "image/png"
                "gif" -> "image/gif"
                "webp" -> "image/webp"
                "svg" -> "image/svg+xml"
                "bmp" -> "image/bmp"
                "mp4" -> "video/mp4"
                "webm" -> "video/webm"
                "mkv" -> "video/x-matroska"
                "mov" -> "video/quicktime"
                "mp3" -> "audio/mpeg"
                "wav" -> "audio/wav"
                "pdf" -> "application/pdf"
                "json" -> "application/json"
                "txt", "md" -> "text/plain; charset=UTF-8"
                "html" -> "text/html; charset=UTF-8"
                else -> "application/octet-stream"
            }
        }

        fun formatIsoDate(epochMs: Long): String {
            val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
            sdf.timeZone = TimeZone.getTimeZone("UTC")
            return sdf.format(Date(epochMs))
        }

        fun resolveSandboxPath(rootDir: File, relPath: String): File {
            if (relPath.contains("\u0000") || relPath.contains("..") || relPath.lowercase(Locale.ROOT).contains("%2e%2e")) {
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
            exchange.responseHeaders.set("Access-Control-Allow-Origin", "*")
            exchange.responseHeaders.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
            exchange.responseHeaders.set("Access-Control-Allow-Headers", "Content-Type, Authorization")
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

    /**
     * Real Storage Statistics & Category Intelligence Handler
     */
    private class StorageHandler(private val rootDir: File) : HttpHandler {
        override fun handle(exchange: HttpExchange) {
            if (exchange.requestMethod != "GET") {
                sendJsonResponse(exchange, 405, """{"success":false,"error":{"code":"METHOD_NOT_ALLOWED","message":"Method not allowed"}}""")
                return
            }

            try {
                var totalBytes = rootDir.totalSpace
                var freeBytes = rootDir.usableSpace
                // Fallback for virtual/sandbox environments if totalSpace returns 0
                if (totalBytes <= 0) {
                    totalBytes = 64L * 1024 * 1024 * 1024 // 64 GB baseline
                    freeBytes = 48L * 1024 * 1024 * 1024
                }
                val usedBytes = totalBytes - freeBytes

                val categoryBytes = mutableMapOf(
                    "photos" to 0L,
                    "videos" to 0L,
                    "documents" to 0L,
                    "audio" to 0L,
                    "archives" to 0L,
                    "other" to 0L
                )

                val categoryCounts = mutableMapOf(
                    "photos" to 0,
                    "videos" to 0,
                    "documents" to 0,
                    "audio" to 0,
                    "archives" to 0,
                    "other" to 0
                )

                var sandboxUsedBytes = 0L
                val allFiles = mutableListOf<File>()

                fun scanDir(dir: File, depth: Int) {
                    if (depth > 12) return
                    val files = dir.listFiles() ?: return
                    for (f in files) {
                        if (f.isDirectory) {
                            scanDir(f, depth + 1)
                        } else if (f.isFile) {
                            val size = f.length()
                            sandboxUsedBytes += size
                            val cat = classifyFile(f.name)
                            categoryBytes[cat] = (categoryBytes[cat] ?: 0L) + size
                            categoryCounts[cat] = (categoryCounts[cat] ?: 0) + 1
                            allFiles.add(f)
                        }
                    }
                }

                scanDir(rootDir, 0)

                // Top 10 largest files
                val largest = allFiles.sortedByDescending { it.length() }.take(10).map { f ->
                    val relPath = f.canonicalPath.substringAfter(rootDir.canonicalPath).replace("\\", "/")
                    val safePath = if (relPath.isEmpty() || !relPath.startsWith("/")) "/$relPath" else relPath
                    """{"name":"${f.name}","path":"$safePath","sizeBytes":${f.length()},"modifiedAt":"${formatIsoDate(f.lastModified())}"}"""
                }.joinToString(",")

                val json = """
                {
                  "success": true,
                  "data": {
                    "totalBytes": $totalBytes,
                    "usedBytes": $usedBytes,
                    "freeBytes": $freeBytes,
                    "sandboxUsedBytes": $sandboxUsedBytes,
                    "usagePercentage": ${if (totalBytes > 0) ((usedBytes.toDouble() / totalBytes) * 100).toInt() else 0},
                    "categories": {
                      "photos": ${categoryBytes["photos"] ?: 0},
                      "videos": ${categoryBytes["videos"] ?: 0},
                      "documents": ${categoryBytes["documents"] ?: 0},
                      "audio": ${categoryBytes["audio"] ?: 0},
                      "archives": ${categoryBytes["archives"] ?: 0},
                      "other": ${categoryBytes["other"] ?: 0}
                    },
                    "counts": {
                      "photos": ${categoryCounts["photos"] ?: 0},
                      "videos": ${categoryCounts["videos"] ?: 0},
                      "documents": ${categoryCounts["documents"] ?: 0},
                      "audio": ${categoryCounts["audio"] ?: 0},
                      "archives": ${categoryCounts["archives"] ?: 0},
                      "other": ${categoryCounts["other"] ?: 0},
                      "total": ${allFiles.size}
                    },
                    "largestFiles": [$largest]
                  }
                }
                """.trimIndent()

                sendJsonResponse(exchange, 200, json)
            } catch (e: Exception) {
                sendJsonResponse(exchange, 500, """{"success":false,"error":{"code":"STORAGE_CALC_FAILED","message":"${e.message}"}}""")
            }
        }
    }

    /**
     * Recent Files Handler — returns files sorted by lastModified descending
     */
    private class RecentFilesHandler(private val rootDir: File) : HttpHandler {
        override fun handle(exchange: HttpExchange) {
            if (exchange.requestMethod != "GET") {
                sendJsonResponse(exchange, 405, """{"success":false,"error":{"code":"METHOD_NOT_ALLOWED","message":"Method not allowed"}}""")
                return
            }

            try {
                val allFiles = mutableListOf<File>()

                fun scanDir(dir: File, depth: Int) {
                    if (depth > 12) return
                    val files = dir.listFiles() ?: return
                    for (f in files) {
                        if (f.isDirectory) {
                            scanDir(f, depth + 1)
                        } else if (f.isFile) {
                            allFiles.add(f)
                        }
                    }
                }

                scanDir(rootDir, 0)

                val recent = allFiles.sortedByDescending { it.lastModified() }.take(20).map { f ->
                    val relPath = f.canonicalPath.substringAfter(rootDir.canonicalPath).replace("\\", "/")
                    val safePath = if (relPath.isEmpty() || !relPath.startsWith("/")) "/$relPath" else relPath
                    val cat = classifyFile(f.name)
                    """{"name":"${f.name}","isDir":false,"sizeBytes":${f.length()},"category":"$cat","modifiedAt":"${formatIsoDate(f.lastModified())}","path":"$safePath"}"""
                }.joinToString(",")

                sendJsonResponse(exchange, 200, """{"success":true,"data":{"items":[$recent]}}""")
            } catch (e: Exception) {
                sendJsonResponse(exchange, 500, """{"success":false,"error":{"code":"RECENT_FILES_FAILED","message":"${e.message}"}}""")
            }
        }
    }

    /**
     * File Listing, Categorical Filtering & Deletion Handler
     */
    private class FileListAndDeleteHandler(private val rootDir: File) : HttpHandler {
        override fun handle(exchange: HttpExchange) {
            try {
                if (exchange.requestMethod == "GET") {
                    val query = exchange.requestURI.rawQuery ?: ""
                    var reqPath = "/"
                    var filterType: String? = null

                    for (param in query.split("&")) {
                        val pair = param.split("=")
                        if (pair.size == 2) {
                            when (pair[0]) {
                                "path" -> reqPath = pair[1]
                                "type" -> filterType = pair[1].lowercase(Locale.ROOT)
                            }
                        }
                    }

                    // If a category filter is requested (photos, videos, documents, audio), perform recursive discovery
                    if (filterType != null && filterType.isNotEmpty()) {
                        val allMatchedFiles = mutableListOf<File>()

                        fun scanCategory(dir: File, depth: Int) {
                            if (depth > 12) return
                            val files = dir.listFiles() ?: return
                            for (f in files) {
                                if (f.isDirectory) {
                                    scanCategory(f, depth + 1)
                                } else if (f.isFile) {
                                    val cat = classifyFile(f.name)
                                    val matches = when (filterType) {
                                        "photo", "photos" -> cat == "photos"
                                        "video", "videos" -> cat == "videos"
                                        "doc", "docs", "document", "documents" -> cat == "documents"
                                        "audio" -> cat == "audio"
                                        "archive", "archives" -> cat == "archives"
                                        else -> true
                                    }
                                    if (matches) {
                                        allMatchedFiles.add(f)
                                    }
                                }
                            }
                        }

                        scanCategory(rootDir, 0)

                        val items = allMatchedFiles.sortedByDescending { it.lastModified() }.map { file ->
                            val relPath = file.canonicalPath.substringAfter(rootDir.canonicalPath).replace("\\", "/")
                            val safePath = if (relPath.isEmpty() || !relPath.startsWith("/")) "/$relPath" else relPath
                            """{"name":"${file.name}","isDir":false,"sizeBytes":${file.length()},"category":"${classifyFile(file.name)}","modifiedAt":"${formatIsoDate(file.lastModified())}","path":"$safePath"}"""
                        }.joinToString(",")

                        sendJsonResponse(exchange, 200, """{"success":true,"data":{"items":[$items]}}""")
                        return
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
                        val safePath = if (relPath.isEmpty() || !relPath.startsWith("/")) "/$relPath" else relPath
                        val cat = if (isDir) "folder" else classifyFile(name)
                        """{"name":"$name","isDir":$isDir,"sizeBytes":$sizeBytes,"category":"$cat","modifiedAt":"${formatIsoDate(file.lastModified())}","path":"$safePath"}"""
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

                val mimeType = getMimeType(targetFile.name)
                exchange.responseHeaders.set("Content-Type", mimeType)
                exchange.responseHeaders.set("Content-Disposition", "inline; filename=\"${targetFile.name}\"")
                exchange.responseHeaders.set("Access-Control-Allow-Origin", "*")
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
                var customFilename: String? = null

                for (param in query.split("&")) {
                    val pair = param.split("=")
                    if (pair.size == 2) {
                        when (pair[0]) {
                            "path" -> reqPath = pair[1]
                            "filename" -> customFilename = URLDecoder.decode(pair[1], StandardCharsets.UTF_8.name())
                        }
                    }
                }

                val targetDir = resolveSandboxPath(rootDir, reqPath)
                if (!targetDir.exists()) targetDir.mkdirs()

                val filename = customFilename ?: "upload_${System.currentTimeMillis()}.dat"
                val newFile = File(targetDir, filename)
                resolveSandboxPath(rootDir, newFile.canonicalPath.substringAfter(rootDir.canonicalPath))

                val os = newFile.outputStream()
                exchange.requestBody.copyTo(os)
                os.close()

                sendJsonResponse(exchange, 200, """{"success":true,"data":{"filename":"${newFile.name}","sizeBytes":${newFile.length()}}}""")
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
                    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #FAFAFC; color: #0F172A; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 1rem; margin: 0; }
                    .card { background: #FFFFFF; border-radius: 12px; padding: 2.5rem; max-width: 520px; text-align: center; border: 1px solid #E2E8F0; box-shadow: 0 4px 6px -1px rgba(15,23,42,0.08); }
                    .badge { color: #059669; background: #ECFDF5; padding: 6px 14px; border-radius: 9999px; font-size: 0.85rem; font-weight: 700; display: inline-flex; align-items: center; gap: 6px; }
                    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #059669; }
                    h1 { margin: 1.25rem 0 0.5rem; font-size: 1.6rem; color: #2563EB; font-weight: 700; }
                    p { color: #475569; font-size: 0.95rem; margin-top: 0.5rem; line-height: 1.5; }
                  </style>
                </head>
                <body>
                  <div class="card">
                    <span class="badge"><span class="status-dot"></span> LOCAL SERVER ONLINE</span>
                    <h1>RemoteNode Personal Storage</h1>
                    <p>Android Local Storage Server running at 127.0.0.1:8080.</p>
                  </div>
                </body>
                </html>
            """.trimIndent()

            val bytes = html.toByteArray(StandardCharsets.UTF_8)
            exchange.responseHeaders.set("Content-Type", "text/html; charset=UTF-8")
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            val os: OutputStream = exchange.responseBody
            os.write(bytes)
            os.close()
        }
    }
}
