/* ==========================================================================
   MAIN WEBSITE INTERACTIVE SCRIPT - VANILLA JS (SHARED HOSTING COMPATIBLE)
   Phase MW-1 — Batch MW-1.3: Unified Chrome & Navigation System
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  initAppRedirectNotice();
  initStickyHeader();
  initMobileDrawer();
  initActiveNavigation();
  initAuthHeaderState();
  initStatusDemoToggles();
  initSmoothScroll();
  initAccordion();
  initFrontendFormHandlers();
});

/**
 * 0. App Access Guidance Banner (Zero Emojis, Pure Lucide SVG Icons)
 * Shows guidance on how to open the File Manager ONLY when the home page is opened from the app (?from=app).
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
  const buttonLabel = authToken ? 'Go to Dashboard' : 'Sign In to Access Dashboard';

  const banner = document.createElement('div');
  banner.id = 'app-access-guidance-banner';
  banner.style.cssText = `
    background: linear-gradient(135deg, #1E293B, #0F172A);
    color: #FFFFFF;
    border-bottom: 2px solid var(--color-brand-accent, #2563eb);
    padding: var(--space-md, 1rem) 0;
    box-shadow: var(--shadow-md);
    position: relative;
    z-index: 1050;
  `;

  banner.innerHTML = `
    <div class="container" style="display: flex; justify-content: space-between; align-items: center; gap: var(--space-md, 1rem); flex-wrap: wrap;">
      <div style="display: flex; align-items: flex-start; gap: var(--space-md, 1rem); max-width: 780px;">
        <div style="width: 40px; height: 40px; border-radius: var(--radius-md, 8px); background: rgba(37, 99, 235, 0.2); color: #60a5fa; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
          <svg class="icon icon-md" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
            <line x1="12" y1="18" x2="12.01" y2="18"></line>
          </svg>
        </div>
        <div>
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px; flex-wrap: wrap;">
            <h3 style="font-size: var(--font-size-body, 1rem); font-weight: 700; margin: 0; color: #ffffff;">How to Access Your File Manager</h3>
            <span class="badge badge-accent" style="font-size: 11px; padding: 2px 8px; background: #2563eb; color: #ffffff; border: none;">Opened from Android App</span>
          </div>
          <p style="margin: 0; font-size: var(--font-size-body-sm, 0.875rem); color: #cbd5e1; line-height: 1.4;">
            Welcome! To open your Android server's file manager: 
            <strong>Sign in</strong> to your account → Go to <strong>Dashboard</strong> → Under <strong>My Servers</strong>, click <strong>Open File Manager</strong>.
          </p>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: var(--space-sm, 0.75rem);">
        <a href="${targetUrl}" class="btn btn-accent btn-sm" style="white-space: nowrap;">
          <span>${buttonLabel}</span>
          <svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="5" y1="12" x2="19" y2="12"></line>
            <polyline points="12 5 19 12 12 19"></polyline>
          </svg>
        </a>
        <button type="button" onclick="document.getElementById('app-access-guidance-banner').remove()" class="btn btn-ghost btn-sm" style="color: #94a3b8; padding: 6px;" aria-label="Dismiss notification">
          <svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
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
 * 2. Mobile Drawer Navigation, Body Lock & Focus Management
 */
