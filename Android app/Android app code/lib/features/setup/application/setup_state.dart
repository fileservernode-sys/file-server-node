import 'dart:async';
import 'dart:io';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../auth/application/auth_state.dart';
import '../../device/data/datasources/device_remote_datasource.dart';
import '../../device/domain/services/device_identity_service.dart';
import '../../remote/domain/services/remote_connection_service.dart';
import '../../server/domain/services/server_service.dart';
import '../../../core/utils/logger.dart';

/// Immutable Setup Configuration, Real Subdomain, and Live State Representation
class SetupState {
  final String deviceName;
  final String serverName;
  final String description;
  final String fileServerUsername;
  final String fileServerPassword;
  final String? deviceId;
  final String? serverInstanceId;
  final String? connectionId;
  final String? assignedSubdomain;
  final String? publicUrl;
  final String? remoteEndpoint;
  final String localServerUrl;
  final bool isLocalOnline;
  final bool isGatewayConnected;
  final String endpointStatus; // 'NOT_CREATED', 'PROVISIONING', 'ACTIVE', 'FAILED'
  final int stageIndex;
  final bool isProcessing;
  final String? errorMessage;

  const SetupState({
    this.deviceName = 'Android Device',
    this.serverName = '',
    this.description = '',
    this.fileServerUsername = 'admin_user',
    this.fileServerPassword = '',
    this.deviceId,
    this.serverInstanceId,
    this.connectionId,
    this.assignedSubdomain,
    this.publicUrl,
    this.remoteEndpoint,
    this.localServerUrl = 'http://127.0.0.1:8080',
    this.isLocalOnline = false,
    this.isGatewayConnected = false,
    this.endpointStatus = 'NOT_CREATED',
    this.stageIndex = 0,
    this.isProcessing = false,
    this.errorMessage,
  });

  SetupState copyWith({
    String? deviceName,
    String? serverName,
    String? description,
    String? fileServerUsername,
    String? fileServerPassword,
    String? deviceId,
    String? serverInstanceId,
    String? connectionId,
    String? assignedSubdomain,
    String? publicUrl,
    String? remoteEndpoint,
    String? localServerUrl,
    bool? isLocalOnline,
    bool? isGatewayConnected,
    String? endpointStatus,
    int? stageIndex,
    bool? isProcessing,
    String? errorMessage,
  }) {
    return SetupState(
      deviceName: deviceName ?? this.deviceName,
      serverName: serverName ?? this.serverName,
      description: description ?? this.description,
      fileServerUsername: fileServerUsername ?? this.fileServerUsername,
      fileServerPassword: fileServerPassword ?? this.fileServerPassword,
      deviceId: deviceId ?? this.deviceId,
      serverInstanceId: serverInstanceId ?? this.serverInstanceId,
      connectionId: connectionId ?? this.connectionId,
      assignedSubdomain: assignedSubdomain ?? this.assignedSubdomain,
      publicUrl: publicUrl ?? this.publicUrl,
      remoteEndpoint: remoteEndpoint ?? this.remoteEndpoint,
      localServerUrl: localServerUrl ?? this.localServerUrl,
      isLocalOnline: isLocalOnline ?? this.isLocalOnline,
      isGatewayConnected: isGatewayConnected ?? this.isGatewayConnected,
      endpointStatus: endpointStatus ?? this.endpointStatus,
      stageIndex: stageIndex ?? this.stageIndex,
      isProcessing: isProcessing ?? this.isProcessing,
      errorMessage: errorMessage,
    );
  }
}

/// Riverpod Providers for Device, Server, & Remote Services
final deviceIdentityServiceProvider = Provider<DeviceIdentityService>((ref) {
  return MethodChannelDeviceIdentityService();
});

final deviceRemoteDataSourceProvider = Provider<DeviceRemoteDataSource>((ref) {
  return HttpDeviceRemoteDataSource();
});

final serverServiceProvider = Provider<ServerService>((ref) {
  return MethodChannelServerService();
});

final remoteConnectionServiceProvider =
    Provider<RemoteConnectionService>((ref) {
  return HttpRemoteConnectionService();
});

