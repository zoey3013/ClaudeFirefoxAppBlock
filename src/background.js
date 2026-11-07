/* global Anchor, I18n, Holidays */
'use strict';

/*
 * Background event page.
 * - Tracks time on the active tab of the focused window (pooled per group, per hour bucket).
 * - Redirects blocked navigations to the block page. Pages already open when a block starts get
 *   the lock overlay instead (so a break doesn't reload them), or a redirect where it can't run.
 * - Handles temporary bypasses requested from the UI.
 * - Answers on-page reminder status requests from the content script.
 * - Downloads public holidays for the chosen country and keeps a copy in state.
 *
 * Settings are written by the UI pages; the background only writes `state`.
 */

const BLOCK_PAGE = browser.runtime.getURL('src/blocked/blocked.html');
const MAX_SLICE_MS = 2 * 60 * 1000; // never credit more than this between two ticks
const IDLE_SECONDS = 10 * 60;

// ---------- Storage ----------

async function load() {
  const { settings, state } = await browser.storage.local.get(['settings', 'state']);
  return { settings: Anchor.normalizeSettings(settings), state: Anchor.normalizeState(state) };
}

const saveState = (state) => browser.storage.local.set({ state });

// Serialize anything that reads-modifies-writes state.
let chain = Promise.resolve();
function serial(fn) {
  const p = chain.then(() => fn());
  chain = p.catch((e) => console.error('[anchor]', e));
  return p;
}

// ---------- Tracking ----------

async function focusedActiveTab() {
  const win = await browser.windows.getLastFocused().catch(() => null);
  if (!win || !win.focused) return null;
  const [tab] = await browser.tabs.query({ active: true, windowId: win.id });
  return tab && Anchor.isTrackable(tab.url) ? tab : null;
}

/** Credit time since the last tick, then start a new slice on whatever is active now. */
async function flush(settings, state, now) {
  const { active } = await browser.storage.session.get('active');
  let changed = false;
  // Time on a page that's already blocked (behind the lock overlay) doesn't count.
  if (active && now > active.start && !Anchor.evaluateUrl(active.url, settings, state, now).blocker) {
    const start = Math.max(active.start, now - MAX_SLICE_MS);
    Anchor.recordUsage(settings, state, active.url, start, now);
    changed = true;
  }
  // Ask every time: idle events can be missed while this event page is suspended.
  const idle = (await browser.idle.queryState(IDLE_SECONDS)) !== 'active';
  const tab = idle ? null : await focusedActiveTab();
  await browser.storage.session.set({ active: tab ? { url: tab.url, start: now } : null });
  return { changed, tab };
}

// ---------- Enforcement ----------

function blockUrl(url, groupId) {
  return `${BLOCK_PAGE}?${new URLSearchParams({ url, g: groupId })}`;
}

function countBlock(state, groupId, now) {
  const dk = Anchor.dayKey(now);
  const day = (state.blocks[dk] = state.blocks[dk] || {});
  day[groupId] = (day[groupId] || 0) + 1;
}

/**
 * Block open tabs that should be blocked, and lift overlays that no longer should be.
 * Tabs showing the overlay are kept in session storage: { [tabId]: groupId }.
 */
async function enforceAll(settings, state, now) {
  const tabs = await browser.tabs.query({});
  const { locked = {} } = await browser.storage.session.get('locked');
  let changed = false;
  for (const tab of tabs) {
    const wasLocked = tab.id in locked;
    const blocker = Anchor.isTrackable(tab.url) ? Anchor.evaluateUrl(tab.url, settings, state, now).blocker : null;
    if (!blocker) {
      if (wasLocked) {
        delete locked[tab.id];
        browser.tabs.sendMessage(tab.id, { type: 'unlock' }, { frameId: 0 }).catch(() => {});
      }
      continue;
    }
    if (wasLocked) continue;
    countBlock(state, blocker.group.id, now);
    changed = true;
    locked[tab.id] = blocker.group.id;
    lockTab(tab, blocker.group.id);
  }
  await browser.storage.session.set({ locked });
  return changed;
}

/** Cover the page with the lock overlay; if the page can't show it, go to the block page. */
function lockTab(tab, groupId) {
  const redirect = async () => {
    const { locked = {} } = await browser.storage.session.get('locked');
    delete locked[tab.id];
    await browser.storage.session.set({ locked });
    browser.tabs.update(tab.id, { url: blockUrl(tab.url, groupId) }).catch(() => {});
  };
  browser.tabs.sendMessage(tab.id, { type: 'lock', groupId }, { frameId: 0 })
    .then((res) => { if (!res || !res.locked) redirect(); }, redirect);
}

