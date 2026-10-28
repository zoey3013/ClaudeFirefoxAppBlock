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

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<!doctype html><title>Test site</title><h1>Test site ${req.url}</h1>`);
}).listen(8123, '127.0.0.1');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const xpi = path.join(OUT, 'anchor-test.xpi');
  fs.writeFileSync(xpi, zipDir(ADDON, ['.git', 'test', 'scripts', '.github', 'web-ext-artifacts', 'node_modules']));

  const opts = new firefox.Options()
    .addArguments('-headless')
    .setPreference('extensions.webextensions.uuids', JSON.stringify({ 'anchor-focus@local': UUID }))
    .setPreference('network.proxy.type', 0)
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
    check('general page renders', (await count('#general .card')) === 3);

    // "Test" always blocks 127.0.0.1, no lock, 5-minute breaks.
    await run(async () => {
      const { settings } = await browser.storage.local.get('settings');
      const g = settings.groups[0];
      Object.assign(g, { name: 'Test', enabled: true, mode: 'block', sites: ['127.0.0.1'] });
      g.schedule.enabled = false; g.limit.enabled = false; g.lock.method = 'none';
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
    await shot('ff-card');

    // Allowance: 1 minute, 35 s already used -> countdown, then blocked.
    await goExt('src/options/options.html');
    await run(async () => {
      const { settings, state } = await browser.storage.local.get(['settings', 'state']);
      const g = settings.groups[0];
      g.limit = { enabled: true, minutes: 1, period: 'day' };
      const s = Anchor.normalizeState(state);
      s.bypass = {};
      s.usage[g.id] = { [Anchor.hourKey()]: 35 };
      await browser.storage.local.set({ settings, state: s });
    });
    await sleep(300);
    await goSite('/feed'); await sleep(2500);
    const pill = await text('anchor-focus-time');
    check('countdown shows under 30 s left', !!pill, pill || 'none');
    await shot('ff-countdown');
    let blockedAfter = null;
    for (let i = 0; i < 45; i++) {
      await sleep(1000);
      if ((await driver.getCurrentUrl()).startsWith(EXT)) { blockedAfter = i + 3; break; }
    }
    check('site is blocked when the allowance runs out', !!blockedAfter, blockedAfter ? `after ~${blockedAfter}s` : 'still open after 48s');
    check('block reason mentions the limit', /used your/.test((await text('#reason')) || ''), await text('#reason'));

    await goExt('src/popup/popup.html');
    check('popup renders groups', (await count('#groups li')) === 2);

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
