/* global Anchor, Challenge, Stats */
'use strict';

const $ = (id) => document.getElementById(id);
const { el } = Challenge;

let settings = { groups: [] };
let state = Anchor.emptyState();
let selected = null; // group id, or 'stats'
const unlocked = new Set(); // groups unlocked for editing during this page visit

// ---------- Persistence ----------

let saveTimer = null;
function save(immediate = false) {
  clearTimeout(saveTimer);
  const run = async () => {
    saveTimer = null;
    await browser.storage.local.set({ settings });
    toast('Saved');
  };
  if (immediate) return run();
  saveTimer = setTimeout(run, 350);
}

let toastTimer = null;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1200);
}

async function load() {
  const data = await browser.storage.local.get(['settings', 'state']);
  settings = data.settings || Anchor.defaultSettings();
  state = Anchor.normalizeState(data.state);
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
  const s = el('select', { class: 'input', 'aria-label': 'Period' },
    el('option', { value: 'day' }, 'per day'), el('option', { value: 'hour' }, 'per hour'));
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
  const parts = [];
  const where = g.mode === 'allow'
    ? 'everything except the allowed sites'
    : `${g.sites.length} site${g.sites.length === 1 ? '' : 's'}`;
  if (!g.schedule.enabled && !g.limit.enabled) return `Always blocks ${where}.`;
  if (g.schedule.enabled) parts.push(`Blocks ${where} during scheduled hours`);
  if (g.limit.enabled) {
    const per = g.limit.period === 'day' ? 'day' : 'hour';
    parts.push(`${g.schedule.enabled ? 'outside them, allows' : `Allows ${where} for`} ${Anchor.formatDuration(g.limit.minutes * 60)} per ${per}, shared`);
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
        el('span', { class: 'name' }, g.name || 'Untitled'),
        el('span', { class: `sub ${s.kind}` }, (isLocked(g) && !unlocked.has(g.id) ? '🔒 ' : '') + s.text)));
    b.addEventListener('click', () => select(g.id));
    return b;
  }));
  $('navStats').setAttribute('aria-current', String(selected === 'stats'));
}

function select(id) {
  selected = id;
  history.replaceState(null, '', id === 'stats' ? '#stats' : `#${id}`);
  render();
}

function render() {
  renderNav();
  const showStats = selected === 'stats';
  $('stats').hidden = !showStats;
  $('editor').hidden = showStats;
  if (showStats) Stats.render($('stats'), settings, state);
  else renderEditor();
}

// ---------- Editor ----------

