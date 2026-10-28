/* global Anchor, Challenge */
'use strict';

/** Stats view: totals, per-group usage, a 7-day chart and top sites. */
const Stats = (() => {
  const { el } = Challenge;
  let range = 'today'; // 'today' | 'week'

  function daysBack(n, now) {
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setHours(12, 0, 0, 0); // midday avoids DST edge cases
      d.setDate(d.getDate() - i);
      out.push(d.getTime());
    }
    return out;
  }

  const sum = (obj) => Object.values(obj || {}).reduce((a, b) => a + b, 0);

  function groupSeconds(state, gid, dayKeys) {
    const u = state.usage[gid] || {};
    let total = 0;
    for (const k in u) if (dayKeys.has(k.slice(0, 10))) total += u[k];
    return total;
  }

  function tile(label, value, sub) {
    return el('div', { class: 'tile' },
      el('p', { class: 'tile-label' }, label),
      el('p', { class: 'tile-value' }, value),
      el('p', { class: 'tile-sub faint' }, sub || ''));
  }

  function barChart(days, values) {
    const max = Math.max(...values, 60);
    const tip = el('div', { class: 'chart-tip', role: 'tooltip', hidden: '' });
    const bars = days.map((t, i) => {
      const v = values[i];
      const d = new Date(t);
      const label = i === days.length - 1 ? 'Today' : Anchor.DAY_LABELS[d.getDay()];
      const full = d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
      const col = el('div', { class: 'bar-col', tabindex: '0', 'aria-label': `${full}: ${Anchor.formatDuration(v)}` },
        el('div', { class: 'bar-track' },
          el('div', { class: 'bar', style: `height:${v ? Math.max(2, (v / max) * 100) : 0}%` })),
        el('span', { class: 'bar-label faint' }, label));
      const show = () => {
        tip.replaceChildren(el('strong', {}, Anchor.formatDuration(v)), el('span', { class: 'faint' }, full));
        tip.hidden = false;
        tip.style.left = `${((i + 0.5) / days.length) * 100}%`;
      };
      col.addEventListener('mouseenter', show);
      col.addEventListener('focus', show);
      col.addEventListener('mouseleave', () => { tip.hidden = true; });
      col.addEventListener('blur', () => { tip.hidden = true; });
      return col;
    });
    return el('div', { class: 'chart' }, el('div', { class: 'bars' }, ...bars), tip);
  }

  function render(root, settings, state) {
    const now = Date.now();
    const days = daysBack(range === 'today' ? 1 : 7, now);
    const keys = new Set(days.map((t) => Anchor.dayKey(t)));
    const start = range === 'today' ? Anchor.periodStart('day', now) : Anchor.periodStart('day', days[0]);

    // Totals
    const siteTotals = {};
    for (const k of keys) for (const [host, s] of Object.entries(state.sites[k] || {})) siteTotals[host] = (siteTotals[host] || 0) + s;
    const webTime = sum(siteTotals);
    let blocks = 0;
    for (const k of keys) blocks += sum(state.blocks[k]);
    let breaks = 0;
    for (const bp of Object.values(state.bypass)) breaks += (bp.uses || []).filter((t) => t >= start).length;

    const toggle = el('div', { class: 'segmented' });
    for (const [val, text] of [['today', 'Today'], ['week', 'Last 7 days']]) {
      const b = el('button', { type: 'button', 'aria-pressed': String(range === val) }, text);
      b.addEventListener('click', () => { range = val; render(root, settings, state); });
      toggle.append(b);
    }

    const head = el('div', { class: 'stats-head' }, el('h1', {}, 'Stats'), toggle);
    const tiles = el('div', { class: 'tiles' },
      tile('Time on the web', Anchor.formatDuration(webTime), range === 'week' ? `${Anchor.formatDuration(webTime / 7)} per day on average` : 'Active tab, browser focused'),
      tile('Blocked visits', String(blocks), 'Times a blocked site was opened'),
      tile('Breaks taken', String(breaks), 'Temporary unblocks'));

    // Groups
    const groupRows = settings.groups.map((g) => {
      const secs = groupSeconds(state, g.id, keys);
      const row = el('div', { class: 'grow' },
        el('div', { class: 'inline', style: 'justify-content:space-between' },
          el('span', { class: 'inline' }, el('span', { class: 'dot', style: `background:${g.color}` }), el('strong', {}, g.name)),
          el('span', { class: 'muted' }, Anchor.formatDuration(secs))));
      if (g.limit.enabled) {
        const used = Anchor.usedSeconds(state, g.id, g.limit.period, now);
        const cap = g.limit.minutes * 60;
        row.append(
          el('div', { class: 'meter' }, el('span', { style: `width:${Math.min(100, (used / cap) * 100)}%;background:${g.color}` })),
          el('p', { class: 'faint', style: 'font-size:12px' },
            `${Anchor.formatDuration(used)} of ${Anchor.formatDuration(cap)} allowance used ${g.limit.period === 'day' ? 'today' : 'this hour'}`));
      }
      return row;
    });

    // Top sites
    const top = Object.entries(siteTotals).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const topMax = top.length ? top[0][1] : 1;
    const siteRows = top.map(([host, s]) => {
      const g = settings.groups.find((x) => x.mode === 'block' && Anchor.groupMatches(x, `https://${host}/`));
      return el('div', { class: 'site-row' },
        el('span', { class: 'site-name' }, g ? el('span', { class: 'dot', style: `background:${g.color}`, title: g.name }) : el('span', { class: 'dot' }), host),
        el('div', { class: 'site-bar' }, el('span', { style: `width:${(s / topMax) * 100}%` })),
        el('span', { class: 'site-time muted' }, Anchor.formatDuration(s)));
    });

    const week = daysBack(7, now);
    const weekValues = week.map((t) => sum(state.sites[Anchor.dayKey(t)]));

    root.replaceChildren(
      head, tiles,
      el('section', { class: 'card' }, el('h2', {}, 'Daily time on the web'), barChart(week, weekValues)),
      el('section', { class: 'card' }, el('h2', {}, 'Focus groups'),
        ...(groupRows.length ? groupRows : [el('p', { class: 'muted' }, 'No groups yet.')])),
      el('section', { class: 'card' }, el('h2', {}, range === 'today' ? 'Top sites today' : 'Top sites this week'),
        ...(siteRows.length ? siteRows : [el('p', { class: 'muted' }, 'Nothing tracked yet. Browse a bit and check back.')])),
    );
  }

  return { render };
})();
