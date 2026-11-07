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

- [ ] **Different settings for weekdays and weekends.** Each group can have a weekend version of its rules, for example 30 minutes a day on weekdays and 2 hours on Saturday and Sunday, or on during the week and off on weekends.
  - Covers the time allowance, breaks (length and how many) and whether the group is on at all. The schedule already picks its own days.
  - Optional per group: by default every day uses the same settings, as today.
  - The settings page shows a *Weekdays / Weekend* switch on the cards that can differ. The popup, block page and reminders use whichever applies today.
  - A daily allowance resets at midnight as usual, so Saturday starts with the weekend amount.

## Ideas

- [x] Light / dark mode setting (1.2.0)
- Sync settings across Firefox installs
- Countdown before a break starts
- Export and import groups
