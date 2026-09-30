package net.remotenode.fileserver

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/**
 * Android Native Gateway Tunnel Manager & Connection Coordinator
 * Phase 11A.3: Authoritative native persistent WebSocket tunnel owner within Android Foreground Service.
 */
object RemoteNodeTunnelManager {

    private const val TAG = "ZdexCloudTunnel"
    private const val LOCAL_SERVER_BASE_URL = "http://127.0.0.1:8080"

    // Connection Lifecycle States
    const val STATE_STOPPED = "STOPPED"
    const val STATE_STARTING = "STARTING"
    const val STATE_CONNECTING = "CONNECTING"
    const val STATE_AUTHENTICATING = "AUTHENTICATING"
    const val STATE_CONNECTED = "CONNECTED"
    const val STATE_RECONNECTING = "RECONNECTING"
    const val STATE_NETWORK_UNAVAILABLE = "NETWORK_UNAVAILABLE"
    const val STATE_AUTH_FAILED = "AUTH_FAILED"
    const val STATE_ERROR = "ERROR"

    @Volatile
    var currentState: String = STATE_STOPPED
        private set

    @Volatile
    var activeConnectionId: String? = null
        private set

    @Volatile
    var activeRemoteEndpoint: String? = null
        private set

    @Volatile
    var activeHostname: String? = null
        private set

    @Volatile
    var activePublicUrl: String? = null
        private set

    @Volatile
    var activeGatewayNodeId: String? = null
        private set

    @Volatile
    var lastFailedGatewayNodeId: String? = null
        private set

    @Volatile
    var lastErrorMessage: String? = null
        private set

    @Volatile
    var lastHeartbeatTime: Long = 0
        private set

    private val connectionGeneration = AtomicLong(0)
    private val random = SecureRandom()

