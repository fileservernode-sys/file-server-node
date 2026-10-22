/* ==========================================================================
   MAIN WEBSITE INTERACTIVE SCRIPT - VANILLA JS (SHARED HOSTING COMPATIBLE)
   Phase MW-1 - Batch MW-1.3: Unified Chrome & Navigation System
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  initAppRedirectNotice();
  initStickyHeader();
  initMobileDrawer();
  initActiveNavigation();
  initAuthHeaderState();
  initSessionLifecycleMonitor();
  initStatusDemoToggles();
  initSmoothScroll();
  initAccordion();
  initFrontendFormHandlers();
  initPageMotion();
});

/**
 * Orchestrates Page Entrance and Scroll Reveal via ZdexMotion
 */
function initPageMotion() {
  if (window.ZdexMotion) {
    if (typeof window.ZdexMotion.initPageEntrance === 'function') {
      window.ZdexMotion.initPageEntrance('main');
    }
    if (typeof window.ZdexMotion.initScrollReveal === 'function') {
      window.ZdexMotion.initScrollReveal('.motion-reveal');
    }
  }
}

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

  const isAuth = typeof AuthService !== 'undefined' ? AuthService.isSessionValid() : Boolean(localStorage.getItem('rn_user_data'));
  const targetUrl = isAuth ? 'pages/dashboard.html' : 'pages/login.html';
  const buttonLabel = isAuth ? 'Go to Dashboard' : 'Sign In to Access Dashboard';

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
 * 1. Sticky Header Scroll Effect (Smooth rAF Throttle & ZdexMotion Integration)
 */
function initStickyHeader() {
  if (window.ZdexMotion && typeof window.ZdexMotion.initHeaderScroll === 'function') {
    window.ZdexMotion.initHeaderScroll('.site-header', 20);
    return;
  }

  const header = document.querySelector('.site-header');
  if (!header) return;

  let ticking = false;
  const handleScroll = () => {
    if (window.scrollY > 20) {
      header.classList.add('is-scrolled');
    } else {
      header.classList.remove('is-scrolled');
    }
    ticking = false;
  };

  window.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(handleScroll);
      ticking = true;
    }
  }, { passive: true });

  handleScroll();
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
 * 3. Automatic Active Navigation Page Detection (Includes Dashboard Shell Navigation)
 */
function initActiveNavigation() {
  const updateNavActiveState = () => {
    const pathname = window.location.pathname.toLowerCase();
    const navLinks = document.querySelectorAll('.nav-link, .drawer-nav-link, .dashboard-nav-link');

    let currentSlug = pathname
      .split('/')
      .pop()
      .replace('.html', '')
      .trim() || 'index';

    // Treat dashboard.html as servers if dashboard.html is loaded
    if (currentSlug === 'dashboard') {
      currentSlug = 'servers';
    }

    navLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (!href) return;

      const normalizedHref = href.toLowerCase();
      const targetSlug = normalizedHref
        .replace('../', '')
        .replace('pages/', '')
        .replace('.html', '')
        .replace('/', '')
        .split('#')[0]
        .trim();

      const isHomePage = (currentSlug === 'index' || currentSlug === '') && (targetSlug === 'index' || targetSlug === '');
      const isMatchingPage = !isHomePage && targetSlug !== '' && currentSlug === targetSlug;

      if (isHomePage || isMatchingPage) {
        link.classList.add('is-active', 'active');
        link.setAttribute('aria-current', 'page');
      } else {
        link.classList.remove('is-active', 'active');
        link.removeAttribute('aria-current');
      }
    });
  };

  updateNavActiveState();
}

/**
 * 4. Dynamic Authenticated Header State Sync (Strict 24-Hour Policy)
 */
