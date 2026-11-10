# Roadmap

## Done in 1.1.0

- [x] **English / Spanish**: a language picker under *General*. By default it follows Firefox's language.
- [x] **Reminder when you open a site in a group**: a small card in the corner, never full screen. It can be turned on or off per group.
- [x] **Automatic updates through GitHub**: the Release workflow plus `updates.json`. They only work while the repository is public.
- [x] **Countdown in the corner** during the last 30 seconds before a site gets blocked, whether because the allowance runs out, a break ends or the schedule starts. It can be turned on or off per group.

## Done in 1.3.0

- [x] **Lock screen as an overlay, without reloading.** A page that's already open when it gets blocked is covered by the lock screen instead of being sent to the block page, and its videos and audio pause. A break lifts it with the page exactly as it was. Opening a blocked site from scratch still goes to the block page. Where the overlay can't run, Anchor falls back to the block page.
- [x] **Reminders at the top center** of the page.

## Done in 1.4

- [x] **Off on public holidays**, with a country picker under *General* (Dominican Republic for now, from the Ministry of Labor's list, downloaded each new year or on demand).
- [x] **Duplicate group** button.

## To do

- [ ] **Fix: a group that's off for a holiday still shows its time left.** The on-page reminder ("…left today, the clock is running"), the 30-second countdown and the minutes on the toolbar icon still appear on a holiday off, even though the group isn't blocking or counting time.
  - Cause: the background still reports the group's remaining time on its day off. The badge and the reminders check that the group is switched on, but not that it's off today.
  - Fix: leave groups that are off today out of the badge, the reminder card and the countdown. The popup and settings keep showing "Off for {holiday}".
  - Add a Firefox test: on a holiday off, no reminder, no countdown, empty badge.

## Ideas

- Holidays for more countries
- [x] Light / dark mode setting (1.2.0)
- Sync settings across Firefox installs
- Countdown before a break starts
- Export and import groups
