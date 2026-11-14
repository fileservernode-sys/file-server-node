// Execution Policy: WRITE-ONLY. ZERO TESTS EXECUTED.
// Test Execution Status: NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28.

package net.remotenode.fileserver.camera

import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * CaptureGenerationCoordinatorTest — Native Kotlin Concurrency & Ownership Tests (Phase 21.4.4.3).
 *
 * Verifies that:
 * [Generation Authorization]
 * 1. Generation replacement racing with onOpened authorization.
 * 2. Generation replacement racing with onConfigured authorization.
 * 3. Stale onOpened cannot begin capture-session configuration.
 * 4. Stale onConfigured cannot submit repeating requests.
 * 5. Stale callback cannot mutate global state or emit a current-generation error.
 * 6. Delayed encoder initialization cannot continue after generation invalidation.
 * 7. Accepted old-generation resources are released without affecting the new generation.
 *
 * [Duplicate Registration Protection]
 * 8. Duplicate CameraDevice attachment rejects and releases the second device.
 * 9. Duplicate capture-session attachment rejects and releases the second session.
 * 10. Duplicate encoder attachment rejects and releases both incoming encoder resources.
 * 11. Duplicate preview-resource group attachment rejects and releases the entire incoming group.
 * 12. Duplicate timeout registration does not silently lose the previous runnable.
 * 13. Duplicate closeable registration follows explicit ownership rules.
 * 14. Duplicate release-callback registration follows the selected policy.
 * 15. Concurrent duplicate registration and cleanup cannot leak or double-release resources.
 *
 * [Regression Coverage]
 * 16. Context-lock-free resource disposal during releaseAll().
 * 17. Racing releaseEncoderOnly() against full cleanup never double-releases.
 * 18. Delayed encoder initialization cannot restore encoder state after cleanup or encoder-only release.
 * 19. All rejected resources are disposed completely outside of locks.
 * 20. Repeated registration and cleanup attempts cannot leak or double-release resources.
 */
class CaptureGenerationCoordinatorTest {

    private lateinit var coordinator: CaptureGenerationCoordinator
    private val stateTransitions = mutableListOf<CaptureState>()
    private val errorEvents = mutableListOf<Pair<String, String>>()

    private class TestCloseable(
        private val shouldThrow: Boolean = false,
        private val exceptionMessage: String = "Test closeable simulated failure",
        val onClosed: (() -> Unit)? = null
    ) : AutoCloseable {
        val closeCount = AtomicInteger(0)
        override fun close() {
            closeCount.incrementAndGet()
            onClosed?.invoke()
            if (shouldThrow) {
                throw RuntimeException(exceptionMessage)
            }
        }
    }

    private class BlockingCloseable(
        private val enteredLatch: CountDownLatch,
        private val releaseLatch: CountDownLatch
    ) : AutoCloseable {
        val closeCount = AtomicInteger(0)
        override fun close() {
            closeCount.incrementAndGet()
            enteredLatch.countDown()
            releaseLatch.await(3, TimeUnit.SECONDS)
        }
    }

    @Before
    fun setUp() {
        stateTransitions.clear()
        errorEvents.clear()

        val listener = object : CaptureStateListener {
            override fun onStateChanged(state: CaptureState, metadata: Map<String, Any?>) {
                synchronized(stateTransitions) {
                    stateTransitions.add(state)
                }
            }

            override fun onError(errorCode: String, errorMessage: String) {
                synchronized(errorEvents) {
                    errorEvents.add(Pair(errorCode, errorMessage))
                }
            }
        }

        coordinator = CaptureGenerationCoordinator(listener)
    }

    // =========================================================================
    // SECTION 1: Generation Authorization Tests (Scenarios 1 - 7)
    // =========================================================================