    private var activeWebSocket: WebSocket? = null
    private var pingFuture: java.util.concurrent.ScheduledFuture<*>? = null
    private var okHttpClient: OkHttpClient = OkHttpClient.Builder()
        .pingInterval(10, TimeUnit.SECONDS)
        .connectTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS) // Keep-alive socket
        .retryOnConnectionFailure(true)
        .build()

    private val workerExecutor = Executors.newCachedThreadPool()
    private var scheduler: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()

    private val mainHandler = Handler(Looper.getMainLooper())
    private val listeners = ConcurrentHashMap.newKeySet<(Map<String, Any?>) -> Unit>()

    @Volatile
    private var storedDeviceId: String? = null

    @Volatile
    private var storedSessionToken: String? = null

    @Volatile
    private var storedApiBaseUrl: String? = null

    @Volatile
    private var storedGatewayWsUrl: String? = null

    @Volatile
    private var isExplicitlyStopped: Boolean = true

    @Volatile
    private var isConnectingOrReconnecting: Boolean = false

    private var reconnectAttempts: Int = 0
    private var missedPings: Int = 0
    private var lastPongReceivedAt: Long = 0
    private var lastPongElapsedRealtime: Long = 0

    init {
        // Register listener with NetworkWatcher for automatic native self-healing
        NetworkWatcher.addListener { event ->
            handleNetworkEvent(event)
        }
    }

    fun addListener(listener: (Map<String, Any?>) -> Unit) {
        listeners.add(listener)
    }

    fun removeListener(listener: (Map<String, Any?>) -> Unit) {
        listeners.remove(listener)
    }

    private fun extractHost(urlStr: String?): String {
        if (urlStr.isNullOrEmpty()) return "none"
        return try {
            val uri = URI(urlStr)
            uri.host ?: urlStr
        } catch (_: Exception) {
            urlStr
        }
    }

    private fun safeDeviceIdSuffix(deviceId: String?): String {
        if (deviceId.isNullOrEmpty()) return "none"
        return if (deviceId.length > 6) "..." + deviceId.takeLast(6) else deviceId
    }

    private fun emitState(state: String, errorMessage: String? = null) {
        val previousState = currentState
        currentState = state
        if (errorMessage != null) {
            lastErrorMessage = errorMessage
        }
        val gen = connectionGeneration.get()
        Log.i(TAG, "[STATE_CHANGE] gen=$gen from=$previousState to=$state error=${errorMessage ?: "none"}")
        val event = mapOf(
            "type" to "TUNNEL_STATE_CHANGED",
            "state" to state,
            "connectionId" to activeConnectionId,
            "remoteEndpoint" to activeRemoteEndpoint,
            "hostname" to activeHostname,
            "publicUrl" to activePublicUrl,
            "errorMessage" to lastErrorMessage,
            "generation" to gen,
            "timestamp" to System.currentTimeMillis()
        )
        mainHandler.post {
            for (listener in listeners) {
                try {
                    listener(event)
                } catch (_: Exception) {}
            }
        }
    }

    fun getStatus(): Map<String, Any?> {
        return mapOf(
            "state" to currentState,
            "connectionId" to activeConnectionId,
            "remoteEndpoint" to activeRemoteEndpoint,
            "hostname" to activeHostname,
            "publicUrl" to activePublicUrl,
            "isConnected" to (currentState == STATE_CONNECTED),
            "errorMessage" to lastErrorMessage,
            "generation" to connectionGeneration.get(),
            "lastHeartbeatAt" to lastHeartbeatTime
        )
    }

    @Synchronized
    fun startTunnel(
        context: Context,
        deviceId: String,
        sessionToken: String,
        apiBaseUrl: String,
        gatewayWsUrl: String
    ) {
        val isActiveState = currentState == STATE_STARTING ||
            currentState == STATE_CONNECTING ||
            currentState == STATE_AUTHENTICATING ||
            currentState == STATE_CONNECTED

        if (!isExplicitlyStopped &&
            isActiveState &&
            storedDeviceId == deviceId &&
            storedSessionToken == sessionToken &&
            storedApiBaseUrl == apiBaseUrl &&
            storedGatewayWsUrl == gatewayWsUrl
        ) {
            val activeGen = connectionGeneration.get()
            Log.i(TAG, "[START_TUNNEL_IDEMPOTENT_IGNORED] gen=$activeGen state=$currentState devId=${safeDeviceIdSuffix(deviceId)}")
            return
        }

        isExplicitlyStopped = false
        storedDeviceId = deviceId
        storedSessionToken = sessionToken
        storedApiBaseUrl = apiBaseUrl
        storedGatewayWsUrl = gatewayWsUrl

        val currentGen = connectionGeneration.incrementAndGet()
        reconnectAttempts = 0
        missedPings = 0
        lastErrorMessage = null

        Log.i(TAG, "[START_TUNNEL] gen=$currentGen devId=${safeDeviceIdSuffix(deviceId)} apiHost=${extractHost(apiBaseUrl)} gwHost=${extractHost(gatewayWsUrl)}")
        emitState(STATE_STARTING)
        executeConnectSequence(currentGen)
    }

    @Synchronized
    fun stopTunnel() {
        isExplicitlyStopped = true
        val currentGen = connectionGeneration.incrementAndGet()

        stopPingTimer()
        closeActiveWebSocket()

        val connId = activeConnectionId
        val token = storedSessionToken
        val apiBase = storedApiBaseUrl

        Log.i(TAG, "[STOP_TUNNEL] gen=$currentGen activeConnId=${connId ?: "none"}")

        if (connId != null && token != null && apiBase != null) {
            workerExecutor.execute {
                try {
                    val url = URL("$apiBase/connections/$connId/disconnect")
                    val conn = url.openConnection() as HttpURLConnection
                    conn.requestMethod = "POST"
                    conn.setRequestProperty("Authorization", "Bearer $token")
                    conn.setRequestProperty("Content-Type", "application/json")
                    conn.connectTimeout = 3000
                    conn.readTimeout = 3000
                    conn.doOutput = true
                    conn.outputStream.write("{}".toByteArray(StandardCharsets.UTF_8))
                    conn.responseCode
                    conn.disconnect()
                } catch (_: Exception) {}
            }
        }

        activeConnectionId = null
        activeRemoteEndpoint = null
        activeHostname = null
        activePublicUrl = null
        isConnectingOrReconnecting = false

        emitState(STATE_STOPPED)
    }

    private fun handleNetworkEvent(event: Map<String, Any>) {
        if (isExplicitlyStopped) return

        val hasInternet = event["hasInternet"] as? Boolean ?: false
        val isValidated = event["isValidated"] as? Boolean ?: false
        val isCaptivePortal = event["isCaptivePortal"] as? Boolean ?: false
        val transport = event["transport"] as? String ?: "NONE"
        val type = event["type"] as? String ?: "UNKNOWN"

        // If no validated internet or trapped behind captive portal
        if (!hasInternet || !isValidated || isCaptivePortal) {
            if (currentState == STATE_CONNECTED || currentState == STATE_CONNECTING || currentState == STATE_AUTHENTICATING) {
                closeActiveWebSocket()
                stopPingTimer()
                emitState(STATE_NETWORK_UNAVAILABLE, "Validated Internet connectivity lost ($transport)")
            }
            return
        }

        // Network is online & validated
        if (currentState == STATE_CONNECTED) {
            val transportChanged = event["transportChanged"] as? Boolean ?: false
            if (transportChanged || type == "AVAILABLE") {
                // Network interface switched (e.g. Wi-Fi <-> Cellular). Invalidate potentially black-holed socket.
                triggerReconnect(immediate = true)
            }
            return
        }

        if (currentState == STATE_NETWORK_UNAVAILABLE || currentState == STATE_RECONNECTING || currentState == STATE_ERROR || currentState == STATE_STARTING) {
            triggerReconnect(immediate = true)
        }
    }

    fun triggerReconnect(immediate: Boolean = false) {
        if (isExplicitlyStopped) return

        // If not immediate and already attempting connection, let the current attempt proceed
        if (!immediate && isConnectingOrReconnecting) return

        val currentGen = connectionGeneration.incrementAndGet()
        closeActiveWebSocket()
        stopPingTimer()
        isConnectingOrReconnecting = false

        val delayMs = if (immediate) 50L else calculateBackoffDelayMs()
        Log.i(TAG, "[RECONNECT_SCHEDULED] gen=$currentGen attempt=$reconnectAttempts delayMs=$delayMs immediate=$immediate")
        emitState(STATE_RECONNECTING)

        scheduler.schedule({
            if (!isExplicitlyStopped && currentGen == connectionGeneration.get()) {
                executeConnectSequence(currentGen)
            }
        }, delayMs, TimeUnit.MILLISECONDS)
    }

    private fun calculateBackoffDelayMs(): Long {
        val attempt = reconnectAttempts.coerceIn(0, 6)
        val baseDelay = (1000L * (1 shl attempt)).coerceIn(1000L, 60000L)
        val jitter = random.nextInt(1000).toLong()
        return (baseDelay + jitter).coerceAtMost(60000L)
    }

    private fun executeConnectSequence(generation: Long) {
        if (isExplicitlyStopped || generation != connectionGeneration.get()) return

        Log.i(TAG, "[CONNECT_SEQUENCE_START] gen=$generation reconnectAttempts=$reconnectAttempts")
        isConnectingOrReconnecting = true
        emitState(STATE_CONNECTING)

        workerExecutor.execute {
            try {
                val devId = storedDeviceId
                val sessionTok = storedSessionToken
                val apiBase = storedApiBaseUrl
                var gatewayWs = storedGatewayWsUrl

                if (devId.isNullOrEmpty() || sessionTok.isNullOrEmpty() || apiBase.isNullOrEmpty() || gatewayWs.isNullOrEmpty()) {
                    Log.e(TAG, "[CONNECT_CONFIG_ERROR] gen=$generation devIdPresent=${!devId.isNullOrEmpty()} sessionTokPresent=${!sessionTok.isNullOrEmpty()} apiBasePresent=${!apiBase.isNullOrEmpty()} gwWsPresent=${!gatewayWs.isNullOrEmpty()}")
                    emitState(STATE_ERROR, "Missing device ID or configuration parameters")
                    isConnectingOrReconnecting = false
                    return@execute
                }

                // 1. Control Plane Registration Request (POST /connections/register)
                var registerSuccess = false
                var connectionToken: String? = null
                var registrationAttempts = 0
                val maxRegAttempts = 5

                while (registrationAttempts < maxRegAttempts && !isExplicitlyStopped && generation == connectionGeneration.get()) {
                    registrationAttempts++
                    val regStartTime = android.os.SystemClock.elapsedRealtime()
                    val regHost = extractHost(apiBase)
                    Log.i(TAG, "[REGISTRATION_START] gen=$generation attempt=$registrationAttempts/$maxRegAttempts method=POST path=/connections/register host=$regHost")
                    try {
                        val regUrl = URL("$apiBase/connections/register")
                        val conn = regUrl.openConnection() as HttpURLConnection
                        conn.requestMethod = "POST"
                        conn.setRequestProperty("Authorization", "Bearer $sessionTok")
                        conn.setRequestProperty("Content-Type", "application/json")
                        conn.connectTimeout = 30000
                        conn.readTimeout = 30000
                        conn.doOutput = true

                        val reqBody = JSONObject().apply {
                            put("deviceId", devId)
                            if (!lastFailedGatewayNodeId.isNullOrEmpty()) {
                                put("failedGatewayNodeId", lastFailedGatewayNodeId)
                            }
                        }
                        conn.outputStream.write(reqBody.toString().toByteArray(StandardCharsets.UTF_8))

                        val respCode = conn.responseCode
                        val regDurationMs = android.os.SystemClock.elapsedRealtime() - regStartTime
                        val respStream = if (respCode in 200..299) conn.inputStream else conn.errorStream
                        val rawBody = respStream?.bufferedReader()?.use { it.readText() } ?: "{}"
                        conn.disconnect()

                        Log.i(TAG, "[REGISTRATION_RESPONSE] gen=$generation attempt=$registrationAttempts status=$respCode durationMs=$regDurationMs bodyLength=${rawBody.length}")

                        if (respCode == 200) {
                            val json = JSONObject(rawBody)
                            if (json.optBoolean("success")) {
                                val connData = json.getJSONObject("data").getJSONObject("connection")
                                activeConnectionId = connData.optString("id")
                                activeRemoteEndpoint = connData.optString("remoteEndpoint")
                                activeHostname = connData.optString("hostname")
                                activePublicUrl = connData.optString("publicUrl", activeRemoteEndpoint)
                                connectionToken = connData.optString("connectionToken")
                                
                                val returnedGatewayWs = connData.optString("gatewayWsUrl")
                                if (!returnedGatewayWs.isNullOrEmpty()) {
                                    gatewayWs = returnedGatewayWs
                                    storedGatewayWsUrl = returnedGatewayWs
                                }
                                activeGatewayNodeId = connData.optString("gatewayNodeId")
                                registerSuccess = true
                                Log.i(TAG, "[REGISTRATION_SUCCESS] gen=$generation attempt=$registrationAttempts durationMs=$regDurationMs connId=$activeConnectionId gwHost=${extractHost(gatewayWs)} tokenPresent=${!connectionToken.isNullOrEmpty()}")
                                break
                            } else {
                                val err = json.optString("error", "Unknown registration failure")
                                Log.w(TAG, "[REGISTRATION_REJECTED] gen=$generation attempt=$registrationAttempts durationMs=$regDurationMs err=$err")
                            }
                        } else if (respCode == 401) {
                            Log.e(TAG, "[REGISTRATION_AUTH_FAILURE] gen=$generation attempt=$registrationAttempts status=401 durationMs=$regDurationMs")
                            AndroidErrorTelemetry.reportError(
                                apiBase, sessionTok,
                                AndroidErrorTelemetry.ErrorTelemetryPayload(
                                    component = "ANDROID_TUNNEL",
                                    errorCode = "REGISTRATION_AUTH_EXPIRED",
                                    errorType = "AuthenticationException",
                                    severity = "ERROR",
                                    message = "Platform session expired during control plane registration (HTTP 401)",
                                    deviceId = devId,
                                    metadata = mapOf("httpStatus" to 401, "attempt" to registrationAttempts, "generation" to generation)
                                )
                            )
                            emitState(STATE_AUTH_FAILED, "Platform session expired. Please sign in again.")
                            isConnectingOrReconnecting = false
                            return@execute
                        } else if (respCode == 403) {
                            Log.e(TAG, "[REGISTRATION_AUTH_FAILURE] gen=$generation attempt=$registrationAttempts status=403 durationMs=$regDurationMs")
                            AndroidErrorTelemetry.reportError(
                                apiBase, sessionTok,
                                AndroidErrorTelemetry.ErrorTelemetryPayload(
                                    component = "ANDROID_TUNNEL",
                                    errorCode = "REGISTRATION_AUTH_FORBIDDEN",
                                    errorType = "AuthenticationException",
                                    severity = "ERROR",
                                    message = "Device unauthorized or account suspended during registration (HTTP 403)",
                                    deviceId = devId,
                                    metadata = mapOf("httpStatus" to 403, "attempt" to registrationAttempts, "generation" to generation)
                                )
                            )
                            emitState(STATE_AUTH_FAILED, "Device unauthorized or account suspended.")
                            isConnectingOrReconnecting = false
                            return@execute
                        } else if (respCode == 404) {
                            Log.e(TAG, "[REGISTRATION_HTTP_ERROR] gen=$generation attempt=$registrationAttempts status=404 durationMs=$regDurationMs")
                            AndroidErrorTelemetry.reportError(
                                apiBase, sessionTok,
                                AndroidErrorTelemetry.ErrorTelemetryPayload(
                                    component = "ANDROID_TUNNEL",
                                    errorCode = "DEVICE_NOT_FOUND",
                                    errorType = "NotFoundException",
                                    severity = "ERROR",
                                    message = "Device node or server instance not found on backend (HTTP 404)",
                                    deviceId = devId,
                                    metadata = mapOf("httpStatus" to 404, "attempt" to registrationAttempts, "generation" to generation)
                                )
                            )
                            emitState(STATE_ERROR, "Device node or server instance not found.")
                            isConnectingOrReconnecting = false
                            return@execute
                        } else {
                            Log.w(TAG, "[REGISTRATION_HTTP_ERROR] gen=$generation attempt=$registrationAttempts status=$respCode durationMs=$regDurationMs retry=${respCode >= 500 && registrationAttempts < maxRegAttempts}")
                        }

                        if (respCode >= 500 && registrationAttempts < maxRegAttempts) {
                            Thread.sleep(2000)
                        } else {
                            break
                        }
                    } catch (e: Exception) {
                        val regDurationMs = android.os.SystemClock.elapsedRealtime() - regStartTime
                        Log.e(TAG, "[REGISTRATION_EXCEPTION] gen=$generation attempt=$registrationAttempts exceptionType=${e.javaClass.simpleName} message=${e.message} durationMs=$regDurationMs retry=${registrationAttempts < maxRegAttempts}", e)
                        if (registrationAttempts < maxRegAttempts) {
                            Thread.sleep(2000)
                        }
                    }
                }

                if (!registerSuccess || connectionToken.isNullOrEmpty() || generation != connectionGeneration.get() || isExplicitlyStopped) {
                    Log.w(TAG, "[REGISTRATION_EXHAUSTED] gen=$generation registerSuccess=$registerSuccess tokenPresent=${!connectionToken.isNullOrEmpty()} activeGen=${connectionGeneration.get()} isExplicitlyStopped=$isExplicitlyStopped")
                    if (!isExplicitlyStopped && generation == connectionGeneration.get()) {
                        reconnectAttempts++
                        AndroidErrorTelemetry.reportError(
                            apiBase, sessionTok,
                            AndroidErrorTelemetry.ErrorTelemetryPayload(
                                component = "ANDROID_TUNNEL",
                                errorCode = "REGISTRATION_RETRIES_EXHAUSTED",
                                errorType = "RegistrationTimeoutException",
                                severity = "WARNING",
                                message = "Control plane registration retries exhausted ($registrationAttempts attempts)",
                                deviceId = devId,
                                metadata = mapOf("maxAttempts" to maxRegAttempts, "generation" to generation, "reconnectAttempts" to reconnectAttempts)
                            )
                        )
                        emitState(STATE_RECONNECTING, "Control plane connection pending. Reconnecting...")
                        triggerReconnect()
                    }
                    isConnectingOrReconnecting = false
                    return@execute
                }

                val targetGatewayWs = gatewayWs ?: storedGatewayWsUrl ?: return@execute

                // 2. Validate Gateway WebSocket Endpoint Safety
                val uri = URI(targetGatewayWs)
                if (uri.scheme != "ws" && uri.scheme != "wss") {
                    Log.e(TAG, "[WEBSOCKET_INVALID_SCHEME] gen=$generation scheme=${uri.scheme} targetGatewayWs=$targetGatewayWs")
                    AndroidErrorTelemetry.reportError(
                        apiBase, sessionTok,
                        AndroidErrorTelemetry.ErrorTelemetryPayload(
                            component = "ANDROID_TUNNEL",
                            errorCode = "INVALID_GATEWAY_SCHEME",
                            errorType = "IllegalArgumentException",
                            severity = "ERROR",
                            message = "Invalid gateway URI scheme '${uri.scheme}' for endpoint $targetGatewayWs",
                            deviceId = devId,
                            metadata = mapOf("scheme" to uri.scheme, "generation" to generation)
                        )
                    )
                    emitState(STATE_ERROR, "Invalid gateway scheme: ${uri.scheme}")
                    isConnectingOrReconnecting = false
                    return@execute
                }

                // 3. Establish WebSocket connection to Gateway
                emitState(STATE_AUTHENTICATING)

                val wsStartTimestamp = android.os.SystemClock.elapsedRealtime()
                Log.i(TAG, "[WEBSOCKET_START] gen=$generation targetGatewayWs=${extractHost(targetGatewayWs)} scheme=${uri.scheme}")

                val wsRequest = Request.Builder()
                    .url(targetGatewayWs)
                    .build()

                val wsListener = object : WebSocketListener() {
                    override fun onOpen(webSocket: WebSocket, response: Response) {
                        val wsElapsed = android.os.SystemClock.elapsedRealtime() - wsStartTimestamp
                        if (generation != connectionGeneration.get() || isExplicitlyStopped) {
                            Log.w(TAG, "[WEBSOCKET_OPEN_SUPERSEDED] gen=$generation activeGen=${connectionGeneration.get()} isStopped=$isExplicitlyStopped")
                            webSocket.close(1000, "Superseded generation")
                            return
                        }
                        activeWebSocket = webSocket
                        Log.i(TAG, "[WEBSOCKET_OPEN] gen=$generation elapsedMs=$wsElapsed responseCode=${response.code}")
                        // Transmit AUTH handshake
                        val authMsg = JSONObject().apply {
                            put("type", "AUTH")
                            put("deviceId", devId)
                            put("connectionToken", connectionToken)
                        }
                        Log.i(TAG, "[AUTH_SENT] gen=$generation devId=${safeDeviceIdSuffix(devId)} tokenPresent=${!connectionToken.isNullOrEmpty()}")
                        webSocket.send(authMsg.toString())
                    }

                    override fun onMessage(webSocket: WebSocket, text: String) {
                        if (generation != connectionGeneration.get() || isExplicitlyStopped) {
                            Log.w(TAG, "[STALE_GENERATION_IGNORED] expected=$generation active=${connectionGeneration.get()}")
                            return
                        }

                        try {
                            val msg = JSONObject(text)
                            val type = msg.optString("type")

                            when (type) {
                                "AUTH_SUCCESS", "CONNECTED" -> {
                                    val authElapsed = android.os.SystemClock.elapsedRealtime() - wsStartTimestamp
                                    reconnectAttempts = 0
                                    missedPings = 0
                                    lastFailedGatewayNodeId = null // Successful handshake clears failover exclusion
                                    lastPongReceivedAt = System.currentTimeMillis()
                                    lastPongElapsedRealtime = android.os.SystemClock.elapsedRealtime()
                                    lastHeartbeatTime = System.currentTimeMillis()
                                    if (msg.has("connectionId")) {
                                        activeConnectionId = msg.optString("connectionId")
                                    }
                                    if (msg.has("remoteEndpoint")) {
                                        activeRemoteEndpoint = msg.optString("remoteEndpoint")
                                    }
                                    Log.i(TAG, "[AUTH_SUCCESS] gen=$generation connId=$activeConnectionId remoteEndpoint=$activeRemoteEndpoint authElapsedMs=$authElapsed")
                                    emitState(STATE_CONNECTED)
                                    Log.i(TAG, "[STATE_CONNECTED] gen=$generation connId=$activeConnectionId startingPingTimer=true")
                                    startPingTimer(generation)
                                }
                                "AUTH_FAILURE" -> {
                                    val reason = msg.optString("reason", "Gateway authentication rejected")
                                    val isTransientTokenFailure = reason.contains("timeout", ignoreCase = true) ||
                                        reason.contains("revoked", ignoreCase = true) ||
                                        reason.contains("invalid", ignoreCase = true)

                                    Log.e(TAG, "[AUTH_FAILURE] gen=$generation reason=$reason isTransient=$isTransientTokenFailure attempt=$reconnectAttempts")
                                    AndroidErrorTelemetry.reportError(
                                        storedApiBaseUrl, storedSessionToken,
                                        AndroidErrorTelemetry.ErrorTelemetryPayload(
                                            component = "ANDROID_TUNNEL",
                                            errorCode = "GATEWAY_AUTH_FAILURE",
                                            errorType = "GatewayAuthenticationException",
                                            severity = if (isTransientTokenFailure) "WARNING" else "ERROR",
                                            message = "Gateway authentication failed: $reason",
                                            deviceId = storedDeviceId,
                                            gatewayNodeId = activeGatewayNodeId,
                                            connectionId = activeConnectionId,
                                            metadata = mapOf("reason" to reason, "isTransient" to isTransientTokenFailure, "generation" to generation)
                                        )
                                    )
                                    if (isTransientTokenFailure && !isExplicitlyStopped && reconnectAttempts < 5) {
                                        reconnectAttempts++
                                        emitState(STATE_RECONNECTING, "Gateway auth transient failure ($reason). Re-registering...")
                                        webSocket.close(1000, "Token refresh required")
                                        triggerReconnect()
                                    } else {
                                        emitState(STATE_AUTH_FAILED, reason)
                                        webSocket.close(1000, "Auth failure")
                                    }
                                }
                                "PONG" -> {
                                    missedPings = 0
                                    lastPongReceivedAt = System.currentTimeMillis()
                                    lastPongElapsedRealtime = android.os.SystemClock.elapsedRealtime()
                                    lastHeartbeatTime = System.currentTimeMillis()
                                    Log.d(TAG, "[PONG] gen=$generation")
                                }
                                "FILE_REQUEST" -> {
                                    lastHeartbeatTime = System.currentTimeMillis()
                                    handleInboundFileRequest(webSocket, msg)
                                }
                                "DISCONNECT" -> {
                                    Log.w(TAG, "[GATEWAY_DISCONNECT_MSG] gen=$generation activeGatewayNodeId=$activeGatewayNodeId")
                                    if (!isExplicitlyStopped) {
                                        if (reconnectAttempts >= 1 && !activeGatewayNodeId.isNullOrEmpty()) {
                                            lastFailedGatewayNodeId = activeGatewayNodeId
                                        }
                                        triggerReconnect()
                                    }
                                }
                            }
                        } catch (e: Exception) {
                            Log.e(TAG, "[MESSAGE_PARSE_EXCEPTION] gen=$generation msg=${e.message}", e)
                        }
                    }

                    override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                        Log.i(TAG, "[WEBSOCKET_CLOSING] gen=$generation code=$code reason=$reason")
                        webSocket.close(code, reason)
                    }

                    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                        Log.i(TAG, "[WEBSOCKET_CLOSED] gen=$generation code=$code reason=$reason")
                        if (generation == connectionGeneration.get() && !isExplicitlyStopped) {
                            if (reconnectAttempts >= 2 && !activeGatewayNodeId.isNullOrEmpty()) {
                                lastFailedGatewayNodeId = activeGatewayNodeId
                            }
                            triggerReconnect()
                        }
                    }

                    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                        Log.e(TAG, "[WEBSOCKET_FAILURE] gen=$generation responseCode=${response?.code} errorType=${t.javaClass.simpleName} errorMsg=${t.message}", t)
                        if (generation == connectionGeneration.get() && !isExplicitlyStopped) {
                            reconnectAttempts++
                            if (reconnectAttempts >= 2 && !activeGatewayNodeId.isNullOrEmpty()) {
                                lastFailedGatewayNodeId = activeGatewayNodeId
                            }
                            if (reconnectAttempts >= 3) {
                                AndroidErrorTelemetry.reportError(
                                    storedApiBaseUrl, storedSessionToken,
                                    AndroidErrorTelemetry.ErrorTelemetryPayload(
                                        component = "ANDROID_TUNNEL",
                                        errorCode = "GATEWAY_WEBSOCKET_FAILED",
                                        errorType = t.javaClass.simpleName,
                                        severity = "ERROR",
                                        message = "Gateway WebSocket connection failed repeatedly: ${t.message}",
                                        throwable = t,
                                        deviceId = storedDeviceId,
                                        gatewayNodeId = activeGatewayNodeId,
                                        connectionId = activeConnectionId,
                                        metadata = mapOf("responseCode" to (response?.code ?: 0), "attempt" to reconnectAttempts, "generation" to generation)
                                    )
                                )
                            }
                            emitState(STATE_RECONNECTING, "Gateway connection error: ${t.message}")
                            triggerReconnect()
                        }
                    }
                }

                okHttpClient.newWebSocket(wsRequest, wsListener)
            } catch (e: Exception) {
                Log.e(TAG, "[CONNECT_SEQUENCE_EXCEPTION] gen=$generation errorType=${e.javaClass.simpleName} errorMsg=${e.message}", e)
                AndroidErrorTelemetry.reportError(
                    storedApiBaseUrl, storedSessionToken,
                    AndroidErrorTelemetry.ErrorTelemetryPayload(
                        component = "ANDROID_TUNNEL",
                        errorCode = "TUNNEL_INIT_FAILED",
                        errorType = e.javaClass.simpleName,
                        severity = "ERROR",
                        message = "Tunnel connect sequence failed: ${e.message}",
                        throwable = e,
                        deviceId = storedDeviceId,
                        gatewayNodeId = activeGatewayNodeId,
                        connectionId = activeConnectionId,
                        metadata = mapOf("generation" to generation)
                    )
                )
                if (generation == connectionGeneration.get() && !isExplicitlyStopped) {
                    reconnectAttempts++
                    emitState(STATE_RECONNECTING, "Tunnel initialization error: ${e.message}")
                    triggerReconnect()
                }
            } finally {
                isConnectingOrReconnecting = false
            }
        }
    }

    private fun startPingTimer(generation: Long) {
        stopPingTimer()
        missedPings = 0
        lastPongReceivedAt = System.currentTimeMillis()
        lastPongElapsedRealtime = android.os.SystemClock.elapsedRealtime()

        pingFuture = scheduler.scheduleAtFixedRate({
            if (generation != connectionGeneration.get() || isExplicitlyStopped || currentState != STATE_CONNECTED) {
                stopPingTimer()
                return@scheduleAtFixedRate
            }

            // Monotonic silent heartbeat check: 2 missed pings or >35s without PONG
            val elapsedSincePong = android.os.SystemClock.elapsedRealtime() - lastPongElapsedRealtime
            if (missedPings >= 2 || (lastPongElapsedRealtime > 0 && elapsedSincePong > 35000L)) {
                Log.w(TAG, "[HEARTBEAT_FAILURE] gen=$generation missedPings=$missedPings elapsedSincePongMs=$elapsedSincePong. Triggering reconnect.")
                AndroidErrorTelemetry.reportError(
                    storedApiBaseUrl, storedSessionToken,
                    AndroidErrorTelemetry.ErrorTelemetryPayload(
                        component = "ANDROID_TUNNEL",
                        errorCode = "HEARTBEAT_TIMEOUT_FAILURE",
                        errorType = "HeartbeatTimeoutException",
                        severity = "WARNING",
                        message = "Heartbeat failure: $missedPings missed pings, >35s elapsed without PONG",
                        deviceId = storedDeviceId,
                        gatewayNodeId = activeGatewayNodeId,
                        connectionId = activeConnectionId,
                        metadata = mapOf("missedPings" to missedPings, "elapsedSincePongMs" to elapsedSincePong, "generation" to generation)
                    )
                )
                closeActiveWebSocket()
                triggerReconnect(immediate = true)
                return@scheduleAtFixedRate
            }

            try {
                val pingMsg = JSONObject().apply { put("type", "PING") }
                val sent = activeWebSocket?.send(pingMsg.toString()) ?: false
                if (sent) {
                    missedPings++
                }
            } catch (_: Exception) {
                closeActiveWebSocket()
                triggerReconnect(immediate = true)
            }
        }, 15, 15, TimeUnit.SECONDS)
    }

    private fun stopPingTimer() {
        try {
            pingFuture?.cancel(true)
            pingFuture = null
        } catch (_: Exception) {}
    }

    private fun closeActiveWebSocket() {
        try {
            activeWebSocket?.close(1000, "Tunnel closed")
        } catch (_: Exception) {}
        activeWebSocket = null
    }

    private fun handleInboundFileRequest(webSocket: WebSocket, req: JSONObject) {
        workerExecutor.execute {
            val requestId = req.optString("requestId")
            val operation = req.optString("operation")

            if (requestId.isEmpty() || operation.isEmpty()) return@execute

            try {
                val responseMsg = JSONObject().apply {
                    put("type", "FILE_RESPONSE")
                    put("requestId", requestId)
                }

                when (operation) {
                    "HEALTH" -> {
                        responseMsg.put("success", true)
                        responseMsg.put("data", JSONObject().apply {
                            put("status", "ok")
                            put("server", "native-remotenode-file-server")
                        })
                    }
                    "STORAGE" -> {
                        val localRes = executeLocalHttpGet("/api/storage")
                        copyLocalResultToResponse(localRes, responseMsg)
                    }
                    "RECENT" -> {
                        val localRes = executeLocalHttpGet("/api/files/recent")
                        copyLocalResultToResponse(localRes, responseMsg)
                    }
                    "PHOTOS" -> {
                        val localRes = executeLocalHttpGet("/api/files?type=photos")
                        copyLocalResultToResponse(localRes, responseMsg)
                    }
                    "VIDEOS" -> {
                        val localRes = executeLocalHttpGet("/api/files?type=videos")
                        copyLocalResultToResponse(localRes, responseMsg)
                    }
                    "DOCUMENTS" -> {
                        val localRes = executeLocalHttpGet("/api/files?type=documents")
                        copyLocalResultToResponse(localRes, responseMsg)
                    }
                    "LIST" -> {
                        val path = req.optString("path", "/")
                        val typeFilter = req.optString("type_filter")
                        val query = if (typeFilter.isNotEmpty()) {
                            "?path=${URLEncoder.encode(path, "UTF-8")}&type=$typeFilter"
                        } else {
                            "?path=${URLEncoder.encode(path, "UTF-8")}"
                        }
                        val localRes = executeLocalHttpGet("/api/files$query")
                        copyLocalResultToResponse(localRes, responseMsg)
                    }
                    "CREATE_FOLDER" -> {
                        val path = req.optString("path", "/")
                        val name = req.optString("name", "New Folder")
                        val body = JSONObject().apply {
                            put("path", path)
                            put("name", name)
                        }
                        val localRes = executeLocalHttpPost("/api/folders", body)
                        copyLocalResultToResponse(localRes, responseMsg)
                    }
                    "RENAME" -> {
                        val oldPath = req.optString("oldPath", "/")
                        val newName = req.optString("newName", "renamed")
                        val body = JSONObject().apply {
                            put("oldPath", oldPath)
                            put("newName", newName)
                        }
                        val localRes = executeLocalHttpPost("/api/rename", body)
                        copyLocalResultToResponse(localRes, responseMsg)
                    }
                    "DELETE" -> {
                        val path = req.optString("path", "/")
                        val body = JSONObject().apply { put("path", path) }
                        val localRes = executeLocalHttpDelete("/api/files", body)
                        copyLocalResultToResponse(localRes, responseMsg)
                    }
                    "UPLOAD" -> {
                        val path = req.optString("path", "/")
                        val name = req.optString("name", "file.dat")
                        val dataBase64 = req.optString("dataBase64")
                        if (dataBase64.isNotEmpty()) {
                            val bytes = Base64.decode(dataBase64, Base64.DEFAULT)
                            val uploadUrl = "$LOCAL_SERVER_BASE_URL/api/upload?path=${URLEncoder.encode(path, "UTF-8")}&filename=${URLEncoder.encode(name, "UTF-8")}"
                            val uConn = URL(uploadUrl).openConnection() as HttpURLConnection
                            uConn.requestMethod = "POST"
                            uConn.setRequestProperty("Content-Type", "application/octet-stream")
                            uConn.doOutput = true
                            uConn.outputStream.write(bytes)
                            val code = uConn.responseCode
                            val resBody = (if (code in 200..299) uConn.inputStream else uConn.errorStream)?.bufferedReader()?.use { it.readText() } ?: "{}"
                            uConn.disconnect()
                            val jsonRes = JSONObject(resBody)
                            copyLocalResultToResponse(jsonRes, responseMsg)
                        } else {
                            responseMsg.put("success", false)
                            responseMsg.put("error", JSONObject().apply { put("code", "EMPTY_PAYLOAD") })
                        }
                    }
                    "DOWNLOAD" -> {
                        var path = req.optString("path", "/")
                        while (path.startsWith("/") || path.startsWith("\\")) {
                            path = path.substring(1)
                        }
                        val dlUrl = "$LOCAL_SERVER_BASE_URL/api/download?path=${URLEncoder.encode(path, "UTF-8")}"
                        val dlConn = URL(dlUrl).openConnection() as HttpURLConnection
                        dlConn.requestMethod = "GET"
                        val code = dlConn.responseCode
                        if (code == 200 || code == 206) {
                            val bytes = dlConn.inputStream.use { it.readBytes() }
                            val dataBase64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                            val mimeType = dlConn.getHeaderField("Content-Type") ?: "application/octet-stream"
                            val filename = path.split("/").lastOrNull { it.isNotEmpty() } ?: "download"
                            dlConn.disconnect()

                            responseMsg.put("success", true)
                            responseMsg.put("filename", filename)
                            responseMsg.put("mimeType", mimeType)
                            responseMsg.put("dataBase64", dataBase64)
                        } else {
                            val errText = dlConn.errorStream?.bufferedReader()?.use { it.readText() } ?: "Download error"
                            dlConn.disconnect()
                            responseMsg.put("success", false)
                            responseMsg.put("error", JSONObject().apply {
                                put("code", "DOWNLOAD_HTTP_ERROR")
                                put("message", "Local server returned HTTP $code: $errText")
                            })
                        }
                    }
                    else -> {
                        responseMsg.put("success", true)
                        responseMsg.put("data", JSONObject().apply { put("items", JSONArray()) })
                    }
                }

                webSocket.send(responseMsg.toString())
            } catch (e: Exception) {
                try {
                    val errMsg = JSONObject().apply {
                        put("type", "FILE_RESPONSE")
                        put("requestId", requestId)
                        put("success", false)
                        put("error", JSONObject().apply {
                            put("code", "PROCESSING_ERROR")
                            put("message", e.message ?: "Native request processing error")
                        })
                    }
                    webSocket.send(errMsg.toString())
                } catch (_: Exception) {}
            }
        }
    }

    private fun copyLocalResultToResponse(localRes: JSONObject, target: JSONObject) {
        val success = localRes.optBoolean("success", true)
        target.put("success", success)
        if (localRes.has("data")) {
            target.put("data", localRes.get("data"))
        } else {
            target.put("data", localRes)
        }
        if (localRes.has("error")) {
            target.put("error", localRes.get("error"))
        }
    }

    private fun executeLocalHttpGet(path: String): JSONObject {
        return try {
            val url = URL("$LOCAL_SERVER_BASE_URL$path")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.connectTimeout = 10000
            conn.readTimeout = 10000
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: "{}"
            conn.disconnect()
            JSONObject(text)
        } catch (e: Exception) {
            JSONObject().apply {
                put("success", false)
                put("error", JSONObject().apply {
                    put("code", "LOCAL_ENGINE_UNAVAILABLE")
                    put("message", e.message ?: "Failed communicating with local storage engine")
                })
            }
        }
    }

    private fun executeLocalHttpPost(path: String, body: JSONObject): JSONObject {
        return try {
            val url = URL("$LOCAL_SERVER_BASE_URL$path")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            conn.connectTimeout = 10000
            conn.readTimeout = 10000
            conn.doOutput = true
            conn.outputStream.write(body.toString().toByteArray(StandardCharsets.UTF_8))
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: "{}"
            conn.disconnect()
            JSONObject(text)
        } catch (e: Exception) {
            JSONObject().apply {
                put("success", false)
                put("error", JSONObject().apply {
                    put("code", "LOCAL_ENGINE_UNAVAILABLE")
                    put("message", e.message ?: "Failed communicating with local storage engine")
                })
            }
        }
    }

    private fun executeLocalHttpDelete(path: String, body: JSONObject): JSONObject {
        return try {
            val url = URL("$LOCAL_SERVER_BASE_URL$path")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "DELETE"
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            conn.connectTimeout = 10000
            conn.readTimeout = 10000
            conn.doOutput = true
            conn.outputStream.write(body.toString().toByteArray(StandardCharsets.UTF_8))
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: "{}"
            conn.disconnect()
            JSONObject(text)
        } catch (e: Exception) {
            JSONObject().apply {
                put("success", false)
                put("error", JSONObject().apply {
                    put("code", "LOCAL_ENGINE_UNAVAILABLE")
                    put("message", e.message ?: "Failed communicating with local storage engine")
                })
            }
        }
    }
}
