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

- [ ] **Choose the days a group works, like a phone alarm.** Each group gets day buttons (M T W T F S S). On days that aren't ticked, the group is off: it blocks nothing and its time doesn't count.
  - By default every day is ticked, so existing groups behave as today.
  - For different rules on different days, use two groups with the same sites. For example: "Weekdays", ticked Monday to Friday with 30 minutes a day, and "Weekend", ticked Saturday and Sunday with 2 hours.
  - The popup and settings show "Not today" for a group that's off because of the day.
  - The schedule keeps its own days. Both have to agree for the schedule to block.

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
