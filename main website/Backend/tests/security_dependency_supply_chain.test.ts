import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('Phase 14 — Category #13: Dependency & Supply-Chain Security', async (t) => {
  const backendDir = __dirname.includes('dist')
    ? path.resolve(__dirname, '..', '..')
    : path.resolve(__dirname, '..');
  const projectRootDir = path.resolve(backendDir, '..', '..');
  const androidAppDir = path.resolve(projectRootDir, 'Android app', 'Android app code');

  await t.test('1. Backend npm Manifest & Lockfile Integrity', async (t2: any) => {
    await t2.test('package.json and package-lock.json exist', () => {
      const packageJsonPath = path.join(backendDir, 'package.json');
      const lockfilePath = path.join(backendDir, 'package-lock.json');
      assert.ok(fs.existsSync(packageJsonPath), 'package.json must exist');
      assert.ok(fs.existsSync(lockfilePath), 'package-lock.json must exist');
    });

    await t2.test('lockfileVersion is modern v3', () => {
      const lockfilePath = path.join(backendDir, 'package-lock.json');
      const lock = JSON.parse(fs.readFileSync(lockfilePath, 'utf8'));
      assert.strictEqual(lock.lockfileVersion, 3, 'lockfileVersion must be 3 for npm v7+');
    });

    await t2.test('all direct dependencies in package.json exist in package-lock.json', () => {
      const packageJson = JSON.parse(fs.readFileSync(path.join(backendDir, 'package.json'), 'utf8'));
      const lock = JSON.parse(fs.readFileSync(path.join(backendDir, 'package-lock.json'), 'utf8'));
      const directDeps = Object.keys(packageJson.dependencies || {});
      const directDevDeps = Object.keys(packageJson.devDependencies || {});
      const lockPackages = lock.packages || {};

      for (const dep of directDeps) {
        const lockKey = `node_modules/${dep}`;
        assert.ok(lockPackages[lockKey], `Direct production dependency '${dep}' must be resolved in package-lock.json`);
      }

      for (const devDep of directDevDeps) {
        const lockKey = `node_modules/${devDep}`;
        assert.ok(lockPackages[lockKey], `Direct dev dependency '${devDep}' must be resolved in package-lock.json`);
      }
    });

    await t2.test('all resolved npm packages use official https://registry.npmjs.org', () => {
      const lock = JSON.parse(fs.readFileSync(path.join(backendDir, 'package-lock.json'), 'utf8'));
      const packages = lock.packages || {};

      for (const [key, pkgRaw] of Object.entries(packages)) {
        const pkg = pkgRaw as { resolved?: string; integrity?: string };
        if (key === '' || !pkg.resolved) continue;
        assert.ok(
          pkg.resolved.startsWith('https://registry.npmjs.org/'),
          `Package '${key}' resolved to unauthorized registry: ${pkg.resolved}`
        );
        assert.ok(
          pkg.integrity && pkg.integrity.startsWith('sha512-'),
          `Package '${key}' must possess sha512 integrity hash`
        );
      }
    });

    await t2.test('no dynamic version ranges (*, +, latest) in production dependencies', () => {
      const packageJson = JSON.parse(fs.readFileSync(path.join(backendDir, 'package.json'), 'utf8'));
      const allDeps: Record<string, string> = { ...packageJson.dependencies, ...packageJson.devDependencies };

      for (const [pkg, version] of Object.entries(allDeps)) {
        assert.doesNotMatch(
          version,
          /^\*|latest|\+|x/,
          `Dependency '${pkg}' has unpinned/dynamic version: ${version}`
        );
      }
    });

    await t2.test('no git or file: dependencies in package.json', () => {
      const packageJson = JSON.parse(fs.readFileSync(path.join(backendDir, 'package.json'), 'utf8'));
      const allDeps: Record<string, string> = { ...packageJson.dependencies, ...packageJson.devDependencies };

      for (const [pkg, version] of Object.entries(allDeps)) {
        assert.ok(!String(version).startsWith('git:'), `Dependency '${pkg}' uses unapproved git protocol`);
        assert.ok(!String(version).startsWith('file:'), `Dependency '${pkg}' uses unapproved file: path`);
        assert.ok(!String(version).startsWith('http:'), `Dependency '${pkg}' uses unapproved unencrypted http:`);
      }
    });
  });

  await t.test('2. npm Scripts & Lifecycle Security', async (t2: any) => {
    await t2.test('no dangerous preinstall / postinstall lifecycle scripts in package.json', () => {
      const packageJson = JSON.parse(fs.readFileSync(path.join(backendDir, 'package.json'), 'utf8'));
      const scripts = packageJson.scripts || {};
      assert.strictEqual(scripts.preinstall, undefined, 'preinstall script must not exist');
      assert.strictEqual(scripts.postinstall, undefined, 'postinstall script must not exist');
      assert.strictEqual(scripts.install, undefined, 'install script must not exist');
    });

    await t2.test('no remote download-and-execute commands in build scripts', () => {
      const packageJson = JSON.parse(fs.readFileSync(path.join(backendDir, 'package.json'), 'utf8'));
      const scripts = packageJson.scripts || {};

      for (const [name, command] of Object.entries(scripts)) {
        const cmdStr = String(command).toLowerCase();
        assert.ok(!cmdStr.includes('curl ') && !cmdStr.includes('wget ') && !cmdStr.includes('invoke-webrequest'),
          `Script '${name}' contains dangerous remote download command: ${command}`);
      }
    });
  });

  await t.test('3. Flutter / Dart Supply-Chain Integrity', async (t2: any) => {
    await t2.test('pubspec.yaml and pubspec.lock exist', () => {
      const pubspecYamlPath = path.join(androidAppDir, 'pubspec.yaml');
      const pubspecLockPath = path.join(androidAppDir, 'pubspec.lock');
      assert.ok(fs.existsSync(pubspecYamlPath), 'pubspec.yaml must exist');
      assert.ok(fs.existsSync(pubspecLockPath), 'pubspec.lock must exist');
    });

    await t2.test('all hosted Dart packages use https://pub.dev and contain sha256 checksums', () => {
      const pubspecLockPath = path.join(androidAppDir, 'pubspec.lock');
      const lockContent = fs.readFileSync(pubspecLockPath, 'utf8');
      const lines = lockContent.split('\n');
      let inHosted = false;
      let hostedCount = 0;

      for (const line of lines) {
        if (line.includes('source: hosted')) {
          inHosted = true;
          hostedCount++;
        } else if (line.includes('source: sdk') || line.includes('source: git') || line.includes('source: path')) {
          inHosted = false;
        }

        if (inHosted && line.includes('url:')) {
          assert.ok(line.includes('https://pub.dev'), `Dart package must use official https://pub.dev registry: ${line}`);
        }
        if (inHosted && line.includes('sha256:')) {
          assert.ok(line.length > 20, `Dart package must contain sha256 digest: ${line}`);
        }
      }
      assert.ok(hostedCount > 0, 'Must verify hosted Dart packages');
    });

    await t2.test('no dynamic or unpinned git dependencies in pubspec.yaml', () => {
      const pubspecYamlPath = path.join(androidAppDir, 'pubspec.yaml');
      const yamlContent = fs.readFileSync(pubspecYamlPath, 'utf8');
      assert.doesNotMatch(yamlContent, /git:\s*\n\s*url:/, 'pubspec.yaml must not contain unpinned git dependencies');
      assert.doesNotMatch(yamlContent, /path:\s*\.\./, 'pubspec.yaml must not contain local path dependencies in production');
    });
  });

  await t.test('4. Android / Gradle Repository & Dependency Security', async (t2: any) => {
    await t2.test('Gradle wrapper enforces HTTPS distribution URL', () => {
      const wrapperPath = path.join(androidAppDir, 'android', 'gradle', 'wrapper', 'gradle-wrapper.properties');
      assert.ok(fs.existsSync(wrapperPath), 'gradle-wrapper.properties must exist');
      const wrapperContent = fs.readFileSync(wrapperPath, 'utf8');
      assert.match(wrapperContent, /distributionUrl=https\\:\/\/services\.gradle\.org\/distributions\//, 'Gradle distributionUrl must use HTTPS');
    });

    await t2.test('Gradle repositories use trusted HTTPS endpoints (google, mavenCentral, gradlePluginPortal)', () => {
      const settingsPath = path.join(androidAppDir, 'android', 'settings.gradle.kts');
      assert.ok(fs.existsSync(settingsPath), 'settings.gradle.kts must exist');
      const settingsContent = fs.readFileSync(settingsPath, 'utf8');
      assert.ok(settingsContent.includes('google()'), 'Must include google()');
      assert.ok(settingsContent.includes('mavenCentral()'), 'Must include mavenCentral()');
      assert.ok(settingsContent.includes('gradlePluginPortal()'), 'Must include gradlePluginPortal()');
      assert.doesNotMatch(settingsContent, /http:\/\//, 'Insecure http:// Maven repositories are forbidden');
    });

    await t2.test('no dynamic dependency coordinates in Android build files', () => {
      const buildGradlePath = path.join(androidAppDir, 'android', 'app', 'build.gradle.kts');
      assert.ok(fs.existsSync(buildGradlePath), 'app/build.gradle.kts must exist');
      const buildContent = fs.readFileSync(buildGradlePath, 'utf8');
      assert.doesNotMatch(buildContent, /implementation\(.*:\+.*?\)/, 'No dynamic + versions allowed');
      assert.doesNotMatch(buildContent, /implementation\(.*:latest.*?\)/, 'No dynamic latest versions allowed');
    });
  });

  await t.test('5. CI/CD Workflow Security & Permissions', async (t2: any) => {
    await t2.test('GitHub Actions workflows specify explicit least-privilege permissions', () => {
      const workflowPath = path.join(projectRootDir, '.github', 'workflows', 'build-flutter-apps.yml');
      if (fs.existsSync(workflowPath)) {
        const content = fs.readFileSync(workflowPath, 'utf8');
        assert.match(content, /permissions:\s*\n\s*contents:\s*read/, 'Workflow must enforce permissions: contents: read');
        assert.doesNotMatch(content, /uses:\s*[^@\n]+@(main|master)\b/, 'Workflow actions must not reference mutable main/master branches');
      }
    });
  });

  await t.test('6. Dependency & Supply-Chain Security Policy', async (t2: any) => {
    await t2.test('DEPENDENCY_SECURITY_POLICY.md exists and defines OWASP ASVS remediation SLAs', () => {
      const policyPath = path.join(projectRootDir, 'DEPENDENCY_SECURITY_POLICY.md');
      assert.ok(fs.existsSync(policyPath), 'DEPENDENCY_SECURITY_POLICY.md must exist at root');
      const content = fs.readFileSync(policyPath, 'utf8');
      assert.ok(content.includes('Critical'), 'Policy must define Critical severity');
      assert.ok(content.includes('High'), 'Policy must define High severity');
      assert.ok(content.includes('npm ci'), 'Policy must specify immutable npm ci');
      assert.ok(content.includes('https://registry.npmjs.org'), 'Policy must specify trusted npm registry');
    });
  });
});
