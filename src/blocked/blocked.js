/* global Anchor, Challenge, I18n, Theme */
'use strict';

const params = new URLSearchParams(location.search);
const targetUrl = params.get('url') || '';
const hintGroupId = params.get('g');
// Embedded: shown inside the lock overlay on top of the still-open site, rather than in place of it.
const embedded = params.get('embedded') === '1';
// Alert mode asks instead of blocking: "You've been here for X minutes. Do you want to stay?"
const alertMode = embedded && params.get('alert') === '1';
const alertMinutes = Number(params.get('m')) || 0;
const ALERT_CHOICES = [5, 10, 15, 30, 60];
if (embedded) document.documentElement.classList.add('embedded');
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
  const first = !view;
  view = { settings: s, state: st, status, blocked: !!blocker };
  if (alertMode) renderAlert(); else render();
  if (first && embedded) parent.postMessage({ anchor: 'lock-ready' }, '*');
}

function renderAlert() {
  const g = view.settings.groups.find((x) => x.id === hintGroupId);
  $('blockView').hidden = true;
  $('alertView').hidden = false;
  if (!g) return;
  // The group's color is this screen's accent.
  document.documentElement.style.setProperty('--accent', g.color);
  $('alertDot').style.background = g.color;
  $('alertGroup').textContent = g.name;
  $('alertTitle').textContent = t('alertTitle', { d: Anchor.formatDuration(alertMinutes * 60) });
  $('alertToday').textContent = t('alertToday', { d: Anchor.formatDuration(Anchor.usedSeconds(view.state, g.id, 'day', Date.now())) });
  document.title = `${g.name} — Anchor`;
  for (const id of ['alertRemindMin', 'alertLockMin']) {
    const sel = $(id);
    if (!sel.options.length) {
      for (const n of ALERT_CHOICES) sel.append(new Option(t('nMinutes', { n }), String(n)));
      sel.value = id === 'alertRemindMin' ? '10' : '15';
    }
  }
}

function answer(choice, minutes) {
  for (const b of document.querySelectorAll('#alertView .btn')) b.disabled = true;
  browser.runtime.sendMessage({ type: 'alertAnswer', groupId: hintGroupId, choice, minutes }).catch(() => {});
}

$('alertDismiss').addEventListener('click', () => answer('dismiss'));
$('alertRemind').addEventListener('click', () => answer('remind', Number($('alertRemindMin').value)));
$('alertLock').addEventListener('click', () => answer('lock', Number($('alertLockMin').value)));

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
  // A lock chosen on an alert has no early way out.
  const lockedByAlert = status && status.reason === 'alertLock';
  const canBypass = blocked && !lockedByAlert && status.group.bypass.enabled;
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
  $('disable').hidden = !blocked || lockedByAlert;
}

function reasonText(st, now) {
  const g = st.group;
  const allowMode = g.mode === 'allow';
  if (st.reason === 'alertLock') return t('reasonAlertLock', { name: g.name, time: Anchor.formatClock(st.until) });
  if (st.reason === 'block' && st.until) {
    const until = t('untilWhen', { when: Anchor.formatWhen(st.until, now) });
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
  // In the overlay the site is still underneath: ask for the overlay to be lifted.
  if (embedded) browser.runtime.sendMessage({ type: 'unlockTab' }).catch(() => {});
  else if (targetUrl && Anchor.isTrackable(targetUrl)) location.replace(targetUrl);
}

$('continue').addEventListener('click', goToSite);

$('close').addEventListener('click', () => browser.runtime.sendMessage({ type: 'closeTab' }).catch(() => {}));

$('bypass').addEventListener('click', async () => {
  const g = view.status.group;
  if (!(await Challenge.run(g, t('actionBreak', { n: g.bypass.minutes, name: g.name })))) return;
  const res = await browser.runtime.sendMessage({ type: 'bypass', groupId: g.id });
  // In the overlay, the background lifts it as soon as the break starts.
  if (res && res.ok) { if (!embedded) goToSite(); }
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

refresh();
// The alert screen is drawn once: it goes away as soon as it's answered.
if (!alertMode) {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.settings || changes.state)) refresh();
  });
  setInterval(() => { if (view) render(); }, 1000);
  setInterval(refresh, 15000);
}
