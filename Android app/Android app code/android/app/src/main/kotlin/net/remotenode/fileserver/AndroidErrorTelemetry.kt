package net.remotenode.fileserver

import android.util.Log
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.PrintWriter
import java.io.StringWriter
import java.nio.charset.StandardCharsets
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Android Native Operational Error Telemetry Client (Phase 12.7)
 *
 * Provides safe, bounded, asynchronous, authenticated ingestion of native
 * operational errors (tunnel, local server, network watcher) to the central
 * Backend ErrorIngestionService (/api/v1/connections/telemetry/errors).
 *
 * Key Invariants:
 * - Telemetry is strictly observational and best-effort; failures in telemetry NEVER crash,
 *   block, interrupt, or alter the tunnel/server lifecycle.
 * - Zero transmission of session tokens, passwords, cookies, OTPs, or customer file contents.
 * - Client-side rate-limiting prevents error storms from flooding the backend during reconnect loops.
 * - String payloads are bounded (message <= 4000 chars, stackTrace <= 8000 chars).
 */
object AndroidErrorTelemetry {

    private const val TAG = "AndroidTelemetry"
    private const val MAX_MESSAGE_LENGTH = 4000
    private const val MAX_STACK_TRACE_LENGTH = 8000
    private const val RATE_LIMIT_WINDOW_MS = 60000L // 1 minute
    private const val MAX_EVENTS_PER_WINDOW = 10
    private const val MIN_INTERVAL_SAME_ERROR_MS = 10000L // 10 seconds between identical error codes

    private val executor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "AndroidTelemetry-Worker").apply { isDaemon = true }
    }

    private val okHttpClient = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .writeTimeout(5, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
        .retryOnConnectionFailure(false)
        .build()

    // Rate-limiting trackers
    private val lastReportedTimes = ConcurrentHashMap<String, Long>()
    private var windowStartMs = System.currentTimeMillis()
    private var windowEventCount = 0

    data class ErrorTelemetryPayload(
        val component: String = "ANDROID",
        val errorCode: String? = null,
        val errorType: String? = null,
        val severity: String? = "WARNING", // "INFO", "WARNING", "ERROR", "CRITICAL"
        val message: String,
        val throwable: Throwable? = null,
        val stackTrace: String? = null,
        val deviceId: String? = null,
        val serverInstanceId: String? = null,
        val gatewayNodeId: String? = null,
        val connectionId: String? = null,
        val sessionId: String? = null,
        val requestId: String? = null,
        val metadata: Map<String, Any?>? = null
    )

    /**
     * Reports an operational error event asynchronously in fail-safe background mode.
     */
    fun reportError(
        apiBaseUrl: String?,
        sessionToken: String?,
        payload: ErrorTelemetryPayload
    ) {
        if (apiBaseUrl.isNullOrEmpty() || sessionToken.isNullOrEmpty()) {
            return
        }

        executor.execute {
            try {
                if (!checkRateLimit(payload.errorCode)) {
                    Log.d(TAG, "[RATE_LIMITED] Telemetry event skipped for code=${payload.errorCode}")
                    return@execute
                }

                val fullStackTrace = payload.stackTrace ?: payload.throwable?.let { extractStackTrace(it) }
                val boundedMessage = sanitizeAndTruncate(payload.message, MAX_MESSAGE_LENGTH)
                val boundedStackTrace = fullStackTrace?.let { sanitizeAndTruncate(it, MAX_STACK_TRACE_LENGTH) }

                val jsonBody = JSONObject().apply {
                    put("component", payload.component)
                    if (!payload.errorCode.isNullOrEmpty()) put("errorCode", payload.errorCode)
                    if (!payload.errorType.isNullOrEmpty()) put("errorType", payload.errorType)
                    if (!payload.severity.isNullOrEmpty()) put("severity", payload.severity)
                    put("message", boundedMessage)
                    if (!boundedStackTrace.isNullOrEmpty()) put("stackTrace", boundedStackTrace)
                    if (!payload.deviceId.isNullOrEmpty()) put("deviceId", payload.deviceId)
                    if (!payload.serverInstanceId.isNullOrEmpty()) put("serverInstanceId", payload.serverInstanceId)
                    if (!payload.gatewayNodeId.isNullOrEmpty()) put("gatewayNodeId", payload.gatewayNodeId)
                    if (!payload.connectionId.isNullOrEmpty()) put("connectionId", payload.connectionId)
                    if (!payload.sessionId.isNullOrEmpty()) put("sessionId", payload.sessionId)
                    if (!payload.requestId.isNullOrEmpty()) put("requestId", payload.requestId)

                    val metaJson = JSONObject()
                    payload.metadata?.forEach { (key, value) ->
                        if (value != null && !isSensitiveKey(key)) {
                            metaJson.put(key, value.toString())
                        }
                    }
                    metaJson.put("platform", "Android")
                    metaJson.put("sdkVersion", android.os.Build.VERSION.SDK_INT)
                    put("metadata", metaJson)
                }

                val normalizedBaseUrl = apiBaseUrl.trimEnd('/')
                val url = "$normalizedBaseUrl/connections/telemetry/errors"

                val requestBody = jsonBody.toString().toRequestBody("application/json; charset=utf-8".toMediaTypeOrNull())
                val request = Request.Builder()
                    .url(url)
                    .addHeader("Authorization", "Bearer $sessionToken")
                    .post(requestBody)
                    .build()

                okHttpClient.newCall(request).execute().use { response ->
                    Log.d(TAG, "[TELEMETRY_SENT] code=${payload.errorCode} responseCode=${response.code}")
                }
            } catch (t: Throwable) {
                // Hard Invariant: Telemetry failure is completely silent and fail-safe
                Log.d(TAG, "[TELEMETRY_FAILED] best-effort error ignored: ${t.message}")
            }
        }
    }

    @Synchronized
    private fun checkRateLimit(errorCode: String?): Boolean {
        val now = System.currentTimeMillis()

        // Reset 1-minute window
        if (now - windowStartMs > RATE_LIMIT_WINDOW_MS) {
            windowStartMs = now
            windowEventCount = 0
        }

        if (windowEventCount >= MAX_EVENTS_PER_WINDOW) {
            return false
        }

        // Check throttle on same error code
        val key = errorCode ?: "UNKNOWN"
        val lastTime = lastReportedTimes[key] ?: 0L
        if (now - lastTime < MIN_INTERVAL_SAME_ERROR_MS) {
            return false
        }

        lastReportedTimes[key] = now
        windowEventCount++
        return true
    }

    private fun extractStackTrace(t: Throwable): String {
        val sw = StringWriter()
        val pw = PrintWriter(sw)
        t.printStackTrace(pw)
        return sw.toString()
    }

    private fun sanitizeAndTruncate(text: String, maxLength: Int): String {
        var sanitized = text
            .replace(Regex("(?i)bearer\\s+[A-Za-z0-9._~+/-]+"), "Bearer [REDACTED]")
            .replace(Regex("(?i)token=([^&\\s]+)"), "token=[REDACTED]")
            .replace(Regex("(?i)password=([^&\\s]+)"), "password=[REDACTED]")

        if (sanitized.length > maxLength) {
            sanitized = sanitized.substring(0, maxLength) + "... [TRUNCATED]"
        }
        return sanitized
    }

    private fun isSensitiveKey(key: String): Boolean {
        val lower = key.lowercase()
        return lower.contains("token") ||
            lower.contains("password") ||
            lower.contains("auth") ||
            lower.contains("cookie") ||
            lower.contains("secret") ||
            lower.contains("key")
    }
}
