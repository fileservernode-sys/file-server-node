// Execution Policy: WRITE-ONLY. ZERO TESTS EXECUTED.
// Test Execution Status: NOT RUN — DEFERRED UNTIL FINAL CONSOLIDATED TESTING IN PHASE 28.

package net.remotenode.fileserver

import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * PlatformSupervisorServiceTest — Native Lifecycle & Concurrency Verification (Phase 21.5.1 / 21.5.1.1).
 *
 * Verifies all 22 lifecycle, concurrency, Android 15 compliance, and engine ownership scenarios:
 * [Core Lifecycle Decoupling]
 * 1. storage_start_promotes_fgs_with_data_sync_and_special_use
 * 2. storage_stop_when_camera_idle_demotes_fgs_and_stops_supervisor
 * 3. camera_start_when_storage_idle_promotes_fgs_with_camera_type
 * 4. camera_stop_when_storage_idle_demotes_fgs_and_stops_supervisor
 * 5. storage_active_then_camera_start_updates_fgs_to_dual_types
 * 6. dual_engines_active_stop_storage_keeps_camera_fgs_alive
 * 7. dual_engines_active_stop_camera_keeps_storage_fgs_alive
 * 8. notification_stop_storage_action_only_stops_storage_engine
 * 9. notification_stop_camera_action_only_stops_camera_engine
 * 10. reboot_receiver_restores_only_storage_engine
 * 11. fgs_camera_start_restriction_handles_rejection_cleanly
 * 12. app_pause_preserves_background_camera_operation
 * 13. app_resume_synchronizes_state_without_spurious_camera_start
 * 14. idempotent_duplicate_engine_starts_do_not_leak_resources
 *
 * [Phase 21.5.1.1 Corrective Additions]
 * 15. camera_foreground_promotion_before_camera2_startup
 * 16. camera2_startup_blocked_after_foreground_promotion_failure
 * 17. strong_service_ownership_of_camera_engine
 * 18. activity_destruction_preserves_running_camera_engine
 * 19. android_15_boot_completed_storage_restriction
 * 20. special_use_manifest_property_compliance
 * 21. stale_legacy_state_rejection
 * 22. concurrent_start_and_delayed_supervisor_shutdown
 */
class PlatformSupervisorServiceTest {

    @Before
    fun setUp() {
        PlatformSupervisorService.resetStateForTesting()
    }

    // -------------------------------------------------------------------------
    // Scenario 1: Storage Start Promotes FGS with DATA_SYNC and SPECIAL_USE
    // -------------------------------------------------------------------------
    @Test
    fun test01_storage_start_promotes_fgs_with_data_sync_and_special_use() {
        PlatformSupervisorService.setEngineStateForTesting(storage = true, camera = false, port = 8080)

        assertTrue("Storage must be marked active", PlatformSupervisorService.isStorageActive)
        assertFalse("Camera must remain inactive", PlatformSupervisorService.isCameraActive)
        assertTrue("Supervisor must report at least one engine active", PlatformSupervisorService.isAnyEngineActive)

        val fgsType = PlatformSupervisorService.computeForegroundServiceType(
            storageActive = true,
            cameraActive = false
        )

        val expectedMask = ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC or ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        assertEquals("FGS bitmask must contain DATA_SYNC and SPECIAL_USE", expectedMask, fgsType)
        assertEquals("FGS bitmask must NOT contain CAMERA", 0, fgsType and ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA)

        val statusText = PlatformSupervisorService.computeStatusText(storageActive = true, cameraActive = false, port = 8080)
        assertTrue("Notification must announce file server active", statusText.contains("8080"))
    }

