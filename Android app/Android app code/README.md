# RemoteNode Android Application Foundation — Control Plane & Personal Storage Host

Production-ready, portable **Flutter Android Application Foundation** built using Dart & Flutter.

---

## 1. Project Purpose & Architecture

The Android application converts an unused or spare Android smartphone into a remotely accessible personal file server host.

### Key Architectural Guidelines
- **Mobile-First Foundation**: Designed for fluid adaptiveness across Android phone screen sizes (`320dp`, `360dp`, `375dp`, `390dp`, `414dp`, `480dp+`).
- **Enforced Account Policy**: The Android application provides **LOGIN ONLY**. Account registration is hosted exclusively on the Main Website (`https://remotenode.net/pages/get-started.html`).
- **Final Authentication Model**: Platform authentication uses **Email + Password + OTP** exclusively. OTP email delivery is handled by the backend using the **Serverbyt SMTP** service. Google authentication is NOT supported and has been completely eliminated from the product.
- **Strict Credential Separation**: Platform Account (Email + Password + OTP) is used for control plane access and device ownership. Dedicated File-Server Credentials created during server setup are used only for accessing files via the Android-hosted File Managing Website.

---

## 2. Directory Structure

```
Android app/Android app code/
├── android/                      # Android wrapper (minSdkVersion 21, applicationId net.remotenode.fileserver)
├── ios/                          # iOS cross-platform wrapper foundation
├── lib/
│   ├── core/
│   │   ├── config/
│   │   │   └── app_config.dart   # Dev & Prod API environment configuration
│   │   ├── constants/
│   │   │   └── app_constants.dart# Shared system constants & touch target constraints
│   │   ├── errors/
│   │   │   └── app_error.dart    # Typed error hierarchy
│   │   ├── routing/
│   │   │   └── app_router.dart   # Centralized routes & page route generator (Email + Password + OTP flow)
│   │   ├── storage/
│   │   │   └── secure_storage_service.dart # Encrypted token storage abstraction
│   │   ├── theme/
│   │   │   ├── app_colors.dart   # Deep Slate Navy #0F172A, Off-White #FAFAFC, Royal Blue #2563EB, status tokens
│   │   │   ├── app_typography.dart# Typography scale matching Main Website
      ├── app_spacing.dart  # Centralized 8-pt spacing scale (4, 8, 12, 16, 20, 24, 32, 40, 48)
│   │   │   └── app_theme.dart    # Light/Dark Material 3 Theme Configuration
│   │   ├── utils/
│   │   │   └── logger.dart       # Development-safe logging abstraction (strips sensitive tokens/passwords)
│   │   └── widgets/
│   │       ├── app_button.dart   # Primary, Secondary, Tertiary, Destructive buttons (44x44 dp targets)
│   │       ├── app_text_field.dart# Responsive form input field
│   │       ├── status_badge.dart # ONLINE (Emerald), CONNECTING (Amber), OFFLINE (Slate) badges
│   │       ├── loading_indicator.dart # Spinner & SkeletonLoader placeholders
│   │       ├── empty_state.dart  # Reusable empty state view
│   │       ├── error_message.dart# Reusable error banner
│   │       ├── app_header.dart   # Compact app header
│   │       ├── app_dialog.dart   # Modal dialog container
│   │       └── app_card.dart     # Surface card container
│   ├── features/
│   │   ├── auth/
│   │   │   ├── application/      # Riverpod AuthStateNotifier & AuthState
│   │   │   ├── data/             # AuthRemoteDataSource & AuthRepositoryImpl
│   │   │   ├── domain/           # PlatformUser & AuthSession entities, AuthRepository contract
│   │   │   └── presentation/     # LoginScreen & OtpScreen UI
│   │   ├── home/
│   │   │   └── presentation/     # HomeScreen dashboard
│   │   ├── server/
│   │   │   └── presentation/     # ServerScreen & ServerStatusScreen
│   │   ├── setup/
│   │   │   └── presentation/     # 6-Step Server Setup Journey Screens & SetupStepper
│   │   ├── settings/
│   │   │   └── presentation/     # SettingsScreen
│   │   ├── help/
│   │   │   └── presentation/     # HelpScreen
│   │   ├── about/
│   │   │   └── presentation/     # AboutScreen
│   │   └── shell/
│   │       └── presentation/     # AppShell authenticated shell with bottom navigation
│   └── main.dart                 # App entry point with ProviderScope & error boundaries
├── test/
│   ├── unit/                     # Config, error, theme, & auth domain architecture unit tests
│   └── widget/                   # Button, status badge, UI components, & setup journey widget tests
├── pubspec.yaml                  # Minimal dependencies (flutter_riverpod)
└── README.md
```

---

## 3. Technology & Minimum Android SDK Decision

| Specification | Decision / Selection | Rationale |
| :--- | :--- | :--- |
| **Package Identifier** | `net.remotenode.fileserver` | Production-ready package namespace. |
| **Minimum Android SDK** | `minSdkVersion 21` (Android 5.0 Lollipop) | Broad device compatibility for repurposed older Android smartphones while maintaining TLS 1.2/1.3 security and background thread support. |
| **Authentication Model** | Email + Password + 6-digit OTP | Security verification model. Backend handles email sending via Serverbyt SMTP. No Google Auth. |
| **State Management** | `flutter_riverpod` (^2.5.1) | Compile-time safety, zero BuildContext dependency coupling, testability via `ProviderContainer` overrides, and clean UI/logic decoupling. |

---

## 4. Development & Build Commands

### Format Code
```bash
dart format .
```

### Static Code Analysis
```bash
flutter analyze
```

### Execute Test Suite
```bash
flutter test
```

### Build Android Debug APK
```bash
flutter build apk --debug
```
