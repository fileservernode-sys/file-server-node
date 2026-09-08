/**
 * ============================================================================
 * ZDEXCLOUD MOTION & INTERACTION CONTROLLER (ZD-UX-1)
 * Centralized, accessible JavaScript motion orchestration.
 * 
 * Features:
 * - Reduced motion preference auto-detection and query API
 * - IntersectionObserver-based viewport scroll reveals
 * - Modal enter/exit state transition coordinator
 * - Ephemeral toast notification queue & transition manager
 * ============================================================================
 */

(function (window, document) {
  'use strict';

  // Motion Configuration Tokens (Synchronized with variables.css)
  const MOTION_CONFIG = {
    reducedMotionQuery: '(prefers-reduced-motion: reduce)',
    scrollRevealThreshold: 0.15,
    toastDefaultDuration: 4000,
    durations: {
      instant: 100,
      fast: 150,
      base: 220,
      moderate: 320,
      deliberate: 450,
      complex: 600
    }
  };

  /**
   * Evaluates if user prefers reduced motion.
   * @returns {boolean}
   */
  function isReducedMotion() {
    if (typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(MOTION_CONFIG.reducedMotionQuery).matches;
  }

  /**
   * Initializes IntersectionObserver to trigger .is-revealed on .motion-reveal elements.
   * Gracefully degrades for users with prefers-reduced-motion or unsupported browsers.
   */
  function initScrollReveal(selector = '.motion-reveal') {
    const targets = document.querySelectorAll(selector);
    if (!targets || targets.length === 0) return;

    if (isReducedMotion() || !('IntersectionObserver' in window)) {
      targets.forEach((el) => el.classList.add('is-revealed'));
      return;
    }

    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-revealed');
          obs.unobserve(entry.target);
        }
      });
    }, {
      root: null,
      rootMargin: '0px 0px -40px 0px',
      threshold: MOTION_CONFIG.scrollRevealThreshold
    });

    targets.forEach((target) => observer.observe(target));
  }

  /**
   * Manages accessible Modal open/close transitions.
   */
  const ModalController = {
    open(dialogElement, backdropElement) {
      if (!dialogElement) return;
      if (backdropElement) backdropElement.classList.add('is-open');
      dialogElement.classList.add('is-open');
      dialogElement.setAttribute('aria-hidden', 'false');

      // Focus first actionable element for accessibility
      const focusable = dialogElement.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (focusable) focusable.focus();
    },

    close(dialogElement, backdropElement, onClosedCallback) {
      if (!dialogElement) return;
      dialogElement.classList.remove('is-open');
      dialogElement.setAttribute('aria-hidden', 'true');
      if (backdropElement) backdropElement.classList.remove('is-open');

      if (isReducedMotion()) {
        if (typeof onClosedCallback === 'function') onClosedCallback();
        return;
      }

      // Allow transition to complete before callback
      setTimeout(() => {
        if (typeof onClosedCallback === 'function') onClosedCallback();
      }, MOTION_CONFIG.durations.moderate);
    }
  };

  /**
   * Manages Toast Notifications with smooth entrance/exit transitions.
   */
  const ToastManager = {
    containerId: 'zdex-toast-container',

    getOrCreateContainer() {
      let container = document.getElementById(this.containerId);
      if (!container) {
        container = document.createElement('div');
        container.id = this.containerId;
        container.className = 'toast-container';
        container.setAttribute('aria-live', 'polite');
        container.setAttribute('aria-atomic', 'true');
        document.body.appendChild(container);
      }
      return container;
    },

    show(message, type = 'info', duration = MOTION_CONFIG.toastDefaultDuration) {
      const container = this.getOrCreateContainer();
      const toast = document.createElement('div');
      toast.className = `toast toast--${type}`;
      toast.setAttribute('role', 'status');
      toast.textContent = message;

      container.appendChild(toast);

      // Trigger entrance frame
      requestAnimationFrame(() => {
        toast.classList.add('is-visible');
      });

      // Auto dismiss timer
      const timeoutId = setTimeout(() => {
        this.dismiss(toast);
      }, duration);

      toast.addEventListener('click', () => {
        clearTimeout(timeoutId);
        this.dismiss(toast);
      });

      return toast;
    },

    dismiss(toastElement) {
      if (!toastElement || !toastElement.parentElement) return;

      if (isReducedMotion()) {
        toastElement.remove();
        return;
      }

      toastElement.classList.remove('is-visible');
      toastElement.classList.add('is-hiding');

      setTimeout(() => {
        if (toastElement.parentElement) {
          toastElement.remove();
        }
      }, MOTION_CONFIG.durations.fast);
    }
  };

  /**
   * Initializes subtle header scroll transformation.
   */
  function initHeaderScroll(headerSelector = '.site-header', threshold = 20) {
    const header = document.querySelector(headerSelector);
    if (!header) return;

    let ticking = false;
    const updateHeader = () => {
      if (window.scrollY > threshold) {
        header.classList.add('is-scrolled');
      } else {
        header.classList.remove('is-scrolled');
      }
      ticking = false;
    };

    window.addEventListener('scroll', () => {
      if (!ticking) {
        window.requestAnimationFrame(updateHeader);
        ticking = true;
      }
    }, { passive: true });

    // Initial check
    updateHeader();
  }

  /**
   * Triggers subtle page entrance animation on main or designated container.
   */
  function initPageEntrance(targetSelector = 'main') {
    const target = document.querySelector(targetSelector);
    if (!target) return;

    if (isReducedMotion()) {
      target.style.opacity = '1';
      target.style.transform = 'none';
      return;
    }

    target.classList.add('page-entrance');
  }

  // Export to global window object
  window.ZdexMotion = {
    isReducedMotion,
    initScrollReveal,
    initHeaderScroll,
    initPageEntrance,
    modal: ModalController,
    toast: ToastManager,
    config: MOTION_CONFIG
  };

  // Auto-init on DOM ready
  const onReady = () => {
    initHeaderScroll();
    initPageEntrance();
    initScrollReveal();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }

})(window, document);