/** Wake up exactly when something can change: allowance runs out, bypass ends, schedule flips. */
async function scheduleNextCheck(settings, state, now, tab) {
  const times = [];
  for (const g of settings.groups) {
    if (!g.enabled) continue;
    const bp = state.bypass[g.id];
    if (bp && bp.until > now) times.push(bp.until);
    const flip = Anchor.nextScheduleChange(g.schedule, now);
    if (flip) times.push(flip);
  }
  if (tab) {
    for (const m of Anchor.evaluateUrl(tab.url, settings, state, now).matches) {
      if (m.enabled && m.remaining > 0) times.push(now + m.remaining * 1000);
    }
  }
  const next = Math.min(...times.filter((t) => t > now));
  if (Number.isFinite(next)) browser.alarms.create('check', { when: next + 500 });
  else browser.alarms.clear('check');
}

async function updateBadge(settings, state, now, tab) {
  let text = '';
  if (tab) {
    const live = Anchor.evaluateUrl(tab.url, settings, state, now).matches
      .filter((m) => m.enabled && m.remaining !== null && !m.reason);
    if (live.length) {
      const min = Math.min(...live.map((m) => m.remaining));
      text = min >= 60 ? `${Math.floor(min / 60)}m` : '<1m';
    }
  }
  await browser.action.setBadgeText({ text });
  await browser.action.setBadgeBackgroundColor({ color: '#2a78d6' });
}

function tick() {
  return serial(async () => {
    const now = Date.now();
    const { settings, state } = await load();
    const { changed: tracked, tab } = await flush(settings, state, now);
    const blocked = await enforceAll(settings, state, now);
    if (tracked || blocked) {
      Anchor.pruneState(state, settings, now);
      await saveState(state);
    }
    await scheduleNextCheck(settings, state, now, tab);
    await updateBadge(settings, state, now, tab);
  });
}

// ---------- Navigation blocking ----------

browser.webRequest.onBeforeRequest.addListener(
  (details) =>
    serial(async () => {
      const now = Date.now();
      const { settings, state } = await load();
      const { blocker } = Anchor.evaluateUrl(details.url, settings, state, now);
      if (!blocker) return {};
      countBlock(state, blocker.group.id, now);
      await saveState(state);
      return { redirectUrl: blockUrl(details.url, blocker.group.id) };
    }),
  { urls: ['<all_urls>'], types: ['main_frame'] },
  ['blocking'],
);

// ---------- Holidays ----------

const HOLIDAYS_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // download again once a month

/** Checked daily and at startup: download only when there's no copy or it's a month old. */
async function maybeRefreshHolidays() {
  const { settings: raw, state: rawState } = await browser.storage.local.get(['settings', 'state']);
  const country = Anchor.normalizeSettings(raw).country;
  const h = Anchor.normalizeState(rawState).holidays;
  const stale = !h || h.country !== country || Date.now() - (h.fetchedAt || 0) > HOLIDAYS_MAX_AGE_MS;
  // After a failed download, wait a day before trying again (this runs about daily).
  const justFailed = h && h.country === country && Date.now() - (h.failedAt || 0) < 20 * 60 * 60 * 1000;
  if ((country === 'none' && h) || (Holidays.COUNTRIES[country] && stale && !justFailed)) return refreshHolidays();
  return { ok: true };
}

