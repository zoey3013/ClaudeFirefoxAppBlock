// Run with: node --test test/
const test = require('node:test');
const assert = require('node:assert');
const A = require('../src/core.js');

const at = (s) => new Date(s).getTime();

test('parseSite normalizes input', () => {
  assert.equal(A.parseSite('https://www.YouTube.com/shorts/'), 'youtube.com/shorts');
  assert.equal(A.parseSite('reddit.com'), 'reddit.com');
  assert.equal(A.parseSite('*.example.org'), 'example.org');
  assert.equal(A.parseSite('not a site'), null);
  assert.equal(A.parseSite('foo'), null);
});

test('siteMatches covers subdomains and paths', () => {
  assert.ok(A.siteMatches('youtube.com', 'https://m.youtube.com/watch?v=1'));
  assert.ok(!A.siteMatches('youtube.com', 'https://notyoutube.com/'));
  assert.ok(A.siteMatches('youtube.com/shorts', 'https://www.youtube.com/shorts/abc'));
  assert.ok(A.siteMatches('youtube.com/shorts', 'https://www.youtube.com/shorts'));
  assert.ok(!A.siteMatches('youtube.com/shorts', 'https://www.youtube.com/shortsx'));
  assert.ok(!A.siteMatches('youtube.com/shorts', 'https://www.youtube.com/watch'));
});

test('allow mode blocks everything except listed sites', () => {
  const g = A.newGroup('W');
  g.mode = 'allow';
  g.sites = ['docs.google.com'];
  assert.ok(!A.groupMatches(g, 'https://docs.google.com/x'));
  assert.ok(A.groupMatches(g, 'https://reddit.com/'));
  assert.ok(!A.groupMatches(g, 'about:newtab'));
});

test('schedule including overnight and all-day', () => {
  const s = { enabled: true, rules: [{ days: [1], start: '22:00', end: '06:00' }] };
  assert.ok(A.scheduleActive(s, at('2026-10-26T23:00')));  // Monday night
  assert.ok(A.scheduleActive(s, at('2026-10-27T05:59')));  // Tuesday early
  assert.ok(!A.scheduleActive(s, at('2026-10-27T06:00')));
  assert.ok(!A.scheduleActive(s, at('2026-10-26T21:59')));
  const all = { enabled: true, rules: [{ days: [3], start: '00:00', end: '00:00' }] };
  assert.ok(A.scheduleActive(all, at('2026-10-28T13:00'))); // Wednesday
  const work = { enabled: true, rules: [{ days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }] };
  assert.equal(A.nextScheduleChange(work, at('2026-10-28T10:30')), at('2026-10-28T17:00'));
});

test('pooled limit blocks the whole group once used up', () => {
  const settings = { groups: [A.newGroup('Social')] };
  const g = settings.groups[0];
  g.sites = ['reddit.com', 'x.com'];
  g.limit = { enabled: true, minutes: 10, period: 'day' };
  const state = A.emptyState();
  const t0 = at('2026-10-28T10:00');
  A.recordUsage(settings, state, 'https://reddit.com/r/a', t0, t0 + 6 * 60000);
  assert.equal(A.evaluateUrl('https://x.com/', settings, state, t0 + 6 * 60000).blocker, null);
  A.recordUsage(settings, state, 'https://x.com/home', t0 + 6 * 60000, t0 + 10 * 60000);
  const r = A.evaluateUrl('https://x.com/', settings, state, t0 + 10 * 60000);
  assert.equal(r.blocker.reason, 'limit');
  assert.equal(state.sites['2026-10-28']['reddit.com'], 360);
});

test('hour limit splits usage across hour boundaries', () => {
  const settings = { groups: [A.newGroup('H')] };
  const g = settings.groups[0];
  g.sites = ['a.com'];
  g.limit = { enabled: true, minutes: 5, period: 'hour' };
  const state = A.emptyState();
  A.recordUsage(settings, state, 'https://a.com', at('2026-10-28T10:58'), at('2026-10-28T11:01'));
  assert.equal(A.usedSeconds(state, g.id, 'hour', at('2026-10-28T11:02')), 60);
  assert.equal(A.usedSeconds(state, g.id, 'day', at('2026-10-28T11:02')), 180);
});