function initAuthHeaderState() {
  const isAuth = typeof AuthService !== 'undefined' ? AuthService.isSessionValid() : false;
  const user = typeof AuthService !== 'undefined' ? AuthService.getSavedUser() : null;

  const headerActions = document.querySelector('.header-actions');
  const userEmailSpan = document.getElementById('user-email-header');
  const logoutBtn = document.getElementById('btn-logout');

  // Populate user data if elements exist and session is valid
  if (isAuth && user && userEmailSpan) {
    try {
      const email = user.email || 'User';
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
      if (typeof AuthService !== 'undefined') {
        AuthService.logoutUser();
      } else {
        const isInnerPage = window.location.pathname.includes('/pages/');
        window.location.href = isInnerPage ? 'login.html' : 'pages/login.html';
      }
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
        if (typeof AuthService !== 'undefined') {
          AuthService.logoutUser();
        } else {
          window.location.href = isInnerPage ? 'login.html' : 'pages/login.html';
        }
      });
    }
  }
}

/**
 * 4.1 Session Lifecycle Monitor (Checks Expiration & Near-Expiry Warnings Every 30s)
 */
function initSessionLifecycleMonitor() {
  if (typeof AuthService === 'undefined') return;

  const checkSession = () => {
    if (!AuthService.isSessionValid()) {
      return;
    }
    AuthService.checkSessionWarning();
  };

  // Immediate check on page load
  checkSession();

  // Periodic check every 30 seconds
  setInterval(checkSession, 30000);
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

      const panel = item.querySelector('.accordion-panel');
      const isExpanded = trigger.getAttribute('aria-expanded') === 'true';
      
      const parentAccordion = item.closest('.accordion');
      if (parentAccordion && !parentAccordion.hasAttribute('data-multi-expand')) {
        parentAccordion.querySelectorAll('.accordion-item').forEach(sibling => {
          if (sibling !== item) {
            sibling.classList.remove('is-open');
            const siblingBtn = sibling.querySelector('.accordion-trigger');
            if (siblingBtn) siblingBtn.setAttribute('aria-expanded', 'false');
            const siblingPanel = sibling.querySelector('.accordion-panel');
            if (siblingPanel) siblingPanel.setAttribute('hidden', '');
          }
        });
      }

      if (isExpanded) {
        item.classList.remove('is-open');
        trigger.setAttribute('aria-expanded', 'false');
        if (panel) panel.setAttribute('hidden', '');
      } else {
        item.classList.add('is-open');
        trigger.setAttribute('aria-expanded', 'true');
        if (panel) panel.removeAttribute('hidden');
      }
    });
  });
}

/**
 * 6. Customer Contact & Support Inquiries Form Handler (Phase 14.4)
 * Provides accessible, validated, rate-limit-aware submission with honest delivery feedback.
 */
