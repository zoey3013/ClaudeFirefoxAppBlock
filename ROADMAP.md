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

## Done in 1.5.0

- [x] **Mode card: Block, Time allowance or Alert.** Each group picks one; breaks and unlock protection stay their own cards. Groups from 1.4 became *Time allowance* if they had one, otherwise *Block*.
- [x] **The schedule works with every mode:** it sets when the group is active. Outside its hours the group rests, and time doesn't count.
- [x] **Alert screen** in the group's color: Dismiss (for this visit), Remind me in 5–60 minutes, or Lock for 5–60 minutes with no way out. Stats count the alerts and answers.
- [x] **Fix:** a group resting for a holiday no longer shows its time left (reminder, countdown, toolbar badge).
- [x] **Fix:** the lock screen pauses videos inside shadow DOMs too, like Reddit's player.

## Ideas

- Holidays for more countries
- [x] Light / dark mode setting (1.2.0)
- Sync settings across Firefox installs
- Countdown before a break starts
- Export and import groups
