/// Global App Constants
class AppConstants {
  static const String appName = 'RemoteNode';
  static const String appTagline = 'Personal File Server';
  static const String appPackageId = 'net.remotenode.fileserver';

  // Timeout Constants
  static const Duration connectionTimeout = Duration(seconds: 15);
  static const Duration receiveTimeout = Duration(seconds: 30);

  // Minimum Touch Target Size (Accessibility Guideline: 44x44 dp)
  static const double minTouchTargetSize = 44.0;
}