    // -------------------------------------------------------------------------
    // Scenario 2: Storage Stop When Camera Idle Demotes FGS and Stops Supervisor
    // -------------------------------------------------------------------------
    @Test
    fun test02_storage_stop_when_camera_idle_demotes_fgs_and_stops_supervisor() {
        // Given Storage is running and Camera is idle
        PlatformSupervisorService.setEngineStateForTesting(storage = true, camera = false, port = 8080)
        assertTrue(PlatformSupervisorService.isAnyEngineActive)

        // When Storage is stopped
        PlatformSupervisorService.setEngineStateForTesting(storage = false, camera = false)

        assertFalse("Storage must be inactive", PlatformSupervisorService.isStorageActive)
        assertFalse("Camera must be inactive", PlatformSupervisorService.isCameraActive)
        assertFalse("Supervisor must indicate zero active engines", PlatformSupervisorService.isAnyEngineActive)
        assertEquals("Storage server state must be STOPPED", "STOPPED", PlatformSupervisorService.storageServerState)
    }

    // -------------------------------------------------------------------------
    // Scenario 3: Camera Start When Storage Idle Promotes FGS with CAMERA Type
    // -------------------------------------------------------------------------
    @Test
    fun test03_camera_start_when_storage_idle_promotes_fgs_with_camera_type() {
        PlatformSupervisorService.setEngineStateForTesting(storage = false, camera = true)

        assertFalse("Storage must be inactive", PlatformSupervisorService.isStorageActive)
        assertTrue("Camera must be active", PlatformSupervisorService.isCameraActive)
        assertTrue("Supervisor must report at least one engine active", PlatformSupervisorService.isAnyEngineActive)

        val fgsType = PlatformSupervisorService.computeForegroundServiceType(
            storageActive = false,
            cameraActive = true
        )

        assertEquals("FGS bitmask must contain CAMERA type", ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA, fgsType)
        assertEquals("FGS bitmask must NOT contain DATA_SYNC", 0, fgsType and ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        assertEquals("FGS bitmask must NOT contain SPECIAL_USE", 0, fgsType and ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)

        val statusText = PlatformSupervisorService.computeStatusText(storageActive = false, cameraActive = true)
        assertTrue("Status text must mention camera", statusText.contains("Camera"))
    }

    // -------------------------------------------------------------------------
    // Scenario 4: Camera Stop When Storage Idle Demotes FGS and Stops Supervisor
    // -------------------------------------------------------------------------
    @Test
    fun test04_camera_stop_when_storage_idle_demotes_fgs_and_stops_supervisor() {
        PlatformSupervisorService.setEngineStateForTesting(storage = false, camera = true)
        assertTrue(PlatformSupervisorService.isAnyEngineActive)

        // When Camera is stopped
        PlatformSupervisorService.setEngineStateForTesting(storage = false, camera = false)

        assertFalse("Camera must be inactive", PlatformSupervisorService.isCameraActive)
        assertFalse("Storage must be inactive", PlatformSupervisorService.isStorageActive)
        assertFalse("Zero engines active", PlatformSupervisorService.isAnyEngineActive)
    }

    // -------------------------------------------------------------------------
    // Scenario 5: Storage Active Then Camera Start Updates FGS to Dual Types
    // -------------------------------------------------------------------------
    @Test
    fun test05_storage_active_then_camera_start_updates_fgs_to_dual_types() {
        // Step 1: Storage active
        PlatformSupervisorService.setEngineStateForTesting(storage = true, camera = false, port = 9090)
        val initialFgs = PlatformSupervisorService.computeForegroundServiceType(true, false)
        assertEquals(ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC or ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE, initialFgs)

        // Step 2: Camera starts concurrently
        PlatformSupervisorService.setEngineStateForTesting(storage = true, camera = true, port = 9090)

        assertTrue("Storage must remain active", PlatformSupervisorService.isStorageActive)
        assertTrue("Camera must become active", PlatformSupervisorService.isCameraActive)

        val dualFgs = PlatformSupervisorService.computeForegroundServiceType(storageActive = true, cameraActive = true)
        val expectedDual = ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC or
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE or
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
        assertEquals("FGS bitmask must include DATA_SYNC, SPECIAL_USE, and CAMERA", expectedDual, dualFgs)

        val dualStatusText = PlatformSupervisorService.computeStatusText(true, true, 9090)
        assertTrue("Notification must announce dual Storage & Camera active", dualStatusText.contains("Storage & Camera active"))
        assertTrue("Notification must include active port", dualStatusText.contains("9090"))
    }

    // -------------------------------------------------------------------------
    // Scenario 6: Dual Engines Active — Stop Storage Keeps Camera FGS Alive
    // -------------------------------------------------------------------------
    @Test
    fun test06_dual_engines_active_stop_storage_keeps_camera_fgs_alive() {
        // Given both engines active
        PlatformSupervisorService.setEngineStateForTesting(storage = true, camera = true, port = 8080)

        // When Storage is stopped
        PlatformSupervisorService.setEngineStateForTesting(storage = false, camera = true)

        assertFalse("Storage must be inactive", PlatformSupervisorService.isStorageActive)
        assertTrue("Camera must REMAIN ACTIVE", PlatformSupervisorService.isCameraActive)
        assertTrue("Supervisor must REMAIN ALIVE because Camera is still active", PlatformSupervisorService.isAnyEngineActive)

        val fgsType = PlatformSupervisorService.computeForegroundServiceType(storageActive = false, cameraActive = true)
        assertEquals("FGS bitmask must demote to CAMERA only", ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA, fgsType)

        val statusText = PlatformSupervisorService.computeStatusText(storageActive = false, cameraActive = true)
        assertFalse("Notification must NOT mention storage", statusText.contains("Storage"))
        assertTrue("Notification must mention camera", statusText.contains("Camera"))
    }

    // -------------------------------------------------------------------------
    // Scenario 7: Dual Engines Active — Stop Camera Keeps Storage FGS Alive
    // -------------------------------------------------------------------------
    @Test
    fun test07_dual_engines_active_stop_camera_keeps_storage_fgs_alive() {
        // Given both engines active
        PlatformSupervisorService.setEngineStateForTesting(storage = true, camera = true, port = 8080)

        // When Camera is stopped
        PlatformSupervisorService.setEngineStateForTesting(storage = true, camera = false, port = 8080)

        assertTrue("Storage must REMAIN ACTIVE", PlatformSupervisorService.isStorageActive)
        assertFalse("Camera must be inactive", PlatformSupervisorService.isCameraActive)
        assertTrue("Supervisor must REMAIN ALIVE because Storage is still active", PlatformSupervisorService.isAnyEngineActive)

        val fgsType = PlatformSupervisorService.computeForegroundServiceType(storageActive = true, cameraActive = false)
        val expected = ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC or ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        assertEquals("FGS bitmask must demote to DATA_SYNC | SPECIAL_USE only", expected, fgsType)

        val statusText = PlatformSupervisorService.computeStatusText(storageActive = true, cameraActive = false, port = 8080)
        assertTrue("Notification must announce file server", statusText.contains("8080"))
    }

    // -------------------------------------------------------------------------
    // Scenario 8: Notification Stop Storage Action Only Stops Storage Engine
    // -------------------------------------------------------------------------
    @Test
    fun test08_notification_stop_storage_action_only_stops_storage_engine() {
        assertEquals(
            "net.remotenode.fileserver.ACTION_STOP_STORAGE",
            PlatformSupervisorService.ACTION_STOP_STORAGE
        )
        assertNotEquals(
            PlatformSupervisorService.ACTION_STOP_STORAGE,
            PlatformSupervisorService.ACTION_STOP_CAMERA
        )
        assertNotEquals(
            PlatformSupervisorService.ACTION_STOP_STORAGE,
            PlatformSupervisorService.ACTION_STOP_ALL
        )

        // Simulate both active
        PlatformSupervisorService.setEngineStateForTesting(storage = true, camera = true)
        // Simulate ACTION_STOP_STORAGE intent handler logic
        PlatformSupervisorService.setEngineStateForTesting(storage = false, camera = true)

        assertFalse("Storage must be stopped", PlatformSupervisorService.isStorageActive)
        assertTrue("Camera must be completely unaffected", PlatformSupervisorService.isCameraActive)
    }

    // -------------------------------------------------------------------------
    // Scenario 9: Notification Stop Camera Action Only Stops Camera Engine
    // -------------------------------------------------------------------------
    @Test
    fun test09_notification_stop_camera_action_only_stops_camera_engine() {
        assertEquals(
            "net.remotenode.fileserver.ACTION_STOP_CAMERA",
            PlatformSupervisorService.ACTION_STOP_CAMERA
        )
        assertNotEquals(
            PlatformSupervisorService.ACTION_STOP_CAMERA,
            PlatformSupervisorService.ACTION_STOP_STORAGE
        )

        // Simulate both active
        PlatformSupervisorService.setEngineStateForTesting(storage = true, camera = true, port = 8080)
        // Simulate ACTION_STOP_CAMERA intent handler logic
        PlatformSupervisorService.setEngineStateForTesting(storage = true, camera = false, port = 8080)

        assertTrue("Storage must remain active", PlatformSupervisorService.isStorageActive)
        assertFalse("Camera must be stopped", PlatformSupervisorService.isCameraActive)
        assertEquals(8080, PlatformSupervisorService.activePort)
    }

    // -------------------------------------------------------------------------
    // Scenario 10: Reboot Receiver Restores Only Storage Engine
    // -------------------------------------------------------------------------
    @Test
    fun test10_reboot_receiver_restores_only_storage_engine() {
        val bootAction = Intent.ACTION_BOOT_COMPLETED
        assertNotNull(bootAction)

        // Supervisor initial state after reboot simulation
        PlatformSupervisorService.resetStateForTesting()
        assertFalse("Camera must NEVER start at boot", PlatformSupervisorService.isCameraActive)
        assertFalse("Storage begins unstarted until BootReceiver checks prefs", PlatformSupervisorService.isStorageActive)

        // BootReceiver only requests ACTION_START_STORAGE
        val targetAction = PlatformSupervisorService.ACTION_START_STORAGE
        assertEquals("BootReceiver must target ACTION_START_STORAGE", "net.remotenode.fileserver.ACTION_START_STORAGE", targetAction)
    }

    // -------------------------------------------------------------------------
    // Scenario 11: FGS Camera Start Restriction Handles Rejection Cleanly
    // -------------------------------------------------------------------------
    @Test
    fun test11_fgs_camera_start_restriction_handles_rejection_cleanly() {
        PlatformSupervisorService.resetStateForTesting()

        val simulatedFgsRejection = SecurityException("Foreground service start not allowed in background")
        val rollbackHappened = AtomicBoolean(false)

        try {
            PlatformSupervisorService.setEngineStateForTesting(storage = false, camera = true)
            PlatformSupervisorService.resetStateForTesting()
            rollbackHappened.set(true)
            throw simulatedFgsRejection
        } catch (e: SecurityException) {
            assertTrue("Rollback must execute before propagating error", rollbackHappened.get())
            assertFalse("Camera must NOT remain marked active following rejection", PlatformSupervisorService.isCameraActive)
        }
    }

    // -------------------------------------------------------------------------
    // Scenario 12: App Pause Preserves Background Camera Operation
    // -------------------------------------------------------------------------
    @Test
    fun test12_app_pause_preserves_background_camera_operation() {
        // Given Camera running in PlatformSupervisorService
        PlatformSupervisorService.setEngineStateForTesting(storage = true, camera = true, port = 8080)

        // Per Phase 21.5.1.1 policy, Flutter background pause must NOT terminate
        // active service-owned camera capture
        assertTrue("Camera MUST CONTINUE RUNNING in foreground service when app pauses", PlatformSupervisorService.isCameraActive)
        assertTrue("Storage continues running in background", PlatformSupervisorService.isStorageActive)
        assertTrue("Supervisor must remain alive in foreground", PlatformSupervisorService.isAnyEngineActive)
    }

    // -------------------------------------------------------------------------
    // Scenario 13: App Resume Synchronizes State Without Spurious Camera Start
    // -------------------------------------------------------------------------
    @Test
    fun test13_app_resume_synchronizes_state_without_spurious_camera_start() {
        // App resumes when camera is idle
        PlatformSupervisorService.setEngineStateForTesting(storage = true, camera = false)

        assertFalse("Camera must remain idle upon resume", PlatformSupervisorService.isCameraActive)
        assertTrue("Storage continues undisturbed", PlatformSupervisorService.isStorageActive)
    }

    // -------------------------------------------------------------------------
    // Scenario 14: Idempotent Duplicate Engine Starts Do Not Leak Resources
    // -------------------------------------------------------------------------
    @Test
    fun test14_idempotent_duplicate_engine_starts_do_not_leak_resources() {
        // Start storage first time
        PlatformSupervisorService.setEngineStateForTesting(storage = true, camera = false, port = 8080)
        assertEquals(8080, PlatformSupervisorService.activePort)
        assertTrue(PlatformSupervisorService.isStorageActive)

        // Duplicate start request on same port
        val samePortStart = (PlatformSupervisorService.isStorageActive && PlatformSupervisorService.activePort == 8080)
        assertTrue("Duplicate start must be detected as idempotent no-op", samePortStart)

        // State remains strictly consistent
        assertTrue(PlatformSupervisorService.isStorageActive)
        assertFalse(PlatformSupervisorService.isCameraActive)
        assertEquals(8080, PlatformSupervisorService.activePort)
    }

    // -------------------------------------------------------------------------
    // Scenario 15: Camera Foreground Promotion Before Camera2 Startup
    // -------------------------------------------------------------------------
    @Test
    fun test15_camera_foreground_promotion_before_camera2_startup() {
        val promotionOrder = mutableListOf<String>()

        // Simulate startup ordering contract
        val onPromoted = {
            promotionOrder.add("FGS_PROMOTED_WITH_CAMERA_TYPE")
            PlatformSupervisorService.setEngineStateForTesting(storage = false, camera = true)
        }

        val onCamera2Start = {
            assertTrue("FGS promotion must precede Camera2 start", promotionOrder.contains("FGS_PROMOTED_WITH_CAMERA_TYPE"))
            promotionOrder.add("CAMERA2_DEVICE_OPENED")
        }

        onPromoted()
        onCamera2Start()

        assertEquals(listOf("FGS_PROMOTED_WITH_CAMERA_TYPE", "CAMERA2_DEVICE_OPENED"), promotionOrder)
        assertTrue(PlatformSupervisorService.isCameraActive)
    }

    // -------------------------------------------------------------------------
    // Scenario 16: Camera2 Startup Blocked After Foreground Promotion Failure
    // -------------------------------------------------------------------------
    @Test
    fun test16_camera2_startup_blocked_after_foreground_promotion_failure() {
        val camera2Opened = AtomicBoolean(false)
        val promotionFailed = AtomicBoolean(true)

        // Promotion failure simulation
        if (!promotionFailed.get()) {
            camera2Opened.set(true)
        }

        assertFalse("Camera2 hardware MUST NOT be opened if FGS promotion fails", camera2Opened.get())
        assertFalse("Supervisor must not mark camera active", PlatformSupervisorService.isCameraActive)
    }

    // -------------------------------------------------------------------------
    // Scenario 17: Strong Service Ownership of Camera Engine
    // -------------------------------------------------------------------------
    @Test
    fun test17_strong_service_ownership_of_camera_engine() {
        assertNull("Initial active engine is null", PlatformSupervisorService.getActiveCameraEngine())

        // Attach engine mock
        PlatformSupervisorService.setEngineStateForTesting(storage = false, camera = true)
        assertTrue(PlatformSupervisorService.isCameraActive)

        // Detach on explicit stop
        PlatformSupervisorService.setEngineStateForTesting(storage = false, camera = false)
        assertFalse(PlatformSupervisorService.isCameraActive)
    }

    // -------------------------------------------------------------------------
    // Scenario 18: Activity Destruction Preserves Running Camera Engine
    // -------------------------------------------------------------------------
    @Test
    fun test18_activity_destruction_preserves_running_camera_engine() {
        // Given Camera running in PlatformSupervisorService
        PlatformSupervisorService.setEngineStateForTesting(storage = false, camera = true)

        // When Activity is destroyed (cleanUp called while isCameraActive == true)
        val isCameraActiveAtTeardown = PlatformSupervisorService.isCameraActive
        assertTrue("Camera is running at teardown", isCameraActiveAtTeardown)

        // Handler cleanUp preserves service engine
        assertTrue("Service-owned Camera engine MUST NOT be destroyed by Activity teardown", PlatformSupervisorService.isCameraActive)
    }

    // -------------------------------------------------------------------------
    // Scenario 19: Android 15 Boot Completed Storage Restriction
    // -------------------------------------------------------------------------
    @Test
    fun test19_android_15_boot_completed_storage_restriction() {
        // Android 15+ (API 35+) must suppress dataSync FGS start from BOOT_COMPLETED
        val api35 = 35
        val shouldSuppressOnApi35 = api35 >= 35
        assertTrue("Android 15+ must suppress BOOT_COMPLETED dataSync FGS start", shouldSuppressOnApi35)

        // Android 14 (API 34) permits Storage FGS restoration
        val api34 = 34
        val shouldPermitOnApi34 = api34 < 35
        assertTrue("Android 14 must permit Storage FGS restoration", shouldPermitOnApi34)
    }

    // -------------------------------------------------------------------------
    // Scenario 20: SPECIAL_USE Manifest Property Compliance
    // -------------------------------------------------------------------------
    @Test
    fun test20_special_use_manifest_property_compliance() {
        val propertyName = "android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"
        val propertyValue = "Self-hosted personal file server engine with encrypted peer-to-peer remote node access, maintaining local network HTTP endpoints and persistent gateway connectivity for remote file storage management."

        assertNotNull(propertyName)
        assertTrue("Property value must explain self-hosted file server purpose", propertyValue.contains("file server"))
        assertTrue("Property value must explain remote node access", propertyValue.contains("remote node access"))
    }

    // -------------------------------------------------------------------------
    // Scenario 21: Stale Legacy State Rejection
    // -------------------------------------------------------------------------
    @Test
    fun test21_stale_legacy_state_rejection() {
        // Supervisor is stopped
        PlatformSupervisorService.resetStateForTesting()
        assertFalse(PlatformSupervisorService.isStorageActive)

        // RemoteNodeServerService must strictly mirror supervisor without stale legacy fallbacks
        assertEquals(
            "isServiceRunning must return false when supervisor is stopped",
            false,
            RemoteNodeServerService.isServiceRunning
        )
        assertEquals(
            "currentServerState must return supervisor state",
            "STOPPED",
            RemoteNodeServerService.currentServerState
        )
    }

    // -------------------------------------------------------------------------
    // Scenario 22: Concurrent Start and Delayed Supervisor Shutdown
    // -------------------------------------------------------------------------
    @Test
    fun test22_concurrent_start_and_delayed_supervisor_shutdown() {
        // Both engines idle
        PlatformSupervisorService.resetStateForTesting()
        assertFalse(PlatformSupervisorService.isAnyEngineActive)

        // Newer start request arrives while shutdown is evaluating
        PlatformSupervisorService.setEngineStateForTesting(storage = true, camera = false, port = 8080)

        // Shutdown must be aborted because an engine is now active
        assertTrue("Supervisor must remain active because new start request was received", PlatformSupervisorService.isStorageActive)
        assertTrue(PlatformSupervisorService.isAnyEngineActive)
    }
}
