package net.remotenode.fileserver.camera

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.camera2.CameraAccessException
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import net.remotenode.fileserver.PlatformSupervisorService

/**
 * CameraEngineHandler — Native Android Camera Platform Channel Handler (Phase 21.3 / 21.4)
 *
 * Implements:
 * 1. Native camera capability discovery via Camera2 CameraCharacteristics.
 * 2. Granular runtime permission flows for CAMERA and RECORD_AUDIO.
 * 3. Native camera capture engine control (startCapture, stopCapture, switchCamera, getCaptureState).
 * 4. Flutter TextureRegistry integration returning hardware-accelerated textureId.
 * 5. Multi-surface pipeline delivering frames to preview and MediaCodec H.264 surface encoder.
 *
 * ARCHITECTURAL SAFETY GUARANTEES:
 * 1. Hardware capability discovery strictly reads HAL metadata and NEVER opens a camera device.
 * 2. Logical cameras vs physical camera sensors are distinguished (API 28+).
 * 3. Permission callbacks are completed exactly once without concurrency leaks.
 * 4. Camera capture engine manages state transitions: IDLE, OPENING, CONFIGURING, CAPTURING, STOPPING, ERROR.
 * 5. Monotonic session generation discards stale callbacks on stop or switch.
 * 6. Decoupled from network streaming: frames remain local and camera is NOT reported as streaming.
 * 7. Storage engine, channels, and credentials are completely isolated and untouched.
 */
