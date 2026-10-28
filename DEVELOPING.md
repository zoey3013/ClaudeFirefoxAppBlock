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
src/core.js            shared logic: model, matching, schedules, limits, puzzles
src/background.js      time tracking, blocking (webRequest + tab sweeps), breaks
src/blocked/           the page shown instead of a blocked site
src/content/           on-page reminder card and 30-second countdown
src/popup/             toolbar popup: current site, quick add, group toggles
src/options/           settings editor, general preferences and stats
src/ui/                shared styles, theme switching and the unlock challenge
test/                  node unit tests
_locales/              add-on name and description in each language
updates.json           version list Firefox reads for automatic updates
.github/workflows/     release workflow: sign, publish, update updates.json
```