final setupStateProvider =
    StateNotifierProvider<SetupStateNotifier, SetupState>((ref) {
  return SetupStateNotifier(ref);
});

/// Setup State Notifier — Executes End-to-End Real Subdomain & Server Lifecycle
class SetupStateNotifier extends StateNotifier<SetupState> {
  final Ref _ref;

  SetupStateNotifier(this._ref) : super(const SetupState()) {
    initDeviceModel();
  }

  Future<void> initDeviceModel() async {
    try {
      final serverService = _ref.read(serverServiceProvider);
      final model = await serverService.getDeviceModel();
      if (state.deviceName == 'Android Device' || state.deviceName.isEmpty) {
        state = state.copyWith(deviceName: model);
      }
    } catch (_) {}
  }

  void setConfiguration({
    required String serverName,
    required String deviceName,
    String description = '',
  }) {
    final authState = _ref.read(authStateProvider);
    final userEmail = authState.session?.user.email ?? authState.pendingEmail ?? '';

    state = state.copyWith(
      serverName: serverName.trim(),
      deviceName: deviceName.trim(),
      description: description.trim(),
      fileServerUsername: userEmail.isNotEmpty ? userEmail : 'account_user',
      fileServerPassword: 'registered_account_auth',
      errorMessage: null,
    );
  }

  void setCredentials({
    required String username,
    required String password,
  }) {
    state = state.copyWith(
      fileServerUsername: username.trim(),
      fileServerPassword: password,
      errorMessage: null,
    );
  }

  /// Central Current-Device Resolution (Batch 5):
  /// Resolves the backend Device record belonging to THIS physical phone installation.
  /// Uses [DeviceIdentityService] to obtain the local installationId and matches it
  /// against the user's registered devices returned by the backend control plane.
  /// Returns null if no device matching local installationId exists.
  /// NEVER falls back to devices.first.
  Future<Map<String, dynamic>?> resolveCurrentDevice({
    required String sessionToken,
  }) async {
    final deviceIdentityService = _ref.read(deviceIdentityServiceProvider);
    final localInstallationId = await deviceIdentityService.getInstallationId();

    final deviceDataSource = _ref.read(deviceRemoteDataSourceProvider);
    final res = await deviceDataSource.getUserDevices(sessionToken: sessionToken);

    if (res['success'] == true && res['data'] != null) {
      final devicesList = res['data']['devices'] as List<dynamic>?;
      if (devicesList != null && devicesList.isNotEmpty) {
        for (final d in devicesList) {
          if (d is Map<String, dynamic>) {
            final instId = d['installationId'] as String?;
            if (instId == localInstallationId) {
              return d;
            }
          }
        }
      }
    }
    return null;
  }

  /// Syncs / Recovers existing device, server, and subdomain topology from MySQL Backend
  /// for THIS physical installationId only.
  Future<void> syncWithBackend() async {
    final authSession = _ref.read(authStateProvider).session;
    final sessionToken = authSession?.accessToken ?? 'dev-mock-session-token';

    try {
      final currentDev = await resolveCurrentDevice(sessionToken: sessionToken);

      if (currentDev != null) {
        final devId = currentDev['id'] as String?;
        final devName = currentDev['deviceName'] as String? ?? state.deviceName;
        final srv = currentDev['server'] as Map<String, dynamic>?;
        final srvId = srv?['id'] as String?;
        final ep = srv?['endpoint'] as Map<String, dynamic>?;
        final hostname = ep?['hostname'] as String?;
        final pubUrl = ep?['publicUrl'] as String? ?? (hostname != null ? 'https://$hostname' : null);
        final epStatus = ep?['status'] as String? ?? (hostname != null ? 'ACTIVE' : 'NOT_CREATED');
        final conn = currentDev['connection'] as Map<String, dynamic>?;
        final connId = conn?['id'] as String?;
        final isConn = conn?['status'] == 'CONNECTED';

        // Check if local HTTP server is actually running
        final serverService = _ref.read(serverServiceProvider);
        final localStatus = await serverService.getServerStatus();
        final localUrl = await serverService.getLocalUrl();
        final isLocal = localStatus['status'] == 'ONLINE';

        String? activeConnId = connId;
        bool isGatewayConnected = isConn;

        // Automatically connect outbound WebSocket to Gateway if device is registered
        if (devId != null && devId.isNotEmpty) {
          try {
            final remoteService = _ref.read(remoteConnectionServiceProvider);
            final connInfo = await remoteService.connect(
              deviceId: devId,
              sessionToken: sessionToken,
            );
            if (connInfo.isConnected) {
              isGatewayConnected = true;
              activeConnId = connInfo.connectionId ?? connId;
            }
          } catch (_) {}
        }

        state = state.copyWith(
          deviceId: devId,
          serverInstanceId: srvId,
          deviceName: devName,
          assignedSubdomain: hostname,
          publicUrl: pubUrl,
          endpointStatus: epStatus,
          connectionId: activeConnId,
          isGatewayConnected: isGatewayConnected,
          isLocalOnline: isLocal,
          localServerUrl: localUrl,
        );
      } else {
        // Explicit "device not registered" for this installationId
        state = state.copyWith(
          deviceId: null,
          serverInstanceId: null,
          assignedSubdomain: null,
          publicUrl: null,
          connectionId: null,
          isGatewayConnected: false,
          endpointStatus: 'NOT_CREATED',
        );
      }
    } catch (_) {
      // Ignored if offline during initial sync
    }
  }

