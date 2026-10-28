/*
 * Anchor core: data model, URL matching, schedules, limits and puzzles.
 * Shared by the background script and every UI page (exposed as `Anchor`).
 */
(function (root) {
  'use strict';

  const GROUP_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
  const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const KEEP_DAYS = 35;

  // ---------- Model ----------

  function uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  function newGroup(name, index = 0) {
    return {
      id: uid(),
      name: name || 'New group',
      color: GROUP_COLORS[index % GROUP_COLORS.length],
      enabled: true,
      mode: 'block', // 'block' = block listed sites, 'allow' = block everything except listed sites
      sites: [],
      schedule: { enabled: false, rules: [{ days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }] },
      limit: { enabled: true, minutes: 30, period: 'day' },
      bypass: { enabled: true, minutes: 5, maxUses: 3, period: 'day' },
      lock: { method: 'puzzle', pinHash: null, salt: null }, // 'none' | 'puzzle' | 'pin'
    };
  }

  function defaultSettings() {
    const social = newGroup('Social', 0);
    social.sites = ['facebook.com', 'instagram.com', 'tiktok.com', 'x.com', 'twitter.com', 'reddit.com'];

    const work = newGroup('Deep work', 1);
    work.enabled = false;
    work.sites = ['youtube.com', 'news.ycombinator.com', 'netflix.com'];
    work.schedule.enabled = true;
    work.limit = { enabled: false, minutes: 15, period: 'hour' };

    return { version: 1, groups: [social, work] };
  }

  function emptyState() {
    // usage:  { [groupId]: { 'YYYY-MM-DDTHH': seconds } }
    // sites:  { 'YYYY-MM-DD': { host: seconds } }
    // blocks: { 'YYYY-MM-DD': { [groupId]: count } }
    // bypass: { [groupId]: { until: ms, uses: [ms...] } }
    return { usage: {}, sites: {}, blocks: {}, bypass: {} };
  }

  function normalizeState(s) {
    return Object.assign(emptyState(), s || {});
  }

  // ---------- Sites & matching ----------

  /** Turn user input like "https://www.YouTube.com/shorts/" into "youtube.com/shorts". */
  function parseSite(input) {
    let s = String(input || '').trim().toLowerCase();
    if (!s) return null;
    s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^\*\./, '').replace(/^www\./, '');
    const slash = s.indexOf('/');
    let host = slash === -1 ? s : s.slice(0, slash);
    let path = slash === -1 ? '' : s.slice(slash);
    host = host.replace(/:\d+$/, '').replace(/\.$/, '');
    path = path.split(/[?#]/)[0].replace(/\/+$/, '');
    if (!/^[a-z0-9.-]+$/.test(host)) return null;
    if (!host.includes('.') && host !== 'localhost') return null;
    return host + path;
  }

  function toURL(url) {
    if (url instanceof URL) return url;
    try { return new URL(url); } catch { return null; }
  }

  function isTrackable(url) {
    const u = toURL(url);
    return !!u && (u.protocol === 'http:' || u.protocol === 'https:');
  }

  function hostOf(url) {
    const u = toURL(url);
    return u ? u.hostname.toLowerCase().replace(/^www\./, '') : '';
  }

  /** Domain entries cover all subdomains; entries with a path cover that path and below. */
  function siteMatches(site, url) {
    const u = toURL(url);
    if (!u) return false;
    const slash = site.indexOf('/');
    const host = slash === -1 ? site : site.slice(0, slash);
    const path = slash === -1 ? '' : site.slice(slash);
    const h = u.hostname.toLowerCase();
    if (h !== host && !h.endsWith('.' + host)) return false;
    if (!path) return true;
    const p = u.pathname.toLowerCase().replace(/\/+$/, '');
    return p === path || p.startsWith(path + '/');
  }

  function groupMatches(group, url) {
    if (!isTrackable(url)) return false;
    const listed = group.sites.some((s) => siteMatches(s, url));
    return group.mode === 'allow' ? !listed : listed;
  }

  // ---------- Time helpers ----------

  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (t = Date.now()) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const hourKey = (t = Date.now()) => `${dayKey(t)}T${pad(new Date(t).getHours())}`;

  function periodStart(period, now) {
    const d = new Date(now);
    d.setMinutes(0, 0, 0);
    if (period === 'day') d.setHours(0);
    return d.getTime();
  }

  function periodEnd(period, now) {
    const d = new Date(periodStart(period, now));
    if (period === 'day') d.setDate(d.getDate() + 1);
    else d.setHours(d.getHours() + 1);
    return d.getTime();
  }

  function usedSeconds(state, groupId, period, now) {
    const u = state.usage[groupId] || {};
    if (period === 'hour') return u[hourKey(now)] || 0;
    const dk = dayKey(now);
    let total = 0;
    for (const k in u) if (k.startsWith(dk)) total += u[k];
    return total;
  }

  // ---------- Schedules ----------

  const toMinutes = (hhmm) => {
    const [h, m] = String(hhmm).split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };

  /** A rule with start == end covers the whole day; end < start runs overnight. */
  function scheduleActive(schedule, now) {
    if (!schedule || !schedule.enabled) return false;
    const d = new Date(now);
    const day = d.getDay();
    const mins = d.getHours() * 60 + d.getMinutes();
    return schedule.rules.some((r) => {
      const s = toMinutes(r.start);
      const e = toMinutes(r.end);
      if (s === e) return r.days.includes(day);
      if (s < e) return r.days.includes(day) && mins >= s && mins < e;
      return (r.days.includes(day) && mins >= s) || (r.days.includes((day + 6) % 7) && mins < e);
    });
  }

  /** Next time (ms) the schedule flips between active and inactive, or null within 8 days. */
  function nextScheduleChange(schedule, now) {
    if (!schedule || !schedule.enabled) return null;
    const current = scheduleActive(schedule, now);
    const t = new Date(now);
    t.setSeconds(0, 0);
    for (let i = 1; i <= 8 * 24 * 60; i++) {
      const at = t.getTime() + i * 60000;
      if (scheduleActive(schedule, at) !== current) return at;
    }
    return null;
  }

  // ---------- Evaluation ----------

  function bypassUsesLeft(group, state, now) {
    const bp = state.bypass[group.id];
    const start = periodStart(group.bypass.period, now);
    const used = ((bp && bp.uses) || []).filter((t) => t >= start).length;
    return Math.max(0, group.bypass.maxUses - used);
  }

  /**
   * Status of one group right now.
   * reason: 'schedule' | 'limit' | 'always' | null
   */
  function evaluateGroup(group, state, now) {
    const out = {
      group,
      enabled: group.enabled,
      blocked: false,
      reason: null,
      until: null,
      remaining: null,
      used: null,
      bypassUntil: 0,
      bypassLeft: group.bypass.enabled ? bypassUsesLeft(group, state, now) : 0,
    };
    if (group.limit.enabled) {
      out.used = usedSeconds(state, group.id, group.limit.period, now);
      out.remaining = Math.max(0, group.limit.minutes * 60 - out.used);
    }
    if (!group.enabled) return out;

    if (scheduleActive(group.schedule, now)) {
      out.reason = 'schedule';
      out.until = nextScheduleChange(group.schedule, now);
    } else if (group.limit.enabled && out.remaining <= 0) {
      out.reason = 'limit';
      out.until = periodEnd(group.limit.period, now);
    } else if (!group.schedule.enabled && !group.limit.enabled) {
      out.reason = 'always';
    }

    const bp = state.bypass[group.id];
    if (bp && bp.until > now) out.bypassUntil = bp.until;
    out.blocked = !!out.reason && !out.bypassUntil;
    return out;
  }

  /** Evaluate a URL against all groups. Returns matching group statuses and the first blocker. */
  function evaluateUrl(url, settings, state, now) {
    const matches = settings.groups
      .filter((g) => groupMatches(g, url))
      .map((g) => evaluateGroup(g, state, now));
    return { matches, blocker: matches.find((m) => m.blocked) || null };
  }

  // ---------- Usage recording ----------

  /** Add `seconds` of time on `url` ending at `end`, split across hour buckets. */
  function recordUsage(settings, state, url, start, end) {
    if (end <= start || !isTrackable(url)) return;
    const host = hostOf(url);
    const groups = settings.groups.filter((g) => groupMatches(g, url));
    let t = start;
    while (t < end) {
      const boundary = Math.min(end, periodEnd('hour', t));
      const secs = (boundary - t) / 1000;
      const dk = dayKey(t);
      const hk = hourKey(t);
      const day = (state.sites[dk] = state.sites[dk] || {});
      day[host] = (day[host] || 0) + secs;
      for (const g of groups) {
        const u = (state.usage[g.id] = state.usage[g.id] || {});
        u[hk] = (u[hk] || 0) + secs;
      }
      t = boundary;
    }
  }

  function pruneState(state, settings, now) {
    const cutoff = dayKey(now - KEEP_DAYS * 86400000);
    const ids = new Set(settings.groups.map((g) => g.id));
    for (const k of Object.keys(state.sites)) if (k < cutoff) delete state.sites[k];
    for (const k of Object.keys(state.blocks)) if (k < cutoff) delete state.blocks[k];
    for (const gid of Object.keys(state.usage)) {
      if (!ids.has(gid)) { delete state.usage[gid]; continue; }
      for (const k of Object.keys(state.usage[gid])) if (k < cutoff) delete state.usage[gid][k];
    }
    for (const gid of Object.keys(state.bypass)) {
      if (!ids.has(gid)) { delete state.bypass[gid]; continue; }
      const bp = state.bypass[gid];
      bp.uses = (bp.uses || []).filter((t) => t > now - 8 * 86400000);
    }
  }

  // ---------- Unlock challenges ----------

  async function hashPin(pin, salt) {
    const data = new TextEncoder().encode(`${salt}:${pin}`);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  const rand = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

  function makeProblem(op) {
    switch (op) {
      case '+': { const a = rand(12, 60), b = rand(7, 40); return { text: `${a} + ${b}`, answer: a + b }; }
      case '−': { const a = rand(25, 90), b = rand(6, a - 5); return { text: `${a} − ${b}`, answer: a - b }; }
      case '×': { const a = rand(3, 12), b = rand(3, 12); return { text: `${a} × ${b}`, answer: a * b }; }
      default:  { const b = rand(2, 12), ans = rand(2, 12); return { text: `${b * ans} ÷ ${b}`, answer: ans }; }
    }
  }

  /** Three easy problems, each using a different operation. */
  function makePuzzle() {
    const ops = ['+', '−', '×', '÷'];
    for (let i = ops.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ops[i], ops[j]] = [ops[j], ops[i]];
    }
    return ops.slice(0, 3).map(makeProblem);
  }

  // ---------- Formatting ----------

  function formatDuration(seconds) {
    seconds = Math.max(0, Math.round(seconds));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h) return m ? `${h}h ${m}m` : `${h}h`;
    if (m) return `${m}m`;
    return `${seconds}s`;
  }

  function formatClock(t) {
    return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function formatWhen(t, now = Date.now()) {
    if (!t) return '';
    const sameDay = dayKey(t) === dayKey(now);
    const tomorrow = dayKey(t) === dayKey(now + 86400000);
    const clock = formatClock(t);
    if (sameDay) return clock;
    if (tomorrow) return `tomorrow ${clock}`;
    return `${DAY_LABELS[new Date(t).getDay()]} ${clock}`;
  }

  /** Short human status for a group evaluation. kind: 'off' | 'blocked' | 'break' | 'open' */
  function describeStatus(st, now = Date.now()) {
    const g = st.group;
    const per = g.limit.period === 'hour' ? 'this hour' : 'today';
    if (!g.enabled) return { kind: 'off', text: 'Off' };
    if (st.bypassUntil) return { kind: 'break', text: `On a break until ${formatClock(st.bypassUntil)}` };
    if (st.reason === 'schedule') {
      return { kind: 'blocked', text: st.until ? `Blocking until ${formatWhen(st.until, now)}` : 'Blocking' };
    }
    if (st.reason === 'limit') {
      return { kind: 'blocked', text: `Limit reached · resets ${g.limit.period === 'day' ? 'at midnight' : formatClock(st.until)}` };
    }
    if (st.reason === 'always') return { kind: 'blocked', text: 'Always blocking' };
    const parts = [];
    if (st.remaining !== null) parts.push(`${formatDuration(st.remaining)} left ${per}`);
    if (g.schedule.enabled) {
      const next = nextScheduleChange(g.schedule, now);
      if (next) parts.push(`blocks ${formatWhen(next, now)}`);
    }
    return { kind: 'open', text: parts.join(' · ') || 'Open' };
  }

  const api = {
    GROUP_COLORS, DAY_LABELS,
    uid, newGroup, defaultSettings, emptyState, normalizeState,
    parseSite, isTrackable, hostOf, siteMatches, groupMatches,
    dayKey, hourKey, periodStart, periodEnd, usedSeconds,
    toMinutes, scheduleActive, nextScheduleChange,
    bypassUsesLeft, evaluateGroup, evaluateUrl,
    recordUsage, pruneState,
    hashPin, makePuzzle,
    formatDuration, formatClock, formatWhen, describeStatus,
  };

  root.Anchor = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
