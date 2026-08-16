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

/// Step 5 — Real Server Creation & Gateway Handshake Progress Screen
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
    'Verifying local socket listener health probe...',
    'Registering server endpoint & allocating remote connection token...',
    'Establishing secure outbound WebSocket connection to Remote Gateway...',
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
    } else {
      Navigator.pushReplacementNamed(context, '/server/setup/failure');
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
                    'Configuring this Android device as a personal file server host node.',
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
                                ? 'Executing server creation...'
                                : 'Finalizing node configuration...'),
                        const SizedBox(height: AppSpacing.xl),
                        Text(
                          _stages[stageIdx],
                          style: AppTypography.body
                              .copyWith(fontWeight: FontWeight.w500),
                        ),
                        const SizedBox(height: AppSpacing.lg),
                        _StageCheckItem(
                            title: 'Registering host device node',
                            isDone: stageIdx >= 1),
                        const SizedBox(height: AppSpacing.xs),
                        _StageCheckItem(
                            title: 'Starting local HTTP engine (0.0.0.0:8080)',
                            isDone: stageIdx >= 2),
                        const SizedBox(height: AppSpacing.xs),
                        _StageCheckItem(
                            title: 'Verifying local socket listener',
                            isDone: stageIdx >= 3),
                        const SizedBox(height: AppSpacing.xs),
                        _StageCheckItem(
                            title: 'Reserving endpoint & gateway token',
                            isDone: stageIdx >= 4),
                        const SizedBox(height: AppSpacing.xs),
                        _StageCheckItem(
                            title: 'Connecting to Remote Gateway',
                            isDone: setupState.isGatewayConnected),
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
                      child: Text(
                        setupState.errorMessage!,
                        style: AppTypography.bodySmall
                            .copyWith(color: AppColors.statusError),
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    PrimaryButton(
                      label: 'Retry Setup',
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
            ),
          ),
        ),
      ],
    );
  }
}
