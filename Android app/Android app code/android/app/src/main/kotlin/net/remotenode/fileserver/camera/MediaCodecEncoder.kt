package net.remotenode.fileserver.camera

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat
import android.os.Build
import android.os.Handler
import android.util.Log
import android.view.Surface
import java.nio.ByteBuffer
import java.util.Locale

/**
 * EncodedFrameListener — Internal media output contract (Phase 21.4 / 21.4.1 / 21.4.2).
 *
 * Clearly separates codec-specific configuration buffers (SPS/PPS) from ordinary
 * video frames (IDR keyframes and P-frames), ensuring streaming protocols receive
 * clean, properly delineated H.264 streams.
 */
interface EncodedFrameListener {
    /**
     * Dispatched when codec configuration data (SPS / PPS parameter sets)
     * is produced by MediaCodec or signaled via BUFFER_FLAG_CODEC_CONFIG.
     */
    fun onCodecConfig(spsPpsData: ByteArray)

    /**
     * Dispatched for real encoded video frames (IDR keyframes and inter-coded frames).
     */
    fun onEncodedFrame(data: ByteArray, isKeyFrame: Boolean, timestampUs: Long)

    /**
     * Dispatched when encoder output format changes, containing updated CSD parameters.
     */
    fun onFormatChanged(format: MediaFormat)

    /**
     * Dispatched on unrecoverable asynchronous encoder errors.
     */
    fun onEncoderError(error: Exception)
}

/**
 * Three-tier acceleration classification (Phase 21.4.2):
 * - HARDWARE: Platform-reported via MediaCodecInfo.isHardwareAccelerated on API 29+.
 * - SOFTWARE: Platform-reported via isSoftwareOnly on API 29+ or verified software name prefix.
 * - UNVERIFIED: Pre-API 29 non-software codecs where platform does not provide an acceleration API.
 *   Vendor name prefixes (e.g. OMX.qcom, OMX.Exynos) are strictly insufficient to confirm hardware acceleration.
 */
enum class CodecAcceleration {
    HARDWARE,
    SOFTWARE,
    UNVERIFIED
}

/**
 * Encapsulates codec discovery results including acceleration classification.
 */
data class EncoderCandidate(
    val info: MediaCodecInfo,
    val acceleration: CodecAcceleration
)

/**
 * MediaCodecEncoder — Surface-based H.264 (video/avc) encoder (Phase 21.4 / 21.4.1 / 21.4.2).
 *
 * Architectural & Correctness Guarantees:
 * 1. Honest Acceleration Classification (Phase 21.4.2):
 *    - Android API 29+: Uses MediaCodecInfo.isHardwareAccelerated and isSoftwareOnly directly.
 *    - Android API < 29: Vendor prefixes (OMX.qcom, OMX.Exynos, OMX.MTK) are treated as UNVERIFIED.
 *      Known software codecs (OMX.google, c2.android, OMX.ffmpeg) are classified as SOFTWARE.
 *      Never falsely claims HARDWARE without official platform API verification.
 * 2. Codec Candidate Selection: Prioritizes platform-verified HARDWARE, then UNVERIFIED, then SOFTWARE.
 * 3. Diagnostic Reporting: Surfaces actual selected codec name and acceleration status
 *    ("HARDWARE", "SOFTWARE", "UNVERIFIED") in diagnostic metadata.
 * 4. Codec-Specific Config Separation: BUFFER_FLAG_CODEC_CONFIG and format CSD buffers (SPS/PPS)
 *    are dispatched via onCodecConfig and never conflated with ordinary video frames.
 * 5. Buffer Slicing & Offset Integrity: Strictly slices ByteBuffer using `BufferInfo.offset` and
 *    `BufferInfo.size`, preserving timestamps and keyframe flags.
 * 6. Guaranteed Output Buffer Release: Every output buffer is released in a finally block even
 *    if the listener throws or rejects a frame, preventing MediaCodec pipeline stalls.
 * 7. Zero Network Transmission: Encoded payloads are handled strictly through the internal listener.
 */
