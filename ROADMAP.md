# Roadmap

## Done in 1.1.0

- [x] **English / Spanish**: a language picker under *General*. By default it follows Firefox's language.
- [x] **Reminder when you open a site in a group**: a small card in the corner, never full screen. It can be turned on or off per group.
- [x] **Automatic updates through GitHub**: the Release workflow plus `updates.json`. They only work while the repository is public.
- [x] **Countdown in the corner** during the last 30 seconds before a site gets blocked, whether because the allowance runs out, a break ends or the schedule starts. It can be turned on or off per group.

## To do

- [ ] **Lock screen as an overlay, without reloading.** When a page that's already open gets blocked (allowance runs out, break ends, schedule starts), cover it with a full-page overlay instead of redirecting the tab, and pause its videos and audio. Taking a break or unlocking removes the overlay, so you keep your scroll position, video time and anything you typed.
  - Opening a blocked site from scratch still redirects to the block page, so the site never loads in the background.
  - Fall back to the redirect wherever Firefox doesn't let add-ons run, such as addons.mozilla.org and `about:` pages, or tabs opened before Anchor was installed.

- [ ] **Block by category.** In a group, tick categories such as *Social media*, *Video & streaming*, *News*, *Shopping*, *Games* or *Adult*, on top of or instead of individual sites.
  - Use open, public category lists. Ship a small built-in copy and refresh it now and then, so new sites in a category get blocked automatically.
  - Match everything on the computer: never send visited sites to an outside service.
  - Let a group allow specific sites even when their category is blocked, because lists can put a site in the wrong category or miss it.
  - Very large categories, such as *Adult*, are downloaded only when someone turns them on.
  - Check each list's license before bundling it.

## Ideas

- [x] Light / dark mode setting (1.2.0)
- Sync settings across Firefox installs
- Countdown before a break starts
- Export and import groups
