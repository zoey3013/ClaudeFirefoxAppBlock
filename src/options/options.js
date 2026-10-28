/* global Anchor, Challenge, Stats, I18n, Theme */
'use strict';

const $ = (id) => document.getElementById(id);
const { el } = Challenge;
const { t } = I18n;

let settings = { groups: [] };
let state = Anchor.emptyState();
let selected = null; // group id, 'stats' or 'general'
const unlocked = new Set(); // groups unlocked for editing during this page visit
const PAGES = ['stats', 'general'];

// ---------- Persistence ----------

let saveTimer = null;
function save(immediate = false) {
  clearTimeout(saveTimer);
  const run = async () => {
    saveTimer = null;
    await browser.storage.local.set({ settings });
    toast(t('saved'));
  };
  if (immediate) return run();
  saveTimer = setTimeout(run, 350);
}

let toastTimer = null;
function toast(text) {
  const n = $('toast');
  n.textContent = text;
  n.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => n.classList.remove('show'), 1200);
}

async function load() {
  const data = await browser.storage.local.get(['settings', 'state']);
  settings = Anchor.normalizeSettings(data.settings);
  state = Anchor.normalizeState(data.state);
}

function applyPreferences() {
  I18n.setLanguage(settings.language);
  I18n.apply();
  Theme.apply(settings.theme);
  document.title = t('docSettings');
}

// ---------- Helpers ----------

const groupById = (id) => settings.groups.find((g) => g.id === id);
const isLocked = (g) => g.lock.method === 'puzzle' || (g.lock.method === 'pin' && !!g.lock.pinHash);
const canEdit = (g) => !isLocked(g) || unlocked.has(g.id);

function switchEl(checked, onChange, label) {
  const input = el('input', { type: 'checkbox', 'aria-label': label });
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked, input));
  return el('label', { class: 'switch' }, input, el('span'));
}

function segmented(options, value, onChange) {
  const wrap = el('div', { class: 'segmented', role: 'group' });
  for (const [val, text] of options) {
    const b = el('button', { type: 'button', 'aria-pressed': String(val === value) }, text);
    b.addEventListener('click', () => onChange(val));
    wrap.append(b);
  }
  return wrap;
}

function numberInput(value, min, max, onChange, label) {
  const input = el('input', { class: 'input num', type: 'number', min, max, value, 'aria-label': label });
  input.addEventListener('input', () => {
    const n = Math.round(Number(input.value));
    if (Number.isFinite(n) && n >= min && n <= max) onChange(n);
  });
  input.addEventListener('blur', () => { input.value = Math.min(max, Math.max(min, Math.round(Number(input.value)) || min)); input.dispatchEvent(new Event('input')); });
  return input;
}