class MediaCodecEncoder(
    val width: Int,
    val height: Int,
    val fps: Int,
    private val listener: EncodedFrameListener? = null,
    private val callbackHandler: Handler? = null
) {
    companion object {
        private const val TAG = "MediaCodecEncoder"
        const val MIME_TYPE = MediaFormat.MIMETYPE_VIDEO_AVC
        const val DEFAULT_I_FRAME_INTERVAL_SEC = 2

        /**
         * Evaluates acceleration classification strictly per Android API version capabilities.
         */
        fun evaluateAcceleration(info: MediaCodecInfo): CodecAcceleration {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                return when {
                    info.isHardwareAccelerated -> CodecAcceleration.HARDWARE
                    info.isSoftwareOnly -> CodecAcceleration.SOFTWARE
                    else -> CodecAcceleration.UNVERIFIED
                }
            }

            // Android API below 29: Vendor prefixes are NOT proof of hardware acceleration!
            val name = info.name.lowercase(Locale.ROOT)
            val isKnownSoftware = name.startsWith("omx.google.") ||
                    name.startsWith("c2.android.") ||
                    name.startsWith("omx.ffmpeg.") ||
                    name.contains(".sw.") ||
                    name.startsWith("omx.sec.avc.sw")

            return if (isKnownSoftware) {
                CodecAcceleration.SOFTWARE
            } else {
                // Pre-API 29 vendor codecs remain UNVERIFIED
                CodecAcceleration.UNVERIFIED
            }
        }

        /**
         * Discovers and prioritizes compatible H.264 encoders supporting COLOR_FormatSurface.
         * Preference order: HARDWARE -> UNVERIFIED -> SOFTWARE.
         */
        fun findBestEncoder(width: Int, height: Int, fps: Int): EncoderCandidate? {
            try {
                val codecList = MediaCodecList(MediaCodecList.REGULAR_CODECS)
                val candidates = mutableListOf<EncoderCandidate>()

                for (info in codecList.codecInfos) {
                    if (!info.isEncoder) continue
                    val types = info.supportedTypes
                    if (!types.contains(MIME_TYPE)) continue

                    val caps = info.getCapabilitiesForType(MIME_TYPE) ?: continue
                    val videoCaps = caps.videoCapabilities ?: continue

                    // Check resolution support
                    val sizeSupported = videoCaps.isSizeSupported(width, height) ||
                            videoCaps.isSizeSupported(height, width)
                    if (!sizeSupported) continue

                    // Check frame rate support
                    val supportedFrameRates = videoCaps.supportedFrameRates
                    if (supportedFrameRates != null && !supportedFrameRates.contains(fps.toDouble())) {
                        continue
                    }

                    // Check Surface color format support
                    val surfaceSupported = caps.colorFormats.contains(
                        MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface
                    )
                    if (!surfaceSupported) continue

                    val acceleration = evaluateAcceleration(info)
                    candidates.add(EncoderCandidate(info, acceleration))
                }

                // 1. Prefer platform-verified hardware encoders first (API 29+)
                val hwCandidate = candidates.firstOrNull { it.acceleration == CodecAcceleration.HARDWARE }
                if (hwCandidate != null) {
                    return hwCandidate
                }

                // 2. Fall back to unverified encoders (pre-API 29 potential hardware)
                val unverifiedCandidate = candidates.firstOrNull { it.acceleration == CodecAcceleration.UNVERIFIED }
                if (unverifiedCandidate != null) {
                    return unverifiedCandidate
                }

                // 3. Fall back to software encoder
                return candidates.firstOrNull()
            } catch (e: Exception) {
                Log.w(TAG, "Error discovering H.264 encoders: ${e.message}")
                return null
            }
        }

        /**
         * Computes conservative default bitrates tailored to streaming resolution.
         */
        fun calculateDefaultBitrate(width: Int, height: Int): Int {
            val pixels = width * height
            return when {
                pixels >= 1920 * 1080 -> 4_000_000 // 4.0 Mbps for 1080p
                pixels >= 1280 * 720  -> 2_000_000 // 2.0 Mbps for 720p
                pixels >= 854 * 480   -> 1_000_000 // 1.0 Mbps for 480p
                else                  -> 500_000   // 500 kbps for 360p / low-res
            }
        }

        /**
         * Validates whether any compatible H.264 encoder exists for the configuration.
         */
        fun isConfigurationSupported(width: Int, height: Int, fps: Int): Boolean {
            return findBestEncoder(width, height, fps) != null
        }
    }

    private val lock = Any()
    private var mediaCodec: MediaCodec? = null
    private var inputSurface: Surface? = null

    @Volatile
    private var isRunning = false

    @Volatile
    private var isConfigured = false

    var selectedCodecName: String? = null
        private set

    var acceleration: CodecAcceleration = CodecAcceleration.UNVERIFIED
        private set

    val isHardwareAccelerated: Boolean
        get() = acceleration == CodecAcceleration.HARDWARE

    val isActive: Boolean
        get() = isRunning

    /**
     * Sanitized diagnostic metadata for telemetry and state reporting.
     */
    fun getDiagnosticInfo(): Map<String, Any?> {
        return mapOf(
            "codecName" to (selectedCodecName ?: "UNKNOWN"),
            "acceleration" to acceleration.name,
            "isHardwareAccelerated" to isHardwareAccelerated,
            "width" to width,
            "height" to height,
            "fps" to fps,
            "bitrate" to calculateDefaultBitrate(width, height),
            "isActive" to isRunning
        )
    }

    /**
     * Initializes, binds, and configures the selected MediaCodec instance.
     * Returns the created hardware input Surface.
     */
    fun prepare(): Surface {
        synchronized(lock) {
            if (isConfigured && inputSurface != null) {
                return inputSurface!!
            }

            val candidate = findBestEncoder(width, height, fps)
                ?: throw UnsupportedOperationException(
                    "No compatible H.264 encoder supporting surface input at ${width}x${height}@${fps}fps found"
                )

            selectedCodecName = candidate.info.name
            acceleration = candidate.acceleration
            Log.i(
                TAG,
                "Selected H.264 encoder: $selectedCodecName (Acceleration: ${acceleration.name})"
            )

            try {
                val bitrate = calculateDefaultBitrate(width, height)
                val format = MediaFormat.createVideoFormat(MIME_TYPE, width, height).apply {
                    setInteger(
                        MediaFormat.KEY_COLOR_FORMAT,
                        MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface
                    )
                    setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
                    setInteger(MediaFormat.KEY_FRAME_RATE, fps)
                    setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, DEFAULT_I_FRAME_INTERVAL_SEC)

                    // Optional VBR bitrate mode
                    try {
                        setInteger(
                            MediaFormat.KEY_BITRATE_MODE,
                            MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_VBR
                        )
                    } catch (_: Exception) {}
                }

                val codec = MediaCodec.createByCodecName(candidate.info.name)

                codec.setCallback(object : MediaCodec.Callback() {
                    override fun onInputBufferAvailable(codec: MediaCodec, index: Int) {
                        // Unused for surface input: Camera2 writes directly to input surface
                    }

                    override fun onOutputBufferAvailable(
                        codec: MediaCodec,
                        index: Int,
                        bufferInfo: MediaCodec.BufferInfo
                    ) {
                        if (!isRunning) {
                            try {
                                codec.releaseOutputBuffer(index, false)
                            } catch (_: Exception) {}
                            return
                        }

                        try {
                            val outputBuffer = codec.getOutputBuffer(index)
                            if (outputBuffer != null && bufferInfo.size > 0) {
                                // Strictly slice valid buffer range per BufferInfo
                                val data = ByteArray(bufferInfo.size)
                                outputBuffer.position(bufferInfo.offset)
                                outputBuffer.limit(bufferInfo.offset + bufferInfo.size)
                                outputBuffer.get(data)

                                val isConfig = (bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0
                                val isKeyFrame = (bufferInfo.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME) != 0

                                if (isConfig) {
                                    // Separate SPS/PPS codec configuration buffer — NOT a video frame
                                    Log.d(TAG, "MediaCodec emitted codec config buffer (${data.size} bytes)")
                                    listener?.onCodecConfig(data)
                                } else {
                                    // Real encoded video frame
                                    listener?.onEncodedFrame(
                                        data = data,
                                        isKeyFrame = isKeyFrame,
                                        timestampUs = bufferInfo.presentationTimeUs
                                    )
                                }
                            }
                        } catch (e: Exception) {
                            Log.e(TAG, "Error handling MediaCodec output buffer: ${e.message}", e)
                            listener?.onEncoderError(e)
                        } finally {
                            // Guaranteed release on every path
                            try {
                                codec.releaseOutputBuffer(index, false)
                            } catch (e: Exception) {
                                Log.w(TAG, "Failed to release output buffer $index: ${e.message}")
                            }
                        }
                    }

                    override fun onError(codec: MediaCodec, e: MediaCodec.CodecException) {
                        Log.e(TAG, "MediaCodec asynchronous error: ${e.message}", e)
                        listener?.onEncoderError(e)
                    }

                    override fun onOutputFormatChanged(codec: MediaCodec, format: MediaFormat) {
                        Log.i(TAG, "MediaCodec output format updated: $format")
                        // Extract CSD-0 (SPS) and CSD-1 (PPS) if present in updated format
                        try {
                            val csd0 = format.getByteBuffer("csd-0")
                            if (csd0 != null) {
                                val sps = ByteArray(csd0.remaining())
                                csd0.get(sps)
                                csd0.rewind()
                                listener?.onCodecConfig(sps)
                            }
                            val csd1 = format.getByteBuffer("csd-1")
                            if (csd1 != null) {
                                val pps = ByteArray(csd1.remaining())
                                csd1.get(pps)
                                csd1.rewind()
                                listener?.onCodecConfig(pps)
                            }
                        } catch (e: Exception) {
                            Log.w(TAG, "Failed to extract CSD buffers on format change: ${e.message}")
                        }
                        listener?.onFormatChanged(format)
                    }
                }, callbackHandler)

                codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
                val surface = codec.createInputSurface()

                mediaCodec = codec
                inputSurface = surface
                isConfigured = true

                Log.i(
                    TAG,
                    "MediaCodec prepared ($selectedCodecName, acceleration=${acceleration.name}, ${width}x$height @ $fps fps, bitrate: $bitrate bps)"
                )
                return surface
            } catch (e: Exception) {
                release()
                Log.e(TAG, "Failed to initialize MediaCodecEncoder: ${e.message}", e)
                throw e
            }
        }
    }

    /**
     * Starts encoding. Must be called after prepare() and before camera capture session starts.
     */
    fun start() {
        synchronized(lock) {
            val codec = mediaCodec ?: throw IllegalStateException("Encoder not prepared")
            if (isRunning) return

            try {
                codec.start()
                isRunning = true
                Log.i(TAG, "MediaCodec started ($selectedCodecName)")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to start MediaCodec: ${e.message}", e)
                throw e
            }
        }
    }

    /**
     * Gets the prepared input Surface, or null if not yet prepared.
     */
    fun getInputSurface(): Surface? {
        synchronized(lock) {
            return inputSurface
        }
    }

    /**
     * Stops the encoder safely and signals end of stream.
     */
    fun stop() {
        synchronized(lock) {
            if (!isRunning) return
            isRunning = false

            try {
                mediaCodec?.signalEndOfInputStream()
            } catch (e: Exception) {
                Log.w(TAG, "signalEndOfInputStream failed: ${e.message}")
            }

            try {
                mediaCodec?.stop()
                Log.i(TAG, "MediaCodec stopped")
            } catch (e: Exception) {
                Log.w(TAG, "MediaCodec stop error: ${e.message}")
            }
        }
    }

    /**
     * Releases all encoder and surface resources. Idempotent.
     */
    fun release() {
        synchronized(lock) {
            isRunning = false
            isConfigured = false

            try {
                mediaCodec?.stop()
            } catch (_: Exception) {}

            try {
                mediaCodec?.release()
            } catch (e: Exception) {
                Log.w(TAG, "MediaCodec release error: ${e.message}")
            }
            mediaCodec = null

            try {
                inputSurface?.release()
            } catch (e: Exception) {
                Log.w(TAG, "Input surface release error: ${e.message}")
            }
            inputSurface = null

            Log.i(TAG, "MediaCodec resources fully released")
        }
    }
}