  /// Manually starts both local HTTP server engine and outbound Gateway WebSocket transport
  /// operating strictly on THIS phone's Device record.
  Future<void> startServerNode() async {
    AppLogger.info('[ServerLifecycle] START SERVER NODE: Starting local HTTP engine and remote gateway transport...');
    final serverService = _ref.read(serverServiceProvider);
    await serverService.startServer();

    var authSession = _ref.read(authStateProvider).session;
    if (authSession == null) {
      final secureStorage = _ref.read(secureStorageProvider);
      authSession = await secureStorage.getSession();
      if (authSession != null) {
        await _ref.read(authStateProvider.notifier).restoreSession();
      }
    }
    final sessionToken = authSession?.accessToken;

    if (sessionToken != null && sessionToken.isNotEmpty) {
      String? devId;

      final currentDev = await resolveCurrentDevice(sessionToken: sessionToken);
      if (currentDev != null) {
        devId = currentDev['id'] as String?;
      }

      if (devId != null && devId.isNotEmpty) {
        try {
          final remoteService = _ref.read(remoteConnectionServiceProvider);
          final connInfo = await remoteService.connect(
            deviceId: devId,
            sessionToken: sessionToken,
          );
          state = state.copyWith(
            deviceId: devId,
            isLocalOnline: true,
            isGatewayConnected: connInfo.isConnected || connInfo.status == RemoteConnectionState.connected,
            connectionId: connInfo.connectionId ?? state.connectionId,
          );
          AppLogger.info('[ServerLifecycle] Server node started successfully (Local Engine: ONLINE, Gateway: ${connInfo.isConnected ? "CONNECTED" : "DISCONNECTED"})');
          return;
        } catch (_) {}
      }
    }

    state = state.copyWith(isLocalOnline: true);
    AppLogger.info('[ServerLifecycle] Server node started (Local Engine: ONLINE)');
  }

  /// Manually stops both local HTTP server engine and outbound Gateway WebSocket transport
  Future<void> stopServerNode() async {
    AppLogger.info('[ServerLifecycle] STOP SERVER NODE: Stopping local HTTP engine and remote gateway transport...');
    final serverService = _ref.read(serverServiceProvider);
    await serverService.stopServer();

    final connId = state.connectionId;
    final authSession = _ref.read(authStateProvider).session;
    final sessionToken = authSession?.accessToken;

    if (connId != null && sessionToken != null && sessionToken.isNotEmpty) {
      try {
        final remoteService = _ref.read(remoteConnectionServiceProvider);
        await remoteService.disconnect(
          connectionId: connId,
          sessionToken: sessionToken,
        );
      } catch (_) {}
    }

    state = state.copyWith(
      isLocalOnline: false,
      isGatewayConnected: false,
    );
  }

