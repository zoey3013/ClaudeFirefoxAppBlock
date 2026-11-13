/* global Anchor, I18n, Holidays */
'use strict';

/*
 * Background event page.
 * - Tracks time on the active tab of the focused window (pooled per group, per hour bucket).
 * - Redirects blocked navigations to the block page. Pages already open when a block starts get
 *   the lock overlay instead (so a break doesn't reload them), or a redirect where it can't run.
 * - Handles temporary bypasses requested from the UI.
 * - Alert mode: counts each tab's time in a row on a group's sites (a "visit") and, when it's
 *   due, shows the alert screen; handles the answer (dismiss, remind me, lock for).
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
async function flush(settings, state, now, visits) {
  const { active } = await browser.storage.session.get('active');
  let changed = false;
  // Time on a page that's already blocked (behind the lock overlay) doesn't count.
  if (active && now > active.start && !Anchor.evaluateUrl(active.url, settings, state, now).blocker) {
    const start = Math.max(active.start, now - MAX_SLICE_MS);
    Anchor.recordUsage(settings, state, active.url, start, now);
    if (active.tabId != null) creditVisits(settings, state, visits, active, start, now);
    changed = true;
  }
  // Ask every time: idle events can be missed while this event page is suspended.
  const idle = (await browser.idle.queryState(IDLE_SECONDS)) !== 'active';
  const tab = idle ? null : await focusedActiveTab();
  await browser.storage.session.set({ active: tab ? { url: tab.url, tabId: tab.id, start: now } : null });
  return { changed, tab };
}

// ---------- Alert mode ----------

/** Alert groups that are active for this URL right now (not resting, not locked). */
function alertGroupsFor(url, settings, state, now) {
  return Anchor.evaluateUrl(url, settings, state, now).matches
    .filter((m) => m.enabled && m.behavior === 'alert' && !m.off && !m.reason)
    .map((m) => m.group);
}

/** Add a used slice to this tab's visits. visits: { [tabId]: { [groupId]: { secs, askAt, dismissed, asking } } } */
function creditVisits(settings, state, visits, active, start, now) {
  const secs = (now - start) / 1000;
  for (const g of alertGroupsFor(active.url, settings, state, start)) {
    const tabVisits = (visits[active.tabId] = visits[active.tabId] || {});
    const v = (tabVisits[g.id] = tabVisits[g.id] || { secs: 0, askAt: g.alert.every * 60, dismissed: false, asking: false });
    v.secs += secs;
  }
}

/** A visit ends when the tab leaves the group's sites, the tab closes, or the group stops alerting. */
function pruneVisits(settings, visits, tabs) {
  const urls = new Map(tabs.map((t) => [String(t.id), t.url]));
  for (const tabId of Object.keys(visits)) {
    const url = urls.get(tabId);
    for (const gid of Object.keys(visits[tabId])) {
      const g = settings.groups.find((x) => x.id === gid);
      if (!url || !g || !g.enabled || g.behavior !== 'alert' || !Anchor.groupMatches(g, url)) delete visits[tabId][gid];
    }
    if (!Object.keys(visits[tabId]).length) delete visits[tabId];
  }
}

function countAlert(state, groupId, what, now) {
  const dk = Anchor.dayKey(now);
  const day = (state.alerts[dk] = state.alerts[dk] || {});
  const g = (day[groupId] = day[groupId] || { shown: 0, dismiss: 0, remind: 0, lock: 0 });
  g[what] = (g[what] || 0) + 1;
}

/** Show the alert on the tab you're using once a visit reaches its time. */
function maybeAsk(settings, state, now, tab, visits, locked) {
  if (!tab || locked[tab.id]) return false;
  const active = new Set(alertGroupsFor(tab.url, settings, state, now).map((g) => g.id));
  for (const [gid, v] of Object.entries(visits[tab.id] || {})) {
    // (Not v.asking: that's only true while this tab shows the alert, and then locked[] is set.)
    if (!active.has(gid) || v.dismissed || v.secs < v.askAt) continue;
    v.asking = true;
    locked[tab.id] = { g: gid, kind: 'alert' };
    countAlert(state, gid, 'shown', now);
    lockTab(tab, gid, 'alert', { m: Math.max(1, Math.round(v.secs / 60)) });
    return true;
  }
  return false;
}

