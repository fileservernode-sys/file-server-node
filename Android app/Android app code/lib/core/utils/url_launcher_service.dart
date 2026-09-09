import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

/// Centralized service for launching canonical ZdexCloud public website URLs
/// in the user's external system browser.
class UrlLauncherService {
  static const String websiteBaseUrl = 'https://zdexcloud.com';
  static const String getStartedUrl = 'https://zdexcloud.com/pages/get-started.html';
  static const String productUrl = 'https://zdexcloud.com/pages/product.html';
  static const String howItWorksUrl = 'https://zdexcloud.com/pages/how-it-works.html';
  static const String documentationUrl = 'https://zdexcloud.com/pages/documentation.html';
  static const String faqUrl = 'https://zdexcloud.com/pages/faq.html';
  static const String pricingUrl = 'https://zdexcloud.com/pages/pricing.html';
  static const String privacyUrl = 'https://zdexcloud.com/pages/privacy.html';
  static const String termsUrl = 'https://zdexcloud.com/pages/terms.html';
  static const String contactUrl = 'https://zdexcloud.com/pages/contact.html';
  static const String supportEmail = 'support@zdexcloud.com';

  /// Launches an external URL safely in the external browser application.
  /// Never displays internal API or gateway URLs on failure.
  static Future<bool> openUrl(BuildContext context, String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) {
      _showFallbackSnackBar(context);
      return false;
    }

    try {
      final launched = await launchUrl(
        uri,
        mode: LaunchMode.externalApplication,
      );

      if (!launched && context.mounted) {
        _showFallbackSnackBar(context);
        return false;
      }
      return true;
    } catch (_) {
      if (context.mounted) {
        _showFallbackSnackBar(context);
      }
      return false;
    }
  }

  static void _showFallbackSnackBar(BuildContext context) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text(
          'Unable to open the website right now. Please check your connection and try again.',
        ),
      ),
    );
  }
}
