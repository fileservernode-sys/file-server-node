# ZDEXCLOUD — DEPENDENCY & SUPPLY-CHAIN SECURITY POLICY
# Standard Operating Procedure for Third-Party Components, Manifests & Build Tools

---

## 1. Objective & Scope

This policy governs the selection, validation, pinning, remediation, and lifecycle management of all direct and transitive third-party dependencies, build tools, plugins, and package registries across the ZdexCloud ecosystem (Control Plane Backend, WebSocket Gateway Relay, and Android Mobile Edge Client).

---

## 2. Risk-Based Vulnerability Remediation Targets (OWASP ASVS 5.0)

When security advisories (CVE / GHSA) affect direct or transitive dependencies, remediation must occur according to the following SLAs:

| Severity Tier | CVSS Score Range | Target Remediation Timeframe | Emergency Action |
| :--- | :--- | :--- | :--- |
| **Critical** | 9.0 – 10.0 | **$\le 24$ Hours** | Immediate out-of-band hotfix patch, override, or isolation |
| **High** | 7.0 – 8.9 | **$\le 7$ Days** | Compatibility verification and targeted point upgrade |
| **Medium** | 4.0 – 6.9 | **$\le 30$ Days** | Routine sprint update with full regression validation |
| **Low / Informational** | 0.1 – 3.9 | **Next Scheduled Release** | Evaluated during standard maintenance cycles |

---

## 3. Lockfile & Deterministic Build Invariants

1. **Mandatory Lockfiles**:
   - Node.js / Backend: `package-lock.json` (`lockfileVersion: 3`) must be committed and synchronized with `package.json`.
   - Flutter / Dart: `pubspec.lock` must be committed and synchronized with `pubspec.yaml`.
   - Android / Gradle: `gradle-wrapper.properties` and Gradle dependency coordinates must be explicit and immutable.
2. **Immutable Installation in CI / Production**:
   - Production and CI builds must use `npm ci` rather than `npm install` to guarantee zero lockfile drift.
   - Builds must strictly fail if lockfiles do not match manifest declarations or if integrity hashes are missing.
3. **No Dynamic Selectors**:
   - Production manifests must not use dynamic version ranges (`*`, `+`, `latest`, `latest.release`, `1.+`). Explicit semver ranges (`^` or pinned) are mandatory.

---

## 4. Trusted Package Registries & Provenance

1. **Authorized Registries**:
   - Node / npm: `https://registry.npmjs.org` exclusively.
   - Flutter / Dart: `https://pub.dev` exclusively.
   - Android / Gradle: `google()`, `mavenCentral()`, and `gradlePluginPortal()` over strict HTTPS.
2. **Prohibited Sources**:
   - Unencrypted HTTP repositories (`http://...`) are strictly prohibited.
   - Unpinned Git branch references (`@main`, `@master`) in production dependencies are prohibited.
   - Local development file paths (`file:...`, `path:...`) must never be referenced in production manifests.

---

## 5. Dependency Confusion & Namespace Protection

1. Internal / private packages must be published under verified organizational scopes (e.g. `@zdexcloud/*`).
2. Public package registries must be queried with scoped resolution to prevent dependency confusion attacks.

---

## 6. Lifecycle Scripts & Code Execution Controls

1. Arbitrary remote download-and-execute commands (`curl | sh`, `wget | bash`, `Invoke-WebRequest`) in build scripts or `package.json` scripts are prohibited.
2. Third-party packages requiring native compilation (`preinstall`, `postinstall`) must be audited for provenance and isolated from production runtime secrets.

---

## 7. Change Review & Verification Gate

1. Every pull request introducing a new dependency or modifying lockfiles must include:
   - Justification of purpose (cannot be satisfied by existing core runtime or standard libraries).
   - Compatibility verification.
   - Execution of automated security regression test suites (`tests/security_dependency_supply_chain.test.ts`).
2. Release artifacts must correspond strictly to audited, reproducible source commits.