class CameraEngineHandler(
    private val activity: Activity,
    private val flutterEngine: FlutterEngine
) : MethodChannel.MethodCallHandler {

    companion object {
        const val CHANNEL_NAME = "camera_engine"
        const val LEGACY_CHANNEL_NAME = "net.remotenode.fileserver/camera_engine"

        const val REQUEST_CAMERA_PERMISSION = 201
        const val REQUEST_RECORD_AUDIO_PERMISSION = 202

        private const val PREFS_CAMERA_PERMS = "net.remotenode.camera_permissions"
        private const val KEY_CAMERA_REQUEST_COUNT = "camera_request_count"
        private const val KEY_MIC_REQUEST_COUNT = "mic_request_count"
        private const val KEY_CAMERA_REQUESTED_BEFORE = "camera_requested_before"
        private const val KEY_MIC_REQUESTED_BEFORE = "mic_requested_before"

        @Volatile
        private var instance: CameraEngineHandler? = null

        fun register(activity: Activity, flutterEngine: FlutterEngine): CameraEngineHandler {
            val handler = CameraEngineHandler(activity, flutterEngine)
            instance = handler

            // Register primary channel as specified in Phase 21.3 / 21.4
            val primaryChannel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL_NAME)
            primaryChannel.setMethodCallHandler(handler)
            handler.primaryChannel = primaryChannel

            // Register namespaced alias for symmetry with server_engine and secure_storage
            val legacyChannel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, LEGACY_CHANNEL_NAME)
            legacyChannel.setMethodCallHandler(handler)
            handler.legacyChannel = legacyChannel

            return handler
        }

        fun handleRequestPermissionsResult(
            requestCode: Int,
            permissions: Array<out String>,
            grantResults: IntArray
        ): Boolean {
            return instance?.onRequestPermissionsResult(requestCode, permissions, grantResults) ?: false
        }

        fun cleanUp() {
            instance?.cleanUp()
            instance = null
        }
    }

    private var primaryChannel: MethodChannel? = null
    private var legacyChannel: MethodChannel? = null
    private var pendingCameraResult: MethodChannel.Result? = null
    private var pendingMicResult: MethodChannel.Result? = null

    val captureStateListener: CaptureStateListener = object : CaptureStateListener {
        override fun onStateChanged(state: CaptureState, metadata: Map<String, Any?>) {
            if (state == CaptureState.IDLE || state == CaptureState.ERROR) {
                PlatformSupervisorService.onCameraStopped(activity.applicationContext)
            }
            activity.runOnUiThread {
                try {
                    primaryChannel?.invokeMethod("onCaptureStateChanged", metadata)
                    legacyChannel?.invokeMethod("onCaptureStateChanged", metadata)
                } catch (_: Exception) {}
            }
        }

        override fun onError(errorCode: String, errorMessage: String) {
            PlatformSupervisorService.onCameraStopped(activity.applicationContext)
            activity.runOnUiThread {
                try {
                    val payload = mapOf(
                        "code" to errorCode,
                        "message" to errorMessage
                    )
                    primaryChannel?.invokeMethod("onCaptureError", payload)
                    legacyChannel?.invokeMethod("onCaptureError", payload)
                } catch (_: Exception) {}
            }
        }
    }

    // Native Camera2 Capture Engine (Phase 21.4 / 21.5.1.1)
    // Strong service ownership managed via PlatformSupervisorService.
    // If an engine is already running in the background supervisor, reuse it.
    private val captureEngine: CameraCaptureEngine =
        PlatformSupervisorService.getActiveCameraEngine() ?: CameraCaptureEngine(
            context = activity.applicationContext,
            flutterEngine = flutterEngine,
            stateListener = captureStateListener
        ).also {
            PlatformSupervisorService.attachActiveCameraEngine(it)
        }

    init {
        captureEngine.stateListener = captureStateListener
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "checkCameraPermission" -> checkCameraPermission(result)
            "requestCameraPermission" -> requestCameraPermission(result)
            "checkMicrophonePermission" -> checkMicrophonePermission(result)
            "requestMicrophonePermission" -> requestMicrophonePermission(result)
            "openAppSettings" -> openAppSettings(result)
            "discoverCameras", "getCameraCapabilities" -> discoverCameras(result)
            "startCapture" -> handleStartCapture(call, result)
            "stopCapture" -> handleStopCapture(result)
            "switchCamera" -> handleSwitchCamera(call, result)
            "getCaptureState" -> handleGetCaptureState(result)
            else -> result.notImplemented()
        }
    }

    private fun handleStartCapture(call: MethodCall, result: MethodChannel.Result) {
        // Step 1: Validate runtime camera permission
        val isGranted = ContextCompat.checkSelfPermission(
            activity,
            Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED
        if (!isGranted) {
            result.error("PERMISSION_DENIED", "Camera permission is required to start camera capture", null)
            return
        }

        val cameraId = call.argument<String>("cameraId")
        val width = call.argument<Int>("width") ?: 1280
        val height = call.argument<Int>("height") ?: 720
        val fps = call.argument<Int>("fps") ?: 30
        val enableEncoder = call.argument<Boolean>("enableEncoder") ?: true

        // Step 2: Request foreground promotion with CAMERA service type.
        // Camera2 is NOT opened until PlatformSupervisorService confirms successful FGS promotion!
        PlatformSupervisorService.requestCameraForegroundPromotion(activity) { success, errorCode, errorMessage ->
            activity.runOnUiThread {
                if (!success) {
                    val code = errorCode ?: "CAMERA_FGS_REJECTED"
                    val msg = errorMessage ?: "Foreground service promotion failed for camera"
                    result.error(code, msg, null)
                    return@runOnUiThread
                }

                // Step 3: ONLY AFTER SUCCESSFUL PROMOTION, open Camera2 hardware and start capture
                try {
                    val metadata = captureEngine.startCapture(
                        targetCameraId = cameraId,
                        width = width,
                        height = height,
                        fps = fps,
                        enableEncoder = enableEncoder
                    )
                    PlatformSupervisorService.attachActiveCameraEngine(captureEngine)
                    result.success(metadata)
                } catch (e: SecurityException) {
                    PlatformSupervisorService.onCameraStopped(activity.applicationContext)
                    result.error("PERMISSION_DENIED", e.message, null)
                } catch (e: IllegalArgumentException) {
                    PlatformSupervisorService.onCameraStopped(activity.applicationContext)
                    result.error("INVALID_CONFIGURATION", e.message, null)
                } catch (e: Exception) {
                    PlatformSupervisorService.onCameraStopped(activity.applicationContext)
                    result.error("CAPTURE_ERROR", e.localizedMessage, mapOf("cause" to e.javaClass.simpleName))
                }
            }
        }
    }

    private fun handleStopCapture(result: MethodChannel.Result) {
        try {
            PlatformSupervisorService.onCameraStopped(activity.applicationContext)
            val stopped = captureEngine.stopCapture()
            result.success(stopped)
        } catch (e: Exception) {
            result.error("STOP_CAPTURE_FAILED", e.localizedMessage, null)
        }
    }

    private fun handleSwitchCamera(call: MethodCall, result: MethodChannel.Result) {
        val cameraId = call.argument<String>("cameraId")
        if (cameraId == null) {
            result.error("INVALID_ARGUMENTS", "cameraId is required to switch camera", null)
            return
        }
        val width = call.argument<Int>("width") ?: 1280
        val height = call.argument<Int>("height") ?: 720
        val fps = call.argument<Int>("fps") ?: 30

        try {
            val metadata = captureEngine.switchCamera(cameraId, width, height, fps)
            result.success(metadata)
        } catch (e: Exception) {
            result.error("SWITCH_CAMERA_FAILED", e.localizedMessage, null)
        }
    }

    private fun handleGetCaptureState(result: MethodChannel.Result) {
        try {
            result.success(captureEngine.getCaptureMetadata())
        } catch (e: Exception) {
            result.error("GET_CAPTURE_STATE_FAILED", e.localizedMessage, null)
        }
    }

    fun cleanUp() {
        // If Camera capture is active under PlatformSupervisorService, preserve running engine!
        // Do NOT call stopCapture() or release() on the service-owned engine during Activity teardown.
        if (!PlatformSupervisorService.isCameraActive) {
            PlatformSupervisorService.detachActiveCameraEngine()
            captureEngine.release()
        } else {
            // Decouple listener to prevent leaking destroyed Activity Context
            captureEngine.stateListener = null
        }
        primaryChannel?.setMethodCallHandler(null)
        legacyChannel?.setMethodCallHandler(null)
        primaryChannel = null
        legacyChannel = null
    }

    private fun checkCameraPermission(result: MethodChannel.Result) {
        val isGranted = ContextCompat.checkSelfPermission(
            activity,
            Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED

        if (isGranted) {
            result.success("granted")
            return
        }

        val prefs = activity.getSharedPreferences(PREFS_CAMERA_PERMS, Context.MODE_PRIVATE)
        val requestCount = prefs.getInt(KEY_CAMERA_REQUEST_COUNT, if (prefs.getBoolean(KEY_CAMERA_REQUESTED_BEFORE, false)) 1 else 0)
        val shouldShowRationale = ActivityCompat.shouldShowRequestPermissionRationale(
            activity,
            Manifest.permission.CAMERA
        )

        if (requestCount > 0 && !shouldShowRationale) {
            result.success("permanently_denied")
        } else {
            result.success("denied")
        }
    }

    private fun requestCameraPermission(result: MethodChannel.Result) {
        val isGranted = ContextCompat.checkSelfPermission(
            activity,
            Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED

        if (isGranted) {
            result.success("granted")
            return
        }

        if (pendingCameraResult != null) {
            result.error("CONCURRENT_REQUEST", "A camera permission request is already in progress", null)
            return
        }

        pendingCameraResult = result
        ActivityCompat.requestPermissions(
            activity,
            arrayOf(Manifest.permission.CAMERA),
            REQUEST_CAMERA_PERMISSION
        )
    }

    private fun checkMicrophonePermission(result: MethodChannel.Result) {
        val isGranted = ContextCompat.checkSelfPermission(
            activity,
            Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED

        if (isGranted) {
            result.success("granted")
            return
        }

        val prefs = activity.getSharedPreferences(PREFS_CAMERA_PERMS, Context.MODE_PRIVATE)
        val requestCount = prefs.getInt(KEY_MIC_REQUEST_COUNT, if (prefs.getBoolean(KEY_MIC_REQUESTED_BEFORE, false)) 1 else 0)
        val shouldShowRationale = ActivityCompat.shouldShowRequestPermissionRationale(
            activity,
            Manifest.permission.RECORD_AUDIO
        )

        if (requestCount > 0 && !shouldShowRationale) {
            result.success("permanently_denied")
        } else {
            result.success("denied")
        }
    }

    private fun requestMicrophonePermission(result: MethodChannel.Result) {
        val isGranted = ContextCompat.checkSelfPermission(
            activity,
            Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED

        if (isGranted) {
            result.success("granted")
            return
        }

        if (pendingMicResult != null) {
            result.error("CONCURRENT_REQUEST", "A microphone permission request is already in progress", null)
            return
        }

        pendingMicResult = result
        ActivityCompat.requestPermissions(
            activity,
            arrayOf(Manifest.permission.RECORD_AUDIO),
            REQUEST_RECORD_AUDIO_PERMISSION
        )
    }

    private fun openAppSettings(result: MethodChannel.Result) {
        try {
            val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.fromParts("package", activity.packageName, null)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            activity.startActivity(intent)
            result.success(true)
        } catch (e: Exception) {
            result.error("OPEN_SETTINGS_FAILED", e.localizedMessage, null)
        }
    }

    private fun discoverCameras(result: MethodChannel.Result) {
        val cameraManager = activity.getSystemService(Context.CAMERA_SERVICE) as? CameraManager
        if (cameraManager == null) {
            result.success(emptyList<Map<String, Any?>>())
            return
        }

        try {
            val cameraIds = cameraManager.cameraIdList
            if (cameraIds.isEmpty()) {
                result.success(emptyList<Map<String, Any?>>())
                return
            }

            val discoveredList = mutableListOf<Map<String, Any?>>()

            for (id in cameraIds) {
                try {
                    val characteristics = cameraManager.getCameraCharacteristics(id)

                    val facing = characteristics.get(CameraCharacteristics.LENS_FACING)
                    val lensFacing = when (facing) {
                        CameraCharacteristics.LENS_FACING_FRONT -> "FRONT"
                        CameraCharacteristics.LENS_FACING_BACK -> "BACK"
                        CameraCharacteristics.LENS_FACING_EXTERNAL -> "EXTERNAL"
                        else -> "UNKNOWN"
                    }

                    val sensorOrientation = characteristics.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 0
                    val flashAvailable = characteristics.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) ?: false

                    val hardwareLevelInt = characteristics.get(CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL)
                    val hardwareLevel = when (hardwareLevelInt) {
                        CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LEGACY -> "LEGACY"
                        CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LIMITED -> "LIMITED"
                        CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_FULL -> "FULL"
                        CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_3 -> "LEVEL_3"
                        else -> "UNKNOWN"
                    }

                    var isLogical = false
                    val physicalCameraIds = mutableListOf<String>()

                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                        val capabilities = characteristics.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES)
                        val hasLogicalMultiCamera = capabilities?.contains(
                            CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_LOGICAL_MULTI_CAMERA
                        ) ?: false

                        val physSet = characteristics.physicalCameraIds
                        if (hasLogicalMultiCamera || physSet.isNotEmpty()) {
                            isLogical = true
                            physicalCameraIds.addAll(physSet)
                        }
                    }

                    val streamConfigMap = characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
                    val resolutionList = mutableListOf<Map<String, Any?>>()

                    if (streamConfigMap != null) {
                        val surfaceTextureSizes = streamConfigMap.getOutputSizes(android.graphics.SurfaceTexture::class.java)

                        if (surfaceTextureSizes != null) {
                            val sortedSizes = surfaceTextureSizes.sortedWith(
                                compareByDescending<android.util.Size> { it.width * it.height }
                                    .thenByDescending { it.width }
                            )

                            for (size in sortedSizes) {
                                val minDurationNs = streamConfigMap.getOutputMinFrameDuration(
                                    android.graphics.SurfaceTexture::class.java,
                                    size
                                )
                                val maxFps = if (minDurationNs > 0L) {
                                    (1_000_000_000.0 / minDurationNs).toInt()
                                } else {
                                    null
                                }

                                resolutionList.add(mapOf(
                                    "width" to size.width,
                                    "height" to size.height,
                                    "format" to "SurfaceTexture",
                                    "maxFps" to maxFps,
                                    "isVerified" to (maxFps != null)
                                ))
                            }
                        }
                    }

                    val fpsRanges = characteristics.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES)
                    val fpsList = mutableListOf<Map<String, Int>>()

                    if (fpsRanges != null) {
                        for (range in fpsRanges) {
                            fpsList.add(mapOf(
                                "min" to range.lower,
                                "max" to range.upper
                            ))
                        }
                    }

                    discoveredList.add(mapOf(
                        "cameraId" to id,
                        "lensFacing" to lensFacing,
                        "sensorOrientation" to sensorOrientation,
                        "isLogical" to isLogical,
                        "physicalCameraIds" to physicalCameraIds,
                        "resolutions" to resolutionList,
                        "fpsRanges" to fpsList,
                        "hasFlash" to flashAvailable,
                        "hardwareLevel" to hardwareLevel
                    ))
                } catch (e: Exception) {
                    // Gracefully skip any camera ID that fails characteristic retrieval
                }
            }

            result.success(discoveredList)
        } catch (e: Exception) {
            result.error("CAMERA_DISCOVERY_ERROR", e.localizedMessage, mapOf("cause" to e.javaClass.simpleName))
        }
    }

    fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ): Boolean {
        when (requestCode) {
            REQUEST_CAMERA_PERMISSION -> {
                val callback = pendingCameraResult
                pendingCameraResult = null
                if (callback == null) return true

                val prefs = activity.getSharedPreferences(PREFS_CAMERA_PERMS, Context.MODE_PRIVATE)
                val previousRequestCount = prefs.getInt(KEY_CAMERA_REQUEST_COUNT, if (prefs.getBoolean(KEY_CAMERA_REQUESTED_BEFORE, false)) 1 else 0)
                prefs.edit().putInt(KEY_CAMERA_REQUEST_COUNT, previousRequestCount + 1).apply()

                val granted = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
                if (granted) {
                    callback.success("granted")
                } else {
                    val shouldShow = ActivityCompat.shouldShowRequestPermissionRationale(
                        activity,
                        Manifest.permission.CAMERA
                    )
                    if (previousRequestCount > 0 && !shouldShow) {
                        callback.success("permanently_denied")
                    } else {
                        callback.success("denied")
                    }
                }
                return true
            }
            REQUEST_RECORD_AUDIO_PERMISSION -> {
                val callback = pendingMicResult
                pendingMicResult = null
                if (callback == null) return true

                val prefs = activity.getSharedPreferences(PREFS_CAMERA_PERMS, Context.MODE_PRIVATE)
                val previousRequestCount = prefs.getInt(KEY_MIC_REQUEST_COUNT, if (prefs.getBoolean(KEY_MIC_REQUESTED_BEFORE, false)) 1 else 0)
                prefs.edit().putInt(KEY_MIC_REQUEST_COUNT, previousRequestCount + 1).apply()

                val granted = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
                if (granted) {
                    callback.success("granted")
                } else {
                    val shouldShow = ActivityCompat.shouldShowRequestPermissionRationale(
                        activity,
                        Manifest.permission.RECORD_AUDIO
                    )
                    if (previousRequestCount > 0 && !shouldShow) {
                        callback.success("permanently_denied")
                    } else {
                        callback.success("denied")
                    }
                }
                return true
            }
        }
        return false
    }
}
