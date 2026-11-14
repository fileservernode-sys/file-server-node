package net.remotenode.fileserver.camera

import android.graphics.SurfaceTexture
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraDevice
import android.os.Handler
import android.view.Surface
import io.flutter.view.TextureRegistry
import java.io.Closeable
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * TimeoutResolution — Explicit outcomes of timeout arbitration (Phase 21.4.4 / 21.4.4.1 / 21.4.4.2).
 */
enum class TimeoutResolution {
    ACTIVELY_TIMED_OUT,
    PREVIEW_ALREADY_VERIFIED,
    STALE_SESSION_IGNORED
}

/**
 * Generation-scoped resource container ensuring clean resource ownership and
 * complete isolation between consecutive capture sessions (Phase 21.4.4.2).
 *
 * Atomic Resource Registration & Lock-Free Disposal Protocol (Phase 21.4.4.2):
 * 1. Atomic Resource Registration: Every incoming resource (CameraDevice, CameraCaptureSession,
 *    MediaCodecEncoder, Surface, SurfaceTexture, TextureEntry, Closeables, Callbacks) must be
 *    registered via `attachResourceInternal` under `cleanupLock`.
 * 2. Deterministic Single-Owner Outcome:
 *    - If context is live: Resource is attached to context and will be released during teardown.
 *    - If context is stopped or cleaned up: Resource is rejected immediately, and disposed
 *      OUTSIDE of all locks by the registration caller. Zero orphaned native resources.
 * 3. Context-Lock-Free Disposal: `releaseAll()` detaches and nulls all resources under `cleanupLock`,
 *    then releases `cleanupLock` before performing any native hardware teardown.
 * 4. Exception Isolation: Every detached resource is disposed within an isolated `try-catch` block.
 * 5. Encoder-Only Teardown Compatibility: `releaseEncoderOnly()` prevents late encoder initialization
 *    from restoring encoder state after teardown (`isEncoderAllowed = false`).
 */
