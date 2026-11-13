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

- [ ] **Mode card: Block, Time allowance or Alert.** Each group picks one mode in a new *Mode* card, which shows that mode's options.
  - **Block:** the group's sites are blocked.
  - **Time allowance:** X minutes per day or per hour, shared by the group's sites, then blocked until it resets.
  - **Alert:** never blocks on its own. After X minutes in a row on the group's sites (its own setting), it asks. Details below.
  - **Breaks** and **Unlock protection** stay separate cards, not tied to a mode. They apply whenever the group blocks, in Block or Time allowance mode. A lock chosen from an alert has no early way out.
  - **Existing groups:** a group with an allowance becomes *Time allowance*; one with only a schedule becomes *Block*. A group that had both keeps the allowance, and the schedule now means its active hours (see below), so check those groups by hand.

- [ ] **The schedule works with every mode.** The schedule now sets *when the group is active*, whatever its mode.
  - Inside the schedule's hours, the mode applies: Block blocks, the allowance counts down, Alert asks.
  - Outside them, the group rests: it doesn't block, ask or count time.
  - With the schedule off, the mode applies all day, every day.
  - Only time inside the active hours counts toward the allowance. It still resets daily or hourly.
  - *Off on public holidays* stays in the Schedule card.

- [ ] **Alert screen.** The same lock-screen overlay (covers the page, pauses video), with the group's color as the accent. It reads "You've been here for X minutes. Do you want to stay?", where X is this visit, with today's total in smaller text underneath.
  - **Three buttons, no math or PIN:**
    - **Dismiss:** leave me alone for the rest of this visit. A visit ends when you leave the group's sites or close the tab.
    - **Remind me in [5 / 10 / 15 / 30 / 60] minutes:** close the screen and ask again after that time.
    - **Lock for [5 / 10 / 15 / 30 / 60] minutes:** a real lock on all the group's sites, using the normal lock screen, with no early way out until the time is up.
  - "Remind me" and "Lock for" each have their own dropdown.
  - Stats count how often the alert appeared and what you chose.
  - Translated to Spanish; covered by the Firefox test.

## Ideas

- Holidays for more countries
- [x] Light / dark mode setting (1.2.0)
- Sync settings across Firefox installs
- Countdown before a break starts
- Export and import groups