  /// Executes the actual 6-stage setup & subdomain provisioning sequence
  Future<bool> executeSetup() async {
    if (state.serverName.trim().isEmpty) {
      state = state.copyWith(
        isProcessing: false,
        endpointStatus: 'FAILED',
        errorMessage: 'Server name is required before starting the server.',
      );
      return false;
    }

    final serverService = _ref.read(serverServiceProvider);
    final storageInfo = await serverService.getStorageReadiness();
    if (storageInfo['isSufficient'] == false) {
      state = state.copyWith(
        isProcessing: false,
        endpointStatus: 'FAILED',
        errorMessage: 'Insufficient device storage to safely operate the server (<100MB free).',
      );
      return false;
    }

    state = state.copyWith(
      isProcessing: true,
      stageIndex: 0,
      endpointStatus: 'PROVISIONING',
      errorMessage: null,
    );

    final authSession = _ref.read(authStateProvider).session;
    if (authSession == null || authSession.accessToken.isEmpty) {
      state = state.copyWith(
        isProcessing: false,
        endpointStatus: 'FAILED',
        errorMessage: 'You must be signed in with your RemoteNode platform account to create a server.',
      );
      return false;
    }
    final sessionToken = authSession.accessToken;
    final deviceIdentityService = _ref.read(deviceIdentityServiceProvider);
    final installationId = await deviceIdentityService.getInstallationId();

    try {
      // -----------------------------------------------------------------------
      // Stage 0: Register Device Node with Backend Control Plane
      // -----------------------------------------------------------------------
      state = state.copyWith(stageIndex: 0);
      final osVersion = await serverService.getOsVersion();
      final deviceDataSource = _ref.read(deviceRemoteDataSourceProvider);
      final regResult = await deviceDataSource.registerDevice(
        deviceName: state.deviceName,
        installationId: installationId,
        sessionToken: sessionToken,
        osVersion: osVersion,
        serverName: state.serverName,
        adminUsername: state.fileServerUsername,
        adminPassword: state.fileServerPassword,
      );

      if (regResult['success'] != true || regResult['data'] == null) {
        final errorMsg = regResult['error']?['message'] ?? 'Failed to register device node on database control plane.';
        throw Exception(errorMsg);
      }

      final dev = regResult['data']['device'];
      final registeredDeviceId = dev['id'] as String;
      state = state.copyWith(deviceId: registeredDeviceId);

      // -----------------------------------------------------------------------
      // Stage 1: Configure Credentials & Start Local HTTP File Server on Android (0.0.0.0:8080)
      // -----------------------------------------------------------------------
      state = state.copyWith(stageIndex: 1);
      await serverService.setCredentials(
        username: state.fileServerUsername,
        password: state.fileServerPassword,
      );
      final startRes = await serverService.startServer(port: 8080);
      final localUrl = startRes['localUrl'] as String? ?? 'http://127.0.0.1:8080';

      // -----------------------------------------------------------------------
      // Stage 2: Verify Local HTTP Socket Listener Is Responding
      // -----------------------------------------------------------------------
      state = state.copyWith(stageIndex: 2);
      bool localHealthy = false;
      try {
        final client = HttpClient();
        final req = await client
            .getUrl(Uri.parse('http://127.0.0.1:8080/api/health'))
            .timeout(const Duration(seconds: 3));
        final res = await req.close().timeout(const Duration(seconds: 3));
        localHealthy = res.statusCode == 200;
      } catch (_) {
        localHealthy = startRes['success'] == true;
      }

      state = state.copyWith(
        localServerUrl: localUrl,
        isLocalOnline: localHealthy,
      );

      // -----------------------------------------------------------------------
      // Stage 3: Provision Public Subdomain Endpoint & Gateway Connection Token
      // -----------------------------------------------------------------------
      state = state.copyWith(stageIndex: 3);
      final remoteService = _ref.read(remoteConnectionServiceProvider);
      final connInfo = await remoteService.connect(
        deviceId: registeredDeviceId,
        sessionToken: sessionToken,
      );

      if (connInfo.status == RemoteConnectionState.failed) {
        throw Exception(connInfo.errorMessage ?? 'Subdomain connection failed');
      }

      final hostname = connInfo.hostname ??
          (connInfo.remoteEndpoint != null
              ? Uri.tryParse(connInfo.remoteEndpoint!)?.host
              : null) ??
          'srv-${registeredDeviceId.hashCode.abs()}.gateway.viewduration.com';

      final publicUrl = connInfo.publicUrl ?? 'https://$hostname';

      state = state.copyWith(
        assignedSubdomain: hostname,
        publicUrl: publicUrl,
        remoteEndpoint: connInfo.remoteEndpoint ?? publicUrl,
        connectionId: connInfo.connectionId,
        endpointStatus: 'ACTIVE',
      );

      // -----------------------------------------------------------------------
      // Stage 4: Verify Outbound WebSocket Transport Connection to Gateway
      // -----------------------------------------------------------------------
      state = state.copyWith(stageIndex: 4);
      state = state.copyWith(
        isGatewayConnected: connInfo.isConnected,
      );

      // -----------------------------------------------------------------------
      // Stage 5: Finalize Setup State & Readiness
      // -----------------------------------------------------------------------
      state = state.copyWith(
        stageIndex: 5,
        endpointStatus: 'ACTIVE',
        isProcessing: false,
      );

      return true;
    } catch (e) {
      state = state.copyWith(
        isProcessing: false,
        endpointStatus: 'FAILED',
        errorMessage: 'Subdomain connection failed: ${e.toString()}',
      );
      return false;
    }
  }