/** The answer on the alert screen. */
function answerAlert(tabId, groupId, choice, minutes) {
  return serial(async () => {
    const now = Date.now();
    const { settings, state } = await load();
    const { visits = {}, locked = {} } = await browser.storage.session.get(['visits', 'locked']);
    const group = settings.groups.find((g) => g.id === groupId);
    const v = visits[tabId] && visits[tabId][groupId];
    const mins = Math.min(240, Math.max(1, Number(minutes) || 5));
    if (!group) return;
    countAlert(state, groupId, choice, now);
    if (locked[tabId] && locked[tabId].kind === 'alert') delete locked[tabId];
    if (choice === 'lock') {
      state.alertLock[groupId] = now + mins * 60000;
      for (const tv of Object.values(visits)) delete tv[groupId]; // a fresh visit starts after the lock
    } else {
      if (v && choice === 'dismiss') v.dismissed = true;
      if (v && choice === 'remind') v.askAt = v.secs + mins * 60;
      if (v) v.asking = false;
      browser.tabs.sendMessage(tabId, { type: 'unlock' }, { frameId: 0 }).catch(() => {});
    }
    await browser.storage.session.set({ visits, locked });
    await saveState(state);
  }).then(() => tick());
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
 * Block open tabs that should be blocked, and lift block overlays that no longer should be.
 * Tabs showing an overlay are kept in session storage: { [tabId]: { g: groupId, kind } },
 * kind 'block' (the lock screen) or 'alert' (waiting for an answer; stays until answered).
 */
async function enforceAll(settings, state, now, tabs, locked) {
  let changed = false;
  for (const tab of tabs) {
    let entry = locked[tab.id];
    if (typeof entry === 'string') entry = locked[tab.id] = { g: entry, kind: 'block' }; // saved by 1.3–1.4
    const blocker = Anchor.isTrackable(tab.url) ? Anchor.evaluateUrl(tab.url, settings, state, now).blocker : null;
    if (blocker) {
      if (entry && entry.kind === 'block') continue;
      countBlock(state, blocker.group.id, now);
      changed = true;
      locked[tab.id] = { g: blocker.group.id, kind: 'block' };
      lockTab(tab, blocker.group.id, 'block');
      continue;
    }
    if (entry && entry.kind === 'block') {
      delete locked[tab.id];
      browser.tabs.sendMessage(tab.id, { type: 'unlock' }, { frameId: 0 }).catch(() => {});
    }
  }
  for (const id of Object.keys(locked)) if (!tabs.some((t) => String(t.id) === id)) delete locked[id];
  return changed;
}

/**
 * Cover the page with an overlay. If a block overlay can't be shown, go to the block page; if an
 * alert can't be shown (no content script there), ask again in 5 minutes.
 */
function lockTab(tab, groupId, kind, extra = {}) {
  const failed = () => serial(async () => {
    const { locked = {}, visits = {} } = await browser.storage.session.get(['locked', 'visits']);
    delete locked[tab.id];
    const v = visits[tab.id] && visits[tab.id][groupId];
    if (kind === 'alert' && v) { v.asking = false; v.askAt = v.secs + 5 * 60; }
    await browser.storage.session.set({ locked, visits });
    if (kind === 'block') browser.tabs.update(tab.id, { url: blockUrl(tab.url, groupId) }).catch(() => {});
  });
  browser.tabs.sendMessage(tab.id, { type: 'lock', groupId, kind, ...extra }, { frameId: 0 })
    .then((res) => { if (!res || !res.locked) failed(); }, failed);
}

/** Wake up exactly when something can change: allowance runs out, bypass ends, schedule flips. */
async function scheduleNextCheck(settings, state, now, tab, visits) {
  const times = [];
  for (const g of settings.groups) {
    if (!g.enabled) continue;
    const bp = state.bypass[g.id];
    if (bp && bp.until > now) times.push(bp.until);
    const lockUntil = state.alertLock[g.id];
    if (lockUntil > now) times.push(lockUntil);
    const flip = Anchor.nextScheduleChange(g.schedule, now);
    if (flip) times.push(flip);
  }
  if (tab) {
    for (const m of Anchor.evaluateUrl(tab.url, settings, state, now).matches) {
      if (m.enabled && !m.off && m.behavior === 'allowance' && m.remaining > 0) times.push(now + m.remaining * 1000);
    }
    for (const v of Object.values(visits[tab.id] || {})) {
      if (!v.dismissed && !v.asking && v.askAt > v.secs) times.push(now + (v.askAt - v.secs) * 1000);
    }
  }
  const next = Math.min(...times.filter((t) => t > now));
  if (Number.isFinite(next)) browser.alarms.create('check', { when: next + 500 });
  else browser.alarms.clear('check');
}

async function updateBadge(settings, state, now, tab) {
  let text = '';
  if (tab) {
    // Only an allowance that's counting right now: not while the group rests or is blocked.
    const live = Anchor.evaluateUrl(tab.url, settings, state, now).matches
      .filter((m) => m.enabled && !m.off && m.behavior === 'allowance' && !m.reason);
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
    const { visits = {}, locked = {} } = await browser.storage.session.get(['visits', 'locked']);
    const { changed: tracked, tab } = await flush(settings, state, now, visits);
    const tabs = await browser.tabs.query({});
    pruneVisits(settings, visits, tabs);
    const blocked = await enforceAll(settings, state, now, tabs, locked);
    const asked = maybeAsk(settings, state, now, tab, visits, locked);
    await browser.storage.session.set({ visits, locked });
    if (tracked || blocked || asked) {
      Anchor.pruneState(state, settings, now);
      await saveState(state);
    }
    await scheduleNextCheck(settings, state, now, tab, visits);
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

/**
 * Checked daily and at startup. Downloads only when there's no copy for this country, or the
 * copy is from an earlier year (so once each new year). Changing country or "Update now"
 * download right away.
 */
async function maybeRefreshHolidays() {
  const { settings: raw, state: rawState } = await browser.storage.local.get(['settings', 'state']);
  const country = Anchor.normalizeSettings(raw).country;
  const h = Anchor.normalizeState(rawState).holidays;
  const stale = !h || h.country !== country || !h.fetchedAt || new Date(h.fetchedAt).getFullYear() < new Date().getFullYear();
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
    // A group on a holiday off says nothing; one outside its schedule only says when it starts.
    groups: matches.filter((m) => m.enabled && !m.blocked && m.off !== 'holiday' && m.reason !== 'alertLock').map((m) => {
      const resting = m.off === 'schedule';
      const startsBlocking = resting && m.behavior === 'block' && m.until && Anchor.activeOn(m.group, state, m.until + 1000).active;
      return {
        id: m.group.id,
        name: m.group.name,
        color: m.group.color,
        reminders: m.group.reminders,
        behavior: m.behavior,
        resting,
        period: m.group.limit.period,
        alertEvery: m.group.alert.every,
        remaining: resting || m.behavior !== 'allowance' ? null : Math.max(0, m.remaining - Math.max(0, pending)),
        bypassUntil: m.bypassUntil,
        blockedAfterBreak: !!m.reason,
        scheduleStart: startsBlocking ? m.until : null,
      };
    }),
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
    case 'alertAnswer': // from the alert screen; reply at once, its frame may go away
      if (sender.tab) answerAlert(sender.tab.id, msg.groupId, msg.choice, msg.minutes);
      return Promise.resolve({ ok: true });
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
    // An alert belongs to the page it was asked on: a new address drops it.
    if (locked[tabId].kind === 'alert') browser.tabs.sendMessage(tabId, { type: 'unlock' }, { frameId: 0 }).catch(() => {});
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
