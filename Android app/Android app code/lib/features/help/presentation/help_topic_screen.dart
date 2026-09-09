import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/utils/url_launcher_service.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_header.dart';

/// Topic data model for native Help & Learn educational content
class HelpTopicData {
  final String id;
  final String title;
  final String subtitle;
  final IconData icon;
  final List<String> paragraphs;
  final List<Map<String, String>> keyPoints;
  final String? calloutTitle;
  final String? calloutText;
  final String websiteCtaLabel;
  final String websiteUrl;

  const HelpTopicData({
    required this.id,
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.paragraphs,
    required this.keyPoints,
    this.calloutTitle,
    this.calloutText,
    required this.websiteCtaLabel,
    required this.websiteUrl,
  });
}

/// Comprehensive native catalog of all 11 ZdexCloud Help & Learn topics
class HelpTopicsCatalog {
  static const Map<String, HelpTopicData> topics = {
    'getting-started': HelpTopicData(
      id: 'getting-started',
      title: 'Getting Started',
      subtitle: 'Set up your Android phone as a personal file server',
      icon: Icons.rocket_launch_outlined,
      paragraphs: [
        'ZdexCloud turns your Android smartphone into a private, dedicated personal file server with remote web access from any modern browser.',
        'The setup process connects your physical device to the ZdexCloud secure connection service so you can access your storage remotely without configuring home router port forwarding.',
      ],
      keyPoints: [
        {
          'title': '1. Create Account & Sign In',
          'detail': 'Sign in with your ZdexCloud platform email and password, verified via 6-digit OTP.'
        },
        {
          'title': '2. Configure Device Host',
          'detail': 'Name your server and choose the storage directories you wish to make accessible.'
        },
        {
          'title': '3. Set Server Credentials',
          'detail': 'Configure dedicated file-manager credentials for browser login.'
        },
        {
          'title': '4. Review & Start Server',
          'detail': 'Start the embedded on-device server and establish the secure outbound connection.'
        },
        {
          'title': '5. Access Remotely',
          'detail': 'Log in from any browser using your remote address and server credentials.'
        },
      ],
      calloutTitle: 'Device Manufacturer Note',
      calloutText:
          'Android may show different permission names or settings screens depending on your device manufacturer (Samsung, Xiaomi, Google, OnePlus, etc.) and OS version.',
      websiteCtaLabel: 'View complete setup guide',
      websiteUrl: UrlLauncherService.getStartedUrl,
    ),
    'how-it-works': HelpTopicData(
      id: 'how-it-works',
      title: 'How ZdexCloud Works',
      subtitle: 'See how your phone, connection service, and browser work together',
      icon: Icons.account_tree_outlined,
      paragraphs: [
        'ZdexCloud uses a private host-node architecture where your physical Android device functions as the true file storage host.',
        'The phone runs an embedded on-device file server and maintains a secure outbound connection to the ZdexCloud connection service over TLS encryption.',
      ],
      keyPoints: [
        {
          'title': 'Your Browser',
          'detail': 'Connects over HTTPS to the web dashboard and requests file operations.'
        },
        {
          'title': 'ZdexCloud Connection Service',
          'detail': 'Maintains the secure bidirectional path between your browser and Android server.'
        },
        {
          'title': 'Your Android Server',
          'detail': 'Embedded on-device engine validates requests and performs file I/O on phone storage.'
        },
        {
          'title': 'Your Phone Storage',
          'detail': 'Files remain on your physical device media and are transferred on-demand.'
        },
      ],
      calloutTitle: 'Zero Port Forwarding',
      calloutText:
          'Because the Android application originates an outbound encrypted connection, your server works smoothly across residential Wi-Fi, carrier NAT, and mobile cellular data without router configuration.',
      websiteCtaLabel: 'See the full architecture',
      websiteUrl: UrlLauncherService.howItWorksUrl,
    ),
    'your-server': HelpTopicData(
      id: 'your-server',
      title: 'Your Android Server',
      subtitle: 'Understand server status, credentials, and device management',
      icon: Icons.dns_outlined,
      paragraphs: [
        'Your Android phone is the actual storage host. When the server is active, it runs an embedded file-server engine that handles file reading, writing, and directory listing.',
        'The application manages the server lifecycle, socket listener, and background connection states.',
      ],
      keyPoints: [
        {
          'title': 'Server Lifecycle States',
          'detail': 'Status transitions through Starting, Connecting, Running, Reconnecting, and Stopped.'
        },
        {
          'title': 'Server Credentials',
          'detail': 'Your server username and password are used to authenticate remote browser sessions.'
        },
        {
          'title': 'Device Identity',
          'detail': 'The application maintains a persistent device identity so your phone is recognized across restarts.'
        },
      ],
      calloutTitle: 'Credential Separation',
      calloutText:
          'Server credentials protect file access on your phone and are distinct from your main ZdexCloud platform account credentials.',
      websiteCtaLabel: 'Explore server features',
      websiteUrl: UrlLauncherService.productUrl,
    ),
    'storage-files': HelpTopicData(
      id: 'storage-files',
      title: 'Storage & Files',
      subtitle: 'Learn where your files live and how remote file access works',
      icon: Icons.folder_special_outlined,
      paragraphs: [
        'Your Android device provides the physical storage for your personal server. Files are stored on your device internal flash storage or installed micro-SD card.',
        'Available capacity depends entirely on your phone available free space. ZdexCloud does not impose arbitrary cloud storage quotas on your own hardware.',
      ],
      keyPoints: [
        {
          'title': 'Local Storage Host',
          'detail': 'Files remain on your configured Android device directories and are not copied to central servers.'
        },
        {
          'title': 'On-Demand Transfer',
          'detail': 'When you download or stream a file, data transfers directly from your phone through the secure connection.'
        },
        {
          'title': 'User Backup Responsibility',
          'detail': 'Because files reside on your phone, you should maintain independent backups of critical data.'
        },
      ],
      calloutTitle: 'Hardware Longevity',
      calloutText:
          'Repurposing a dedicated or spare Android phone plugged into power provides an eco-friendly, high-capacity personal server.',
      websiteCtaLabel: 'Learn about storage capabilities',
      websiteUrl: UrlLauncherService.productUrl,
    ),
    'permissions-battery': HelpTopicData(
      id: 'permissions-battery',
      title: 'Permissions & Battery',
      subtitle: 'Understand Android permissions and battery settings needed for reliable operation',
      icon: Icons.battery_charging_full_outlined,
      paragraphs: [
        'To operate reliably as a personal server, the Android app requires specific permissions and background power settings.',
        'Modern Android operating systems aggressively suspend background applications to save battery unless explicitly configured.',
      ],
      keyPoints: [
        {
          'title': 'Storage Access',
          'detail': 'Required to read, upload, and organize files in your designated server folders.'
        },
        {
          'title': 'Notification Permission',
          'detail': 'Enables Android foreground service notifications to keep the server active.'
        },
        {
          'title': 'Battery Optimization Exclusion',
          'detail': 'Prevents Android OS Doze mode from putting the server engine to sleep.'
        },
        {
          'title': 'OEM-Specific Restrictions',
          'detail': 'Manufacturers like Xiaomi, Samsung, and Huawei require disabling app-killer restrictions.'
        },
      ],
      calloutTitle: 'Continuous Operation Design',
      calloutText:
          'ZdexCloud is designed for continuous background operation when plugged into continuous power with battery optimization disabled.',
      websiteCtaLabel: 'View Android reliability guidance',
      websiteUrl: UrlLauncherService.documentationUrl,
    ),
    'remote-access': HelpTopicData(
      id: 'remote-access',
      title: 'Remote Access',
      subtitle: 'Learn how to access your server remotely without router port forwarding',
      icon: Icons.public_outlined,
      paragraphs: [
        'ZdexCloud is designed to provide secure remote access anywhere in the world without requiring dynamic DNS or inbound router configuration.',
        'Traditional self-hosting requires exposing open ports on your home router. ZdexCloud eliminates this complexity.',
      ],
      keyPoints: [
        {
          'title': '1. Outbound Secure Connection',
          'detail': 'Your phone establishes an outbound TLS connection to the connection service.'
        },
        {
          'title': '2. Bidirectional Relay',
          'detail': 'The connection service routes browser requests to your phone server and returns responses.'
        },
        {
          'title': '3. Firewall & CGNAT Traversal',
          'detail': 'Outbound connections naturally pass through home Wi-Fi routers and mobile carrier firewalls.'
        },
        {
          'title': '4. Remote Web Dashboard',
          'detail': 'Access your files from any phone, laptop, or tablet browser with HTTPS encryption.'
        },
      ],
      calloutTitle: 'No Public IP Required',
      calloutText:
          'You do not need a static public IP address or port forwarding. The outbound relay handles connection maintenance automatically.',
      websiteCtaLabel: 'Read remote access guide',
      websiteUrl: UrlLauncherService.howItWorksUrl,
    ),
    'security-privacy': HelpTopicData(
      id: 'security-privacy',
      title: 'Security & Privacy',
      subtitle: 'Understand account security, server credentials, and local storage',
      icon: Icons.shield_outlined,
      paragraphs: [
        'Security is central to the ZdexCloud architecture. We employ defense-in-depth across authentication, transmission, and access control.',
        'Your files remain stored on your personal phone hardware and are transferred over encrypted channels during remote access.',
      ],
      keyPoints: [
        {
          'title': 'Multi-Factor OTP Authentication',
          'detail': 'Platform logins require email password plus 6-digit one-time verification codes.'
        },
        {
          'title': 'Encrypted Transmission',
          'detail': 'All remote file transfers and control messages use TLS 1.3 encryption.'
        },
        {
          'title': 'Dedicated Server Credentials',
          'detail': 'File manager access uses separate credentials configured on your phone.'
        },
        {
          'title': '24-Hour Web Session Lifetime',
          'detail': 'Browser sessions expire automatically after 24 hours to minimize exposure.'
        },
      ],
      calloutTitle: 'Security Best Practices',
      calloutText:
          'Never share your password, OTP verification codes, or private server credentials with anyone, including support staff.',
      websiteCtaLabel: 'Read the Privacy Policy',
      websiteUrl: UrlLauncherService.privacyUrl,
    ),
    'accounts-sessions': HelpTopicData(
      id: 'accounts-sessions',
      title: 'Accounts & Sessions',
      subtitle: 'Learn how your web account session differs from your Android server',
      icon: Icons.manage_accounts_outlined,
      paragraphs: [
        'It is important to understand the three distinct concepts in the ZdexCloud ecosystem: platform account, web session, and server lifecycle.',
        'Your Android server continues running independently in the background even when your browser session expires.',
      ],
      keyPoints: [
        {
          'title': 'Platform Account',
          'detail': 'Your registered email and password used to manage subscriptions and device registration.'
        },
        {
          'title': 'Web Platform Session',
          'detail': 'Enforces a strict absolute 24-hour lifetime. After 24 hours, you must sign in again.'
        },
        {
          'title': 'Android Server Lifecycle',
          'detail': 'Runs continuously in the background on your phone and is not interrupted by web logout.'
        },
      ],
      calloutTitle: 'Independent Operation',
      calloutText:
          'Closing your browser or having your web session expire does NOT stop your Android server from running.',
      websiteCtaLabel: 'Read the Terms of Service',
      websiteUrl: UrlLauncherService.termsUrl,
    ),
    'multiple-servers': HelpTopicData(
      id: 'multiple-servers',
      title: 'Multiple Servers',
      subtitle: 'Manage multiple Android storage hosts from one account where your plan allows it',
      icon: Icons.devices_other_outlined,
      paragraphs: [
        'ZdexCloud allows managing multiple physical Android servers under a single platform account depending on your subscription tier.',
        'Each physical phone operates as an independent node with its own unique storage, server name, and credentials.',
      ],
      keyPoints: [
        {
          'title': 'Free Plan',
          'detail': 'Includes 1 registered Android server node (₹0 forever).'
        },
        {
          'title': 'Pro Monthly (₹49/month)',
          'detail': 'Supports up to 5 concurrent Android server nodes.'
        },
        {
          'title': 'Pro Yearly (₹500/year)',
          'detail': 'Supports up to 5 concurrent Android server nodes with ₹88 annual savings (₹41.67/mo effective).'
        },
        {
          'title': 'Independent Node Management',
          'detail': 'Monitor and access each phone storage pool separately from the dashboard.'
        },
      ],
      calloutTitle: 'Commercial Tiers',
      calloutText:
          'Upgrade or manage your subscription anytime from the web platform dashboard.',
      websiteCtaLabel: 'Compare commercial plans',
      websiteUrl: UrlLauncherService.pricingUrl,
    ),
    'troubleshooting': HelpTopicData(
      id: 'troubleshooting',
      title: 'Troubleshooting',
      subtitle: 'Diagnose common setup, connectivity, permission, and background operation problems',
      icon: Icons.build_outlined,
      paragraphs: [
        'If you encounter issues with server startup, connectivity, or remote file access, check these diagnostic solutions.',
        'Most issues are related to Android OS background restrictions or Wi-Fi sleep policies.',
      ],
      keyPoints: [
        {
          'title': 'Server Won\'t Start',
          'detail': 'Verify storage permissions are granted, notification permission is allowed, and available phone storage is above 100MB.'
        },
        {
          'title': 'Server Shows Offline',
          'detail': 'Check that Wi-Fi or mobile data is active, app battery optimization is disabled, and the phone is connected to power.'
        },
        {
          'title': 'Remote Access Does Not Work',
          'detail': 'Confirm the server is in Running state, your device is online, and you are using correct server credentials.'
        },
        {
          'title': 'Files Are Not Visible',
          'detail': 'Check selected storage directories and ensure full storage management permissions are enabled.'
        },
        {
          'title': 'Background Operation Stops',
          'detail': 'Disable OEM battery saver, lock the app in recent apps tray, and disable auto-sleep on Wi-Fi.'
        },
      ],
      calloutTitle: 'Diagnostic Guidance',
      calloutText:
          'Keeping the phone connected to a reliable charger and Wi-Fi network ensures uninterrupted remote access.',
      websiteCtaLabel: 'View full documentation & FAQs',
      websiteUrl: UrlLauncherService.documentationUrl,
    ),
    'contact-support': HelpTopicData(
      id: 'contact-support',
      title: 'Contact Support',
      subtitle: 'Get help without sharing passwords, OTPs, or private server credentials',
      icon: Icons.support_agent_outlined,
      paragraphs: [
        'Need assistance with your ZdexCloud personal server? Our support team is available to help resolve technical and account questions.',
        'You can reach support directly by email or through the official contact form on the website.',
      ],
      keyPoints: [
        {
          'title': 'Official Support Email',
          'detail': 'Reach us directly at support@zdexcloud.com for technical inquiries.'
        },
        {
          'title': 'What to Include',
          'detail': 'Describe your issue, Android OS version, device model, and observed error messages.'
        },
        {
          'title': 'What NEVER to Send',
          'detail': 'Never send your platform password, 6-digit OTP codes, or private server credentials.'
        },
      ],
      calloutTitle: 'Security Warning',
      calloutText:
          'ZdexCloud support staff will NEVER ask for your password, verification codes, or server passwords.',
      websiteCtaLabel: 'Open web support form',
      websiteUrl: UrlLauncherService.contactUrl,
    ),
  };
}