  /// Deletes ONLY the active server node belonging to THIS physical phone installation (Batch 5).
  /// Verifies device.installationId == localInstallationId before calling deleteDevice.
  /// After successful deletion, clears local state for THIS device without affecting other devices in the account.
  Future<bool> deleteServer() async {
    final authSession = _ref.read(authStateProvider).session;
    final sessionToken = authSession?.accessToken;

    if (sessionToken == null || sessionToken.isEmpty) {
      state = state.copyWith(
        errorMessage: 'Authentication session expired. Please sign in again before deleting server.',
      );
      return false;
    }

    try {
      // 1. Stop local HTTP server engine on Android
      try {
        final serverService = _ref.read(serverServiceProvider);
        await serverService.stopServer();
      } catch (_) {}

      // 2. Disconnect remote transport
      try {
        final remoteService = _ref.read(remoteConnectionServiceProvider);
        final connId = state.connectionId ?? 'active-conn';
        await remoteService.disconnect(
          connectionId: connId,
          sessionToken: sessionToken,
        );
      } catch (_) {}

      // 3. Resolve device matching ONLY THIS physical phone installation
      final deviceIdentityService = _ref.read(deviceIdentityServiceProvider);
      final localInstallationId = await deviceIdentityService.getInstallationId();

      final currentDev = await resolveCurrentDevice(sessionToken: sessionToken);

      if (currentDev != null) {
        final targetDeviceId = currentDev['id'] as String?;
        final targetInstId = currentDev['installationId'] as String?;

        // PART 9 — DELETE SAFETY: Verify device.installationId == localInstallationId
        if (targetInstId == localInstallationId && targetDeviceId != null && targetDeviceId.isNotEmpty) {
          final deviceDataSource = _ref.read(deviceRemoteDataSourceProvider);
          await deviceDataSource.deleteDevice(
            deviceId: targetDeviceId,
            sessionToken: sessionToken,
          );
        }
      } else if (state.deviceId != null && state.deviceId!.isNotEmpty) {
        // Fallback: If device was registered in state, attempt single delete on state.deviceId
        final deviceDataSource = _ref.read(deviceRemoteDataSourceProvider);
        try {
          await deviceDataSource.deleteDevice(
            deviceId: state.deviceId!,
            sessionToken: sessionToken,
          );
        } catch (_) {}
      }

      // 4. PART 10 — STATE CLEANUP: Reset setup state for THIS device only
      state = const SetupState();
      return true;
    } catch (e) {
      state = state.copyWith(
        errorMessage: 'Failed to delete server: ${e.toString()}',
      );
      return false;
    }
  }
}
