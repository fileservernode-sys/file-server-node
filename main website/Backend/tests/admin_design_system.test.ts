import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('Admin Design-System Harmonization & UI Polish (Phase 7.5-E)', () => {
  let app: FastifyInstance;
  let adminCssContent: string;
  let loginHtmlContent: string;
  let indexHtmlContent: string;
  let adminShellJsContent: string;
  let variablesCssContent: string;

  before(async () => {
    app = await buildApp();
    await app.ready();

    // Read static files for direct semantic validation
    const frontendDir = path.resolve(process.cwd(), '../Frontend');
    adminCssContent = fs.readFileSync(path.join(frontendDir, 'admin/css/admin.css'), 'utf-8');
    loginHtmlContent = fs.readFileSync(path.join(frontendDir, 'admin/login.html'), 'utf-8');
    indexHtmlContent = fs.readFileSync(path.join(frontendDir, 'admin/index.html'), 'utf-8');
    adminShellJsContent = fs.readFileSync(path.join(frontendDir, 'admin/js/admin-shell.js'), 'utf-8');
    variablesCssContent = fs.readFileSync(path.join(frontendDir, 'css/variables.css'), 'utf-8');
  });

  after(async () => {
    await app.close();
  });

  describe('1. Canonical Typography & Font Declarations', () => {
    test('declares canonical Plus Jakarta Sans font family', () => {
      assert.match(adminCssContent, /--font-family-sans:\s*['"]Plus Jakarta Sans['"]/);
      assert.match(adminCssContent, /--font-sans:\s*var\(--font-family-sans\)/);
    });

    test('declares canonical JetBrains Mono monospace font family', () => {
      assert.match(adminCssContent, /--font-family-mono:\s*['"]JetBrains Mono['"]/);
      assert.match(adminCssContent, /--font-mono:\s*var\(--font-family-mono\)/);
    });

    test('does not introduce unauthorized third-party fonts', () => {
      assert.doesNotMatch(adminCssContent, /Comic Sans|Papyrus|Open Sans|Roboto Slab/i);
    });
  });

  describe('2. Canonical Radius System (12px / 16px Semantics)', () => {
    test('defines canonical radius tokens (8px, 12px, 16px, 9999px)', () => {
      assert.match(adminCssContent, /--radius-xs:\s*4px/);
      assert.match(adminCssContent, /--radius-sm:\s*8px/);
      assert.match(adminCssContent, /--radius-md:\s*12px/);
      assert.match(adminCssContent, /--radius-lg:\s*16px/);
      assert.match(adminCssContent, /--radius-full:\s*9999px/);
    });

    test('maps semantic Admin radius aliases to canonical radius tokens', () => {
      assert.match(adminCssContent, /--admin-radius-sm:\s*var\(--radius-sm\)/);
      assert.match(adminCssContent, /--admin-radius-md:\s*var\(--radius-md\)/);
      assert.match(adminCssContent, /--admin-radius-lg:\s*var\(--radius-lg\)/);
    });

    test('replaces non-standard 10px and 14px border radius values with canonical 12px and 16px tokens', () => {
      // Standard component geometry in admin.css must use canonical radius tokens
      assert.match(adminCssContent, /--border-radius-md:\s*var\(--radius-md\)/);
      assert.match(adminCssContent, /--border-radius-lg:\s*var\(--radius-lg\)/);
    });
  });

  describe('3. Spacing Scale (8-pt / 4-pt Grid System)', () => {
    test('defines canonical 8px/4px spacing tokens in admin.css', () => {
      assert.match(adminCssContent, /--space-2xs:\s*0\.25rem/); // 4px
      assert.match(adminCssContent, /--space-xs:\s*0\.5rem/);   // 8px
      assert.match(adminCssContent, /--space-sm:\s*0\.75rem/);  // 12px
      assert.match(adminCssContent, /--space-md:\s*1rem/);      // 16px
      assert.match(adminCssContent, /--space-lg:\s*1\.25rem/);  // 20px
      assert.match(adminCssContent, /--space-xl:\s*1\.5rem/);   // 24px
      assert.match(adminCssContent, /--space-2xl:\s*2rem/);     // 32px
    });
  });

  describe('4. Semantic Color Tokens & Canonical ZdexCloud Palette', () => {
    test('preserves canonical ZdexCloud brand light operations console palette', () => {
      assert.match(adminCssContent, /--admin-bg-base:\s*#FAFAFC/);
      assert.match(adminCssContent, /--admin-bg-surface:\s*#FFFFFF/);
      assert.match(adminCssContent, /--admin-border:\s*#E2E8F0/);
      assert.match(adminCssContent, /--admin-primary:\s*#2563EB/);
    });

    test('declares complete semantic status color tokens', () => {
      assert.match(adminCssContent, /--admin-success:\s*#059669/);
      assert.match(adminCssContent, /--admin-warning:\s*#D97706/);
      assert.match(adminCssContent, /--admin-danger:\s*#DC2626/);
      assert.match(adminCssContent, /--admin-info:\s*#2563EB/);
    });
  });

  describe('5. Button Geometry & Interactive States', () => {
    test('enforces minimum touch target min-height: 44px on primary buttons', () => {
      assert.match(adminCssContent, /min-height:\s*var\(--min-touch-target\)/);
      assert.match(adminCssContent, /--min-touch-target:\s*44px/);
    });

    test('enforces canonical radius-md (12px) on buttons', () => {
      assert.match(adminCssContent, /\.admin-btn\s*\{[^}]*border-radius:\s*var\(--radius-md\)/);
    });

    test('includes active depression and hover states', () => {
      assert.match(adminCssContent, /\.admin-btn-primary:active/);
      assert.match(adminCssContent, /transform:\s*scale\(0\.98\)/);
    });

    test('provides compact button variant with 36px min-height and radius-sm', () => {
      assert.match(adminCssContent, /\.admin-btn-sm\s*\{[^}]*min-height:\s*36px/);
      assert.match(adminCssContent, /\.admin-btn-sm\s*\{[^}]*border-radius:\s*var\(--radius-sm\)/);
    });
  });

  describe('6. OTP Input Dimensions & Presentation', () => {
    test('aligns Admin OTP box to canonical dimensions (52px × 60px)', () => {
      assert.match(adminCssContent, /\.otp-box\s*\{[^}]*width:\s*52px/);
      assert.match(adminCssContent, /\.otp-box\s*\{[^}]*height:\s*60px/);
    });

    test('uses canonical radius-md (12px) and mono typography on OTP boxes', () => {
      assert.match(adminCssContent, /\.otp-box\s*\{[^}]*border-radius:\s*var\(--radius-md\)/);
      assert.match(adminCssContent, /\.otp-box\s*\{[^}]*font-family:\s*var\(--font-mono\)/);
    });

    test('login.html contains 6 OTP input boxes with accessible numeric mode and ARIA labels', () => {
      const otpInputs = loginHtmlContent.match(/class="otp-box"/g);
      assert.equal(otpInputs?.length, 6);
      assert.match(loginHtmlContent, /inputmode="numeric"/);
      assert.match(loginHtmlContent, /pattern="\[0-9\]"/);
      assert.match(loginHtmlContent, /aria-label="Digit 1 of 6"/);
    });
  });

  describe('7. Cards, Modals & Dropdown Geometry', () => {
    test('enforces canonical radius-lg (16px) on login card, main cards, and placeholders', () => {
      assert.match(adminCssContent, /\.admin-login-card\s*\{[^}]*border-radius:\s*var\(--radius-lg\)/);
      assert.match(adminCssContent, /\.admin-card\s*\{[^}]*border-radius:\s*var\(--radius-lg\)/);
      assert.match(adminCssContent, /\.admin-placeholder-box\s*\{[^}]*border-radius:\s*var\(--radius-lg\)/);
      assert.match(adminCssContent, /\.admin-forbidden-box\s*\{[^}]*border-radius:\s*var\(--radius-lg\)/);
    });

    test('enforces canonical radius-lg (16px) on profile dropdown', () => {
      assert.match(adminCssContent, /\.admin-profile-dropdown\s*\{[^}]*border-radius:\s*var\(--radius-lg\)/);
    });
  });

  describe('8. Reduced Motion Implementation (@media prefers-reduced-motion: reduce)', () => {
    test('contains comprehensive prefers-reduced-motion media query block', () => {
      assert.match(adminCssContent, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    });

    test('disables animations, transforms and transitions during reduced-motion mode', () => {
      const reducedMotionBlock = adminCssContent.split('@media (prefers-reduced-motion: reduce)')[1];
      assert.ok(reducedMotionBlock, 'Reduced motion block must be present');
      assert.match(reducedMotionBlock, /animation-duration:\s*0\.01ms/);
      assert.match(reducedMotionBlock, /transition-duration:\s*0\.01ms/);
      assert.match(reducedMotionBlock, /transform:\s*none/);
    });
  });

  describe('9. Icon Consistency & No Emoji/Unicode Substitutions', () => {
    test('uses Lucide SVG icons in admin-shell.js without emojis', () => {
      assert.doesNotMatch(adminShellJsContent, /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u);
      assert.match(adminShellJsContent, /<svg viewBox="0 0 24 24"/);
      assert.match(adminShellJsContent, /stroke-width="2"/);
    });
  });

  describe('10. Accessibility (WCAG 2.2 AA) & Focus States', () => {
    test('defines high-contrast visible :focus-visible indicators', () => {
      assert.match(adminCssContent, /:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--admin-primary\)/);
    });

    test('toast notifications are assigned ARIA live-region attributes', () => {
      assert.match(adminShellJsContent, /container\.setAttribute\('role',\s*'region'\)/);
      assert.match(adminShellJsContent, /toast\.setAttribute\('role'/);
      assert.match(adminShellJsContent, /toast\.setAttribute\('aria-live'/);
    });

    test('login alerts use role="alert" with assertive live regions', () => {
      assert.match(loginHtmlContent, /role="alert"/);
      assert.match(loginHtmlContent, /aria-live="assertive"/);
    });
  });

  describe('11. Responsive Behavior & Viewport Breakpoints', () => {
    test('declares responsive breakpoints for mobile, tablet, and desktop (1024px, 768px, 640px)', () => {
      assert.match(adminCssContent, /@media\s*\(max-width:\s*1024px\)/);
      assert.match(adminCssContent, /@media\s*\(max-width:\s*768px\)/);
      assert.match(adminCssContent, /@media\s*\(max-width:\s*640px\)/);
    });

    test('prevents horizontal overflow with overflow-x: hidden', () => {
      assert.match(adminCssContent, /overflow-x:\s*hidden/);
    });
  });

  describe('12. End-to-End HTTP Delivery Verification', () => {
    test('GET /admin/css/admin.css serves harmonized stylesheet', async () => {
      const res = await app.inject({ method: 'GET', url: '/admin/css/admin.css' });
      assert.equal(res.statusCode, 200);
      assert.match(res.body, /--radius-md:\s*12px/);
      assert.match(res.body, /--radius-lg:\s*16px/);
      assert.match(res.body, /prefers-reduced-motion/);
    });

    test('GET /admin/login serves accessible login HTML with 52x60 OTP specifications', async () => {
      const res = await app.inject({ method: 'GET', url: '/admin/login' });
      assert.equal(res.statusCode, 200);
      assert.match(res.body, /inputmode="numeric"/);
      assert.match(res.body, /aria-label="Digit 1 of 6"/);
    });

    test('GET /admin serves accessible SPA shell HTML', async () => {
      const res = await app.inject({ method: 'GET', url: '/admin' });
      assert.equal(res.statusCode, 200);
      assert.match(res.body, /admin-app/);
      assert.match(res.body, /adminSidebar/);
    });
  });
});