class CaptureSessionContext(
    val generation: Int,
    val cameraId: String = "0",
    val width: Int = 1280,
    val height: Int = 720,
    val fps: Int = 30,
    @Volatile var textureEntry: TextureRegistry.SurfaceTextureEntry? = null,
    @Volatile var surfaceTexture: SurfaceTexture? = null,
    @Volatile var previewSurface: Surface? = null,
    @Volatile var mediaCodecEncoder: MediaCodecEncoder? = null,
    @Volatile var encoderSurface: Surface? = null,
    @Volatile var cameraDevice: CameraDevice? = null,
    @Volatile var captureSession: CameraCaptureSession? = null,
    @Volatile var timeoutRunnable: Runnable? = null,
    @Volatile var timeoutHandler: Handler? = null,
    @Volatile var isStopped: Boolean = false,
    @Volatile var hasStartedCaptureRequest: Boolean = false,
    @Volatile var hasReceivedPreviewFrame: Boolean = false,
    @Volatile var isDualSurfaceActive: Boolean = false,
    @Volatile var isEncoderAllowed: Boolean = true,
    val closeables: MutableList<AutoCloseable> = mutableListOf(),
    val testResources: MutableMap<String, AutoCloseable> = mutableMapOf(),
    @Volatile var onReleaseCallback: (() -> Unit)? = null,
    @Volatile var token: GenerationAuthorizationToken? = null
) {
    val isPreviewReady: Boolean
        get() = hasStartedCaptureRequest && hasReceivedPreviewFrame

    private val cleanupLock = Any()
    private val isCleanedUp = AtomicBoolean(false)

    val isReleased: Boolean
        get() = isCleanedUp.get()

    /**
     * Core atomic resource attachment protocol with duplicate protection (Phase 21.4.4.3).
     *
     * 1. Under `cleanupLock`: Atomically inspects context lifecycle state (`isCleanedUp || isStopped`)
     *    and slot availability (`isSlotAvailable()`).
     * 2. If live and slot available: executes `assign()` under lock and returns `true`.
     * 3. If stopped, cleaned up, or slot occupied: returns `false`.
     * 4. Outside `cleanupLock`: If rejected, invokes `disposeOnReject(resource)` with exception isolation.
     */
    private fun <T> attachResourceInternal(
        resource: T,
        isSlotAvailable: () -> Boolean = { true },
        assign: () -> Unit,
        disposeOnReject: (T) -> Unit
    ): Boolean {
        val accepted = synchronized(cleanupLock) {
            if (isCleanedUp.get() || isStopped || !isSlotAvailable()) {
                false
            } else {
                assign()
                true
            }
        }
        if (!accepted) {
            try {
                disposeOnReject(resource)
            } catch (_: Throwable) {}
        }
        return accepted
    }

    /**
     * Atomically attaches CameraDevice with duplicate protection.
     * If context is stopped, cleaned up, or device slot is already occupied,
     * immediately closes the rejected device outside locks and returns false.
     * Preserves any existing attached device.
     */
    fun attachCameraDevice(device: CameraDevice): Boolean {
        return attachResourceInternal(
            resource = device,
            isSlotAvailable = { cameraDevice == null },
            assign = { cameraDevice = device },
            disposeOnReject = { d -> d.close() }
        )
    }

    /**
     * Atomically attaches CameraCaptureSession with duplicate protection.
     * If context is stopped, cleaned up, or session slot is already occupied,
     * immediately stops and closes the rejected session outside locks and returns false.
     * Preserves any existing attached session.
     */
    fun attachCaptureSession(session: CameraCaptureSession): Boolean {
        return attachResourceInternal(
            resource = session,
            isSlotAvailable = { captureSession == null },
            assign = { captureSession = session },
            disposeOnReject = { s ->
                try { s.stopRepeating() } catch (_: Throwable) {}
                s.close()
            }
        )
    }

    /**
     * Atomically attaches MediaCodec encoder and its surface as a single group.
     * Rejects if context is stopped, cleaned up, encoder torn down, or either slot is already occupied.
     * If rejected, both incoming encoder and surface are disposed immediately outside locks.
     * Preserves existing encoder and surface.
     */
    fun attachEncoder(encoder: MediaCodecEncoder, surface: Surface): Boolean {
        val accepted = synchronized(cleanupLock) {
            if (isCleanedUp.get() || isStopped || !isEncoderAllowed ||
                mediaCodecEncoder != null || encoderSurface != null
            ) {
                false
            } else {
                mediaCodecEncoder = encoder
                encoderSurface = surface
                isDualSurfaceActive = true
                true
            }
        }
        if (!accepted) {
            try { encoder.stop() } catch (_: Throwable) {}
            try { encoder.release() } catch (_: Throwable) {}
            try { surface.release() } catch (_: Throwable) {}
        }
        return accepted
    }

    /**
     * Atomically attaches Flutter zero-copy preview surface texture resources as a single group.
     * Rejects if context is stopped, cleaned up, or any preview slot is already occupied.
     * If rejected, all three incoming preview resources are released immediately outside locks.
     * Preserves existing preview resources.
     */
    fun attachPreviewResources(
        entry: TextureRegistry.SurfaceTextureEntry,
        texture: SurfaceTexture,
        surface: Surface
    ): Boolean {
        val accepted = synchronized(cleanupLock) {
            if (isCleanedUp.get() || isStopped ||
                textureEntry != null || surfaceTexture != null || previewSurface != null
            ) {
                false
            } else {
                textureEntry = entry
                surfaceTexture = texture
                previewSurface = surface
                true
            }
        }
        if (!accepted) {
            try { texture.setOnFrameAvailableListener(null) } catch (_: Throwable) {}
            try { surface.release() } catch (_: Throwable) {}
            try { entry.release() } catch (_: Throwable) {}
        }
        return accepted
    }

    /**
     * Atomically attaches the timeout runnable and handler with duplicate protection.
     * Rejects if timeout slot is already occupied, stopped, or cleaned up.
     * If rejected, cancels the incoming runnable on handler outside locks.
     * Preserves existing timeout runnable.
     */
    fun attachTimeout(runnable: Runnable, handler: Handler): Boolean {
        return attachResourceInternal(
            resource = runnable,
            isSlotAvailable = { timeoutRunnable == null },
            assign = {
                timeoutRunnable = runnable
                timeoutHandler = handler
            },
            disposeOnReject = { r -> handler.removeCallbacks(r) }
        )
    }

    /**
     * Atomically attaches a tracked closeable with duplicate reference protection.
     * If context is stopped or cleaned up, immediately closes the closeable outside locks and returns false.
     * If the exact instance is already tracked, rejects addition without closing the active instance.
     */
    fun addCloseable(closeable: AutoCloseable): Boolean {
        val (accepted, shouldDispose) = synchronized(cleanupLock) {
            if (isCleanedUp.get() || isStopped) {
                Pair(false, true)
            } else if (closeables.any { it === closeable }) {
                Pair(false, false)
            } else {
                closeables.add(closeable)
                Pair(true, false)
            }
        }
        if (shouldDispose) {
            try { closeable.close() } catch (_: Throwable) {}
        }
        return accepted
    }

    /**
     * Atomically attaches a testable resource with duplicate slot protection.
     * If key is already occupied, stopped, or cleaned up, rejects and closes the new resource outside locks.
     * Preserves existing resource under key.
     */
    fun attachTestResource(key: String, resource: AutoCloseable): Boolean {
        val accepted = synchronized(cleanupLock) {
            if (isCleanedUp.get() || isStopped || testResources.containsKey(key)) {
                false
            } else {
                testResources[key] = resource
                true
            }
        }
        if (!accepted) {
            try { resource.close() } catch (_: Throwable) {}
        }
        return accepted
    }

    /**
     * Registers a release callback with documented exactly-once policy (Phase 21.4.4.3).
     *
     * Policy:
     * - Live context & empty slot: accepted (`returns true`), executes exactly once during `releaseAll()`.
     * - Duplicate registration: slot already occupied; rejected (`returns false`), executed immediately outside locks.
     * - Stopped or cleaned-up context: rejected (`returns false`), executed immediately outside locks.
     * - Every callback executes strictly once without exception propagation or lock deadlock.
     */
    fun registerReleaseCallback(callback: () -> Unit): Boolean {
        val (accepted, shouldInvokeImmediately) = synchronized(cleanupLock) {
            if (isCleanedUp.get() || isStopped) {
                Pair(false, true)
            } else if (onReleaseCallback != null) {
                Pair(false, true)
            } else {
                onReleaseCallback = callback
                Pair(true, false)
            }
        }
        if (shouldInvokeImmediately) {
            try { callback.invoke() } catch (_: Throwable) {}
        }
        return accepted
    }

    /**
     * Releases all native resources belonging strictly to this generation.
     *
     * Execution Protocol:
     * 1. Under `cleanupLock`: Atomically claims cleanup ownership (`compareAndSet(false, true)`),
     *    marks `isStopped = true`, extracts all resources into local variables, and nulls all fields.
     * 2. Release `cleanupLock`.
     * 3. Outside `cleanupLock`: Perform native disposal on extracted local variables with
     *    isolated exception handling per resource.
     */
    fun releaseAll() {
        isStopped = true

        val currentTimeout: Runnable?
        val currentHandler: Handler?
        val session: CameraCaptureSession?
        val device: CameraDevice?
        val encoder: MediaCodecEncoder?
        val encSurface: Surface?
        val st: SurfaceTexture?
        val srf: Surface?
        val entry: TextureRegistry.SurfaceTextureEntry?
        val extractedCloseables: List<AutoCloseable>
        val extractedTestResources: Map<String, AutoCloseable>
        val callback: (() -> Unit)?

        synchronized(cleanupLock) {
            // Atomically claim cleanup ownership
            if (!isCleanedUp.compareAndSet(false, true)) {
                return
            }
            isEncoderAllowed = false

            // Extract references into local variables under lock
            currentTimeout = timeoutRunnable
            currentHandler = timeoutHandler
            timeoutRunnable = null
            timeoutHandler = null

            session = captureSession
            captureSession = null

            device = cameraDevice
            cameraDevice = null

            encoder = mediaCodecEncoder
            mediaCodecEncoder = null

            encSurface = encoderSurface
            encoderSurface = null
            isDualSurfaceActive = false

            st = surfaceTexture
            surfaceTexture = null

            srf = previewSurface
            previewSurface = null

            entry = textureEntry
            textureEntry = null

            extractedCloseables = if (closeables.isNotEmpty()) {
                val copy = ArrayList(closeables)
                closeables.clear()
                copy
            } else {
                emptyList()
            }

            extractedTestResources = if (testResources.isNotEmpty()) {
                val copy = HashMap(testResources)
                testResources.clear()
                copy
            } else {
                emptyMap()
            }

            callback = onReleaseCallback
            onReleaseCallback = null
        }
        // cleanupLock is now released! All native calls below execute outside cleanupLock and stateLock.

        // 1. Remove scheduled timeout runnable from handler
        try {
            if (currentTimeout != null) {
                currentHandler?.removeCallbacks(currentTimeout)
            }
        } catch (_: Throwable) {}

        // 2. Stop repeating capture requests and close CameraCaptureSession
        try { session?.stopRepeating() } catch (_: Throwable) {}
        try { session?.close() } catch (_: Throwable) {}

        // 3. Close CameraDevice
        try { device?.close() } catch (_: Throwable) {}

        // 4. Stop and release MediaCodec encoder
        try { encoder?.stop() } catch (_: Throwable) {}
        try { encoder?.release() } catch (_: Throwable) {}

        // 5. Release encoder input Surface
        try { encSurface?.release() } catch (_: Throwable) {}

        // 6. Clear SurfaceTexture frame listener
        try { st?.setOnFrameAvailableListener(null) } catch (_: Throwable) {}

        // 7. Release preview Surface
        try { srf?.release() } catch (_: Throwable) {}

        // 8. Release Flutter SurfaceTextureEntry
        try { entry?.release() } catch (_: Throwable) {}

        // 9. Close all extracted closeables with independent exception isolation
        for (c in extractedCloseables) {
            try {
                c.close()
            } catch (_: Throwable) {}
        }

        // 10. Close all extracted test resources
        for ((_, r) in extractedTestResources) {
            try {
                r.close()
            } catch (_: Throwable) {}
        }

        // 11. Invoke release callback independently outside any lock
        try {
            callback?.invoke()
        } catch (_: Throwable) {}
    }

    /**
     * Releases encoder and its surface while preserving preview resources.
     * Extraction occurs under `cleanupLock`, disposal occurs outside `cleanupLock`.
     */
    fun releaseEncoderOnly() {
        val encoderToRelease: MediaCodecEncoder?
        val surfaceToRelease: Surface?
        val testEncoderToRelease: AutoCloseable?

        synchronized(cleanupLock) {
            if (isCleanedUp.get()) return
            isDualSurfaceActive = false
            isEncoderAllowed = false

            encoderToRelease = mediaCodecEncoder
            mediaCodecEncoder = null

            surfaceToRelease = encoderSurface
            encoderSurface = null

            testEncoderToRelease = testResources.remove("encoder")
        }

        try { encoderToRelease?.stop() } catch (_: Throwable) {}
        try { encoderToRelease?.release() } catch (_: Throwable) {}
        try { surfaceToRelease?.release() } catch (_: Throwable) {}
        try { testEncoderToRelease?.close() } catch (_: Throwable) {}
    }
}