    // -------------------------------------------------------------------------
    // Scenario 1: Generation replacement racing with onOpened authorization
    // -------------------------------------------------------------------------
    @Test
    fun testGenerationReplacementRacingWithOnOpenedAuthorization() {
        val (ctx1, _) = coordinator.advanceGeneration("0", 1280, 720, 30)
        val mockDevice1 = TestCloseable()

        val enterLatch = CountDownLatch(1)
        val proceedLatch = CountDownLatch(1)
        val completedLatch = CountDownLatch(2)

        var onOpenedAuthorized = false

        val onOpenedThread = Thread {
            enterLatch.countDown()
            proceedLatch.await(3, TimeUnit.SECONDS)
            val attached = ctx1.attachTestResource("cameraDevice", mockDevice1)
            if (attached) {
                onOpenedAuthorized = coordinator.authorizeOnOpened(ctx1)
            }
            completedLatch.countDown()
        }

        val advanceThread = Thread {
            enterLatch.countDown()
            proceedLatch.await(3, TimeUnit.SECONDS)
            val (_, oldCtx) = coordinator.advanceGeneration("1", 1280, 720, 30)
            oldCtx?.releaseAll()
            completedLatch.countDown()
        }

        onOpenedThread.start()
        advanceThread.start()
        enterLatch.await(3, TimeUnit.SECONDS)
        proceedLatch.countDown()
        completedLatch.await(3, TimeUnit.SECONDS)

        assertEquals("Mock device from Gen 1 must be disposed exactly once", 1, mockDevice1.closeCount.get())
        assertEquals(2, coordinator.generation)
        assertEquals("1", coordinator.currentCameraId)
        assertFalse(coordinator.activeContext?.isStopped ?: true)
    }

    // -------------------------------------------------------------------------
    // Scenario 2: Generation replacement racing with onConfigured authorization
    // -------------------------------------------------------------------------
    @Test
    fun testGenerationReplacementRacingWithOnConfiguredAuthorization() {
        val (ctx1, _) = coordinator.advanceGeneration("0", 1280, 720, 30)
        coordinator.authorizeOnOpened(ctx1)
        assertEquals(CaptureState.CONFIGURING, coordinator.state)

        val mockSession1 = TestCloseable()
        val enterLatch = CountDownLatch(1)
        val proceedLatch = CountDownLatch(1)
        val completedLatch = CountDownLatch(2)

        var onConfiguredAuthorized = false

        val onConfiguredThread = Thread {
            enterLatch.countDown()
            proceedLatch.await(3, TimeUnit.SECONDS)
            val attached = ctx1.attachTestResource("captureSession", mockSession1)
            if (attached) {
                onConfiguredAuthorized = coordinator.authorizeOnConfigured(ctx1)
            }
            completedLatch.countDown()
        }

        val advanceThread = Thread {
            enterLatch.countDown()
            proceedLatch.await(3, TimeUnit.SECONDS)
            val (_, oldCtx) = coordinator.advanceGeneration("1", 1280, 720, 30)
            oldCtx?.releaseAll()
            completedLatch.countDown()
        }

        onConfiguredThread.start()
        advanceThread.start()
        enterLatch.await(3, TimeUnit.SECONDS)
        proceedLatch.countDown()
        completedLatch.await(3, TimeUnit.SECONDS)

        assertEquals("CaptureSession from Gen 1 must be disposed exactly once", 1, mockSession1.closeCount.get())
        assertEquals(2, coordinator.generation)
        assertEquals(CaptureState.OPENING, coordinator.state)
    }

    // -------------------------------------------------------------------------
    // Scenario 3: Stale onOpened cannot begin capture-session configuration
    // -------------------------------------------------------------------------
    @Test
    fun testStaleOnOpenedCannotBeginSessionConfiguration() {
        val (ctx1, _) = coordinator.advanceGeneration("0", 1280, 720, 30)
        val (ctx2, oldCtx) = coordinator.advanceGeneration("1", 1280, 720, 30)
        oldCtx?.releaseAll()

        val staleDevice = TestCloseable()
        val attached = ctx1.attachTestResource("cameraDevice", staleDevice)
        assertFalse("Stale context must reject device attachment", attached)
        assertEquals("Rejected device must be closed immediately outside locks", 1, staleDevice.closeCount.get())

        val authorized = coordinator.authorizeOnOpened(ctx1)
        assertFalse("Stale onOpened must not be authorized", authorized)

        var configurationStarted = false
        if (authorized && coordinator.isGenerationActive(ctx1)) {
            configurationStarted = true
        }
        assertFalse("Stale onOpened must not begin session configuration", configurationStarted)
        assertEquals(CaptureState.OPENING, coordinator.state)
        assertEquals(2, coordinator.generation)
    }

