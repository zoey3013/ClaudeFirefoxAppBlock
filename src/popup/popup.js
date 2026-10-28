/* global Anchor, Challenge */
'use strict';

const $ = (id) => document.getElementById(id);
const { el } = Challenge;
const BLOCK_PAGE = browser.runtime.getURL('src/blocked/blocked.html');

let settings, state, currentUrl;

async function getCurrentUrl() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) return '';
  if (tab.url.startsWith(BLOCK_PAGE)) return new URL(tab.url).searchParams.get('url') || '';
  return tab.url;
}

async function load() {
  const data = await browser.storage.local.get(['settings', 'state']);
  settings = data.settings || { groups: [] };
  state = Anchor.normalizeState(data.state);
}

async function saveSettings() {
  await browser.storage.local.set({ settings });
}

function render() {
  const now = Date.now();
  renderCurrent(now);
  renderGroups(now);
}

function renderCurrent(now) {
  const trackable = Anchor.isTrackable(currentUrl);
  $('host').textContent = trackable ? Anchor.hostOf(currentUrl) : 'Not a website';
  const box = $('currentStatus');
  box.replaceChildren();
  $('addForm').hidden = true;
  if (!trackable) return;

  const { matches } = Anchor.evaluateUrl(currentUrl, settings, state, now);
  for (const m of matches) {
    const s = Anchor.describeStatus(m, now);
    box.append(el('div', { class: 'row' },
      el('span', { class: 'dot', style: `background:${m.group.color}` }),
      el('span', { class: 'name' }, m.group.name),
      el('span', { class: 'muted' }, s.text)));
  }
  if (!matches.length) box.append(el('p', { class: 'muted' }, 'Not in any focus group.'));

  // Quick add: only block-list groups that don't already cover this site (adding is always allowed).
  const candidates = settings.groups.filter((g) => g.mode === 'block' && !Anchor.groupMatches(g, currentUrl));
  if (candidates.length) {
    $('addGroup').replaceChildren(...candidates.map((g) => el('option', { value: g.id }, `Add to ${g.name}`)));
    $('addForm').hidden = false;
  }
}

function renderGroups(now) {
  const list = $('groups');
  list.replaceChildren();
  $('empty').hidden = settings.groups.length > 0;
  for (const g of settings.groups) {
    const st = Anchor.evaluateGroup(g, state, now);
    const s = Anchor.describeStatus(st, now);
    const input = el('input', { type: 'checkbox', 'aria-label': `Enable ${g.name}` });
    input.checked = g.enabled;
    input.addEventListener('change', () => toggleGroup(g, input));
    list.append(el('li', { class: g.enabled ? '' : 'off' },
      el('span', { class: 'dot', style: `background:${g.color}` }),
      el('div', { class: 'meta' },
        el('div', { class: 'name' }, g.name),
        el('div', { class: `status ${s.kind}` }, s.text)),
      el('label', { class: 'switch' }, input, el('span'))));
  }
}

async function toggleGroup(group, input) {
  if (!input.checked) {
    input.checked = true;
    if (!(await Challenge.run(group, `turn off “${group.name}”`))) return;
    input.checked = false;
  }
  group.enabled = input.checked;
  await saveSettings();
  render();
}

$('addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const group = settings.groups.find((g) => g.id === $('addGroup').value);
  const site = Anchor.parseSite(Anchor.hostOf(currentUrl));
  if (!group || !site) return;
  if (!group.sites.includes(site)) group.sites.push(site);
  await saveSettings();
  render();
});

function openOptions(hash) {
  browser.tabs.create({ url: browser.runtime.getURL(`src/options/options.html${hash}`) });
  window.close();
}
$('openSettings').addEventListener('click', () => openOptions(''));
$('openStats').addEventListener('click', () => openOptions('#stats'));

const ALL_SITES = { origins: ['<all_urls>'] };
$('grant').addEventListener('click', async () => {
  if (await browser.permissions.request(ALL_SITES)) $('permBanner').hidden = true;
});

(async () => {
  [currentUrl] = await Promise.all([getCurrentUrl(), load()]);
  $('permBanner').hidden = await browser.permissions.contains(ALL_SITES);
  render();
  browser.storage.onChanged.addListener(async () => { await load(); render(); });
})();