/** Download the chosen country's holidays. On failure, keep the copy we have. */
async function refreshHolidays() {
  const { settings: raw } = await browser.storage.local.get('settings');
  const country = Anchor.normalizeSettings(raw).country;
  const source = Holidays.COUNTRIES[country];
  let days = null;
  if (source) {
    try {
      const res = await fetch(source.url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      days = Holidays.parse(country, await res.json());
      if (!days.length) throw new Error('empty list');
    } catch (e) {
      console.warn('[anchor] holidays:', e.message);
      days = null;
    }
  }
  return serial(async () => {
    const { state } = await load();
    const now = Date.now();
    if (!source) state.holidays = null;
    else if (days) {
      const since = `${new Date(now).getFullYear() - 1}-01-01`;
      state.holidays = { country, fetchedAt: now, failedAt: 0, days: days.filter((d) => d.date >= since) };
    } else {
      const keep = state.holidays && state.holidays.country === country ? state.holidays : { country, fetchedAt: 0, days: [] };
      state.holidays = { ...keep, failedAt: now };
    }
    await saveState(state);
    return { ok: !source || !!days };
  }).then((r) => (tick(), r));
}

// ---------- Messages from UI ----------

async function handleBypass(groupId) {
  return serial(async () => {
    const now = Date.now();
    const { settings, state } = await load();
    const group = settings.groups.find((g) => g.id === groupId);
    // Errors are i18n keys; the page that asked translates them.
    if (!group || !group.bypass.enabled) return { ok: false, error: 'errBypassOff' };
    if (Anchor.bypassUsesLeft(group, state, now) <= 0) return { ok: false, error: 'errNoBreaks' };
    const bp = (state.bypass[groupId] = state.bypass[groupId] || { until: 0, uses: [] });
    bp.until = now + group.bypass.minutes * 60000;
    bp.uses.push(now);
    await saveState(state);
    return { ok: true, until: bp.until };
  });
}

async function handleEndBypass(groupId) {
  return serial(async () => {
    const { state } = await load();
    if (state.bypass[groupId]) state.bypass[groupId].until = 0;
    await saveState(state);
    return { ok: true };
  });
}

/** Next time the schedule starts blocking, if the group works then (not a day off). */
function scheduleStartWhileActive(group, state, now) {
  const at = Anchor.nextScheduleChange(group.schedule, now);
  return at && Anchor.activeOn(group, state, at).active ? at : null;
}

/** What the on-page reminder needs to know about the page it runs on. */
async function pageStatus(url) {
  const now = Date.now();
  const { settings, state } = await load();
  const { active } = await browser.storage.session.get('active');
  // Include the slice still in progress, so a countdown starts from the true remaining time.
  const pending = active && active.url === url ? Math.min(now - active.start, MAX_SLICE_MS) / 1000 : 0;
  const { matches } = Anchor.evaluateUrl(url, settings, state, now);
  return {
    now,
    language: settings.language,
    theme: settings.theme,
    groups: matches.filter((m) => m.enabled && !m.blocked).map((m) => ({
      id: m.group.id,
      name: m.group.name,
      color: m.group.color,
      reminders: m.group.reminders,
      period: m.group.limit.period,
      remaining: m.remaining === null ? null : Math.max(0, m.remaining - Math.max(0, pending)),
      bypassUntil: m.bypassUntil,
      blockedAfterBreak: !!m.reason,
      scheduleStart: m.reason ? null : scheduleStartWhileActive(m.group, state, now),
    })),
  };
}

browser.runtime.onMessage.addListener((msg, sender) => {
  switch (msg && msg.type) {
    case 'unlockTab': // "Continue" in the overlay; lifted only if the page isn't blocked any more
      // Reply at once: the overlay asking for this is removed by the tick.
      tick();
      return Promise.resolve({ ok: true });
    case 'closeTab':
      return sender.tab ? browser.tabs.remove(sender.tab.id) : undefined;
    case 'pageStatus':
      return pageStatus(msg.url);
    case 'bypass':
      return handleBypass(msg.groupId).then((r) => (tick(), r));
    case 'endBypass':
      return handleEndBypass(msg.groupId).then((r) => (tick(), r));
    case 'tick':
      return tick().then(() => ({ ok: true }));
    case 'refreshHolidays':
      return refreshHolidays();
    default:
      return undefined;
  }
});

// ---------- Wiring ----------

browser.tabs.onActivated.addListener(() => tick());
browser.tabs.onUpdated.addListener(async (tabId) => {
  // A new address may not be blocked, or may be a new page without the overlay: re-check it.
  const { locked = {} } = await browser.storage.session.get('locked');
  if (tabId in locked) {
    delete locked[tabId];
    await browser.storage.session.set({ locked });
  }
  tick();
  // Single-page sites change URL without reloading; let the on-page reminder re-check.
  browser.tabs.sendMessage(tabId, { type: 'recheck' }).catch(() => {});
}, { properties: ['url'] });
browser.tabs.onRemoved.addListener(async (tabId) => {
  const { locked = {} } = await browser.storage.session.get('locked');
  if (tabId in locked) {
    delete locked[tabId];
    await browser.storage.session.set({ locked });
  }
});
browser.windows.onFocusChanged.addListener(() => tick());
browser.alarms.onAlarm.addListener((alarm) => (alarm.name === 'holidays' ? maybeRefreshHolidays() : tick()));

browser.idle.setDetectionInterval(IDLE_SECONDS);
browser.idle.onStateChanged.addListener(() => tick());

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const before = changes.settings.oldValue && changes.settings.oldValue.country;
  const after = changes.settings.newValue && changes.settings.newValue.country;
  if (before !== after) refreshHolidays();
  else tick();
});

function setup() {
  browser.alarms.create('tick', { periodInMinutes: 1 });
  browser.alarms.create('holidays', { periodInMinutes: 24 * 60 });
  maybeRefreshHolidays();
  tick();
}

browser.runtime.onStartup.addListener(setup);
browser.runtime.onInstalled.addListener(async ({ reason }) => {
  const { settings } = await browser.storage.local.get('settings');
  I18n.setLanguage('auto'); // default group names follow the Firefox language
  if (!settings) await browser.storage.local.set({ settings: Anchor.defaultSettings() });
  setup();
  if (reason === 'install') browser.runtime.openOptionsPage();
});
