// End-to-end test of Anchor in real (headless) Firefox via geckodriver.
// Usage (from the repo root): node test/firefox/e2e.js . <folder for screenshots and logs>
// Needs Firefox, geckodriver and `npm install` in test/firefox (see DEVELOPING.md).
const { Builder, By, until } = require('selenium-webdriver');
const firefox = require('selenium-webdriver/firefox');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), zlib = require('zlib');

const ADDON = path.resolve(process.argv[2] || '.');
const OUT = path.resolve(process.argv[3] || os.tmpdir());
const UUID = '7d3c6a1e-0b6f-4f8e-9a51-2f7e3c1d9b10';
const EXT = `moz-extension://${UUID}`;
const SITE = 'http://127.0.0.1:8123';
const LOG = path.join(OUT, 'firefox.log');
// Lets WebDriver script Anchor's own (privileged) moz-extension:// pages.
process.env.MOZ_REMOTE_ALLOW_SYSTEM_ACCESS = '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);

// Minimal zip writer (stored + deflate) so the test needs no extra packages.
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function zipDir(dir, skip) {
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const full = path.join(d, e.name), rel = path.relative(dir, full).split(path.sep).join('/');
    if (skip.some((s) => rel === s || rel.startsWith(s + '/'))) continue;
    if (e.isDirectory()) walk(full); else files.push([rel, fs.readFileSync(full)]);
  } };
  walk(dir);
  const parts = [], central = []; let offset = 0;
  for (const [name, data] of files) {
    const comp = zlib.deflateRawSync(data), n = Buffer.from(name), crc = crc32(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26);
    parts.push(h, n, comp);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, n); offset += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

// One second of silence, so the test can check that the lock pauses media and a break resumes it.
function silentWav() {
  const rate = 8000, n = rate, b = Buffer.alloc(44 + n);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate, 28);
  b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40); b.fill(128, 44);
  return b;
}

