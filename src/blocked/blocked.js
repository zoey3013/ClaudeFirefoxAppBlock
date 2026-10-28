/* global Anchor, Challenge */
'use strict';

const params = new URLSearchParams(location.search);
const targetUrl = params.get('url') || '';
const hintGroupId = params.get('g');
const $ = (id) => document.getElementById(id);

let view = null; // { settings, state, status }

async function refresh() {
  const { settings, state } = await browser.storage.local.get(['settings', 'state']);
  const s = settings || { groups: [] };
  const st = Anchor.normalizeState(state);
  const now = Date.now();
  const { matches, blocker } = Anchor.evaluateUrl(targetUrl, s, st, now);
  const status = blocker || matches.find((m) => m.group.id === hintGroupId) || matches[0] || null;
  view = { settings: s, state: st, status, blocked: !!blocker };
  render();
}

function periodWord(p) { return p === 'hour' ? 'this hour' : 'today'; }

function render() {
  const { status, blocked } = view;
  const now = Date.now();
  const host = Anchor.hostOf(targetUrl) || 'This site';
  $('title').textContent = blocked ? `${host} is blocked` : `${host} is available`;
  document.title = `${blocked ? 'Blocked' : 'Available'} — ${host}`;

  if (!status) {
    $('group').hidden = true;
    $('reason').textContent = 'No focus group is blocking this site right now.';
  } else {
    const g = status.group;
    $('group').hidden = false;
    $('groupDot').style.background = g.color;
    $('groupName').textContent = g.name;
    $('reason').textContent = blocked ? reasonText(status, now) : availableText(status, now);
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
    bypass.textContent = `Take a ${b.minutes}-minute break`;
    bypass.disabled = status.bypassLeft <= 0;
    note.textContent = status.bypassLeft > 0
      ? `${status.bypassLeft} of ${b.maxUses} breaks left ${periodWord(b.period)}`
      : `No breaks left ${periodWord(b.period)}`;
  }
  $('disable').hidden = !blocked;
}

function reasonText(st, now) {
  const g = st.group;
  const allowMode = g.mode === 'allow';
  if (st.reason === 'schedule') {
    const end = st.until ? ` until ${Anchor.formatWhen(st.until, now)}` : '';
    return allowMode
      ? `“${g.name}” is on${end}. Only its allowed sites are open.`
      : `“${g.name}” is on${end}. Stay with what matters.`;
  }
  if (st.reason === 'limit') {
    const reset = g.limit.period === 'day' ? 'midnight' : Anchor.formatClock(st.until);
    return `You’ve used your ${Anchor.formatDuration(g.limit.minutes * 60)} ${periodWord(g.limit.period)}. It resets at ${reset}.`;
  }
  return allowMode
    ? `“${g.name}” only allows its listed sites.`
    : `“${g.name}” keeps this site blocked.`;
}

function availableText(st, now) {
  if (st.bypassUntil) return `Break in progress. Blocking resumes at ${Anchor.formatClock(st.bypassUntil)}.`;
  if (st.remaining !== null) return `${Anchor.formatDuration(st.remaining)} left ${periodWord(st.group.limit.period)}.`;
  return 'You can continue.';
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
  if (!(await Challenge.run(g, `take a ${g.bypass.minutes}-minute break from “${g.name}”`))) return;
  const res = await browser.runtime.sendMessage({ type: 'bypass', groupId: g.id });
  if (res && res.ok) goToSite();
  else { $('bypassNote').textContent = (res && res.error) || 'Could not start a break.'; }
});

$('disable').addEventListener('click', async () => {
  const g = view.status.group;
  if (!(await Challenge.run(g, `turn off “${g.name}”`))) return;
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