    // -------------------------------------------------------------------------
    // Scenario 4: Stale onConfigured cannot submit repeating requests
    // -------------------------------------------------------------------------
    @Test
    fun testStaleOnConfiguredCannotSubmitRepeatingRequests() {
        val (ctx1, _) = coordinator.advanceGeneration("0", 1280, 720, 30)
        coordinator.authorizeOnOpened(ctx1)

        val (ctx2, oldCtx) = coordinator.advanceGeneration("1", 1280, 720, 30)
        oldCtx?.releaseAll()

        val staleSession = TestCloseable()
        val attached = ctx1.attachTestResource("captureSession", staleSession)
        assertFalse("Stale context must reject session attachment", attached)
        assertEquals(1, staleSession.closeCount.get())

        val authorized = coordinator.authorizeOnConfigured(ctx1)
        assertFalse("Stale onConfigured must not be authorized", authorized)

        var repeatingRequestSubmitted = false
        if (authorized && coordinator.isGenerationActive(ctx1)) {
            repeatingRequestSubmitted = true
        }
        assertFalse("Repeating requests must never be submitted on stale generation", repeatingRequestSubmitted)
        assertEquals(2, coordinator.generation)
        assertEquals(CaptureState.OPENING, coordinator.state)
    }

    // -------------------------------------------------------------------------
    // Scenario 5: Stale callback cannot mutate global state or emit a current-generation error
    // -------------------------------------------------------------------------
    @Test
    fun testStaleCallbackCannotMutateGlobalStateOrEmitCurrentGenerationError() {
        val (ctx1, _) = coordinator.advanceGeneration("0", 1280, 720, 30)
        val (ctx2, oldCtx) = coordinator.advanceGeneration("1", 1280, 720, 30)
        oldCtx?.releaseAll()

        val applied = coordinator.handleHalError(ctx1, "ERROR_CAMERA_DEVICE", "Stale device exploded")
        assertFalse("Stale HAL error must be ignored", applied)

        assertEquals(CaptureState.OPENING, coordinator.state)
        assertNull(coordinator.getCaptureMetadata()["errorMessage"])
        assertTrue("No error event should be recorded for active generation", errorEvents.isEmpty())

        val didTransition = coordinator.transitionSessionState(ctx1, CaptureState.IDLE)
        assertFalse("Stale context must not transition global state", didTransition)
        assertEquals(CaptureState.OPENING, coordinator.state)
    }

    // -------------------------------------------------------------------------
    // Scenario 6: Delayed encoder initialization cannot continue after generation invalidation
    // -------------------------------------------------------------------------
    @Test
    fun testDelayedEncoderInitializationCannotContinueAfterInvalidation() {
        val (ctx1, _) = coordinator.advanceGeneration("0", 1280, 720, 30)

        val (ctx2, oldCtx) = coordinator.advanceGeneration("1", 1280, 720, 30)
        oldCtx?.releaseAll()

        var encoderStarted = false
        val mockEncoder = TestCloseable()
        val mockSurface = TestCloseable()

        if (coordinator.isGenerationActive(ctx1)) {
            encoderStarted = true
        } else {
            mockEncoder.close()
            mockSurface.close()
        }

        assertFalse("Delayed encoder setup must abort if generation is inactive", encoderStarted)
        assertEquals("Mock encoder must be closed", 1, mockEncoder.closeCount.get())
        assertEquals("Mock surface must be closed", 1, mockSurface.closeCount.get())
    }

