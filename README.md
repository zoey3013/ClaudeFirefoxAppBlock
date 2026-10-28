# Anchor — Focus Blocker for Firefox

Block distracting websites with **focus groups**. Each group has its own schedule, its own pooled time allowance, short breaks and an unlock challenge. Unlocking is meant to be a conscious choice.

## Features

- **Focus groups**: sets of websites that share the same rules, for example "Social" or "Deep work".
- **Two modes per group**:
  - *Block these sites*: a blocklist.
  - *Allow only these sites*: a whitelist where everything else is blocked.
- **Precise matching**: `reddit.com` covers every subdomain (`old.reddit.com`, `m.reddit.com`). `youtube.com/shorts` blocks only that section.
- **Schedule**: blocks fully during set hours on chosen days. You can add several time ranges, run one overnight (22:00 → 06:00), or block the whole day by giving a range the same start and end.
- **Time allowance**: for example, 30 minutes **per day** or **per hour**, *pooled* across every site in the group. When the allowance runs out, the whole group is blocked until it resets.
- **Temporary breaks**: you set how long a break lasts and how many you get per day or hour. You start one from the block page.
- **Unlock protection, set per group**:
  - None
  - **Math puzzle**: three easy problems using + − × ÷. A wrong answer gives you a new set.
  - **PIN code** (4–8 digits): stored as a salted SHA-256 hash, with a cool-down after each wrong guess.

  Taking a break, editing a protected group and turning a group off all require the challenge. Turning a group on or adding a site never does.
- **Stats**: time spent on the web, blocked visits, breaks taken, a chart of the last 7 days, time per group against its allowance, and your top sites.
- **Private windows** are supported once you allow them (see below).
- **Toolbar badge**: shows the minutes left in the current site's allowance.

## How a group decides to block

1. If the group is off, nothing is blocked.
2. During scheduled hours, its sites are blocked.
3. Outside scheduled hours, its sites are open until the pooled allowance is used up.
4. If the group has neither a schedule nor an allowance, its sites are always blocked.
5. While a break is running, the group doesn't block.

Time counts only while a matching site is the active tab in a focused Firefox window. Counting stops when your computer locks or has been idle for 10 minutes.

## Install (development / personal use)

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on…** and pick `manifest.json` from this folder.
3. The settings page opens automatically. If you see an **Allow access** banner, click it.
4. To make blocking work in private windows, go to `about:addons` → **Anchor** → set **Run in Private Windows** to **Allow**.

A temporary add-on is removed when Firefox restarts. To keep Anchor installed permanently without publishing it, sign it as an *unlisted* add-on. This is free and takes a few minutes:

```bash
npx web-ext sign --channel=unlisted --api-key=<JWT issuer> --api-secret=<JWT secret> --ignore-files test
```

Get the API keys at <https://addons.mozilla.org/developers/addon/api/key/>. Then install the `.xpi` file it produces.

## Development

```bash
node --test test/core.test.js        # unit tests for matching, schedules, limits, puzzles
npx web-ext lint --ignore-files test # Mozilla's add-on linter
npx web-ext run                      # launch Firefox with the add-on loaded
```

Plain JavaScript, HTML and CSS with no build step, on Manifest V3.

```
manifest.json
src/core.js            shared logic: model, matching, schedules, limits, puzzles
src/background.js      time tracking, blocking (webRequest + tab sweeps), breaks
src/blocked/           the page shown instead of a blocked site
src/popup/             toolbar popup: current site, quick add, group toggles
src/options/           settings editor and stats
src/ui/                shared styles and the unlock challenge modal
test/                  node unit tests
```

## Limitation

A Firefox add-on can't stop you from disabling or uninstalling it in `about:addons`. The challenge protects your groups, not the add-on itself.
