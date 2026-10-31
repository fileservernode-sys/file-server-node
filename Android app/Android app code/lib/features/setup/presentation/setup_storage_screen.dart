import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/app_header.dart';
import '../application/setup_state.dart';
import 'widgets/setup_stepper.dart';

/// Step 3: Choose Upload Storage Folder Screen
/// Allows the user to select the default folder on internal storage, SD card,
/// or external drive where files uploaded from ZdexCloud File Manager will be saved.
class SetupStorageScreen extends ConsumerStatefulWidget {
  const SetupStorageScreen({super.key});

  @override
  ConsumerState<SetupStorageScreen> createState() => _SetupStorageScreenState();
}

class _SetupStorageScreenState extends ConsumerState<SetupStorageScreen> {
  bool _isLoading = true;
  List<Map<String, dynamic>> _storageLocations = [];
  late String _selectedPath;
  late String _selectedFolderName;
  final TextEditingController _customPathController = TextEditingController();
  bool _isCustomMode = false;

  @override
  void initState() {
    super.initState();
    final currentSetup = ref.read(setupStateProvider);
    _selectedPath = currentSetup.storagePath;
    _selectedFolderName = currentSetup.storageFolderName;
    _customPathController.text = _selectedPath;
    _loadStorageLocations();
  }

  @override
  void dispose() {
    _customPathController.dispose();
    super.dispose();
  }