function initContactForm() {
  const form = document.getElementById('contact-form');
  if (!form) return;

  const nameInput = form.querySelector('#contact-name');
  const emailInput = form.querySelector('#contact-email');
  const reasonSelect = form.querySelector('#contact-reason');
  const subjectInput = form.querySelector('#contact-subject');
  const messageInput = form.querySelector('#contact-message');
  const hpInput = form.querySelector('#contact-hp');
  const submitBtn = form.querySelector('#contact-submit-btn') || form.querySelector('button[type="submit"]');
  const feedbackArea = form.querySelector('#contact-form-feedback') || form.querySelector('.form-feedback-area');

  function clearErrors() {
    form.querySelectorAll('.form-error-msg').forEach(el => {
      el.textContent = '';
      el.style.display = 'none';
    });
    form.querySelectorAll('.form-input, .form-select, .form-textarea').forEach(el => {
      el.removeAttribute('aria-invalid');
    });
    if (feedbackArea) {
      feedbackArea.innerHTML = '';
    }
  }

  function setFieldError(field, errorElId, message) {
    if (field) {
      field.setAttribute('aria-invalid', 'true');
    }
    const errEl = document.getElementById(errorElId);
    if (errEl) {
      errEl.textContent = message;
      errEl.style.display = 'block';
    }
  }

  // Clear field errors dynamically as user corrects their input
  [nameInput, emailInput, reasonSelect, subjectInput, messageInput].forEach(field => {
    if (!field) return;
    const errId = field.id + '-error';
    field.addEventListener('input', () => {
      field.removeAttribute('aria-invalid');
      const errEl = document.getElementById(errId);
      if (errEl) {
        errEl.textContent = '';
        errEl.style.display = 'none';
      }
    });
    if (field.tagName === 'SELECT') {
      field.addEventListener('change', () => {
        field.removeAttribute('aria-invalid');
        const errEl = document.getElementById(errId);
        if (errEl) {
          errEl.textContent = '';
          errEl.style.display = 'none';
        }
      });
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();

    const name = (nameInput ? nameInput.value : '').trim();
    const email = (emailInput ? emailInput.value : '').trim();
    const reason = (reasonSelect ? reasonSelect.value : '').trim();
    const subject = (subjectInput ? subjectInput.value : '').trim();
    const message = (messageInput ? messageInput.value : '').trim();
    const hp = (hpInput ? hpInput.value : '').trim();

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    let hasError = false;
    let firstInvalidField = null;

    if (!name) {
      setFieldError(nameInput, 'contact-name-error', 'Please enter your full name.');
      hasError = true;
      if (!firstInvalidField) firstInvalidField = nameInput;
    } else if (name.length > 100) {
      setFieldError(nameInput, 'contact-name-error', 'Name must not exceed 100 characters.');
      hasError = true;
      if (!firstInvalidField) firstInvalidField = nameInput;
    }

    if (!email) {
      setFieldError(emailInput, 'contact-email-error', 'Please enter your email address.');
      hasError = true;
      if (!firstInvalidField) firstInvalidField = emailInput;
    } else if (!emailRegex.test(email) || email.length > 254) {
      setFieldError(emailInput, 'contact-email-error', 'Please enter a valid email address (e.g. name@example.com).');
      hasError = true;
      if (!firstInvalidField) firstInvalidField = emailInput;
    }

    if (!reason) {
      setFieldError(reasonSelect, 'contact-reason-error', 'Please select a reason for your inquiry.');
      hasError = true;
      if (!firstInvalidField) firstInvalidField = reasonSelect;
    }

    if (!subject) {
      setFieldError(subjectInput, 'contact-subject-error', 'Please enter a subject.');
      hasError = true;
      if (!firstInvalidField) firstInvalidField = subjectInput;
    } else if (subject.length < 3 || subject.length > 200) {
      setFieldError(subjectInput, 'contact-subject-error', 'Subject must be between 3 and 200 characters.');
      hasError = true;
      if (!firstInvalidField) firstInvalidField = subjectInput;
    }

    if (!message) {
      setFieldError(messageInput, 'contact-message-error', 'Please enter your message.');
      hasError = true;
      if (!firstInvalidField) firstInvalidField = messageInput;
    } else if (message.length < 10) {
      setFieldError(messageInput, 'contact-message-error', 'Message must be at least 10 characters long.');
      hasError = true;
      if (!firstInvalidField) firstInvalidField = messageInput;
    } else if (message.length > 3000) {
      setFieldError(messageInput, 'contact-message-error', 'Message must not exceed 3000 characters.');
      hasError = true;
      if (!firstInvalidField) firstInvalidField = messageInput;
    }

    if (hasError) {
      if (firstInvalidField) firstInvalidField.focus();
      return;
    }

    // Set loading state on submit button
    const originalBtnHtml = submitBtn ? submitBtn.innerHTML : 'Send Message';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="spinner" aria-hidden="true" style="margin-right:8px;"></span><span>Sending Message...</span>';
    }

    const host = window.location.hostname;
    const protocol = window.location.protocol;
    const isLocal = host === 'localhost' || host === '127.0.0.1' || protocol === 'file:' || !host;
    const apiBase = (window.CONFIG && window.CONFIG.API_BASE_URL) ||
                    window.API_BASE_URL ||
                    (isLocal ? 'http://localhost:4000/api/v1' : 'https://api.zdexcloud.com/api/v1');

    const mailtoSubject = encodeURIComponent('[ZdexCloud Support] ' + subject);
    const mailtoBody = encodeURIComponent(
      'Full Name: ' + name + '\n' +
      'Email: ' + email + '\n' +
      'Category: ' + reason + '\n\n' +
      'Message:\n' + message
    );
    const mailtoUrl = 'mailto:support@zdexcloud.com?subject=' + mailtoSubject + '&body=' + mailtoBody;

    try {
      const response = await fetch(apiBase + '/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          name: name,
          email: email,
          reason: reason,
          subject: subject,
          message: message,
          _hp_security_check: hp
        })
      });

      const data = await response.json().catch(() => null);

      if (response.ok && data && data.success) {
        if (feedbackArea) {
          feedbackArea.innerHTML = [
            '<div class="alert alert-success" role="status" aria-live="polite" style="margin-top: var(--space-md); display: flex; align-items: flex-start; gap: var(--space-md);">',
            '  <div style="flex-shrink:0;">',
            '    <svg class="icon icon-md" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">',
            '      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>',
            '      <polyline points="22 4 12 14.01 9 11.01"></polyline>',
            '    </svg>',
            '  </div>',
            '  <div>',
            '    <strong style="display:block; margin-bottom: 2px;">Inquiry Sent Successfully</strong>',
            '    <span>Your message has been received by our engineering support desk. We will review your inquiry and follow up at <strong>' + escapeHtml(email) + '</strong>.</span>',
            '  </div>',
            '</div>'
          ].join('\n');
        }
        form.reset();
      } else if (response.status === 429) {
        if (feedbackArea) {
          feedbackArea.innerHTML = [
            '<div class="alert alert-warning" role="alert" aria-live="assertive" style="margin-top: var(--space-md);">',
            '  <div>',
            '    <strong style="display:block; margin-bottom: 2px;">Rate Limit Reached</strong>',
            '    <span>You have submitted multiple requests recently. Please wait a few minutes before submitting again, or reach us directly at <a href="mailto:support@zdexcloud.com" style="text-decoration: underline; font-weight: 600;">support@zdexcloud.com</a>.</span>',
            '  </div>',
            '</div>'
          ].join('\n');
        }
      } else {
        const errorMsg = (data && data.error && data.error.message) ? data.error.message : 'Unable to submit your inquiry through the automated form.';
        if (feedbackArea) {
          feedbackArea.innerHTML = [
            '<div class="alert alert-error" role="alert" aria-live="assertive" style="margin-top: var(--space-md);">',
            '  <div>',
            '    <strong style="display:block; margin-bottom: 4px;">Submission Notice</strong>',
            '    <p style="margin:0 0 8px 0;">' + escapeHtml(errorMsg) + '</p>',
            '    <a href="' + mailtoUrl + '" class="btn btn-secondary btn-sm" style="display:inline-flex; align-items:center; gap:6px;">',
            '      <span>Open in Email Client</span>',
            '    </a>',
            '  </div>',
            '</div>'
          ].join('\n');
        }
      }
    } catch (networkErr) {
      if (feedbackArea) {
        feedbackArea.innerHTML = [
          '<div class="alert alert-warning" role="alert" aria-live="assertive" style="margin-top: var(--space-md);">',
          '  <div>',
          '    <strong style="display:block; margin-bottom: 4px;">Automated Service Notice</strong>',
          '    <p style="margin: 0 0 8px 0;">Could not connect to the automated intake service right now. Your message text has been retained below. You can send it directly to our support desk with your email client:</p>',
          '    <a href="' + mailtoUrl + '" class="btn btn-secondary btn-sm" style="display:inline-flex; align-items:center; gap:6px;">',
          '      <span>Send via Email Client</span>',
          '    </a>',
          '  </div>',
          '</div>'
        ].join('\n');
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnHtml;
      }
    }
  });

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

function initFrontendFormHandlers() {
  initContactForm();
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


