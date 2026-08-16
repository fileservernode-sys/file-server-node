import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_header.dart';
import '../../../core/widgets/loading_indicator.dart';
import '../application/setup_state.dart';
import 'widgets/setup_stepper.dart';

/// Step 5 — Real Server Creation, Subdomain Provisioning & Gateway Handshake Progress Screen
class SetupCreatingScreen extends ConsumerStatefulWidget {
  const SetupCreatingScreen({super.key});

  @override
  ConsumerState<SetupCreatingScreen> createState() =>
      _SetupCreatingScreenState();
}

class _SetupCreatingScreenState extends ConsumerState<SetupCreatingScreen> {
  final List<String> _stages = const [
    'Registering Android host device with control plane...',
    'Starting embedded HTTP file-server engine on 0.0.0.0:8080...',
    'Verifying local socket listener health probe (127.0.0.1:8080)...',
    'Provisioning public subdomain endpoint & DNS routing...',
    'Establishing secure WebSocket connection to Remote Gateway...',
    'Verifying gateway reverse-proxy routing & public server access...',
  ];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _runSetup();
    });
  }

  Future<void> _runSetup() async {
    final success = await ref.read(setupStateProvider.notifier).executeSetup();
    if (!mounted) return;

    if (success) {
      Navigator.pushReplacementNamed(context, '/server/setup/success');
    }
  }

  @override
  Widget build(BuildContext context) {
    final setupState = ref.watch(setupStateProvider);
    final stageIdx = setupState.stageIndex.clamp(0, _stages.length - 1);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: const AppHeader(
        title: 'Server Setup Wizard',
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints:
                const BoxConstraints(maxWidth: AppSpacing.maxFormWidth),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SetupStepper(
                    currentStep: 5,
                    stepTitle: 'Create Server',
                  ),
                  const SizedBox(height: AppSpacing.xl),

                  const Text(
                    'Creating your personal file server',
                    style: AppTypography.pageTitle,
                  ),
                  const SizedBox(height: AppSpacing.xs),
                  const Text(
                    'Configuring local engine, provisioning public subdomain, and connecting to Remote Gateway.',
                    style: AppTypography.bodySmall,
                  ),
                  const SizedBox(height: AppSpacing.xxl),

                  // Progress Stages Card
                  AppCard(
                    padding: const EdgeInsets.all(AppSpacing.xl),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        LoadingIndicator(
                            message: setupState.isProcessing
                                ? 'Provisioning server & public endpoint...'
                                : 'Finalizing node configuration...'),
                        const SizedBox(height: AppSpacing.xl),
                        Text(
                          _stages[stageIdx],
                          style: AppTypography.body
                              .copyWith(fontWeight: FontWeight.w600, color: AppColors.primary),
                        ),
                        const SizedBox(height: AppSpacing.lg),
                        _StageCheckItem(
                            title: 'Registering host device node with backend',
                            isDone: stageIdx >= 1),
                        const SizedBox(height: AppSpacing.xs),
                        _StageCheckItem(
                            title: 'Starting local HTTP engine (0.0.0.0:8080)',
                            isDone: stageIdx >= 2),
                        const SizedBox(height: AppSpacing.xs),
                        _StageCheckItem(
                            title: 'Verifying local socket listener (127.0.0.1:8080)',
                            isDone: stageIdx >= 3),
                        const SizedBox(height: AppSpacing.xs),
                        _StageCheckItem(
                            title: 'Provisioning public subdomain endpoint',
                            isDone: stageIdx >= 4),
                        const SizedBox(height: AppSpacing.xs),
                        _StageCheckItem(
                            title: 'Connecting outbound WebSocket to Remote Gateway',
                            isDone: stageIdx >= 5 || setupState.isGatewayConnected),
                        const SizedBox(height: AppSpacing.xs),
                        _StageCheckItem(
                            title: 'Verifying public reverse-proxy routing',
                            isDone: setupState.endpointStatus == 'ACTIVE'),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xxl),

                  if (setupState.errorMessage != null) ...[
                    Container(
                      padding: const EdgeInsets.all(AppSpacing.md),
                      decoration: BoxDecoration(
                        color: AppColors.statusErrorBg,
                        borderRadius:
                            BorderRadius.circular(AppSpacing.radiusMd),
                        border: Border.all(color: AppColors.statusError),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              const Icon(Icons.error_outline,
                                  color: AppColors.statusError, size: 20),
                              const SizedBox(width: AppSpacing.xs),
                              Text(
                                'Subdomain connection failed',
                                style: AppTypography.cardTitle
                                    .copyWith(color: AppColors.statusError),
                              ),
                            ],
                          ),
                          const SizedBox(height: AppSpacing.xs),
                          Text(
                            setupState.errorMessage!,
                            style: AppTypography.bodySmall
                                .copyWith(color: AppColors.statusError),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    PrimaryButton(
                      label: 'Retry Connection',
                      icon: Icons.refresh,
                      onPressed: _runSetup,
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _StageCheckItem extends StatelessWidget {
  final String title;
  final bool isDone;

  const _StageCheckItem({required this.title, required this.isDone});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(
          isDone ? Icons.check_circle_rounded : Icons.hourglass_empty_rounded,
          size: 18,
          color: isDone ? AppColors.statusOnline : AppColors.textMuted,
        ),
        const SizedBox(width: AppSpacing.xs),
        Expanded(
          child: Text(
            title,
            style: AppTypography.caption.copyWith(
              color: isDone ? AppColors.textPrimary : AppColors.textMuted,
              fontWeight: isDone ? FontWeight.w500 : FontWeight.normal,
            ),
          ),
        ),
      ],
    );
  }
}
