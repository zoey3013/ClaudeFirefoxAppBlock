'use strict';

/*
 * Light / dark theme for Anchor's own pages. Loaded in <head>, so the last
 * choice (cached in localStorage) applies before the first paint; pages call
 * Theme.apply(settings.theme) once settings load. 'auto' follows the system.
 */
const Theme = (() => {
  const KEY = 'anchor-theme';

  function set(pref) {
    const root = document.documentElement;
    if (pref === 'light' || pref === 'dark') root.dataset.theme = pref;
    else delete root.dataset.theme;
  }

  try { set(localStorage.getItem(KEY)); } catch { /* storage unavailable: follow the system */ }

  function apply(pref) {
    set(pref);
    try { localStorage.setItem(KEY, pref || 'auto'); } catch { /* ignore */ }
  }

  return { apply };
})();
