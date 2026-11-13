# Developing Anchor

Plain JavaScript, HTML and CSS, with no build step, on Manifest V3.

## Run it locally

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on…** and pick `manifest.json`.

Firefox removes a temporary add-on when it restarts.

```bash
node --test test/core.test.js                                                     # unit tests
npx web-ext lint --self-hosted --ignore-files "test/**" "scripts/**" ".github/**"  # Mozilla's linter
npx web-ext run                                                                   # Firefox with the add-on loaded
```

## Testing in real Firefox

`test/firefox/e2e.js` loads Anchor into headless Firefox and checks:
- the settings, stats, general and popup pages render;
- a blocked site redirects to the block page;
- a break returns you to the site and shows the reminder card;
- the reminder card and the 30-second countdown sit at the top center;
- Alert mode doesn't block; when a visit reaches its time the alert shows (group color, 5–60 minute choices), "Remind me" closes it without a reload, and "Lock for" turns it into a lock with no break, on all the group's sites; stats count it;
- when the allowance runs out, the open page gets the lock overlay instead of a redirect, its audio pauses (also audio inside a closed shadow DOM, like Reddit's player), and a break lifts it with no reload (scroll position and typed text kept);
- the overlay also works on a page whose security policy forbids frames;
- a group that takes a holiday off doesn't block or show reminders, the holiday list shows, the holidays switch sits in the Schedule card, and Duplicate makes a copy;
- switching to Spanish and to dark mode works;
- no script errors reach Firefox's Browser Console.

It needs Firefox and geckodriver. To have them in every cloud session, use this as the environment's **Setup script**. The network must allow `download.mozilla.org`, `download-installer.cdn.mozilla.net` and `github.com`.

```bash
#!/bin/bash
set -e
if [ ! -x /opt/firefox/firefox ]; then
  curl -fsSL "https://download.mozilla.org/?product=firefox-latest-ssl&os=linux64&lang=en-US" -o /tmp/firefox.tar.xz
  tar -xf /tmp/firefox.tar.xz -C /opt
  ln -sf /opt/firefox/firefox /usr/local/bin/firefox
fi
if ! command -v geckodriver > /dev/null; then
  curl -fsSL https://github.com/mozilla/geckodriver/releases/download/v0.36.0/geckodriver-v0.36.0-linux64.tar.gz | tar -xz -C /usr/local/bin
fi
```

Then:

```bash
cd test/firefox && npm install && npm test
```

Screenshots and the geckodriver log go to `$TMPDIR/anchor-e2e`. Firefox normally refuses to let automation script add-on pages; the test sets `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1` for its own Firefox only.

## Releasing a new version

**One-time setup:**
1. Get API keys at <https://addons.mozilla.org/developers/addon/api/key/>.
2. On GitHub, open **Settings → Secrets and variables → Actions** and add two repository secrets: `AMO_JWT_ISSUER` (the "JWT issuer") and `AMO_JWT_SECRET` (the "JWT secret").
3. Keep the repository **public**. Firefox downloads `updates.json` and the `.xpi` without logging in.

**Each release:**
1. Raise `"version"` in `manifest.json` and push.
2. On GitHub, go to **Actions → Release → Run workflow**.

The workflow:
1. runs the tests;
2. signs the add-on with Mozilla as unlisted;
3. publishes `anchor-<version>.xpi` as a GitHub Release;
4. adds the new version to `updates.json`.

Installed copies read `updates.json` (the manifest's `update_url`) and update themselves within a day.

## Layout

```
manifest.json
src/i18n.js            English and Spanish translations
src/core.js            shared logic: model, matching, schedules, modes (block, allowance, alert), puzzles
src/holidays.js        public holiday sources by country (add a country here)
src/background.js      time tracking, blocking (webRequest + tab sweeps), breaks
src/blocked/           the page shown instead of a blocked site
src/content/           on-page reminder card, 30-second countdown and lock overlay
src/popup/             toolbar popup: current site, quick add, group toggles
src/options/           settings editor, general preferences and stats
src/ui/                shared styles, theme switching and the unlock challenge
test/                  node unit tests; test/firefox/ runs Anchor in real Firefox
_locales/              add-on name and description in each language
updates.json           version list Firefox reads for automatic updates
.github/workflows/     release workflow: sign, publish, update updates.json
```