/**
 * GenerationAuthorizationToken — Focused coordinator-mediated authorization token (Phase 21.4.4.3).
 *
 * Encapsulates generation identity and allows callbacks to atomically authorize consequential
 * actions (state transitions, Camera2 configuration, repeating requests, frame confirmations).
 */
class GenerationAuthorizationToken internal constructor(
    val generation: Int,
    private val coordinator: CaptureGenerationCoordinator,
    private val context: CaptureSessionContext
) {
    val isAuthorized: Boolean
        get() = coordinator.isGenerationActive(context)

    fun authorizeOnOpened(): Boolean = coordinator.authorizeOnOpened(context)

    fun authorizeOnConfigured(): Boolean = coordinator.authorizeOnConfigured(context)

    fun isGenerationActive(): Boolean = coordinator.isGenerationActive(context)

    fun transitionSessionState(newState: CaptureState, error: String? = null): Boolean =
        coordinator.transitionSessionState(context, newState, error)

    fun onCaptureRequestStarted(timestamp: Long, frameNumber: Long): Boolean =
        coordinator.onCaptureRequestStarted(context, timestamp, frameNumber)

    fun onPreviewFrameAvailable(): Boolean =
        coordinator.onPreviewFrameAvailable(context)

    fun handleHalError(errorCode: String, errorMessage: String): Boolean =
        coordinator.handleHalError(context, errorCode, errorMessage)
}

