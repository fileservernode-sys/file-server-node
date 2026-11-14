package net.remotenode.fileserver.camera

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.SurfaceTexture
import android.hardware.camera2.*
import android.hardware.camera2.params.OutputConfiguration
import android.hardware.camera2.params.SessionConfiguration
import android.hardware.camera2.params.StreamConfigurationMap
import android.media.MediaFormat
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import android.util.Range
import android.util.Size
import android.view.Surface
import androidx.core.content.ContextCompat
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.view.TextureRegistry

/**
 * CaptureState — Explicit Camera2 Capture Lifecycle State Machine (Phase 21.4 / 21.4.1 / 21.4.2 / 21.4.3 / 21.4.4).
 */
enum class CaptureState {
    IDLE,
    OPENING,
    CONFIGURING,
    CAPTURING,
    STOPPING,
    ERROR;

    val isCapturing: Boolean
        get() = this == CAPTURING
}

/**
 * CaptureStateListener — Callback interface for notifying Flutter and handlers
 * of native camera lifecycle changes, errors, and encoded frame events.
 */
interface CaptureStateListener {
    fun onStateChanged(state: CaptureState, metadata: Map<String, Any?>)
    fun onError(errorCode: String, errorMessage: String)
}

/**
 * CameraCaptureEngine — Native Android Camera2 Hardware Capture Engine (Phase 21.4.4.2).
 *
 * Concurrency & Ownership Architecture (Phase 21.4.4.2):
 * 1. Atomic Generation & Ownership: All generation advancement, active-context replacement,
 *    and state transitions are serialized via `CaptureGenerationCoordinator` under `stateLock`.
 * 2. Atomic Resource Registration: All asynchronous resource creation (CameraDevice, CameraCaptureSession,
 *    MediaCodecEncoder, SurfaceTexture, Flutter TextureEntry) must register atomically with its owning
 *    context via typed methods (`attachCameraDevice`, `attachCaptureSession`, etc.).
 * 3. Deterministic Single-Owner Outcome: If a context has already been stopped or claimed by cleanup,
 *    incoming resources are rejected immediately and disposed outside all locks. No orphaned resources.
 * 4. Context-Lock-Free Disposal: `CaptureSessionContext.releaseAll()` detaches and nulls all resources
 *    under `cleanupLock`, then releases `cleanupLock` before performing any native hardware teardown.
 * 5. Deterministic Preview Readiness vs. Timeout Arbitration: If preview frames arrive before or
 *    with a timeout, the coordinator atomically confirms readiness and prevents capture termination.
 */
