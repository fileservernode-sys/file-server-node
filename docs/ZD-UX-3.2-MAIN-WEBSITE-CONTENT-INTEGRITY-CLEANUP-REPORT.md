# ZD-UX-3.2 — MAIN WEBSITE CONTENT INTEGRITY & DESIGN-SYSTEM CLEANUP
## Targeted Corrective Batch Report

**Project:** ZdexCloud Personal File Server  
**Batch ID:** ZD-UX-3.2  
**Audit Standard:** Antigravity Global Engineering Operating System (GEOS) — Level 1  
**Scope:** Strictly `main website/Frontend/` (Targeted cleanup of findings F-01, F-02, F-03, F-04 from ZD-UX-3.1)  
**Date:** September 8, 2026  
**Final Verdict:** **PASS**  

---

## 1. Executive Summary

Batch **ZD-UX-3.2** successfully resolved the four specific findings identified during the **ZD-UX-3.1** Forensic Audit without causing any functional, responsive, visual, or architectural regressions. 

Every change was executed strictly within the authorized scope of `main website/Frontend/`:
1. **F-01 (Pricing Device Limit):** Updated the Registered Devices row in the Feature Comparison Matrix on `pages/pricing.html` to specify *"Up to 5 Phones"* across Free and Pro tiers, bringing it into 100% harmony with the page header, the tier cards, and the canonical backend database enforcement.
2. **F-02 (Static Telemetry Label):** Replaced the badge text *"Live Architecture Node Status"* in the homepage hero diagram (`index.html`) with *"Architecture Concept Overview"*, eliminating any ambiguity regarding live runtime telemetry vs. architectural visualization.
3. **F-03 (Terminology Clarification):** Replaced *"Zero-Knowledge"* in the homepage hero telemetry strip (`index.html`) with *"Dual-Plane Privacy Isolation"*, accurately conveying the dual-auth isolation architecture without misappropriating cryptographic ZKP nomenclature.
4. **F-04 (CSS Token Fallback Normalization):** Cleaned redundant `#E2E8F0` fallbacks across `css/notification-center.css` where the canonical design token `var(--color-border)` already natively provides the exact semantic border color.
5. **Regression & Worktree Integrity:** All 141 Android Flutter tests passed, all JavaScript modules passed syntax compilation, all internal links and assets resolved without error, and zero unrelated files were modified.

---

## 2. Baseline Git State

The Git repository was checked immediately upon initiation:
- **Branch:** `main`
- **Baseline Commit:** `e9f61da739d26c32f6e60d299b8602483c199c84`
- **Dirty Files:** Pre-existing modified files from batches ZD-UX-0, ZD-UX-1, ZD-UX-2, and ZD-UX-3 were preserved intact.
- **Touched Files in ZD-UX-3.2:**
  - `main website/Frontend/pages/pricing.html`
  - `main website/Frontend/index.html`
  - `main website/Frontend/css/notification-center.css`
  - Zero commits created. Zero destructive operations executed.

---

## 3. F-01 — Pricing Device Limit Correction

- **Target File:** `main website/Frontend/pages/pricing.html`
- **Problem Statement (from ZD-UX-3.1):** The header stated *"Up to 5 paired Android phone servers included free"* and the Free Tier card stated *"Up to 5 Registered Android Phones"*, but the comparison table listed *"1 Phone"* (Free Tier) and *"Up to 3 Phones"* (Pro Tier).
- **Backend Evidence:** In `main website/Backend/src/routes/device.ts:121`, the server limit is strictly enforced at 5 active servers (`if (serverCount >= 5) throw new ConflictError(...)`).
- **Correction Implemented:**
  ```html
  <!-- Before -->
  <tr>
    <td><strong>Registered Devices</strong></td>
    <td>1 Phone</td>
    <td>Up to 3 Phones</td>
    <td>Custom</td>
  </tr>

  <!-- After -->
  <tr>
    <td><strong>Registered Devices</strong></td>
    <td>Up to 5 Phones</td>
    <td>Up to 5 Phones</td>
    <td>Custom</td>
  </tr>
  ```
- **Result:** **RESOLVED**. Complete consistency across the page header, cards, comparison matrix, and backend control plane.

---

## 4. F-02 — Static Telemetry Label Correction

- **Target File:** `main website/Frontend/index.html`
- **Problem Statement (from ZD-UX-3.1):** The hero visual card contained a badge reading *"Live Architecture Node Status"*, which could be misinterpreted as live streaming backend socket telemetry rather than an illustrative topology diagram.
- **Correction Implemented:**
  ```html
  <!-- Before -->
  <span class="badge badge-subtle">Live Architecture Node Status</span>

  <!-- After -->
  <span class="badge badge-subtle">Architecture Concept Overview</span>
  ```
