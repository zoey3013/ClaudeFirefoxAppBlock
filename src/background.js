/* global Anchor */
'use strict';

/*
 * Background event page.
 * - Tracks time on the active tab of the focused window (pooled per group, per hour bucket).
 * - Redirects blocked navigations to the block page and sweeps open tabs when limits kick in.
 * - Handles temporary bypasses requested from the UI.
 *
 * Settings are written by the UI pages; the background only writes `state`.
 */

const BLOCK_PAGE = browser.runtime.getURL('src/blocked/blocked.html');
const MAX_SLICE_MS = 2 * 60 * 1000; // never credit more than this between two ticks
const IDLE_SECONDS = 10 * 60;

// ---------- Storage ----------

async function load() {
  const { settings, state } = await browser.storage.local.get(['settings', 'state']);
  return { settings: settings || Anchor.defaultSettings(), state: Anchor.normalizeState(state) };
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
  if (active && now > active.start) {
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

async function enforceAll(settings, state, now) {
  const tabs = await browser.tabs.query({});
  let changed = false;
  for (const tab of tabs) {
    if (!Anchor.isTrackable(tab.url)) continue;
    const { blocker } = Anchor.evaluateUrl(tab.url, settings, state, now);
    if (!blocker) continue;
    countBlock(state, blocker.group.id, now);
    changed = true;
    browser.tabs.update(tab.id, { url: blockUrl(tab.url, blocker.group.id) }).catch(() => {});
  }
  return changed;
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

// ---------- Messages from UI ----------

async function handleBypass(groupId) {
  return serial(async () => {
    const now = Date.now();
    const { settings, state } = await load();
    const group = settings.groups.find((g) => g.id === groupId);
    if (!group || !group.bypass.enabled) return { ok: false, error: 'Bypass is turned off for this group.' };
    if (Anchor.bypassUsesLeft(group, state, now) <= 0) return { ok: false, error: 'No bypasses left for this period.' };
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

browser.runtime.onMessage.addListener((msg) => {
  switch (msg && msg.type) {
    case 'bypass':
      return handleBypass(msg.groupId).then((r) => (tick(), r));
    case 'endBypass':
      return handleEndBypass(msg.groupId).then((r) => (tick(), r));
    case 'tick':
      return tick().then(() => ({ ok: true }));
    default:
      return undefined;
  }
});

// ---------- Wiring ----------

browser.tabs.onActivated.addListener(() => tick());
browser.tabs.onUpdated.addListener(() => tick(), { properties: ['url'] });
browser.windows.onFocusChanged.addListener(() => tick());
browser.alarms.onAlarm.addListener(() => tick());

browser.idle.setDetectionInterval(IDLE_SECONDS);
browser.idle.onStateChanged.addListener(() => tick());

browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) tick();
});

function setup() {
  browser.alarms.create('tick', { periodInMinutes: 1 });
  tick();
}

browser.runtime.onStartup.addListener(setup);
browser.runtime.onInstalled.addListener(async ({ reason }) => {
  const { settings } = await browser.storage.local.get('settings');
  if (!settings) await browser.storage.local.set({ settings: Anchor.defaultSettings() });
  setup();
  if (reason === 'install') browser.runtime.openOptionsPage();
});
