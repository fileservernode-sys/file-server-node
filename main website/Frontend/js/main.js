/* ==========================================================================
   MAIN WEBSITE INTERACTIVE SCRIPT - VANILLA JS (SHARED HOSTING COMPATIBLE)
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  initStickyHeader();
  initMobileDrawer();
  initStatusDemoToggles();
  initSmoothScroll();
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
 * 3. Status System Interactive Demo Toggle (For Previewing Design System States)
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
 * 4. Smooth Anchor Link Scrolling
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