function renderEditor() {
  const root = $('editor');
  const g = groupById(selected);
  if (!g) {
    root.replaceChildren(el('div', { class: 'card' },
      el('h2', {}, 'No group selected'),
      el('p', { class: 'muted' }, 'Create a focus group to start blocking distractions.')));
    return;
  }
  const editable = canEdit(g);
  const changed = (rerender = false) => { save(); renderNav(); if (rerender) renderEditor(); else updateSummary(); };

  // Header (outside the fieldset so a locked group can still be switched on).
  const summary = el('p', { class: 'summary' }, summarize(g));
  const updateSummary = () => { summary.textContent = summarize(g); };

  const nameInput = el('input', { class: 'name-input', value: g.name, 'aria-label': 'Group name', maxlength: '40' });
  nameInput.disabled = !editable;
  nameInput.addEventListener('input', () => { g.name = nameInput.value.trim() || 'Untitled'; changed(); });

  const enabled = switchEl(g.enabled, async (on, input) => {
    if (!on && !canEdit(g)) {
      input.checked = true;
      if (!(await Challenge.run(g, `turn off “${g.name}”`))) return;
      input.checked = false;
    }
    g.enabled = on;
    save(true);
    renderNav();
    input.closest('.toggle-label').firstChild.textContent = on ? 'On' : 'Off';
  }, 'Group enabled');

  const header = el('section', { class: 'card' },
    el('div', { class: 'title-row' },
      el('span', { class: 'dot', style: `background:${g.color};width:14px;height:14px` }),
      nameInput,
      el('label', { class: 'toggle-label' }, g.enabled ? 'On' : 'Off', enabled)),
    summary);

  const parts = [header];

  if (!editable) {
    const unlock = el('button', { class: 'btn primary', type: 'button' }, 'Unlock to edit');
    unlock.addEventListener('click', async () => {
      if (await Challenge.run(g, `change “${g.name}”`)) { unlocked.add(g.id); render(); }
    });
    parts.push(el('div', { class: 'lockbar' },
      el('div', {}, el('strong', {}, 'This group is protected'),
        el('span', { class: 'muted' }, g.lock.method === 'pin' ? 'Enter the PIN to make changes.' : 'Solve three quick problems to make changes.')),
      unlock));
  } else if (isLocked(g)) {
    const relock = el('button', { class: 'btn small', type: 'button' }, 'Lock again');
    relock.addEventListener('click', () => { unlocked.delete(g.id); render(); });
    parts.push(el('div', { class: 'lockbar' },
      el('div', {}, el('strong', {}, 'Unlocked for editing'), el('span', { class: 'muted' }, 'Changes save automatically.')),
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
    lockCard(g, changed),
    dangerCard(g),
  );
  parts.push(fs);
  root.replaceChildren(...parts);
}

function colorCard(g, changed) {
  const swatches = el('div', { class: 'swatches' }, ...Anchor.GROUP_COLORS.map((c) => {
    const b = el('button', { type: 'button', class: 'swatch', style: `background:${c}`, 'aria-pressed': String(g.color === c), 'aria-label': `Color ${c}` });
    b.addEventListener('click', () => { g.color = c; changed(true); });
    return b;
  }));
  return card('Color', 'Helps you recognise the group in the toolbar and stats.', null, swatches);
}

let siteError = ''; // survives the re-render after adding sites

function sitesCard(g, changed) {
  const mode = segmented([['block', 'Block these sites'], ['allow', 'Allow only these sites']], g.mode,
    (m) => { g.mode = m; changed(true); });

  const chips = el('div', { class: 'chips' }, ...g.sites.map((s) => {
    const x = el('button', { type: 'button', 'aria-label': `Remove ${s}` }, '×');
    x.addEventListener('click', () => { g.sites = g.sites.filter((v) => v !== s); changed(true); });
    return el('span', { class: 'chip' }, s, x);
  }));
  if (!g.sites.length) chips.append(el('span', { class: 'faint' }, 'No sites yet.'));

  const input = el('input', { class: 'input', placeholder: 'reddit.com, youtube.com/shorts …', 'aria-label': 'Add website' });
  const error = el('p', { class: 'hint', style: 'color:var(--danger)' }, siteError);
  if (siteError) { input.value = siteError.replace(/^.*?: /, ''); siteError = ''; }
  const add = () => {
    const raw = input.value.split(/[\s,]+/).filter(Boolean);
    const bad = [];
    for (const r of raw) {
      const s = Anchor.parseSite(r);
      if (!s) bad.push(r);
      else if (!g.sites.includes(s)) g.sites.push(s);
    }
    if (bad.length) siteError = `Not a valid website: ${bad.join(', ')}`;
    if (raw.length && bad.length < raw.length) changed(true);
    else if (bad.length) { error.textContent = siteError; siteError = ''; }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  const addBtn = el('button', { class: 'btn', type: 'button' }, 'Add');
  addBtn.addEventListener('click', add);

  return card('Websites',
    g.mode === 'allow'
      ? 'Whitelist mode: every website is blocked except these.'
      : 'These websites are blocked by this group.',
    null, mode, chips, el('div', { class: 'add-row' }, input, addBtn), error,
    el('p', { class: 'hint' }, 'A domain like reddit.com covers all its subdomains. Add a path like youtube.com/shorts to target just that section. Paste several at once, separated by commas or spaces.'));
}

function scheduleCard(g, changed) {
  const sch = g.schedule;
  const rules = el('div', { style: 'display:grid;gap:8px' }, ...sch.rules.map((r, i) => {
    const days = el('div', { class: 'days' }, ...[1, 2, 3, 4, 5, 6, 0].map((d) => {
      const b = el('button', { type: 'button', class: 'day', 'aria-pressed': String(r.days.includes(d)), 'aria-label': Anchor.DAY_LABELS[d] },
        Anchor.DAY_LABELS[d][0]);
      b.addEventListener('click', () => {
        r.days = r.days.includes(d) ? r.days.filter((x) => x !== d) : [...r.days, d];
        b.setAttribute('aria-pressed', String(r.days.includes(d)));
        changed();
      });
      return b;
    }));
    const start = el('input', { class: 'input', type: 'time', value: r.start, 'aria-label': 'Start' });
    const end = el('input', { class: 'input', type: 'time', value: r.end, 'aria-label': 'End' });
    start.addEventListener('change', () => { if (start.value) { r.start = start.value; changed(); } });
    end.addEventListener('change', () => { if (end.value) { r.end = end.value; changed(); } });
    const remove = el('button', { type: 'button', class: 'btn ghost small remove', 'aria-label': 'Remove time range' }, 'Remove');
    remove.hidden = sch.rules.length < 2;
    remove.addEventListener('click', () => { sch.rules.splice(i, 1); changed(true); });
    return el('div', { class: 'rule' }, days, el('span', { class: 'inline' }, start, el('span', { class: 'faint' }, 'to'), end), remove);
  }));
  const addRule = el('button', { type: 'button', class: 'btn small' }, '+ Add time range');
  addRule.addEventListener('click', () => { sch.rules.push({ days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }); changed(true); });

  const body = sch.enabled
    ? [rules, el('div', {}, addRule),
      el('p', { class: 'hint' }, 'Ranges can run overnight (22:00 to 06:00). Same start and end blocks the whole day.')]
    : [];
  return card('Schedule', 'Fully block these sites during set hours.',
    switchEl(sch.enabled, (on) => { sch.enabled = on; changed(true); }, 'Use schedule'), ...body);
}

function limitCard(g, changed) {
  const lim = g.limit;
  const body = [];
  if (lim.enabled) {
    body.push(el('div', { class: 'inline' },
      numberInput(lim.minutes, 1, 1440, (n) => { lim.minutes = n; changed(); }, 'Minutes'),
      el('span', {}, 'minutes'),
      periodSelect(lim.period, (p) => { lim.period = p; changed(true); })));
    const used = Anchor.usedSeconds(state, g.id, lim.period, Date.now());
    const pct = Math.min(100, (used / (lim.minutes * 60)) * 100);
    body.push(el('div', { style: 'display:grid;gap:6px' },
      el('div', { class: 'inline', style: 'justify-content:space-between' },
        el('span', { class: 'muted' }, `Used ${lim.period === 'day' ? 'today' : 'this hour'}`),
        el('span', {}, `${Anchor.formatDuration(used)} of ${Anchor.formatDuration(lim.minutes * 60)}`)),
      el('div', { class: 'meter' }, el('span', { style: `width:${pct}%;background:${g.color}` }))));
    body.push(el('p', { class: 'hint' }, 'Time is pooled: every site in this group draws from the same allowance. Once it runs out, all of them are blocked until it resets.'));
  }
  return card('Time allowance', 'Let yourself use these sites for a limited time.',
    switchEl(lim.enabled, (on) => { lim.enabled = on; changed(true); }, 'Use time allowance'), ...body);
}

function bypassCard(g, changed) {
  const bp = g.bypass;
  const body = bp.enabled ? [
    el('div', { class: 'inline' },
      numberInput(bp.minutes, 1, 120, (n) => { bp.minutes = n; changed(); }, 'Break length'),
      el('span', {}, 'minute break, up to'),
      numberInput(bp.maxUses, 1, 50, (n) => { bp.maxUses = n; changed(); }, 'Times'),
      el('span', {}, 'times'),
      periodSelect(bp.period, (p) => { bp.period = p; changed(); })),
    el('p', { class: 'hint' }, 'Breaks are offered on the block page and pause blocking for the whole group. They require the unlock challenge below.'),
  ] : [];
  return card('Temporary breaks', 'Pause blocking for a few minutes when you really need to.',
    switchEl(bp.enabled, (on) => { bp.enabled = on; changed(true); }, 'Allow breaks'), ...body);
}

function lockCard(g, changed) {
  const lock = g.lock;
  const control = segmented([['none', 'None'], ['puzzle', 'Math puzzle'], ['pin', 'PIN code']], lock.method, (m) => {
    lock.method = m;
    unlocked.add(g.id); // you're already in, keep editing
    changed(true);
  });
  const desc = {
    none: 'Anyone can take breaks, change or turn off this group instantly.',
    puzzle: 'Solve three easy math problems (+ − × ÷) to take a break, edit, or turn off this group.',
    pin: 'Enter a PIN to take a break, edit, or turn off this group. Ask someone else to set it for extra commitment.',
  }[lock.method];
  const body = [el('p', { class: 'muted' }, desc)];

  if (lock.method === 'pin') {
    const a = el('input', { class: 'input', type: 'password', inputmode: 'numeric', maxlength: '8', placeholder: 'New PIN', 'aria-label': 'New PIN' });
    const b = el('input', { class: 'input', type: 'password', inputmode: 'numeric', maxlength: '8', placeholder: 'Repeat', 'aria-label': 'Repeat PIN' });
    const set = el('button', { class: 'btn primary', type: 'button' }, lock.pinHash ? 'Change PIN' : 'Set PIN');
    const msg = el('span', { class: lock.pinHash ? 'ok-text' : 'warn-text' }, lock.pinHash ? 'PIN is set' : 'No PIN set yet, protection is off');
    set.addEventListener('click', async () => {
      if (!/^\d{4,8}$/.test(a.value)) { msg.className = 'warn-text'; msg.textContent = 'Use 4 to 8 digits.'; return; }
      if (a.value !== b.value) { msg.className = 'warn-text'; msg.textContent = 'PINs don’t match.'; return; }
      lock.salt = Anchor.uid();
      lock.pinHash = await Anchor.hashPin(a.value, lock.salt);
      unlocked.add(g.id);
      changed(true);
    });
    body.push(el('div', { class: 'pin-row' }, a, b, set, msg));
  }
  return card('Unlock protection', 'Make unlocking a conscious choice.', null, control, ...body);
}

function dangerCard(g) {
  const del = el('button', { class: 'btn danger', type: 'button' }, 'Delete group');
  del.addEventListener('click', async () => {
    if (!confirm(`Delete “${g.name}”? Its usage history will be removed.`)) return;
    settings.groups = settings.groups.filter((x) => x.id !== g.id);
    await save(true);
    select(settings.groups[0] ? settings.groups[0].id : 'stats');
  });
  return el('div', { class: 'danger-zone' }, del);
}

// ---------- Boot ----------

$('newGroup').addEventListener('click', () => {
  const g = Anchor.newGroup('New group', settings.groups.length);
  settings.groups.push(g);
  unlocked.add(g.id);
  save(true);
  select(g.id);
  const name = document.querySelector('.name-input');
  if (name) { name.focus(); name.select(); }
});
$('navStats').addEventListener('click', () => select('stats'));

const ALL_SITES = { origins: ['<all_urls>'] };
$('grant').addEventListener('click', async () => {
  if (await browser.permissions.request(ALL_SITES)) $('permBanner').hidden = true;
});

(async () => {
  await load();
  const hash = location.hash.slice(1);
  selected = hash === 'stats' || groupById(hash) ? hash : (settings.groups[0] ? settings.groups[0].id : 'stats');
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
      settings = incoming;
      if (selected !== 'stats' && !groupById(selected)) selected = settings.groups[0] ? settings.groups[0].id : 'stats';
      render();
      return;
    }
    renderNav();
    if (selected === 'stats') Stats.render($('stats'), settings, state);
  });
})();
