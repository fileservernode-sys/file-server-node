package net.remotenode.fileserver

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.Handler
import android.os.Looper

/**
 * Robust Android Platform Network Transition Watcher using ConnectivityManager.NetworkCallback
 * Phase 11A.2: Detects network availability, validation, handoffs (Wi-Fi <-> Mobile), and loss.
 */
object NetworkWatcher {

    private var connectivityManager: ConnectivityManager? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private val listeners = java.util.concurrent.ConcurrentHashMap.newKeySet<(Map<String, Any>) -> Unit>()
    private val mainHandler = Handler(Looper.getMainLooper())

    @Volatile
    private var isRegistered = false

    @Volatile
    private var lastNetworkId: String? = null

    @Volatile
    private var lastTransport: String = "NONE"

    @Volatile
    private var lastValidated: Boolean = false

    @Volatile
    private var lastHasInternet: Boolean = false

    @Volatile
    private var lastCaptivePortal: Boolean = false

    fun addListener(listener: (Map<String, Any>) -> Unit) {
        listeners.add(listener)
    }

    fun removeListener(listener: (Map<String, Any>) -> Unit) {
        listeners.remove(listener)
    }

    @Deprecated("Use addListener instead to prevent listener collision")
    fun setEventListener(listener: ((Map<String, Any>) -> Unit)?) {
        if (listener != null) {
            addListener(listener)
        }
    }

    @Synchronized
    fun start(context: Context) {
        if (isRegistered) return

        try {
            val cm = context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            if (cm == null) return
            connectivityManager = cm

            val callback = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    val caps = cm.getNetworkCapabilities(network)
                    val netId = network.toString()
                    val transport = resolveTransport(caps)
                    val validated = isNetworkValidated(caps)
                    val hasInternet = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) ?: false
                    val isCaptive = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_CAPTIVE_PORTAL) ?: false
                    } else false

                    val transportChanged = lastTransport != transport
                    val validationChanged = lastValidated != validated

                    lastNetworkId = netId
                    lastTransport = transport
                    lastValidated = validated
                    lastHasInternet = hasInternet
                    lastCaptivePortal = isCaptive

                    emitEvent(mapOf(
                        "type" to "AVAILABLE",
                        "networkId" to netId,
                        "transport" to transport,
                        "hasInternet" to hasInternet,
                        "isValidated" to validated,
                        "isCaptivePortal" to isCaptive,
                        "transportChanged" to transportChanged,
                        "validationChanged" to validationChanged,
                        "timestamp" to System.currentTimeMillis()
                    ))
                }

                override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
                    val netId = network.toString()
                    val transport = resolveTransport(capabilities)
                    val validated = isNetworkValidated(capabilities)
                    val hasInternet = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    val isCaptive = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_CAPTIVE_PORTAL)
                    } else false

                    val transportChanged = lastTransport != transport
                    val validationChanged = lastValidated != validated
                    val internetChanged = lastHasInternet != hasInternet

                    lastNetworkId = netId
                    lastTransport = transport
                    lastValidated = validated
                    lastHasInternet = hasInternet
                    lastCaptivePortal = isCaptive

                    emitEvent(mapOf(
                        "type" to "CAPABILITIES_CHANGED",
                        "networkId" to netId,
                        "transport" to transport,
                        "hasInternet" to hasInternet,
                        "isValidated" to validated,
                        "isCaptivePortal" to isCaptive,
                        "transportChanged" to transportChanged,
                        "validationChanged" to validationChanged,
                        "internetChanged" to internetChanged,
                        "timestamp" to System.currentTimeMillis()
                    ))
                }

                override fun onLost(network: Network) {
                    val netId = network.toString()
                    if (lastNetworkId == netId) {
                        lastNetworkId = null
                        lastTransport = "NONE"
                        lastValidated = false
                        lastHasInternet = false
                        lastCaptivePortal = false
                    }

                    emitEvent(mapOf(
                        "type" to "LOST",
                        "networkId" to netId,
                        "transport" to "NONE",
                        "hasInternet" to false,
                        "isValidated" to false,
                        "isCaptivePortal" to false,
                        "timestamp" to System.currentTimeMillis()
                    ))
                }

                override fun onUnavailable() {
                    lastNetworkId = null
                    lastTransport = "NONE"
                    lastValidated = false
                    lastHasInternet = false
                    lastCaptivePortal = false

                    emitEvent(mapOf(
                        "type" to "UNAVAILABLE",
                        "transport" to "NONE",
                        "hasInternet" to false,
                        "isValidated" to false,
                        "isCaptivePortal" to false,
                        "timestamp" to System.currentTimeMillis()
                    ))
                }
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                cm.registerDefaultNetworkCallback(callback)
            } else {
                val request = NetworkRequest.Builder()
                    .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    .build()
                cm.registerNetworkCallback(request, callback)
            }

            networkCallback = callback
            isRegistered = true
        } catch (_: Exception) {}
    }

    @Synchronized
    fun stop() {
        if (!isRegistered) return
        try {
            networkCallback?.let {
                connectivityManager?.unregisterNetworkCallback(it)
            }
        } catch (_: Exception) {}
        networkCallback = null
        connectivityManager = null
        isRegistered = false
    }

    fun getCurrentNetworkInfo(context: Context): Map<String, Any> {
        try {
            val cm = context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                ?: return fallbackNetworkInfo()

            val activeNet = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                cm.activeNetwork
            } else {
                null
            }

            if (activeNet == null) {
                return fallbackNetworkInfo()
            }

            val caps = cm.getNetworkCapabilities(activeNet) ?: return fallbackNetworkInfo()
            val transport = resolveTransport(caps)
            val hasInternet = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            val validated = isNetworkValidated(caps)
            val isCaptive = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_CAPTIVE_PORTAL)
            } else false

            return mapOf(
                "networkId" to activeNet.toString(),
                "transport" to transport,
                "hasInternet" to hasInternet,
                "isValidated" to validated,
                "isCaptivePortal" to isCaptive,
                "isOnline" to (hasInternet && validated && !isCaptive)
            )
        } catch (_: Exception) {
            return fallbackNetworkInfo()
        }
    }

    private fun fallbackNetworkInfo(): Map<String, Any> {
        return mapOf(
            "networkId" to "unknown",
            "transport" to "NONE",
            "hasInternet" to false,
            "isValidated" to false,
            "isCaptivePortal" to false,
            "isOnline" to false
        )
    }

    private fun isNetworkValidated(capabilities: NetworkCapabilities?): Boolean {
        if (capabilities == null) return false
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
        } else {
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        }
    }

    private fun resolveTransport(capabilities: NetworkCapabilities?): String {
        if (capabilities == null) return "NONE"
        return when {
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "VPN"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "WIFI"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "CELLULAR"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ETHERNET"
            else -> "OTHER"
        }
    }

    private fun emitEvent(event: Map<String, Any>) {
        mainHandler.post {
            for (listener in listeners) {
                try {
                    listener(event)
                } catch (_: Exception) {}
            }
        }
    }
}