/// Screen rendering detailed educational content for a specific Help & Learn topic
class HelpTopicScreen extends StatelessWidget {
  final String topicId;

  const HelpTopicScreen({super.key, required this.topicId});

  @override
  Widget build(BuildContext context) {
    final topic = HelpTopicsCatalog.topics[topicId] ??
        HelpTopicsCatalog.topics['getting-started']!;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppHeader(
        title: topic.title,
        showBackButton: true,
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints:
                const BoxConstraints(maxWidth: AppSpacing.maxContentWidth),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Hero Card
                  AppCard(
                    padding: const EdgeInsets.all(AppSpacing.xl),
                    color: AppColors.primarySubtle.withValues(alpha: 0.4),
                    borderColor: AppColors.primary.withValues(alpha: 0.25),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          padding: const EdgeInsets.all(AppSpacing.sm),
                          decoration: BoxDecoration(
                            color: AppColors.primary.withValues(alpha: 0.1),
                            shape: BoxShape.circle,
                          ),
                          child: Icon(topic.icon,
                              size: 28, color: AppColors.primary),
                        ),
                        const SizedBox(width: AppSpacing.md),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(topic.title, style: AppTypography.cardTitle),
                              const SizedBox(height: AppSpacing.xxs),
                              Text(
                                topic.subtitle,
                                style: AppTypography.bodySmall
                                    .copyWith(color: AppColors.textSecondary),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xl),

                  // Paragraphs
                  ...topic.paragraphs.map(
                    (p) => Padding(
                      padding: const EdgeInsets.only(bottom: AppSpacing.md),
                      child: Text(
                        p,
                        style: AppTypography.body
                            .copyWith(color: AppColors.textPrimary, height: 1.5),
                      ),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.sm),

                  // Key Points Section
                  const Text('Key Concepts & Steps',
                      style: AppTypography.caption),
                  const SizedBox(height: AppSpacing.xs),
                  AppCard(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    child: Column(
                      children: [
                        for (int i = 0; i < topic.keyPoints.length; i++) ...[
                          if (i > 0) const Divider(height: AppSpacing.lg),
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Icon(Icons.check_circle_outline_rounded,
                                  size: 20, color: AppColors.primary),
                              const SizedBox(width: AppSpacing.sm),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      topic.keyPoints[i]['title']!,
                                      style: AppTypography.body.copyWith(
                                          fontWeight: FontWeight.w600),
                                    ),
                                    const SizedBox(height: AppSpacing.xxs),
                                    Text(
                                      topic.keyPoints[i]['detail']!,
                                      style: AppTypography.bodySmall
                                          .copyWith(color: AppColors.textSecondary),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.lg),

                  // Optional Callout Card
                  if (topic.calloutTitle != null &&
                      topic.calloutText != null) ...[
                    Container(
                      padding: const EdgeInsets.all(AppSpacing.lg),
                      decoration: BoxDecoration(
                        color: AppColors.surfaceSubtle,
                        borderRadius:
                            BorderRadius.circular(AppSpacing.radiusMd),
                        border: Border.all(color: AppColors.borderSubtle),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(Icons.info_outline_rounded,
                              size: 20, color: AppColors.textSecondary),
                          const SizedBox(width: AppSpacing.sm),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(topic.calloutTitle!,
                                    style: AppTypography.body.copyWith(
                                        fontWeight: FontWeight.w600)),
                                const SizedBox(height: AppSpacing.xxs),
                                Text(topic.calloutText!,
                                    style: AppTypography.bodySmall.copyWith(
                                        color: AppColors.textSecondary)),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpacing.xl),
                  ],

                  // Website External Link Action Card
                  AppCard(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Row(
                          children: [
                            Icon(Icons.open_in_new_rounded,
                                size: 18, color: AppColors.primary),
                            SizedBox(width: AppSpacing.xs),
                            Text('Comprehensive Web Documentation',
                                style: AppTypography.cardTitle),
                          ],
                        ),
                        const SizedBox(height: AppSpacing.xs),
                        Text(
                          'Read in-depth technical guides, architecture diagrams, and community FAQs on zdexcloud.com.',
                          style: AppTypography.bodySmall
                              .copyWith(color: AppColors.textSecondary),
                        ),
                        const SizedBox(height: AppSpacing.md),
                        PrimaryButton(
                          label: topic.websiteCtaLabel,
                          icon: Icons.open_in_new_rounded,
                          onPressed: () {
                            UrlLauncherService.openUrl(
                                context, topic.websiteUrl);
                          },
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