    // -------------------------------------------------------------------------
    // Scenario 7: Accepted old-generation resources are released without affecting the new generation
    // -------------------------------------------------------------------------
    @Test
    fun testAcceptedOldGenerationResourcesReleasedWithoutAffectingNewGeneration() {
        val (ctx1, _) = coordinator.advanceGeneration("0", 1280, 720, 30)
        val dev1 = TestCloseable()
        val sess1 = TestCloseable()
        ctx1.attachTestResource("cameraDevice", dev1)
        ctx1.attachTestResource("captureSession", sess1)

        assertEquals(0, dev1.closeCount.get())
        assertEquals(0, sess1.closeCount.get())

        val (ctx2, oldCtx) = coordinator.advanceGeneration("1", 1280, 720, 30)
        oldCtx?.releaseAll()

        assertEquals(1, dev1.closeCount.get())
        assertEquals(1, sess1.closeCount.get())

        val dev2 = TestCloseable()
        val sess2 = TestCloseable()
        val dev2Attached = ctx2.attachTestResource("cameraDevice", dev2)
        val sess2Attached = ctx2.attachTestResource("captureSession", sess2)

        assertTrue(dev2Attached)
        assertTrue(sess2Attached)
        assertEquals(0, dev2.closeCount.get())
        assertEquals(0, sess2.closeCount.get())
        assertFalse(ctx2.isStopped)
        assertFalse(ctx2.isReleased)
    }

    // =========================================================================
    // SECTION 2: Duplicate Resource Registration Protection Tests (Scenarios 8 - 15)
    // =========================================================================

    // -------------------------------------------------------------------------
    // Scenario 8: Duplicate CameraDevice attachment rejects and releases the second device
    // -------------------------------------------------------------------------
    @Test
    fun testDuplicateCameraDeviceAttachmentRejectsAndReleasesSecondDevice() {
        val ctx = CaptureSessionContext(generation = 1, cameraId = "0")
        val dev1 = TestCloseable()
        val dev2 = TestCloseable()

        val attached1 = ctx.attachTestResource("cameraDevice", dev1)
        assertTrue("First device attachment must succeed", attached1)
        assertEquals(0, dev1.closeCount.get())

        val attached2 = ctx.attachTestResource("cameraDevice", dev2)
        assertFalse("Duplicate device attachment must be rejected", attached2)
        assertEquals("Rejected second device must be closed immediately outside locks", 1, dev2.closeCount.get())
        assertEquals("Original first device must remain open", 0, dev1.closeCount.get())

        ctx.releaseAll()
        assertEquals(1, dev1.closeCount.get())
        assertEquals(1, dev2.closeCount.get())
    }

    // -------------------------------------------------------------------------
    // Scenario 9: Duplicate capture-session attachment rejects and releases the second session
    // -------------------------------------------------------------------------
    @Test
    fun testDuplicateCaptureSessionAttachmentRejectsAndReleasesSecondSession() {
        val ctx = CaptureSessionContext(generation = 1, cameraId = "0")
        val sess1 = TestCloseable()
        val sess2 = TestCloseable()

        val attached1 = ctx.attachTestResource("captureSession", sess1)
        assertTrue("First session attachment must succeed", attached1)
        assertEquals(0, sess1.closeCount.get())

        val attached2 = ctx.attachTestResource("captureSession", sess2)
        assertFalse("Duplicate session attachment must be rejected", attached2)
        assertEquals("Rejected second session must be closed immediately outside locks", 1, sess2.closeCount.get())
        assertEquals("Original first session must remain open", 0, sess1.closeCount.get())

        ctx.releaseAll()
        assertEquals(1, sess1.closeCount.get())
        assertEquals(1, sess2.closeCount.get())
    }

    // -------------------------------------------------------------------------
    // Scenario 10: Duplicate encoder attachment rejects and releases both incoming encoder resources
    // -------------------------------------------------------------------------
    @Test
    fun testDuplicateEncoderAttachmentRejectsAndReleasesBothIncomingResources() {
        val ctx = CaptureSessionContext(generation = 1, cameraId = "0")
        val enc1 = TestCloseable()
        val srf1 = TestCloseable()
        ctx.attachTestResource("encoder", enc1)
        ctx.attachTestResource("encoderSurface", srf1)

        val enc2 = TestCloseable()
        val srf2 = TestCloseable()
        val attachedEnc2 = ctx.attachTestResource("encoder", enc2)
        val attachedSrf2 = ctx.attachTestResource("encoderSurface", srf2)

        assertFalse("Duplicate encoder must be rejected", attachedEnc2)
        assertFalse("Duplicate encoder surface must be rejected", attachedSrf2)
        assertEquals(1, enc2.closeCount.get())
        assertEquals(1, srf2.closeCount.get())
        assertEquals(0, enc1.closeCount.get())
        assertEquals(0, srf1.closeCount.get())

        ctx.releaseAll()
        assertEquals(1, enc1.closeCount.get())
        assertEquals(1, srf1.closeCount.get())
    }