test('no schedule and no limit means always blocked; bypass lifts it', () => {
  const settings = { groups: [A.newGroup('A')] };
  const g = settings.groups[0];
  g.sites = ['a.com'];
  g.limit.enabled = false;
  const state = A.emptyState();
  const now = Date.now();
  assert.equal(A.evaluateUrl('https://a.com', settings, state, now).blocker.reason, 'always');
  state.bypass[g.id] = { until: now + 60000, uses: [now] };
  assert.equal(A.evaluateUrl('https://a.com', settings, state, now).blocker, null);
  assert.equal(A.bypassUsesLeft(g, state, now), 2);
  g.enabled = false;
  state.bypass = {};
  assert.equal(A.evaluateUrl('https://a.com', settings, state, now).blocker, null);
});

test('puzzle has three problems with distinct ops and integer answers', () => {
  for (let i = 0; i < 200; i++) {
    const p = A.makePuzzle();
    assert.equal(p.length, 3);
    const ops = new Set(p.map((x) => x.text.split(' ')[1]));
    assert.equal(ops.size, 3);
    for (const x of p) assert.ok(Number.isInteger(x.answer) && x.answer > 0, x.text);
  }
});

test('pin hashing is salted and stable', async () => {
  assert.equal(await A.hashPin('1234', 's'), await A.hashPin('1234', 's'));
  assert.notEqual(await A.hashPin('1234', 's'), await A.hashPin('1234', 't'));
});

test('older settings gain new fields', () => {
  const old = { version: 1, groups: [{ ...A.newGroup('X'), reminders: undefined }] };
  delete old.groups[0].reminders;
  const s = A.normalizeSettings(old);
  assert.equal(s.language, 'auto');
  assert.deepEqual(s.groups[0].reminders, { card: true, countdown: true });
});

test('translations: every Spanish key exists in English and vice versa', () => {
  const I18n = require('../src/i18n.js');
  I18n.setLanguage('es');
  assert.equal(I18n.t('addTo', { name: 'Social' }), 'Añadir a Social');
  assert.equal(I18n.t('nSites', { n: 1 }), '1 sitio');
  assert.equal(I18n.t('nSites', { n: 3 }), '3 sitios');
  const src = require('fs').readFileSync(require('path').join(__dirname, '../src/i18n.js'), 'utf8');
  const block = (name) => src.slice(src.indexOf(`    ${name}: {`), src.indexOf('\n    },', src.indexOf(`    ${name}: {`)));
  const keys = (b) => new Set([...b.matchAll(/^ {6}(\w+):/gm)].map((m) => m[1]));
  const en = keys(block('en')), es = keys(block('es'));
  assert.deepEqual([...en].filter((k) => !es.has(k)), []);
  assert.deepEqual([...es].filter((k) => !en.has(k)), []);
  I18n.setLanguage('en');
});

test('every t() key used in the UI exists', () => {
  const fs = require('fs'), path = require('path');
  const i18nSrc = fs.readFileSync(path.join(__dirname, '../src/i18n.js'), 'utf8');
  const enBlock = i18nSrc.slice(i18nSrc.indexOf('    en: {'), i18nSrc.indexOf('    es: {'));
  const known = new Set([...enBlock.matchAll(/^ {6}(\w+):/gm)].map((m) => m[1]));
  const files = ['blocked/blocked.js', 'popup/popup.js', 'options/options.js', 'options/stats.js', 'ui/challenge.js', 'content/content.js', 'core.js',
    'blocked/blocked.html', 'popup/popup.html', 'options/options.html'];
  const missing = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(__dirname, '../src', f), 'utf8');
    for (const m of src.matchAll(/(?:\bt|I18n\.t|tr)\('(\w+)'|data-i18n(?:-aria|-title)?="(\w+)"/g)) {
      const k = m[1] || m[2];
      if (!known.has(k)) missing.push(`${f}: ${k}`);
    }
  }
  assert.deepEqual(missing, []);
});
