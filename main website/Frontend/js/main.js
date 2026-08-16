/* ==========================================================================
   MAIN WEBSITE INTERACTIVE SCRIPT - VANILLA JS (SHARED HOSTING COMPATIBLE)
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  initAppRedirectNotice();
  initStickyHeader();
  initMobileDrawer();
  initStatusDemoToggles();
  initSmoothScroll();
  initAccordion();
  initFrontendFormHandlers();
});

/**
 * 0. App Access Guidance Banner
 * Shows guidance on how to open the File Manager ONLY when the home page is opened from the app (?from=app).
 * Does NOT show when opened via Google, direct link, or normal browsing.
 */
function initAppRedirectNotice() {
  const urlParams = new URLSearchParams(window.location.search);
  const fromApp = urlParams.get('from') === 'app' || 
                  urlParams.get('ref') === 'app' || 
                  urlParams.get('source') === 'app' ||
                  urlParams.get('action') === 'access_server';

  if (!fromApp) return;

  const header = document.querySelector('.site-header') || document.body.firstChild;
  if (!header) return;

  const authToken = localStorage.getItem('rn_auth_token');
  const targetUrl = authToken ? 'pages/dashboard.html' : 'pages/login.html';
  const buttonLabel = authToken ? 'Go to Dashboard 📁' : 'Sign In to Access Dashboard 📁';

  const banner = document.createElement('div');
  banner.id = 'app-access-guidance-banner';
  banner.style.cssText = `
    background: linear-gradient(135deg, #1e293b, #0f172a);
    color: #ffffff;
    border-bottom: 3px solid var(--color-brand-primary, #2563eb);
    padding: var(--space-md, 1rem) 0;
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.15);
    position: relative;
    z-index: 1050;
  `;

  banner.innerHTML = `
    <div class="container" style="display: flex; justify-content: space-between; align-items: center; gap: var(--space-md, 1rem); flex-wrap: wrap;">
      <div style="display: flex; align-items: flex-start; gap: var(--space-sm, 0.75rem); max-width: 780px;">
        <div style="font-size: 1.8rem; line-height: 1;">📱</div>
        <div>
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px; flex-wrap: wrap;">
            <h3 style="font-size: var(--font-size-base, 1rem); font-weight: 700; margin: 0; color: #ffffff;">How to Access Your File Manager</h3>
            <span class="badge badge-accent" style="font-size: 11px; padding: 2px 8px; background: #2563eb; color: #ffffff;">Opened from Android App</span>
          </div>
          <p style="margin: 0; font-size: var(--font-size-sm, 0.875rem); color: #cbd5e1; line-height: 1.4;">
            Welcome! To open your Android server's file manager: 
            <strong>Sign in</strong> to your account → Go to <strong>Dashboard</strong> → Under <strong>My Servers</strong>, click <strong>Open File Manager</strong>.
          </p>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: var(--space-sm, 0.75rem);">
        <a href="${targetUrl}" class="btn btn-primary btn-sm" style="white-space: nowrap; padding: 8px 16px; font-weight: 600; text-decoration: none;">
          ${buttonLabel}
        </a>
        <button type="button" onclick="document.getElementById('app-access-guidance-banner').remove()" class="btn btn-ghost btn-sm" style="color: #94a3b8; padding: 6px 10px; font-size: 1.1rem;" title="Dismiss notification">✕</button>
      </div>
    </div>
  `;

  if (header.nextSibling) {
    header.parentNode.insertBefore(banner, header.nextSibling);
  } else {
    header.parentNode.appendChild(banner);
  }
}

/**
 * 1. Sticky Header Scroll Effect
 */
function initStickyHeader() {
  const header = document.querySelector('.site-header');
  if (!header) return;

  const handleScroll = () => {
    if (window.scrollY > 20) {
      header.classList.add('is-scrolled');
    } else {
      header.classList.remove('is-scrolled');
    }
  };

  window.addEventListener('scroll', handleScroll, { passive: true });
}

/**
 * 2. Mobile Drawer Navigation & Backdrop Logic
 */