- **Result:** **RESOLVED**. Eliminates false expectations of live WebSocket telemetry while retaining modern developer aesthetic.

---

## 5. F-03 — Terminology Clarification ("Zero-Knowledge")

- **Target File:** `main website/Frontend/index.html`
- **Problem Statement (from ZD-UX-3.1):** The hero telemetry strip featured `ISOLATION: Zero-Knowledge`. Because "Zero-Knowledge" has a rigorous mathematical definition in cryptography (ZKP) and ZdexCloud's architecture achieves privacy through credential isolation and non-inspection of user data on relay, the terminology was technically imprecise.
- **Correction Implemented:**
  ```html
  <!-- Before -->
  <span class="telemetry-item"><span class="telemetry-label">ISOLATION:</span> Zero-Knowledge</span>

  <!-- After -->
  <span class="telemetry-item"><span class="telemetry-label">ISOLATION:</span> Dual-Plane Privacy Isolation</span>
  ```
- **Result:** **RESOLVED**. Accurately portrays the airgap between Platform Account credentials and on-device File-Server credentials.

---

## 6. F-04 — CSS Token Fallback Cleanup

- **Target File:** `main website/Frontend/css/notification-center.css`
- **Problem Statement (from ZD-UX-3.1):** Redundant hardcoded hex fallbacks `var(--color-border, #E2E8F0)` were present across `.rn-notif-bell-btn`, `.rn-notif-popover`, `.rn-notif-popover-header`, `.rn-notif-popover-footer`, `.rn-notif-item`, `.rn-notif-filter-bar`, and `.rn-notif-card`.
- **Token Check:** In `css/variables.css:103`, `--color-border: #E2E8F0;` is authoritatively defined.
- **Correction Implemented:**
  Normalized all instances of `var(--color-border, #E2E8F0)` to the canonical token `var(--color-border)`.
- **Result:** **RESOLVED**. Code is clean, DRY, and tightly bound to the single source of truth.

---

## 7. Files Modified

| File Path | Nature of Change |
|---|---|
| `main website/Frontend/pages/pricing.html` | Updated comparison matrix Registered Devices row to "Up to 5 Phones". |
| `main website/Frontend/index.html` | Corrected hero badge to "Architecture Concept Overview" and isolation label to "Dual-Plane Privacy Isolation". |
| `main website/Frontend/css/notification-center.css` | Normalized redundant `--color-border` fallbacks. |

---

## 8. Regression Verification

1. **HTML Validation:** All 18 HTML pages verified for tag balance and container hierarchy (**100% PASS**).
2. **JavaScript Syntax Check:** Executed `node -c` on all 7 JS modules (`auth.js`, `config.js`, `file-manager-embedded.js`, `main.js`, `motion.js`, `notification-center.js`, `server-discovery.js`). Result: **0 syntax errors**.
3. **Link & Asset Audit:** Executed automated asset scanner across all 18 HTML pages. Result: **0 broken references**.
4. **Claims Audit:** Verified that no remaining instances of `Zero-Knowledge` exist on `index.html`.
5. **Android Flutter Suite:** Ran `flutter test` across all unit, widget, and architecture test suites in `Android app/Android app code/`.
   - **Result:** **All 141 tests PASSED** with zero failures or regressions.

---

## 9. Legacy Branding Verification

- Grepped for `ViewDuration`, `viewduration`, `viewduration.com`, `RemoteNode`, `remotenode.net`.
- **Result:** **Zero occurrences in user-visible content**. Internal technical compatibility keys (`rn_auth_token`, deep link parser fallback) remain safely constrained.

---

## 10. Responsive Verification

Inspected layout and container boundaries across the 11 targeted viewport widths:
- `320px`, `360px`, `375px`, `390px`, `414px`, `480px`, `768px`, `1024px`, `1280px`, `1440px`, `1920px`.
- **Result:** **CODE-VERIFIED**. Table wrapper native horizontal scrolling (`overflow-x: auto;`) accommodates table text cleanly down to 320px; hero visual telemetry strip flex-wraps smoothly without clipping.

---

## 11. Scope Verification

- **Changes Confined To:** `main website/Frontend/` only.
- **Prohibited Modules:** Zero modifications to `Backend/`, `Android app/`, or `inbuilt file manager/`.
- **Result:** **PASS**.

---

## 12. Worktree Integrity

- Run: `git status --short`
- The modified files precisely match the baseline with the addition of the targeted CSS cleanup in `notification-center.css`.
- Zero commits created. Zero files deleted.
- **Result:** **VERIFIED**.

---

## 13. Remaining Out-of-Scope Findings

None identified during this targeted corrective batch.

---

## 14. Final Verdict

# **PASS**

All four corrective tasks (F-01, F-02, F-03, F-04) have been completely resolved, fully verified, and validated against canonical backend evidence and test suites.
