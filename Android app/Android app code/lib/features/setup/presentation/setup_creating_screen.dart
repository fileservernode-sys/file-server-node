import 'dart:async';
import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_header.dart';
import '../../../core/widgets/loading_indicator.dart';
import 'widgets/setup_stepper.dart';

/// Step 5 — Server Creation Simulated Loading State Screen
class SetupCreatingScreen extends StatefulWidget {
  const SetupCreatingScreen({super.key});

  @override
  State<SetupCreatingScreen> createState() => _SetupCreatingScreenState();
}

class _SetupCreatingScreenState extends State<SetupCreatingScreen> {
  int _simulatedStageIndex = 0;
  Timer? _timer;

  final List<String> _stages = const [
    'Preparing device storage environment...',
    'Configuring local HTTP file server host...',
    'Generating mock encryption keys...',
    'Establishing control plane heartbeat connection...',
  ];

  @override
  void initState() {
    super.initState();
    _startSimulatedProgress();
  }

  void _startSimulatedProgress() {
    _timer = Timer.periodic(const Duration(milliseconds: 600), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      if (_simulatedStageIndex < _stages.length - 1) {
        setState(() {
          _simulatedStageIndex++;
        });
      } else {
        timer.cancel();
      }
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
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
                    'Preparing this Android device as a personal file server host node.',
                    style: AppTypography.bodySmall,
                  ),
                  const SizedBox(height: AppSpacing.xxl),

                  // Progress Stages Card
                  AppCard(
                    padding: const EdgeInsets.all(AppSpacing.xl),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const LoadingIndicator(
                            message: 'Initializing server node...'),
                        const SizedBox(height: AppSpacing.xl),
                        Text(
                          _stages[_simulatedStageIndex],
                          style: AppTypography.body
                              .copyWith(fontWeight: FontWeight.w500),
                        ),
                        const SizedBox(height: AppSpacing.lg),
                        _StageCheckItem(
                            title: 'Preparing device',
                            isDone: _simulatedStageIndex >= 0),
                        const SizedBox(height: AppSpacing.xs),
                        _StageCheckItem(
                            title: 'Configuring storage',
                            isDone: _simulatedStageIndex >= 1),
                        const SizedBox(height: AppSpacing.xs),
                        _StageCheckItem(
                            title: 'Starting server host',
                            isDone: _simulatedStageIndex >= 2),
                        const SizedBox(height: AppSpacing.xs),
                        _StageCheckItem(
                            title: 'Establishing connection',
                            isDone: _simulatedStageIndex >= 3),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xxl),

                  PrimaryButton(
                    label: 'Complete Setup',
                    icon: Icons.check_circle_outline,
                    onPressed: () {
                      Navigator.pushReplacementNamed(
                          context, '/server/setup/success');
                    },
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  TertiaryButton(
                    label: 'Simulate Failure State',
                    onPressed: () {
                      Navigator.pushReplacementNamed(
                          context, '/server/setup/failure');
                    },
                  ),
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
        Text(
          title,
          style: AppTypography.caption.copyWith(
            color: isDone ? AppColors.textPrimary : AppColors.textMuted,
          ),
        ),
      ],
    );
  }
}