class CameraCaptureEngine(
    private val context: Context,
    private val flutterEngine: FlutterEngine,
    stateListener: CaptureStateListener? = null
) {
    companion object {
        private const val TAG = "CameraCaptureEngine"
        private const val FRAME_START_TIMEOUT_MS = 5000L
    }

    private val cameraManager = context.applicationContext.getSystemService(Context.CAMERA_SERVICE) as CameraManager
    private val coordinator = CaptureGenerationCoordinator(stateListener)

    var stateListener: CaptureStateListener? = stateListener
        set(value) {
            field = value
            coordinator.stateListener = value
        }

    // Background Threading
    private var backgroundThread: HandlerThread? = null
    private var backgroundHandler: Handler? = null

    val state: CaptureState
        get() = coordinator.state

    val activeTextureId: Long?
        get() = coordinator.activeTextureId

    fun getCaptureMetadata(): Map<String, Any?> = coordinator.getCaptureMetadata()

    private fun startBackgroundThread() {
        if (backgroundThread == null) {
            val thread = HandlerThread("ZdexCameraBackground").apply { start() }
            backgroundThread = thread
            backgroundHandler = Handler(thread.looper)
        }
    }

    private fun stopBackgroundThread() {
        backgroundThread?.quitSafely()
        try {
            backgroundThread?.join(300)
        } catch (_: InterruptedException) {}
        backgroundThread = null
        backgroundHandler = null
    }

    /**
     * Validates HAL capabilities and evaluates stream configuration map.
     */
    private fun validateConfiguration(
        cameraId: String,
        width: Int,
        height: Int,
        fps: Int
    ): Pair<CameraCharacteristics, Range<Int>> {
        val characteristics = cameraManager.getCameraCharacteristics(cameraId)

        val streamConfigMap = characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
            ?: throw IllegalArgumentException("Camera $cameraId has no stream configuration map")

        val supportedSizes = streamConfigMap.getOutputSizes(SurfaceTexture::class.java)
            ?: throw IllegalArgumentException("Camera $cameraId does not support SurfaceTexture output")

        val sizeMatches = supportedSizes.any {
            (it.width == width && it.height == height) || (it.width == height && it.height == width)
        }
        if (!sizeMatches) {
            throw IllegalArgumentException("Unsupported resolution ${width}x${height} for camera $cameraId")
        }

        val fpsRanges = characteristics.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES)
            ?: emptyArray()

        var bestRange: Range<Int>? = null
        for (range in fpsRanges) {
            if (range.upper == fps) {
                bestRange = range
                break
            }
        }
        if (bestRange == null) {
            for (range in fpsRanges) {
                if (fps >= range.lower && fps <= range.upper) {
                    bestRange = range
                    break
                }
            }
        }
        if (bestRange == null && fpsRanges.isNotEmpty()) {
            bestRange = fpsRanges.maxByOrNull { it.upper }
        }
        if (bestRange == null) {
            bestRange = Range(fps, fps)
        }

        return Pair(characteristics, bestRange)
    }

    /**
     * Verifies whether dual-surface session configuration is supported on Android P+ (API 28+).
     */
    private fun isDualSurfaceSessionSupported(
        camera: CameraDevice,
        previewSurface: Surface,
        encoderSurface: Surface
    ): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                val outputConfigs = listOf(
                    OutputConfiguration(previewSurface),
                    OutputConfiguration(encoderSurface)
                )
                val sessionConfig = SessionConfiguration(
                    SessionConfiguration.SESSION_REGULAR,
                    outputConfigs,
                    context.mainExecutor,
                    object : CameraCaptureSession.StateCallback() {
                        override fun onConfigured(session: CameraCaptureSession) {}
                        override fun onConfigureFailed(session: CameraCaptureSession) {}
                    }
                )
                val supported = camera.isSessionConfigurationSupported(sessionConfig)
                Log.i(TAG, "isSessionConfigurationSupported for dual-surface returned: $supported")
                return supported
            } catch (e: Exception) {
                Log.w(TAG, "isSessionConfigurationSupported query failed: ${e.message}")
            }
        }
        return true
    }

    /**
     * Starts native camera capture with generation atomicity, decoupled resource teardown,
     * atomic resource attachment, and bounded availability timeout.
     */
    @SuppressLint("MissingPermission")
    fun startCapture(
        targetCameraId: String? = null,
        width: Int = 1280,
        height: Int = 720,
        fps: Int = 30,
        enableEncoder: Boolean = true
    ): Map<String, Any?> {
        val hasPermission = ContextCompat.checkSelfPermission(
            context.applicationContext,
            Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED

        if (!hasPermission) {
            val err = "Camera permission not granted"
            coordinator.transitionState(CaptureState.ERROR, err)
            stateListener?.onError("PERMISSION_DENIED", err)
            throw SecurityException(err)
        }

        val selectedId = targetCameraId ?: coordinator.currentCameraId ?: run {
            val list = cameraManager.cameraIdList
            if (list.isEmpty()) throw IllegalStateException("No cameras available on device")
            list[0]
        }

        // 1. Advance generation and replace active context atomically under coordinator lock
        val (sessionCtx, oldCtxToRelease) = coordinator.advanceGeneration(selectedId, width, height, fps)

        // 2. Perform native teardown of superseded generation OUTSIDE of lock to prevent HandlerThread deadlocks
        oldCtxToRelease?.releaseAll()

        // 3. If already capturing with matching configuration, return existing state immediately
        if (sessionCtx === coordinator.activeContext && coordinator.state == CaptureState.CAPTURING) {
            Log.i(TAG, "startCapture called while already CAPTURING with same configuration. Returning existing state.")
            return coordinator.getCaptureMetadata()
        }

        try {
            val (characteristics, aeFpsRange) = validateConfiguration(selectedId, width, height, fps)

            val facing = characteristics.get(CameraCharacteristics.LENS_FACING)
            val lens = when (facing) {
                CameraCharacteristics.LENS_FACING_FRONT -> "FRONT"
                CameraCharacteristics.LENS_FACING_BACK -> "BACK"
                CameraCharacteristics.LENS_FACING_EXTERNAL -> "EXTERNAL"
                else -> "UNKNOWN"
            }
            val orientation = characteristics.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 0
            coordinator.updateHardwareInfo(lens, orientation)

            startBackgroundThread()
            val handler = backgroundHandler ?: throw IllegalStateException("Background handler failed to start")

            // Bounded frame availability timeout runnable with strict generation isolation & deterministic arbitration (Phase 21.4.4)
            val timeoutRunnable = Runnable {
                val (errCode, msg) = if (sessionCtx.hasStartedCaptureRequest) {
                    Pair("PREVIEW_FRAME_TIMEOUT", "Camera preview frame timed out after capture request started")
                } else {
                    Pair("FRAME_START_TIMEOUT", "Camera hardware timed out waiting for initial frame start")
                }

                val resolution = coordinator.handleTimeout(sessionCtx, errCode, msg)
                when (resolution) {
                    TimeoutResolution.ACTIVELY_TIMED_OUT -> {
                        Log.e(TAG, "Timeout: $msg (gen=${sessionCtx.generation}, camera=$selectedId)")
                        sessionCtx.releaseAll()
                        stateListener?.onError(errCode, msg)
                    }
                    TimeoutResolution.PREVIEW_ALREADY_VERIFIED -> {
                        Log.i(TAG, "Timeout callback for gen ${sessionCtx.generation} ignored: preview frame already verified")
                    }
                    TimeoutResolution.STALE_SESSION_IGNORED -> {
                        Log.i(TAG, "Stale timeout callback for gen ${sessionCtx.generation} ignored; active generation is ${coordinator.generation}")
                        sessionCtx.releaseAll()
                    }
                }
            }

            // Atomically attach timeout to context
            val timeoutAttached = sessionCtx.attachTimeout(timeoutRunnable, handler)
            if (timeoutAttached) {
                coordinator.setActiveTimeout(timeoutRunnable)
                handler.postDelayed(timeoutRunnable, FRAME_START_TIMEOUT_MS)
            }

            // Allocate Flutter zero-copy surface texture
            val entry = flutterEngine.renderer.createSurfaceTexture()
            val surfaceTexture = entry.surfaceTexture()
            surfaceTexture.setDefaultBufferSize(width, height)
            val previewSrf = Surface(surfaceTexture)

            // Atomically attach preview resources; if context was stopped/cleaned up, they are immediately disposed
            val previewAttached = sessionCtx.attachPreviewResources(entry, surfaceTexture, previewSrf)
            if (!previewAttached) {
                Log.w(TAG, "Preview resources rejected for generation ${sessionCtx.generation}: context already stopped or cleaned up")
                return coordinator.getCaptureMetadata()
            }

            // Register OnFrameAvailableListener on SurfaceTexture tied strictly to this generation
            surfaceTexture.setOnFrameAvailableListener(object : SurfaceTexture.OnFrameAvailableListener {
                override fun onFrameAvailable(st: SurfaceTexture) {
                    val isReady = coordinator.onPreviewFrameAvailable(sessionCtx)
                    if (isReady) {
                        sessionCtx.timeoutRunnable?.let { handler.removeCallbacks(it) }
                    }
                }
            }, handler)

            // Attempt MediaCodec H.264 Encoder preparation
            if (enableEncoder && coordinator.isGenerationActive(sessionCtx)) {
                try {
                    val encoder = MediaCodecEncoder(
                        width = width,
                        height = height,
                        fps = fps,
                        listener = object : EncodedFrameListener {
                            override fun onCodecConfig(spsPpsData: ByteArray) {
                                Log.d(TAG, "MediaCodec SPS/PPS config received (${spsPpsData.size} bytes)")
                            }

                            override fun onEncodedFrame(data: ByteArray, isKeyFrame: Boolean, timestampUs: Long) {}

                            override fun onFormatChanged(format: MediaFormat) {
                                Log.i(TAG, "MediaCodec output format changed: $format")
                            }

                            override fun onEncoderError(errorCode: String, message: String) {
                                if (!coordinator.isGenerationActive(sessionCtx)) return
                                Log.w(TAG, "MediaCodec encoder runtime error: $message. Falling back to preview-only.")
                                sessionCtx.releaseEncoderOnly()
                            }
                        }
                    )
                    // Atomically attach encoder; if rejected, encoder and its surface are immediately disposed
                    val encAttached = sessionCtx.attachEncoder(encoder, encoder.inputSurface)
                    if (encAttached && coordinator.isGenerationActive(sessionCtx)) {
                        encoder.start()
                        Log.i(TAG, "MediaCodec surface-based H.264 encoder prepared (${width}x${height} @ ${fps}fps)")
                    } else if (encAttached) {
                        sessionCtx.releaseEncoderOnly()
                    } else {
                        Log.w(TAG, "MediaCodec encoder rejected: context already stopped, cleaned up, duplicate, or encoder disabled")
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to initialize MediaCodec encoder: ${e.message}. Reverting to preview-only fallback.")
                    sessionCtx.releaseEncoderOnly()
                }
            }

            // Open native Camera2 device
            cameraManager.openCamera(selectedId, object : CameraDevice.StateCallback() {
                override fun onOpened(camera: CameraDevice) {
                    // 1. Atomically attach CameraDevice under cleanupLock with duplicate protection
                    val cameraAttached = sessionCtx.attachCameraDevice(camera)
                    if (!cameraAttached) {
                        Log.w(TAG, "Camera device rejected on onOpened: context stopped, cleaned up, or duplicate attachment (gen=${sessionCtx.generation})")
                        return
                    }

                    // 2. Authorize onOpened with coordinator under stateLock
                    val authorized = coordinator.authorizeOnOpened(sessionCtx)
                    if (!authorized) {
                        Log.i(TAG, "Camera onOpened discarded: generation ${sessionCtx.generation} is no longer active")
                        sessionCtx.releaseAll()
                        return
                    }

                    // 3. Re-validate authorization before entering session configuration
                    if (!coordinator.isGenerationActive(sessionCtx)) {
                        Log.i(TAG, "Generation invalidated prior to configureCaptureSession (gen=${sessionCtx.generation})")
                        sessionCtx.releaseAll()
                        return
                    }

                    configureCaptureSession(sessionCtx, camera, aeFpsRange, handler)
                }

                override fun onDisconnected(camera: CameraDevice) {
                    val applied = coordinator.handleHalError(
                        sessionCtx,
                        "CAMERA_DISCONNECTED",
                        "Camera $selectedId disconnected by OS"
                    )
                    if (applied) {
                        Log.w(TAG, "Camera $selectedId disconnected by OS")
                        sessionCtx.timeoutRunnable?.let { handler.removeCallbacks(it) }
                        sessionCtx.releaseAll()
                        coordinator.transitionSessionState(sessionCtx, CaptureState.IDLE)
                    } else {
                        Log.i(TAG, "Stale onDisconnected ignored for generation ${sessionCtx.generation}")
                        sessionCtx.releaseAll()
                    }
                }

                override fun onError(camera: CameraDevice, error: Int) {
                    val errorName = when (error) {
                        ERROR_CAMERA_IN_USE -> "ERROR_CAMERA_IN_USE"
                        ERROR_MAX_CAMERAS_IN_USE -> "ERROR_MAX_CAMERAS_IN_USE"
                        ERROR_CAMERA_DISABLED -> "ERROR_CAMERA_DISABLED"
                        ERROR_CAMERA_DEVICE -> "ERROR_CAMERA_DEVICE"
                        ERROR_CAMERA_SERVICE -> "ERROR_CAMERA_SERVICE"
                        else -> "ERROR_UNKNOWN ($error)"
                    }
                    val msg = "Camera device error: $errorName"
                    val applied = coordinator.handleHalError(sessionCtx, "CAMERA_DEVICE_ERROR", msg)
                    if (applied) {
                        Log.e(TAG, msg)
                        sessionCtx.timeoutRunnable?.let { handler.removeCallbacks(it) }
                        sessionCtx.releaseAll()
                        stateListener?.onError("CAMERA_DEVICE_ERROR", msg)
                    } else {
                        Log.i(TAG, "Stale onError ignored for generation ${sessionCtx.generation}")
                        sessionCtx.releaseAll()
                    }
                }
            }, handler)

            return coordinator.getCaptureMetadata()
        } catch (e: Exception) {
            sessionCtx.releaseAll()
            val msg = "startCapture failed: ${e.message}"
            Log.e(TAG, msg, e)
            coordinator.transitionSessionState(sessionCtx, CaptureState.ERROR, msg)
            stateListener?.onError("START_CAPTURE_FAILED", msg)
            throw e
        }
    }

    /**
     * Configures the Camera2 capture session with automatic fallback from dual-surface to preview-only.
     */
    private fun configureCaptureSession(
        sessionCtx: CaptureSessionContext,
        camera: CameraDevice,
        aeFpsRange: Range<Int>,
        handler: Handler
    ) {
        val previewSrf = sessionCtx.previewSurface
        if (previewSrf == null) {
            sessionCtx.releaseAll()
            coordinator.transitionSessionState(sessionCtx, CaptureState.ERROR, "Preview surface not available")
            return
        }

        if (!coordinator.isGenerationActive(sessionCtx)) {
            Log.i(TAG, "configureCaptureSession discarded: generation ${sessionCtx.generation} is no longer active")
            sessionCtx.releaseAll()
            return
        }

        // Dual-surface eligibility check
        val canAttemptDualSurface = sessionCtx.isDualSurfaceActive &&
                sessionCtx.encoderSurface != null &&
                isDualSurfaceSessionSupported(camera, previewSrf, sessionCtx.encoderSurface!!)

        if (sessionCtx.isDualSurfaceActive && !canAttemptDualSurface) {
            Log.w(TAG, "Dual-surface not supported by device HAL. Reverting to preview-only.")
            sessionCtx.releaseEncoderOnly()
        }

        val surfaces = mutableListOf<Surface>()
        surfaces.add(previewSrf)
        if (sessionCtx.isDualSurfaceActive && sessionCtx.encoderSurface != null) {
            surfaces.add(sessionCtx.encoderSurface!!)
        }

        try {
            camera.createCaptureSession(
                surfaces,
                object : CameraCaptureSession.StateCallback() {
                    override fun onConfigured(session: CameraCaptureSession) {
                        // 1. Atomically attach CameraCaptureSession under cleanupLock with duplicate protection
                        val sessionAttached = sessionCtx.attachCaptureSession(session)
                        if (!sessionAttached) {
                            Log.w(TAG, "Capture session rejected on onConfigured: context stopped, cleaned up, or duplicate attachment (gen=${sessionCtx.generation})")
                            return
                        }

                        // 2. Authorize onConfigured with coordinator under stateLock
                        val authorized = coordinator.authorizeOnConfigured(sessionCtx)
                        if (!authorized) {
                            Log.i(TAG, "Capture session onConfigured discarded: generation ${sessionCtx.generation} is no longer active")
                            sessionCtx.releaseAll()
                            return
                        }

                        // 3. Re-validate authorization before submitting repeating request
                        if (!coordinator.isGenerationActive(sessionCtx)) {
                            Log.i(TAG, "Generation invalidated prior to submitting repeating capture request (gen=${sessionCtx.generation})")
                            sessionCtx.releaseAll()
                            return
                        }

                        try {
                            val template = if (sessionCtx.isDualSurfaceActive) {
                                CameraDevice.TEMPLATE_RECORD
                            } else {
                                CameraDevice.TEMPLATE_PREVIEW
                            }

                            val requestBuilder = camera.createCaptureRequest(template).apply {
                                addTarget(previewSrf)
                                if (sessionCtx.isDualSurfaceActive && sessionCtx.encoderSurface != null) {
                                    addTarget(sessionCtx.encoderSurface!!)
                                }
                                set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, aeFpsRange)
                                set(CaptureRequest.CONTROL_MODE, CameraMetadata.CONTROL_MODE_AUTO)
                                set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_VIDEO)
                                set(CaptureRequest.CONTROL_AE_MODE, CameraMetadata.CONTROL_AE_MODE_ON)
                            }

                            if (!coordinator.isGenerationActive(sessionCtx)) {
                                sessionCtx.releaseAll()
                                return
                            }

                            // Tracking request start via onCaptureStarted
                            session.setRepeatingRequest(
                                requestBuilder.build(),
                                object : CameraCaptureSession.CaptureCallback() {
                                    override fun onCaptureStarted(
                                        session: CameraCaptureSession,
                                        request: CaptureRequest,
                                        timestamp: Long,
                                        frameNumber: Long
                                    ) {
                                        val isReady = coordinator.onCaptureRequestStarted(sessionCtx, timestamp, frameNumber)
                                        if (isReady) {
                                            sessionCtx.timeoutRunnable?.let { handler.removeCallbacks(it) }
                                        }
                                    }

                                    override fun onCaptureFailed(
                                        session: CameraCaptureSession,
                                        request: CaptureRequest,
                                        failure: CaptureFailure
                                    ) {
                                        if (!coordinator.isGenerationActive(sessionCtx)) return
                                        Log.w(TAG, "Repeating capture request failed: reason=${failure.reason}")
                                    }
                                },
                                handler
                            )
                        } catch (e: Exception) {
                            val msg = "Failed to start repeating capture request: ${e.message}"
                            Log.e(TAG, msg, e)
                            sessionCtx.timeoutRunnable?.let { handler.removeCallbacks(it) }
                            sessionCtx.releaseAll()
                            coordinator.transitionSessionState(sessionCtx, CaptureState.ERROR, msg)
                            stateListener?.onError("CAPTURE_REQUEST_FAILED", msg)
                        }
                    }

                    override fun onConfigureFailed(session: CameraCaptureSession) {
                        if (!coordinator.isGenerationActive(sessionCtx)) {
                            Log.i(TAG, "Stale onConfigureFailed discarded for generation ${sessionCtx.generation}")
                            sessionCtx.releaseAll()
                            return
                        }

                        // If dual-surface failed, attempt fallback to preview-only
                        if (sessionCtx.isDualSurfaceActive) {
                            Log.w(TAG, "Dual-surface session configuration failed. Attempting preview-only fallback.")
                            sessionCtx.releaseEncoderOnly()
                            if (coordinator.isGenerationActive(sessionCtx)) {
                                try {
                                    configureCaptureSession(sessionCtx, camera, aeFpsRange, handler)
                                    return
                                } catch (e: Exception) {
                                    Log.e(TAG, "Preview-only fallback configuration failed: ${e.message}")
                                }
                            } else {
                                sessionCtx.releaseAll()
                                return
                            }
                        }

                        // Preview-only also failed or initial configuration failed
                        val msg = "Camera capture session configuration failed"
                        val applied = coordinator.handleHalError(sessionCtx, "SESSION_CONFIGURE_FAILED", msg)
                        if (applied) {
                            Log.e(TAG, msg)
                            sessionCtx.timeoutRunnable?.let { handler.removeCallbacks(it) }
                            sessionCtx.releaseAll()
                            stateListener?.onError("SESSION_CONFIGURE_FAILED", msg)
                        } else {
                            sessionCtx.releaseAll()
                        }
                    }

                    override fun onClosed(session: CameraCaptureSession) {
                        super.onClosed(session)
                        Log.d(TAG, "Camera capture session closed")
                    }
                },
                handler
            )
        } catch (e: Exception) {
            val msg = "Failed to create capture session: ${e.message}"
            Log.e(TAG, msg, e)
            sessionCtx.timeoutRunnable?.let { handler.removeCallbacks(it) }
            sessionCtx.releaseAll()
            coordinator.transitionSessionState(sessionCtx, CaptureState.ERROR, msg)
            stateListener?.onError("SESSION_CREATION_FAILED", msg)
        }
    }

    /**
     * Stops native camera capture safely and releases all generation resources outside of stateLock. Idempotent.
     */
    fun stopCapture(): Boolean {
        val (ctxToRelease, didStop) = coordinator.stopSession()
        if (!didStop && ctxToRelease == null) {
            Log.d(TAG, "stopCapture: already IDLE")
            return true
        }

        backgroundHandler?.let { handler ->
            ctxToRelease?.timeoutRunnable?.let { handler.removeCallbacks(it) }
        }

        // Perform native resource teardown OUTSIDE of stateLock to prevent HandlerThread deadlocks
        ctxToRelease?.releaseAll()
        stopBackgroundThread()
        return true
    }

    /**
     * Switches camera lens / ID safely during active capture or standby.
     */
    fun switchCamera(
        newCameraId: String,
        width: Int = coordinator.currentWidth,
        height: Int = coordinator.currentHeight,
        fps: Int = coordinator.currentFps
    ): Map<String, Any?> {
        val wasCapturing = (coordinator.state == CaptureState.CAPTURING ||
                coordinator.state == CaptureState.OPENING ||
                coordinator.state == CaptureState.CONFIGURING)
        stopCapture()
        if (wasCapturing) {
            startCapture(
                targetCameraId = newCameraId,
                width = width,
                height = height,
                fps = fps
            )
        }
        return coordinator.getCaptureMetadata()
    }

    /**
     * Full engine disposal on Activity teardown.
     */
    fun release() {
        stopCapture()
        stateListener = null
        coordinator.stateListener = null
    }
}