const server = http.createServer((req, res) => {
  if (req.url === '/silence.wav') { res.writeHead(200, { 'content-type': 'audio/wav' }); res.end(silentWav()); return; }
  const headers = { 'content-type': 'text/html' };
  // A strict page policy that forbids frames, to check the overlay's fallback.
  if (req.url.startsWith('/strict')) headers['content-security-policy'] = "default-src 'self'; frame-src 'none'";
  res.writeHead(200, headers);
  res.end(`<!doctype html><title>Test site</title><h1>Test site ${req.url}</h1>
    <input id="note"><audio id="snd" src="/silence.wav" loop></audio>
    <shadow-player id="sp"></shadow-player>
    <script>
      // Like Reddit: the player sits inside a closed shadow DOM the page's own code can't reach.
      const root = document.getElementById('sp').attachShadow({ mode: 'closed' });
      const a = document.createElement('audio'); a.src = '/silence.wav'; a.loop = true; root.append(a);
      window.shadowAudio = a;
    </script>
    <div style="height:4000px;background:linear-gradient(#eef,#fee)"></div>`);
}).listen(8123, '127.0.0.1');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const xpi = path.join(OUT, 'anchor-test.xpi');
  fs.writeFileSync(xpi, zipDir(ADDON, ['.git', 'test', 'scripts', '.github', 'web-ext-artifacts', 'node_modules']));

  const opts = new firefox.Options()
    .addArguments('-headless')
    .setPreference('extensions.webextensions.uuids', JSON.stringify({ 'anchor-focus@local': UUID }))
    .setPreference('network.proxy.type', 0)
    .setPreference('media.autoplay.default', 0)
    .setPreference('devtools.console.stdout.content', true)
    .setPreference('devtools.console.stdout.chrome', true);
  if (fs.existsSync('/opt/firefox/firefox')) opts.setBinary('/opt/firefox/firefox');
  const service = new firefox.ServiceBuilder().setStdio(['ignore', fs.openSync(LOG, 'w'), fs.openSync(LOG, 'a')]);
  const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(opts).setFirefoxService(service).build();

  const shot = async (name) => fs.writeFileSync(path.join(OUT, `${name}.png`), await driver.takeScreenshot(), 'base64');
  const text = async (css) => { try { return await driver.findElement(By.css(css)).getText(); } catch { return null; } };
  const count = async (css) => (await driver.findElements(By.css(css))).length;
  const run = (fn, ...args) => driver.executeAsyncScript(`const done = arguments[arguments.length - 1];
    (${fn})(...Array.from(arguments).slice(0, -1)).then((v) => done(v), (e) => done('ERROR ' + e.message));`, ...args);

  try {
    await driver.manage().window().setRect({ width: 1200, height: 900 });
    const id = await driver.installAddon(xpi, true);
    check('add-on installs', id === 'anchor-focus@local', id);
    await sleep(1500);

    // Automation can't type moz-extension:// URLs, so keep the settings tab the add-on opened
    // and move between Anchor's pages from inside it.
    let settingsTab = null;
    for (const h of await driver.getAllWindowHandles()) {
      await driver.switchTo().window(h);
      if ((await driver.getCurrentUrl()).includes('/src/options/options.html')) settingsTab = h;
    }
    check('settings page opens on install', !!settingsTab);
    const goExt = async (p) => {
      await driver.switchTo().window(settingsTab);
      await driver.executeScript('location.href = arguments[0]', `${EXT}/${p}`);
      await sleep(700);
    };
    await driver.switchTo().newWindow('tab');
    const siteTab = await driver.getWindowHandle();
    const goSite = async (p) => { await driver.switchTo().window(siteTab); await driver.get(`${SITE}${p}`); };
    await goExt('src/options/options.html');
    await driver.wait(until.elementLocated(By.css('#groupNav .nav-item')), 5000).catch(() => {});
    const names = await driver.findElements(By.css('#groupNav .nav-item .name'));
    check('settings page lists default groups', names.length === 2, (await Promise.all(names.map((n) => n.getText()))).join(', '));
    check('host permission granted', (await run(() => browser.permissions.contains({ origins: ['<all_urls>'] }))) === true);
    await shot('ff-options');

    await driver.findElement(By.id('navStats')).click(); await sleep(400);
    check('stats page renders', (await count('#stats > *')) >= 4);
    await shot('ff-stats');
    await driver.findElement(By.id('navGeneral')).click(); await sleep(300);
    check('general page renders', (await count('#general .card')) === 4);

    // "Test" always blocks 127.0.0.1, no lock, 5-minute breaks.
    await run(async () => {
      const { settings } = await browser.storage.local.get('settings');
      const g = settings.groups[0];
      Object.assign(g, { name: 'Test', enabled: true, mode: 'block', sites: ['127.0.0.1'] });
      g.schedule.enabled = false; g.behavior = 'block'; g.lock.method = 'none';
      g.bypass = { enabled: true, minutes: 5, maxUses: 3, period: 'day' };
      settings.groups[1].enabled = false;
      await browser.storage.local.set({ settings });
    });
    await sleep(500);

    await goSite('/watch'); await sleep(1200);
    const blockedUrl = await driver.getCurrentUrl();
    check('blocked site redirects to block page', blockedUrl.startsWith(`${EXT}/src/blocked/blocked.html`), blockedUrl.slice(0, 80));
    check('block page shows title', /blocked/.test((await text('#title')) || ''), await text('#title'));
    await shot('ff-blocked');

    await driver.findElement(By.id('bypass')).click(); await sleep(2500);
    const after = await driver.getCurrentUrl();
    check('break returns to the site', after.startsWith(`${SITE}/watch`), after);
    const card = await text('anchor-focus-card');
    check('on-page reminder card appears', !!card, card ? card.replace(/\s+/g, ' ') : 'none');
    const topCenter = (css) => driver.executeScript(`const r = document.querySelector(arguments[0]).getBoundingClientRect();
      return Math.abs(r.left + r.width / 2 - document.documentElement.clientWidth / 2) < 4 && r.top < 40;`, css);
    check('reminder card is at the top center', await topCenter('anchor-focus-card').catch(() => false));
    await shot('ff-card');

    // Allowance: 1 minute, 35 s already used -> countdown, then the open page gets the lock overlay.
    await goExt('src/options/options.html');
    await run(async () => {
      const { settings, state } = await browser.storage.local.get(['settings', 'state']);
      const g = settings.groups[0];
      g.behavior = 'allowance';
      g.limit = { minutes: 1, period: 'day' };
      const s = Anchor.normalizeState(state);
      s.bypass = {};
      s.usage[g.id] = { [Anchor.hourKey()]: 35 };
      await browser.storage.local.set({ settings, state: s });
    });
    await sleep(300);
    await goSite('/feed'); await sleep(2500);
    // Page state that a reload would lose.
    await driver.findElement(By.id('note')).sendKeys('half-written comment');
    await driver.executeScript(`window.scrollTo(0, 1500); window.marker = 'same page'; document.getElementById('snd').play(); window.shadowAudio.play();`);
    const pill = await text('anchor-focus-time');
    check('countdown shows under 30 s left', !!pill, pill || 'none');
    check('countdown is at the top center', await topCenter('anchor-focus-countdown').catch(() => false));
    await shot('ff-countdown');
    let lockedAfter = null;
    for (let i = 0; i < 45; i++) {
      await sleep(1000);
      if (await count('anchor-focus-lock')) { lockedAfter = i + 3; break; }
    }
    check('lock overlay covers the page when the allowance runs out', !!lockedAfter, lockedAfter ? `after ~${lockedAfter}s` : 'no overlay after 48s');
    await sleep(800);
    check('page stays open underneath (no redirect)', (await driver.getCurrentUrl()).startsWith(`${SITE}/feed`), await driver.getCurrentUrl());
    check('audio is paused while locked', await driver.executeScript('return document.getElementById("snd").paused'));
    check('audio inside a closed shadow DOM is paused too (Reddit)', await driver.executeScript('return window.shadowAudio.paused'));
    await shot('ff-lock-overlay');

    await driver.switchTo().frame(await driver.findElement(By.css('anchor-focus-lock iframe')));
    check('overlay shows the limit reason', /used your/.test((await text('#reason')) || ''), await text('#reason'));
    await driver.findElement(By.id('bypass')).click();
    await driver.switchTo().defaultContent();
    await sleep(2000);
    check('break lifts the overlay', (await count('anchor-focus-lock')) === 0);
    const kept = await driver.executeScript(`return { marker: window.marker, y: Math.round(scrollY),
      note: document.getElementById('note').value, playing: !document.getElementById('snd').paused, shadowPlaying: !window.shadowAudio.paused };`);
    check('no reload: page, scroll and typed text kept', kept.marker === 'same page' && kept.y === 1500 && kept.note === 'half-written comment', JSON.stringify(kept));
    check('audio resumes after the break', kept.playing && kept.shadowPlaying);

    // A page whose security policy forbids frames: falls back to the block page.
    await goSite('/strict'); await sleep(1500);
    await goExt('src/options/options.html');
    await run(async () => {
      const { state } = await browser.storage.local.get('state');
      for (const bp of Object.values(state.bypass)) bp.until = 0; // end the break
      await browser.storage.local.set({ state });
      await browser.runtime.sendMessage({ type: 'tick' });
    });
    await driver.switchTo().window(siteTab);
    await sleep(5000);
    const strictUrl = await driver.getCurrentUrl();
    const strictOverlay = await count('anchor-focus-lock');
    check('strict page is still blocked (overlay or block page)', strictUrl.startsWith(EXT) || strictOverlay > 0,
      strictUrl.startsWith(EXT) ? 'fell back to the block page' : 'overlay shown');

    // Alert mode: never blocks; when a visit reaches its time, the alert screen asks.
    await goExt('src/options/options.html');
    const siteTabId = await run(async (site) => {
      const { settings, state } = await browser.storage.local.get(['settings', 'state']);
      const g = settings.groups[0];
      Object.assign(g, { behavior: 'alert', alert: { every: 1 }, color: '#e34948' });
      g.schedule.enabled = false;
      const s = Anchor.normalizeState(state);
      s.bypass = {}; s.alertLock = {};
      await browser.storage.local.set({ settings, state: s });
      return (await browser.tabs.query({})).find((t) => t.url.startsWith(site)).id;
    }, SITE);
    await goSite('/alert'); await sleep(1500);
    check('alert mode does not block', (await driver.getCurrentUrl()).startsWith(`${SITE}/alert`) && !(await count('anchor-focus-lock')));
    await driver.executeScript(`window.marker = 'alert page'; window.scrollTo(0, 800);`);
    const askNow = async (secs) => {
      await goExt('src/options/options.html');
      await run(async (tabId, secs) => {
        const { settings } = await browser.storage.local.get('settings');
        const gid = settings.groups[0].id;
        await browser.storage.session.set({ visits: { [tabId]: { [gid]: { secs, askAt: 60, dismissed: false, asking: false } } } });
      }, siteTabId, secs);
      await driver.switchTo().window(siteTab); // switching tabs makes Anchor check
      await sleep(2500);
    };
    await askNow(61);
    check('alert screen appears after the visit time', (await count('anchor-focus-lock')) === 1);
    await driver.switchTo().frame(await driver.findElement(By.css('anchor-focus-lock iframe')));
    const alertInfo = await driver.executeScript(`return { shown: !document.getElementById('alertView').hidden,
      title: document.getElementById('alertTitle').textContent, accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
      options: [...document.getElementById('alertLockMin').options].map((o) => o.value).join(',') };`);
    check('alert asks "been here" with the group color', alertInfo.shown && /been here for 1m/.test(alertInfo.title) && alertInfo.accent === '#e34948', JSON.stringify(alertInfo));
    check('alert offers 5/10/15/30/60 minutes', alertInfo.options === '5,10,15,30,60');
    await driver.switchTo().defaultContent();
    await shot('ff-alert');
    await driver.switchTo().frame(await driver.findElement(By.css('anchor-focus-lock iframe')));
    await driver.findElement(By.css('#alertRemindMin option[value="5"]')).click();
    await driver.findElement(By.id('alertRemind')).click();
    await driver.switchTo().defaultContent();
    await sleep(1500);
    const afterRemind = await driver.executeScript('return { marker: window.marker, y: Math.round(scrollY) }');
    check('"Remind me" closes the alert without a reload', (await count('anchor-focus-lock')) === 0 && afterRemind.marker === 'alert page' && afterRemind.y === 800, JSON.stringify(afterRemind));

    await askNow(400);
    await driver.switchTo().frame(await driver.findElement(By.css('anchor-focus-lock iframe')));
    await driver.findElement(By.id('alertLock')).click();
    await driver.switchTo().defaultContent();
    await sleep(2500);
    await driver.switchTo().frame(await driver.findElement(By.css('anchor-focus-lock iframe')));
    const lockView = await driver.executeScript(`return { block: !document.getElementById('blockView').hidden,
      reason: document.getElementById('reason').textContent, breakShown: !document.getElementById('bypass').hidden,
      disableShown: !document.getElementById('disable').hidden };`);
    await driver.switchTo().defaultContent();
    check('"Lock for" turns the alert into the lock screen', lockView.block && /locked/.test(lockView.reason), lockView.reason);
    check('a lock from an alert has no break or turn-off', !lockView.breakShown && !lockView.disableShown);
    await shot('ff-alert-lock');
    await goSite('/elsewhere'); await sleep(1200);
    check('other sites of the group are locked too', (await driver.getCurrentUrl()).startsWith(EXT), await driver.getCurrentUrl());
    await goExt('src/options/options.html');
    const alertCounts = await run(async () => {
      const { settings, state } = await browser.storage.local.get(['settings', 'state']);
      const counts = state.alerts[Anchor.dayKey()][settings.groups[0].id];
      state.alertLock = {}; // end the lock for the next steps
      settings.groups[0].behavior = 'block';
      await browser.storage.local.set({ state, settings });
      return counts;
    });
    check('stats count alerts and answers', alertCounts && alertCounts.shown === 2 && alertCounts.remind === 1 && alertCounts.lock === 1, JSON.stringify(alertCounts));

    // Holidays: country dropdown; with today as a holiday, "Off on holidays" lets the site open.
    await goExt('src/options/options.html#general');
    const countries = await driver.findElements(By.css('#general select[aria-label="Country"] option'));
    check('country dropdown offers Dominican Republic', (await Promise.all(countries.map((o) => o.getText()))).includes('Dominican Republic'));
    await run(async () => {
      const { settings, state } = await browser.storage.local.get(['settings', 'state']);
      settings.country = 'DO';
      settings.groups[0].behavior = 'block';
      // Scheduled all day, every day: blocks, except on a holiday off.
      settings.groups[0].schedule = { enabled: true, rules: [{ days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '00:00' }] };
      settings.groups[0].holidaysOff = true;
      await browser.storage.local.set({ settings });
      await new Promise((r) => setTimeout(r, 1500)); // the download fails here (no internet): the copy below stays
      const s = Anchor.normalizeState((await browser.storage.local.get('state')).state);
      s.holidays = { country: 'DO', fetchedAt: Date.now(), failedAt: 0, days: [{ date: Anchor.dayKey(), name: 'Test holiday' }] };
      await browser.storage.local.set({ state: s });
    });
    await goExt('src/options/options.html#general'); await sleep(500);
    check('holiday list shows in General', /Test holiday/.test((await text('.holiday-list')) || ''), await text('.holiday-list'));
    await shot('ff-holidays');
    await goSite('/holiday'); await sleep(1200);
    check('group off on a holiday does not block', (await driver.getCurrentUrl()).startsWith(`${SITE}/holiday`), await driver.getCurrentUrl());
    check('no reminder on a holiday off', (await count('anchor-focus-card')) === 0 && (await count('anchor-focus-countdown')) === 0);

    await goExt('src/popup/popup.html');
    check('popup says the group is off for the holiday', /Off for Test holiday/.test((await text('#groups')) || ''), (await text('#groups') || '').replace(/\s+/g, ' '));

    // Duplicate.
    await goExt('src/options/options.html');
    for (const b of await driver.findElements(By.css('.danger-zone .btn'))) if ((await b.getText()) === 'Duplicate group') { await b.click(); break; }
    await sleep(600);
    const afterDup = await Promise.all((await driver.findElements(By.css('#groupNav .nav-item .name'))).map((n) => n.getText()));
    check('duplicate adds a copy right after the group', afterDup.length === 3 && afterDup[1] === 'Test (copy)', afterDup.join(', '));
    const inSchedule = await driver.executeScript(`return [...document.querySelectorAll('#editor .card')]
      .some((c) => /Schedule/.test(c.querySelector('h2')?.textContent || '') && /Off on public holidays/.test(c.textContent));`);
    check('holidays switch is in the Schedule card', inSchedule);
    await driver.executeScript(`[...document.querySelectorAll('#editor .card h2')].find((h) => h.textContent === 'Schedule').scrollIntoView({ block: 'center' })`);
    await shot('ff-schedule-card');

    await goExt('src/popup/popup.html');
    check('popup renders groups', (await count('#groups li')) === 3);

    await goExt('src/options/options.html#general');
    await driver.findElement(By.css('#general select option[value="es"]')).click(); await sleep(500);
    check('switch to Spanish', (await text('#navStats .name')) === 'Estadísticas', await text('#navStats .name'));
    for (const b of await driver.findElements(By.css('#general .segmented button'))) if ((await b.getText()) === 'Oscuro') await b.click();
    await sleep(300);
    check('switch to dark theme', (await driver.executeScript('return document.documentElement.dataset.theme')) === 'dark');
    await shot('ff-general-es-dark');
  } catch (e) {
    check('test ran to the end', false, e.message.split('\n')[0]);
  }
  try {
    // Every script error from Anchor's pages, background and content scripts lands in the Browser Console.
    await driver.setContext('chrome');
    const errors = await driver.executeScript(`
      return Services.console.getMessageArray()
        .filter((m) => m instanceof Ci.nsIScriptError && !(m.flags & Ci.nsIScriptError.warningFlag))
        .filter((m) => (m.sourceName || '').includes(arguments[0]))
        // Firefox notes when a reply arrives after its page has gone (tab navigated away
        // mid-refresh). That's page lifecycle, not an Anchor bug.
        .filter((m) => !/(after context unloaded|while context is inactive)/.test(m.errorMessage || ''))
        .map((m) => (m.sourceName || '').split('/').slice(3).join('/') + ':' + m.lineNumber + ' ' + m.errorMessage);`, UUID);
    check('no script errors from Anchor (Browser Console)', errors.length === 0, errors.slice(0, 5).join(' | '));
  } catch (e) {
    check('read Browser Console', false, e.message.split('\n')[0]);
  } finally {
    await driver.quit();
    server.close();
  }
  console.log(results.join('\n'));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