  Future<void> _loadStorageLocations() async {
    setState(() => _isLoading = true);
    try {
      final service = ref.read(serverServiceProvider);
      final locations = await service.getAvailableStorageLocations();
      final defaultPath = await service.getDefaultStoragePath();

      if (mounted) {
        setState(() {
          _storageLocations = locations;
          // If no specific path was chosen yet, guarantee default is Download folder
          if (_selectedPath.isEmpty) {
            _selectedPath = defaultPath;
            _selectedFolderName = 'Download Folder (Default)';
            _customPathController.text = defaultPath;
          }
          _isLoading = false;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  String _extractFolderName(String rawPath) {
    var path = rawPath.trim();
    while (path.endsWith('/') || path.endsWith('\\')) {
      path = path.substring(0, path.length - 1);
    }
    if (path.contains('%2F') || path.contains('%2f')) {
      try {
        path = Uri.decodeComponent(path);
      } catch (_) {}
    }
    if (path.contains(':')) {
      final lastColon = path.lastIndexOf(':');
      final afterColon = path.substring(lastColon + 1);
      if (afterColon.isNotEmpty) {
        path = afterColon;
      }
    }
    while (path.endsWith('/') || path.endsWith('\\')) {
      path = path.substring(0, path.length - 1);
    }
    final lastSlash = path.lastIndexOf('/');
    final lastBackslash = path.lastIndexOf('\\');
    final splitIdx = lastSlash > lastBackslash ? lastSlash : lastBackslash;
    if (splitIdx != -1 && splitIdx < path.length - 1) {
      final extracted = path.substring(splitIdx + 1).trim();
      if (extracted.isNotEmpty) return extracted;
    }
    return path.isNotEmpty ? path : 'Custom Folder';
  }

  Future<void> _handlePickCustomFolder() async {
    try {
      final service = ref.read(serverServiceProvider);
      final pickedPath = await service.pickStorageFolder();
      if (pickedPath != null && pickedPath.isNotEmpty && mounted) {
        final folderName = _extractFolderName(pickedPath);
        setState(() {
          _selectedPath = pickedPath;
          _selectedFolderName = folderName;
          _customPathController.text = pickedPath;
          _isCustomMode = true;
        });
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not open folder picker: $e')),
        );
      }
    }
  }

  void _selectPreset(String path, String name) {
    setState(() {
      _selectedPath = path;
      _selectedFolderName = name;
      _customPathController.text = path;
      _isCustomMode = false;
    });
  }

  void _onContinue() {
    final pathToSave = _isCustomMode
        ? _customPathController.text.trim()
        : _selectedPath.trim();

    if (pathToSave.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select or specify a valid storage path.')),
      );
      return;
    }

    final nameToSave = _isCustomMode
        ? _extractFolderName(pathToSave)
        : _selectedFolderName;

    ref.read(setupStateProvider.notifier).setStorageLocation(
          path: pathToSave,
          folderName: nameToSave.isNotEmpty ? nameToSave : 'Upload Storage',
        );

    Navigator.pushNamed(context, '/server/setup/review');
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
            constraints: const BoxConstraints(maxWidth: AppSpacing.maxFormWidth),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SetupStepper(
                    currentStep: 3,
                    totalSteps: 4,
                    stepTitle: 'Upload Storage Folder',
                  ),
                  const SizedBox(height: AppSpacing.xl),

                  const Text(
                    'Choose upload storage folder',
                    style: AppTypography.pageTitle,
                  ),
                  const SizedBox(height: AppSpacing.xs),
                  const Text(
                    'Select the folder where files uploaded from ZdexCloud Web File Manager will be stored on this phone, SD card, or drive. Default is your phone\'s Download folder.',
                    style: AppTypography.bodySmall,
                  ),
                  const SizedBox(height: AppSpacing.xl),

                  if (_isLoading)
                    const Center(
                      child: Padding(
                        padding: EdgeInsets.all(AppSpacing.xxl),
                        child: CircularProgressIndicator(),
                      ),
                    )
                  else ...[
                    // Preset Locations List
                    ..._storageLocations.map((loc) {
                      final path = loc['path'] as String? ?? '';
                      final name = loc['name'] as String? ?? 'Storage Location';
                      final isDefault = loc['isDefault'] as bool? ?? false;
                      final type = loc['type'] as String? ?? 'folder';
                      final isSelected = !_isCustomMode && _selectedPath == path;

                      IconData iconData = Icons.folder_outlined;
                      if (type == 'download') iconData = Icons.download_outlined;
                      if (type == 'documents') iconData = Icons.description_outlined;
                      if (type == 'sdcard') iconData = Icons.sd_card_outlined;
                      if (type == 'media') iconData = Icons.photo_library_outlined;

                      return Padding(
                        padding: const EdgeInsets.only(bottom: AppSpacing.md),
                        child: InkWell(
                          onTap: () => _selectPreset(path, name),
                          borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                          child: Container(
                            padding: const EdgeInsets.all(AppSpacing.lg),
                            decoration: BoxDecoration(
                              color: isSelected
                                  ? AppColors.primarySubtle.withValues(alpha: 0.4)
                                  : AppColors.surface,
                              borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                              border: Border.all(
                                color: isSelected
                                    ? AppColors.primary
                                    : AppColors.borderSubtle,
                                width: isSelected ? 2 : 1,
                              ),
                            ),
                            child: Row(
                              children: [
                                Container(
                                  padding: const EdgeInsets.all(AppSpacing.sm),
                                  decoration: BoxDecoration(
                                    color: isSelected
                                        ? AppColors.primary.withValues(alpha: 0.15)
                                        : AppColors.surfaceSubtle,
                                    shape: BoxShape.circle,
                                  ),
                                  child: Icon(
                                    iconData,
                                    color: isSelected
                                        ? AppColors.primary
                                        : AppColors.textSecondary,
                                    size: 22,
                                  ),
                                ),
                                const SizedBox(width: AppSpacing.md),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Wrap(
                                        spacing: AppSpacing.xs,
                                        runSpacing: 2,
                                        crossAxisAlignment:
                                            WrapCrossAlignment.center,
                                        children: [
                                          Text(
                                            name,
                                            style: AppTypography.cardTitle.copyWith(
                                              color: isSelected
                                                  ? AppColors.primary
                                                  : AppColors.textPrimary,
                                            ),
                                          ),
                                          if (isDefault) ...[
                                            Container(
                                              padding: const EdgeInsets.symmetric(
                                                horizontal: AppSpacing.xs,
                                                vertical: 2,
                                              ),
                                              decoration: BoxDecoration(
                                                color: AppColors.statusOnlineBg,
                                                borderRadius: BorderRadius.circular(4),
                                                border: Border.all(
                                                  color: AppColors.statusOnline
                                                      .withValues(alpha: 0.5),
                                                ),
                                              ),
                                              child: Text(
                                                'Default (Recommended)',
                                                style: AppTypography.caption.copyWith(
                                                  color: AppColors.statusOnline,
                                                  fontWeight: FontWeight.bold,
                                                  fontSize: 10,
                                                ),
                                              ),
                                            ),
                                          ],
                                        ],
                                      ),
                                      const SizedBox(height: 2),
                                      Text(
                                        path,
                                        style: AppTypography.caption.copyWith(
                                          color: AppColors.textSecondary,
                                          fontFamily: 'monospace',
                                        ),
                                        softWrap: true,
                                      ),
                                    ],
                                  ),
                                ),
                                const SizedBox(width: AppSpacing.sm),
                                Icon(
                                  isSelected
                                      ? Icons.radio_button_checked
                                      : Icons.radio_button_unchecked,
                                  color: isSelected
                                      ? AppColors.primary
                                      : AppColors.textMuted,
                                ),
                              ],
                            ),
                          ),
                        ),
                      );
                    }),

                    // Custom Folder Picker Card
                    AppCard(
                      padding: const EdgeInsets.all(AppSpacing.lg),
                      color: _isCustomMode
                          ? AppColors.primarySubtle.withValues(alpha: 0.3)
                          : AppColors.surface,
                      borderColor: _isCustomMode
                          ? AppColors.primary
                          : AppColors.borderSubtle,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              const Icon(
                                Icons.create_new_folder_outlined,
                                color: AppColors.primary,
                                size: 22,
                              ),
                              const SizedBox(width: AppSpacing.sm),
                              const Expanded(
                                child: Text(
                                  'Choose Any Folder, SD Card or Drive',
                                  style: AppTypography.cardTitle,
                                ),
                              ),
                              if (_isCustomMode)
                                const Icon(
                                  Icons.check_circle_rounded,
                                  color: AppColors.primary,
                                  size: 20,
                                ),
                            ],
                          ),
                          const SizedBox(height: AppSpacing.xs),
                          const Text(
                            'Select any specific directory on internal storage, removable micro SD card, or USB drive using the system folder picker.',
                            style: AppTypography.caption,
                          ),
                          const SizedBox(height: AppSpacing.md),
                          SecondaryButton(
                            label: _isCustomMode
                                ? 'Choose Another Folder'
                                : 'Browse System Folders & SD Card',
                            icon: Icons.folder_open_rounded,
                            onPressed: _handlePickCustomFolder,
                          ),
                          if (_isCustomMode && _selectedFolderName.isNotEmpty) ...[
                            const SizedBox(height: AppSpacing.md),
                            Container(
                              padding: const EdgeInsets.all(AppSpacing.md),
                              decoration: BoxDecoration(
                                color: AppColors.surface,
                                borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                                border: Border.all(
                                  color: AppColors.primary.withValues(alpha: 0.35),
                                  width: 1.5,
                                ),
                              ),
                              child: Row(
                                children: [
                                  Container(
                                    padding: const EdgeInsets.all(AppSpacing.xs),
                                    decoration: BoxDecoration(
                                      color: AppColors.primarySubtle,
                                      borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                                    ),
                                    child: const Icon(
                                      Icons.folder_rounded,
                                      color: AppColors.primary,
                                      size: 24,
                                    ),
                                  ),
                                  const SizedBox(width: AppSpacing.sm),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        const Text(
                                          'Selected Folder',
                                          style: TextStyle(
                                            fontSize: 11,
                                            fontWeight: FontWeight.w500,
                                            color: AppColors.textSecondary,
                                          ),
                                        ),
                                        const SizedBox(height: 2),
                                        Text(
                                          _selectedFolderName,
                                          style: AppTypography.cardTitle.copyWith(
                                            color: AppColors.primary,
                                            fontWeight: FontWeight.bold,
                                          ),
                                          softWrap: true,
                                        ),
                                      ],
                                    ),
                                  ),
                                  const Icon(
                                    Icons.check_circle,
                                    color: AppColors.statusOnline,
                                    size: 20,
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpacing.lg),

                    // Information Callout Card
                    Container(
                      padding: const EdgeInsets.all(AppSpacing.md),
                      decoration: BoxDecoration(
                        color: AppColors.surfaceSubtle,
                        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                        border: Border.all(color: AppColors.borderSubtle),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(
                            Icons.info_outline_rounded,
                            size: 20,
                            color: AppColors.primary,
                          ),
                          const SizedBox(width: AppSpacing.sm),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text(
                                  'Upload Storage Location',
                                  style: AppTypography.cardTitle,
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  'All files uploaded from the ZdexCloud File Manager on the web dashboard will be safely saved in your chosen "$_selectedFolderName" folder.',
                                  style: AppTypography.caption,
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],

                  const SizedBox(height: AppSpacing.xxl),

                  PrimaryButton(
                    label: 'Continue',
                    icon: Icons.arrow_forward_rounded,
                    onPressed: _isLoading ? null : _onContinue,
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  SecondaryButton(
                    label: 'Back',
                    onPressed: () => Navigator.pop(context),
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