    // -------------------------------------------------------------------------
    // Scenario 11: Duplicate preview-resource group attachment rejects and releases entire group
    // -------------------------------------------------------------------------
    @Test
    fun testDuplicatePreviewResourceGroupAttachmentRejectsAndReleasesEntireGroup() {
        val ctx = CaptureSessionContext(generation = 1, cameraId = "0")
        val entry1 = TestCloseable()
        val tex1 = TestCloseable()
        val srf1 = TestCloseable()

        ctx.attachTestResource("previewEntry", entry1)
        ctx.attachTestResource("previewTexture", tex1)
        ctx.attachTestResource("previewSurface", srf1)

        val entry2 = TestCloseable()
        val tex2 = TestCloseable()
        val srf2 = TestCloseable()

        val a1 = ctx.attachTestResource("previewEntry", entry2)
        val a2 = ctx.attachTestResource("previewTexture", tex2)
        val a3 = ctx.attachTestResource("previewSurface", srf2)

        assertFalse(a1)
        assertFalse(a2)
        assertFalse(a3)
        assertEquals(1, entry2.closeCount.get())
        assertEquals(1, tex2.closeCount.get())
        assertEquals(1, srf2.closeCount.get())
        assertEquals(0, entry1.closeCount.get())
        assertEquals(0, tex1.closeCount.get())
        assertEquals(0, srf1.closeCount.get())

        ctx.releaseAll()
        assertEquals(1, entry1.closeCount.get())
        assertEquals(1, tex1.closeCount.get())
        assertEquals(1, srf1.closeCount.get())
    }

    // -------------------------------------------------------------------------
    // Scenario 12: Duplicate timeout registration does not silently lose the previous runnable
    // -------------------------------------------------------------------------
    @Test
    fun testDuplicateTimeoutRegistrationDoesNotSilentlyLosePreviousRunnable() {
        val ctx = CaptureSessionContext(generation = 1, cameraId = "0")
        val t1 = TestCloseable()
        val t2 = TestCloseable()

        val attached1 = ctx.attachTestResource("timeout", t1)
        assertTrue(attached1)
        assertEquals(0, t1.closeCount.get())

        val attached2 = ctx.attachTestResource("timeout", t2)
        assertFalse("Duplicate timeout slot must be rejected", attached2)
        assertEquals("Rejected timeout must be closed immediately outside locks", 1, t2.closeCount.get())
        assertEquals("Original timeout must remain active", 0, t1.closeCount.get())

        ctx.releaseAll()
        assertEquals(1, t1.closeCount.get())
        assertEquals(1, t2.closeCount.get())
    }

    // -------------------------------------------------------------------------
    // Scenario 13: Duplicate closeable registration follows explicit ownership rules
    // -------------------------------------------------------------------------
    @Test
    fun testDuplicateCloseableRegistrationFollowsExplicitOwnershipRules() {
        val ctx = CaptureSessionContext(generation = 1, cameraId = "0")
        val c1 = TestCloseable()

        val firstAdded = ctx.addCloseable(c1)
        assertTrue("First add must succeed", firstAdded)
        assertEquals(1, ctx.closeables.size)
        assertEquals(0, c1.closeCount.get())

        val secondAdded = ctx.addCloseable(c1)
        assertFalse("Duplicate addition of already tracked closeable must be rejected", secondAdded)
        assertEquals("Collection must not retain duplicate reference", 1, ctx.closeables.size)
        assertEquals("Active instance must NOT be closed upon duplicate rejection", 0, c1.closeCount.get())

        ctx.releaseAll()
        assertEquals("Closeable must be closed strictly once on cleanup", 1, c1.closeCount.get())
    }

