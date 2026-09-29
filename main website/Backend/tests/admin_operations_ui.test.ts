import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { test, describe } from 'node:test';

describe('Admin Panel Operational UI (Phase 8.7)', () => {
  const frontendAdminDir = path.resolve(process.cwd(), '../Frontend/admin');
  const indexHtmlPath = path.join(frontendAdminDir, 'index.html');
  const adminShellJsPath = path.join(frontendAdminDir, 'js/admin-shell.js');
  const adminApiJsPath = path.join(frontendAdminDir, 'js/admin-api.js');
  const adminCssPath = path.join(frontendAdminDir, 'css/admin.css');

  // =========================================================================
  // SUITE 1: SHELL HTML STRUCTURE & ASSET RESOLUTION
  // =========================================================================
  describe('Suite 1: Shell HTML Structure & Asset Resolution', () => {
    test('1.1: index.html exists and loads required CSS/JS modules', () => {
      assert.ok(fs.existsSync(indexHtmlPath), 'index.html must exist');
      const html = fs.readFileSync(indexHtmlPath, 'utf8');
      assert.ok(html.includes('/admin/css/admin.css'), 'Must reference admin.css');
      assert.ok(html.includes('/admin/js/admin-api.js'), 'Must load admin-api.js');
      assert.ok(html.includes('/admin/js/admin-auth.js'), 'Must load admin-auth.js');
      assert.ok(html.includes('/admin/js/admin-shell.js'), 'Must load admin-shell.js');
    });

    test('1.2: index.html defines semantic landmark containers', () => {
      const html = fs.readFileSync(indexHtmlPath, 'utf8');
      assert.ok(html.includes('id="adminSidebar"'), 'Must have sidebar container');
      assert.ok(html.includes('id="adminSidebarNav"'), 'Must have sidebar nav');
      assert.ok(html.includes('id="adminViewContainer"'), 'Must have main view container');
      assert.ok(html.includes('id="adminSessionCountdown"'), 'Must have session countdown timer');
    });
  });

  // =========================================================================
  // SUITE 2: NAVIGATION SCHEMA & RBAC ROUTING
  // =========================================================================
  describe('Suite 2: Navigation Schema & RBAC Routing', () => {
    test('2.1: admin-shell.js registers Core Operations navigation items with permissions', () => {
      assert.ok(fs.existsSync(adminShellJsPath), 'admin-shell.js must exist');
      const js = fs.readFileSync(adminShellJsPath, 'utf8');
      assert.ok(js.includes("id: 'users'"), 'Must include users navigation item');
      assert.ok(js.includes("permission: 'users.read'"), 'Users item must require users.read');
      assert.ok(js.includes("id: 'devices'"), 'Must include devices navigation item');
      assert.ok(js.includes("permission: 'devices.read'"), 'Devices item must require devices.read');
      assert.ok(js.includes("id: 'servers'"), 'Must include servers navigation item');
      assert.ok(js.includes("permission: 'servers.read'"), 'Servers item must require servers.read');
      assert.ok(js.includes("id: 'gateway'"), 'Must include gateway navigation item');
      assert.ok(js.includes("permission: 'gateway.read'"), 'Gateway item must require gateway.read');
    });
  });

  // =========================================================================
  // SUITE 3: USER OPERATIONS UI INTEGRATION
  // =========================================================================
  describe('Suite 3: User Operations UI Integration', () => {
    test('3.1: admin-shell.js implements user listing, inspection, suspend and restore', () => {
      const js = fs.readFileSync(adminShellJsPath, 'utf8');
      assert.ok(js.includes('/admin/operations/users'), 'Must call /admin/operations/users API');
      assert.ok(js.includes('loadUsers'), 'Must implement loadUsers');
      assert.ok(js.includes('inspectUser'), 'Must implement inspectUser');
      assert.ok(js.includes('confirmSuspendUser'), 'Must implement confirmSuspendUser');
      assert.ok(js.includes('confirmRestoreUser'), 'Must implement confirmRestoreUser');
      assert.ok(js.includes('/suspend'), 'Must call /suspend endpoint');
      assert.ok(js.includes('/restore'), 'Must call /restore endpoint');
    });
  });

  // =========================================================================
  // SUITE 4: DEVICE OPERATIONS UI INTEGRATION
  // =========================================================================
  describe('Suite 4: Device Operations UI Integration', () => {
    test('4.1: admin-shell.js implements device listing, detail drawer, and disconnect modal', () => {
      const js = fs.readFileSync(adminShellJsPath, 'utf8');
      assert.ok(js.includes('/admin/operations/devices'), 'Must call /admin/operations/devices API');
      assert.ok(js.includes('loadDevices'), 'Must implement loadDevices');
      assert.ok(js.includes('inspectDevice'), 'Must implement inspectDevice');
      assert.ok(js.includes('confirmDisconnectDevice'), 'Must implement confirmDisconnectDevice');
      assert.ok(js.includes('/disconnect'), 'Must call /disconnect endpoint');
    });
  });

  // =========================================================================
  // SUITE 5: SERVER OPERATIONS UI INTEGRATION
  // =========================================================================
  describe('Suite 5: Server Operations UI Integration', () => {
    test('5.1: admin-shell.js implements server listing, detail drawer, start, stop, and restart', () => {
      const js = fs.readFileSync(adminShellJsPath, 'utf8');
      assert.ok(js.includes('/admin/operations/servers'), 'Must call /admin/operations/servers API');
      assert.ok(js.includes('loadServers'), 'Must implement loadServers');
      assert.ok(js.includes('inspectServer'), 'Must implement inspectServer');
      assert.ok(js.includes('executeStartServer'), 'Must implement executeStartServer');
      assert.ok(js.includes('confirmStopServer'), 'Must implement confirmStopServer');
      assert.ok(js.includes('confirmRestartServer'), 'Must implement confirmRestartServer');
      assert.ok(js.includes('/start'), 'Must call /start endpoint');
      assert.ok(js.includes('/stop'), 'Must call /stop endpoint');
      assert.ok(js.includes('/restart'), 'Must call /restart endpoint');
    });
  });

  // =========================================================================
  // SUITE 6: GATEWAY OPERATIONS UI INTEGRATION
  // =========================================================================
  describe('Suite 6: Gateway Operations UI Integration', () => {
    test('6.1: admin-shell.js implements nodes, telemetry, diagnostics, drain, and restore', () => {
      const js = fs.readFileSync(adminShellJsPath, 'utf8');
      assert.ok(js.includes('/admin/operations/gateway/nodes'), 'Must call gateway nodes API');
      assert.ok(js.includes('/admin/operations/gateway/telemetry'), 'Must call gateway telemetry API');
      assert.ok(js.includes('/admin/operations/gateway/diagnostics'), 'Must call gateway diagnostics API');
      assert.ok(js.includes('/admin/operations/gateway/connections'), 'Must call gateway connections API');
      assert.ok(js.includes('confirmDrainGatewayNode'), 'Must implement confirmDrainGatewayNode');
      assert.ok(js.includes('confirmRestoreGatewayNode'), 'Must implement confirmRestoreGatewayNode');
      assert.ok(js.includes('/drain'), 'Must call /drain endpoint');
      assert.ok(js.includes('/restore'), 'Must call /restore endpoint');
    });
  });

  // =========================================================================
  // SUITE 7: SECURITY & SECRET PROTECTION IN UI
  // =========================================================================
  describe('Suite 7: Security & Secret Protection in UI', () => {
    test('7.1: UI scripts never serialize or interpolate server password hashes or connection tokens', () => {
      const js = fs.readFileSync(adminShellJsPath, 'utf8');
      assert.strictEqual(js.includes('adminPasswordHash'), false, 'Must not reference adminPasswordHash');
      assert.strictEqual(js.includes('passwordHash'), false, 'Must not reference passwordHash');
      assert.strictEqual(js.includes('connectionToken'), false, 'Must not reference connectionToken');
    });
  });

  // =========================================================================
  // SUITE 8: ACCESSIBILITY, RESPONSIVE & VISUAL SYSTEM
  // =========================================================================
  describe('Suite 8: Accessibility & Visual System Compliance', () => {
    test('8.1: admin.css provides modal, drawer, tab, and responsive layout definitions', () => {
      assert.ok(fs.existsSync(adminCssPath), 'admin.css must exist');
      const css = fs.readFileSync(adminCssPath, 'utf8');
      assert.ok(css.includes('.admin-modal-backdrop'), 'Must have modal backdrop style');
      assert.ok(css.includes('.admin-modal-card'), 'Must have modal card style');
      assert.ok(css.includes('.admin-drawer-container'), 'Must have drawer style');
      assert.ok(css.includes('.admin-tabs-nav'), 'Must have tabs nav style');
      assert.ok(css.includes('.admin-toolbar'), 'Must have toolbar style');
      assert.ok(css.includes('.admin-pagination-bar'), 'Must have pagination bar style');
      assert.ok(css.includes('--min-touch-target: 44px'), 'Must enforce 44px minimum touch target');
    });
  });
});
