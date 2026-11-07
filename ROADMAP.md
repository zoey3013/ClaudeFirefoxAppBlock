# Roadmap

## Done in 1.1.0

- [x] **English / Spanish**: a language picker under *General*. By default it follows Firefox's language.
- [x] **Reminder when you open a site in a group**: a small card in the corner, never full screen. It can be turned on or off per group.
- [x] **Automatic updates through GitHub**: the Release workflow plus `updates.json`. They only work while the repository is public.
- [x] **Countdown in the corner** during the last 30 seconds before a site gets blocked, whether because the allowance runs out, a break ends or the schedule starts. It can be turned on or off per group.

## Done in 1.3.0

- [x] **Lock screen as an overlay, without reloading.** A page that's already open when it gets blocked is covered by the lock screen instead of being sent to the block page, and its videos and audio pause. A break lifts it with the page exactly as it was. Opening a blocked site from scratch still goes to the block page. Where the overlay can't run, Anchor falls back to the block page.
- [x] **Reminders at the top center** of the page.

## To do

- [ ] **Different settings for different days, picked like a phone alarm.** A group can have more than one set of rules, each for the days you tick (M T W T F S S). For example: Monday to Friday, 30 minutes a day; Saturday and Sunday, 2 hours; or on during the week and off on weekends.
  - Covers the time allowance, breaks (length and how many) and whether the group is on at all. The schedule already picks its own days.
  - Optional per group: by default every day uses the same rules, as today.
  - A day can belong to only one set, so it's always clear which rules apply. Days left unticked use the group's main rules.
  - The popup, block page and reminders use whichever set applies today. A daily allowance resets at midnight as usual, so each day starts with its own amount.

- [ ] **Days off on public holidays.** A per-group switch, *Off on holidays*: on a public holiday the group doesn't block at all.
  - Dominican Republic holidays come from the Ministry of Labor's list (`https://webapi.mt.gob.do/api/holidays`), which also covers holidays moved to a Monday.
  - Anchor downloads the list now and then and keeps a copy, so holidays still work offline. If the list can't be reached, nothing changes.
  - *General* settings show the holidays Anchor knows about for this year, so you can check them.
  - Leave room for other countries later; Dominican Republic first.

## Ideas

- [x] Light / dark mode setting (1.2.0)
- Sync settings across Firefox installs
- Countdown before a break starts
- Export and import groups
