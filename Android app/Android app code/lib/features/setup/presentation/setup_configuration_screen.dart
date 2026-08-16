import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_header.dart';
import '../../../core/widgets/app_text_field.dart';
import '../application/setup_state.dart';
import 'widgets/setup_stepper.dart';

/// Step 2 — Server Configuration Screen
class SetupConfigurationScreen extends ConsumerStatefulWidget {
  const SetupConfigurationScreen({super.key});

  @override
  ConsumerState<SetupConfigurationScreen> createState() =>
      _SetupConfigurationScreenState();
}

class _SetupConfigurationScreenState
    extends ConsumerState<SetupConfigurationScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _serverNameController;
  late final TextEditingController _deviceNameController;
  late final TextEditingController _descriptionController;

  @override
  void initState() {
    super.initState();
    final currentSetup = ref.read(setupStateProvider);
    _serverNameController =
        TextEditingController(text: currentSetup.serverName);
    _deviceNameController =
        TextEditingController(text: currentSetup.deviceName);
    _descriptionController =
        TextEditingController(text: currentSetup.description);
  }

  @override
  void dispose() {
    _serverNameController.dispose();
    _deviceNameController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const AppHeader(
        title: 'Server Setup Wizard',
        showBackButton: true,
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints:
                const BoxConstraints(maxWidth: AppSpacing.maxFormWidth),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const SetupStepper(
                      currentStep: 2,
                      totalSteps: 3,
                      stepTitle: 'Configure Server',
                    ),
                    const SizedBox(height: AppSpacing.xl),
                    const Text(
                      'Name your server node',
                      style: AppTypography.pageTitle,
                    ),
                    const SizedBox(height: AppSpacing.xs),
                    const Text(
                      'Give your personal file server node a friendly name for identification.',
                      style: AppTypography.bodySmall,
                    ),
                    const SizedBox(height: AppSpacing.xl),
                    AppTextField(
                      label: 'Server Name',
                      hintText: 'e.g., Home File Server',
                      controller: _serverNameController,
                      prefixIcon: const Icon(Icons.dns_outlined),
                      validator: (val) {
                        if (val == null || val.trim().isEmpty) {
                          return 'Please enter a server name';
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: AppSpacing.md),
                    AppTextField(
                      label: 'Device Display Name',
                      hintText: 'e.g., Android Phone Host',
                      controller: _deviceNameController,
                      prefixIcon: const Icon(Icons.phone_android_outlined),
                      validator: (val) {
                        if (val == null || val.trim().isEmpty) {
                          return 'Please enter a device display name';
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: AppSpacing.md),
                    AppTextField(
                      label: 'Description (Optional)',
                      hintText: 'e.g., Secondary storage phone in living room',
                      controller: _descriptionController,
                      prefixIcon: const Icon(Icons.notes_outlined),
                    ),
                    const SizedBox(height: AppSpacing.xxl),
                    PrimaryButton(
                      label: 'Continue',
                      icon: Icons.arrow_forward,
                      onPressed: () {
                        if (_formKey.currentState?.validate() ?? false) {
                          ref.read(setupStateProvider.notifier).setConfiguration(
                                serverName: _serverNameController.text,
                                deviceName: _deviceNameController.text,
                                description: _descriptionController.text,
                              );
                          Navigator.pushNamed(
                              context, '/server/setup/review');
                        }
                      },
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