/**
 * CaptureGenerationCoordinator — Native Capture Generation Atomicity & Concurrency Manager (Phase 21.4.4 / 21.4.4.1 / 21.4.4.2 / 21.4.4.3).
 */
class CaptureGenerationCoordinator(
    var stateListener: CaptureStateListener? = null
) {
    private val stateLock = Any()
    private val sessionGeneration = AtomicInteger(0)

    @Volatile
    private var currentState: CaptureState = CaptureState.IDLE

    // Active session context
    @Volatile
    private var currentContext: CaptureSessionContext? = null

    // Active configuration metadata
    @Volatile private var activeCameraId: String? = null
    @Volatile private var activeWidth: Int = 1280
    @Volatile private var activeHeight: Int = 720
    @Volatile private var activeFps: Int = 30
    @Volatile private var sensorOrientation: Int = 0
    @Volatile private var lensFacing: String = "BACK"
    @Volatile private var lastErrorMessage: String? = null

    // Active timeout runnable reference
    @Volatile private var activeTimeoutRunnable: Runnable? = null

    val state: CaptureState
        get() = currentState

    val generation: Int
        get() = sessionGeneration.get()

    val activeContext: CaptureSessionContext?
        get() = synchronized(stateLock) { currentContext }

    val activeTextureId: Long?
        get() = synchronized(stateLock) { currentContext?.textureEntry?.id() }

    val currentCameraId: String?
        get() = synchronized(stateLock) { activeCameraId }

    val currentWidth: Int
        get() = synchronized(stateLock) { activeWidth }

    val currentHeight: Int
        get() = synchronized(stateLock) { activeHeight }

    val currentFps: Int
        get() = synchronized(stateLock) { activeFps }

    /**
     * Atomically advances capture generation and replaces the active context.
     */
    fun advanceGeneration(
        selectedId: String,
        width: Int,
        height: Int,
        fps: Int
    ): Pair<CaptureSessionContext, CaptureSessionContext?> {
        val (sessionCtx, existing) = synchronized(stateLock) {
            val existing = currentContext
            val isSameConfig = existing != null &&
                    existing.cameraId == selectedId &&
                    existing.width == width &&
                    existing.height == height &&
                    existing.fps == fps &&
                    currentState == CaptureState.CAPTURING

            if (isSameConfig) {
                return Pair(existing, null)
            }

            // Mark old context stopped immediately under lock to prevent any in-flight callbacks from taking effect
            existing?.isStopped = true

            val gen = sessionGeneration.incrementAndGet()
            val sessionCtx = CaptureSessionContext(
                generation = gen,
                cameraId = selectedId,
                width = width,
                height = height,
                fps = fps
            )
            sessionCtx.token = GenerationAuthorizationToken(gen, this, sessionCtx)
            currentContext = sessionCtx

            activeCameraId = selectedId
            activeWidth = width
            activeHeight = height
            activeFps = fps
            lastErrorMessage = null
            activeTimeoutRunnable = null

            currentState = CaptureState.OPENING
            Pair(sessionCtx, existing)
        }

        val meta = getCaptureMetadata()
        stateListener?.onStateChanged(CaptureState.OPENING, meta)

        return Pair(sessionCtx, existing)
    }

    /**
     * Checks if the given session context is strictly active, matching current generation and context reference.
     */
    fun isGenerationActive(sessionCtx: CaptureSessionContext): Boolean {
        return synchronized(stateLock) {
            !sessionCtx.isStopped &&
            sessionCtx.generation == sessionGeneration.get() &&
            currentContext === sessionCtx
        }
    }

    /**
     * Authorizes onOpened Camera2 callback. If active, transitions state to CONFIGURING atomically.
     * If session is stale, returns false without mutating coordinator state.
     */
    fun authorizeOnOpened(sessionCtx: CaptureSessionContext): Boolean {
        val (shouldNotify, meta) = synchronized(stateLock) {
            if (sessionCtx.isStopped ||
                sessionCtx.generation != sessionGeneration.get() ||
                currentContext !== sessionCtx
            ) {
                return false
            }
            if (currentState == CaptureState.OPENING) {
                currentState = CaptureState.CONFIGURING
                Pair(true, getCaptureMetadataLocked())
            } else {
                Pair(false, null)
            }
        }
        if (shouldNotify && meta != null) {
            stateListener?.onStateChanged(CaptureState.CONFIGURING, meta)
        }
        return synchronized(stateLock) {
            !sessionCtx.isStopped &&
            sessionCtx.generation == sessionGeneration.get() &&
            currentContext === sessionCtx
        }
    }

    /**
     * Authorizes onConfigured Camera2 callback. Returns true only if session is strictly active.
     */
    fun authorizeOnConfigured(sessionCtx: CaptureSessionContext): Boolean {
        return synchronized(stateLock) {
            !sessionCtx.isStopped &&
            sessionCtx.generation == sessionGeneration.get() &&
            currentContext === sessionCtx
        }
    }

    /**
     * Transitions session state only if the session context is strictly active in the coordinator.
     * Stale sessions cannot modify currentState or lastErrorMessage.
     */
    fun transitionSessionState(
        sessionCtx: CaptureSessionContext,
        newState: CaptureState,
        error: String? = null
    ): Boolean {
        val (shouldNotify, meta) = synchronized(stateLock) {
            if (sessionCtx.isStopped ||
                sessionCtx.generation != sessionGeneration.get() ||
                currentContext !== sessionCtx
            ) {
                return false
            }
            currentState = newState
            if (error != null) {
                lastErrorMessage = error
            } else if (newState == CaptureState.IDLE) {
                lastErrorMessage = null
            }
            Pair(true, getCaptureMetadataLocked())
        }
        if (shouldNotify && meta != null) {
            stateListener?.onStateChanged(newState, meta)
        }
        return shouldNotify
    }

    /**
     * Records capture request started for active session and transitions to CAPTURING if frame ready.
     */
    fun onCaptureRequestStarted(
        sessionCtx: CaptureSessionContext,
        timestamp: Long,
        frameNumber: Long
    ): Boolean {
        val (shouldNotify, meta) = synchronized(stateLock) {
            if (sessionCtx.isStopped ||
                sessionCtx.generation != sessionGeneration.get() ||
                currentContext !== sessionCtx
            ) {
                return false
            }
            if (!sessionCtx.hasStartedCaptureRequest) {
                sessionCtx.hasStartedCaptureRequest = true
                if (sessionCtx.hasReceivedPreviewFrame && currentState != CaptureState.CAPTURING) {
                    currentState = CaptureState.CAPTURING
                    activeTimeoutRunnable = null
                    Pair(true, getCaptureMetadataLocked())
                } else {
                    Pair(false, null)
                }
            } else {
                Pair(false, null)
            }
        }
        if (shouldNotify && meta != null) {
            stateListener?.onStateChanged(CaptureState.CAPTURING, meta)
            return true
        }
        return synchronized(stateLock) {
            currentState == CaptureState.CAPTURING && currentContext === sessionCtx
        }
    }

    /**
     * Records preview frame arrival for active session and transitions to CAPTURING if capture started.
     */
    fun onPreviewFrameAvailable(sessionCtx: CaptureSessionContext): Boolean {
        val (shouldNotify, meta) = synchronized(stateLock) {
            if (sessionCtx.isStopped ||
                sessionCtx.generation != sessionGeneration.get() ||
                currentContext !== sessionCtx
            ) {
                return false
            }
            if (!sessionCtx.hasReceivedPreviewFrame) {
                sessionCtx.hasReceivedPreviewFrame = true
                if (sessionCtx.hasStartedCaptureRequest && currentState != CaptureState.CAPTURING) {
                    currentState = CaptureState.CAPTURING
                    activeTimeoutRunnable = null
                    Pair(true, getCaptureMetadataLocked())
                } else {
                    Pair(false, null)
                }
            } else {
                Pair(false, null)
            }
        }
        if (shouldNotify && meta != null) {
            stateListener?.onStateChanged(CaptureState.CAPTURING, meta)
            return true
        }
        return synchronized(stateLock) {
            currentState == CaptureState.CAPTURING && currentContext === sessionCtx
        }
    }

    /**
     * Checks if both capture request and preview frame are verified to transition to CAPTURING.
     */
    fun checkCaptureReady(sessionCtx: CaptureSessionContext): Boolean {
        val shouldNotify = synchronized(stateLock) {
            if (sessionCtx.isStopped ||
                sessionCtx.generation != sessionGeneration.get() ||
                currentContext !== sessionCtx
            ) {
                return false
            }

            if (sessionCtx.hasStartedCaptureRequest && sessionCtx.hasReceivedPreviewFrame) {
                activeTimeoutRunnable = null
                if (currentState != CaptureState.CAPTURING) {
                    currentState = CaptureState.CAPTURING
                    true
                } else {
                    false
                }
            } else {
                false
            }
        }

        if (shouldNotify) {
            val meta = getCaptureMetadata()
            stateListener?.onStateChanged(CaptureState.CAPTURING, meta)
            return true
        }
        return synchronized(stateLock) { currentState == CaptureState.CAPTURING && currentContext === sessionCtx }
    }

    /**
     * Handles timeout callback with strict atomic ownership and deterministic race arbitration.
     */
    fun handleTimeout(
        sessionCtx: CaptureSessionContext,
        errorCode: String,
        errorMessage: String
    ): TimeoutResolution {
        val (resolution, shouldNotify) = synchronized(stateLock) {
            // 1. If capture was already verified, timeout was cancelled or raced with success
            if (sessionCtx.hasReceivedPreviewFrame) {
                return TimeoutResolution.PREVIEW_ALREADY_VERIFIED
            }

            // 2. Check strict multi-field ownership atomically under stateLock
            val isCurrentActiveContext = (currentContext === sessionCtx) &&
                    (sessionGeneration.get() == sessionCtx.generation) &&
                    !sessionCtx.isStopped

            if (isCurrentActiveContext) {
                sessionCtx.isStopped = true
                if (currentContext === sessionCtx) {
                    currentContext = null
                }
                activeTimeoutRunnable = null
                currentState = CaptureState.ERROR
                lastErrorMessage = errorMessage
                Pair(TimeoutResolution.ACTIVELY_TIMED_OUT, true)
            } else {
                Pair(TimeoutResolution.STALE_SESSION_IGNORED, false)
            }
        }

        if (shouldNotify) {
            val meta = getCaptureMetadata()
            stateListener?.onStateChanged(CaptureState.ERROR, meta)
        }
        return resolution
    }

    /**
     * Stops the capture session atomically under stateLock.
     */
    fun stopSession(): Pair<CaptureSessionContext?, Boolean> {
        val (ctx, didStop) = synchronized(stateLock) {
            val ctx = currentContext
            if (currentState == CaptureState.IDLE && ctx == null) {
                return Pair(null, false)
            }

            sessionGeneration.incrementAndGet()
            activeTimeoutRunnable = null
            ctx?.isStopped = true
            if (currentContext === ctx) {
                currentContext = null
            }

            currentState = CaptureState.IDLE
            Pair(ctx, true)
        }

        if (didStop) {
            val meta = getCaptureMetadata()
            stateListener?.onStateChanged(CaptureState.IDLE, meta)
        }
        return Pair(ctx, didStop)
    }

    /**
     * Handles error transition from CameraDevice or HAL callbacks.
     */
    fun handleHalError(
        sessionCtx: CaptureSessionContext,
        errorCode: String,
        errorMessage: String
    ): Boolean {
        val shouldNotify = synchronized(stateLock) {
            if (sessionCtx.generation != sessionGeneration.get() ||
                currentContext !== sessionCtx ||
                sessionCtx.isStopped
            ) {
                return false
            }

            sessionCtx.isStopped = true
            if (currentContext === sessionCtx) {
                currentContext = null
            }
            activeTimeoutRunnable = null
            currentState = CaptureState.ERROR
            lastErrorMessage = errorMessage
            true
        }

        if (shouldNotify) {
            val meta = getCaptureMetadata()
            stateListener?.onStateChanged(CaptureState.ERROR, meta)
        }
        return shouldNotify
    }

    fun setActiveTimeout(runnable: Runnable?) {
        synchronized(stateLock) {
            activeTimeoutRunnable = runnable
        }
    }

    fun updateHardwareInfo(lens: String, orientation: Int) {
        synchronized(stateLock) {
            lensFacing = lens
            sensorOrientation = orientation
        }
    }

    fun transitionState(newState: CaptureState, error: String? = null) {
        val meta = synchronized(stateLock) {
            currentState = newState
            if (error != null) {
                lastErrorMessage = error
            } else if (newState == CaptureState.IDLE) {
                lastErrorMessage = null
            }
            getCaptureMetadata()
        }
        stateListener?.onStateChanged(newState, meta)
    }

    private fun getCaptureMetadataLocked(): Map<String, Any?> {
        val ctx = currentContext
        val encoderInfo = ctx?.mediaCodecEncoder?.getDiagnosticInfo() ?: emptyMap()
        return mapOf(
            "status" to currentState.name,
            "isCapturing" to (currentState == CaptureState.CAPTURING),
            "isCaptureRequestStarted" to (ctx?.hasStartedCaptureRequest ?: false),
            "hasPreviewFrame" to (ctx?.hasReceivedPreviewFrame ?: false),
            "generation" to (ctx?.generation ?: sessionGeneration.get()),
            "cameraId" to activeCameraId,
            "width" to activeWidth,
            "height" to activeHeight,
            "fps" to activeFps,
            "textureId" to (ctx?.textureEntry?.id()),
            "sensorOrientation" to sensorOrientation,
            "lensFacing" to lensFacing,
            "isEncoderActive" to (ctx?.isDualSurfaceActive == true),
            "codecName" to (encoderInfo["codecName"] ?: "NONE"),
            "codecAcceleration" to (encoderInfo["acceleration"] ?: "UNVERIFIED"),
            "isHardwareAccelerated" to (encoderInfo["isHardwareAccelerated"] ?: false),
            "errorMessage" to lastErrorMessage
        )
    }

    fun getCaptureMetadata(): Map<String, Any?> {
        return synchronized(stateLock) {
            getCaptureMetadataLocked()
        }
    }
}