function periodSelect(value, onChange) {
  const s = el('select', { class: 'input', 'aria-label': t('period') },
    el('option', { value: 'day' }, t('perDay')), el('option', { value: 'hour' }, t('perHourOpt')));
  s.value = value;
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

function card(title, desc, control, ...body) {
  return el('section', { class: 'card' },
    el('div', { class: 'card-head' },
      el('div', {}, el('h2', {}, title), desc ? el('p', {}, desc) : ''),
      control || ''),
    ...body);
}

function summarize(g) {
  const where = g.mode === 'allow' ? t('whereAllow') : t('nSites', { n: g.sites.length });
  if (!g.schedule.enabled && !g.limit.enabled) return t('sumAlways', { where });
  const parts = [];
  if (g.schedule.enabled) parts.push(t('sumSchedule', { where }));
  if (g.limit.enabled) {
    const vars = { where, d: Anchor.formatDuration(g.limit.minutes * 60), per: t(g.limit.period === 'day' ? 'unitDay' : 'unitHour') };
    parts.push(t(g.schedule.enabled ? 'sumLimitAfter' : 'sumLimit', vars));
  }
  return parts.join('; ') + '.';
}

// ---------- Sidebar ----------

function renderNav() {
  const nav = $('groupNav');
  const now = Date.now();
  nav.replaceChildren(...settings.groups.map((g) => {
    const s = Anchor.describeStatus(Anchor.evaluateGroup(g, state, now), now);
    const b = el('button', { class: 'nav-item', 'aria-current': String(selected === g.id) },
      el('span', { class: 'dot', style: `background:${g.color}` }),
      el('span', { class: 'meta' },
        el('span', { class: 'name' }, g.name || t('untitled')),
        el('span', { class: `sub ${s.kind}` }, (isLocked(g) && !unlocked.has(g.id) ? '🔒 ' : '') + s.text)));
    b.addEventListener('click', () => select(g.id));
    return b;
  }));
  $('navStats').setAttribute('aria-current', String(selected === 'stats'));
  $('navGeneral').setAttribute('aria-current', String(selected === 'general'));
}

function select(id) {
  selected = id;
  history.replaceState(null, '', `#${id}`);
  render();
}

function render() {
  renderNav();
  $('stats').hidden = selected !== 'stats';
  $('general').hidden = selected !== 'general';
  $('editor').hidden = PAGES.includes(selected);
  if (selected === 'stats') Stats.render($('stats'), settings, state);
  else if (selected === 'general') renderGeneral();
  else renderEditor();
}

// ---------- General ----------

function renderGeneral() {
  const lang = el('select', { class: 'input', 'aria-label': t('language') },
    el('option', { value: 'auto' }, t('langAuto')),
    el('option', { value: 'en' }, 'English'),
    el('option', { value: 'es' }, 'Español'));
  lang.value = settings.language;
  lang.addEventListener('change', async () => {
    settings.language = lang.value;
    applyPreferences();
    await save(true);
    render();
  });
  const theme = segmented([['auto', t('themeAuto')], ['light', t('themeLight')], ['dark', t('themeDark')]], settings.theme,
    async (value) => {
      settings.theme = value;
      applyPreferences();
      await save(true);
      render();
    });
  $('general').replaceChildren(
    el('h1', {}, t('general')),
    card(t('language'), t('languageDesc'), lang),
    card(t('appearance'), t('appearanceDesc'), theme),
    card(t('about'), t('version', { v: browser.runtime.getManifest().version }), null,
      el('p', { class: 'hint' }, t('updatesNote'))),
  );
}

// ---------- Editor ----------

function renderEditor() {
  const root = $('editor');
  const g = groupById(selected);
  if (!g) {
    root.replaceChildren(el('div', { class: 'card' },
      el('h2', {}, t('noGroupSelected')),
      el('p', { class: 'muted' }, t('createToStart'))));
    return;
  }
  const editable = canEdit(g);
  const changed = (rerender = false) => { save(); renderNav(); if (rerender) renderEditor(); else updateSummary(); };

  // Header (outside the fieldset so a locked group can still be switched on).
  const summary = el('p', { class: 'summary' }, summarize(g));
  const updateSummary = () => { summary.textContent = summarize(g); };

  const nameInput = el('input', { class: 'name-input', value: g.name, 'aria-label': t('groupName'), maxlength: '40' });
  nameInput.disabled = !editable;
  nameInput.addEventListener('input', () => { g.name = nameInput.value.trim() || t('untitled'); changed(); });

  const enabled = switchEl(g.enabled, async (on, input) => {
    if (!on && !canEdit(g)) {
      input.checked = true;
      if (!(await Challenge.run(g, t('actionDisable', { name: g.name })))) return;
      input.checked = false;
    }
    g.enabled = on;
    save(true);
    renderNav();
    input.closest('.toggle-label').firstChild.textContent = t(on ? 'on' : 'off');
  }, t('groupEnabled'));

  const header = el('section', { class: 'card' },
    el('div', { class: 'title-row' },
      el('span', { class: 'dot', style: `background:${g.color};width:14px;height:14px` }),
      nameInput,
      el('label', { class: 'toggle-label' }, t(g.enabled ? 'on' : 'off'), enabled)),
    summary);

  const parts = [header];

  if (!editable) {
    const unlock = el('button', { class: 'btn primary', type: 'button' }, t('unlockToEdit'));
    unlock.addEventListener('click', async () => {
      if (await Challenge.run(g, t('actionEdit', { name: g.name }))) { unlocked.add(g.id); render(); }
    });
    parts.push(el('div', { class: 'lockbar' },
      el('div', {}, el('strong', {}, t('protectedTitle')),
        el('span', { class: 'muted' }, t(g.lock.method === 'pin' ? 'protectedPin' : 'protectedPuzzle'))),
      unlock));
  } else if (isLocked(g)) {
    const relock = el('button', { class: 'btn small', type: 'button' }, t('lockAgain'));
    relock.addEventListener('click', () => { unlocked.delete(g.id); render(); });
    parts.push(el('div', { class: 'lockbar' },
      el('div', {}, el('strong', {}, t('unlockedTitle')), el('span', { class: 'muted' }, t('autosave'))),
      relock));
  }

  const fs = el('fieldset');
  fs.disabled = !editable;
  fs.append(
    colorCard(g, changed),
    sitesCard(g, changed),
    scheduleCard(g, changed),
    limitCard(g, changed),
    bypassCard(g, changed),
    remindersCard(g, changed),
    lockCard(g, changed),
    dangerCard(g),
  );
  parts.push(fs);
  root.replaceChildren(...parts);
}

function colorCard(g, changed) {
  const swatches = el('div', { class: 'swatches' }, ...Anchor.GROUP_COLORS.map((c) => {
    const b = el('button', { type: 'button', class: 'swatch', style: `background:${c}`, 'aria-pressed': String(g.color === c), 'aria-label': t('colorLabel', { c }) });
    b.addEventListener('click', () => { g.color = c; changed(true); });
    return b;
  }));
  return card(t('color'), t('colorDesc'), null, swatches);
}

let siteError = ''; // survives the re-render after adding sites
let siteErrorInput = '';

function sitesCard(g, changed) {
  const mode = segmented([['block', t('modeBlock')], ['allow', t('modeAllow')]], g.mode,
    (m) => { g.mode = m; changed(true); });

  const chips = el('div', { class: 'chips' }, ...g.sites.map((s) => {
    const x = el('button', { type: 'button', 'aria-label': t('removeSite', { s }) }, '×');
    x.addEventListener('click', () => { g.sites = g.sites.filter((v) => v !== s); changed(true); });
    return el('span', { class: 'chip' }, s, x);
  }));
  if (!g.sites.length) chips.append(el('span', { class: 'faint' }, t('noSites')));

  const input = el('input', { class: 'input', placeholder: 'reddit.com, youtube.com/shorts …', 'aria-label': t('addWebsite') });
  const error = el('p', { class: 'hint', style: 'color:var(--danger)' }, siteError);
  if (siteError) { input.value = siteErrorInput; siteError = ''; siteErrorInput = ''; }
  const add = () => {
    const raw = input.value.split(/[\s,]+/).filter(Boolean);
    const bad = [];
    for (const r of raw) {
      const s = Anchor.parseSite(r);
      if (!s) bad.push(r);
      else if (!g.sites.includes(s)) g.sites.push(s);
    }
    if (bad.length) { siteError = t('invalidSite', { list: bad.join(', ') }); siteErrorInput = bad.join(', '); }
    if (raw.length && bad.length < raw.length) changed(true);
    else if (bad.length) { error.textContent = siteError; siteError = ''; siteErrorInput = ''; }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  const addBtn = el('button', { class: 'btn', type: 'button' }, t('add'));
  addBtn.addEventListener('click', add);

  return card(t('websites'), t(g.mode === 'allow' ? 'sitesDescAllow' : 'sitesDescBlock'),
    null, mode, chips, el('div', { class: 'add-row' }, input, addBtn), error,
    el('p', { class: 'hint' }, t('sitesHint')));
}

function scheduleCard(g, changed) {
  const sch = g.schedule;
  const dayNames = I18n.days();
  const initials = I18n.dayInitials();
  const rules = el('div', { style: 'display:grid;gap:8px' }, ...sch.rules.map((r, i) => {
    const days = el('div', { class: 'days' }, ...[1, 2, 3, 4, 5, 6, 0].map((d) => {
      const b = el('button', { type: 'button', class: 'day', 'aria-pressed': String(r.days.includes(d)), 'aria-label': dayNames[d], title: dayNames[d] },
        initials[d]);
      b.addEventListener('click', () => {
        r.days = r.days.includes(d) ? r.days.filter((x) => x !== d) : [...r.days, d];
        b.setAttribute('aria-pressed', String(r.days.includes(d)));
        changed();
      });
      return b;
    }));
    const start = el('input', { class: 'input', type: 'time', value: r.start, 'aria-label': t('start') });
    const end = el('input', { class: 'input', type: 'time', value: r.end, 'aria-label': t('end') });
    start.addEventListener('change', () => { if (start.value) { r.start = start.value; changed(); } });
    end.addEventListener('change', () => { if (end.value) { r.end = end.value; changed(); } });
    const remove = el('button', { type: 'button', class: 'btn ghost small remove', 'aria-label': t('removeRange') }, t('remove'));
    remove.hidden = sch.rules.length < 2;
    remove.addEventListener('click', () => { sch.rules.splice(i, 1); changed(true); });
    return el('div', { class: 'rule' }, days, el('span', { class: 'inline' }, start, el('span', { class: 'faint' }, t('to')), end), remove);
  }));
  const addRule = el('button', { type: 'button', class: 'btn small' }, t('addRange'));
  addRule.addEventListener('click', () => { sch.rules.push({ days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }); changed(true); });

  const body = sch.enabled
    ? [rules, el('div', {}, addRule), el('p', { class: 'hint' }, t('scheduleHint'))]
    : [];
  return card(t('schedule'), t('scheduleDesc'),
    switchEl(sch.enabled, (on) => { sch.enabled = on; changed(true); }, t('useSchedule')), ...body);
}

function limitCard(g, changed) {
  const lim = g.limit;
  const body = [];
  if (lim.enabled) {
    body.push(el('div', { class: 'inline' },
      numberInput(lim.minutes, 1, 1440, (n) => { lim.minutes = n; changed(); }, t('minutes')),
      el('span', {}, t('minutes')),
      periodSelect(lim.period, (p) => { lim.period = p; changed(true); })));
    const used = Anchor.usedSeconds(state, g.id, lim.period, Date.now());
    const pct = Math.min(100, (used / (lim.minutes * 60)) * 100);
    body.push(el('div', { style: 'display:grid;gap:6px' },
      el('div', { class: 'inline', style: 'justify-content:space-between' },
        el('span', { class: 'muted' }, t(lim.period === 'day' ? 'usedToday' : 'usedHour')),
        el('span', {}, t('usedOf', { a: Anchor.formatDuration(used), b: Anchor.formatDuration(lim.minutes * 60) }))),
      el('div', { class: 'meter' }, el('span', { style: `width:${pct}%;background:${g.color}` }))));
    body.push(el('p', { class: 'hint' }, t('allowanceHint')));
  }
  return card(t('allowance'), t('allowanceDesc'),
    switchEl(lim.enabled, (on) => { lim.enabled = on; changed(true); }, t('useAllowance')), ...body);
}

function bypassCard(g, changed) {
  const bp = g.bypass;
  const body = bp.enabled ? [
    el('div', { class: 'inline' },
      numberInput(bp.minutes, 1, 120, (n) => { bp.minutes = n; changed(); }, t('breakLength')),
      el('span', {}, t('minuteBreakUpTo')),
      numberInput(bp.maxUses, 1, 50, (n) => { bp.maxUses = n; changed(); }, t('timesLabel')),
      el('span', {}, t('times')),
      periodSelect(bp.period, (p) => { bp.period = p; changed(); })),
    el('p', { class: 'hint' }, t('breaksHint')),
  ] : [];
  return card(t('breaks'), t('breaksDesc'),
    switchEl(bp.enabled, (on) => { bp.enabled = on; changed(true); }, t('allowBreaks')), ...body);
}

function remindersCard(g, changed) {
  const r = g.reminders;
  const row = (key, label, hint) => el('div', { class: 'check-row' },
    el('div', {}, el('strong', {}, t(label)), el('span', { class: 'hint' }, t(hint))),
    switchEl(r[key], (on) => { r[key] = on; changed(); }, t(label)));
  return card(t('reminders'), t('remindersDesc'), null,
    row('card', 'reminderCard', 'reminderCardHint'),
    row('countdown', 'reminderCountdown', 'reminderCountdownHint'));
}

function lockCard(g, changed) {
  const lock = g.lock;
  const control = segmented([['none', t('lockNone')], ['puzzle', t('lockPuzzle')], ['pin', t('lockPin')]], lock.method, (m) => {
    lock.method = m;
    unlocked.add(g.id); // you're already in, keep editing
    changed(true);
  });
  const desc = t({ none: 'lockNoneDesc', puzzle: 'lockPuzzleDesc', pin: 'lockPinDesc' }[lock.method]);
  const body = [el('p', { class: 'muted' }, desc)];

  if (lock.method === 'pin') {
    const a = el('input', { class: 'input', type: 'password', inputmode: 'numeric', maxlength: '8', placeholder: t('newPin'), 'aria-label': t('newPin') });
    const b = el('input', { class: 'input', type: 'password', inputmode: 'numeric', maxlength: '8', placeholder: t('repeatPin'), 'aria-label': t('repeatPin') });
    const set = el('button', { class: 'btn primary', type: 'button' }, t(lock.pinHash ? 'changePin' : 'setPin'));
    const msg = el('span', { class: lock.pinHash ? 'ok-text' : 'warn-text' }, t(lock.pinHash ? 'pinIsSet' : 'noPinYet'));
    set.addEventListener('click', async () => {
      if (!/^\d{4,8}$/.test(a.value)) { msg.className = 'warn-text'; msg.textContent = t('pinDigits'); return; }
      if (a.value !== b.value) { msg.className = 'warn-text'; msg.textContent = t('pinMismatch'); return; }
      lock.salt = Anchor.uid();
      lock.pinHash = await Anchor.hashPin(a.value, lock.salt);
      unlocked.add(g.id);
      changed(true);
    });
    body.push(el('div', { class: 'pin-row' }, a, b, set, msg));
  }
  return card(t('lockTitle'), t('lockDesc'), null, control, ...body);
}

function dangerCard(g) {
  const del = el('button', { class: 'btn danger', type: 'button' }, t('deleteGroup'));
  del.addEventListener('click', async () => {
    if (!confirm(t('confirmDelete', { name: g.name }))) return;
    settings.groups = settings.groups.filter((x) => x.id !== g.id);
    await save(true);
    select(settings.groups[0] ? settings.groups[0].id : 'stats');
  });
  return el('div', { class: 'danger-zone' }, del);
}

// ---------- Boot ----------

$('newGroup').addEventListener('click', () => {
  const g = Anchor.newGroup(t('newGroupName'), settings.groups.length);
  settings.groups.push(g);
  unlocked.add(g.id);
  save(true);
  select(g.id);
  const name = document.querySelector('.name-input');
  if (name) { name.focus(); name.select(); }
});
$('navStats').addEventListener('click', () => select('stats'));
$('navGeneral').addEventListener('click', () => select('general'));

const ALL_SITES = { origins: ['<all_urls>'] };
$('grant').addEventListener('click', async () => {
  if (await browser.permissions.request(ALL_SITES)) $('permBanner').hidden = true;
});

(async () => {
  await load();
  applyPreferences();
  const hash = location.hash.slice(1);
  selected = PAGES.includes(hash) || groupById(hash) ? hash : (settings.groups[0] ? settings.groups[0].id : 'stats');
  render();

  $('permBanner').hidden = await browser.permissions.contains(ALL_SITES);
  $('privateNote').hidden = await browser.extension.isAllowedIncognitoAccess();

  // Keep usage/status fresh without disturbing what the user is typing.
  browser.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    if (changes.state) state = Anchor.normalizeState(changes.state.newValue);
    // Adopt changes made elsewhere (popup, block page); our own saves come back identical.
    const incoming = changes.settings && changes.settings.newValue;
    if (incoming && !saveTimer && JSON.stringify(incoming) !== JSON.stringify(settings)) {
      settings = Anchor.normalizeSettings(incoming);
      applyPreferences();
      if (!PAGES.includes(selected) && !groupById(selected)) selected = settings.groups[0] ? settings.groups[0].id : 'stats';
      render();
      return;
    }
    renderNav();
    if (selected === 'stats') Stats.render($('stats'), settings, state);
  });
})();
