/*
 * main.js
 * -------
 * Page behaviour for the FundExecs landing page. Vanilla JS, no framework.
 *
 * Responsibilities:
 *   - Sticky nav: add a blurred/elevated style once the user scrolls.
 *   - Smooth-scroll for in-page anchor CTAs (e.g. "See How It Works").
 *   - Live Activity ticker: load data, render the marquee + "view all" grid,
 *     handle the expand toggle, and respect prefers-reduced-motion.
 *   - "Ask Earnest" launcher: open/close a placeholder chat panel.
 *   - Footer year.
 *
 * Depends on:
 *   - window.getChainOfTrustActivity()  (from activity.js)
 *
 * Heavily commented so copy/behaviour is easy to tweak.
 */

(function () {
  'use strict';

  // Small util: does the visitor prefer reduced motion?
  const prefersReducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)'
  ).matches;

  // Path to the mascot coin (used for ticker pill icons + spinner).
  const COIN_SRC = './assets/earn_coin.png';

  // Run once the DOM is ready.
  document.addEventListener('DOMContentLoaded', init);

  function init() {
    setFooterYear();
    initStickyNav();
    initSmoothScroll();
    initActivity();
    initAskEarnest();
  }

  // ---------------------------------------------------------------------------
  // FOOTER YEAR
  // ---------------------------------------------------------------------------
  function setFooterYear() {
    const el = document.getElementById('year');
    if (el) el.textContent = String(new Date().getFullYear());
  }

  // ---------------------------------------------------------------------------
  // STICKY NAV — subtle blur/elevation after scrolling a little.
  // ---------------------------------------------------------------------------
  function initStickyNav() {
    const nav = document.getElementById('nav');
    if (!nav) return;
    const onScroll = () => {
      if (window.scrollY > 12) {
        nav.classList.add('nav-scrolled');
      } else {
        nav.classList.remove('nav-scrolled');
      }
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // ---------------------------------------------------------------------------
  // SMOOTH SCROLL — for any <a href="#..."> with data-scroll.
  // ---------------------------------------------------------------------------
  function initSmoothScroll() {
    document.querySelectorAll('a[data-scroll][href^="#"]').forEach((a) => {
      a.addEventListener('click', (e) => {
        const id = a.getAttribute('href').slice(1);
        const target = document.getElementById(id);
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({
          behavior: prefersReducedMotion ? 'auto' : 'smooth',
          block: 'start'
        });
      });
    });
  }

  // ---------------------------------------------------------------------------
  // LIVE ACTIVITY TICKER
  // ---------------------------------------------------------------------------
  async function initActivity() {
    const track = document.getElementById('ticker-track');
    const spinner = document.getElementById('ticker-spinner');
    const grid = document.getElementById('activity-grid');
    const toggle = document.getElementById('activity-toggle');
    const toggleLabel = document.getElementById('activity-toggle-label');
    if (!track) return;

    let entries = [];
    try {
      entries =
        typeof window.getChainOfTrustActivity === 'function'
          ? await window.getChainOfTrustActivity()
          : [];
    } catch (_) {
      entries = [];
    }

    // Hide the coin spinner now that loading is done.
    if (spinner) spinner.remove();

    if (!entries.length) {
      track.innerHTML =
        '<span class="text-sm text-ink-300/70 px-4">Activity is loading shortly…</span>';
      if (toggle) toggle.style.display = 'none';
      return;
    }

    // --- Marquee row ---------------------------------------------------------
    // Build the pills once.
    const pillsHtml = entries.map(pillHtml).join('');

    if (prefersReducedMotion) {
      // No auto-scroll: render a single, statically wrapping row.
      track.classList.remove('marquee-animate');
      track.innerHTML = pillsHtml;
    } else {
      // Duplicate the content so the CSS marquee can loop seamlessly.
      // aria-hidden on the duplicate so screen readers don't read it twice.
      track.classList.add('marquee-animate');
      track.innerHTML =
        '<div class="marquee-group">' +
        pillsHtml +
        '</div>' +
        '<div class="marquee-group" aria-hidden="true">' +
        pillsHtml +
        '</div>';
    }

    // --- "View all" grid -----------------------------------------------------
    if (grid) {
      grid.innerHTML = entries.map(cardHtml).join('');
    }

    if (toggle && grid) {
      toggle.addEventListener('click', () => {
        const open = grid.hasAttribute('hidden');
        if (open) {
          grid.removeAttribute('hidden');
        } else {
          grid.setAttribute('hidden', '');
        }
        toggle.setAttribute('aria-expanded', String(open));
        if (toggleLabel) {
          toggleLabel.textContent = open ? 'Hide activity' : 'View all activity';
        }
      });
    }
  }

  /** Escape a string for safe HTML interpolation. */
  function esc(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;'
        })[c]
    );
  }

  /** A small coin <img> used inside pills/cards. */
  function coinImg(size) {
    return (
      '<img src="' +
      COIN_SRC +
      '" alt="" aria-hidden="true" width="' +
      size +
      '" height="' +
      size +
      '" class="inline-block shrink-0 rounded-full" />'
    );
  }

  /** Marquee pill markup for a single entry. */
  function pillHtml(e) {
    return (
      '<span class="ticker-pill">' +
      coinImg(18) +
      '<span class="font-medium text-offwhite">' +
      esc(e.initials) +
      '</span>' +
      sep() +
      span(e.role) +
      sep() +
      span(e.region) +
      sep() +
      '<span class="text-gold">' +
      esc(e.type) +
      '</span>' +
      sep() +
      '<span class="font-semibold text-offwhite">' +
      esc(e.value) +
      '</span>' +
      sep() +
      '<span class="text-ink-300/70">' +
      esc(e.date) +
      '</span>' +
      '</span>'
    );

    function sep() {
      return '<span class="text-ink-300/40" aria-hidden="true">·</span>';
    }
    function span(t) {
      return '<span class="text-ink-300/90">' + esc(t) + '</span>';
    }
  }

  /** Grid card markup for a single entry (used in "view all"). */
  function cardHtml(e) {
    return (
      '<div class="activity-card">' +
      '<div class="flex items-center gap-2 mb-2">' +
      coinImg(20) +
      '<span class="font-semibold text-offwhite">' +
      esc(e.initials) +
      '</span>' +
      '<span class="ml-auto text-xs text-ink-300/60">' +
      esc(e.date) +
      '</span>' +
      '</div>' +
      '<div class="text-sm text-gold font-medium">' +
      esc(e.type) +
      ' · ' +
      esc(e.value) +
      '</div>' +
      '<div class="text-xs text-ink-300/80 mt-1">' +
      esc(e.role) +
      ' · ' +
      esc(e.region) +
      '</div>' +
      '</div>'
    );
  }

  // ---------------------------------------------------------------------------
  // ASK EARNEST — placeholder chat launcher + panel.
  // ---------------------------------------------------------------------------
  function initAskEarnest() {
    const launcher = document.getElementById('earnest-launcher');
    const panel = document.getElementById('earnest-panel');
    const closeBtn = document.getElementById('earnest-close');
    const form = document.getElementById('earnest-form');
    const input = document.getElementById('earnest-input');
    const log = document.getElementById('earnest-log');
    if (!launcher || !panel) return;

    const open = () => {
      panel.removeAttribute('hidden');
      launcher.setAttribute('aria-expanded', 'true');
      // Focus the input for keyboard users.
      if (input) setTimeout(() => input.focus(), 0);
    };
    const close = () => {
      panel.setAttribute('hidden', '');
      launcher.setAttribute('aria-expanded', 'false');
      launcher.focus();
    };

    launcher.addEventListener('click', () => {
      if (panel.hasAttribute('hidden')) open();
      else close();
    });
    if (closeBtn) closeBtn.addEventListener('click', close);

    // Close on Escape for accessibility.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !panel.hasAttribute('hidden')) close();
    });

    // Placeholder send handler — echoes a stoic canned reply.
    if (form && input && log) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        appendMessage(log, 'you', text);
        input.value = '';

        // TODO(earnest-backend): wire this to the live Earnest copilot.
        // Replace the canned reply below with a call to your chat endpoint,
        // e.g. POST /api/earnest { message: text } and stream the response.
        setTimeout(() => {
          appendMessage(
            log,
            'earnest',
            'Understood. I am Earnest — I will route this to the right copilot. Full conversations open inside the FundExecs platform.'
          );
          log.scrollTop = log.scrollHeight;
        }, 350);

        log.scrollTop = log.scrollHeight;
      });
    }
  }

  function appendMessage(log, who, text) {
    const row = document.createElement('div');
    row.className =
      who === 'you' ? 'earnest-msg earnest-msg-you' : 'earnest-msg earnest-msg-bot';
    row.textContent = text;
    log.appendChild(row);
  }
})();
