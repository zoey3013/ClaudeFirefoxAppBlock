/* global Anchor, I18n */
'use strict';

/*
 * On-page parts of Anchor for sites in a focus group:
 * - a small card when the page opens (time left, break, or when it will be blocked);
 * - a countdown pill in the last 30 seconds before the site gets blocked;
 * - the lock overlay: when an open page gets blocked, the background asks us to cover it
 *   instead of navigating away, so a break can lift the lock without reloading the page.
 */
(() => {
  if (window.top !== window || !Anchor.isTrackable(location.href)) return;

  const BLOCK_PAGE = browser.runtime.getURL('src/blocked/blocked.html');
  const LOCK_READY_MS = 3000;
  const CARD_MS = 8000;
  const COUNTDOWN_FROM = 30;
  const RESYNC_MS = 20000;

  let root = null;
  let card = null;
  let pill = null;
  let status = null;
  let syncedAt = 0;
  let activeLeft = Infinity; // seconds of allowance left, only drains while this tab is in use
  let lastUrl = '';
  let cardTimer = null;
  let lock = null; // { el, frame, groupId, paused: [media], overflow, guard }

  const make = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    n.append(...kids);
    return n;
  };

  function ensureRoot() {
    if (!root || !root.isConnected) {
      root = make('anchor-focus-root');
      document.documentElement.append(root);
      applyTheme();
    }
    return root;
  }

  function applyTheme() {
    if (!root || !status) return;
    if (status.theme === 'light' || status.theme === 'dark') root.setAttribute('data-theme', status.theme);
    else root.removeAttribute('data-theme');
  }

  const inUse = () => document.visibilityState === 'visible' && document.hasFocus();
  const perWord = (p) => I18n.t(p === 'hour' ? 'perHour' : 'perToday');

  // ---------- Reminder card ----------

  function cardText(g, now) {
    if (g.bypassUntil) return I18n.t('cardBreak', { time: Anchor.formatClock(g.bypassUntil) });
    if (g.remaining !== null) return I18n.t('cardCounting', { d: Anchor.formatDuration(g.remaining), per: perWord(g.period) });
    if (g.scheduleStart) return I18n.t('cardScheduled', { when: Anchor.formatAt(g.scheduleStart, now) });
    return I18n.t('cardMember');
  }

  function hideCard() {
    clearTimeout(cardTimer);
    if (!card) return;
    const c = card;
    card = null;
    c.setAttribute('data-leaving', '');
    setTimeout(() => c.remove(), 300);
  }

  function showCard() {
    const groups = status.groups.filter((g) => g.reminders.card);
    if (!groups.length) return;
    hideCard();
    const now = Date.now();
    const close = make('anchor-focus-close', { role: 'button', tabindex: '0', 'aria-label': I18n.t('dismiss'), title: I18n.t('dismiss') }, '×');
    close.addEventListener('click', hideCard);
    close.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') hideCard(); });
    const g = groups[0];
    const c = make('anchor-focus-card', { role: 'status' },
      make('anchor-focus-head', {},
        make('anchor-focus-dot', { style: `background:${g.color} !important` }),
        make('anchor-focus-title', {}, `Anchor · ${groups.map((x) => x.name).join(', ')}`),
        close),
      make('anchor-focus-text', {}, cardText(g, now)));
    // Stay while hovered, fade a moment after the pointer leaves.
    c.addEventListener('mouseenter', () => clearTimeout(cardTimer));
    c.addEventListener('mouseleave', () => { cardTimer = setTimeout(hideCard, 2500); });
    ensureRoot().append(c);
    card = c;
    cardTimer = setTimeout(hideCard, CARD_MS);
  }

  // ---------- Countdown ----------

  /** Seconds until this page gets blocked, or Infinity. */
  function secondsLeft(now) {
    let left = Infinity;
    for (const g of status.groups) {
      if (!g.reminders.countdown) continue;
      if (g.bypassUntil) {
        const breakLeft = (g.bypassUntil - now) / 1000;
        // A break only ends in a block if the group would block by then.
        if (g.blockedAfterBreak || (g.remaining !== null && activeLeft <= breakLeft)) left = Math.min(left, breakLeft);
        continue;
      }
      if (g.remaining !== null) left = Math.min(left, activeLeft);
      if (g.scheduleStart) left = Math.min(left, (g.scheduleStart - now) / 1000);
    }
    return left;
  }

  function renderCountdown(left) {
    if (!(left > 0 && left <= COUNTDOWN_FROM)) {
      if (pill) { pill.remove(); pill = null; }
      return;
    }
    if (!pill) {
      hideCard();
      pill = make('anchor-focus-countdown', { role: 'timer', 'aria-live': 'off' },
        make('anchor-focus-dot'), make('anchor-focus-text'), make('anchor-focus-time'));
      ensureRoot().append(pill);
    }
    const g = status.groups.find((x) => x.reminders.countdown) || status.groups[0];
    const s = Math.ceil(left);
    pill.querySelector('anchor-focus-dot').setAttribute('style', `background:${g.color} !important`);
    pill.querySelector('anchor-focus-text').textContent = I18n.t('countdownLabel');
    pill.querySelector('anchor-focus-time').textContent = `0:${String(s).padStart(2, '0')}`;
    if (s <= 10) pill.setAttribute('data-urgent', ''); else pill.removeAttribute('data-urgent');
  }

  // ---------- Lock overlay ----------

  // While locked, the page underneath keeps its state but gets no keys and can't play media.
  const swallowKey = (e) => { if (lock) { e.stopImmediatePropagation(); e.preventDefault(); } };
  const stopPlayback = (e) => { if (lock && e.target instanceof HTMLMediaElement) e.target.pause(); };

  function pauseMedia() {
    const paused = [];
    for (const m of document.querySelectorAll('video, audio')) {
      if (!m.paused) { m.pause(); paused.push(m); }
    }
    return paused;
  }

  function lockPage(groupId) {
    if (lock) return Promise.resolve({ locked: true, already: true });
    hideCard();
    if (pill) { pill.remove(); pill = null; }
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});

    const params = new URLSearchParams({ url: location.href, g: groupId, embedded: '1' });
    const frame = make('iframe', { src: `${BLOCK_PAGE}?${params}`, title: 'Anchor', allow: '' });
    const el = make('anchor-focus-lock', {}, frame);
    const html = document.documentElement;
    lock = {
      el, frame, groupId,
      paused: pauseMedia(),
      overflow: [html.style.getPropertyValue('overflow'), html.style.getPropertyPriority('overflow')],
      // Put the overlay back if the page removes it.
      guard: new MutationObserver(() => { if (lock && !el.isConnected) html.append(el); }),
    };
    html.style.setProperty('overflow', 'hidden', 'important');
    html.append(el);
    lock.guard.observe(html, { childList: true });
    frame.focus();

    // The block page says hello once it loads. If a page's security policy stops it from
    // loading, give up and let the background send the tab to the block page instead.
    return new Promise((resolve) => {
      const timer = setTimeout(() => { window.removeEventListener('message', onReady); unlockPage(false); resolve({ locked: false }); }, LOCK_READY_MS);
      function onReady(e) {
        if (e.source !== frame.contentWindow || !e.data || e.data.anchor !== 'lock-ready') return;
        clearTimeout(timer);
        window.removeEventListener('message', onReady);
        resolve({ locked: true });
      }
      window.addEventListener('message', onReady);
    });
  }

  function unlockPage(resume = true) {
    if (!lock) return { unlocked: false };
    const { el, paused, overflow, guard } = lock;
    lock = null;
    guard.disconnect();
    el.remove();
    const html = document.documentElement;
    if (overflow[0]) html.style.setProperty('overflow', overflow[0], overflow[1]);
    else html.style.removeProperty('overflow');
    if (resume) for (const m of paused) m.play().catch(() => {});
    sync(false);
    return { unlocked: true };
  }

  for (const type of ['keydown', 'keypress', 'keyup']) window.addEventListener(type, swallowKey, true);
  document.addEventListener('play', stopPlayback, true);

  // ---------- Sync ----------

  async function sync(fresh) {
    let res;
    try {
      res = await browser.runtime.sendMessage({ type: 'pageStatus', url: location.href });
    } catch {
      return; // extension reloading, or the page is going away
    }
    if (!res) return;
    I18n.setLanguage(res.language);
    status = res;
    applyTheme();
    syncedAt = Date.now();
    const limited = res.groups.filter((g) => g.remaining !== null).map((g) => g.remaining);
    activeLeft = limited.length ? Math.min(...limited) : Infinity;
    if (lock) return;
    if (fresh) showCard();
    renderCountdown(secondsLeft(Date.now()));
  }

  function onUrlMaybeChanged() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    sync(true);
  }

  let lastTick = Date.now();
  setInterval(() => {
    const now = Date.now();
    if (status && inUse() && activeLeft !== Infinity) activeLeft -= (now - lastTick) / 1000;
    lastTick = now;
    if (!status) return;
    if (now - syncedAt > RESYNC_MS) sync(false);
    if (!lock) renderCountdown(secondsLeft(now));
  }, 1000);

  browser.runtime.onMessage.addListener((msg) => {
    if (!msg) return undefined;
    if (msg.type === 'recheck') onUrlMaybeChanged();
    if (msg.type === 'lock') return lockPage(msg.groupId);
    if (msg.type === 'unlock') return Promise.resolve(unlockPage());
    return undefined;
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(false); });

  onUrlMaybeChanged();
})();