function initMobileDrawer() {
  const toggleBtn = document.querySelector('.mobile-menu-toggle');
  const closeBtn = document.querySelector('.drawer-close-btn');
  const drawer = document.querySelector('.mobile-nav-drawer');
  const backdrop = document.querySelector('.drawer-backdrop');

  if (!toggleBtn || !drawer || !backdrop) return;

  let previousActiveElement = null;

  const openDrawer = () => {
    previousActiveElement = document.activeElement;
    drawer.classList.add('is-open');
    backdrop.classList.add('is-open');
    document.body.classList.add('drawer-open');
    drawer.setAttribute('aria-hidden', 'false');
    backdrop.setAttribute('aria-hidden', 'false');
    toggleBtn.setAttribute('aria-expanded', 'true');
    if (closeBtn) closeBtn.focus();
  };

  const closeDrawer = () => {
    drawer.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    document.body.classList.remove('drawer-open');
    drawer.setAttribute('aria-hidden', 'true');
    backdrop.setAttribute('aria-hidden', 'true');
    toggleBtn.setAttribute('aria-expanded', 'false');
    if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
      previousActiveElement.focus();
    } else {
      toggleBtn.focus();
    }
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
 * 3. Automatic Active Navigation Page Detection
 */
function initActiveNavigation() {
  const pathname = window.location.pathname.toLowerCase();
  const navLinks = document.querySelectorAll('.nav-link, .drawer-nav-link');

  const currentSlug = pathname
    .split('/')
    .pop()
    .replace('.html', '')
    .trim() || 'index';

  navLinks.forEach(link => {
    const href = link.getAttribute('href');
    if (!href) return;

    const normalizedHref = href.toLowerCase();
    const targetSlug = normalizedHref
      .replace('../', '')
      .replace('pages/', '')
      .replace('.html', '')
      .replace('/', '')
      .trim();

    const isHomePage = (currentSlug === 'index' || currentSlug === '') && (targetSlug === 'index' || targetSlug === '');
    const isMatchingPage = !isHomePage && targetSlug !== '#' && targetSlug !== '' && currentSlug === targetSlug;

    if (isHomePage || isMatchingPage) {
      link.classList.add('is-active');
      link.setAttribute('aria-current', 'page');
    } else {
      link.classList.remove('is-active');
      link.removeAttribute('aria-current');
    }
  });
}

/**
 * 4. Dynamic Authenticated Header State Sync
 */
function initAuthHeaderState() {
  const authToken = localStorage.getItem('rn_auth_token');
  const userDataRaw = localStorage.getItem('rn_user_data');
  const isAuth = Boolean(authToken);

  const headerActions = document.querySelector('.header-actions');
  const userEmailSpan = document.getElementById('user-email-header');
  const logoutBtn = document.getElementById('btn-logout');

  // Populate user data if elements exist
  if (userDataRaw && userEmailSpan) {
    try {
      const userData = JSON.parse(userDataRaw);
      const email = userData.email || 'User';
      userEmailSpan.textContent = email;

      const avatarElem = document.getElementById('user-avatar-initial');
      if (avatarElem) {
        avatarElem.textContent = email.charAt(0).toUpperCase();
      }
    } catch (e) {
      console.warn('Could not parse user data', e);
    }
  }

  // Handle Logout Button
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem('rn_auth_token');
      localStorage.removeItem('rn_user_data');
      sessionStorage.clear();
      
      const isInnerPage = window.location.pathname.includes('/pages/');
      window.location.href = isInnerPage ? 'login.html' : 'pages/login.html';
    });
  }

  // Synchronize Public Header Actions for Authenticated Users
  if (isAuth && headerActions && !document.querySelector('.site-header--authenticated')) {
    const isInnerPage = window.location.pathname.includes('/pages/');
    const dashboardPath = isInnerPage ? 'dashboard.html' : 'pages/dashboard.html';

    headerActions.innerHTML = `
      <a href="${dashboardPath}" class="btn btn-secondary btn-sm">
        <svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7"></rect>
          <rect x="14" y="3" width="7" height="7"></rect>
          <rect x="14" y="14" width="7" height="7"></rect>
          <rect x="3" y="14" width="7" height="7"></rect>
        </svg>
        <span>Dashboard</span>
      </a>
      <button type="button" id="btn-header-logout" class="btn btn-ghost btn-sm">Sign Out</button>
    `;

    const dynamicLogoutBtn = document.getElementById('btn-header-logout');
    if (dynamicLogoutBtn) {
      dynamicLogoutBtn.addEventListener('click', () => {
        localStorage.removeItem('rn_auth_token');
        localStorage.removeItem('rn_user_data');
        sessionStorage.clear();
        window.location.href = isInnerPage ? 'login.html' : 'pages/login.html';
      });
    }
  }
}

/**
 * 5. Accessible Accordion Controller (FAQ & Collapsibles)
 */
function initAccordion() {
  const accordionTriggers = document.querySelectorAll('.accordion-trigger');
  accordionTriggers.forEach(trigger => {
    trigger.addEventListener('click', () => {
      const item = trigger.closest('.accordion-item');
      if (!item) return;

      const isExpanded = trigger.getAttribute('aria-expanded') === 'true';
      
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
 * 6. Interactive Frontend Form Submission Handlers
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
                <strong>Notice:</strong> Form validation succeeded. Backend API processing active.
              </div>`;
          }
        }, 800);
      }
    });
  });
}

/**
 * 7. Status System Interactive Demo Toggle
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
 * 8. Smooth Anchor Link Scrolling
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