function initMobileDrawer() {
  const toggleBtn = document.querySelector('.mobile-menu-toggle');
  const closeBtn = document.querySelector('.drawer-close-btn');
  const drawer = document.querySelector('.mobile-nav-drawer');
  const backdrop = document.querySelector('.drawer-backdrop');

  if (!toggleBtn || !drawer || !backdrop) return;

  const openDrawer = () => {
    drawer.classList.add('is-open');
    backdrop.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    toggleBtn.setAttribute('aria-expanded', 'true');
    if (closeBtn) closeBtn.focus();
  };

  const closeDrawer = () => {
    drawer.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    document.body.style.overflow = '';
    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleBtn.focus();
  };

  toggleBtn.addEventListener('click', openDrawer);
  if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
  backdrop.addEventListener('click', closeDrawer);

  // Close on Escape Key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer.classList.contains('is-open')) {
      closeDrawer();
    }
  });

  // Close drawer on link click
  const drawerLinks = drawer.querySelectorAll('a');
  drawerLinks.forEach(link => {
    link.addEventListener('click', closeDrawer);
  });
}

/**
 * 3. Accessible Accordion Controller (FAQ & Collapsibles)
 */
function initAccordion() {
  const accordionTriggers = document.querySelectorAll('.accordion-trigger');
  accordionTriggers.forEach(trigger => {
    trigger.addEventListener('click', () => {
      const item = trigger.closest('.accordion-item');
      if (!item) return;

      const isExpanded = trigger.getAttribute('aria-expanded') === 'true';
      
      // Close sibling items in the same accordion group if needed
      const parentAccordion = item.closest('.accordion');
      if (parentAccordion && !parentAccordion.hasAttribute('data-multi-expand')) {
        parentAccordion.querySelectorAll('.accordion-item').forEach(sibling => {
          if (sibling !== item) {
            sibling.classList.remove('is-open');
            const siblingBtn = sibling.querySelector('.accordion-trigger');
            if (siblingBtn) siblingBtn.setAttribute('aria-expanded', 'false');
          }
        });
      }

      // Toggle current item
      if (isExpanded) {
        item.classList.remove('is-open');
        trigger.setAttribute('aria-expanded', 'false');
      } else {
        item.classList.add('is-open');
        trigger.setAttribute('aria-expanded', 'true');
      }
    });
  });
}

/**
 * 4. Interactive Frontend Form Submission Handlers (Contact, Login, Get-Started)
 */
function initFrontendFormHandlers() {
  const forms = document.querySelectorAll('[data-frontend-form]');
  forms.forEach(form => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      
      const submitBtn = form.querySelector('[type="submit"]');
      const feedbackContainer = form.querySelector('.form-feedback-area');

      if (submitBtn) {
        submitBtn.disabled = true;
        const originalText = submitBtn.innerHTML;
        submitBtn.innerHTML = `<span class="spinner"></span> Processing...`;

        setTimeout(() => {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalText;
          
          if (feedbackContainer) {
            feedbackContainer.innerHTML = `
              <div class="alert alert-info" style="margin-top: var(--space-md);">
                <strong>Frontend Demo:</strong> Form validation succeeded. Backend endpoints will connect in Phase 2.
              </div>`;
          }
        }, 800);
      }
    });
  });
}

/**
 * 5. Status System Interactive Demo Toggle
 */
function initStatusDemoToggles() {
  const statusContainer = document.getElementById('demo-status-container');
  const statusButtons = document.querySelectorAll('[data-status-toggle]');

  if (!statusContainer || !statusButtons.length) return;

  const statusMap = {
    online: `
      <span class="status-indicator status-online">
        <span class="status-dot"></span>
        Server Online
      </span>`,
    connecting: `
      <span class="status-indicator status-connecting">
        <span class="status-dot"></span>
        Connecting...
      </span>`,
    reconnecting: `
      <span class="status-indicator status-reconnecting">
        <span class="status-dot"></span>
        Reconnecting...
      </span>`,
    offline: `
      <span class="status-indicator status-offline">
        <span class="status-dot"></span>
        Server Offline
      </span>`
  };

  statusButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetState = btn.getAttribute('data-status-toggle');
      if (statusMap[targetState]) {
        statusContainer.innerHTML = statusMap[targetState];
        statusButtons.forEach(b => b.classList.remove('btn-primary'));
        btn.classList.add('btn-primary');
      }
    });
  });
}

/**
 * 6. Smooth Anchor Link Scrolling
 */
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const href = this.getAttribute('href');
      if (href === '#' || href === '') return;

      const targetElement = document.querySelector(href);
      if (targetElement) {
        e.preventDefault();
        targetElement.scrollIntoView({
          behavior: 'smooth'
        });
      }
    });
  });
}