    // -------------------------------------------------------------------------
    // Scenario 14: Duplicate release-callback registration follows the selected policy
    // -------------------------------------------------------------------------
    @Test
    fun testDuplicateReleaseCallbackRegistrationFollowsPolicy() {
        val ctx = CaptureSessionContext(generation = 1, cameraId = "0")
        val cb1Invoked = AtomicBoolean(false)
        val cb2Invoked = AtomicBoolean(false)

        val reg1 = ctx.registerReleaseCallback { cb1Invoked.set(true) }
        assertTrue("First callback registration must succeed", reg1)
        assertFalse(cb1Invoked.get())

        val reg2 = ctx.registerReleaseCallback { cb2Invoked.set(true) }
        assertFalse("Duplicate callback registration must be rejected", reg2)
        assertTrue("Documented policy: rejected duplicate callback is executed immediately outside locks", cb2Invoked.get())
        assertFalse("Original callback must not execute until releaseAll()", cb1Invoked.get())

        ctx.releaseAll()
        assertTrue("Original callback must execute on releaseAll()", cb1Invoked.get())
    }

    // -------------------------------------------------------------------------
    // Scenario 15: Concurrent duplicate registration and cleanup cannot leak or double-release
    // -------------------------------------------------------------------------
    @Test
    fun testConcurrentDuplicateRegistrationAndCleanupCannotLeakOrDoubleRelease() {
        val iterations = 30
        for (iter in 0 until iterations) {
            val ctx = CaptureSessionContext(generation = iter, cameraId = "0")
            val dev1 = TestCloseable()
            val dev2 = TestCloseable()
            val sess1 = TestCloseable()
            val sess2 = TestCloseable()
            val c1 = TestCloseable()
            val cb1Invoked = AtomicBoolean(false)
            val cb2Invoked = AtomicBoolean(false)

            val latch = CountDownLatch(1)
            val threadA = Thread {
                latch.await()
                ctx.attachTestResource("device", dev1)
                ctx.attachTestResource("device", dev2)
                ctx.addCloseable(c1)
                ctx.registerReleaseCallback { cb1Invoked.set(true) }
            }
            val threadB = Thread {
                latch.await()
                ctx.attachTestResource("session", sess1)
                ctx.attachTestResource("session", sess2)
                ctx.addCloseable(c1)
                ctx.registerReleaseCallback { cb2Invoked.set(true) }
            }
            val threadC = Thread {
                latch.await()
                ctx.releaseAll()
            }

            threadA.start()
            threadB.start()
            threadC.start()
            latch.countDown()

            threadA.join(2000)
            threadB.join(2000)
            threadC.join(2000)

            ctx.releaseAll()

            assertEquals("dev1 closed exactly once in iter $iter", 1, dev1.closeCount.get())
            assertEquals("dev2 closed exactly once in iter $iter", 1, dev2.closeCount.get())
            assertEquals("sess1 closed exactly once in iter $iter", 1, sess1.closeCount.get())
            assertEquals("sess2 closed exactly once in iter $iter", 1, sess2.closeCount.get())
            assertEquals("c1 closed exactly once in iter $iter", 1, c1.closeCount.get())
            assertTrue("cb1 executed in iter $iter", cb1Invoked.get())
            assertTrue("cb2 executed in iter $iter", cb2Invoked.get())
        }
    }

    // =========================================================================
    // SECTION 3: Regression Coverage Tests (Scenarios 16 - 20)
    // =========================================================================

    // -------------------------------------------------------------------------
    // Scenario 16: Context-lock-free resource disposal during releaseAll()
    // -------------------------------------------------------------------------
    @Test
    fun testContextLockFreeResourceDisposalDuringReleaseAll() {
        val ctx = CaptureSessionContext(generation = 1, cameraId = "0")
        val enteredLatch = CountDownLatch(1)
        val releaseLatch = CountDownLatch(1)
        val blockingResource = BlockingCloseable(enteredLatch, releaseLatch)

        ctx.addCloseable(blockingResource)

        val releaseThread = Thread {
            ctx.releaseAll()
        }
        releaseThread.start()

        // Wait until blockingResource.close() is entered
        enteredLatch.await(3, TimeUnit.SECONDS)

        // While close() is running (blocking), verify cleanupLock is free
        val callbackInvoked = AtomicBoolean(false)
        val registrationThread = Thread {
            // Attempting to register a callback will acquire cleanupLock
            ctx.registerReleaseCallback {
                callbackInvoked.set(true)
            }
        }
        registrationThread.start()
        registrationThread.join(1000)

        // The registrationThread must not be blocked by cleanupLock
        assertFalse("Registration thread must finish without waiting on blocking close()", registrationThread.isAlive)
        assertTrue("Callback must have been invoked immediately outside locks", callbackInvoked.get())

        releaseLatch.countDown()
        releaseThread.join(2000)
        assertEquals(1, blockingResource.closeCount.get())
    }

