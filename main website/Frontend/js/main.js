/* ==========================================================================
   MAIN WEBSITE INTERACTIVE SCRIPT - VANILLA JS (SHARED HOSTING COMPATIBLE)
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  initStickyHeader();
  initMobileDrawer();
  initStatusDemoToggles();
  initSmoothScroll();
  initAccordion();
  initFrontendFormHandlers();
});

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

