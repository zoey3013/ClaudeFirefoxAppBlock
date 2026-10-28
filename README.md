# Anchor — Focus Blocker for Firefox

Anchor keeps distracting websites out of your way. You put sites into **focus groups**, and each group has its own rules: when the sites are blocked, how much time you get on them, and how hard it is to unlock them.

## Install

1. Download the latest `anchor-x.y.z.xpi` from the [Releases page](https://github.com/zoey3013/ClaudeFirefoxAppBlock/releases/latest).
2. In Firefox, open `about:addons`, click the ⚙️ menu and choose **Install Add-on From File…**.
3. Select the file you downloaded and confirm.

The settings page opens on its own. If you see an **Allow access** banner, click it: Anchor needs access to websites to block them.

Anchor updates itself after that.

**Private windows:** to block sites there too, open `about:addons` → **Anchor** and set **Run in Private Windows** to **Allow**.

## Getting started

Anchor starts with two example groups: **Social**, which allows 30 minutes a day, and **Deep work**, which blocks during work hours and starts turned off. Change them or create your own from the settings page.

Click the Anchor icon in the toolbar to:
- see how much time you have left on the current site;
- add the current site to a group;
- turn groups on or off.

## What a group can do

**Websites**
- **Block these sites**, or **allow only these sites** and block everything else.
- `reddit.com` also covers its subdomains, like `old.reddit.com`.
- `youtube.com/shorts` blocks only that part of the site.

**Schedule**
- Block the sites completely during set hours on the days you choose, for example Monday to Friday, 9:00 to 17:00.
- You can add several time ranges, and a range can run overnight.

**Time allowance**
- Give yourself a number of minutes **per day** or **per hour**.
- The time is shared by every site in the group: 20 minutes on one site leaves 10 for the rest. When it runs out, all of them are blocked until it resets.

**Temporary breaks**
- When a site is blocked, you can take a short break from the block page, for example 5 minutes.
- You choose how long breaks last and how many you get per day or per hour.

**Unlock protection**
- Make unlocking a conscious choice. Choose **None**, a **Math puzzle** (three easy problems) or a **PIN code**.
- You'll need it to take a break, change the group or turn it off. Turning a group on or adding a site never needs it.

**On-page reminders**, both optional:
- A small note in the corner when you open one of the group's sites. It tells you that your time is counting, how much is left, or when the site will be blocked.
- A countdown in the corner during the last 30 seconds before the site is blocked.

## How blocking works

- If a group is **off**, it blocks nothing.
- During **scheduled hours**, its sites are blocked.
- Outside those hours, its sites stay open until the **time allowance** runs out.
- If a group has neither a schedule nor a time allowance, its sites are **always** blocked.
- During a **break**, the group doesn't block.

Your time only counts while one of the group's sites is the tab you're looking at. It stops when your computer is locked or you've been away for 10 minutes.

## Stats

See your time on the web, how often you opened a blocked site, how many breaks you took, your last 7 days and your most visited sites. Open them from the toolbar icon or the settings page.

## Settings

Under **General** you can choose:
- **Language:** English or Spanish. By default, Anchor uses Firefox's language.
- **Appearance:** light, dark, or the same as your system.

## Privacy

Everything stays on your computer. Anchor doesn't send your browsing, stats or settings anywhere. The only thing it downloads is the list of new versions from this page, to check for updates.

## Good to know

Firefox doesn't let an add-on stop you from turning it off or removing it in `about:addons`. The unlock protection guards your groups, not the add-on itself.