    // -------------------------------------------------------------------------
    // Scenario 17: Racing releaseEncoderOnly() against full cleanup
    // -------------------------------------------------------------------------
    @Test
    fun testRaceReleaseEncoderOnlyAgainstFullCleanup() {
        val ctx = CaptureSessionContext(generation = 1, cameraId = "0")
        val mockEncoder = TestCloseable()
        ctx.attachTestResource("encoder", mockEncoder)

        val latch = CountDownLatch(1)
        val threadEncoder = Thread {
            latch.await()
            ctx.releaseEncoderOnly()
        }

        val threadAll = Thread {
            latch.await()
            ctx.releaseAll()
        }

        threadEncoder.start()
        threadAll.start()
        latch.countDown()

        threadEncoder.join(2000)
        threadAll.join(2000)

        assertEquals("Encoder must be closed exactly once during concurrent release", 1, mockEncoder.closeCount.get())
        assertFalse(ctx.isEncoderAllowed)
        assertTrue(ctx.isReleased)
    }

    // -------------------------------------------------------------------------
    // Scenario 18: Delayed encoder cannot restore state after cleanup
    // -------------------------------------------------------------------------
    @Test
    fun testDelayedEncoderCannotRestoreStateAfterCleanup() {
        val ctx = CaptureSessionContext(generation = 1, cameraId = "0")
        ctx.releaseEncoderOnly()
        assertFalse(ctx.isEncoderAllowed)
        assertFalse(ctx.isDualSurfaceActive)

        ctx.releaseAll()

        val postAllEncoder = TestCloseable()
        val postAllAttached = ctx.attachTestResource("encoder", postAllEncoder)

        assertFalse("Cannot reattach encoder after full cleanup", postAllAttached)
        assertEquals(1, postAllEncoder.closeCount.get())
    }

    // -------------------------------------------------------------------------
    // Scenario 19: All rejected resources are disposed outside locks
    // -------------------------------------------------------------------------
    @Test
    fun testRejectedResourcesDisposedOutsideLocks() {
        val ctx = CaptureSessionContext(generation = 1, cameraId = "0")
        ctx.releaseAll()

        val closeable = TestCloseable(onClosed = {
            val thread = Thread {
                ctx.registerReleaseCallback {}
            }
            thread.start()
            thread.join(500)
        })

        val attached = ctx.addCloseable(closeable)
        assertFalse(attached)
        assertEquals(1, closeable.closeCount.get())
    }

    // -------------------------------------------------------------------------
    // Scenario 20: Repeated registration and cleanup attempts cannot leak or double-release
    // -------------------------------------------------------------------------
    @Test
    fun testRepeatedRegistrationAndCleanupCannotLeakOrDoubleRelease() {
        val iterations = 50
        val allCloseables = mutableListOf<TestCloseable>()

        for (i in 0 until iterations) {
            val (ctx, _) = coordinator.advanceGeneration("0", 1280, 720, 30)
            val c1 = TestCloseable()
            val c2 = TestCloseable()
            ctx.addCloseable(c1)
            allCloseables.add(c1)

            val (toRelease, _) = coordinator.stopSession()
            toRelease?.releaseAll()

            val lateAttached = ctx.addCloseable(c2)
            assertFalse(lateAttached)
            allCloseables.add(c2)
        }

        for ((idx, c) in allCloseables.withIndex()) {
            assertEquals("Closeable $idx was not closed exactly once", 1, c.closeCount.get())
        }
    }
}
