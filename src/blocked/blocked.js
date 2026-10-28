/* global Anchor, Challenge, I18n, Theme */
'use strict';

const params = new URLSearchParams(location.search);
const targetUrl = params.get('url') || '';
const hintGroupId = params.get('g');
const $ = (id) => document.getElementById(id);
const { t } = I18n;

let view = null; // { settings, state, status }

async function refresh() {
  const { settings, state } = await browser.storage.local.get(['settings', 'state']);
  const s = Anchor.normalizeSettings(settings);
  I18n.setLanguage(s.language);
  I18n.apply();
  Theme.apply(s.theme);
  const st = Anchor.normalizeState(state);
  const now = Date.now();
  const { matches, blocker } = Anchor.evaluateUrl(targetUrl, s, st, now);
  const status = blocker || matches.find((m) => m.group.id === hintGroupId) || matches[0] || null;
  view = { settings: s, state: st, status, blocked: !!blocker };
  render();
}

function periodWord(p) { return t(p === 'hour' ? 'perHour' : 'perToday'); }

function render() {
  const { status, blocked } = view;
  const now = Date.now();
  const host = Anchor.hostOf(targetUrl) || t('thisSiteFallback');
  $('title').textContent = t(blocked ? 'blockedTitle' : 'availableTitle', { host });
  document.title = `${t(blocked ? 'docBlocked' : 'docAvailable')} — ${host}`;

  if (!status) {
    $('group').hidden = true;
    $('reason').textContent = t('noGroupBlocking');
  } else {
    const g = status.group;
    $('group').hidden = false;
    $('groupDot').style.background = g.color;
    $('groupName').textContent = g.name;
    $('reason').textContent = blocked ? reasonText(status, now) : availableText(status);
  }

  // Countdown: bypass remaining, or time until unblocked.
  const cd = $('countdown');
  const until = status && (status.bypassUntil || (blocked && status.until));
  cd.hidden = !until;
  if (until) cd.textContent = clock(until - now);

  $('continue').hidden = blocked;

  const bypass = $('bypass');
  const note = $('bypassNote');
  const canBypass = blocked && status.group.bypass.enabled;
  bypass.hidden = !canBypass;
  note.hidden = !canBypass;
  if (canBypass) {
    const b = status.group.bypass;
    bypass.textContent = t('takeBreak', { n: b.minutes });
    bypass.disabled = status.bypassLeft <= 0;
    note.textContent = status.bypassLeft > 0
      ? t('breaksLeft', { left: status.bypassLeft, max: b.maxUses, per: periodWord(b.period) })
      : t('noBreaksLeft', { per: periodWord(b.period) });
  }
  $('disable').hidden = !blocked;
}

function reasonText(st, now) {
  const g = st.group;
  const allowMode = g.mode === 'allow';
  if (st.reason === 'schedule') {
    const until = st.until ? t('untilWhen', { when: Anchor.formatWhen(st.until, now) }) : '';
    return t(allowMode ? 'reasonScheduleAllow' : 'reasonSchedule', { name: g.name, until });
  }
  if (st.reason === 'limit') {
    const reset = g.limit.period === 'day' ? t('resetMidnight') : t('atTime', { time: Anchor.formatClock(st.until) });
    return t('reasonLimit', { d: Anchor.formatDuration(g.limit.minutes * 60), per: periodWord(g.limit.period), reset });
  }
  return t(allowMode ? 'reasonAlwaysAllow' : 'reasonAlways', { name: g.name });
}

function availableText(st) {
  if (st.bypassUntil) return t('availBreak', { time: Anchor.formatClock(st.bypassUntil) });
  if (st.remaining !== null) return t('availLeft', { d: Anchor.formatDuration(st.remaining), per: periodWord(st.group.limit.period) });
  return t('availContinue');
}

function clock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return `${h ? h + ':' : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

function goToSite() {
  if (targetUrl && Anchor.isTrackable(targetUrl)) location.replace(targetUrl);
}

$('continue').addEventListener('click', goToSite);

$('close').addEventListener('click', async () => {
  const tab = await browser.tabs.getCurrent();
  browser.tabs.remove(tab.id);
});

$('bypass').addEventListener('click', async () => {
  const g = view.status.group;
  if (!(await Challenge.run(g, t('actionBreak', { n: g.bypass.minutes, name: g.name })))) return;
  const res = await browser.runtime.sendMessage({ type: 'bypass', groupId: g.id });
  if (res && res.ok) goToSite();
  else { $('bypassNote').textContent = t((res && res.error) || 'breakFailed'); }
});

$('disable').addEventListener('click', async () => {
  const g = view.status.group;
  if (!(await Challenge.run(g, t('actionDisable', { name: g.name })))) return;
  const { settings } = await browser.storage.local.get('settings');
  const group = settings.groups.find((x) => x.id === g.id);
  if (group) group.enabled = false;
  await browser.storage.local.set({ settings });
  await refresh();
  if (!view.blocked) goToSite();
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.settings || changes.state)) refresh();
});

refresh();
setInterval(() => { if (view) render(); }, 1000);
setInterval(refresh, 15000);
